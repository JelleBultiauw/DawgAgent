---
name: luau-architecture
description: Luau-scripting en game-architectuur: client/server, RemoteEvents, ModuleScripts, typed Luau, attributes, tags en veelgemaakte fouten
---
# Luau en game-architectuur

## Waar hoort wat?
| Locatie | Inhoud | Zichtbaar voor client? |
|---|---|---|
| ServerScriptService | Server Scripts (gamelogica) | nee |
| ServerStorage | Server-modules, prefabs, geheime config | nee |
| ReplicatedStorage | Gedeelde ModuleScripts, `Remotes`-map, gedeelde assets | ja |
| StarterPlayer/StarterPlayerScripts | LocalScripts (input, camera, UI-logica) | ja |
| StarterPlayer/StarterCharacterScripts | LocalScripts per character | ja |
| StarterGui | ScreenGuis + UI-LocalScripts | ja |
| Workspace | Alleen de wereld | ja |

## Communicatie client ↔ server
```lua
-- ReplicatedStorage/Remotes/RequestPurchase (RemoteEvent)
-- Client:
Remotes.RequestPurchase:FireServer("SpeedCoil")
-- Server:
Remotes.RequestPurchase.OnServerEvent:Connect(function(player: Player, itemId: unknown)
	if typeof(itemId) ~= "string" then return end -- ALTIJD valideren
	-- prijs en saldo op de server controleren
end)
```
- `RemoteFunction:InvokeServer()` voor een antwoord terug. Nooit `InvokeClient` op de server gebruiken: die kan eeuwig blijven hangen.
- `UnreliableRemoteEvent` voor frequente cosmetische updates (effecten, posities).
- Server → client: `:FireClient(player, ...)` / `:FireAllClients(...)`.

## ModuleScript-patroon
```lua
--!strict
local Inventory = {}

export type Item = { id: string, amount: number }

local inventories: { [Player]: { Item } } = {}

function Inventory.add(player: Player, id: string, amount: number)
	local list = inventories[player] or {}
	table.insert(list, { id = id, amount = amount })
	inventories[player] = list
end

return Inventory
```

## Spelers en characters
```lua
local Players = game:GetService("Players")
local function onPlayer(player: Player)
	player.CharacterAdded:Connect(function(character)
		local humanoid = character:WaitForChild("Humanoid") :: Humanoid
		humanoid.Died:Connect(function() end)
	end)
end
Players.PlayerAdded:Connect(onPlayer)
for _, p in Players:GetPlayers() do onPlayer(p) end -- spelers die al in de game zijn
```

## Moderne API's
- `task.wait`, `task.spawn`, `task.delay`, `task.defer` (niet `wait`, `spawn` of `delay`).
- Attributes: `inst:SetAttribute("Health", 100)`, `inst:GetAttributeChangedSignal("Health")`.
- Tags: `CollectionService:AddTag(part, "KillBrick")`, `GetTagged`, `GetInstanceAddedSignal`. Eén script bedient alle getagde objecten; geen kopie van een script in elk object.
- `game:GetService("X")` bovenaan het script, als lokale variabele.

## Opruimen
- Bewaar connections en roep `:Disconnect()` aan als iets verdwijnt (of gebruik het `Destroying`-event).
- Tabellen met spelers-keys leegmaken in `PlayerRemoving`.

## Veelgemaakte fouten
- De client probeert ServerStorage of ServerScriptService te lezen (bestaat daar niet).
- `FindFirstChild` zonder nil-check; aan de client-kant `WaitForChild` gebruiken.
- Een yield in PlayerAdded vóórdat CharacterAdded verbonden is, waardoor het eerste character gemist wordt.
- Gamelogica in LocalScripts: dat is door exploiters aan te passen.
- `while true do` zonder `task.wait()` bevriest de game.

## Testen
- start_stop_play(true) → get_console_output → fouten oplossen → start_stop_play(false).
- Server-staat tijdens een playtest: execute_luau met datamodel_type "Server"; client-staat: "Client".
