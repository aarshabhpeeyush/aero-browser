"""Turn an Aero theme.css (which styles Aero's own frame: #titlebar, .tab, #toolbar, .orb, #address...)
into CSS for Aeris's frame, which is Firefox's (#TabsToolbar, .tabbrowser-tab, #nav-bar...).

Each Aero selector is looked up in MAP. Rules for selectors Aeris doesn't have are left out, every
declaration gets !important (Firefox's own styles are very specific), and @keyframes are kept.
Aero's side panels (.panel, .gel, .choice...) aren't converted: the Customize panel in Aeris is built
like Aero's and loads theme.css itself."""
import re

ORBS = "#nav-bar :is(#back-button, #forward-button, #reload-button, #stop-button) > .toolbarbutton-icon"
TEXT_PROPS = ("color", "text-shadow", "font", "letter-spacing", "text-transform")

# Aero selector -> Aeris selector, or (box, text) for things Firefox draws as two parts
# (a tab's glass is .tab-background, its title is .tab-label).
MAP = {
    "#titlebar": "#TabsToolbar",
    ".tab": (".tabbrowser-tab .tab-background", ".tabbrowser-tab .tab-label"),
    ".tab:hover": (".tabbrowser-tab:hover .tab-background:not([selected])", ".tabbrowser-tab:hover:not([selected]) .tab-label"),
    ".tab.active": (".tabbrowser-tab[selected] .tab-background", ".tabbrowser-tab[selected] .tab-label"),
    ".app-orb": "#TabsToolbar-customization-target::before",
    "#toolbar": "#nav-bar",
    ".orb": ORBS,
    ".navpair .orb": ORBS,
    ".orb:hover": ORBS.replace("> .toolbarbutton-icon", ":hover > .toolbarbutton-icon"),
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
    # Fonts only (see FONT_ONLY)
    "body": ":root",
    "button": "toolbarbutton",
    "input": "#urlbar-input",
    "select": None,
}
# Tabs at the side: only used when Aeris has its tabs on the left or right.
SIDE_MAP = {".side #titlebar": "sidebar-main"}
FONT_ONLY = {"body", "button", "input", "select"}


def _blocks(css):
    """Yield (prelude, body) for each top-level block."""
    i, n = 0, len(css)
    while i < n:
        start = css.find("{", i)
        if start < 0:
            return
        depth, j = 1, start + 1
        while j < n and depth:
            depth += {"{": 1, "}": -1}.get(css[j], 0)
            j += 1
        yield css[i:start].strip(), css[start + 1:j - 1]
        i = j


def _decls(body):
    out = []
    for d in re.split(r";(?![^(]*\))", body):
        d = d.strip()
        if ":" not in d:
            continue
        name, value = d.split(":", 1)
        out.append((name.strip(), value.strip()))
    return out


def _render(selector, decls):
    if not decls:
        return ""
    lines = []
    for name, value in decls:
        if not name.startswith("--") and "!important" not in value:
            value += " !important"
        lines.append(f"  {name}: {value};")
    return f"{selector} {{\n" + "\n".join(lines) + "\n}\n"


def translate(css):
    """Return (frame_css, side_css)."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    frame, side = [], []
    for prelude, body in _blocks(css):
        if prelude.startswith("@keyframes"):
            frame.append(f"{prelude} {{{body}}}\n")
            continue
        if prelude.startswith("@"):
            continue
        decls = _decls(body)
        for sel in (s.strip() for s in prelude.split(",")):
            sel = re.sub(r"\s+", " ", sel)
            if sel == ":root":
                frame.append(_render(":root", [d for d in decls if d[0].startswith("--")]))
                continue
            if sel in SIDE_MAP:
                side.append(_render(SIDE_MAP[sel], decls))
                continue
            target = MAP.get(sel)
            if not target:
                continue
            use = [d for d in decls if d[0].startswith("font")] if sel in FONT_ONLY else decls
            if isinstance(target, tuple):
                box, text = target
                frame.append(_render(box, [d for d in use if not d[0].startswith(TEXT_PROPS)]))
                frame.append(_render(text, [d for d in use if d[0].startswith(TEXT_PROPS)]))
            else:
                frame.append(_render(target, use))
    return "".join(frame), "".join(side)


if __name__ == "__main__":
    import sys
    a, b = translate(open(sys.argv[1], encoding="utf-8").read())
    print(a)
    print("/* ---- side ---- */")
    print(b)
