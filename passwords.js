// Aero Browser — the password manager.
// Passwords live only on this computer, in <userData>/passwords/<profile>.vault, encrypted with
// Windows' own data protection (Electron safeStorage), the same way Chrome protects saved passwords.
// Each profile has its own vault. An optional PIN guards seeing and copying passwords.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, ipcMain, safeStorage, clipboard } = require("electron");

const vaults = {}; // profileId -> { logins: [], never: [], pin: null }
const unlockedUntil = {}; // profileId -> time the PIN unlock runs out
const UNLOCK_MINUTES = 5;

const vaultFile = profileId => path.join(app.getPath("userData"), "passwords", profileId + ".vault");

function loadVault(profileId) {
  if (vaults[profileId]) return vaults[profileId];
  let vault = { logins: [], never: [], pin: null };
  try {
    const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(vaultFile(profileId))));
    vault = { ...vault, ...saved };
  } catch {}
  return (vaults[profileId] = vault);
}

function saveVault(profileId) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows encryption isn't available, so passwords can't be saved safely.");
  fs.mkdirSync(path.dirname(vaultFile(profileId)), { recursive: true });
  fs.writeFileSync(vaultFile(profileId), safeStorage.encryptString(JSON.stringify(vaults[profileId])));
}

const originOf = url => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch { return null; }
};
const hostOf = origin => origin.replace(/^https?:\/\//, "").replace(/^www\./, "");

// ----- PIN -----

const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("hex");

function isUnlocked(profileId) {
  const vault = loadVault(profileId);
  return !vault.pin || Date.now() < (unlockedUntil[profileId] || 0);
}

function checkPin(profileId, pin) {
  const { pin: saved } = loadVault(profileId);
  if (!saved) return true;
  const ok = crypto.timingSafeEqual(Buffer.from(hashPin(pin, saved.salt), "hex"), Buffer.from(saved.hash, "hex"));
  if (ok) unlockedUntil[profileId] = Date.now() + UNLOCK_MINUTES * 60 * 1000;
  return ok;
}

// ----- Setup -----

function setupPasswords(ctx) {
  // ctx: { send, tabs, tabIdFor(webContents), currentProfile() }
  const pending = {}; // tabId -> { origin, username, password } waiting for "Save?"
  const lastUsername = {}; // tabId -> username typed on an earlier step of a login

  const status = message => ctx.send("pw:status", message);

  function listFor(profileId) {
    const vault = loadVault(profileId);
    ctx.send("pw:list", {
      logins: vault.logins
        .map(l => ({ id: l.id, origin: l.origin, host: hostOf(l.origin), username: l.username, updated: l.updated }))
        .sort((a, b) => a.host.localeCompare(b.host)),
      never: vault.never.map(hostOf),
      hasPin: !!vault.pin,
      unlocked: isUnlocked(profileId),
      encrypted: safeStorage.isEncryptionAvailable()
    });
  }

  // Tell the UI whether this tab's page has a login form we have saved passwords for.
  function offerFill(tabId) {
    const t = ctx.tabs.get(tabId);
    if (!t) return;
    const origin = originOf(t.view.webContents.getURL());
    const logins = origin && t.hasLoginForm && t.profileId !== "incognito"
      ? loadVault(t.profileId).logins.filter(l => l.origin === origin)
      : [];
    ctx.send("pw:fillable", {
      tabId,
      host: origin ? hostOf(origin) : "",
      accounts: logins.map(l => ({ id: l.id, username: l.username || "(no username)" }))
    });
  }

  // ----- Messages from the little helper inside each tab -----

  ipcMain.on("pw:form", (e, present) => {
    const tabId = ctx.tabIdFor(e.sender);
    if (tabId == null) return;
    ctx.tabs.get(tabId).hasLoginForm = !!present;
    offerFill(tabId);
  });

  ipcMain.on("pw:username", (e, value) => {
    const tabId = ctx.tabIdFor(e.sender);
    if (tabId != null && typeof value === "string") lastUsername[tabId] = value.slice(0, 200);
  });

  ipcMain.on("pw:submit", (e, data) => {
    const tabId = ctx.tabIdFor(e.sender);
    if (tabId == null || !data || typeof data.password !== "string" || !data.password) return;
    const t = ctx.tabs.get(tabId);
    if (t.profileId === "incognito") return; // incognito never saves anything
    const origin = originOf(e.sender.getURL()); // where the form really is, never what the page claims
    if (!origin) return;
    const vault = loadVault(t.profileId);
    if (vault.never.includes(origin)) return;
    const username = String(data.username || lastUsername[tabId] || "").slice(0, 200);
    const password = data.password.slice(0, 500);
    const existing = vault.logins.find(l => l.origin === origin && l.username === username);
    if (existing && existing.password === password) return; // already saved
    const offer = { origin, username, password, update: !!existing };
    const before = pending[tabId];
    if (before && before.origin === origin && before.username === username && before.password === password) return;
    pending[tabId] = offer;
    ctx.send("pw:offer", { tabId, host: hostOf(origin), username, update: offer.update });
  });

  // ----- Messages from the browser UI -----

  ipcMain.on("pw:save", (e, tabId) => {
    const offer = pending[tabId];
    const t = ctx.tabs.get(tabId);
    if (!offer || !t) return;
    const vault = loadVault(t.profileId);
    const existing = vault.logins.find(l => l.origin === offer.origin && l.username === offer.username);
    if (existing) Object.assign(existing, { password: offer.password, updated: Date.now() });
    else vault.logins.push({ id: crypto.randomUUID(), origin: offer.origin, username: offer.username, password: offer.password, created: Date.now(), updated: Date.now() });
    delete pending[tabId];
    try { saveVault(t.profileId); status("Password saved 🔑"); } catch (err) { status(err.message); }
    listFor(ctx.currentProfile());
  });

  ipcMain.on("pw:never", (e, tabId) => {
    const offer = pending[tabId];
    const t = ctx.tabs.get(tabId);
    if (!offer || !t) return;
    const vault = loadVault(t.profileId);
    if (!vault.never.includes(offer.origin)) vault.never.push(offer.origin);
    delete pending[tabId];
    try { saveVault(t.profileId); } catch {}
    listFor(ctx.currentProfile());
  });

  ipcMain.on("pw:dismiss", (e, tabId) => delete pending[tabId]);

  ipcMain.on("pw:fill", (e, { tabId, id } = {}) => {
    const t = ctx.tabs.get(tabId);
    if (!t) return;
    const login = loadVault(t.profileId).logins.find(l => l.id === id);
    // Only ever fill a password into the exact site it was saved for.
    if (!login || login.origin !== originOf(t.view.webContents.getURL())) return;
    t.view.webContents.send("pw:fill", { username: login.username, password: login.password });
  });

  ipcMain.on("pw:refresh", () => listFor(ctx.currentProfile()));

  ipcMain.on("pw:unlock", (e, pin) => {
    const profileId = ctx.currentProfile();
    if (!checkPin(profileId, pin)) status("That PIN isn't right.");
    listFor(profileId);
  });

  ipcMain.on("pw:reveal", (e, id) => {
    const profileId = ctx.currentProfile();
    if (!isUnlocked(profileId)) return status("Unlock with your PIN first.");
    const login = loadVault(profileId).logins.find(l => l.id === id);
    if (login) ctx.send("pw:revealed", { id, password: login.password });
  });

  ipcMain.on("pw:copy", (e, { id, field } = {}) => {
    const profileId = ctx.currentProfile();
    const login = loadVault(profileId).logins.find(l => l.id === id);
    if (!login) return;
    if (field === "password" && !isUnlocked(profileId)) return status("Unlock with your PIN first.");
    const text = field === "password" ? login.password : login.username;
    clipboard.writeText(text);
    status(field === "password" ? "Password copied — it's wiped from the clipboard in 30 seconds." : "Username copied.");
    if (field === "password") setTimeout(() => clipboard.readText() === text && clipboard.writeText(""), 30000);
  });

  ipcMain.on("pw:upsert", (e, data = {}) => {
    const profileId = ctx.currentProfile();
    if (!isUnlocked(profileId)) return status("Unlock with your PIN first.");
    let site = String(data.site || "").trim();
    if (!/^https?:\/\//i.test(site)) site = "https://" + site;
    const origin = originOf(site);
    if (!origin || !data.password) return status("Type a website and a password.");
    const vault = loadVault(profileId);
    const existing = vault.logins.find(l => l.id === data.id);
    const fields = { origin, username: String(data.username || ""), password: String(data.password), updated: Date.now() };
    if (existing) Object.assign(existing, fields);
    else vault.logins.push({ id: crypto.randomUUID(), created: Date.now(), ...fields });
    try { saveVault(profileId); status("Saved 🔑"); } catch (err) { status(err.message); }
    listFor(profileId);
  });

  ipcMain.on("pw:delete", (e, id) => {
    const profileId = ctx.currentProfile();
    if (!isUnlocked(profileId)) return status("Unlock with your PIN first.");
    const vault = loadVault(profileId);
    vault.logins = vault.logins.filter(l => l.id !== id);
    try { saveVault(profileId); status("Deleted."); } catch (err) { status(err.message); }
    listFor(profileId);
  });

  ipcMain.on("pw:unnever", (e, host) => {
    const profileId = ctx.currentProfile();
    const vault = loadVault(profileId);
    vault.never = vault.never.filter(o => hostOf(o) !== host);
    try { saveVault(profileId); } catch {}
    listFor(profileId);
  });

  ipcMain.on("pw:set-pin", (e, { oldPin, newPin } = {}) => {
    const profileId = ctx.currentProfile();
    const vault = loadVault(profileId);
    if (vault.pin && !checkPin(profileId, oldPin)) return status("Your current PIN isn't right.");
    if (newPin && !/^\d{4,8}$/.test(newPin)) return status("A PIN is 4 to 8 numbers.");
    if (newPin) {
      const salt = crypto.randomBytes(16).toString("hex");
      vault.pin = { salt, hash: hashPin(newPin, salt) };
    } else {
      vault.pin = null;
    }
    try { saveVault(profileId); status(newPin ? "PIN set 🔒" : "PIN removed."); } catch (err) { status(err.message); }
    listFor(profileId);
  });

  return {
    offerFill,
    listFor,
    // Forget per-tab things when a tab goes away.
    forgetTab(tabId) {
      delete pending[tabId];
      delete lastUsername[tabId];
    }
  };
}

module.exports = { setupPasswords };
