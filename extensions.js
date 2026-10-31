// Aero Browser — extensions.
// Installs Chrome Web Store extensions from the Aero Web Store (aero://store): downloads the
// extension package from Google's update server, unpacks it into <userData>/extensions/<id>, and
// loads it into every profile. Extensions with a toolbar popup get a button next to the address bar.
//
// Electron supports most of what extensions need (content scripts, storage, messaging, background
// workers), but not everything Chrome has, so some extensions only partly work.

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { app, ipcMain, session, BrowserWindow } = require("electron");

const extDir = () => path.join(app.getPath("userData"), "extensions");
const listFile = () => path.join(extDir(), "installed.json");
const isStoreId = id => /^[a-p]{32}$/.test(id || "");

// A .crx file is a zip with a small signed header in front. Strip the header to get the zip.
function crxToZip(buf) {
  if (buf.subarray(0, 2).toString() === "PK") return buf;
  if (buf.subarray(0, 4).toString() !== "Cr24") throw new Error("That isn't an extension package.");
  const version = buf.readUInt32LE(4);
  if (version === 3) return buf.subarray(12 + buf.readUInt32LE(8));
  if (version === 2) return buf.subarray(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
  throw new Error("Unknown extension package version " + version);
}

// Extension names can be placeholders like "__MSG_appName__" that point into _locales.
function readText(dir, manifest, value) {
  const m = /^__MSG_(\w+)__$/.exec(value || "");
  if (!m) return value || "";
  for (const locale of ["en", "en_US", "en_GB", manifest.default_locale].filter(Boolean)) {
    try {
      const messages = JSON.parse(fs.readFileSync(path.join(dir, "_locales", locale, "messages.json"), "utf8"));
      const entry = Object.entries(messages).find(([k]) => k.toLowerCase() === m[1].toLowerCase());
      if (entry) return entry[1].message;
    } catch {}
  }
  return value;
}

// The extension's toolbar icon, as a picture the browser UI can show.
function iconFor(dir, manifest) {
  const action = manifest.action || manifest.browser_action || {};
  const icons = typeof action.default_icon === "string" ? { 32: action.default_icon } : action.default_icon || manifest.icons || {};
  const sizes = Object.keys(icons).map(Number).sort((a, b) => Math.abs(a - 32) - Math.abs(b - 32));
  for (const size of sizes) {
    try {
      const file = path.join(dir, icons[size]);
      const ext = path.extname(file).slice(1).toLowerCase() || "png";
      return `data:image/${ext === "svg" ? "svg+xml" : ext};base64,` + fs.readFileSync(file).toString("base64");
    } catch {}
  }
  return null;
}

function setupExtensions({ sessions, send, chromeVersion }) {
  let installed = [];
  try { installed = JSON.parse(fs.readFileSync(listFile(), "utf8")); } catch {}
  const save = () => {
    fs.mkdirSync(extDir(), { recursive: true });
    fs.writeFileSync(listFile(), JSON.stringify(installed.map(({ icon, ...e }) => e), null, 2));
  };
  const electronIds = new Map(); // store id -> Electron's id for the loaded extension

  const describe = () => installed.map(e => ({
    id: e.id, name: e.name, version: e.version, description: e.description,
    icon: e.icon, hasPopup: !!e.popup, enabled: e.enabled !== false
  }));
  const announce = () => send("extensions:list", describe());

  async function loadInto(ses, e) {
    try {
      const ext = await ses.loadExtension(path.join(extDir(), e.id), { allowFileAccess: false });
      electronIds.set(e.id, ext.id);
    } catch (err) {
      e.error = err.message;
    }
  }

  async function install(id) {
    if (!isStoreId(id)) throw new Error("That isn't a Chrome Web Store extension id.");
    const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromeVersion}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
    // A private session with no extensions in it: an installed extension that watches network
    // requests (like Unhook) would otherwise make this download fail.
    const res = await session.fromPartition("aero-store-downloads").fetch(url);
    if (!res.ok) throw new Error("The Chrome Web Store didn't send it (" + res.status + ").");
    const zip = new AdmZip(crxToZip(Buffer.from(await res.arrayBuffer())));
    const dir = path.join(extDir(), id);
    fs.rmSync(dir, { recursive: true, force: true });
    zip.extractAllTo(dir, true);
    fs.rmSync(path.join(dir, "_metadata"), { recursive: true, force: true }); // Chrome-only signature files
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    const action = manifest.action || manifest.browser_action || {};
    const entry = {
      id,
      name: readText(dir, manifest, manifest.name),
      description: readText(dir, manifest, manifest.description),
      version: manifest.version,
      popup: action.default_popup || null,
      icon: iconFor(dir, manifest),
      enabled: true
    };
    // Reinstalling: unload the old copy first.
    await uninstallFromSessions(id);
    installed = installed.filter(e => e.id !== id).concat(entry);
    for (const ses of sessions()) await loadInto(ses, entry);
    save();
    announce();
    return { name: entry.name };
  }

  async function uninstallFromSessions(id) {
    const electronId = electronIds.get(id);
    if (!electronId) return;
    for (const ses of sessions()) {
      try { ses.removeExtension(electronId); } catch {}
    }
    electronIds.delete(id);
  }

  async function remove(id) {
    await uninstallFromSessions(id);
    installed = installed.filter(e => e.id !== id);
    fs.rmSync(path.join(extDir(), id), { recursive: true, force: true });
    save();
    announce();
  }

  // Shows an extension's popup in a small window under its toolbar button.
  function openPopup(id, ses, at, parent) {
    const e = installed.find(x => x.id === id);
    const electronId = electronIds.get(id);
    if (!e?.popup || !electronId) return;
    const popup = new BrowserWindow({
      x: Math.round(at.x - 360), y: Math.round(at.y), width: 380, height: 500,
      frame: false, resizable: false, skipTaskbar: true, show: false, parent,
      webPreferences: { session: ses, sandbox: true }
    });
    popup.loadURL(`chrome-extension://${electronId}/${e.popup.replace(/^\//, "")}`);
    popup.webContents.once("did-finish-load", async () => {
      // Fit the window to the popup's own size.
      const size = await popup.webContents.executeJavaScript(
        "({ w: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0), h: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) })"
      ).catch(() => null);
      if (size && !popup.isDestroyed()) popup.setBounds({ x: Math.round(at.x - Math.min(Math.max(size.w, 200), 800)), y: Math.round(at.y), width: Math.min(Math.max(size.w, 200), 800), height: Math.min(Math.max(size.h, 60), 600) });
      if (!popup.isDestroyed()) popup.show();
    });
    popup.on("blur", () => !popup.isDestroyed() && popup.close());
  }

  // The store page is the only page allowed to install or remove extensions.
  const fromStore = e => /^aero:\/\/store\//.test(e.sender.getURL());
  ipcMain.handle("store:install", async (e, id) => {
    if (!fromStore(e)) throw new Error("Not allowed");
    return install(id);
  });
  ipcMain.handle("store:remove", async (e, id) => {
    if (!fromStore(e)) throw new Error("Not allowed");
    return remove(id);
  });
  ipcMain.handle("store:list", e => (fromStore(e) ? describe() : []));
  ipcMain.on("extensions:refresh", () => announce());

  return {
    // Load every installed extension into a profile's session (called when it's set up).
    async addSession(ses) {
      for (const e of installed) {
        if (e.enabled === false) continue;
        if (!e.icon) e.icon = iconFor(path.join(extDir(), e.id), (() => { try { return JSON.parse(fs.readFileSync(path.join(extDir(), e.id, "manifest.json"), "utf8")); } catch { return {}; } })());
        await loadInto(ses, e);
      }
    },
    openPopup,
    list: describe
  };
}

module.exports = { setupExtensions, crxToZip };
