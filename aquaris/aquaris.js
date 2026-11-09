// Aquaris: a desktop OS made of web apps, running on Aeris's engine (everything shares one engine).
// Aquaris is its own app: Aeris Core opens this page as a privileged window of its own
// (chrome://aquaris/content/index.html, see the Aquaris part of aeris/addon/api/parent.js).
// - Apps (Discord, YouTube Music…) are real browser views (<browser> elements) in windows on the desktop,
//   so they behave like normal tabs (sign-ins work, nothing is "framed").
// - Aeris is its own app; the Aeris icon opens Aeris windows linked to Aquaris (they minimise,
//   come back and close with Aquaris; see "Aeris, linked to Aquaris").
// - Minimised apps "nap" after a while (their view is unloaded until opened again) to save memory.
// Layout (DESIGN.md): top bar, centred dock, search-first launcher, quick settings.
// Opened as a plain file (no privileges), it still shows the desktop, with apps in iframes.
"use strict";

const $ = s => document.querySelector(s);
const html = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
// Privileged pages strip buttons and inputs out of HTML set with innerHTML, so Aquaris's own bits
// of HTML are parsed separately and moved in (only Aquaris's own text goes through here).
const parser = new DOMParser();
function setHTML(el, text) {
  el.replaceChildren(...parser.parseFromString(`<body>${text}</body>`, "text/html").body.childNodes);
}
const icon = (name, cls = "i") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const inChrome = typeof ChromeUtils !== "undefined" && typeof Services !== "undefined";
// The web version (iPad, phones, any browser): Aquaris as a website you add to the Home Screen
const onWeb = !inChrome;
if (onWeb) document.body.classList.add("web");
// The iPad app ("shell", aquaris-ipad/): every website opens inside Aquaris windows, as a real
// app view the iPad app lays over the window (websites can't be put inside a web page there).
const shell = window.webkit?.messageHandlers?.aquarisShell || null;
const inShell = !!shell;
if (inShell) document.body.classList.add("shell");

// ================= Settings storage =================
// Inside Aeris: aquaris.json in the profile folder. As a plain file: in memory only.

const store = {
  data: {},
  file: inChrome ? PathUtils.join(PathUtils.profileDir, "aquaris.json") : null,
  timer: 0,
  async load() {
    if (this.file) this.data = await IOUtils.readJSON(this.file).catch(() => ({}));
    else if (inShell && window.aquarisSaved) this.data = window.aquarisSaved;
    else try { this.data = JSON.parse(localStorage.getItem("aquaris") || "{}"); } catch { this.data = {}; }
  },
  async get(defaults) {
    return Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, k in this.data ? this.data[k] : v]));
  },
  async set(changes) {
    Object.assign(this.data, changes);
    clearTimeout(this.timer);
    if (!this.file) return void (this.timer = setTimeout(() => {
      const json = JSON.stringify(this.data);
      if (inShell) shell.postMessage({ cmd: "save", data: json });
      try { localStorage.setItem("aquaris", json); } catch {}
    }, 300));
    this.timer = setTimeout(() => IOUtils.writeJSON(this.file, this.data, { tmpPath: this.file + ".tmp" }).catch(e => console.error("Aquaris save:", e)), 300);
  }
};

const DEFAULTS = {
  aquarisApps: [],            // apps you added yourself
  aquarisPinned: AQUARIS_PINNED,
  aquarisLayout: [],          // the app windows that were open, to bring back next time
  aquarisTheme: "minimal",    // "minimal" (default) or "aqua" (Frutiger Aqua skin)
  aquarisMode: "auto",        // light / dark / auto (follows the computer)
  aquarisGlass: 55,           // 0 = clear glass, 100 = frosted
  aquarisLessMotion: false,
  aquarisWall: "auto",        // "auto" = the style's own wallpaper
  aquarisOwnWall: "",
  aquarisDesktopIcons: true,
  aquarisNapAfter: 3,         // minutes a minimised app waits before napping (0 = never)
  aquarisAutostart: true,     // start Aquaris when the computer starts
  aquarisHidden: [],          // apps taken off the desktop (still in the launcher)
  aquarisSpots: {},           // where each desktop icon sits: { id: [column, row] }
  aquarisNotes: [{ id: "first", text: "" }],
  aquarisNight: { on: false, warmth: 50 },  // Aquaris's night light
  aquarisRamLimit: { on: false, gb: 4 },    // like Opera GX's RAM limiter
  aquarisCpuLimit: { on: false, pct: 50 },  // like Opera GX's CPU limiter
  aquarisRemoved: [],         // apps you uninstalled (get them back in AquaApps)
  aquarisGot: [],             // Aquaris apps you got from AquaApps
  aquarisLookMore: { radius: 10, buttons: "windows", dock: 44, clock: true, deskText: "", cursor: "normal", cursorSize: 24, ownCursor: "", intro: true },
  aquarisRecent: [],          // apps you opened lately, newest first
  aquarisQuickAccess: null,   // folders pinned in Files' Quick access (null = the usual ones)
  aquarisWeather: null,       // { name, lat, lon } for the Weather app
  aquarisAwake: [],           // apps that should never nap
  // Aeris in the iPad app: its Customize options (the same ones as Aeris on a computer)
  aquarisAeris: { theme: "", accent: "", gloss: 50, bars: "top", tabShape: "rounded", size: "comfy", ntZoom: 85,
    mods: { shell: true, floating: false, motion: true, hoverClose: false, centerTitles: false, tabNumbers: false, bigTabs: false } }
};
let settings = { ...DEFAULTS };

const allApps = () => [...AQUARIS_APPS.filter(a => !settings.aquarisRemoved.includes(a.id)), ...settings.aquarisApps];
// Aeris runs inside Aquaris as an app: its New Tab page (with its themes and Google search), with
// back / forward / home and an address bar. Links stay in its window.
const NEW_TAB_URL = (() => {
  try { return ChromeUtils.importESModule("resource:///modules/AboutNewTab.sys.mjs").AboutNewTab.newTabURL; } catch { return "https://www.google.com/"; }
})();
// In the iPad app, Aeris is Aeris's own New Tab page, toolbar and tabs, in an Aquaris window (on the
// iPad's engine: Apple only allows its own). The theme you picked in Aquaris goes along.
const aerisNewTab = () => {
  const s = typeof settings !== "undefined" ? settings : {};
  const pick = s.aquarisAeris?.theme ? s.aquarisAeris.theme : s.aquarisTheme || "";
  const id = pick.startsWith("t:") ? pick.slice(2) : "";
  // Widget size goes along too (the New Tab scales its widgets; zooming the whole page made the bubbles smear)
  return new URL("../aeris/newtab/index.html", location.href).href + "#size=" + (s.aquarisAeris?.ntZoom || 85) + (id ? "&theme=" + id : "");
};
const AERIS_APP = inShell ? { id: "aeris", name: "Aeris", about: "The web browser, with Aeris's New Tab and themes", get url() { return aerisNewTab(); }, browser: true, size: [1060, 720] }
  : onWeb ? { id: "aeris", name: "Browser", about: "Opens the web in a new tab", url: "https://www.google.com/", color: "#2a86e8", ui: "globe", size: [1000, 700] }
  : { id: "aeris", name: "Aeris", about: "The web browser, with all of Aeris", url: NEW_TAB_URL, size: [1180, 760] };
// Aquaris's own apps: made by Aquaris, nothing from the internet
const OWN_APPS = [
  { id: "aquaapps", name: "AquaApps", about: "Get Aquaris apps", color: "#1aa3e8", ui: "store", own: true, pre: true, size: [820, 600] },
  { id: "files", name: "Files", about: "Your folders and files", color: "#f0a81c", ui: "folder", own: true, pre: true, size: [900, 600] },
  { id: "notepad", name: "Notepad", about: "Write notes (they save by themselves)", color: "#f2b01e", ui: "pencil", own: true, pre: true, size: [620, 520] },
  { id: "calculator", name: "Calculator", about: "Do sums", color: "#5b6b82", ui: "calc", own: true, pre: true, size: [340, 520] },
  { id: "clock", name: "Clock", about: "Time, stopwatch and timer", color: "#2a86e8", ui: "clock", own: true, pre: true, size: [420, 440] },
  { id: "paint", name: "Paint", about: "Draw and paint pictures", color: "#e8487b", ui: "brush", own: true, size: [960, 660] },
  { id: "weather", name: "Weather", about: "Today and the next days, anywhere", color: "#1e9be8", ui: "cloud", own: true, size: [520, 560] }
];
// Installed: the ones that come with Aquaris (unless you removed them) and the ones you got
const ownInstalled = () => OWN_APPS.filter(a => !(onWeb && a.id === "files")).filter(a => a.id === "aquaapps" || ((a.pre || settings.aquarisGot.includes(a.id)) && !settings.aquarisRemoved.includes(a.id)));
const everyApp = () => [AERIS_APP, ...ownInstalled(), ...allApps()];
// Look up any app, installed or not (for AquaApps)
const anyApp = id => [AERIS_APP, ...OWN_APPS, ...AQUARIS_APPS, ...settings.aquarisApps].find(a => a.id === id);
const appById = id => everyApp().find(a => a.id === id);
const SYSTEM = {
  settings: { id: "settings", name: "Settings", color: "#6b7a8f", ui: "gear" },
  about: { id: "about", name: "About Aquaris", color: "#2a86e8", ui: "info" },
  add: { id: "add", name: "Add an app", color: "#8a96a8", ui: "plus" }
};

// ================= Web views =================
// A real browser view (inside Aeris) or an iframe (as a plain file).

const ALL_PRINCIPAL = () => Services.scriptSecurityManager.getSystemPrincipal();
function makeView(url) {
  let v;
  if (inShell) {
    v = html("div", "shell-view");
    v.dataset.shell = "v" + ++shellSeq;
    v.className = "view shell-view";
    v.dataset.first = url;
    return v;
  }
  if (inChrome) {
    v = document.createXULElement("browser");
    for (const [k, val] of Object.entries({ type: "content", remote: "true", maychangeremoteness: "true", messagemanagergroup: "browsers", nodefaultsrc: "true" })) v.setAttribute(k, val);
  } else {
    v = html("iframe");
    v.setAttribute("allow", "autoplay; clipboard-read; clipboard-write; microphone; camera; fullscreen; encrypted-media");
  }
  v.className = "view";
  v.dataset.first = url;
  // Camera, microphone, notifications, location…: Aquaris asks you itself (see "Permissions")
  if (inChrome) v.fxrPermissionPrompt = request => askPermission(v, request);
  return v;
}
// Call once the view is in the page
function loadView(v, url) {
  if (inShell && v.dataset.shell) { shellOpen.add(v.dataset.shell); shell.postMessage({ cmd: "open", id: v.dataset.shell, url }); return shellSync(); }
  if (!inChrome) return void (v.src = url);
  v.fixupAndLoadURIString(url, { triggeringPrincipal: ALL_PRINCIPAL() });
}
const viewUrl = v => (inChrome ? v.currentURI?.spec : v.src || v.dataset.url) || v.dataset.first || "";
const viewTitle = v => (inChrome ? v.contentTitle : v.dataset.title) || "";
const viewLoading = v => (inChrome ? !!v.webProgress?.isLoadingDocument : v.dataset.loading === "1");
const pageIcon = url => (inChrome && /^https?:/.test(url) ? "page-icon:" + url : "");

// Turn what someone typed into an address (a website, or a web search)
function fixup(text) {
  text = text.trim();
  if (!inChrome) return /^\w+:\/\//.test(text) ? text : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text) ? "https://" + text : "https://www.google.com/search?q=" + encodeURIComponent(text);
  const info = Services.uriFixup.getFixupURIInfo(text, Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS | Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP);
  return info.preferredURI?.spec || text;
}

// ================= App icons =================

function tile(app, size = "") {
  const t = html("span", "tile" + (size ? " " + size : ""));
  if (app.id === "aeris" && (!onWeb || inShell)) {
    t.classList.add("img");
    const img = html("img");
    img.alt = "";
    img.src = "../icons/aeris-128.png";
    t.append(img);
    return t;
  }
  t.style.setProperty("--c", app.color || "#2a86e8");
  t.style.color = app.color || "#2a86e8";
  if (app.image) {
    // A picture someone uploaded
    t.classList.add("photo");
    const img = html("img");
    img.alt = "";
    img.src = app.image;
    t.append(img);
    return t;
  }
  if (app.symbol) setHTML(t, `<svg class="glyph ui"><use href="#i-${app.symbol}"/></svg>`);
  else if (app.letter) t.textContent = app.letter;
  else if (app.glyph) setHTML(t, `<svg viewBox="0 0 24 24" class="glyph">${app.glyph}</svg>`);
  else if (app.ui) setHTML(t, `<svg class="glyph ui"><use href="#i-${app.ui}"/></svg>`);
  else {
    t.textContent = (app.name || "?").trim()[0].toUpperCase();
    const src = app.url && pageIcon(app.url);
    if (src) {
      // The website's own little picture, on a white square, once it's known
      const img = html("img");
      img.alt = "";
      img.addEventListener("load", () => { t.textContent = ""; t.classList.add("site"); t.append(img); });
      img.src = src;
    }
  }
  return t;
}

// ================= Windows =================
// kind: "app" (a web app) or "native" (Settings, About, Add an app)

const wins = [];
let zTop = 10, cascade = 0;
const deskRect = () => $("#desktop").getBoundingClientRect();
const dockSpace = () => Math.ceil(innerHeight - $("#dock").getBoundingClientRect().top) + 8;

function makeWindow({ app, title, kind, rect, state = "normal" }) {
  const el = html("section", "win opening " + kind);
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", title);
  const bar = html("div", "titlebar");
  bar.append(tile(app, "tiny"));
  const name = html("span", "title", title);
  bar.append(name);
  const tools = html("span", "tools");
  setHTML(tools, `<button class="tool t-split" title="Split screen: this on the left, pick what goes on the right">${icon("split")}</button>` +
    (kind === "app" ? `<button class="tool t-reload" title="Reload">${icon("reload")}</button><button class="tool t-out" title="Open in Aeris">${icon("out")}</button>` : ""));
  bar.append(tools);
  const caption = html("span", "caption");
  setHTML(caption, `<button class="c-min" title="Minimise">${icon("min")}</button><button class="c-max" title="Maximise">${icon("max")}</button><button class="c-close" title="Close">${icon("close")}</button>`);
  bar.append(caption);
  const body = html("div", "body");
  el.append(bar, body);
  for (const d of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
    const h = html("div", "rz");
    h.dataset.d = d;
    el.append(h);
  }
  const d = deskRect();
  const room = d.height - dockSpace();
  const [w0, h0] = app.size || (kind === "native" ? [560, 520] : [1040, 700]);
  const w = Math.min(w0, d.width - 40), h = Math.min(h0, room - 24);
  if (!rect) {
    const step = (cascade++ % 6) * 26;
    rect = { x: Math.max(12, (d.width - w) / 2 - 60 + step), y: Math.max(10, (room - h) / 2 - 20 + step), w, h };
  }
  const win = { id: crypto.randomUUID(), app, kind, el, bar, body, name, view: null, state: "normal", rect, napped: false, minimisedAt: 0 };
  wins.push(win);
  $("#windows").append(el);
  place(win);
  wireWindow(win, bar, caption, tools);
  if (state === "max") maximise(win, true);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("opening")));
  focusWin(win);
  return win;
}

// Animate a window's size and position for a moment (maximise, restore, snap)
function animateGeo(win) {
  win.el.classList.add("geo");
  clearTimeout(win.geoTimer);
  win.geoTimer = setTimeout(() => win.el.classList.remove("geo"), 380);
}

function place(win) {
  const r = win.state === "max" ? { x: 0, y: 0, w: deskRect().width, h: deskRect().height - dockSpace() } : win.rect;
  Object.assign(win.el.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
}

function focusWin(win) {
  if (win) {
    win.el.style.zIndex = ++zTop;
    win.lastUsed = Date.now();
    if (win.throttled) unthrottle(win);
  }
  for (const w of wins) w.el.classList.toggle("active", w === win);
  // On an iPad, redrawing the dock and menu bar while a finger is still down makes iPadOS think
  // the tap was only a "hover", and the button never gets clicked: so redraw just after the tap.
  if (onWeb) {
    clearTimeout(focusWin.later);
    focusWin.later = setTimeout(() => { drawDock(); drawTopApp(); }, 450);
  } else {
    drawDock();
    drawTopApp();
  }
}
const activeWin = () => wins.filter(w => !w.state.startsWith("min")).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0] || null;
const isFront = w => w === activeWin() && w.el.classList.contains("active") && !w.state.startsWith("min");

function dockSpot(win) {
  const b = $(`#dockApps [data-app="${win.app.id}"]`) || $("#dockLauncher");
  const r = b.getBoundingClientRect(), d = deskRect();
  return `${r.left + r.width / 2 - d.left - win.rect.x}px ${r.top - d.top - win.rect.y}px`;
}

function minimise(win) {
  if (win.state !== "max") win.el.style.transformOrigin = dockSpot(win);
  win.state = win.state === "max" ? "min-max" : "min";
  win.el.classList.add("min");
  win.el.classList.remove("active");
  win.minimisedAt = Date.now();
  focusWin(activeWin());
  saveLayout();
}

function restore(win) {
  if (win.state.startsWith("min")) {
    win.state = win.state === "min-max" ? "max" : "normal";
    win.el.classList.remove("min");
  }
  if (win.napped) wake(win);
  focusWin(win);
  saveLayout();
}

function maximise(win, on = win.state !== "max") {
  if (on && win.state !== "max") win.before = { ...win.rect };
  win.state = on ? "max" : "normal";
  animateGeo(win);
  win.el.classList.toggle("max", on);
  setHTML(win.el.querySelector(".c-max"), icon(on ? "restore" : "max"));
  win.el.querySelector(".c-max").title = on ? "Restore" : "Maximise";
  place(win);
  saveLayout();
}

function closeWin(win) {
  wins.splice(wins.indexOf(win), 1);
  win.el.classList.add("closing");
  setTimeout(() => win.el.remove(), 200);
  focusWin(activeWin());
  saveLayout();
}

function wireWindow(win, bar, caption, tools) {
  const { el } = win;
  el.addEventListener("pointerdown", () => focusWin(win), true);
  caption.querySelector(".c-min").addEventListener("click", () => minimise(win));
  caption.querySelector(".c-max").addEventListener("click", () => maximise(win));
  caption.querySelector(".c-close").addEventListener("click", () => closeWin(win));
  bar.addEventListener("dblclick", e => !e.target.closest("button") && maximise(win));
  tools.querySelector(".t-reload")?.addEventListener("click", () => (inChrome && win.view ? win.view.reload() : inShell && win.view ? shell.postMessage({ cmd: "reload", id: win.view.dataset.shell }) : loadApp(win)));
  tools.querySelector(".t-split").addEventListener("click", () => splitScreen(win, "left"));
  tools.querySelector(".t-out")?.addEventListener("click", () => { openInAeris([win.view ? viewUrl(win.view) : win.app.url]); closeWin(win); });

  // Moving. Drop at the top edge to maximise, a side for half the screen, a corner for a quarter.
  bar.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    const d = deskRect();
    let start = { x: e.clientX, y: e.clientY, rx: win.rect.x, ry: win.rect.y };
    let moved = false, snap = null;
    try { bar.setPointerCapture(e.pointerId); } catch {}
    document.body.classList.add("dragging");
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      if (!moved && (win.state === "max" || win.snapped)) {
        const frac = (ev.clientX - d.left) / d.width;
        if (win.before) win.rect = { ...win.before };
        win.state = "normal";
        win.snapped = false;
        el.classList.remove("max");
        setHTML(el.querySelector(".c-max"), icon("max"));
        win.rect.x = ev.clientX - d.left - win.rect.w * frac;
        win.rect.y = Math.max(0, ev.clientY - d.top - 16);
        start = { x: ev.clientX, y: ev.clientY, rx: win.rect.x, ry: win.rect.y };
      }
      moved = true;
      win.rect.x = start.rx + ev.clientX - start.x;
      win.rect.y = Math.max(0, Math.min(d.height - 40, start.ry + ev.clientY - start.y));
      place(win);
      const px = ev.clientX - d.left, py = ev.clientY - d.top, edge = 3, corner = 60;
      const left = px <= edge, right = px >= d.width - edge - 1, top = py <= edge;
      snap = (left || right) && py < corner ? (left ? "tl" : "tr")
        : (left || right) && py > d.height - dockSpace() - corner ? (left ? "bl" : "br")
        : top ? "max" : left ? "left" : right ? "right" : null;
      showSnap(snap);
    };
    const up = () => {
      bar.removeEventListener("pointermove", move);
      document.body.classList.remove("dragging");
      showSnap(null);
      if (snap === "max") maximise(win, true);
      else if (snap) {
        win.before = { ...win.rect, x: start.rx, y: start.ry };
        win.rect = snapRect(snap);
        win.snapped = true;
        animateGeo(win);
        place(win);
        if (snap === "left" || snap === "right") snapAssist(win, snap === "left" ? "right" : "left");
      }
      if (moved) saveLayout();
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up, { once: true });
    bar.addEventListener("pointercancel", up, { once: true });
  });

  for (const h of el.querySelectorAll(".rz")) {
    h.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      focusWin(win);
      const dir = h.dataset.d;
      const px = e.clientX, py = e.clientY, s = { ...win.rect };
      try { h.setPointerCapture(e.pointerId); } catch {}
      document.body.classList.add("dragging");
      const move = ev => {
        const dx = ev.clientX - px, dy = ev.clientY - py;
        const r = { ...s };
        if (dir.includes("e")) r.w = Math.max(320, s.w + dx);
        if (dir.includes("s")) r.h = Math.max(200, s.h + dy);
        if (dir.includes("w")) { r.w = Math.max(320, s.w - dx); r.x = s.x + s.w - r.w; }
        if (dir.includes("n")) { r.h = Math.max(200, s.h - dy); r.y = Math.max(0, s.y + s.h - r.h); }
        win.rect = r;
        win.snapped = false;
        place(win);
      };
      const up = () => {
        h.removeEventListener("pointermove", move);
        document.body.classList.remove("dragging");
        saveLayout();
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up, { once: true });
      h.addEventListener("pointercancel", up, { once: true });
    });
  }
}

function snapRect(kind) {
  const d = deskRect(), W = d.width, H = d.height - dockSpace();
  const r = { max: [0, 0, W, H], left: [0, 0, W / 2, H], right: [W / 2, 0, W / 2, H], tl: [0, 0, W / 2, H / 2], tr: [W / 2, 0, W / 2, H / 2], bl: [0, H / 2, W / 2, H / 2], br: [W / 2, H / 2, W / 2, H / 2] }[kind];
  return { x: r[0], y: r[1], w: r[2], h: r[3] };
}
// ================= Split screen =================
// Two windows side by side, each filling half the desktop. Put one on a side (the split button, or
// drag it to the edge) and pick what goes on the other side, from your open windows (Aeris too).

function splitScreen(win, side) {
  if (win.state === "max") maximise(win, false);
  if (win.state.startsWith("min")) restore(win);
  win.before = { ...win.rect };
  win.rect = snapRect(side);
  win.snapped = true;
  animateGeo(win);
  place(win);
  focusWin(win);
  snapAssist(win, side === "left" ? "right" : "left");
}

