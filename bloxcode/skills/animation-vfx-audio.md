---
name: animation-vfx-audio
description: Animaties afspelen (Animator, AnimationTrack), bewegende objecten met TweenService, particles, beams, trails, highlights en geluid
---
# Animatie, effecten en geluid

## Character-animaties
```lua
local animator = humanoid:FindFirstChildOfClass("Animator") or Instance.new("Animator", humanoid)
local anim = Instance.new("Animation")
anim.AnimationId = "rbxassetid://1234567890"
local track = animator:LoadAnimation(anim) -- laad één keer en hergebruik de track
track.Priority = Enum.AnimationPriority.Action
track:Play(0.1)                             -- fadeTime, (weight), (speed)
track:GetMarkerReachedSignal("Hit"):Connect(function() end)
track.Stopped:Once(function() end)
```
- Speel animaties van de eigen speler af in een LocalScript; via Animator repliceren ze automatisch.
- Niet-humanoid modellen: `AnimationController` met een `Animator` erin.
- Standaardanimaties vervangen: pas in `character.Animate` de AnimationId's aan (bijv. `Animate.walk.WalkAnim.AnimationId`), of zet een eigen `Animate`-script in StarterCharacterScripts.
- Een animatie laadt alleen als hij eigendom is van dezelfde user of groep als de game. Laadt hij niet, dan is dat meestal de oorzaak.
- Prioriteit: Core < Idle < Movement < Action (Action2–4 bestaan ook).

## Bewegende objecten (TweenService)
```lua
local TweenService = game:GetService("TweenService")
local door = workspace.Map.Door -- Anchored part
local info = TweenInfo.new(0.6, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut)
TweenService:Create(door, info, { CFrame = door.CFrame * CFrame.new(0, 0, -4) }):Play()
```
- Een Model tweenen: tween een `CFrameValue` en roep in `.Changed` `model:PivotTo(value.Value)` aan.
- Getweende, geankerde platforms nemen spelers niet mee. Gebruik daarvoor constraints (zie physics-vehicles).
- Doe cosmetische tweens op de client voor soepelheid; de server bepaalt alleen de staat.
- Draaien: `TweenInfo.new(4, Enum.EasingStyle.Linear, Enum.EasingDirection.In, -1)` met een CFrame-rotatie, of RunService-rotatie op de client.

## Particles
```lua
local emitter = Instance.new("ParticleEmitter")
emitter.Rate = 20
emitter.Lifetime = NumberRange.new(0.5, 1.2)
emitter.Speed = NumberRange.new(4, 8)
emitter.SpreadAngle = Vector2.new(25, 25)
emitter.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(1, 0) })
emitter.Transparency = NumberSequence.new(0, 1)
emitter.Color = ColorSequence.new(Color3.fromRGB(255, 200, 80), Color3.fromRGB(255, 80, 20))
emitter.LightEmission = 0.8
emitter.Acceleration = Vector3.new(0, 6, 0)
emitter.Parent = attachment -- Attachment in een part
emitter:Emit(30) -- eenmalige burst (explosie, coin pickup)
```
- Recepten: vuur (oranje → rood, omhoog, LightEmission 1), rook (grijs, groot worden, langzaam), sparkles (klein, snel, kort), stof bij landen (burst, Drag 5).

## Beams, trails en highlights
- `Beam`: Attachment0/1, Width0/1, Texture, TextureSpeed, FaceCamera (lasers, portalen, zipline).
- `Trail`: Attachment0/1 op een bewegend object, Lifetime 0.3, WidthScale (zwaardslagen, snelheid).
- `Highlight`: outline om objecten (FillTransparency 1, OutlineColor). Maximaal ~31 tegelijk zichtbaar.

## Geluid
- 3D-geluid: `Sound` in een part (RollOffMode InverseTapered, RollOffMaxDistance 60–150). 2D-geluid (UI, muziek): in SoundService of PlayerGui.
- `SoundGroup`s voor muziek/SFX-volume; zet `sound.SoundGroup`.
- Client-only effect: `SoundService:PlayLocalSound(sound)`.
- Zoek audio met search_asset (assetType "Audio"). Audio moet openbaar zijn of eigendom van de game-eigenaar.

## Game feel ("juice")
- Camera shake bij impact (client), kleine squash-tween op knoppen, particle burst plus geluid bij beloningen, en een FOV-tween bij sprinten.
