// The Frutiger Aero New Tab: wallpapers, poppable bubbles and draggable widgets.

let S; // synced settings
let L; // local-only data (layout, tasks, notes…)

const $ = (sel, root = document) => root.querySelector(sel);

// ================= Wallpapers =================

const SCENES = [
  {
    id: "meadow",
    name: "Meadow",
    html: `
      <div class="sun"></div>
      <div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div>
      <svg class="hills" viewBox="0 0 1440 320" preserveAspectRatio="none">
        <defs>
          <linearGradient id="hB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9be15d"/><stop offset="1" stop-color="#3fa34d"/></linearGradient>
          <linearGradient id="hF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c6f36b"/><stop offset=".5" stop-color="#5cc23c"/><stop offset="1" stop-color="#1f7a2e"/></linearGradient>
          <linearGradient id="hS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        </defs>
        <path fill="url(#hB)" d="M0,180 C240,90 480,120 720,170 C960,220 1200,110 1440,140 L1440,320 L0,320 Z"/>
        <path fill="url(#hF)" d="M0,240 C300,160 560,200 820,240 C1080,280 1260,200 1440,210 L1440,320 L0,320 Z"/>
        <path fill="url(#hS)" d="M0,240 C300,160 560,200 820,240 C1080,280 1260,200 1440,210 L1440,250 C1260,240 1080,300 820,270 C560,240 300,200 0,270 Z"/>
      </svg>`
  },
  {
    id: "ocean",
    name: "Ocean",
    html: `<div class="rays"></div><div class="surface"></div><div class="seabed"></div>`
  },
  {
    id: "swoosh",
    name: "Swoosh",
    html: `
      <svg class="swirls" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <defs><filter id="glow"><feGaussianBlur stdDeviation="6"/></filter></defs>
        <g fill="none" stroke="#fff" stroke-linecap="round">
          <path filter="url(#glow)" stroke-width="40" stroke-opacity=".35" d="M-100,700 C300,450 700,850 1100,520 S1500,300 1600,350"/>
          <path stroke-width="6" stroke-opacity=".8" d="M-100,700 C300,450 700,850 1100,520 S1500,300 1600,350"/>
          <path filter="url(#glow)" stroke-width="24" stroke-opacity=".3" d="M-100,820 C400,620 800,900 1200,650 S1500,500 1600,520"/>
          <path stroke-width="3" stroke-opacity=".7" d="M-100,820 C400,620 800,900 1200,650 S1500,500 1600,520"/>
        </g>
      </svg>
      <div class="orb-deco" style="width:220px;height:220px;left:8%;top:14%"></div>
      <div class="orb-deco" style="width:120px;height:120px;left:70%;top:58%;animation-delay:-3s"></div>
      <div class="orb-deco" style="width:70px;height:70px;left:84%;top:12%;animation-delay:-6s"></div>`
  }
];

function sceneList() {
  return L.wallpaperImage ? [...SCENES, { id: "custom", name: "My picture" }] : SCENES;
}

function renderScene() {
  const list = sceneList();
  const scene = list.find(s => s.id === S.wallpaper) || list[0];
  const el = $("#scene");
  el.className = "scene-" + scene.id;
  el.innerHTML = scene.html || "";
  el.style.backgroundImage = scene.id === "custom" ? `url(${L.wallpaperImage})` : "";

  $("#wpDots").innerHTML = list.map(s => `<span class="${s.id === scene.id ? "on" : ""}"></span>`).join("");
  document.querySelectorAll("#wpChoices button").forEach(b => b.classList.toggle("on", b.dataset.id === scene.id));
}

function stepScene(dir) {
  const list = sceneList();
  const i = list.findIndex(s => s.id === S.wallpaper);
  S.wallpaper = list[(i + dir + list.length) % list.length].id;
  saveSettings({ wallpaper: S.wallpaper });
  renderScene();
  AeroSound.bloop();
}

// ================= Bubbles =================

