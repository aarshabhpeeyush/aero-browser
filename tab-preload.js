// Runs inside every tab before the website's own code.
// It lives in its own "isolated world", so websites can't see or use anything in here.
const { webFrame, ipcRenderer } = require("electron");

// In "Firefox" sign-in mode, Google's sign-in page sees us as Firefox (see main.js), so also hide
// the Chromium-only "userAgentData" that would give the game away.
if (location.hostname === "accounts.google.com" && ipcRenderer.sendSync("signin:mode") === "firefox") {
  webFrame.executeJavaScript("Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });");
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
