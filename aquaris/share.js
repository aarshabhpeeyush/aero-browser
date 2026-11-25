// AquaDrop (send links, text and files between your computer and your iPad) and "Continue where
// you left off". Both ride on Sync: the iPad talks to the computer every 30 seconds (and straight
// away when you send something), and every sync carries what's waiting to be sent and what each
// side is looking at right now. Nothing goes through the internet, only your home Wi-Fi.

const DROP_MAX = 8 * 1024 * 1024;   // biggest file (8 MB): it travels inside a sync
const dropOut = [];                 // waiting to go to the other device
const dropSeen = [];                // ids already received (so nothing arrives twice)
let dropPeerName = "", remoteActivity = null, handoffHidden = "";

// Is there another device to send to, and what's it called
const dropPeer = () => inShell ? !!settings.aquarisSync?.address : inChrome && !!settings.aquarisSync?.server;
const peerLabel = () => dropPeerName || (inShell ? "your computer" : "your iPad");
const shortPeer = () => (inShell ? "computer" : "iPad");

// ----- Sending -----
function sendDrop(item) {
  if (!dropPeer()) { toast({ title: "AquaDrop", body: inShell ? "Pair with your computer first (Settings → Sync)." : "Turn on Sync with your iPad first (Settings → Sync)." }); return false; }
  const d = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: Date.now(), ...item };
  dropOut.push(d);
  remember({ ...d, data: undefined, dir: "out" });
  toast({ app: "aquadrop", title: "AquaDrop", body: inShell ? `Sending to ${peerLabel()}…` : `${peerLabel()[0].toUpperCase() + peerLabel().slice(1)} gets it the next time it syncs (within half a minute).` });
  if (inShell) syncSoon();
  return true;
}
const sendLink = (url, title = "") => /^https?:/i.test(url || "") && sendDrop({ kind: "link", url, title: title || hostOf(url) });
const sendText = text => text && sendDrop({ kind: "text", text: String(text).slice(0, 100000) });
function sendFile(file) {
  if (file.size > DROP_MAX) { toast({ title: "AquaDrop", body: `“${file.name}” is too big (the most is 8 MB).` }); return; }
  const r = new FileReader();
  r.onload = () => sendDrop({ kind: "file", name: file.name, type: file.type || "application/octet-stream", size: file.size, data: String(r.result).split(",")[1] || "" });
  r.readAsDataURL(file);
}

// The list in AquaDrop: what came in and what went out (no file contents, just names)
function remember(d) {
  settings.aquarisDrops = [d, ...(settings.aquarisDrops || []).filter(x => x.id !== d.id)].slice(0, 40);
  store.set({ aquarisDrops: settings.aquarisDrops });
  wins.filter(w => w.app.id === "aquadrop").forEach(w => w.drawDrops?.());
}

// ----- Receiving -----
async function receiveDrop(d) {
  if (!d?.id || dropSeen.includes(d.id)) return;
  dropSeen.push(d.id);
  while (dropSeen.length > 100) dropSeen.shift();
  const keep = { ...d, data: undefined, dir: "in" };
  if (d.kind === "file" && d.data) {
    if (inChrome) {
      try {
        const dir = dropFolder();
        await IOUtils.makeDirectory(dir, { createAncestors: true });
        let path = PathUtils.join(dir, d.name.replace(/[\\/:*?"<>|]/g, "-") || "AquaDrop file");
        for (let n = 2; await IOUtils.exists(path); n++) path = PathUtils.join(dir, d.name.replace(/(\.[^.]*)?$/, ` (${n})$1`));
        await IOUtils.write(path, Uint8Array.from(atob(d.data), c => c.charCodeAt(0)));
        keep.path = path;
      } catch (e) { console.error("AquaDrop:", e); }
    } else {
      await mediaDB.put("drop:" + d.id, new Blob([Uint8Array.from(atob(d.data), c => c.charCodeAt(0))], { type: d.type })).catch(() => {});
    }
  }
  remember(keep);
  const what = d.kind === "link" ? d.title || hostOf(d.url) : d.kind === "text" ? `“${d.text.slice(0, 60)}”` : d.name;
  notify({ app: "aquadrop", title: `AquaDrop from ${peerLabel()}`, body: what, from: "aquadrop" });
}
function dropFolder() {
  let down;
  try { down = Services.dirsvc.get("DfltDwnld", Ci.nsIFile).path; } catch { down = PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, "Downloads"); }
  return PathUtils.join(down, "AquaDrop");
}
// Open whatever arrived
async function openDrop(d) {
  if (d.kind === "link") return continueAt({ url: d.url, title: d.title });
  if (d.kind === "text") return void (inChrome ? clipboard(d.text) : navigator.clipboard?.writeText(d.text).catch(() => {}), toast({ title: "AquaDrop", body: "Copied. Paste it anywhere." }));
  if (inChrome && d.path) { try { const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); f.initWithPath(d.path); f.launch(); } catch { revealDrop(d); } return; }
  const blob = await mediaDB.get("drop:" + d.id).catch(() => null);
  if (!blob) return toast({ title: "AquaDrop", body: "That file isn't on this device any more." });
  if (inShell) {
    // Save it to Files or Photos, or open it in another app (the iPad's share sheet)
    const data = await new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",")[1]); f.readAsDataURL(blob); });
    return shell.postMessage({ cmd: "share", name: d.name, data });
  }
  const a = Object.assign(html("a"), { href: URL.createObjectURL(blob), download: d.name });
  a.click();
}
function revealDrop(d) { try { const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); f.initWithPath(d.path); f.reveal(); } catch {} }

