#!/usr/bin/env bash
# Turns a plain Firefox source folder into Aeris: branding, settings, our own files and patches.
# Usage: aeris/prepare.sh <firefox source folder>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$(cd "$1" && pwd)"

rm -rf "$src/browser/branding/aeris"
cp -r "$src/browser/branding/unofficial" "$src/browser/branding/aeris"
python3 "$here/tools/brand.py" "$src/browser/branding/aeris" "$here/../build/icon.png"

cp "$here/mozconfig" "$src/mozconfig"

if [ -d "$here/overlay" ]; then cp -r "$here/overlay/." "$src/"; fi
for p in "$here"/patches/*.patch; do
  [ -e "$p" ] || continue
  echo "Applying $(basename "$p")"
  patch -d "$src" -p1 --forward < "$p"
done
