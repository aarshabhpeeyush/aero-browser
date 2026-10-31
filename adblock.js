// Aero Browser — the built-in ad blocker.
// Uses Ghostery's open-source blocker with the same filter lists as uBlock Origin (EasyList,
// EasyPrivacy and friends). The lists are downloaded once and cached in the browser's data folder.

const fs = require("fs");
const path = require("path");
const { app, ipcMain } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

// Filter-list rules that break websites, switched off with exceptions:
// - Hiding ad Shorts leaves an invisible slot in YouTube's Shorts feed that the scroll wheel gets
//   stuck on. (Every other YouTube ad rule stays on.)
const EXCEPTIONS = [
  "youtube.com#@##shorts-inner-container > .ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer)"
];

// Pages where the blocker only stops ad downloads and doesn't hide anything on the page,
// because hiding (CSS rules and scripts) breaks them. YouTube Shorts wouldn't scroll with it on.
const SKIP_HIDING = [/^https:\/\/(www\.|m\.)?youtube\.com\/shorts(\/|$|\?)/];
const skipHiding = url => SKIP_HIDING.some(pattern => pattern.test(url || ""));

const BLOCKER_CHANNELS =["@ghostery/adblocker/inject-cosmetic-filters", "@ghostery/adblocker/is-mutation-observer-enabled"];

// The blocker library is written for newer Electron versions (registerPreloadScript arrived in
// Electron 35). Our Electron has setPreloads, which does the same job, so give it a stand-in.
function addPreloadSupport(ses) {
  if (typeof ses.registerPreloadScript === "function") return;
  ses.registerPreloadScript = ({ filePath }) => {
    if (!ses.getPreloads().includes(filePath)) ses.setPreloads([...ses.getPreloads(), filePath]);
    return filePath;
  };
  ses.unregisterPreloadScript = filePath => ses.setPreloads(ses.getPreloads().filter(p => p !== filePath));
}

function setupAdblock({ enabled, onBlocked }) {
  let blocker = null;
  let on = enabled;
  const sessions = new Map(); // session -> is blocking switched on there

  function apply(ses) {
    if (!blocker) return;
    const isOn = sessions.get(ses);
    addPreloadSupport(ses);
    try {
      if (on && !isOn) {
        // The library registers the same message handlers for every session it's switched on
        // in, which Electron only allows once, so clear the previous ones first.
        BLOCKER_CHANNELS.forEach(channel => ipcMain.removeHandler(channel));
        blocker.enableBlockingInSession(ses);
      }
      if (!on && isOn) blocker.disableBlockingInSession(ses);
    } catch {
      return; // never let the ad blocker break browsing
    }
    sessions.set(ses, on);
  }

  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path: path.join(app.getPath("userData"), "adblock-engine.bin"),
    read: fs.promises.readFile,
    write: fs.promises.writeFile
  })
    .then(b => {
      blocker = b;
      blocker.updateFromDiff({ added: EXCEPTIONS });
      // On pages where hiding things breaks the site (see SKIP_HIDING), only block ad downloads.
      const injectHiding = blocker.onInjectCosmeticFilters;
      blocker.onInjectCosmeticFilters = (event, url, msg) => (skipHiding(url) ? undefined : injectHiding(event, url, msg));
      blocker.on("request-blocked", request => onBlocked(request.tabId));
      for (const ses of sessions.keys()) apply(ses);
    })
    .catch(() => {}); // no internet the first time: the browser just runs without blocking

  return {
    addSession(ses) {
      if (!sessions.has(ses)) sessions.set(ses, false);
      apply(ses);
    },
    setEnabled(value) {
      on = value;
      for (const ses of sessions.keys()) apply(ses);
    }
  };
}

module.exports = { setupAdblock, skipHiding };
