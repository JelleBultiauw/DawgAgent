#!/bin/bash
# Maakt ~/Applications/DawgAgent.app: een echte Mac-app die direct de code in deze map draait.
# Omdat de app naar deze map verwijst, gelden zelf-aanpassingen van DawgAgent meteen.
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="${1:-$HOME/Applications}"
DEST="$DEST_DIR/DawgAgent.app"
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
/usr/libexec/PlistBuddy -c "Set :CFBundleName DawgAgent" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName DawgAgent" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string DawgAgent" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier nl.dawgagent.app" "$PLIST"

if [ ! -f "$APP_DIR/assets/DawgAgent.icns" ]; then
  bash "$APP_DIR/scripts/make-icon.sh" || true
fi
if [ -f "$APP_DIR/assets/DawgAgent.icns" ]; then
  cp "$APP_DIR/assets/DawgAgent.icns" "$DEST/Contents/Resources/electron.icns"
fi

codesign --force --deep --sign - "$DEST" >/dev/null 2>&1 || echo "Let op: ondertekenen mislukt (de app werkt meestal toch)."
touch "$DEST"
echo "Klaar: $DEST"
echo "Start DawgAgent via Launchpad/Spotlight, of: open \"$DEST\""
