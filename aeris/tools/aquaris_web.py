"""Puts the web version of Aquaris (for iPads, phones and any browser) together in one folder:
   <out>/aquaris/      Aquaris itself
   <out>/themes/       Aeris's theme list (so the web version has the same themes)
   <out>/index.html    sends visitors on to aquaris/
Usage: python aeris/tools/aquaris_web.py [out folder]   (default: build/aquaris-web)"""
import pathlib, shutil, subprocess, sys, tempfile

repo = pathlib.Path(__file__).resolve().parents[2]
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else repo / "build" / "aquaris-web"
shutil.rmtree(out, ignore_errors=True)
(out / "themes").mkdir(parents=True)
shutil.copytree(repo / "aquaris", out / "aquaris",
                ignore=shutil.ignore_patterns("README.md", "DESIGN.md", "system.ps1", "icon.ico"))

# The theme list is made by addon.py while it builds Aeris Core, so build it into a throwaway folder
with tempfile.TemporaryDirectory() as tmp:
    fake = pathlib.Path(tmp)
    (fake / "browser/extensions").mkdir(parents=True)
    (fake / "browser/extensions/moz.build").write_text("DIRS += [\n]\n")
    subprocess.run([sys.executable, "-I", str(repo / "aeris/tools/addon.py"), str(fake)], check=True, cwd=repo, stdout=subprocess.DEVNULL)
    shutil.copy(fake / "browser/extensions/aeris/extension/themes/index.json", out / "themes/index.json")

# Aeris for the iPad app: Aeris's own New Tab page (the one Aero had), its themes and its icon
newtab = out / "aeris" / "newtab"
shutil.copytree(repo / "pages" / "newtab", newtab)
page = (newtab / "index.html").read_text(encoding="utf-8")
theme_link = '<link id="aeroTheme" rel="stylesheet" href="aero://themes/_active/newtab.css">'
assert theme_link in page
# The theme comes from the address: index.html#theme=<id> (Aquaris passes the Aeris theme you picked)
page = page.replace(theme_link, '<link id="aeroTheme" rel="stylesheet">\n  <script>{ const pick = () => { const id = (location.hash.match(/theme=([\\w-]+)/) || [])[1];'
                    ' const link = document.getElementById("aeroTheme"); if (id) link.href = "../../themes/" + id + "/newtab.css"; else link.removeAttribute("href");'
                    ' const size = +((location.hash.match(/size=([0-9]+)/) || [])[1] || 100); document.documentElement.style.setProperty("--wscale", size / 100); };'
                    ' pick(); addEventListener("hashchange", pick); }</script>')
# Fingers: dragging a widget moves it instead of scrolling the page
page = page.replace("</head>", "<style>.widget, .widget * { touch-action: none; } input, textarea, .list, .queue { touch-action: auto; } .widget { transform: translate(-50%, -50%) scale(var(--wscale, 1)); }</style>\n</head>", 1)
(newtab / "index.html").write_text(page, encoding="utf-8")
sys.path.insert(0, str(repo / "aeris" / "tools"))
import ipad_theme  # noqa: E402
for folder in sorted((repo / "themes-builtin").iterdir()):
    if folder.is_dir():
        shutil.copytree(folder, out / "themes" / folder.name, dirs_exist_ok=True)
        # The theme's frame (tab bar, tabs, toolbar, buttons, address bar) for Aeris on the iPad
        if (folder / "theme.css").exists():
            (out / "themes" / folder.name / "ipad-frame.css").write_text(
                ipad_theme.translate((folder / "theme.css").read_text(encoding="utf-8"), folder.name), encoding="utf-8")
(out / "icons").mkdir(exist_ok=True)
from PIL import Image
Image.open(repo / "build" / "icon.png").convert("RGBA").resize((128, 128), Image.LANCZOS).save(out / "icons" / "aeris-128.png")

(out / "index.html").write_text('<!doctype html><meta charset="utf-8"><title>Aquaris</title>'
                                '<meta http-equiv="refresh" content="0; url=aquaris/"><a href="aquaris/">Open Aquaris</a>\n', encoding="utf-8")
(out / ".nojekyll").write_text("")
print(f"Aquaris web version: {out}")
