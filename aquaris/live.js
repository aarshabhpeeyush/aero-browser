// Aquaris, live: Now Playing in the top bar, unread badges and the Notification Centre, and sync
// between Aquaris on a computer and Aquaris on an iPad. Loaded after aquaris.js (same page, so it
// uses its windows, settings and helpers).

// ======================================================================================
// ===================================== NOW PLAYING ====================================
// ======================================================================================
// Whatever is playing music or video (YouTube Music, YouTube, Spotify-like sites, Aeris tabs) shows
// in the top bar with ⏮ ⏯ ⏭, even when its window is minimised.
// On a computer: Firefox's own media controls for each view. In the iPad app: the app watches each
// website's media and sends it here. (The web version can't see inside other websites.)

const media = new Map();        // key → { key, app, win, title, artist, art, playing, at, act(action) }
let mediaFront = null;          // the key shown in the top bar

function mediaSources() {
  const out = [];
  if (!inChrome) return out;
  for (const w of wins) {
    for (const v of w.tabs || (w.view ? [w.view] : [])) {
      const mc = v.browsingContext?.mediaController;
      if (mc) out.push({ key: "v" + v.browsingContext.id, app: w.app, win: w, mc });
    }
  }
  // Tabs in the real Aeris windows
  for (const a of aerisWindows()) {
    for (const b of a.gBrowser?.browsers || []) {
      const mc = b.browsingContext?.mediaController;
      if (mc) out.push({ key: "a" + b.browsingContext.id, app: AERIS_APP, aeris: a, tab: a.gBrowser.getTabForBrowser(b), mc });
    }
  }
  return out;
}
function pollMedia() {
  if (!inChrome) return;
  const seen = new Set();
  for (const s of mediaSources()) {
    const mc = s.mc;
    if (!mc.isActive) continue;
    let meta = {};
    try { meta = mc.getMetadata(); } catch {}
    seen.add(s.key);
    const old = media.get(s.key);
    const art = meta.artwork?.length ? meta.artwork[meta.artwork.length - 1].src : "";
    const item = {
      key: s.key, app: s.app, win: s.win, aeris: s.aeris, tab: s.tab,
      title: meta.title || (s.win ? viewTitle(s.win.view) : s.tab?.label) || s.app.name,
      artist: meta.artist || "", art,
      playing: mc.isPlaying,
      at: mc.isPlaying ? Date.now() : old?.at || 0,
      act: action => ({ play: () => mc.play(), pause: () => mc.pause(), next: () => mc.nextTrack(), prev: () => mc.prevTrack() })[action]?.()
    };
    media.set(s.key, item);
  }
  for (const k of [...media.keys()]) if (k[0] !== "s" && !seen.has(k)) media.delete(k);
  drawNowPlaying();
}
setInterval(pollMedia, 1000);

// From the iPad app: { type: "media", id, title, artist, art, playing } (or gone: true)
function shellMedia(ev, win) {
  const key = "s" + ev.id;
  if (ev.gone || !win) { media.delete(key); return drawNowPlaying(); }
  const old = media.get(key);
  media.set(key, {
    key, app: win.app, win, title: ev.title || viewTitle(win.view) || win.app.name, artist: ev.artist || "", art: ev.art || "",
    playing: !!ev.playing, at: ev.playing ? Date.now() : old?.at || 0,
    act: action => shell.postMessage({ cmd: "media", id: ev.id, action })
  });
  drawNowPlaying();
}

