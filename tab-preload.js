// Runs inside every tab before the website's own code.
// It lives in its own "isolated world", so websites can't see or use anything in here.
const { webFrame, ipcRenderer } = require("electron");

// ================= Aero Web Store =================
// Only the built-in store page (aero://store) gets the buttons that install and remove extensions.
if (location.protocol === "aero:" && location.host === "store") {
  require("electron").contextBridge.exposeInMainWorld("aeroStore", {
    list: () => ipcRenderer.invoke("store:list"),
    install: id => ipcRenderer.invoke("store:install", id),
    remove: id => ipcRenderer.invoke("store:remove", id)
  });
}

// ================= Theme paper colour =================
// Light themes colour the page behind a website, but sites like Google draw their own plain white
// boxes on top, which stick out. If the theme gives this site a "paper" colour, those white (and
// almost white) boxes get painted in it instead. A site showing its own dark look is left alone.

const paper = location.protocol.startsWith("http") ? ipcRenderer.sendSync("theme:paper", location.hostname) : null;
if (paper) {
  const [pr, pg, pb] = paper.match(/[0-9a-f]{2}/gi).map(h => parseInt(h, 16));
  const shade = k => `rgb(${Math.round(pr * k)}, ${Math.round(pg * k)}, ${Math.round(pb * k)})`;
  const RGB = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/;
  const siteIsDark = () => document.body?.dataset.dt === "1" || getComputedStyle(document.body).colorScheme === "dark";
  // White becomes paper; Google's very light grey chips and boxes become a slightly darker paper.
  const paperFor = color => {
    const m = color.match(RGB);
    if (!m || (m[4] !== undefined && +m[4] <= 0.6)) return null;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    if (`rgb(${r}, ${g}, ${b})` === shade(1) || `rgb(${r}, ${g}, ${b})` === shade(0.96)) return null; // painted already
    const low = Math.min(r, g, b);
    if (low < 236 || Math.max(r, g, b) - low > 12) return null;
    return low >= 250 ? "paper" : "shade";
  };
  // ::before / ::after boxes can't be given a colour directly, so they're tagged and a small
  // stylesheet colours the tagged ones.
  let pseudoStyle = null;
  const addPseudoStyle = () => {
    if (pseudoStyle?.isConnected) return;
    pseudoStyle = document.createElement("style");
    pseudoStyle.textContent = ["before", "after"].map(p =>
      `[data-aero-${p}="paper"]::${p} { background-color: ${paper} !important; }\n` +
      `[data-aero-${p}="shade"]::${p} { background-color: ${shade(0.96)} !important; }`).join("\n");
    document.documentElement.append(pseudoStyle);
  };
  const paint = el => {
    const cs = getComputedStyle(el);
    const tone = paperFor(cs.backgroundColor);
    if (tone) el.style.setProperty("background-color", tone === "paper" ? paper : shade(0.96), "important");
    for (const p of ["before", "after"]) {
      const ps = getComputedStyle(el, "::" + p);
      if (ps.content === "none") continue;
      const pTone = paperFor(ps.backgroundColor);
      if (pTone && el.getAttribute("data-aero-" + p) !== pTone) {
        addPseudoStyle();
        el.setAttribute("data-aero-" + p, pTone);
      }
    }
    // Fades to white (like the one above Google's "Ask anything" box) fade to paper instead.
    if (cs.backgroundImage.includes("255, 255, 255")) {
      el.style.setProperty("background-image", cs.backgroundImage.replace(/rgba?\(255, 255, 255(?:, ([\d.]+))?\)/g, (_, a) => `rgba(${pr}, ${pg}, ${pb}, ${a ?? 1})`), "important");
    }
  };
  const paintAll = () => {
    if (!document.body || siteIsDark()) return;
    for (const el of document.body.querySelectorAll("*")) paint(el);
  };
  let paperTimer;
  addEventListener("DOMContentLoaded", () => {
    paintAll();
    new MutationObserver(() => {
      clearTimeout(paperTimer);
      paperTimer = setTimeout(paintAll, 200);
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
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