function snapAssist(first, side) {
  $("#snapAssist")?.remove();
  const others = [
    ...wins.filter(w => w !== first).map(w => ({ app: w.app, title: w.name.textContent, go: () => {
      if (w.state.startsWith("min")) restore(w);
      if (w.state === "max") maximise(w, false);
      w.before = { ...w.rect };
      w.rect = snapRect(side);
      w.snapped = true;
      animateGeo(w);
      place(w);
      focusWin(w);
    } })),
    ...aerisWindows().map(a => ({ app: AERIS_APP, title: aerisTitle(a), go: () => {
      if (a.windowState !== a.STATE_NORMAL) a.restore();
      const r = snapRect(side), d = deskRect();
      a.resizeTo(r.w, r.h);
      a.moveTo(mozInnerScreenX + d.left + r.x, mozInnerScreenY + d.top + r.y);
      a.focus();
    } }))
  ];
  if (!others.length) return;
  const r = snapRect(side);
  const box = html("div", "snap-assist");
  box.id = "snapAssist";
  Object.assign(box.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
  box.append(html("b", "snap-title", "Pick what goes here"));
  const grid = html("div", "snap-grid");
  for (const o of others) {
    const b = html("button", "snap-pick");
    b.append(tile(o.app, "big"), html("span", "", o.title));
    b.addEventListener("click", () => { box.remove(); o.go(); });
    grid.append(b);
  }
  box.append(grid);
  box.addEventListener("pointerdown", e => { if (e.target === box) box.remove(); });
  $("#desktop").append(box);
  const gone = e => { if (e.key === "Escape") { box.remove(); removeEventListener("keydown", gone); } };
  addEventListener("keydown", gone);
}

function showSnap(kind) {
  const p = $("#snapPreview");
  p.hidden = !kind;
  if (!kind) return;
  const r = snapRect(kind);
  Object.assign(p.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
}

// ================= Web apps =================

function cover(win, kind) {
  win.body.querySelector(".cover")?.remove();
  if (!kind) return;
  const c = html("div", "cover " + kind);
  c.append(tile(win.app, "big"));
  if (kind === "nap") {
    c.append(html("b", "", `${win.app.name} is napping`));
    c.append(html("small", "", "It was put to sleep while it was hidden, so it isn't using any memory. Click to wake it up."));
    c.addEventListener("click", () => wake(win));
  } else {
    c.append(html("b", "", win.app.name), html("span", "spinner"));
  }
  win.body.append(c);
}

function loadApp(win) {
  win.view?.remove();
  const v = makeView(win.app.url);
  win.view = v;
  win.napped = false;
  win.loadedOnce = false;
  cover(win, "loading");
  win.body.prepend(v);
  loadView(v, win.app.url);
  if (!inChrome && !inShell) v.addEventListener("load", () => cover(win, null), { once: true });
  drawDock();
}
function nap(win) {
  if (win.kind !== "app" || win.napped) return;
  win.view?.remove();
  win.view = null;
  win.napped = true;
  cover(win, "nap");
  drawDock();
}
function wake(win) {
  if (win.napped) loadApp(win);
}

function noteRecent(app) {
  if (!app?.id || SYSTEM[app.id] || app.id.startsWith("photo:") || app.id.startsWith("page-")) return;
  settings.aquarisRecent = [app.id, ...settings.aquarisRecent.filter(i => i !== app.id)].slice(0, 6);
  store.set({ aquarisRecent: settings.aquarisRecent });
}

function openApp(app, opts = {}) {
  if (!opts.rect) noteRecent(app);
  if (SYSTEM[app.id]) return openSystem(app.id);
  if (app.id === "aeris" && !inShell) return showOrOpenAeris();
  if (app.own) return openOwnApp(app);
  if (onWeb && !app.frame && !inShell) { closeOverlays(); window.open(app.url, "_blank"); return null; }
  const open = wins.find(w => w.app.id === app.id && w.kind === "app");
  if (open) return restore(open), open;
  const win = makeWindow({ app, title: app.name, kind: "app", rect: opts.rect, state: opts.state === "max" ? "max" : "normal" });
  if (app.browser) addBrowserBar(win);
  if (opts.napped) nap(win);
  else loadApp(win);
  if (opts.state === "min" || opts.state === "min-max") {
    if (opts.state === "min-max") maximise(win, true);
    minimise(win);
  }
  saveLayout();
  return win;
}

function napCheck(force = false) {
  const after = settings.aquarisNapAfter;
  for (const w of wins) {
    if (w.kind !== "app" || !w.state.startsWith("min") || w.napped) continue;
    if (w.app.music || w.app.browser || settings.aquarisAwake.includes(w.app.id)) continue;
    if (force || (after && Date.now() - w.minimisedAt > after * 60000)) nap(w);
  }
}
setInterval(napCheck, 10000);

// ================= Aeris, inside Aquaris =================
// The Aeris app: back, forward, reload, home and an address bar above its page. Pages "for Aeris"
// (from the launcher's search, links from other places) open here.

function addBrowserBar(win) {
  const tb = html("div", "ab-bar");
  setHTML(tb, `<button class="ab-btn" data-a="back" title="Back (Alt+Left)">${icon("left")}</button>
    <button class="ab-btn" data-a="forward" title="Forward (Alt+Right)">${icon("right")}</button>
    <button class="ab-btn" data-a="reload" title="Reload (F5)">${icon("reload")}</button>
    <button class="ab-btn" data-a="home" title="Home">${icon("home")}</button>
    <label class="ab-url"><span class="ab-lock"></span><input spellcheck="false" placeholder="Search Google or type a web address"></label>
    ${AERIS_PANEL || inShell ? `<button class="ab-btn" data-a="customize" title="Customize Aeris: themes, colours and more">${icon("sliders")}</button>` : ""}`);
  win.body.before(tb);
  win.toolbar = tb;
  win.url = tb.querySelector("input");
  if (inShell) addTabs(win);
  tb.addEventListener("click", e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    const v = win.view;
    if (!a) return;
    if (win.napped) wake(win);
    if (!v) return;
    if (inShell && a === "customize") return toggleAerisCustomize(win);
    if (inShell) {
      const id = v.dataset.shell;
      if (a === "back" || a === "forward") shell.postMessage({ cmd: a, id });
      if (a === "reload") shell.postMessage({ cmd: viewLoading(v) ? "stop" : "reload", id });
      if (a === "home") shell.postMessage({ cmd: "go", id, url: aerisNewTab() });
      return;
    }
    if (a === "back" && v.canGoBack) v.goBack();
    if (a === "forward" && v.canGoForward) v.goForward();
    if (a === "reload") viewLoading(v) ? v.stop() : v.reload();
    if (a === "home") loadView(v, win.app.url);
    if (a === "customize") toggleCustomize(win);
  });
  win.url.addEventListener("focus", () => win.url.select());
  win.url.addEventListener("keydown", e => {
    if (e.key === "Enter" && win.url.value.trim() && win.view) {
      if (inShell) shell.postMessage({ cmd: "go", id: win.view.dataset.shell, url: fixup(win.url.value) });
      else loadView(win.view, fixup(win.url.value));
      win.url.blur();
    }
    if (e.key === "Escape") win.url.blur();
  });
}

// Aeris's own Customize panel (themes, accent, layout, notes…), opened as a drawer on the right
const AERIS_PANEL = NEW_TAB_URL.startsWith("moz-extension:") ? NEW_TAB_URL.replace(/newtab\/index\.html.*$/, "panel/index.html") : null;
function toggleCustomize(win) {
  if (!AERIS_PANEL) return;
  if (win.drawer) {
    const open = !win.el.classList.contains("drawer-open");
    win.el.classList.toggle("drawer-open", open);
    win.toolbar.querySelector('[data-a="customize"]').classList.toggle("on", open);
    return;
  }
  const v = makeView(AERIS_PANEL);
  v.classList.add("ab-drawer");
  v.fxrPermissionPrompt = undefined;
  win.body.append(v);
  loadView(v, AERIS_PANEL);
  win.drawer = v;
  win.el.classList.add("drawer-open");
  win.toolbar.querySelector('[data-a="customize"]').classList.add("on");
}

const isNewTab = url => !url || url === "about:blank" || url === "about:newtab" || url === NEW_TAB_URL || /^moz-extension:\/\/[^/]+\/newtab\//.test(url) || /\/aeris\/newtab\//.test(url);
function updateBrowserBar(win) {
  const v = win.view;
  if (!win.toolbar) return;
  const url = v ? viewUrl(v) : "";
  if (document.activeElement !== win.url) {
    const shown = isNewTab(url) ? "" : url;
    if (win.url.value !== shown) win.url.value = shown;
  }
  win.toolbar.querySelector(".ab-lock").classList.toggle("secure", url.startsWith("https:"));
  win.toolbar.querySelector('[data-a="back"]').disabled = !(v && (inChrome ? v.canGoBack : v.dataset.back === "1"));
  win.toolbar.querySelector('[data-a="forward"]').disabled = !(v && (inChrome ? v.canGoForward : v.dataset.forward === "1"));
  const t = (v && viewTitle(v)) || "Aeris";
  if (win.name.textContent !== t) win.name.textContent = t;
  if (win.tabs) drawTabs(win);
}

// ----- Tabs (Aeris in the iPad app) -----
function addTabs(win) {
  const strip = html("div", "ab-tabs");
  win.toolbar.before(strip);
  win.tabStrip = strip;
  win.tabs = [];
  win.el.classList.add("aeris-win");
  applyAerisLook(win);
}
function drawTabs(win) {
  if (win.view && !win.tabs.includes(win.view)) win.tabs.push(win.view);   // the first tab (loadApp made it)
  win.tabs = win.tabs.filter(v => v.isConnected);
  const strip = win.tabStrip;
  const key = win.tabs.map(v => v.dataset.shell + (v === win.view ? "*" : "") + viewTitle(v)).join("|");
  if (strip.dataset.key === key) return;
  strip.dataset.key = key;
  strip.textContent = "";
  win.tabs.forEach((v, i) => {
    const tab = html("div", "ab-tab" + (v === win.view ? " on" : ""));
    tab.setAttribute("role", "button");
    tab.append(html("span", "ab-tab-num", String(i + 1)));
    tab.append(html("span", "ab-tab-title", isNewTab(viewUrl(v)) ? "New Tab" : viewTitle(v) || viewUrl(v).replace(/^https?:\/\/(www\.)?/, "") || "New Tab"));
    const x = html("button", "ab-tab-x", "×");
    x.title = "Close tab";
    x.addEventListener("click", e => { e.stopPropagation(); closeTab(win, v); });
    tab.append(x);
    tab.addEventListener("click", () => switchTab(win, v));
    strip.append(tab);
  });
  const plus = html("button", "ab-tab-new", "+");
  plus.title = "New tab";
  plus.addEventListener("click", () => newTab(win));
  strip.append(plus);
}
function newTab(win, url = aerisNewTab()) {
  const v = makeView(url);
  win.body.prepend(v);
  win.tabs.push(v);
  loadView(v, url);
  switchTab(win, v);
  if (isNewTab(url)) setTimeout(() => win.url.focus(), 50);
}
function switchTab(win, v) {
  win.view = v;
  v.dataset.used = Date.now();
  for (const t of win.tabs) t.classList.toggle("tab-off", t !== v);
  cover(win, null);
  updateBrowserBar(win);
}
function closeTab(win, v) {
  const i = win.tabs.indexOf(v);
  win.tabs.splice(i, 1);
  v.remove();
  if (!win.tabs.length) return closeWin(win);
  if (win.view === v) switchTab(win, win.tabs[Math.max(0, i - 1)]);
  else updateBrowserBar(win);
}

// ----- Aeris's look and Customize panel (iPad app) -----
const aerisWins = () => wins.filter(w => w.el.classList.contains("aeris-win"));
function applyAerisLook(win) {
  const A = settings.aquarisAeris, el = win.el;
  for (const c of [...el.classList]) if (/^ab-(bars|shape|size|mod)-/.test(c)) el.classList.remove(c);
  el.classList.add("ab-bars-" + A.bars, "ab-shape-" + A.tabShape, "ab-size-" + A.size);
  for (const [k, on] of Object.entries(A.mods)) if (on) el.classList.add("ab-mod-" + k);
  // Where the tabs go: above or below the address bar, in the same row, or down a side
  const strip = win.tabStrip, bar = win.toolbar;
  if (A.bars === "under") bar.after(strip);
  else if (A.bars === "compact") bar.insertBefore(strip, bar.querySelector(".ab-url"));
  else if (A.bars === "left" || A.bars === "right") win.body.append(strip);
  else bar.before(strip);
  // The theme: Aero's frame driven by its colours, plus a custom theme's own frame styles
  // (themes/<id>/ipad-frame.css, made from its theme.css like Aeris on a computer)
  for (const c of [...el.classList]) if (c.startsWith("th-")) el.classList.remove(c);
  const th = themeById(A.theme);
  const custom = A.theme.startsWith("t:") ? A.theme.slice(2) : "";
  for (const k of ["--ab-frame-a", "--ab-frame-b", "--ab-accent", "--ab-text", "--ab-text-shadow"]) el.style.removeProperty(k);
  if (th) {
    el.style.setProperty("--ab-frame-a", th.a);
    el.style.setProperty("--ab-frame-b", th.b);
    el.style.setProperty("--ab-accent", th.accent);
    if (th.light && !custom) { el.style.setProperty("--ab-text", "#123a5c"); el.style.setProperty("--ab-text-shadow", "0 1px 0 rgba(255, 255, 255, 0.6)"); }
  }
  if (custom) {
    el.classList.add("th-" + custom);
    if (!document.querySelector(`link[data-ipad-theme="${custom}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `../themes/${custom}/ipad-frame.css`;
      link.dataset.ipadTheme = custom;
      document.head.append(link);
    }
  }
  el.style.removeProperty("--ab-picked");
  if (A.accent) { el.style.setProperty("--ab-accent", A.accent); el.style.setProperty("--ab-picked", A.accent); }
  // Shine: the theme's own amount, scaled by the slider (50 = as the theme made it)
  el.style.setProperty("--shine", String(A.gloss / 50));
  shellSync();
}
async function saveAeris(changes) {
  const before = settings.aquarisAeris;
  settings.aquarisAeris = { ...before, ...changes, mods: { ...before.mods, ...changes.mods } };
  await store.set({ aquarisAeris: settings.aquarisAeris });
  for (const w of aerisWins()) {
    applyAerisLook(w);
    if (changes.theme !== undefined || changes.ntZoom !== undefined) {
      // New Tab pages that are showing pick up the new theme and widget size
      for (const v of w.tabs || []) if (isNewTab(viewUrl(v))) shell.postMessage({ cmd: "go", id: v.dataset.shell, url: aerisNewTab() });
    }
    w.custom?.sync();
  }
}
function toggleAerisCustomize(win) {
  if (!win.custom) {
    const box = html("aside", "ab-custom");
    const A = () => settings.aquarisAeris;
    const choice = (key, items) => `<div class="ab-choice" data-key="${key}">${items.map(([v, label]) => `<button data-v="${v}">${label}</button>`).join("")}</div>`;
    const MODS = [["shell", "Aeris toolbar: the glossy back and forward capsule"], ["floating", "Floating page: websites sit in a rounded card"], ["motion", "Motion: tabs bubble in, buttons squish"],
      ["hoverClose", "Close buttons only on the open tab"], ["centerTitles", "Tab titles in the middle"], ["tabNumbers", "Numbers on tabs"], ["bigTabs", "Bigger tabs"]];
    setHTML(box, `<div class="ab-custom-head"><b>Customize</b><button class="ab-btn" data-a="close" title="Close">${icon("close")}</button></div>
      <div class="ab-custom-scroll">
        <h4>Theme</h4><div class="ab-themes"></div>
        <label class="ab-row">Accent colour <input type="color" class="ab-accent"><button class="btn tiny" data-a="accentReset">Theme colour</button></label>
        <label class="ab-row">Shine <input type="range" min="0" max="100" class="ab-gloss"></label>
        <h4>Layout</h4>
        <span class="ab-label">Tabs</span>${choice("bars", [["top", "Top"], ["compact", "Compact"], ["under", "Under"], ["left", "Left"], ["right", "Right"]])}
        <span class="ab-label">Tab shape</span>${choice("tabShape", [["rounded", "Rounded"], ["pill", "Bubble"], ["square", "Square"]])}
        <span class="ab-label">Size</span>${choice("size", [["comfy", "Comfy"], ["compact", "Compact"]])}
        <h4>Aeris Mods</h4>
        ${MODS.map(([k, label]) => `<label class="ab-toggle"><input type="checkbox" data-mod="${k}"> ${label}</label>`).join("")}
        <h4>New Tab</h4>
        <label class="ab-row">Widget size <input type="range" min="50" max="100" step="5" class="ab-ntzoom"><span class="ab-ntzoom-n"></span></label>
        <p class="hint">Drag widgets with a finger to move them. The ⚙ on the New Tab has its wallpapers and which widgets show.</p>
      </div>`);
    const grid = box.querySelector(".ab-themes");
    for (const th of [{ id: "", name: "Aeris", a: "#e8f1fa", b: "#cfe0f0" }, ...aerisThemes]) {
      const b = html("button", "ab-theme");
      b.dataset.v = th.id;
      b.style.setProperty("--a", th.a);
      b.style.setProperty("--b", th.b);
      b.append(html("span", "ab-theme-swatch"), html("span", "ab-theme-name", th.name));
      grid.append(b);
    }
    box.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.a === "close") return toggleAerisCustomize(win);
      if (btn.dataset.a === "accentReset") return saveAeris({ accent: "" });
      if (btn.classList.contains("ab-theme")) return saveAeris({ theme: btn.dataset.v });
      const group = btn.closest(".ab-choice");
      if (group) saveAeris({ [group.dataset.key]: btn.dataset.v });
    });
    box.querySelector(".ab-accent").addEventListener("input", e => saveAeris({ accent: e.target.value }));
    box.querySelector(".ab-gloss").addEventListener("input", e => saveAeris({ gloss: +e.target.value }));
    box.querySelector(".ab-ntzoom").addEventListener("change", e => saveAeris({ ntZoom: +e.target.value }));
    box.querySelector(".ab-ntzoom").addEventListener("input", e => (box.querySelector(".ab-ntzoom-n").textContent = e.target.value + "%"));
    box.addEventListener("change", e => { const k = e.target.dataset.mod; if (k) saveAeris({ mods: { [k]: e.target.checked } }); });
    win.custom = {
      box,
      sync() {
        const s = A();
        box.querySelectorAll(".ab-theme").forEach(b => b.classList.toggle("on", b.dataset.v === s.theme));
        box.querySelectorAll(".ab-choice").forEach(g => g.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === s[g.dataset.key])));
        box.querySelectorAll("[data-mod]").forEach(c => (c.checked = !!s.mods[c.dataset.mod]));
        box.querySelector(".ab-accent").value = /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : (themeById(s.theme)?.accent || "#2a86e8");
        box.querySelector(".ab-gloss").value = s.gloss;
        box.querySelector(".ab-ntzoom").value = s.ntZoom;
        box.querySelector(".ab-ntzoom-n").textContent = s.ntZoom + "%";
      }
    };
    win.body.append(box);
    win.custom.sync();
  }
  const open = !win.el.classList.contains("ab-custom-open");
  win.el.classList.toggle("ab-custom-open", open);
  win.toolbar.querySelector('[data-a="customize"]')?.classList.toggle("on", open);
  shellSync();
}

// A web page from elsewhere in Aquaris: a new tab in Aeris (opening Aeris if it isn't open)
function openInAerisTab(url) {
  const win = wins.find(w => w.app.id === "aeris" && w.kind === "app");
  if (!win) return openApp({ ...AERIS_APP, url });
  restore(win);
  newTab(win, url);
}
setInterval(() => { for (const w of wins) if (w.toolbar) updateBrowserBar(w); }, 500);

// ================= The real Aeris, linked to Aquaris =================
// The Aeris icon opens a real Aeris window: everything Aeris has (tabs, the side panel, Quick
// Commands, spaces, themes…), running on the same engine. It's linked to Aquaris: when Aquaris is
// minimised it minimises too, when Aquaris comes back so does it, and it closes with Aquaris. When
// you minimise or close Aeris, Aquaris carries on.

const aerisWindows = () => (inChrome ? [...Services.wm.getEnumerator("navigator:browser")].filter(w => !w.closed && w.aquarisLinked) : []);
const aerisFront = w => Services.focus.activeWindow === w && w.windowState !== w.STATE_MINIMIZED;
const aerisTitle = w => w.gBrowser?.selectedTab?.label || "Aeris";

function openAerisWindow(urls = []) {
  closeOverlays();
  if (!inChrome) return window.open(urls[0] || AERIS_APP.url, "_blank");
  const args = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
  // Aeris's own New Tab (looked up now: Aeris Core sets it once it has started)
  let newTab = "about:newtab";
  try { newTab = ChromeUtils.importESModule("resource:///modules/AboutNewTab.sys.mjs").AboutNewTab.newTabURL || newTab; } catch {}
  args.data = urls.length ? urls.join("|") : newTab;
  // "dependent": the window belongs to Aquaris's window (it stays on top of Aquaris and goes with it)
  const w = Services.ww.openWindow(window, "chrome://browser/content/browser.xhtml", "_blank", "chrome,all,dialog=no,dependent", args);
  w.aquarisLinked = true;
  w.aquarisUsed = Date.now();
  w.addEventListener("activate", () => (w.aquarisUsed = Date.now()));
  w.addEventListener("load", () => {
    // Part of Aquaris on the taskbar: same group and icon as Aquaris
    if (Services.appinfo.OS === "WINNT") {
      try { Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar).setGroupIdForWindow(w, "Aeris.Aquaris"); } catch {}
    }
    placeAeris(w, false);
    // Maximising fills the Aquaris desktop (between the top bar and the dock), not the whole screen
    w.addEventListener("sizemodechange", () => {
      if (w.windowState === w.STATE_MAXIMIZED && !w.fullScreen) setTimeout(() => { w.restore(); placeAeris(w, true); }, 0);
    });
    noteRecent(AERIS_APP);
    drawDock();
  }, { once: true });
  return w;
}
// Put an Aeris window over the Aquaris desktop (fill = the whole desktop area)
function placeAeris(w, fill) {
  const d = deskRect(), room = d.height - dockSpace();
  const W = fill ? d.width : Math.min(1280, d.width - 80), H = fill ? room : Math.min(840, room - 40);
  w.resizeTo(W, H);
  w.moveTo(mozInnerScreenX + d.left + (fill ? 0 : (d.width - W) / 2), mozInnerScreenY + d.top + (fill ? 0 : Math.max(12, (room - H) / 2)));
  w.aquarisFilled = fill;
}
function showAeris(w) {
  if (w.windowState === w.STATE_MINIMIZED) w.restore();
  w.focus();
}
// The dock's Aeris icon: open Aeris, or bring it up / put it away
function showOrOpenAeris() {
  if (inShell) return openApp(AERIS_APP);
  const list = aerisWindows();
  if (!list.length) return openAerisWindow();
  const w = list[list.length - 1];
  aerisFront(w) ? w.minimize() : showAeris(w);
  setTimeout(drawDock, 250);
}
// Pages for Aeris: new tabs in the Aeris window (or a new Aeris window)
function openInAeris(urls) {
  closeOverlays();
  urls = [].concat(urls).filter(Boolean);
  const w = aerisWindows().pop();
  if (!w) return openAerisWindow(urls);
  for (const u of urls) w.openTrustedLinkIn(u, "tab");
  showAeris(w);
  return w;
}

// The link: Aeris follows Aquaris (minimise, come back, close)
if (inChrome) {
  addEventListener("sizemodechange", () => {
    const minimised = window.windowState === window.STATE_MINIMIZED;
    for (const w of aerisWindows()) {
      if (minimised && w.windowState !== w.STATE_MINIMIZED) { w.aquarisHid = true; w.minimize(); }
      if (!minimised && w.aquarisHid) { w.aquarisHid = false; w.restore(); }
    }
  });
  addEventListener("unload", () => { for (const w of aerisWindows()) w.close(); });
  // Keep the dock up to date as Aeris windows open, close, or change page
  let seen = "";
  setInterval(() => {
    const now = aerisWindows().map(w => aerisTitle(w) + (aerisFront(w) ? "*" : "") + w.windowState).join("|");
    if (now !== seen) { seen = now; drawDock(); drawTopApp(); }
  }, 600);
}

// Keyboard shortcuts for the Aeris window in front
document.addEventListener("keydown", e => {
  const win = activeWin();
  if (!win?.toolbar || !isFront(win)) return;
  const v = win.view, ctrl = e.ctrlKey || e.metaKey;
  let done = true;
  if (ctrl && e.key.toLowerCase() === "l") win.url.focus();
  else if (e.key === "F5" || (ctrl && e.key.toLowerCase() === "r")) v?.reload();
  else if (e.altKey && e.key === "ArrowLeft" && v?.canGoBack) v.goBack();
  else if (e.altKey && e.key === "ArrowRight" && v?.canGoForward) v.goForward();
  else if (e.altKey && e.key === "Home" && v) loadView(v, win.app.url);
  else done = false;
  if (done) e.preventDefault();
});

// ================= Links that open a new window =================
// When a page in an app opens something "in a new window" (a Canva design, a Gmail attachment), it
// opens in that app's own window instead, replacing what was there. Pop-up windows (like sign-in
// windows) aren't asked here; they stay pop-ups.

function viewWindow(view) {
  return wins.find(w => w.view === view);
}
function openFromApp(uri, params, skipLoad) {
  const win = viewWindow(params?.openerBrowser);
  if (!win || win.kind !== "app") {
    if (uri) openInAeris([uri.spec]);
    return null;
  }
  const opener = params.openerBrowser;
  const v = makeView(uri?.spec || "about:blank");
  v.setAttribute("remoteType", opener.remoteType || "web");
  if (params.openWindowInfo) v.openWindowInfo = params.openWindowInfo;
  win.view.replaceWith(v);
  win.view = v;
  win.loadedOnce = true;
  if (!skipLoad && uri) v.loadURI(uri, { triggeringPrincipal: params.triggeringPrincipal || ALL_PRINCIPAL(), referrerInfo: params.referrerInfo });
  restore(win);
  return v;
}
if (inChrome) {
  window.browserDOMWindow = {
    QueryInterface: ChromeUtils.generateQI(["nsIBrowserDOMWindow"]),
    createContentWindowInFrame: (uri, params) => openFromApp(uri, params, true),
    openURIInFrame: (uri, params) => openFromApp(uri, params, false),
    createContentWindow: () => null,
    openURI(uri) { if (uri) openInAeris([uri.spec]); return null; },
    canClose: () => true,
    get tabCount() { return 1; }
  };
}

// ================= Right-click menus on web pages =================
// When you right-click a page in an app (or Aeris), the engine asks this window to show its menu;
// Aquaris draws its own: page, link, picture, selected text and text-box choices.

const clipboard = text => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
function webMenu() {
  const data = window.nsContextMenu.contentData;
  if (!data) return;
  const { context: c, browser: view, actor } = data;
  const win = wins.find(w => w.view === view || w.drawer === view);
  const sel = (data.selectionInfo?.fullText || "").trim();
  const items = [];
  const short = s => (s.length > 24 ? s.slice(0, 24) + "…" : s);
  if (c.onLink && c.linkURL) {
    items.push(["Open link here", () => loadView(view, c.linkURL)]);
    if (!win?.app.browser) items.push(["Open link in Aeris", () => openInAeris([c.linkURL])]);
    items.push(["Copy link", () => clipboard(c.linkURL)], null);
  }
  if (c.onImage && c.mediaURL) {
    items.push(["Open picture in Aeris", () => openInAeris([c.mediaURL])], ["Copy picture link", () => clipboard(c.mediaURL)], null);
  }
  if (c.onEditable) {
    items.push(["Cut", () => windowUtils.sendContentCommandEvent("cut")], ["Copy", () => windowUtils.sendContentCommandEvent("copy")],
      ["Paste", () => windowUtils.sendContentCommandEvent("paste")], null);
  } else if (sel) {
    items.push(["Copy", () => clipboard(sel)], [`Search Google for “${short(sel)}”`, () => openInAeris([webSearchUrl(sel)])], null);
  }
  if (!c.onLink && !c.onImage && !c.onEditable && !sel) {
    items.push(["Back", () => view.canGoBack && view.goBack()], ["Forward", () => view.canGoForward && view.goForward()], ["Reload", () => view.reload()], null);
    if (win && !win.app.browser && view === win.view) items.push(["Open this page in Aeris", () => openInAeris([viewUrl(view)])]);
    items.push(["Copy page address", () => clipboard(viewUrl(view))]);
    if (win?.app.browser && AERIS_PANEL) items.push(null, ["Customize Aeris…", () => toggleCustomize(win)]);
  }
  while (items.length && !items[items.length - 1]) items.pop();
  const x = (c.screenXDevPx / devicePixelRatio) - mozInnerScreenX, y = (c.screenYDevPx / devicePixelRatio) - mozInnerScreenY;
  showMenu({ clientX: x, clientY: y }, items);
  // Tell the page when the menu goes away
  const done = () => { try { actor.hiding(); } catch {} };
  new MutationObserver((_, obs) => { if ($("#menu").hidden) { obs.disconnect(); done(); } }).observe($("#menu"), { attributes: true, attributeFilter: ["hidden"] });
}
if (inChrome) {
  // What the engine looks for in a window to show a page's right-click menu
  window.nsContextMenu = { contentData: null };
  const hook = html("div");
  hook.id = "contentAreaContextMenu";
  hook.hidden = true;
  hook.openPopupAtScreen = () => setTimeout(webMenu, 0);
  document.body.append(hook);
}

// ================= Permissions =================
// When an app wants the camera, the microphone, notifications or your location, Aquaris asks you
// in that app's window. "Remember" keeps the answer for that website.

const PERMISSION_WORDS = {
  camera: "camera", microphone: "microphone", "desktop-notification": "send you notifications",
  geolocation: "know your location", "persistent-storage": "keep its data on this computer",
  "screen-wake-lock": "keep the screen on", midi: "use MIDI devices", "storage-access": "use its cookies here"
};
const siteName = principal => { try { return principal.host || principal.origin; } catch { return "This site"; } };

function askPermission(view, request) {
  const win = wins.find(w => w.view === view);
  const { perms } = Services;
  // Notifications, location and the rest
  if (request instanceof Ci.nsIContentPermissionRequest) {
    const types = request.types.QueryInterface(Ci.nsIArray);
    const type = types.length === 1 ? types.queryElementAt(0, Ci.nsIContentPermissionType).type : null;
    if (!type) return request.cancel();
    const stored = perms.testExactPermissionFromPrincipal(request.principal, type);
    if (stored === perms.ALLOW_ACTION) return request.allow();
    if (stored === perms.DENY_ACTION) return request.cancel();
    const want = PERMISSION_WORDS[type] || `use "${type}"`;
    return showAsk(win, `${siteName(request.principal)} wants to ${want}`, (allowed, remember) => {
      if (remember) perms.addFromPrincipal(request.principal, type, allowed ? perms.ALLOW_ACTION : perms.DENY_ACTION);
      allowed ? request.allow() : request.cancel();
    });
  }
  // Camera and microphone
  const send = (message, data = {}) => view.sendMessageToActor(message, { callID: request.callID, windowID: request.windowID, ...data }, "WebRTC");
  const types = request.requestTypes || [];
  if (types.some(t => !["Camera", "Microphone", "AudioCapture"].includes(t))) return send("webrtc:Deny"); // (sharing the screen isn't ready yet)
  const audio = request.audioInputDevices || request.audioDevices || [];
  const video = request.videoInputDevices || request.videoDevices || [];
  const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin(request.origin);
  const need = [...(video.length ? ["camera"] : []), ...(audio.length ? ["microphone"] : [])];
  const allow = () => {
    const devices = [];
    if (audio.length) devices.push(audio[0].deviceIndex);
    if (video.length) {
      perms.addFromPrincipal(principal, "MediaManagerVideo", perms.ALLOW_ACTION, perms.EXPIRE_SESSION);
      devices.push(video[0].deviceIndex);
    }
    send("webrtc:Allow", { devices });
  };
  const stored = need.map(n => perms.testExactPermissionFromPrincipal(principal, n));
  if (need.length && stored.every(s => s === perms.ALLOW_ACTION)) return allow();
  if (!need.length || stored.some(s => s === perms.DENY_ACTION)) return send("webrtc:Deny");
  showAsk(win, `${siteName(principal)} wants to use your ${need.join(" and ")}`, (allowed, remember) => {
    if (remember) for (const n of need) perms.addFromPrincipal(principal, n, allowed ? perms.ALLOW_ACTION : perms.DENY_ACTION);
    allowed ? allow() : send("webrtc:Deny");
  });
}

// A small question card inside the app's window (or in the middle of the desktop)
function showAsk(win, text, answer) {
  if (win) restore(win);
  const box = html("div", "ask");
  setHTML(box, `<div class="ask-card" role="alertdialog">
      <b class="ask-text"></b>
      <label class="ask-remember"><input type="checkbox" checked> Remember for this site</label>
      <div class="ask-buttons"><button class="btn" data-a="block">Block</button><button class="btn primary" data-a="allow">Allow</button></div>
    </div>`);
  box.querySelector(".ask-text").textContent = text;
  box.addEventListener("click", e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    box.remove();
    answer(a === "allow", box.querySelector("input").checked);
  });
  (win ? win.body : $("#desktop")).append(box);
  box.querySelector('[data-a="allow"]').focus();
}

// Loading covers on apps disappear once the app has loaded
setInterval(() => {
  for (const w of wins) {
    if (w.kind === "app" && w.view && inChrome && !w.loadedOnce && !viewLoading(w.view) && viewUrl(w.view) !== "about:blank") {
      w.loadedOnce = true;
      cover(w, null);
    }
  }
}, 500);

// ================= Dock =================

function dockItem(app, label) {
  const b = html("button", "dock-item");
  b.append(tile(app));
  b.dataset.label = label || app.name;
  b.setAttribute("aria-label", label || app.name);
  return b;
}

function drawDock() {
  const bar = $("#dockApps");
  if (!bar) return;
  bar.textContent = "";
  // Aeris first
  const aw = aerisWindows();
  const ab = dockItem(AERIS_APP, aw.length ? aerisTitle(aw[aw.length - 1]) : "Aeris");
  ab.dataset.app = "aeris";
  ab.classList.toggle("running", aw.length > 0);
  ab.classList.toggle("front", aw.some(aerisFront));
  ab.addEventListener("click", showOrOpenAeris);
  ab.addEventListener("contextmenu", e => {
    e.preventDefault();
    showMenu(e, [["New Aeris window", () => openAerisWindow()], ...(aw.length ? [null] : []), ...aw.map(w => [aerisTitle(w), () => showAeris(w)]), ...(aw.length ? [null, ["Close Aeris", () => aw.forEach(w => w.close())]] : [])]);
  });
  // In the iPad app, Aeris is a window inside Aquaris: its dock icon shows and switches that window
  const shellAeris = inShell ? wins.find(w => w.app.id === "aeris" && w.kind === "app") : null;
  if (inShell) {
    ab.classList.toggle("running", !!shellAeris);
    ab.classList.toggle("front", !!shellAeris && isFront(shellAeris));
    const fresh = ab.cloneNode(true);       // without the computer version's click and menu
    fresh.addEventListener("click", () => (!shellAeris ? openApp(AERIS_APP) : isFront(shellAeris) ? minimise(shellAeris) : restore(shellAeris)));
    fresh.addEventListener("contextmenu", e => {
      e.preventDefault();
      showMenu(e, shellAeris ? [["New tab", () => { restore(shellAeris); newTab(shellAeris); }], null, ["Close Aeris", () => closeWin(shellAeris)]] : [["Open Aeris", () => openApp(AERIS_APP)]]);
    });
    bar.append(fresh);
  } else bar.append(ab);
  const apps = settings.aquarisPinned.filter(id => id !== "aeris").map(appById).filter(Boolean);
  for (const w of wins) if ((w.kind === "app" || w.kind === "own") && w.app.id !== "aeris" && !apps.includes(w.app)) apps.push(w.app);
  for (const app of apps) {
    const win = wins.find(w => w.app.id === app.id && w.kind !== "native");
    const b = dockItem(app, app.name + (win?.napped ? " (napping)" : ""));
    b.dataset.app = app.id;
    b.classList.toggle("running", !!win);
    b.classList.toggle("front", !!win && isFront(win));
    b.classList.toggle("napping", !!win?.napped);
    b.addEventListener("click", () => {
      if (!win) return openApp(app);
      isFront(win) ? minimise(win) : restore(win);
    });
    b.addEventListener("contextmenu", e => { e.preventDefault(); appMenu(e, app, win); });
    bar.append(b);
  }
  for (const w of wins.filter(w => w.kind === "native")) {
    const b = dockItem(w.app, w.app.name);
    b.dataset.app = w.app.id;
    b.classList.add("running");
    b.classList.toggle("front", isFront(w));
    b.addEventListener("click", () => (isFront(w) ? minimise(w) : restore(w)));
    bar.append(b);
  }
}

function appMenu(e, app, win) {
  win ??= wins.find(w => w.app.id === app.id && w.kind !== "native");
  const pinned = settings.aquarisPinned.includes(app.id);
  const awake = settings.aquarisAwake.includes(app.id);
  const onDesktop = !settings.aquarisHidden.includes(app.id);
  const items = [[win ? "Show" : "Open", () => openApp(app)]];
  if (app.url && app.id !== "aeris" && !onWeb) items.push(["Open in Aeris", () => openInAeris([app.url])]);
  items.push(null, [onDesktop ? "Remove app" : "Show on desktop", () => save({ aquarisHidden: onDesktop ? [...settings.aquarisHidden, app.id] : settings.aquarisHidden.filter(i => i !== app.id) })]);
  if (app.id !== "aeris") items.push([pinned ? "Remove from the dock" : "Keep in the dock", () => save({ aquarisPinned: pinned ? settings.aquarisPinned.filter(i => i !== app.id) : [...settings.aquarisPinned, app.id] })]);
  if (app.url && !app.music && (!onWeb || app.frame)) items.push([awake ? "Let it nap when hidden" : "Never nap this app", () => save({ aquarisAwake: awake ? settings.aquarisAwake.filter(i => i !== app.id) : [...settings.aquarisAwake, app.id] })]);
  if (win && !win.napped) items.push(["Nap now", () => { if (!win.state.startsWith("min")) minimise(win); nap(win); }]);
  if (settings.aquarisApps.some(a => a.id === app.id)) items.push(null, ["Change name or icon", () => openAddApp(settings.aquarisApps.find(a => a.id === app.id))], ["Delete app", () => removeApp(app)]);
  else if (app.id !== "aeris" && app.id !== "aquaapps") items.push(null, ["Delete app", () => uninstall(app)]);
  if (win) items.push(null, ["Close", () => closeWin(win)]);
  showMenu(e, items);
}

function showMenu(e, items) {
  const m = $("#menu");
  m.textContent = "";
  for (const it of items) {
    if (!it) { m.append(html("hr")); continue; }
    const b = html("button", "", it[0]);
    b.addEventListener("click", () => { m.hidden = true; it[1](); });
    m.append(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
  m.style.top = Math.max(6, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
}

// Right-click the dock (not an app): dock settings, task manager, show the desktop
$("#dock").addEventListener("contextmenu", e => {
  if (e.target.closest("#dockApps .dock-item")) return;
  e.preventDefault();
  const anyOpen = wins.some(w => !w.state.startsWith("min"));
  showMenu(e, [
    ["Task manager", () => toggleOverlay("#tasks", true)],
    [anyOpen ? "Show the desktop" : "Bring windows back", () => {
      const open = wins.filter(w => !w.state.startsWith("min"));
      if (open.length) { showDesktopPeek = open; open.forEach(minimise); }
      else { showDesktopPeek.filter(w => wins.includes(w)).forEach(restore); showDesktopPeek = []; }
    }],
    null,
    ["Dock and desktop settings…", () => openSystem("settings")]
  ]);
});
let showDesktopPeek = [];

// ================= Top bar =================

// ================= Menu bar (like a Mac's) =================
// The drop is the Aquaris menu; next to it, the app in front's name and its File, Edit, View, Window
// and Help menus. Once a menu is open, pointing at another title opens that one.

function frontTarget() {
  if (aerisWindows().some(aerisFront)) return { kind: "aeris", name: "Aeris" };
  const w = activeWin();
  return w && w.el.classList.contains("active") ? { kind: "win", win: w, name: w.app.name } : { kind: "desktop", name: "Desktop" };
}
let menuKey = "";
function drawTopApp() {
  const f = frontTarget();
  const key = f.kind + ":" + f.name;
  $("#tbApp").textContent = f.name;
  if (key === menuKey) return;
  menuKey = key;
  const bar = $("#tbMenus");
  bar.textContent = "";
  for (const [title, cls] of [[f.name, "tb-appname"], ["File"], ["Edit"], ["View"], ["Window"], ["Help"]]) {
    const b = html("button", "tb-btn tb-menu" + (cls ? " " + cls : ""), title);
    b.dataset.menu = title === f.name ? "app" : title.toLowerCase();
    bar.append(b);
  }
}
const ctrl = k => (onMac ? `⌘${k}` : `Ctrl+${k}`);
// What the focused web page (or Aquaris page) should do for Edit commands
function editCommand(cmd) {
  const f = frontTarget();
  const view = f.win?.view;
  if (view && inChrome) { view.focus(); windowUtils.sendContentCommandEvent(cmd); return; }
  document.execCommand(cmd === "selectAll" ? "selectAll" : cmd);
}
function zoom(step) {
  const v = frontTarget().win?.view;
  if (!v?.browsingContext) return;
  v.browsingContext.fullZoom = step === 0 ? 1 : Math.max(0.3, Math.min(3, Math.round((v.browsingContext.fullZoom + step) * 10) / 10));
}
function menuItems(name) {
  const f = frontTarget(), w = f.win;
  const aeris = aerisWindows().pop();
  const recent = settings.aquarisRecent.map(appById).filter(Boolean).slice(0, 5);
  const close = () => (f.kind === "aeris" ? aeris?.close() : w && closeWin(w));
  const minimiseFront = () => (f.kind === "aeris" ? aeris?.minimize() : w && minimise(w));
  switch (name) {
    case "aquaris": return [
      ["About This Aquaris", () => openSystem("about")],
      null,
      ["System Settings…", () => openSystem("settings")],
      ["AquaApps…", () => openApp(appById("aquaapps"))],
      null,
      ...(recent.length ? [["Recent Apps", null], ...recent.map(a => ["   " + a.name, () => openApp(a)])] : []),
      ...(recent.length ? [null] : []),
      ["Force Quit…", () => toggleOverlay("#tasks", true), "Ctrl+Alt+Esc"],
      null,
      ["Nap All Apps", () => { for (const x of wins.filter(x => x.kind === "app" && !x.app.music)) nap(x); updateRam(); }],
      ["Lock Screen", lockScreen, "Ctrl+Alt+L"],
      null,
      ["Restart Aquaris", () => (inChrome ? Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart) : location.reload())],
      ["Shut Down…", async () => { if (await askYes($("#desktop"), "Shut down Aquaris?")) shutDown(); }]
    ];
    case "app": return f.kind === "desktop" ? [
      ["About Aquaris", () => openSystem("about")],
      null,
      ["Settings…", () => openSystem("settings"), "Ctrl+,"],
      ["Show Desktop Icons", () => save({ aquarisDesktopIcons: !settings.aquarisDesktopIcons }), settings.aquarisDesktopIcons ? "✓" : ""],
      null,
      ["Hide All Windows", () => wins.filter(x => !x.state.startsWith("min")).forEach(minimise)]
    ] : [
      [`About ${f.name}`, () => alertIn($("#desktop"), `${f.name}${w?.app.about ? " — " + w.app.about : ""}${w?.app.url ? "\n" + w.app.url : ""}`)],
      null,
      [`Hide ${f.name}`, minimiseFront, ctrl("H")],
      ["Hide Others", () => wins.filter(x => x !== w && !x.state.startsWith("min")).forEach(minimise)],
      ["Show All", () => wins.filter(x => x.state.startsWith("min")).forEach(restore)],
      null,
      [`Quit ${f.name}`, close, ctrl("Q")]
    ];
    case "file": return [
      ["Spotlight…", () => toggleOverlay("#spotlight", true), "Ctrl+Space"],
      ["All Apps", () => toggleOverlay("#launcher", true)],
      ["Add an App…", () => openSystem("add")],
      null,
      ...(w?.view ? [["Reload Page", () => w.view.reload(), ctrl("R")], ["Open in Aeris", () => openInAeris([viewUrl(w.view)])], null] : []),
      ...(f.kind === "aeris" ? [["New Aeris Window", () => openAerisWindow(), ctrl("N")], null] : []),
      ["Open Files", () => openApp(appById("files"))],
      null,
      ["Close Window", close, ctrl("W")]
    ];
    case "edit": return [
      ["Undo", () => editCommand("undo"), ctrl("Z")],
      ["Redo", () => editCommand("redo"), ctrl("Y")],
      null,
      ["Cut", () => editCommand("cut"), ctrl("X")],
      ["Copy", () => editCommand("copy"), ctrl("C")],
      ["Paste", () => editCommand("paste"), ctrl("V")],
      ["Select All", () => editCommand("selectAll"), ctrl("A")]
    ];
    case "view": return [
      ["Zoom In", () => zoom(0.1), ctrl("+")],
      ["Zoom Out", () => zoom(-0.1), ctrl("-")],
      ["Actual Size", () => zoom(0), ctrl("0")],
      null,
      [isFullscreen() ? "Exit Full Screen" : "Enter Full Screen", toggleFullscreen, "F11"],
      [settings.aquarisDesktopIcons ? "Hide Desktop Icons" : "Show Desktop Icons", () => save({ aquarisDesktopIcons: !settings.aquarisDesktopIcons })]
    ];
    case "window": return [
      ["Minimise", minimiseFront, ctrl("M")],
      ["Zoom", () => (w ? maximise(w) : aeris && (aeris.windowState === aeris.STATE_MAXIMIZED ? aeris.restore() : aeris.maximize()))],
      ["Tile Window to Left of Screen", () => w && splitScreen(w, "left")],
      ["Tile Window to Right of Screen", () => w && splitScreen(w, "right")],
      null,
      ["Bring All to Front", () => wins.forEach(restore)],
      ...(wins.length || aerisWindows().length ? [null] : []),
      ...wins.map(x => [(x === w ? "✓ " : "   ") + x.name.textContent, () => restore(x)]),
      ...aerisWindows().map(x => ["   " + aerisTitle(x), () => showAeris(x)])
    ];
    case "help": return [
      ["Aquaris Tips", () => openSystem("about")],
      ["Search the Web for Help…", () => { toggleOverlay("#spotlight", true); }]
    ];
  }
  return [];
}
let mbOpen = null;
function openMenuBar(button) {
  const m = $("#mbMenu");
  const name = button.dataset.menu || "aquaris";
  m.textContent = "";
  for (const it of menuItems(name)) {
    if (!it) { m.append(html("hr")); continue; }
    const [label, fn, keys] = it;
    const b = html("button", fn ? "" : "mb-head");
    b.append(html("span", "", label.trim()));
    if (label.startsWith("   ")) b.classList.add("mb-sub");
    if (keys) b.append(html("kbd", "", keys));
    if (fn) b.addEventListener("click", () => { closeMenuBar(); fn(); });
    else b.disabled = true;
    m.append(b);
  }
  const r = button.getBoundingClientRect();
  m.hidden = false;
  m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 6) + "px";
  m.style.top = r.bottom + 2 + "px";
  document.querySelectorAll("#topbar .open").forEach(x => x.classList.remove("open"));
  button.classList.add("open");
  mbOpen = button;
}
function closeMenuBar() {
  $("#mbMenu").hidden = true;
  mbOpen?.classList.remove("open");
  mbOpen = null;
}
$("#topbar").addEventListener("click", e => {
  const b = e.target.closest("#tbLauncher, .tb-menu");
  if (!b) return;
  if (mbOpen === b) return closeMenuBar();
  closeOverlays();
  openMenuBar(b);
});
$("#topbar").addEventListener("mouseover", e => {
  const b = e.target.closest("#tbLauncher, .tb-menu");
  if (b && mbOpen && b !== mbOpen) openMenuBar(b);
});
document.addEventListener("pointerdown", e => { if (mbOpen && !e.target.closest("#mbMenu, #tbLauncher, .tb-menu")) closeMenuBar(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && mbOpen) closeMenuBar();
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "l") { e.preventDefault(); lockScreen(); }
  if (e.ctrlKey && e.altKey && e.key === "Escape") { e.preventDefault(); toggleOverlay("#tasks", true); }
});

// Lock screen: a curtain with the time, until you click or press a key
function lockScreen() {
  const l = $("#lock");
  const draw = () => {
    const now = new Date();
    l.querySelector(".lock-time").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    l.querySelector(".lock-date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  };
  draw();
  const timer = setInterval(draw, 5000);
  l.hidden = false;
  const unlock = () => { l.hidden = true; clearInterval(timer); removeEventListener("keydown", unlock, true); };
  l.addEventListener("click", unlock, { once: true });
  setTimeout(() => addEventListener("keydown", unlock, true), 300);
}

// Status icons on the right: Wi-Fi, Bluetooth, battery, sound (from Windows, every half minute)
async function drawStatus() {
  if (!hasSystem) { for (const id of ["#tbWifi", "#tbBt", "#tbVol"]) $(id).hidden = true; return; }
  try {
    const soft = p => p.catch(() => null);
    const [r, now, vol, batt] = await Promise.all([soft(system("radios")).then(x => x || []), soft(system("wifiNow")).then(x => x || { state: "", ssid: "" }), soft(system("getVolume")), soft(system("battery"))]);
    $("#tbVol").hidden = !vol;
    const on = Object.fromEntries(r.map(x => [x.kind, x.state === "On"]));
    $("#tbWifi").hidden = !("WiFi" in on);
    $("#tbWifi").classList.toggle("off", !on.WiFi || now.state !== "connected");
    $("#tbWifi").title = on.WiFi ? (now.state === "connected" ? `Wi-Fi: ${now.ssid}` : "Wi-Fi: not connected") : "Wi-Fi is off";
    $("#tbBt").hidden = !("Bluetooth" in on);
    $("#tbBt").classList.toggle("off", !on.Bluetooth);
    if (vol) {
      setHTML($("#tbVol"), icon(vol.muted || vol.level === 0 ? "mute" : "speaker"));
      $("#tbVol").title = `Sound: ${vol.muted ? "muted" : vol.level + "%"}`;
    }
    $("#tbBattery").hidden = batt == null;
    if (batt) {
      $("#batteryText").textContent = batt.level + "%";
      $("#tbBattery").classList.toggle("charging", batt.charging);
      $("#tbBattery").style.setProperty("--batt", batt.level / 100);
    }
  } catch {}
}
$("#tbWifi").addEventListener("click", () => { toggleOverlay("#quick", true); qsPage("wifi"); });
$("#tbBt").addEventListener("click", () => { toggleOverlay("#quick", true); qsPage("bt"); });
$("#tbVol").addEventListener("click", () => toggleOverlay("#quick", true));
$("#tbBattery").addEventListener("click", () => toggleOverlay("#quick", true));
setInterval(drawStatus, 30000);

function tick() {
  const now = new Date();
  $("#clockTime").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("#clockDate").textContent = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}
setInterval(tick, 5000);

let calMonth = null;
function drawCalendar() {
  const cal = $("#calendar");
  const today = new Date();
  calMonth ??= new Date(today.getFullYear(), today.getMonth(), 1);
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  setHTML(cal, `
    <div class="cal-head">
      <b></b>
      <span><button class="cal-nav" data-step="-1">${icon("left")}</button><button class="cal-nav" data-step="1">${icon("right")}</button></span>
    </div>
    <div class="cal-grid"></div>
    <p class="cal-today"></p>`);
  cal.querySelector(".cal-head b").textContent = calMonth.toLocaleDateString([], { month: "long", year: "numeric" });
  cal.querySelector(".cal-today").textContent = today.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const grid = cal.querySelector(".cal-grid");
  const first = (new Date(y, m, 1).getDay() + 6) % 7;
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) grid.append(html("span", "cal-dow", d));
  for (let i = 0; i < first; i++) grid.append(html("span"));
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const s = html("span", "cal-day", String(d));
    if (d === today.getDate() && m === today.getMonth() && y === today.getFullYear()) s.classList.add("today");
    grid.append(s);
  }
  cal.querySelectorAll(".cal-nav").forEach(b => b.addEventListener("click", () => { calMonth = new Date(y, m + +b.dataset.step, 1); drawCalendar(); }));
}

// ================= Overlays: launcher, quick settings, calendar =================

const overlays = ["#launcher", "#spotlight", "#quick", "#calendar", "#menu", "#tasks"];
function closeOverlays(except) {
  for (const s of overlays) if (s !== except) $(s).hidden = true;
  document.body.classList.toggle("launcher-open", except === "#launcher" && !$("#launcher").hidden);
}
function toggleOverlay(sel, open = $(sel).hidden) {
  closeOverlays(sel);
  $(sel).hidden = !open;
  document.body.classList.toggle("launcher-open", sel === "#launcher" && open);
  if (open && sel === "#launcher") { $("#lnSearch").value = ""; drawLauncher(); setTimeout(() => $("#lnSearch").focus(), 30); }
  if (open && sel === "#spotlight") { $("#spInput").value = ""; spotlight(""); setTimeout(() => $("#spInput").focus(), 20); }
  if (open && sel === "#quick") { qsPage("main"); drawQuick(); }
  if (open && sel === "#calendar") { calMonth = null; drawCalendar(); }
  if (open && sel === "#tasks") updateRam();
}

// (the drop opens the Aquaris menu: see "Menu bar")
$("#dockLauncher").addEventListener("click", () => toggleOverlay("#launcher"));
$("#tbQuick").addEventListener("click", () => toggleOverlay("#quick"));
$("#tbRam").addEventListener("click", () => toggleOverlay("#tasks"));
$("#tbClock").addEventListener("click", () => toggleOverlay("#calendar"));
$("#tbSearch").addEventListener("click", () => toggleOverlay("#spotlight"));
$("#launcher").addEventListener("pointerdown", e => { if (e.target === $("#launcher") || e.target === $("#lnApps")) toggleOverlay("#launcher", false); });
$("#spotlight").addEventListener("pointerdown", e => { if (e.target === $("#spotlight")) toggleOverlay("#spotlight", false); });
document.addEventListener("pointerdown", e => {
  if (!e.target.closest("#quick, #tbQuick")) $("#quick").hidden = true;
  if (!e.target.closest("#tasks, #tbRam, #menu")) $("#tasks").hidden = true;
  if (!e.target.closest("#calendar, #tbClock")) $("#calendar").hidden = true;
  if (!e.target.closest("#menu")) $("#menu").hidden = true;
});
// ================= The window switcher (Alt+Shift+T) =================
// Like Alt+Tab: hold Alt+Shift and press T. The window (or tab) you used just before is picked
// already; press T again for the next one, or use the arrow keys, or click one. Let go of Alt to
// switch to it; Esc closes the switcher.
const switcher = { open: false, items: [], index: 0, timer: 0 };
function switchItems() {
  const items = [];
  for (const w of wins) {
    if (w.kind === "native") continue;
    // Aeris in the iPad app: each tab is its own entry
    if (w.tabs?.length > 1) {
      for (const v of w.tabs) items.push({ app: w.app, title: viewTitle(v) || (isNewTab(viewUrl(v)) ? "New Tab" : viewUrl(v)), used: Math.max(+v.dataset.used || 0, w.view === v ? w.lastUsed || 0 : 0), go: () => { restore(w); switchTab(w, v); focusWin(w); } });
    } else {
      items.push({ app: w.app, title: w.name?.textContent || w.app.name, used: w.lastUsed || 0, go: () => { restore(w); focusWin(w); } });
    }
  }
  // The real Aeris windows on a computer
  for (const a of aerisWindows()) items.push({ app: AERIS_APP, title: aerisTitle(a), used: a.aquarisUsed || 0, go: () => showAeris(a) });
  return items.sort((x, y) => y.used - x.used);
}
function drawSwitcher() {
  const list = $("#swList");
  list.textContent = "";
  switcher.items.forEach((it, i) => {
    const b = html("button", "sw-item" + (i === switcher.index ? " on" : ""));
    b.append(tile(it.app, "big"), html("span", "sw-name", it.app.name));
    b.title = it.title;
    b.addEventListener("click", () => { switcher.index = i; finishSwitch(true); });
    list.append(b);
  });
  $("#swTitle").textContent = switcher.items[switcher.index]?.title || "";
  list.children[switcher.index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function stepSwitch(step = 1, { gesture = false } = {}) {
  if (!switcher.open) {
    switcher.items = switchItems();
    if (!switcher.items.length) return;
    closeOverlays();
    switcher.open = true;
    switcher.index = Math.min(1, switcher.items.length - 1);   // the one used just before
    $("#switcher").hidden = false;
  } else {
    const n = switcher.items.length;
    switcher.index = (switcher.index + step + n) % n;
  }
  drawSwitcher();
  // Keyboards that don't tell us when Alt is let go (iPad websites): switch after a short pause
  clearTimeout(switcher.timer);
  if (inShell && !gesture) switcher.timer = setTimeout(() => finishSwitch(true), 1300);
}
function finishSwitch(go) {
  if (!switcher.open) return;
  clearTimeout(switcher.timer);
  switcher.open = false;
  $("#switcher").hidden = true;
  if (go) switcher.items[switcher.index]?.go();
}
const isSwitchKey = e => e.altKey && e.shiftKey && (e.code === "KeyT" || e.key.toLowerCase() === "t");
addEventListener("keydown", e => {
  if (isSwitchKey(e)) { e.preventDefault(); e.stopPropagation(); stepSwitch(1); return; }
  if (!switcher.open) return;
  if (e.key === "Escape") { e.preventDefault(); finishSwitch(false); }
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); stepSwitch(1); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); stepSwitch(-1); }
  else if (e.key === "Enter") { e.preventDefault(); finishSwitch(true); }
}, true);
addEventListener("keyup", e => { if (switcher.open && e.key === "Alt") finishSwitch(true); }, true);
addEventListener("blur", () => finishSwitch(true));
$("#switcher").addEventListener("pointerdown", e => { if (e.target.id === "switcher") finishSwitch(false); });

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeOverlays();
  if ((e.ctrlKey || e.altKey) && e.code === "Space") { e.preventDefault(); toggleOverlay("#spotlight"); }
  if (e.key === "F11") { e.preventDefault(); toggleFullscreen(); }
});

// ----- Launcher -----

function drawLauncher(filter = "") {
  const q = filter.trim().toLowerCase();
  const grid = $("#lnApps");
  grid.textContent = "";
  for (const app of [...everyApp(), SYSTEM.add, SYSTEM.settings]) {
    if (q && !app.name.toLowerCase().includes(q)) continue;
    const b = html("button", "ln-app");
    b.append(tile(app), html("span", "", app.name));
    b.title = app.about || "";
    b.addEventListener("click", () => { toggleOverlay("#launcher", false); openApp(app); });
    if (!SYSTEM[app.id]) b.addEventListener("contextmenu", e => { e.preventDefault(); appMenu(e, app); });
    grid.append(b);
  }
}
$("#lnSearch").addEventListener("input", e => drawLauncher(e.target.value));
$("#lnSearch").addEventListener("keydown", e => {
  if (e.key === "Enter") $("#lnApps .ln-app")?.click();
});
$(".ln-foot").addEventListener("click", e => {
  const b = e.target.closest("[data-do]");
  if (!b) return;
  toggleOverlay("#launcher", false);
  b.dataset.do === "shutdown" ? shutDown() : openSystem(b.dataset.do);
});

// ----- Spotlight -----
// Type anything: apps, Aquaris's settings, a sum, a website, or a web search. Results are grouped
// like on a Mac; the arrow keys move, Enter opens, Esc closes.

// Sums without eval: numbers, brackets, + - * / ^ %
function quickSum(text) {
  if (!/^[\d\s.+\-*/x×÷^%()]+$/.test(text) || !/\d/.test(text) || !/[+\-*/x×÷^%]/.test(text.replace(/^\s*-/, ""))) return null;
  const tokens = text.replace(/[x×]/g, "*").replace(/÷/g, "/").match(/\d*\.?\d+|[()+\-*/^%]/g) || [];
  let i = 0;
  const peek = () => tokens[i], take = () => tokens[i++];
  const unit = () => {
    if (peek() === "-") { take(); return -unit(); }
    if (peek() === "(") { take(); const v = add(); if (take() !== ")") throw 0; return v; }
    const n = parseFloat(take());
    if (Number.isNaN(n)) throw 0;
    return peek() === "%" ? (take(), n / 100) : n;
  };
  const pow = () => { const b = unit(); return peek() === "^" ? (take(), b ** pow()) : b; };
  const mul = () => { let v = pow(); while (peek() === "*" || peek() === "/") { const o = take(), r = pow(); v = o === "*" ? v * r : v / r; } return v; };
  const add = () => { let v = mul(); while (peek() === "+" || peek() === "-") { const o = take(), r = mul(); v = o === "+" ? v + r : v - r; } return v; };
  try { const v = add(); return i === tokens.length && Number.isFinite(v) ? +v.toPrecision(12) : null; } catch { return null; }
}

const SETTING_HITS = [
  ["Wallpaper", "Change the desktop picture"], ["Dark mode", "Light, dark or automatic"], ["Themes", "Minimal, Frutiger Aqua and Aeris themes"],
  ["Dock size", "Make the dock bigger or smaller"], ["Pointer", "Change the mouse pointer"], ["Start with my computer", "Open Aquaris when the computer starts"]
];
let spItems = [], spAt = 0;
function spotlight(text) {
  const q = text.trim().toLowerCase();
  const groups = [];
  if (!q) {
    const recent = settings.aquarisRecent.map(appById).filter(Boolean);
    if (recent.length) groups.push(["Recently used", recent.map(app => ({ app, title: app.name, kind: "App", go: () => openApp(app) }))]);
  } else {
    const score = a => { const n = a.name.toLowerCase(); return n.startsWith(q) ? 0 : n.split(/\s+/).some(w => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : (a.about || "").toLowerCase().includes(q) ? 3 : 9; };
    const apps = [...everyApp(), SYSTEM.add, SYSTEM.about].map(a => [score(a), a]).filter(([s]) => s < 9).sort((x, y) => x[0] - y[0]).map(([, a]) => a);
    const sum = quickSum(text.trim());
    const site = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text.trim()) || /^https?:\/\//.test(text.trim());
    if (apps.length && score(apps[0]) <= 1) groups.push(["Top Hit", [{ app: apps[0], title: apps[0].name, kind: apps[0].about || "App", big: true, go: () => openApp(apps[0]) }]]);
    if (sum !== null) groups.push(["Calculator", [{ app: { id: "sum", ui: "calc", color: "#5b6b82" }, title: `= ${sum.toLocaleString()}`, kind: "Copy the answer", go: () => inChrome && clipboard(String(sum)) }]]);
    const rest = apps.filter((a, i) => !(i === 0 && score(a) <= 1));
    if (rest.length) groups.push(["Applications", rest.slice(0, 6).map(app => ({ app, title: app.name, kind: "App", go: () => openApp(app) }))]);
    const sets = SETTING_HITS.filter(([n, d]) => (n + " " + d).toLowerCase().includes(q));
    if (sets.length) groups.push(["Settings", sets.map(([n, d]) => ({ app: SYSTEM.settings, title: n, kind: d, go: () => openSystem("settings") }))]);
    const web = [];
    if (site) web.push({ app: { id: "web", ui: "globe", color: "#2a86e8" }, title: text.trim(), kind: "Open website", go: () => openInAeris([fixup(text.trim())]) });
    web.push({ app: { id: "find", ui: "search", color: "#6b7a8f" }, title: text.trim(), kind: "Search the web", go: () => openInAeris([webSearchUrl(text.trim())]) });
    groups.push(["Web", web]);
  }
  spItems = groups.flatMap(([, items]) => items);
  spAt = 0;
  const box = $("#spResults");
  box.textContent = "";
  box.hidden = !spItems.length;
  let n = 0;
  for (const [title, items] of groups) {
    box.append(html("div", "sp-group", title));
    for (const it of items) {
      const i = n++;
      const row = html("button", "sp-row" + (it.big ? " big" : "") + (i === 0 ? " on" : ""));
      row.append(tile(it.app, it.big ? "small" : "tiny"));
      row.append(html("span", "sp-title", it.title), html("span", "sp-kind", it.kind));
      row.addEventListener("mousemove", () => spSelect(i));
      row.addEventListener("click", () => { toggleOverlay("#spotlight", false); it.go(); });
      box.append(row);
    }
  }
}
function spSelect(i) {
  spAt = Math.max(0, Math.min(spItems.length - 1, i));
  $("#spResults").querySelectorAll(".sp-row").forEach((r, k) => r.classList.toggle("on", k === spAt));
  $("#spResults").querySelectorAll(".sp-row")[spAt]?.scrollIntoView({ block: "nearest" });
}
$("#spInput").addEventListener("input", e => spotlight(e.target.value));
$("#spInput").addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { spSelect(spAt + 1); e.preventDefault(); }
  if (e.key === "ArrowUp") { spSelect(spAt - 1); e.preventDefault(); }
  if (e.key === "Enter" && spItems[spAt]) { const it = spItems[spAt]; toggleOverlay("#spotlight", false); it.go(); }
});

function webSearchUrl(text) {
  if (!inChrome) return "https://duckduckgo.com/?q=" + encodeURIComponent(text);
  // The default search engine, through the same "keyword" search the address bar uses
  return Services.uriFixup.getFixupURIInfo(text, Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP).preferredURI?.spec || "https://duckduckgo.com/?q=" + encodeURIComponent(text);
}

// ----- Quick settings -----

function drawQuick() {
  for (const b of $("#qsMode").children) b.classList.toggle("on", b.dataset.v === settings.aquarisMode);
  for (const b of $("#qsStyle").children) b.classList.toggle("on", b.dataset.v === settings.aquarisTheme || (b.dataset.v === "more" && !!themeById(settings.aquarisTheme)));
  $("#qsGlass").value = settings.aquarisGlass;
  $("#qsFull").classList.toggle("on", isFullscreen());
  $("#qsNight").classList.toggle("on", settings.aquarisNight.on);
  $("#nightWarmth").value = settings.aquarisNight.warmth;
  drawRamDetail();
  refreshSystem();
}
$("#qsMode").addEventListener("click", e => e.target.dataset.v && save({ aquarisMode: e.target.dataset.v }).then(drawQuick));
$("#qsStyle").addEventListener("click", e => {
  const v = e.target.dataset.v;
  if (v === "more") return closeOverlays(), openSystem("settings");
  if (v) save({ aquarisTheme: v }).then(drawQuick);
});
$("#qsGlass").addEventListener("input", e => { settings.aquarisGlass = +e.target.value; applyLook(); });
$("#qsGlass").addEventListener("change", e => save({ aquarisGlass: +e.target.value }));
$("#qsFull .qs-on").addEventListener("click", () => { toggleFullscreen(); setTimeout(drawQuick, 400); });
$("#qsNap .qs-on").addEventListener("click", () => { napCheck(true); drawRamDetail(); setTimeout(updateRam, 2500); });
$("#qsSettings").addEventListener("click", () => { closeOverlays(); openSystem("settings"); });
// Pages inside quick settings (Wi-Fi, Bluetooth, night light)
function qsPage(name) {
  for (const pg of document.querySelectorAll("#quick .qs-page")) pg.hidden = pg.dataset.page !== name;
  if (name === "wifi") drawWifi();
  if (name === "bt") drawBluetooth();
}
$("#quick").addEventListener("click", e => {
  const go = e.target.closest("[data-go]")?.dataset.go;
  if (go) qsPage(go);
  if (e.target.closest(".qs-back")) qsPage("main");
  const s = e.target.closest("[data-settings]")?.dataset.settings;
  if (s) openWindowsSettings(s);
});

// ================= Your computer: Wi-Fi, Bluetooth, volume, brightness, night light =================
// Aquaris asks Windows through a small hidden helper (system.ps1, started once and kept running).
// Only the commands in system.ps1 exist; Wi-Fi names and passwords are passed to it as data.

const sys = { proc: null, starting: null, next: 1, waiting: new Map(), buf: "" };
const OS = inChrome ? Services.appinfo.OS : "web";       // "WINNT", "Linux" or "Darwin" (Mac)
const onWindows = OS === "WINNT", onLinux = OS === "Linux", onMac = OS === "Darwin";
const hasSystem = onWindows || onLinux || onMac;
async function startSystem() {
  const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
  const file = PathUtils.join(PathUtils.profileDir, "aquaris-system.ps1");
  await IOUtils.writeUTF8(file, await (await fetch("system.ps1")).text());
  const shell = PathUtils.join(Services.dirsvc.get("WinD", Ci.nsIFile).path, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const proc = await Subprocess.call({ command: shell, arguments: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], stderr: "pipe" });
  let ready;
  const isReady = new Promise(r => (ready = r));
  (async () => {
    for (;;) {
      const chunk = await proc.stdout.readString();
      if (!chunk) break;
      sys.buf += chunk;
      let i;
      while ((i = sys.buf.indexOf("\n")) >= 0) {
        const line = sys.buf.slice(0, i).trim();
        sys.buf = sys.buf.slice(i + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 0) { ready(); continue; }
        const w = sys.waiting.get(msg.id);
        sys.waiting.delete(msg.id);
        if (w) msg.ok ? w.resolve(msg.data) : w.reject(new Error(msg.error));
      }
    }
    sys.proc = null;
    sys.starting = null;
    for (const w of sys.waiting.values()) w.reject(new Error("The helper stopped"));
    sys.waiting.clear();
  })();
  (async () => { while (await proc.stderr.readString()) {} })();
  sys.proc = proc;
  await isReady;
}
async function system(cmd, args = {}) {
  if (onLinux || onMac) return unixSystem(cmd, args);
  if (!onWindows) throw new Error("Not on this computer");
  sys.starting ??= startSystem();
  await sys.starting;
  const id = sys.next++;
  const answer = new Promise((resolve, reject) => sys.waiting.set(id, { resolve, reject }));
  await sys.proc.stdin.write(JSON.stringify({ id, cmd, args }) + "\n");
  return answer;
}
addEventListener("unload", () => sys.proc?.kill());

// ----- Linux and Mac: the same commands, done with each system's own tools -----
// Linux: wpctl/pactl (sound), brightnessctl (brightness), nmcli (Wi-Fi), bluetoothctl, the battery
// files, gio (Trash). Mac: osascript (sound, Trash), networksetup (Wi-Fi), pmset (battery).
// Programs are found by name and given their values as separate arguments (never through a shell).
let SubprocessModule = null;
async function run(name, args = [], { ok = [0] } = {}) {
  SubprocessModule ??= ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs").Subprocess;
  const command = await SubprocessModule.pathSearch(name).catch(() => null);
  if (!command) throw new Error(`${name} isn't installed`);
  const proc = await SubprocessModule.call({ command, arguments: args, stderr: "stdout", environment: { LC_ALL: "C" }, environmentAppend: true });
  let out = "", chunk;
  while ((chunk = await proc.stdout.readString())) out += chunk;
  const { exitCode } = await proc.wait();
  if (!ok.includes(exitCode)) throw new Error(out.trim().split("\n").pop() || `${name} failed`);
  return out;
}
const has = async name => { SubprocessModule ??= ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs").Subprocess; return !!(await SubprocessModule.pathSearch(name).catch(() => null)); };
// nmcli -t separates with ":" and escapes real colons as "\:"
const nmFields = line => line.split(/(?<!\\):/).map(s => s.replace(/\\:/g, ":"));
let macWifiDevice = null;
async function macWifi() {
  if (macWifiDevice) return macWifiDevice;
  const out = await run("networksetup", ["-listallhardwareports"]);
  const m = out.match(/Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\S+)/);
  if (!m) throw new Error("No Wi-Fi on this Mac");
  return (macWifiDevice = m[1]);
}

async function unixSystem(cmd, a) {
  if (onLinux) switch (cmd) {
    case "getVolume":
      if (await has("wpctl")) {
        const out = await run("wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"]);
        return { level: Math.round(parseFloat(out.match(/[\d.]+/)?.[0] || "0") * 100), muted: /MUTED/.test(out) };
      } else {
        const v = await run("pactl", ["get-sink-volume", "@DEFAULT_SINK@"]);
        const m = await run("pactl", ["get-sink-mute", "@DEFAULT_SINK@"]);
        return { level: +(v.match(/(\d+)%/)?.[1] || 0), muted: /yes/.test(m) };
      }
    case "setVolume":
      return (await has("wpctl")) ? run("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", (Math.max(0, Math.min(100, a.level)) / 100).toFixed(2)])
        : run("pactl", ["set-sink-volume", "@DEFAULT_SINK@", Math.max(0, Math.min(100, a.level)) + "%"]);
    case "setMute":
      return (await has("wpctl")) ? run("wpctl", ["set-mute", "@DEFAULT_AUDIO_SINK@", a.muted ? "1" : "0"]) : run("pactl", ["set-sink-mute", "@DEFAULT_SINK@", a.muted ? "1" : "0"]);
    case "getBrightness":
      if (!(await has("brightnessctl"))) return null;
      try { return +((await run("brightnessctl", ["-m"])).split(",")[3] || "").replace("%", "") || null; } catch { return null; }
    case "setBrightness":
      return run("brightnessctl", ["set", Math.max(1, Math.min(100, a.level)) + "%"]);
    case "radios": {
      const list = [];
      if (await has("nmcli")) list.push({ kind: "WiFi", state: (await run("nmcli", ["radio", "wifi"])).trim() === "enabled" ? "On" : "Off" });
      if (await has("bluetoothctl")) list.push({ kind: "Bluetooth", state: /Powered: yes/.test(await run("bluetoothctl", ["show"]).catch(() => "")) ? "On" : "Off" });
      return list;
    }
    case "setRadio":
      if (a.kind === "WiFi") return run("nmcli", ["radio", "wifi", a.on ? "on" : "off"]);
      return run("bluetoothctl", ["power", a.on ? "on" : "off"]);
    case "wifiNow": {
      const line = (await run("nmcli", ["-t", "-f", "ACTIVE,SSID,SIGNAL", "device", "wifi"])).split("\n").find(l => l.startsWith("yes:"));
      if (!line) return { state: "disconnected", ssid: "", signal: 0 };
      const [, ssid, signal] = nmFields(line);
      return { state: "connected", ssid, signal: +signal };
    }
    case "wifiList": {
      const known = new Set((await run("nmcli", ["-t", "-f", "NAME", "connection", "show"])).split("\n").map(s => s.trim()).filter(Boolean));
      const seen = new Map();
      for (const line of (await run("nmcli", ["-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "auto"])).split("\n")) {
        const [ssid, signal, security] = nmFields(line);
        if (!ssid || (seen.get(ssid)?.signal || 0) >= +signal) continue;
        seen.set(ssid, { ssid, signal: +signal, auth: security || "Open", open: !security || security === "--", known: known.has(ssid) });
      }
      return [...seen.values()].sort((x, y) => y.signal - x.signal);
    }
    case "wifiConnect": {
      const known = (await run("nmcli", ["-t", "-f", "NAME", "connection", "show"])).split("\n").map(s => s.trim());
      const out = known.includes(a.ssid) ? await run("nmcli", ["connection", "up", "id", a.ssid])
        : await run("nmcli", ["device", "wifi", "connect", a.ssid, ...(a.password ? ["password", a.password] : [])]);
      return { result: out, now: await unixSystem("wifiNow") };
    }
    case "wifiDisconnect": {
      const dev = (await run("nmcli", ["-t", "-f", "DEVICE,TYPE", "device"])).split("\n").map(nmFields).find(([, type]) => type === "wifi")?.[0];
      return dev ? run("nmcli", ["device", "disconnect", dev]) : null;
    }
    case "btPaired": case "btScan": {
      const paired = (await run("bluetoothctl", ["devices", "Paired"]).catch(() => run("bluetoothctl", ["paired-devices"])))
        .split("\n").map(l => l.match(/^Device (\S+) (.+)$/)).filter(Boolean).map(([, id, name]) => ({ id, name, paired: true }));
      if (cmd === "btPaired") return paired;
      await run("bluetoothctl", ["--timeout", "10", "scan", "on"], { ok: [0, 1] });
      return (await run("bluetoothctl", ["devices"])).split("\n").map(l => l.match(/^Device (\S+) (.+)$/)).filter(Boolean)
        .map(([, id, name]) => ({ id, name, paired: false })).filter(d => !paired.some(p => p.id === d.id) && !/^([0-9A-F]{2}-){5}/i.test(d.name));
    }
    case "btPair": {
      const out = await run("bluetoothctl", ["--timeout", "20", "pair", a.id], { ok: [0, 1] });
      if (!/successful|AlreadyExists/i.test(out)) return out.trim().split("\n").pop();
      await run("bluetoothctl", ["trust", a.id], { ok: [0, 1] });
      await run("bluetoothctl", ["connect", a.id], { ok: [0, 1] });
      return "Paired";
    }
    case "btUnpair":
      return /removed/i.test(await run("bluetoothctl", ["remove", a.id], { ok: [0, 1] })) ? "Unpaired" : "Failed";
    case "battery": {
      for (const name of await IOUtils.getChildren("/sys/class/power_supply").catch(() => [])) {
        if (!/BAT/i.test(PathUtils.filename(name))) continue;
        const level = +(await IOUtils.readUTF8(PathUtils.join(name, "capacity")).catch(() => "0"));
        const status = (await IOUtils.readUTF8(PathUtils.join(name, "status")).catch(() => "")).trim();
        return { level, charging: /Charging|Full/.test(status) };
      }
      return null;
    }
    case "recycle":
      if (await has("gio")) return run("gio", ["trash", "--", a.path]);
      return run("kioclient5", ["move", a.path, "trash:/"]);
  }
  if (onMac) switch (cmd) {
    case "getVolume": {
      const out = await run("osascript", ["-e", "set s to get volume settings", "-e", "return (output volume of s as text) & \",\" & (output muted of s as text)"]);
      const [level, muted] = out.trim().split(",");
      return { level: +level || 0, muted: muted === "true" };
    }
    case "setVolume": return run("osascript", ["-e", `set volume output volume ${Math.round(Math.max(0, Math.min(100, a.level)))}`]);
    case "setMute": return run("osascript", ["-e", `set volume output muted ${a.muted ? "true" : "false"}`]);
    case "getBrightness": return null; // macOS has no built-in tool for this (System Settings has it)
    case "setBrightness": throw new Error("Use System Settings for brightness on a Mac");
    case "radios": return [{ kind: "WiFi", state: /: On/.test(await run("networksetup", ["-getairportpower", await macWifi()])) ? "On" : "Off" }];
    case "setRadio":
      if (a.kind !== "WiFi") throw new Error("Use System Settings for Bluetooth on a Mac");
      return run("networksetup", ["-setairportpower", await macWifi(), a.on ? "on" : "off"]);
    case "wifiNow": {
      const out = await run("networksetup", ["-getairportnetwork", await macWifi()], { ok: [0, 1] });
      const m = out.match(/Current Wi-Fi Network: (.+)/);
      return m ? { state: "connected", ssid: m[1].trim(), signal: 100 } : { state: "disconnected", ssid: "", signal: 0 };
    }
    case "wifiList": {
      // Newer macOS only names nearby networks for apps allowed to see your location
      const data = JSON.parse(await run("system_profiler", ["SPAirPortDataType", "-json"]));
      const iface = data.SPAirPortDataType?.[0]?.spairport_airport_interfaces?.[0] || {};
      const nets = (iface.spairport_airport_other_local_wireless_networks || []).map(n => ({ ssid: n._name, signal: 60, auth: n.spairport_security_mode || "", open: /none/i.test(n.spairport_security_mode || ""), known: false }));
      if (!nets.length || nets.every(n => /redacted/i.test(n.ssid))) throw new Error("LOCATION");
      return nets;
    }
    case "wifiConnect": {
      const out = await run("networksetup", ["-setairportnetwork", await macWifi(), a.ssid, ...(a.password ? [a.password] : [])], { ok: [0, 1] });
      return { result: out, now: await unixSystem("wifiNow") };
    }
    case "wifiDisconnect": throw new Error("Use the Wi-Fi menu or System Settings to disconnect on a Mac");
    case "btPaired": case "btScan": case "btPair": case "btUnpair": throw new Error("Bluetooth devices are in System Settings on a Mac");
    case "battery": {
      const m = (await run("pmset", ["-g", "batt"])).match(/(\d+)%;\s*([a-z ]+);/i);
      return m ? { level: +m[1], charging: /charging|charged/i.test(m[2]) && !/discharging/i.test(m[2]) } : null;
    }
    case "recycle":
      // The path goes to the script as data (argv), not inside its text
      return run("osascript", ["-e", "on run argv", "-e", 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', "-e", "end run", a.path]);
  }
  throw new Error("Unknown command");
}

// Windows' own settings pages (only these fixed ones)
const SETTINGS_PAGES = ["ms-settings:network-wifi", "ms-settings:bluetooth", "ms-settings:nightlight", "ms-settings:privacy-location"];
// The same pages on Linux (GNOME or KDE) and on a Mac
const OTHER_SETTINGS = {
  "ms-settings:network-wifi": { gnome: "wifi", kde: "kcm_networkmanagement", mac: "x-apple.systempreferences:com.apple.wifi-settings-extension" },
  "ms-settings:bluetooth": { gnome: "bluetooth", kde: "kcm_bluetooth", mac: "x-apple.systempreferences:com.apple.BluetoothSettings" },
  "ms-settings:nightlight": { gnome: "display", kde: "kcm_nightlight", mac: "x-apple.systempreferences:com.apple.Displays-Settings.extension" },
  "ms-settings:privacy-location": { gnome: "privacy", kde: "kcm_kded", mac: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices" }
};
async function openOtherSettings(page) {
  const s = OTHER_SETTINGS[page];
  if (!s) return;
  if (onMac) return run("open", [s.mac]).catch(() => {});
  if (await has("gnome-control-center")) return run("gnome-control-center", [s.gnome]).catch(() => {});
  if (await has("systemsettings")) return run("systemsettings", [s.kde]).catch(() => {});
}
function openWindowsSettings(page) {
  if (onLinux || onMac) return openOtherSettings(page);
  if (!onWindows || !SETTINGS_PAGES.includes(page)) return;
  const explorer = Services.dirsvc.get("WinD", Ci.nsIFile);
  explorer.append("explorer.exe");
  const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  proc.init(explorer);
  proc.run(false, [page], 1);
}

let radios = {};
function sysNote(text) {
  $("#qsSysNote").hidden = !text;
  $("#qsSysNote").textContent = text || "";
}
async function refreshSystem() {
  if (!hasSystem) { sysNote("Wi-Fi, Bluetooth, volume and brightness work when Aquaris runs on a computer."); return; }
  if (onWindows && !sys.proc) sysNote("Connecting to Windows…");
  try {
    const soft = p => p.catch(() => null);
    const [r, now, vol, bright] = await Promise.all([soft(system("radios")).then(x => x || []), soft(system("wifiNow")).then(x => x || { state: "", ssid: "" }), soft(system("getVolume")).then(x => x || { level: 0, muted: false, missing: true }), soft(system("getBrightness"))]);
    $("#qsVol").hidden = !!vol.missing;
    sysNote("");
    radios = Object.fromEntries(r.map(x => [x.kind, x.state === "On"]));
    $("#qsWifi").classList.toggle("on", !!radios.WiFi);
    $("#qsWifi").hidden = !("WiFi" in radios);
    $("#qsWifi .qs-cap").textContent = radios.WiFi ? (now.state === "connected" ? now.ssid : "Not connected") : "Wi-Fi";
    $("#qsBt").classList.toggle("on", !!radios.Bluetooth);
    $("#qsBt").hidden = !("Bluetooth" in radios);
    $("#qsPlane").classList.toggle("on", !radios.WiFi && !radios.Bluetooth);
    $("#qsVol input").value = vol.level;
    $("#qsVol .qs-num").textContent = vol.level;
    $("#qsVol").classList.toggle("muted", vol.muted);
    setHTML($("#qsVol .qs-mute"), icon(vol.muted ? "mute" : "speaker"));
    $("#qsBright").hidden = bright == null;
    if (bright != null) $("#qsBright input").value = bright;
  } catch (e) {
    sysNote("Couldn't reach Windows: " + e.message);
  }
}

// Wi-Fi and Bluetooth on/off, airplane mode
async function setRadio(kind, on) {
  try { await system("setRadio", { kind, on }); } catch (e) { sysNote(e.message); }
  setTimeout(refreshSystem, 600);
}
$("#qsWifi .qs-on").addEventListener("click", () => setRadio("WiFi", !radios.WiFi));
$("#qsBt .qs-on").addEventListener("click", () => setRadio("Bluetooth", !radios.Bluetooth));
$("#qsPlane .qs-on").addEventListener("click", async () => {
  const plane = !radios.WiFi && !radios.Bluetooth;
  for (const kind of ["WiFi", "Bluetooth"]) if (kind in radios) await system("setRadio", { kind, on: plane }).catch(e => sysNote(e.message));
  setTimeout(refreshSystem, 600);
});

// Volume and brightness (sent a moment after you stop dragging)
let levelTimer = 0;
$("#qsVol input").addEventListener("input", e => {
  $("#qsVol .qs-num").textContent = e.target.value;
  clearTimeout(levelTimer);
  levelTimer = setTimeout(() => system("setVolume", { level: +e.target.value }).catch(err => sysNote(err.message)), 120);
});
$("#qsVol .qs-mute").addEventListener("click", async () => {
  await system("setMute", { muted: !$("#qsVol").classList.contains("muted") }).catch(err => sysNote(err.message));
  refreshSystem();
});
$("#qsBright input").addEventListener("input", e => {
  clearTimeout(levelTimer);
  levelTimer = setTimeout(() => system("setBrightness", { level: +e.target.value }).catch(err => sysNote(err.message)), 150);
});

// Wi-Fi networks
const bars = n => (n > 75 ? 4 : n > 50 ? 3 : n > 25 ? 2 : 1);
async function drawWifi() {
  const list = $("#wifiList");
  setHTML(list, `<p class="hint qs-wait"><span class="spinner"></span> Looking for networks…</p>`);
  let nets, now;
  try { [nets, now] = await Promise.all([system("wifiList"), system("wifiNow")]); }
  catch (e) {
    if (e.message === "LOCATION") {
      setHTML(list, `<p class="hint">${onMac ? "macOS" : "Windows"} only lists Wi-Fi networks when Location is on.</p><button class="btn" data-settings="ms-settings:privacy-location">Open Location settings</button>`);
    } else setHTML(list, `<p class="hint"></p>`), (list.querySelector("p").textContent = "Couldn't list networks: " + e.message);
    return;
  }
  list.textContent = "";
  for (const n of nets) {
    const here = now.state === "connected" && now.ssid === n.ssid;
    const row = html("div", "qs-item" + (here ? " on" : ""));
    setHTML(row, `<span class="qs-ico">${icon("wifi")}</span><span class="qs-what"><b></b><small></small></span>${n.open ? "" : `<span class="qs-lock">${icon("lock")}</span>`}`);
    row.querySelector("b").textContent = n.ssid;
    row.querySelector("small").textContent = here ? "Connected" : n.known ? "Saved" : n.open ? "Open" : "Secured";
    row.querySelector(".qs-ico").dataset.bars = bars(n.signal);
    row.addEventListener("click", () => wifiRow(row, n, here));
    list.append(row);
  }
  if (!nets.length) setHTML(list, `<p class="hint">No networks found.</p>`);
}
function wifiRow(row, n, here) {
  if (row.querySelector(".qs-act")) return;
  const act = html("div", "qs-act");
  if (here) {
    setHTML(act, `<button class="btn">Disconnect</button>`);
    act.querySelector("button").addEventListener("click", async e => { e.stopPropagation(); await system("wifiDisconnect").catch(() => {}); drawWifi(); refreshSystem(); });
  } else if (n.known || n.open) {
    setHTML(act, `<button class="btn primary">Connect</button>`);
    act.querySelector("button").addEventListener("click", e => { e.stopPropagation(); joinWifi(act, n.ssid, ""); });
  } else {
    setHTML(act, `<input type="password" placeholder="Wi-Fi password" autocomplete="off"><button class="btn primary">Connect</button>`);
    const pass = act.querySelector("input");
    const go = e => { e.stopPropagation(); if (pass.value) joinWifi(act, n.ssid, pass.value); };
    act.querySelector("button").addEventListener("click", go);
    pass.addEventListener("keydown", e => e.key === "Enter" && go(e));
    pass.addEventListener("click", e => e.stopPropagation());
    setTimeout(() => pass.focus(), 30);
  }
  row.append(act);
}
async function joinWifi(act, ssid, password) {
  setHTML(act, `<span class="hint"><span class="spinner"></span> Connecting…</span>`);
  try {
    const r = await system("wifiConnect", { ssid, password });
    act.textContent = r.now?.state === "connected" && r.now.ssid === ssid ? "Connected" : "Couldn't connect. Check the password and try again.";
  } catch (e) { act.textContent = "Couldn't connect: " + e.message; }
  setTimeout(() => { drawWifi(); refreshSystem(); }, 1500);
}
$("#quick .qs-refresh").addEventListener("click", drawWifi);

// Bluetooth devices
async function drawBluetooth(found) {
  const list = $("#btList");
  if (!found) setHTML(list, `<p class="hint qs-wait"><span class="spinner"></span> Loading devices…</p>`);
  let paired = [];
  try { paired = await system("btPaired"); } catch (e) { list.textContent = "Couldn't list devices: " + e.message; return; }
  list.textContent = "";
  const section = (title, items, action) => {
    if (!items.length) return;
    list.append(html("h4", "qs-sub", title));
    for (const d of items) {
      const row = html("div", "qs-item");
      setHTML(row, `<span class="qs-ico">${icon("bluetooth")}</span><span class="qs-what"><b></b></span><button class="btn"></button>`);
      row.querySelector("b").textContent = d.name;
      const b = row.querySelector("button");
      b.textContent = action.label;
      b.addEventListener("click", async () => {
        b.disabled = true;
        b.textContent = action.busy;
        try {
          const status = await system(action.cmd, { id: d.id });
          b.textContent = /^(Paired|AlreadyPaired|Unpaired|AlreadyUnpaired)$/.test(status) ? action.done : "Didn't work";
          if (b.textContent === "Didn't work") row.append(html("small", "qs-why", `Windows said "${status}". If the device asks for a code, finish in Windows' Bluetooth settings.`));
        } catch (e) { b.textContent = "Didn't work"; row.append(html("small", "qs-why", e.message)); }
        setTimeout(() => drawBluetooth(found), 2000);
      });
      list.append(row);
    }
  };
  section("Your devices", paired, { label: "Remove", busy: "Removing…", done: "Removed", cmd: "btUnpair" });
  section("Found nearby", (found || []).filter(d => !paired.some(p => p.id === d.id)), { label: "Pair", busy: "Pairing…", done: "Paired", cmd: "btPair" });
  if (!paired.length && !found?.length) setHTML(list, `<p class="hint">No devices yet. Put your device in pairing mode and press "Add a device".</p>`);
}
$("#btScan").addEventListener("click", async () => {
  const b = $("#btScan");
  b.disabled = true;
  b.textContent = "Looking…";
  try { await drawBluetooth(await system("btScan")); } catch (e) { sysNote(e.message); }
  b.disabled = false;
  b.textContent = "Add a device";
});

// Night light: a warm layer over all of Aquaris
function applyNight() {
  const n = settings.aquarisNight;
  $("#nightlight").hidden = !n.on;
  $("#nightlight").style.setProperty("--warmth", (n.warmth / 100).toFixed(2));
}
$("#qsNight .qs-on").addEventListener("click", () => save({ aquarisNight: { ...settings.aquarisNight, on: !settings.aquarisNight.on } }).then(drawQuick));
$("#nightWarmth").addEventListener("input", e => { settings.aquarisNight = { ...settings.aquarisNight, warmth: +e.target.value, on: true }; applyNight(); });
$("#nightWarmth").addEventListener("change", () => save({ aquarisNight: settings.aquarisNight }));

const isFullscreen = () => (inChrome ? window.fullScreen : !!document.fullscreenElement);
function toggleFullscreen() {
  if (inChrome) window.fullScreen = !window.fullScreen;
  else document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
}

// Shut down: Aquaris is its own app, so this closes it (everything in it goes with it)
function shutDown() {
  if (!inChrome) return;
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
}

// ================= Desktop icons =================

// Icons sit in a grid. Drag one and let go: it snaps to the nearest free spot (or swaps places).
const CELL = { w: 92, h: 100, x: 16, y: 16 };
function gridSize() {
  const d = deskRect();
  return { cols: Math.max(1, Math.floor((d.width - CELL.x) / CELL.w)), rows: Math.max(1, Math.floor((d.height - CELL.y - 96) / CELL.h)) };
}
function drawIcons() {
  const box = $("#icons");
  box.textContent = "";
  box.hidden = !settings.aquarisDesktopIcons;
  const { cols, rows } = gridSize();
  const spots = { ...settings.aquarisSpots };
  const taken = new Set(Object.values(spots).map(s => s.join()));
  const apps = everyApp().filter(a => !settings.aquarisHidden.includes(a.id));
  // Icons without a spot go into the first free ones, top to bottom, then the next column
  let next = 0;
  for (const app of apps) {
    if (spots[app.id] && spots[app.id][0] < cols && spots[app.id][1] < rows) continue;
    while (taken.has([Math.floor(next / rows), next % rows].join())) next++;
    spots[app.id] = [Math.floor(next / rows), next % rows];
    taken.add(spots[app.id].join());
  }
  apps.forEach((app, i) => {
    const b = html("button", "icon");
    b.setAttribute("role", "listitem");
    b.append(tile(app), html("span", "", app.name));
    b.title = app.about || "";
    b.dataset.app = app.id;
    const [c, r] = spots[app.id];
    b.style.left = CELL.x + c * CELL.w + "px";
    b.style.top = CELL.y + r * CELL.h + "px";
    b.style.transitionDelay = document.body.classList.contains("opening") ? `${0.4 + i * 0.04}s` : "";
    b.addEventListener("dblclick", () => openApp(app));
    b.addEventListener("keydown", e => e.key === "Enter" && openApp(app));
    b.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); appMenu(e, app); });
    b.addEventListener("pointerdown", e => dragIcon(e, b, app, spots));
    box.append(b);
  });
}
function dragIcon(e, b, app, spots) {
  if (e.button !== 0) return;
  $("#icons").querySelectorAll(".on").forEach(x => x.classList.remove("on"));
  b.classList.add("on");
  const sx = e.clientX, sy = e.clientY, left = parseFloat(b.style.left), top = parseFloat(b.style.top);
  let moved = false, held = false;
  try { b.setPointerCapture(e.pointerId); } catch {}
  // Fingers (iPad): a tap opens the app, holding a finger on it shows its menu
  const touch = e.pointerType === "touch";
  const hold = touch ? setTimeout(() => { held = true; appMenu({ clientX: e.clientX, clientY: e.clientY, preventDefault() {}, stopPropagation() {} }, app); }, 550) : 0;
  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < (touch ? 10 : 5)) return;
    clearTimeout(hold);
    moved = true;
    b.classList.add("dragging-icon");
    b.style.left = left + ev.clientX - sx + "px";
    b.style.top = top + ev.clientY - sy + "px";
  };
  const up = () => {
    b.removeEventListener("pointermove", move);
    b.classList.remove("dragging-icon");
    clearTimeout(hold);
    if (!moved) { if (touch && !held && !twoFingersLately()) openApp(app); return; }
    const { cols, rows } = gridSize();
    const c = Math.max(0, Math.min(cols - 1, Math.round((parseFloat(b.style.left) - CELL.x) / CELL.w)));
    const r = Math.max(0, Math.min(rows - 1, Math.round((parseFloat(b.style.top) - CELL.y) / CELL.h)));
    // Someone already there? Swap places.
    const other = Object.keys(spots).find(id => id !== app.id && spots[id][0] === c && spots[id][1] === r);
    if (other) spots[other] = spots[app.id];
    spots[app.id] = [c, r];
    save({ aquarisSpots: spots });
  };
  b.addEventListener("pointermove", move);
  b.addEventListener("pointerup", up, { once: true });
  b.addEventListener("pointercancel", up, { once: true });
}
$("#desktop").addEventListener("pointerdown", e => {
  if (!e.target.closest(".icon")) $("#icons").querySelectorAll(".on").forEach(x => x.classList.remove("on"));
});
addEventListener("resize", () => { clearTimeout(drawIcons.t); drawIcons.t = setTimeout(drawIcons, 200); });

// Right-click the desktop
$("#desktop").addEventListener("contextmenu", e => {
  if (e.target.closest(".win, .icon")) return;
  e.preventDefault();
  const walls = WALLS.map(w => w[0]).filter(w => w !== "own" || settings.aquarisOwnWall);
  showMenu(e, [
    ["Next wallpaper", () => save({ aquarisWall: walls[(walls.indexOf(settings.aquarisWall) + 1) % walls.length] })],
    ["Personalise…", () => openSystem("settings")],
    null,
    ["Add an app…", () => openSystem("add")],
    ["Task manager", () => toggleOverlay("#tasks", true)],
    null,
    [settings.aquarisDesktopIcons ? "Hide desktop icons" : "Show desktop icons", () => save({ aquarisDesktopIcons: !settings.aquarisDesktopIcons })],
    ["Tidy up icons", () => save({ aquarisSpots: {} })]
  ]);
});

// ================= Aquaris's own windows =================

function openSystem(id) {
  closeOverlays();
  ({ settings: openSettings, about: openAbout, add: () => openAddApp() })[id]?.();
}
function nativeWin(id, size) {
  const old = wins.find(w => w.kind === "native" && w.app.id === id);
  if (old) { restore(old); return null; }
  const app = { ...SYSTEM[id], size };
  const win = makeWindow({ app, title: app.name, kind: "native" });
  const page = html("div", "page");
  win.body.append(page);
  return { win, page };
}

function openOwnApp(app) {
  const open = wins.find(w => w.app.id === app.id);
  if (open) return restore(open), open;
  const win = makeWindow({ app, title: app.name, kind: "own" });
  const page = html("div", "page own-" + app.id);
  win.body.append(page);
  ({ notepad: buildNotepad, calculator: buildCalculator, clock: buildClock, aquaapps: buildStore, files: buildFiles, paint: buildPaint, weather: buildWeather })[app.id]?.(page, win);
  return win;
}

// ----- AquaApps: the Aquaris app shop -----
function buildStore(page, win) {
  setHTML(page, `<div class="store">
    <aside class="store-nav">
      <button data-tab="aquaris" class="on">Aquaris apps</button>
      <button data-tab="web">Web apps</button>
      <button data-tab="library">Your library</button>
    </aside>
    <div class="store-main">
      <header class="store-head"><h2></h2><p class="hint"></p></header>
      <div class="store-grid"></div>
    </div></div>`);
  let tab = "aquaris";
  const heads = {
    aquaris: ["Aquaris apps", "Made by Aquaris, for Aquaris. Nothing from the internet, nothing to sign in to."],
    web: ["Web apps", "Websites that work great as apps. Get back any you removed, or add your own."],
    library: ["Your library", "Everything you have in Aquaris."]
  };
  const isIn = a => everyApp().some(x => x.id === a.id);
  const draw = () => {
    page.querySelectorAll(".store-nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
    page.querySelector(".store-head h2").textContent = heads[tab][0];
    page.querySelector(".store-head p").textContent = heads[tab][1];
    const grid = page.querySelector(".store-grid");
    grid.textContent = "";
    const list = tab === "aquaris" ? OWN_APPS.filter(a => a.id !== "aquaapps")
      : tab === "web" ? [...AQUARIS_APPS, ...settings.aquarisApps]
      : everyApp().filter(a => a.id !== "aquaapps");
    for (const app of list) {
      const card = html("div", "store-card");
      card.append(tile(app, "big"));
      const words = html("div", "store-words");
      words.append(html("b", "", app.name), html("small", "", app.about || ""));
      if (app.own) words.append(html("span", "store-tag", "Aquaris original"));
      card.append(words);
      const btns = html("div", "store-btns");
      if (isIn(app)) {
        const open = html("button", "btn primary", "Open");
        open.addEventListener("click", () => openApp(app));
        btns.append(open);
        if (app.id !== "aeris") {
          const rm = html("button", "btn", "Remove");
          rm.addEventListener("click", async () => { await uninstall(app); draw(); });
          btns.append(rm);
        }
      } else {
        const get = html("button", "btn primary", "Get");
        get.addEventListener("click", async () => {
          get.disabled = true;
          get.textContent = "Getting…";
          await new Promise(r => setTimeout(r, 500));
          await install(app);
          draw();
        });
        btns.append(get);
      }
      card.append(btns);
      grid.append(card);
    }
    if (tab === "web") {
      const add = html("button", "store-card store-add");
      add.append(tile(SYSTEM.add, "big"), html("b", "", "Add a website"));
      add.addEventListener("click", () => openSystem("add"));
      grid.append(add);
    }
  };
  page.querySelector(".store-nav").addEventListener("click", e => { if (e.target.dataset.tab) { tab = e.target.dataset.tab; draw(); } });
  win.redraw = draw;
  draw();
}

// ----- Files: like Windows File Explorer -----
// Back / forward / up, an address bar and search; a command bar (New, Cut, Copy, Paste, Rename,
// Delete, Sort, View); your folders and This PC on the left; details or big icons; a status bar.
// Files open in the program Windows uses for them (pictures in Aquaris's viewer). Delete moves
// things to the Recycle Bin. "Paste" copies (or moves, after Cut) inside your own folders.
let fileClip = null; // { mode: "copy" | "cut", paths: [] }
function buildFiles(page) {
  setHTML(page, `<div class="fx">
    <div class="fx-top">
      <button class="ab-btn" data-a="back" title="Back (Alt+Left)">${icon("left")}</button>
      <button class="ab-btn" data-a="forward" title="Forward (Alt+Right)">${icon("right")}</button>
      <button class="ab-btn" data-a="up" title="Up to the folder above (Backspace)">${icon("up")}</button>
      <button class="ab-btn" data-a="refresh" title="Refresh (F5)">${icon("reload")}</button>
      <div class="fx-address"><div class="fx-crumbs"></div><input class="fx-typed" spellcheck="false" hidden></div>
      <label class="fx-search">${icon("search")}<input placeholder="Search" spellcheck="false"></label>
    </div>
    <div class="fx-cmd">
      <button class="fx-c" data-a="new">${icon("plus")}<span>New</span></button>
      <span class="fx-sep"></span>
      <button class="fx-c" data-a="cut" title="Cut (Ctrl+X)">${icon("cut")}</button>
      <button class="fx-c" data-a="copy" title="Copy (Ctrl+C)">${icon("copy")}</button>
      <button class="fx-c" data-a="paste" title="Paste (Ctrl+V)">${icon("paste")}</button>
      <button class="fx-c" data-a="rename" title="Rename (F2)">${icon("rename")}</button>
      <button class="fx-c" data-a="delete" title="Delete (Del)">${icon("trash")}</button>
      <span class="fx-sep"></span>
      <button class="fx-c" data-a="sort">${icon("sort")}<span>Sort</span></button>
      <button class="fx-c" data-a="view">${icon("view")}<span>View</span></button>
      <button class="fx-c" data-a="more" title="More">${icon("more")}</button>
    </div>
    <div class="fx-body">
      <aside class="fx-nav"></aside>
      <div class="fx-main">
        <div class="fx-head"><button data-sort="name">Name</button><button data-sort="when">Date modified</button><button data-sort="type">Type</button><button data-sort="size">Size</button></div>
        <div class="fx-list" tabindex="0"></div>
      </div>
    </div>
    <footer class="fx-status"><span class="fx-count"></span><span class="fx-sel"></span></footer>
  </div>`);
  if (!inChrome) { page.querySelector(".fx-list").textContent = "Files works inside Aeris."; return; }
  const PC = "::pc";
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  // The system's own idea of where these folders are (Windows can move them into OneDrive; Linux has XDG folders)
  const known = (key, name) => {
    for (const k of [key, ...({ Desk: ["XDGDesk"], Pers: ["XDGDocs", "Docs"], DfltDwnld: ["XDGDwnld"], Pict: ["XDGPict"], Music: ["XDGMusic"], Vids: ["XDGVids"] }[key] || [])]) {
      try { return Services.dirsvc.get(k, Ci.nsIFile).path; } catch {}
    }
    return PathUtils.join(home, name);
  };
  const places = [["Home", home, "home"], ["Desktop", known("Desk", "Desktop"), "grid"], ["Downloads", known("DfltDwnld", "Downloads"), "down"], ["Documents", known("Pers", "Documents"), "book"],
    ["Pictures", known("Pict", "Pictures"), "camera"], ["Music", known("Music", "Music"), "music"], ["Videos", known("Vids", "Videos"), "film"]];
  let here = home, back = [], fwd = [], items = [], sel = new Set(), anchor = null, sortBy = "name", sortUp = true, view = "details";
  const $p = s => page.querySelector(s);
  const list = $p(".fx-list");
  const nsFile = path => { const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); f.initWithPath(path); return f; };
  const drives = async () => {
    const out = [];
    if (Services.appinfo.OS === "WINNT") {
      for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        const root = letter + ":\\";
        if (!(await IOUtils.exists(root).catch(() => false))) continue;
        let free = 0, total = 0;
        try { const f = nsFile(root); free = f.diskSpaceAvailable; total = f.diskCapacity; } catch {}
        out.push({ path: root, name: `Local Disk (${letter}:)`, free, total });
      }
    } else {
      // The computer itself, plus USB sticks and other disks (Mac: /Volumes; Linux: /media, /run/media, /mnt)
      const user = PathUtils.filename(home);
      const roots = onMac ? ["/Volumes"] : [`/media/${user}`, `/run/media/${user}`, "/mnt"];
      const disk = (path, name) => { let free = 0, total = 0; try { const f = nsFile(path); free = f.diskSpaceAvailable; total = f.diskCapacity; } catch {} return { path, name, free, total }; };
      out.push(disk("/", onMac ? "Macintosh HD" : "Computer"));
      for (const r of roots) {
        for (const child of await IOUtils.getChildren(r, { ignoreAbsent: true }).catch(() => [])) {
          if (onMac && PathUtils.filename(child) === "Macintosh HD") continue;
          if ((await IOUtils.stat(child).catch(() => null))?.type === "directory") out.push(disk(child, PathUtils.filename(child)));
        }
      }
    }
    return out;
  };
  // The left pane: Home, Quick access (folders you pinned) and This PC
  const iconFor = path => (places.find(pl => pl[1] === path) || [, , "folder"])[2];
  const pinned = () => settings.aquarisQuickAccess ?? places.slice(1).map(pl => pl[1]);
  const pin = async (path, on) => {
    const now = pinned().filter(x => x !== path);
    await save({ aquarisQuickAccess: on ? [...now, path] : now });
    drawNav();
  };
  async function drawNav() {
    const nav = $p(".fx-nav");
    nav.textContent = "";
    const place = (name, path, ic, extra = "") => {
      const b = html("button", "fx-place" + extra);
      b.dataset.path = path;
      setHTML(b, icon(ic));
      b.append(name);
      b.classList.toggle("on", path === here);
      b.addEventListener("click", () => go(path));
      nav.append(b);
      return b;
    };
    place("Home", home, "home");
    nav.append(html("h4", "fx-section", "Quick access"));
    for (const path of pinned()) {
      if (!(await IOUtils.exists(path).catch(() => false))) continue;
      const b = place(nameOf(path), path, iconFor(path));
      b.title = path;
      b.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); showMenu(e, [["Open", () => go(path)], ["Unpin from Quick access", () => pin(path, false)]]); });
      // drag pinned folders to put them in a different order
      b.draggable = true;
      b.addEventListener("dragstart", e => e.dataTransfer.setData("text/aquaris-pin", path));
      b.addEventListener("dragover", e => e.preventDefault());
      b.addEventListener("drop", e => {
        const from = e.dataTransfer.getData("text/aquaris-pin");
        if (!from || from === path) return;
        const list = pinned().filter(x => x !== from);
        list.splice(list.indexOf(path), 0, from);
        save({ aquarisQuickAccess: list }).then(drawNav);
      });
    }
    nav.append(html("h4", "fx-section", "This PC"));
    place("This PC", PC, "pc");
    for (const d of await drives()) place(d.name, d.path, "drive", " fx-drive");
  }
  drawNav();
  const kindOf = it => it.drive ? "drive" : it.dir ? "folder" : /\.(png|jpe?g|gif|webp|bmp|svg|heic|ico)$/i.test(it.name) ? "image" : /\.(mp4|mkv|mov|avi|webm)$/i.test(it.name) ? "film" : /\.(mp3|wav|flac|ogg|m4a)$/i.test(it.name) ? "music" : /\.(txt|md|docx?|pdf|pptx?|xlsx?|odt|rtf)$/i.test(it.name) ? "book" : /\.(zip|rar|7z|gz)$/i.test(it.name) ? "box" : /\.(exe|msi|bat|lnk|cmd)$/i.test(it.name) ? "gear" : "file";
  const TYPES = { txt: "Text Document", md: "Markdown File", pdf: "PDF Document", doc: "Word Document", docx: "Word Document", xls: "Excel Worksheet", xlsx: "Excel Worksheet", ppt: "PowerPoint", pptx: "PowerPoint", png: "PNG image", jpg: "JPEG image", jpeg: "JPEG image", gif: "GIF image", webp: "WebP image", svg: "SVG image", mp3: "MP3 audio", wav: "WAV audio", mp4: "MP4 video", mkv: "MKV video", zip: "Compressed (zipped) Folder", exe: "Application", lnk: "Shortcut", html: "HTML Document", js: "JavaScript File", json: "JSON File", py: "Python File" };
  const typeOf = it => it.drive ? "Local Disk" : it.dir ? "File folder" : TYPES[(it.name.split(".").pop() || "").toLowerCase()] || ((it.name.includes(".") ? it.name.split(".").pop().toUpperCase() + " " : "") + "File");
  const size = n => n < 1024 ? n + " bytes" : n < 1048576 ? Math.ceil(n / 1024) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(1) + " GB";
  const nameOf = p => (p === PC ? "This PC" : PathUtils.filename(p) || p);

  async function go(path, how = "new") {
    if (how === "new" && path !== here) { back.push(here); fwd = []; }
    here = path;
    sel.clear();
    $p(".fx-search input").value = "";
    page.querySelectorAll(".fx-place").forEach(b => b.classList.toggle("on", b.dataset.path === here));
    setHTML(list, `<p class="hint qs-wait"><span class="spinner"></span> Opening…</p>`);
    try {
      if (path === PC) {
        items = (await drives()).map(d => ({ ...d, drive: true, dir: true, size: 0, when: 0 }));
      } else {
        const names = await IOUtils.getChildren(path, { ignoreAbsent: true });
        const win32 = Services.appinfo.OS === "WINNT";
        const stats = await Promise.all(names.slice(0, 5000).map(async n => {
          try {
            if (win32) { const at = await IOUtils.getWindowsAttributes(n); if (at.hidden || at.system) return null; }
            const s = await IOUtils.stat(n);
            return { path: n, name: PathUtils.filename(n), dir: s.type === "directory", size: s.size, when: s.lastModified };
          } catch { return null; }
        }));
        items = stats.filter(s => s && !s.name.startsWith(".") && !/^(desktop\.ini|thumbs\.db|ntuser|appdata$)/i.test(s.name));
      }
    } catch (e) {
      items = [];
      list.textContent = "Can't open this folder: " + (e.message || e);
      return;
    }
    draw();
  }
  function sorted() {
    const q = $p(".fx-search input").value.trim().toLowerCase();
    const shown = items.filter(i => !q || i.name.toLowerCase().includes(q));
    const by = { name: i => i.name.toLowerCase(), when: i => i.when, type: i => typeOf(i), size: i => i.size }[sortBy];
    return shown.sort((a, b) => (b.dir - a.dir) || ((by(a) > by(b) ? 1 : by(a) < by(b) ? -1 : 0) * (sortUp ? 1 : -1)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  let shown = [];
  function draw() {
    // address bar
    const crumbs = $p(".fx-crumbs");
    crumbs.textContent = "";
    const parts = [];
    if (here === PC) parts.push(PC);
    else { let p = here; while (p) { parts.unshift(p); const up = PathUtils.parent(p); if (!up || up === p) break; p = up; } parts.unshift(PC); }
    for (const part of parts) {
      const c = html("button", "fx-crumb", nameOf(part));
      c.addEventListener("click", e => { e.stopPropagation(); go(part); });
      crumbs.append(c);
    }
    page.querySelectorAll(".fx-head button").forEach(b => { b.classList.toggle("on", b.dataset.sort === sortBy); b.dataset.dir = sortUp ? "up" : "down"; });
    list.classList.toggle("icons", view === "icons");
    list.classList.toggle("pc", here === PC);
    $p(".fx-head").hidden = view === "icons" || here === PC;
    shown = sorted();
    list.textContent = "";
    shown.forEach((it, i) => {
      const row = html("div", "fx-item" + (sel.has(it.path) ? " on" : ""));
      row.tabIndex = -1;
      const k = kindOf(it);
      const ic = html("span", "fx-ico k-" + k);
      if (view === "icons" && k === "image" && it.size < 25e6) {
        const img = html("img");
        img.loading = "lazy";
        img.src = PathUtils.toFileURI(it.path);
        img.alt = "";
        ic.append(img);
      } else setHTML(ic, icon(k));
      row.append(ic, html("span", "fx-name", it.name));
      if (it.drive) {
        const used = it.total ? 1 - it.free / it.total : 0;
        const bar = html("span", "fx-cap");
        const fill = html("i");
        fill.style.width = Math.round(used * 100) + "%";
        if (used > 0.9) fill.classList.add("full");
        bar.append(fill);
        row.append(bar, html("span", "fx-meta", it.total ? `${size(it.free)} free of ${size(it.total)}` : ""));
      } else {
        row.append(html("span", "fx-when", it.when ? new Date(it.when).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : ""),
          html("span", "fx-type", typeOf(it)), html("span", "fx-size", it.dir ? "" : size(it.size)));
      }
      row.addEventListener("click", e => select(it, i, e));
      row.addEventListener("dblclick", () => openItem(it));
      row.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        if (!sel.has(it.path)) select(it, i, {});
        itemMenu(e);
      });
      list.append(row);
    });
    if (!shown.length) list.append(html("p", "hint fx-empty", $p(".fx-search input").value ? "No items match your search." : "This folder is empty."));
    status();
  }
  function select(it, i, e) {
    if (e.shiftKey && anchor != null) {
      const [a, b] = [anchor, i].sort((x, y) => x - y);
      if (!e.ctrlKey) sel.clear();
      for (let k = a; k <= b; k++) sel.add(shown[k].path);
    } else if (e.ctrlKey) {
      sel.has(it.path) ? sel.delete(it.path) : sel.add(it.path);
      anchor = i;
    } else {
      sel = new Set([it.path]);
      anchor = i;
    }
    list.querySelectorAll(".fx-item").forEach((r, k) => r.classList.toggle("on", sel.has(shown[k].path)));
    status();
  }
  function status() {
    $p(".fx-count").textContent = `${shown.length} item${shown.length === 1 ? "" : "s"}`;
    const chosen = shown.filter(i => sel.has(i.path));
    const bytes = chosen.filter(i => !i.dir).reduce((s, i) => s + i.size, 0);
    $p(".fx-sel").textContent = chosen.length ? `${chosen.length} item${chosen.length === 1 ? "" : "s"} selected${bytes ? "  " + size(bytes) : ""}` : "";
    const none = !chosen.length || here === PC;
    for (const a of ["cut", "copy", "rename", "delete"]) $p(`[data-a="${a}"]`).disabled = none || (a === "rename" && chosen.length !== 1);
    $p('[data-a="paste"]').disabled = !fileClip || here === PC;
    $p('[data-a="new"]').disabled = here === PC;
    $p('[data-a="back"]').disabled = !back.length;
    $p('[data-a="forward"]').disabled = !fwd.length;
  }
  const chosenItems = () => shown.filter(i => sel.has(i.path));
  function openItem(it) {
    if (it.dir) return go(it.path);
    if (kindOf(it) === "image") return viewPicture(it.path);
    try { nsFile(it.path).launch(); } catch (e) { alertIn(page, "Couldn't open it: " + e.message); }
  }
  // free name for pasting/new items: "name (2).ext"
  async function freeName(dir, name) {
    let n = name, k = 2;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    while (await IOUtils.exists(PathUtils.join(dir, n))) n = `${stem} (${k++})${ext}`;
    return PathUtils.join(dir, n);
  }
  async function act(a, e) {
    if (a === "back" && back.length) { fwd.push(here); go(back.pop(), "hist"); }
    if (a === "forward" && fwd.length) { back.push(here); go(fwd.pop(), "hist"); }
    if (a === "up") { if (here === PC) return; const up = PathUtils.parent(here); go(up && up !== here ? up : PC); }
    if (a === "refresh") go(here, "hist");
    if (a === "new") {
      showMenu(e, [
        ["Folder", async () => { const name = await askText(page, "Name of the new folder", "New folder"); if (name) { await IOUtils.makeDirectory(await freeName(here, cleanName(name))).catch(err => alertIn(page, err.message)); go(here, "hist"); } }],
        ["Text Document", async () => { await IOUtils.writeUTF8(await freeName(here, "New Text Document.txt"), "").catch(err => alertIn(page, err.message)); go(here, "hist"); }]
      ]);
    }
    if (a === "cut" || a === "copy") { fileClip = { mode: a, paths: chosenItems().map(i => i.path) }; status(); }
    if (a === "paste" && fileClip) {
      for (const src of fileClip.paths) {
        if (here === src || here.startsWith(src + "\\") || here.startsWith(src + "/")) { alertIn(page, "Can't put a folder inside itself."); continue; }
        try {
          const dst = await freeName(here, PathUtils.filename(src));
          if (fileClip.mode === "cut") await IOUtils.move(src, dst);
          else await IOUtils.copy(src, dst, { recursive: true });
        } catch (err) { alertIn(page, err.message); }
      }
      if (fileClip.mode === "cut") fileClip = null;
      go(here, "hist");
    }
    if (a === "rename") {
      const it = chosenItems()[0];
      if (!it) return;
      const name = await askText(page, "Rename", it.name);
      if (name && name !== it.name) { await IOUtils.move(it.path, PathUtils.join(here, cleanName(name)), { noOverwrite: true }).catch(err => alertIn(page, err.message)); go(here, "hist"); }
    }
    if (a === "delete") {
      const chosen = chosenItems();
      if (!chosen.length) return;
      if (!(await askYes(page, chosen.length === 1 ? `Move "${chosen[0].name}" to the Recycle Bin?` : `Move these ${chosen.length} items to the Recycle Bin?`))) return;
      for (const it of chosen) { try { await system("recycle", { path: it.path }); } catch (err) { alertIn(page, err.message); break; } }
      go(here, "hist");
    }
    if (a === "sort") {
      const opt = (key, label) => [(sortBy === key ? "✓ " : "   ") + label, () => { sortBy = key; draw(); }];
      showMenu(e, [opt("name", "Name"), opt("when", "Date modified"), opt("type", "Type"), opt("size", "Size"), null,
        [(sortUp ? "✓ " : "   ") + "Ascending", () => { sortUp = true; draw(); }], [(!sortUp ? "✓ " : "   ") + "Descending", () => { sortUp = false; draw(); }]]);
    }
    if (a === "view") showMenu(e, [[(view === "icons" ? "✓ " : "   ") + "Large icons", () => { view = "icons"; draw(); }], [(view === "details" ? "✓ " : "   ") + "Details", () => { view = "details"; draw(); }]]);
    if (a === "more") showMenu(e, [
      ["Select all", () => { sel = new Set(shown.map(i => i.path)); draw(); }],
      ["Copy path", () => clipboard(chosenItems()[0]?.path || here)],
      ...(here !== PC ? [[pinned().includes(here) ? "Unpin this folder from Quick access" : "Pin this folder to Quick access", () => pin(here, !pinned().includes(here))]] : []),
      [onMac ? "Show in Finder" : onLinux ? "Show in the file manager" : "Show in Windows File Explorer", () => { try { nsFile(chosenItems()[0]?.path || (here === PC ? home : here)).reveal(); } catch {} }]
    ]);
  }
  function itemMenu(e) {
    const chosen = chosenItems();
    const one = chosen.length === 1 ? chosen[0] : null;
    showMenu(e, [
      ...(one ? [["Open", () => openItem(one)]] : []),
      ...(one && !one.dir ? [[onWindows ? "Open in Windows" : "Open with its app", () => { try { nsFile(one.path).launch(); } catch {} }]] : []),
      ...(one && one.dir && !one.drive ? [[pinned().includes(one.path) ? "Unpin from Quick access" : "Pin to Quick access", () => pin(one.path, !pinned().includes(one.path))]] : []),
      null,
      ["Cut", () => act("cut")], ["Copy", () => act("copy")],
      ...(one ? [["Rename", () => act("rename")]] : []),
      ["Delete", () => act("delete")],
      null,
      ["Copy as path", () => clipboard(chosen.map(i => i.path).join("\n"))],
      [onMac ? "Show in Finder" : onLinux ? "Show in the file manager" : "Show in Windows File Explorer", () => { try { nsFile(chosen[0].path).reveal(); } catch {} }],
      ...(one ? [["Properties", () => alertIn(page, `${one.name}\n${typeOf(one)}${one.dir ? "" : " · " + size(one.size)}\nModified ${new Date(one.when).toLocaleString()}\n${one.path}`)]] : [])
    ].filter((x, i, arr) => x || (arr[i - 1] && i < arr.length - 1)));
  }
  page.addEventListener("click", e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a && !e.target.closest("[data-a]").disabled) act(a, e);
    const s = e.target.closest("[data-sort]")?.dataset.sort;
    if (s) { sortUp = s === sortBy ? !sortUp : true; sortBy = s; draw(); }
  });
  list.addEventListener("click", e => { if (e.target === list) { sel.clear(); draw(); } });
  list.addEventListener("contextmenu", e => {
    if (e.target.closest(".fx-item")) return;
    e.preventDefault();
    showMenu(e, [
      ["View", null], [(view === "icons" ? "✓ " : "   ") + "Large icons", () => { view = "icons"; draw(); }], [(view === "details" ? "✓ " : "   ") + "Details", () => { view = "details"; draw(); }],
      null,
      ["Refresh", () => go(here, "hist")],
      ...(here !== PC ? [["Paste", () => act("paste")], null, ["New folder", async () => { const name = await askText(page, "Name of the new folder", "New folder"); if (name) { await IOUtils.makeDirectory(await freeName(here, cleanName(name))); go(here, "hist"); } }]] : [])
    ].map(x => (x && x[1] === null ? [x[0], () => {}] : x)));
  });
  $p(".fx-search input").addEventListener("input", draw);
  // Typing an address: click the empty part of the address bar
  $p(".fx-address").addEventListener("click", () => {
    const typed = $p(".fx-typed");
    $p(".fx-crumbs").hidden = true;
    typed.hidden = false;
    typed.value = here === PC ? "This PC" : here;
    typed.select();
  });
  $p(".fx-typed").addEventListener("keydown", async e => {
    if (e.key === "Escape" || e.key === "Enter") {
      const v = e.target.value.trim();
      e.target.hidden = true;
      $p(".fx-crumbs").hidden = false;
      if (e.key === "Enter" && v) { if (/^this pc$/i.test(v)) go(PC); else if (await IOUtils.exists(v)) go(v); else alertIn(page, "Aquaris can't find that folder."); }
    }
  });
  $p(".fx-typed").addEventListener("blur", e => { e.target.hidden = true; $p(".fx-crumbs").hidden = false; });
  page.addEventListener("keydown", e => {
    if (e.target.closest("input")) return;
    const k = e.key, c = e.ctrlKey;
    if (k === "Delete") act("delete");
    else if (k === "F2") act("rename");
    else if (k === "F5") act("refresh");
    else if (k === "Enter" && chosenItems().length === 1) openItem(chosenItems()[0]);
    else if (k === "Backspace" || (e.altKey && k === "ArrowUp")) act("up");
    else if (e.altKey && k === "ArrowLeft") act("back");
    else if (e.altKey && k === "ArrowRight") act("forward");
    else if (c && k.toLowerCase() === "c") act("copy");
    else if (c && k.toLowerCase() === "x") act("cut");
    else if (c && k.toLowerCase() === "v") act("paste");
    else if (c && k.toLowerCase() === "a") { sel = new Set(shown.map(i => i.path)); draw(); }
    else return;
    e.preventDefault();
  });
  go(home, "hist");
}
const cleanName = s => s.replace(/[\\/:*?"<>|]/g, "").trim() || "New folder";
// Small question boxes inside a window
function askText(page, label, value) {
  return new Promise(resolve => {
    const box = html("div", "ask");
    setHTML(box, `<div class="ask-card"><b class="ask-text"></b><input class="ask-input"><div class="ask-buttons"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">OK</button></div></div>`);
    box.querySelector(".ask-text").textContent = label;
    const input = box.querySelector("input");
    input.value = value || "";
    const done = v => { box.remove(); resolve(v); };
    box.addEventListener("click", e => { const a = e.target.closest("[data-a]")?.dataset.a; if (a) done(a === "yes" ? input.value.trim() : null); });
    input.addEventListener("keydown", e => { if (e.key === "Enter") done(input.value.trim()); if (e.key === "Escape") done(null); });
    page.append(box);
    setTimeout(() => input.select(), 30);
  });
}
function askYes(page, text) {
  return new Promise(resolve => {
    const box = html("div", "ask");
    setHTML(box, `<div class="ask-card"><b class="ask-text"></b><div class="ask-buttons"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">Yes</button></div></div>`);
    box.querySelector(".ask-text").textContent = text;
    box.addEventListener("click", e => { const a = e.target.closest("[data-a]")?.dataset.a; if (a) { box.remove(); resolve(a === "yes"); } });
    page.append(box);
  });
}
function alertIn(page, text) {
  const box = html("div", "ask");
  setHTML(box, `<div class="ask-card"><b class="ask-text"></b><div class="ask-buttons"><button class="btn primary">OK</button></div></div>`);
  box.querySelector(".ask-text").textContent = text;
  box.querySelector("button").addEventListener("click", () => box.remove());
  page.append(box);
}
// A simple picture viewer (opened from Files)
function viewPicture(path) {
  const app = { id: "photo:" + path, name: PathUtils.filename(path), color: "#3a4659", ui: "camera", size: [900, 640] };
  const win = makeWindow({ app, title: app.name, kind: "native" });
  const img = html("img", "photo-view");
  img.src = PathUtils.toFileURI(path);
  win.body.append(img);
}

// ----- Paint -----
function buildPaint(page) {
  const COLOURS = ["#111111", "#ffffff", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#00acc1", "#1e88e5", "#5e35b1", "#d81b60", "#6d4c41", "#9e9e9e"];
  setHTML(page, `<div class="paint">
    <div class="paint-tools">
      <div class="seg paint-tool"><button data-t="brush" class="on" title="Brush">${icon("brush")}</button><button data-t="eraser" title="Eraser">${icon("eraser")}</button><button data-t="line" title="Line">${icon("line")}</button><button data-t="rect" title="Rectangle">${icon("square")}</button><button data-t="ellipse" title="Circle">${icon("circle")}</button><button data-t="fill" title="Fill">${icon("bucket")}</button></div>
      <div class="paint-colours"></div>
      <input type="color" class="paint-pick" value="#1e88e5" title="Any colour">
      <label class="paint-size">Size <input type="range" min="1" max="60" value="6"></label>
      <span class="tb-space"></span>
      <button class="ab-btn" data-a="undo" title="Undo (Ctrl+Z)">${icon("undo")}</button>
      <button class="ab-btn" data-a="redo" title="Redo (Ctrl+Y)">${icon("redo")}</button>
      <button class="btn" data-a="open">Open…</button>
      <button class="btn" data-a="clear">Clear</button>
      <button class="btn primary" data-a="save">Save…</button>
    </div>
    <div class="paint-stage"><canvas width="1600" height="1000"></canvas></div></div>`);
  const canvas = page.querySelector("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let tool = "brush", colour = "#1e88e5", sizeV = 6, undo = [], redo = [];
  const pal = page.querySelector(".paint-colours");
  for (const c of COLOURS) {
    const b = html("button", "paint-colour");
    b.style.background = c;
    b.addEventListener("click", () => { colour = c; page.querySelector(".paint-pick").value = c; });
    pal.append(b);
  }
  page.querySelector(".paint-pick").addEventListener("input", e => (colour = e.target.value));
  page.querySelector(".paint-size input").addEventListener("input", e => (sizeV = +e.target.value));
  page.querySelector(".paint-tool").addEventListener("click", e => {
    const b = e.target.closest("[data-t]");
    if (!b) return;
    tool = b.dataset.t;
    page.querySelectorAll(".paint-tool button").forEach(x => x.classList.toggle("on", x === b));
  });
  const snapshot = () => { undo.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); if (undo.length > 30) undo.shift(); redo = []; };
  const at = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
  let drawing = false, start = null, base = null, last = null;
  canvas.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    snapshot();
    const [x, y] = at(e);
    if (tool === "fill") return fill(Math.round(x), Math.round(y));
    drawing = true;
    start = [x, y];
    last = [x, y];
    base = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (tool === "brush" || tool === "eraser") stroke(x, y, x, y);
  });
  canvas.addEventListener("pointermove", e => {
    if (!drawing) return;
    const [x, y] = at(e);
    if (tool === "brush" || tool === "eraser") { stroke(last[0], last[1], x, y); last = [x, y]; return; }
    ctx.putImageData(base, 0, 0);
    shape(start[0], start[1], x, y);
  });
  canvas.addEventListener("pointerup", () => (drawing = false));
  function stroke(x1, y1, x2, y2) {
    ctx.strokeStyle = tool === "eraser" ? "#fff" : colour;
    ctx.lineWidth = sizeV * (tool === "eraser" ? 2 : 1);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  function shape(x1, y1, x2, y2) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = sizeV;
    ctx.beginPath();
    if (tool === "line") { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    if (tool === "rect") ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    if (tool === "ellipse") ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  function fill(x, y) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data, W = canvas.width, H = canvas.height;
    const i0 = (y * W + x) * 4, target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const n = parseInt(colour.slice(1), 16), to = [n >> 16, (n >> 8) & 255, n & 255, 255];
    if (target.every((v, k) => Math.abs(v - to[k]) < 4)) return;
    const same = i => Math.abs(d[i] - target[0]) + Math.abs(d[i + 1] - target[1]) + Math.abs(d[i + 2] - target[2]) + Math.abs(d[i + 3] - target[3]) < 40;
    const stack = [[x, y]];
    while (stack.length) {
      const [px, py] = stack.pop();
      let i = (py * W + px) * 4;
      if (px < 0 || py < 0 || px >= W || py >= H || !same(i)) continue;
      d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2]; d[i + 3] = 255;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    ctx.putImageData(img, 0, 0);
  }
  const doUndo = () => { if (!undo.length) return; redo.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); ctx.putImageData(undo.pop(), 0, 0); };
  const doRedo = () => { if (!redo.length) return; undo.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); ctx.putImageData(redo.pop(), 0, 0); };
  page.tabIndex = 0;
  page.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); }
  });
  page.addEventListener("click", e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "undo") doUndo();
    if (a === "redo") doRedo();
    if (a === "clear") { snapshot(); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    if (a === "save" && inChrome) {
      const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window.browsingContext, "Save picture", Ci.nsIFilePicker.modeSave);
      fp.appendFilter("PNG picture", "*.png");
      fp.defaultString = "My painting.png";
      fp.open(r => {
        if (r === Ci.nsIFilePicker.returnCancel) return;
        canvas.toBlob(async blob => IOUtils.write(fp.file.path, new Uint8Array(await blob.arrayBuffer())), "image/png");
      });
    }
    if (a === "open" && inChrome) {
      const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window.browsingContext, "Open picture", Ci.nsIFilePicker.modeOpen);
      fp.appendFilters(Ci.nsIFilePicker.filterImages);
      fp.open(r => {
        if (r !== Ci.nsIFilePicker.returnOK) return;
        const img = new Image();
        img.onload = () => {
          snapshot();
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const s = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight, 1);
          ctx.drawImage(img, 0, 0, img.naturalWidth * s, img.naturalHeight * s);
        };
        img.src = PathUtils.toFileURI(fp.file.path);
      });
    }
  });
}

