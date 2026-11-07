// The welcome tour: every choice is saved straight away, so Aeris changes as you click.

const $ = sel => document.querySelector(sel);
const store = browser.storage.local;
const UBLOCK = "uBlock0@raymondhill.net";
const steps = [...document.querySelectorAll(".step")];
let at = 0;
let prefs = {};

// ================= Moving between steps =================

function show(i) {
  at = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach((s, n) => (s.hidden = n !== at));
  // Page one shows the welcome picture as it is; the others soften it behind a glass sheet
  $("#scene").classList.toggle("soft", at > 0);
  document.querySelectorAll("#thumbs button").forEach((t, n) => t.classList.toggle("current", n === at));
}
// The step bar at the bottom: a glossy pill for each step
steps.forEach((s, n) => {
  const t = document.createElement("button");
  t.title = s.dataset.label;
  t.textContent = s.dataset.label;
  t.addEventListener("click", () => show(n));
  $("#thumbs").append(t);
});
document.querySelectorAll(".next").forEach(b => b.addEventListener("click", () => show(at + 1)));
document.querySelectorAll(".back").forEach(b => b.addEventListener("click", () => show(at - 1)));

// ================= Choices =================

function markChoices() {
  document.querySelectorAll("#swatches button").forEach(b => b.classList.toggle("on", b.dataset.value === prefs.colorTheme));
  document.querySelectorAll("#customs button").forEach(b => b.classList.toggle("on", b.dataset.value === String(prefs.theme)));
  document.querySelectorAll("[data-pref] > button").forEach(b => b.classList.toggle("on", prefs[b.parentElement.dataset.pref] === b.dataset.value));
  document.querySelectorAll("input[data-pref]").forEach(box => (box.checked = !!prefs[box.dataset.pref]));
  document.documentElement.style.setProperty("--accent", (prefs.colors[prefs.colorTheme] || {}).accent || "#1e9be8");
}

async function draw() {
  const { colors, custom } = await browser.runtime.sendMessage({ type: "themes" });
  prefs = { ...(await store.get({ colorTheme: "frost", theme: null, bars: "top", tabShape: "rounded", size: "comfy", hideAi: true, sounds: true, restyle: true })), colors };

  const plain = { minimal: { name: "Minimal", a: "#fafafa", b: "#e9e9ed", dark: true } };
  for (const [id, t] of Object.entries({ ...colors, ...plain })) {
    const b = document.createElement("button");
    b.dataset.value = id;
    b.textContent = t.name;
    if (t.dark) b.style.cssText = "color:#1d3550;text-shadow:0 1px 0 rgba(255,255,255,0.7)";
    b.style.background = `linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0) 51%), linear-gradient(180deg, ${t.a}, ${t.b})`;
    b.addEventListener("click", () => set({ colorTheme: id, accent: null }));
    $("#swatches").append(b);
  }
  for (const t of [{ id: null, name: "No custom theme", description: "Just the colours above" }, ...custom]) {
    const b = document.createElement("button");
    b.dataset.value = String(t.id);
    b.innerHTML = "<b></b><small></small>";
    b.querySelector("b").textContent = t.name;
    b.querySelector("small").textContent = t.description || "";
    b.addEventListener("click", () => set({ theme: t.id }));
    $("#customs").append(b);
  }
  document.querySelectorAll("[data-pref] > button").forEach(b => b.addEventListener("click", () => set({ [b.parentElement.dataset.pref]: b.dataset.value })));
  document.querySelectorAll("input[data-pref]").forEach(box => box.addEventListener("change", () => set({ [box.dataset.pref]: box.checked })));
  markChoices();

  // Ad blocking is uBlock Origin being on or off
  const [ub] = await browser.aeris.addonInfo([UBLOCK]);
  $("#adblock").checked = ub.installed && ub.enabled;
  $("#adblock").disabled = !ub.installed;
  $("#adblock").addEventListener("change", e => browser.aeris.setAddonEnabled(UBLOCK, e.target.checked));

  // Already moved in from Aero?
  const { importResult } = await store.get({ importResult: null });
  if (importResult?.found) {
    $("#fromAero").hidden = false;
    $("#fromAero").textContent = "Your bookmarks, apps and settings from Aero are already here. 🎉";
    $("#importText").textContent = "Your Aero bookmarks, apps and settings have been brought over. You can also bring things from Chrome, Edge and other browsers.";
  }

  if (await browser.aeris.isDefaultBrowser()) {
    $("#defaultText").textContent = "Aeris is already your default browser. ✓";
    $("#makeDefault").hidden = true;
  }
}

async function set(changes) {
  Object.assign(prefs, changes);
  markChoices();
  await store.set(changes);
}

// ================= Favourite sites =================

const FAVOURITES = [
  ["YouTube", "https://www.youtube.com/"], ["Google", "https://www.google.com/"], ["Gmail", "https://mail.google.com/"],
  ["Discord", "https://discord.com/app"], ["Spotify", "https://open.spotify.com/"], ["Roblox", "https://www.roblox.com/home"],
  ["WhatsApp", "https://web.whatsapp.com/"], ["Wikipedia", "https://www.wikipedia.org/"]
];
for (const [name, url] of FAVOURITES) {
  const label = document.createElement("label");
  label.innerHTML = "<img alt=''><span></span><input type='checkbox'>";
  label.querySelector("img").src = new URL("/favicon.ico", url).href;
  label.querySelector("img").addEventListener("error", e => (e.target.style.visibility = "hidden"));
  label.querySelector("span").textContent = name;
  label.querySelector("input").value = url;
  $("#favs").append(label);
}
$("#pinFavs").addEventListener("click", async () => {
  const urls = [...document.querySelectorAll("#favs input:checked")].map(i => i.value);
  const open = await browser.tabs.query({ pinned: true });
  for (const url of urls) {
    if (!open.some(t => t.url.startsWith(url))) await browser.tabs.create({ url, pinned: true, active: false });
  }
  show(at + 1);
});

// ================= Bringing things over, default browser =================

$("#importAero").addEventListener("click", async () => {
  const r = await browser.runtime.sendMessage({ type: "import-aero" });
  $("#importText").textContent = !r?.found
    ? "No Aero data was found. If you used Aero, open it once (version 0.6.5 or newer), then try again."
    : `Brought over from Aero: ${r.bookmarks} bookmarks, ${r.apps} apps${r.passwords ? `, ${r.passwords} passwords` : ""}${r.theme ? " and your theme" : ""}.`;
});
$("#importOther").addEventListener("click", () => browser.aeris.openImportWizard());
$("#makeDefault").addEventListener("click", async () => {
  await browser.aeris.makeDefaultBrowser();
  show(at + 1);
});

// Aeris asks about being the default browser only here, never again.
browser.aeris.setPrefs({ "browser.shell.checkDefaultBrowser": false });

$("#finish").addEventListener("click", async () => {
  const tab = await browser.tabs.getCurrent();
  browser.tabs.update(tab.id, { url: browser.runtime.getURL("newtab/index.html") });
});

draw();
show(0);
