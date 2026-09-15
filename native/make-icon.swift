// Tekent het DawgAgent-app-icoon: afgeronde tegel met blauw verloop en een simpele robot-cartoon.
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

// macOS-tegel: 824px met marge, hoekradius ~185
let inset: CGFloat = 100
let tile = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
let path = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 36, color: NSColor(white: 0, alpha: 0.28).cgColor)
ctx.addPath(path)
ctx.setFillColor(NSColor.black.cgColor)
ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(path)
ctx.clip()
let colors = [NSColor(calibratedRed: 0.29, green: 0.47, blue: 0.98, alpha: 1).cgColor,
              NSColor(calibratedRed: 0.09, green: 0.17, blue: 0.43, alpha: 1).cgColor] as CFArray
let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: tile.minX, y: tile.maxY), end: CGPoint(x: tile.maxX, y: tile.minY), options: [])

// ---------- robot-cartoon ----------
let white = NSColor.white.cgColor
let ink = NSColor(calibratedRed: 0.09, green: 0.14, blue: 0.31, alpha: 1).cgColor
let sunny = NSColor(calibratedRed: 1.0, green: 0.82, blue: 0.40, alpha: 1).cgColor
let blush = NSColor(calibratedRed: 1.0, green: 0.58, blue: 0.58, alpha: 0.45).cgColor

func rounded(_ r: CGRect, _ radius: CGFloat, _ color: CGColor) {
    ctx.addPath(CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil))
    ctx.setFillColor(color)
    ctx.fillPath()
}
func dot(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, _ color: CGColor) {
    ctx.setFillColor(color)
    ctx.fillEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
}

// oren (achter het hoofd)
rounded(CGRect(x: 166, y: 445, width: 98, height: 150), 49, white)
rounded(CGRect(x: 760, y: 445, width: 98, height: 150), 49, white)

// antenne-steel (achter het hoofd)
ctx.setStrokeColor(white)
ctx.setLineWidth(36)
ctx.setLineCap(.round)
ctx.move(to: CGPoint(x: 512, y: 660))
ctx.addLine(to: CGPoint(x: 512, y: 802))
ctx.strokePath()

// hoofd met zachte schaduw
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -16), blur: 40, color: NSColor(calibratedRed: 0.03, green: 0.06, blue: 0.18, alpha: 0.35).cgColor)
rounded(CGRect(x: 250, y: 310, width: 524, height: 380), 108, white)
ctx.restoreGState()

// antenne-bal
dot(512, 838, 47, sunny)

// wangetjes
dot(318, 462, 27, blush)
dot(706, 462, 27, blush)

// ogen met highlight
dot(390, 540, 52, ink)
dot(634, 540, 52, ink)
dot(404, 554, 17, white)
dot(648, 554, 17, white)

// glimlach
ctx.setStrokeColor(ink)
ctx.setLineWidth(30)
ctx.setLineCap(.round)
ctx.move(to: CGPoint(x: 421, y: 468))
ctx.addCurve(to: CGPoint(x: 603, y: 468), control1: CGPoint(x: 470, y: 428), control2: CGPoint(x: 554, y: 428))
ctx.strokePath()

ctx.restoreGState()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
