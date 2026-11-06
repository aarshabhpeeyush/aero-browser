// Customize extras: Forget and Screenshot buttons, saving tabs for later, the memory meter and
// things hidden on websites.

// ================= Firefox's own toolbar buttons =================

const buttonBoxes = [...document.querySelectorAll("input[data-button]")];
async function drawButtons() {
  const placed = await browser.aeris.toolbarButtons(buttonBoxes.map(b => b.dataset.button));
  for (const box of buttonBoxes) box.checked = !!placed[box.dataset.button];
}
for (const box of buttonBoxes) box.addEventListener("change", () => browser.aeris.setToolbarButton(box.dataset.button, box.checked));

// ================= Save for later =================
// Saved tabs go in a bookmarks folder, "Saved for later" (in Other Bookmarks), one folder per save.

const SAVED = "Saved for later";
async function savedRoot(create) {
  const [found] = (await browser.bookmarks.search({ title: SAVED })).filter(b => !b.url);
  if (found || !create) return found;
  return browser.bookmarks.create({ parentId: "unfiled_____", title: SAVED });
}

async function drawCollections() {
  const box = $("#collections");
  box.innerHTML = "";
  const root = await savedRoot(false);
  if (!root) return;
  const folders = (await browser.bookmarks.getChildren(root.id)).filter(f => !f.url).reverse();
  for (const f of folders) {
    const links = (await browser.bookmarks.getChildren(f.id)).filter(b => b.url);
    const row = document.createElement("div");
    row.className = "profile-row";
    row.innerHTML = `<span class="who"><b></b><small></small></span>`;
    row.querySelector("b").textContent = f.title;
    row.querySelector("small").textContent = links.map(l => l.title).join(" · ");
    const open = document.createElement("button");
    open.className = "gel tiny";
    open.textContent = "Open";
    open.addEventListener("click", () => links.forEach(l => browser.tabs.create({ url: l.url, active: false })));
    const del = document.createElement("button");
    del.className = "gel tiny red";
    del.textContent = "✕";
    del.title = "Delete this saved set";
    confirmClick(del, async () => {
      await browser.bookmarks.removeTree(f.id);
      drawCollections();
    });
    row.append(open, del);
    box.append(row);
  }
}

$("#saveTabs").addEventListener("click", async () => {
  const tabs = (await browser.tabs.query({ currentWindow: true, hidden: false, pinned: false })).filter(t => /^https?:/.test(t.url));
  if (!tabs.length) return;
  const root = await savedRoot(true);
  const name = new Date().toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const folder = await browser.bookmarks.create({ parentId: root.id, title: `${name} (${tabs.length} tab${tabs.length === 1 ? "" : "s"})` });
  for (const t of tabs) await browser.bookmarks.create({ parentId: folder.id, title: t.title, url: t.url });
  if ($("#saveClose").checked) {
    await browser.tabs.create({});
    await browser.tabs.remove(tabs.map(t => t.id));
  }
  drawCollections();
});

// ================= Memory meter (like Aero's performance panel) =================

const ramSamples = [];
async function sampleRam() {
  if (document.hidden || $("#customizeView").hidden) return;
  const mb = await browser.aeris.memoryUsage();
  ramSamples.push(mb);
  if (ramSamples.length > 60) ramSamples.shift();
  $("#ramNow").textContent = mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb + " MB";
  const sleeping = (await browser.tabs.query({ discarded: true })).length;
  $("#sleeping").textContent = sleeping ? `💤 ${sleeping} tab${sleeping === 1 ? " is" : "s are"} napping.` : "No tabs are napping.";

  const c = $("#ramGraph");
  const g = c.getContext("2d");
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3d8bd4";
  g.clearRect(0, 0, c.width, c.height);
  const max = Math.max(...ramSamples) * 1.2 || 1;
  g.beginPath();
  ramSamples.forEach((v, i) => {
    const x = (i / 59) * c.width;
    const y = c.height - (v / max) * c.height;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = accent;
  g.lineWidth = 2;
  g.stroke();
  g.lineTo(((ramSamples.length - 1) / 59) * c.width, c.height);
  g.lineTo(0, c.height);
  g.fillStyle = accent + "33";
  g.fill();
}
setInterval(sampleRam, 2000);

// ================= Hidden on websites =================

async function drawZaps() {
  const { zaps } = await store.get({ zaps: {} });
  const box = $("#zapList");
  box.innerHTML = "";
  const sites = Object.keys(zaps).filter(k => zaps[k]?.length);
  if (!sites.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Nothing hidden yet.";
    box.append(p);
  }
  for (const site of sites) {
    const row = document.createElement("div");
    row.className = "profile-row";
    row.innerHTML = `<span class="who"><b></b><small></small></span>`;
    row.querySelector("b").textContent = site;
    row.querySelector("small").textContent = `${zaps[site].length} thing${zaps[site].length === 1 ? "" : "s"} hidden`;
    const undo = document.createElement("button");
    undo.className = "gel tiny";
    undo.textContent = "Show again";
    undo.addEventListener("click", async () => {
      delete zaps[site];
      await store.set({ zaps });
    });
    row.append(undo);
    box.append(row);
  }
}
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.zaps) drawZaps();
});

drawButtons();
drawCollections();
drawZaps();
sampleRam();
