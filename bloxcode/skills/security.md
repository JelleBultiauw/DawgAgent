---
name: security
description: Anti-exploit en veiligheid: remotes valideren, rate limiting, server-authority, backdoors in free models opsporen en tekstfiltering
---
# Veiligheid en anti-exploit

## Uitgangspunt: de client is van de exploiter
Een exploiter kan elke RemoteEvent afvuren met willekeurige argumenten, alle client-scripts lezen, zijn eigen character teleporteren of versnellen, en lokale UI of waarden aanpassen. Alles wat telt (valuta, schade, inventory, voortgang) beslist de server.

## Remotes goed ontwerpen
- Slecht: `GiveCoins:FireServer(1000)` of `DealDamage:FireServer(target, 9999)`.
- Goed: `RequestPurchase:FireServer("SpeedCoil")` of `Attack:FireServer(aimDirection)`. De server bepaalt prijs, schade en bereik.

## Validatie-checklist per remote
```lua
local lastUse: { [Player]: number } = {}
Remote.OnServerEvent:Connect(function(player, itemId, direction)
	-- 1. Types
	if typeof(itemId) ~= "string" or typeof(direction) ~= "Vector3" then return end
	-- 2. Waarden en bereik
	if direction.Magnitude == 0 or direction.Magnitude ~= direction.Magnitude then return end -- NaN-check
	-- 3. Rate limit / cooldown
	local now = os.clock()
	if now - (lastUse[player] or 0) < 0.3 then return end
	lastUse[player] = now
	-- 4. Staat en eigendom
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if not root then return end
	-- 5. Afstand (bijv. tot een shop of doelwit)
	-- if (root.Position - shop.Position).Magnitude > 15 then return end
	-- 6. Server-side prijs, saldo en gevolgen
end)
game:GetService("Players").PlayerRemoving:Connect(function(p) lastUse[p] = nil end)
```
- Tabellen van de client: controleer elke sleutel en waarde en de grootte; accepteer geen Instances die de client niet mag bezitten.

## Beweging en physics
- Controleer periodiek op de server: onmogelijke snelheid (verplaatsing per seconde > WalkSpeed × marge) of teleports. Corrigeer eerst terug naar de laatste geldige positie; kick niet direct (voorkom false positives door lag).

## Waar staat wat
- Geheime logica en config in ServerScriptService/ServerStorage, nooit in ReplicatedStorage of client-scripts.
- Game Settings → Security: "Allow HTTP Requests" en third-party sales/teleports alleen aan als het nodig is. `ServerScriptService.LoadStringEnabled = false`.

## Backdoors in free models opsporen
Zoek met script_grep naar:
- `require%(%s*%d` (require met asset-id), `getfenv`, `setfenv`, `loadstring`
- `InsertService`, `LoadAsset`, `HttpService`, `MarketplaceService` in onverwachte scripts
- Rare namen ("Vaccine", "Anti-Lag", "Fix", "Spread"), heel lange strings, `string.reverse`, `\x`-escapes of andere obfuscatie
- Scripts diep in decoratiemodellen (bomen en auto's horen geen Script te bevatten)

Meld de vondsten aan de gebruiker en stel voor ze te verwijderen. Verwijder niets in bulk zonder toestemming.

## Tekst van spelers
Alle tekst die spelers invoeren en die anderen zien (namen van huisdieren, borden, chat) MOET gefilterd worden:
```lua
local TextService = game:GetService("TextService")
local ok, result = pcall(function()
	return TextService:FilterStringAsync(text, player.UserId):GetNonChatStringForBroadcastAsync()
end)
local safeText = ok and result or ""
```

## Eigen tools van BloxCode
BloxCode vraagt altijd toestemming voor code met DataStore-writes, HTTP-verzoeken, loadstring/getfenv, require(asset-id), bulk-verwijderen of publiceren, en voor het invoegen van Models uit de Creator Store.