// ----- Weather (from Open-Meteo, free and with no account) -----
const WEATHER_WORDS = { 0: ["Clear", "sun"], 1: ["Mostly clear", "sun"], 2: ["Partly cloudy", "cloud"], 3: ["Cloudy", "cloud"], 45: ["Fog", "cloud"], 48: ["Fog", "cloud"], 51: ["Drizzle", "rain"], 53: ["Drizzle", "rain"], 55: ["Drizzle", "rain"], 61: ["Rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain"], 71: ["Snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 80: ["Showers", "rain"], 81: ["Showers", "rain"], 82: ["Heavy showers", "rain"], 95: ["Thunderstorm", "storm"], 96: ["Thunderstorm", "storm"], 99: ["Thunderstorm", "storm"] };
function buildWeather(page) {
  setHTML(page, `<div class="wx">
    <div class="wx-find"><input placeholder="Search for a town or city" spellcheck="false"><button class="btn primary">Find</button></div>
    <div class="wx-results"></div>
    <div class="wx-now"></div>
    <div class="wx-days"></div>
    <p class="hint wx-credit">Weather from Open-Meteo.</p></div>`);
  const input = page.querySelector("input");
  const find = async () => {
    const q = input.value.trim();
    if (!q) return;
    const res = page.querySelector(".wx-results");
    setHTML(res, `<p class="hint qs-wait"><span class="spinner"></span> Looking…</p>`);
    try {
      const data = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6`)).json();
      res.textContent = "";
      for (const p of data.results || []) {
        const b = html("button", "wx-place", [p.name, p.admin1, p.country].filter(Boolean).join(", "));
        b.addEventListener("click", async () => { res.textContent = ""; await save({ aquarisWeather: { name: p.name, lat: p.latitude, lon: p.longitude } }); show(); });
        res.append(b);
      }
      if (!data.results?.length) res.textContent = "No places found.";
    } catch { res.textContent = "Couldn't search. Are you online?"; }
  };
  page.querySelector(".wx-find button").addEventListener("click", find);
  input.addEventListener("keydown", e => e.key === "Enter" && find());
  async function show() {
    const place = settings.aquarisWeather;
    const now = page.querySelector(".wx-now"), days = page.querySelector(".wx-days");
    if (!place) { now.textContent = "Search for your town to see its weather."; return; }
    setHTML(now, `<p class="hint qs-wait"><span class="spinner"></span> Getting the weather…</p>`);
    try {
      const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`)).json();
      const [word, ic] = WEATHER_WORDS[w.current.weather_code] || ["", "cloud"];
      setHTML(now, `<span class="wx-ico">${icon(ic)}</span><div><b class="wx-temp"></b><span class="wx-word"></span><small class="wx-more"></small></div>`);
      now.querySelector(".wx-temp").textContent = Math.round(w.current.temperature_2m) + "°";
      now.querySelector(".wx-word").textContent = `${word} in ${place.name}`;
      now.querySelector(".wx-more").textContent = `Feels like ${Math.round(w.current.apparent_temperature)}° · wind ${Math.round(w.current.wind_speed_10m)} km/h · humidity ${w.current.relative_humidity_2m}%`;
      days.textContent = "";
      w.daily.time.forEach((d, i) => {
        const [dw, di] = WEATHER_WORDS[w.daily.weather_code[i]] || ["", "cloud"];
        const c = html("div", "wx-day");
        setHTML(c, `<b></b>${icon(di)}<span></span>`);
        c.querySelector("b").textContent = i === 0 ? "Today" : new Date(d).toLocaleDateString([], { weekday: "short" });
        c.querySelector("span").textContent = `${Math.round(w.daily.temperature_2m_max[i])}° / ${Math.round(w.daily.temperature_2m_min[i])}°`;
        c.title = dw;
        days.append(c);
      });
    } catch { now.textContent = "Couldn't get the weather. Are you online?"; }
  }
  show();
}