function drawNowPlaying() {
  // The one playing now, or the one that played most recently
  const list = [...media.values()].sort((a, b) => (b.playing - a.playing) || (b.at - a.at));
  const m = list[0];
  mediaFront = m?.key || null;
  const bar = $("#tbNow");
  bar.hidden = !m;
  if (!m) { $("#nowCard").hidden = true; return; }
  const text = m.artist ? `${m.title} · ${m.artist}` : m.title;
  bar.querySelector(".now-text").textContent = text;
  bar.title = `${text} (${m.app.name})`;
  const art = bar.querySelector(".now-art");
  art.replaceChildren(m.art ? Object.assign(html("img"), { src: m.art, alt: "" }) : tile(m.app, "tiny"));
  setHTML(bar.querySelector('[data-a="play"]'), icon(m.playing ? "pause" : "play"));
  bar.querySelector('[data-a="play"]').title = m.playing ? "Pause" : "Play";
  if (!$("#nowCard").hidden) drawNowCard(m);
}
function drawNowCard(m) {
  const card = $("#nowCard");
  const big = card.querySelector(".nc-art");
  big.replaceChildren(m.art ? Object.assign(html("img"), { src: m.art, alt: "" }) : tile(m.app, "big"));
  card.querySelector(".nc-title").textContent = m.title;
  card.querySelector(".nc-artist").textContent = m.artist || "";
  card.querySelector(".nc-app").textContent = m.app.name;
  setHTML(card.querySelector('[data-a="play"]'), icon(m.playing ? "pause" : "play"));
}
function mediaAction(a) {
  const m = media.get(mediaFront);
  if (!m) return;
  if (a === "play") m.act(m.playing ? "pause" : "play");
  else if (a === "show") {
    $("#nowCard").hidden = true;
    if (m.win) { restore(m.win); focusWin(m.win); }
    else if (m.aeris) { showAeris(m.aeris); if (m.tab) m.aeris.gBrowser.selectedTab = m.tab; }
  } else m.act(a);
  setTimeout(pollMedia, 250);
}
$("#tbNow").addEventListener("click", e => {
  const a = e.target.closest("[data-a]")?.dataset.a;
  if (a) return mediaAction(a);
  const card = $("#nowCard");
  closeOverlays();
  card.hidden = !card.hidden;
  if (!card.hidden) drawNowCard(media.get(mediaFront));
});
$("#nowCard").addEventListener("click", e => { const a = e.target.closest("[data-a]")?.dataset.a; if (a) mediaAction(a); });
document.addEventListener("pointerdown", e => { if (!e.target.closest("#nowCard, #tbNow")) $("#nowCard").hidden = true; });

// ======================================================================================
// ============================ BADGES AND NOTIFICATIONS ================================
// ======================================================================================
// Unread counts come from the apps' own titles ("(3) Discord", "Inbox (5) - Gmail") and show as red
// badges on the dock and desktop. When a count goes up, Aquaris pops up a notification, and every
// notification is kept in the Notification Centre (the bell in the top bar). In the iPad app,
// websites can also send real notifications (with the message), which arrive here too.

const unread = {};             // app id → count
const unreadOf = title => {
  const m = String(title || "").match(/^\((\d+)\+?\)|^\[(\d+)\]|\((\d+)\+?\)\s*$|Inbox \((\d+)\)/i);
  return m ? +(m[1] || m[2] || m[3] || m[4]) : 0;
};
function pollUnread() {
  for (const w of wins) {
    if (w.kind !== "app" || !w.view || w.napped) continue;
    const n = unreadOf(viewTitle(w.view));
    const before = unread[w.app.id] || 0;
    unread[w.app.id] = n;
    if (n > before) notify({ app: w.app.id, title: w.app.name, body: n - before === 1 ? "1 new message" : `${n - before} new messages`, from: "count" });
  }
  paintBadges();
}
setInterval(pollUnread, 2000);
function paintBadges() {
  for (const el of document.querySelectorAll("#dockApps [data-app], #icons [data-app], #lnApps [data-app]")) {
    const n = unread[el.dataset.app] || 0;
    let b = el.querySelector(":scope > .badge");
    if (!n) { b?.remove(); continue; }
    if (!b) { b = html("span", "badge"); el.append(b); }
    b.textContent = n > 99 ? "99+" : String(n);
  }
}

// One notification: { app, title, body, icon, from }
const NOTIF_KEEP = 60;
function notify(n) {
  const item = { id: Date.now() + Math.random().toString(36).slice(2, 6), at: Date.now(), read: false, ...n };
  settings.aquarisNotifs = [item, ...(settings.aquarisNotifs || [])].slice(0, NOTIF_KEEP);
  store.set({ aquarisNotifs: settings.aquarisNotifs });
  drawBell();
  if (!$("#notifs").hidden) drawNotifs();
  // No pop-up while Do Not Disturb is on, or when the app is already in front of you
  const win = wins.find(w => w.app.id === n.app);
  if (settings.aquarisDnd || (win && isFront(win) && document.hasFocus())) return;
  toast(item);
}
// The jingle: a soft rising two-note chime with a little sparkle, made on the spot (no sound file)
let chimeCtx = null;
function chime() {
  if (settings.aquarisNotifSound === false) return;
  try {
    chimeCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const ac = chimeCtx, t0 = ac.currentTime + 0.02;
    if (ac.state === "suspended") ac.resume();
    const out = ac.createGain();
    out.gain.value = 0.22;
    out.connect(ac.destination);
    const note = (freq, at, len, type = "sine", vol = 1) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0 + at);
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(vol, t0 + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + at + len);
      o.connect(g).connect(out);
      o.start(t0 + at);
      o.stop(t0 + at + len + 0.05);
    };
    note(880, 0, 0.35);                 // A5
    note(1318.5, 0.11, 0.55);           // E6
    note(2637, 0.11, 0.25, "sine", 0.18); // a glassy overtone
  } catch {}
}

