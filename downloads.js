// Aero Browser — downloads.
// Files go straight into your Downloads folder (like Chrome), and the ⬇ panel shows their progress.

const fs = require("fs");
const path = require("path");
const { app, ipcMain, shell } = require("electron");

function setupDownloads({ send }) {
  const items = []; // newest first: { id, name, file, url, received, total, state, item }
  let nextId = 1;
  let sendTimer = null;

  const publicList = () => items.map(({ item, ...rest }) => rest);
  const sendSoon = () => {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => send("downloads:list", publicList()), 200);
  };

  // "photo.png" becomes "photo (1).png" if a file with that name is already there.
  function freePath(folder, name) {
    const ext = path.extname(name);
    const base = path.basename(name, ext) || "download";
    let file = path.join(folder, base + ext);
    for (let i = 1; fs.existsSync(file) || items.some(d => d.file === file && d.state === "downloading"); i++) {
      file = path.join(folder, `${base} (${i})${ext}`);
    }
    return file;
  }

  function track(item) {
    const name = item.getFilename().replace(/[\\/:*?"<>|]+/g, "_") || "download";
    const file = freePath(app.getPath("downloads"), name);
    item.setSavePath(file);
    const d = { id: nextId++, name: path.basename(file), file, url: item.getURL(), received: 0, total: item.getTotalBytes(), state: "downloading", item };
    items.unshift(d);
    if (items.length > 50) items.pop();
    send("downloads:started", { name: d.name });
    item.on("updated", (e, state) => {
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      d.state = state === "interrupted" ? "interrupted" : item.isPaused() ? "paused" : "downloading";
      sendSoon();
    });
    item.once("done", (e, state) => {
      d.received = item.getReceivedBytes();
      d.state = state === "completed" ? "done" : state === "cancelled" ? "cancelled" : "failed";
      d.item = null;
      send("downloads:finished", { name: d.name, state: d.state });
      sendSoon();
    });
    sendSoon();
  }

  const find = id => items.find(d => d.id === id);
  ipcMain.on("downloads:refresh", () => send("downloads:list", publicList()));
  ipcMain.on("downloads:open", (e, id) => { const d = find(id); if (d?.state === "done") shell.openPath(d.file); });
  ipcMain.on("downloads:show", (e, id) => { const d = find(id); if (d) shell.showItemInFolder(d.file); });
  ipcMain.on("downloads:cancel", (e, id) => find(id)?.item?.cancel());
  ipcMain.on("downloads:pause", (e, id) => {
    const item = find(id)?.item;
    if (item) item.isPaused() ? item.resume() : item.pause();
  });
  ipcMain.on("downloads:clear", () => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].state !== "downloading" && items[i].state !== "paused") items.splice(i, 1);
    send("downloads:list", publicList());
  });
  ipcMain.on("downloads:folder", () => shell.openPath(app.getPath("downloads")));

  return {
    // Call once for every session (profile) so its downloads are handled too.
    addSession(ses) {
      ses.on("will-download", (e, item) => track(item));
    }
  };
}

module.exports = { setupDownloads };