// ----- Notepad: notes that save by themselves -----
function buildNotepad(page) {
  setHTML(page, `<aside class="np-list"><button class="btn primary np-new">New note</button><div class="np-notes"></div></aside>
    <div class="np-edit"><textarea spellcheck="true" placeholder="Start writing…"></textarea>
    <footer class="np-foot"><span class="np-count"></span><span class="tb-space"></span><button class="btn np-save">Save as a file…</button><button class="btn np-del">Delete</button></footer></div>`);
  const area = page.querySelector("textarea");
  let current = settings.aquarisNotes[0]?.id;
  const notes = () => settings.aquarisNotes;
  const title = n => (n.text.trim().split("\n")[0] || "Empty note").slice(0, 40);
  const draw = () => {
    const list = page.querySelector(".np-notes");
    list.textContent = "";
    for (const n of notes()) {
      const b = html("button", "np-note" + (n.id === current ? " on" : ""), title(n));
      b.addEventListener("click", () => { current = n.id; show(); });
      list.append(b);
    }
  };
  const show = () => {
    const n = notes().find(n => n.id === current) || notes()[0];
    current = n.id;
    area.value = n.text;
    count();
    draw();
  };
  const count = () => {
    const words = area.value.trim() ? area.value.trim().split(/\s+/).length : 0;
    page.querySelector(".np-count").textContent = `${words} word${words === 1 ? "" : "s"} · saved`;
  };
  let timer = 0;
  area.addEventListener("input", () => {
    const n = notes().find(n => n.id === current);
    n.text = area.value;
    page.querySelector(".np-count").textContent = "Saving…";
    clearTimeout(timer);
    timer = setTimeout(() => { store.set({ aquarisNotes: notes() }); count(); draw(); }, 500);
  });
  page.querySelector(".np-new").addEventListener("click", () => {
    const n = { id: crypto.randomUUID(), text: "" };
    settings.aquarisNotes = [n, ...notes()];
    store.set({ aquarisNotes: settings.aquarisNotes });
    current = n.id;
    show();
    area.focus();
  });
  page.querySelector(".np-del").addEventListener("click", () => {
    settings.aquarisNotes = notes().filter(n => n.id !== current);
    if (!settings.aquarisNotes.length) settings.aquarisNotes = [{ id: crypto.randomUUID(), text: "" }];
    store.set({ aquarisNotes: settings.aquarisNotes });
    current = settings.aquarisNotes[0].id;
    show();
  });
  page.querySelector(".np-save").addEventListener("click", () => {
    if (!inChrome) return;
    // The computer's own "Save as" box
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window.browsingContext, "Save note", Ci.nsIFilePicker.modeSave);
    fp.appendFilter("Text", "*.txt");
    fp.defaultString = title(notes().find(n => n.id === current)).replace(/[\\/:*?"<>|]/g, "") + ".txt";
    fp.open(r => { if (r !== Ci.nsIFilePicker.returnCancel) IOUtils.writeUTF8(fp.file.path, area.value); });
  });
  show();
}

// ----- Calculator -----
function buildCalculator(page) {
  setHTML(page, `<div class="calc"><div class="calc-screen"><small class="calc-sum"></small><b class="calc-out">0</b></div><div class="calc-keys"></div></div>`);
  const keys = ["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "±", "0", ".", "="];
  let sum = "", shown = "0";
  const out = page.querySelector(".calc-out"), top = page.querySelector(".calc-sum");
  const draw = () => { out.textContent = shown; top.textContent = sum; };
  const work = text => {
    // Only digits, brackets, dots and + − × ÷ get here, worked out by hand (no eval)
    const tokens = text.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").match(/\d*\.?\d+|[()+\-*/]/g) || [];
    let i = 0;
    const peek = () => tokens[i], take = () => tokens[i++];
    const unit = () => {
      if (peek() === "-") { take(); return -unit(); }
      if (peek() === "(") { take(); const v = add(); take(); return v; }
      const n = parseFloat(take());
      if (Number.isNaN(n)) throw new Error("bad");
      return n;
    };
    const mul = () => { let v = unit(); while (peek() === "*" || peek() === "/") { const o = take(), r = unit(); v = o === "*" ? v * r : v / r; } return v; };
    const add = () => { let v = mul(); while (peek() === "+" || peek() === "-") { const o = take(), r = mul(); v = o === "+" ? v + r : v - r; } return v; };
    const v = add();
    if (i !== tokens.length || !Number.isFinite(v)) throw new Error("bad");
    return +v.toPrecision(12);
  };
  const press = k => {
    if (k === "C") { sum = ""; shown = "0"; }
    else if (k === "=") {
      try { const v = work(sum); top.textContent = sum + " ="; shown = String(v); sum = String(v); out.textContent = shown; return; }
      catch { shown = "Oops"; }
    } else if (k === "±") { sum = sum ? `−(${sum})` : ""; shown = sum || "0"; }
    else { sum += k; shown = sum; }
    draw();
  };
  const grid = page.querySelector(".calc-keys");
  for (const k of keys) {
    const b = html("button", "calc-key" + (/[÷×−+=]/.test(k) ? " op" : k === "C" ? " clear" : ""), k);
    b.addEventListener("click", () => press(k));
    grid.append(b);
  }
  page.tabIndex = 0;
  page.addEventListener("keydown", e => {
    const map = { "*": "×", "/": "÷", "-": "−", Enter: "=", Escape: "C", Backspace: "C" };
    const k = map[e.key] || e.key;
    if (keys.includes(k)) { e.preventDefault(); press(k); }
  });
  setTimeout(() => page.focus(), 50);
  draw();
}

// ----- Clock: the time, a stopwatch and a timer -----
function buildClock(page, win) {
  setHTML(page, `<div class="seg clk-tabs"><button data-t="clock" class="on">Clock</button><button data-t="stop">Stopwatch</button><button data-t="timer">Timer</button></div>
    <div class="clk-face"><b class="clk-big"></b><small class="clk-small"></small></div>
    <div class="row clk-ctl"></div>`);
  let mode = "clock", swStart = 0, swRun = 0, swOn = false, tEnd = 0, tLeft = 5 * 60000, tOn = false;
  const big = page.querySelector(".clk-big"), small = page.querySelector(".clk-small"), ctl = page.querySelector(".clk-ctl");
  const two = n => String(Math.floor(n)).padStart(2, "0");
  const dur = ms => `${two(ms / 60000)}:${two((ms / 1000) % 60)}${mode === "stop" ? "." + two((ms / 10) % 100) : ""}`;
  const button = (label, fn, primary) => { const b = html("button", "btn" + (primary ? " primary" : ""), label); b.addEventListener("click", fn); ctl.append(b); };
  const controls = () => {
    ctl.textContent = "";
    if (mode === "stop") {
      button(swOn ? "Pause" : "Start", () => { if (swOn) { swRun += Date.now() - swStart; swOn = false; } else { swStart = Date.now(); swOn = true; } controls(); }, true);
      button("Reset", () => { swOn = false; swRun = 0; controls(); });
    }
    if (mode === "timer") {
      for (const m of [1, 5, 10, 25]) button(`${m} min`, () => { tOn = false; tLeft = m * 60000; controls(); });
      button(tOn ? "Pause" : "Start", () => { if (tOn) { tLeft = tEnd - Date.now(); tOn = false; } else { tEnd = Date.now() + tLeft; tOn = true; } controls(); }, true);
    }
  };
  const tick = () => {
    if (!wins.includes(win)) return clearInterval(timer);
    const now = new Date();
    if (mode === "clock") { big.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); small.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
    if (mode === "stop") { big.textContent = dur(swRun + (swOn ? Date.now() - swStart : 0)); small.textContent = ""; }
    if (mode === "timer") {
      let left = tOn ? tEnd - Date.now() : tLeft;
      if (tOn && left <= 0) { tOn = false; tLeft = 0; left = 0; controls(); restore(win); small.textContent = "Time's up!"; }
      big.textContent = dur(Math.max(0, left));
      if (left > 0) small.textContent = tOn ? "Counting down" : "";
    }
  };
  page.querySelector(".clk-tabs").addEventListener("click", e => {
    if (!e.target.dataset.t) return;
    mode = e.target.dataset.t;
    page.querySelectorAll(".clk-tabs button").forEach(b => b.classList.toggle("on", b === e.target));
    controls();
    tick();
  });
  const timer = setInterval(tick, 50);
  tick();
}

const SYMBOLS = ["star", "heart", "music", "chat", "video", "camera", "book", "game", "code", "pencil", "cart", "film", "cloud", "mail", "globe", "school"];

// Add an app, or change one you added (edit = that app)
function openAddApp(edit = null) {
  const made = nativeWin("add", [540, 640]);
  if (!made) return;
  const { win, page } = made;
  const draft = edit ? { ...edit } : { color: "#2a86e8", letter: "" };
  setHTML(page, `
    <h2>${edit ? "Change app" : "Add an app"}</h2>
    <p class="hint">Any website can be an app. It gets its own window, a place in the launcher and in the dock.</p>
    <label class="field"><span>Website address</span><input id="addUrl" type="url" placeholder="canva.com"></label>
    <label class="field"><span>Name</span><input id="addName" type="text" placeholder="Canva"></label>
    <section class="icon-maker">
      <h3>Icon</h3>
      <div class="im-top">
        <span class="im-preview"></span>
        <div class="seg im-tabs"><button data-t="design" class="on">Design one</button><button data-t="picture">Use a picture</button></div>
      </div>
      <div class="im-design">
        <label class="row between"><span>Colour</span><input id="imColor" type="color"></label>
        <div class="im-symbols"></div>
        <label class="row between"><span>Or a letter or two</span><input id="imLetter" type="text" maxlength="2" placeholder="Aa"></label>
      </div>
      <div class="im-picture" hidden>
        <p class="hint">Pick a picture from your computer. It's cut into a square and shrunk to icon size.</p>
        <button class="btn" id="imPick">Choose a picture…</button>
        <input id="imFile" type="file" accept="image/*" hidden>
      </div>
    </section>
    <div class="row"><button class="btn primary" id="addGo"></button><span class="hint" id="addMsg"></span></div>`);
  const url = page.querySelector("#addUrl"), name = page.querySelector("#addName");
  const go = page.querySelector("#addGo");
  go.textContent = edit ? "Save" : "Add app";
  url.value = edit?.url || "";
  name.value = edit?.name || "";
  const preview = page.querySelector(".im-preview");
  const draw = () => {
    preview.replaceChildren(tile({ ...draft, name: name.value || "?", url: null }, "big"));
    page.querySelectorAll(".im-symbol").forEach(b => b.classList.toggle("on", b.dataset.s === draft.symbol));
  };
  // Symbols to choose from
  const grid = page.querySelector(".im-symbols");
  for (const s of SYMBOLS) {
    const b = html("button", "im-symbol");
    b.dataset.s = s;
    b.title = s;
    setHTML(b, icon(s));
    b.addEventListener("click", () => { Object.assign(draft, { symbol: s, letter: "", image: "" }); page.querySelector("#imLetter").value = ""; draw(); });
    grid.append(b);
  }
  const color = page.querySelector("#imColor");
  color.value = draft.color || "#2a86e8";
  color.addEventListener("input", () => { draft.color = color.value; draw(); });
  const letter = page.querySelector("#imLetter");
  letter.value = draft.letter || "";
  letter.addEventListener("input", () => { Object.assign(draft, { letter: letter.value.trim(), symbol: "", image: "" }); draw(); });
  name.addEventListener("input", draw);
  // Design / picture tabs
  const tabs = page.querySelector(".im-tabs");
  const showTab = which => {
    tabs.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.t === which));
    page.querySelector(".im-design").hidden = which !== "design";
    page.querySelector(".im-picture").hidden = which !== "picture";
  };
  tabs.addEventListener("click", e => e.target.dataset.t && showTab(e.target.dataset.t));
  if (draft.image) showTab("picture");
  page.querySelector("#imPick").addEventListener("click", () => page.querySelector("#imFile").click());
  page.querySelector("#imFile").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    draft.image = await squareIcon(file);
    Object.assign(draft, { symbol: "", letter: "" });
    draw();
  });
  url.addEventListener("change", () => {
    try { if (!name.value) name.value = new URL(/^https?:/.test(url.value) ? url.value : "https://" + url.value).hostname.replace(/^www\./, "").split(".")[0].replace(/^./, c => c.toUpperCase()); } catch {}
    draw();
  });
  go.addEventListener("click", async () => {
    let u = url.value.trim();
    if (!u) return (page.querySelector("#addMsg").textContent = "Type the website's address first.");
    if (!/^https?:\/\//.test(u)) u = "https://" + u;
    try { new URL(u); } catch { return (page.querySelector("#addMsg").textContent = "That doesn't look like a website address."); }
    const app = { ...draft, id: edit?.id || "my-" + crypto.randomUUID().slice(0, 8), name: name.value.trim() || new URL(u).hostname.replace(/^www\./, ""), url: u, about: new URL(u).hostname };
    if (edit) {
      await save({ aquarisApps: settings.aquarisApps.map(a => (a.id === app.id ? app : a)) });
      for (const w of wins.filter(w => w.app.id === app.id)) { w.app = app; w.name.textContent = app.name; }
      closeWin(win);
    } else {
      await save({ aquarisApps: [...settings.aquarisApps, app], aquarisPinned: [...settings.aquarisPinned, app.id] });
      closeWin(win);
      openApp(app);
    }
  });
  draw();
  setTimeout(() => (edit ? name : url).focus(), 60);
}