function toast(item) {
  chime();
  const app = appById(item.app) || { name: item.title, color: "#5b6b82" };
  const t = html("div", "toast");
  t.setAttribute("role", "status");
  const pic = item.icon ? Object.assign(html("img", "toast-icon"), { src: item.icon, alt: "" }) : tile(app, "small");
  const text = html("div", "toast-text");
  text.append(html("b", "", item.title || app.name), html("span", "", item.body || ""));
  const x = html("button", "toast-x");
  setHTML(x, icon("close"));
  x.title = "Dismiss";
  t.append(pic, text, x);
  t.addEventListener("click", e => {
    t.remove();
    if (e.target.closest(".toast-x")) return;
    openNotif(item);
  });
  $("#toasts").prepend(t);
  while ($("#toasts").children.length > 4) $("#toasts").lastElementChild.remove();
  setTimeout(() => { t.classList.add("going"); setTimeout(() => t.remove(), 300); }, 6000);
}
function openNotif(item) {
  const app = appById(item.app);
  item.read = true;
  store.set({ aquarisNotifs: settings.aquarisNotifs });
  drawBell();
  $("#notifs").hidden = true;
  if (app) openApp(app);
}
function drawBell() {
  const n = (settings.aquarisNotifs || []).filter(x => !x.read).length;
  $("#tbBell").classList.toggle("has-new", n > 0);
  $("#tbBell").title = n ? `Notifications (${n} new)` : "Notifications";
}
const ago = t => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
};
function drawNotifs() {
  const box = $("#notifs");
  const list = settings.aquarisNotifs || [];
  setHTML(box, `<div class="nf-head"><b>Notifications</b><label class="nf-dnd switch"><span>Do Not Disturb</span><input type="checkbox"></label></div>
    <label class="nf-dnd nf-sound switch"><span>Play a sound</span><input type="checkbox"></label><div class="nf-list"></div><div class="nf-foot"><button class="btn" data-a="clear">Clear all</button></div>`);
  box.querySelector(".nf-dnd input").checked = !!settings.aquarisDnd;
  box.querySelector(".nf-dnd input").addEventListener("change", e => save({ aquarisDnd: e.target.checked }));
  const sound = box.querySelector(".nf-sound input");
  sound.checked = settings.aquarisNotifSound !== false;
  sound.addEventListener("change", () => { save({ aquarisNotifSound: sound.checked }); if (sound.checked) chime(); });
  box.querySelector('[data-a="clear"]').addEventListener("click", () => { settings.aquarisNotifs = []; store.set({ aquarisNotifs: [] }); drawBell(); drawNotifs(); });
  const ul = box.querySelector(".nf-list");
  if (!list.length) { ul.append(html("p", "hint nf-empty", "You're all caught up.")); return; }
  for (const item of list) {
    const app = appById(item.app) || { name: item.title, color: "#5b6b82" };
    const row = html("button", "nf-row" + (item.read ? "" : " new"));
    const text = html("div", "nf-text");
    text.append(html("b", "", item.title || app.name), html("span", "", item.body || ""), html("small", "", `${app.name} · ${ago(item.at)}`));
    row.append(item.icon ? Object.assign(html("img", "toast-icon"), { src: item.icon, alt: "" }) : tile(app, "small"), text);
    row.addEventListener("click", () => openNotif(item));
    ul.append(row);
  }
  // Opening the centre counts as seeing them
  setTimeout(() => { for (const x of list) x.read = true; store.set({ aquarisNotifs: list }); drawBell(); }, 1500);
}
$("#tbBell").addEventListener("click", () => {
  const box = $("#notifs");
  const open = box.hidden;
  closeOverlays();
  box.hidden = !open;
  if (open) drawNotifs();
});
document.addEventListener("pointerdown", e => { if (!e.target.closest("#notifs, #tbBell")) $("#notifs").hidden = true; });

