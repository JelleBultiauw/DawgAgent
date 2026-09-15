#!/bin/bash
# Eenmalige wissel: van penuraplicatie.app naar DawgAgent.app.
# Dubbelklik dit bestand. De oude app wordt afgesloten en verwijderd; DawgAgent start daarna.
cd "$(dirname "$0")" || exit 1

echo "DawgAgent-app bouwen…"
bash scripts/make-app.sh || {
  echo "Bouwen mislukte. Probeer het opnieuw of open de app via npm start."
  read -n 1 -s -r -p "Druk op een toets om te sluiten…"
  exit 1
}

echo
echo "Oude app (penuraplicatie) afsluiten…"
osascript -e 'tell application "penuraplicatie" to quit' >/dev/null 2>&1
sleep 2
pkill -f "Applications/penuraplicatie.app" >/dev/null 2>&1
sleep 1

if [ -d "$HOME/Applications/penuraplicatie.app" ]; then
  mv "$HOME/Applications/penuraplicatie.app" "$HOME/.Trash/DawgAgent-oude-app-$(date +%s).app" 2>/dev/null || rm -rf "$HOME/Applications/penuraplicatie.app"
fi

open "$HOME/Applications/DawgAgent.app"
echo
echo "Klaar! DawgAgent start nu."
echo
echo "Wat je daarna opnieuw moet instellen:"
echo "  • Computer use: Systeeminstellingen → Privacy en beveiliging →"
echo "    Schermopname én Toegankelijkheid aanzetten voor DawgAgent."
echo "  • Chrome: chrome://extensions → de DawgAgent-extensie opnieuw laden"
echo "    vanuit ~/Library/Application Support/DawgAgent/browser-extension"
echo
read -n 1 -s -r -p "Druk op een toets om te sluiten…"
