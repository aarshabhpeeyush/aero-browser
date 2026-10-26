// Gives the browser UI a small, safe set of messages it can send to (and get from) the engine.
const { contextBridge, ipcRenderer } = require("electron");

const TO_ENGINE = [
  "ui:ready", "tab:new", "tab:close", "tab:activate",
  "nav:go", "nav:back", "nav:forward", "nav:reload", "nav:stop", "nav:home",
  "view:bounds", "set:restyle", "set:search", "win:min", "win:max", "win:close",
  "profile:switch", "profile:add", "profile:update", "profile:delete", "profile:refresh",
  "theme:set", "theme:install", "theme:open-folder", "whatsnew:open", "update:check", "update:restart"
];
const FROM_ENGINE = [
  "tab:created", "tab:update", "tab:activated", "tab:closed", "ui:focus-address", "win:state",
  "profiles", "themes", "app:info", "update:status"
];

contextBridge.exposeInMainWorld("aero", {
  send(channel, data) {
    if (TO_ENGINE.includes(channel)) ipcRenderer.send(channel, data);
  },
  on(channel, fn) {
    if (FROM_ENGINE.includes(channel)) ipcRenderer.on(channel, (e, data) => fn(data));
  }
});