// ----- Continue where you left off -----
let myActivity = null;
function currentActivity() {
  const w = activeWin();
  const url = w?.view && (w.kind === "app" || w.app.browser) ? viewUrl(w.view) : "";
  if (!/^https?:/i.test(url)) return myActivity;
  const using = document.visibilityState === "visible" && (inShell || document.hasFocus());
  if (!myActivity || myActivity.url !== url || using) myActivity = { url, title: viewTitle(w.view) || w.app.name, app: w.app.id, name: w.app.name, at: Date.now() };
  return myActivity;
}
// Open a page: in its own app if you have one, otherwise in Aeris
function continueAt(a) {
  const app = (a.app && appById(a.app)?.url && appById(a.app)) || appForUrl(a.url);
  if (app && app.id !== "aeris") {
    const w = openApp(app);
    const view = w?.view || wins.find(x => x.app.id === app.id)?.view;
    if (view && viewUrl(view) !== a.url) setTimeout(() => loadView(view, a.url), 250);
    return;
  }
  openInAeris([a.url]);
}
const openHere = url => wins.some(w => w.view && viewUrl(w.view) === url);
function drawHandoff() {
  let card = $("#handoff");
  const a = remoteActivity;
  const show = a && Date.now() - a.at < 15 * 60000 && a.url !== handoffHidden && !openHere(a.url);
  if (!show) { card?.remove(); return; }
  if (!card) {
    card = html("div", "handoff");
    card.id = "handoff";
    document.body.append(card);
  }
  card.textContent = "";
  const app = appById(a.app) || appForUrl(a.url) || { name: hostOf(a.url), color: "#5b6b82", ui: "globe" };
  const text = html("div", "handoff-text");
  text.append(html("small", "", `Continue from ${peerLabel()}`), html("b", "", a.title || a.name || hostOf(a.url)));
  const go = html("button", "btn primary", "Open");
  go.addEventListener("click", () => { continueAt(a); handoffHidden = a.url; card.remove(); });
  const x = html("button", "handoff-x");
  setHTML(x, icon("close"));
  x.title = "Not now";
  x.addEventListener("click", () => { handoffHidden = a.url; card.remove(); });
  card.append(tile(app, "small"), text, go, x);
}
setInterval(drawHandoff, 20000);

// ----- Riding on Sync -----
syncOut.push(() => ({ drops: dropOut.slice(), dropAck: dropSeen.slice(-50), activity: currentActivity() }));
syncIn.push(remote => {
  if (remote.device) dropPeerName = remote.device === "iPad" ? "your iPad" : remote.device === "computer" ? "your computer" : remote.device;
  // What the other side says it got can leave the outbox
  for (const id of remote.dropAck || []) { const i = dropOut.findIndex(d => d.id === id); if (i >= 0) dropOut.splice(i, 1); }
  for (const d of remote.drops || []) receiveDrop(d);
  if (remote.activity?.url && remote.activity.url !== remoteActivity?.url) handoffHidden = "";
  if (remote.activity) remoteActivity = remote.activity;
  drawHandoff();
});
// A file is slow to send: give the iPad's sync more time when one is waiting
syncTimeout = () => (dropOut.some(d => d.kind === "file") ? 60000 : 8000);