const Bubbles = {
  canvas: null,
  ctx: null,
  list: [],
  sparks: [],

  init() {
    this.canvas = $("#bubbles");
    this.ctx = this.canvas.getContext("2d");
    addEventListener("resize", () => this.resize());
    this.resize();
    this.setCount(S.bubbleCount);
    this.canvas.addEventListener("pointerdown", e => this.tryPop(e.clientX, e.clientY));
    requestAnimationFrame(t => this.frame(t));
  },

  resize() {
    const dpr = devicePixelRatio || 1;
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  make(anywhere) {
    const r = 6 + Math.random() * 22;
    return {
      r,
      x: Math.random() * innerWidth,
      y: anywhere ? Math.random() * innerHeight : innerHeight + r + Math.random() * 200,
      speed: 0.25 + Math.random() * 0.6 + (30 - r) * 0.015,
      phase: Math.random() * Math.PI * 2
    };
  },

  setCount(n) {
    while (this.list.length < n) this.list.push(this.make(true));
    this.list.length = n;
  },

  tryPop(x, y) {
    const i = this.list.findIndex(b => Math.hypot(b.x - x, b.y - y) < b.r + 4);
    if (i < 0) return;
    const b = this.list[i];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      this.sparks.push({ x: b.x, y: b.y, vx: Math.cos(a) * 2.5, vy: Math.sin(a) * 2.5, life: 1 });
    }
    this.list[i] = this.make(false);
    AeroSound.pop();
  },

  frame(t) {
    const { ctx } = this;
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    for (const b of this.list) {
      b.y -= b.speed;
      const x = b.x + Math.sin(t / 900 + b.phase) * 6;
      if (b.y < -b.r) Object.assign(b, this.make(false));

      // body
      const body = ctx.createRadialGradient(x, b.y, b.r * 0.2, x, b.y, b.r);
      body.addColorStop(0, "rgba(255,255,255,0.05)");
      body.addColorStop(0.75, "rgba(170,235,255,0.18)");
      body.addColorStop(1, "rgba(255,255,255,0.65)");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      // shine
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.ellipse(x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.35, b.r * 0.2, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    this.sparks = this.sparks.filter(s => (s.life -= 0.04) > 0);
    for (const s of this.sparks) {
      s.x += s.vx;
      s.y += s.vy;
      ctx.fillStyle = `rgba(255,255,255,${s.life})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(t2 => this.frame(t2));
  }
};

// ================= Widget system =================

const WIDGET_NAMES = {
  clock: "Clock", search: "Search bar", dock: "Shortcut dock", tasks: "Tasks", notes: "Quick notes",
  music: "Music (YouTube)", weather: "Weather", aquarium: "Aquarium", calendar: "Calendar",
  timer: "Focus timer", bubblewrap: "Bubble wrap"
};

// Where each widget's middle sits, in % of the screen.
const DEFAULT_LAYOUT = {
  clock: { x: 50, y: 16 },
  search: { x: 50, y: 34 },
  dock: { x: 50, y: 91 },
  tasks: { x: 11, y: 24 },
  weather: { x: 11, y: 57 },
  timer: { x: 11, y: 84 },
  calendar: { x: 30, y: 66 },
  bubblewrap: { x: 50, y: 62 },
  aquarium: { x: 70, y: 66 },
  notes: { x: 89, y: 24 },
  music: { x: 89, y: 68 }
};

const SETUP = {};
let widgetTimers = [];
let zTop = 10;

function every(fn, ms) {
  fn();
  widgetTimers.push(setInterval(fn, ms));
}

function renderWidgets() {
  widgetTimers.forEach(clearInterval);
  widgetTimers = [];
  stopMusicTimers();
  const desk = $("#desk");
  desk.innerHTML = "";

  for (const id of Object.keys(WIDGET_NAMES)) {
    if (!S.widgets[id]) continue;
    const el = $("#tpl-" + id).content.firstElementChild.cloneNode(true);
    const pos = L.layout[id] || DEFAULT_LAYOUT[id];
    el.style.left = pos.x + "%";
    el.style.top = pos.y + "%";
    desk.append(el);
    makeDraggable(el, id);
    SETUP[id](el);
  }
}

function makeDraggable(el, id) {
  el.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest("input, textarea, button, a, iframe, label, canvas, .list, .queue, .no-drag")) return;
    e.preventDefault();

    const rect = el.getBoundingClientRect();
    const offX = e.clientX - (rect.left + rect.width / 2);
    const offY = e.clientY - (rect.top + rect.height / 2);
    el.style.zIndex = ++zTop;
    el.classList.add("dragging");
    el.setPointerCapture(e.pointerId);

    const clamp = (v, half, max) => (half * 2 > max ? max / 2 : Math.min(Math.max(v, half), max - half));
    const move = ev => {
      const x = clamp(ev.clientX - offX, el.offsetWidth / 2, innerWidth);
      const y = clamp(ev.clientY - offY, el.offsetHeight / 2, innerHeight);
      el.style.left = (x / innerWidth) * 100 + "%";
      el.style.top = (y / innerHeight) * 100 + "%";
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.classList.remove("dragging");
      L.layout[id] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
      localStore.save({ layout: L.layout });
      AeroSound.click();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
}

// ----- Clock -----
SETUP.clock = el => {
  every(() => {
    const now = new Date();
    $(".time", el).textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
    $(".date", el).textContent = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    const h = now.getHours();
    const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    $(".greeting", el).textContent = S.name ? `${part}, ${S.name}!` : "";
  }, 1000);
};

// ----- Search -----
SETUP.search = el => {
  el.addEventListener("submit", e => {
    e.preventDefault();
    const text = $("input", el).value.trim();
    if (!text) return;
    AeroSound.bloop();
    if (typeof chrome !== "undefined" && chrome.search) {
      chrome.search.query({ text, disposition: "CURRENT_TAB" });
    } else {
      location.href = "https://www.google.com/search?q=" + encodeURIComponent(text);
    }
  });
};

// ----- Shortcut dock -----
function faviconUrl(url) {
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`;
  }
  return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
}

SETUP.dock = el => {
  el.innerHTML = "";
  S.shortcuts.forEach((s, i) => {
    const item = document.createElement("div");
    item.className = "dock-item";
    item.innerHTML = `<a href="${s.url}"><img alt=""></a><span class="label"></span><button class="remove" title="Remove">✕</button>`;
    const img = $("img", item);
    img.src = faviconUrl(s.url);
    img.onerror = () => img.replaceWith(s.title[0].toUpperCase());
    $(".label", item).textContent = s.title;
    $("a", item).addEventListener("click", () => AeroSound.bloop());
    $(".remove", item).addEventListener("click", () => {
      S.shortcuts.splice(i, 1);
      saveSettings({ shortcuts: S.shortcuts });
      AeroSound.pop();
      SETUP.dock(el);
    });
    el.append(item);
  });

  const add = document.createElement("div");
  add.className = "dock-item";
  add.innerHTML = `<button class="add" title="Add shortcut">+</button><span class="label">Add</span>`;
  // Aero Browser has no pop-up questions, so the + turns into a little address box instead.
  $("button", add).addEventListener("click", () => {
    const form = document.createElement("form");
    form.className = "dock-add";
    form.innerHTML = `<input type="text" placeholder="youtube.com" autocomplete="off">`;
    add.replaceWith(form);
    const input = $("input", form);
    input.focus();
    input.addEventListener("blur", () => SETUP.dock(el));
    input.addEventListener("keydown", e => e.key === "Escape" && input.blur());
    form.addEventListener("submit", e => {
      e.preventDefault();
      let url = input.value.trim();
      if (!url) return input.blur();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      let host;
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return input.select(); }
      const name = host.split(".")[0];
      S.shortcuts.push({ title: name[0].toUpperCase() + name.slice(1), url });
      saveSettings({ shortcuts: S.shortcuts });
      AeroSound.chime();
      SETUP.dock(el);
    });
  });
  el.append(add);
};

// ----- Tasks -----
SETUP.tasks = el => {
  const list = $(".list", el);
  const save = () => localStore.save({ tasks: L.tasks });

  const draw = () => {
    list.innerHTML = "";
    if (!L.tasks.length) list.innerHTML = `<li class="empty">Nothing to do — enjoy the bubbles!</li>`;
    L.tasks.forEach((t, i) => {
      const li = document.createElement("li");
      li.className = t.done ? "done" : "";
      li.innerHTML = `<button class="check">${t.done ? "✓" : ""}</button><span></span><button class="del" title="Delete">✕</button>`;
      $("span", li).textContent = t.text;
      $(".check", li).addEventListener("click", () => {
        t.done = !t.done;
        t.done ? AeroSound.chime() : AeroSound.click();
        save();
        draw();
      });
      $(".del", li).addEventListener("click", () => {
        L.tasks.splice(i, 1);
        AeroSound.pop();
        save();
        draw();
      });
      list.append(li);
    });
    $(".count", el).textContent = `${L.tasks.filter(t => t.done).length}/${L.tasks.length}`;
  };

  $(".add-row", el).addEventListener("submit", e => {
    e.preventDefault();
    const input = $("input", e.target);
    const text = input.value.trim();
    if (!text) return;
    L.tasks.push({ text, done: false });
    input.value = "";
    AeroSound.bloop();
    save();
    draw();
  });

  draw();
};

// ----- Notes -----
SETUP.notes = el => {
  const area = $("textarea", el);
  const count = $(".count", el);
  let timer;
  area.value = L.notes;
  count.textContent = area.value.length;
  area.addEventListener("input", () => {
    count.textContent = area.value.length;
    clearTimeout(timer);
    timer = setTimeout(() => {
      L.notes = area.value;
      localStore.save({ notes: L.notes });
    }, 400);
  });
};

// ----- Music (YouTube) -----
// Plays the sound of YouTube videos through a hidden YouTube player,
// controlled with YouTube's postMessage commands.
let musicCleanup = null;

function stopMusicTimers() {
  musicCleanup?.();
  musicCleanup = null;
}

const fmt = sec => {
  const s = Math.floor(sec || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Works out the video id (or playlist id) from any kind of YouTube link.
function parseYouTube(link) {
  let u;
  try { u = new URL(/^https?:/i.test(link) ? link : "https://" + link); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/) || [])[1];
  } else return null;
  if (id && /^[\w-]{11}$/.test(id)) return { id };
  const list = u.searchParams.get("list");
  return list ? { list } : null;
}

function embedSrc(item, autoplay) {
  const base = item.id
    ? `https://www.youtube.com/embed/${item.id}?`
    : `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(item.list)}&`;
  // "origin" tells the player who to send its updates (time, title, state) to.
  return base + `enablejsapi=1&playsinline=1&controls=0&widgetid=1&autoplay=${autoplay ? 1 : 0}&origin=${encodeURIComponent(location.origin)}`;
}

async function lookupTitle(item) {
  const page = item.id ? `https://www.youtube.com/watch?v=${item.id}` : `https://www.youtube.com/playlist?list=${item.list}`;
  try {
    const res = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(page));
    const data = await res.json();
    if (data.title) return { title: data.title, author: data.author_name || "" };
  } catch {}
  // The real title shows up from the player once it starts playing.
  return { title: item.id ? "YouTube video" : "YouTube playlist", author: "" };
}

SETUP.music = el => {
  const box = $(".player-box", el);
  const queueEl = $(".queue", el);
  const playBtn = $(".play", el);
  let iframe = null;
  let state = -1; // YouTube: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  let time = 0;
  let duration = 0;
  let sampledAt = 0;
  let info = {};
  let playlistInfo = null;
  let problem = "";

  const saveQueue = () => localStore.save({ musicQueue: L.musicQueue, musicIndex: L.musicIndex });
  const current = () => L.musicQueue[L.musicIndex];
  const isPlaying = () => state === 1 || state === 3;
  const post = msg => iframe?.contentWindow?.postMessage(JSON.stringify({ id: 1, channel: "widget", ...msg }), "*");
  const send = (func, args = []) => post({ event: "command", func, args });

  function load(index, autoplay) {
    const n = L.musicQueue.length;
    box.innerHTML = "";
    iframe = null;
    state = -1;
    time = duration = 0;
    info = {};
    playlistInfo = null;
    problem = "";
    if (n) {
      L.musicIndex = ((index % n) + n) % n;
      saveQueue();
      if (autoplay) {
        state = 3;
        iframe = document.createElement("iframe");
        iframe.allow = "autoplay; encrypted-media";
        iframe.src = embedSrc(current(), true);
        iframe.addEventListener("load", () => {
          post({ event: "listening" });
          send("setVolume", [S.musicVolume]);
        });
        box.append(iframe);
      }
    }
    drawQueue();
    paint();
  }

  function onEnded() {
    const item = current();
    if (item?.list && playlistInfo && playlistInfo.index < playlistInfo.list.length - 1) return; // YouTube moves on by itself
    if (L.musicQueue.length > 1) load(L.musicIndex + 1, true);
  }

  function setState(s) {
    if (s === state) return;
    state = s;
    if (s === 0) onEnded();
  }

  const onMessage = e => {
    if (!iframe || e.source !== iframe.contentWindow) return;
    let data;
    try { data = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
    if (data.event === "onReady") send("setVolume", [S.musicVolume]);
    if (data.event === "onStateChange") setState(data.info);
    if (data.event === "onError") {
      // 101 / 150: the video's owner doesn't allow it to play outside YouTube.
      problem = [101, 150].includes(data.info) ? "Its owner only lets it play on YouTube 😕" : "This one couldn't play 😕";
      state = 2;
      const at = L.musicIndex;
      if (L.musicQueue.length > 1) setTimeout(() => L.musicIndex === at && load(at + 1, true), 2500);
    }
    if (data.event === "infoDelivery" && data.info) {
      const i = data.info;
      if ("currentTime" in i) { time = i.currentTime; sampledAt = Date.now(); }
      if ("duration" in i) duration = i.duration;
      if (i.videoData?.title) {
        info = { title: i.videoData.title, author: i.videoData.author, id: i.videoData.video_id };
        // Remember the real title in the queue (playlists keep their own name).
        const item = current();
        if (item?.id && item.title !== info.title) {
          Object.assign(item, { title: info.title, author: info.author });
          saveQueue();
          drawQueue();
        }
      }
      if (Array.isArray(i.playlist)) playlistInfo = { list: i.playlist, index: i.playlistIndex ?? 0 };
      else if ("playlistIndex" in i && playlistInfo) playlistInfo.index = i.playlistIndex;
      if ("playerState" in i) setState(i.playerState);
    }
    paint();
  };
  addEventListener("message", onMessage);
  const tick = setInterval(paint, 500);
  musicCleanup = () => {
    removeEventListener("message", onMessage);
    clearInterval(tick);
  };

  const now = () => (state === 1 ? Math.min(time + (Date.now() - sampledAt) / 1000, duration || Infinity) : time);

  function paint() {
    const item = current();
    $(".title", el).textContent = info.title || item?.title || "Nothing playing";
    $(".artist", el).textContent = problem || info.author || item?.author || (item ? "" : "Paste a YouTube link below");
    const vid = info.id || item?.id;
    $(".art", el).style.backgroundImage = vid ? `url(https://i.ytimg.com/vi/${vid}/mqdefault.jpg)` : "";
    $(".progress div", el).style.width = duration ? (now() / duration) * 100 + "%" : "0";
    $(".cur", el).textContent = fmt(now());
    $(".dur", el).textContent = fmt(duration);
    playBtn.textContent = isPlaying() ? "⏸" : "▶";
  }

  function drawQueue() {
    queueEl.innerHTML = "";
    L.musicQueue.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = i === L.musicIndex ? "on" : "";
      li.innerHTML = `<span></span><button class="del" title="Remove">✕</button>`;
      $("span", li).textContent = (item.list ? "≡ " : "♪ ") + item.title;
      li.addEventListener("click", () => {
        AeroSound.bloop();
        load(i, true);
      });
      $(".del", li).addEventListener("click", e => {
        e.stopPropagation();
        AeroSound.pop();
        const wasCurrent = i === L.musicIndex;
        L.musicQueue.splice(i, 1);
        if (i < L.musicIndex) L.musicIndex--;
        if (wasCurrent) load(Math.min(L.musicIndex, L.musicQueue.length - 1), false);
        else { saveQueue(); drawQueue(); }
      });
      queueEl.append(li);
    });
  }

  playBtn.addEventListener("click", () => {
    AeroSound.click();
    if (!L.musicQueue.length) return $(".add input", el).focus();
    if (!iframe) return load(L.musicIndex, true);
    if (isPlaying()) { send("pauseVideo"); state = 2; }
    else { send("playVideo"); state = 3; }
    paint();
  });

  $(".next", el).addEventListener("click", () => {
    AeroSound.click();
    if (current()?.list && iframe && playlistInfo && playlistInfo.index < playlistInfo.list.length - 1) send("nextVideo");
    else load(L.musicIndex + 1, true);
  });

  $(".prev", el).addEventListener("click", () => {
    AeroSound.click();
    if (iframe && now() > 3) { send("seekTo", [0, true]); time = 0; sampledAt = Date.now(); }
    else if (current()?.list && iframe && playlistInfo?.index > 0) send("previousVideo");
    else load(L.musicIndex - 1, true);
  });

  $(".progress", el).addEventListener("click", e => {
    if (!iframe || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    time = ((e.clientX - r.left) / r.width) * duration;
    sampledAt = Date.now();
    send("seekTo", [time, true]);
    paint();
  });

  const volume = $(".volume", el);
  volume.value = S.musicVolume;
  volume.addEventListener("input", () => {
    S.musicVolume = +volume.value;
    send("setVolume", [S.musicVolume]);
  });
  volume.addEventListener("change", () => saveSettings({ musicVolume: S.musicVolume }));

  $(".add", el).addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("input", e.target);
    const item = parseYouTube(input.value.trim());
    if (!item) return alert("That isn't a YouTube link. On YouTube, click Share → Copy, then paste it here.");
    input.value = "";
    AeroSound.bloop();
    Object.assign(item, await lookupTitle(item));
    L.musicQueue.push(item);
    if (!isPlaying()) load(L.musicQueue.length - 1, true);
    else { saveQueue(); drawQueue(); }
  });

  drawQueue();
  paint();
};

