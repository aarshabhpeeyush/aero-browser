// Aeris Core features loved in Vivaldi (loaded after background.js and features.js, sharing their
// globals): Quick Commands' extra commands, mouse gestures, page filters and the theme schedule.

// ================= Quick Commands (F2) =================
// The box itself is drawn by the privileged API (api/parent.js); these are the commands only Aeris
// Core can carry out: themes, spaces, page filters and the rest.

async function quickCommandExtras() {
  const { spaces } = await featureSettings();
  const extras = [
    ...Object.entries(COLOR_THEMES).map(([id, t]) => ({ title: `Theme: ${t.name}`, command: `theme:${id}` })),
    { title: "Theme: Minimal", command: "theme:minimal" },
    { title: "Theme: Your own look", command: "theme:studio" },
    { title: "Theme: Firefox look", command: "theme:firefox" },
    ...THEMES.map(t => ({ title: `Custom theme: ${t.name}`, command: `custom:${t.id}` })),
    { title: "Custom theme: none", command: "custom:" },
    ...spaces.map(s => ({ title: `Space: ${s.icon} ${s.name}`, command: `space:${s.id}` })),
    ...Object.entries(PAGE_FILTERS).map(([id, f]) => ({ title: `Page filter: ${f.name}`, command: `filter:${id}` })),
    { title: "Page filters off", command: "filter:off" }
  ];
  return extras;
}
browser.commands.onCommand.addListener(async name => {
  if (name === "quick-commands") browser.aeris.openQuickCommands(await quickCommandExtras());
  if (name === "copy-link") copyLink();
});

// Copy the page's link (Ctrl+Shift+C, like Zen), with a little "Link copied" bubble on the page
async function copyLink() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  await navigator.clipboard.writeText(tab.url);
  browser.tabs.sendMessage(tab.id, { type: "toast", text: "🔗 Link copied" }).catch(() => {});
  Sound.pop();
}

browser.aeris.onCommand.addListener(async command => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const [kind, arg] = command.split(/:(.*)/s);
  if (kind === "focus") return toggleFocus();
  if (kind === "notes") return browser.storage.local.set({ panelView: "notes" });
  if (kind === "studio") return browser.tabs.create({ url: browser.runtime.getURL("studio/index.html") });
  if (kind === "store") return browser.tabs.create({ url: browser.runtime.getURL("settings/index.html") });
  if (kind === "save-tabs") return saveAllTabsForLater(true);
  if (kind === "copy-link") return copyLink();
  if (kind === "clip-page" && tab && /^https?:/.test(tab.url)) return addToNotes(`${tab.title}\n${tab.url}\n`);
  if (kind === "theme") return browser.storage.local.set({ colorTheme: arg, accent: null });
  if (kind === "custom") {
    const { colorTheme } = await browser.storage.local.get({ colorTheme: "frost" });
    const plain = ["minimal", "firefox", "studio"].includes(colorTheme);
    return browser.storage.local.set({ theme: arg || null, ...(plain && arg ? { colorTheme: "aqua" } : {}) });
  }
  if (kind === "space") return switchSpace(arg);
  if (kind === "aquaris") return openAquaris();
  if (kind === "filter" && tab) return arg === "off" ? setPageFilters(tab.id, []) : togglePageFilter(tab.id, arg);
});

// Shared with the panel's buttons
async function addToNotes(text) {
  const { notes, currentNote } = await browser.storage.local.get({ notes: [], currentNote: null });
  let note = notes.find(n => n.id === currentNote);
  if (!note) {
    note = { id: crypto.randomUUID(), text: "", updated: 0 };
    notes.push(note);
  }
  note.text = (note.text.trimEnd() ? note.text.trimEnd() + "\n\n" : "") + text;
  note.updated = Date.now();
  await browser.storage.local.set({ notes, currentNote: note.id, panelView: "notes" });
  Sound.bloop();
}

async function saveAllTabsForLater(close) {
  const tabs = (await browser.tabs.query({ currentWindow: true, hidden: false, pinned: false })).filter(t => /^https?:/.test(t.url));
  if (!tabs.length) return;
  let [root] = (await browser.bookmarks.search({ title: "Saved for later" })).filter(b => !b.url);
  root ||= await browser.bookmarks.create({ parentId: "unfiled_____", title: "Saved for later" });
  const name = new Date().toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const folder = await browser.bookmarks.create({ parentId: root.id, title: `${name} (${tabs.length} tab${tabs.length === 1 ? "" : "s"})` });
  for (const t of tabs) await browser.bookmarks.create({ parentId: folder.id, title: t.title, url: t.url });
  if (close) {
    await browser.tabs.create({});
    await browser.tabs.remove(tabs.map(t => t.id));
  }
}

// ================= Mouse gestures =================
// content/gestures.js watches for right-button drags and sends the gesture here.

const GESTURES = {
  L: { name: "Back", run: tab => browser.tabs.goBack(tab.id) },
  R: { name: "Forward", run: tab => browser.tabs.goForward(tab.id) },
  UD: { name: "Reload", run: tab => browser.tabs.reload(tab.id) },
  D: { name: "New tab", run: tab => browser.tabs.create({ index: tab.index + 1 }) },
  DR: { name: "Close tab", run: tab => browser.tabs.remove(tab.id) },
  U: { name: "Reopen closed tab", run: () => browser.sessions.restore() },
  RL: { name: "Reload", run: tab => browser.tabs.reload(tab.id) },
  UL: { name: "Previous tab", run: tab => switchTabBy(tab, -1) },
  UR: { name: "Next tab", run: tab => switchTabBy(tab, 1) }
};
async function switchTabBy(tab, step) {
  const tabs = await browser.tabs.query({ windowId: tab.windowId, hidden: false });
  const at = tabs.findIndex(t => t.id === tab.id);
  const next = tabs[(at + step + tabs.length) % tabs.length];
  if (next) browser.tabs.update(next.id, { active: true });
}

