---
name: terrain
description: Terrain genereren en bewerken met code (heuvels, water, grotten, paden, biomen, materiaalkleuren)
---
# Terrain met code

Alle Terrain-functies werken op `workspace.Terrain` (Edit, via execute_luau). Voxel-resolutie is 4 studs.

## Basisvormen
```lua
local T = workspace.Terrain
T:FillBlock(CFrame.new(0, -8, 0), Vector3.new(512, 16, 512), Enum.Material.Grass)  -- vlakke ondergrond
T:FillBall(Vector3.new(40, 0, 40), 24, Enum.Material.Rock)                          -- heuvel of rots
T:FillCylinder(CFrame.new(0, 10, 0), 20, 12, Enum.Material.Sand)                    -- cfrm, hoogte, straal
T:FillWedge(CFrame.new(0, 4, 60), Vector3.new(40, 8, 40), Enum.Material.Ground)     -- helling
T:FillBall(Vector3.new(40, 0, 40), 10, Enum.Material.Air)                           -- grot uithollen
```
- Water: vul met `Enum.Material.Water`. Uiterlijk via `T.WaterColor`, `T.WaterTransparency`, `T.WaterWaveSize`, `T.WaterWaveSpeed`, `T.WaterReflectance`.
- Materiaal vervangen in een gebied: `T:ReplaceMaterial(Region3.new(min, max):ExpandToGrid(4), 4, Enum.Material.Grass, Enum.Material.Snow)`.
- Kleur per materiaal: `T:SetMaterialColor(Enum.Material.Grass, Color3.fromRGB(90, 140, 60))`.
- Gras-decoratie: `T.Decoration = true`.
- `T:Clear()` wist ALLES. Alleen op uitdrukkelijk verzoek.

## Heuvellandschap (heightmap met noise)
```lua
local T = workspace.Terrain
local SIZE, STEP, SEED = 512, 8, math.random(1, 10000)
for x = -SIZE / 2, SIZE / 2, STEP do
	for z = -SIZE / 2, SIZE / 2, STEP do
		local n = math.noise(x / 180, z / 180, SEED) * 0.7 + math.noise(x / 60, z / 60, SEED + 1) * 0.3
		local height = math.max(4, 20 + n * 40)
		local material = height > 45 and Enum.Material.Rock or (height < 12 and Enum.Material.Sand or Enum.Material.Grass)
		T:FillBlock(CFrame.new(x, height / 2 - 10, z), Vector3.new(STEP, height, STEP), material)
	end
	if x % 64 == 0 then task.wait() end
end
T:FillBlock(CFrame.new(0, 0, 0), Vector3.new(SIZE, 8, SIZE), Enum.Material.Water) -- zeespiegel
return "Landschap klaar (seed " .. SEED .. ")"
```
- Werk bij grote gebieden in stukken (meerdere aanroepen), anders kan execute_luau een timeout geven.
- Lagen: zand bij water, gras in het midden, rock/snow bovenop voor een natuurlijke look.

## Paden en rivieren
- Pad: dunne FillBlock-segmenten (hoogte 1–2) met `Enum.Material.Ground`, `Mud` of `Pavement`, langs een lijst waypoints.
- Rivier: eerst een geul uithollen met FillBlock van `Air`, daarna de onderste laag vullen met `Water`.

## Voxels direct (geavanceerd)
- `T:ReadVoxels(region, 4)` en `T:WriteVoxels(region, 4, materials, occupancies)` voor precieze controle; de region moet `:ExpandToGrid(4)` zijn.

## Materialen
Grass, LeafyGrass, Ground, Mud, Sand, Sandstone, Rock, Slate, Basalt, Limestone, Granite, Snow, Glacier, Ice, Salt, Asphalt, Pavement, Cobblestone, Brick, Concrete, CrackedLava, Water, Air.

## Biome-ideeën
- Woestijn: Sand + Sandstone, `SetMaterialColor` warm oranje, weinig bomen, felle belichting.
- Winter: Snow + Glacier + Ice, Atmosphere met lichte haze.
- Vulkaan: Basalt + CrackedLava, rode ColorCorrection, ParticleEmitters voor rook.
