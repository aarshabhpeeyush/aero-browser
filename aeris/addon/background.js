// Aeris Core: themes, New Tab, moving in from Aero, Aero Originals and updates.
// The privileged bits (restyling the browser frame, passwords, installing) are in api/parent.js.

const DEFAULT_THEME = "aqua-glass";
const RELEASES = "https://api.github.com/repos/aarshabhpeeyush/aero-browser/releases/latest";
const DEFAULTS = { theme: DEFAULT_THEME, hideAi: false, restyle: true, imported: false, lastVersion: null, update: null };

let THEMES = [];
let chromeCss = "";
let registered = []; // website stylesheets for the active theme

const settings = () => browser.storage.local.get(DEFAULTS);
const fileText = async path => (await fetch(browser.runtime.getURL(path))).text();

// ================= Themes =================

// "a.b.c" > "a.b.d"? A beta comes before its finished version: 1.0.0-beta.1 < 1.0.0-beta.2 < 1.0.0.
function newer(a, b) {
  const [na, pre_a] = a.split("-"), [nb, pre_b] = b.split("-");
  const pa = na.split(".").map(Number), pb = nb.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  if (!pre_a || !pre_b) return !pre_a && !!pre_b;
  return pre_a.localeCompare(pre_b, undefined, { numeric: true }) > 0;
}

// Each theme's colours come from its Aero theme.css. Light themes have a "paper" colour (what
// Google gets painted in), which also makes a good toolbar; dark themes use their own frame colour.
function colorsFor(theme) {
  const v = theme.vars;
  const paper = theme.paper?.["google.com"];
  const dark = !paper;
  const toolbar = paper || `color-mix(in srgb, ${v["frame-b"]} 80%, black)`;
  const toolbarText = dark ? v.text : "#14283c";
  return {
    dark,
    vars: {
      "--aeris-frame-a": v["frame-a"],
      "--aeris-frame-b": v["frame-b"],
      "--aeris-accent": v.accent,
      "--aeris-text": v.text,
      "--aeris-text-shadow": v["text-shadow"] || "0 1px 2px rgba(0, 0, 0, 0.35)",
      "--aeris-gloss": v.gloss ?? "0.7",
      "--aeris-radius": v["tab-radius"] || "12px",
      "--aeris-toolbar": toolbar,
      "--aeris-toolbar-text": toolbarText,
      "--aeris-field": dark ? "rgba(255, 255, 255, 0.1)" : "#fff",
      "--aeris-field-text": dark ? v.text : "#10202e",
      "--aeris-dark": dark ? "1" : "0"
    },
    // Firefox draws menus, popups and the sidebar itself, so it gets the colours too.
    // (The theme API only takes plain colours, so dark toolbars use the frame colour.)
    api: {
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
        sidebar: dark ? "#141a26" : paper,
        sidebar_text: dark ? v.text : "#14283c",
        ntp_background: v["frame-b"],
        ntp_text: v.text
      },
      properties: {
        color_scheme: dark ? "dark" : "light",
        content_color_scheme: theme.websites === "dark" ? "dark" : theme.websites === "light" ? "light" : "auto"
      }
    }
  };
}

async function applyTheme() {
  const s = await settings();
  const theme = THEMES.find(t => t.id === s.theme);

  for (const r of registered) r.unregister();
  registered = [];

  // Fixes that make websites look right in Aeris, plus Aero's gentle restyle if switched on.
  registered.push(await browser.contentScripts.register({ matches: ["http://*/*", "https://*/*"], css: [{ file: "content/site-fixes.css" }], runAt: "document_start" }));
  if (s.restyle) registered.push(await browser.contentScripts.register({ matches: ["http://*/*", "https://*/*"], css: [{ file: "content/aero-sites.css" }], runAt: "document_start" }));

  if (!theme) {
    // "Firefox's own look"
    await browser.theme.reset();
    await browser.aeris.setChromeStyle("");
    await browser.storage.local.set({ paper: null });
    return;
  }

  const c = colorsFor(theme);
  await browser.theme.update(c.api);
  const vars = Object.entries(c.vars).map(([k, val]) => `  ${k}: ${val};`).join("\n");
  await browser.aeris.setChromeStyle(`:root {\n${vars}\n}\n${chromeCss}`);

  // The theme's own website styles: websites.css for every site, sites/<domain>.css for one site.
  if (theme.websitesCss) {
    registered.push(await browser.contentScripts.register({ matches: ["http://*/*", "https://*/*"], css: [{ file: `themes/${theme.id}/websites.css` }], runAt: "document_start" }));
  }
  for (const domain of theme.sites) {
    registered.push(await browser.contentScripts.register({
      matches: [`*://${domain}/*`, `*://*.${domain}/*`],
      css: [{ file: `themes/${theme.id}/sites/${domain}.css` }],
      runAt: "document_start"
    }));
  }
  // site.js paints sites' plain white boxes in the theme's paper colour.
  await browser.storage.local.set({ paper: theme.paper || null });
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
      const theme = data.state?.activeTheme;
      // Aero hides Google's AI answers unless you switched that off.
      const changes = { hideAi: data.state?.hideAi !== false };
      if (theme && THEMES.some(t => t.id === theme)) changes.theme = result.theme = theme;
      if (typeof data.prefs?.restyle === "boolean") changes.restyle = data.prefs.restyle;
      await browser.storage.local.set(changes);
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

async function openSettings(hash = "") {
  const url = browser.runtime.getURL("settings/index.html");
  const [tab] = await browser.tabs.query({ url: url + "*" });
  if (tab) return browser.tabs.update(tab.id, { active: true, url: url + hash });
  return browser.tabs.create({ url: url + hash });
}

browser.browserAction.onClicked.addListener(() => openSettings());

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.theme || changes.restyle)) applyTheme();
});

browser.runtime.onMessage.addListener(msg => {
  if (msg?.type === "import-aero") return importFromAero().then(r => (applyTheme(), r));
  if (msg?.type === "check-update") return checkForUpdate();
  if (msg?.type === "themes") return Promise.resolve(THEMES);
});

browser.alarms.onAlarm.addListener(a => a.name === "update" && checkForUpdate());

(async function start() {
  THEMES = JSON.parse(await fileText("themes/index.json"));
  chromeCss = await fileText("chrome/aeris.css");
  await browser.aeris.setNewTabPage(browser.runtime.getURL("newtab/index.html"));

  const s = await settings();
  if (!s.imported) await importFromAero();
  await applyTheme();

  const { aeris: version } = await browser.aeris.appInfo();
  if (s.lastVersion !== version) {
    await browser.storage.local.set({ lastVersion: version });
    // The very first window opens before Aeris Core is ready, on Firefox's home page.
    if (!s.lastVersion) {
      for (const tab of await browser.tabs.query({ url: "about:home" })) browser.tabs.update(tab.id, { url: browser.runtime.getURL("newtab/index.html") });
    }
    const { importResult } = await browser.storage.local.get("importResult");
    const from = s.lastVersion || (importResult?.found ? "Aero" : null);
    browser.tabs.create({ url: browser.runtime.getURL(`whatsnew/index.html?app=Aeris&v=${version}${from ? "&from=" + encodeURIComponent(from) : ""}`) });
  }

  browser.alarms.create("update", { delayInMinutes: 1, periodInMinutes: 360 });
})();
