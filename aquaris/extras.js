// Aquaris extras: the Arcade (three games of our own), snap layouts on the maximise button, and
// Capture (screenshots and screen recordings). Loaded after aquaris.js and live.js.

// ======================================================================================
// ====================================== ARCADE ========================================
// ======================================================================================
// Three small games, made for Aquaris:
//   Bubble Pop   – pop rising bubbles; popping one pops every touching bubble of its colour too.
//   Drop Swap    – swap neighbouring water drops to line up three or more of a colour.
//   Memory Tides – turn over cards two at a time and find the pairs.
// Mouse, finger, trackpad and controller cursor all work (they're pointer events).

const arcadeBest = () => settings.aquarisArcade || {};
const setBest = (game, value, lowerIsBetter = false) => {
  const best = arcadeBest()[game];
  const better = best == null || (lowerIsBetter ? value < best : value > best);
  if (better) save({ aquarisArcade: { ...arcadeBest(), [game]: value } });
  return better;
};
const DROP_COLOURS = ["#1e9be8", "#3cc23c", "#ff5f6d", "#ffc233", "#a35cff", "#ff8a1f"];

function buildArcade(page, win) {
  const home = () => {
    setHTML(page, `<div class="arcade"><header class="arc-head"><h2>Arcade</h2><p class="hint">Three games made for Aquaris.</p></header>
      <div class="arc-cards">
        <button class="arc-card" data-g="bubble"><i class="arc-art bubble"></i><b>Bubble Pop</b><span>Pop the bubbles. Touching bubbles of the same colour pop together.</span><small>Best: ${arcadeBest().bubble ?? "—"}</small></button>
        <button class="arc-card" data-g="swap"><i class="arc-art swap"></i><b>Drop Swap</b><span>Swap two drops to line up three or more of a colour.</span><small>Best: ${arcadeBest().swap ?? "—"}</small></button>
        <button class="arc-card" data-g="memory"><i class="arc-art memory"></i><b>Memory Tides</b><span>Turn over two cards at a time and find every pair.</span><small>Best: ${arcadeBest().memory != null ? arcadeBest().memory + " moves" : "—"}</small></button>
      </div></div>`);
    page.querySelectorAll(".arc-card").forEach(b => b.addEventListener("click", () => ({ bubble: bubblePop, swap: dropSwap, memory: memoryTides })[b.dataset.g](page, home)));
  };
  home();
  win.stopGame = () => page.dispatchEvent(new Event("arcade-stop"));
}
// The frame every game sits in: a top row with Back, the score and Restart
function gameFrame(page, home, title, restart) {
  page.dispatchEvent(new Event("arcade-stop"));
  setHTML(page, `<div class="game"><header class="game-bar"><button class="btn" data-a="back">‹ Arcade</button><b>${title}</b><span class="game-score"></span><button class="btn" data-a="again">Restart</button></header><div class="game-area"></div></div>`);
  page.querySelector('[data-a="back"]').addEventListener("click", () => { page.dispatchEvent(new Event("arcade-stop")); home(); });
  page.querySelector('[data-a="again"]').addEventListener("click", () => restart(page, home));
  return { area: page.querySelector(".game-area"), score: t => (page.querySelector(".game-score").textContent = t) };
}
function gameOver(area, text, again) {
  const box = html("div", "game-over");
  box.append(html("b", "", "Game over"), html("span", "", text));
  const b = html("button", "btn primary", "Play again");
  b.addEventListener("click", again);
  box.append(b);
  area.append(box);
}
const glossyDrop = (ctx, x, y, r, colour) => {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.25, colour);
  g.addColorStop(1, colour);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.45, r * 0.38, r * 0.2, -0.5, 0, Math.PI * 2); ctx.fill();
};

