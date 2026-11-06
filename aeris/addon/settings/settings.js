// The Aeris Store: Aero Originals and recommended add-ons from Mozilla's store.

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

drawOriginals();
drawRecommended();
browser.storage.onChanged.addListener(changes => {
  if (changes.theme) location.reload();
});

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
