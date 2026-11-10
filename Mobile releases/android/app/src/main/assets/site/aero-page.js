// Runs at the start of every page in Aero for Android, wrapped as (function (AERO) { … })({…}).
// AERO = { css: { base, websites, fixes, sites: { "google.com": "…" } }, paper: { "google.com": "#…" },
//          newtabCss: "/assets/themes/<id>/newtab.css" or "" }
// It can run again on a page that's already open (when the theme changes), so everything here
// replaces what it added last time instead of adding twice.

if (window.top !== window) return;
const host = location.hostname;
const matches = domain => host === domain || host.endsWith("." + domain);

// ================= Aero's own pages: the New Tab and Aero Originals =================

if (location.host === "appassets.androidplatform.net") {
  const setLink = () => {
    let link = document.getElementById("aeroTheme");
    if (!link) {
      // Only the New Tab gets a theme link added; other pages (like the welcome tour) have their own look.
      if (!AERO.newtabCss || !/^\/assets\/(index\.html)?$/.test(location.pathname)) return;
      link = document.createElement("link");
      link.id = "aeroTheme";
      link.rel = "stylesheet";
      (document.head || document.documentElement).append(link);
    }
    if (AERO.newtabCss) link.setAttribute("href", AERO.newtabCss);
    else link.removeAttribute("href");
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", setLink);
  else setLink();
}

// ================= Theme and Aero style on websites =================

if (/^https?:$/.test(location.protocol) && location.host !== "appassets.androidplatform.net") {
  let css = AERO.css.base + "\n" + AERO.css.websites;
  for (const [domain, siteCss] of Object.entries(AERO.css.sites)) if (matches(domain)) css += "\n" + siteCss;
  css += "\n" + AERO.css.fixes;
  // Things you hid on this website (one rule each, so one broken selector can't undo the others)
  const site = host.replace(/^www\./, "");
  for (const selector of (AERO.zaps || {})[site] || []) css += `\n${selector} { display: none !important; }`;

  const put = () => {
    let style = document.getElementById("aero-theme-style");
    if (!style) {
      if (!document.documentElement) return;
      style = document.createElement("style");
      style.id = "aero-theme-style";
    }
    style.textContent = css;
    // Last in the page, so it wins over the site's own styles.
    if (style.parentNode !== document.documentElement || style !== document.documentElement.lastElementChild) {
      document.documentElement.append(style);
    }
  };
  put();
  addEventListener("DOMContentLoaded", put);

  // ----- Paper colour (ported from the desktop's tab-preload.js) -----
  // Light themes colour the page behind a website, but sites like Google draw their own plain white
  // boxes on top, which stick out. If the theme gives this site a "paper" colour, those white (and
  // almost white) boxes get painted in it instead. A site showing its own dark look is left alone.
  const paper = Object.entries(AERO.paper || {}).find(([domain]) => matches(domain))?.[1];
  window.__aeroPaperStop?.();
  if (paper && /^#[0-9a-f]{6}$/i.test(paper)) {
    const [pr, pg, pb] = paper.match(/[0-9a-f]{2}/gi).map(h => parseInt(h, 16));
    const shade = k => `rgb(${Math.round(pr * k)}, ${Math.round(pg * k)}, ${Math.round(pb * k)})`;
    const RGB = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/;
    const siteIsDark = () => document.body?.dataset.dt === "1" || getComputedStyle(document.body).colorScheme === "dark";
    const paperFor = color => {
      const m = color.match(RGB);
      if (!m || (m[4] !== undefined && +m[4] <= 0.6)) return null;
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      if (`rgb(${r}, ${g}, ${b})` === shade(1) || `rgb(${r}, ${g}, ${b})` === shade(0.96)) return null;
      const low = Math.min(r, g, b);
      if (low < 236 || Math.max(r, g, b) - low > 12) return null;
      return low >= 250 ? "paper" : "shade";
    };
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
      if (cs.backgroundImage.includes("255, 255, 255")) {
        el.style.setProperty("background-image", cs.backgroundImage.replace(/rgba?\(255, 255, 255(?:, ([\d.]+))?\)/g, (_, a) => `rgba(${pr}, ${pg}, ${pb}, ${a ?? 1})`), "important");
      }
    };
    const paintAll = () => {
      if (!document.body || siteIsDark()) return;
      for (const el of document.body.querySelectorAll("*")) paint(el);
    };
    let timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(paintAll, 200);
    });
    const start = () => {
      paintAll();
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    };
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", start);
    else start();
    window.__aeroPaperStop = () => { observer.disconnect(); clearTimeout(timer); };
  }
}

