// Aeris Core: themes, New Tab, moving in from Aero, Aero Originals and updates.
// The privileged bits (restyling the browser frame, passwords, installing) are in api/parent.js.

const RELEASES = "https://api.github.com/repos/aarshabhpeeyush/aero-browser/releases/latest";

// Aero's colour themes ("dark: true" ones use dark writing on light glass). "firefox" = Firefox's own look.
const COLOR_THEMES = {
  frost:     { name: "Frost",     a: "#c3d8ea", b: "#e2eef8", accent: "#3d8bd4", dark: true },
  aqua:      { name: "Aqua Sky",  a: "#1f7fd6", b: "#7fd0ff", accent: "#1e9be8" },
  meadow:    { name: "Meadow",    a: "#2f8f3f", b: "#a8e66b", accent: "#3cb83c" },
  ocean:     { name: "Deep Ocean", a: "#031f45", b: "#0b6fb5", accent: "#22b8e0" },
  bubblegum: { name: "Bubblegum", a: "#d0287f", b: "#ffb3e0", accent: "#ff5fb0" },
  sunset:    { name: "Sunset",    a: "#e8601a", b: "#ffd27a", accent: "#ff8c1a" },
  silver:    { name: "Silver",    a: "#7a8b9a", b: "#e6eef4", accent: "#4c7fb0" },
  midnight:  { name: "Midnight",  a: "#0b0f1e", b: "#26324f", accent: "#5a7dff" }
};

// Customize choices, the same as Aero's: a colour theme, accent (null = the theme's), shine, tabs
// top/left/right, tab shape, window buttons, size and bubbly sounds. "theme" is the custom theme
// (one of Aero's theme folders, like Woodland Hut) laid on top, or null for none.
const LOOK = { colorTheme: "frost", accent: null, gloss: 70, bars: "top", tabShape: "rounded", winButtons: "simple", size: "comfy", sounds: true, focus: false };
const DEFAULTS = { theme: null, studio: null, hideAi: true, restyle: true, stacking: true, imported: false, lastVersion: null, update: null, ...LOOK };

let THEMES = []; // the custom themes (from themes/index.json)
let registered = []; // website stylesheets for the active theme

const settings = () => browser.storage.local.get(DEFAULTS);
const fileText = async path => {
  const res = await fetch(browser.runtime.getURL(path));
  return res.ok ? res.text() : "";
};
const cssCache = {};
const css = async path => (cssCache[path] ??= await fileText(path));

// ================= Themes =================

// "a.b.c" > "a.b.d"? A beta comes before its finished version: 1.0.0-beta.1 < 1.0.0-beta.2 < 1.0.0.
function newer(a, b) {
  const [na, pre_a] = a.split("-"), [nb, pre_b] = b.split("-");
  const pa = na.split(".").map(Number), pb = nb.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  if (!pre_a || !pre_b) return !pre_a && !!pre_b;
  return pre_a.localeCompare(pre_b, undefined, { numeric: true }) > 0;
}

// Mix two #rrggbb colours (the theme API only takes plain colours, not color-mix()).
function mix(a, b, amount) {
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  return "#" + [0, 1, 2].map(i => Math.round(ch(a, i) * (1 - amount) + ch(b, i) * amount).toString(16).padStart(2, "0")).join("");
}

// The colours in use: the colour theme and your accent, with the custom theme's on top (like Aero).
function activeColors(s, theme) {
  const c = COLOR_THEMES[s.colorTheme] || COLOR_THEMES.frost;
  const v = {
    "frame-a": c.a,
    "frame-b": c.b,
    text: c.dark ? "#1d3550" : "#fff",
    accent: s.accent || c.accent,
    ...(theme?.vars || {})
  };
  if (theme && s.accent) v.accent = s.accent;
  return v;
}

