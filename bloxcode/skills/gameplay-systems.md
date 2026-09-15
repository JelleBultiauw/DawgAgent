---
name: gameplay-systems
description: Veelgebruikte gameplay-systemen: leaderstats, obby-checkpoints, kill bricks, ProximityPrompts, rondesysteem, wapens/tools, NPC-pathfinding, teams en collision groups
---
# Gameplay-systemen

## Leaderstats
```lua
Players.PlayerAdded:Connect(function(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats" -- exact deze naam
	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Parent = stats
	stats.Parent = player
end)
```

## Obby: checkpoints en kill bricks (één server-script, met tags)
```lua
local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local stageOf: { [Player]: number } = {}

local function playerFromHit(hit: BasePart): Player?
	return Players:GetPlayerFromCharacter(hit.Parent)
end

for _, cp in CollectionService:GetTagged("Checkpoint") do -- attribute "Stage" (number)
	cp.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		local stage = cp:GetAttribute("Stage")
		if player and stage and stage > (stageOf[player] or 0) then
			stageOf[player] = stage
		end
	end)
end

for _, brick in CollectionService:GetTagged("KillBrick") do
	brick.Touched:Connect(function(hit)
		local humanoid = hit.Parent:FindFirstChildOfClass("Humanoid")
		if humanoid then humanoid.Health = 0 end
	end)
end

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(function(character)
		local stage = stageOf[player]
		if not stage then return end
		for _, cp in CollectionService:GetTagged("Checkpoint") do
			if cp:GetAttribute("Stage") == stage then
				task.defer(function() character:PivotTo(cp.CFrame + Vector3.new(0, 4, 0)) end)
			end
		end
	end)
end)
Players.PlayerRemoving:Connect(function(p) stageOf[p] = nil end)
```

## Interactie: ProximityPrompt
- ProximityPrompt in een part: ActionText, ObjectText, HoldDuration, MaxActivationDistance (8–12).
- Server: `prompt.Triggered:Connect(function(player) ... end)`.

## Rondesysteem (state machine, server)
```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local function setStatus(text) ReplicatedStorage:SetAttribute("Status", text) end
while true do
	for i = 15, 1, -1 do setStatus("Intermissie: " .. i) task.wait(1) end
	-- spelers teleporteren: character:PivotTo(spawn.CFrame + Vector3.new(0, 4, 0))
	for i = 90, 1, -1 do setStatus("Ronde: " .. i) task.wait(1) --[[ stop als er een winnaar is ]] end
	setStatus("Ronde voorbij!") task.wait(5)
end
```
De client leest `ReplicatedStorage:GetAttributeChangedSignal("Status")` voor de UI.

## Wapens en tools (server-authoritative)
- Tool in StarterPack met een part `Handle`. De client stuurt bij `tool.Activated` de richting via een RemoteEvent.
- De server valideert: cooldown per speler (`os.clock()`), afstand, en een raycast vanaf de server:
```lua
local params = RaycastParams.new()
params.FilterType = Enum.RaycastFilterType.Exclude
params.FilterDescendantsInstances = { character }
local result = workspace:Raycast(head.Position, direction.Unit * 300, params)
if result then
	local hum = result.Instance.Parent:FindFirstChildOfClass("Humanoid")
	if hum then hum:TakeDamage(25) end
end
```

## NPC's met pathfinding
```lua
local PathfindingService = game:GetService("PathfindingService")
local path = PathfindingService:CreatePath({ AgentRadius = 2, AgentHeight = 5, AgentCanJump = true })
path:ComputeAsync(npc.PrimaryPart.Position, goal)
if path.Status == Enum.PathStatus.Success then
	for _, wp in path:GetWaypoints() do
		if wp.Action == Enum.PathWaypointAction.Jump then humanoid.Jump = true end
		humanoid:MoveTo(wp.Position)
		humanoid.MoveToFinished:Wait()
	end
end
```
- Server-gestuurde NPC's: `npc.PrimaryPart:SetNetworkOwner(nil)`. Bereken het pad opnieuw bij `path.Blocked`.

## Teams en spawns
- Teams-service met Team-objecten (TeamColor); SpawnLocation met dezelfde TeamColor en `Neutral = false`.

## Collision groups
```lua
local PhysicsService = game:GetService("PhysicsService")
PhysicsService:RegisterCollisionGroup("Players")
PhysicsService:CollisionGroupSetCollidable("Players", "Players", false)
-- per character-part: part.CollisionGroup = "Players"
```

## Pickups (munten)
- Touched plus een debounce-tabel; munt verbergen (Transparency, CanTouch = false), waarde toekennen op de server, na `task.delay(10, ...)` weer tonen.
