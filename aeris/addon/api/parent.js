/* This runs with Aeris's own powers (it's part of the browser, not a normal extension), for the few
   things Aeris Core can't do with the regular extension APIs. Everything else lives in background.js. */
"use strict";
/* global ExtensionAPI, ChromeUtils, Services, Cc, Ci, Cu, IOUtils, PathUtils, WebExtensionPolicy */

Cu.importGlobalProperties(["atob", "crypto", "fetch"]);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  CustomizableUI: "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  LoginHelper: "resource://gre/modules/LoginHelper.sys.mjs",
  MigrationUtils: "moz-src:///browser/components/migration/MigrationUtils.sys.mjs",
  OSCrypto: "resource://gre/modules/OSCrypto_win.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  ShellService: "moz-src:///browser/components/shell/ShellService.sys.mjs"
});

// Websites see Aeris as the Firefox it's built on (like LibreWolf, Floorp and Zen do), so sites such as
// addons.mozilla.org work normally. Builds set this too; doing it here covers copies built before that.
{
  const major = Services.appinfo.platformVersion.split(".")[0];
  Services.prefs.getDefaultBranch("").setStringPref("general.useragent.override",
    `Mozilla/5.0 (${{ WINNT: "Windows NT 10.0; Win64; x64", Darwin: "Macintosh; Intel Mac OS X 10.15" }[Services.appinfo.OS] || "X11; Linux x86_64"}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`);
}

// The Firefox settings Customize may read and change, and their type.
const PREFS = {
  "sidebar.verticalTabs": "bool",
  "sidebar.position_start": "bool",
  "sidebar.expandOnHover": "bool",
  "sidebar.visibility": "string",
  "browser.uidensity": "int",
  "browser.toolbars.bookmarks.visibility": "string",
  "browser.tabs.splitView.enabled": "bool",
  "browser.tabs.groups.enabled": "bool",
  "browser.tabs.hoverPreview.enabled": "bool",
  "browser.tabs.notes.enabled": "bool",
  "browser.tabs.unloadOnLowMemory": "bool",
  "browser.shell.checkDefaultBrowser": "bool",
  "extensions.unifiedExtensions.button.always_visible": "bool"
};
// Firefox's own pages (Settings, Add-ons…) in Aero style: one sheet, registered once for the whole app.
// Its rules only match those pages (they're wrapped in @-moz-document), and it isn't swapped on every
// theme change, so websites aren't slowed down.
const sheetService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
let pagesSheet = null;
function setPagesStyle(css) {
  if (pagesSheet && sheetService.sheetRegistered(pagesSheet, sheetService.USER_SHEET)) sheetService.unregisterSheet(pagesSheet, sheetService.USER_SHEET);
  pagesSheet = css ? Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(css)) : null;
  if (pagesSheet) sheetService.loadAndRegisterSheet(pagesSheet, sheetService.USER_SHEET);
}

// Firefox's own toolbar buttons Customize can add: Forget (clears recent history) and Screenshot.
const TOOLBAR_BUTTONS = ["panic-button", "screenshot-button"];
const prefGet = { bool: "getBoolPref", string: "getStringPref", int: "getIntPref" };
const prefSet = { bool: "setBoolPref", string: "setStringPref", int: "setIntPref" };
const browserWindow = () => Services.wm.getMostRecentWindow("navigator:browser");

