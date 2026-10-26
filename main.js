// Aero Browser — the "engine room".
// The window shows our own glossy UI (ui/browser.html); every tab is a Chromium web view placed on top of it.

const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, session, Menu, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const PAGES = path.join(__dirname, "pages");
const HOME = "aero://newtab/";
const SITE_CSS = fs.readFileSync(path.join(PAGES, "aero-sites.css"), "utf8");

let win;
const tabs = new Map(); // id -> { view, profileId, cssKey, favicon }
let activeId = null;
let nextId = 1;
let viewBounds = { x: 0, y: 0, width: 0, height: 0 };
let restyleSites = true;
let searchUrl = "https://www.google.com/search?q=";

// aero:// is our own address scheme for built-in pages, like chrome:// in Chrome.
protocol.registerSchemesAsPrivileged([
  { scheme: "aero", privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// ================= Profiles =================
// Each profile has its own storage ("session"), so its logins, cookies and history
// stay separate, just like profiles in Chrome.

let profiles = [{ id: "default", name: "Me", color: "#1e9be8" }];
let currentProfile = "default";
const accounts = {}; // profileId -> Google accounts signed in there
const activeByProfile = {}; // profileId -> the tab you were last on
const readySessions = new Set();
let chromeUserAgent = "";

const profileFile = () => path.join(app.getPath("userData"), "profiles.json");

function loadProfiles() {
  try {
    const data = JSON.parse(fs.readFileSync(profileFile(), "utf8"));
    if (data.profiles?.length) profiles = data.profiles;
    currentProfile = profiles.some(p => p.id === data.current) ? data.current : profiles[0].id;
  } catch {}
}

function saveProfiles() {
  fs.writeFileSync(profileFile(), JSON.stringify({ profiles, current: currentProfile }, null, 2));
}

function sendProfiles() {
  send("profiles", { profiles, current: currentProfile, accounts });
}

function sessionFor(profileId) {
  const ses = profileId === "default" ? session.defaultSession : session.fromPartition("persist:profile-" + profileId);
  if (!readySessions.has(ses)) {
    setupSession(ses);
    readySessions.add(ses);
  }
  return ses;
}

function setupSession(ses) {
  // Google won't let you sign in from apps that say they're "Electron", so we introduce
  // ourselves the way Chromium browsers like Brave and Edge do.
  ses.setUserAgent(chromeUserAgent);

  // Serve built-in pages like aero://newtab/ from the "pages" folder,
  // and people's own themes from aero://themes/.
  ses.protocol.handle("aero", req => {
    const { host, pathname } = new URL(req.url);
    if (host === "themes") return serveThemeFile(decodeURIComponent(pathname));
    const root = path.join(PAGES, host);
    const file = path.normalize(path.join(root, pathname === "/" ? "index.html" : decodeURIComponent(pathname)));
    if (!file.startsWith(root)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ["*://*.youtube.com/embed/*", "*://accounts.google.com/*"] }, (details, done) => {
    const headers = details.requestHeaders;
    if (details.url.includes("youtube.com/embed/")) {
      // YouTube players refuse to start without a "Referer", which our built-in pages don't send.
      if (!headers.Referer) headers.Referer = "https://aero-browser.app/";
    } else {
      // Google blocks sign-in from browsers it doesn't recognise as Chrome, but happily allows
      // Firefox, so the sign-in page sees us as Firefox (and none of Chromium's tell-tale hints).
      headers["User-Agent"] = FIREFOX_UA;
      for (const name of Object.keys(headers)) if (/^sec-ch-ua/i.test(name)) delete headers[name];
    }
    done({ requestHeaders: headers });
  });
}

const FIREFOX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
const isGoogleSignIn = url => /^https:\/\/accounts\.google\.com\//.test(url);

// ================= Saved state (theme, last version seen) =================

const stateFile = () => path.join(app.getPath("userData"), "state.json");
let state = { lastVersion: null, activeTheme: null };
function loadState() {
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile(), "utf8")) }; } catch {}
}
function saveState() {
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

// ================= Custom themes =================
// A theme is a folder inside <userData>/themes with:
//   theme.json  — { "name", "author", "description" }
//   theme.css   — restyles the browser itself
//   newtab.css  — (optional) restyles the New Tab page
// plus any pictures or fonts those CSS files use.

const themesDir = () => path.join(app.getPath("userData"), "themes");
let themeVersion = Date.now(); // changes whenever a theme file changes, so pages reload it

function ensureThemesFolder() {
  const dir = themesDir();
  const builtIn = path.join(__dirname, "themes-builtin");
  fs.mkdirSync(dir, { recursive: true });
  // Example themes and the guide are copied in once, so people have something to learn from.
  for (const name of fs.readdirSync(builtIn)) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) fs.cpSync(path.join(builtIn, name), target, { recursive: true });
  }
}

