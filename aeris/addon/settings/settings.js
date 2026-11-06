// Aeris settings: themes, browsing options, add-ons, moving in from Aero, and updates.

const $ = id => document.getElementById(id);
const store = browser.storage.local;
const AMO_API = "https://addons.mozilla.org/api/v5/addons/addon/";

function toast(text, error = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = error ? "error" : "";
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3200);
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ================= Themes =================

async function drawThemes() {
  const [themes, { theme: active }] = await Promise.all([browser.runtime.sendMessage({ type: "themes" }), store.get({ theme: "aqua-glass" })]);
  const grid = $("themeGrid");
  grid.innerHTML = "";
  const choices = [...themes, { id: "none", name: "Firefox's own look", description: "No theme: Firefox's normal colours.", vars: { "frame-a": "#f0f0f4", "frame-b": "#f9f9fb", accent: "#0061e0", text: "#15141a" } }];
  for (const t of choices) {
    const card = el("button", "glass card theme" + (t.id === active || (t.id === "none" && !themes.some(x => x.id === active)) ? " on" : ""));
    const preview = el("div", "preview");
    preview.style.background = `linear-gradient(180deg, ${t.vars["frame-a"]}, ${t.vars["frame-b"]})`;
    const dot = el("span", "dot");
    dot.style.background = t.vars.accent;
    const bar = el("span", "bar");
    bar.style.background = t.paper?.["google.com"] || "rgba(255,255,255,0.15)";
    preview.append(dot, bar);
    card.append(preview, el("h3", null, t.name), el("p", null, t.description));
    card.addEventListener("click", async () => {
      await store.set({ theme: t.id });
      drawThemes();
      toast(`${t.name} is on`);
    });
    grid.append(card);
  }
}

// ================= Browsing =================

async function drawBrowsing() {
  const s = await store.get({ hideAi: false, restyle: true });
  $("hideAi").checked = s.hideAi;
  $("restyle").checked = s.restyle;
}
$("hideAi").addEventListener("change", e => store.set({ hideAi: e.target.checked }));
$("restyle").addEventListener("change", e => store.set({ restyle: e.target.checked }));
for (const [id, url] of [["ffPrefs", "about:preferences"], ["ffImport", "about:preferences#general"]]) {
  $(id).addEventListener("click", e => {
    e.preventDefault();
    browser.aeris.openBrowserPage(url);
  });
}

// ================= Add-ons =================

function addonCard({ icon, name, author, category, description, warn }) {
  const card = el("div", "glass card");
  const top = el("div", "top");
  const orb = el("div", "icon");
  if (icon) {
    const img = el("img");
    img.src = icon;
    img.alt = "";
    orb.append(img);
  }
  const titles = el("div");
  titles.append(el("h3", null, name), el("div", "cat", [category, author && "by " + author].filter(Boolean).join(" · ")));
  top.append(orb, titles);
  card.append(top, el("p", null, description));
  if (warn) card.append(el("p", "warn", warn));
  const actions = el("div", "actions");
  card.append(actions);
  return { card, actions };
}

function button(label, cls, fn) {
  const b = el("button", "gel " + cls, label);
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { toast(String(e.message || e), true); }
    b.disabled = false;
  });
  return b;
}

async function drawOriginals() {
  const grid = $("originals");
  grid.innerHTML = "";
  for (const o of ORIGINALS) {
    const [info] = await browser.aeris.addonInfo([o.id], o.page);
    const { card, actions } = addonCard({ ...o, category: "Aero Original" });
    if (info.installed) {
      actions.append(el("span", "installed", "✓ Installed"));
      if (info.page) actions.append(button("Open", "", () => browser.tabs.create({ url: info.page })));
      actions.append(button("Remove", "red", async () => { await browser.aeris.removeAddon(o.id); toast(`${o.name} removed`); drawOriginals(); }));
    } else {
      actions.append(button("Install", "", async () => {
        await browser.aeris.installAddon(o.file);
        toast(`${o.name} installed`);
        drawOriginals();
      }));
    }
    grid.append(card);
  }
}

async function drawRecommended() {
  const grid = $("recommended");
  grid.innerHTML = "";
  for (const r of RECOMMENDED) {
    let a;
    try { a = await (await fetch(AMO_API + r.slug + "/")).json(); } catch { continue; }
    if (!a?.guid) continue;
    const pick = v => (typeof v === "object" && v ? v["en-US"] || Object.values(v)[0] : v) || "";
    const name = pick(a.name);
    const [info] = await browser.aeris.addonInfo([a.guid]);
    const { card, actions } = addonCard({ icon: a.icon_url, name, category: r.category, description: pick(a.summary) });
    if (info.installed) {
      actions.append(el("span", "installed", "✓ Installed"));
      actions.append(button("Remove", "red", async () => { await browser.aeris.removeAddon(a.guid); toast(`${name} removed`); drawRecommended(); }));
    } else {
      actions.append(button("Install", "", async () => {
        await browser.aeris.installAddon(a.current_version.file.url);
        toast(`${name} installed`);
        drawRecommended();
      }));
    }
    grid.append(card);
  }
}

