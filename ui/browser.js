// Aero Browser — the glossy controls around the web page.

const $ = sel => document.querySelector(sel);

// ================= Settings you can change =================

// "dark: true" themes use dark writing on light glass.
const THEMES = {
  frost:     { name: "Frost",     a: "#c3d8ea", b: "#e2eef8", accent: "#3d8bd4", dark: true },
  aqua:      { name: "Aqua Sky",  a: "#1f7fd6", b: "#7fd0ff", accent: "#1e9be8" },
  meadow:    { name: "Meadow",    a: "#2f8f3f", b: "#a8e66b", accent: "#3cb83c" },
  ocean:     { name: "Deep Ocean", a: "#031f45", b: "#0b6fb5", accent: "#22b8e0" },
  bubblegum: { name: "Bubblegum", a: "#d0287f", b: "#ffb3e0", accent: "#ff5fb0" },
  sunset:    { name: "Sunset",    a: "#e8601a", b: "#ffd27a", accent: "#ff8c1a" },
  silver:    { name: "Silver",    a: "#7a8b9a", b: "#e6eef4", accent: "#4c7fb0" },
  midnight:  { name: "Midnight",  a: "#0b0f1e", b: "#26324f", accent: "#5a7dff" }
};

const SEARCH = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  ecosia: "https://www.ecosia.org/search?q=",
  yahoo: "https://search.yahoo.com/search?p="
};

const DEFAULTS = {
  theme: "frost",
  winButtons: "simple",
  accent: null,
  gloss: 70,
  bars: "top",
  tabShape: "rounded",
  size: "comfy",
  bookmarksBar: true,
  search: "google",
  restyle: true,
  sounds: true,
  bookmarks: [
    { title: "YouTube", url: "https://www.youtube.com/" },
    { title: "Google", url: "https://www.google.com/" },
    { title: "Wikipedia", url: "https://www.wikipedia.org/" }
  ]
};

function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("aero-browser") || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
let prefs = loadPrefs();
const savePrefs = () => localStorage.setItem("aero-browser", JSON.stringify(prefs));

// ================= Engine connection =================
// Inside Aero Browser, window.aero talks to main.js. Opened as a plain web page
// (for previewing the design), a pretend engine is used instead.
const api = window.aero || makePretendEngine();

// ================= Sounds =================

const Sound = {
  ctx: null,
  tone(type, from, to, dur, vol) {
    if (!prefs.sounds) return;
    this.ctx ||= new AudioContext();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },
  bloop() { this.tone("sine", 300, 900, 0.18, 0.2); },
  pop() { this.tone("sine", 1400, 2400, 0.07, 0.16); },
  click() { this.tone("triangle", 1800, 1400, 0.05, 0.1); }
};

// ================= Tabs =================

const tabs = new Map(); // id -> info from the engine
let activeId = null;
let editingUrl = false; // true while you're typing in the address bar

function tabEl(id) {
  return document.querySelector(`.tab[data-id="${id}"]`);
}

function drawTab(info) {
  let el = tabEl(info.id);
  if (!el) {
    el = document.createElement("div");
    el.className = "tab";
    el.dataset.id = info.id;
    if (info.profileId) el.dataset.profile = info.profileId;
    el.hidden = !!info.profileId && info.profileId !== profileState.current;
    el.innerHTML = `<span class="fav"></span><span class="title"></span><button class="x" title="Close (Ctrl+W)">✕</button>`;
    el.addEventListener("mousedown", e => {
      if (e.button === 0 && !e.target.closest(".x")) api.send("tab:activate", info.id);
    });
    el.addEventListener("auxclick", e => e.button === 1 && closeTab(info.id));
    el.querySelector(".x").addEventListener("click", () => closeTab(info.id));
    $("#tabs").append(el);
  }
  el.title = info.title;
  el.querySelector(".title").textContent = info.title;
  el.classList.toggle("sleeping", !!info.sleeping);
  const fav = el.querySelector(".fav");
  if (info.sleeping) fav.textContent = "💤";
  else if (info.loading) fav.innerHTML = `<span class="spin"></span>`;
  else if (info.favicon) {
    fav.innerHTML = `<img alt="">`;
    const img = fav.querySelector("img");
    img.src = info.favicon;
    img.onerror = () => (fav.textContent = "🌐");
  } else fav.textContent = info.url ? "🌐" : "🫧";
}

function closeTab(id) {
  Sound.pop();
  api.send("tab:close", id);
}

function drawActive() {
  const info = tabs.get(activeId);
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", +t.dataset.id === activeId));
  if (!info) return;
  document.title = info.title + " — Aero Browser";
  if (!editingUrl) $("#url").value = info.url;
  $("#siteIcon").textContent = !info.url ? "🔍" : info.url.startsWith("https:") ? "🔒" : "ⓘ";
  $("#back").disabled = !info.canBack;
  $("#forward").disabled = !info.canForward;
  $("#reload").innerHTML = info.loading ? "✕" : "↻";
  $("#reload").title = info.loading ? "Stop" : "Reload (F5)";
  $("#app").classList.toggle("loading", info.loading);
  const marked = prefs.bookmarks.some(b => b.url === info.url);
  $("#star").textContent = marked ? "★" : "☆";
  $("#star").disabled = !info.url;
}