function listThemes() {
  const list = [];
  for (const entry of fs.readdirSync(themesDir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(themesDir(), entry.name);
    if (!fs.existsSync(path.join(folder, "theme.css")) && !fs.existsSync(path.join(folder, "newtab.css"))) continue;
    let info = {};
    try { info = JSON.parse(fs.readFileSync(path.join(folder, "theme.json"), "utf8")); } catch {}
    list.push({
      id: entry.name,
      name: info.name || entry.name,
      author: info.author || "",
      description: info.description || "",
      newtab: fs.existsSync(path.join(folder, "newtab.css"))
    });
  }
  return list;
}

function sendThemes() {
  const list = listThemes();
  if (state.activeTheme && !list.some(t => t.id === state.activeTheme)) state.activeTheme = null;
  send("themes", { list, active: state.activeTheme, v: themeVersion });
}

// aero://themes/_active/theme.css is always "whatever theme is switched on" (or nothing).
function serveThemeFile(pathname) {
  const empty = () => new Response("", { headers: { "content-type": "text/css" } });
  let rel = pathname.replace(/^\/+/, "");
  if (rel.startsWith("_active/")) {
    if (!state.activeTheme) return empty();
    rel = state.activeTheme + rel.slice("_active".length);
  }
  const file = path.normalize(path.join(themesDir(), rel));
  if (!file.startsWith(themesDir() + path.sep) || !fs.existsSync(file)) return empty();
  return net.fetch(pathToFileURL(file).toString());
}

// Tells every page using the theme to fetch it again (used for live editing).
function refreshThemes() {
  themeVersion = Date.now();
  sendThemes();
  for (const t of tabs.values()) {
    if (t.view.webContents.getURL().startsWith("aero://")) {
      t.view.webContents.executeJavaScript(
        `document.getElementById("aeroTheme")?.setAttribute("href", "aero://themes/_active/newtab.css?v=${themeVersion}")`
      ).catch(() => {});
    }
  }
}

let themeWatchTimer;
function watchThemes() {
  try {
    fs.watch(themesDir(), { recursive: true }, () => {
      clearTimeout(themeWatchTimer);
      themeWatchTimer = setTimeout(refreshThemes, 250);
    });
  } catch {}
}

async function installTheme() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Add a theme",
    buttonLabel: "Add theme",
    filters: [{ name: "Theme files", extensions: ["css", "json"] }],
    properties: ["openFile"]
  });
  if (canceled || !filePaths[0]) return;
  const picked = filePaths[0];
  const folder = path.dirname(picked);
  // A file from a theme folder brings the whole folder; a lone .css becomes a new theme.
  if (fs.existsSync(path.join(folder, "theme.json")) || path.basename(picked) === "theme.css") {
    const id = path.basename(folder).replace(/[^\w.-]+/g, "-");
    fs.cpSync(folder, path.join(themesDir(), id), { recursive: true });
    state.activeTheme = id;
  } else {
    const id = path.basename(picked, ".css").replace(/[^\w.-]+/g, "-");
    fs.mkdirSync(path.join(themesDir(), id), { recursive: true });
    fs.copyFileSync(picked, path.join(themesDir(), id, "theme.css"));
    state.activeTheme = id;
  }
  saveState();
  refreshThemes();
}

