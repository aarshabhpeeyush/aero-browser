// Panel controls for the Vivaldi favourites: Quick Commands, toolbar editor, mouse gestures,
// page filters and the theme schedule (the work itself is in ../vivaldi.js).

$("#quickCommands").addEventListener("click", async () => {
  // Same as pressing F2
  const extras = await browser.runtime.sendMessage({ type: "quick-command-extras" }).catch(() => null);
  browser.aeris.openQuickCommands(extras || []);
});
$("#customizeToolbar").addEventListener("click", () => browser.aeris.openCustomizeToolbar());

// ================= Mouse gestures =================

browser.runtime.sendMessage({ type: "gesture-names" }).then(names => {
  const arrows = { L: "←", R: "→", U: "↑", D: "↓" };
  $("#gestureList").textContent = Object.entries(names || {}).map(([g, name]) => `${[...g].map(d => arrows[d]).join("")} ${name}`).join(" · ");
});

// ================= This page =================

let filterNames = {};
async function drawFilters() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const box = $("#filters");
  box.innerHTML = "";
  const web = tab && /^https?:/.test(tab.url || "");
  const on = web ? await browser.runtime.sendMessage({ type: "page-filters", tabId: tab.id }) : [];
  for (const [id, name] of Object.entries(filterNames)) {
    const b = document.createElement("button");
    b.textContent = name;
    b.disabled = !web;
    b.classList.toggle("on", on.includes(id));
    b.addEventListener("click", async () => {
      await browser.runtime.sendMessage({ type: "toggle-filter", tabId: tab.id, filter: id });
      drawFilters();
    });
    box.append(b);
  }
  if (!web) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Open a website to use these.";
    box.append(p);
  }
}
browser.tabs.onActivated.addListener(drawFilters);
browser.tabs.onUpdated.addListener((id, info) => info.url && drawFilters());
browser.runtime.sendMessage({ type: "filter-names" }).then(n => {
  filterNames = n || {};
  drawFilters();
});

// ================= Theme schedule =================

const SCH = { on: false, mode: "time", dayAt: "07:00", nightAt: "19:00", day: null, night: null };
function lookName(look) {
  if (!look) return "—";
  const extra = { minimal: "Minimal", firefox: "Firefox look", studio: "Your own look" };
  const base = colorThemes[look.colorTheme]?.name || extra[look.colorTheme] || look.colorTheme;
  const custom = customThemes.find(t => t.id === look.theme);
  return custom ? `${base} + ${custom.name}` : base;
}
async function drawSchedule() {
  const { schedule } = await store.get({ schedule: SCH });
  const s = { ...SCH, ...schedule };
  $("#schOn").checked = s.on;
  $("#schBox").hidden = !s.on;
  $("#schTimes").hidden = s.mode !== "time";
  $("#schMode").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.value === s.mode));
  $("#schDay").value = s.dayAt;
  $("#schNight").value = s.nightAt;
  $("#schDayName").textContent = lookName(s.day);
  $("#schNightName").textContent = lookName(s.night);
}
async function setSchedule(changes) {
  const { schedule } = await store.get({ schedule: SCH });
  await store.set({ schedule: { ...SCH, ...schedule, ...changes } });
  drawSchedule();
}
$("#schOn").addEventListener("change", async e => {
  const { schedule } = await store.get({ schedule: SCH });
  const now = { colorTheme: prefs.colorTheme, theme: prefs.theme };
  // First time on: what you have now is the day look, and Midnight the night look
  setSchedule({ on: e.target.checked, day: schedule?.day || now, night: schedule?.night || { colorTheme: "midnight", theme: null } });
});
$("#schMode").querySelectorAll("button").forEach(b => b.addEventListener("click", () => setSchedule({ mode: b.dataset.value })));
$("#schDay").addEventListener("change", e => setSchedule({ dayAt: e.target.value || "07:00" }));
$("#schNight").addEventListener("change", e => setSchedule({ nightAt: e.target.value || "19:00" }));
$("#schSetDay").addEventListener("click", () => setSchedule({ day: { colorTheme: prefs.colorTheme, theme: prefs.theme } }));
$("#schSetNight").addEventListener("click", () => setSchedule({ night: { colorTheme: prefs.colorTheme, theme: prefs.theme } }));
setTimeout(drawSchedule, 300); // after panel.js has loaded the theme names
