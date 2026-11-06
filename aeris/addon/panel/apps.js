// Apps in the side panel: web apps you keep open next to any website. Aero's apps sidebar had the
// same four to start with; apps brought over from Aero are added by background.js.

const DEFAULT_APPS = [
  { id: "discord", name: "Discord", url: "https://discord.com/app" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com/" },
  { id: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com/" },
  { id: "ytmusic", name: "YouTube Music", url: "https://music.youtube.com/" }
];
let apps = [];
let openApp = null;

const appIcon = url => {
  try { return new URL("/favicon.ico", url).href; } catch { return ""; }
};

function drawApps() {
  const grid = $("#appGrid");
  grid.innerHTML = "";
  for (const a of apps) {
    const row = document.createElement("div");
    row.className = "profile-row app-row";
    row.innerHTML = `<img alt=""><span class="who"><b></b><small></small></span><button class="gel tiny red" title="Remove">✕</button>`;
    row.querySelector("img").src = appIcon(a.url);
    row.querySelector("img").addEventListener("error", e => (e.target.style.visibility = "hidden"));
    row.querySelector("b").textContent = a.name;
    row.querySelector("small").textContent = new URL(a.url).hostname;
    row.addEventListener("click", () => showApp(a));
    row.querySelector("button").addEventListener("click", async e => {
      e.stopPropagation();
      apps = apps.filter(x => x !== a);
      await store.set({ apps });
      drawApps();
    });
    grid.append(row);
  }
}

function showApp(a) {
  openApp = a;
  $("#appTitle").textContent = a ? a.name : "Apps";
  $("#appTools").hidden = !a;
  $("#appPicker").hidden = !!a;
  $("#appFrame").hidden = !a;
  if (a && $("#appFrame").dataset.url !== a.url) {
    $("#appFrame").dataset.url = a.url;
    $("#appFrame").src = a.url;
  }
}

$("#appBack").addEventListener("click", () => showApp(null));
$("#appReload").addEventListener("click", () => openApp && ($("#appFrame").src = openApp.url));
$("#appTab").addEventListener("click", () => openApp && browser.tabs.create({ url: openApp.url }));
$("#appAdd").addEventListener("click", async () => {
  let url = $("#appUrl").value.trim();
  if (!url) return;
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  try { new URL(url); } catch { return; }
  const name = $("#appName").value.trim() || new URL(url).hostname.replace(/^www\./, "");
  apps.push({ id: crypto.randomUUID(), name, url });
  await store.set({ apps });
  $("#appName").value = $("#appUrl").value = "";
  drawApps();
});

(async () => {
  ({ apps } = await store.get({ apps: DEFAULT_APPS }));
  drawApps();
})();
