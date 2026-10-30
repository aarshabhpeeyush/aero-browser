// Aero Browser — Power: a CPU and RAM manager, like Opera GX Control, plus a battery saver.
// Every 2 seconds it measures how much the browser and each tab use, and if you've switched on a limiter:
//   RAM limiter: puts background tabs you haven't used for a while to sleep until memory is back under the limit.
//   CPU limiter: slows down busy background tabs (never the one you're looking at or one playing sound).
//   Battery saver: slows down all background tabs and naps tabs left alone for 10 minutes.
// To keep things smooth, the tab you were just on is never slowed or put to sleep, tabs go to sleep
// one at a time (not all at once), and a sleeping tab starts waking as soon as you point at it.

const os = require("os");
const { app, ipcMain, powerMonitor } = require("electron");

const DEFAULTS = { ramOn: false, ramLimit: 2048, cpuOn: false, cpuLimit: 40, batterySaver: "auto" };
const SLOW_DOWN = 3; // background tabs run this many times slower while a limiter is slowing them
const HISTORY = 60;
const SLEEP_COOLDOWN = 8000; // at most one tab put to sleep every 8 seconds
const RECENT = 2 * 60 * 1000; // tabs used in the last 2 minutes are left alone (unless memory is way over)
const SAVER_NAP = 10 * 60 * 1000; // battery saver naps tabs left alone this long

