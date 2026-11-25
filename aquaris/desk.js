// The desktop, more: widgets, Spaces (several desktops), Spotlight that finds everything, clipboard
// history and the mini player. Loaded after aquaris.js and the other parts.

// ======================================================================================
// ===================================== WIDGETS ========================================
// ======================================================================================
// Little panels on the desktop: clock, weather, calendar, a quick note, Now Playing and a to-do list.
// Add them from the desktop's right-click menu; drag them by their top edge; × takes one away.

const WIDGET_TYPES = {
  clock: { name: "Clock", w: 220 },
  weather: { name: "Weather", w: 220 },
  calendar: { name: "Calendar", w: 240 },
  note: { name: "Quick note", w: 240 },
  playing: { name: "Now Playing", w: 260 },
  todo: { name: "To-do", w: 250 }
};
const widgetLayer = html("div", "widget-layer");
widgetLayer.id = "widgets";
$("#icons").after(widgetLayer);
const widgetTimers = new Map();
const saveWidgets = list => save({ aquarisWidgets: list });

function drawWidgets() {
  for (const t of widgetTimers.values()) clearInterval(t);
  widgetTimers.clear();
  widgetLayer.textContent = "";
  for (const w of settings.aquarisWidgets || []) widgetLayer.append(makeWidget(w));
}
function makeWidget(w) {
  const type = WIDGET_TYPES[w.type];
  const el = html("section", "widget-card w-" + w.type);
  el.style.left = w.x + "px";
  el.style.top = w.y + "px";
  el.style.width = type.w + "px";
  const head = html("header", "wg-head");
  const x = html("button", "wg-x");
  setHTML(x, icon("close"));
  x.title = "Remove widget";
  x.addEventListener("click", () => saveWidgets((settings.aquarisWidgets || []).filter(o => o.id !== w.id)).then(drawWidgets));
  head.append(html("span", "", type.name), x);
  const body = html("div", "wg-body");
  el.append(head, body);
  // Drag by the top edge
  head.addEventListener("pointerdown", e => {
    if (e.target.closest(".wg-x")) return;
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    try { head.setPointerCapture(e.pointerId); } catch {}
    const move = ev => { el.style.left = Math.max(0, ev.clientX - sx) + "px"; el.style.top = Math.max(0, ev.clientY - sy) + "px"; };
    const up = () => {
      head.removeEventListener("pointermove", move);
      saveWidgets((settings.aquarisWidgets || []).map(o => (o.id === w.id ? { ...o, x: el.offsetLeft, y: el.offsetTop } : o)));
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up, { once: true });
    head.addEventListener("pointercancel", up, { once: true });
  });
  WIDGET_DRAW[w.type](body, w);
  return el;
}
const every = (w, ms, fn) => { fn(); widgetTimers.set(w.id, setInterval(fn, ms)); };
const WIDGET_DRAW = {
  clock(body, w) {
    setHTML(body, `<b class="wg-time"></b><span class="wg-date"></span>`);
    every(w, 5000, () => {
      const now = new Date();
      body.querySelector(".wg-time").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      body.querySelector(".wg-date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    });
  },
  weather(body, w) {
    const place = settings.aquarisWeather;
    if (!place) {
      setHTML(body, `<p class="hint">Pick your town in the Weather app first.</p><button class="btn">Open Weather</button>`);
      body.querySelector("button").addEventListener("click", () => openApp(appById("weather") || anyApp("weather")));
      return;
    }
    setHTML(body, `<b class="wg-temp">…</b><span class="wg-place"></span><span class="wg-sky"></span>`);
    body.querySelector(".wg-place").textContent = place.name;
    const SKY = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Fog", 51: "Drizzle", 61: "Rain", 63: "Rain", 65: "Heavy rain", 71: "Snow", 80: "Showers", 95: "Thunderstorm" };
    every(w, 30 * 60000, async () => {
      try {
        const d = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code&timezone=auto`)).json();
        body.querySelector(".wg-temp").textContent = Math.round(d.current.temperature_2m) + "°";
        body.querySelector(".wg-sky").textContent = SKY[d.current.weather_code] || "";
      } catch { body.querySelector(".wg-sky").textContent = "Offline"; }
    });
  },
  calendar(body, w) {
    every(w, 60 * 60000, () => {
      const now = new Date(), y = now.getFullYear(), m = now.getMonth();
      const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
      let cells = ["M", "T", "W", "T", "F", "S", "S"].map(d => `<i class="wg-dow">${d}</i>`).join("");
      for (let i = 0; i < first; i++) cells += "<i></i>";
      for (let d = 1; d <= days; d++) cells += `<i class="${d === now.getDate() ? "today" : ""}">${d}</i>`;
      setHTML(body, `<b class="wg-month">${now.toLocaleDateString([], { month: "long", year: "numeric" })}</b><div class="wg-cal">${cells}</div>`);
    });
  },
  note(body) {
    const ta = html("textarea", "wg-note");
    ta.placeholder = "Write something…";
    ta.value = settings.aquarisWidgetNote || "";
    let t = 0;
    ta.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => save({ aquarisWidgetNote: ta.value }), 400); });
    body.append(ta);
  },
  playing(body, w) {
    setHTML(body, `<div class="wg-np"><span class="wg-art"></span><div class="wg-np-text"><b></b><span></span></div></div><div class="wg-np-btns"><button data-a="prev">${icon("prev")}</button><button data-a="play">${icon("play")}</button><button data-a="next">${icon("next")}</button></div>`);
    body.addEventListener("click", e => { const a = e.target.closest("[data-a]")?.dataset.a; if (a) mediaAction(a); });
    every(w, 1000, () => {
      const m = media.get(mediaFront);
      body.querySelector("b").textContent = m ? m.title : "Nothing playing";
      body.querySelector(".wg-np-text span").textContent = m ? m.artist || m.app.name : "Play music in YouTube Music or YouTube";
      const art = body.querySelector(".wg-art");
      const key = m ? m.art || m.app.id : "";
      if (art.dataset.key !== key) { art.dataset.key = key; art.replaceChildren(m?.art ? Object.assign(html("img"), { src: m.art, alt: "" }) : m ? tile(m.app, "small") : ""); }
      setHTML(body.querySelector('[data-a="play"]'), icon(m?.playing ? "pause" : "play"));
    });
  },
  todo(body) {
    const draw = () => {
      const list = settings.aquarisTodos || [];
      setHTML(body, `<ul class="wg-todo"></ul><form class="wg-add"><input placeholder="Add a to-do" maxlength="120"></form>`);
      const ul = body.querySelector("ul");
      for (const it of list) {
        const li = html("li", it.done ? "done" : "");
        const box = Object.assign(html("input"), { type: "checkbox", checked: it.done });
        box.addEventListener("change", () => save({ aquarisTodos: list.map(o => (o.id === it.id ? { ...o, done: box.checked } : o)) }).then(draw));
        const del = html("button", "wg-del", "×");
        del.title = "Remove";
        del.addEventListener("click", () => save({ aquarisTodos: list.filter(o => o.id !== it.id) }).then(draw));
        li.append(box, html("span", "", it.text), del);
        ul.append(li);
      }
      body.querySelector("form").addEventListener("submit", e => {
        e.preventDefault();
        const v = body.querySelector("input").value.trim();
        if (v) save({ aquarisTodos: [...list, { id: Date.now().toString(36), text: v, done: false }] }).then(() => { draw(); body.querySelector("input").focus(); });
      });
    };
    draw();
  }
};
// Pick a widget to add (from the desktop's right-click menu)
function pickWidget(x, y) {
  showMenu({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} }, Object.entries(WIDGET_TYPES).map(([type, t]) => [t.name, () => {
    const d = deskRect();
    const list = settings.aquarisWidgets || [];
    saveWidgets([...list, { id: Date.now().toString(36), type, x: Math.min(d.width - t.w - 20, Math.max(20, x - d.left - 40)), y: Math.max(10, y - d.top - 10) }]).then(drawWidgets);
  }]));
}
$("#desktop").addEventListener("contextmenu", e => {
  if (e.target.closest(".win, .icon, .widget-card")) return;
  // Add "Add a widget…" to the desktop menu Aquaris just opened
  setTimeout(() => {
    const menu = $("#menu");
    if (menu.hidden || menu.querySelector(".add-widget")) return;
    const b = html("button", "add-widget", "Add a widget…");
    b.addEventListener("click", () => { menu.hidden = true; pickWidget(e.clientX, e.clientY); });
    menu.prepend(b);
  }, 0);
});

// ======================================================================================
// ====================================== SPACES ========================================
// ======================================================================================
// Several desktops, each with its own windows (school, games, chill…). Switch with Ctrl+Alt+← / →,
// a three-finger swipe on an iPad, or the Spaces button in the top bar. Apps in the dock open on the
// desktop they're on.

const spaceList = () => (settings.aquarisSpaces?.length ? settings.aquarisSpaces : [{ id: "s1", name: "Desktop 1" }]);
const curSpace = () => (spaceList().some(s => s.id === settings.aquarisSpace) ? settings.aquarisSpace : spaceList()[0].id);
windowHooks.push(win => { win.space ??= curSpace(); applySpace(false); });
function applySpace(animate = true, dir = 0) {
  const cur = curSpace();
  for (const w of wins) w.el.classList.toggle("off-space", (w.space || "s1") !== cur);
  if (animate && dir) {
    $("#windows").classList.remove("slide-l", "slide-r");
    void $("#windows").offsetWidth;
    $("#windows").classList.add(dir > 0 ? "slide-l" : "slide-r");
  }
  drawSpacesButton();
}
async function switchSpace(id, dir = 0) {
  if (id === curSpace()) return;
  if (!dir) { const ids = spaceList().map(s => s.id); dir = Math.sign(ids.indexOf(id) - ids.indexOf(curSpace())); }
  await save({ aquarisSpace: id });
  applySpace(true, dir);
  const front = activeWin();
  if (front) focusWin(front);
  showSpaceName();
}
function stepSpace(step) {
  const list = spaceList(), i = list.findIndex(s => s.id === curSpace());
  const next = list[i + step];
  if (next) switchSpace(next.id, step);
}
function showSpaceName() {
  $("#spaceToast")?.remove();
  const t = html("div", "space-toast");
  t.id = "spaceToast";
  const list = spaceList();
  t.append(html("b", "", list.find(s => s.id === curSpace())?.name || ""));
  const dots = html("span", "space-dots");
  for (const s of list) dots.append(html("i", s.id === curSpace() ? "on" : ""));
  t.append(dots);
  document.body.append(t);
  setTimeout(() => t.remove(), 1100);
}
// Windows on another desktop: opening them goes there
const restoreOnSpace = restore;
restore = function (w) {
  if (w?.space && w.space !== curSpace()) switchSpace(w.space);
  return restoreOnSpace(w);
};
// The Spaces button in the top bar, and its menu
const spacesBtn = html("button", "tb-btn tb-spaces");
spacesBtn.id = "tbSpaces";
spacesBtn.title = "Desktops (Ctrl+Alt+← →)";
$("#tbSearch").before(spacesBtn);
function drawSpacesButton() {
  const list = spaceList();
  spacesBtn.hidden = list.length < 2;
  spacesBtn.textContent = "";
  for (const s of list) spacesBtn.append(html("i", "sp-dot" + (s.id === curSpace() ? " on" : "")));
}
function spacesMenu(e) {
  const list = spaceList();
  const items = list.map(s => [(s.id === curSpace() ? "✓ " : "   ") + s.name, () => switchSpace(s.id)]);
  items.push(null, ["New desktop", async () => {
    const id = "s" + Date.now().toString(36);
    await save({ aquarisSpaces: [...list, { id, name: `Desktop ${list.length + 1}` }] });
    switchSpace(id, 1);
  }], ["Rename this desktop…", async () => {
    const name = await askText($("#desktop"), "Name this desktop (like School, Games or Chill)", list.find(s => s.id === curSpace())?.name || "");
    if (name) save({ aquarisSpaces: list.map(s => (s.id === curSpace() ? { ...s, name } : s)) }).then(() => applySpace(false));
  }]);
  if (list.length > 1) items.push(["Remove this desktop", async () => {
    const gone = curSpace(), keep = list.find(s => s.id !== gone);
    for (const w of wins) if (w.space === gone) w.space = keep.id;   // its windows move over
    await save({ aquarisSpaces: list.filter(s => s.id !== gone), aquarisSpace: keep.id });
    applySpace(false); saveLayout();
  }]);
  showMenu(e, items);
}
spacesBtn.addEventListener("click", e => { const r = spacesBtn.getBoundingClientRect(); spacesMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {} }); });
// Desktop menu: "New desktop" too
$("#desktop").addEventListener("contextmenu", e => {
  if (e.target.closest(".win, .icon, .widget-card")) return;
  setTimeout(() => {
    const menu = $("#menu");
    if (menu.hidden || menu.querySelector(".spaces-item")) return;
    const b = html("button", "spaces-item", "Desktops…");
    b.addEventListener("click", () => { menu.hidden = true; spacesMenu({ clientX: e.clientX, clientY: e.clientY, preventDefault() {}, stopPropagation() {} }); });
    menu.querySelector(".add-widget")?.after(b) ?? menu.prepend(b);
  }, 0);
});
addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    if (spaceList().length < 2 && e.key === "ArrowRight") return;
    stepSpace(e.key === "ArrowRight" ? 1 : -1);
  }
});
// iPad: a three-finger swipe sideways switches desktops
if (onWeb) {
  let three = null;
  document.addEventListener("touchstart", e => { three = e.touches.length === 3 ? { x: [...e.touches].reduce((s, t) => s + t.clientX, 0) / 3, done: false } : null; }, { passive: true, capture: true });
  document.addEventListener("touchmove", e => {
    if (!three || three.done || e.touches.length !== 3) return;
    const x = [...e.touches].reduce((s, t) => s + t.clientX, 0) / 3;
    if (Math.abs(x - three.x) > 90) { three.done = true; stepSpace(x < three.x ? 1 : -1); }
  }, { passive: true, capture: true });
}

// ======================================================================================
// =========================== SPOTLIGHT FINDS EVERYTHING ===============================
// ======================================================================================
// Open windows, Aeris tabs, notes, to-dos, captures and (on a computer) your files.

let fileIndex = null, fileIndexAt = 0;
async function buildFileIndex() {
  if (!inChrome || (fileIndex && Date.now() - fileIndexAt < 10 * 60000)) return;
  fileIndexAt = Date.now();
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path, out = [];
  const roots = ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"].map(n => PathUtils.join(home, n));
  const walk = async (dir, depth) => {
    if (out.length > 6000 || depth > 3) return;
    for (const p of await IOUtils.getChildren(dir).catch(() => [])) {
      const name = PathUtils.filename(p);
      if (name.startsWith(".")) continue;
      const st = await IOUtils.stat(p).catch(() => null);
      if (!st) continue;
      out.push({ path: p, name, dir: st.type === "directory" });
      if (st.type === "directory") await walk(p, depth + 1);
    }
  };
  for (const r of roots) await walk(r, 0);
  fileIndex = out;
}
spotlightHooks.push(q => {
  const groups = [], has = s => String(s || "").toLowerCase().includes(q);
  // Windows and tabs
  const open = [];
  for (const w of wins) {
    if (w.tabs?.length > 1) { for (const v of w.tabs) if (has(viewTitle(v)) || has(viewUrl(v))) open.push({ app: w.app, title: viewTitle(v) || viewUrl(v), kind: "Aeris tab", go: () => { restore(w); switchTab(w, v); focusWin(w); } }); }
    else if (has(w.name.textContent) || has(w.app.name)) open.push({ app: w.app, title: w.name.textContent, kind: "Open window", go: () => { restore(w); focusWin(w); } });
  }
  for (const a of aerisWindows()) for (const t of a.gBrowser?.tabs || []) {
    if (has(t.label) || has(t.linkedBrowser?.currentURI?.spec)) open.push({ app: AERIS_APP, title: t.label, kind: "Aeris tab", go: () => { showAeris(a); a.gBrowser.selectedTab = t; } });
  }
  if (open.length) groups.push(["Open now", open.slice(0, 6)]);
  // Notes and to-dos
  const notepad = appById("notepad") || anyApp("notepad");
  const notes = (settings.aquarisNotes || []).filter(n => has(n.text)).map(n => ({ app: notepad, title: (n.text.split("\n")[0] || "Note").slice(0, 60), kind: "Note", go: () => openApp(notepad) }));
  if (has(settings.aquarisWidgetNote)) notes.push({ app: notepad, title: settings.aquarisWidgetNote.split("\n")[0].slice(0, 60), kind: "Quick note widget", go: () => {} });
  const todos = (settings.aquarisTodos || []).filter(t => has(t.text)).map(t => ({ app: { id: "todo", ui: "pencil", color: "#3cb371" }, title: t.text, kind: t.done ? "To-do (done)" : "To-do", go: () => {} }));
  if (notes.length || todos.length) groups.push(["Notes and to-dos", [...notes, ...todos].slice(0, 6)]);
  // Captures
  const caps = (typeof captures !== "undefined" ? captures : []).filter(c => has(c.name)).map(c => ({ app: appById("capture") || anyApp("capture"), title: c.name, kind: c.kind === "video" ? "Recording" : "Screenshot", go: () => openApp(appById("capture") || anyApp("capture")) }));
  if (caps.length) groups.push(["Captures", caps.slice(0, 4)]);
  // Files on this computer (indexed in the background)
  if (inChrome) {
    buildFileIndex();
    const files = (fileIndex || []).filter(f => has(f.name)).slice(0, 6).map(f => ({ app: { id: "file", ui: f.dir ? "folder" : "file", color: f.dir ? "#f0a81c" : "#6b7a8f" }, title: f.name, kind: PathUtils.parent(f.path).replace(Services.dirsvc.get("Home", Ci.nsIFile).path, "~"),
      go: () => { try { const nf = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); nf.initWithPath(f.path); f.dir ? nf.reveal() : nf.launch(); } catch {} } }));
    if (files.length) groups.push(["Files", files]);
  }
  return groups;
});
if (inChrome) setTimeout(buildFileIndex, 15000);

// ======================================================================================
// ================================= CLIPBOARD HISTORY ==================================
// ======================================================================================
// The last 25 things you copied (text and links). Ctrl+Shift+V shows them; pick one to paste it.
// Kept only while Aquaris is running, never saved.

const clipHistory = [];
function rememberCopy(text) {
  text = String(text || "");
  if (!text.trim() || text.length > 20000) return;
  const i = clipHistory.indexOf(text);
  if (i === 0) return;
  if (i > 0) clipHistory.splice(i, 1);
  clipHistory.unshift(text);
  clipHistory.length = Math.min(clipHistory.length, 25);
}
// On a computer: look at the clipboard now and then (it can change in any program)
function readClipboard() {
  try {
    const trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
    trans.init(null);
    trans.addDataFlavor("text/plain");
    Services.clipboard.getData(trans, Services.clipboard.kGlobalClipboard, window.browsingContext.currentWindowContext);
    const out = {};
    trans.getTransferData("text/plain", out);
    return out.value?.QueryInterface(Ci.nsISupportsString).data || "";
  } catch { return ""; }
}
if (inChrome) setInterval(() => rememberCopy(readClipboard()), 1500);
document.addEventListener("copy", () => setTimeout(() => rememberCopy(getSelection().toString()), 0));
function showClipboard() {
  $("#clipBox")?.remove();
  const box = html("div", "clip-box");
  box.id = "clipBox";
  box.append(html("b", "clip-head", "Clipboard history"));
  const list = html("div", "clip-list");
  if (!clipHistory.length) list.append(html("p", "hint", "Copy some text and it shows up here."));
  clipHistory.forEach(text => {
    const b = html("button", "clip-item", text.length > 160 ? text.slice(0, 160) + "…" : text);
    b.title = text.slice(0, 600);
    b.addEventListener("click", () => { box.remove(); pasteText(text); });
    list.append(b);
  });
  box.append(list);
  if (clipHistory.length) {
    const clear = html("button", "btn", "Clear");
    clear.addEventListener("click", () => { clipHistory.length = 0; box.remove(); });
    box.append(clear);
  }
  document.body.append(box);
  const away = e => { if (!box.contains(e.target)) { box.remove(); removeEventListener("pointerdown", away, true); } };
  setTimeout(() => addEventListener("pointerdown", away, true), 0);
}
function pasteText(text) {
  const front = activeWin();
  if (inChrome) {
    clipboard(text);
    rememberCopy(text);
    if (front?.view && front.kind === "app") { front.view.focus(); setTimeout(() => windowUtils.sendContentCommandEvent("paste"), 50); }
    else document.execCommand?.("insertText", false, text);
  } else {
    navigator.clipboard?.writeText(text).catch(() => {});
    rememberCopy(text);
    if (inShell && front?.view?.dataset.shell) shell.postMessage({ cmd: "paste", id: front.view.dataset.shell, text });
  }
}
addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyV") { e.preventDefault(); showClipboard(); } }, true);
deskShell = ev => {
  if (ev.type === "copied") rememberCopy(ev.text);
  if (ev.type === "key" && ev.key === "clipboard") showClipboard();
};

// ======================================================================================
// ==================================== MINI PLAYER =====================================
// ======================================================================================
// Pops an app (YouTube, a video call…) out into a small player that stays on top of the other
// windows, in a corner. Where Aquaris can, it shows just the video. Click ⤢ to put it back.

const MINI_CSS = "video { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; z-index: 2147483647 !important; object-fit: contain !important; background: #000 !important; transform: none !important; } html, body { overflow: hidden !important; }";
function setMiniCss(win, on) {
  const v = win.view;
  if (!v) return;
  if (inShell && v.dataset.shell) return shell.postMessage({ cmd: "css", id: v.dataset.shell, css: on ? MINI_CSS : "" });
  if (inChrome) {
    // A tiny frame script puts the style into the page (and takes it out again)
    try {
      const code = on ? `(() => { const s = content.document.createElement("style"); s.id = "aquaris-mini"; s.textContent = ${JSON.stringify(MINI_CSS)}; content.document.documentElement.append(s); })()`
        : `content.document.getElementById("aquaris-mini")?.remove()`;
      v.messageManager?.loadFrameScript("data:application/javascript," + encodeURIComponent(code), false);
    } catch (e) { console.warn("Aquaris mini player:", e); }
  }
}
function toggleMini(win) {
  if (!win?.view) return;
  if (win.mini) {
    win.el.classList.remove("mini");
    win.rect = win.mini.rect;
    win.mini = null;
    setMiniCss(win, false);
    animateGeo(win); place(win); focusWin(win);
    return;
  }
  if (win.state === "max") maximise(win, false);
  if (win.state.startsWith("min")) restore(win);
  const d = deskRect(), W = 380, H = 230;
  win.mini = { rect: { ...win.rect } };
  win.rect = { x: d.width - W - 16, y: d.height - dockSpace() - H - 16, w: W, h: H };
  win.el.classList.add("mini");
  setMiniCss(win, true);
  animateGeo(win); place(win);
}
// A mini player button on app windows, and in their right-click menus
windowHooks.push(win => {
  if (win.kind !== "app") return;
  const b = html("button", "tool t-mini");
  b.title = "Mini player (stays on top)";
  setHTML(b, icon("out"));
  b.addEventListener("click", () => toggleMini(win));
  win.el.querySelector(".tools")?.prepend(b);
});

// ----- Start -----
deskReady = () => { drawWidgets(); applySpace(false); };
