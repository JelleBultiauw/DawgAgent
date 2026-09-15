#!/bin/bash
# Maakt ~/Applications/penuraplicatie.app: een echte Mac-app die direct de code in deze map draait.
# Omdat de app naar deze map verwijst, gelden zelf-aanpassingen van penuraplicatie meteen.
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="${1:-$HOME/Applications}"
DEST="$DEST_DIR/penuraplicatie.app"
SRC="$APP_DIR/node_modules/electron/dist/Electron.app"

if [ ! -d "$SRC" ]; then
  echo "Electron niet gevonden. Draai eerst: npm install"
  exit 1
fi

mkdir -p "$DEST_DIR"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
ln -s "$APP_DIR" "$DEST/Contents/Resources/app"

PLIST="$DEST/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName penuraplicatie" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName penuraplicatie" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string penuraplicatie" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier nl.penuraplicatie.app" "$PLIST"

if [ ! -f "$APP_DIR/assets/penuraplicatie.icns" ]; then
  bash "$APP_DIR/scripts/make-icon.sh" || true
fi
if [ -f "$APP_DIR/assets/penuraplicatie.icns" ]; then
  cp "$APP_DIR/assets/penuraplicatie.icns" "$DEST/Contents/Resources/electron.icns"
fi

codesign --force --deep --sign - "$DEST" >/dev/null 2>&1 || echo "Let op: ondertekenen mislukt (de app werkt meestal toch)."
touch "$DEST"
echo "Klaar: $DEST"
echo "Start penuraplicatie via Launchpad/Spotlight, of: open \"$DEST\""
