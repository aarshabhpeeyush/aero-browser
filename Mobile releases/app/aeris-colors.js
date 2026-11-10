// Aeris's 8 colour themes plus Minimal (the same as aeris/addon/background.js on the computer).
// a = top colour, b = bottom colour, accent = buttons and highlights, dark = needs dark writing.
const AERIS_COLORS = {
  frost:     { name: "Frost",      a: "#c3d8ea", b: "#e2eef8", accent: "#3d8bd4", dark: true },
  aqua:      { name: "Aqua Sky",   a: "#1f7fd6", b: "#7fd0ff", accent: "#1e9be8" },
  meadow:    { name: "Meadow",     a: "#2f8f3f", b: "#a8e66b", accent: "#3cb83c" },
  ocean:     { name: "Deep Ocean", a: "#031f45", b: "#0b6fb5", accent: "#22b8e0" },
  bubblegum: { name: "Bubblegum",  a: "#d0287f", b: "#ffb3e0", accent: "#ff5fb0" },
  sunset:    { name: "Sunset",     a: "#e8601a", b: "#ffd27a", accent: "#ff8c1a" },
  silver:    { name: "Silver",     a: "#7a8b9a", b: "#e6eef4", accent: "#4c7fb0" },
  midnight:  { name: "Midnight",   a: "#0b0f1e", b: "#26324f", accent: "#5a7dff" },
  minimal:   { name: "Minimal",    a: "#fafafa", b: "#e9e9ed", accent: "#0061e0", dark: true }
};

// The web app's look: a colour theme and an optional custom theme (like Woodland Hut) on top.
const AERIS_LOOK_KEY = "aeris-look";
function aerisLook() {
  try {
    return { colorTheme: "frost", theme: null, ...JSON.parse(localStorage.getItem(AERIS_LOOK_KEY) || "{}") };
  } catch {
    return { colorTheme: "frost", theme: null };
  }
}
function saveAerisLook(changes) {
  localStorage.setItem(AERIS_LOOK_KEY, JSON.stringify({ ...aerisLook(), ...changes }));
}