api.on("tab:created", info => {
  tabs.set(info.id, info);
  drawTab(info);
});
api.on("tab:update", info => {
  tabs.set(info.id, info);
  drawTab(info);
  if (info.id === activeId) drawActive();
});
api.on("tab:activated", id => {
  activeId = id;
  editingUrl = false;
  drawActive();
  tabEl(id)?.scrollIntoView({ inline: "nearest" });
});
api.on("tab:closed", id => {
  tabs.delete(id);
  tabEl(id)?.remove();
});
api.on("ui:focus-address", () => {
  $("#url").focus();
  $("#url").select();
});
api.on("win:state", state => {
  $("#winMax").innerHTML = state === "max" ? "&#x2750;" : "&#x25A1;";
  $("#winMax").title = state === "max" ? "Restore" : "Maximise";
});

// ================= Toolbar =================

$("#newTab").addEventListener("click", () => { Sound.bloop(); api.send("tab:new"); });
$("#back").addEventListener("click", () => { Sound.click(); api.send("nav:back"); });
$("#forward").addEventListener("click", () => { Sound.click(); api.send("nav:forward"); });
$("#reload").addEventListener("click", () => {
  Sound.click();
  api.send(tabs.get(activeId)?.loading ? "nav:stop" : "nav:reload");
});
$("#home").addEventListener("click", () => { Sound.bloop(); api.send("nav:home"); });

$("#address").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("#url").value.trim();
  if (!text) return;
  Sound.bloop();
  editingUrl = false;
  api.send("nav:go", text);
  $("#url").blur();
});
$("#url").addEventListener("focus", () => setTimeout(() => $("#url").select()));
$("#url").addEventListener("input", () => (editingUrl = true));
$("#url").addEventListener("blur", () => {
  editingUrl = false;
  drawActive();
});
$("#url").addEventListener("keydown", e => {
  if (e.key === "Escape") $("#url").blur();
});

$("#star").addEventListener("click", () => {
  const info = tabs.get(activeId);
  if (!info?.url) return;
  const i = prefs.bookmarks.findIndex(b => b.url === info.url);
  if (i >= 0) { prefs.bookmarks.splice(i, 1); Sound.pop(); }
  else { prefs.bookmarks.push({ title: info.title, url: info.url, favicon: info.favicon }); Sound.bloop(); }
  savePrefs();
  drawBookmarks();
  drawActive();
});

$("#winMin").addEventListener("click", () => api.send("win:min"));
$("#winMax").addEventListener("click", () => api.send("win:max"));
$("#winClose").addEventListener("click", () => api.send("win:close"));
$("#titlebar").addEventListener("dblclick", e => {
  if (e.target.matches("#titlebar, .drag-space, #tabs")) api.send("win:max");
});

// ================= Bookmarks bar =================

function drawBookmarks() {
  const bar = $("#bookmarks");
  bar.innerHTML = "";
  if (!prefs.bookmarks.length) {
    bar.innerHTML = `<span class="empty">Click ☆ in the address bar to add bookmarks here</span>`;
    return;
  }
  prefs.bookmarks.forEach((b, i) => {
    const btn = document.createElement("button");
    btn.title = b.url + "\n(middle-click: new tab · right-click: remove)";
    btn.innerHTML = `<img alt=""><span></span>`;
    const img = btn.querySelector("img");
    img.src = b.favicon || `https://www.google.com/s2/favicons?sz=32&domain=${new URL(b.url).hostname}`;
    img.onerror = () => img.remove();
    btn.querySelector("span").textContent = b.title;
    btn.addEventListener("click", () => { Sound.click(); api.send("nav:go", b.url); });
    btn.addEventListener("auxclick", e => e.button === 1 && api.send("tab:new", b.url));
    btn.addEventListener("contextmenu", e => {
      e.preventDefault();
      if (!confirm(`Remove "${b.title}" from bookmarks?`)) return;
      prefs.bookmarks.splice(i, 1);
      savePrefs();
      Sound.pop();
      drawBookmarks();
      drawActive();
    });
    bar.append(btn);
  });
}

// ================= Customize panel =================

function applyPrefs() {
  const theme = THEMES[prefs.theme] || THEMES.frost;
  const root = document.documentElement.style;
  // Written as a stylesheet (not inline styles) so a custom theme loaded after it can override them.
  root.cssText = "";
  $("#prefVars").textContent = `:root {
    --frame-a: ${theme.a};
    --frame-b: ${theme.b};
    --text: ${theme.dark ? "#1d3550" : "#fff"};
    --text-shadow: ${theme.dark ? "0 1px 0 rgba(255,255,255,0.7)" : "0 1px 2px rgba(0, 40, 90, 0.55)"};
    --accent: ${prefs.accent || theme.accent};
    --gloss: ${prefs.gloss / 100};
  }`;

  const app = $("#app");
  app.className = [
    { bottom: "bars-bottom", left: "side bars-left", right: "side bars-right" }[prefs.bars] || "",
    "shape-" + prefs.tabShape,
    "size-" + prefs.size,
    "win-" + prefs.winButtons,
    prefs.bookmarksBar ? "" : "no-bookmarks",
    tabs.get(activeId)?.loading ? "loading" : ""
  ].join(" ");

  document.querySelectorAll("#themes button").forEach(b => b.classList.toggle("on", b.dataset.theme === prefs.theme));
  document.querySelectorAll(".choice").forEach(group => {
    group.querySelectorAll("button").forEach(b => b.classList.toggle("on", prefs[group.dataset.pref] === b.dataset.value));
  });
  document.querySelectorAll("input[type=checkbox][data-pref]").forEach(box => (box.checked = prefs[box.dataset.pref]));
  $("#accent").value = prefs.accent || theme.accent;
  $("#gloss").value = prefs.gloss;
  $("#search").value = prefs.search;

  api.send("set:restyle", prefs.restyle);
  api.send("set:search", SEARCH[prefs.search] || SEARCH.google);
  requestAnimationFrame(sendBounds);
}

