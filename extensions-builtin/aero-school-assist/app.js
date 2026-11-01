// School Assist dashboard: turns what the 21K School pages loaded (saved by bridge.js) into
// Today, To-do, Inbox, Coming up, Holidays, Birthdays and Classes.
// Ticks and birthdays are saved in School Assist's storage inside Aero. Nothing is sent anywhere.

const SITE = "https://www.21kschool.in/";
const store = chrome.storage.local;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DAY = 86400000;

// ===================== From school data to to-dos and events =====================

const stripHtml = html => (html || "").replace(/<img[^>]*>/g, "").replace(/<br\s*\/?>/g, "\n").replace(/<\/p>/g, "\n")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\n{2,}/g, "\n").trim();

// Teacher messages that ask you to do something become to-dos, with a deadline read from the text.
const ACTION = /\b(task|homework|assignment|submit|upload|complete|prepare|worksheet|project|fill (in|out)|book(ing)?\b|register|registration|report (them|it|any)|check your|revise|practi[sc]e)\b/i;
const SKIP_SENDER = /events|announcements/i; // school-wide newsletters, mostly for parents
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_MONTH = /(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})?/i;
const MONTH_DAY = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i;
function parseDate(str, sent) {
  let m = str.match(DAY_MONTH);
  let day, mon, year;
  if (m) [, day, mon, year] = m;
  else if ((m = str.match(MONTH_DAY))) [, mon, day, year] = m;
  else return null;
  const d = new Date(+(year || sent.getFullYear()), MONTHS.indexOf(mon.toLowerCase().slice(0, 3)), +day, 23, 59);
  if (!year && d < sent) d.setFullYear(d.getFullYear() + 1);
  return d;
}
const endOfDay = (d, plus = 0) => { const x = new Date(d); x.setDate(x.getDate() + plus); x.setHours(23, 59, 0, 0); return x; };
function findDue(text, sent) {
  const by = text.match(/\b(?:by|before|deadline:?|due:?|on or before)\s+([^.\n]{0,40})/i);
  if (by) {
    const d = parseDate(by[1], sent);
    if (d) return d;
    if (/tomorrow/i.test(by[1])) return endOfDay(sent, 1);
    if (/today|tonight/i.test(by[1])) return endOfDay(sent);
  }
  if (/task for today|today'?s .*task|by today|by tonight/i.test(text)) return endOfDay(sent);
  if (/by tomorrow|task for tomorrow|for tomorrow'?s class/i.test(text)) return endOfDay(sent, 1);
  return null;
}
const firstLine = (text, re) => (text.split("\n").map(l => l.trim()).find(l => re.test(l)) || "").slice(0, 180);
function inboxTasks(messages, now = new Date()) {
  const seen = new Set();
  const tasks = [];
  for (const m of messages) {
    const sent = new Date(m.time);
    if ((now - sent) / DAY > 21 || SKIP_SENDER.test(m.from)) continue;
    const text = m.text || "";
    if (!ACTION.test(m.subject) && !ACTION.test(text)) continue;
    const key = m.subject.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const due = findDue(text, sent);
    tasks.push({
      id: "m" + m.id, name: m.subject, className: m.from, kind: "From inbox", source: "inbox", messageId: m.id,
      start: m.time, due: due ? due.toISOString() : null, completed: false, text: firstLine(text, ACTION) || text.slice(0, 180)
    });
  }
  return tasks;
}

function buildData(raw) {
  const workspaces = (raw.overview?.workspaces || []).filter(w => w.group_type === "Qualification");
  const classes = [];
  const todos = [];
  for (const w of workspaces) {
    const items = (raw.groups?.[w.group_id]?.assignments || []).filter(a => a.assignment_type !== "meeting");
    classes.push({ id: w.group_id, name: w.group_name, done: items.filter(a => a.status?.completed).length, total: items.length });
    for (const a of items) {
      todos.push({
        id: a.assignment_id, name: a.assignment_name, classId: w.group_id, className: w.group_name,
        kind: a.type_title || a.assignment_type, start: a.start_date, due: a.due_date,
        completed: !!a.status?.completed, waitingApproval: !!a.status?.approval_waiting, text: stripHtml(a.text).slice(0, 600)
      });
    }
  }
  const notes = raw.notifications?.notifications || [];
  const unreadIds = new Set(notes.filter(n => n.object_type === "message" && !n.is_read).map(n => n.object_id));
  const messages = raw.inbox?.length
    ? raw.inbox.map(m => {
      const u = m.participants?.users?.[0] || {};
      return {
        id: m.message_id, subject: m.subject || "(no subject)", from: `${u.user_first_name || ""} ${u.user_last_name || ""}`.trim(),
        time: m.time || m.datestamp, unread: unreadIds.has(m.message_id), text: stripHtml(m.message).slice(0, 2000)
      };
    })
    : notes.filter(n => n.object_type === "message").map(n => ({
      id: n.object_id, subject: n.data?.message_subject || "(no subject)",
      from: `${n.user?.user_first_name || ""} ${n.user?.user_last_name || ""}`.trim(), time: n.pn_time, unread: !n.is_read, text: ""
    }));
  const events = Object.values(raw.events || {}).map(e => ({
    id: e.id || e.event_id, type: e.type, title: (e.assignment_name || e.title || "").replace(/^"\s*|\s*"$/g, "").trim(),
    className: e.group_name || null, classId: e.group_id || null,
    category: e.calendar_name || e.data?.calendar_name || null, // "Holiday", "Common School Events", "birthday"
    start: e.start_time || e.start, end: e.end_time || e.end,
    allDay: !!e.allDay || e.whole_day === "1", zoom: e.assignment_url === "prv://zoom"
  })).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { fetchedAt: raw.fetchedAt, student: raw.student || {}, classes, todos: [...todos, ...inboxTasks(messages)], events, messages };
}

// ===================== Drawing the dashboard =====================

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const link = {
  message: id => `${SITE}#messages/in/${id}`,
  assignment: (id, classId) => `${SITE}Launcher?assignment=${id}&ref=${encodeURIComponent(`${SITE}#workspace/${classId}`)}`,
  classPage: classId => `${SITE}#workspace/${classId}`,
  calendarDay: d => `${SITE}#calendar////meetings=1&workspace_events=1&assignments=1&courses=0/${ymd(d)}/day`
};
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const fmtTime = d => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDay = d => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const toDate = s => new Date(String(s).includes("T") ? s : String(s).replace(" ", "T")); // school times are local
function relDue(due, now) {
  const ms = due - now;
  if (ms < 0) return { label: "late", cls: "urgent" };
  if (ms < DAY && sameDay(due, now)) return { label: "today " + fmtTime(due), cls: "urgent" };
  if (sameDay(due, new Date(now.getTime() + DAY))) return { label: "tomorrow", cls: "urgent" };
  const days = Math.ceil(ms / DAY);
  return { label: days <= 7 ? `in ${days} days` : fmtDay(due), cls: days <= 3 ? "soon" : "" };
}
function item({ when, title, meta, cls = "", href }) {
  const tag = href ? "a" : "div";
  const attrs = href ? ` href="${esc(href)}" target="_blank" rel="noopener"` : "";
  return `<${tag} class="item ${cls}"${attrs}>${when != null ? `<div class="when">${when}</div>` : ""}
    <div class="body"><div class="title">${title}</div>${meta ? `<div class="meta">${meta}</div>` : ""}</div></${tag}>`;
}
const fill = (id, html, emptyText) => { $(id).innerHTML = html || `<div class="empty">${emptyText}</div>`; };

let checks = {};
let birthdayList = [];
let data = buildData({});

function render() {
  const now = new Date();
  const first = (data.student?.name || "").split(" ")[0];
  $("greet").textContent = `${now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening"}${first ? ", " + first : ""}`;
  $("today-date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("updated").textContent = data.fetchedAt ? "updated " + new Date(data.fetchedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "no data yet";
  $("welcome").hidden = !!data.fetchedAt;

  const att = data.student?.attendance;
  $("att-stat").hidden = !att;
  if (att) {
    const pct = Math.round((att.attended / att.total) * 100);
    $("att-ring").style.setProperty("--p", pct);
    $("att-ring").style.setProperty("--c", pct >= 75 ? "var(--green)" : pct >= 60 ? "var(--orange)" : "var(--red)");
    $("att-pct").textContent = pct + "%";
    $("att-stat").title = `${att.attended} of ${att.total} classes`;
  }

  const events = data.events.map(e => ({ ...e, s: toDate(e.start), e: toDate(e.end) }));

  // Today, or the next day with something on it once today is over.
  let day = now;
  let todays = events.filter(e => sameDay(e.s, day));
  if (!todays.length || todays.every(e => e.e < now)) {
    const next = events.find(e => e.s > now && !sameDay(e.s, now));
    if (next) { day = next.s; todays = events.filter(e => sameDay(e.s, day)); }
  }
  const tomorrow = new Date(now.getTime() + DAY);
  $("today-title").textContent = sameDay(day, now) ? "Today" : sameDay(day, tomorrow) ? "Tomorrow" : "Next up · " + fmtDay(day);
  fill("today-list", todays.map(e => item({
    when: e.allDay ? "all day" : `${fmtTime(e.s)}–${fmtTime(e.e)}`,
    title: esc(e.title) + (e.zoom ? '<span class="tag">ZOOM</span>' : ""),
    meta: e.className && e.className !== e.title ? esc(e.className) : "",
    cls: e.s <= now && now < e.e ? "now" : e.e < now ? "past" : "",
    href: e.classId ? link.classPage(e.classId) : link.calendarDay(e.s)
  })).join(""), data.fetchedAt ? "Nothing on the calendar. Enjoy!" : "Press Refresh to load your timetable.");

  // To-do list: open assignments plus tasks found in the inbox, soonest first.
  const all = data.todos.map(t => ({ ...t, d: t.due ? new Date(String(t.due).replace(" ", "T")) : null, ticked: !!checks[t.id] }));
  const open = all.filter(t => !t.completed && !t.ticked);
  const upcoming = open.filter(t => !t.d || t.d >= now).sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || new Date(b.start) - new Date(a.start));
  const overdue = open.filter(t => t.d && t.d < now).sort((a, b) => b.d - a.d);
  const done = all.filter(t => t.ticked || (t.completed && t.d && now - t.d < 14 * DAY))
    .sort((a, b) => String(checks[b.id] || b.due || "").localeCompare(String(checks[a.id] || a.due || "")));
  const todoItem = t => {
    const r = t.d ? relDue(t.d, now) : { label: "no deadline", cls: "" };
    const isDone = t.completed || t.ticked;
    const href = t.source === "inbox" ? link.message(t.messageId) : link.assignment(t.id, t.classId);
    const tags = (t.source === "inbox" ? '<span class="tag inbox">INBOX</span>' : "")
      + (t.waitingApproval ? '<span class="tag">WAITING FOR TEACHER</span>' : "")
      + (t.completed ? '<span class="tag">DONE ON SITE</span>' : "");
    return `<label class="check ${isDone ? "done" : r.cls}">
      <input type="checkbox" data-id="${esc(t.id)}" ${isDone ? "checked" : ""} ${t.completed ? "disabled" : ""}>
      <div class="body">
        <div class="title"><a href="${esc(href)}" target="_blank" rel="noopener">${esc(t.name)}</a>${tags}</div>
        <div class="meta">${esc(t.className)} · ${esc(t.kind)}${t.d ? " · due " + fmtDay(t.d) + " " + fmtTime(t.d) : ""}</div>
        ${t.source === "inbox" && t.text ? `<div class="note">${esc(t.text)}</div>` : ""}
      </div>
      ${isDone ? "" : `<div class="due">${r.label}</div>`}
    </label>`;
  };
  $("todo-count").textContent = upcoming.length || "";
  fill("todo-list", upcoming.map(todoItem).join(""), data.fetchedAt ? "All caught up, nothing to do! 🎉" : "Press Refresh to load your assignments.");
  $("overdue-box").hidden = !overdue.length;
  $("overdue-count").textContent = overdue.length;
  $("overdue-list").innerHTML = overdue.map(todoItem).join("");
  $("done-box").hidden = !done.length;
  $("done-count").textContent = done.length;
  $("done-list").innerHTML = done.map(todoItem).join("");

  // Inbox
  const unread = data.messages.filter(m => m.unread).length;
  $("inbox-count").textContent = unread ? `${unread} new` : data.messages.length || "";
  fill("inbox-list", data.messages.map(m => {
    const t = new Date(String(m.time).replace(" ", "T"));
    return item({ when: sameDay(t, now) ? fmtTime(t) : fmtDay(t), title: esc(m.subject), meta: esc(m.from), cls: m.unread ? "unread" : "", href: link.message(m.id) });
  }).join(""), "No messages.");

  // Coming up: special events in the next 3 weeks.
  const until = new Date(now.getTime() + 21 * DAY);
  const special = events.filter(e => e.s > now && e.s < until && !sameDay(e.s, now) && e.title !== e.className && !/^(holiday|birthday)$/i.test(e.category || ""));
  const hot = /assessment|test|exam|ptm|quiz|deadline/i;
  fill("upcoming-list", special.map(e => item({
    when: fmtDay(e.s),
    title: esc(e.title) + (hot.test(e.title) ? '<span class="tag hot">IMPORTANT</span>' : ""),
    meta: [e.allDay ? "all day" : fmtTime(e.s), e.className].filter(Boolean).map(esc).join(" · "),
    href: e.classId ? link.classPage(e.classId) : link.calendarDay(e.s)
  })).join(""), "Nothing special coming up.");

  // Holidays: the next 3 months, with back-to-back days merged.
  const holidays = [];
  for (const e of events.filter(x => /^holiday$/i.test(x.category || "") && x.e >= now && x.s < new Date(now.getTime() + 92 * DAY))) {
    const last = holidays[holidays.length - 1];
    if (last && last.title === e.title && e.s - last.to <= DAY * 1.5) last.to = e.s;
    else holidays.push({ title: e.title, from: e.s, to: e.s });
  }
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  fill("holidays-list", holidays.map(h => {
    const days = Math.round((new Date(h.from.getFullYear(), h.from.getMonth(), h.from.getDate()) - midnight) / DAY);
    return item({
      when: sameDay(h.from, h.to) ? fmtDay(h.from) : `${fmtDay(h.from)} –<br>${fmtDay(h.to)}`,
      title: esc(h.title === "Holiday" ? "School holiday" : h.title),
      meta: days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`,
      href: link.calendarDay(h.from)
    });
  }).join(""), "No holidays in the next 3 months.");

  // Birthdays: yours from the school calendar, plus classmates you add.
  const nextOccur = (month, d) => { const x = new Date(now.getFullYear(), month - 1, d); if (x < midnight) x.setFullYear(x.getFullYear() + 1); return x; };
  const bdays = [
    ...events.filter(e => /^birthday$/i.test(e.category || "")).slice(0, 1).map(e => ({ name: "You", mine: true, when: nextOccur(e.s.getMonth() + 1, e.s.getDate()) })),
    ...birthdayList.map(b => ({ ...b, when: nextOccur(b.month, b.day) }))
  ].sort((a, b) => a.when - b.when);
  fill("birthdays-list", bdays.map(b => {
    const days = Math.round((b.when - midnight) / DAY);
    return `<div class="item ${b.mine ? "mine" : ""}">
      <div class="when">${b.when.toLocaleDateString([], { day: "numeric", month: "short" })}</div>
      <div class="body"><div class="title">${b.mine ? "Your birthday 🎂" : esc(b.name)}</div>
        <div class="meta">${days === 0 ? "today! 🎉" : days === 1 ? "tomorrow" : `in ${days} days`}</div></div>
      ${b.mine ? "" : `<button class="x" data-bday="${esc(b.id)}" title="Remove">×</button>`}
    </div>`;
  }).join(""), "Add your classmates' birthdays below.");

  // Classes
  fill("classes-list", data.classes.map(c => {
    const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
    return `<a class="class-card" href="${link.classPage(c.id)}" target="_blank" rel="noopener">
      <div class="title">${esc(c.name)}</div>
      <div class="sub">${c.total ? `${c.done} / ${c.total} assignments done` : "no assignments read yet"}</div>
      <div class="bar"><div style="width:${pct}%"></div></div></a>`;
  }).join(""), data.fetchedAt ? "No classes yet." : "Press Refresh to load your classes.");
}

// ===================== Storage, refresh and buttons =====================

async function load() {
  const r = await store.get(["raw", "checks", "birthdays", "sync"]);
  data = buildData(r.raw || {});
  checks = r.checks || {};
  birthdayList = r.birthdays || [];
  showSync(r.sync);
  render();
}
chrome.storage.onChanged.addListener(changes => {
  if (changes.sync) showSync(changes.sync.newValue);
  if (changes.raw || changes.checks || changes.birthdays) load();
});

function showSync(s) {
  const running = s && (s.state === "running" || s.state === "login") && Date.now() - s.at < 6 * 60000;
  $("refresh-btn").disabled = !!running;
  if (running) $("banner").textContent = "↻ " + s.text;
  else if (s?.state === "error" && Date.now() - s.at < 60000) $("banner").textContent = "Couldn't refresh: " + s.text;
  else if (s?.state === "done" && Date.now() - s.at < 15000) $("banner").textContent = "✓ Up to date. You can close the 21K School tab.";
  else { $("banner").hidden = true; return; }
  $("banner").hidden = false;
}

// Refresh: leave a note for the School Assist helper and open the school site in a new tab.
$("refresh-btn").addEventListener("click", async () => {
  await store.set({ syncRequest: Date.now(), sync: { state: "running", text: "Opening 21K School…", at: Date.now() } });
  window.open(SITE + "#portal", "_blank");
});

// Tick or untick a to-do (saved inside Aero only, nothing is sent to school).
document.addEventListener("change", async ev => {
  const box = ev.target.closest("input[type=checkbox][data-id]");
  if (!box) return;
  if (box.checked) checks[box.dataset.id] = new Date().toISOString();
  else delete checks[box.dataset.id];
  setTimeout(() => store.set({ checks }), 250); // a short pause so you see the tick before it moves
});

document.addEventListener("click", async ev => {
  const x = ev.target.closest("[data-bday]");
  if (!x) return;
  birthdayList = birthdayList.filter(b => b.id !== x.dataset.bday);
  await store.set({ birthdays: birthdayList });
});
$("bday-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const [, month, day] = $("bday-date").value.split("-");
  const name = $("bday-name").value.trim();
  if (!name || !month) return;
  birthdayList = [...birthdayList, { id: String(Date.now()), name, month: +month, day: +day }];
  await store.set({ birthdays: birthdayList });
  ev.target.reset();
});

// If your Aero theme makes the glass dark, switch the text to light colours.
function matchGlass() {
  const cs = getComputedStyle(document.querySelector(".glass"));
  const colors = (cs.backgroundImage + " " + cs.backgroundColor).match(/rgba?\([^)]+\)/g) || [];
  const solid = colors.map(c => c.match(/[\d.]+/g).map(Number)).filter(v => v.length < 4 || v[3] > 0.25);
  if (!solid.length) return;
  const light = solid.reduce((sum, [r, g, b]) => sum + (0.299 * r + 0.587 * g + 0.114 * b), 0) / solid.length;
  document.body.classList.toggle("dark-glass", light < 128);
}
$("aeroTheme").addEventListener("load", matchGlass);
matchGlass();

load();
setInterval(render, 5 * 60000); // keep "now" up to date