// ----- Weather (free Open-Meteo service, no account needed) -----
let refreshWeather = null;

const WEATHER_CODES = {
  0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Cloudy"],
  45: ["🌫️", "Foggy"], 48: ["🌫️", "Foggy"],
  51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌦️", "Heavy drizzle"],
  56: ["🌧️", "Icy drizzle"], 57: ["🌧️", "Icy drizzle"],
  61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
  66: ["🌧️", "Icy rain"], 67: ["🌧️", "Icy rain"],
  71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
  80: ["🌦️", "Showers"], 81: ["🌦️", "Showers"], 82: ["⛈️", "Heavy showers"],
  85: ["🌨️", "Snow showers"], 86: ["🌨️", "Snow showers"],
  95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunder & hail"], 99: ["⛈️", "Thunder & hail"]
};

function weatherLook(code, isDay = 1) {
  const [icon, text] = WEATHER_CODES[code] || ["🌈", "Weather"];
  if (!isDay && code <= 1) return ["🌙", code ? "Mostly clear" : "Clear night"];
  return [icon, text];
}

async function geocode(name) {
  if (!name) return null;
  const res = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + encodeURIComponent(name));
  const r = (await res.json()).results?.[0];
  return r ? { name: r.name, lat: r.latitude, lon: r.longitude } : null;
}

