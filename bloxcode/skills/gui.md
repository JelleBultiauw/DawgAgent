---
name: gui
description: UI bouwen: ScreenGui, HUD's, menu's, shops, schaalbaar voor mobiel, TweenService-animaties, BillboardGui en SurfaceGui
---
# UI in Roblox

## Basis-setup
- ScreenGui in StarterGui met `ResetOnSpawn = false` (anders verdwijnt de UI bij doodgaan), `ZIndexBehavior = Sibling`, `IgnoreGuiInset` alleen als je bewust de topbar overlapt.
- De UI-logica zit in een LocalScript in de ScreenGui (of in StarterPlayerScripts, met `PlayerGui:WaitForChild`).
- In Edit zie je UI in de viewport als `StarterGui.ShowDevelopmentGui = true`; controleer met screen_capture.

## Schalen (werkt op alle schermen)
- Gebruik Scale: `UDim2.fromScale(0.3, 0.1)`; Offset alleen voor kleine vaste details.
- Centreren: `AnchorPoint = Vector2.new(0.5, 0.5)`, `Position = UDim2.fromScale(0.5, 0.5)`.
- `UIAspectRatioConstraint` houdt vierkante knoppen vierkant; `UISizeConstraint` begrenst min/max-grootte.
- Tekst: `TextScaled = true` plus `UITextSizeConstraint` (MaxTextSize) zodat tekst niet enorm wordt.
- Telefoon: knoppen minimaal ~44 px hoog; belangrijke knoppen niet in de hoeken onder duimen of in de notch.

## Layout en stijl
- `UIListLayout` (FillDirection, Padding, SortOrder = LayoutOrder, HorizontalAlignment), `UIGridLayout` (CellSize, CellPadding) voor shops en inventories.
- `UIPadding`, `UICorner` (CornerRadius = UDim.new(0, 8)), `UIStroke` (Thickness 2), `UIGradient`.
- Lettertype: `label.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Bold)`.
- Houd een vast palet aan (achtergrond, paneel, accent, tekst) en consistente afstanden (8/12/16 px).

## Knoppen en animatie
```lua
local TweenService = game:GetService("TweenService")
local button = script.Parent.OpenShop
local shop = script.Parent.Shop
local info = TweenInfo.new(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

button.Activated:Connect(function() -- Activated werkt voor muis, touch en gamepad
	shop.Visible = true
	shop.Position = UDim2.fromScale(0.5, 0.6)
	TweenService:Create(shop, info, { Position = UDim2.fromScale(0.5, 0.5) }):Play()
end)

button.MouseEnter:Connect(function()
	TweenService:Create(button, info, { Size = UDim2.fromScale(0.22, 0.09) }):Play()
end)
```

## Data tonen
- Luister naar waarden in plaats van elke frame te pollen: `player.leaderstats.Coins.Changed:Connect(update)` of `player:GetAttributeChangedSignal("Coins")`.
- Aankopen via een RemoteEvent; de server beslist. De UI toont alleen het resultaat.

## Wereld-UI
- `BillboardGui` boven hoofden en objecten: Adornee/parent aan een part, `Size = UDim2.fromScale(4, 1)`, `StudsOffset = Vector3.new(0, 3, 0)`, `MaxDistance = 60`, `AlwaysOnTop` naar keuze.
- `SurfaceGui` op een part (borden, schermen): `Face`, `SizingMode = PixelsPerStud`, `PixelsPerStud = 50`.

## Veelgebruikte schermen
- HUD: valuta rechtsboven, knoppenbalk links, meldingen (toasts) middenboven die na 3 s wegtweenen.
- Shop: modal met UIGridLayout-kaarten (icoon, naam, prijs, koopknop) en een sluitknop rechtsboven.
- Laadscherm: ReplicatedFirst-LocalScript, `ContentProvider:PreloadAsync`, daarna fade-out.

Voor het testen op verschillende apparaten heeft de Roblox-server de skill `rbx-device-simulator-lua`.
