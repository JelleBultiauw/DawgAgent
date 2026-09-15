---
name: datastores
description: Spelerdata veilig opslaan met DataStoreService: laden/opslaan met retries, UpdateAsync, session locking, BindToClose, autosave en leaderboards
---
# DataStores (spelerdata)

## Belangrijk vooraf
- In Studio werkt dit alleen met Game Settings → Security → "Enable Studio Access to API Services". Dan schrijf je naar ECHTE data van je game. Gebruik in Studio een testnaam:
  `local STORE_NAME = RunService:IsStudio() and "PlayerData_Test" or "PlayerData_v1"`.
- Waarden moeten JSON-serialiseerbaar zijn: geen Instances, Vector3 of Color3 (sla die op als tabellen). Maximaal 4 MB per key.
- Bij DataStore-writes vraagt BloxCode altijd toestemming.

## Robuust patroon (Script in ServerScriptService)
```lua
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local store = DataStoreService:GetDataStore(RunService:IsStudio() and "PlayerData_Test" or "PlayerData_v1")
local DEFAULT = { version = 1, coins = 0, level = 1, inventory = {} }
local sessions: { [Player]: { data: any, loaded: boolean } } = {}

local function withRetry<T>(fn: () -> T): (boolean, T?)
	for attempt = 1, 5 do
		local ok, result = pcall(fn)
		if ok then return true, result end
		warn("DataStore poging", attempt, result)
		task.wait(2 ^ attempt)
	end
	return false, nil
end

local function load(player: Player)
	local ok, data = withRetry(function() return store:GetAsync("u_" .. player.UserId) end)
	if not ok then
		player:Kick("Je data kon niet geladen worden. Probeer het opnieuw.") -- nooit met lege data doorgaan
		return
	end
	local merged = table.clone(DEFAULT)
	for k, v in data or {} do merged[k] = v end
	sessions[player] = { data = merged, loaded = true }
end

local function save(player: Player)
	local session = sessions[player]
	if not session or not session.loaded then return end -- nooit defaults over echte data heen schrijven
	withRetry(function()
		return store:UpdateAsync("u_" .. player.UserId, function(_old)
			return session.data
		end)
	end)
end

Players.PlayerAdded:Connect(load)
Players.PlayerRemoving:Connect(function(player)
	save(player)
	sessions[player] = nil
end)

game:BindToClose(function()
	if RunService:IsStudio() then task.wait(1) end
	local pending = 0
	for _, player in Players:GetPlayers() do
		pending += 1
		task.spawn(function() save(player) pending -= 1 end)
	end
	while pending > 0 do task.wait() end
end)

task.spawn(function() -- autosave
	while true do
		task.wait(120)
		for _, player in Players:GetPlayers() do task.spawn(save, player) end
	end
end)
```

## Session locking (tegen dupliceren bij snel van server wisselen)
- Sla in de data `lock = { jobId = game.JobId, time = os.time() }` op via UpdateAsync bij het laden. Weiger (return nil) als een andere jobId de lock minder dan 30 minuten geleden zette; verwijder de lock bij de laatste save.
- Beproefd alternatief: de community-library ProfileStore (loleris), die dit allemaal regelt.

## Leaderboard (OrderedDataStore)
```lua
local wins = DataStoreService:GetOrderedDataStore("Wins_v1")
pcall(function() wins:SetAsync(tostring(player.UserId), totalWins) end)
local ok, pages = pcall(function() return wins:GetSortedAsync(false, 10) end)
if ok then
	for rank, entry in pages:GetCurrentPage() do
		local nameOk, name = pcall(Players.GetNameFromUserIdAsync, Players, tonumber(entry.key))
		print(rank, nameOk and name or entry.key, entry.value)
	end
end
```
Ververs het leaderboard hooguit elke 60 seconden.

## Tips
- Houd data in een sessietabel en schrijf alleen bij verlaten, autosave en afsluiten, niet bij elke munt.
- Budget checken: `DataStoreService:GetRequestBudgetForRequestType(Enum.DataStoreRequestType.SetIncrementAsync)`.
- Veld `version` in de data voor migraties. Bekijken en bewerken kan in Studio via View → Data Stores Manager.
