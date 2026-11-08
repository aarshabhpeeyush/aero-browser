"""Puts Aeris Core together inside the Firefox source, from aeris/addon plus Aero's own themes,
New Tab, What's New and Originals, so both browsers share one copy of them.
Usage: addon.py <firefox source folder>"""
import json, pathlib, re, shutil, sys, zipfile
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import chrome_theme  # noqa: E402

repo = pathlib.Path(__file__).resolve().parents[2]
src = pathlib.Path(sys.argv[1])
home = src / "browser/extensions/aeris"
ext = home / "extension"
version = (repo / "aeris/version.txt").read_text().strip()

shutil.rmtree(home, ignore_errors=True)
shutil.copytree(repo / "aeris/addon", ext)

# ---- Build files: a built-in add-on lives at resource://builtin-addons/aeris/ ----
(home / "moz.build").write_text('JAR_MANIFESTS += ["jar.mn"]\n')
(home / "jar.mn").write_text("browser.jar:\n    builtin-addons/aeris/ (extension/**)\n")
mb = src / "browser/extensions/moz.build"
text = mb.read_text()
if '"aeris"' not in text:
    text = text.replace("DIRS += [\n", 'DIRS += [\n    "aeris",\n', 1)
    mb.write_text(text)

manifest = json.loads((ext / "manifest.json").read_text())
# Firefox wants plain numbers ("1.0.0"); the full name ("1.0.0-beta.1") goes in version.json.
manifest["version"] = version.split("-")[0]
(ext / "version.json").write_text(json.dumps({"version": version}))
(ext / "manifest.json").write_text(json.dumps(manifest, indent=2))

# ---- Icons ----
icon = Image.open(repo / "build/icon.png").convert("RGBA")
(ext / "icons").mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    icon.resize((size, size), Image.LANCZOS).save(ext / f"icons/aeris-{size}.png")

# ---- Themes: Aero's theme folders, plus each theme.css converted for Aeris's frame (chrome.css and,
#      for tabs at the side, chrome-side.css; see chrome_theme.py), and an index for background.js ----
index = []
for folder in sorted((repo / "themes-builtin").iterdir()):
    if not (folder / "theme.json").exists():
        continue
    info = json.loads((folder / "theme.json").read_text(encoding="utf-8"))
    css = (folder / "theme.css").read_text(encoding="utf-8")
    root = re.search(r":root\s*\{(.*?)\}", css, re.S)
    vars_ = dict(re.findall(r"--([\w-]+)\s*:\s*([^;]+);", re.sub(r"/\*.*?\*/", "", root.group(1), flags=re.S))) if root else {}
    vars_ = {k: v.strip() for k, v in vars_.items()}
    shutil.copytree(folder, ext / "themes" / folder.name)
    frame_css, side_css = chrome_theme.translate(css)
    (ext / "themes" / folder.name / "chrome.css").write_text(frame_css, encoding="utf-8")
    (ext / "themes" / folder.name / "chrome-side.css").write_text(side_css, encoding="utf-8")
    sites = sorted(f.stem for f in (folder / "sites").glob("*.css")) if (folder / "sites").exists() else []
    index.append({
        "id": folder.name,
        "name": info.get("name", folder.name),
        "description": info.get("description", ""),
        "websites": info.get("websites"),
        "paper": info.get("paper"),
        "vars": vars_,
        "sites": sites,
        "websitesCss": (folder / "websites.css").exists(),
        "newtabCss": (folder / "newtab.css").exists(),
    })
(ext / "themes/index.json").write_text(json.dumps(index, indent=1))
print("Themes:", ", ".join(t["id"] for t in index))

# ---- Aquaris: the desktop of web apps (repo/aquaris), served at aquaris/ inside Aeris Core ----
shutil.copytree(repo / "aquaris", ext / "aquaris", ignore=shutil.ignore_patterns("README.md", "DESIGN.md"))

# ---- Website styles shared by every theme ----
for name in ("aero-sites.css", "site-fixes.css"):
    shutil.copy(repo / "pages" / name, ext / "content" / name)

# ---- Aero pages: New Tab and What's New ----
def page(name, fixes):
    shutil.copytree(repo / "pages" / name, ext / name)
    html = (ext / name / "index.html").read_text(encoding="utf-8")
    for old, new in fixes:
        assert old in html, f"{name}: {old!r} not found"
        html = html.replace(old, new)
    (ext / name / "index.html").write_text(html, encoding="utf-8")

theme_link = ('<link id="aeroTheme" rel="stylesheet" href="aero://themes/_active/newtab.css">', '<link id="aeroTheme" rel="stylesheet">')
page("newtab", [theme_link, ('<script src="shared.js"></script>', '<script src="../theme-link.js"></script>\n  <script src="shared.js"></script>')])
page("whatsnew", [theme_link, ('href="aero://newtab/"', 'href="../newtab/index.html"'),
                  ('<script src="changelog.js"></script>', '<script src="../theme-link.js"></script>\n  <script src="changelog.js"></script>')])

# ---- Aero Originals, packed as add-ons Aeris can install ----
ORIGINAL_IDS = {"aero-beat-lab": "aero-beat-lab@aeris.app", "aero-school-assist": "aero-school-assist@aeris.app", "aero-desktop-gifs": "desktop-gifs@rayytor"}
OPEN_PAGE = """// Aeris: clicking the toolbar button opens this extension's page in a tab.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL(%s) }));
"""
(ext / "originals").mkdir()
for folder in sorted((repo / "extensions-builtin").iterdir()):
    if folder.name not in ORIGINAL_IDS:
        continue
    m = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    gecko = {"id": ORIGINAL_IDS[folder.name], "strict_min_version": "128.0", "data_collection_permissions": {"required": ["none"]}}
    m["browser_specific_settings"] = {"gecko": gecko}
    extra = {}
    page_name = m.pop("aero_page", None)
    if page_name:
        extra["aeris-open.js"] = OPEN_PAGE % json.dumps(page_name)
        m["background"] = {"scripts": ["aeris-open.js"]}
    elif "background" in m and "service_worker" in m["background"]:
        m["background"] = {"scripts": [m["background"]["service_worker"]]}
    out = ext / "originals" / f"{folder.name}.xpi"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.rglob("*")):
            rel = f.relative_to(folder).as_posix()
            if f.is_file() and rel != "manifest.json":
                z.write(f, rel)
        z.writestr("manifest.json", json.dumps(m, indent=2))
        for name, body in extra.items():
            z.writestr(name, body)
    icons = m.get("icons", {})
    best = icons[max(icons, key=int)] if icons else None
    if best:
        shutil.copy(folder / best, ext / "originals" / f"{folder.name}.png")
    print("Original:", out.name, gecko["id"])