// Firefox draws menus, popups and the sidebar itself, so they get the colours through the theme
// API. (The frame itself is styled with CSS, see buildChromeCss.) A custom theme with a "paper"
// colour is light, one without is dark. Colour themes have Aero's light toolbar.
function themeApiColors(v, theme) {
  const paper = theme ? theme.paper?.["google.com"] : mix(v.accent, "#ffffff", 0.75);
  const dark = !paper;
  const toolbarText = dark ? v.text : "#14283c";
  return {
    colors: {
      frame: v["frame-a"],
      frame_inactive: v["frame-a"],
      tab_background_text: v.text,
      tab_selected: dark ? v["frame-b"] : paper,
      tab_text: toolbarText,
      tab_line: v.accent,
      tab_loading: v.accent,
      toolbar: dark ? v["frame-b"] : paper,
      toolbar_text: toolbarText,
      bookmark_text: toolbarText,
      icons: toolbarText,
      toolbar_field: dark ? "#1b2230" : "#ffffff",
      toolbar_field_text: dark ? v.text : "#10202e",
      toolbar_field_focus: dark ? "#1b2230" : "#ffffff",
      toolbar_field_border_focus: v.accent,
      toolbar_bottom_separator: "transparent",
      popup: dark ? "#1b2230" : "#ffffff",
      popup_text: dark ? v.text : "#10202e",
      popup_highlight: v.accent,
      popup_highlight_text: "#ffffff",
      sidebar: v["frame-a"],
      sidebar_text: v.text,
      ntp_background: v["frame-b"],
      ntp_text: v.text
    },
    properties: {
      color_scheme: dark ? "dark" : "light",
      content_color_scheme: theme?.websites === "dark" ? "dark" : theme?.websites === "light" ? "light" : "auto"
    }
  };
}

// The frame's CSS, in Aero's order: the Aero look, your colour theme, accent and shine, the custom
// theme on top (so it can change anything), then the layout choices.
async function buildChromeCss(s, theme) {
  if (s.colorTheme === "minimal") {
    return [
      await css("chrome/stacking.css"),
      await css("chrome/minimal.css"),
      s.accent ? `:root { --accent: ${s.accent} !important; }` : "",
      s.size === "compact" ? await css("chrome/size-compact.css") : "",
      s.focus ? await css("chrome/focus.css") : ""
    ].join("\n");
  }
  const c = COLOR_THEMES[s.colorTheme] || COLOR_THEMES.frost;
  const side = s.bars === "left" || s.bars === "right";
  const parts = [
    await css("chrome/stacking.css"),
    await css("chrome/aeris.css"),
    `:root {
  --frame-a: ${c.a};
  --frame-b: ${c.b};
  --text: ${c.dark ? "#1d3550" : "#fff"};
  --text-shadow: ${c.dark ? "0 1px 0 rgba(255,255,255,0.7)" : "0 1px 2px rgba(0, 40, 90, 0.55)"};
  --accent: ${s.accent || c.accent};
  --gloss: ${s.gloss / 100};
}`,
    s.colorTheme === "studio" ? studioCss(s.studio || {}) : theme ? await css(`themes/${theme.id}/chrome.css`) : "",
    side ? (await css("chrome/side.css")) + (theme ? await css(`themes/${theme.id}/chrome-side.css`) : "") : "",
    s.tabShape === "pill" ? await css("chrome/shape-pill.css") : s.tabShape === "square" ? await css("chrome/shape-square.css") : "",
    s.winButtons === "glossy" ? await css("chrome/buttons-glossy.css") : "",
    s.size === "compact" ? await css("chrome/size-compact.css") : "",
    s.focus ? await css("chrome/focus.css") : "",
    // An accent you picked yourself still wins over the custom theme's.
    theme && s.accent ? `:root { --accent: ${s.accent} !important; }` : ""
  ];
  return parts.join("\n");
}

// Tabs top/left/right and the size are Firefox settings (its own side tabs and density).
async function applyLayout(s) {
  await browser.aeris.setPrefs({
    "sidebar.verticalTabs": s.bars === "left" || s.bars === "right",
    "sidebar.position_start": s.bars !== "right",
    "browser.uidensity": s.size === "compact" ? 1 : 0
  });
}

