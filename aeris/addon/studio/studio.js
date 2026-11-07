// Theme Studio: every change is saved straight away and switches Aeris to "Your own look", so the
// browser changes as you go. background.js turns the choices into CSS (see studio-css.js).

const $ = sel => document.querySelector(sel);
const store = browser.storage.local;
let look = { ...STUDIO_DEFAULTS };
let before = null; // the look you had when you opened the studio, for "Back to my old look"
let colorThemes = {};

// ================= Saving =================

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await store.set({ studio: look, colorTheme: "studio", theme: null });
    $("#undo").hidden = !before || before.colorTheme === "studio";
  }, 60);
  paintPage();
}
function set(key, value) {
  look[key] = value;
  save();
  draw();
}

// ================= Controls =================

function draw() {
  for (const el of document.querySelectorAll("input[data-key], select[data-key]")) {
    const key = el.dataset.key;
    if (key === "urlbarRadiusSlider") el.value = Math.min(look.urlbarRadius, 24);
    else if (key === "fontSizeSlider") el.value = look.fontSize || 13;
    else if (el.type === "checkbox") el.checked = !!look[key];
    else el.value = look[key] ?? "";
  }
  for (const group of document.querySelectorAll(".choice[data-key]")) {
    group.querySelectorAll("button").forEach(b => b.classList.toggle("on", look[group.dataset.key] === b.dataset.value));
  }
  $("#name").value = look.name;
  $("#fontSizeText").textContent = look.fontSize ? look.fontSize + " px" : "normal";
  $("#sideSame").checked = !look.side;
  $("#sideRow").hidden = !look.side;
  $("#imageRow").hidden = $("#imageOpacityRow").hidden = !look.image;
  if (look.image) $("#imagePreview").src = look.image;
}

for (const el of document.querySelectorAll("input[data-key], select[data-key]")) {
  el.addEventListener("input", () => {
    const key = el.dataset.key;
    if (key === "urlbarRadiusSlider") return set("urlbarRadius", +el.value >= 24 ? 999 : +el.value);
    if (key === "fontSizeSlider") return set("fontSize", +el.value === 13 ? 0 : +el.value);
    if (el.type === "checkbox") return set(key, el.checked);
    if (el.type === "range") return set(key, +el.value);
    set(key, el.value);
  });
}
for (const group of document.querySelectorAll(".choice[data-key]")) {
  group.querySelectorAll("button").forEach(b => b.addEventListener("click", () => set(group.dataset.key, b.dataset.value)));
}
$("#name").addEventListener("input", e => set("name", e.target.value.trim() || "My look"));
$("#sideSame").addEventListener("change", e => set("side", e.target.checked ? "" : look.frameA));

// A picture behind the tabs: made smaller first, so the browser stays quick
$("#image").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const scale = Math.min(1, 1800 / img.width, 400 / img.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  set("image", canvas.toDataURL("image/jpeg", 0.85));
  e.target.value = "";
});
$("#imageRemove").addEventListener("click", () => set("image", ""));

// ================= Start from a theme =================

function mix(a, b, amount) {
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map(i => Math.round(ch(a, i) * (1 - amount) + ch(b, i) * amount).toString(16).padStart(2, "0")).join("");
}
function fromPalette(c) {
  const light = mix(c.accent, "#ffffff", 0.55);
  return {
    frameA: c.a, frameB: c.b, accent: c.accent,
    frameText: c.dark ? "#1d3550" : "#ffffff",
    toolbarA: mix(light, "#ffffff", 0.4), toolbarB: light, toolbarText: "#04345c",
    tabSelected: mix(light, "#ffffff", 0.3), tabSelectedText: "#04345c",
    urlbar: "#ffffff", urlbarText: "#04345c",
    bookmarks: light, bookmarksText: "#04345c", side: ""
  };
}
$("#startFrom").addEventListener("change", e => {
  const c = colorThemes[e.target.value];
  if (c) {
    Object.assign(look, fromPalette(c), { name: c.name + " (mine)" });
    save();
    draw();
  }
  e.target.value = "";
});