// ----- Spotlight: "Continue" at the top, and send what you typed -----
spotlightHooks.unshift(q => {
  const a = remoteActivity, out = [];
  if (a && Date.now() - a.at < 60 * 60000 && (!q || (a.title + " " + a.url).toLowerCase().includes(q.toLowerCase())))
    out.push([`Continue from ${peerLabel()}`, [{ app: appById(a.app) || appForUrl(a.url) || { id: "web", ui: "globe", color: "#5b6b82" }, title: a.title || hostOf(a.url), kind: hostOf(a.url), go: () => continueAt(a) }]]);
  if (q && dropPeer() && q.length > 1) out.push(["AquaDrop", [{ app: anyApp("aquadrop") || { id: "aquadrop", ui: "up", color: "#14b8a6" }, title: `Send “${q.length > 40 ? q.slice(0, 40) + "…" : q}” to ${peerLabel()}`, kind: /^https?:\/\//i.test(q) ? "Link" : "Text", go: () => (/^https?:\/\/\S+$/i.test(q) ? sendLink(q) : sendText(q)) }]]);
  return out;
});

// ----- Right-click: "Send to iPad" on links, pages and app windows -----
pageMenuHooks.push((items, c, view) => {
  if (!dropPeer()) return;
  const to = `Send to ${shortPeer()}`;
  if (c.onLink && c.linkURL) items.push([`${to} (link)`, () => sendLink(c.linkURL, c.linkTextContent || "")]);
  else if (!c.onImage && !c.onEditable) items.push([`${to} (this page)`, () => sendLink(viewUrl(view), viewTitle(view))]);
});
appMenuHooks.push((items, app, win) => {
  if (!dropPeer() || !win?.view) return;
  const url = viewUrl(win.view);
  if (/^https?:/i.test(url)) items.push([`Send page to ${shortPeer()}`, () => sendLink(url, viewTitle(win.view))]);
});

// ----- The AquaDrop app -----
function buildAquaDrop(page, win) {
  setHTML(page, `<div class="aquadrop">
    <div class="ad-hero">${icon("up")}<div><b>AquaDrop</b><p class="hint ad-peer"></p></div></div>
    <textarea class="ad-text" placeholder="Type or paste a link or some text to send"></textarea>
    <div class="row"><button class="btn primary ad-send">Send</button><button class="btn ad-file">Send a file…</button><span class="hint ad-pages"></span></div>
    <input type="file" class="ad-pick" multiple hidden>
    <div class="ad-open"></div>
    <h3>Sent and received</h3>
    <div class="ad-list"></div></div>`);
  const $p = s => page.querySelector(s);
  const peerLine = () => ($p(".ad-peer").textContent = dropPeer()
    ? `Paired with ${peerLabel()}. ${inShell ? "Things you send arrive in a few seconds." : "Your iPad picks things up within half a minute."}`
    : inShell ? "Not paired yet. In Settings → Sync with your computer, type the address and code your computer shows." : "Not paired yet. Turn on Settings → Sync with your iPad, then pair the iPad.");
  peerLine();
  $p(".ad-send").addEventListener("click", () => {
    const v = $p(".ad-text").value.trim();
    if (!v) return;
    if (/^https?:\/\/\S+$/i.test(v) ? sendLink(v) : sendText(v)) $p(".ad-text").value = "";
  });
  $p(".ad-file").addEventListener("click", () => $p(".ad-pick").click());
  $p(".ad-pick").addEventListener("change", e => { for (const f of e.target.files) sendFile(f); e.target.value = ""; });
  // Quick buttons: the pages open in your other windows
  const pages = $p(".ad-open");
  const drawPages = () => {
    pages.textContent = "";
    for (const w of wins.filter(w => w !== win && w.view && /^https?:/.test(viewUrl(w.view)))) {
      const b = html("button", "ad-page");
      b.append(tile(w.app, "small"), html("span", "", `Send ${viewTitle(w.view) || w.app.name}`));
      b.addEventListener("click", () => sendLink(viewUrl(w.view), viewTitle(w.view)));
      pages.append(b);
    }
  };
  drawPages();
  win.drawDrops = () => {
    peerLine();
    drawPages();
    const list = $p(".ad-list");
    list.textContent = "";
    const all = settings.aquarisDrops || [];
    if (!all.length) list.append(html("p", "hint", "Nothing yet. Things you send or get show up here."));
    for (const d of all) {
      const row = html("div", "ad-item " + d.dir);
      const what = d.kind === "link" ? d.title || d.url : d.kind === "text" ? d.text : d.name;
      const text = html("div", "ad-what");
      text.append(html("b", "", what), html("small", "", `${d.dir === "in" ? "From" : "To"} ${peerLabel()} · ${ago(d.at)}${d.kind === "file" && d.size ? ` · ${Math.ceil(d.size / 1024)} KB` : ""}`));
      row.append(html("span", "ad-dir", d.dir === "in" ? "↓" : "↑"), text);
      if (d.dir === "in" || d.kind !== "file") {
        const open = html("button", "btn", d.kind === "link" ? "Open" : d.kind === "text" ? "Copy" : inShell ? "Save…" : "Open");
        open.addEventListener("click", () => openDrop(d));
        row.append(open);
      }
      if (d.dir === "in" && d.path && inChrome) {
        const show = html("button", "btn", "Show in folder");
        show.addEventListener("click", () => revealDrop(d));
        row.append(show);
      }
      list.append(row);
    }
  };
  win.drawDrops();
  // Drop files straight onto the window
  page.addEventListener("dragover", e => e.preventDefault());
  page.addEventListener("drop", e => { e.preventDefault(); for (const f of e.dataTransfer?.files || []) sendFile(f); });
}
ownBuilders.aquadrop = buildAquaDrop;

// A look inside, for Aquaris's own tests (only chrome code can reach window.Aquaris)
window.Aquaris.state = () => ({ settings, wins, sendLink, sendText });
