// Turns an Aero theme.css into CSS for Aeris's frame, for your own themes (from your Themes folder).
// The built-in themes are converted the same way when Aeris is built: this is a copy of
// aeris/tools/chrome_theme.py, so keep the two the same.

const THEME_ORBS = "#nav-bar :is(#back-button, #forward-button, #reload-button, #stop-button) > .toolbarbutton-icon";
const THEME_TEXT_PROPS = ["color", "text-shadow", "font", "letter-spacing", "text-transform"];

// Aero selector -> Aeris selector, or [box, text] for things Firefox draws as two parts
// (a tab's glass is .tab-background, its title is .tab-label).
const THEME_MAP = {
  "#titlebar": "#TabsToolbar",
  ".tab": [".tabbrowser-tab .tab-background", ".tabbrowser-tab .tab-label"],
  ".tab:hover": [".tabbrowser-tab:hover .tab-background:not([selected])", ".tabbrowser-tab:hover:not([selected]) .tab-label"],
  ".tab.active": [".tabbrowser-tab[selected] .tab-background", ".tabbrowser-tab[selected] .tab-label"],
  ".app-orb": "#TabsToolbar-customization-target::before",
  "#toolbar": "#nav-bar",
  ".orb": THEME_ORBS,
  ".navpair .orb": THEME_ORBS,
  ".orb:hover": THEME_ORBS.replace("> .toolbarbutton-icon", ":hover > .toolbarbutton-icon"),
  "#customizeBtn": "#aeris-core_aeris_app-BAP .toolbarbutton-badge-stack",
  "#address": "#urlbar .urlbar-background",
  "#address:focus-within": "#urlbar[focused] .urlbar-background",
  "#url": "#urlbar-input",
  "#url::placeholder": "#urlbar-input::placeholder",
  "#bookmarks": "#PersonalToolbar",
  "#bookmarks button": "#PersonalToolbar toolbarbutton.bookmark-item",
  "#bookmarks button:hover": "#PersonalToolbar toolbarbutton.bookmark-item:hover",
  "#bookmarks .empty": "#personal-toolbar-empty-description",
  ".winbtns button": ".titlebar-button",
  ".win-simple .winbtns button": ".titlebar-button",
  "#appsBar": "sidebar-main",
  // Fonts only (see THEME_FONT_ONLY)
  "body": ":root",
  "button": "toolbarbutton",
  "input": "#urlbar-input"
};
// Tabs at the side: only used when Aeris has its tabs on the left or right.
const THEME_SIDE_MAP = { ".side #titlebar": "sidebar-main" };
const THEME_FONT_ONLY = new Set(["body", "button", "input", "select"]);

// Each top-level block as [prelude, body]
function themeBlocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const start = css.indexOf("{", i);
    if (start < 0) break;
    let depth = 1, j = start + 1;
    while (j < css.length && depth) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    out.push([css.slice(i, start).trim(), css.slice(start + 1, j - 1)]);
    i = j;
  }
  return out;
}

function themeDecls(body) {
  return body.split(/;(?![^(]*\))/).map(d => d.trim()).filter(d => d.includes(":")).map(d => {
    const at = d.indexOf(":");
    return [d.slice(0, at).trim(), d.slice(at + 1).trim()];
  });
}

function themeRender(selector, decls) {
  if (!decls.length) return "";
  const lines = decls.map(([name, value]) => `  ${name}: ${!name.startsWith("--") && !value.includes("!important") ? value + " !important" : value};`);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

// Returns [frameCss, sideCss]
function translateTheme(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const frame = [], side = [];
  for (const [prelude, body] of themeBlocks(css)) {
    if (prelude.startsWith("@keyframes")) {
      frame.push(`${prelude} {${body}}\n`);
      continue;
    }
    if (prelude.startsWith("@")) continue;
    const decls = themeDecls(body);
    for (const raw of prelude.split(",")) {
      const sel = raw.trim().replace(/\s+/g, " ");
      if (sel === ":root") {
        frame.push(themeRender(":root", decls.filter(([n]) => n.startsWith("--"))));
        continue;
      }
      if (THEME_SIDE_MAP[sel]) {
        side.push(themeRender(THEME_SIDE_MAP[sel], decls));
        continue;
      }
      const target = THEME_MAP[sel];
      if (!target) continue;
      const use = THEME_FONT_ONLY.has(sel) ? decls.filter(([n]) => n.startsWith("font")) : decls;
      const isText = ([n]) => THEME_TEXT_PROPS.some(p => n.startsWith(p));
      if (Array.isArray(target)) {
        frame.push(themeRender(target[0], use.filter(d => !isText(d))));
        frame.push(themeRender(target[1], use.filter(isText)));
      } else {
        frame.push(themeRender(target, use));
      }
    }
  }
  return [frame.join(""), side.join("")];
}

// The colour variables from a theme.css's :root (for the theme picker and Firefox's menus)
function themeVars(css) {
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  const vars = {};
  for (const m of (root?.[1] || "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}
