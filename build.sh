#!/bin/sh
# Packs the extension into dist/zen-mpris-tabs-<versión>.xpi
set -eu
cd "$(dirname "$0")"
v=$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')
mkdir -p dist
rm -f "dist/zen-mpris-tabs-$v.xpi"
(cd extension && zip -qr -X "../dist/zen-mpris-tabs-$v.xpi" .)
echo "dist/zen-mpris-tabs-$v.xpi"