// ================= Hide this on the website (Aeris) =================
// ⋮ → "Hide something on this page", then tap it. The selector logic is the same as Aeris on the computer.

function aerisSelectorFor(el) {
  const parts = [];
  while (el && el.nodeType === 1 && el !== document.documentElement && parts.length < 6) {
    if (el.id && !/\d{3,}/.test(el.id)) {
      parts.unshift("#" + CSS.escape(el.id));
      break;
    }
    let part = el.localName;
    const classes = [...el.classList].filter(c => !/\d{3,}|^(is-|has-)?(active|hover|focus|open|selected)$/.test(c)).slice(0, 2);
    if (classes.length) part += "." + classes.map(c => CSS.escape(c)).join(".");
    const same = el.parentElement ? [...el.parentElement.children].filter(c => c.localName === el.localName) : [];
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(el) + 1})`;
    parts.unshift(part);
    el = el.parentElement;
  }
  return parts.join(" > ");
}

window.__aerisPick = () => {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ff4fa8;background:rgba(255,79,168,0.15);border-radius:6px;display:none";
  const tip = document.createElement("div");
  tip.textContent = "Tap the thing to hide. Tap here to cancel.";
  tip.style.cssText = "position:fixed;z-index:2147483647;left:12px;right:12px;top:12px;padding:12px 16px;border-radius:999px;font:600 15px system-ui,sans-serif;color:#fff;text-align:center;background:linear-gradient(180deg,#ff8cc6,#e0287f);box-shadow:0 6px 20px rgba(0,0,0,0.3)";
  document.documentElement.append(box, tip);
  const outline = e => {
    const t = e.touches?.[0];
    const el = t && document.elementFromPoint(t.clientX, t.clientY);
    if (!el || el === tip) return;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  };
  const done = () => {
    removeEventListener("touchstart", outline, true);
    removeEventListener("click", pick, true);
    box.remove();
    tip.remove();
  };
  const pick = e => {
    e.preventDefault();
    e.stopPropagation();
    done();
    const el = e.target;
    if (el === tip || el === document.body || el === document.documentElement) return;
    el.style.setProperty("display", "none", "important");
    window.AeroNative?.postMessage(JSON.stringify({ type: "zap", site: location.hostname.replace(/^www\./, ""), selector: aerisSelectorFor(el) }));
  };
  addEventListener("touchstart", outline, { capture: true, passive: true });
  addEventListener("click", pick, true);
};

// ================= Page filters (Aeris) =================
// Grayscale, dark, sepia and the rest: the app sends the CSS for the filters you picked.

window.__aerisFilter = css => {
  let style = document.getElementById("aeris-filter");
  if (!css) return style?.remove();
  if (!style) {
    style = document.createElement("style");
    style.id = "aeris-filter";
  }
  style.textContent = css;
  document.documentElement.append(style);
};

// ================= Files a page makes itself =================
// Pages like Beat Lab build a file in memory and "click" a download link for it. Android's web
// viewer can't save those, so Aero reads the file here and hands it to the app to save in Downloads.

if (!window.__aeroDownloadsHooked && window.AeroNative) {
  window.__aeroDownloadsHooked = true;
  const save = a => {
    const href = a.href || "";
    if (!a.hasAttribute("download") || !/^(blob|data):/.test(href)) return false;
    fetch(href).then(r => r.blob()).then(blob => {
      const reader = new FileReader();
      reader.onload = () => AeroNative.postMessage(JSON.stringify({ type: "save", name: a.download || "download", data: reader.result }));
      reader.readAsDataURL(blob);
    }).catch(() => AeroNative.postMessage(JSON.stringify({ type: "save-failed" })));
    return true;
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!save(this)) click.call(this);
  };
  addEventListener("click", e => {
    const a = e.target.closest?.("a[download]");
    if (a && save(a)) e.preventDefault();
  }, true);
}