// Asks Google which accounts are signed in to a profile (the same list Chrome's account menu uses).
async function refreshAccounts(profileId) {
  try {
    const res = await sessionFor(profileId).fetch(
      "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard"
    );
    const text = await res.text();
    const data = JSON.parse(text.slice(text.indexOf("[")));
    accounts[profileId] = (data[1] || [])
      .filter(a => typeof a[3] === "string" && a[3].includes("@"))
      .map(a => ({ name: a[2] || a[3], email: a[3], photo: a[4] || null }));
  } catch {
    accounts[profileId] ||= [];
  }
  sendProfiles();
}

const accountTimers = {};
function refreshAccountsSoon(profileId) {
  clearTimeout(accountTimers[profileId]);
  accountTimers[profileId] = setTimeout(() => refreshAccounts(profileId), 1500);
}

const profileTabs = profileId => [...tabs.keys()].filter(id => tabs.get(id).profileId === profileId);

function switchProfile(id) {
  if (id === currentProfile || !profiles.some(p => p.id === id)) return;
  for (const t of tabs.values()) t.view.setVisible(false);
  currentProfile = id;
  activeId = null;
  saveProfiles();
  sendProfiles();
  const own = profileTabs(id);
  if (!own.length) createTab();
  else activate(own.includes(activeByProfile[id]) ? activeByProfile[id] : own[own.length - 1]);
}

function addProfile({ name, color }) {
  const id = Date.now().toString(36);
  profiles.push({ id, name: name || "Profile " + (profiles.length + 1), color: color || "#3cc23c" });
  saveProfiles();
  switchProfile(id);
}

function updateProfile({ id, name, color }) {
  const p = profiles.find(x => x.id === id);
  if (!p) return;
  if (name) p.name = name;
  if (color) p.color = color;
  saveProfiles();
  sendProfiles();
}

async function deleteProfile(id) {
  if (profiles.length < 2 || !profiles.some(p => p.id === id)) return;
  for (const tid of profileTabs(id)) removeTab(tid);
  await sessionFor(id).clearStorageData().catch(() => {});
  profiles = profiles.filter(p => p.id !== id);
  delete accounts[id];
  if (currentProfile === id) {
    currentProfile = null;
    switchProfile(profiles[0].id);
  } else {
    saveProfiles();
    sendProfiles();
  }
}

// ================= Tabs =================

const send = (channel, data) => win && !win.isDestroyed() && win.webContents.send(channel, data);
const activeTab = () => tabs.get(activeId);

function tabInfo(id) {
  const t = tabs.get(id);
  const wc = t.view.webContents;
  const url = wc.getURL();
  return {
    id,
    profileId: t.profileId,
    url: url.startsWith(HOME) ? "" : url,
    title: wc.getTitle() || "New Tab",
    loading: wc.isLoading(),
    canBack: wc.navigationHistory.canGoBack(),
    canForward: wc.navigationHistory.canGoForward(),
    favicon: t.favicon || null
  };
}

const update = id => tabs.has(id) && send("tab:update", tabInfo(id));