SETUP.weather = el => {
  const body = $(".weather-body", el);
  const place = $(".place", el);

  function ask(message) {
    place.textContent = "";
    body.innerHTML = `<p class="msg"></p><form><input type="text" placeholder="Type your city…"><button class="orb small" type="submit">✓</button></form>`;
    $(".msg", body).textContent = message;
    $("form", body).addEventListener("submit", async e => {
      e.preventDefault();
      const p = await geocode($("input", body).value.trim()).catch(() => null);
      if (!p) return ask("Couldn't find that city — try another spelling.");
      S.weatherPlace = p;
      saveSettings({ weatherPlace: p });
      $("#setCity").value = p.name;
      AeroSound.chime();
      refresh();
    });
  }

  function draw(data) {
    const c = data.current;
    const d = data.daily;
    const [icon, text] = weatherLook(c.weather_code, c.is_day);
    body.innerHTML = `
      <div class="wx-now">
        <div class="wx-icon">${icon}</div>
        <div>
          <div class="wx-temp">${Math.round(c.temperature_2m)}°${S.weatherUnit}</div>
          <div class="wx-desc">${text}<br>H ${Math.round(d.temperature_2m_max[0])}° · L ${Math.round(d.temperature_2m_min[0])}°</div>
        </div>
      </div>
      <div class="wx-days">${[1, 2, 3].map(i => `
        <div>${new Date(d.time[i] + "T12:00").toLocaleDateString([], { weekday: "short" })}
          <b>${weatherLook(d.weather_code[i])[0]}</b>
          ${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</div>`).join("")}
      </div>`;
  }

  async function refresh() {
    const p = S.weatherPlace;
    if (!p) return ask("Where do you live? I'll show your weather.");
    place.textContent = p.name;
    const key = `${p.lat},${p.lon},${S.weatherUnit}`;
    const cache = L.weatherCache;
    if (cache?.key === key) draw(cache.data);
    if (cache?.key === key && Date.now() - cache.at < 20 * 60 * 1000) return;
    try {
      const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
        latitude: p.lat,
        longitude: p.lon,
        current: "temperature_2m,weather_code,is_day",
        daily: "weather_code,temperature_2m_max,temperature_2m_min",
        timezone: "auto",
        forecast_days: 4,
        temperature_unit: S.weatherUnit === "F" ? "fahrenheit" : "celsius"
      });
      const data = await (await fetch(url)).json();
      L.weatherCache = { key, at: Date.now(), data };
      localStore.save({ weatherCache: L.weatherCache });
      draw(data);
    } catch {
      if (cache?.key !== key) body.innerHTML = `<p class="msg">The weather couldn't load right now.</p>`;
    }
  }

  refreshWeather = refresh;
  every(refresh, 30 * 60 * 1000);
};

