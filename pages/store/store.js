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
  el.innerHTML = `<div class="icon"></div><div class="info"><h3></h3><span class="cat"></span><p></p></div><div class="actions"></div>`;
  const icon = el.querySelector(".icon");
  if (mine?.icon) icon.innerHTML = `<img alt="">`, (icon.querySelector("img").src = mine.icon);
  else icon.textContent = ext.emoji || "🧩";
  el.querySelector("h3").textContent = mine?.name || ext.name;
  el.querySelector(".cat").textContent = ext.category || (mine ? "v" + mine.version : "");
  el.querySelector("p").textContent = ext.description || mine?.description || "";
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

(async () => {
  if (!window.aeroStore) {
    document.body.innerHTML = "<p style='padding:40px'>The Aero Web Store only works inside Aero Browser.</p>";
    return;
  }
  await Promise.all([loadCatalog(), refreshInstalled()]);
  draw();
})();
