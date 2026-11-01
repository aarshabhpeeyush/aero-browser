// Beat Lab: a drum machine, two DJ decks, a mixer, a recorder and lessons, all made with the
// browser's built-in sound engine (the Web Audio API). Nothing is uploaded anywhere.

const $ = sel => document.querySelector(sel);
const ctx = new AudioContext();
const resume = () => ctx.state === "suspended" && ctx.resume();
addEventListener("pointerdown", resume, true);

// Sound path: drums and both decks → master volume → speakers (and the recorder).
const master = ctx.createGain();
master.gain.value = 0.85;
master.connect(ctx.destination);
const recordTap = ctx.createMediaStreamDestination();
master.connect(recordTap);
$("#master").addEventListener("input", e => (master.gain.value = +e.target.value));

function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3200);
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ===================== Drum machine =====================
// Every drum is made from scratch with oscillators and noise, so no sound files are needed.

const drumBus = ctx.createGain();
drumBus.gain.value = 0.8;
drumBus.connect(master);
$("#drumVol").addEventListener("input", e => (drumBus.gain.value = +e.target.value));

const noiseBuffer = (() => {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
})();
const envelope = (t, peak, length) => {
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + length);
  g.connect(drumBus);
  return g;
};
const noise = (t, length, type, freq, peak, q = 1) => {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(envelope(t, peak, length));
  src.start(t);
  src.stop(t + length + 0.05);
};
const tone = (t, type, from, to, length, peak) => {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + length * 0.8);
  o.connect(envelope(t, peak, length));
  o.start(t);
  o.stop(t + length + 0.05);
};

const DRUMS = [
  { id: "kick", name: "Kick", c1: "#9fd8ff", c2: "#1e7fd8", play: t => tone(t, "sine", 150, 42, 0.45, 1) },
  { id: "snare", name: "Snare", c1: "#ffd0a0", c2: "#ff7a1a", play: t => { noise(t, 0.18, "highpass", 1200, 0.7); tone(t, "triangle", 220, 160, 0.1, 0.5); } },
  { id: "clap", name: "Clap", c1: "#ffb3f0", c2: "#d01aa8", play: t => [0, 0.012, 0.024].forEach((d, i) => noise(t + d, i === 2 ? 0.16 : 0.03, "bandpass", 1600, 0.8, 1.5)) },
  { id: "hat", name: "Hi-hat", c1: "#fff3a0", c2: "#e0b000", play: t => noise(t, 0.05, "highpass", 7500, 0.45) },
  { id: "open", name: "Open hat", c1: "#e8ffa0", c2: "#7ac000", play: t => noise(t, 0.32, "highpass", 7000, 0.4) },
  { id: "tom", name: "Tom", c1: "#d0b8ff", c2: "#6a3bd8", play: t => tone(t, "sine", 220, 110, 0.32, 0.8) }
];
const STEPS = 16;
const pattern = Object.fromEntries(DRUMS.map(d => [d.id, new Array(STEPS).fill(false)]));

