# DawgAgent

Je eigen agent-app op DeepSeek — vergelijkbaar met Claude Code of Codex, maar met een simpele Mac-interface.

- **Chatten & laten werken**: DawgAgent leest en bewerkt bestanden, draait commando’s, zoekt op het web en houdt een takenlijst bij.
- **Uploaden**: foto’s, spreadsheets (Excel/CSV/Numbers, alle tabbladen), PDF, Word, code en hele mappen. Via de **+**-knop, slepen of plakken (⌘V).
- **Skills**: herbruikbare instructies (map met `SKILL.md`, zelfde formaat als Claude Code). Importeren, zelf maken, of DawgAgent er een laten schrijven.
- **Connectors**: MCP-servers, lokaal (`npx …`) of via URL. JSON uit Claude Desktop/Cursor kun je direct plakken.
- **Computer use**: DawgAgent ziet je scherm (screenshot + tekstherkenning) en bedient muis en toetsenbord. Noodstop: **⌘⇧⎋**.
- **Browser (Chrome-extensie)**: DawgAgent leest en bedient je eigen Chrome-tabs via de extensie in `browser-extension/`. Hij krijgt paginatekst en een genummerde lijst met knoppen en velden in plaats van screenshots — zuiniger met tokens en preciezer. Zeg bijvoorbeeld: *"gebruik de browser extensie en zoek …"*.
- **Zijpaneel** (⌘⇧B): vier tabbladen naast de chat — een **zijchat** die de context van de chat deelt (vraag daar om extra uitleg over iets uit het gesprek, zonder de hoofdchat te vervuilen), de **takenlijst** met de voortgang (met een schakelaar om DawgAgent bij elke opdracht zelf een lijst te laten bijhouden), een eigen **browser** (die DawgAgent ook kan lezen en bedienen via de tool `paneel_browser`) en een **terminal** met een echte shell in je werkmap.
- **Zelf-aanpassing**: vraag DawgAgent om zichzelf te verbeteren (“voeg een donkere modus-knop toe”). Vóór elke wijziging wordt een back-up gemaakt.

## Starten

```bash
cd ~/Projects/DawgAgent
npm install        # eenmalig
npm start          # start DawgAgent
```

Maak er een echte app van in `~/Applications` (met eigen icoon, te vinden via Spotlight):

```bash
npm run make-app
```

Bij de eerste start plak je je DeepSeek API-sleutel (aan te maken op platform.deepseek.com). Hij wordt alleen lokaal opgeslagen.

## Gebruik

| Onderdeel | Waar |
|---|---|
| Werkmap kiezen | map-knop onder het invoerveld |
| Goedkeuring | *Vraag eerst* · *Auto-bewerken* (standaard) · *Volledig automatisch* |
| Model & nadenken | rechtsonder in het invoerveld (Flash ziet afbeeldingen) |
| Computer use aan/uit | monitor-knop onder het invoerveld |
| Skills, Connectors, Instellingen | zijbalk |
| Zijpaneel (zijchat · taken · browser · terminal) | knop in de zijbalk, of ⌘⇧B |
| Browser-extensie | Instellingen → Browser (eenmalig laden in Chrome) |

Staat er een `AGENTS.md` in je werkmap, dan leest DawgAgent die automatisch als projectinstructies.

### Computer use
macOS vraagt twee toestemmingen (Systeeminstellingen → Privacy en beveiliging):
**Toegankelijkheid** (muis/toetsenbord) en **Schermopname** (screenshots). Zet daar *DawgAgent* aan (of *Electron*/*Terminal* als je via `npm start` opstart) en herstart DawgAgent. De eerste keer bouwt DawgAgent een kleine native helper; daarvoor zijn de Xcode Command Line Tools nodig (`xcode-select --install`).

Tijdens computer use gaat het DawgAgent-venster opzij en verschijnt rechtsonder een balkje met **Stop**.

### Browser-extensie (eigen Chrome)
De extensie in `browser-extension/` laat DawgAgent je eigen Chrome lezen en bedienen. Eenmalig laden:

1. Open Chrome en ga naar `chrome://extensions`
2. Zet **Ontwikkelaarsmodus** aan (rechtsboven)
3. Kies **Uitgepakte extensie laden** en selecteer `~/Library/Application Support/DawgAgent/browser-extension`
   (DawgAgent houdt die map automatisch gelijk aan `browser-extension/` in deze repo)

Klik daarna op het DawgAgent-icoon in de werkbalk: je krijgt een **zijpaneel** met de tab waar je naar kijkt, een live log van wat de agent leest en doet, een vraagveld en een stopknop. Typ daar bijvoorbeeld *"vat deze pagina samen"* of *"zoek op deze site de study guidance pagina"* — dat komt als bericht in DawgAgent binnen, met de actieve tab erbij.

- Groen rondje = verbonden, grijs = geen verbinding (DawgAgent nog niet open), oranje = gepauzeerd.
- Handig om te weten: standaard pakt de agent **de tab die jij voor je hebt**. Je kunt zelf blijven klikken en wisselen; het paneel volgt je.
- Inloggen: DawgAgent vult je e-mail/gebruikersnaam en wacht; het **wachtwoord typ je zelf** (Chrome vult het meestal automatisch in) — wachtwoorden gaan nooit door de agent.
- Zonder Chrome in de buurt kun je het gereedschap uitzetten: **Instellingen → Browser**.

### Zelf-aanpassing & herstellen
DawgAgent kent zijn eigen broncode (deze map). Na een wijziging herlaadt hij zichzelf.
- Terugzetten: **Instellingen → Zelf-aanpassing & versies → Herstellen**.
- Start DawgAgent niet meer? Dubbelklik op **`Herstel.command`** in deze map.

## Waar staat wat

| | |
|---|---|
| Broncode | deze map (`src/` = achterkant, `renderer/` = interface, `native/` = computer-use-helper) |
| Chats, skills, instellingen, back-ups | `~/Library/Application Support/DawgAgent` |
| API-sleutel | `~/Library/Application Support/DawgAgent/credentials.json` (alleen leesbaar voor jou) |
