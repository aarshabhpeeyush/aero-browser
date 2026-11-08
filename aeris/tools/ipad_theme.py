"""Turn an Aero theme.css (which styles Aero's own frame: #titlebar, .tab, #toolbar, .orb, #address...)
into CSS for Aeris in the Aquaris iPad app, whose frame is Aquaris's Aeris window (.ab-tabs, .ab-tab,
.ab-bar, .ab-btn, .ab-url). Like chrome_theme.py does for Aeris on a computer. Every rule is scoped to
.aeris-win.th-<theme id>, so a theme only styles Aeris windows that use it."""
import re
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from chrome_theme import _blocks, _decls, _render  # noqa: E402

MAP = {
    "#titlebar": ".ab-tabs",
    ".tab": ".ab-tab",
    ".tab:hover": ".ab-tab:hover",
    ".tab.active": ".ab-tab.on",
    ".tab .x": ".ab-tab-x",
    ".tab .x:hover": ".ab-tab-x:hover",
    "#toolbar": ".ab-bar",
    ".orb": ".ab-btn",
    ".navpair .orb": ".ab-btn",
    ".orb:hover": ".ab-btn:hover",
    "#address": ".ab-url",
    "#address:focus-within": ".ab-url:focus-within",
    "#url": ".ab-url input",
    "#url::placeholder": ".ab-url input::placeholder",
    ".side #titlebar": ":is(.ab-bars-left, .ab-bars-right) .ab-tabs",
    # Fonts only
    "body": ":is(.ab-tabs, .ab-bar)",
    "button": ":is(.ab-tab, .ab-btn)",
    "input": ".ab-url input",
}
FONT_ONLY = {"body", "button", "input"}


def translate(css, theme_id):
    scope = f".aeris-win.th-{theme_id}"
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = []
    for prelude, body in _blocks(css):
        if prelude.startswith("@keyframes"):
            out.append(f"{prelude} {{{body}}}\n")
            continue
        if prelude.startswith("@"):
            continue
        decls = _decls(body)
        for sel in (s.strip() for s in prelude.split(",")):
            sel = re.sub(r"\s+", " ", sel)
            if sel == ":root":
                vars_ = [(k, v) if k != "--accent" else (k, f"var(--ab-picked, {v})") for k, v in decls if k.startswith("--")]
                out.append(_render(f"{scope} :is(.ab-tabs, .ab-bar)", vars_))
                continue
            target = MAP.get(sel)
            if not target:
                continue
            use = [d for d in decls if d[0].startswith("font")] if sel in FONT_ONLY else decls
            # The side tab bar only when tabs are at a side
            if sel == ".side #titlebar":
                out.append(_render(f"{scope}:is(.ab-bars-left, .ab-bars-right) .ab-tabs", use))
            else:
                out.append(_render(f"{scope} {target}", use))
    return "".join(out)


if __name__ == "__main__":
    print(translate(open(sys.argv[1], encoding="utf-8").read(), sys.argv[2]))
