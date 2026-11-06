// Runs on every website. Ported from Aero's tab-preload.js: the theme "paper" painter and the
// Google AI Overview hider. Settings come from Aeris Core (background.js) through storage.

// Settings arrive a moment after the page starts, so run straight away if the page is already ready.
const whenReady = fn => (document.readyState === "loading" ? addEventListener("DOMContentLoaded", fn) : fn());

// ================= Theme paper colour =================
// Light themes colour the page behind a website, but sites like Google draw their own plain white
// boxes on top, which stick out. If the theme gives this site a "paper" colour, those white (and
// almost white) boxes get painted in it instead. A site showing its own dark look is left alone.

function paperFor(map, host) {
  for (const [domain, color] of Object.entries(map || {})) if (host === domain || host.endsWith("." + domain)) return color;
  return null;
}

function paintPaper(paper) {
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
  whenReady(() => {
    paintAll();
    new MutationObserver(() => {
      clearTimeout(paperTimer);
      paperTimer = setTimeout(paintAll, 200);
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  });
}

// ================= Hide Google's AI Overviews =================
// Finds the "AI Overview" heading on Google search pages and hides the whole box around it.
// (Switch this off in Aeris settings.)

function hideAi() {
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
  whenReady(() => {
    hideAiOverviews();
    new MutationObserver(() => {
      clearTimeout(aiTimer);
      aiTimer = setTimeout(hideAiOverviews, 150);
    }).observe(document.documentElement, { subtree: true, childList: true });
  });
}

browser.storage.local.get({ paper: null, hideAi: false }).then(s => {
  const paper = paperFor(s.paper, location.hostname);
  if (paper) paintPaper(paper);
  if (s.hideAi && /(^|\.)google\.[a-z.]+$/.test(location.hostname)) hideAi();
});