// A picture → a 128×128 square icon (cut from the middle), as a data address to keep
function squareIcon(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Take an app out of Aquaris (AquaApps can bring it back)
async function uninstall(app) {
  for (const w of wins.filter(w => w.app.id === app.id)) closeWin(w);
  await save({ aquarisRemoved: [...new Set([...settings.aquarisRemoved, app.id])], aquarisGot: settings.aquarisGot.filter(i => i !== app.id), aquarisPinned: settings.aquarisPinned.filter(i => i !== app.id) });
}
async function install(app) {
  await save({ aquarisRemoved: settings.aquarisRemoved.filter(i => i !== app.id), aquarisGot: app.own && !app.pre ? [...new Set([...settings.aquarisGot, app.id])] : settings.aquarisGot });
}

async function removeApp(app) {
  for (const w of wins.filter(w => w.app.id === app.id)) closeWin(w);
  await save({ aquarisApps: settings.aquarisApps.filter(a => a.id !== app.id), aquarisPinned: settings.aquarisPinned.filter(i => i !== app.id) });
}

const WALLS = [["auto", "Matches the style"], ["tide", "Tide"], ["dusk", "Dusk"], ["hills", "Aeris hills"], ["aqua", "Aqua"], ["own", "Your picture"]];

function openSettings() {
  const made = nativeWin("settings", [640, 620]);
  if (!made) return;
  const { page } = made;
  setHTML(page, `
    <h2>Settings</h2>
    <section>
      <h3>Style</h3>
      <div class="cards" id="setStyle">
        <button data-v="minimal" class="card c-minimal"><i></i><b>Minimal</b><small>Calm glass, soft depth, light or dark</small></button>
        <button data-v="aqua" class="card c-aqua"><i></i><b>Frutiger Aqua</b><small>Shiny, bubbly candy-blue gel</small></button>
      </div>
      <h3>Aeris themes</h3>
      <div class="theme-grid" id="setThemes"></div>
      <div class="row between"><span>Appearance</span><div class="seg" id="setMode"><button data-v="auto">Auto</button><button data-v="light">Light</button><button data-v="dark">Dark</button></div></div>
      <div class="row between"><span>Glass</span><div class="qs-slider"><small>Clear</small><input id="setGlass" type="range" min="0" max="100"><small>Frosted</small></div></div>
      <label class="row between switch"><span>Less motion</span><input type="checkbox" id="setMotion"></label>
    </section>
    <section>
      <h3>Wallpaper</h3>
      <div class="walls"></div>
      <input id="wallFile" type="file" accept="image/*" hidden>
    </section>
    <section>
      <h3>Personalise</h3>
      <div class="row between"><span>Window corners</span><div class="qs-slider"><small>Square</small><input id="setRadius" type="range" min="0" max="22"><small>Round</small></div></div>
      <div class="row between"><span>Window buttons</span><div class="seg" id="setButtons"><button data-v="windows">Windows style</button><button data-v="mac">Mac style</button></div></div>
      <div class="row between"><span>Dock size</span><div class="qs-slider"><small>Small</small><input id="setDock" type="range" min="34" max="64"><small>Big</small></div></div>
      <label class="row between switch"><span>Show the clock</span><input type="checkbox" id="setClock"></label>
      <div class="row between"><span>Pointer</span><div class="seg" id="setCursor"><button data-v="normal">Normal</button><button data-v="aquaris">Aquaris</button><button data-v="own">Your own…</button></div></div>
      <div class="row between"><span>Pointer size</span><div class="qs-slider"><small>Small</small><input id="setCursorSize" type="range" min="16" max="64" step="4"><small>Big</small></div></div>
      <input id="cursorFile" type="file" accept="image/*" hidden>
      <div class="row between"><span>Words on the desktop</span><input id="setDeskText" class="set-input" maxlength="40" placeholder="Nothing"></div>
      <label class="row between switch"><span>Start-up animation and sound</span><input type="checkbox" id="setIntro"></label>
    </section>
    <section>
      <h3>Desktop</h3>
      <label class="row between switch"><span>Show app icons on the desktop</span><input type="checkbox" id="setIcons"></label>
      <div class="row between"><span>Nap minimised apps after</span>
        <select id="napAfter"><option value="1">1 minute</option><option value="3">3 minutes</option><option value="10">10 minutes</option><option value="30">30 minutes</option><option value="0">Never</option></select>
      </div>
      <p class="hint">A napping app is unloaded, so it uses no memory. It wakes up when you open it. Music apps keep playing.</p>
    </section>
    <section class="computer-only">
      <h3>Aquaris on your computer</h3>
      <p class="hint">Aquaris is its own app with its own sign-ins, kept apart from your normal Aeris.</p>
      <label class="row between switch"><span>Start Aquaris when my computer starts</span><input type="checkbox" id="setAutostart"></label>
      <div class="row"><button class="btn" id="makeShortcut">Put an Aquaris shortcut on the desktop</button><span class="hint" id="shortcutMsg"></span></div>
    </section>`);
  const sync = () => {
    page.querySelectorAll("#setStyle .card, #setThemes .theme-chip").forEach(b => b.classList.toggle("on", b.dataset.v === settings.aquarisTheme));
    page.querySelectorAll("#setMode button").forEach(b => b.classList.toggle("on", b.dataset.v === settings.aquarisMode));
    page.querySelector("#setGlass").value = settings.aquarisGlass;
    page.querySelector("#setMotion").checked = settings.aquarisLessMotion;
    page.querySelector("#setIcons").checked = settings.aquarisDesktopIcons;
    page.querySelector("#setAutostart").checked = settings.aquarisAutostart;
    const L = settings.aquarisLookMore;
    page.querySelector("#setRadius").value = L.radius;
    page.querySelectorAll("#setButtons button").forEach(b => b.classList.toggle("on", b.dataset.v === L.buttons));
    page.querySelector("#setDock").value = L.dock;
    page.querySelector("#setClock").checked = L.clock;
    page.querySelectorAll("#setCursor button").forEach(b => b.classList.toggle("on", b.dataset.v === L.cursor));
    page.querySelector("#setCursorSize").value = L.cursorSize;
    if (document.activeElement !== page.querySelector("#setDeskText")) page.querySelector("#setDeskText").value = L.deskText;
    page.querySelector("#setIntro").checked = L.intro;
    page.querySelectorAll(".walls button").forEach(b => b.classList.toggle("on", b.dataset.v === settings.aquarisWall));
  };
  page.querySelector("#setStyle").addEventListener("click", e => { const b = e.target.closest(".card"); if (b) save({ aquarisTheme: b.dataset.v }).then(sync); });
  for (const th of aerisThemes) {
    const b = html("button", "theme-chip");
    b.dataset.v = th.id;
    b.style.background = `linear-gradient(135deg, ${th.a}, ${th.b})`;
    b.style.color = th.light ? "#18202c" : "#fff";
    b.append(html("span", "", th.name));
    b.addEventListener("click", () => save({ aquarisTheme: th.id }).then(sync));
    page.querySelector("#setThemes").append(b);
  }
  page.querySelector("#setMode").addEventListener("click", e => e.target.dataset.v && save({ aquarisMode: e.target.dataset.v }).then(sync));
  page.querySelector("#setGlass").addEventListener("input", e => { settings.aquarisGlass = +e.target.value; applyLook(); });
  page.querySelector("#setGlass").addEventListener("change", e => save({ aquarisGlass: +e.target.value }));
  page.querySelector("#setMotion").addEventListener("change", e => save({ aquarisLessMotion: e.target.checked }));
  page.querySelector("#setIcons").addEventListener("change", e => save({ aquarisDesktopIcons: e.target.checked }));
  const look = changes => save({ aquarisLookMore: { ...settings.aquarisLookMore, ...changes } }).then(sync);
  page.querySelector("#setRadius").addEventListener("input", e => { settings.aquarisLookMore.radius = +e.target.value; applyLook(); });
  page.querySelector("#setRadius").addEventListener("change", e => look({ radius: +e.target.value }));
  page.querySelector("#setButtons").addEventListener("click", e => e.target.dataset.v && look({ buttons: e.target.dataset.v }));
  page.querySelector("#setDock").addEventListener("input", e => { settings.aquarisLookMore.dock = +e.target.value; applyLook(); });
  page.querySelector("#setDock").addEventListener("change", e => look({ dock: +e.target.value }));
  page.querySelector("#setClock").addEventListener("change", e => look({ clock: e.target.checked }));
  page.querySelector("#setCursor").addEventListener("click", e => {
    const v = e.target.dataset.v;
    if (v === "own") return page.querySelector("#cursorFile").click();
    if (v) look({ cursor: v });
  });
  page.querySelector("#cursorFile").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (file) look({ cursor: "own", ownCursor: await squareIcon(file) });
  });
  page.querySelector("#setCursorSize").addEventListener("change", e => look({ cursorSize: +e.target.value }));
  page.querySelector("#setDeskText").addEventListener("input", e => look({ deskText: e.target.value }));
  page.querySelector("#setIntro").addEventListener("change", e => look({ intro: e.target.checked }));
  page.querySelector("#setAutostart").addEventListener("change", async e => {
    await save({ aquarisAutostart: e.target.checked });
    setAutostart(e.target.checked).catch(err => console.error("Aquaris autostart:", err));
  });
  const walls = page.querySelector(".walls");
  for (const [id, name] of WALLS) {
    const b = html("button", "wall w-" + id);
    b.dataset.v = id;
    b.append(html("span", "", name));
    if (id === "own" && settings.aquarisOwnWall) b.style.backgroundImage = `url("${settings.aquarisOwnWall}")`;
    b.addEventListener("click", () => (id === "own" ? page.querySelector("#wallFile").click() : save({ aquarisWall: id }).then(sync)));
    walls.append(b);
  }
  page.querySelector("#wallFile").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = async () => {
      await save({ aquarisOwnWall: r.result, aquarisWall: "own" });
      walls.querySelector(".w-own").style.backgroundImage = `url("${r.result}")`;
      sync();
    };
    r.readAsDataURL(file);
  });
  const nap = page.querySelector("#napAfter");
  nap.value = String(settings.aquarisNapAfter);
  nap.addEventListener("change", () => save({ aquarisNapAfter: +nap.value }));
  page.querySelector("#makeShortcut").addEventListener("click", async () => {
    const msg = page.querySelector("#shortcutMsg");
    try {
      await makeShortcut();
      msg.textContent = "Done. Look for Aquaris on your desktop.";
    } catch (e) {
      msg.textContent = "That didn't work: " + (e.message || e);
    }
  });
  sync();
}