function change(key, value) {
  prefs[key] = value;
  savePrefs();
  applyPrefs();
}

function buildCustomize() {
  for (const [id, t] of Object.entries(THEMES)) {
    const b = document.createElement("button");
    b.dataset.theme = id;
    b.textContent = t.name;
    b.style.background = `linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0) 51%), linear-gradient(180deg, ${t.a}, ${t.b})`;
    b.addEventListener("click", () => { Sound.bloop(); prefs.accent = null; change("theme", id); });
    $("#themes").append(b);
  }

  document.querySelectorAll(".choice").forEach(group => {
    group.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      Sound.click();
      change(group.dataset.pref, b.dataset.value);
    }));
  });
  document.querySelectorAll("input[type=checkbox][data-pref]").forEach(box => box.addEventListener("change", () => {
    change(box.dataset.pref, box.checked);
    Sound.click();
  }));

  $("#accent").addEventListener("input", e => change("accent", e.target.value));
  $("#accentReset").addEventListener("click", () => { Sound.click(); change("accent", null); });
  $("#gloss").addEventListener("input", e => change("gloss", +e.target.value));
  $("#search").addEventListener("change", e => { Sound.click(); change("search", e.target.value); });

  $("#resetAll").addEventListener("click", () => {
    if (!confirm("Put every setting back to how it started? (Your bookmarks stay.)")) return;
    prefs = { ...DEFAULTS, bookmarks: prefs.bookmarks };
    savePrefs();
    applyPrefs();
    Sound.bloop();
  });

}

// Only one side panel is open at a time; it takes space from the page so nothing hides behind it.
function togglePanel(id) {
  document.querySelectorAll(".panel").forEach(p => (p.hidden = p.id === id ? !p.hidden : true));
  Sound.click();
  if (id === "profiles" && !$("#profiles").hidden) api.send("profile:refresh");
}
$("#customizeBtn").addEventListener("click", () => togglePanel("customize"));
$("#profileBtn").addEventListener("click", () => togglePanel("profiles"));
document.querySelectorAll(".close-panel").forEach(b => b.addEventListener("click", () => togglePanel(b.closest(".panel").id)));

// ================= Profiles & Google accounts =================

const PROFILE_COLORS = ["#1e9be8", "#3cc23c", "#ff5fb0", "#ff8c1a", "#8a5cff", "#e8433c", "#14b8a6"];
let profileState = { profiles: [], current: null, accounts: {} };

const profileById = id => profileState.profiles.find(p => p.id === id);
const accountsOf = id => profileState.accounts[id] || [];

// Fills an avatar element with the Google photo if there is one, otherwise the first letter.
function paintAvatar(el, profile) {
  const photo = accountsOf(profile.id)[0]?.photo;
  el.style.setProperty("--avatar-color", profile.color);
  el.innerHTML = "";
  if (photo) {
    const img = document.createElement("img");
    img.src = photo;
    img.referrerPolicy = "no-referrer";
    img.onerror = () => (el.textContent = profile.name[0].toUpperCase());
    el.append(img);
  } else {
    el.textContent = (profile.name[0] || "?").toUpperCase();
  }
}

function avatar(profile, size) {
  const el = document.createElement("span");
  el.className = "avatar " + size;
  paintAvatar(el, profile);
  return el;
}

function openGoogle(url) {
  Sound.bloop();
  api.send("tab:new", url);
}

