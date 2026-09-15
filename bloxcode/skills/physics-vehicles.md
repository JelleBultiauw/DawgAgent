---
name: physics-vehicles
description: Physics en constraints: auto's met VehicleSeat, deuren/liften met motors en servo's, bewegende platforms, veren, touwen en network ownership
---
# Physics, constraints en voertuigen

## Basis
- Constraints verbinden twee Attachments. De primaire as van een Attachment is de X-as (rood); die bepaalt de draairichting van een HingeConstraint.
- Unanchored assemblies simuleren physics; alleen de basis-ankers blijven Anchored.
- Massa en grip: `part.CustomPhysicalProperties = PhysicalProperties.new(density, friction, elasticity, frictionWeight, elasticityWeight)`.
- Impuls: `part:ApplyImpulse(Vector3.new(0, part.AssemblyMass * 50, 0))`. Snelheid lezen: `part.AssemblyLinearVelocity`.
- Zwaartekracht: `workspace.Gravity` (standaard 196.2).

## Network ownership
- Spelers krijgen automatisch eigendom van nabije physics-objecten. Server-gestuurd (NPC's, platforms): `part:SetNetworkOwner(nil)`.
- Voertuig: bij instappen `seat:SetNetworkOwner(player)` voor soepel rijden; bij uitstappen terug naar `nil`.

## Constraints-overzicht
| Constraint | Gebruik | Belangrijke properties |
|---|---|---|
| HingeConstraint | wielen, deuren, draaiende objecten | ActuatorType (None/Motor/Servo), AngularVelocity, MotorMaxTorque, TargetAngle, AngularSpeed, ServoMaxTorque |
| PrismaticConstraint | schuifdeur, lift | ActuatorType Servo, TargetPosition, Speed, ServoMaxForce, LowerLimit/UpperLimit |
| CylindricalConstraint | wiel met vering | combinatie van hinge en slider |
| SpringConstraint | vering, trampoline | Stiffness, Damping, FreeLength |
| RopeConstraint / RodConstraint | touwen, kettingen, vaste afstand | Length, Visible |
| BallSocketConstraint | ragdoll, hangende lamp | LimitsEnabled, UpperAngle |
| AlignPosition / AlignOrientation | bewegend platform, zwevend object | RigidityEnabled, MaxForce, Responsiveness |
| LinearVelocity / AngularVelocity | constante beweging (movers) | VectorVelocity, MaxForce |
| VectorForce / Torque | eigen krachten | Force, RelativeTo |

## Eenvoudige auto
1. Chassis-part (bijv. 6×1×10) met een `VehicleSeat` erop gewelded (WeldConstraint).
2. Vier wielen: Part met Shape = Cylinder (as langs X), Friction ~1.5.
3. Per wiel: Attachment op het chassis en in het wielcentrum, met gelijke oriëntatie (X-as = wielas). HingeConstraint met `ActuatorType = Motor` en `MotorMaxTorque = 50000`.
4. Voorwielen sturen: een extra "steer"-part per voorwiel met een HingeConstraint `ActuatorType = Servo` (verticale as) tussen chassis en steer-part, en het wiel aan het steer-part.
5. Server-script:
```lua
local seat = car.VehicleSeat
local MAX_SPEED = 60
seat:GetPropertyChangedSignal("Throttle"):Connect(function() end) -- optioneel
game:GetService("RunService").Heartbeat:Connect(function()
	local speed = seat.ThrottleFloat * MAX_SPEED
	for _, motor in car.Motors:GetChildren() do motor.AngularVelocity = speed end
	for _, steer in car.Steering:GetChildren() do steer.TargetAngle = seat.SteerFloat * 30 end
end)
seat:GetPropertyChangedSignal("Occupant"):Connect(function()
	local hum = seat.Occupant
	local player = hum and game.Players:GetPlayerFromCharacter(hum.Parent)
	car.Chassis:SetNetworkOwner(player)
end)
```
Let op het teken: afhankelijk van de wieloriëntatie kan AngularVelocity negatief moeten zijn voor vooruit.

## Bewegend platform dat spelers meeneemt
- Platform unanchored, met `AlignPosition` + `AlignOrientation` naar een onzichtbaar geankerd doel-part (RigidityEnabled = true), en `SetNetworkOwner(nil)`. Beweeg het doel-part met een tween. Of gebruik een PrismaticConstraint-servo.

## Deur en lift
- Scharnierdeur: HingeConstraint Servo, TargetAngle 0 ↔ 90, AngularSpeed 3.
- Lift: PrismaticConstraint Servo, TargetPosition per verdieping, ServoMaxForce hoog genoeg voor de massa plus spelers.

## Debuggen
- Model → Constraints → "Show Welds" / "Draw On Top" in Studio. Controleer de oriëntatie van attachments als iets de verkeerde kant op draait.