// ----- Aquarium -----
SETUP.aquarium = el => {
  const canvas = $("canvas", el);
  const ctx = canvas.getContext("2d");
  const W = 300;
  const H = 170;
  const SAND = H - 16;
  const dpr = devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.scale(dpr, dpr);

  const COLORS = [["#ffc27a", "#ff5e1a"], ["#fff07a", "#ffb300"], ["#a8ecff", "#1e7be8"], ["#ffb3e0", "#e8338f"], ["#d4ff9a", "#2fae2f"]];
  const fish = COLORS.map((colors, i) => ({
    colors,
    x: 30 + Math.random() * (W - 60),
    y: 30 + Math.random() * (SAND - 60),
    vx: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.4),
    targetY: 30 + Math.random() * (SAND - 60),
    size: 9 + i * 1.2,
    phase: Math.random() * 6
  }));
  const food = [];
  const bubbles = [];

  canvas.addEventListener("pointerdown", e => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    for (let k = 0; k < 3 && food.length < 30; k++) food.push({ x: x + (Math.random() - 0.5) * 16, y: 4 + Math.random() * 6 });
    AeroSound.click();
  });

  function drawFish(f, t) {
    const s = f.size;
    const dir = f.vx >= 0 ? 1 : -1;
    const wag = Math.sin(t / 120 + f.phase) * s * 0.25;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(dir, 1);
    // tail
    ctx.fillStyle = f.colors[1];
    ctx.beginPath();
    ctx.moveTo(-s * 0.7, 0);
    ctx.lineTo(-s * 1.6, -s * 0.6 + wag);
    ctx.lineTo(-s * 1.6, s * 0.6 + wag);
    ctx.closePath();
    ctx.fill();
    // body
    const g = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.6);
    g.addColorStop(0, f.colors[0]);
    g.addColorStop(1, f.colors[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // shine
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(-s * 0.1, -s * 0.3, s * 0.55, s * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    // eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s * 0.5, -s * 0.12, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#123";
    ctx.beginPath();
    ctx.arc(s * 0.56, -s * 0.12, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function frame(t) {
    if (!el.isConnected) return; // widget was hidden or redrawn

    // water
    const water = ctx.createLinearGradient(0, 0, 0, H);
    water.addColorStop(0, "#7fe4ff");
    water.addColorStop(1, "#0a6cc4");
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, W, H);

    // sand
    ctx.fillStyle = "#f1d68c";
    ctx.beginPath();
    ctx.moveTo(0, SAND);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, SAND + Math.sin(x / 30) * 3);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fill();

    // swaying plants
    ctx.strokeStyle = "#2fae2f";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const [px, h] of [[30, 60], [44, 42], [250, 70], [266, 50], [150, 34]]) {
      ctx.beginPath();
      ctx.moveTo(px, SAND + 2);
      ctx.quadraticCurveTo(px + Math.sin(t / 800 + px) * 10, SAND - h / 2, px + Math.sin(t / 600 + px) * 8, SAND - h);
      ctx.stroke();
    }

    // bubbles
    if (Math.random() < 0.05) bubbles.push({ x: 256 + Math.random() * 10, y: SAND, r: 1.5 + Math.random() * 2.5 });
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= 0.6;
      b.x += Math.sin(b.y / 10) * 0.2;
      if (b.y < 0) { bubbles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // food
    ctx.fillStyle = "#a0522d";
    for (const p of food) {
      if (p.y < SAND - 2) p.y += 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // fish
    for (const f of fish) {
      let nearest = null;
      let best = Infinity;
      for (const p of food) {
        const d = Math.hypot(p.x - f.x, p.y - f.y);
        if (d < best) { best = d; nearest = p; }
      }
      if (nearest) {
        f.vx += Math.sign(nearest.x - f.x) * 0.06;
        f.vx = Math.max(-1.8, Math.min(1.8, f.vx));
        f.y += Math.sign(nearest.y - f.y) * Math.min(1.2, Math.abs(nearest.y - f.y));
        if (best < f.size) {
          food.splice(food.indexOf(nearest), 1);
          f.size = Math.min(f.size + 0.3, 18);
          AeroSound.pop();
        }
      } else {
        if (Math.abs(f.vx) > 0.8) f.vx *= 0.98;
        f.y += (f.targetY - f.y) * 0.01;
        if (Math.random() < 0.005) f.targetY = 25 + Math.random() * (SAND - 50);
      }
      f.x += f.vx;
      if (f.x < f.size * 1.6 || f.x > W - f.size * 1.6) {
        f.vx = -f.vx || 0.5;
        f.x = Math.max(f.size * 1.6, Math.min(W - f.size * 1.6, f.x));
      }
      drawFish(f, t);
    }

    // glass shine
    const shine = ctx.createLinearGradient(0, 0, W, H);
    shine.addColorStop(0, "rgba(255,255,255,0.35)");
    shine.addColorStop(0.35, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, W, H);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
};

// ----- Calendar -----
SETUP.calendar = el => {
  const view = new Date();
  view.setDate(1);
  const grid = $(".grid", el);

  function draw() {
    const today = new Date();
    $(".month", el).textContent = view.toLocaleDateString([], { month: "long", year: "numeric" });
    const y = view.getFullYear();
    const m = view.getMonth();
    const start = view.getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    const cells = ["S", "M", "T", "W", "T", "F", "S"].map(d => `<span class="dow">${d}</span>`);
    for (let i = start - 1; i >= 0; i--) cells.push(`<span class="other">${prevDays - i}</span>`);
    for (let d = 1; d <= days; d++) {
      const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
      cells.push(`<span class="${isToday ? "today" : ""}">${d}</span>`);
    }
    for (let d = 1; (cells.length - 7) % 7; d++) cells.push(`<span class="other">${d}</span>`);
    grid.innerHTML = cells.join("");
  }

  $(".prev", el).addEventListener("click", () => { view.setMonth(view.getMonth() - 1); AeroSound.click(); draw(); });
  $(".next", el).addEventListener("click", () => { view.setMonth(view.getMonth() + 1); AeroSound.click(); draw(); });
  every(draw, 60 * 1000);
};

// ----- Focus timer -----
SETUP.timer = el => {
  const RING = 2 * Math.PI * 52;
  let total = 25 * 60;
  let left = total;
  let endAt = 0;
  let loop = null;

  const paint = () => {
    $(".left", el).textContent = fmt(left);
    $(".fill", el).style.strokeDashoffset = RING * (1 - left / total);
    $(".start", el).textContent = loop ? "⏸" : "▶";
  };

  const stop = () => {
    clearInterval(loop);
    loop = null;
  };

  const tick = () => {
    left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    if (left === 0) {
      stop();
      el.classList.add("done");
      AeroSound.chime();
      setTimeout(() => AeroSound.chime(), 700);
      setTimeout(() => AeroSound.chime(), 1400);
    }
    paint();
  };

  $(".start", el).addEventListener("click", () => {
    AeroSound.click();
    el.classList.remove("done");
    if (loop) {
      stop();
    } else {
      if (left === 0) left = total;
      endAt = Date.now() + left * 1000;
      loop = setInterval(tick, 250);
      widgetTimers.push(loop);
    }
    paint();
  });

  $(".reset", el).addEventListener("click", () => {
    AeroSound.click();
    stop();
    el.classList.remove("done");
    left = total;
    paint();
  });

  el.querySelectorAll("[data-min]").forEach(b => b.addEventListener("click", () => {
    AeroSound.bloop();
    stop();
    el.classList.remove("done");
    total = left = +b.dataset.min * 60;
    paint();
  }));

  paint();
};

// ----- Bubble wrap -----
SETUP.bubblewrap = el => {
  const sheet = $(".sheet", el);
  const count = $(".count", el);
  count.textContent = L.poppedTotal;

  function fresh() {
    sheet.innerHTML = "";
    for (let i = 0; i < 24; i++) {
      const b = document.createElement("button");
      b.addEventListener("click", () => {
        if (b.classList.contains("popped")) return;
        b.classList.add("popped");
        AeroSound.pop();
        count.textContent = ++L.poppedTotal;
        localStore.save({ poppedTotal: L.poppedTotal });
        if (!sheet.querySelector("button:not(.popped)")) {
          AeroSound.chime();
          setTimeout(fresh, 1200);
        }
      });
      sheet.append(b);
    }
  }

  $(".fresh", el).addEventListener("click", () => { AeroSound.bloop(); fresh(); });
  fresh();
};

// ================= Settings panel =================

function openSettings() {
  $("#settings").hidden = false;
  AeroSound.click();
}

function closeSettings() {
  $("#settings").hidden = true;
  AeroSound.click();
}

function initSettings() {
  $("#openSettings").addEventListener("click", () => ($("#settings").hidden ? openSettings() : closeSettings()));
  $("#closeSettings").addEventListener("click", closeSettings);
  addEventListener("keydown", e => e.key === "Escape" && !$("#settings").hidden && closeSettings());

  const name = $("#setName");
  name.value = S.name;
  name.addEventListener("input", () => {
    S.name = name.value.trim();
    saveSettings({ name: S.name });
  });

  const sounds = $("#setSounds");
  sounds.checked = S.sounds;
  sounds.addEventListener("change", () => {
    S.sounds = AeroSound.enabled = sounds.checked;
    saveSettings({ sounds: S.sounds });
    AeroSound.click();
  });

  const toggles = $("#widgetToggles");
  for (const [id, label] of Object.entries(WIDGET_NAMES)) {
    const row = document.createElement("label");
    row.className = "toggle";
    row.innerHTML = `<input type="checkbox"> ${label}`;
    const box = $("input", row);
    box.checked = S.widgets[id];
    box.addEventListener("change", () => {
      S.widgets = { ...S.widgets, [id]: box.checked };
      saveSettings({ widgets: S.widgets });
      AeroSound.click();
      renderWidgets();
    });
    toggles.append(row);
  }

  $("#resetLayout").addEventListener("click", () => {
    L.layout = {};
    localStore.save({ layout: {} });
    AeroSound.bloop();
    renderWidgets();
  });

  drawWallpaperChoices();
  $("#wpUpload").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) useOwnPicture(file);
  });

  const bubbles = $("#setBubbles");
  bubbles.value = S.bubbleCount;
  bubbles.addEventListener("input", () => {
    S.bubbleCount = +bubbles.value;
    Bubbles.setCount(S.bubbleCount);
    saveSettings({ bubbleCount: S.bubbleCount });
  });

  const city = $("#setCity");
  city.value = S.weatherPlace?.name || "";
  $("#cityForm").addEventListener("submit", async e => {
    e.preventDefault();
    const p = await geocode(city.value.trim()).catch(() => null);
    if (!p) return alert("Couldn't find that city — try another spelling.");
    S.weatherPlace = p;
    saveSettings({ weatherPlace: p });
    city.value = p.name;
    AeroSound.chime();
    refreshWeather?.();
  });

  const fahrenheit = $("#setFahrenheit");
  fahrenheit.checked = S.weatherUnit === "F";
  fahrenheit.addEventListener("change", () => {
    S.weatherUnit = fahrenheit.checked ? "F" : "C";
    saveSettings({ weatherUnit: S.weatherUnit });
    AeroSound.click();
    refreshWeather?.();
  });
}