function renderProfiles() {
  const me = profileById(profileState.current);
  if (!me) return;
  paintAvatar($("#profileBtn"), me);
  const signedIn = accountsOf(me.id);
  $("#profileBtn").title = `${me.name}${signedIn[0] ? " — " + signedIn[0].email : ""}\nProfiles & Google accounts`;

  const body = $("#profilesBody");
  body.innerHTML = "";

  // --- This profile ---
  const card = document.createElement("section");
  card.innerHTML = `<div class="me"></div><div class="colors"></div><h3>Google accounts</h3><ul class="accounts"></ul><div class="btn-col"></div>`;
  const meRow = card.querySelector(".me");
  meRow.append(avatar(me, "big"));
  const nameInput = document.createElement("input");
  nameInput.className = "name-edit";
  nameInput.value = me.name;
  nameInput.title = "Click to rename this profile";
  nameInput.addEventListener("change", () => {
    if (nameInput.value.trim()) api.send("profile:update", { id: me.id, name: nameInput.value.trim() });
  });
  nameInput.addEventListener("keydown", e => e.key === "Enter" && nameInput.blur());
  meRow.append(nameInput);

  for (const color of PROFILE_COLORS) {
    const dot = document.createElement("button");
    dot.style.backgroundColor = color;
    dot.className = color === me.color ? "on" : "";
    dot.title = "Profile colour";
    dot.addEventListener("click", () => { Sound.click(); api.send("profile:update", { id: me.id, color }); });
    card.querySelector(".colors").append(dot);
  }

  const list = card.querySelector(".accounts");
  if (!signedIn.length) {
    list.innerHTML = `<li><span class="who"><b>Not signed in</b><small>Sign in to keep your Google account saved in this profile</small></span></li>`;
  }
  for (const acc of signedIn) {
    const li = document.createElement("li");
    li.append(avatar({ id: "_", name: acc.name, color: me.color }, "mini"));
    const img = li.querySelector(".avatar");
    if (acc.photo) {
      img.innerHTML = `<img referrerpolicy="no-referrer" alt="">`;
      img.querySelector("img").src = acc.photo;
    }
    li.insertAdjacentHTML("beforeend", `<span class="who"><b></b><small></small></span>`);
    li.querySelector("b").textContent = acc.name;
    li.querySelector("small").textContent = acc.email;
    list.append(li);
  }

  const buttons = card.querySelector(".btn-col");
  const addButton = (label, cls, fn) => {
    const b = document.createElement("button");
    b.className = "gel " + cls;
    b.textContent = label;
    b.addEventListener("click", fn);
    buttons.append(b);
  };
  if (!signedIn.length) {
    addButton("Sign in to Google", "", () => openGoogle("https://accounts.google.com/ServiceLogin"));
    // If Google says "This browser may not be secure", switching how we introduce ourselves can help.
    const mode = document.createElement("select");
    mode.innerHTML = `<option value="chromium">Sign in as: Chromium (normal)</option><option value="firefox">Sign in as: Firefox</option>`;
    mode.value = profileState.signInMode || "chromium";
    mode.title = "If Google blocks the sign-in, try the other option";
    mode.className = "signin-mode";
    mode.addEventListener("change", () => { Sound.click(); api.send("signin:set-mode", mode.value); });
    buttons.append(mode, Object.assign(document.createElement("p"), {
      className: "hint",
      textContent: "Google blocked the sign-in? Pick the other option and try again."
    }));
  } else {
    addButton("Add another Google account", "", () => openGoogle("https://accounts.google.com/AddSession"));
    addButton("Sign out of Google", "tiny red", () => openGoogle("https://accounts.google.com/Logout"));
  }
  body.append(card);

  // --- Other profiles ---
  const others = document.createElement("section");
  others.innerHTML = `<h3>Switch profile</h3>`;
  for (const p of profileState.profiles.filter(x => x.id !== me.id)) {
    const row = document.createElement("button");
    row.className = "profile-row";
    row.append(avatar(p, "mini"));
    row.insertAdjacentHTML("beforeend", `<span class="who"><b></b><small></small></span>`);
    row.querySelector("b").textContent = p.name;
    row.querySelector("small").textContent = accountsOf(p.id)[0]?.email || "Not signed in";
    row.addEventListener("click", () => { Sound.bloop(); api.send("profile:switch", p.id); });
    others.append(row);
  }
  const form = document.createElement("form");
  form.className = "add-profile";
  form.innerHTML = `<input placeholder="New profile name…" maxlength="30"><button class="gel tiny" type="submit">+ Add</button>`;
  form.addEventListener("submit", e => {
    e.preventDefault();
    const name = form.querySelector("input").value.trim();
    if (!name) return form.querySelector("input").focus();
    const color = PROFILE_COLORS[profileState.profiles.length % PROFILE_COLORS.length];
    Sound.bloop();
    api.send("profile:add", { name, color });
  });
  others.append(form);
  others.insertAdjacentHTML("beforeend", `<p class="hint">Each profile is like its own browser: it keeps its own Google accounts, logins and cookies.</p>`);
  body.append(others);

  // --- Remove ---
  if (profileState.profiles.length > 1) {
    const danger = document.createElement("section");
    const del = document.createElement("button");
    del.className = "gel tiny red";
    del.textContent = `Delete "${me.name}" profile`;
    del.addEventListener("click", () => {
      if (!confirm(`Delete the "${me.name}" profile? Its tabs close and its saved logins are erased from this browser.`)) return;
      Sound.pop();
      api.send("profile:delete", me.id);
    });
    danger.append(del);
    body.append(danger);
  }
}

// ================= Custom themes =================