// Theme changes run one at a time; a change made while one is running is applied straight after.
let applying = null;
let applyAgain = false;
function applyTheme() {
  if (applying) {
    applyAgain = true;
    return applying;
  }
  applying = (async () => {
    try {
      do {
        applyAgain = false;
        await applyThemeNow();
      } while (applyAgain);
    } finally {
      applying = null;
    }
  })();
  return applying;
}

async function applyThemeNow() {
  const s = await settings();
  const theme = THEMES.find(t => t.id === s.theme) || null;

  // The browser frame first, so the change shows up straight away
  const plain = s.colorTheme === "firefox" || s.colorTheme === "minimal" || s.colorTheme === "studio";
  if (s.colorTheme === "firefox") {
    // "Firefox's own look"
    await browser.theme.reset();
    await browser.aeris.setChromeStyle(await css("chrome/stacking.css"));
  } else if (s.colorTheme === "studio") {
    // Your own look, made in the Theme Studio
    await browser.theme.update(studioApiColors(s.studio || {}));
    await browser.aeris.setChromeStyle(await buildChromeCss(s, null));
  } else if (s.colorTheme === "minimal") {
    // Minimal: Firefox's own colours (light or dark, like Windows), with a few clean touches
    await browser.theme.reset();
    await browser.aeris.setChromeStyle(await buildChromeCss(s, null));
  } else {
    await browser.theme.update(themeApiColors(activeColors(s, theme), theme));
    await browser.aeris.setChromeStyle(await buildChromeCss(s, theme));
  }

  // Then the website styles: fixes that make sites look right in Aeris, Aero's gentle restyle if
  // it's on, and the theme's own styles (websites.css for every site, sites/<domain>.css for one).
  const all = ["http://*/*", "https://*/*"];
  const wanted = [{ matches: all, css: [{ file: "content/site-fixes.css" }], runAt: "document_start" }];
  if (s.restyle && s.colorTheme !== "minimal") wanted.push({ matches: all, css: [{ file: "content/aero-sites.css" }], runAt: "document_start" });
  const custom = plain ? null : theme;
  if (custom?.websitesCss) wanted.push({ matches: all, css: [{ file: `themes/${custom.id}/websites.css` }], runAt: "document_start" });
  for (const domain of custom?.sites || []) {
    wanted.push({ matches: [`*://${domain}/*`, `*://*.${domain}/*`], css: [{ file: `themes/${custom.id}/sites/${domain}.css` }], runAt: "document_start" });
  }
  const old = registered;
  registered = await Promise.all(wanted.map(w => browser.contentScripts.register(w)));
  for (const r of old) r.unregister();

  // site.js paints sites' plain white boxes in the theme's paper colour.
  await browser.storage.local.set({ paper: custom?.paper || null });
}

// ================= Moving in from Aero =================

