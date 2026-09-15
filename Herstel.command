#!/bin/bash
# Zet de broncode van DawgAgent terug naar een eerdere back-up.
# Gebruik dit als DawgAgent na een zelf-aanpassing niet meer start: dubbelklik op dit bestand.

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SNAP_DIR="$HOME/Library/Application Support/DawgAgent/snapshots"

if [ ! -d "$SNAP_DIR" ] || [ -z "$(ls -A "$SNAP_DIR" 2>/dev/null)" ]; then
  echo "Geen back-ups gevonden in: $SNAP_DIR"
  read -n 1 -s -r -p "Druk op een toets om te sluiten…"
  exit 1
fi

echo "Laatste back-ups (nieuwste onderaan):"
echo
ls -1 "$SNAP_DIR" | sort | tail -n 12 | while read -r id; do
  reason=$(sed -n 's/.*"reason": *"\(.*\)".*/\1/p' "$SNAP_DIR/$id/meta.json" 2>/dev/null)
  echo "  $id   $reason"
done
LATEST="$(ls -1 "$SNAP_DIR" | sort | tail -n 1)"
echo
read -r -p "Welke back-up herstellen? [Enter = $LATEST] " CHOICE
CHOICE="${CHOICE:-$LATEST}"
SRC="$SNAP_DIR/$CHOICE/files/"

if [ ! -d "$SRC" ]; then
  echo "Back-up niet gevonden: $CHOICE"
  exit 1
fi

rsync -a --delete --exclude node_modules --exclude .git --exclude dist "$SRC" "$APP_DIR/"
chmod +x "$APP_DIR/Herstel.command" "$APP_DIR/scripts/"*.sh 2>/dev/null
echo
echo "Hersteld naar $CHOICE. Je kunt DawgAgent weer starten."
read -n 1 -s -r -p "Druk op een toets om te sluiten…"