function drawThemes({ list, active, v }) {
  $("#userTheme").href = active ? `aero://themes/_active/theme.css?v=${v}` : "";
  const box = $("#customThemes");
  box.innerHTML = "";
  for (const t of [{ id: null, name: "None", description: "Just the built-in look above" }, ...list]) {
    const row = document.createElement("button");
    row.className = "profile-row theme-row" + (t.id === active ? " on" : "");
    row.innerHTML = `<span class="pick"></span><span class="who"><b></b><small></small></span>`;
    row.querySelector("b").textContent = t.name + (t.author ? " · by " + t.author : "");
    row.querySelector("small").textContent = t.description || (t.newtab ? "Also restyles the New Tab" : "");
    row.addEventListener("click", () => { Sound.bloop(); api.send("theme:set", t.id); });
    box.append(row);
  }
}

api.on("themes", drawThemes);
$("#themeAdd").addEventListener("click", () => { Sound.click(); api.send("theme:install"); });
$("#themeFolder").addEventListener("click", () => { Sound.click(); api.send("theme:open-folder"); });

// ================= Updates & about =================

api.on("app:info", info => ($("#version").textContent = "version " + info.version));

api.on("update:status", s => {
  const text = {
    idle: "",
    dev: "Updates only work in the installed app.",
    checking: "Checking for updates…",
    latest: "You're up to date ✓",
    downloading: `Downloading version ${s.version}… ${s.percent || 0}%`,
    ready: `Version ${s.version} is ready — restart to update.`,
    error: "Couldn't check for updates right now."
  }[s.state] || "";
  $("#updateText").textContent = text;
  $("#updateBtn").hidden = s.state !== "ready";
  $("#updateBtn").title = s.state === "ready" ? `Version ${s.version} is ready. Click to restart and update.` : "";
  requestAnimationFrame(sendBounds);
});
$("#updateBtn").addEventListener("click", () => { Sound.bloop(); api.send("update:restart"); });
$("#checkUpdates").addEventListener("click", () => { Sound.click(); api.send("update:check"); });
$("#whatsNew").addEventListener("click", () => { Sound.bloop(); api.send("whatsnew:open"); });

// Shows only the current profile's tabs in the tab strip.
function filterTabs() {
  document.querySelectorAll(".tab").forEach(t => {
    t.hidden = !!t.dataset.profile && t.dataset.profile !== profileState.current;
  });
}

api.on("profiles", state => {
  profileState = state;
  filterTabs();
  renderProfiles();
});

// ================= Where the web page goes =================

