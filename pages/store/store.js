// The Aero Web Store. window.aeroStore comes from tab-preload.js and only exists on this page.
const $ = sel => document.querySelector(sel);
const CATALOG_URL = "https://raw.githubusercontent.com/aarshabhpeeyush/aero-browser/main/pages/store/catalog.json";

let catalog = [];
let installed = [];
let category = "All";

// The catalog ships with Aero, and a newer one is fetched from GitHub when online,
// so new extensions can appear in the store without updating the browser.
async function loadCatalog() {
  const local = await fetch("catalog.json").then(r => r.json()).catch(() => ({ extensions: [] }));
  catalog = local.extensions;
  try {
    const remote = await fetch(CATALOG_URL, { cache: "no-store" }).then(r => (r.ok ? r.json() : null));
    if (remote?.extensions?.length && remote.updated >= local.updated) catalog = remote.extensions;
  } catch {}
}

async function refreshInstalled() {
  installed = await window.aeroStore.list();
  $("#installedCount").textContent = installed.length ? `(${installed.length})` : "";
}

function toast(text, isError) {
  const t = $("#toast");
  t.textContent = text;
  t.className = isError ? "error" : "";
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

async function install(id, button) {
  button.disabled = true;
  button.textContent = "Adding…";
  try {
    const { name } = await window.aeroStore.install(id);
    toast(`${name} was added to Aero 🎉`);
  } catch (err) {
    toast("Couldn't add it: " + String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
  }
  await refreshInstalled();
  draw();
}

async function remove(id, name) {
  if (!confirm(`Remove ${name}?`)) return;
  await window.aeroStore.remove(id);
  toast(`${name} was removed`);
  await refreshInstalled();
  draw();
}

function card(ext) {
  const mine = installed.find(e => e.id === ext.id);
  const el = document.createElement("article");
  el.className = "glass card";
  el.innerHTML = `<div class="top"><div class="icon"></div><div><h3></h3><span class="cat"></span></div></div><p></p><div class="actions"></div>`;
  const icon = el.querySelector(".icon");
  if (mine?.icon) icon.innerHTML = `<img alt="">`, (icon.querySelector("img").src = mine.icon);
  else icon.textContent = ext.emoji || "🧩";
  el.querySelector("h3").textContent = mine?.name || ext.name;
  el.querySelector(".cat").textContent = ext.category || (mine ? "v" + mine.version : "");
  el.querySelector("p").textContent = ext.description || mine?.description || "";
  // Credit for extensions made by other people, and any heads-up about them.
  if (ext.author) el.querySelector(".cat").textContent += " · by " + ext.author;
  if (ext.note) {
    const note = document.createElement("div");
    note.className = "warn";
    note.textContent = ext.note;
    el.querySelector("p").after(note);
  }
  const actions = el.querySelector(".actions");
  if (mine) {
    const done = document.createElement("span");
    done.className = "installed";
    done.textContent = "✓ Added";
    const del = document.createElement("button");
    del.className = "gel red";
    del.textContent = "Remove";
    del.addEventListener("click", () => remove(ext.id, mine.name));
    actions.append(done, del);
  } else {
    const add = document.createElement("button");
    add.className = "gel";
    add.textContent = "Add to Aero";
    add.addEventListener("click", () => install(ext.id, add));
    actions.append(add);
  }
  return el;
}

function draw() {
  const q = $("#search").value.trim().toLowerCase();
  const cats = ["All", ...new Set(catalog.map(e => e.category))];
  $("#categories").innerHTML = "";
  for (const c of cats) {
    const b = document.createElement("button");
    b.textContent = c;
    b.className = c === category ? "on" : "";
    b.addEventListener("click", () => { category = c; draw(); });
    $("#categories").append(b);
  }
  const shown = catalog.filter(e => (category === "All" || e.category === category) && (!q || (e.name + " " + e.description).toLowerCase().includes(q)));
  $("#grid").replaceChildren(...shown.map(card));
  if (!shown.length) $("#grid").innerHTML = `<p class="empty">No extensions match that. Try pasting a Chrome Web Store link below!</p>`;

  const mineList = installed.map(e => card(catalog.find(c => c.id === e.id) || { id: e.id, name: e.name, description: e.description }));
  $("#installedList").replaceChildren(...mineList);
  if (!installed.length) $("#installedList").innerHTML = `<p class="empty">No extensions yet. Add some from Browse!</p>`;
}

// Any Chrome Web Store address (old or new style) or a bare 32-letter id.
$("#anyForm").addEventListener("submit", e => {
  e.preventDefault();
  const id = ($("#anyInput").value.match(/[a-p]{32}/) || [])[0];
  if (!id) return toast("That doesn't look like a Chrome Web Store extension link.", true);
  install(id, e.target.querySelector("button"));
});

for (const b of document.querySelectorAll("#tabs button")) {
  b.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x === b));
    $("#browse").hidden = b.dataset.tab !== "browse";
    $("#installed").hidden = b.dataset.tab !== "installed";
  });
}
$("#search").addEventListener("input", draw);

// Floating bubbles in the sky.
for (let i = 0; i < 14; i++) {
  const b = document.createElement("span");
  const size = 18 + Math.random() * 60;
  b.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${14 + Math.random() * 18}s;animation-delay:${-Math.random() * 30}s;--drift:${(Math.random() - 0.5) * 120}px`;
  $("#bubbles").append(b);
}

// Themes can make the glass dark (like Dark Mode). Then the text switches to light colours.
// It looks at the colours in a card's background and checks how bright they are.
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
$("#aeroTheme").addEventListener("load", matchGlass);
$("#aeroTheme").addEventListener("error", matchGlass);
// The browser swaps the theme file when you pick another theme; check again when it does.
new MutationObserver(() => setTimeout(matchGlass, 300)).observe($("#aeroTheme"), { attributes: true, attributeFilter: ["href"] });
matchGlass();

(async () => {
  if (!window.aeroStore) {
    document.body.innerHTML = "<p style='padding:40px'>The Aero Web Store only works inside Aero Browser.</p>";
    return;
  }
  await Promise.all([loadCatalog(), refreshInstalled()]);
  draw();
})();
