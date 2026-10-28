// Gives the browser UI a small, safe set of messages it can send to (and get from) the engine.
const { contextBridge, ipcRenderer } = require("electron");

const TO_ENGINE = [
  "ui:ready", "tab:new", "tab:close", "tab:activate",
  "nav:go", "nav:back", "nav:forward", "nav:reload", "nav:stop", "nav:home",
  "view:bounds", "set:restyle", "set:search", "win:min", "win:max", "win:close",
  "profile:switch", "profile:add", "profile:update", "profile:delete", "profile:refresh",
  "theme:set", "theme:install", "theme:open-folder", "whatsnew:open", "update:check", "update:restart",
  "pw:save", "pw:never", "pw:dismiss", "pw:fill", "pw:refresh", "pw:unlock", "pw:reveal", "pw:copy",
  "pw:upsert", "pw:delete", "pw:unnever", "pw:set-pin",
  "perf:settings", "tab:sleep", "signin:set-mode"
];
const FROM_ENGINE = [
  "tab:created", "tab:update", "tab:activated", "tab:closed", "ui:focus-address", "ui:resend-bounds", "win:state",
  "profiles", "themes", "app:info", "update:status",
  "pw:list", "pw:status", "pw:offer", "pw:fillable", "pw:revealed", "perf:stats"
];

contextBridge.exposeInMainWorld("aero", {
  send(channel, data) {
    if (TO_ENGINE.includes(channel)) ipcRenderer.send(channel, data);
  },
  on(channel, fn) {
    if (FROM_ENGINE.includes(channel)) ipcRenderer.on(channel, (e, data) => fn(data));
  }
});
