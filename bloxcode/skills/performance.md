---
name: performance
description: Performance optimaliseren: StreamingEnabled, part- en meshbudgetten, collision/shadow-instellingen, efficiënte scripts, object pooling en profiling
---
# Performance

## Eerst meten
- In Studio: Developer Console (F9), MicroProfiler (Ctrl+Alt+F6 / Cmd+Opt+F6), Script Performance-venster.
- De Roblox-server heeft skills `rbx-perf-profiling` (MicroProfiler-data) en `rbx-scene-analysis` (rendering, geheugen, instance-telling). Laad die voor diepgaande analyse.
- Snel tellen via execute_luau:
```lua
local counts = {}
for _, d in workspace:GetDescendants() do counts[d.ClassName] = (counts[d.ClassName] or 0) + 1 end
local list = {}
for class, n in counts do table.insert(list, { class, n }) end
table.sort(list, function(a, b) return a[2] > b[2] end)
local out = {}
for i = 1, math.min(15, #list) do table.insert(out, list[i][1] .. ": " .. list[i][2]) end
return table.concat(out, "\n")
```

## Wereld en rendering
- Grote maps: `workspace.StreamingEnabled = true`, redelijke `StreamingTargetRadius`; belangrijke modellen `ModelStreamingMode = Atomic` of `Persistent`. Clients moeten dan `WaitForChild` gebruiken voor objecten ver weg.
- Decoratie: `CanCollide = false`, `CanTouch = false`, `CanQuery = false`; kleine details `CastShadow = false`.
- MeshParts: `RenderFidelity = Automatic`; decoratie `CollisionFidelity = Box` of `Hull` (niet `PreciseConvexDecomposition`).
- Beperk triangles (props < 2k), unieke meshes en textures (max 1024 px). Hergebruik dezelfde mesh-id's.
- Veel losse geankerde parts in één statisch bouwwerk is prima; vermijd duizenden unanchored parts.
- Lichten met `Shadows = true` zijn duur; gebruik ze spaarzaam. Future lighting met veel lichtbronnen is zwaar op mobiel.

## Scripts
- Geen `while true do task.wait() end` per object. Gebruik één centrale loop of `CollectionService`-tags met één script.
- Frame-updates: `RunService.Heartbeat` (server en client) of `RenderStepped` (alleen client, alleen voor camera en input). Doe er zo min mogelijk in.
- Vervang veel Touched-events door periodieke ruimtelijke queries: `workspace:GetPartBoundsInBox(cf, size, params)`, 5–10× per seconde.
- Cache `game:GetService` en `FindFirstChild`-resultaten buiten loops.
- Tijdelijke objecten opruimen: `task.delay(3, function() part:Destroy() end)` of `Debris:AddItem(part, 3)`.
- Object pooling voor projectielen en effecten die vaak verschijnen.
- Verbreek connections (`:Disconnect()`) en maak tabellen leeg bij PlayerRemoving; anders lekt geheugen.

## Netwerk
- Visuele effecten op de client laten gebeuren; de server stuurt alleen gebeurtenissen.
- `UnreliableRemoteEvent` voor frequente, niet-kritieke updates; bundel data en stuur niet elke frame.
- Niet onnodig properties op de server blijven wijzigen (elke wijziging repliceert).

## NPC's en humanoids
- Humanoids zijn duur. Voor grote groepen NPC's: `AnimationController` in plaats van Humanoid, geankerde beweging via CFrame op de client, of minder NPC's tegelijk actief (activeren binnen een radius).

## Mobiel
- Test in de Device Emulator; houd UI-elementen en particles beperkt (Rate omlaag), en overweeg een "Low graphics"-schakelaar die effecten uitzet.
