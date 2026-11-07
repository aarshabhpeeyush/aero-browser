// Mouse gestures (like Vivaldi's): hold the right mouse button, draw, let go. A short label shows
// what the gesture does, and Aeris Core carries it out (see vivaldi.js). A normal right-click still
// opens the menu; only a drag counts as a gesture.

(() => {
  if (window.top !== window) return;
  const STEP = 28; // px of movement before a direction counts
  let on = true;
  let start = null;
  let last = null;
  let path = [];
  let swallowMenu = false;
  let names = {};
  let label = null;

  browser.storage.local.get({ gestures: true }).then(s => (on = s.gestures));
  browser.storage.onChanged.addListener((c, area) => { if (area === "local" && c.gestures) on = c.gestures.newValue !== false; });

  function show(text) {
    if (!label) {
      label = document.createElement("div");
      label.style.cssText = "position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:2147483647;padding:10px 22px;border-radius:999px;" +
        "background:linear-gradient(180deg,rgba(255,255,255,.5) 0%,rgba(255,255,255,.1) 50%,rgba(255,255,255,0) 51%),rgba(10,90,170,.88);" +
        "color:#fff;font:600 18px 'Segoe UI',system-ui,sans-serif;text-shadow:0 1px 2px rgba(0,0,0,.4);box-shadow:0 8px 24px rgba(0,30,70,.35);pointer-events:none;transition:opacity .25s";
    }
    label.textContent = text;
    label.style.opacity = "1";
    if (!label.isConnected) document.documentElement.append(label);
    clearTimeout(show.timer);
    show.timer = setTimeout(() => (label.style.opacity = "0"), 600);
  }

  const arrows = { L: "←", R: "→", U: "↑", D: "↓" };
  addEventListener("mousedown", e => {
    if (!on || e.button !== 2) return;
    start = last = { x: e.clientX, y: e.clientY };
    path = [];
    if (!Object.keys(names).length) browser.runtime.sendMessage({ type: "gesture-names" }).then(n => (names = n || {})).catch(() => {});
  }, true);

  addEventListener("mousemove", e => {
    if (!start || !(e.buttons & 2)) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    if (Math.hypot(dx, dy) < STEP) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U");
    if (path[path.length - 1] !== dir) {
      path.push(dir);
      const g = path.join("");
      show(`${path.map(d => arrows[d]).join("")}  ${names[g] || ""}`.trim());
    }
    last = { x: e.clientX, y: e.clientY };
  }, true);

  addEventListener("mouseup", e => {
    if (e.button !== 2 || !start) return;
    const g = path.join("");
    start = null;
    if (!g) return;
    swallowMenu = true; // it was a gesture, not a right-click
    setTimeout(() => (swallowMenu = false), 400);
    browser.runtime.sendMessage({ type: "gesture", gesture: g }).catch(() => {});
  }, true);

  // Little messages from Aeris Core (like "Link copied") use the same bubble
  browser.runtime.onMessage.addListener(msg => {
    if (msg?.type === "toast") show(msg.text);
  });

  addEventListener("contextmenu", e => {
    if (!swallowMenu) return;
    e.preventDefault();
    e.stopPropagation();
    swallowMenu = false;
  }, true);
})();
