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
  "perf:settings", "tab:sleep", "signin:set-mode",
  "tab:reopen", "tab:menu", "tab:prewake", "split:toggle", "incognito:open", "incognito:close",
  "app:open", "app:close", "app:remove", "app:bounds", "set:adblock", "set:hide-ai",
  "split:ratio", "split:drag", "store:open", "ext:popup", "extensions:refresh", "default:check", "default:set",
  "downloads:refresh", "downloads:open", "downloads:show", "downloads:cancel", "downloads:pause", "downloads:clear", "downloads:folder",
  "bookmarks:sources", "bookmarks:import-browser", "bookmarks:import-file", "bookmarks:export-file"
];
const FROM_ENGINE = [
  "tab:created", "tab:update", "tab:activated", "tab:closed", "ui:focus-address", "ui:resend-bounds", "win:state",
  "profiles", "themes", "app:info", "update:status",
  "pw:list", "pw:status", "pw:offer", "pw:fillable", "pw:revealed", "perf:stats",
  "split:state", "ui:fullscreen", "adblock:counts", "settings",
  "downloads:list", "downloads:started", "downloads:finished", "extensions:list", "default:status",
  "bookmarks:sources", "bookmarks:imported", "bookmarks:exported"
];

contextBridge.exposeInMainWorld("aero", {
  send(channel, data) {
    if (TO_ENGINE.includes(channel)) ipcRenderer.send(channel, data);
  },
  on(channel, fn) {
    if (FROM_ENGINE.includes(channel)) ipcRenderer.on(channel, (e, data) => fn(data));
  }
});