const UPDATE_PREFIX = "https://github.com/aarshabhpeeyush/aero-browser/releases/download/";
const AMO_PREFIX = "https://addons.mozilla.org/firefox/downloads/";
const BROWSER_PAGES = /^about:(preferences|addons|logins)([#?].*)?$/;

let chromeSheet = null; // the theme's restyle of the browser frame
let pendingInstaller = null; // a downloaded update waiting for Aeris to close

const aeroFolder = () => Services.appinfo.OS === "WINNT"
  ? PathUtils.join(Services.dirsvc.get("AppData", Ci.nsIFile).path, "Aero Browser")
  : PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, ".config", "Aero Browser");

// The frame's style goes only into browser windows (not the whole app), so changing theme doesn't make
// Firefox re-check every open website, which made changes slow to show up with heavy sites open.
const isBrowserWindow = win => win.document.documentElement.getAttribute("windowtype") === "navigator:browser";
function styleWindow(win, oldSheet) {
  const utils = win.windowUtils;
  if (oldSheet) {
    try { utils.removeSheet(oldSheet, utils.USER_SHEET); } catch {}
  }
  if (chromeSheet) utils.loadSheet(chromeSheet, utils.USER_SHEET);
}
const windowWatcher = {
  observe(win, topic) {
    if (topic !== "domwindowopened") return;
    win.addEventListener("load", () => {
      if (!isBrowserWindow(win)) return;
      if (chromeSheet) styleWindow(win, null);
      if (stacking) stackWindow(win);
    }, { once: true });
  }
};
let watching = false;
function watchWindows() {
  const want = !!chromeSheet || stacking;
  if (want && !watching) Services.ww.registerNotification(windowWatcher);
  if (!want && watching) Services.ww.unregisterNotification(windowWatcher);
  watching = want;
}

// ================= Tab stacking =================
// Each tab gets a "+" next to its close button. It opens a new tab *under* that tab (its child), so you
// can always see which tab you came from; closing the child takes you back to it. Children can have
// children too. Tabs opened the normal way stay flat. The family tree is saved with the session.

let stacking = false;
const MAX_DEPTH = 5;
const stackListeners = new WeakMap(); // window -> its listeners, to remove them again

function tabId(tab) {
  let id = tab.getAttribute("aeris-id");
  if (!id) {
    id = lazy.SessionStore.getCustomTabValue(tab, "aerisId") || Services.uuid.generateUUID().toString().slice(1, 37);
    tab.setAttribute("aeris-id", id);
    lazy.SessionStore.setCustomTabValue(tab, "aerisId", id);
  }
  return id;
}
function setParent(tab, parentId) {
  if (parentId) {
    tab.setAttribute("aeris-parent", parentId);
    lazy.SessionStore.setCustomTabValue(tab, "aerisParent", parentId);
  } else {
    tab.removeAttribute("aeris-parent");
    lazy.SessionStore.deleteCustomTabValue(tab, "aerisParent");
  }
}

// Work out each tab's depth from the family tree. A child only counts while it sits right after its
// parent's family; one dragged away becomes a normal tab again.
function layoutStacks(win) {
  const chain = [];
  for (const tab of win.gBrowser.tabs) {
    const id = tabId(tab);
    const parent = tab.getAttribute("aeris-parent");
    const at = parent ? chain.lastIndexOf(parent) : -1;
    if (parent && at < 0) setParent(tab, null);
    chain.length = at + 1;
    const depth = Math.min(chain.length, MAX_DEPTH);
    if (depth) {
      tab.setAttribute("aeris-depth", depth);
      tab.style.setProperty("--aeris-depth", depth);
    } else {
      tab.removeAttribute("aeris-depth");
      tab.style.removeProperty("--aeris-depth");
    }
    chain.push(id);
  }
}

function openChild(win, parentTab) {
  const { gBrowser } = win;
  const tabs = [...gBrowser.tabs];
  const depth = +(parentTab.getAttribute("aeris-depth") || 0);
  // After the parent's own children (and theirs)
  let index = tabs.indexOf(parentTab) + 1;
  while (index < tabs.length && +(tabs[index].getAttribute("aeris-depth") || 0) > depth) index++;
  const child = gBrowser.addTab(win.BROWSER_NEW_TAB_URL, {
    tabIndex: index, // (called "index" before Firefox 135)
    index,
    ownerTab: parentTab,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
  });
  setParent(child, tabId(parentTab));
  gBrowser.selectedTab = child;
  layoutStacks(win);
  win.gURLBar?.select();
}

function addStackButton(win, tab) {
  if (tab.querySelector(".aeris-stack-button")) return;
  const close = tab.querySelector(".tab-close-button");
  if (!close) return;
  const button = win.document.createXULElement("image");
  button.className = "aeris-stack-button";
  button.setAttribute("role", "button");
  button.setAttribute("tooltiptext", "Open a tab under this one");
  button.addEventListener("mousedown", e => e.button === 0 && e.stopPropagation());
  button.addEventListener("click", e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    openChild(win, tab);
  });
  close.before(button);
}

function stackWindow(win) {
  if (stackListeners.has(win)) return;
  const { gBrowser } = win;
  win.document.documentElement.setAttribute("aeris-stacking", "true");
  const later = () => win.setTimeout(() => layoutStacks(win), 0);
  const on = {
    TabOpen: e => addStackButton(win, e.target),
    // A closing tab's children move up to its own parent, so the family stays together
    TabClose: e => {
      const tab = e.target;
      const id = tab.getAttribute("aeris-id");
      const up = tab.getAttribute("aeris-parent");
      if (id) for (const t of gBrowser.tabs) if (t.getAttribute("aeris-parent") === id) setParent(t, up);
      // Closing a child takes you back to the tab it came from (Firefox forgets that once you switch tabs)
      const parentTab = up && [...gBrowser.tabs].find(t => t.getAttribute("aeris-id") === up);
      if (tab.selected && parentTab && !parentTab.closing) tab.owner = parentTab;
      later();
    },
    TabMove: later,
    // Firefox forgets which tab a tab came from once you switch tabs, so remind it each time
    TabSelect: e => {
      const up = e.target.getAttribute("aeris-parent");
      const parentTab = up && [...gBrowser.tabs].find(t => t.getAttribute("aeris-id") === up);
      if (parentTab) e.target.owner = parentTab;
    },
    SSTabRestoring: e => {
      const tab = e.target;
      tab.removeAttribute("aeris-id");
      tabId(tab);
      const parent = lazy.SessionStore.getCustomTabValue(tab, "aerisParent");
      if (parent) tab.setAttribute("aeris-parent", parent);
      later();
    }
  };
  for (const [type, fn] of Object.entries(on)) gBrowser.tabContainer.addEventListener(type, fn);
  stackListeners.set(win, on);
  for (const tab of gBrowser.tabs) {
    addStackButton(win, tab);
    const parent = lazy.SessionStore.getCustomTabValue(tab, "aerisParent");
    if (parent) tab.setAttribute("aeris-parent", parent);
  }
  layoutStacks(win);
}

function unstackWindow(win) {
  const on = stackListeners.get(win);
  if (!on) return;
  for (const [type, fn] of Object.entries(on)) win.gBrowser.tabContainer.removeEventListener(type, fn);
  stackListeners.delete(win);
  win.document.documentElement.removeAttribute("aeris-stacking");
  for (const b of win.document.querySelectorAll(".aeris-stack-button")) b.remove();
  for (const tab of win.gBrowser.tabs) {
    tab.removeAttribute("aeris-depth");
    tab.style.removeProperty("--aeris-depth");
  }
}

