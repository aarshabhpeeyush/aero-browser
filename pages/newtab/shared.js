// Shared bits used by the New Tab page and the popup.

// Small settings that sync between your computers.
const AERO_DEFAULTS = {
  name: "",
  sounds: true,
  bubbleCount: 25,
  wallpaper: "meadow",
  restyleSites: true,
  glossyButtons: true,
  siteBubbles: false,
  musicVolume: 70,
  weatherPlace: null,
  weatherUnit: "C",
  widgets: {
    clock: true, search: true, dock: true, tasks: true, notes: true, music: true,
    weather: true, aquarium: true, calendar: true, timer: true, bubblewrap: true
  },
  shortcuts: [
    { title: "YouTube", url: "https://www.youtube.com" },
    { title: "Google", url: "https://www.google.com" },
    { title: "Wikipedia", url: "https://www.wikipedia.org" },
    { title: "Gmail", url: "https://mail.google.com" }
  ]
};

// Bigger things that stay on this computer only.
const AERO_LOCAL_DEFAULTS = {
  layout: {},
  tasks: [],
  notes: "",
  musicQueue: [],
  musicIndex: 0,
  weatherCache: null,
  poppedTotal: 0,
  wallpaperImage: null
};

// When a page is opened outside the extension (e.g. for testing), fall back to localStorage.
const hasChromeStorage = typeof chrome !== "undefined" && chrome.storage;

function makeStore(area, key, defaults) {
  return {
    async load() {
      if (hasChromeStorage) return chrome.storage[area].get(defaults);
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      return { ...defaults, ...saved };
    },
    async save(changes) {
      if (hasChromeStorage) return chrome.storage[area].set(changes);
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      localStorage.setItem(key, JSON.stringify({ ...saved, ...changes }));
    }
  };
}

const syncStore = makeStore("sync", "aero", AERO_DEFAULTS);
const localStore = makeStore("local", "aero-local", AERO_LOCAL_DEFAULTS);

// Widgets added in later versions should still show up for people with saved settings.
const loadSettings = async () => {
  const s = await syncStore.load();
  s.widgets = { ...AERO_DEFAULTS.widgets, ...s.widgets };
  return s;
};
const saveSettings = (changes) => syncStore.save(changes);

// Bubbly sounds made with the Web Audio API, so no sound files are needed.
const AeroSound = {
  ctx: null,
  enabled: true,

  _ctx() {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  },

  _tone(type, from, to, duration, volume) {
    if (!this.enabled) return;
    const ctx = this._ctx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  },

  // Rising "bloop" like a bubble coming up through water.
  bloop() {
    this._tone("sine", 300, 900, 0.18, 0.25);
  },

  // Quick high "pop" for popping bubbles.
  pop() {
    this._tone("sine", 1200 + Math.random() * 600, 2400, 0.07, 0.2);
  },

  // Soft glassy tick for toggles and buttons.
  click() {
    this._tone("triangle", 1800, 1400, 0.05, 0.12);
  },

  // Little two-note chime.
  chime() {
    this._tone("sine", 880, 880, 0.35, 0.15);
    setTimeout(() => this._tone("sine", 1320, 1320, 0.45, 0.12), 110);
  }
};