function openAbout() {
  const made = nativeWin("about", [520, 470]);
  if (!made) return;
  setHTML(made.page, `
    <div class="about-head"><span class="about-logo"></span><div><h2>Aquaris</h2><p class="hint">A desktop made of web apps, running on Aeris's engine</p></div></div>
    <p>Apps like Discord and Zoom on your computer are really websites, each packed with its own copy of a whole browser. Five of them means five browsers running at once. In Aquaris they're the website versions, all sharing <b>one</b> engine, so they use much less memory.</p>
    <h3>Tips</h3>
    <ul>
      <li>Press <kbd>Ctrl</kbd> + <kbd>Space</kbd> to search for anything.</li>
      <li>Drag a window to the top to fill the screen, to a side for half, or to a corner for a quarter.</li>
      <li>Minimised apps nap after a few minutes and wake up when you click them.</li>
      <li>Aeris opens from the dock. Links in it stay in its window.</li>
    </ul>
    <h3>Thanks to</h3>
    <p class="hint">Weather by Open-Meteo (open-meteo.com). Video editing by OpenCut, photo editing by Photopea, coding by VS Code for the Web. The web apps belong to their makers; Aquaris just gives them a home.</p>`);
  const logo = html("img");
  logo.src = "icon-256.png";
  logo.alt = "";
  made.page.querySelector(".about-logo").append(logo);
}

