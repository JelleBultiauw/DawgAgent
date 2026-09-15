---
name: monetization
description: Geld verdienen met Game Passes, Developer Products (ProcessReceipt), Premium en PolicyService, eerlijk en veilig geïmplementeerd
---
# Monetization

## Voorbereiding (door de gebruiker)
Game Passes en Developer Products maak je op create.roblox.com → jouw experience → Monetization. BloxCode kan ze niet aanmaken; vraag de gebruiker om de ID's en zet die in een ModuleScript `ReplicatedStorage.Config.Products`.

## Game Pass (eenmalige aankoop)
```lua
-- Server
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local VIP_PASS = 123456789

local function hasPass(player: Player, passId: number): boolean
	local ok, owns = pcall(MarketplaceService.UserOwnsGamePassAsync, MarketplaceService, player.UserId, passId)
	return ok and owns
end

local function grantVip(player: Player)
	player:SetAttribute("VIP", true)
end

Players.PlayerAdded:Connect(function(player)
	if hasPass(player, VIP_PASS) then grantVip(player) end
end)

MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
	if purchased and passId == VIP_PASS then grantVip(player) end
end)
```
- Prompt tonen (client of server): `MarketplaceService:PromptGamePassPurchase(player, VIP_PASS)`.

## Developer Product (herhaalbaar: munten, boosts)
```lua
-- Server: er mag maar ÉÉN ProcessReceipt in de hele game zijn
local handlers: { [number]: (Player) -> boolean } = {
	[987654321] = function(player) -- 500 munten
		local coins = player:FindFirstChild("leaderstats") and player.leaderstats:FindFirstChild("Coins")
		if not coins then return false end
		coins.Value += 500
		return true
	end,
}

MarketplaceService.ProcessReceipt = function(receipt)
	local player = Players:GetPlayerByUserId(receipt.PlayerId)
	local handler = handlers[receipt.ProductId]
	if not player or not handler then
		return Enum.ProductPurchaseDecision.NotProcessedYet -- Roblox probeert het later opnieuw
	end
	local ok, granted = pcall(handler, player)
	if ok and granted then
		-- Sla receipt.PurchaseId op in de spelerdata om dubbel toekennen te voorkomen, en sla de data direct op
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end
	return Enum.ProductPurchaseDecision.NotProcessedYet
end
```
- Prompt: `MarketplaceService:PromptProductPurchase(player, productId)`.
- Idempotent maken: bewaar verwerkte `PurchaseId`s en geef niets opnieuw als het ID er al in staat.

## Prijzen en info tonen
```lua
local ok, info = pcall(MarketplaceService.GetProductInfo, MarketplaceService, VIP_PASS, Enum.InfoType.GamePass)
if ok then print(info.Name, info.PriceInRobux) end
```

## Premium
- `player.MembershipType == Enum.MembershipType.Premium` voor kleine Premium-voordelen; luister naar `Players.PlayerMembershipChanged`.
- Premium Payouts belonen speeltijd van Premium-spelers: een goede game-loop verdient hier vanzelf.

## Regels en beleid
- Loot boxes of willekeurige betaalde items: controleer `PolicyService:GetPolicyInfoForPlayerAsync(player).ArePaidRandomItemsRestricted` (in pcall) en schakel ze uit waar dat nodig is.
- Laat de server altijd beslissen wat iemand krijgt; de client toont alleen de prompt.

## Ontwerp-tips
- Verkoop gemak, cosmetica en tijdwinst, geen onoverkomelijke pay-to-win.
- Toon het aanbod op logische momenten (na een mislukte poging, in de shop), niet als popup bij het joinen.
- Shop-UI: duidelijke prijs in Robux, voorbeeld van het voordeel, bevestiging na aankoop met particles en geluid.
