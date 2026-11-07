#!/usr/bin/env bash
# Turns a plain Firefox source folder into Aeris: branding, settings, our own files and patches.
# Usage: aeris/prepare.sh <firefox source folder> [windows|linux]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$(cd "$1" && pwd)"
platform="${2:-windows}"

rm -rf "$src/browser/branding/aeris"
cp -r "$src/browser/branding/unofficial" "$src/browser/branding/aeris"
python3 "$here/tools/brand.py" "$src/browser/branding/aeris" "$here/../build/icon.png"

if [ "$platform" = linux ]; then
  cp "$here/mozconfig-linux" "$src/mozconfig"
  system="X11; Linux x86_64"
else
  cp "$here/mozconfig" "$src/mozconfig"
  system="Windows NT 10.0; Win64; x64"
fi
python3 "$here/tools/addon.py" "$src"
cat "$here/prefs.js" >> "$src/browser/branding/aeris/pref/firefox-branding.js"
# Websites see Aeris as the Firefox it's built on (like LibreWolf, Floorp and Zen do), so sites
# such as addons.mozilla.org work normally instead of asking you to download Firefox.
major="$(cut -d. -f1 "$here/firefox-version.txt")"
echo "pref(\"general.useragent.override\", \"Mozilla/5.0 (${system}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0\");" \
  >> "$src/browser/branding/aeris/pref/firefox-branding.js"

if [ -d "$here/overlay" ]; then cp -r "$here/overlay/." "$src/"; fi
for p in "$here"/patches/*.patch; do
  [ -e "$p" ] || continue
  echo "Applying $(basename "$p")"
  patch -d "$src" -p1 --forward < "$p"
done