// ================= From Aero =================

function describeImport(r) {
  if (!r) return "Aeris brings over your bookmarks, apps, theme, settings and saved passwords from Aero.";
  if (!r.found) return "No Aero data was found on this computer. If you used Aero, open it once (version 0.6.5 or newer) and then press the button.";
  const parts = [];
  if (r.bookmarks) parts.push(`${r.bookmarks} bookmark${r.bookmarks === 1 ? "" : "s"}`);
  if (r.apps) parts.push(`${r.apps} app${r.apps === 1 ? "" : "s"} (in the "Apps" folder on your bookmarks bar)`);
  if (r.passwords) parts.push(`${r.passwords} password${r.passwords === 1 ? "" : "s"}`);
  if (r.theme) parts.push("your theme");
  const brought = parts.length ? `Brought over from Aero: ${parts.join(", ")}.` : "Everything from Aero was already here.";
  return r.error ? `${brought} (Something didn't come over: ${r.error})` : brought;
}

async function drawImport() {
  const { importResult } = await store.get({ importResult: null });
  $("importText").textContent = describeImport(importResult);
}
$("importBtn").addEventListener("click", async () => {
  $("importBtn").disabled = true;
  const r = await browser.runtime.sendMessage({ type: "import-aero" });
  $("importBtn").disabled = false;
  $("importText").textContent = describeImport(r);
  drawThemes();
  drawBrowsing();
});

// ================= Updates =================

async function drawUpdates() {
  const [{ update }, info] = await Promise.all([store.get({ update: null }), browser.aeris.appInfo()]);
  $("versionLine").textContent = `Version ${info.aeris} · built on Firefox ${info.firefox}`;
  const text = {
    latest: "You have the newest Aeris.",
    downloading: `Downloading Aeris ${update?.version}…`,
    ready: `Aeris ${update?.version} is ready. It installs when you close Aeris, or now with Restart to update.`,
    error: `Couldn't check for updates (${update?.error}).`
  }[update?.state] || "Aeris checks for new versions on its own and installs them when you close it.";
  $("updateText").textContent = text;
  $("restartBtn").classList.toggle("hidden", update?.state !== "ready");
}
$("checkBtn").addEventListener("click", async () => {
  $("checkBtn").disabled = true;
  $("updateText").textContent = "Checking…";
  await browser.runtime.sendMessage({ type: "check-update" });
  $("checkBtn").disabled = false;
  drawUpdates();
});
$("restartBtn").addEventListener("click", () => browser.aeris.restartToUpdate());

browser.storage.onChanged.addListener(changes => {
  if (changes.update) drawUpdates();
  if (changes.theme) drawThemes();
});

drawThemes();
drawBrowsing();
drawOriginals();
drawRecommended();
drawImport();
drawUpdates();

// ================= Look (same as the Aero Web Store) =================

// Floating bubbles in the sky.
for (let i = 0; i < 14; i++) {
  const b = document.createElement("span");
  const size = 18 + Math.random() * 60;
  b.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${14 + Math.random() * 18}s;animation-delay:${-Math.random() * 30}s;--drift:${(Math.random() - 0.5) * 120}px`;
  $("bubbles").append(b);
}

// Themes can make the glass dark (like Dark Mode). Then the text switches to light colours.
function matchGlass() {
  const probe = document.querySelector(".glass");
  if (!probe) return;
  const cs = getComputedStyle(probe);
  const colors = (cs.backgroundImage + " " + cs.backgroundColor).match(/rgba?\([^)]+\)/g) || [];
  const solid = colors.map(c => c.match(/[\d.]+/g).map(Number)).filter(v => v.length < 4 || v[3] > 0.25);
  if (!solid.length) return;
  const light = solid.reduce((sum, [r, g, b]) => sum + (0.299 * r + 0.587 * g + 0.114 * b), 0) / solid.length;
  document.body.classList.toggle("dark-glass", light < 128);
}
$("aeroTheme").addEventListener("load", matchGlass);
$("aeroTheme").addEventListener("error", matchGlass);
new MutationObserver(() => setTimeout(matchGlass, 300)).observe($("aeroTheme"), { attributes: true, attributeFilter: ["href"] });
