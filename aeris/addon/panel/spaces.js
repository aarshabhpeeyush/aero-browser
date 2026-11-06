// Spaces: separate sets of tabs. The switching itself happens in features.js.

const SPACE_ICONS = ["🏠", "📚", "🎮", "🎵", "💼", "🎨", "🌿", "⭐", "🚀", "🐟"];
let spaces = [];
let activeSpace = "main";

const spaceOf = tabId => browser.runtime.sendMessage({ type: "space-of", tabId });

function spaceButton(label, title, cls = "") {
  const b = document.createElement("button");
  b.className = "gel tiny " + cls;
  b.textContent = label;
  b.title = title;
  return b;
}

async function drawSpaces() {
  const list = $("#spaceList");
  const tabs = await browser.tabs.query({ currentWindow: true });
  const counts = {};
  for (const t of tabs) {
    const id = await spaceOf(t.id);
    counts[id] = (counts[id] || 0) + 1;
  }
  list.innerHTML = "";
  for (const s of spaces) {
    const row = document.createElement("div");
    row.className = "profile-row theme-row space-row" + (s.id === activeSpace ? " on" : "");
    row.innerHTML = `<span class="space-icon"></span><span class="who"><b></b><small></small></span>`;
    row.querySelector(".space-icon").textContent = s.icon;
    row.querySelector("b").textContent = s.name;
    row.querySelector("small").textContent = `${counts[s.id] || 0} tab${counts[s.id] === 1 ? "" : "s"}`;
    row.addEventListener("click", () => browser.runtime.sendMessage({ type: "switch-space", id: s.id }));

    if (s.id !== "main") {
      // Rename right in the row
      const rename = spaceButton("✎", "Rename");
      rename.addEventListener("click", e => {
        e.stopPropagation();
        const b = row.querySelector("b");
        const input = document.createElement("input");
        input.value = s.name;
        input.maxLength = 30;
        input.addEventListener("click", ev => ev.stopPropagation());
        const done = async () => {
          if (input.value.trim()) s.name = input.value.trim();
          await store.set({ spaces });
          drawSpaces();
        };
        input.addEventListener("keydown", ev => ev.key === "Enter" && done());
        input.addEventListener("blur", done);
        b.replaceWith(input);
        input.select();
      });
      // Delete: its tabs move to Main
      const del = spaceButton("✕", "Delete (its tabs move to Main)", "red");
      confirmClick(del, async () => {
        for (const t of tabs) {
          if ((await spaceOf(t.id)) === s.id) await browser.runtime.sendMessage({ type: "move-tab", tabId: t.id, id: "main" });
        }
        spaces = spaces.filter(x => x !== s);
        await store.set({ spaces });
        if (activeSpace === s.id) await browser.runtime.sendMessage({ type: "switch-space", id: "main" });
      });
      row.append(rename, del);
    }
    list.append(row);
  }

  const select = $("#spaceMove");
  select.innerHTML = "";
  for (const s of spaces) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.icon} ${s.name}`;
    o.selected = s.id === activeSpace;
    select.append(o);
  }
}

$("#spaceAdd").addEventListener("click", () => {
  $("#spaceNew").hidden = false;
  $("#spaceName").focus();
});
async function createSpace() {
  const name = $("#spaceName").value.trim();
  if (!name) return;
  const space = { id: crypto.randomUUID(), name, icon: SPACE_ICONS[spaces.length % SPACE_ICONS.length] };
  spaces.push(space);
  $("#spaceName").value = "";
  $("#spaceNew").hidden = true;
  await store.set({ spaces });
  await browser.runtime.sendMessage({ type: "switch-space", id: space.id });
}
$("#spaceCreate").addEventListener("click", createSpace);
$("#spaceName").addEventListener("keydown", e => e.key === "Enter" && createSpace());

$("#spaceMove").addEventListener("change", async e => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) await browser.runtime.sendMessage({ type: "move-tab", tabId: tab.id, id: e.target.value });
  drawSpaces();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.spaces) spaces = changes.spaces.newValue;
  if (changes.activeSpace) activeSpace = changes.activeSpace.newValue;
  if (changes.spaces || changes.activeSpace) drawSpaces();
});
browser.tabs.onCreated.addListener(() => setTimeout(drawSpaces, 300));
browser.tabs.onRemoved.addListener(() => setTimeout(drawSpaces, 300));

(async () => {
  ({ spaces, activeSpace } = await store.get({ spaces: [{ id: "main", name: "Main", icon: "🏠" }], activeSpace: "main" }));
  drawSpaces();
})();
