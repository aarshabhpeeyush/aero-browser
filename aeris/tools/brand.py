"""Rebrands a copy of Firefox's "unofficial" branding folder as Aeris: names, then every icon."""
import base64, io, pathlib, re, sys
from PIL import Image

NAME = "Aeris"
VENDOR = "Aeris Project"
branding, icon_path = pathlib.Path(sys.argv[1]), sys.argv[2]
icon = Image.open(icon_path).convert("RGBA")

def sized(w, h):
    return icon.resize((w, h), Image.LANCZOS)

# ---- Names ----
for f in branding.rglob("*"):
    if f.name == "brand.ftl":
        out = []
        for line in f.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^(-[\w-]+)\s*=", line)
            if m:
                key = m.group(1)
                line = f"{key} = {VENDOR if key.startswith('-vendor') else NAME}"
            elif line.startswith("trademarkInfo"):
                line = "trademarkInfo = Aeris is built on Firefox, made by Mozilla and its contributors."
            out.append(line)
        f.write_text("\n".join(out) + "\n", encoding="utf-8")
    elif f.name in ("brand.properties", "brand.dtd"):
        text = f.read_text(encoding="utf-8")
        text = re.sub(r"^(\w*[Vv]endor\w*\s*=\s*).*$", lambda m: m.group(1) + VENDOR, text, flags=re.M)
        text = re.sub(r"^(brand\w*Name\s*=\s*).*$", lambda m: m.group(1) + NAME, text, flags=re.M)
        text = re.sub(r'(<!ENTITY\s+\w*[Nn]ame\w*\s+")[^"]*(")', lambda m: m.group(1) + NAME + m.group(2), text)
        f.write_text(text, encoding="utf-8")
    elif f.name == "configure.sh":
        text = f.read_text(encoding="utf-8")
        text = re.sub(r"^MOZ_APP_DISPLAYNAME=.*$", f"MOZ_APP_DISPLAYNAME={NAME}", text, flags=re.M)
        if "MOZ_APP_DISPLAYNAME" not in text:
            text += f"\nMOZ_APP_DISPLAYNAME={NAME}\n"
        f.write_text(text, encoding="utf-8")

# ---- Icons ----
png_b64 = lambda size: base64.b64encode((lambda b: (sized(size, size).save(b, "PNG"), b.getvalue())[1])(io.BytesIO())).decode()
for f in branding.rglob("*"):
    if f.suffix == ".png":
        w, h = Image.open(f).size
        sized(w, h).save(f)
    elif f.suffix == ".ico":
        sizes = sorted(Image.open(f).info.get("sizes") or [(16, 16), (32, 32), (48, 48), (256, 256)])
        icon.save(f, format="ICO", sizes=sizes)
    elif f.suffix == ".icns":
        # The Mac app icon (Pillow makes every size it needs from the big one)
        sized(1024, 1024).save(f, format="ICNS")
    elif f.suffix == ".svg":
        if "wordmark" in f.name:
            svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="172" height="42" viewBox="0 0 172 42">'
                   '<text x="0" y="34" font-family="Segoe UI, sans-serif" font-size="38" font-weight="300" '
                   f'fill="context-fill #1e9be8">{NAME}</text></svg>')
        else:
            svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
                   f'<image width="256" height="256" href="data:image/png;base64,{png_b64(256)}"/></svg>')
        f.write_text(svg, encoding="utf-8")

for f in sorted(branding.rglob("*")):
    if f.name in ("brand.ftl", "brand.properties", "configure.sh"):
        print(f"---- {f.relative_to(branding)}\n{f.read_text(encoding='utf-8')}")
