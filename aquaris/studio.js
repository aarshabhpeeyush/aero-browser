// Theme Studio: design your own Aquaris look (colours, glass, corners, icon shape, font, wallpaper)
// and keep it as a theme. Your themes live in aquarisMyThemes and sync to your iPad; the one you use
// is aquarisTheme = "my:<id>". The basics (light or dark, glass, corners, wallpaper) go into the
// normal settings when you use a theme, so Settings still shows them; the rest (accent, glass tint,
// icon shape, font) is laid on top here.

const STUDIO_FONTS = {
  system: ["Standard", ""],
  rounded: ["Rounded", '"Segoe UI Variable Display", "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif'],
  serif: ["Classic", 'Georgia, "Iowan Old Style", "Times New Roman", serif'],
  mono: ["Coder", '"Cascadia Code", Consolas, "SF Mono", Menlo, monospace'],
  comic: ["Playful", '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive']
};
const STUDIO_SHAPES = { squircle: ["Rounded", "23%"], circle: ["Circle", "50%"], square: ["Square", "10%"], leaf: ["Leaf", "50% 10% 50% 10%"], drop: ["Drop", "50% 50% 50% 12%"] };
const STUDIO_WALLS = [["tide", "Tide"], ["dusk", "Dusk"], ["aqua", "Aqua"], ["hills", "Aeris hills"], ["colour", "Plain colour"], ["own", "Your picture"]];
const NEW_THEME = () => ({ id: "", name: "My theme", mode: "light", accent: "#2a7de1", tint: "#ffffff", tintAmount: 0, glass: 55, radius: 12, shape: "squircle", font: "system", wall: "tide", wallColour: "#1d4e89", wallImg: "" });

let studioDraft = null;   // the theme being designed (shown live while Theme Studio is open)
const myThemes = () => settings.aquarisMyThemes || [];
const myThemeInUse = () => (settings.aquarisTheme || "").startsWith("my:") ? myThemes().find(t => "my:" + t.id === settings.aquarisTheme) : null;

// Mix two colours (#rrggbb), p = how much of b
function mixHex(a, b, p) {
  const n = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const A = n(a), B = n(b);
  return A.map((v, i) => Math.round(v + (B[i] - v) * p));
}
// Lay a theme over the look
function paintMyTheme(t, full) {
  let style = $("#myThemeStyle");
  if (!style) { style = html("style"); style.id = "myThemeStyle"; document.head.append(style); }
  const b = document.body;
  b.classList.toggle("my-theme", !!t);
  const VARS = ["--accent-ink", "--glass", "--glass-strong", "--font", "--font-display"];
  if (!t) { style.textContent = ""; for (const v of VARS) b.style.removeProperty(v); return; }
  // While designing, show everything live (normally those come from the settings)
  if (full) {
    b.dataset.mode = t.mode;
    b.style.setProperty("--frost", (t.glass / 100).toFixed(2));
    b.style.setProperty("--r-win", t.radius + "px");
    if (t.wall === "own" && t.wallImg) { b.dataset.wall = "own"; b.style.setProperty("--own-wall", `url("${t.wallImg}")`); }
    else if (t.wall !== "colour") b.dataset.wall = t.wall;
  }
  const dark = b.dataset.mode === "dark";
  const base = dark ? "#1a1e26" : "#fafcff";
  const [r, g, bl] = mixHex(base, t.tint, (t.tintAmount || 0) / 100);
  const font = STUDIO_FONTS[t.font]?.[1];
  const ink = (() => { const [x, y, z] = mixHex(t.accent, t.accent, 0); return 0.299 * x + 0.587 * y + 0.114 * z > 170 ? "#111" : "#fff"; })();
  // On the body itself, so no style's own colours can win over them
  b.style.setProperty("--accent", t.accent);
  b.style.setProperty("--accent-ink", ink);
  b.style.setProperty("--glass", `rgba(${r}, ${g}, ${bl}, calc(${dark ? 0.45 : 0.5} + ${dark ? 0.4 : 0.38} * var(--frost)))`);
  b.style.setProperty("--glass-strong", `rgba(${r}, ${g}, ${bl}, calc(0.9 + 0.08 * var(--frost)))`);
  for (const v of ["--font", "--font-display"]) font ? b.style.setProperty(v, font) : b.style.removeProperty(v);
  style.textContent = `
    body.my-theme .tile { border-radius: ${STUDIO_SHAPES[t.shape]?.[1] || "23%"} !important; }
    ${t.wall === "colour" ? `body.my-theme::before { background: linear-gradient(160deg, ${t.wallColour}, rgb(${mixHex(t.wallColour, "#000000", 0.45).join(",")})) !important; }` : ""}`;
}
lookHooks.push(() => paintMyTheme(studioDraft || myThemeInUse(), !!studioDraft));

