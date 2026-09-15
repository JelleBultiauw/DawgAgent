---
name: lighting-atmosphere
description: Belichting, sfeer, lucht, post-processing en presets (dag, zonsondergang, nacht, horror, cartoon) plus dag/nacht-cyclus
---
# Belichting en sfeer

## Lighting-service (Edit via execute_luau)
```lua
local Lighting = game:GetService("Lighting")
Lighting.Technology = Enum.Technology.Future      -- mooiste schaduwen (zwaarder); ShadowMap is een goede middenweg
Lighting.ClockTime = 14                            -- 0–24
Lighting.Brightness = 2
Lighting.Ambient = Color3.fromRGB(70, 70, 80)
Lighting.OutdoorAmbient = Color3.fromRGB(120, 120, 130)
Lighting.EnvironmentDiffuseScale = 1
Lighting.EnvironmentSpecularScale = 1
Lighting.ShadowSoftness = 0.2
Lighting.GeographicLatitude = 41
Lighting.ExposureCompensation = 0
```

## Atmosphere, Sky en effecten (instances in Lighting)
- `Atmosphere`: Density (0–1, mist), Offset, Color, Decay, Glare, Haze.
- `Sky`: SkyboxBk/Dn/Ft/Lf/Rt/Up (asset-ids), SunAngularSize, MoonAngularSize, StarCount, CelestialBodiesShown.
- `BloomEffect`: Intensity, Size, Threshold (lage Threshold = meer gloed op Neon).
- `ColorCorrectionEffect`: Brightness, Contrast, Saturation, TintColor.
- `SunRaysEffect`: Intensity, Spread.
- `DepthOfFieldEffect`: FarIntensity, FocusDistance, InFocusRadius, NearIntensity.
- `BlurEffect`: Size (bijv. voor menu's).

Hulpfunctie: haal eerst een bestaand effect op met `Lighting:FindFirstChildOfClass("Atmosphere")`, en maak alleen een nieuw als het ontbreekt.

## Presets
| Sfeer | ClockTime | Atmosphere | ColorCorrection | Overig |
|---|---|---|---|---|
| Zonnige dag | 13 | Density 0.3, Haze 0 | Saturation 0.05 | Bloom zacht |
| Zonsondergang | 17.8 | Density 0.35, Color warm oranje, Glare 0.4 | TintColor (255, 230, 210) | SunRays Intensity 0.1 |
| Nacht | 0 | Density 0.4, Color donkerblauw | Brightness -0.05 | OutdoorAmbient laag, PointLights bij lampen |
| Horror | 1 | Density 0.7, Color (30, 30, 35), Haze 3 | Saturation -0.5, Contrast 0.2 | Ambient bijna zwart, flikkerende lampen |
| Cartoon/simulator | 12 | Density 0.25 | Saturation 0.25, Contrast 0.1 | Technology ShadowMap, heldere kleuren |
| Onderwater | 12 | Density 0.6, Color (40, 120, 160) | TintColor (170, 220, 255) | Blur Size 4 |

## Lokale lichtbronnen
- `PointLight` (Brightness, Range ≤ 60, Color, Shadows), `SpotLight` (+Angle, Face), `SurfaceLight`.
- Lamp: Neon-part plus een PointLight met Range 16–24. Beperk lichten met Shadows = true: die zijn zwaar.

## Dag/nacht-cyclus (Script in ServerScriptService)
```lua
local Lighting = game:GetService("Lighting")
local RunService = game:GetService("RunService")
local MINUTES_PER_DAY = 12
RunService.Heartbeat:Connect(function(dt)
	Lighting.ClockTime = (Lighting.ClockTime + dt * 24 / (MINUTES_PER_DAY * 60)) % 24
end)
```

## Tips
- Stem kleuren van gebouwen af op de belichting: warme belichting plus koele schaduwen oogt professioneel.
- Controleer altijd met screen_capture, vanuit een spelersperspectief (camera op ~5 studs hoogte).
