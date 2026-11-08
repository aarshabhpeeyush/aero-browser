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

(out / "index.html").write_text('<!doctype html><meta charset="utf-8"><title>Aquaris</title>'
                                '<meta http-equiv="refresh" content="0; url=aquaris/"><a href="aquaris/">Open Aquaris</a>\n', encoding="utf-8")
(out / ".nojekyll").write_text("")
print(f"Aquaris web version: {out}")
