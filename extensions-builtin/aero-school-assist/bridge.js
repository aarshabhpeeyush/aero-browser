// School Assist, part 2 (runs next to the 21K School page, with access to School Assist's storage).
// - Keeps the data the school pages load (passed on by hook.js) in School Assist's storage.
// - When you press Refresh in School Assist, it visits the same pages you would (home, inbox,
//   calendar, each class) so they load fresh data. READ-ONLY: it only changes which page is
//   showing. It never clicks buttons, submits work or replies to anyone.

const store = chrome.storage.local;
let raw = null;
const ready = store.get(["raw"]).then(r => (raw = r.raw || {}));
let saveTimer = null;
const saveSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set({ raw }), 300);
};
const waiters = [];
const seen = {}; // which kinds of data arrived on this page, and when

// ---------- Keeping what the pages load ----------
window.addEventListener("message", async e => {
  if (e.source !== window || e.data?.source !== "school-assist") return;
  const { url, data } = e.data;
  await ready;
  const part = (url.match(/\/api\?\/([a-z_]+\/(?:[a-z_]+\/)?)/i) || [])[1] || "";
  if (part.startsWith("notifications/")) raw.notifications = data;
  else if (part.startsWith("overview/basic/")) { if (data?.workspaces) raw.overview = { workspaces: data.workspaces }; }
  else if (part.startsWith("messages/box/")) { if (data?.items) raw.inbox = data.items; }
  else if (part.startsWith("calendar/get_events/")) {
    raw.events = raw.events || {};
    for (const ev of Array.isArray(data) ? data : []) raw.events[`${ev.type}-${ev.id || ev.event_id}-${ev.start_time || ev.start}`] = ev;
    // Forget events more than two months old.
    const cutoff = Date.now() - 62 * 86400000;
    for (const [k, ev] of Object.entries(raw.events)) if (new Date(String(ev.end_time || ev.end || ev.start).replace(" ", "T")) < cutoff) delete raw.events[k];
  } else {
    const group = url.match(/\/api\?\/groups\/([^/&?]+)\//);
    if (group && data?.assignments) {
      raw.groups = raw.groups || {};
      raw.groups[group[1]] = { assignments: data.assignments };
    }
  }
  raw.fetchedAt = new Date().toISOString();
  saveSoon();
  seen[part] = Date.now();
  for (const w of [...waiters]) if (url.includes("/api?/" + w.fragment)) w.resolve();
});

// Your name and attendance are shown on the portal page.
function readPortal() {
  const text = document.querySelector("main")?.innerText || "";
  const att = text.match(/attendance\s+(\d+)\s*\/\s*(\d+)/i);
  const name = (text.match(/Good \w+ (.+)/) || [])[1]?.trim();
  if (!att && !name) return;
  raw.student = { name: name || raw.student?.name || "", attendance: att ? { attended: +att[1], total: +att[2] } : raw.student?.attendance || null };
  saveSoon();
}
const portalCheck = () => /^#portal/.test(location.hash) && setTimeout(() => ready.then(readPortal), 2500);
addEventListener("hashchange", portalCheck);
addEventListener("DOMContentLoaded", portalCheck);

// ---------- Refresh: visit the pages so they load fresh data ----------
const waitFor = (fragment, timeout = 20000) => new Promise(resolve => {
  const w = { fragment, resolve: () => { clearTimeout(timer); waiters.splice(waiters.indexOf(w), 1); resolve(true); } };
  const timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); resolve(false); }, timeout);
  waiters.push(w);
});
const pause = ms => new Promise(r => setTimeout(r, ms));
const go = (hash, fragment, timeout) => { const wait = waitFor(fragment, timeout); location.hash = hash; return wait; };
const monthStart = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

let banner = null;
function show(text, done) {
  if (!banner) {
    banner = document.createElement("div");
    banner.style.cssText = "position:fixed;z-index:2147483647;left:50%;top:14px;transform:translateX(-50%);max-width:90vw;padding:12px 20px;border-radius:999px;font:600 14px 'Segoe UI',sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,40,90,.35);border:1px solid rgba(255,255,255,.8);pointer-events:none";
    document.documentElement.append(banner);
  }
  banner.style.background = done
    ? "linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,0) 50%),linear-gradient(180deg,#4fd14f,#11782a)"
    : "linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,0) 50%),linear-gradient(180deg,#2fb0f5,#0a5fb4)";
  banner.textContent = "🎒 School Assist: " + text;
}
const status = (state, text) => store.set({ sync: { state, text, at: Date.now() } });

let syncing = false;
async function sync() {
  if (syncing) return;
  syncing = true;
  await ready;
  await store.remove("syncRequest");
  try {
    show("checking you're logged in…");
    status("running", "Opening 21K School…");
    // The portal loads your notifications only when you're logged in. They may have arrived
    // already when the page opened. If you're not logged in yet, log in: School Assist waits
    // for up to 5 minutes and then carries on.
    const loggedIn = seen["notifications/"] || (location.hash.startsWith("#portal")
      ? await waitFor("notifications/", 15000)
      : await go("#portal", "notifications/", 15000));
    if (!loggedIn) {
      show("please log in to 21K School. I'll start reading as soon as you're in.");
      status("login", "Log in to 21K School in the tab that opened.");
      if (!(await waitFor("notifications/", 5 * 60000))) throw new Error("Not logged in, so nothing was read.");
    }
    await pause(2500);
    readPortal();

    show("reading your classes…");
    status("running", "Reading your classes…");
    await go("#home", "overview/basic/");
    await pause(800);
    const classes = (raw.overview?.workspaces || []).filter(w => w.group_type === "Qualification");
    const total = 3 + classes.length;
    let n = 0;

    show("reading your inbox…");
    status("running", "Reading your inbox…");
    await go("#messages/in", "messages/box/in/");

    const now = new Date();
    for (const k of [0, 1, 2]) {
      const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
      show(`reading your calendar (${++n} of ${total})…`);
      status("running", `Reading your calendar (${n} of ${total})…`);
      await go(`#calendar////meetings=1&workspace_events=1&assignments=1&courses=0/${monthStart(d)}/month`, "calendar/get_events/");
      await pause(3000); // classes and school events arrive separately
      location.hash = "#portal"; // leave the calendar so the next month loads fresh
      await pause(800);
    }
    for (const c of classes) {
      show(`reading ${c.group_name} (${++n} of ${total})…`);
      status("running", `Reading ${c.group_name} (${n} of ${total})…`);
      await go(`#workspace/${c.group_id}`, `groups/${c.group_id}/`);
      await pause(400);
    }
    raw.fetchedAt = new Date().toISOString();
    raw.classList = classes.map(c => ({ id: c.group_id, name: c.group_name, category: c.classification_name }));
    await store.set({ raw });
    location.hash = "#portal";
    show("all done! You can close this tab and go back to School Assist.", true);
    status("done", "Up to date");
    setTimeout(() => banner?.remove(), 8000);
  } catch (err) {
    show(err.message);
    status("error", err.message);
    setTimeout(() => banner?.remove(), 8000);
  } finally {
    syncing = false;
  }
}

// School Assist asks for a refresh by leaving a note and opening this site in a new tab.
// That new tab picks the note up (and removes it, so only one tab does the reading).
if (window.top === window) {
  store.get(["syncRequest"]).then(r => {
    if (!r.syncRequest || Date.now() - r.syncRequest > 2 * 60000) return;
    const start = () => setTimeout(sync, 800);
    if (document.readyState === "complete") start();
    else addEventListener("load", start, { once: true });
  });
}
