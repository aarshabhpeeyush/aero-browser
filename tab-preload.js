// Runs inside every tab before the website's own code.
// It lives in its own "isolated world", so websites can't see or use anything in here.
const { webFrame, ipcRenderer } = require("electron");

// On Google's sign-in page, what the page's own code sees has to match how we introduce ourselves
// (see signInMode in main.js):
//   "firefox": hide the Chromium-only userAgentData that would give the game away.
//   "chrome":  report Google Chrome's brands, the way Chrome itself does.
if (location.hostname === "accounts.google.com") {
  const { mode, full, major } = ipcRenderer.sendSync("signin:mode");
  if (mode === "firefox") {
    webFrame.executeJavaScript("Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });");
  } else if (mode === "chrome") {
    webFrame.executeJavaScript(`(() => {
      const real = navigator.userAgentData;
      if (!real) return;
      const brands = [{ brand: "Google Chrome", version: "${major}" }, { brand: "Chromium", version: "${major}" }, { brand: "Not?A_Brand", version: "99" }];
      const fullVersionList = [{ brand: "Google Chrome", version: "${full}" }, { brand: "Chromium", version: "${full}" }, { brand: "Not?A_Brand", version: "99.0.0.0" }];
      const fake = {
        brands, mobile: real.mobile, platform: real.platform,
        getHighEntropyValues: hints => real.getHighEntropyValues(hints).then(v => ({ ...v, brands, fullVersionList, uaFullVersion: "${full}" })),
        toJSON: () => ({ brands, mobile: real.mobile, platform: real.platform })
      };
      Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => fake });
    })();`);
  }
}

// ================= Aero Web Store =================
// Only the built-in store page (aero://store) gets the buttons that install and remove extensions.
if (location.protocol === "aero:" && location.host === "store") {
  require("electron").contextBridge.exposeInMainWorld("aeroStore", {
    list: () => ipcRenderer.invoke("store:list"),
    install: id => ipcRenderer.invoke("store:install", id),
    remove: id => ipcRenderer.invoke("store:remove", id)
  });
}

// ================= Hide Google's AI Overviews =================
// Finds the "AI Overview" heading on Google search pages and hides the whole box around it.
// (Switch this off in ✨ Customize → Browsing.)

if (/(^|\.)google\.[a-z.]+$/.test(location.hostname) && ipcRenderer.sendSync("settings:hide-ai")) {
  const RESULT_AREAS = ["rso", "rcnt", "center_col", "search", "main"];
  // The "AI Overview" label can be a heading or a small label next to a ✨ icon, so look at every
  // short piece of text that says it.
  const isAiLabel = text => /^AI Overviews?$/i.test(text.trim());
  const hideAiOverviews = () => {
    const labels = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: node => (isAiLabel(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
    });
    while (walker.nextNode()) labels.push(walker.currentNode.parentElement);
    for (const label of labels) {
      // Climb up to the block that sits directly inside Google's results area, and hide that.
      // (Labels elsewhere, like menus, climb all the way up and are left alone.)
      let box = label;
      while (box.parentElement && box.parentElement !== document.body && !RESULT_AREAS.includes(box.parentElement.id)) box = box.parentElement;
      if (box.parentElement && box.parentElement !== document.body) box.style.setProperty("display", "none", "important");
    }
  };
  let aiTimer;
  addEventListener("DOMContentLoaded", () => {
    hideAiOverviews();
    new MutationObserver(() => {
      clearTimeout(aiTimer);
      aiTimer = setTimeout(hideAiOverviews, 150);
    }).observe(document.documentElement, { subtree: true, childList: true });
  });
}

// ================= Password manager helper =================
// Spots login forms, notices when you log in (so the browser can offer to save the password),
// and fills saved logins in when you click Fill.

const isVisible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const passwordFields = () => [...document.querySelectorAll("input[type=password]")].filter(isVisible);
const TEXTISH = "input[type=email], input[type=text], input[type=tel], input:not([type])";

// The username box is the last text-like box before the password box.
function usernameFor(pw) {
  const scope = pw.form || document;
  const before = [...scope.querySelectorAll(TEXTISH)]
    .filter(i => isVisible(i) && i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
  return before[before.length - 1] || null;
}

function captureLogin() {
  const pw = passwordFields().find(p => p.value);
  if (!pw) return;
  ipcRenderer.send("pw:submit", { username: usernameFor(pw)?.value || "", password: pw.value });
}

// Logging in = submitting the form, clicking its button, or pressing Enter in it.
document.addEventListener("submit", captureLogin, true);
document.addEventListener("click", e => {
  if (e.target instanceof Element && e.target.closest("button, input[type=submit], [role=button]")) captureLogin();
}, true);
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target instanceof HTMLInputElement) captureLogin();
}, true);

// Logins that ask for the email first and the password on the next step: remember the email.
document.addEventListener("change", e => {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.matches(TEXTISH) && t.value && !passwordFields().length) {
    ipcRenderer.send("pw:username", t.value);
  }
}, true);

// Let the browser know whenever a login form appears or disappears.
let hadForm = null;
let checkTimer;
function checkForForm() {
  const has = passwordFields().length > 0;
  if (has !== hadForm) {
    hadForm = has;
    ipcRenderer.send("pw:form", has);
  }
}
addEventListener("DOMContentLoaded", () => {
  checkForForm();
  new MutationObserver(() => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkForForm, 400);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["type", "style", "class", "hidden"] });
});

// Type a value the way a person would, so the website's own code notices it.
function typeInto(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

ipcRenderer.on("pw:fill", (e, { username, password }) => {
  const pw = passwordFields()[0];
  if (pw) {
    typeInto(pw, password);
    const user = usernameFor(pw);
    if (user && username) typeInto(user, username);
    return;
  }
  // Email-first logins: fill the email box on this step.
  const user = [...document.querySelectorAll(TEXTISH)].find(isVisible);
  if (user && username) typeInto(user, username);
});