function createTab(url = HOME, background = false, profileId = currentProfile) {
  const id = nextId++;
  const view = new WebContentsView({
    webPreferences: { sandbox: true, session: sessionFor(profileId), preload: path.join(__dirname, "tab-preload.js") }
  });
  const wc = view.webContents;
  view.setBackgroundColor("#ffffff");
  tabs.set(id, { view, profileId, cssKey: null, favicon: null });
  win.contentView.addChildView(view);
  view.setVisible(false);

  wc.on("page-title-updated", () => update(id));
  wc.on("did-start-loading", () => update(id));
  wc.on("did-stop-loading", () => update(id));
  wc.on("did-navigate", (e, navUrl) => {
    tabs.get(id).favicon = null;
    update(id);
    // Signing in or out happens on Google pages, so check the account list after visiting one.
    if (/^https:\/\/([a-z]+\.)*google\.com\//.test(navUrl)) refreshAccountsSoon(profileId);
  });
  wc.on("did-navigate-in-page", () => update(id));
  // Match what the page's own code sees (navigator.userAgent) to the Firefox disguise on Google sign-in.
  wc.on("did-start-navigation", (details, navUrl, inPlace, isMainFrame) => {
    const url = details.url ?? navUrl;
    if (details.isMainFrame ?? isMainFrame) wc.setUserAgent(isGoogleSignIn(url) ? FIREFOX_UA : chromeUserAgent);
  });
  wc.on("page-favicon-updated", (e, icons) => { tabs.get(id).favicon = icons[0] || null; update(id); });
  wc.on("dom-ready", () => applySiteStyle(id));
  wc.on("before-input-event", (e, input) => handleKey(input) && e.preventDefault());

  // Links that want a new window open as a new tab (in the same profile) instead.
  wc.setWindowOpenHandler(({ url: target }) => {
    createTab(target, false, profileId);
    return { action: "deny" };
  });

  send("tab:created", tabInfo(id));
  wc.loadURL(url);
  if (!background && profileId === currentProfile) activate(id);
  return id;
}

function activate(id) {
  const tab = tabs.get(id);
  if (!tab || tab.profileId !== currentProfile) return;
  activeId = id;
  activeByProfile[currentProfile] = id;
  for (const [tid, t] of tabs) {
    t.view.setVisible(tid === id);
    if (tid === id) t.view.setBounds(viewBounds);
  }
  send("tab:activated", id);
  // A fresh tab should let you type in the address bar straight away.
  const url = tab.view.webContents.getURL();
  if (!url || url.startsWith(HOME)) {
    win.webContents.focus();
    send("ui:focus-address");
  } else {
    tab.view.webContents.focus();
  }
}

function removeTab(id) {
  const t = tabs.get(id);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  tabs.delete(id);
  send("tab:closed", id);
}

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  const order = profileTabs(t.profileId);
  const index = order.indexOf(id);
  removeTab(id);
  if (t.profileId !== currentProfile) return;
  if (order.length === 1) return createTab();
  if (id === activeId) activate(order[index + 1] ?? order[index - 1]);
}

function cycleTabs(dir) {
  const order = profileTabs(currentProfile);
  const i = order.indexOf(activeId);
  activate(order[(i + dir + order.length) % order.length]);
}

// Turns whatever was typed in the address bar into a web address.
function toUrl(text) {
  text = text.trim();
  if (!text) return HOME;
  if (/^(https?|aero|file):/i.test(text)) return text;
  if (/^localhost(:\d+)?(\/|$)/i.test(text)) return "http://" + text;
  if (!/\s/.test(text) && /^[^.]+\.[^.]{2,}/.test(text)) return "https://" + text;
  return searchUrl + encodeURIComponent(text);
}

// ================= Aero style on websites =================

async function applySiteStyle(id) {
  const t = tabs.get(id);
  if (!t) return;
  const wc = t.view.webContents;
  if (t.cssKey) {
    await wc.removeInsertedCSS(t.cssKey).catch(() => {});
    t.cssKey = null;
  }
  if (restyleSites && !wc.getURL().startsWith("aero:")) {
    t.cssKey = await wc.insertCSS(SITE_CSS).catch(() => null);
  }
}

// ================= Keyboard shortcuts =================

function handleKey(input) {
  if (input.type !== "keyDown") return false;
  const key = input.key.toLowerCase();
  const ctrl = input.control || input.meta;
  const wc = activeTab()?.view.webContents;

  if (ctrl && key === "t") createTab();
  else if (ctrl && key === "w") closeTab(activeId);
  else if (ctrl && key === "tab") cycleTabs(input.shift ? -1 : 1);
  else if ((ctrl && key === "l") || key === "f6") { win.webContents.focus(); send("ui:focus-address"); }
  else if ((ctrl && key === "r") || key === "f5") wc?.reload();
  else if (input.alt && key === "arrowleft") wc?.navigationHistory.goBack();
  else if (input.alt && key === "arrowright") wc?.navigationHistory.goForward();
  else if (ctrl && (key === "=" || key === "+")) wc?.setZoomLevel(wc.getZoomLevel() + 0.5);
  else if (ctrl && key === "-") wc?.setZoomLevel(wc.getZoomLevel() - 0.5);
  else if (ctrl && key === "0") wc?.setZoomLevel(0);
  else if (key === "f12") wc?.toggleDevTools();
  else if (key === "f11") win.setFullScreen(!win.isFullScreen());
  else return false;
  return true;
}

// ================= Messages from the UI =================

const onActive = fn => () => {
  const wc = activeTab()?.view.webContents;
  if (wc) fn(wc);
};

