// Theme Studio: turns the choices from studio/index.html into CSS for the browser frame (laid on
// top of Aero's look in chrome/aeris.css) and colours for Firefox's menus. Loaded in the background
// page (after background.js) and by the studio page for its preview swatches.

const STUDIO_DEFAULTS = {
  name: "My look",
  frameA: "#1f7fd6",       // tab bar, top
  frameB: "#7fd0ff",       // tab bar, bottom
  frameText: "#ffffff",    // tab titles and buttons on the tab bar
  toolbarA: "#eaf6ff",     // toolbar, top
  toolbarB: "#bfe3fb",     // toolbar, bottom
  toolbarText: "#04345c",  // toolbar icons
  accent: "#1e9be8",
  tabSelected: "#d6efff",  // the open tab
  tabSelectedText: "#04345c",
  tabGlass: 18,            // how see-through other tabs are (0 = none, 60 = very milky)
  urlbar: "#ffffff",
  urlbarText: "#04345c",
  bookmarks: "#cfeaff",
  bookmarksText: "#04345c",
  side: "",                // side tab bar ("" = same as the tab bar)
  gloss: 70,               // shine, 0–100
  tabRadius: 10,           // px
  urlbarRadius: 999,       // px (999 = pill)
  buttons: "orbs",         // orbs | flat | outline
  tabBorders: true,
  glow: false,             // glow around the open tab
  font: "",                // "" = Aero's Segoe UI
  fontSize: 0,             // 0 = normal
  image: "",               // data: URL of a picture behind the tab bar
  imageFit: "cover",       // cover | tile
  imageOpacity: 100
};

const studioFonts = {
  "": "\"Segoe UI\", \"Frutiger\", Tahoma, sans-serif",
  rounded: "\"Segoe UI Variable Display\", \"Segoe UI\", sans-serif",
  tahoma: "Tahoma, Verdana, sans-serif",
  verdana: "Verdana, sans-serif",
  trebuchet: "\"Trebuchet MS\", sans-serif",
  georgia: "Georgia, serif",
  palatino: "\"Palatino Linotype\", \"Book Antiqua\", serif",
  comic: "\"Comic Sans MS\", \"Comic Neue\", cursive",
  bahnschrift: "Bahnschrift, \"Segoe UI\", sans-serif",
  consolas: "Consolas, \"Courier New\", monospace",
  impact: "Impact, \"Arial Black\", sans-serif"
};

// Light text on a colour, or dark? (for Firefox's menus, which take plain colours)
function studioIsDark(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 140;
}