async function importFromAero() {
  const result = { bookmarks: 0, apps: 0, passwords: 0, theme: null, found: false, error: null };
  try {
    const data = await browser.aeris.readAeroExport();
    if (data) {
      result.found = true;
      const toolbar = "toolbar_____";
      const existing = new Set((await browser.bookmarks.search({})).map(b => b.url));
      for (const b of data.prefs?.bookmarks || []) {
        if (!b.url || existing.has(b.url)) continue;
        await browser.bookmarks.create({ parentId: toolbar, title: b.title || b.url, url: b.url });
        existing.add(b.url);
        result.bookmarks++;
      }
      const apps = (data.prefs?.apps || []).filter(a => a.url && !existing.has(a.url));
      if (apps.length) {
        const folder = await browser.bookmarks.create({ parentId: toolbar, title: "Apps" });
        for (const a of apps) await browser.bookmarks.create({ parentId: folder.id, title: a.name || a.url, url: a.url });
        result.apps = apps.length;
      }
      // Aero's apps also go in the side panel's Apps, like Aero's apps sidebar
      if (data.prefs?.apps?.length) {
        const { apps: panelApps } = await browser.storage.local.get({ apps: null });
        const have = new Set((panelApps || []).map(a => a.url));
        const merged = [...(panelApps || []), ...data.prefs.apps.filter(a => a.url && !have.has(a.url)).map(a => ({ id: a.id || crypto.randomUUID(), name: a.name || a.url, url: a.url }))];
        await browser.storage.local.set({ apps: merged });
      }
      const theme = data.state?.activeTheme;
      // Aero hides Google's AI answers unless you switched that off.
      const changes = { hideAi: data.state?.hideAi !== false };
      if (theme && THEMES.some(t => t.id === theme)) changes.theme = result.theme = theme;
      if (typeof data.prefs?.restyle === "boolean") changes.restyle = data.prefs.restyle;
      // Your Aero Customize choices (Aeris can't put tabs at the bottom, so those go on top).
      for (const key of Object.keys(LOOK)) {
        if (data.prefs?.[key] !== undefined) changes[key] = data.prefs[key];
      }
      if (COLOR_THEMES[data.prefs?.theme]) changes.colorTheme = data.prefs.theme;
      if (changes.bars === "bottom") changes.bars = "top";
      await browser.storage.local.set(changes);
      await applyLayout(await settings());
    }
  } catch (e) {
    result.error = String(e.message || e);
  }
  try {
    result.passwords = await browser.aeris.importAeroPasswords();
    if (result.passwords) result.found = true;
  } catch (e) {
    result.error = result.error || "Passwords: " + (e.message || e);
  }
  await browser.storage.local.set({ imported: true, importResult: result });
  return result;
}

// ================= Updates =================
// Like Aero: new versions download quietly from GitHub and install when you close Aeris.

async function checkForUpdate() {
  try {
    const { aeris: current } = await browser.aeris.appInfo();
    const release = await (await fetch(RELEASES, { cache: "no-store" })).json();
    const version = String(release.tag_name || "").replace(/^v/, "");
    const asset = (release.assets || []).find(a => /^Aeris-Setup-.*\.exe$/i.test(a.name));
    if (!asset || !newer(version, current)) {
      await browser.storage.local.set({ update: { state: "latest", checked: Date.now() } });
      return;
    }
    const { update } = await settings();
    if (update?.state === "ready" && update.version === version) return;
    await browser.storage.local.set({ update: { state: "downloading", version } });
    await browser.aeris.downloadUpdate(asset.browser_download_url, version);
    await browser.storage.local.set({ update: { state: "ready", version } });
    browser.browserAction.setBadgeText({ text: "↑" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#2fb52f" });
  } catch (e) {
    await browser.storage.local.set({ update: { state: "error", error: String(e.message || e) } });
  }
}

// ================= YouTube players on Aeris's own pages =================
// YouTube players refuse to start without a "Referer", which pages like the New Tab don't send.
const OWN_PAGES = browser.runtime.getURL("");
browser.webRequest.onBeforeSendHeaders.addListener(details => {
  const from = details.documentUrl || details.originUrl || "";
  if (!from.startsWith(OWN_PAGES)) return {};
  const headers = details.requestHeaders.filter(h => h.name.toLowerCase() !== "referer");
  headers.push({ name: "Referer", value: "https://aeris.app/" });
  return { requestHeaders: headers };
}, { urls: ["*://*.youtube.com/embed/*", "*://*.youtube-nocookie.com/embed/*"] }, ["blocking", "requestHeaders"]);

// ================= Start =================

// The Aeris button opens the side panel (Customize and Notes), like Aero's ✨ button.
browser.browserAction.onClicked.addListener(() => browser.sidebarAction.toggle());

// ================= Notes: clip text from websites =================

browser.menus.create({ id: "clip", title: "Clip to Aeris Notes", contexts: ["selection"] });
browser.menus.create({ id: "clip-page", title: "Add this page to Aeris Notes", contexts: ["page"] });
browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "clip" && info.menuItemId !== "clip-page") return;
  browser.sidebarAction.open(); // must come first: it only works straight after your click
  const { notes, currentNote } = await browser.storage.local.get({ notes: [], currentNote: null });
  let note = notes.find(n => n.id === currentNote);
  if (!note) {
    note = { id: crypto.randomUUID(), text: "", updated: 0 };
    notes.push(note);
  }
  const clip = info.menuItemId === "clip"
    ? `> ${info.selectionText.trim().replace(/\n+/g, "\n> ")}\n— ${tab.title} (${tab.url})\n`
    : `${tab.title}\n${tab.url}\n`;
  note.text = (note.text.trimEnd() ? note.text.trimEnd() + "\n\n" : "") + clip;
  note.updated = Date.now();
  await browser.storage.local.set({ notes, currentNote: note.id, panelView: "notes" });
  Sound.bloop();
});