// How to start Aquaris again: inside a Linux AppImage the program itself lives in a temporary folder,
// so start-up entries point at the AppImage file (its "--aquaris" option picks the Aquaris profile).
function aquarisCommand() {
  const appImage = Services.env.get("APPIMAGE");
  if (onLinux && appImage) return [appImage, "--aquaris"];
  return [Services.dirsvc.get("XREExeF", Ci.nsIFile).path, "-profile", PathUtils.profileDir];
}
const desktopEntry = () => {
  const [exe, ...args] = aquarisCommand();
  return `[Desktop Entry]\nType=Application\nName=Aquaris\nComment=A desktop made of web apps\nExec="${exe}" ${args.map(x => `"${x}"`).join(" ")}\nIcon=${PathUtils.join(PathUtils.parent(PathUtils.profileDir), "aquaris.png")}\nTerminal=false\nCategories=Network;\n`;
};
async function saveIconPng() {
  const file = PathUtils.join(PathUtils.parent(PathUtils.profileDir), "aquaris.png");
  await IOUtils.write(file, new Uint8Array(await (await fetch("icon-256.png")).arrayBuffer()));
}

// A desktop shortcut that starts Aquaris straight away
async function makeShortcut() {
  if (!inChrome) throw new Error("This only works when Aquaris runs on a computer.");
  if (onLinux) {
    await saveIconPng();
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    let desk = PathUtils.join(home, "Desktop");
    try { desk = Services.dirsvc.get("XDGDesk", Ci.nsIFile).path; } catch {}
    for (const file of [PathUtils.join(home, ".local", "share", "applications", "aquaris.desktop"), PathUtils.join(desk, "aquaris.desktop")]) {
      await IOUtils.makeDirectory(PathUtils.parent(file), { ignoreExisting: true });
      await IOUtils.writeUTF8(file, desktopEntry());
      await IOUtils.setPermissions(file, 0o755);
    }
    return;
  }
  if (onMac) throw new Error("On a Mac, Aquaris is in your Applications folder (drag it to the Dock to keep it there).");
  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
  const iconPath = PathUtils.join(PathUtils.parent(PathUtils.profileDir), "Aquaris.ico");
  await IOUtils.write(iconPath, new Uint8Array(await (await fetch("icon.ico")).arrayBuffer()));
  const iconFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  iconFile.initWithPath(iconPath);
  const shell = Cc["@mozilla.org/browser/shell-service;1"].getService(Ci.nsIWindowsShellService);
  await shell.createShortcut(exe, ["-profile", PathUtils.profileDir], "Aquaris", iconFile, 0, "Aeris.Aquaris", "Desktop", "Aquaris.lnk");
}

