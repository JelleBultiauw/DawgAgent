---
name: building-3d
description: 3D bouwen met Parts, CFrame, Models, welds, CSG en procedurele bouwcode (huizen, levels, props, obby's)
---
# 3D bouwen in Roblox

## Schaal (studs)
- 1 stud ≈ 28 cm. Speler ≈ 5 studs hoog. Deur 4×7, plafondhoogte 10–12, traptrede 1 hoog × 1–2 diep, muurdikte 1.
- Werk op een grid van 0.5 of 1 stud: nette uitlijning en geen z-fighting.

## Parts maken (Edit, via execute_luau)
```lua
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local recording = ChangeHistoryService:TryBeginRecording("BloxCode: huis bouwen")

local function part(props)
	local p = Instance.new(props.ClassName or "Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for key, value in props do
		if key ~= "ClassName" and key ~= "Parent" then
			p[key] = value
		end
	end
	p.Parent = props.Parent -- parent als laatste: sneller
	return p
end

local model = Instance.new("Model")
model.Name = "House"
local floor = part({ Name = "Floor", Size = Vector3.new(20, 1, 16), CFrame = CFrame.new(0, 0.5, 0),
	Material = Enum.Material.WoodPlanks, Color = Color3.fromRGB(150, 110, 70), Parent = model })
model.PrimaryPart = floor
model.Parent = workspace

if recording then
	ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
end
return "House gebouwd met " .. #model:GetChildren() .. " parts"
```
- Grote bouwacties in TryBeginRecording/FinishRecording zetten, zodat de gebruiker ze met Ctrl+Z ongedaan kan maken.

## CFrame-basis
- Positie + rotatie: `CFrame.new(x, y, z) * CFrame.Angles(math.rad(rx), math.rad(ry), math.rad(rz))`
- Richten: `CFrame.lookAt(position, target)`
- Relatief plaatsen: `base.CFrame * CFrame.new(0, base.Size.Y/2 + h/2, 0)` (bovenop base)
- Cirkel: `CFrame.Angles(0, math.rad(i * 360 / n), 0) * CFrame.new(0, 0, -radius)`
- Een Model verplaatsen: `model:PivotTo(cf)`. Grootte opvragen: `model:GetBoundingBox()`. Schalen: `model:ScaleTo(1.5)`.
- Op de grond zetten: raycast omlaag met `workspace:Raycast(origin, Vector3.new(0, -500, 0), params)`.

## Vormen en details
- `Part.Shape = Enum.PartType.Block | Ball | Cylinder | Wedge | CornerWedge` (Cylinder ligt langs de X-as).
- `WedgePart` voor daken en hellingen; twee wedges vormen een zadeldak.
- Neon + een PointLight voor lampen. Glas: `Material = Glass`, `Transparency = 0.5`.
- Afgeronde look: kleine afschuiningen met wedges; organische vormen liever met generate_mesh.

## CSG (gaten, bogen, ramen)
```lua
local wall = part({ Size = Vector3.new(12, 10, 1), CFrame = CFrame.new(0, 5, 0), Parent = workspace })
local hole = part({ Size = Vector3.new(4, 7, 2), CFrame = CFrame.new(0, 3.5, 0), Parent = workspace })
local union = wall:SubtractAsync({ hole })
union.Parent = model
wall:Destroy(); hole:Destroy()
```
- Ook `UnionAsync` en `IntersectAsync`. Beperk CSG: veel unions zijn zwaar. Bouw ramen liever uit losse muurdelen.

## Welds (voor losse, bewegende objecten)
- Statisch bouwwerk: alles `Anchored = true`.
- Bewegend object: één hoofdpart, de rest vastmaken met `WeldConstraint` (Part0 = hoofdpart, Part1 = onderdeel), onderdelen unanchored.

## Structuur
- `Workspace/Map/Buildings/House_01`, `Workspace/Map/Props`, `Workspace/Map/Nature`. Duidelijke namen, geen "Part" × 500.
- Herhaalde objecten: bouw er één als Model in `ServerStorage/Prefabs` en kloon met `:Clone()` + `PivotTo`.
- Decoratie: `CanCollide = false`, `CanTouch = false`, `CanQuery = false`, kleine parts `CastShadow = false`.

## Procedurele patronen
- Deterministische variatie: `local rng = Random.new(42)`, dan `rng:NextNumber(min, max)` / `rng:NextInteger(a, b)`.
- Muren met deuropening: bouw segmenten links en rechts van de opening plus een latei erboven.
- Trap: loop `for i = 0, n - 1` met offset `CFrame.new(0, i * 1, -i * 1.5)`.
- Hek: palen om de 4 studs plus twee liggers ertussen.
- Stijlconsistentie: kies een palet van 3–5 kleuren en 2–3 materialen per bouwwerk.

## Controle
- Na het bouwen: screen_capture met camera_position schuin boven het object en look_at_position op het midden.