function sendBounds() {
  const r = $("#viewport").getBoundingClientRect();
  api.send("view:bounds", { x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(sendBounds).observe($("#viewport"));
addEventListener("resize", sendBounds);

// ================= Start =================

buildCustomize();
drawBookmarks();
applyPrefs();
api.send("ui:ready");

// ================= Password manager =================

const pwOffers = new Map(); // tabId -> { host, username, update } — "Save password?"
const pwFillable = new Map(); // tabId -> { host, accounts } — saved logins for this page
const pwRevealed = new Map(); // login id -> password, only while the panel shows it
let pwData = { logins: [], never: [], hasPin: false, unlocked: true, encrypted: true };
let pwSearch = "";
let pwEditing = null; // login being edited in the form
let barFlash = null;

function drawPwBar() {
  const bar = $("#pwBar");
  const offer = pwOffers.get(activeId);
  const fill = pwFillable.get(activeId);
  const select = $("#pwAccount");
  select.hidden = true;
  $("#pwBarSecondary").hidden = false;
  $("#pwBarPrimary").hidden = false;

  if (barFlash) {
    $("#pwBarText").textContent = barFlash;
    $("#pwBarPrimary").hidden = $("#pwBarSecondary").hidden = true;
    bar.hidden = false;
  } else if (offer) {
    $("#pwBarText").textContent = `${offer.update ? "Update the saved password" : "Save your password"} for ${offer.host}${offer.username ? " (" + offer.username + ")" : ""}?`;
    $("#pwBarPrimary").textContent = offer.update ? "Update" : "Save";
    $("#pwBarSecondary").textContent = "Never for this site";
    bar.hidden = false;
  } else if (fill?.accounts.length) {
    $("#pwBarText").textContent = `Saved login for ${fill.host}:`;
    select.innerHTML = "";
    for (const a of fill.accounts) select.add(new Option(a.username, a.id));
    select.hidden = false;
    $("#pwBarPrimary").textContent = "Fill in";
    $("#pwBarSecondary").hidden = true;
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
  requestAnimationFrame(sendBounds);
}

// A short message in the bar (and the Passwords panel), e.g. "Password saved".
function flash(message) {
  barFlash = message;
  const status = $("#pwStatus");
  if (status) status.textContent = message;
  drawPwBar();
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { barFlash = null; drawPwBar(); }, 2800);
}

$("#pwBarPrimary").addEventListener("click", () => {
  const tabId = activeId;
  if (pwOffers.has(tabId)) {
    api.send("pw:save", tabId);
    pwOffers.delete(tabId);
    Sound.bloop();
  } else if (pwFillable.has(tabId)) {
    api.send("pw:fill", { tabId, id: $("#pwAccount").value });
    pwFillable.delete(tabId); // the bar goes away once filled
    Sound.bloop();
  }
  drawPwBar();
});
$("#pwBarSecondary").addEventListener("click", () => {
  api.send("pw:never", activeId);
  pwOffers.delete(activeId);
  Sound.click();
  drawPwBar();
});
$("#pwBarClose").addEventListener("click", () => {
  if (pwOffers.has(activeId)) api.send("pw:dismiss", activeId);
  pwOffers.delete(activeId);
  pwFillable.delete(activeId);
  barFlash = null;
  Sound.click();
  drawPwBar();
});

api.on("pw:offer", offer => { pwOffers.set(offer.tabId, offer); Sound.bloop(); drawPwBar(); });
api.on("pw:fillable", data => {
  if (data.accounts.length) pwFillable.set(data.tabId, data);
  else pwFillable.delete(data.tabId);
  drawPwBar();
});
api.on("pw:status", flash);
api.on("tab:activated", drawPwBar);
api.on("tab:closed", id => { pwOffers.delete(id); pwFillable.delete(id); });
api.on("pw:revealed", ({ id, password }) => { pwRevealed.set(id, password); renderPasswords(); });
api.on("pw:list", data => { pwData = data; renderPasswords(); });

// Strong random passwords, made on this computer.
function generatePassword(length = 16, symbols = true) {
  const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789"];
  if (symbols) sets.push("!@#$%&*?-_+=");
  const all = sets.join("");
  const random = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = sets.map(set => set[random(set.length)]); // at least one of each kind
  while (chars.length < length) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function renderPasswords() {
  const body = $("#passwordsBody");
  if ($("#passwords").hidden) return;
  body.innerHTML = "";
  const d = pwData;

  body.append(el("p", { className: "hint safe", textContent: d.encrypted
    ? "🔒 Encrypted with your Windows account. Your passwords never leave this computer."
    : "⚠️ Windows encryption isn't available, so passwords can't be saved." }));
  body.append(el("p", { id: "pwStatus", className: "pw-status" }));

  // --- PIN lock ---
  if (d.hasPin && !d.unlocked) {
    const pin = el("input", { type: "password", placeholder: "PIN", inputMode: "numeric", maxLength: 8 });
    const form = el("form", { className: "add-profile" }, pin, el("button", { className: "gel tiny", type: "submit", textContent: "Unlock" }));
    form.addEventListener("submit", e => { e.preventDefault(); api.send("pw:unlock", pin.value); });
    body.append(el("section", {}, el("h3", { textContent: "Locked 🔒" }), el("p", { className: "hint", textContent: "Type your PIN to see, copy or change passwords. It stays unlocked for 5 minutes." }), form));
  }

  // --- Saved logins ---
  const list = el("section", {}, el("h3", { textContent: `Saved logins (${d.logins.length})` }));
  const search = el("input", { className: "pw-search", placeholder: "Search…", value: pwSearch });
  search.addEventListener("input", () => {
    pwSearch = search.value;
    renderPasswords();
    $(".pw-search").focus();
    $(".pw-search").setSelectionRange(pwSearch.length, pwSearch.length);
  });
  list.append(search);
  const q = pwSearch.toLowerCase();
  const shown = d.logins.filter(l => !q || l.host.includes(q) || l.username.toLowerCase().includes(q));
  if (!shown.length) list.append(el("p", { className: "hint", textContent: d.logins.length ? "Nothing matches." : "No passwords yet. Log in to a website and click Save, or add one below." }));
  for (const login of shown) {
    const icon = el("img", { src: `https://www.google.com/s2/favicons?sz=32&domain=${login.host}`, alt: "" });
    icon.onerror = () => icon.remove();
    const pass = pwRevealed.has(login.id) ? pwRevealed.get(login.id) : "••••••••";
    const button = (text, title, fn) => {
      const b = el("button", { className: "mini", textContent: text, title });
      b.addEventListener("click", fn);
      return b;
    };
    list.append(el("div", { className: "pw-row" },
      icon,
      el("span", { className: "who" }, el("b", { textContent: login.host }), el("small", { textContent: login.username || "(no username)" }), el("code", { textContent: pass })),
      el("span", { className: "pw-actions" },
        button(pwRevealed.has(login.id) ? "🙈" : "👁", "Show / hide password", () => {
          if (pwRevealed.has(login.id)) { pwRevealed.delete(login.id); renderPasswords(); } else api.send("pw:reveal", login.id);
        }),
        button("👤", "Copy username", () => api.send("pw:copy", { id: login.id, field: "username" })),
        button("📋", "Copy password", () => api.send("pw:copy", { id: login.id, field: "password" })),
        button("✎", "Edit", () => { pwEditing = login; renderPasswords(); $("#pwFormPass").focus(); }),
        button("🗑", "Delete", () => {
          if (confirm(`Delete the saved password for ${login.host}${login.username ? " (" + login.username + ")" : ""}?`)) api.send("pw:delete", login.id);
        })
      )
    ));
  }
  body.append(list);

  // --- Add / edit ---
  const site = el("input", { placeholder: "Website (e.g. roblox.com)", value: pwEditing?.host || "" });
  const user = el("input", { placeholder: "Username or email", value: pwEditing?.username || "" });
  const pass = el("input", { id: "pwFormPass", type: "password", placeholder: pwEditing ? "New password" : "Password" });
  const show = el("button", { type: "button", className: "mini", textContent: "👁", title: "Show password" });
  show.addEventListener("click", () => (pass.type = pass.type === "password" ? "text" : "password"));
  const gen = el("button", { type: "button", className: "mini", textContent: "🎲", title: "Make a strong password" });
  gen.addEventListener("click", () => { pass.value = generatePassword(); pass.type = "text"; Sound.bloop(); });
  const form = el("form", { className: "pw-form" },
    site, user, el("div", { className: "pw-pass" }, pass, show, gen),
    el("div", { className: "row" }, el("button", { className: "gel tiny", type: "submit", textContent: pwEditing ? "Save changes" : "Add password" }))
  );
  if (pwEditing) {
    const cancel = el("button", { type: "button", className: "gel tiny plain", textContent: "Cancel" });
    cancel.addEventListener("click", () => { pwEditing = null; renderPasswords(); });
    form.querySelector(".row").append(cancel);
  }
  form.addEventListener("submit", e => {
    e.preventDefault();
    if (pwEditing && !pass.value) return flash("Type the new password (or press 🎲).");
    api.send("pw:upsert", { id: pwEditing?.id, site: site.value, username: user.value, password: pass.value });
    pwEditing = null;
  });
  body.append(el("section", {}, el("h3", { textContent: pwEditing ? "Edit login" : "Add a password" }), form));

  // --- Generator ---
  const length = el("input", { type: "range", min: 8, max: 32, value: 16 });
  const symbols = el("input", { type: "checkbox", checked: true });
  const out = el("code", { className: "pw-generated", textContent: generatePassword() });
  const regen = () => (out.textContent = generatePassword(+length.value, symbols.checked));
  length.addEventListener("input", regen);
  symbols.addEventListener("change", regen);
  const again = el("button", { className: "gel tiny", textContent: "🎲 New" });
  again.addEventListener("click", () => { regen(); Sound.bloop(); });
  const copy = el("button", { className: "gel tiny", textContent: "Copy" });
  copy.addEventListener("click", () => { navigator.clipboard.writeText(out.textContent); flash("Copied!"); });
  body.append(el("section", {},
    el("h3", { textContent: "Password generator" }), out,
    el("label", { className: "row" }, "Length", length),
    el("label", { className: "toggle" }, symbols, "Symbols (!@#…)"),
    el("div", { className: "row" }, again, copy)
  ));

  // --- PIN settings ---
  const oldPin = el("input", { type: "password", placeholder: "Current PIN", inputMode: "numeric", maxLength: 8 });
  const newPin = el("input", { type: "password", placeholder: d.hasPin ? "New PIN (blank = remove)" : "New PIN (4–8 numbers)", inputMode: "numeric", maxLength: 8 });
  const pinForm = el("form", { className: "pw-form" }, ...(d.hasPin ? [oldPin] : []), newPin,
    el("div", { className: "row" }, el("button", { className: "gel tiny", type: "submit", textContent: d.hasPin ? "Change PIN" : "Set PIN" })));
  pinForm.addEventListener("submit", e => { e.preventDefault(); api.send("pw:set-pin", { oldPin: oldPin.value, newPin: newPin.value }); });
  body.append(el("section", {}, el("h3", { textContent: "PIN lock" }),
    el("p", { className: "hint", textContent: "A PIN stops anyone else on this computer from seeing or copying your passwords." }), pinForm));

  // --- Never-save sites ---
  if (d.never.length) {
    const never = el("section", {}, el("h3", { textContent: "Never save on" }));
    for (const host of d.never) {
      const allow = el("button", { className: "mini", textContent: "Allow again" });
      allow.addEventListener("click", () => api.send("pw:unnever", host));
      never.append(el("div", { className: "pw-row" }, el("span", { className: "who" }, el("b", { textContent: host })), allow));
    }
    body.append(never);
  }
}

$("#pwBtn").addEventListener("click", () => {
  togglePanel("passwords");
  if (!$("#passwords").hidden) { pwRevealed.clear(); api.send("pw:refresh"); }
});

// ================= Power (CPU & RAM manager) =================

let perfSettingsShown = false;

function drawGraph(canvas, values, max, limit, color) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth || 280;
  const h = canvas.clientHeight || 56;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;
  const step = w / 59;
  const x = i => w - (values.length - 1 - i) * step;
  const y = v => h - 2 - Math.min(v / max, 1) * (h - 6);
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, color + "aa");
  fill.addColorStop(1, color + "11");
  ctx.beginPath();
  ctx.moveTo(x(0), h);
  values.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(values.length - 1), h);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (limit) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#e8433c";
    ctx.beginPath();
    ctx.moveTo(0, y(limit));
    ctx.lineTo(w, y(limit));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

const mb = n => (n >= 1024 ? (n / 1024).toFixed(1) + " GB" : Math.round(n) + " MB");

api.on("perf:stats", stats => {
  const s = stats.settings;
  if (!perfSettingsShown) {
    perfSettingsShown = true;
    $("#ramOn").checked = s.ramOn;
    $("#cpuOn").checked = s.cpuOn;
    $("#ramLimit").value = s.ramLimit;
    $("#cpuLimit").value = s.cpuLimit;
  }
  $("#ramLimitText").textContent = mb(+$("#ramLimit").value);
  $("#cpuLimitText").textContent = $("#cpuLimit").value + "%";
  $("#powerBtn").classList.toggle("limiting", s.ramOn || s.cpuOn);
  if ($("#power").hidden) return;

  $("#cpuNow").textContent = Math.round(stats.cpu) + "%";
  $("#ramNow").textContent = mb(stats.ram);
  $("#ramSystem").textContent = `Your computer: ${mb(stats.systemRam.total - stats.systemRam.free)} of ${mb(stats.systemRam.total)} in use`;
  drawGraph($("#cpuGraph"), stats.history.map(p => p.cpu), 100, s.cpuOn && s.cpuLimit, "#3cc23c");
  const ramMax = Math.max(s.ramOn ? s.ramLimit * 1.15 : 0, ...stats.history.map(p => p.ram * 1.25), 256);
  drawGraph($("#ramGraph"), stats.history.map(p => p.ram), ramMax, s.ramOn && s.ramLimit, "#1e9be8");
  $("#sleptCount").textContent = stats.sleptCount ? `· ${stats.sleptCount} put to sleep` : "";

  const list = $("#tabUsage");
  list.innerHTML = "";
  for (const t of stats.tabs.filter(t => t.profileId === profileState.current)) {
    const icon = t.favicon ? el("img", { src: t.favicon, alt: "" }) : el("span", { textContent: t.builtIn ? "🫧" : "🌐" });
    if (icon.tagName === "IMG") icon.onerror = () => icon.replaceWith("🌐");
    const badges = [t.active && "👀", t.sleeping && "💤", t.audible && "🔊", t.slowed && "🐢"].filter(Boolean).join(" ");
    const row = el("li", { className: "usage-row" + (t.sleeping ? " asleep" : "") },
      icon,
      el("span", { className: "who" }, el("b", { textContent: t.title }), el("small", { textContent: t.sleeping ? "Asleep 💤" : `${mb(t.ram)} · CPU ${Math.round(t.cpu)}% ${badges}` }))
    );
    if (!t.active && !t.sleeping && !t.builtIn) {
      const sleep = el("button", { className: "mini", textContent: "💤", title: "Put this tab to sleep to free memory" });
      sleep.addEventListener("click", () => { api.send("tab:sleep", t.id); Sound.click(); });
      row.append(sleep);
    }
    list.append(row);
  }
});

const sendPerf = () => api.send("perf:settings", {
  ramOn: $("#ramOn").checked,
  cpuOn: $("#cpuOn").checked,
  ramLimit: +$("#ramLimit").value,
  cpuLimit: +$("#cpuLimit").value
});
for (const id of ["ramOn", "cpuOn"]) $("#" + id).addEventListener("change", () => { Sound.click(); sendPerf(); });
for (const id of ["ramLimit", "cpuLimit"]) {
  $("#" + id).addEventListener("input", () => {
    $("#ramLimitText").textContent = mb(+$("#ramLimit").value);
    $("#cpuLimitText").textContent = $("#cpuLimit").value + "%";
  });
  $("#" + id).addEventListener("change", sendPerf);
}
$("#powerBtn").addEventListener("click", () => togglePanel("power"));

// ================= Pretend engine (design preview only) =================

function makePretendEngine() {
  const handlers = {};
  const emit = (ch, data) => handlers[ch]?.forEach(fn => fn(data));
  const fake = new Map();
  let next = 1;
  let active = null;
  const profiles = {
    current: "default",
    profiles: [{ id: "default", name: "Me", color: "#1e9be8" }, { id: "school", name: "School", color: "#3cc23c" }],
    accounts: { school: [{ name: "School Me", email: "me@school.example", photo: null }] }
  };
  const make = (title, url) => {
    const info = { id: next++, title, url, loading: false, canBack: !!url, canForward: false, favicon: null };
    fake.set(info.id, info);
    emit("tab:created", info);
    emit("tab:activated", (active = info.id));
  };
  return {
    on(ch, fn) { (handlers[ch] ||= []).push(fn); },
    send(ch, data) {
      if (ch === "ui:ready" && !fake.size) {
        emit("profiles", profiles);
        make("Wikipedia", "https://www.wikipedia.org/");
        make("New Tab", "");
      }
      if (ch === "profile:add") {
        profiles.profiles.push({ id: "p" + next, ...data });
        profiles.current = "p" + next;
        emit("profiles", profiles);
      }
      if (ch === "profile:switch") { profiles.current = data; emit("profiles", profiles); }
      if (ch === "profile:update") { Object.assign(profiles.profiles.find(p => p.id === data.id), data); emit("profiles", profiles); }
      if (ch === "tab:new") make("New Tab", data || "");
      if (ch === "tab:activate") emit("tab:activated", (active = data));
      if (ch === "tab:close") {
        fake.delete(data);
        emit("tab:closed", data);
        if (data === active && fake.size) emit("tab:activated", (active = [...fake.keys()].pop()));
      }
      if (ch === "nav:go") {
        const info = { ...fake.get(active), url: data.includes(".") ? "https://" + data : "https://www.google.com/search?q=" + data, title: data };
        fake.set(active, info);
        emit("tab:update", info);
      }
    }
  };
}