function setTabStacking(on) {
  stacking = on;
  for (const win of Services.wm.getEnumerator("navigator:browser")) (on ? stackWindow : unstackWindow)(win);
  watchWindows();
}

function setChromeStyle(css) {
  const oldSheet = chromeSheet;
  chromeSheet = css ? Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(css)) : null;
  for (const win of Services.wm.getEnumerator("navigator:browser")) styleWindow(win, oldSheet);
  // New windows get the style when they open
  watchWindows();
}

// Aero kept passwords in <AppData>/Aero Browser/passwords/<profile>.vault, locked with Windows'
// data protection the same way Chrome does it ("v10" + nonce + AES-GCM), with the key in "Local State".
async function importAeroPasswords() {
  const dir = aeroFolder();
  const vaultDir = PathUtils.join(dir, "passwords");
  if (!(await IOUtils.exists(vaultDir))) return 0;
  const localState = await IOUtils.readJSON(PathUtils.join(dir, "Local State"));
  const wrapped = atob(localState.os_crypt.encrypted_key);
  if (!wrapped.startsWith("DPAPI")) throw new Error("Aero's password key isn't in the expected format.");
  const osCrypto = new lazy.OSCrypto();
  let keyBytes;
  try { keyBytes = osCrypto.decryptData(wrapped.slice(5), null, "bytes"); }
  finally { osCrypto.finalize(); }
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes), "AES-GCM", false, ["decrypt"]);

  const logins = [];
  for (const file of await IOUtils.getChildren(vaultDir)) {
    if (!file.endsWith(".vault")) continue;
    const data = await IOUtils.read(file);
    if (String.fromCharCode(...data.slice(0, 3)) !== "v10") continue;
    // A vault locked with an older key can't be opened (Aero couldn't open it either), so skip it.
    let vault;
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(3, 15) }, key, data.slice(15));
      vault = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      continue;
    }
    for (const l of vault.logins || []) {
      if (!l.origin || !l.password) continue;
      logins.push({
        origin: l.origin,
        formActionOrigin: l.origin,
        httpRealm: null,
        username: l.username || "",
        password: l.password,
        usernameElement: "",
        passwordElement: "",
        timeCreated: l.created || Date.now(),
        timePasswordChanged: l.updated || Date.now()
      });
    }
  }
  const added = await lazy.LoginHelper.maybeImportLogins(logins);
  return added.filter(r => r.result === "added").length;
}

function launchInstaller(args) {
  if (!pendingInstaller) return;
  const exe = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  exe.initWithPath(pendingInstaller);
  const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  proc.init(exe);
  proc.runAsync(args, args.length);
  pendingInstaller = null;
}

const quitObserver = { observe: () => launchInstaller(["/S"]) };

// ================= Quick Commands (like Vivaldi's, on F2) =================
// A box that pops up over the page: type to find open tabs, bookmarks and history, do quick maths,
// search the web, or run commands. Commands for Aeris's own features (themes, spaces, focus mode…)
// are sent to Aeris Core through aeris.onCommand.

const PALETTE_ID = "aeris-quick-commands";

