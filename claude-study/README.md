# Study-functie van DawgAgent in de gewone Claude

Alles in deze map is een omzetting van de study-modus van DawgAgent (`src/prompt.js` + `src/study.js`)
naar wat claude.ai aankan. Je kiest één route, of je combineert ze.

| Bestand | Waarvoor |
|---|---|
| `studeren.zip` | Skill om te uploaden in claude.ai |
| `studeren/SKILL.md` | De bron van die skill (hier aanpassen, daarna opnieuw zippen) |
| `stijl-instructies.md` | Tekst om in een eigen stijl te plakken |
| `projectinstructies.md` | Tekst om in een projectinstructie te plakken |
| `leerstatus-template.md` | De vorm van de leerstatus die je tussen gesprekken bewaart |

Opnieuw zippen na een wijziging:

    cd ~/Projects/DawgAgent/claude-study && rm -f studeren.zip && zip -r studeren.zip studeren

## Route 1 — als skill (aanbevolen)
1. claude.ai → je initiaal linksonder → **Settings** → **Capabilities** (bij sommige accounts *Features*) → **Skills**.
2. **Upload skill** → kies `studeren.zip` → zet de schakelaar van *studeren* aan.
3. Vereist Pro, Max, Team of Enterprise met code-uitvoering aan.
4. Gebruiken: upload je slides in een gesprek en zeg bijvoorbeeld *"leer me dit deck"* of *"toets me hierover"*.
   Komt hij er niet van zelf op, zeg dan letterlijk *"gebruik de studeren-skill"*.

## Route 2 — als eigen stijl (de regels gelden dan in élk bericht)
1. In een gesprek: **Search and tools** onder het invoerveld → **Use style** → **Create & edit styles**.
2. **Create custom style** → **Describe style instead** → **Use custom instructions (advanced)**.
3. Plak de inhoud van `stijl-instructies.md`, noem hem *Study*, en bewaar.
4. Per gesprek aanzetten via hetzelfde stijlmenu. Zet hem uit als je gewoon antwoorden wil.

## Route 3 — als project per vak (voor het geheugen)
1. **Projects** → nieuw project, bijvoorbeeld *Wiskunde examen*.
2. Zet in **Instructions** de tekst uit `projectinstructies.md` plus de volledige inhoud van
   `studeren/SKILL.md` (alles onder de frontmatter).
3. Zet je slides en `leerstatus.md` in de projectkennis.
4. Elk nieuw gesprek in dat project begint met de leerstatus; aan het eind laat je de bijgewerkte
   status geven en vervang je `leerstatus.md`.

## Het geheugen (dekking, mastery, foutpatronen)
DawgAgent houdt dit automatisch bij in `study/state.json` per chat. In claude.ai kan dat niet,
dus kies er één:
- **Memory aan** (Settings → Capabilities → Memory): Claude onthoudt de status zelf tussen gesprekken.
- **Handmatig**: laat aan het eind van elke sessie het statusblok geven en bewaar het als
  `leerstatus.md` in de projectkennis (of plak het aan het begin van het volgende gesprek).

## Wat niet mee kan
- Het zijpaneel met de échte dia's. Upload je slides als **pdf**, dan ziet Claude ze echt;
  een `.pptx` wordt alleen als tekst gelezen.
- Het automatisch meesturen van de leerstatus in elke beurt. In claude.ai moet Claude de status
  zelf teruglezen, dus dat is minder waterdicht dan in DawgAgent.