// ----- Bubble Pop -----
function bubblePop(page, home) {
  const { area, score } = gameFrame(page, home, "Bubble Pop", bubblePop);
  const canvas = html("canvas", "game-canvas");
  area.append(canvas);
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, bubbles = [], sparks = [], points = 0, left = 60, last = performance.now(), spawn = 0, running = true, raf = 0;
  const fit = () => { const r = area.getBoundingClientRect(), dpr = devicePixelRatio || 1; W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  const make = () => {
    const r = 16 + Math.random() * 18, golden = Math.random() < 0.04;
    return { x: r + Math.random() * (W - 2 * r), y: H + r, r, vy: 30 + Math.random() * 40 + (60 - left) * 0.8, colour: golden ? "#ffd700" : DROP_COLOURS[Math.floor(Math.random() * 4)], golden, wob: Math.random() * 6 };
  };
  const pop = b => {
    // Pop it and every touching bubble of the same colour (a chain), for more points
    const chain = new Set([b]), queue = [b];
    while (queue.length) {
      const c = queue.pop();
      for (const o of bubbles) if (!chain.has(o) && o.colour === c.colour && Math.hypot(o.x - c.x, o.y - c.y) < o.r + c.r + 6) { chain.add(o); queue.push(o); }
    }
    for (const c of chain) {
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; sparks.push({ x: c.x, y: c.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 1, colour: c.colour }); }
      if (c.golden) left += 5;
    }
    points += chain.size * chain.size;
    bubbles = bubbles.filter(o => !chain.has(o));
  };
  canvas.addEventListener("pointerdown", e => {
    if (!running) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = [...bubbles].reverse().find(b => Math.hypot(b.x - x, b.y - y) < b.r + 4);
    if (hit) pop(hit);
  });
  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (running) {
      left -= dt;
      spawn -= dt;
      if (spawn <= 0) { bubbles.push(make()); spawn = Math.max(0.18, 0.6 - (60 - left) * 0.006); }
      for (const b of bubbles) { b.y -= b.vy * dt; b.wob += dt * 2; }
      bubbles = bubbles.filter(b => b.y > -b.r);
      if (left <= 0) {
        running = false;
        const best = setBest("bubble", points);
        gameOver(area, `${points} points${best ? " · a new best!" : ""}`, () => bubblePop(page, home));
      }
    }
    ctx.clearRect(0, 0, W, H);
    for (const b of bubbles) glossyDrop(ctx, b.x + Math.sin(b.wob) * 4, b.y, b.r, b.colour);
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 2; ctx.globalAlpha = Math.max(0, s.life); ctx.fillStyle = s.colour; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    sparks = sparks.filter(s => s.life > 0);
    score(`${points} points · ${Math.max(0, Math.ceil(left))} s`);
    raf = requestAnimationFrame(frame);
  };
  fit();
  new ResizeObserver(fit).observe(area);
  raf = requestAnimationFrame(frame);
  page.addEventListener("arcade-stop", () => cancelAnimationFrame(raf), { once: true });
}

