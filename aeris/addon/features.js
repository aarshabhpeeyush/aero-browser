// Aeris Core features inspired by other browsers (loaded after background.js, sharing its globals):
// focus mode (Orion, Zen), apps in the side panel (Vivaldi, Edge, Floorp), spaces (SigmaOS, Zen),
// napping tabs (Mirror, and Aero's own battery saver), hiding things on websites (Orion's tweaks,
// Arc's boosts) and break reminders (Opera).

const FEATURE_DEFAULTS = { napAfter: 0, breakEvery: 0, spaces: [{ id: "main", name: "Main", icon: "🏠" }], activeSpace: "main" };
const featureSettings = () => browser.storage.local.get(FEATURE_DEFAULTS);

// ================= Focus mode =================

async function toggleFocus() {
  const { focus } = await browser.storage.local.get({ focus: false });
  await browser.storage.local.set({ focus: !focus });
  Sound.click();
}
browser.commands.onCommand.addListener(name => name === "focus-mode" && toggleFocus());
browser.pageAction.onClicked.addListener(toggleFocus);

// ================= Apps in the side panel =================
// The panel shows web apps (Discord, Spotify…) in a frame, and so do Aquaris's app windows. Many
// sites refuse to be shown inside another page, so for frames inside the panel and Aquaris (Aeris's
// own pages, nobody else's) those refusals are taken out.

const FRAME_HOSTS = [browser.runtime.getURL("panel/"), browser.runtime.getURL("aquaris/")];
const ownPage = url => FRAME_HOSTS.some(p => (url || "").startsWith(p));
browser.webRequest.onHeadersReceived.addListener(details => {
  // Frames inside the app count too: sites check every page above them, right up to Aeris's page
  const parent = details.documentUrl || details.originUrl || "";
  if (!ownPage(parent) && !(details.frameAncestors || []).some(f => ownPage(f.url))) return {};
  const responseHeaders = [];
  for (const h of details.responseHeaders) {
    const name = h.name.toLowerCase();
    if (name === "x-frame-options") continue;
    if (name === "content-security-policy" && /frame-ancestors/i.test(h.value)) {
      h.value = h.value.split(";").filter(d => !/^\s*frame-ancestors/i.test(d)).join(";");
    }
    responseHeaders.push(h);
  }
  return { responseHeaders };
}, { urls: ["http://*/*", "https://*/*"], types: ["sub_frame"] }, ["blocking", "responseHeaders"]);

// ================= Spaces =================
// Each space is its own set of tabs; switching hides the other spaces' tabs. A tab remembers its
// space even after a restart.

const tabSpace = async tabId => (await browser.sessions.getTabValue(tabId, "space")) || "main";

async function switchSpace(id) {
  const { spaces } = await featureSettings();
  if (!spaces.some(s => s.id === id)) id = "main";
  await browser.storage.local.set({ activeSpace: id });
  const tabs = await browser.tabs.query({ currentWindow: true });
  const mine = [], others = [];
  for (const t of tabs) ((await tabSpace(t.id)) === id ? mine : others).push(t);
  if (mine.length) {
    await browser.tabs.show(mine.map(t => t.id));
    if (!mine.some(t => t.active)) {
      const last = mine.sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
      await browser.tabs.update(last.id, { active: true });
    }
  } else {
    await browser.tabs.create({}); // gets this space (see onCreated)
  }
  const hide = others.filter(t => !t.pinned).map(t => t.id);
  if (hide.length) await browser.tabs.hide(hide);
  Sound.bloop();
}

async function moveTabToSpace(tabId, id) {
  await browser.sessions.setTabValue(tabId, "space", id);
  const { activeSpace } = await featureSettings();
  if (id !== activeSpace) {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === tabId) {
      // Can't hide the tab you're on: go to its neighbour first
      const visible = (await browser.tabs.query({ currentWindow: true, hidden: false })).filter(t => t.id !== tabId);
      if (visible.length) await browser.tabs.update(visible[0].id, { active: true });
      else await browser.tabs.create({});
    }
    await browser.tabs.hide(tabId);
  }
}

browser.tabs.onCreated.addListener(async tab => {
  const { activeSpace } = await featureSettings();
  browser.sessions.setTabValue(tab.id, "space", activeSpace);
});

// Right-click a tab → Move to space
async function buildSpaceMenu() {
  const { spaces } = await featureSettings();
  await browser.menus.remove("space").catch(() => {});
  browser.menus.create({ id: "space", title: "Move to space", contexts: ["tab"] });
  for (const s of spaces) browser.menus.create({ id: "space:" + s.id, parentId: "space", title: `${s.icon} ${s.name}`, contexts: ["tab"] });
}
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.spaces) buildSpaceMenu();
});
buildSpaceMenu();

// ================= Napping tabs (and memory) =================

async function napTabs() {
  const { napAfter } = await featureSettings();
  if (!napAfter) return;
  const old = Date.now() - napAfter * 60000;
  const tabs = await browser.tabs.query({ active: false, discarded: false, audible: false, pinned: false });
  const sleepy = tabs.filter(t => t.lastAccessed < old && /^https?:/.test(t.url));
  if (sleepy.length) await browser.tabs.discard(sleepy.map(t => t.id));
}

// ================= Hide things on websites =================

browser.menus.create({ id: "zap", title: "Hide this on the website", contexts: ["page", "image", "link", "video", "frame"], documentUrlPatterns: ["http://*/*", "https://*/*"] });

// ================= Break reminders =================

async function scheduleBreak() {
  const { breakEvery } = await featureSettings();
  await browser.alarms.clear("break");
  if (breakEvery) browser.alarms.create("break", { delayInMinutes: breakEvery, periodInMinutes: breakEvery });
}
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.breakEvery) scheduleBreak();
});

// ================= Shared listeners =================

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "zap") {
    browser.tabs.sendMessage(tab.id, { type: "zap", targetElementId: info.targetElementId }, { frameId: info.frameId });
  } else if (String(info.menuItemId).startsWith("space:")) {
    moveTabToSpace(tab.id, info.menuItemId.slice(6));
  }
});

browser.alarms.onAlarm.addListener(async a => {
  if (a.name === "nap") napTabs();
  if (a.name === "break") {
    const { breakEvery } = await featureSettings();
    browser.notifications.create("break", {
      type: "basic",
      iconUrl: "icons/aeris-128.png",
      title: "Time for a break 🌿",
      message: `You've been browsing for ${breakEvery} minutes. Stretch, have some water and look at something far away for a bit.`
    });
  }
});

browser.runtime.onMessage.addListener(msg => {
  if (msg?.type === "switch-space") return switchSpace(msg.id);
  if (msg?.type === "move-tab") return moveTabToSpace(msg.tabId, msg.id);
  if (msg?.type === "space-of") return tabSpace(msg.tabId);
  if (msg?.type === "toggle-focus") return toggleFocus();
});

(async () => {
  browser.alarms.create("nap", { periodInMinutes: 1 });
  scheduleBreak();
  // After a restart, show only the space you were in
  const { activeSpace } = await featureSettings();
  if (activeSpace !== "main") switchSpace(activeSpace);
})();
