// Aero Browser — bookmark transfer.
// Imports bookmarks from other browsers on this computer (Chrome, Edge, Brave, Opera GX), and imports
// or exports the standard bookmarks file that every browser understands.

const fs = require("fs");
const path = require("path");
const { app, ipcMain, dialog, BrowserWindow } = require("electron");

const local = process.env.LOCALAPPDATA || "";
const roaming = process.env.APPDATA || "";
const BROWSERS = [
  { id: "chrome", name: "Chrome", file: path.join(local, "Google", "Chrome", "User Data", "Default", "Bookmarks") },
  { id: "edge", name: "Edge", file: path.join(local, "Microsoft", "Edge", "User Data", "Default", "Bookmarks") },
  { id: "brave", name: "Brave", file: path.join(local, "BraveSoftware", "Brave-Browser", "User Data", "Default", "Bookmarks") },
  { id: "operagx", name: "Opera GX", file: path.join(roaming, "Opera Software", "Opera GX Stable", "Bookmarks") }
];

// Chromium browsers keep bookmarks as a tree of folders; flatten it, bookmarks bar first.
function readChromiumBookmarks(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  const walk = node => {
    if (!node) return;
    if (node.type === "url" && /^https?:/.test(node.url)) out.push({ title: node.name || node.url, url: node.url });
    for (const child of node.children || []) walk(child);
  };
  walk(data.roots?.bookmark_bar);
  walk(data.roots?.other);
  walk(data.roots?.synced);
  return out;
}

// The standard "bookmarks.html" format: <A HREF="https://…">Title</A>
function readHtmlBookmarks(html) {
  const out = [];
  const decode = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const m of html.matchAll(/<A\s[^>]*HREF="([^"]+)"[^>]*>([\s\S]*?)<\/A>/gi)) {
    const url = decode(m[1]);
    if (/^https?:/.test(url)) out.push({ title: decode(m[2].replace(/<[^>]+>/g, "").trim()) || url, url });
  }
  return out;
}

function writeHtmlBookmarks(list) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
    '    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Aero Browser bookmarks</H3>',
    "    <DL><p>",
    ...list.map(b => `        <DT><A HREF="${esc(b.url)}">${esc(b.title)}</A>`),
    "    </DL><p>",
    "</DL><p>",
    ""
  ].join("\n");
}

function setupBookmarks() {
  const reply = (e, data) => e.sender.send("bookmarks:imported", data);

  // Which other browsers on this computer have bookmarks we can bring over.
  ipcMain.on("bookmarks:sources", e => {
    e.sender.send("bookmarks:sources", BROWSERS.filter(b => fs.existsSync(b.file)).map(({ id, name }) => ({ id, name })));
  });

  ipcMain.on("bookmarks:import-browser", (e, id) => {
    const browser = BROWSERS.find(b => b.id === id);
    try {
      reply(e, { from: browser.name, bookmarks: readChromiumBookmarks(browser.file) });
    } catch (err) {
      reply(e, { from: browser?.name || id, error: "Couldn't read its bookmarks (" + err.message + ")" });
    }
  });

  ipcMain.on("bookmarks:import-file", async e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Import bookmarks",
      filters: [{ name: "Bookmarks file", extensions: ["html", "htm"] }],
      properties: ["openFile"]
    });
    if (canceled || !filePaths[0]) return;
    try {
      reply(e, { from: path.basename(filePaths[0]), bookmarks: readHtmlBookmarks(fs.readFileSync(filePaths[0], "utf8")) });
    } catch (err) {
      reply(e, { from: "that file", error: err.message });
    }
  });

  ipcMain.on("bookmarks:export-file", async (e, list) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export bookmarks",
      defaultPath: path.join(app.getPath("documents"), "aero-bookmarks.html"),
      filters: [{ name: "Bookmarks file", extensions: ["html"] }]
    });
    if (canceled || !filePath) return;
    fs.writeFileSync(filePath, writeHtmlBookmarks(Array.isArray(list) ? list : []));
    e.sender.send("bookmarks:exported", { file: filePath });
  });
}

module.exports = { setupBookmarks, readHtmlBookmarks, writeHtmlBookmarks };