// ----- Drop Swap -----
function dropSwap(page, home) {
  const { area, score } = gameFrame(page, home, "Drop Swap", dropSwap);
  const N = 8, KINDS = 6;
  const canvas = html("canvas", "game-canvas");
  area.append(canvas);
  const ctx = canvas.getContext("2d");
  let grid = [], pick = null, points = 0, moves = 25, busy = false, S = 40, ox = 0, oy = 0, gone = new Set();
  const rnd = () => Math.floor(Math.random() * KINDS);
  // A starting board with no lines of three already in it
  for (let r = 0; r < N; r++) {
    grid[r] = [];
    for (let c = 0; c < N; c++) {
      let k;
      do k = rnd(); while ((c >= 2 && grid[r][c - 1] === k && grid[r][c - 2] === k) || (r >= 2 && grid[r - 1][c] === k && grid[r - 2][c] === k));
      grid[r][c] = k;
    }
  }
  const fit = () => {
    const r = area.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = Math.floor(Math.min(r.width, r.height - 10) / N);
    ox = (r.width - S * N) / 2; oy = (r.height - S * N) / 2;
    draw();
  };
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(127,127,127,0.12)";
    ctx.fillRect(ox, oy, S * N, S * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (grid[r][c] == null || gone.has(r * N + c)) continue;
      if (pick && pick[0] === r && pick[1] === c) { ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(ox + c * S, oy + r * S, S, S); }
      glossyDrop(ctx, ox + c * S + S / 2, oy + r * S + S / 2, S * 0.38, DROP_COLOURS[grid[r][c]]);
    }
    score(`${points} points · ${moves} moves left`);
  };
  const lines = () => {
    const hit = new Set();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const k = grid[r][c];
      if (k == null) continue;
      if (c <= N - 3 && grid[r][c + 1] === k && grid[r][c + 2] === k) for (let i = 0; i < 3; i++) hit.add(r * N + c + i);
      if (r <= N - 3 && grid[r + 1][c] === k && grid[r + 2][c] === k) for (let i = 0; i < 3; i++) hit.add((r + i) * N + c);
    }
    // Lines longer than three: keep adding
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of [...hit]) {
        const r = Math.floor(i / N), c = i % N, k = grid[r][c];
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const rr = r + dr, cc = c + dc, j = rr * N + cc;
          if (rr >= 0 && rr < N && cc >= 0 && cc < N && !hit.has(j) && grid[rr][cc] === k) {
            const r2 = rr + dr, c2 = cc + dc;
            if ((r2 >= 0 && r2 < N && c2 >= 0 && c2 < N && hit.has(r2 * N + c2)) || hit.has((r - dr) * N + (c - dc))) { hit.add(j); grew = true; }
          }
        }
      }
    }
    return hit;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settle = async () => {
    let combo = 1;
    for (let hit = lines(); hit.size; hit = lines(), combo++) {
      gone = hit; draw(); await wait(180); gone = new Set();
      points += hit.size * 10 * combo;
      for (const i of hit) grid[Math.floor(i / N)][i % N] = null;
      // Drops fall, new ones come in at the top
      for (let c = 0; c < N; c++) {
        const col = [];
        for (let r = N - 1; r >= 0; r--) if (grid[r][c] != null) col.push(grid[r][c]);
        for (let r = N - 1, i = 0; r >= 0; r--, i++) grid[r][c] = i < col.length ? col[i] : rnd();
      }
      draw(); await wait(160);
    }
  };
  const swap = async (a, b) => {
    busy = true;
    [grid[a[0]][a[1]], grid[b[0]][b[1]]] = [grid[b[0]][b[1]], grid[a[0]][a[1]]];
    draw();
    if (!lines().size) { await wait(180); [grid[a[0]][a[1]], grid[b[0]][b[1]]] = [grid[b[0]][b[1]], grid[a[0]][a[1]]]; draw(); busy = false; return; }
    moves--;
    await settle();
    busy = false;
    draw();
    if (moves <= 0) { const best = setBest("swap", points); gameOver(area, `${points} points${best ? " · a new best!" : ""}`, () => dropSwap(page, home)); }
  };
  let downAt = null;
  canvas.addEventListener("pointerdown", e => {
    if (busy || moves <= 0) return;
    const r = canvas.getBoundingClientRect(), c = Math.floor((e.clientX - r.left - ox) / S), row = Math.floor((e.clientY - r.top - oy) / S);
    if (c < 0 || c >= N || row < 0 || row >= N) return;
    downAt = { row, c, x: e.clientX, y: e.clientY };
    if (pick && Math.abs(pick[0] - row) + Math.abs(pick[1] - c) === 1) { const a = pick; pick = null; swap(a, [row, c]); downAt = null; return; }
    pick = [row, c];
    draw();
  });
  // Dragging a drop towards a neighbour swaps them too
  canvas.addEventListener("pointermove", e => {
    if (!downAt || busy) return;
    const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < S * 0.45) return;
    const to = Math.abs(dx) > Math.abs(dy) ? [downAt.row, downAt.c + Math.sign(dx)] : [downAt.row + Math.sign(dy), downAt.c];
    const from = [downAt.row, downAt.c];
    downAt = null; pick = null;
    if (to[0] >= 0 && to[0] < N && to[1] >= 0 && to[1] < N) swap(from, to);
  });
  addEventListener("pointerup", () => (downAt = null));
  canvas.style.touchAction = "none";
  fit();
  new ResizeObserver(fit).observe(area);
}

// ----- Memory Tides -----
function memoryTides(page, home) {
  const { area, score } = gameFrame(page, home, "Memory Tides", memoryTides);
  const SYMBOLS = ["star", "heart", "music", "game", "camera", "cloud", "globe", "moon"];
  const deck = [...SYMBOLS, ...SYMBOLS].map((s, i) => ({ s, i, colour: DROP_COLOURS[SYMBOLS.indexOf(s) % DROP_COLOURS.length] })).sort(() => Math.random() - 0.5);
  const board = html("div", "mem-board");
  area.append(board);
  let open = [], found = 0, moves = 0, busy = false;
  const t0 = Date.now();
  const show = () => score(`${moves} moves · ${found} of 8 pairs`);
  for (const card of deck) {
    const b = html("button", "mem-card");
    setHTML(b, `<span class="mem-back"></span><span class="mem-face" style="--c:${card.colour}">${icon(card.s)}</span>`);
    b.addEventListener("click", () => {
      if (busy || b.classList.contains("up") || b.classList.contains("done")) return;
      b.classList.add("up");
      open.push([b, card]);
      if (open.length < 2) return;
      moves++;
      const [[b1, c1], [b2, c2]] = open;
      open = [];
      if (c1.s === c2.s) {
        b1.classList.add("done"); b2.classList.add("done"); found++;
        if (found === 8) {
          const secs = Math.round((Date.now() - t0) / 1000), best = setBest("memory", moves, true);
          setTimeout(() => gameOver(area, `All pairs in ${moves} moves (${secs} s)${best ? " · a new best!" : ""}`, () => memoryTides(page, home)), 500);
        }
      } else {
        busy = true;
        setTimeout(() => { b1.classList.remove("up"); b2.classList.remove("up"); busy = false; }, 800);
      }
      show();
    });
    board.append(b);
  }
  show();
}
ownBuilders.arcade = buildArcade;

