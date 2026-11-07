// Aeris's Customize panel: the same choices as Aero's, saved to storage. background.js applies them
// to the browser straight away. A few are Firefox's own settings (data-ffpref), changed through
// Aeris Core's privileged API.

const $ = sel => document.querySelector(sel);
const store = browser.storage.local;
const UBLOCK = "uBlock0@raymondhill.net";
const LOOK_DEFAULTS = { theme: null, colorTheme: "frost", accent: null, gloss: 70, bars: "top", tabShape: "rounded", winButtons: "simple", size: "comfy", restyle: true, hideAi: true, sounds: true, focus: false, napAfter: 0, breakEvery: 0, stacking: true };

let colorThemes = {};
let customThemes = [];
let prefs = { ...LOOK_DEFAULTS };

const change = (key, value) => store.set({ [key]: value });

// Pop-up boxes don't work in a side panel, so a risky button asks "Sure?" and needs a second click.
function confirmClick(button, action) {
  button.addEventListener("click", async e => {
    e.stopPropagation();
    if (!button.dataset.armed) {
      button.dataset.armed = button.textContent;
      button.textContent = "Sure?";
      setTimeout(() => {
        if (button.dataset.armed) button.textContent = button.dataset.armed;
        delete button.dataset.armed;
      }, 3000);
      return;
    }
    delete button.dataset.armed;
    await action();
  });
}

// ================= Look of this panel (follows your theme, like Aero's panel) =================

function paintPanel() {
  const c = colorThemes[prefs.colorTheme] || colorThemes.frost || { a: "#c3d8ea", b: "#e2eef8", accent: "#3d8bd4" };
  $("#prefVars").textContent = `:root {
    --frame-a: ${c.a};
    --frame-b: ${c.b};
    --accent: ${prefs.accent || c.accent};
    --gloss: ${prefs.gloss / 100};
  }`;
  const theme = customThemes.find(t => t.id === prefs.theme);
  const href = theme ? `../themes/${theme.id}/theme.css` : "";
  if ($("#userTheme").getAttribute("href") !== href) $("#userTheme").setAttribute("href", href);
}

// ================= Theme =================

function drawThemes() {
  const box = $("#themes");
  box.innerHTML = "";
  const extras = [
    ["minimal", { name: "Minimal", a: "#fafafa", b: "#e9e9ed", dark: true, title: "A plain, modern look: no gloss or orbs, light or dark like Windows" }],
    ["firefox", { name: "Firefox look", a: "#f0f0f4", b: "#f9f9fb", dark: true, title: "No Aero look: Firefox's normal colours" }]
  ];
  for (const [id, t] of [...Object.entries(colorThemes), ...extras]) {
    const b = document.createElement("button");
    b.dataset.theme = id;
    b.textContent = t.name;
    if (t.dark) b.style.color = "#1d3550";
    if (t.dark) b.style.textShadow = "0 1px 0 rgba(255,255,255,0.7)";
    b.style.background = `linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0) 51%), linear-gradient(180deg, ${t.a}, ${t.b})`;
    b.title = t.title || t.name;
    b.addEventListener("click", () => store.set({ colorTheme: id, accent: null }));
    box.append(b);
  }

  const rows = $("#customThemes");
  rows.innerHTML = "";
  for (const t of [{ id: null, name: "None", description: "Just the colours above" }, ...customThemes]) {
    const row = document.createElement("button");
    row.className = "profile-row theme-row";
    row.dataset.theme = t.id ?? "";
    row.innerHTML = `<span class="pick"></span><span class="who"><b></b><small></small></span>`;
    row.querySelector("b").textContent = t.name;
    row.querySelector("small").textContent = t.description || "";
    row.title = t.description || "";
    row.addEventListener("click", () => change("theme", t.id));
    rows.append(row);
  }
}

$("#accent").addEventListener("input", e => change("accent", e.target.value));
$("#accentReset").addEventListener("click", () => change("accent", null));
$("#gloss").addEventListener("input", e => change("gloss", +e.target.value));

// ================= Layout and browsing =================