function setupPower(ctx) {
  // ctx: { tabs, isActive(id), visibleIds(), send, settings(), saveSettings(s), sleepTab(id), wakeTab(id) }
  const settings = { ...DEFAULTS, ...ctx.settings() };
  const cores = os.cpus().length || 1;
  const history = [];
  const lastUsed = new Map();
  const slowed = new Set();
  let calmTicks = 0;
  let sleptCount = 0;
  let lastSleep = 0;
  let previousTab = null; // the tab you were on before this one
  let lastTouched = null;

  const onBattery = () => {
    try { return powerMonitor.isOnBatteryPower(); } catch { return false; }
  };
  const saverActive = () => settings.batterySaver === "on" || (settings.batterySaver === "auto" && onBattery());

  async function setSlowdown(tabId, rate) {
    const wc = ctx.tabs.get(tabId)?.view.webContents;
    if (!wc || wc.isDestroyed()) return slowed.delete(tabId);
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
      await wc.debugger.sendCommand("Emulation.setCPUThrottlingRate", { rate });
      if (rate === 1) wc.debugger.detach();
    } catch {
      // Developer tools being open can block this; just skip that tab.
    }
    rate === 1 ? slowed.delete(tabId) : slowed.add(tabId);
  }

  const releaseAll = () => [...slowed].forEach(id => setSlowdown(id, 1));

  function sample() {
    const metrics = app.getAppMetrics();
    const byPid = new Map(metrics.map(m => [m.pid, m]));
    let cpu = 0;
    let ram = 0;
    for (const m of metrics) {
      cpu += m.cpu.percentCPUUsage;
      ram += m.memory.workingSetSize; // in KB
    }
    cpu /= cores;
    ram /= 1024;

    const visible = new Set(ctx.visibleIds());
    const tabList = [];
    for (const [id, t] of ctx.tabs) {
      const wc = t.view.webContents;
      if (!wc || wc.isDestroyed()) continue;
      const m = byPid.get(wc.getOSProcessId());
      tabList.push({
        id,
        profileId: t.profileId,
        title: t.sleeping?.title || wc.getTitle() || "New Tab",
        favicon: t.favicon || null,
        builtIn: wc.getURL().startsWith("aero:") && !t.sleeping,
        ram: m ? m.memory.workingSetSize / 1024 : 0,
        cpu: m ? m.cpu.percentCPUUsage / cores : 0,
        sleeping: !!t.sleeping,
        active: ctx.isActive(id),
        visible: visible.has(id),
        audible: wc.isCurrentlyAudible(),
        slowed: slowed.has(id)
      });
    }

    history.push({ cpu, ram });
    if (history.length > HISTORY) history.shift();

    enforce(cpu, ram, tabList);

    ctx.send("perf:stats", {
      cpu, ram, history, settings, sleptCount,
      saver: { active: saverActive(), onBattery: onBattery() },
      systemRam: { total: os.totalmem() / 1048576, free: os.freemem() / 1048576 },
      tabs: tabList.sort((a, b) => b.ram - a.ram)
    });
  }

  // Background tabs that are safe to sleep or slow: not on screen, not playing sound,
  // and not the tab you were just on (so flipping between two tabs stays instant).
  const background = tabList => tabList.filter(t =>
    !t.active && !t.visible && !t.audible && !t.sleeping && !t.builtIn && t.id !== previousTab);
  const idleFor = t => Date.now() - (lastUsed.get(t.id) || 0);

  function sleepOne(candidates) {
    if (!candidates.length || Date.now() - lastSleep < SLEEP_COOLDOWN) return;
    const victim = candidates.sort((a, b) => idleFor(b) - idleFor(a))[0];
    ctx.sleepTab(victim.id);
    sleptCount++;
    lastSleep = Date.now();
  }

  function enforce(cpu, ram, tabList) {
    const bg = background(tabList);
    const saver = saverActive();

    // RAM limiter: sleep the longest-unused tab, but leave recently used ones alone unless memory is way over.
    if (settings.ramOn && ram > settings.ramLimit) {
      const wayOver = ram > settings.ramLimit * 1.3;
      sleepOne(bg.filter(t => wayOver || idleFor(t) > RECENT));
    }

    // Battery saver: nap tabs that have been left alone for a long time.
    if (saver) sleepOne(bg.filter(t => idleFor(t) > SAVER_NAP));

    // CPU limiter / battery saver: slow down background tabs.
    const overCpu = settings.cpuOn && cpu > settings.cpuLimit;
    if (overCpu || saver) {
      calmTicks = 0;
      for (const t of bg) if (!slowed.has(t.id)) setSlowdown(t.id, SLOW_DOWN);
    } else if (slowed.size && (!settings.cpuOn || cpu < settings.cpuLimit * 0.6) && ++calmTicks >= 5) {
      releaseAll();
    }
    // Anything now on screen (or the tab you were just on) is never left slowed down.
    for (const t of tabList) if (slowed.has(t.id) && (t.active || t.visible || t.id === previousTab)) setSlowdown(t.id, 1);
  }

  ipcMain.on("perf:settings", (e, changes = {}) => {
    if (typeof changes.ramOn === "boolean") settings.ramOn = changes.ramOn;
    if (typeof changes.cpuOn === "boolean") settings.cpuOn = changes.cpuOn;
    if (Number.isFinite(changes.ramLimit)) settings.ramLimit = Math.min(65536, Math.max(256, changes.ramLimit));
    if (Number.isFinite(changes.cpuLimit)) settings.cpuLimit = Math.min(100, Math.max(5, changes.cpuLimit));
    if (["off", "on", "auto"].includes(changes.batterySaver)) settings.batterySaver = changes.batterySaver;
    if (!settings.cpuOn && !saverActive()) releaseAll();
    ctx.saveSettings({ ...settings });
  });

  ipcMain.on("tab:sleep", (e, id) => {
    if (!ctx.isActive(id) && ctx.tabs.has(id)) {
      ctx.sleepTab(id);
      sleptCount++;
    }
  });

  // Pointing at a sleeping tab starts waking it, so it's ready by the time you click.
  ipcMain.on("tab:prewake", (e, id) => {
    if (ctx.tabs.get(id)?.sleeping) ctx.wakeTab(id);
  });

  setInterval(sample, 2000);

  return {
    // The tab you switch to is "used" now, and never stays slowed down.
    touch(tabId) {
      if (lastTouched !== tabId) previousTab = lastTouched;
      lastTouched = tabId;
      lastUsed.set(tabId, Date.now());
      if (slowed.has(tabId)) setSlowdown(tabId, 1);
    },
    forget(tabId) {
      lastUsed.delete(tabId);
      slowed.delete(tabId);
      if (previousTab === tabId) previousTab = null;
    },
    saverActive
  };
}

module.exports = { setupPower };
