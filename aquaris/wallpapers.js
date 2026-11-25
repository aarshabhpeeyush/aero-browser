// Video wallpapers, and a lock screen with its own wallpaper (a picture, a built-in one, or a video).
// Videos are big, so they're kept in Aquaris's own storage on this device (IndexedDB), one set per
// account, not in the settings file (and they don't sync).

// ----- Storage for big files -----
const mediaDB = {
  db: null,
  open() {
    return (this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open("aquaris-media", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  },
  async put(key, blob) {
    const db = await this.open();
    return new Promise((resolve, reject) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(blob, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  },
  async get(key) {
    const db = await this.open();
    return new Promise(resolve => { const r = db.transaction("files").objectStore("files").get(key); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
  }
};
const mediaKey = name => `${accounts.key()}:${name}`;
const videoUrls = {};   // name → object URL (made once)
async function videoUrl(name) {
  if (videoUrls[name]) return videoUrls[name];
  const blob = await mediaDB.get(mediaKey(name)).catch(() => null);
  return blob ? (videoUrls[name] = URL.createObjectURL(blob)) : null;
}
async function saveVideo(name, file) {
  await mediaDB.put(mediaKey(name), file);
  if (videoUrls[name]) URL.revokeObjectURL(videoUrls[name]);
  delete videoUrls[name];
}

// ----- The desktop's video -----
const wallVideo = html("video", "wall-video");
Object.assign(wallVideo, { muted: true, loop: true, playsInline: true, autoplay: true });
wallVideo.setAttribute("muted", "");
wallVideo.hidden = true;
document.body.prepend(wallVideo);
async function showWallVideo() {
  const on = settings.aquarisWall === "video";
  const url = on ? await videoUrl("wall-video") : null;
  if (!url) { wallVideo.hidden = true; wallVideo.pause(); wallVideo.removeAttribute("src"); return; }
  if (wallVideo.src !== url) wallVideo.src = url;
  wallVideo.hidden = false;
  if (document.visibilityState === "visible") wallVideo.play().catch(() => {});
}
// Pauses while Aquaris is minimised or hidden (no battery spent on a wallpaper nobody sees)
document.addEventListener("visibilitychange", () => {
  for (const v of [wallVideo, $("#lock .lock-video")]) {
    if (!v || v.hidden) continue;
    document.visibilityState === "visible" ? v.play().catch(() => {}) : v.pause();
  }
});

// ----- The lock screen's own wallpaper -----
const LOCK_WALLS = [["same", "Same as desktop"], ["tide", "Tide"], ["dusk", "Dusk"], ["hills", "Aeris hills"], ["aqua", "Aqua"], ["own", "Your picture"], ["video", "Your video"]];
const WALL_PICTURE = { tide: () => document.body.dataset.mode === "dark" ? "walls/tide-dark.svg" : "walls/tide-light.svg", dusk: () => "walls/dusk.svg", hills: () => "../welcome/hero.jpg", aqua: () => "walls/aqua.svg" };
async function dressLock() {
  const l = $("#lock");
  const L = settings.aquarisLock || {};
  const wall = L.wall || "same";
  l.querySelector(".lock-video")?.remove();
  l.classList.toggle("own-wall", wall !== "same");
  l.style.removeProperty("--lock-wall");
  if (wall === "video") {
    const url = await videoUrl("lock-video");
    if (url) {
      const v = html("video", "lock-video");
      Object.assign(v, { muted: true, loop: true, playsInline: true, autoplay: true, src: url });
      v.setAttribute("muted", "");
      l.prepend(v);
      v.play().catch(() => {});
      return;
    }
    l.classList.remove("own-wall");
  } else if (wall === "own" && L.own) l.style.setProperty("--lock-wall", `url("${L.own}")`);
  else if (WALL_PICTURE[wall]) l.style.setProperty("--lock-wall", `url("${WALL_PICTURE[wall]()}")`);
}
// The lock screen re-dresses itself every time it shows
new MutationObserver(() => { if (!$("#lock").hidden) dressLock(); else $("#lock .lock-video")?.pause(); })
  .observe($("#lock"), { attributes: true, attributeFilter: ["hidden"] });

// ----- Settings: "Your video" for the desktop, and the Lock screen section -----
function wallpaperExtrasSection() {
  return `<section><h3>Lock screen</h3>
    <p class="hint">The lock screen can have its own wallpaper, a picture or a video, apart from the desktop.</p>
    <div class="walls lock-walls"></div>
    <input id="lockFile" type="file" accept="image/*" hidden><input id="lockVideoFile" type="file" accept="video/*" hidden>
    <div class="row"><button class="btn" id="lockPreview">Show the lock screen</button></div></section>`;
}
function wireWallpaperExtras(page, sync) {
  // The desktop's "Your video" tile, next to the other wallpapers
  const walls = page.querySelector(".walls:not(.lock-walls)");
  const vt = html("button", "wall w-video");
  vt.dataset.v = "video";
  vt.append(html("span", "", "Your video"));
  const videoFile = Object.assign(html("input"), { type: "file", accept: "video/*", hidden: true });
  page.append(videoFile);
  vt.addEventListener("click", () => videoFile.click());
  videoFile.addEventListener("change", async () => {
    const f = videoFile.files[0];
    if (!f) return;
    await saveVideo("wall-video", f);
    await save({ aquarisWall: "video" });
    showWallVideo();
    sync?.();
  });
  walls.append(vt);
  // The lock screen's choices
  const lw = page.querySelector(".lock-walls");
  const mark = () => lw.querySelectorAll(".wall").forEach(b => b.classList.toggle("on", b.dataset.v === ((settings.aquarisLock || {}).wall || "same")));
  const setLock = async changes => { await save({ aquarisLock: { ...(settings.aquarisLock || {}), ...changes } }); mark(); };
  for (const [id, name] of LOCK_WALLS) {
    const b = html("button", "wall w-" + (id === "same" ? "lock-same" : id));
    b.dataset.v = id;
    b.append(html("span", "", name));
    if (id === "own" && settings.aquarisLock?.own) b.style.backgroundImage = `url("${settings.aquarisLock.own}")`;
    b.addEventListener("click", () => {
      if (id === "own") return page.querySelector("#lockFile").click();
      if (id === "video") return page.querySelector("#lockVideoFile").click();
      setLock({ wall: id });
    });
    lw.append(b);
  }
  page.querySelector("#lockFile").addEventListener("change", e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setLock({ wall: "own", own: r.result }); lw.querySelector(".w-own").style.backgroundImage = `url("${r.result}")`; };
    r.readAsDataURL(f);
  });
  page.querySelector("#lockVideoFile").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    await saveVideo("lock-video", f);
    setLock({ wall: "video" });
  });
  page.querySelector("#lockPreview").addEventListener("click", () => lockScreen());
  mark();
}

// Start, and whenever the look changes
wallpapersReady = () => showWallVideo();
lookHooks.push(() => showWallVideo());
