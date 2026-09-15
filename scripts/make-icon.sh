#!/bin/bash
# Tekent het penuraplicatie-icoon (native/make-icon.swift) en zet het om naar assets/penuraplicatie.icns.
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
mkdir -p "$APP_DIR/assets" "$TMP/icon.iconset"

swiftc -O "$APP_DIR/native/make-icon.swift" -o "$TMP/make-icon"
"$TMP/make-icon" "$TMP/icon-1024.png"
cp "$TMP/icon-1024.png" "$APP_DIR/assets/icon.png"

for size in 16 32 64 128 256 512 1024; do
  sips -z $size $size "$TMP/icon-1024.png" --out "$TMP/$size.png" >/dev/null
done
cp "$TMP/16.png" "$TMP/icon.iconset/icon_16x16.png"
cp "$TMP/32.png" "$TMP/icon.iconset/icon_16x16@2x.png"
cp "$TMP/32.png" "$TMP/icon.iconset/icon_32x32.png"
cp "$TMP/64.png" "$TMP/icon.iconset/icon_32x32@2x.png"
cp "$TMP/128.png" "$TMP/icon.iconset/icon_128x128.png"
cp "$TMP/256.png" "$TMP/icon.iconset/icon_128x128@2x.png"
cp "$TMP/256.png" "$TMP/icon.iconset/icon_256x256.png"
cp "$TMP/512.png" "$TMP/icon.iconset/icon_256x256@2x.png"
cp "$TMP/512.png" "$TMP/icon.iconset/icon_512x512.png"
cp "$TMP/1024.png" "$TMP/icon.iconset/icon_512x512@2x.png"
iconutil -c icns "$TMP/icon.iconset" -o "$APP_DIR/assets/penuraplicatie.icns"
rm -rf "$TMP"
echo "Icoon gemaakt: assets/penuraplicatie.icns"