ipcMain.on("ui:ready", () => {
  sendProfiles();
  sendThemes();
  send("app:info", { version: app.getVersion() });
  send("update:status", updateStatus);
  // After an update (or the very first launch), the What's new page is the first thing you see.
  const version = app.getVersion();
  if (state.lastVersion !== version) {
    const from = state.lastVersion ? "&from=" + encodeURIComponent(state.lastVersion) : "";
    createTab("aero://whatsnew/?v=" + encodeURIComponent(version) + from);
    state.lastVersion = version;
    saveState();
  } else if (!profileTabs(currentProfile).length) {
    createTab();
  }
  profiles.forEach(p => refreshAccounts(p.id));
});
ipcMain.on("tab:new", (e, url) => createTab(url ? toUrl(url) : HOME));
ipcMain.on("tab:close", (e, id) => closeTab(id));
ipcMain.on("tab:activate", (e, id) => activate(id));
ipcMain.on("nav:go", (e, text) => {
  const wc = activeTab()?.view.webContents;
  if (!wc) return;
  wc.loadURL(toUrl(text));
  wc.focus();
});
ipcMain.on("nav:back", onActive(wc => wc.navigationHistory.goBack()));
ipcMain.on("nav:forward", onActive(wc => wc.navigationHistory.goForward()));
ipcMain.on("nav:reload", onActive(wc => wc.reload()));
ipcMain.on("nav:stop", onActive(wc => wc.stop()));
ipcMain.on("nav:home", onActive(wc => wc.loadURL(HOME)));
ipcMain.on("view:bounds", (e, b) => {
  viewBounds = {
    x: Math.round(b.x), y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height))
  };
  activeTab()?.view.setBounds(viewBounds);
});
ipcMain.on("set:restyle", (e, on) => {
  restyleSites = on;
  for (const id of tabs.keys()) applySiteStyle(id);
});
ipcMain.on("set:search", (e, url) => { searchUrl = url; });
ipcMain.on("profile:switch", (e, id) => switchProfile(id));
ipcMain.on("profile:add", (e, data) => addProfile(data || {}));
ipcMain.on("profile:update", (e, data) => updateProfile(data || {}));
ipcMain.on("profile:delete", (e, id) => deleteProfile(id));
ipcMain.on("profile:refresh", () => refreshAccounts(currentProfile));
ipcMain.on("theme:set", (e, id) => {
  state.activeTheme = id || null;
  saveState();
  refreshThemes();
});
ipcMain.on("theme:install", () => installTheme().catch(err => dialog.showErrorBox("Couldn't add that theme", err.message)));
ipcMain.on("theme:open-folder", () => shell.openPath(themesDir()));
ipcMain.on("whatsnew:open", () => createTab("aero://whatsnew/?v=" + encodeURIComponent(app.getVersion())));
ipcMain.on("update:check", () => (updater ? updater.checkForUpdates().catch(() => {}) : sendUpdate({ state: "dev" })));
ipcMain.on("update:restart", () => updater?.quitAndInstall(true, true));
ipcMain.on("win:min", () => win.minimize());
ipcMain.on("win:max", () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on("win:close", () => win.close());

// ================= Automatic updates =================
// Like Chrome: new versions download quietly from GitHub Releases in the background
// and get installed the next time you close the browser (or straight away with "Restart to update").

let updater = null;
let updateStatus = { state: "idle" };

function sendUpdate(status) {
  updateStatus = status;
  send("update:status", status);
}

function setupAutoUpdates() {
  if (!app.isPackaged) return; // only the installed app updates itself
  try { updater = require("electron-updater").autoUpdater; } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("checking-for-update", () => sendUpdate({ state: "checking" }));
  updater.on("update-not-available", () => sendUpdate({ state: "latest" }));
  updater.on("update-available", info => sendUpdate({ state: "downloading", version: info.version, percent: 0 }));
  updater.on("download-progress", p => sendUpdate({ ...updateStatus, state: "downloading", percent: Math.round(p.percent) }));
  updater.on("update-downloaded", info => sendUpdate({ state: "ready", version: info.version }));
  updater.on("error", err => sendUpdate({ state: "error", message: String(err?.message || err).slice(0, 200) }));
  const check = () => updater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

// ================= Start =================

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    backgroundColor: "#3aa6f0",
    title: "Aero Browser",
    icon: path.join(__dirname, "icons", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  win.loadFile(path.join(__dirname, "ui", "browser.html"));
  win.webContents.on("before-input-event", (e, input) => handleKey(input) && e.preventDefault());
  win.on("maximize", () => send("win:state", "max"));
  win.on("unmaximize", () => send("win:state", "normal"));

  // Debug helper: AERO_SNAPSHOT=<folder> saves pictures of the UI and the current tab, then quits.
  if (process.env.AERO_SNAPSHOT) {
    const log = text => fs.appendFileSync(path.join(process.env.AERO_SNAPSHOT, "log.txt"), text + "\n");
    win.webContents.on("console-message", (e, level, message, line, source) => log(`[ui] ${message} ${source}:${line}`));
    process.on("uncaughtException", err => log("[main] " + err.stack));
    // AERO_SNAPSHOT_OPEN=url1,url2 opens extra tabs; AERO_SNAPSHOT_JS runs in the UI before the picture.
    setTimeout(() => (process.env.AERO_SNAPSHOT_OPEN || "").split(",").filter(Boolean).forEach(u => createTab(u)), 2500);
    setTimeout(async () => {
      const dir = process.env.AERO_SNAPSHOT;
      if (process.env.AERO_SNAPSHOT_JS) {
        await win.webContents.executeJavaScript(process.env.AERO_SNAPSHOT_JS).catch(e => log("[js] " + e.message));
        await new Promise(r => setTimeout(r, 1500));
      }
      log("[ui state] " + await win.webContents.executeJavaScript(
        "JSON.stringify({aero: typeof window.aero, tabs: document.querySelectorAll('.tab').length, marks: document.querySelectorAll('#bookmarks button').length, themeHref: document.querySelector('#userTheme').href, sheet: (() => { try { return document.querySelector('#userTheme').sheet?.cssRules.length } catch (e) { return 'err ' + e.message } })(), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent'), script: typeof applyPrefs, panelOpen: !document.querySelector('#profiles').hidden, panelW: document.querySelector('#profiles').offsetWidth, bodyKids: document.querySelector('#profilesBody').children.length, bg: getComputedStyle(document.querySelector('#profiles')).backgroundImage.slice(0,80)})"
      ).catch(e => "error " + e.message));
      log("[tabs] " + JSON.stringify([...tabs.keys()].map(id => ({ ...tabInfo(id), wcUrl: tabs.get(id).view.webContents.getURL() }))));
      log("[profiles] " + JSON.stringify({ profiles, currentProfile, accounts }));
      for (const [id, t] of tabs) {
        log(`[tab ${id} sees] ` + await t.view.webContents.executeJavaScript(
          "navigator.userAgent + ' | userAgentData: ' + typeof navigator.userAgentData"
        ).catch(e => e.message));
      }
      fs.writeFileSync(path.join(dir, "ui.png"), (await win.webContents.capturePage()).toPNG());
      const tab = activeTab();
      if (tab) fs.writeFileSync(path.join(dir, "tab.png"), (await tab.view.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(dir, "bounds.json"), JSON.stringify(viewBounds));
      app.quit();
    }, +process.env.AERO_SNAPSHOT_DELAY || 6000);
  }
}

// Lets Windows group the taskbar button and Start menu shortcut under our own app.
app.setAppUserModelId("com.aero.browser");

// Debug helper: AERO_USER_DATA=<folder> keeps a test run's profiles and logins away from your real ones.
if (process.env.AERO_USER_DATA) app.setPath("userData", process.env.AERO_USER_DATA);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  chromeUserAgent = app.userAgentFallback.replace(/ (Electron|AeroBrowser|aero-browser)\/\S+/gi, "");
  app.userAgentFallback = chromeUserAgent;
  loadProfiles();
  loadState();
  ensureThemesFolder();
  watchThemes();
  sessionFor("default"); // the browser UI uses this session too, and needs aero://themes/ ready
  createWindow();
  setupAutoUpdates();
});

app.on("window-all-closed", () => app.quit());