// From the iPad app: a website sent a notification ({ type: "notify", id, title, body, icon })
function shellNotify(ev, win) {
  notify({ app: win?.app.id || "aeris", title: ev.title || win?.app.name || "Notification", body: ev.body || "", icon: ev.icon || "", from: "site" });
}

// ======================================================================================
// ========================== SYNC BETWEEN COMPUTER AND iPAD ============================
// ======================================================================================
// No cloud: Aquaris on the computer listens on your home network, and the iPad app talks to it
// directly using a pairing code. Your look, wallpaper, notes, apps, desktop layout and Aeris's
// Customize settings go both ways; for each one the newest change wins.

const SYNC_PORT = 28950;
const SYNC_KEYS = ["aquarisTheme", "aquarisMode", "aquarisGlass", "aquarisLessMotion", "aquarisWall", "aquarisOwnWall", "aquarisLookMore",
  "aquarisNight", "aquarisPinned", "aquarisApps", "aquarisHidden", "aquarisSpots", "aquarisNotes", "aquarisRemoved", "aquarisGot",
  "aquarisWeather", "aquarisAeris", "aquarisAwake"];
let syncApplying = false;
// Every change to a synced setting is stamped with the time it was made
storeHooks.push(changes => {
  if (syncApplying) return;
  const keys = Object.keys(changes).filter(k => SYNC_KEYS.includes(k));
  if (!keys.length) return;
  const stamps = { ...(settings.aquarisSyncStamps || {}) };
  for (const k of keys) stamps[k] = Date.now();
  settings.aquarisSyncStamps = stamps;
  store.data.aquarisSyncStamps = stamps;
  if (inShell && settings.aquarisSync?.address) { clearTimeout(syncSoon.t); syncSoon.t = setTimeout(syncSoon, 1500); }
});
function syncBundle() {
  const data = {};
  for (const k of SYNC_KEYS) data[k] = settings[k];
  return { data, stamps: settings.aquarisSyncStamps || {} };
}
// Take whatever the other side changed more recently
function syncMerge(remote) {
  const mine = settings.aquarisSyncStamps || {};
  const changes = {}, stamps = { ...mine };
  for (const k of SYNC_KEYS) {
    if (!(k in (remote.data || {}))) continue;
    if ((remote.stamps?.[k] || 0) > (mine[k] || 0)) { changes[k] = remote.data[k]; stamps[k] = remote.stamps[k]; }
  }
  if (!Object.keys(changes).length) return 0;
  syncApplying = true;
  Object.assign(settings, changes, { aquarisSyncStamps: stamps });
  store.set({ ...changes, aquarisSyncStamps: stamps });
  syncApplying = false;
  applyLook(); drawIcons(); drawDock(); paintBadges();
  for (const w of aerisWins?.() || []) applyAerisLook(w);
  return Object.keys(changes).length;
}

