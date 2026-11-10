// The welcome tour, the same steps as Aeris on the computer. Every choice is saved straight away.
// In the Aeris Android app, choices go to the app (window.AeroNative); on the home-screen web app
// they're saved in this browser's storage.

const $ = sel => document.querySelector(sel);
const inApp = !!window.AeroNative;
const params = new URLSearchParams(location.search);

// Steps meant for the other version are taken out.
document.querySelectorAll("[data-only]").forEach(el => el.dataset.only !== (inApp ? "app" : "web") && el.remove());
const steps = [...document.querySelectorAll(".step")];
let at = 0;

// ================= Choices =================

const tell = msg => AeroNative.postMessage(JSON.stringify({ type: "aeris", ...msg }));
const startPage = () => {
  try { return JSON.parse(localStorage.getItem("aero") || "{}"); } catch { return {}; }
};

// What's chosen now: the app passes its settings in the address; the web app reads its storage.
const prefs = inApp ? {
  colorTheme: params.get("colorTheme") || "frost",
  theme: params.get("theme") || null,
  adBlock: params.get("adBlock") === "1",
  hideAi: params.get("hideAi") === "1",
  aeroStyle: params.get("aeroStyle") === "1",
  sounds: startPage().sounds !== false
} : {
  ...aerisLook(),
  sounds: startPage().sounds !== false,
  saver: startPage().batterySaver === "on"
};

function set(key, value) {
  prefs[key] = value;
  // Sounds and battery saver belong to the start page, which shares this page's storage (in the app too).
  if (key === "sounds" || key === "saver") {
    const s = startPage();
    if (key === "sounds") s.sounds = value;
    else s.batterySaver = value ? "on" : "off";
    localStorage.setItem("aero", JSON.stringify(s));
  } else if (inApp) tell({ action: "set", key, value });
  else saveAerisLook({ [key]: value });
  mark();
}

function mark() {
  document.querySelectorAll("#swatches button").forEach(b => b.classList.toggle("on", b.dataset.value === prefs.colorTheme));
  document.querySelectorAll("#customs button").forEach(b => b.classList.toggle("on", b.dataset.value === String(prefs.theme)));
  document.querySelectorAll("input[data-pref]").forEach(box => (box.checked = !!prefs[box.dataset.pref]));
  const c = AERIS_COLORS[prefs.colorTheme] || AERIS_COLORS.frost;
  document.documentElement.style.setProperty("--accent", c.accent);
  document.querySelector('meta[name="theme-color"]').content = c.a;
}

async function draw() {
  for (const [id, t] of Object.entries(AERIS_COLORS)) {
    const b = document.createElement("button");
    b.dataset.value = id;
    b.textContent = t.name;
    if (t.dark) b.style.cssText = "color:#1d3550;text-shadow:0 1px 0 rgba(255,255,255,0.7)";
    b.style.background = `linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0) 51%), linear-gradient(180deg, ${t.a}, ${t.b})`;
    b.addEventListener("click", () => set("colorTheme", id));
    $("#swatches").append(b);
  }
  let custom = [];
  try { custom = await (await fetch("../themes/index.json")).json(); } catch {}
  // The web app can only restyle its start page, so it offers the themes that have a start-page look.
  if (!inApp) custom = custom.filter(t => t.newtabCss);
  for (const t of [{ id: null, name: "No custom theme", description: "Just the colours above" }, ...custom]) {
    const b = document.createElement("button");
    b.dataset.value = String(t.id);
    b.innerHTML = "<b></b><small></small>";
    b.querySelector("b").textContent = t.name;
    b.querySelector("small").textContent = t.description || "";
    b.addEventListener("click", () => set("theme", t.id));
    $("#customs").append(b);
  }
  document.querySelectorAll("input[data-pref]").forEach(box => box.addEventListener("change", () => set(box.dataset.pref, box.checked)));
  mark();

  if (inApp) {
    if (params.get("isDefault") === "1") {
      $("#defaultText").textContent = "Aeris is already your default browser. ✓";
      $("#makeDefault").hidden = true;
    }
    $("#import").addEventListener("click", () => tell({ action: "import" }));
    $("#makeDefault").addEventListener("click", () => { tell({ action: "default" }); show(at + 1); });
  } else {
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    $(standalone ? "#installed" : ios ? "#installIos" : "#installAndroid").hidden = false;
  }
}

// ================= Moving between steps =================

function show(i) {
  at = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach((s, n) => (s.hidden = n !== at));
  $("#scene").classList.toggle("soft", at > 0);
  document.querySelectorAll("#thumbs button").forEach((t, n) => t.classList.toggle("current", n === at));
}
steps.forEach((s, n) => {
  const t = document.createElement("button");
  t.textContent = s.dataset.label;
  t.addEventListener("click", () => show(n));
  $("#thumbs").append(t);
});
document.querySelectorAll(".next").forEach(b => b.addEventListener("click", () => show(at + 1)));
document.querySelectorAll(".back").forEach(b => b.addEventListener("click", () => show(at - 1)));

$("#finish").addEventListener("click", () => {
  if (inApp) return tell({ action: "finish" });
  localStorage.setItem("aeris-welcomed", "1");
  location.href = "../";
});

draw();
show(0);
