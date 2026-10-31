// Aero Browser — the "engine room".
// Every profile gets its own window. Each window shows our own glossy UI (ui/browser.html), and every
// tab is a Chromium web view placed on top of it.

const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, session, Menu, dialog, shell, clipboard, nativeTheme } = require("electron");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { setupPasswords } = require("./passwords");
const { setupPower } = require("./power");
const { setupAdblock, skipHiding } = require("./adblock");
const { setupDownloads } = require("./downloads");
const { setupBookmarks } = require("./bookmarks");
const { setupExtensions } = require("./extensions");
const { setupDefaultBrowser } = require("./default-browser");

let passwords = null; // the password manager, started once the app is ready
let power = null; // the CPU/RAM manager
let adblock = null; // the ad blocker
let downloads = null; // the downloads manager
let extensions = null; // installed extensions

const PAGES = path.join(__dirname, "pages");
const HOME = "aero://newtab/";
const SITE_CSS = fs.readFileSync(path.join(PAGES, "aero-sites.css"), "utf8");
const SITE_FIXES_CSS = fs.readFileSync(path.join(PAGES, "site-fixes.css"), "utf8"); // always applied last

const tabs = new Map(); // tab id -> { view, profileId, cssKey, favicon, attached, sleeping }
let nextId = 1;
let restyleSites = true;
let searchUrl = "https://www.google.com/search?q=";
const pendingLaunchUrls = process.platform === "win32" ? urlsFromArgs(process.argv) : [];
let appReady = false;

// aero:// is our own address scheme for built-in pages, like chrome:// in Chrome.
protocol.registerSchemesAsPrivileged([
  { scheme: "aero", privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// ================= Profiles =================
// Each profile has its own storage ("session"), so its logins, cookies and history stay separate,
// and its own window, just like profiles in Chrome.

let profiles = [{ id: "default", name: "Me", color: "#1e9be8" }];
let currentProfile = "default"; // the profile whose window you used last
const accounts = {}; // profileId -> Google accounts signed in there
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
  const current = currentProfile === INCOGNITO ? lastProfile : currentProfile;
  fs.writeFileSync(profileFile(), JSON.stringify({ profiles, current }, null, 2));
}

const profileName = id => (id === INCOGNITO ? "Incognito" : profiles.find(p => p.id === id)?.name || "Aero Browser");

// Every window gets the profile list, plus which profile is its own.
function sendProfiles() {
  for (const w of windows.values()) {
    sendTo(w, "profiles", {
      profiles, current: w.profileId, accounts, signInMode: signInMode(),
      incognito: w.profileId === INCOGNITO, incognitoOpen: windows.has(INCOGNITO),
      openProfiles: [...windows.keys()]
    });
  }
}

// Incognito works like a temporary profile: its session has no "persist:" name, so cookies,
// logins and history live only in memory and vanish when incognito is closed.
const INCOGNITO = "incognito";
let lastProfile = "default"; // the normal profile to go back to after incognito

function sessionFor(profileId) {
  const ses = profileId === "default" ? session.defaultSession
    : profileId === INCOGNITO ? session.fromPartition("aero-incognito")
    : session.fromPartition("persist:profile-" + profileId);
  if (!readySessions.has(ses)) {
    setupSession(ses);
    readySessions.add(ses);
  }
  return ses;
}

function setupSession(ses) {
  adblock?.addSession(ses);
  downloads?.addSession(ses);
  extensions?.addSession(ses);

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
    } else if (signInMode() === "firefox") {
      // "Firefox" sign-in mode: Google's sign-in page sees us as Firefox (with no Chromium hints).
      headers["User-Agent"] = FIREFOX_UA;
      for (const name of Object.keys(headers)) if (/^sec-ch-ua/i.test(name)) delete headers[name];
    } else if (signInMode() === "chrome") {
      // "Chrome" sign-in mode (the default): Google's sign-in page sees exactly what Google Chrome
      // sends. "Sign in with Google" on other sites (like Aternos) rejects browsers that don't.
      for (const name of Object.keys(headers)) if (/^sec-ch-ua(-full-version-list)?$/i.test(name)) delete headers[name];
      headers["sec-ch-ua"] = CHROME_BRANDS(CHROME_MAJOR);
      headers["sec-ch-ua-full-version-list"] = CHROME_BRANDS(CHROME_FULL, "99.0.0.0");
    }
    // Otherwise ("chromium" mode) we're simply a Chromium browser, like Brave or Edge.
    done({ requestHeaders: headers });
  });
}

const FIREFOX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
const CHROME_FULL = process.versions.chrome;
const CHROME_MAJOR = CHROME_FULL.split(".")[0];
const CHROME_BRANDS = (version, other = "99") => `"Google Chrome";v="${version}", "Chromium";v="${version}", "Not?A_Brand";v="${other}"`;
// How we introduce ourselves to Google's sign-in pages: "chrome" (default), "chromium" or "firefox".
// Changeable in Profiles.
const signInMode = () => (["firefox", "chromium"].includes(state.signInMode) ? state.signInMode : "chrome");
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

// Built-in theme files get updated with new versions of the browser, unless you've changed that
// file yourself: .builtin.json remembers what we last put there, so your edits are never overwritten.
function refreshBuiltInThemes(builtIn, dir) {
  const recordFile = path.join(dir, ".builtin.json");
  let record = null; // null = a copy from before 0.6.0, which never recorded anything
  try { record = JSON.parse(fs.readFileSync(recordFile, "utf8")); } catch {}
  const hash = data => crypto.createHash("sha1").update(data).digest("hex");
  const next = {};
  const walk = rel => {
    const from = path.join(builtIn, rel);
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(path.join(dir, rel), { recursive: true });
      for (const name of fs.readdirSync(from)) walk(path.join(rel, name));
      return;
    }
    const key = rel.split(path.sep).join("/");
    const data = fs.readFileSync(from);
    const to = path.join(dir, rel);
    const current = fs.existsSync(to) ? fs.readFileSync(to) : null;
    const untouched = !current || !record || record[key] === hash(current);
    if (untouched && (!current || !current.equals(data))) fs.writeFileSync(to, data);
    next[key] = untouched ? hash(data) : record[key];
  };
  for (const name of fs.readdirSync(builtIn)) if (name !== "THEME-GUIDE.md") walk(name);
  fs.writeFileSync(recordFile, JSON.stringify(next, null, 1));
}

function ensureThemesFolder() {
  const dir = themesDir();
  fs.mkdirSync(dir, { recursive: true });
  // Example themes and the guide are copied in (and kept up to date), so people always have
  // something to learn from.
  const builtIn = path.join(__dirname, "themes-builtin");
  refreshBuiltInThemes(builtIn, dir);
  // The guide isn't something people edit, so keep it up to date with each version.
  fs.writeFileSync(path.join(dir, "THEME-GUIDE.md"), fs.readFileSync(path.join(builtIn, "THEME-GUIDE.md")));
}