// ----- On a computer: listen for the iPad -----
let syncServer = null, syncFails = 0, syncLockedUntil = 0, syncLastSeen = 0;
function newSyncCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function startSyncServer() {
  if (!inChrome || syncServer || !settings.aquarisSync?.server) return;
  try {
    syncServer = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
    syncServer.init(SYNC_PORT, false, -1);
    syncServer.asyncListen({ onSocketAccepted: (srv, transport) => serveSync(transport), onStopListening() {} });
  } catch (e) { console.error("Aquaris sync:", e); syncServer = null; }
}
function stopSyncServer() { try { syncServer?.close(); } catch {} syncServer = null; }
function serveSync(transport) {
  const input = transport.openInputStream(0, 0, 0);
  const output = transport.openOutputStream(Ci.nsITransport.OPEN_BLOCKING, 0, 0);
  const bin = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
  const pump = Cc["@mozilla.org/network/input-stream-pump;1"].createInstance(Ci.nsIInputStreamPump);
  let bytes = [];
  const reply = (status, obj) => {
    const body = new TextEncoder().encode(JSON.stringify(obj));
    const head = new TextEncoder().encode(`HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`);
    const bout = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    bout.setOutputStream(output);
    try { bout.writeByteArray([...head]); bout.writeByteArray([...body]); } catch {}
    try { output.close(); input.close(); } catch {}
  };
  pump.init(input, 0, 0, true);
  pump.asyncRead({
    onStartRequest() {},
    onStopRequest() {},
    onDataAvailable(req, stream, offset, count) {
      bin.setInputStream(stream);
      bytes = bytes.concat(bin.readByteArray(count));
      const text = new TextDecoder().decode(new Uint8Array(bytes));
      const split = text.indexOf("\r\n\r\n");
      if (split < 0) return;
      const head = text.slice(0, split), length = +(head.match(/content-length:\s*(\d+)/i)?.[1] || 0);
      const bodyBytes = new TextEncoder().encode(text.slice(split + 4));
      if (bodyBytes.length < length) return;
      if (Date.now() < syncLockedUntil) return reply("429 Too Many Requests", { error: "Too many wrong codes. Wait a minute." });
      const key = head.match(/x-aquaris-code:\s*(\d+)/i)?.[1];
      if (!key || key !== settings.aquarisSync?.code) {
        if (++syncFails >= 5) { syncFails = 0; syncLockedUntil = Date.now() + 60000; }
        return reply("403 Forbidden", { error: "That pairing code isn't right." });
      }
      syncFails = 0;
      let remote = {};
      try { remote = JSON.parse(text.slice(split + 4)); } catch { return reply("400 Bad Request", { error: "Unreadable" }); }
      syncMerge(remote);
      syncLastSeen = Date.now();
      $("#syncStatus") && ($("#syncStatus").textContent = `Last synced with ${remote.device || "your iPad"} just now`);
      reply("200 OK", { device: "computer", ...syncBundle() });
    }
  });
}
// This computer's address on the home network
async function myAddresses() {
  try {
    const dns = Cc["@mozilla.org/network/dns-service;1"].getService(Ci.nsIDNSService);
    const rec = await new Promise((resolve, reject) => dns.asyncResolve(dns.myHostName, Ci.nsIDNSService.RESOLVE_TYPE_DEFAULT, Ci.nsIDNSService.RESOLVE_DISABLE_IPV6, null,
      { onLookupComplete: (r, record, status) => (Components.isSuccessCode(status) ? resolve(record.QueryInterface(Ci.nsIDNSAddrRecord)) : reject(status)) }, Services.tm.mainThread, {}));
    const out = [];
    while (rec.hasMore()) { const a = rec.getNextAddrAsString(); if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) out.push(a); }
    return out;
  } catch { return []; }
}

// ----- On the iPad: talk to the computer -----
const syncWaits = new Map();
function syncSoon() { syncNow().catch(() => {}); }
async function syncNow() {
  const s = settings.aquarisSync || {};
  if (!inShell || !s.address || !s.code) return;
  const id = "s" + Date.now();
  const body = JSON.stringify({ device: "iPad", ...syncBundle() });
  const reply = await new Promise(resolve => {
    syncWaits.set(id, resolve);
    shell.postMessage({ cmd: "sync", id, url: `http://${s.address}:${SYNC_PORT}/aquaris-sync`, code: s.code, body });
    setTimeout(() => { if (syncWaits.delete(id)) resolve({ ok: false, error: "The computer didn't answer" }); }, 8000);
  });
  const status = $("#syncStatus");
  if (!reply.ok) { if (status) status.textContent = reply.error || "Couldn't reach your computer"; return; }
  let remote = {};
  try { remote = JSON.parse(reply.body); } catch {}
  if (remote.error) { if (status) status.textContent = remote.error; return; }
  const n = syncMerge(remote);
  if (status) status.textContent = `Synced just now${n ? ` (${n} change${n === 1 ? "" : "s"} from your computer)` : ""}`;
}
function shellSyncReply(ev) { const done = syncWaits.get(ev.id); if (done) { syncWaits.delete(ev.id); done(ev); } }
if (inShell) setInterval(() => { if (settings.aquarisSync?.address && document.visibilityState === "visible") syncSoon(); }, 30000);

