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
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`);
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
  "browser.shell.checkDefaultBrowser": "bool"
};
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

const aeroFolder = () => PathUtils.join(Services.dirsvc.get("AppData", Ci.nsIFile).path, "Aero Browser");

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
    ["Clip this page to Notes", "", send("clip-page")],
    ["Aeris Store", "", send("store")]
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

this.aeris = class extends ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (!isAppShutdown) {
      setChromeStyle("");
      setTabStacking(false);
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