// ======================================================================================
// =================================== SNAP LAYOUTS =====================================
// ======================================================================================
// Rest the pointer on a window's maximise button (or right-click it) to pick a layout and a spot in
// it, like Windows 11. The window goes there; then Aquaris offers your other windows for the
// remaining spots, one after another.

const SNAP_LAYOUTS = [
  [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
  [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
  [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]
];
function zoneRect(z) {
  const d = deskRect(), W = d.width, H = d.height - dockSpace(), gap = 6;
  return { x: Math.round(z[0] * W + gap / 2), y: Math.round(z[1] * H + gap / 2), w: Math.round(z[2] * W - gap), h: Math.round(z[3] * H - gap) };
}
function putInZone(w, z) {
  if (w.state.startsWith("min")) restore(w);
  if (w.state === "max") maximise(w, false);
  w.before ??= { ...w.rect };
  w.rect = zoneRect(z);
  w.snapped = true;
  animateGeo(w);
  place(w);
  focusWin(w);
  saveLayout();
}
// Fill the other spots of a layout, one at a time, from the other open windows
function fillLayout(zones, placed) {
  const z = zones[0];
  if (!z) return;
  const others = wins.filter(w => w.kind !== "native" && !placed.includes(w));
  if (!others.length) return;
  $("#snapAssist")?.remove();
  const r = zoneRect(z);
  const box = html("div", "snap-assist");
  box.id = "snapAssist";
  Object.assign(box.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
  box.append(html("b", "snap-title", "Pick what goes here"));
  const grid = html("div", "snap-grid");
  for (const w of others) {
    const b = html("button", "snap-pick");
    b.append(tile(w.app, "big"), html("span", "", w.name.textContent));
    b.addEventListener("click", () => { box.remove(); putInZone(w, z); fillLayout(zones.slice(1), [...placed, w]); });
    grid.append(b);
  }
  box.append(grid);
  box.addEventListener("pointerdown", e => { if (e.target === box) box.remove(); });
  $("#desktop").append(box);
}
let snapPopTimer = 0;
function openSnapPop(win, button) {
  $("#snapPop")?.remove();
  const pop = html("div", "snap-pop");
  pop.id = "snapPop";
  SNAP_LAYOUTS.forEach(layout => {
    const lay = html("div", "snap-lay");
    layout.forEach((z, i) => {
      const zb = html("button", "snap-zone");
      Object.assign(zb.style, { left: z[0] * 100 + "%", top: z[1] * 100 + "%", width: z[2] * 100 + "%", height: z[3] * 100 + "%" });
      zb.title = "Put the window here";
      zb.addEventListener("click", () => {
        pop.remove();
        putInZone(win, z);
        fillLayout(layout.filter((_, j) => j !== i), [win]);
      });
      lay.append(zb);
    });
    pop.append(lay);
  });
  document.body.append(pop);
  const r = button.getBoundingClientRect(), pw = pop.offsetWidth;
  Object.assign(pop.style, { left: Math.max(8, Math.min(innerWidth - pw - 8, r.right - pw)) + "px", top: r.bottom + 6 + "px" });
  const away = e => { if (!pop.contains(e.target) && e.target !== button) { pop.remove(); removeEventListener("pointerdown", away, true); } };
  addEventListener("pointerdown", away, true);
  pop.addEventListener("pointerleave", () => { snapPopTimer = setTimeout(() => pop.remove(), 500); });
  pop.addEventListener("pointerenter", () => clearTimeout(snapPopTimer));
}
$("#windows").addEventListener("pointerover", e => {
  const b = e.target.closest(".c-max");
  if (!b || e.pointerType === "touch") return;
  const win = wins.find(w => w.el.contains(b));
  clearTimeout(snapPopTimer);
  snapPopTimer = setTimeout(() => { if (b.matches(":hover")) openSnapPop(win, b); }, 450);
});
$("#windows").addEventListener("pointerout", e => { if (e.target.closest?.(".c-max")) clearTimeout(snapPopTimer); });
$("#windows").addEventListener("contextmenu", e => {
  const b = e.target.closest(".c-max");
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  openSnapPop(wins.find(w => w.el.contains(b)), b);
}, true);

// ======================================================================================
// ====================================== CAPTURE =======================================
// ======================================================================================
// Screenshots (everything, one window, or an area you drag) and screen recordings of Aquaris.
// On a computer they're saved in Pictures → Aquaris Captures (and screenshots are copied too).
// In the iPad app they go to the Photos app.

const captures = [];      // this session's captures: { kind, name, url (to show), path }
function capFolder() {
  let pics;
  for (const k of ["Pict", "XDGPict"]) { try { pics = Services.dirsvc.get(k, Ci.nsIFile).path; break; } catch {} }
  pics ??= PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, "Pictures");
  return PathUtils.join(pics, "Aquaris Captures");
}
const capName = (ext) => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `Capture ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.${ext}`; };
async function snapshotRect(rect) {
  const dpr = devicePixelRatio || 1;
  const bmp = await browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(rect.x, rect.y, rect.w, rect.h), dpr, "white");
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return c;
}
// Hide Capture's own window while the picture is taken
async function withCaptureHidden(fn) {
  const me = wins.find(w => w.app.id === "capture");
  const wasOpen = me && !me.state.startsWith("min");
  if (wasOpen) { me.el.style.visibility = "hidden"; }
  await new Promise(r => setTimeout(r, 180));
  try { return await fn(); } finally { if (wasOpen) me.el.style.visibility = ""; }
}
async function takeShot(rect) {
  if (inShell) return shell.postMessage({ cmd: "capture", rect: rect || null });
  if (!inChrome) return;
  const canvas = await withCaptureHidden(() => snapshotRect(rect || { x: 0, y: 0, w: innerWidth, h: innerHeight }));
  const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
  const dir = capFolder(), name = capName("png"), path = PathUtils.join(dir, name);
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); } catch {}
  addCapture({ kind: "shot", name, url: URL.createObjectURL(blob), path });
  notify({ app: "capture", title: "Screenshot saved", body: `${name} (also copied)`, from: "capture" });
}
// Drag over the screen to pick an area
function pickArea() {
  return new Promise(resolve => {
    const veil = html("div", "cap-veil"), box = html("div", "cap-box");
    veil.append(box, html("span", "cap-help", "Drag over the part to capture · Esc to cancel"));
    document.body.append(veil);
    let start = null;
    const end = r => { veil.remove(); removeEventListener("keydown", key, true); resolve(r); };
    const key = e => { if (e.key === "Escape") end(null); };
    addEventListener("keydown", key, true);
    veil.addEventListener("pointerdown", e => { start = { x: e.clientX, y: e.clientY }; try { veil.setPointerCapture(e.pointerId); } catch {} });
    veil.addEventListener("pointermove", e => {
      if (!start) return;
      const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
      Object.assign(box.style, { left: x + "px", top: y + "px", width: Math.abs(e.clientX - start.x) + "px", height: Math.abs(e.clientY - start.y) + "px", display: "block" });
    });
    veil.addEventListener("pointerup", e => {
      if (!start) return;
      const r = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
      end(r.w > 8 && r.h > 8 ? r : null);
    });
  });
}