// Simple maths, without running any code: + - * / % ^ and brackets.
function quickMaths(text) {
  if (!/^[\d\s.+\-*/%^()]+$/.test(text) || !/\d/.test(text) || !/[+\-*/%^]/.test(text)) return null;
  const tokens = text.match(/\d+(\.\d+)?|[+\-*/%^()]/g);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function number() {
    const t = next();
    if (t === "(") { const v = sum(); if (next() !== ")") throw 0; return v; }
    if (t === "-") return -number();
    if (t === "+") return number();
    const v = parseFloat(t);
    if (Number.isNaN(v)) throw 0;
    return v;
  }
  function power() { const b = number(); return peek() === "^" ? (next(), b ** power()) : b; }
  function product() {
    let v = power();
    while (["*", "/", "%"].includes(peek())) {
      const op = next(), r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (["+", "-"].includes(peek())) v = next() === "+" ? v + product() : v - product();
    return v;
  }
  try {
    const v = sum();
    if (i !== tokens.length || !Number.isFinite(v)) return null;
    return Math.round(v * 1e10) / 1e10;
  } catch { return null; }
}

async function historyMatches(text) {
  const db = await lazy.PlacesUtils.promiseDBConnection();
  const like = `%${text.replace(/[\\%_]/g, c => "\\" + c)}%`;
  const rows = await db.executeCached(
    `SELECT url, title FROM moz_places
     WHERE hidden = 0 AND (title LIKE :like ESCAPE '\\' OR url LIKE :like ESCAPE '\\')
     ORDER BY frecency DESC LIMIT 6`, { like });
  return rows.map(r => ({ url: r.getResultByName("url"), title: r.getResultByName("title") || r.getResultByName("url") }));
}

function paletteCommands(win, extras) {
  const { gBrowser } = win;
  const run = name => () => win.goDoCommand ? win.goDoCommand(name) : null;
  const send = command => () => Services.obs.notifyObservers(null, "aeris-command", command);
  const list = [
    ["New tab", "Ctrl+T", () => win.BrowserCommands.openTab()],
    ["New window", "Ctrl+N", () => win.OpenBrowserWindow()],
    ["New private window", "Ctrl+Shift+P", () => win.OpenBrowserWindow({ private: true })],
    ["Close tab", "Ctrl+W", () => gBrowser.removeTab(gBrowser.selectedTab)],
    ["Reopen closed tab", "Ctrl+Shift+T", () => lazy.SessionStore.undoCloseTab(win, 0)],
    ["Duplicate tab", "", () => gBrowser.duplicateTab(gBrowser.selectedTab)],
    ["Pin or unpin tab", "", () => gBrowser.selectedTab.pinned ? gBrowser.unpinTab(gBrowser.selectedTab) : gBrowser.pinTab(gBrowser.selectedTab)],
    ["Mute or unmute tab", "", () => gBrowser.selectedTab.toggleMuteAudio()],
    ["Reload", "F5", () => gBrowser.reload()],
    ["Bookmark this page", "Ctrl+D", () => win.PlacesCommandHook.bookmarkTabs([gBrowser.selectedTab])],
    ["Reader view", "F9", () => win.AboutReaderParent?.toggleReaderMode?.({ target: gBrowser.selectedBrowser }) ?? win.ReaderParent?.toggleReaderMode?.({ target: gBrowser.selectedBrowser })],
    ["Print", "Ctrl+P", () => win.PrintUtils.startPrintWindow(gBrowser.selectedBrowser.browsingContext)],
    ["Find in page", "Ctrl+F", () => gBrowser.getFindBar().then(f => f.onFindCommand())],
    ["Zoom in", "Ctrl++", () => win.FullZoom.enlarge()],
    ["Zoom out", "Ctrl+-", () => win.FullZoom.reduce()],
    ["Reset zoom", "Ctrl+0", () => win.FullZoom.reset()],
    ["Full screen", "F11", () => win.BrowserCommands.fullScreen?.() ?? win.BrowserFullScreen?.()],
    ["Downloads", "Ctrl+J", () => win.DownloadsPanel?.showDownloadsHistory?.() ?? win.openTrustedLinkIn("about:downloads", "tab")],
    ["History", "Ctrl+H", () => win.SidebarController.toggle("viewHistorySidebar")],
    ["Bookmarks", "Ctrl+B", () => win.SidebarController.toggle("viewBookmarksSidebar")],
    ["Saved passwords", "", () => win.openTrustedLinkIn("about:logins", "tab")],
    ["Add-ons", "Ctrl+Shift+A", () => win.openTrustedLinkIn("about:addons", "tab")],
    ["All Firefox settings", "", () => win.openTrustedLinkIn("about:preferences", "tab")],
    ["Customize toolbar", "", () => win.gCustomizeMode.enter()],
    ["Take a screenshot", "Ctrl+Shift+S", () => Services.obs.notifyObservers(win, "menuitem-screenshot", "QuickActions")],
    ["Split view", "", () => win.goDoCommand?.("cmd_splitViewAddSplitView") ?? win.gBrowser.addTabSplitView?.([gBrowser.selectedTab])],
    // Aeris's own (done by Aeris Core)
    ["Focus mode", "Alt+Shift+F", send("focus")],
    ["Aeris panel", "Alt+Shift+A", () => win.SidebarController.show("aeris-core_aeris_app-sidebar-action")],
    ["Notes", "", () => { send("notes")(); win.SidebarController.show("aeris-core_aeris_app-sidebar-action"); }],
    ["Theme Studio", "", send("studio")],
    ["Save all tabs for later", "", send("save-tabs")],
    ["Copy this page's link", "Ctrl+Shift+C", send("copy-link")],
    ["Clip this page to Notes", "", send("clip-page")],
    ["Aeris Store", "", send("store")],
    ["Open Aquaris (a desktop of web apps)", "", send("aquaris")]
  ].map(([title, keys, action]) => ({ kind: "command", title, keys, action }));
  for (const e of extras || []) list.push({ kind: "command", title: e.title, keys: "", action: send(e.command) });
  return list;
}

function openPalette(win, extras) {
  const doc = win.document;
  let panel = doc.getElementById(PALETTE_ID);
  if (panel) panel.remove();
  const html = tag => doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
  panel = doc.createXULElement("panel");
  panel.id = PALETTE_ID;
  panel.setAttribute("noautofocus", "true");
  panel.setAttribute("consumeoutsideclicks", "true");
  const box = html("div");
  box.className = "aeris-qc";
  const input = html("input");
  input.className = "aeris-qc-input";
  input.placeholder = "Search tabs, bookmarks and history, do maths, or type a command…";
  const results = html("div");
  results.className = "aeris-qc-results";
  box.append(input, results);
  panel.append(box);
  doc.getElementById("mainPopupSet").append(panel);

  const { gBrowser } = win;
  const commands = paletteCommands(win, extras);
  let items = [];
  let at = 0;
  let generation = 0;

  const close = () => panel.hidePopup();
  const open = (url, where = "current") => {
    const tab = gBrowser.selectedTab;
    const blank = !tab.linkedBrowser.currentURI || /^(about:(blank|newtab|home)|moz-extension:.*\/newtab\/)/.test(tab.linkedBrowser.currentURI.spec);
    win.openTrustedLinkIn(url, blank ? "current" : where === "current" ? "tab" : where);
  };

  function draw() {
    results.textContent = "";
    items.forEach((it, n) => {
      const row = html("div");
      row.className = "aeris-qc-row" + (n === at ? " on" : "");
      const icon = html("span");
      icon.className = "aeris-qc-kind";
      icon.textContent = { tab: "🗂", bookmark: "⭐", history: "🕘", command: "⚡", maths: "🧮", search: "🔎" }[it.kind] || "•";
      const title = html("span");
      title.className = "aeris-qc-title";
      title.textContent = it.title;
      const sub = html("span");
      sub.className = "aeris-qc-sub";
      sub.textContent = it.sub || it.keys || "";
      row.append(icon, title, sub);
      row.addEventListener("mousemove", () => { if (at !== n) { at = n; draw(); } });
      row.addEventListener("click", () => runItem(it));
      results.append(row);
    });
  }

  function runItem(it) {
    close();
    try { it.action(); } catch (e) { console.error("Aeris Quick Commands:", e); }
  }

  async function update() {
    const text = input.value.trim();
    const mine = ++generation;
    const q = text.toLowerCase();
    const found = [];
    const maths = quickMaths(text);
    if (maths !== null) found.push({ kind: "maths", title: `= ${maths}`, sub: "Copy the answer", action: () => win.navigator.clipboard.writeText(String(maths)) });
    const words = q.split(/\s+/).filter(Boolean);
    const fits = s => words.every(w => s.toLowerCase().includes(w));
    found.push(...commands.filter(c => !q || fits(c.title)).slice(0, q ? 8 : 12));
    if (q) {
      for (const tab of gBrowser.tabs) {
        const url = tab.linkedBrowser.currentURI?.spec || "";
        if (fits(tab.label + " " + url)) found.push({ kind: "tab", title: tab.label, sub: "Switch to tab", action: () => { gBrowser.selectedTab = tab; } });
      }
      try {
        const marks = await lazy.PlacesUtils.bookmarks.search(text);
        for (const b of marks.filter(b => b.url).slice(0, 5)) found.push({ kind: "bookmark", title: b.title || b.url.href, sub: b.url.host, action: () => open(b.url.href) });
        for (const h of await historyMatches(text)) {
          if (!found.some(f => f.sub === h.url)) found.push({ kind: "history", title: h.title, sub: h.url, action: () => open(h.url) });
        }
      } catch (e) { console.error(e); }
      const engine = await lazy.SearchService.getDefault();
      found.push({ kind: "search", title: `Search ${engine.name} for "${text}"`, sub: "", action: () => {
        const sub = engine.getSubmission(text);
        open(sub.uri.spec);
      } });
    }
    if (mine !== generation) return;
    items = found;
    at = 0;
    draw();
  }

  input.addEventListener("input", update);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { at = Math.min(items.length - 1, at + 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { at = Math.max(0, at - 1); draw(); e.preventDefault(); }
    else if (e.key === "Enter") { if (items[at]) runItem(items[at]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  panel.addEventListener("popuphidden", () => panel.remove(), { once: true });

  const r = win.document.documentElement.getBoundingClientRect();
  const width = Math.min(640, r.width - 40);
  panel.openPopupAtScreen(win.screenX + (win.outerWidth - width) / 2, win.screenY + 90, false);
  panel.addEventListener("popupshown", () => input.focus(), { once: true });
  update();
}

// ================= Aquaris =================
// Aquaris (../aquaris/) is its own app: a desktop OS made of web apps, running on Aeris's engine.
// "Aquaris mode" is Aeris started with a profile folder called Aquaris (the Aquaris shortcut does
// that, or "Open Aquaris" in Aeris). Then Aquaris opens as its own privileged window
// (chrome://aquaris/content/aquaris/index.html, served from Aeris Core), with its own icon and
// taskbar button.
//
// Aeris stays its own app. Aquaris starts it (normal Aeris, its normal profile) and the windows
// it opens are linked to Aquaris: when Aquaris is minimised, restored or closed, they follow. Not
// the other way round. The two apps talk through a small "link" file that Aquaris writes
// ({ sid, state: "normal" | "minimized" | "closed" }) and Aeris reads, plus a reply file Aeris
// writes (its linked windows) so Aquaris's dock can show them. Aquaris asks Aeris for a window by
// starting Aeris with "about:blank#aquaris-link=<json>" (Aeris hands that to the running Aeris).

const aquarisProfile = () => {
  const os = Services.appinfo.OS;
  if (os === "WINNT") return PathUtils.join(Services.dirsvc.get("AppData", Ci.nsIFile).path, "Aeris", "Aquaris");
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  if (os === "Darwin") return PathUtils.join(home, "Library", "Application Support", "Aeris", "Aquaris");
  // Same folder the AppImage's "--aquaris" option uses
  return PathUtils.join(Services.env.get("XDG_DATA_HOME") || PathUtils.join(home, ".local", "share"), "aeris", "Aquaris");
};
const isAquarisMode = () => /^aquaris$/i.test(PathUtils.filename(PathUtils.profileDir)) || Services.env.get("AERIS_AQUARIS") === "1";
const AQUARIS_AUMID = "Aeris.Aquaris";
const AQUARIS_URL = "chrome://aquaris/content/aquaris/index.html";
const AQUARIS_PING = "about:blank#aquaris";
const LINK_MARK = "about:blank#aquaris-link=";
const aquarisWindow = () => Services.wm.getMostRecentWindow("aquaris:desktop");

// Start another copy of this program with these arguments (it hands over to a running one)
function runSelf(args) {
  // Settings this copy got from how it was started mustn't leak into the new one
  for (const name of ["MOZ_NO_REMOTE", "XRE_PROFILE_PATH", "XRE_PROFILE_LOCAL_PATH", "XRE_PROFILE_NAME"]) Services.env.set(name, "");
  const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  proc.init(Services.dirsvc.get("XREExeF", Ci.nsIFile));
  proc.runw(false, args, args.length);
}

let aquarisChrome = null;
function registerAquarisChrome(extension) {
  if (aquarisChrome) return;
  const aom = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
  aquarisChrome = aom.registerChrome(Services.io.newURI("manifest.json", null, extension.rootURI), [["content", "aquaris", "./"]]);
}

function watchNewWindow(win, check) {
  if (win.document.readyState === "complete") win.setTimeout(() => check(win), 600);
  else win.addEventListener("load", () => win.setTimeout(() => check(win), 600), { once: true });
}

// ----- Inside Aquaris: browser windows don't belong here -----
// The empty window Aeris opens by itself at start-up and the "come to the front" signal are closed.
// A page opened in a new window (a link in an app) goes to Aeris instead. Pop-ups that a page
// opened (sign-in windows and so on) stay, because they need their opener.
const STRAY_EMPTY = /^(about:(blank|home|newtab|welcome|sessionrestore|privatebrowsing)|moz-extension:\/\/[^/]+\/(newtab|welcome|whatsnew)\/)/;
function checkStrayWindow(win) {
  if (win.closed || win.document.documentElement.getAttribute("windowtype") !== "navigator:browser") return;
  // Real Aeris windows that Aquaris opened belong here
  if (win.aquarisLinked) return;
  // (Automated tests need a browser window to attach to)
  if (Services.prefs.getBoolPref("aeris.aquaris.testKeepWindows", false)) return;
  const desk = aquarisWindow();
  if (!desk?.Aquaris) return win.setTimeout(() => checkStrayWindow(win), 300);
  const tabs = [...win.gBrowser.tabs];
  if (!win.toolbar.visible || tabs.some(t => t.linkedBrowser.browsingContext?.opener)) return;
  const urls = tabs.map(t => t.linkedBrowser.currentURI?.spec || "").filter(u => u && !STRAY_EMPTY.test(u));
  if (urls.length) desk.Aquaris.openInAeris(urls);
  else desk.focus();
  win.close();
}
const strayWatcher = { observe(subject, topic) { if (topic === "domwindowopened") watchNewWindow(subject, checkStrayWindow); } };
let watchingStrays = false;

async function startAquaris(extension) {
  registerAquarisChrome(extension);
  // Aquaris remembers its own windows; old browser windows shouldn't come back here
  Services.prefs.setIntPref("browser.startup.page", 0);
  Services.prefs.setBoolPref("browser.sessionstore.resume_from_crash", false);
  // Some music and video sites need protected playback (DRM). Normal Aeris asks with a
  // bar at the top of the page; Aquaris has no such bar, so it's simply on here.
  Services.prefs.setBoolPref("media.eme.enabled", true);
  let desk = aquarisWindow();
  if (!desk) {
    desk = Services.ww.openWindow(null, AQUARIS_URL, "_blank", "chrome,dialog=no,all,resizable", null);
    await new Promise(r => desk.addEventListener("load", r, { once: true }));
  }
  // What the Aquaris window uses from here (set once its page has loaded)
  desk.aerisHost = { openLinkedAeris };
  desk.focus();
  if (!watchingStrays) {
    watchingStrays = true;
    Services.ww.registerNotification(strayWatcher);
  }
  for (const win of Services.wm.getEnumerator("navigator:browser")) watchNewWindow(win, checkStrayWindow);
}

// Aquaris asks for an Aeris window: start normal Aeris (or hand over to the running one)
function openLinkedAeris(file, sid, urls, focus) {
  const mark = LINK_MARK + encodeURIComponent(JSON.stringify({ file, sid, urls, focus }));
  const args = [];
  // For testing, a different Aeris profile can be used
  const profile = Services.prefs.getStringPref("aeris.aquaris.aerisProfile", "");
  if (profile) args.push("-profile", profile);
  args.push("-new-window", mark);
  runSelf(args);
}

// ----- In normal Aeris: windows linked to Aquaris -----

const links = new Map(); // link file → { sid, windows: Set, last }
let linkTimer = null;
const liveWindows = link => [...link.windows].filter(w => !w.closed);

function checkLinkWindow(win, tries = 0) {
  if (win.closed || win.document.documentElement.getAttribute("windowtype") !== "navigator:browser") return;
  const mark = [...win.gBrowser.tabs].find(t => t.linkedBrowser.currentURI?.spec.startsWith(LINK_MARK));
  if (!mark) {
    // A new window's address can take a moment to show up
    if (tries < 12) win.setTimeout(() => checkLinkWindow(win, tries + 1), 500);
    return;
  }
  let data;
  try { data = JSON.parse(decodeURIComponent(mark.linkedBrowser.currentURI.spec.slice(LINK_MARK.length))); } catch { return; }
  if (typeof data?.file !== "string" || !/aeris-link\.json$/.test(data.file)) return;
  let link = links.get(data.file);
  if (!link || link.sid !== data.sid) {
    link = { sid: data.sid, windows: new Set(), last: "normal" };
    links.set(data.file, link);
  }
  const system = Services.scriptSecurityManager.getSystemPrincipal();
  const urls = (data.urls || []).filter(u => typeof u === "string" && /^(https?|about|moz-extension):/.test(u));
  const existing = liveWindows(link)[0];
  if (existing && existing !== win && (data.focus || urls.length)) {
    // Aeris already has a window for Aquaris: open the pages there and bring it up
    for (const u of urls) existing.openTrustedLinkIn(u, "tab");
    if (existing.windowState === existing.STATE_MINIMIZED) existing.restore();
    existing.focus();
    if (win.gBrowser.tabs.length === 1) win.close();
    else win.gBrowser.removeTab(mark);
    return;
  }
  link.windows.add(win);
  win.aquarisLinked = data.file;
  if (urls.length) {
    for (const u of urls) win.gBrowser.addTab(u, { triggeringPrincipal: system });
    win.gBrowser.removeTab(mark);
  } else {
    mark.linkedBrowser.fixupAndLoadURIString(win.BROWSER_NEW_TAB_URL || "about:newtab", { triggeringPrincipal: system });
  }
  startLinkTimer();
}
const linkWatcher = { observe(subject, topic) { if (topic === "domwindowopened") watchNewWindow(subject, w => checkLinkWindow(w)); } };
let watchingLinks = false;

// Follow Aquaris: minimised → minimise; back → restore (only the ones it minimised); closed → close
async function followLinks() {
  for (const [file, link] of links) {
    const state = await IOUtils.readJSON(file).catch(() => null);
    if (state?.sid === link.sid && state.state !== link.last) {
      link.last = state.state;
      for (const w of liveWindows(link)) {
        if (state.state === "minimized" && w.windowState !== w.STATE_MINIMIZED) { w.aquarisMinimized = true; w.minimize(); }
        if (state.state === "normal" && w.aquarisMinimized) { w.aquarisMinimized = false; w.restore(); }
        if (state.state === "closed") w.close();
      }
    }
    // Tell Aquaris which windows it has here (for its dock)
    const open = liveWindows(link).filter(w => !w.closing);
    const reply = { sid: link.sid, at: Date.now(), windows: open.map(w => ({ title: w.gBrowser.selectedTab.label, minimized: w.windowState === w.STATE_MINIMIZED })) };
    IOUtils.writeJSON(file + ".aeris", reply).catch(() => {});
    if (link.last === "closed" || !open.length) links.delete(file);
  }
  if (!links.size) { linkTimer?.cancel(); linkTimer = null; }
}
function startLinkTimer() {
  if (linkTimer) return;
  linkTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  linkTimer.initWithCallback({ notify: () => followLinks() }, 600, Ci.nsITimer.TYPE_REPEATING_SLACK);
}
function watchAquarisLinks() {
  if (watchingLinks || isAquarisMode()) return;
  watchingLinks = true;
  Services.ww.registerNotification(linkWatcher);
  for (const win of Services.wm.getEnumerator("navigator:browser")) watchNewWindow(win, w => checkLinkWindow(w));
}

async function launchAquaris() {
  const profile = aquarisProfile();
  await IOUtils.makeDirectory(profile, { ignoreExisting: true });
  runSelf(["-profile", profile, AQUARIS_PING]);
}

this.aeris = class extends ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (!isAppShutdown) {
      setChromeStyle("");
      setTabStacking(false);
      setPagesStyle("");
    }
  }

  getAPI(context) {
    const { extension } = context;
    return {
      aeris: {
        async setChromeStyle(css) { setChromeStyle(css); },

        async setNewTabPage(url) {
          lazy.AboutNewTab.newTabURL = url;
          Services.prefs.setStringPref("browser.startup.homepage", url);
        },

        async appInfo() {
          // version.json has the full name, like "1.0.0-beta.1" (the manifest only takes numbers).
          const full = await extension.readJSON("version.json").catch(() => null);
          return { aeris: full?.version || extension.manifest.version, firefox: Services.appinfo.version };
        },

        async readAeroExport() {
          const file = PathUtils.join(aeroFolder(), "aeris-export.json");
          return (await IOUtils.exists(file)) ? IOUtils.readJSON(file) : null;
        },

        importAeroPasswords,

        async installAddon(path) {
          // Add-ons from Mozilla's store are signed by Mozilla; ours ship inside Aeris Core.
          const url = path.startsWith(AMO_PREFIX) ? path : extension.rootURI.resolve(path);
          const install = await lazy.AddonManager.getInstallForURL(url, { telemetryInfo: { source: "aeris-store" } });
          const addon = await install.install();
          return { id: addon.id, version: addon.version };
        },

        async openBrowserPage(url) {
          if (!BROWSER_PAGES.test(url)) throw new Error("Only Firefox's settings, add-ons and passwords pages can be opened.");
          Services.wm.getMostRecentWindow("navigator:browser")?.openTrustedLinkIn(url, "tab");
        },

        async removeAddon(id) {
          const addon = await lazy.AddonManager.getAddonByID(id);
          if (addon) await addon.uninstall();
        },

        async addonInfo(ids, page) {
          const out = [];
          for (const id of ids) {
            const addon = await lazy.AddonManager.getAddonByID(id);
            const policy = WebExtensionPolicy.getByID(id);
            out.push({
              id,
              installed: !!addon,
              enabled: !!addon?.isActive,
              version: addon?.version || null,
              page: policy && page ? policy.getURL(page) : null
            });
          }
          return out;
        },

        async downloadUpdate(url, version) {
          if (!url.startsWith(UPDATE_PREFIX)) throw new Error("Updates only come from Aeris's GitHub releases.");
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          const file = PathUtils.join(PathUtils.tempDir, `Aeris-Setup-${version.replace(/[^\w.-]/g, "")}.exe`);
          await IOUtils.write(file, new Uint8Array(await res.arrayBuffer()));
          if (!pendingInstaller) Services.obs.addObserver(quitObserver, "quit-application-granted");
          pendingInstaller = file;
          return true;
        },

        async restartToUpdate() {
          if (!pendingInstaller) return false;
          Services.obs.removeObserver(quitObserver, "quit-application-granted");
          launchInstaller(["/S", "/RELAUNCH"]);
          Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
          return true;
        },

        async getPrefs(names) {
          const out = {};
          for (const name of names) {
            if (PREFS[name]) out[name] = Services.prefs[prefGet[PREFS[name]]](name);
          }
          return out;
        },

        async setPrefs(prefs) {
          for (const [name, value] of Object.entries(prefs)) {
            if (!PREFS[name]) throw new Error(`Customize can't change ${name}.`);
            Services.prefs[prefSet[PREFS[name]]](name, value);
          }
        },

        async searchEngines() {
          const current = await lazy.SearchService.getDefault();
          return (await lazy.SearchService.getVisibleEngines()).map(e => ({ name: e.name, isDefault: e.name === current.name }));
        },

        async setSearchEngine(name) {
          const engine = lazy.SearchService.getEngineByName(name);
          if (!engine) throw new Error(`There's no search engine called ${name}.`);
          await lazy.SearchService.setDefault(engine, lazy.SearchService.CHANGE_REASON.USER ?? lazy.SearchService.CHANGE_REASON.USER_SEARCHBAR);
        },

        async isDefaultBrowser() {
          return lazy.ShellService.isDefaultBrowser(false, false);
        },

        async makeDefaultBrowser() {
          await lazy.ShellService.setDefaultBrowser(false);
        },

        async setAddonEnabled(id, enabled) {
          const addon = await lazy.AddonManager.getAddonByID(id);
          if (!addon) throw new Error("That add-on isn't installed.");
          await (enabled ? addon.enable() : addon.disable());
        },

        async openImportWizard() {
          lazy.MigrationUtils.showMigrationWizard(browserWindow(), {});
        },

        async openLibrary() {
          browserWindow()?.PlacesCommandHook.showPlacesOrganizer("BookmarksToolbar");
        },

        async memoryUsage() {
          const info = await ChromeUtils.requestProcInfo();
          const bytes = info.memory + info.children.reduce((sum, c) => sum + c.memory, 0);
          return Math.round(bytes / 1048576);
        },

        async toolbarButtons(ids) {
          const out = {};
          for (const id of ids) if (TOOLBAR_BUTTONS.includes(id)) out[id] = !!lazy.CustomizableUI.getPlacementOfWidget(id);
          return out;
        },

        async openQuickCommands(extras) {
          const win = browserWindow();
          if (win) openPalette(win, extras);
        },

        async openCustomizeToolbar() {
          browserWindow()?.gCustomizeMode.enter();
        },

        // Commands from Quick Commands for Aeris Core to carry out
        onCommand: new ExtensionCommon.EventManager({
          context,
          name: "aeris.onCommand",
          register: fire => {
            const observer = (subject, topic, command) => fire.async(command);
            Services.obs.addObserver(observer, "aeris-command");
            return () => Services.obs.removeObserver(observer, "aeris-command");
          }
        }).api(),

        async aquarisMode() {
          return isAquarisMode();
        },

        async watchAquarisLinks() {
          watchAquarisLinks();
        },

        async startAquaris() {
          if (!isAquarisMode()) throw new Error("Aquaris runs as its own app; use launchAquaris.");
          await startAquaris(extension);
        },

        async launchAquaris() {
          await launchAquaris();
        },

        async makeAquarisShortcut() {
          if (Services.appinfo.OS !== "WINNT") throw new Error(Services.appinfo.OS === "Darwin" ? "On a Mac, open Aquaris from your Applications folder." : "On Linux, open Aquaris from your apps menu, or start Aeris with --aquaris.");
          const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
          const profile = aquarisProfile();
          await IOUtils.makeDirectory(profile, { ignoreExisting: true });
          // Aquaris's own icon, saved next to its profile for the shortcut to use
          const iconPath = PathUtils.join(PathUtils.parent(profile), "Aquaris.ico");
          const res = await fetch(extension.baseURI.resolve("aquaris/icon.ico"));
          await IOUtils.write(iconPath, new Uint8Array(await res.arrayBuffer()));
          const icon = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          icon.initWithPath(iconPath);
          const shell = Cc["@mozilla.org/browser/shell-service;1"].getService(Ci.nsIWindowsShellService);
          return shell.createShortcut(exe, ["-profile", profile], "Aquaris", icon, 0, AQUARIS_AUMID, "Desktop", "Aquaris.lnk");
        },

        async setPagesStyle(css) {
          setPagesStyle(css);
        },

        async setTabStacking(on) {
          setTabStacking(on);
        },

        async setToolbarButton(id, show) {
          if (!TOOLBAR_BUTTONS.includes(id)) throw new Error(`Customize can't move ${id}.`);
          if (show) lazy.CustomizableUI.addWidgetToArea(id, lazy.CustomizableUI.AREA_NAVBAR);
          else lazy.CustomizableUI.removeWidgetFromArea(id);
        }
      }
    };
  }
};
