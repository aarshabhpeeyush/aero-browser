// Aero Browser — Power: a CPU and RAM manager, like Opera GX Control.
// Every 2 seconds it measures how much the browser and each tab use, and if you've switched on a limiter:
//   RAM limiter: puts the background tabs you haven't used for longest to sleep until memory is back under the limit.
//   CPU limiter: slows down busy background tabs (never the one you're looking at or one playing sound).

const os = require("os");
const { app, ipcMain } = require("electron");

const DEFAULTS = { ramOn: false, ramLimit: 2048, cpuOn: false, cpuLimit: 40 };
const SLOW_DOWN = 6; // background tabs run this many times slower while the CPU limiter is active
const HISTORY = 60;

function setupPower(ctx) {
  // ctx: { tabs, activeId(), send, settings(), saveSettings(s), sleepTab(id) }
  const settings = { ...DEFAULTS, ...ctx.settings() };
  const cores = os.cpus().length || 1;
  const history = [];
  const lastUsed = new Map();
  const slowed = new Set();
  let calmTicks = 0;
  let sleptCount = 0;

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

    const tabList = [];
    for (const [id, t] of ctx.tabs) {
      const wc = t.view.webContents;
      if (wc.isDestroyed()) continue;
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
        active: id === ctx.activeId(),
        audible: wc.isCurrentlyAudible(),
        slowed: slowed.has(id)
      });
    }

    history.push({ cpu, ram });
    if (history.length > HISTORY) history.shift();

    enforce(cpu, ram, tabList);

    ctx.send("perf:stats", {
      cpu, ram, history, settings, sleptCount,
      systemRam: { total: os.totalmem() / 1048576, free: os.freemem() / 1048576 },
      tabs: tabList.sort((a, b) => b.ram - a.ram)
    });
  }

  // Background tabs that are safe to sleep or slow: not the one you're on, not playing sound.
  const background = tabList => tabList.filter(t => !t.active && !t.audible && !t.sleeping && !t.builtIn);

  function enforce(cpu, ram, tabList) {
    if (settings.ramOn && ram > settings.ramLimit) {
      const victim = background(tabList).sort((a, b) => (lastUsed.get(a.id) || 0) - (lastUsed.get(b.id) || 0))[0];
      if (victim) {
        ctx.sleepTab(victim.id);
        sleptCount++;
      }
    }

    if (settings.cpuOn && cpu > settings.cpuLimit) {
      calmTicks = 0;
      for (const t of background(tabList)) if (!slowed.has(t.id)) setSlowdown(t.id, SLOW_DOWN);
    } else if (slowed.size && (!settings.cpuOn || cpu < settings.cpuLimit * 0.6) && ++calmTicks >= 5) {
      releaseAll();
    }
  }

  ipcMain.on("perf:settings", (e, changes = {}) => {
    if (typeof changes.ramOn === "boolean") settings.ramOn = changes.ramOn;
    if (typeof changes.cpuOn === "boolean") settings.cpuOn = changes.cpuOn;
    if (Number.isFinite(changes.ramLimit)) settings.ramLimit = Math.min(65536, Math.max(256, changes.ramLimit));
    if (Number.isFinite(changes.cpuLimit)) settings.cpuLimit = Math.min(100, Math.max(5, changes.cpuLimit));
    if (!settings.cpuOn) releaseAll();
    ctx.saveSettings({ ...settings });
  });

  ipcMain.on("tab:sleep", (e, id) => {
    if (id !== ctx.activeId() && ctx.tabs.has(id)) {
      ctx.sleepTab(id);
      sleptCount++;
    }
  });

  setInterval(sample, 2000);

  return {
    // The tab you switch to is "used" now, and never stays slowed down.
    touch(tabId) {
      lastUsed.set(tabId, Date.now());
      if (slowed.has(tabId)) setSlowdown(tabId, 1);
    },
    forget(tabId) {
      lastUsed.delete(tabId);
      slowed.delete(tabId);
    }
  };
}

module.exports = { setupPower };