document.querySelectorAll(".choice[data-pref]").forEach(group => {
  const num = group.hasAttribute("data-num");
  group.querySelectorAll("button").forEach(b => b.addEventListener("click", () => change(group.dataset.pref, num ? +b.dataset.value : b.dataset.value)));
});
document.querySelectorAll("input[type=checkbox][data-pref]").forEach(box => {
  box.addEventListener("change", () => change(box.dataset.pref, box.checked));
});

// Firefox's own settings
const ffBoxes = [...document.querySelectorAll("input[data-ffpref]")];
async function drawFirefoxPrefs() {
  const names = [...ffBoxes.map(b => b.dataset.ffpref), "browser.toolbars.bookmarks.visibility"];
  const values = await browser.aeris.getPrefs(names);
  for (const box of ffBoxes) box.checked = !!values[box.dataset.ffpref];
  $("#bookmarksBar").checked = values["browser.toolbars.bookmarks.visibility"] === "always";
}
for (const box of ffBoxes) {
  box.addEventListener("change", () => browser.aeris.setPrefs({ [box.dataset.ffpref]: box.checked }));
}
$("#bookmarksBar").addEventListener("change", e => {
  browser.aeris.setPrefs({ "browser.toolbars.bookmarks.visibility": e.target.checked ? "always" : "never" });
});

async function drawSearch() {
  const engines = await browser.aeris.searchEngines();
  const select = $("#search");
  select.innerHTML = "";
  for (const e of engines) {
    const o = document.createElement("option");
    o.value = o.textContent = e.name;
    o.selected = e.isDefault;
    select.append(o);
  }
}
$("#search").addEventListener("change", e => browser.aeris.setSearchEngine(e.target.value));

async function drawAdblock() {
  const [info] = await browser.aeris.addonInfo([UBLOCK]);
  const box = $("#adblock");
  box.disabled = !info.installed;
  box.checked = info.installed && info.enabled;
  box.parentElement.title = info.installed ? "uBlock Origin" : "uBlock Origin isn't installed. Get it from the Aeris Store.";
}
$("#adblock").addEventListener("change", async e => {
  await browser.aeris.setAddonEnabled(UBLOCK, e.target.checked);
  drawAdblock();
});

// Show what's chosen
function drawChoices() {
  document.querySelectorAll("#themes button").forEach(b => b.classList.toggle("on", b.dataset.theme === prefs.colorTheme));
  document.querySelectorAll("#customThemes .theme-row").forEach(r => r.classList.toggle("on", r.dataset.theme === (prefs.theme ?? "")));
  document.querySelectorAll(".choice[data-pref]").forEach(group => {
    group.querySelectorAll("button").forEach(b => b.classList.toggle("on", String(prefs[group.dataset.pref]) === b.dataset.value));
  });
  document.querySelectorAll("input[type=checkbox][data-pref]").forEach(box => (box.checked = !!prefs[box.dataset.pref]));
  const c = colorThemes[prefs.colorTheme];
  const theme = customThemes.find(t => t.id === prefs.theme);
  $("#accent").value = prefs.accent || theme?.vars?.accent || c?.accent || "#3d8bd4";
  $("#gloss").value = prefs.gloss;
  paintPanel();
}

// ================= Add-ons, bookmarks, default browser =================

$("#openStore").addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("settings/index.html") }));
$("#openAddons").addEventListener("click", () => browser.aeris.openBrowserPage("about:addons"));
$("#importOther").addEventListener("click", () => browser.aeris.openImportWizard());
$("#library").addEventListener("click", () => browser.aeris.openLibrary());
$("#passwords").addEventListener("click", () => browser.aeris.openBrowserPage("about:logins"));
$("#ffSettings").addEventListener("click", () => browser.aeris.openBrowserPage("about:preferences"));

