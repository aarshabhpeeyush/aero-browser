// The web version's offline copy: Aquaris itself keeps working without internet
// (the apps that are websites still need it). A new version replaces the old copy.
const VERSION = "aquaris-web-4";
const FILES = ["./", "index.html", "aquaris.js", "apps.js", "aquaris.css", "aqua.css", "skins.css", "skins-retro.css", "minimal.css", "icon-256.png", "manifest.webmanifest",
  "walls/tide-light.svg", "walls/tide-dark.svg", "walls/dusk.svg", "walls/aqua.svg", "walls/waves.svg", "walls/aero-shine.svg", "walls/woodland.svg", "walls/metro-tiles.svg", "walls/neon-grid.svg", "walls/green-hill.svg", "../themes/index.json", "../icons/aeris-128.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(FILES.map(f => c.add(f)))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Aquaris's own files: the newest from the internet, or the saved copy when offline
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
