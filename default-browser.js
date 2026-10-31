// Lets Windows know Aero Browser is a web browser, so it shows up in Settings → Default apps.
// The installer does this too, but doing it at every start (like Chrome does) means copies that
// were installed by an older installer, or moved to another folder, still get listed.
// Windows only lets *you* pick the default browser, so the button just opens the right Settings page.
const { app, ipcMain, shell } = require("electron");
const { execFile } = require("child_process");

const NAME = "Aero Browser";
const CLIENT = `HKCU\\Software\\Clients\\StartMenuInternet\\${NAME}`;
const CAPS = `${CLIENT}\\Capabilities`;

const reg = args => new Promise(resolve => {
  execFile("reg.exe", args, { windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
});
const setValue = (key, name, value) => reg(["add", key, ...(name ? ["/v", name] : ["/ve"]), "/t", "REG_SZ", "/d", value, "/f"]);

async function register() {
  const exe = process.execPath;
  const icon = `"${exe}",0`;
  const open = `"${exe}" "%1"`;
  const values = [
    [CLIENT, "", NAME],
    [`${CLIENT}\\DefaultIcon`, "", icon],
    [`${CLIENT}\\shell\\open\\command`, "", `"${exe}"`],
    [CAPS, "ApplicationName", NAME],
    [CAPS, "ApplicationDescription", "Browse the web with Aero Browser"],
    [CAPS, "ApplicationIcon", icon],
    [CAPS, "StartMenuInternet", NAME],
    [`${CAPS}\\URLAssociations`, "http", "AeroURL"],
    [`${CAPS}\\URLAssociations`, "https", "AeroURL"],
    ...[".htm", ".html", ".xht", ".xhtml", ".shtml"].map(ext => [`${CAPS}\\FileAssociations`, ext, "AeroHTML"]),
    ["HKCU\\Software\\RegisteredApplications", NAME, `Software\\Clients\\StartMenuInternet\\${NAME}\\Capabilities`],
    ["HKCU\\Software\\Classes\\AeroURL", "", "Aero Browser URL"],
    ["HKCU\\Software\\Classes\\AeroURL", "URL Protocol", ""],
    ["HKCU\\Software\\Classes\\AeroURL\\DefaultIcon", "", icon],
    ["HKCU\\Software\\Classes\\AeroURL\\shell\\open\\command", "", open],
    ["HKCU\\Software\\Classes\\AeroHTML", "", "HTML Document"],
    ["HKCU\\Software\\Classes\\AeroHTML\\DefaultIcon", "", icon],
    ["HKCU\\Software\\Classes\\AeroHTML\\shell\\open\\command", "", open]
  ];
  for (const [key, name, value] of values) await setValue(key, name, value);
}

// Is Aero the browser Windows opens https:// links with?
async function isDefault() {
  const out = await reg(["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice", "/v", "ProgId"]);
  return !!out && /\bAeroURL\b/.test(out);
}

function setupDefaultBrowser() {
  // Only the installed app registers itself (not test runs or `npm start`, whose exe is electron.exe).
  // Test runs and the unpacked build folder are skipped too, so they never take over the real install.
  const installedCopy = app.isPackaged && !process.env.AERO_SNAPSHOT && !/[\\/]win-unpacked[\\/]/i.test(process.execPath);
  if (process.platform === "win32" && installedCopy) register().catch(() => {});

  ipcMain.on("default:check", async e => {
    e.sender.send("default:status", { isDefault: process.platform === "win32" && (await isDefault()), canSet: installedCopy });
  });
  ipcMain.on("default:set", async () => {
    if (installedCopy) await register();
    // Opens Default apps straight on Aero's page (Windows 11), or the Default apps list otherwise.
    shell.openExternal("ms-settings:defaultapps?registeredAppUser=" + encodeURIComponent(NAME))
      .catch(() => shell.openExternal("ms-settings:defaultapps"));
  });
}

module.exports = { setupDefaultBrowser };
