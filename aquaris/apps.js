// The apps Aquaris comes with. Each one is just a website, opened in a window on the desktop, so
// they all share Aeris's one engine instead of each bringing its own copy of Chrome (that's what
// Discord's and Zoom's desktop apps do, and why they use so much memory).
//   music: true  → it keeps playing when you minimise it (it never naps)
//   size         → the window size it opens at
//   glyph        → its icon: a simple white drawing (24×24) on a rounded square of its colour.
//                  "currentColor" inside a glyph is the app's colour (for cut-outs).
//   frame: true  → on the web version (iPad) it opens inside Aquaris; other sites refuse to be
//                  inside another website, so there they open in their own tab
// The glyphs are Aquaris's own simple drawings, so every icon matches.

const AQUARIS_APPS = [
  {
    id: "discord", name: "Discord", url: "https://discord.com/app", color: "#5865f2", about: "Chat and call your friends",
    glyph: `<path fill="#fff" d="M6 6.6A2.6 2.6 0 0 1 8.6 4h6.8A2.6 2.6 0 0 1 18 6.6v6.8a2.6 2.6 0 0 1-2.6 2.6H11.2L7.6 19v-3.1A2.4 2.4 0 0 1 6 13.6z"/><circle cx="9.8" cy="10" r="1.35" fill="currentColor"/><circle cx="14.2" cy="10" r="1.35" fill="currentColor"/>`
  },
  {
    id: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com/", color: "#25d366", about: "Messages from your phone",
    glyph: `<path fill="#fff" d="M12 4.2a7.8 7.8 0 0 0-6.7 11.8l-1 3.7 3.8-1A7.8 7.8 0 1 0 12 4.2z"/><path fill="currentColor" d="M9.6 8.4c.3-.3.7-.3 1 0l.9 1.2c.2.3.2.6 0 .9l-.4.5c.5 1 1.2 1.7 2.2 2.2l.5-.4c.3-.2.6-.2.9 0l1.2.9c.3.3.3.7 0 1l-.6.6c-.6.6-1.5.7-2.2.3-1.8-.9-3.2-2.3-4.1-4.1-.4-.7-.3-1.6.3-2.2z"/>`
  },
  {
    id: "ytmusic", name: "YouTube Music", url: "https://music.youtube.com/", color: "#ff1f3d", music: true, about: "Songs and videos",
    glyph: `<circle cx="12" cy="12" r="6.7" fill="none" stroke="#fff" stroke-width="1.9"/><path fill="#fff" d="M10.4 9.1v5.8l4.8-2.9z"/>`
  },
  {
    id: "youtube", name: "YouTube", url: "https://www.youtube.com/", color: "#ff0000", about: "Videos",
    glyph: `<rect x="3.8" y="6.4" width="16.4" height="11.2" rx="3.4" fill="#fff"/><path fill="currentColor" d="M10.3 9.4v5.2l4.5-2.6z"/>`
  },
  {
    id: "zoom", name: "Zoom", url: "https://app.zoom.us/wc", color: "#0b5cff", about: "Video calls and meetings",
    glyph: `<rect x="3.8" y="7.2" width="11.4" height="9.6" rx="2.6" fill="#fff"/><path fill="#fff" d="M16.2 10.6l4-2.5v7.8l-4-2.5z"/>`
  },
  {
    id: "gmail", name: "Gmail", url: "https://mail.google.com/", color: "#ea4335", about: "Your email",
    glyph: `<rect x="4.5" y="6.3" width="15" height="11.4" rx="2.2" fill="#fff"/><path d="M5.6 8l6.4 4.9L18.4 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  },
  {
    id: "docs", name: "Google Docs", url: "https://docs.google.com/document/", color: "#3b7cf0", about: "Write documents",
    glyph: `<path fill="#fff" d="M8.2 4h5.6L18 8.2v10.2a1.6 1.6 0 0 1-1.6 1.6H8.2a1.6 1.6 0 0 1-1.6-1.6V5.6A1.6 1.6 0 0 1 8.2 4z"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M9.3 11.3h5.4M9.3 13.8h5.4M9.3 16.3h3.6"/>`
  },
  {
    id: "photopea", name: "Photopea", url: "https://www.photopea.com/", frame: true, color: "#13a089", about: "Edit pictures, like Photoshop", size: [1180, 760],
    glyph: `<rect x="4.5" y="5.5" width="15" height="13" rx="2.6" fill="#fff"/><path fill="currentColor" d="M6.6 16.4l3.4-4 2.6 2.6 2-2.1 2.8 3.5z"/><circle cx="15" cy="9.4" r="1.6" fill="currentColor"/>`
  },
  {
    id: "opencut", name: "OpenCut", url: "https://opencut.app/", color: "#1d1d1f", about: "Edit videos (free and open source)", size: [1240, 780],
    glyph: `<rect x="4.2" y="6.2" width="15.6" height="11.6" rx="2.4" fill="#fff"/><path fill="currentColor" d="M10.2 9.3v5.4l4.6-2.7z"/><path d="M4.2 9.4h2.2M4.2 12h2.2M4.2 14.6h2.2M17.6 9.4h2.2M17.6 12h2.2M17.6 14.6h2.2" stroke="currentColor" stroke-width="1.1"/>`
  },
  {
    id: "vscode", name: "VS Code", url: "https://vscode.dev/", color: "#1478d4", about: "Write code", size: [1180, 760],
    glyph: `<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.6 8L4.8 12l3.8 4M15.4 8l3.8 4-3.8 4M13.1 6.6l-2.2 10.8"/></g>`
  }
];

// In the dock to start with (right-click an app to pin or unpin it)
const AQUARIS_PINNED = ["discord", "ytmusic", "whatsapp", "photopea"];
