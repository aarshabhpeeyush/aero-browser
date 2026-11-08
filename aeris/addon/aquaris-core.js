// Aquaris, from Aeris Core's side (loaded after background.js, features.js and vivaldi.js).
// Aquaris is its own app (see the Aquaris part of api/parent.js): Aeris started with a profile
// called Aquaris opens the Aquaris desktop as its own window. Normal Aeris is still its own app;
// windows that Aquaris opens in it follow Aquaris (minimise, restore, close).
// In normal Aeris, "Open Aquaris" (Quick Commands, the Customize panel) starts the Aquaris app.

async function openAquaris() {
  if (await browser.aeris.aquarisMode()) return browser.aeris.startAquaris();
  await browser.aeris.launchAquaris();
  Sound.bloop();
}

browser.runtime.onMessage.addListener(msg => {
  if (msg?.type === "open-aquaris") return openAquaris();
});

(async () => {
  if (!(await browser.aeris.aquarisMode())) return browser.aeris.watchAquarisLinks();
  // Aquaris has its own welcome; Aeris's tour isn't needed in this profile
  await browser.storage.local.set({ toured: 3 });
  await browser.aeris.startAquaris();
})();
