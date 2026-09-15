---
name: ai-3d-generation
description: AI-modellering in Studio met generate_procedural_model, generate_mesh, generate_material, generate_texture, segment_mesh en assets zoeken/invoegen
---
# AI 3D-generatie in Roblox Studio

## Welke tool wanneer?
| Doel | Tool |
|---|---|
| Object uit primitives met aanpasbare attributen (huis, stoel, auto, toren, creature in blokstijl) | generate_procedural_model |
| Gedetailleerde of organische mesh met textuur (standbeeld, rots, boom, monster, wapen) | generate_mesh |
| Bestaand asset uit eigen inventory of de Creator Store | search_asset → insert_asset |
| Nieuw materiaal (bijv. "mossige kasseien") | generate_material |
| Bestaande mesh een nieuw uiterlijk geven | generate_texture |
| Mesh opsplitsen in losse, benoemde onderdelen (voor animatie of kleuren) | segment_mesh |
| Afbeelding van schijf als referentie | store_image → attachedImageUri |

## generate_procedural_model
- Geef de woorden van de gebruiker door als `prompt`, inclusief gewenste attributen ("met instelbare hoogte, dakkleur en aantal ramen").
- `async = true` (standaard aanpak), daarna gewoon doorwerken. Het model wordt automatisch in Workspace gezet.
- `segmentation`: weglaten = automatisch; "explicit" + `partNames` als de gebruiker onderdelen noemt (max 8); "none" voor één stuk.

## generate_mesh
- `textPrompt`: beschrijf vorm, stijl, materiaal en kleur. Bijv. "low-poly cartoon oak tree, chunky trunk, bright green rounded canopy".
- `size` {x, y, z} in studs; kies realistische maten (boom ≈ 12–25 hoog, zwaard ≈ 4 lang).
- `maxTriangles` (12–20000): kleine props 300–1500, middelgroot 2000–5000, hero-assets tot 20000. Minder triangles = betere performance.
- Lange taak: `async = true` voor meerdere tegelijk; `wait_job_finished` als je het resultaat nodig hebt.

## Materiaal en textuur
- generate_material geeft BaseMaterial + MaterialVariant-naam terug. Zet op parts:
```lua
part.Material = Enum.Material.Cobblestone
part.MaterialVariant = "MossyCobblestone"
```
- generate_texture en segment_mesh hebben `selectedInstanceRef = { uniqueId = ... }` nodig. Haal de uniqueId op met inspect_instance.

## Assets uit de Creator Store
1. `search_asset` (scope "auto"; voor alleen de marketplace scope "creator_store"; overweeg `verifiedCreatorsOnly = true`).
2. `insert_asset` met `assetId`, `assetName` en `assetType`.
3. Bij een Model: controleer op scripts met search_game_tree (`instance_type = "BaseScript"`, pad van het asset). Meld verdachte scripts (require met getal, getfenv, loadstring, rare namen) en stel voor ze te verwijderen.

## Nabewerking (altijd doen)
- Zoek het nieuwe object (search_game_tree op naam), zet het op de juiste plek met `PivotTo`, en zet de grond eronder met een raycast.
- Statische objecten Anchored. Geef het een duidelijke naam en zet het in de juiste map (bijv. Workspace.Map.Props).
- Decoratief: `CanCollide = false` of `CollisionFidelity = Box` (collision-fidelity alleen in Edit instelbaar).
- Controleer met screen_capture en pas aan waar nodig.

## Prompt-tips
- Noem stijl expliciet: "low-poly", "stylized cartoon", "realistic", "voxel".
- Noem proporties en onderdelen: "wide base, tall thin chimney on the left".
- Houd een hele map in één stijl: herhaal dezelfde stijlwoorden in elke prompt.