const PRESETS = {
  four: { kick: [0, 4, 8, 12], clap: [4, 12], hat: [2, 6, 10, 14], open: [14] },
  hiphop: { kick: [0, 3, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  break: { kick: [0, 10], snare: [4, 12, 15], hat: [0, 2, 4, 6, 8, 10, 12, 14], tom: [7] },
  reggaeton: { kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hat: [0, 2, 4, 6, 8, 10, 12, 14] }
};

// Draw the grid
const grid = $("#grid");
grid.append(document.createElement("span"));
for (let s = 0; s < STEPS; s++) {
  const n = document.createElement("span");
  n.className = "step-num";
  n.textContent = s % 4 === 0 ? s / 4 + 1 : "·";
  grid.append(n);
}
const cells = {};
for (const d of DRUMS) {
  const name = document.createElement("div");
  name.className = "row-name";
  name.innerHTML = `<button title="Hear it">🔊</button><span></span>`;
  name.querySelector("span").textContent = d.name;
  name.querySelector("button").addEventListener("click", () => { resume(); d.play(ctx.currentTime + 0.01); });
  grid.append(name);
  cells[d.id] = [];
  for (let s = 0; s < STEPS; s++) {
    const c = document.createElement("button");
    c.className = "cell" + (Math.floor(s / 4) % 2 ? " alt" : "");
    c.style.setProperty("--c1", d.c1);
    c.style.setProperty("--c2", d.c2);
    c.title = `${d.name}, step ${s + 1}`;
    c.addEventListener("click", () => {
      pattern[d.id][s] = !pattern[d.id][s];
      c.classList.toggle("on", pattern[d.id][s]);
      if (pattern[d.id][s] && !drumsPlaying) { resume(); d.play(ctx.currentTime + 0.01); }
    });
    grid.append(c);
    cells[d.id].push(c);
  }
}
const drawPattern = () => DRUMS.forEach(d => cells[d.id].forEach((c, s) => c.classList.toggle("on", pattern[d.id][s])));

// Playing: a small timer looks a little ahead and books each step at its exact time.
let drumsPlaying = false;
let nextStep = 0;
let nextTime = 0;
let stepQueue = [];
let schedulerTimer = null;
const drumBpm = () => Math.min(190, Math.max(60, +$("#drumBpm").value || 110));
function scheduler() {
  while (nextTime < ctx.currentTime + 0.12) {
    for (const d of DRUMS) if (pattern[d.id][nextStep]) d.play(nextTime);
    stepQueue.push({ step: nextStep, time: nextTime });
    nextTime += 60 / drumBpm() / 4; // 16th notes
    nextStep = (nextStep + 1) % STEPS;
  }
}
function setDrums(on) {
  resume();
  drumsPlaying = on;
  $("#drumPlay").textContent = on ? "■ Stop" : "▶ Play";
  $("#drumPlay").classList.toggle("on", on);
  clearInterval(schedulerTimer);
  document.querySelectorAll(".cell.now").forEach(c => c.classList.remove("now"));
  if (on) {
    nextStep = 0;
    nextTime = ctx.currentTime + 0.06;
    stepQueue = [];
    scheduler();
    schedulerTimer = setInterval(scheduler, 25);
  }
}
$("#drumPlay").addEventListener("click", () => setDrums(!drumsPlaying));
$("#drumClear").addEventListener("click", () => { DRUMS.forEach(d => pattern[d.id].fill(false)); drawPattern(); });
$("#preset").addEventListener("change", e => {
  const p = PRESETS[e.target.value];
  if (!p) return;
  DRUMS.forEach(d => pattern[d.id].fill(false));
  for (const [id, steps] of Object.entries(p)) steps.forEach(s => (pattern[id][s] = true));
  drawPattern();
  e.target.value = "";
});
$("#drumSync").addEventListener("click", () => {
  const bpm = decks.A.effectiveBpm();
  if (!bpm) return toast("Load a song on Deck A first");
  $("#drumBpm").value = Math.round(bpm);
  toast(`Drums set to ${Math.round(bpm)} BPM`);
});

// ===================== BPM finder =====================
// Looks at how loud the song is moment to moment, finds the "thumps", and checks which beat
// speed (70–180 BPM) lines up with them best.
function detectBpm(buffer) {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const hop = 512;
  const startAt = Math.floor(Math.max(0, buffer.duration / 2 - 20) * rate);
  const endAt = Math.min(data.length, startAt + 40 * rate);
  const energy = [];
  for (let i = startAt; i + hop < endAt; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += data[j] * data[j];
    energy.push(Math.sqrt(sum / hop));
  }
  const onset = energy.map((e, i) => Math.max(0, e - (energy[i - 1] ?? e)));
  const fps = rate / hop;
  let best = 0;
  let bestLag = 0;
  const scores = [];
  for (let lag = Math.floor((fps * 60) / 180); lag <= Math.ceil((fps * 60) / 70); lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    scores[lag] = s;
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!bestLag) return null;
  // Fine-tune between neighbouring frames for a more exact answer.
  const a = scores[bestLag - 1] ?? best, c = scores[bestLag + 1] ?? best;
  const shift = (a - c) / (2 * (a - 2 * best + c) || 1);
  let bpm = (60 * fps) / (bestLag + (Math.abs(shift) < 1 ? shift : 0));
  while (bpm < 85) bpm *= 2;
  while (bpm > 175) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}

// ===================== Decks =====================

class Deck {
  constructor(name, el) {
    this.name = name;
    this.el = el;
    el.append($("#deckTemplate").content.cloneNode(true));
    el.querySelector(".deck-name").textContent = name;
    this.q = sel => el.querySelector(sel);
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.offset = 0; // seconds into the song
    this.startedAt = 0;
    this.cuePoint = 0;
    this.bpm = null;
    this.rate = 1;
    this.looping = false;

    // Sound path: song → low / mid / high EQ → volume → crossfader side → master
    this.low = Object.assign(ctx.createBiquadFilter(), { type: "lowshelf" });
    this.low.frequency.value = 250;
    this.mid = Object.assign(ctx.createBiquadFilter(), { type: "peaking" });
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 0.9;
    this.high = Object.assign(ctx.createBiquadFilter(), { type: "highshelf" });
    this.high.frequency.value = 4000;
    this.vol = ctx.createGain();
    this.vol.gain.value = 0.85;
    this.side = ctx.createGain();
    this.low.connect(this.mid).connect(this.high).connect(this.vol).connect(this.side).connect(master);

    this.q(".eq-low").addEventListener("input", e => (this.low.gain.value = +e.target.value));
    this.q(".eq-mid").addEventListener("input", e => (this.mid.gain.value = +e.target.value));
    this.q(".eq-high").addEventListener("input", e => (this.high.gain.value = +e.target.value));
    this.q(".vol").addEventListener("input", e => (this.vol.gain.value = +e.target.value));
    for (const sel of [".eq-low", ".eq-mid", ".eq-high"]) this.q(sel).addEventListener("dblclick", e => { e.target.value = 0; e.target.dispatchEvent(new Event("input")); });
    this.q(".tempo").addEventListener("input", e => this.setRate(1 + e.target.value / 100));
    this.q(".tempo").addEventListener("dblclick", e => { e.target.value = 0; this.setRate(1); });
    this.q(".play").addEventListener("click", () => (this.playing ? this.pause() : this.play()));
    this.q(".cue").addEventListener("click", () => this.seek(this.cuePoint));
    this.q(".setcue").addEventListener("click", () => { this.cuePoint = this.position(); toast(`Deck ${name}: cue set at ${fmt(this.cuePoint)}`); });
    this.q(".loop").addEventListener("click", () => this.toggleLoop());
    this.q(".sync").addEventListener("click", () => this.syncTo(this.other()));
    this.q("input[type=file]").addEventListener("change", e => e.target.files[0] && this.load(e.target.files[0]));
    this.q(".wave").addEventListener("click", e => {
      if (!this.buffer) return;
      const r = e.target.getBoundingClientRect();
      this.seek(((e.clientX - r.left) / r.width) * this.buffer.duration);
    });
    el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("dragover"); });
    el.addEventListener("dragleave", () => el.classList.remove("dragover"));
    el.addEventListener("drop", e => {
      e.preventDefault();
      el.classList.remove("dragover");
      const file = [...e.dataTransfer.files].find(f => f.type.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(f.name));
      if (file) this.load(file);
    });
  }

  other() { return this.name === "A" ? decks.B : decks.A; }

  async load(file) {
    resume();
    this.pause();
    this.q(".deck-title").textContent = "Loading " + file.name + "…";
    try {
      this.buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      this.q(".deck-title").textContent = "Couldn't read that file. Try an MP3 or WAV.";
      return;
    }
    this.title = file.name.replace(/\.[^.]+$/, "");
    this.q(".deck-title").textContent = this.title;
    this.q(".deck-title").title = file.name;
    this.offset = 0;
    this.cuePoint = 0;
    this.looping = false;
    this.q(".loop").classList.remove("on");
    this.el.querySelectorAll("button").forEach(b => (b.disabled = false));
    this.peaks = this.makePeaks();
    this.bpm = detectBpm(this.buffer);
    this.showBpm();
    this.draw();
  }

  makePeaks() {
    const data = this.buffer.getChannelData(0);
    const bars = 600;
    const size = Math.floor(data.length / bars);
    const peaks = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      for (let j = i * size; j < (i + 1) * size; j += 16) max = Math.max(max, Math.abs(data[j]));
      peaks.push(max);
    }
    return peaks;
  }

  position() {
    if (!this.buffer) return 0;
    let pos = this.playing ? this.offset + (ctx.currentTime - this.startedAt) * this.rate : this.offset;
    if (this.source?.loop && this.source.loopEnd > this.source.loopStart && pos > this.source.loopEnd) {
      const len = this.source.loopEnd - this.source.loopStart;
      pos = this.source.loopStart + ((pos - this.source.loopStart) % len);
    }
    return Math.min(pos, this.buffer.duration);
  }

  play() {
    if (!this.buffer) return;
    resume();
    if (this.offset >= this.buffer.duration - 0.05) this.offset = 0;
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this.rate;
    this.source.connect(this.low);
    if (this.looping) this.applyLoop(this.loopStart);
    this.source.start(0, this.offset);
    this.startedAt = ctx.currentTime;
    this.playing = true;
    const src = this.source;
    src.onended = () => {
      if (this.source !== src || !this.playing) return;
      this.playing = false;
      this.offset = 0;
      this.q(".play").textContent = "▶";
      this.q(".play").classList.remove("on");
    };
    this.q(".play").textContent = "❚❚";
    this.q(".play").classList.add("on");
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position();
    this.playing = false;
    try { this.source.stop(); } catch {}
    this.source = null;
    this.q(".play").textContent = "▶";
    this.q(".play").classList.remove("on");
  }

  seek(t) {
    const was = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(t, this.buffer?.duration || 0));
    if (was) this.play();
  }

  setRate(rate) {
    this.offset = this.position();
    this.startedAt = ctx.currentTime;
    this.rate = rate;
    if (this.source) this.source.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.02);
    const pct = (rate - 1) * 100;
    this.q(".tempo").value = pct.toFixed(1);
    this.q(".tempo-val").textContent = (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
    this.showBpm();
  }

  effectiveBpm() { return this.bpm ? this.bpm * this.rate : null; }
  showBpm() { this.q(".bpm-num").textContent = this.bpm ? this.effectiveBpm().toFixed(1) : "--"; }

  syncTo(other) {
    if (!this.bpm || !other.effectiveBpm()) return toast("Load songs on both decks to sync");
    const rate = other.effectiveBpm() / this.bpm;
    if (rate < 0.84 || rate > 1.16) return toast("These songs' speeds are too far apart to sync (more than 16%)");
    this.setRate(rate);
    toast(`Deck ${this.name} now matches Deck ${other.name}: ${other.effectiveBpm().toFixed(1)} BPM`);
  }

  // Loop the next 4 beats, so you can keep a part going while you mix.
  applyLoop(start) {
    const beat = 60 / (this.bpm || 120);
    this.source.loop = true;
    this.source.loopStart = start;
    this.source.loopEnd = Math.min(start + beat * 4, this.buffer.duration);
  }
  toggleLoop() {
    if (!this.buffer) return;
    this.looping = !this.looping;
    this.q(".loop").classList.toggle("on", this.looping);
    if (this.looping) {
      this.loopStart = this.position();
      if (this.source) this.applyLoop(this.loopStart);
    } else if (this.source) {
      this.offset = this.position();
      this.startedAt = ctx.currentTime;
      this.source.loop = false;
    }
  }

  draw() {
    const c = this.q(".wave");
    const w = (c.width = c.clientWidth * devicePixelRatio || 600);
    const h = (c.height = 90 * devicePixelRatio);
    const g = c.getContext("2d");
    g.clearRect(0, 0, w, h);
    if (!this.peaks) return;
    const played = this.position() / this.buffer.duration;
    const color = this.name === "A" ? ["#7fd0ff", "#2a6fa8"] : ["#ff9ae6", "#a8307e"];
    const bw = w / this.peaks.length;
    this.peaks.forEach((p, i) => {
      const bh = Math.max(2, p * h * 0.95);
      g.fillStyle = i / this.peaks.length < played ? color[1] : color[0];
      g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.5), bh);
    });
    if (this.looping && this.source) {
      g.fillStyle = "rgba(255, 220, 80, 0.25)";
      const d = this.buffer.duration;
      g.fillRect((this.source.loopStart / d) * w, 0, ((this.source.loopEnd - this.source.loopStart) / d) * w, h);
    }
    g.fillStyle = "#fff";
    g.fillRect(played * w - 1, 0, 2 * devicePixelRatio, h);
    g.fillStyle = "#ffd84a";
    g.fillRect((this.cuePoint / this.buffer.duration) * w - 1, 0, 2, 10 * devicePixelRatio);
    this.q(".time").textContent = `${fmt(this.position())} / ${fmt(this.buffer.duration)}`;
  }
}

