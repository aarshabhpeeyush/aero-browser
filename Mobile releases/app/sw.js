// Keeps a copy of the app on the phone so it opens even without internet.
// Change VERSION whenever you update the app so phones fetch the new files.
const VERSION = "aeris-mobile-1";
const FILES = [
  "./", "index.html", "newtab.css", "mobile.css", "shared.js", "newtab.js", "manifest.webmanifest",
  "aeris.js", "aeris-colors.js", "themes/index.json",
  "welcome/", "welcome/index.html", "welcome/welcome.css", "welcome/welcome.js", "welcome/hero.jpg",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Our own files: use the internet copy when online (so updates show up), the saved copy when offline.
// Other sites (weather, YouTube, icons) are left alone.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