function describeImport(r) {
  if (!r) return "Bring your bookmarks, apps, theme, settings and saved passwords over from Aero.";
  if (!r.found) return "No Aero data was found on this computer. Open Aero once (version 0.6.5 or newer), then press the button.";
  const parts = [];
  if (r.bookmarks) parts.push(`${r.bookmarks} bookmark${r.bookmarks === 1 ? "" : "s"}`);
  if (r.apps) parts.push(`${r.apps} app${r.apps === 1 ? "" : "s"} (in the "Apps" folder)`);
  if (r.passwords) parts.push(`${r.passwords} password${r.passwords === 1 ? "" : "s"}`);
  if (r.theme) parts.push("your theme");
  const brought = parts.length ? `Brought over from Aero: ${parts.join(", ")}.` : "Everything from Aero is already here.";
  return r.error ? `${brought} (Something didn't come over: ${r.error})` : brought;
}
async function drawImport() {
  const { importResult } = await store.get({ importResult: null });
  $("#importText").textContent = describeImport(importResult);
}
$("#importAero").addEventListener("click", async () => {
  $("#importAero").disabled = true;
  $("#importText").textContent = describeImport(await browser.runtime.sendMessage({ type: "import-aero" }));
  $("#importAero").disabled = false;
});

async function drawDefault() {
  const isDefault = await browser.aeris.isDefaultBrowser();
  $("#defaultText").textContent = isDefault ? "Aeris is your default browser. ✓" : "Links from other apps open in another browser.";
  $("#defaultSet").hidden = isDefault;
}
$("#defaultSet").addEventListener("click", async () => {
  await browser.aeris.makeDefaultBrowser();
  setTimeout(drawDefault, 3000);
});

// ================= About and updates =================

async function drawAbout() {
  const [{ update }, info] = await Promise.all([store.get({ update: null }), browser.aeris.appInfo()]);
  $("#version").textContent = info.aeris.replace(/-beta\.(\d+)$/, " Beta $1") + ` · Firefox ${info.firefox}`;
  $("#updateText").textContent = {
    latest: "You have the newest Aeris.",
    downloading: `Downloading Aeris ${update?.version}…`,
    ready: `Aeris ${update?.version} is ready. It installs when you close Aeris.`,
    error: `Couldn't check for updates (${update?.error}).`
  }[update?.state] || "Aeris updates itself.";
  $("#restartUpdate").hidden = update?.state !== "ready";
}
$("#checkUpdates").addEventListener("click", async () => {
  $("#updateText").textContent = "Checking…";
  await browser.runtime.sendMessage({ type: "check-update" });
  drawAbout();
});
$("#restartUpdate").addEventListener("click", () => browser.aeris.restartToUpdate());
$("#tour").addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("welcome/index.html") }));
$("#whatsNew").addEventListener("click", async () => {
  const { aeris } = await browser.aeris.appInfo();
  browser.tabs.create({ url: browser.runtime.getURL(`whatsnew/index.html?app=Aeris&v=${aeris}`) });
});

// ================= Customize / Notes =================

document.querySelectorAll(".switcher button").forEach(b => b.addEventListener("click", () => showView(b.dataset.show)));
function showView(name) {
  for (const view of ["customize", "notes", "apps", "spaces"]) $(`#${view}View`).hidden = name !== view;
  document.querySelectorAll(".switcher button").forEach(b => b.classList.toggle("on", b.dataset.show === name));
  store.set({ panelView: name });
}

// ================= Start =================

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let redraw = false;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in LOOK_DEFAULTS) {
      prefs[key] = newValue === undefined ? LOOK_DEFAULTS[key] : newValue;
      redraw = true;
    }
  }
  if (redraw) drawChoices();
  if (changes.update) drawAbout();
  if (changes.importResult) drawImport();
  if (changes.panelView && !document.hasFocus()) showView(changes.panelView.newValue);
});

(async () => {
  const [themes, saved, { panelView }] = await Promise.all([
    browser.runtime.sendMessage({ type: "themes" }),
    store.get(LOOK_DEFAULTS),
    store.get({ panelView: "customize" })
  ]);
  colorThemes = themes.colors;
  customThemes = themes.custom;
  prefs = saved;
  drawThemes();
  drawChoices();
  showView(panelView);
  drawFirefoxPrefs();
  drawSearch();
  drawAdblock();
  drawImport();
  drawDefault();
  drawAbout();
})();