function listThemes() {
  const list = [];
  for (const entry of fs.readdirSync(themesDir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(themesDir(), entry.name);
    const has = file => fs.existsSync(path.join(folder, file));
    if (!["theme.css", "newtab.css", "websites.css", "sites"].some(has)) continue;
    let info = {};
    try { info = JSON.parse(fs.readFileSync(path.join(folder, "theme.json"), "utf8")); } catch {}
    list.push({
      id: entry.name,
      name: info.name || entry.name,
      author: info.author || "",
      description: info.description || "",
      newtab: has("newtab.css"),
      websites: has("websites.css") || has("sites")
    });
  }
  return list;
}

function sendThemes() {
  const list = listThemes();
  if (state.activeTheme && !list.some(t => t.id === state.activeTheme)) state.activeTheme = null;
  sendAll("themes", { list, active: state.activeTheme, v: themeVersion });
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
// A theme's theme.json can say "websites": "light" or "dark". Websites with their own dark mode
// (like Google) then pick the matching one, so their text stays readable on the theme's colours.
// Without it, websites follow Windows' light/dark setting.
function applySiteColorScheme() {
  let scheme = "system";
  if (state.activeTheme) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(themesDir(), state.activeTheme, "theme.json"), "utf8"));
      if (["light", "dark"].includes(info.websites)) scheme = info.websites;
    } catch {}
  }
  nativeTheme.themeSource = scheme;
}