const decks = { A: new Deck("A", $(".deck[data-deck=A]")), B: new Deck("B", $(".deck[data-deck=B]")) };

// Crossfader: an "equal power" curve, so the middle isn't quieter than the sides.
let xMin = 0.5;
let xMax = 0.5;
function setX(x) {
  decks.A.side.gain.value = Math.cos((x * Math.PI) / 2);
  decks.B.side.gain.value = Math.sin((x * Math.PI) / 2);
  if (decks.A.playing && decks.B.playing) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
}
$("#xfade").addEventListener("input", e => setX(+e.target.value));
$("#xCenter").addEventListener("click", () => { $("#xfade").value = 0.5; setX(0.5); });
setX(0.5);

// ===================== Recorder =====================
let recorder = null;
let recStart = 0;
let recordedOnce = false;
$("#rec").addEventListener("click", () => {
  resume();
  if (recorder) return recorder.stop();
  const chunks = [];
  recorder = new MediaRecorder(recordTap.stream);
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
    a.download = `Beat Lab mix ${stamp}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    recorder = null;
    recordedOnce = true;
    $("#rec").textContent = "● Record";
    $("#recTime").textContent = "";
    toast("Your mix was saved to Downloads 🎉");
  };
  recorder.start(1000);
  recStart = performance.now();
  $("#rec").textContent = "■ Stop & save";
});

// ===================== Lessons =====================
const has = (id, steps) => steps.every(s => pattern[id][s]);
const LESSONS = [
  { title: "Your first beat", text: "Click the Kick squares on steps 1, 5, 9 and 13 (the first square of each group of four).", check: () => has("kick", [0, 4, 8, 12]) },
  { title: "Add a backbeat", text: "Add a Snare or Clap on steps 5 and 13. That's the “2 and 4” in almost every song.", check: () => has("snare", [4, 12]) || has("clap", [4, 12]) },
  { title: "Let it play", text: "Press ▶ Play on the drum machine, then add hi-hats while it plays.", check: () => drumsPlaying && pattern.hat.filter(Boolean).length >= 2 },
  { title: "Load two songs", text: "Load a song on Deck A and another on Deck B. Beat Lab finds each song's BPM (beats per minute).", check: () => decks.A.buffer && decks.B.buffer },
  { title: "Match the speed", text: "Play both decks, then press Sync on one of them so their BPMs match. That's called beatmatching.", check: () => decks.A.playing && decks.B.playing && Math.abs(decks.A.effectiveBpm() - decks.B.effectiveBpm()) < 0.6 },
  { title: "Crossfade", text: "With both songs playing, slide the crossfader all the way from one side to the other.", check: () => xMin < 0.1 && xMax > 0.9 },
  { title: "Record a mix", text: "Press ● Record, mix for a bit, then press Stop & save. Your mix goes to Downloads.", check: () => recordedOnce }
];
const doneLessons = new Set();
try { JSON.parse(localStorage.getItem("beatlab-lessons") || "[]").forEach(i => doneLessons.add(i)); } catch {}
function drawLessons() {
  const list = $("#lessonList");
  list.innerHTML = "";
  const current = LESSONS.findIndex((_, i) => !doneLessons.has(i));
  LESSONS.forEach((l, i) => {
    const li = document.createElement("li");
    li.dataset.n = i + 1;
    li.className = doneLessons.has(i) ? "done" : i === current ? "current" : "";
    li.innerHTML = "<b></b><span></span>";
    li.querySelector("b").textContent = l.title;
    li.querySelector("span").textContent = l.text;
    list.append(li);
  });
  $("#lessonBar").style.width = (doneLessons.size / LESSONS.length) * 100 + "%";
}
function checkLessons() {
  let changed = false;
  LESSONS.forEach((l, i) => {
    if (!doneLessons.has(i) && l.check()) {
      doneLessons.add(i);
      changed = true;
      toast(doneLessons.size === LESSONS.length ? "🏆 All lessons done! You're a DJ now." : `✓ Lesson done: ${l.title}`);
    }
  });
  if (changed) {
    try { localStorage.setItem("beatlab-lessons", JSON.stringify([...doneLessons])); } catch {}
    drawLessons();
  }
}
drawLessons();
setInterval(checkLessons, 400);

// ===================== Animation =====================
function frame() {
  // Light up the step that's playing right now.
  while (stepQueue.length > 1 && stepQueue[1].time <= ctx.currentTime) stepQueue.shift();
  if (drumsPlaying && stepQueue[0] && stepQueue[0].time <= ctx.currentTime) {
    const s = stepQueue[0].step;
    if (frame.lastStep !== s) {
      document.querySelectorAll(".cell.now").forEach(c => c.classList.remove("now"));
      DRUMS.forEach(d => cells[d.id][s].classList.add("now"));
      frame.lastStep = s;
    }
  }
  decks.A.draw();
  decks.B.draw();
  if (recorder) $("#recTime").textContent = fmt((performance.now() - recStart) / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ===================== Look =====================
// Floating bubbles in the sky.
for (let i = 0; i < 12; i++) {
  const b = document.createElement("span");
  const size = 16 + Math.random() * 56;
  b.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${16 + Math.random() * 18}s;animation-delay:${-Math.random() * 30}s;--drift:${(Math.random() - 0.5) * 120}px`;
  $("#bubbles").append(b);
}
// If your Aero theme makes the glass dark, switch the text to light colours.
function matchGlass() {
  const cs = getComputedStyle(document.querySelector(".glass"));
  const colors = (cs.backgroundImage + " " + cs.backgroundColor).match(/rgba?\([^)]+\)/g) || [];
  const solid = colors.map(c => c.match(/[\d.]+/g).map(Number)).filter(v => v.length < 4 || v[3] > 0.25);
  if (!solid.length) return;
  const light = solid.reduce((sum, [r, g, b]) => sum + (0.299 * r + 0.587 * g + 0.114 * b), 0) / solid.length;
  document.body.classList.toggle("dark-glass", light < 128);
}
$("#aeroTheme").addEventListener("load", matchGlass);
matchGlass();