function studioCss(input) {
  const v = { ...STUDIO_DEFAULTS, ...input };
  const shine = a => `rgba(255,255,255,${(v.gloss / 100) * a})`;
  const gloss = (top, mid) => `linear-gradient(180deg, ${shine(top)} 0%, ${shine(mid)} 50%, rgba(255,255,255,0) 51%)`;
  const font = studioFonts[v.font] || studioFonts[""];
  const out = [`:root {
  --frame-a: ${v.frameA};
  --frame-b: ${v.frameB};
  --text: ${v.frameText};
  --text-shadow: ${studioIsDark(v.frameText) ? "0 1px 0 rgba(255,255,255,0.6)" : "0 1px 2px rgba(0,0,0,0.45)"};
  --accent: ${v.accent};
  --gloss: ${v.gloss / 100};
  --tab-radius: ${v.tabRadius}px;
  font-family: ${font} !important;
  ${v.fontSize ? `font-size: ${v.fontSize}px !important;` : ""}
}
#TabsToolbar .tab-label, #urlbar-input, toolbarbutton, #PersonalToolbar { font-family: ${font} !important; }

/* Toolbar */
#nav-bar {
  background: ${gloss(0.6, 0.2)}, linear-gradient(180deg, ${v.toolbarA}, ${v.toolbarB}) !important;
  color: ${v.toolbarText} !important;
  border-bottom-color: color-mix(in srgb, ${v.toolbarB}, #000 15%) !important;
}
#nav-bar toolbarbutton:not(#back-button, #forward-button, #reload-button, #stop-button) { color: ${v.toolbarText} !important; fill: ${v.toolbarText} !important; }

/* Tabs */
.tabbrowser-tab .tab-background {
  background: ${gloss(0.5, 0.08)}, rgba(255,255,255,${v.tabGlass / 100}) !important;
  ${v.tabBorders ? "" : "border-color: transparent !important;"}
}
.tabbrowser-tab[selected] .tab-background {
  background: ${gloss(0.9, 0.35)}, ${v.tabSelected} !important;
  ${v.glow ? `box-shadow: 0 0 12px ${v.accent} !important;` : ""}
}
.tabbrowser-tab[selected] .tab-label, .tabbrowser-tab[selected] .tab-close-button, .tabbrowser-tab[selected] .aeris-stack-button { color: ${v.tabSelectedText} !important; text-shadow: none !important; }

/* Address bar */
#urlbar .urlbar-background {
  background: ${v.urlbar} !important;
  border-radius: ${v.urlbarRadius}px !important;
}
#urlbar[open] .urlbar-background { border-radius: ${Math.min(v.urlbarRadius, 16)}px !important; }
#urlbar-input, #urlbar { color: ${v.urlbarText} !important; }

/* Bookmarks bar */
#PersonalToolbar { background: ${v.bookmarks} !important; color: ${v.bookmarksText} !important; }
#PersonalToolbar toolbarbutton.bookmark-item { color: ${v.bookmarksText} !important; }
`];
  if (v.side) out.push(`sidebar-main { background: ${gloss(0.35, 0)}, ${v.side} !important; }`);

  // Buttons: Aero's glossy orbs (the default), or plain flat or outlined ones
  const nav = "#nav-bar :is(#back-button, #forward-button, #reload-button, #stop-button) > .toolbarbutton-icon";
  if (v.buttons === "flat") {
    out.push(`${nav} { background: none !important; border-color: transparent !important; box-shadow: none !important; fill: ${v.toolbarText} !important; color: ${v.toolbarText} !important; }
${nav.replace("> .toolbarbutton-icon", ":hover > .toolbarbutton-icon")} { background: color-mix(in srgb, ${v.toolbarText} 12%, transparent) !important; }
#aeris-core_aeris_app-BAP .toolbarbutton-badge-stack { background: none !important; border-color: transparent !important; box-shadow: none !important; }
#TabsToolbar-customization-target::before { display: none !important; }`);
  } else if (v.buttons === "outline") {
    out.push(`${nav} { background: none !important; border: 1.5px solid ${v.accent} !important; box-shadow: none !important; fill: ${v.accent} !important; color: ${v.accent} !important; }`);
  }

  // A picture behind the tab bar
  if (v.image) {
    const fit = v.imageFit === "tile" ? "auto" : "cover";
    out.push(`#TabsToolbar { position: relative; }
#TabsToolbar::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: url("${v.image}") center / ${fit} ${v.imageFit === "tile" ? "repeat" : "no-repeat"};
  opacity: ${v.imageOpacity / 100};
}
#TabsToolbar { background-color: transparent !important; isolation: isolate; }`);
  }
  return out.join("\n");
}

// Colours for Firefox's menus and popups, to match.
function studioApiColors(input) {
  const v = { ...STUDIO_DEFAULTS, ...input };
  const darkBar = studioIsDark(v.toolbarB);
  return {
    colors: {
      frame: v.frameA,
      frame_inactive: v.frameA,
      tab_background_text: v.frameText,
      tab_selected: v.tabSelected,
      tab_text: v.tabSelectedText,
      tab_line: v.accent,
      tab_loading: v.accent,
      toolbar: v.toolbarB,
      toolbar_text: v.toolbarText,
      bookmark_text: v.bookmarksText,
      icons: v.toolbarText,
      toolbar_field: v.urlbar,
      toolbar_field_text: v.urlbarText,
      toolbar_field_focus: v.urlbar,
      toolbar_field_border_focus: v.accent,
      toolbar_bottom_separator: "transparent",
      popup: darkBar ? "#1b2230" : "#ffffff",
      popup_text: darkBar ? "#f2f6fa" : "#10202e",
      popup_highlight: v.accent,
      popup_highlight_text: "#ffffff",
      sidebar: v.side || v.frameA,
      sidebar_text: v.frameText
    },
    properties: { color_scheme: darkBar ? "dark" : "light", content_color_scheme: "auto" }
  };
}