function refreshThemes() {
  themeVersion = Date.now();
  applySiteColorScheme();
  sendThemes();
  for (const [id, t] of tabs) {
    if (t.view.webContents.getURL().startsWith("aero://")) {
      t.view.webContents.executeJavaScript(
        `document.getElementById("aeroTheme")?.setAttribute("href", "aero://themes/_active/newtab.css?v=${themeVersion}")`
      ).catch(() => {});
    } else {
      applySiteStyle(id); // websites.css and sites/*.css
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

async function installTheme(w) {
  const { canceled, filePaths } = await dialog.showOpenDialog(w.win, {
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
// Google only answers this as a POST request: a plain GET gets "400 Bad Request", which is why
// signed-in accounts used to show as "Not signed in".
const ACCOUNT_LIST_URL = "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard";

async function refreshAccounts(profileId) {
  if (profileId === INCOGNITO) return;
  try {
    const res = await sessionFor(profileId).fetch(ACCOUNT_LIST_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ""
    });
    if (!res.ok) throw new Error("Google answered " + res.status);
    accounts[profileId] = parseAccounts(await res.text());
    debugLog(`google accounts for profile ${profileId}: ${accounts[profileId].length} found`);
  } catch (err) {
    accounts[profileId] ||= [];
    debugLog(`google accounts for profile ${profileId}: check failed (${err.message})`);
  }
  sendProfiles();
}

// Google's answer looks like ["gaia.l.a.r", [["gaia.l.a", 1, "Name", "you@gmail.com", "https://…photo", …], …]].
// Rather than trusting exact positions (which Google can change), pick out the email, photo and name.
function parseAccounts(text) {
  const data = JSON.parse(text.slice(text.indexOf("[")));
  const list = [];
  for (const entry of Array.isArray(data[1]) ? data[1] : []) {
    if (!Array.isArray(entry)) continue;
    const strings = entry.filter(x => typeof x === "string");
    const email = strings.find(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (!email) continue;
    const photo = strings.find(x => /^https:\/\/.*(googleusercontent|ggpht)/.test(x)) || null;
    const name = strings.find(x => x !== email && x !== photo && !/^gaia\./.test(x) && !/^https?:/.test(x) && !/^\d+$/.test(x)) || email;
    if (!list.some(a => a.email === email)) list.push({ name, email, photo });
  }
  return list;
}

const accountTimers = {};
function refreshAccountsSoon(profileId) {
  clearTimeout(accountTimers[profileId]);
  accountTimers[profileId] = setTimeout(() => refreshAccounts(profileId), 1500);
}


// ================= Windows =================
// One window per profile. Each window keeps its own tabs, layout, split screen and apps sidebar.

const windows = new Map(); // profileId -> window state (see openProfileWindow)

const sendTo = (w, channel, data) => w && !w.win.isDestroyed() && w.win.webContents.send(channel, data);
const sendAll = (channel, data) => { for (const w of windows.values()) sendTo(w, channel, data); };
const windowOfTab = id => (tabs.has(id) ? windows.get(tabs.get(id).profileId) : null);
const sendForTab = (id, channel, data) => sendTo(windowOfTab(id), channel, data);
const windowFor = webContents => [...windows.values()].find(w => !w.win.isDestroyed() && w.win.webContents === webContents);
const focusedWindow = () => windows.get(currentProfile) || [...windows.values()][0];
const activeTabOf = w => (w ? tabs.get(w.activeId) : null);
const isActive = id => windowOfTab(id)?.activeId === id;
const profileTabs = profileId => [...tabs.keys()].filter(id => tabs.get(id).profileId === profileId);

// Opens a profile's window (or brings it to the front if it's already open).
// startUrls are opened as its first tabs once its UI is ready.
function openProfileWindow(profileId, startUrls = []) {
  if (profileId !== INCOGNITO && !profiles.some(p => p.id === profileId)) return null;
  const existing = windows.get(profileId);
  if (existing) {
    for (const url of startUrls) createTab(url, false, profileId);
    if (existing.win.isMinimized()) existing.win.restore();
    existing.win.show();
    existing.win.focus();
    return existing;
  }

  const offset = windows.size * 30;
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    x: offset ? 120 + offset : undefined,
    y: offset ? 60 + offset : undefined,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    show: !process.env.AERO_SNAPSHOT || !!process.env.AERO_SNAPSHOT_VISIBLE, // test runs stay invisible unless asked
    backgroundColor: profileId === INCOGNITO ? "#2b1747" : "#3aa6f0",
    title: "Aero Browser — " + profileName(profileId),
    icon: path.join(__dirname, "icons", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  const w = {
    win, profileId, startUrls: [...startUrls],
    activeId: null, previousActive: null,
    viewBounds: { x: 0, y: 0, width: 0, height: 0 },
    split: null, splitRatio: 0.5, splitDragging: false, fullscreenTab: null,
    appViews: new Map(), openAppId: null, appBounds: null
  };
  windows.set(profileId, w);
  if (profileId !== INCOGNITO) lastProfile = profileId;
  currentProfile = profileId;

  win.loadFile(path.join(__dirname, "ui", "browser.html"));
  win.webContents.on("before-input-event", (e, input) => handleKey(input, w) && e.preventDefault());
  win.on("maximize", () => sendTo(w, "win:state", "max"));
  win.on("unmaximize", () => sendTo(w, "win:state", "normal"));
  win.on("focus", () => {
    currentProfile = profileId;
    if (profileId !== INCOGNITO) {
      lastProfile = profileId;
      saveProfiles();
    }
  });
  // Coming back to the window (from minimised, or from another app or game): redraw the page.
  for (const event of ["show", "restore", "focus"]) win.on(event, () => layoutViews(w, "window " + event));
  win.on("resize", () => w.fullscreenTab != null && layoutViews(w, "full screen resize", false));
  for (const event of ["minimize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    win.on(event, () => debugLog(`window ${profileId} ${event} ${JSON.stringify(win.getContentBounds())}`));
  }
  win.on("closed", () => closeWindowState(w));

  if (process.env.AERO_SNAPSHOT && !snapshotArmed) armSnapshot(w);
  sendProfiles();
  return w;
}

// A window closed: close its tabs and apps. Closing the incognito window wipes everything it stored.
function closeWindowState(w) {
  windows.delete(w.profileId);
  for (const id of profileTabs(w.profileId)) {
    const t = tabs.get(id);
    if (t.view.webContents && !t.view.webContents.isDestroyed()) t.view.webContents.close();
    tabs.delete(id);
    passwords?.forgetTab(id);
    power?.forget(id);
  }
  for (const a of w.appViews.values()) if (!a.view.webContents.isDestroyed()) a.view.webContents.close();
  if (w.profileId === INCOGNITO) {
    for (let i = closedTabs.length - 1; i >= 0; i--) if (closedTabs[i].profileId === INCOGNITO) closedTabs.splice(i, 1);
    sessionFor(INCOGNITO).clearStorageData().catch(() => {});
    sessionFor(INCOGNITO).clearCache().catch(() => {});
  }
  if (currentProfile === w.profileId) currentProfile = [...windows.keys()][0] || lastProfile;
  sendProfiles();
}

function closeIncognito() {
  windows.get(INCOGNITO)?.win.close();
}

function switchProfile(id) {
  openProfileWindow(id);
}

function addProfile({ name, color }) {
  const id = Date.now().toString(36);
  profiles.push({ id, name: name || "Profile " + (profiles.length + 1), color: color || "#3cc23c" });
  saveProfiles();
  openProfileWindow(id);
}

function updateProfile({ id, name, color }) {
  const p = profiles.find(x => x.id === id);
  if (!p) return;
  if (name) p.name = name;
  if (color) p.color = color;
  saveProfiles();
  windows.get(id)?.win.setTitle("Aero Browser — " + p.name);
  sendProfiles();
}

async function deleteProfile(id) {
  if (profiles.length < 2 || !profiles.some(p => p.id === id)) return;
  profiles = profiles.filter(p => p.id !== id);
  delete accounts[id];
  if (lastProfile === id) lastProfile = profiles[0].id;
  if (currentProfile === id) currentProfile = profiles[0].id;
  saveProfiles();
  const w = windows.get(id);
  // Keep the browser open: show another profile before closing this one's window.
  if (w && windows.size === 1) openProfileWindow(profiles[0].id);
  w?.win.close();
  await sessionFor(id).clearStorageData().catch(() => {});
  sendProfiles();
}

// ================= Tabs =================

function tabInfo(id) {
  const t = tabs.get(id);
  const wc = t.view.webContents;
  if (!wc || wc.isDestroyed()) return { id, profileId: t.profileId, url: "", title: "Closed tab", sleeping: false, loading: false, canBack: false, canForward: false, favicon: null };
  const url = t.sleeping ? t.sleeping.url : wc.getURL();
  return {
    id,
    profileId: t.profileId,
    url: url.startsWith(HOME) ? "" : url,
    title: (t.sleeping ? t.sleeping.title : wc.getTitle()) || "New Tab",
    sleeping: !!t.sleeping,
    loading: !t.sleeping && wc.isLoading(),
    canBack: wc.navigationHistory.canGoBack(),
    canForward: wc.navigationHistory.canGoForward(),
    muted: wc.isAudioMuted(),
    favicon: t.favicon || null
  };
}

const update = id => tabs.has(id) && sendForTab(id, "tab:update", tabInfo(id));

// Opens a page in a profile: in a new tab of its window, opening the window first if needed.
function openInProfile(profileId, url) {
  if (windows.has(profileId)) createTab(url, false, profileId);
  else openProfileWindow(profileId, [url]);
}

// Windows passes web links as command-line arguments when Aero is selected as the default browser.
function urlsFromArgs(args = []) {
  return args.filter(value => {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
    try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
  });
}

function createTab(url = HOME, background = false, profileId = currentProfile) {
  const w = windows.get(profileId);
  if (!w) return null;
  const id = nextId++;
  const view = new WebContentsView({
    webPreferences: { sandbox: true, session: sessionFor(profileId), preload: path.join(__dirname, "tab-preload.js") }
  });
  const wc = view.webContents;
  view.setBackgroundColor("#ffffff");
  tabs.set(id, { view, profileId, cssKey: null, favicon: null, attached: false });

  wc.on("page-title-updated", () => update(id));
  wc.on("did-start-loading", () => update(id));
  wc.on("did-stop-loading", () => update(id));
  wc.on("did-navigate", (e, navUrl) => {
    const t = tabs.get(id);
    if (!t) return;
    if (!navUrl.startsWith(SLEEP_PAGE)) {
      t.favicon = null;
      t.sleeping = null; // woken up (e.g. by clicking the sleeping page)
      blockedCounts.delete(id);
      sendForTab(id, "adblock:counts", Object.fromEntries(blockedCounts));
    }
    t.hasLoginForm = false;
    t.lastUrl = navUrl;
    passwords?.offerFill(id);
    update(id);
    // Signing in or out happens on Google pages, so check the account list after visiting one.
    if (/^https:\/\/([a-z]+\.)*google\.com\//.test(navUrl)) refreshAccountsSoon(profileId);
  });
  wc.on("did-navigate-in-page", (e, navUrl, isMainFrame) => {
    update(id);
    // YouTube switches pages without loading a new one. The ad blocker leaves Shorts unhidden
    // (hiding breaks its scrolling), so reload once when you go into Shorts from elsewhere on YouTube.
    const t = tabs.get(id);
    if (isMainFrame && state.adblock !== false && skipHiding(navUrl) && !skipHiding(t?.lastUrl)) wc.reload();
    if (t) t.lastUrl = navUrl;
  });
  // In Firefox sign-in mode, match what the page's own code sees (navigator.userAgent) too.
  wc.on("did-start-navigation", (details, navUrl, inPlace, isMainFrame) => {
    const target = details.url ?? navUrl;
    const firefox = isGoogleSignIn(target) && signInMode() === "firefox";
    if (details.isMainFrame ?? isMainFrame) wc.setUserAgent(firefox ? FIREFOX_UA : chromeUserAgent);
  });
  wc.on("page-favicon-updated", (e, icons) => {
    if (!tabs.has(id)) return;
    tabs.get(id).favicon = icons[0] || null;
    update(id);
  });
  wc.on("dom-ready", () => applySiteStyle(id));
  // If a page crashes (e.g. out of memory), load it again instead of leaving a dead tab.
  wc.on("render-process-gone", (e, details) => {
    if (details.reason === "clean-exit") return;
    setTimeout(() => !wc.isDestroyed() && wc.reload(), 500);
  });
  wc.on("before-input-event", (e, input) => handleKey(input, windowOfTab(id)) && e.preventDefault());
  wc.on("context-menu", (e, params) => showPageMenu(id, params));

  // Videos (and games) that go full screen fill the whole screen, not just the page area.
  wc.on("enter-html-full-screen", () => {
    const tw = windowOfTab(id);
    if (!tw) return;
    tw.fullscreenTab = id;
    tw.win.setFullScreen(true);
    sendTo(tw, "ui:fullscreen", true);
    layoutViews(tw, "video full screen");
  });
  wc.on("leave-html-full-screen", () => {
    const tw = windowOfTab(id);
    if (!tw) return;
    tw.fullscreenTab = null;
    tw.win.setFullScreen(false);
    sendTo(tw, "ui:fullscreen", false);
    layoutViews(tw, "video left full screen");
  });

  // In split screen, clicking into a page makes it the tab the toolbar controls.
  wc.on("focus", () => {
    const tw = windowOfTab(id);
    if (tw?.split && (id === tw.split.left || id === tw.split.right) && tw.activeId !== id) {
      tw.activeId = id;
      sendTo(tw, "tab:activated", id);
    }
  });

  // Links that want a new window open as a new tab (in the same profile) instead.
  wc.setWindowOpenHandler(({ url: target }) => {
    createTab(target, false, profileId);
    return { action: "deny" };
  });

  sendTo(w, "tab:created", tabInfo(id));
  wc.loadURL(url);
  if (!background) activate(id);
  return id;
}

function activate(id) {
  const tab = tabs.get(id);
  const w = windowOfTab(id);
  if (!tab || !w) return;
  const previous = w.activeId;
  w.activeId = id;
  if (tab.sleeping) wakeTab(id);
  power?.touch(id);
  // In split screen, the tab you pick replaces the side you were on.
  if (w.split && id !== w.split.left && id !== w.split.right) {
    if (previous === w.split.right) w.split.right = id;
    else w.split.left = id;
    sendSplit(w);
  }
  if (previous !== id) w.previousActive = previous;
  layoutViews(w, "show");
  sendTo(w, "tab:activated", id);
  // A fresh tab should let you type in the address bar straight away.
  const url = tab.view.webContents?.getURL() || "";
  if (!url || url.startsWith(HOME)) {
    w.win.webContents.focus();
    sendTo(w, "ui:focus-address");
  } else {
    tab.view.webContents.focus();
  }
}

// Background tabs are taken OFF the window instead of being made invisible: invisible views
// get paused by Windows/Chromium and stop loading, but views off the window keep running
// (just like background tabs in Chrome).
function detachView(t) {
  if (!t.attached) return;
  const w = windows.get(t.profileId);
  if (w && !w.win.isDestroyed()) w.win.contentView.removeChildView(t.view);
  t.attached = false;
}

// ================= Page layout: normal, split screen and full screen =================

const SPLIT_GAP = 10; // room for the divider you can drag
const SPLIT_MARK = 3; // a coloured bar above the side you're using

const sendSplit = w => sendTo(w, "split:state", w.split ? { ...w.split, ratio: w.splitRatio } : null);

// Which of a window's tabs are on screen right now.
function visibleTabIds(w) {
  if (!w) return [];
  if (w.fullscreenTab != null && tabs.has(w.fullscreenTab)) return [w.fullscreenTab];
  if (w.split && tabs.has(w.split.left) && tabs.has(w.split.right)) return w.splitDragging ? [] : [w.split.left, w.split.right];
  return w.activeId != null && tabs.has(w.activeId) ? [w.activeId] : [];
}

const allVisibleTabIds = () => [...windows.values()].flatMap(visibleTabIds);

// Where a visible tab goes: the whole page area, half of it, or the whole window (full screen video).
function rectFor(w, id) {
  const vb = w.viewBounds;
  if (w.fullscreenTab === id) {
    const { width, height } = w.win.getContentBounds();
    return { x: 0, y: 0, width, height };
  }
  if (w.split && (id === w.split.left || id === w.split.right) && visibleTabIds(w).length === 2) {
    const leftWidth = Math.round((vb.width - SPLIT_GAP) * w.splitRatio);
    const top = { y: vb.y + SPLIT_MARK, height: Math.max(0, vb.height - SPLIT_MARK) };
    return id === w.split.left
      ? { x: vb.x, width: leftWidth, ...top }
      : { x: vb.x + leftWidth + SPLIT_GAP, width: vb.width - leftWidth - SPLIT_GAP, ...top };
  }
  return vb;
}

// Puts a window's pages on screen at the right size. With nudge, each page is shrunk 2px and grown
// back a moment later, because on Windows a page that's just been shown isn't always drawn until
// its size really changes.
function layoutViews(w, reason = "layout", nudge = true) {
  if (!w || w.win.isDestroyed()) return;
  const show = visibleTabIds(w);
  for (const id of profileTabs(w.profileId)) if (!show.includes(id)) detachView(tabs.get(id));
  for (const id of show) {
    const t = tabs.get(id);
    const wc = t.view.webContents;
    if (!wc || wc.isDestroyed()) continue;
    if (!t.attached) {
      w.win.contentView.addChildView(t.view);
      t.attached = true;
    }
    const r = rectFor(w, id);
    if (!nudge) {
      t.view.setBounds(r);
      continue;
    }
    t.view.setBounds({ ...r, width: Math.max(0, r.width - 2), height: Math.max(0, r.height - 2) });
    setTimeout(() => {
      if (wc.isDestroyed() || !t.attached) return;
      t.view.setBounds(rectFor(w, id));
      wc.invalidate();
    }, 120);
  }
  layoutApp(w);
  if (nudge) {
    sendTo(w, "ui:resend-bounds");
    debugLog(`${w.profileId} ${reason}: showing tabs ${show.join(", ") || "none"} in ${JSON.stringify(w.viewBounds)}${w.split ? " (split)" : ""}${w.fullscreenTab != null ? " (full screen)" : ""}`);
  }
}

function toggleSplit(w) {
  if (!w) return;
  if (w.split) {
    w.split = null;
  } else {
    const mine = profileTabs(w.profileId);
    let partner = mine.includes(w.previousActive) && w.previousActive !== w.activeId ? w.previousActive : mine.find(id => id !== w.activeId);
    if (partner == null) partner = createTab(HOME, true, w.profileId);
    w.split = { left: w.activeId, right: partner };
    if (tabs.get(partner).sleeping) wakeTab(partner);
  }
  sendSplit(w);
  layoutViews(w, w.split ? "split on" : "split off");
}

function splitWith(w, otherId) {
  if (!w || otherId === w.activeId || !tabs.has(otherId)) return;
  w.split = { left: w.activeId, right: otherId };
  if (tabs.get(otherId).sleeping) wakeTab(otherId);
  sendSplit(w);
  layoutViews(w, "split with tab");
}

// ================= Apps sidebar (web panels, like Opera GX) =================
// Discord, Spotify, WhatsApp or any website can live in a panel beside your tabs. Each app keeps
// running while its panel is closed, so chats stay connected and music keeps playing.

function layoutApp(w) {
  for (const [id, a] of w.appViews) {
    const show = id === w.openAppId && w.appBounds && w.fullscreenTab == null && w.appBounds.width > 0;
    if (show) {
      if (!a.attached) {
        w.win.contentView.addChildView(a.view);
        a.attached = true;
      }
      a.view.setBounds(w.appBounds);
    } else if (a.attached) {
      w.win.contentView.removeChildView(a.view);
      a.attached = false;
    }
  }
}

function openApp(w, { id, url } = {}) {
  if (!w || typeof id !== "string" || !/^https?:\/\//.test(url || "")) return;
  let a = w.appViews.get(id);
  if (!a) {
    // Apps use your normal profile, even in the incognito window.
    const appProfile = w.profileId === INCOGNITO ? lastProfile : w.profileId;
    const view = new WebContentsView({ webPreferences: { sandbox: true, session: sessionFor(appProfile) } });
    view.setBackgroundColor("#ffffff");
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      createTab(target, false, w.profileId);
      return { action: "deny" };
    });
    view.webContents.on("before-input-event", (e, input) => handleKey(input, w) && e.preventDefault());
    a = { view, url: "", attached: false };
    w.appViews.set(id, a);
  }
  if (a.url !== url) {
    a.url = url;
    a.view.webContents.loadURL(url);
  }
  w.openAppId = id;
  layoutApp(w);
}

function removeApp(w, id) {
  const a = w?.appViews.get(id);
  if (!a) return;
  if (a.attached) w.win.contentView.removeChildView(a.view);
  a.view.webContents.close();
  w.appViews.delete(id);
  if (w.openAppId === id) w.openAppId = null;
}

// A small "flight recorder" for the page area, so blank-page bugs can be tracked down.
// Written to debug.log in the browser's data folder; trimmed so it never gets big.
function debugLog(text) {
  try {
    const file = path.join(app.getPath("userData"), "debug.log");
    if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) {
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").slice(-100 * 1024));
    }
    fs.appendFileSync(file, `[${new Date().toISOString()}] v${app.getVersion()} ${text}\n`);
  } catch {}
}

function removeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  const w = windowOfTab(id);
  detachView(t);
  sendTo(w, "tab:closed", id);
  if (t.view.webContents && !t.view.webContents.isDestroyed()) t.view.webContents.close();
  tabs.delete(id);
  blockedCounts.delete(id);
  passwords?.forgetTab(id);
  power?.forget(id);
}

// How many ads/trackers were blocked on each tab's current page (shown on the 🛡 shield).
const blockedCounts = new Map();
const blockedTimers = new Map();
function countBlocked(webContentsId) {
  for (const [id, t] of tabs) {
    if (t.view.webContents?.id !== webContentsId) continue;
    blockedCounts.set(id, (blockedCounts.get(id) || 0) + 1);
    const w = windowOfTab(id);
    clearTimeout(blockedTimers.get(w));
    blockedTimers.set(w, setTimeout(() => sendTo(w, "adblock:counts", Object.fromEntries(blockedCounts)), 400));
    return;
  }
}

const tabIdFor = webContents => {
  for (const [id, t] of tabs) if (t.view.webContents === webContents) return id;
  return null;
};

// ----- Sleeping tabs (to save memory) -----
// A sleeping tab swaps its page for a tiny "💤" page and remembers where it was.
// Switching to it (or clicking the 💤 page) wakes it up again.

const SLEEP_PAGE = "aero://sleeping/";

function sleepTab(id) {
  const t = tabs.get(id);
  if (!t || t.sleeping || isActive(id) || allVisibleTabIds().includes(id)) return;
  const wc = t.view.webContents;
  const url = wc.getURL();
  if (!/^https?:/.test(url)) return;
  t.sleeping = { url, title: wc.getTitle() };
  wc.loadURL(SLEEP_PAGE + "?" + new URLSearchParams({ url, title: t.sleeping.title }));
  update(id);
}

function wakeTab(id) {
  const t = tabs.get(id);
  if (!t?.sleeping) return;
  const { url } = t.sleeping;
  t.sleeping = null;
  const wc = t.view.webContents;
  const history = wc.navigationHistory;
  // Going "back" from the 💤 page restores the page and keeps the back/forward history tidy.
  const index = history.getActiveIndex?.();
  if (history.canGoBack() && history.getEntryAtIndex?.(index - 1)?.url === url) history.goBack();
  else wc.loadURL(url);
  update(id);
}

// Recently closed tabs, so Ctrl+Shift+T can bring them back (newest last).
const closedTabs = [];

function closeTab(id) {
  const t = tabs.get(id);
  const w = windowOfTab(id);
  if (!t || !w) return;
  const info = tabInfo(id);
  if (info.url) closedTabs.push({ url: info.url, profileId: t.profileId });
  if (closedTabs.length > 25) closedTabs.shift();
  if (w.split && (id === w.split.left || id === w.split.right)) {
    w.split = null;
    sendSplit(w);
  }
  if (w.fullscreenTab === id) w.fullscreenTab = null;
  const order = profileTabs(t.profileId);
  const index = order.indexOf(id);
  // Closing a window's last tab closes the window, like Chrome.
  if (order.length === 1) return w.win.close();
  removeTab(id);
  if (id === w.activeId) activate(order[index + 1] ?? order[index - 1]);
  else layoutViews(w, "tab closed", false);
}

function reopenClosedTab(w) {
  if (!w) return;
  for (let i = closedTabs.length - 1; i >= 0; i--) {
    if (closedTabs[i].profileId !== w.profileId) continue;
    const [{ url }] = closedTabs.splice(i, 1);
    return createTab(url, false, w.profileId);
  }
}

// ================= Right-click menus =================

// What you see when you right-click on a web page: link, picture, text and page options.
function showPageMenu(id, p) {
  const t = tabs.get(id);
  const w = windowOfTab(id);
  const wc = t?.view.webContents;
  if (!wc || !w) return;
  const items = [];
  const add = (label, click, enabled = true) => items.push({ label, click, enabled });
  const line = () => items.length && items[items.length - 1].type !== "separator" && items.push({ type: "separator" });

  if (p.linkURL && /^https?:/.test(p.linkURL)) {
    add("Open link in new tab", () => createTab(p.linkURL, true, t.profileId));
    add("Open link in split screen", () => {
      const other = createTab(p.linkURL, true, t.profileId);
      activate(id);
      splitWith(w, other);
    });
    if (t.profileId !== INCOGNITO) add("Open link in incognito window", () => openInProfile(INCOGNITO, p.linkURL));
    for (const other of profiles) {
      if (other.id !== t.profileId) add(`Open link as ${other.name}`, () => openInProfile(other.id, p.linkURL));
    }
    add("Copy link address", () => clipboard.writeText(p.linkURL));
    add("Save link as file", () => wc.downloadURL(p.linkURL));
    line();
  }
  if (p.mediaType === "image" && p.srcURL) {
    add("Open image in new tab", () => createTab(p.srcURL, true, t.profileId));
    add("Save image", () => wc.downloadURL(p.srcURL));
    add("Copy image", () => wc.copyImageAt(p.x, p.y));
    add("Copy image address", () => clipboard.writeText(p.srcURL));
    line();
  }
  if (p.isEditable) {
    add("Cut", () => wc.cut(), p.editFlags.canCut);
    add("Copy", () => wc.copy(), p.editFlags.canCopy);
    add("Paste", () => wc.paste(), p.editFlags.canPaste);
    add("Select all", () => wc.selectAll());
    line();
  } else if (p.selectionText.trim()) {
    const text = p.selectionText.trim();
    add("Copy", () => wc.copy());
    add(`Search for "${text.length > 30 ? text.slice(0, 30) + "…" : text}"`, () => createTab(searchUrl + encodeURIComponent(text), false, t.profileId));
    line();
  }
  add("Back", () => wc.navigationHistory.goBack(), wc.navigationHistory.canGoBack());
  add("Forward", () => wc.navigationHistory.goForward(), wc.navigationHistory.canGoForward());
  add("Reload", () => wc.reload());
  line();
  add(w.split ? "Leave split screen" : "Split screen", () => { activate(id); toggleSplit(w); });
  add("Inspect (developer tools)", () => wc.inspectElement(p.x, p.y));
  Menu.buildFromTemplate(items).popup({ window: w.win });
}

// What you see when you right-click a tab.
function showTabMenu(id) {
  const t = tabs.get(id);
  const w = windowOfTab(id);
  if (!t || !w) return;
  const wc = t.view.webContents;
  const others = profileTabs(t.profileId).filter(x => x !== id);
  const url = tabInfo(id).url;
  Menu.buildFromTemplate([
    { label: "New tab", click: () => createTab(HOME, false, t.profileId) },
    { label: "Reload", click: () => wc.reload() },
    { label: "Duplicate", enabled: !!url, click: () => createTab(url, false, t.profileId) },
    { label: "Open in split screen", enabled: id !== w.activeId, click: () => splitWith(w, id) },
    { label: wc.isAudioMuted() ? "Unmute tab" : "Mute tab", click: () => { wc.setAudioMuted(!wc.isAudioMuted()); update(id); } },
    { label: "Put to sleep 💤", enabled: id !== w.activeId && !t.sleeping && /^https?:/.test(url), click: () => sleepTab(id) },
    { type: "separator" },
    { label: "Close tab", click: () => closeTab(id) },
    { label: "Close other tabs", enabled: others.length > 0, click: () => others.forEach(closeTab) },
    { label: "Reopen closed tab", accelerator: "Ctrl+Shift+T", enabled: closedTabs.some(c => c.profileId === w.profileId), click: () => reopenClosedTab(w) }
  ]).popup({ window: w.win });
}

function cycleTabs(w, dir) {
  const order = profileTabs(w.profileId);
  const i = order.indexOf(w.activeId);
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
  for (const key of [t.cssKey, t.themeCssKey, t.fixesCssKey]) if (key) await wc.removeInsertedCSS(key).catch(() => {});
  t.cssKey = t.themeCssKey = t.fixesCssKey = null;
  const url = wc.getURL();
  if (!/^https?:/.test(url)) return;
  if (restyleSites) t.cssKey = await wc.insertCSS(SITE_CSS).catch(() => null);
  const themeCss = themeCssForSite(new URL(url).hostname);
  if (themeCss) t.themeCssKey = await wc.insertCSS(themeCss).catch(() => null);
  t.fixesCssKey = await wc.insertCSS(SITE_FIXES_CSS).catch(() => null);
}

// A theme can restyle websites too:
//   websites.css            → every website
//   sites/youtube.com.css   → youtube.com and its subdomains (www.youtube.com, music.youtube.com…)
function themeCssForSite(hostname) {
  if (!state.activeTheme) return "";
  const folder = path.join(themesDir(), state.activeTheme);
  const read = file => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
  let css = read(path.join(folder, "websites.css"));
  let siteFiles = [];
  try { siteFiles = fs.readdirSync(path.join(folder, "sites")).filter(f => f.endsWith(".css")); } catch {}
  for (const file of siteFiles) {
    const domain = file.slice(0, -4).toLowerCase();
    if (hostname === domain || hostname.endsWith("." + domain)) css += "\n" + read(path.join(folder, "sites", file));
  }
  return css;
}


// ================= Keyboard shortcuts =================

function exitFullScreen(w) {
  const id = w.fullscreenTab;
  if (id == null) return w.win.setFullScreen(false);
  // Ask the page to leave full screen (it tells us back through "leave-html-full-screen")...
  tabs.get(id)?.view.webContents.executeJavaScript("document.fullscreenElement && document.exitFullscreen()", true).catch(() => {});
  // ...and if it doesn't answer quickly, leave anyway.
  setTimeout(() => {
    if (w.fullscreenTab !== id || w.win.isDestroyed()) return;
    w.fullscreenTab = null;
    w.win.setFullScreen(false);
    sendTo(w, "ui:fullscreen", false);
    layoutViews(w, "esc left full screen");
  }, 400);
}

function handleKey(input, w) {
  if (input.type !== "keyDown" || !w) return false;
  const key = input.key.toLowerCase();
  const ctrl = input.control || input.meta;
  const wc = activeTabOf(w)?.view.webContents;

  // Esc leaves full screen (a video's, or F11's). Otherwise Esc works as normal on the page.
  if (key === "escape" && (w.fullscreenTab != null || w.win.isFullScreen())) {
    exitFullScreen(w);
    return true;
  }
  if (ctrl && input.shift && key === "t") reopenClosedTab(w);
  else if (ctrl && input.shift && key === "n") openProfileWindow(INCOGNITO);
  else if (ctrl && key === "n") openProfileWindow(w.profileId === INCOGNITO ? lastProfile : w.profileId);
  else if (ctrl && key === "t") createTab(HOME, false, w.profileId);
  else if (ctrl && key === "w") closeTab(w.activeId);
  else if (ctrl && key === "tab") cycleTabs(w, input.shift ? -1 : 1);
  else if ((ctrl && key === "l") || key === "f6") { w.win.webContents.focus(); sendTo(w, "ui:focus-address"); }
  else if ((ctrl && key === "r") || key === "f5") wc?.reload();
  else if (input.alt && key === "arrowleft") wc?.navigationHistory.goBack();
  else if (input.alt && key === "arrowright") wc?.navigationHistory.goForward();
  else if (ctrl && (key === "=" || key === "+")) wc?.setZoomLevel(wc.getZoomLevel() + 0.5);
  else if (ctrl && key === "-") wc?.setZoomLevel(wc.getZoomLevel() - 0.5);
  else if (ctrl && key === "0") wc?.setZoomLevel(0);
  else if (key === "f12") wc?.toggleDevTools();
  else if (key === "f11") w.win.setFullScreen(!w.win.isFullScreen());
  else return false;
  return true;
}

// ================= Messages from the UI =================
// Every message comes from one window's UI, and acts on that window.

let shownWhatsNew = false;

// Registers a handler that's given the window the message came from.
function onWindow(channel, fn) {
  ipcMain.on(channel, (e, data) => {
    const w = windowFor(e.sender);
    if (w) fn(w, data, e);
  });
}
const onActiveTab = fn => w => {
  const wc = activeTabOf(w)?.view.webContents;
  if (wc) fn(wc, w);
};

onWindow("ui:ready", w => {
  sendProfiles();
  sendThemes();
  sendTo(w, "app:info", { version: app.getVersion() });
  sendTo(w, "update:status", updateStatus);
  sendTo(w, "settings", { adblock: state.adblock !== false, hideAi: state.hideAi !== false });
  // After an update (or the very first launch), the What's new page is the first thing you see.
  const version = app.getVersion();
  if (!shownWhatsNew && state.lastVersion !== version) {
    const from = state.lastVersion ? "&from=" + encodeURIComponent(state.lastVersion) : "";
    w.startUrls.unshift("aero://whatsnew/?v=" + encodeURIComponent(version) + from);
    state.lastVersion = version;
    saveState();
  }
  shownWhatsNew = true;
  const start = w.startUrls.splice(0);
  if (!profileTabs(w.profileId).length && !start.length) start.push(HOME);
  start.forEach((url, i) => createTab(url, i < start.length - 1, w.profileId));
  if (w.profileId !== INCOGNITO) refreshAccounts(w.profileId);
});
onWindow("tab:new", (w, url) => createTab(url ? toUrl(url) : HOME, false, w.profileId));
onWindow("tab:close", (w, id) => closeTab(id));
// Clicking the tab you're already on redraws its page (a handy fix if it ever looks blank).
onWindow("tab:activate", (w, id) => (id === w.activeId ? layoutViews(w, "tab clicked again") : activate(id)));
onWindow("tab:reopen", w => reopenClosedTab(w));
onWindow("tab:menu", (w, id) => showTabMenu(id));
onWindow("split:toggle", w => toggleSplit(w));
onWindow("split:ratio", (w, ratio) => {
  if (!Number.isFinite(ratio)) return;
  w.splitRatio = Math.min(0.8, Math.max(0.2, ratio));
  layoutViews(w, "split resized", false);
});
// While the divider is being dragged the pages step aside (so the mouse doesn't get lost in them).
onWindow("split:drag", (w, on) => {
  w.splitDragging = !!on;
  layoutViews(w, on ? "split drag" : "split drop", !on);
  sendSplit(w);
});
onWindow("store:open", w => openInProfile(w.profileId, "aero://store/"));
onWindow("ext:popup", (w, { id, x, y } = {}) => {
  const cb = w.win.getContentBounds();
  extensions?.openPopup(id, sessionFor(w.profileId), { x: cb.x + x, y: cb.y + y }, w.win);
});
onWindow("incognito:open", () => openProfileWindow(INCOGNITO));
onWindow("incognito:close", () => closeIncognito());
onWindow("app:open", (w, data) => openApp(w, data));
onWindow("app:close", w => { w.openAppId = null; layoutApp(w); });
onWindow("app:remove", (w, id) => removeApp(w, id));
onWindow("app:bounds", (w, b) => {
  w.appBounds = b && { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) };
  layoutApp(w);
});
onWindow("nav:go", (w, text) => {
  const wc = activeTabOf(w)?.view.webContents;
  if (!wc) return;
  wc.loadURL(toUrl(text));
  wc.focus();
});
onWindow("nav:back", onActiveTab(wc => wc.navigationHistory.goBack()));
onWindow("nav:forward", onActiveTab(wc => wc.navigationHistory.goForward()));
onWindow("nav:reload", onActiveTab(wc => wc.reload()));
onWindow("nav:stop", onActiveTab(wc => wc.stop()));
onWindow("nav:home", onActiveTab(wc => wc.loadURL(HOME)));
onWindow("view:bounds", (w, b) => {
  w.viewBounds = {
    x: Math.round(b.x), y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height))
  };
  layoutViews(w, "page area changed", false);
});
onWindow("profile:refresh", w => w.profileId !== INCOGNITO && refreshAccounts(w.profileId));
onWindow("whatsnew:open", w => createTab("aero://whatsnew/?v=" + encodeURIComponent(app.getVersion()), false, w.profileId));
onWindow("theme:install", w => installTheme(w).catch(err => dialog.showErrorBox("Couldn't add that theme", err.message)));
onWindow("win:min", w => w.win.minimize());
onWindow("win:max", w => (w.win.isMaximized() ? w.win.unmaximize() : w.win.maximize()));
onWindow("win:close", w => w.win.close());

ipcMain.on("set:adblock", (e, on) => {
  state.adblock = !!on;
  saveState();
  adblock?.setEnabled(state.adblock);
  sendAll("settings", { adblock: state.adblock, hideAi: state.hideAi !== false });
});
ipcMain.on("set:hide-ai", (e, on) => {
  state.hideAi = !!on;
  saveState();
  sendAll("settings", { adblock: state.adblock !== false, hideAi: state.hideAi });
});
ipcMain.on("settings:hide-ai", e => (e.returnValue = state.hideAi !== false)); // asked by tab-preload.js
ipcMain.on("set:restyle", (e, on) => {
  restyleSites = on;
  for (const id of tabs.keys()) applySiteStyle(id);
});
ipcMain.on("set:search", (e, url) => { searchUrl = url; });
ipcMain.on("profile:switch", (e, id) => switchProfile(id));
ipcMain.on("profile:add", (e, data) => addProfile(data || {}));
ipcMain.on("profile:update", (e, data) => updateProfile(data || {}));
ipcMain.on("profile:delete", (e, id) => deleteProfile(id));
ipcMain.on("signin:mode", e => (e.returnValue = { mode: signInMode(), full: CHROME_FULL, major: CHROME_MAJOR })); // asked by tab-preload.js
ipcMain.on("signin:set-mode", (e, mode) => {
  state.signInMode = ["firefox", "chromium"].includes(mode) ? mode : "chrome";
  saveState();
  sendProfiles();
});
ipcMain.on("theme:set", (e, id) => {
  state.activeTheme = id || null;
  saveState();
  refreshThemes();
});
ipcMain.on("theme:open-folder", () => shell.openPath(themesDir()));
ipcMain.on("update:check", () => (updater ? updater.checkForUpdates().catch(() => {}) : sendUpdate({ state: "dev" })));
ipcMain.on("update:restart", () => updater?.quitAndInstall(true, true));

// ================= Automatic updates =================
// Like Chrome: new versions download quietly from GitHub Releases in the background
// and get installed the next time you close the browser (or straight away with "Restart to update").

let updater = null;
let updateStatus = { state: "idle" };

function sendUpdate(status) {
  updateStatus = status;
  sendAll("update:status", status);
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

// Debug helper: AERO_SNAPSHOT=<folder> runs a scripted test in the first window, saves what it saw, then quits.
//   AERO_SNAPSHOT_OPEN=url1,url2   extra tabs to open
//   AERO_SNAPSHOT_TABJS            code to run in the active tab (counts as a click)
//   AERO_SNAPSHOT_JS               code to run in the browser UI
//   AERO_SNAPSHOT_TABJS_AFTER      code to run in the active tab afterwards
//   AERO_SNAPSHOT_VISIBLE=1        use a real on-screen window instead of an invisible one
let snapshotArmed = false;
function armSnapshot(w) {
  snapshotArmed = true;
  const { win } = w;
  const log = text => fs.appendFileSync(path.join(process.env.AERO_SNAPSHOT, "log.txt"), text + "\n");
  global.aeroTestLog = log;
  win.webContents.on("console-message", (e, level, message, line, source) => log(`[ui] ${message} ${source}:${line}`));
  if (!process.env.AERO_SNAPSHOT_VISIBLE) {
    // Shown far off-screen without taking focus from what you're doing.
    win.setPosition(-10000, -10000);
    win.showInactive();
  } else {
    win.setAlwaysOnTop(true); // so a screen photo of this window shows only Aero Browser
  }
  win.webContents.on("render-process-gone", (e, details) => log("[ui gone] " + JSON.stringify(details)));
  win.webContents.on("did-finish-load", () => log("[ui loaded]"));
  process.on("uncaughtException", err => log("[main] " + err.stack));
  setTimeout(() => (process.env.AERO_SNAPSHOT_OPEN || "").split(",").filter(Boolean).forEach(u => createTab(u, false, w.profileId)), 2500);
  setTimeout(async () => {
    const dir = process.env.AERO_SNAPSHOT;
    const active = () => activeTabOf(w);
    if (process.env.AERO_SNAPSHOT_TABJS && active()) {
      log("[tabjs] " + await active().view.webContents.executeJavaScript(process.env.AERO_SNAPSHOT_TABJS, true).catch(e => "error " + e.message));
      await new Promise(r => setTimeout(r, 1500));
    }
    // AERO_SNAPSHOT_WHEEL=n scrolls the mouse wheel down n notches over the middle of the active tab.
    if (process.env.AERO_SNAPSHOT_WHEEL && active()) {
      const wc = active().view.webContents;
      // Wait (up to 20s) for a Short to be showing, e.g. after clicking a Shorts link.
      for (let i = 0; i < 40 && !/\/shorts\/[\w-]+/.test(wc.getURL()); i++) await new Promise(r => setTimeout(r, 500));
      await new Promise(r => setTimeout(r, 4000));
      log("[before wheel] " + wc.getURL());
      const { width, height } = active().view.getBounds();
      for (let i = 0; i < +process.env.AERO_SNAPSHOT_WHEEL; i++) {
        wc.sendInputEvent({ type: "mouseMove", x: Math.round(width / 2), y: Math.round(height / 2) });
        wc.sendInputEvent({ type: "mouseWheel", x: Math.round(width / 2), y: Math.round(height / 2), deltaX: 0, deltaY: -120, wheelTicksY: -1, canScroll: true });
        await new Promise(r => setTimeout(r, 2500));
        log(`[after wheel ${i + 1}] ` + wc.getURL());
      }
    }
    // AERO_SNAPSHOT_KEY presses a key in the active tab (e.g. "Escape").
    if (process.env.AERO_SNAPSHOT_KEY && active()) {
      const wc = active().view.webContents;
      wc.sendInputEvent({ type: "keyDown", keyCode: process.env.AERO_SNAPSHOT_KEY });
      wc.sendInputEvent({ type: "keyUp", keyCode: process.env.AERO_SNAPSHOT_KEY });
      await new Promise(r => setTimeout(r, 1500));
      log("[after key] full screen: " + (w.fullscreenTab != null) + ", window full screen: " + win.isFullScreen());
    }
    if (process.env.AERO_SNAPSHOT_JS && !win.isDestroyed()) {
      log("[js] " + await win.webContents.executeJavaScript(process.env.AERO_SNAPSHOT_JS).catch(e => "error " + e.message));
      await new Promise(r => setTimeout(r, 1500));
    }
    if (process.env.AERO_SNAPSHOT_TABJS_AFTER && active()) {
      log("[tabjs after] " + await active().view.webContents.executeJavaScript(process.env.AERO_SNAPSHOT_TABJS_AFTER).catch(e => "error " + e.message));
    }
    log("[windows] " + JSON.stringify([...windows.values()].map(x => ({ profile: x.profileId, title: x.win.isDestroyed() ? "closed" : x.win.getTitle(), tabs: profileTabs(x.profileId).length, active: x.activeId }))));
    log("[tabs] " + JSON.stringify([...tabs.keys()].map(id => ({ ...tabInfo(id), wcUrl: tabs.get(id).view.webContents.getURL() }))));
    log("[profiles] " + JSON.stringify({ profiles, currentProfile, accounts }));
    if (!win.isDestroyed()) {
      const uiShot = await Promise.race([win.webContents.capturePage().catch(() => null), new Promise(r => setTimeout(() => r(null), 3000))]);
      if (uiShot && !uiShot.isEmpty()) fs.writeFileSync(path.join(dir, "ui.png"), uiShot.toPNG());
      fs.writeFileSync(path.join(dir, "bounds.json"), JSON.stringify(w.viewBounds));
      if (process.env.AERO_SNAPSHOT_VISIBLE) {
        // Tell the test script where the window is, and hold still while it takes a screen photo.
        const scale = require("electron").screen.getDisplayMatching(win.getBounds()).scaleFactor;
        log("[screen-now] " + JSON.stringify({ ...win.getContentBounds(), scale }));
        await new Promise(r => setTimeout(r, 4000));
      }
    }
    app.exit(0);
  }, +process.env.AERO_SNAPSHOT_DELAY || 6000);
}

// Lets Windows group the taskbar button and Start menu shortcut under our own app.
app.setAppUserModelId("com.aero.browser");

// Debug helper: AERO_USER_DATA=<folder> keeps a test run's profiles and logins away from your real ones.
if (process.env.AERO_USER_DATA) app.setPath("userData", process.env.AERO_USER_DATA);
// Windows tells Chromium which parts of a window are covered up so it can skip drawing them. With our
// tab pages layered on top of the browser UI, it can wrongly decide a tab is hidden (often after a
// fullscreen game was on top) and the page stays blank. Switching that check off keeps tabs drawn.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// Test runs don't use the graphics card, so they never fight with games or other apps for it.
if (process.env.AERO_SNAPSHOT && !process.env.AERO_SNAPSHOT_VISIBLE) app.disableHardwareAcceleration();

// Only one Aero Browser at a time: opening it again just brings its window to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const urls = urlsFromArgs(commandLine);
    if (!appReady) {
      pendingLaunchUrls.push(...urls);
      return;
    }
    const w = focusedWindow();
    if (!w) return openProfileWindow(lastProfile, urls);
    if (w.win.isMinimized()) w.win.restore();
    w.win.show();
    w.win.focus();
    urls.forEach(url => createTab(url, false, w.profileId));
  });
}

app.whenReady().then(() => {
  appReady = true;
  Menu.setApplicationMenu(null);
  chromeUserAgent = app.userAgentFallback.replace(/ (Electron|AeroBrowser|aero-browser)\/\S+/gi, "");
  app.userAgentFallback = chromeUserAgent;
  // Extras must never stop the window from opening: if one fails, note it and carry on.
  const safely = (name, fn) => {
    try { fn(); } catch (err) { logError(name, err); }
  };
  safely("profiles", loadProfiles);
  safely("state", loadState);
  safely("themes", ensureThemesFolder);
  safely("site colour scheme", applySiteColorScheme);
  safely("theme watcher", watchThemes);
  safely("adblock", () => {
    adblock = setupAdblock({ enabled: state.adblock !== false, onBlocked: countBlocked });
  });
  safely("downloads", () => { downloads = setupDownloads({ send: sendAll }); });
  safely("bookmarks", setupBookmarks);
  safely("extensions", () => {
    extensions = setupExtensions({ sessions: () => [...readySessions], send: sendAll, chromeVersion: CHROME_FULL });
  });
  safely("default browser", setupDefaultBrowser);
  sessionFor("default"); // the browser UI uses this session too, and needs aero://themes/ ready
  safely("passwords", () => {
    passwords = setupPasswords({
      // Messages about a tab go to that tab's window; the rest go to the window you're using.
      send: (channel, data) => (data && data.tabId != null ? sendForTab(data.tabId, channel, data) : sendTo(focusedWindow(), channel, data)),
      tabs,
      tabIdFor,
      currentProfile: () => currentProfile
    });
  });
  safely("power", () => {
    power = setupPower({
      tabs,
      send: sendAll,
      sleepTab,
      wakeTab,
      isActive,
      visibleIds: allVisibleTabIds,
      settings: () => state.power || {},
      saveSettings: s => { state.power = s; saveState(); }
    });
  });
  lastProfile = profiles.some(p => p.id === currentProfile) ? currentProfile : profiles[0].id;
  openProfileWindow(lastProfile, pendingLaunchUrls.splice(0));
  safely("updates", setupAutoUpdates);
});

// Problems get written to error.log in the browser's data folder, so they can be tracked down.
function logError(where, err) {
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "error.log"),
      `[${new Date().toISOString()}] v${app.getVersion()} ${where}: ${err?.stack || err}\n`
    );
  } catch {}
}
process.on("uncaughtException", err => logError("crash", err));
process.on("unhandledRejection", err => logError("crash", err));

app.on("window-all-closed", () => app.quit());