// ----- Recording -----
const rec = { on: false, recorder: null, timer: 0, started: 0, loop: 0 };
async function startRecording() {
  if (rec.on) return;
  if (inShell) { rec.on = true; rec.started = Date.now(); showRecBar(); return shell.postMessage({ cmd: "record", on: true }); }
  if (!inChrome) return;
  // Draw Aquaris into a canvas about 12 times a second, and record that canvas
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  canvas.width = innerWidth; canvas.height = innerHeight;
  const stream = canvas.captureStream(12);
  const chunks = [];
  rec.recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  rec.recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const dir = capFolder(), name = capName("webm"), path = PathUtils.join(dir, name);
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
    addCapture({ kind: "video", name, url: URL.createObjectURL(blob), path });
    notify({ app: "capture", title: "Recording saved", body: name, from: "capture" });
  };
  rec.on = true;
  rec.started = Date.now();
  let busy = false;
  rec.loop = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const bmp = await browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(0, 0, innerWidth, innerHeight), 1, "white");
      ctx.drawImage(bmp, 0, 0);
    } catch {}
    busy = false;
  }, 83);
  rec.recorder.start(1000);
  showRecBar();
}
function stopRecording() {
  if (!rec.on) return;
  rec.on = false;
  clearInterval(rec.loop);
  clearInterval(rec.timer);
  $("#recBar")?.remove();
  if (inShell) return shell.postMessage({ cmd: "record", on: false });
  rec.recorder?.stop();
}
function showRecBar() {
  $("#recBar")?.remove();
  const bar = html("button", "tb-btn rec-bar");
  bar.id = "recBar";
  bar.title = "Stop recording";
  bar.append(html("i", "rec-dot"), html("span", "rec-time", "0:00"));
  bar.addEventListener("click", stopRecording);
  $("#tbBell").before(bar);
  rec.timer = setInterval(() => { const s = Math.floor((Date.now() - rec.started) / 1000); bar.querySelector(".rec-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 500);
}

function addCapture(c) {
  captures.unshift(c);
  for (const w of wins) if (w.app.id === "capture") w.drawCaptures?.();
}
function buildCapture(page, win) {
  setHTML(page, `<div class="capture">
    <div class="cap-modes">
      <button class="cap-mode" data-m="screen">${icon("pc")}<b>Whole screen</b></button>
      <button class="cap-mode" data-m="window">${icon("square")}<b>A window</b></button>
      <button class="cap-mode" data-m="area">${icon("cut")}<b>An area</b></button>
      <button class="cap-mode rec" data-m="record">${icon("video")}<b>Record</b></button>
    </div>
    <p class="hint cap-where"></p>
    <div class="cap-pick" hidden></div>
    <h3>Captures</h3>
    <div class="cap-list"></div></div>`);
  page.querySelector(".cap-where").textContent = inShell ? "Screenshots and recordings go to your Photos." : `Saved in ${capFolder()}. Screenshots are copied too, ready to paste.`;
  const pickWin = page.querySelector(".cap-pick");
  page.querySelector(".cap-modes").addEventListener("click", async e => {
    const m = e.target.closest("[data-m]")?.dataset.m;
    pickWin.hidden = true;
    if (m === "screen") takeShot();
    if (m === "area") { const r = await withCaptureHidden(pickArea); if (r) takeShot(r); }
    if (m === "record") rec.on ? stopRecording() : startRecording();
    if (m === "window") {
      pickWin.textContent = "";
      for (const w of wins.filter(w => w !== win && !w.state.startsWith("min"))) {
        const b = html("button", "snap-pick");
        b.append(tile(w.app, "small"), html("span", "", w.name.textContent));
        b.addEventListener("click", () => { pickWin.hidden = true; const r = w.el.getBoundingClientRect(); takeShot({ x: r.left, y: r.top, w: r.width, h: r.height }); });
        pickWin.append(b);
      }
      if (!pickWin.children.length) pickWin.append(html("p", "hint", "Open a window first."));
      pickWin.hidden = false;
    }
    page.querySelector('[data-m="record"] b').textContent = rec.on ? "Stop" : "Record";
  });
  win.drawCaptures = () => {
    const list = page.querySelector(".cap-list");
    list.textContent = "";
    if (!captures.length) return list.append(html("p", "hint", "Nothing yet. Your screenshots and recordings show up here."));
    for (const c of captures) {
      const item = html("div", "cap-item");
      const media = c.kind === "video" ? Object.assign(html("video"), { src: c.url, controls: true }) : Object.assign(html("img"), { src: c.url, alt: c.name });
      item.append(media, html("span", "", c.name));
      if (c.path && inChrome) {
        const show = html("button", "btn", "Show in folder");
        show.addEventListener("click", () => { try { const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); f.initWithPath(c.path); f.reveal(); } catch {} });
        item.append(show);
      }
      list.append(item);
    }
  };
  win.drawCaptures();
}
ownBuilders.capture = buildCapture;
// From the iPad app: a screenshot (saved to Photos) or a recording finished
extraShell = ev => {
  if (ev.type === "captured") { addCapture({ kind: "shot", name: "Saved to Photos", url: ev.thumb }); notify({ app: "capture", title: "Screenshot saved", body: "It's in your Photos.", from: "capture" }); }
  if (ev.type === "recorded") { rec.on = false; clearInterval(rec.timer); $("#recBar")?.remove(); }
};
// Keyboard: Ctrl+Shift+S takes a screenshot of the area you drag
addEventListener("keydown", async e => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyS" && (inChrome || inShell)) { e.preventDefault(); const r = await pickArea(); if (r) takeShot(r); }
});