// Start Aquaris when the computer starts: Windows' "Run" list for this user, Linux's autostart folder,
// or a Mac "launch agent". Not while being tested by a program (hidden test copies must not end up there).
async function setAutostart(on) {
  if (!inChrome || Services.env.get("MOZ_HEADLESS") || Services.env.get("MOZ_MARIONETTE") || navigator.webdriver) return;
  const [exe, ...args] = aquarisCommand();
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  if (onWindows) {
    const key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(Ci.nsIWindowsRegKey);
    key.open(key.ROOT_KEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", key.ACCESS_ALL);
    try {
      if (on) key.writeStringValue("Aquaris", `"${exe}" -profile "${PathUtils.profileDir}"`);
      else if (key.hasValue("Aquaris")) key.removeValue("Aquaris");
    } finally { key.close(); }
  } else if (onLinux) {
    const file = PathUtils.join(home, ".config", "autostart", "aquaris.desktop");
    if (on) {
      await saveIconPng();
      await IOUtils.makeDirectory(PathUtils.parent(file), { ignoreExisting: true });
      await IOUtils.writeUTF8(file, desktopEntry() + "X-GNOME-Autostart-enabled=true\n");
    } else await IOUtils.remove(file, { ignoreAbsent: true });
  } else if (onMac) {
    const file = PathUtils.join(home, "Library", "LaunchAgents", "app.aeris.aquaris.plist");
    const xml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    if (on) {
      await IOUtils.makeDirectory(PathUtils.parent(file), { ignoreExisting: true });
      await IOUtils.writeUTF8(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.aeris.aquaris</string>
  <key>ProgramArguments</key><array>${[exe, ...args].map(x => `<string>${xml(x)}</string>`).join("")}</array>
  <key>RunAtLoad</key><true/>
</dict></plist>
`);
    } else await IOUtils.remove(file, { ignoreAbsent: true });
  }
}

// ================= Memory and the task manager =================
// Click the memory meter: how much memory each app uses, biggest first. Each app's memory is the
// processes its pages run in (shared ones are split between the apps sharing them).

let ramMb = 0, cpuPct = 0;
// The real Aeris windows in the task manager
const aerisEntry = { app: AERIS_APP, kind: "aeris", state: "normal", el: null, isAeris: true };
const mb = n => (n >= 1024 ? (n / 1024).toFixed(1) + " GB" : Math.round(n) + " MB");
const cores = navigator.hardwareConcurrency || 4;
let lastCpu = new Map(), lastAt = 0;

// Memory and processor use: for everything together and for each app
async function measure() {
  const info = await ChromeUtils.requestProcInfo();
  const now = performance.now();
  const procs = [info, ...info.children];
  const memByPid = new Map(procs.map(c => [c.pid, c.memory / 1048576]));
  const cpuByPid = new Map();
  for (const c of procs) {
    const before = lastCpu.get(c.pid);
    if (before != null && lastAt) cpuByPid.set(c.pid, Math.max(0, ((c.cpuTime - before) / 1e6 / (now - lastAt)) * 100 / cores));
  }
  lastCpu = new Map(procs.map(c => [c.pid, c.cpuTime]));
  lastAt = now;
  ramMb = [...memByPid.values()].reduce((a, b) => a + b, 0);
  cpuPct = [...cpuByPid.values()].reduce((a, b) => a + b, 0);
  // Which processes each app's pages use (shared ones are split)
  const users = new Map();
  const appsOpen = wins.filter(w => w.kind !== "native");
  // Real Aeris windows count as one "app": all their tabs
  const aerisTabs = aerisWindows().flatMap(win => [...win.gBrowser.browsers]);
  aerisEntry.view = null;
  aerisEntry.browsers = aerisTabs;
  if (aerisTabs.length) appsOpen.push(aerisEntry);
  for (const w of appsOpen) {
    w.pids = new Set();
    const roots = w.browsers || (w.view ? [w.view] : []);
    for (const bc of roots.flatMap(v => v.browsingContext?.getAllBrowsingContextsInSubtree?.() || [])) {
      const pid = bc.currentWindowGlobal?.osPid;
      if (pid && pid !== -1) w.pids.add(pid);
    }
    for (const pid of w.pids) users.set(pid, (users.get(pid) || 0) + 1);
  }
  for (const w of appsOpen) {
    w.mem = [...w.pids].reduce((s, pid) => s + (memByPid.get(pid) || 0) / users.get(pid), 0);
    w.cpu = [...w.pids].reduce((s, pid) => s + (cpuByPid.get(pid) || 0) / users.get(pid), 0);
  }
  return appsOpen;
}

async function updateRam() {
  if (!inChrome) return;
  try { await measure(); } catch { return; }
  $("#ramText").textContent = mb(ramMb);
  limiters();
  if (!$("#tasks").hidden) drawTasks();
  if (!$("#quick").hidden) drawRamDetail();
}
function drawRamDetail() {
  const awake = wins.filter(w => w.view && !w.napped).length;
  const napping = wins.filter(w => w.napped).length;
  const sleepy = wins.filter(w => w.kind === "app" && !w.napped && w.state.startsWith("min") && !w.app.music && !w.app.browser).length;
  $("#ramDetail").textContent = `Using ${ramMb ? mb(ramMb) : "…"} · ${awake} app${awake === 1 ? "" : "s"} awake · ${napping} napping`;
  $("#qsNap .qs-on").disabled = !sleepy;
}

// ----- Limiters (like Opera GX) -----
// RAM limiter: over the limit, the app you used longest ago (not the one in front, not music) naps.
// CPU limiter: over the limit, apps you aren't using are slowed down (their pages run on low power
// until you go back to them).
const canNap = w => w.kind === "app" && !w.napped && !w.app.music && !w.app.browser && !isFront(w) && !settings.aquarisAwake.includes(w.app.id);
function limiters() {
  const ram = settings.aquarisRamLimit, cpu = settings.aquarisCpuLimit;
  if (ram.on && ramMb > ram.gb * 1024) {
    const oldest = wins.filter(canNap).sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))[0];
    if (oldest) { nap(oldest); oldest.nappedBy = "ram"; }
  }
  const background = wins.filter(w => w.view && !w.napped && !isFront(w) && !w.app.music && !w.isAeris);
  if (cpu.on && cpuPct > cpu.pct) {
    // Minimised apps first, then the ones behind
    const next = background.filter(w => !w.throttled).sort((a, b) => (b.state.startsWith("min") - a.state.startsWith("min")) || (b.cpu || 0) - (a.cpu || 0))[0];
    if (next) throttle(next);
  } else if (!cpu.on || cpuPct < cpu.pct * 0.7) {
    for (const w of wins.filter(w => w.throttled)) unthrottle(w);
  }
}
function throttle(w) {
  if (!inChrome || !w.view) return;
  w.view.docShellIsActive = false;
  w.throttled = true;
  w.el.classList.add("throttled");
}
function unthrottle(w) {
  if (w.view && inChrome) w.view.docShellIsActive = true;
  w.throttled = false;
  w.el.classList.remove("throttled");
}

async function drawTasks() {
  const appsOpen = wins.filter(w => w.kind !== "native");
  if (aerisWindows().length) appsOpen.push(aerisEntry);
  const own = Math.max(0, ramMb - appsOpen.reduce((s, w) => s + (w.napped ? 0 : w.mem || 0), 0));
  const ownCpu = Math.max(0, cpuPct - appsOpen.reduce((s, w) => s + (w.cpu || 0), 0));
  const all = [...appsOpen.map(w => ({ w, mb: w.napped ? 0 : w.mem || 0, cpu: w.napped ? 0 : w.cpu || 0 })), { own: true, mb: own, cpu: ownCpu }].sort((a, b) => b.mb - a.mb);
  const max = Math.max(...all.map(r => r.mb), 1);
  const box = $("#taskList");
  box.textContent = "";
  for (const r of all) {
    const app = r.own ? { id: "aquaris", ui: "chip", color: "#5b6b82" } : r.w.app;
    const row = html("div", "task-row");
    row.append(tile(app, "small"));
    const words = html("span", "task-name");
    const state = r.own ? "The desktop, Aeris Core and shared parts"
      : r.w.isAeris ? `${aerisWindows().reduce((s, w) => s + w.gBrowser.tabs.length, 0)} tabs`
      : r.w.napped ? (r.w.nappedBy === "ram" ? "Napped by the RAM limiter" : "Napping")
      : r.w.throttled ? "Slowed down by the CPU limiter"
      : r.w.state.startsWith("min") ? "Minimised" : "Open";
    words.append(html("b", "", r.own ? "Aquaris and the engine" : app.name), html("small", "", state));
    const bar = html("span", "task-bar");
    const fill = html("i");
    fill.style.width = Math.max(2, (r.mb / max) * 100) + "%";
    bar.append(fill);
    const nums = html("span", "task-mb");
    nums.append(html("b", "", r.mb ? mb(r.mb) : "–"), html("small", "", `${r.cpu.toFixed(1)}% CPU`));
    row.append(words, bar, nums);
    if (!r.own) {
      const x = html("button", "task-x");
      x.title = "Close";
      setHTML(x, icon("close"));
      x.addEventListener("click", () => { r.w.isAeris ? aerisWindows().forEach(w => w.close()) : closeWin(r.w); setTimeout(updateRam, 800); });
      row.append(x);
    } else row.append(html("span", "task-x"));
    box.append(row);
  }
  $("#taskTotal").textContent = `${mb(ramMb)} · ${cpuPct.toFixed(0)}% CPU`;
  // limiter controls
  const ram = settings.aquarisRamLimit, cpu = settings.aquarisCpuLimit;
  $("#limRam").checked = ram.on;
  $("#limRamGb").value = ram.gb;
  $("#limRamTxt").textContent = ram.gb + " GB";
  $("#limCpu").checked = cpu.on;
  $("#limCpuPct").value = cpu.pct;
  $("#limCpuTxt").textContent = cpu.pct + "%";
}
$("#limRam").addEventListener("change", e => save({ aquarisRamLimit: { ...settings.aquarisRamLimit, on: e.target.checked } }));
$("#limRamGb").addEventListener("input", e => { $("#limRamTxt").textContent = e.target.value + " GB"; });
$("#limRamGb").addEventListener("change", e => save({ aquarisRamLimit: { ...settings.aquarisRamLimit, gb: +e.target.value } }));
$("#limCpu").addEventListener("change", e => save({ aquarisCpuLimit: { ...settings.aquarisCpuLimit, on: e.target.checked } }).then(limiters));
$("#limCpuPct").addEventListener("input", e => { $("#limCpuTxt").textContent = e.target.value + "%"; });
$("#limCpuPct").addEventListener("change", e => save({ aquarisCpuLimit: { ...settings.aquarisCpuLimit, pct: +e.target.value } }));
setInterval(updateRam, 3000);

// ================= Themes =================
// Minimal and Frutiger Aqua, plus Aeris's themes: its colour themes (the same as Aeris's) and its
// custom themes (themes/index.json in Aeris Core). An Aeris theme gives Aquaris its accent colour,
// a wallpaper in its colours, and light or dark.

const AERIS_COLOURS = {
  frost: { name: "Frost", a: "#c3d8ea", b: "#e2eef8", accent: "#3d8bd4" },
  aqua: { name: "Aqua Sky", a: "#1f7fd6", b: "#7fd0ff", accent: "#1e9be8" },
  meadow: { name: "Meadow", a: "#2f8f3f", b: "#a8e66b", accent: "#3cb83c" },
  ocean: { name: "Deep Ocean", a: "#031f45", b: "#0b6fb5", accent: "#22b8e0" },
  bubblegum: { name: "Bubblegum", a: "#d0287f", b: "#ffb3e0", accent: "#ff5fb0" },
  sunset: { name: "Sunset", a: "#e8601a", b: "#ffd27a", accent: "#ff8c1a" },
  silver: { name: "Silver", a: "#7a8b9a", b: "#e6eef4", accent: "#4c7fb0" },
  midnight: { name: "Midnight", a: "#0b0f1e", b: "#26324f", accent: "#5a7dff" }
};
let aerisThemes = [];  // { id, name, a, b, accent, light }
const lightness = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
async function loadAerisThemes() {
  const list = Object.entries(AERIS_COLOURS).map(([id, c]) => ({ id: "c:" + id, name: c.name, a: c.a, b: c.b, accent: c.accent, light: lightness(c.b) > 0.55 }));
  try {
    const custom = await (await fetch("../themes/index.json")).json();
    for (const th of custom) {
      const v = th.vars || {};
      if (v["frame-a"] && v["frame-b"]) list.push({ id: "t:" + th.id, name: th.name, a: v["frame-a"], b: v["frame-b"], accent: v.accent || v["frame-a"], light: !!th.paper });
    }
  } catch {}
  aerisThemes = list;
}
const themeById = id => aerisThemes.find(t => t.id === id);

// ================= Look and saving =================

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener("change", () => applyLook());

function applyLook() {
  const s = settings;
  const aerisTheme = themeById(s.aquarisTheme);
  const theme = s.aquarisTheme === "aqua" ? "aqua" : "minimal";
  // Frutiger Aqua is always light; an Aeris theme is light or dark unless you choose
  const mode = theme === "aqua" || ["t:woodland-hut", "t:retro-2000", "t:luna-xp"].includes(s.aquarisTheme) ? "light"
    : s.aquarisTheme === "t:neon-gamer" ? "dark"
    : s.aquarisMode !== "auto" ? s.aquarisMode
    : aerisTheme ? (aerisTheme.light ? "light" : "dark")
    : darkQuery.matches ? "dark" : "light";
  const b = document.body;
  b.dataset.theme = theme;
  b.dataset.mode = mode;
  // An Aeris theme dresses all of Aquaris (skins.css): Woodland Hut in wood, Frutiger Metro in
  // Metro, every other one in Frutiger Aero
  const SKINS = { "t:woodland-hut": "wood", "t:frutiger-metro": "metro", "t:neon-gamer": "gamer", "t:retro-2000": "w95", "t:luna-xp": "xp" };
  const skin = !aerisTheme ? "" : SKINS[s.aquarisTheme] || "aero";
  if (skin) b.dataset.skin = skin; else delete b.dataset.skin;
  b.style.setProperty("--accent", aerisTheme?.accent || "");
  if (!aerisTheme) b.style.removeProperty("--accent");
  b.style.setProperty("--theme-a", aerisTheme?.a || "#36597e");
  b.style.setProperty("--theme-b", aerisTheme?.b || "#a9c3d9");
  let wall = s.aquarisWall;
  if (wall === "auto" || (wall === "own" && !s.aquarisOwnWall)) wall = theme === "aqua" ? "aqua" : skin || "tide";
  b.dataset.wall = wall;
  b.style.setProperty("--own-wall", s.aquarisOwnWall ? `url("${s.aquarisOwnWall}")` : "none");
  b.style.setProperty("--frost", (s.aquarisGlass / 100).toFixed(2));
  b.classList.toggle("less-motion", !!s.aquarisLessMotion);
  const L = s.aquarisLookMore;
  b.style.setProperty("--r-win", L.radius + "px");
  b.style.setProperty("--dock-icon", L.dock + "px");
  b.classList.toggle("mac-buttons", L.buttons === "mac");
  b.classList.toggle("no-clock", !L.clock);
  applyCursor(L);
  $("#deskText").textContent = L.deskText;
  applyNight();
  try { localStorage.setItem("aquarisLook", JSON.stringify({ theme, mode, intro: s.aquarisLookMore.intro })); } catch {}
}
// The pointer: Aquaris's own (a drop-coloured arrow) or a picture you chose, at the size you chose
let cursorKey = "";
async function applyCursor(L) {
  const key = [L.cursor, L.cursorSize, L.cursor === "own" ? (L.ownCursor || "").length : 0, getComputedStyle(document.body).getPropertyValue("--accent")].join("|");
  if (key === cursorKey) return;
  cursorKey = key;
  let style = $("#cursorStyle");
  if (!style) { style = html("style"); style.id = "cursorStyle"; document.head.append(style); }
  if (L.cursor === "normal" || (L.cursor === "own" && !L.ownCursor)) return void (style.textContent = "");
  const size = Math.min(64, L.cursorSize || 24);
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#2a7de1";
  const src = L.cursor === "own" ? L.ownCursor
    : "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 2l15 7.5-6.2 1.8L8.5 18z" fill="${accent}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`);
  // Draw it at the chosen size (pointers can't be resized with CSS)
  const img = new Image();
  img.src = src;
  await img.decode().catch(() => {});
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").drawImage(img, 0, 0, size, size);
  const url = c.toDataURL("image/png");
  const hot = L.cursor === "own" ? "0 0" : `${Math.round(size * 0.12)} ${Math.round(size * 0.08)}`;
  style.textContent = `body, body * { cursor: url("${url}") ${hot}, default !important; } input, textarea, [contenteditable] { cursor: text !important; }`;
}

async function save(changes) {
  Object.assign(settings, changes);
  await store.set(changes);
  applyLook();
  drawIcons();
  drawDock();
}
let layoutTimer = 0;
function saveLayout() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    const aquarisLayout = wins.filter(w => w.kind === "app" || w.kind === "own").map(w => ({ app: w.app.id, rect: w.rect, state: w.state }));
    settings.aquarisLayout = aquarisLayout;
    store.set({ aquarisLayout });
  }, 400);
}
// When the screen changes size (an iPad turned on its side, a smaller window), windows stay on it
addEventListener("resize", () => {
  const d = deskRect(), room = d.height - dockSpace();
  for (const w of wins) {
    if (w.state !== "max" && w.rect) {
      const r = w.rect;
      r.w = Math.min(r.w, Math.max(240, d.width - 16));
      r.h = Math.min(r.h, Math.max(180, room - 16));
      r.x = Math.max(0, Math.min(r.x, d.width - r.w));
      r.y = Math.max(0, Math.min(r.y, room - r.h));
    }
    if (w.el) place(w);
  }
});

// ================= Aquaris as its own app =================

async function setUpAppWindow() {
  // Its own taskbar button and icon on Windows
  if (Services.appinfo.OS === "WINNT") {
    try {
      Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar).setGroupIdForWindow(window, "Aeris.Aquaris");
      const buf = await (await fetch("icon-256.png")).arrayBuffer();
      const img = Cc["@mozilla.org/image/tools;1"].getService(Ci.imgITools).decodeImageFromArrayBuffer(buf, "image/png");
      Cc["@mozilla.org/windows-ui-utils;1"].getService(Ci.nsIWindowsUIUtils).setWindowIcon(window, img, img);
    } catch (e) { console.warn("Aquaris taskbar:", e); }
  }
  window.fullScreen = true;
}

// What Aeris Core uses to reach this window (pages to open in Aeris, coming to the front)
window.Aquaris = {
  openInAeris(urls) { window.focus(); openInAeris(urls); },
  focus() { window.focus(); },
  shellEvent(ev) { shellEvent(ev); },
  pad(action, x, y, dx, dy) { padAction(action, x, y, dx, dy); }
};

// ================= Game controller (iPad app) =================
// The iPad app reads the controller and draws the cursor; here is what it does on Aquaris's own
// screen (websites in windows get their clicks from the iPad app directly).
let padTarget = null;
function padFire(el, type, x, y, buttons) {
  const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons, view: window };
  if (type.startsWith("pointer")) el.dispatchEvent(new PointerEvent(type, { ...o, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  else el.dispatchEvent(new MouseEvent(type, o));
}
function scrollableAt(el) {
  for (; el && el !== document.body; el = el.parentElement) {
    const s = getComputedStyle(el);
    if ((el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(s.overflowY)) || (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(s.overflowX))) return el;
  }
  return null;
}
function cycleWindows(step) {
  const list = wins.filter(w => w.kind !== "native").sort((a, b) => (+a.el.style.zIndex || 0) - (+b.el.style.zIndex || 0));
  if (!list.length) return;
  const front = activeWin();
  const i = list.indexOf(front);
  const next = list[(i + step + list.length) % list.length];
  restore(next);
  focusWin(next);
}
function padAction(action, x, y, dx, dy) {
  if (mbOpen && !["down", "move", "up", "scroll", "right", "menu", "back"].includes(action)) closeMenuBar();
  const at = () => document.elementFromPoint(x, y);
  // The window switcher from a controller: R3 opens it and moves along (it switches after a short
  // pause); R1 still just clicks, so clicking a tile picks it; Circle/B cancels
  if (action === "switch") return stepSwitch(1);
  if (switcher.open && action === "back") return finishSwitch(false);
  if (action === "down") {
    const el = at();
    if (!el) return;
    padTarget = el;
    padFire(el, "pointerdown", x, y, 1);
    padFire(el, "mousedown", x, y, 1);
  } else if (action === "move" && padTarget) {
    padFire(padTarget, "pointermove", x, y, 1);
    padFire(padTarget, "mousemove", x, y, 1);
  } else if (action === "up" && padTarget) {
    const down = padTarget;
    padTarget = null;
    padFire(down, "pointerup", x, y, 0);
    padFire(down, "mouseup", x, y, 0);
    const el = at();
    if (!el || !(el === down || down.contains(el) || el.contains(down))) return;
    if (el.matches("input, textarea, select")) el.focus();
    el.click();
    // Desktop icons and files open with a double-click
    const icon = el.closest("#icons > *, .fx-item");
    if (icon) icon.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }));
  } else if (action === "right") {
    at()?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  } else if (action === "scroll") {
    scrollableAt(at())?.scrollBy({ left: dx, top: dy });
  } else if (action === "spotlight") toggleOverlay("#spotlight");
  else if (action === "apps") toggleOverlay("#launcher");
  else if (action === "control") toggleOverlay("#quick");
  else if (action === "menu") (mbOpen ? closeMenuBar() : openMenuBar($("#tbLauncher")));
  else if (action === "desktop") { for (const w of wins) if (!w.state.startsWith("min")) minimise(w); }
  else if (action === "nextWin") cycleWindows(1);
  else if (action === "prevWin") cycleWindows(-1);
  else if (action === "back") {
    // Close whatever is open first; otherwise go back a page in the front window
    const open = ["#spotlight", "#launcher", "#quick", "#tasks", "#calendar", "#menu", "#mbMenu"].some(s => !$(s).hidden) || document.querySelector(".ask");
    if (open || mbOpen) { document.querySelector(".ask [data-a=no]")?.click(); closeOverlays(); closeMenuBar(); $("#menu").hidden = true; return; }
    const w = activeWin();
    if (w?.view?.dataset.shell) shell.postMessage({ cmd: "back", id: w.view.dataset.shell });
  }
}

// ================= The iPad app =================
// Each website is a real app view the iPad app lays exactly over its window's body. The window's
// title bar (move, minimise, close) and the dock stay Aquaris's own. App views can't be drawn
// under Aquaris's menus, so whenever something covers one (a menu, the app page, another window)
// it's swapped for a picture of itself until it's uncovered.
let shellSeq = 0, shellQueued = false, shellUntil = 0;
const shellOpen = new Set(), shellShown = new Set();
const SHELL_OVERLAYS = ["#switcher", "#menu", "#mbMenu", "#quick", "#tasks", "#calendar", "#launcher", "#spotlight", "#lock", "#boot", ".ask"];
const isShown = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
function shellSync() {
  if (!inShell) return;
  shellUntil = performance.now() + 450;       // follow windows while they animate
  if (shellQueued) return;
  shellQueued = true;
  const frame = () => {
    shellLayout();
    if (performance.now() < shellUntil) requestAnimationFrame(frame);
    else shellQueued = false;
  };
  requestAnimationFrame(frame);
}
function shellLayout() {
  const views = [...document.querySelectorAll(".shell-view")];
  const live = new Set(views.map(v => v.dataset.shell));
  for (const id of [...shellOpen]) if (!live.has(id)) { shell.postMessage({ cmd: "close", id }); shellOpen.delete(id); shellShown.delete(id); }
  const overlay = SHELL_OVERLAYS.some(s => [...document.querySelectorAll(s)].some(isShown)) || document.body.classList.contains("launcher-open");
  const winsShown = [...document.querySelectorAll(".win")].filter(w => isShown(w) && !w.classList.contains("min") && !w.classList.contains("closing"));
  const z = el => +el.style.zIndex || 0;
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const list = views.filter(v => shellOpen.has(v.dataset.shell)).map(v => {
    const win = v.closest(".win"), r = v.getBoundingClientRect();
    const onScreen = !!win && winsShown.includes(win) && r.width > 0;
    const covered = overlay || (onScreen && winsShown.some(o => o !== win && z(o) > z(win) && hit(o.getBoundingClientRect(), r)));
    return { id: v.dataset.shell, x: r.left, y: r.top, w: r.width, h: r.height, z: win ? z(win) : 0, show: onScreen && !covered, snap: onScreen && covered,
      radius: settings.aquarisLookMore?.radius ?? 10 };
  }).sort((a, b) => a.z - b.z);
  for (const it of list) {
    if (it.snap && shellShown.has(it.id)) shell.postMessage({ cmd: "snapshot", id: it.id });   // a picture before it hides
    it.show ? shellShown.add(it.id) : shellShown.delete(it.id);
  }
  shell.postMessage({ cmd: "layout", views: list });
}
function shellEvent(ev) {
  const v = document.querySelector(`.shell-view[data-shell="${ev.id}"]`);
  const win = v && wins.find(w => w.view === v);
  if (ev.type === "loaded" && win) { cover(win, null); if (ev.url) v.dataset.url = ev.url; }
  if (ev.type === "snap" && v) { v.style.backgroundImage = `url(${ev.data})`; v.style.backgroundSize = "100% 100%"; }
  if (ev.type === "tap" && win) focusWin(win);
  if (ev.type === "switch") stepSwitch(ev.step || 1, { gesture: !!ev.gesture });
  if (ev.type === "switchEnd") finishSwitch(true);
  if (ev.type === "key") {
    if (ev.key === "spotlight") toggleOverlay("#spotlight");
    if (ev.key === "lock") lockScreen();
    if (ev.key === "escape") { finishSwitch(false); closeOverlays(); }
  }
  if (ev.type === "openUrl" && /^https?:/.test(ev.url || "")) openInAerisTab(ev.url);
  if (ev.type === "state" && v) {
    v.dataset.url = ev.url || v.dataset.url || "";
    v.dataset.title = ev.title || "";
    v.dataset.back = ev.back ? "1" : "";
    v.dataset.forward = ev.forward ? "1" : "";
    v.dataset.loading = ev.loading ? "1" : "";
    const owner = wins.find(w => w.view === v || w.tabs?.includes(v));
    if (owner && !ev.loading && owner.view === v) cover(owner, null);
    if (owner?.toolbar) updateBrowserBar(owner);
  }
}
// ================= Mouse, trackpad and keyboard on an iPad =================
// With a Bluetooth mouse or trackpad connected, Aquaris works like on a computer: double-click to
// open, right-click menus, hover, computer-sized controls (the finger-only gestures below only react
// to fingers). It follows the iPad: connecting or disconnecting a mouse switches straight away.
if (onWeb) {
  const fine = matchMedia("(any-pointer: fine)");
  const setMouse = on => document.body.classList.toggle("has-mouse", on);
  setMouse(fine.matches);
  fine.addEventListener?.("change", () => setMouse(fine.matches));
  addEventListener("pointermove", e => { if (e.pointerType === "mouse" && !document.body.classList.contains("has-mouse")) setMouse(true); }, { passive: true });
}

// ================= Fingers (iPad) =================
// 1. A tap on a button always counts. (iPadOS sometimes treats a tap as "hovering" instead of a
//    click, so if no click follows a finger's tap on a button, Aquaris clicks it itself.)
// 2. A two-finger tap is a right-click: it opens the menu of whatever is under the fingers.
let lastTwoFingers = 0;
const twoFingersLately = () => performance.now() - lastTwoFingers < 700;
if (onWeb) {
  // A finger lifting off a button presses it straight away (iPadOS doesn't always turn taps into
  // clicks), and the click iPadOS may send a moment later is ignored, so nothing happens twice.
  let tap = null, pressed = null;
  const TAPPABLE = "button, .tb-btn, [role=button], label, a[href], summary, .tile-btn";
  document.addEventListener("pointerdown", e => {
    if (e.pointerType !== "touch" || !e.isPrimary) return void (tap = null);
    // Typing boxes, lists and sliders work as usual
    if (e.target.closest('input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=""], [contenteditable="true"]')) return void (tap = null);
    const el = e.target.closest(TAPPABLE);
    tap = el && !el.disabled && !el.closest("#icons") ? { el, x: e.clientX, y: e.clientY, at: performance.now() } : null;
  }, true);
  document.addEventListener("pointercancel", () => (tap = null), true);
  document.addEventListener("pointerup", e => {
    const t0 = tap;
    tap = null;
    if (!t0 || e.pointerType !== "touch" || twoFingersLately()) return;
    if (Math.hypot(e.clientX - t0.x, e.clientY - t0.y) > 12 || performance.now() - t0.at > 800) return;
    pressed = { el: t0.el, until: performance.now() + 700 };
    t0.el.click();
  }, true);
  document.addEventListener("click", e => {
    if (!e.isTrusted || !pressed || performance.now() > pressed.until) return;
    if (pressed.el === e.target || pressed.el.contains(e.target) || e.target.contains?.(pressed.el)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pressed = null;
    }
  }, true);

  let two = null, three = null, swipe = null;
  document.addEventListener("touchstart", e => {
    if (e.touches.length === 3) {
      two = null;
      lastTwoFingers = performance.now();
      three = { at: performance.now(), pts: [...e.touches].map(x => [x.clientX, x.clientY]) };
      return;
    }
    if (e.touches.length > 3) three = null;
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      lastTwoFingers = performance.now();
      two = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, at: performance.now(), a: [a.clientX, a.clientY], b: [b.clientX, b.clientY] };
      swipe = { x: two.x, y: two.y, steps: 0, on: false };
    } else if (e.touches.length > 2) two = null;
  }, { passive: true, capture: true });
  document.addEventListener("touchmove", e => {
    if (three && [...e.touches].some((x, i) => three.pts[i] && Math.hypot(x.clientX - three.pts[i][0], x.clientY - three.pts[i][1]) > 16)) three = null;
    // Two fingers swiping sideways: the window switcher (right = next, left = back; lift to switch)
    if (swipe && e.touches.length === 2) {
      const [p, q] = e.touches;
      const dx = (p.clientX + q.clientX) / 2 - swipe.x, dy = (p.clientY + q.clientY) / 2 - swipe.y;
      if (!swipe.on && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { swipe.on = true; two = null; stepSwitch(1, { gesture: true }); }
      if (swipe.on) {
        const want = Math.trunc(dx / 90);
        while (swipe.steps < want) { swipe.steps++; stepSwitch(1, { gesture: true }); }
        while (swipe.steps > want) { swipe.steps--; stepSwitch(-1, { gesture: true }); }
      }
    }
    if (!two || e.touches.length < 2) return;
    const [a, b] = e.touches;
    if (Math.hypot(a.clientX - two.a[0], a.clientY - two.a[1]) > 14 || Math.hypot(b.clientX - two.b[0], b.clientY - two.b[1]) > 14) two = null;
  }, { passive: true, capture: true });
  document.addEventListener("touchend", e => {
    if (swipe?.on && e.touches.length < 2) { swipe = null; lastTwoFingers = performance.now(); finishSwitch(true); return; }
    if (e.touches.length < 2) swipe = null;
    // A three-finger tap opens Spotlight search
    if (three) {
      if (e.touches.length) return;
      const t3 = three;
      three = null;
      lastTwoFingers = performance.now();
      if (performance.now() - t3.at < 600) { closeOverlays(); toggleOverlay("#spotlight", true); }
      return;
    }
    if (e.touches.length) lastTwoFingers = two ? performance.now() : lastTwoFingers;
    if (!two || e.touches.length) return;     // wait for every finger to lift
    const t2 = two;
    two = null;
    lastTwoFingers = performance.now();
    if (performance.now() - t2.at > 600) return;
    const target = document.elementFromPoint(t2.x, t2.y);
    target?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: t2.x, clientY: t2.y, button: 2 }));
  }, { capture: true });
}

if (inShell) {
  new MutationObserver(shellSync).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
  addEventListener("resize", shellSync);
}

// ================= Start =================

let introOn = true;
try {
  const look = JSON.parse(localStorage.getItem("aquarisLook") || "{}");
  if (look.theme) document.body.dataset.theme = look.theme;
  document.body.dataset.mode = look.mode || (darkQuery.matches ? "dark" : "light");
  if (look.intro === false) introOn = false;
} catch {}

// The start-up sound: a soft chime, a warm pad and a breath of air, made right here (no files)
function playIntro() {
  try {
    const ac = new AudioContext();
    const t0 = ac.currentTime + 0.05;
    const out = ac.createGain();
    out.gain.value = 0.22;
    out.connect(ac.destination);
    const echo = ac.createDelay();
    echo.delayTime.value = 0.28;
    const fb = ac.createGain();
    fb.gain.value = 0.3;
    echo.connect(fb).connect(echo);
    echo.connect(out);
    // warm pad: a soft chord swelling in
    for (const f of [261.63, 329.63, 392, 523.25]) {
      const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
      o.type = "triangle";
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      lp.frequency.value = 1400;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.09, t0 + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + 2.8);
      o.connect(lp).connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + 3);
    }
    // chime: three bell notes rising
    [[1046.5, 0.15], [1318.5, 0.35], [1568, 0.55]].forEach(([f, at]) => {
      const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = f;
      o2.type = "sine"; o2.frequency.value = f * 2.01;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(0.16, t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + at + 1.6);
      o.connect(g); o2.connect(g);
      g.connect(out); g.connect(echo);
      o.start(t0 + at); o2.start(t0 + at);
      o.stop(t0 + at + 1.7); o2.stop(t0 + at + 1.7);
    });
    // air: filtered noise, like a soft breath
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const n = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain();
    n.buffer = buf;
    bp.type = "bandpass"; bp.frequency.setValueAtTime(800, t0); bp.frequency.exponentialRampToValueAtTime(4000, t0 + 1.6); bp.Q.value = 0.8;
    ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime(0.05, t0 + 0.5); ng.gain.exponentialRampToValueAtTime(0.0005, t0 + 2);
    n.connect(bp).connect(ng).connect(out);
    n.start(t0); n.stop(t0 + 2);
    setTimeout(() => ac.close(), 4000);
  } catch {}
}

{
  const boot = $("#boot");
  const end = () => {
    if (boot.classList.contains("done")) return;
    boot.classList.add("done");
    document.body.classList.remove("opening");
    setTimeout(() => boot.remove(), 600);
  };
  boot.addEventListener("click", end);
  if (!introOn) { boot.remove(); document.body.classList.remove("opening"); }
  else {
    if (inChrome) playIntro();
    setTimeout(end, matchMedia("(prefers-reduced-motion: reduce)").matches ? 400 : 2200);
  }
}

(async () => {
  await store.load();
  settings = await store.get(DEFAULTS);
  // Settings saved by an older Aquaris get the newer options' defaults
  settings.aquarisLookMore = { ...DEFAULTS.aquarisLookMore, ...settings.aquarisLookMore };
  settings.aquarisNight = { ...DEFAULTS.aquarisNight, ...settings.aquarisNight };
  settings.aquarisAeris = { ...DEFAULTS.aquarisAeris, ...settings.aquarisAeris, mods: { ...DEFAULTS.aquarisAeris.mods, ...settings.aquarisAeris?.mods } };
  // Spotify was taken out (it needs Google-approved copy-protection Aeris doesn't have): YouTube Music instead
  if (settings.aquarisPinned.includes("spotify")) settings.aquarisPinned = [...new Set(settings.aquarisPinned.map(i => (i === "spotify" ? "ytmusic" : i)))];
  await loadAerisThemes();
  applyLook();
  drawIcons();
  tick();
  if (inChrome) {
    $("#powerButton").title = "Shut down Aquaris";
    drawTopApp();
    setUpAppWindow();
    setAutostart(settings.aquarisAutostart).catch(e => console.error("Aquaris autostart:", e));
    setTimeout(drawStatus, 1500);
    updateRam();
  }
  for (const l of settings.aquarisLayout) {
    const app = appById(l.app);
    if (app) openApp(app, { rect: l.rect, state: l.state, napped: l.state.startsWith("min") });
  }
  // Windows from last time might be bigger than this screen (an iPad turned the other way)
  dispatchEvent(new Event("resize"));
  drawDock();
  drawTopApp();
  if (onWeb && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
