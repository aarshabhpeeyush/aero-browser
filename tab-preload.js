// Runs inside every tab before the website's own code.
const { webFrame } = require("electron");

// On Google's sign-in page we introduce ourselves as Firefox (see main.js), so also hide the
// Chromium-only "userAgentData" that would give the game away and get the sign-in blocked.
if (location.hostname === "accounts.google.com") {
  webFrame.executeJavaScript("Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });");
}