// ----- The Sync section in Settings -----
function syncSettingsSection() {
  const s = settings.aquarisSync || {};
  if (inChrome) {
    return `<section class="sync-sec"><h3>Sync with your iPad</h3>
      <p class="hint">Your look, wallpaper, notes, apps and desktop go to Aquaris on your iPad and back, over your home Wi-Fi (nothing goes to the internet).</p>
      <label class="row between switch"><span>Let my iPad sync with this computer</span><input type="checkbox" id="syncOn"${s.server ? " checked" : ""}></label>
      <div id="syncPair"${s.server ? "" : " hidden"}><p>On the iPad: Aquaris → Settings → <b>Sync with your computer</b>, then type:</p>
      <div class="sync-codes"><div><small>Computer address</small><b id="syncAddr">…</b></div><div><small>Pairing code</small><b id="syncCode">${s.code || ""}</b></div></div>
      <div class="row"><button class="btn" id="syncNewCode">New code</button><span class="hint" id="syncStatus"></span></div>
      <p class="hint">If Windows asks whether Aeris may use your network, allow it on <b>private</b> networks.</p></div></section>`;
  }
  if (inShell) {
    return `<section class="sync-sec"><h3>Sync with your computer</h3>
      <p class="hint">Your look, wallpaper, notes, apps and desktop sync with Aquaris on your computer over your home Wi-Fi. On the computer: Aquaris → Settings → Sync with your iPad.</p>
      <div class="row between"><span>Computer address</span><input id="syncAddrIn" class="sync-in" inputmode="decimal" placeholder="192.168.1.5" value="${s.address || ""}"></div>
      <div class="row between"><span>Pairing code</span><input id="syncCodeIn" class="sync-in" inputmode="numeric" maxlength="6" placeholder="6 digits" value="${s.code || ""}"></div>
      <div class="row"><button class="btn primary" id="syncGo">Sync now</button><button class="btn" id="syncOff"${s.address ? "" : " hidden"}>Stop syncing</button><span class="hint" id="syncStatus"></span></div></section>`;
  }
  return "";
}
function wireSyncSettings(page) {
  if (inChrome) {
    const show = async () => {
      const on = !!settings.aquarisSync?.server;
      page.querySelector("#syncPair").hidden = !on;
      if (!on) return;
      page.querySelector("#syncCode").textContent = settings.aquarisSync.code;
      const addrs = await myAddresses();
      page.querySelector("#syncAddr").textContent = addrs[0] || "(connect to Wi-Fi)";
      if (syncLastSeen) page.querySelector("#syncStatus").textContent = `Last synced ${ago(syncLastSeen)}`;
    };
    page.querySelector("#syncOn")?.addEventListener("change", async e => {
      const s = { ...(settings.aquarisSync || {}), server: e.target.checked };
      if (!s.code) s.code = newSyncCode();
      await save({ aquarisSync: s });
      e.target.checked ? startSyncServer() : stopSyncServer();
      show();
    });
    page.querySelector("#syncNewCode")?.addEventListener("click", async () => { await save({ aquarisSync: { ...settings.aquarisSync, code: newSyncCode() } }); show(); });
    show();
  }
  if (inShell) {
    page.querySelector("#syncGo")?.addEventListener("click", async () => {
      const address = page.querySelector("#syncAddrIn").value.trim(), code = page.querySelector("#syncCodeIn").value.trim();
      if (!/^[\w.-]+$/.test(address) || !/^\d{6}$/.test(code)) return void (page.querySelector("#syncStatus").textContent = "Type the address and the 6-digit code from your computer.");
      await save({ aquarisSync: { address, code } });
      page.querySelector("#syncOff").hidden = false;
      page.querySelector("#syncStatus").textContent = "Syncing…";
      syncNow();
    });
    page.querySelector("#syncOff")?.addEventListener("click", async () => { await save({ aquarisSync: {} }); page.querySelector("#syncOff").hidden = true; page.querySelector("#syncStatus").textContent = "Not syncing."; });
  }
}

// ----- Start -----
liveReady = () => {
  drawBell();
  paintBadges();
  startSyncServer();
  if (inShell && settings.aquarisSync?.address) setTimeout(syncSoon, 3000);
};
liveShell = (ev, win) => {
  if (ev.type === "media") shellMedia(ev, win);
  if (ev.type === "notify") shellNotify(ev, win);
  if (ev.type === "syncReply") shellSyncReply(ev);
};