// ================= My looks =================

async function drawLooks() {
  const { myLooks } = await store.get({ myLooks: [] });
  const box = $("#looks");
  box.innerHTML = "";
  $("#looksHint").textContent = myLooks.length ? "" : "Looks you save show up here, so you can switch between them.";
  myLooks.forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "profile-row look";
    row.innerHTML = `<span class="swatch"></span><span class="who"><b></b><small></small></span>`;
    row.querySelector(".swatch").style.background = `linear-gradient(180deg, ${l.frameA}, ${l.frameB} 55%, ${l.toolbarB} 56%)`;
    row.querySelector("b").textContent = l.name;
    row.querySelector("small").textContent = l.image ? "with a picture" : "";
    const use = document.createElement("button");
    use.className = "gel tiny";
    use.textContent = "Use";
    use.addEventListener("click", () => {
      look = { ...STUDIO_DEFAULTS, ...l };
      save();
      draw();
    });
    const del = document.createElement("button");
    del.className = "gel tiny red";
    del.textContent = "✕";
    del.title = "Delete (click twice)";
    del.addEventListener("click", async () => {
      if (!del.dataset.armed) {
        del.dataset.armed = "1";
        del.textContent = "Sure?";
        setTimeout(() => { delete del.dataset.armed; del.textContent = "✕"; }, 3000);
        return;
      }
      myLooks.splice(i, 1);
      await store.set({ myLooks });
      drawLooks();
    });
    row.append(use, del);
    box.append(row);
  });
}
$("#save").addEventListener("click", async () => {
  const { myLooks } = await store.get({ myLooks: [] });
  const at = myLooks.findIndex(l => l.name === look.name);
  if (at >= 0) myLooks[at] = { ...look };
  else myLooks.push({ ...look });
  await store.set({ myLooks });
  $("#save").textContent = "Saved ✓";
  setTimeout(() => ($("#save").textContent = "Save to My looks"), 1500);
  drawLooks();
});

// Share a look as a file, or open one someone shared
$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ aerisLook: 1, ...look }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (look.name || "My look").replace(/[^\w\- ]/g, "") + ".aeris-look.json";
  a.click();
});
$("#import").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.aerisLook) throw new Error();
    const clean = {};
    for (const key of Object.keys(STUDIO_DEFAULTS)) if (key in data && typeof data[key] === typeof STUDIO_DEFAULTS[key]) clean[key] = data[key];
    if (clean.image && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(clean.image)) delete clean.image;
    look = { ...STUDIO_DEFAULTS, ...clean };
    save();
    draw();
    $("#looksHint").textContent = `Opened "${look.name}". Save it to keep it in My looks.`;
  } catch {
    $("#looksHint").textContent = "That file isn't an Aeris look.";
  }
});

// Back to the look you had before opening the studio
$("#undo").addEventListener("click", async () => {
  await store.set({ colorTheme: before.colorTheme, theme: before.theme });
  $("#undo").hidden = true;
});

// ================= This page follows the look =================

function paintPage() {
  $("#prefVars").textContent = `:root { --frame-a: ${look.frameA}; --frame-b: ${look.frameB}; --accent: ${look.accent}; --gloss: ${look.gloss / 100}; }`;
}

(async () => {
  const [{ colors }, saved] = await Promise.all([
    browser.runtime.sendMessage({ type: "themes" }),
    store.get({ studio: null, colorTheme: "frost", theme: null })
  ]);
  colorThemes = colors;
  before = { colorTheme: saved.colorTheme, theme: saved.theme };
  for (const [id, c] of Object.entries(colors)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = c.name;
    $("#startFrom").append(o);
  }
  // First time: start from the colours you're using now
  look = saved.studio ? { ...STUDIO_DEFAULTS, ...saved.studio } : { ...STUDIO_DEFAULTS, ...fromPalette(colors[saved.colorTheme] || colors.frost) };
  draw();
  paintPage();
  drawLooks();
})();