// Customize changes show up straight away, like in Aero.
browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  const keys = Object.keys(changes);
  if (keys.some(k => k === "theme" || k === "restyle" || k === "studio" || k in LOOK)) applyTheme();
  if (keys.some(k => k === "bars" || k === "size")) applyLayout(await settings());
  if (changes.stacking) browser.aeris.setTabStacking(changes.stacking.newValue !== false);
});

// ================= Bubbly sounds (Aero's, made with the Web Audio API) =================

const Sound = {
  ctx: null,
  on: true,
  tone(type, from, to, dur, vol) {
    if (!this.on) return;
    this.ctx ||= new AudioContext();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },
  bloop() { this.tone("sine", 300, 900, 0.18, 0.2); },
  pop() { this.tone("sine", 1400, 2400, 0.07, 0.16); },
  click() { this.tone("triangle", 1800, 1400, 0.05, 0.1); }
};
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.sounds) Sound.on = changes.sounds.newValue !== false;
});
browser.tabs.onCreated.addListener(() => Sound.bloop());
browser.tabs.onRemoved.addListener((id, info) => { if (!info.isWindowClosing) Sound.pop(); });
browser.bookmarks.onCreated.addListener(() => Sound.bloop());
browser.bookmarks.onRemoved.addListener(() => Sound.pop());
browser.webNavigation.onCommitted.addListener(d => {
  if (d.frameId === 0 && d.transitionQualifiers.includes("forward_back")) Sound.click();
});

browser.runtime.onMessage.addListener(msg => {
  if (msg?.type === "import-aero") return importFromAero().then(r => (applyTheme(), r));
  if (msg?.type === "check-update") return checkForUpdate();
  if (msg?.type === "themes") return Promise.resolve({ colors: COLOR_THEMES, custom: THEMES });
});

browser.alarms.onAlarm.addListener(a => a.name === "update" && checkForUpdate());

(async function start() {
  THEMES = JSON.parse(await fileText("themes/index.json"));
  await browser.aeris.setNewTabPage(browser.runtime.getURL("newtab/index.html"));

  const s = await settings();
  Sound.on = s.sounds;
  browser.aeris.setTabStacking(s.stacking);
  if (!s.imported) await importFromAero();
  await applyTheme();

  const { aeris: version } = await browser.aeris.appInfo();
  if (s.lastVersion !== version) {
    await browser.storage.local.set({ lastVersion: version });
    // The very first window opens before Aeris Core is ready, on Firefox's home page.
    if (!s.lastVersion) {
      for (const tab of await browser.tabs.query({ url: "about:home" })) browser.tabs.update(tab.id, { url: browser.runtime.getURL("newtab/index.html") });
    }
    // Updates show What's New; the first start shows the welcome tour instead (below).
    if (s.lastVersion) browser.tabs.create({ url: browser.runtime.getURL(`whatsnew/index.html?app=Aeris&v=${version}&from=${encodeURIComponent(s.lastVersion)}`) });
  }
  // The welcome tour, once. TOUR goes up when the tour changes a lot, so testers see the new one.
  const TOUR = 3;
  const { toured } = await browser.storage.local.get({ toured: 0 });
  if (toured !== TOUR) {
    await browser.storage.local.set({ toured: TOUR });
    browser.tabs.create({ url: browser.runtime.getURL("welcome/index.html") });
  }

  browser.alarms.create("update", { delayInMinutes: 1, periodInMinutes: 360 });
})();