// Use a theme: its basics go into the normal settings
async function useMyTheme(t) {
  const changes = { aquarisTheme: "my:" + t.id, aquarisMode: t.mode, aquarisGlass: t.glass, aquarisLookMore: { ...settings.aquarisLookMore, radius: t.radius } };
  if (t.wall === "own" && t.wallImg) Object.assign(changes, { aquarisWall: "own", aquarisOwnWall: t.wallImg });
  else if (t.wall !== "colour") changes.aquarisWall = t.wall;
  await save(changes);
}

// ----- The Theme Studio app -----
function buildStudio(page, win) {
  let t = { ...(myThemeInUse() || NEW_THEME()) };
  setHTML(page, `<div class="studio">
    <div class="st-controls">
      <label class="st-row"><span>Name</span><input class="st-name" maxlength="30"></label>
      <div class="st-row"><span>Light or dark</span><div class="seg st-mode"><button data-v="light">Light</button><button data-v="dark">Dark</button></div></div>
      <label class="st-row"><span>Accent colour</span><input type="color" class="st-accent"></label>
      <div class="st-swatches st-accents"></div>
      <label class="st-row"><span>Glass tint</span><input type="color" class="st-tint"></label>
      <label class="st-row"><span>Tint strength</span><input type="range" min="0" max="60" class="st-tinta"></label>
      <label class="st-row"><span>Glass</span><input type="range" min="0" max="100" class="st-glass"></label>
      <label class="st-row"><span>Window corners</span><input type="range" min="0" max="24" class="st-radius"></label>
      <div class="st-row"><span>Icon shape</span><div class="st-shapes"></div></div>
      <div class="st-row"><span>Font</span><div class="seg st-fonts"></div></div>
      <div class="st-row col"><span>Wallpaper</span><div class="walls st-walls"></div></div>
      <label class="st-row st-colour-row"><span>Wallpaper colour</span><input type="color" class="st-wallc"></label>
      <input type="file" accept="image/*" class="st-wallfile" hidden>
      <div class="row st-actions"><button class="btn primary st-save">Save and use</button><button class="btn st-new">New theme</button><button class="btn st-stop">Back to normal</button></div>
    </div>
    <div class="st-side"><h3>Your themes</h3><div class="st-list"></div>
      <p class="hint">Changes show live on your desktop while Theme Studio is open. Close it without saving to go back.</p></div>
  </div>`);
  const $p = s => page.querySelector(s);
  // Accent ideas
  for (const c of ["#2a7de1", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#e5484d", "#e8487b", "#a35cff", "#6366f1", "#64748b"]) {
    const s = html("button", "st-swatch");
    s.style.background = c;
    s.title = c;
    s.addEventListener("click", () => set({ accent: c }));
    $p(".st-accents").append(s);
  }
  for (const [id, [name]] of Object.entries(STUDIO_SHAPES)) {
    const b = html("button", "st-shape");
    b.dataset.v = id;
    b.title = name;
    b.append(Object.assign(html("i"), { style: `border-radius: ${STUDIO_SHAPES[id][1]}` }));
    b.addEventListener("click", () => set({ shape: id }));
    $p(".st-shapes").append(b);
  }
  for (const [id, [name, stack]] of Object.entries(STUDIO_FONTS)) {
    const b = html("button", "", name);
    b.dataset.v = id;
    if (stack) b.style.fontFamily = stack;
    b.addEventListener("click", () => set({ font: id }));
    $p(".st-fonts").append(b);
  }
  for (const [id, name] of STUDIO_WALLS) {
    const b = html("button", "wall w-" + id);
    b.dataset.v = id;
    b.append(html("span", "", name));
    b.addEventListener("click", () => (id === "own" ? $p(".st-wallfile").click() : set({ wall: id })));
    $p(".st-walls").append(b);
  }
  $p(".st-wallfile").addEventListener("change", e => {
    const f = e.target.files[0];
    if (!f) return;
    // Made smaller so it syncs and saves quickly
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 2560 / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      set({ wall: "own", wallImg: c.toDataURL("image/jpeg", 0.85) });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });
  // Show the draft
  const show = () => {
    $p(".st-name").value = t.name;
    $p(".st-accent").value = t.accent;
    $p(".st-tint").value = t.tint;
    $p(".st-tinta").value = t.tintAmount;
    $p(".st-glass").value = t.glass;
    $p(".st-radius").value = t.radius;
    $p(".st-wallc").value = t.wallColour;
    $p(".st-colour-row").hidden = t.wall !== "colour";
    page.querySelectorAll(".st-mode button").forEach(b => b.classList.toggle("on", b.dataset.v === t.mode));
    page.querySelectorAll(".st-shape").forEach(b => b.classList.toggle("on", b.dataset.v === t.shape));
    page.querySelectorAll(".st-fonts button").forEach(b => b.classList.toggle("on", b.dataset.v === t.font));
    page.querySelectorAll(".st-walls .wall").forEach(b => b.classList.toggle("on", b.dataset.v === t.wall));
    const own = $p(".st-walls .w-own");
    own.style.backgroundImage = t.wallImg ? `url("${t.wallImg}")` : "";
    $p(".st-walls .w-colour").style.background = `linear-gradient(160deg, ${t.wallColour}, rgb(${mixHex(t.wallColour, "#000000", 0.45).join(",")}))`;
  };
  const set = changes => { Object.assign(t, changes); studioDraft = t; applyLook(); show(); };
  $p(".st-name").addEventListener("input", e => (t.name = e.target.value));
  $p(".st-mode").addEventListener("click", e => e.target.dataset.v && set({ mode: e.target.dataset.v }));
  for (const [sel, key, num] of [[".st-accent", "accent"], [".st-tint", "tint"], [".st-tinta", "tintAmount", 1], [".st-glass", "glass", 1], [".st-radius", "radius", 1], [".st-wallc", "wallColour"]])
    $p(sel).addEventListener("input", e => set({ [key]: num ? +e.target.value : e.target.value }));
  // Save (as a new theme, or over the one you're editing)
  $p(".st-save").addEventListener("click", async () => {
    t.name = t.name.trim() || "My theme";
    if (!t.id) t.id = Date.now().toString(36);
    const list = myThemes().filter(x => x.id !== t.id);
    await save({ aquarisMyThemes: [...list, { ...t }] });
    studioDraft = null;
    await useMyTheme(t);
    drawList();
    toast({ app: "studio", title: "Theme Studio", body: `“${t.name}” is saved and in use.` });
  });
  $p(".st-new").addEventListener("click", () => { t = NEW_THEME(); set({}); });
  $p(".st-stop").addEventListener("click", async () => { studioDraft = null; await save({ aquarisTheme: "minimal" }); t = NEW_THEME(); show(); drawList(); });
  // Your themes
  const drawList = () => {
    const list = $p(".st-list");
    list.textContent = "";
    if (!myThemes().length) list.append(html("p", "hint", "None yet. Design one and press Save."));
    for (const th of myThemes()) {
      const row = html("div", "st-theme" + ("my:" + th.id === settings.aquarisTheme ? " on" : ""));
      const pic = html("span", "st-pic");
      pic.style.background = th.wall === "own" && th.wallImg ? `center / cover url("${th.wallImg}")` : th.wall === "colour" ? th.wallColour : "";
      if (!pic.style.background) pic.classList.add("w-" + th.wall);
      const dot = html("i");
      dot.style.background = th.accent;
      dot.style.borderRadius = STUDIO_SHAPES[th.shape]?.[1];
      pic.append(dot);
      const use = html("button", "btn st-use", "Use");
      use.addEventListener("click", async () => { studioDraft = null; await useMyTheme(th); t = { ...th }; show(); drawList(); });
      const edit = html("button", "btn st-edit", "Edit");
      edit.addEventListener("click", () => { t = { ...th }; set({}); });
      const del = html("button", "btn st-del", "Delete");
      del.addEventListener("click", async () => {
        await save({ aquarisMyThemes: myThemes().filter(x => x.id !== th.id), ...("my:" + th.id === settings.aquarisTheme ? { aquarisTheme: "minimal" } : {}) });
        drawList();
      });
      row.append(pic, html("b", "", th.name), use, edit, del);
      list.append(row);
    }
  };
  show();
  drawList();
  // Closing without saving puts the look back
  win.onClose = () => { if (studioDraft) { studioDraft = null; applyLook(); } };
}
ownBuilders.studio = buildStudio;
