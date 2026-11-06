// Aeris Notes: simple notes in the side panel, saved on this computer. Text clipped from websites
// (right-click → Clip to Aeris Notes, see background.js) is added to the open note.

const notesStore = browser.storage.local;
let notes = []; // [{ id, text, updated }]
let currentId = null;
let saveTimer = null;

const noteTitle = n => (n.text.trim().split("\n")[0] || "Empty note").replace(/^[>#*\s-]+/, "").slice(0, 60) || "Empty note";
const when = t => new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function drawNoteList() {
  const list = $("#noteList");
  list.innerHTML = "";
  for (const n of [...notes].sort((a, b) => b.updated - a.updated)) {
    const row = document.createElement("button");
    row.className = "profile-row" + (n.id === currentId ? " on" : "");
    row.innerHTML = `<span class="who"><b></b><small></small></span>`;
    row.querySelector("b").textContent = noteTitle(n);
    row.querySelector("small").textContent = when(n.updated);
    row.addEventListener("click", () => openNote(n.id));
    list.append(row);
  }
  if (!notes.length) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "No notes yet. Start typing below.";
    list.append(p);
  }
}

function openNote(id) {
  currentId = id;
  const n = notes.find(x => x.id === id);
  $("#noteText").value = n ? n.text : "";
  $("#saved").textContent = n ? "Saved " + when(n.updated) : "";
  notesStore.set({ currentNote: id });
  drawNoteList();
}

async function saveNow() {
  clearTimeout(saveTimer);
  const text = $("#noteText").value;
  let n = notes.find(x => x.id === currentId);
  if (!n) {
    if (!text.trim()) return;
    n = { id: crypto.randomUUID(), text: "", updated: 0 };
    notes.push(n);
    currentId = n.id;
  }
  n.text = text;
  n.updated = Date.now();
  await notesStore.set({ notes, currentNote: currentId });
  $("#saved").textContent = "Saved " + when(n.updated);
  drawNoteList();
}

$("#noteText").addEventListener("input", () => {
  $("#saved").textContent = "…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
});
$("#noteText").addEventListener("blur", saveNow);

$("#newNote").addEventListener("click", async () => {
  await saveNow();
  currentId = null;
  $("#noteText").value = "";
  $("#saved").textContent = "";
  drawNoteList();
  $("#noteText").focus();
});

$("#deleteNote").addEventListener("click", async () => {
  const n = notes.find(x => x.id === currentId);
  if (!n || !confirm(`Delete "${noteTitle(n)}"?`)) return;
  notes = notes.filter(x => x.id !== currentId);
  await notesStore.set({ notes });
  openNote(notes.sort((a, b) => b.updated - a.updated)[0]?.id ?? null);
});

$("#addPage").addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  const box = $("#noteText");
  box.value = (box.value.trimEnd() ? box.value.trimEnd() + "\n\n" : "") + `${tab.title}\n${tab.url}\n`;
  await saveNow();
});

// Clips arrive while the panel is open
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.notes) return;
  if (document.activeElement === $("#noteText")) return; // you're typing here; your text wins
  notes = changes.notes.newValue || [];
  if (changes.currentNote) currentId = changes.currentNote.newValue;
  openNote(currentId);
});

(async () => {
  const saved = await notesStore.get({ notes: [], currentNote: null });
  notes = saved.notes;
  openNote(saved.currentNote && notes.some(n => n.id === saved.currentNote) ? saved.currentNote : notes[0]?.id ?? null);
})();