// ================= Page filters (Vivaldi's page actions) =================
// Looks for just the tab you're on. They stay on while you browse in that tab.

const PAGE_FILTERS = {
  grayscale: { name: "Grayscale", filter: "grayscale(1)" },
  dark: { name: "Dark (inverted)", filter: "invert(0.92) hue-rotate(180deg)",
    css: "img, video, picture, canvas, iframe, svg image, [style*='background-image'] { filter: invert(1) hue-rotate(180deg) !important; }" },
  sepia: { name: "Sepia", filter: "sepia(0.75)" },
  contrast: { name: "High contrast", filter: "contrast(1.4)" },
  noimages: { name: "No images", css: "img, picture, video, [style*='background-image'] { visibility: hidden !important; }" },
  readable: { name: "Readable font", css: "body, body *:not(code):not(pre):not(kbd) { font-family: Georgia, 'Palatino Linotype', serif !important; line-height: 1.7 !important; }" }
};
const pageFilters = new Map(); // tabId -> { list: [ids], code: inserted CSS }

function filterCss(list) {
  const filters = list.map(id => PAGE_FILTERS[id]?.filter).filter(Boolean);
  const parts = list.map(id => PAGE_FILTERS[id]?.css).filter(Boolean);
  if (filters.length) parts.unshift(`html { filter: ${filters.join(" ")} !important; }`);
  return parts.join("\n");
}

async function setPageFilters(tabId, list) {
  const old = pageFilters.get(tabId);
  if (old?.code) await browser.tabs.removeCSS(tabId, { code: old.code, allFrames: true }).catch(() => {});
  if (!list.length) {
    pageFilters.delete(tabId);
    return [];
  }
  const code = filterCss(list);
  await browser.tabs.insertCSS(tabId, { code, allFrames: true, cssOrigin: "user", runAt: "document_start" }).catch(() => {});
  pageFilters.set(tabId, { list, code });
  return list;
}
function togglePageFilter(tabId, id) {
  const list = pageFilters.get(tabId)?.list || [];
  return setPageFilters(tabId, list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
}
// Keep a tab's filters while it goes to other pages
browser.webNavigation.onCommitted.addListener(d => {
  const f = d.frameId === 0 && pageFilters.get(d.tabId);
  if (f) browser.tabs.insertCSS(d.tabId, { code: f.code, allFrames: true, cssOrigin: "user", runAt: "document_start" }).catch(() => {});
});
browser.tabs.onRemoved.addListener(id => pageFilters.delete(id));

// ================= Theme schedule =================
// A day look and a night look, switched by time of day or by Windows' light/dark mode (like Vivaldi).
// It only switches when day turns to night (or back), so you can still change looks by hand.

const SCHEDULE_DEFAULTS = { on: false, mode: "time", dayAt: "07:00", nightAt: "19:00", day: null, night: null, last: null };
const darkMode = matchMedia("(prefers-color-scheme: dark)");

function partOfDay(sch) {
  if (sch.mode === "system") return darkMode.matches ? "night" : "day";
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const day = toMins(sch.dayAt), night = toMins(sch.nightAt);
  const isDay = day < night ? mins >= day && mins < night : mins >= day || mins < night;
  return isDay ? "day" : "night";
}

async function checkSchedule(force = false) {
  const { schedule } = await browser.storage.local.get({ schedule: SCHEDULE_DEFAULTS });
  const sch = { ...SCHEDULE_DEFAULTS, ...schedule };
  if (!sch.on) return;
  const part = partOfDay(sch);
  if (part === sch.last && !force) return;
  const look = sch[part];
  await browser.storage.local.set({ schedule: { ...sch, last: part }, ...(look ? { colorTheme: look.colorTheme, theme: look.theme ?? null } : {}) });
}
darkMode.addEventListener("change", () => checkSchedule());
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.schedule) return;
  const { oldValue = {}, newValue = {} } = changes.schedule;
  // Switched on, or the times or mode changed: apply now
  if (newValue.on && (!oldValue.on || oldValue.mode !== newValue.mode || oldValue.dayAt !== newValue.dayAt || oldValue.nightAt !== newValue.nightAt)) checkSchedule(true);
});

// ================= Messages and timers =================

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "gesture") {
    const g = GESTURES[msg.gesture];
    if (g && sender.tab) {
      g.run(sender.tab);
      Sound.click();
    }
    return Promise.resolve(g?.name || null);
  }
  if (msg?.type === "page-filters") return Promise.resolve(pageFilters.get(msg.tabId)?.list || []);
  if (msg?.type === "toggle-filter") return togglePageFilter(msg.tabId, msg.filter);
  if (msg?.type === "filter-names") return Promise.resolve(Object.fromEntries(Object.entries(PAGE_FILTERS).map(([id, f]) => [id, f.name])));
  if (msg?.type === "gesture-names") return Promise.resolve(Object.fromEntries(Object.entries(GESTURES).map(([g, x]) => [g, x.name])));
  if (msg?.type === "save-tabs") return saveAllTabsForLater(msg.close);
  if (msg?.type === "quick-command-extras") return quickCommandExtras();
});

browser.alarms.onAlarm.addListener(a => a.name === "schedule" && checkSchedule());
browser.alarms.create("schedule", { periodInMinutes: 1 });
checkSchedule();
