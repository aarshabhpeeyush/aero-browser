/* This runs with Aeris's own powers (it's part of the browser, not a normal extension), for the few
   things Aeris Core can't do with the regular extension APIs. Everything else lives in background.js. */
"use strict";
/* global ExtensionAPI, ChromeUtils, Services, Cc, Ci, Cu, IOUtils, PathUtils, WebExtensionPolicy */

Cu.importGlobalProperties(["atob", "crypto", "fetch"]);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  LoginHelper: "resource://gre/modules/LoginHelper.sys.mjs",
  OSCrypto: "resource://gre/modules/OSCrypto_win.sys.mjs"
});

const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
const UPDATE_PREFIX = "https://github.com/aarshabhpeeyush/aero-browser/releases/download/";
const AMO_PREFIX = "https://addons.mozilla.org/firefox/downloads/";
const BROWSER_PAGES = /^about:(preferences|addons|logins)([#?].*)?$/;

let chromeSheet = null; // the theme's restyle of the browser frame
let pendingInstaller = null; // a downloaded update waiting for Aeris to close

const aeroFolder = () => PathUtils.join(Services.dirsvc.get("AppData", Ci.nsIFile).path, "Aero Browser");

function setChromeStyle(css) {
  if (chromeSheet && sss.sheetRegistered(chromeSheet, sss.USER_SHEET)) sss.unregisterSheet(chromeSheet, sss.USER_SHEET);
  chromeSheet = null;
  if (!css) return;
  // Only the browser window itself, never websites.
  const wrapped = `@-moz-document url("chrome://browser/content/browser.xhtml") {\n${css}\n}`;
  chromeSheet = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(wrapped));
  sss.loadAndRegisterSheet(chromeSheet, sss.USER_SHEET);
}

// Aero kept passwords in <AppData>/Aero Browser/passwords/<profile>.vault, locked with Windows'
// data protection the same way Chrome does it ("v10" + nonce + AES-GCM), with the key in "Local State".
async function importAeroPasswords() {
  const dir = aeroFolder();
  const vaultDir = PathUtils.join(dir, "passwords");
  if (!(await IOUtils.exists(vaultDir))) return 0;
  const localState = await IOUtils.readJSON(PathUtils.join(dir, "Local State"));
  const wrapped = atob(localState.os_crypt.encrypted_key);
  if (!wrapped.startsWith("DPAPI")) throw new Error("Aero's password key isn't in the expected format.");
  const osCrypto = new lazy.OSCrypto();
  let keyBytes;
  try { keyBytes = osCrypto.decryptData(wrapped.slice(5), null, "bytes"); }
  finally { osCrypto.finalize(); }
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes), "AES-GCM", false, ["decrypt"]);

  const logins = [];
  for (const file of await IOUtils.getChildren(vaultDir)) {
    if (!file.endsWith(".vault")) continue;
    const data = await IOUtils.read(file);
    if (String.fromCharCode(...data.slice(0, 3)) !== "v10") continue;
    // A vault locked with an older key can't be opened (Aero couldn't open it either), so skip it.
    let vault;
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(3, 15) }, key, data.slice(15));
      vault = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      continue;
    }
    for (const l of vault.logins || []) {
      if (!l.origin || !l.password) continue;
      logins.push({
        origin: l.origin,
        formActionOrigin: l.origin,
        httpRealm: null,
        username: l.username || "",
        password: l.password,
        usernameElement: "",
        passwordElement: "",
        timeCreated: l.created || Date.now(),
        timePasswordChanged: l.updated || Date.now()
      });
    }
  }
  const added = await lazy.LoginHelper.maybeImportLogins(logins);
  return added.filter(r => r.result === "added").length;
}

function launchInstaller(args) {
  if (!pendingInstaller) return;
  const exe = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  exe.initWithPath(pendingInstaller);
  const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  proc.init(exe);
  proc.runAsync(args, args.length);
  pendingInstaller = null;
}

const quitObserver = { observe: () => launchInstaller(["/S"]) };

this.aeris = class extends ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (!isAppShutdown) setChromeStyle("");
  }

  getAPI(context) {
    const { extension } = context;
    return {
      aeris: {
        async setChromeStyle(css) { setChromeStyle(css); },

        async setNewTabPage(url) {
          lazy.AboutNewTab.newTabURL = url;
          Services.prefs.setStringPref("browser.startup.homepage", url);
        },

        async appInfo() {
          return { aeris: extension.manifest.version, firefox: Services.appinfo.version };
        },

        async readAeroExport() {
          const file = PathUtils.join(aeroFolder(), "aeris-export.json");
          return (await IOUtils.exists(file)) ? IOUtils.readJSON(file) : null;
        },

        importAeroPasswords,

        async installAddon(path) {
          // Add-ons from Mozilla's store are signed by Mozilla; ours ship inside Aeris Core.
          const url = path.startsWith(AMO_PREFIX) ? path : extension.rootURI.resolve(path);
          const install = await lazy.AddonManager.getInstallForURL(url, { telemetryInfo: { source: "aeris-store" } });
          const addon = await install.install();
          return { id: addon.id, version: addon.version };
        },

        async openBrowserPage(url) {
          if (!BROWSER_PAGES.test(url)) throw new Error("Only Firefox's settings, add-ons and passwords pages can be opened.");
          Services.wm.getMostRecentWindow("navigator:browser")?.openTrustedLinkIn(url, "tab");
        },

        async removeAddon(id) {
          const addon = await lazy.AddonManager.getAddonByID(id);
          if (addon) await addon.uninstall();
        },

        async addonInfo(ids, page) {
          const out = [];
          for (const id of ids) {
            const addon = await lazy.AddonManager.getAddonByID(id);
            const policy = WebExtensionPolicy.getByID(id);
            out.push({
              id,
              installed: !!addon,
              enabled: !!addon?.isActive,
              version: addon?.version || null,
              page: policy && page ? policy.getURL(page) : null
            });
          }
          return out;
        },

        async downloadUpdate(url, version) {
          if (!url.startsWith(UPDATE_PREFIX)) throw new Error("Updates only come from Aeris's GitHub releases.");
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          const file = PathUtils.join(PathUtils.tempDir, `Aeris-Setup-${version.replace(/[^\w.-]/g, "")}.exe`);
          await IOUtils.write(file, new Uint8Array(await res.arrayBuffer()));
          if (!pendingInstaller) Services.obs.addObserver(quitObserver, "quit-application-granted");
          pendingInstaller = file;
          return true;
        },

        async restartToUpdate() {
          if (!pendingInstaller) return false;
          Services.obs.removeObserver(quitObserver, "quit-application-granted");
          launchInstaller(["/S", "/RELAUNCH"]);
          Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
          return true;
        }
      }
    };
  }
};
