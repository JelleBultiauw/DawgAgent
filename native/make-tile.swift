// Maakt van een foto een net macOS-app-icoon: afgeronde tegel met de foto erin.
// gebruik: make-tile <bron.png> <uit.png> [achtergrond-hex]
import AppKit

let args = CommandLine.arguments
guard args.count > 2, let image = NSImage(contentsOfFile: args[1]) else {
    FileHandle.standardError.write("gebruik: make-tile <bron.png> <uit.png> [hex]\n".data(using: .utf8)!)
    exit(1)
}
let out = args[2]
var bg = NSColor(calibratedRed: 0.97, green: 0.97, blue: 0.98, alpha: 1)
if args.count > 3 {
    let hex = args[3].replacingOccurrences(of: "#", with: "")
    if hex.count == 6, let v = UInt32(hex, radix: 16) {
        bg = NSColor(calibratedRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

let size: CGFloat = 1024
let inset: CGFloat = 84
let radius: CGFloat = 200
let pad: CGFloat = 40

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

let tile = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
let clip = CGPath(roundedRect: tile, cornerWidth: radius, cornerHeight: radius, transform: nil)

// Slagschaduw onder de tegel.
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 34, color: NSColor(white: 0, alpha: 0.30).cgColor)
ctx.addPath(clip)
ctx.setFillColor(NSColor.black.cgColor)
ctx.fillPath()
ctx.restoreGState()

// Tegel met de foto, bijgesneden op de afgeronde vorm.
ctx.saveGState()
ctx.addPath(clip)
ctx.clip()

// Lichte achtergrond.
ctx.setFillColor(bg.cgColor)
ctx.fill(tile)

// Foto zo groot mogelijk, gecentreerd.
let avail = CGSize(width: tile.width - pad * 2, height: tile.height - pad * 2)
let imgSize = image.size
let scale = min(avail.width / imgSize.width, avail.height / imgSize.height)
let drawSize = CGSize(width: imgSize.width * scale, height: imgSize.height * scale)
let drawRect = CGRect(x: tile.midX - drawSize.width / 2, y: tile.midY - drawSize.height / 2, width: drawSize.width, height: drawSize.height)
image.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1.0, respectFlipped: false, hints: [.interpolation: NSImageInterpolation.high.rawValue])
ctx.restoreGState()

NSGraphicsContext.restoreGraphicsState()

guard let data = rep.representation(using: .png, properties: [:]) else { exit(1) }
try? data.write(to: URL(fileURLWithPath: out))
print("gemaakt: \(out)")