function drawWallpaperChoices() {
  const box = $("#wpChoices");
  box.innerHTML = "";
  for (const s of sceneList()) {
    const b = document.createElement("button");
    b.dataset.id = s.id;
    b.className = "scene-" + s.id;
    b.textContent = s.name;
    if (s.id === "custom") b.style.backgroundImage = `url(${L.wallpaperImage})`;
    b.addEventListener("click", () => {
      S.wallpaper = s.id;
      saveSettings({ wallpaper: s.id });
      renderScene();
      AeroSound.bloop();
    });
    box.append(b);
  }
  renderScene();
}

// Shrinks the picture so it fits nicely in storage, then uses it as the wallpaper.
function useOwnPicture(file) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 2560 / img.width);
    const c = document.createElement("canvas");
    c.width = img.width * scale;
    c.height = img.height * scale;
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    L.wallpaperImage = c.toDataURL("image/jpeg", 0.88);
    S.wallpaper = "custom";
    localStore.save({ wallpaperImage: L.wallpaperImage });
    saveSettings({ wallpaper: "custom" });
    URL.revokeObjectURL(img.src);
    drawWallpaperChoices();
    AeroSound.chime();
  };
  img.src = URL.createObjectURL(file);
}

// ================= Start =================

async function init() {
  S = await loadSettings();
  L = await localStore.load();
  AeroSound.enabled = S.sounds;

  renderScene();
  Bubbles.init();
  renderWidgets();
  initSettings();

  $("#wpPrev").addEventListener("click", () => stepScene(-1));
  $("#wpNext").addEventListener("click", () => stepScene(1));

  // Keep in sync when settings change from the popup.
  if (hasChromeStorage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes.sounds) S.sounds = AeroSound.enabled = changes.sounds.newValue;
      if (changes.bubbleCount) Bubbles.setCount((S.bubbleCount = changes.bubbleCount.newValue));
    });
  }
}

init();
