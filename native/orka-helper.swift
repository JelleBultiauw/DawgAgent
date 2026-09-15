// orka-helper — kleine native helper voor computer use op macOS.
// Wordt automatisch gecompileerd door Orka (swiftc). Alle output is JSON.
//
//   screen                          -> {width,height,scale}
//   permissions [prompt]            -> {accessibility, screenRecording}
//   ocr <image>                     -> {width,height,items:[{text,x,y,w,h}]} (genormaliseerd, oorsprong linksboven)
//   move <x> <y>
//   click <x> <y> [left|right|middle] [count]
//   drag <x1> <y1> <x2> <y2>
//   scroll <x> <y> <dy> [dx]       (positief dy = omhoog, in regels)
//   type <text>
//   key <combo>                     bv. "cmd+shift+t", "return", "escape"
//   cursor                          -> {x,y}
//   ax [max]                        -> toegankelijkheidsboom van de voorste app
//   windows                         -> zichtbare vensters

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import Vision

func emit(_ obj: Any) {
    if let d = try? JSONSerialization.data(withJSONObject: obj, options: []),
       let s = String(data: d, encoding: .utf8) {
        print(s)
    }
}

func fail(_ msg: String) -> Never {
    emit(["error": msg])
    exit(1)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { fail("geen commando") }

func num(_ i: Int, _ def: Double? = nil) -> Double {
    if args.count > i, let v = Double(args[i]) { return v }
    if let def = def { return def }
    fail("argument \(i) ontbreekt of is geen getal")
}

let src = CGEventSource(stateID: .hidSystemState)

func pause(_ ms: UInt32) { usleep(ms * 1000) }

func mouse(_ type: CGEventType, _ p: CGPoint, _ btn: CGMouseButton = .left, clicks: Int64 = 1) {
    guard let e = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: btn) else { return }
    e.setIntegerValueField(.mouseEventClickState, value: clicks)
    e.post(tap: .cghidEventTap)
}

let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11,
    "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
    "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31,
    "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42,
    ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51,
    "escape": 53, "esc": 53, "forwarddelete": 117, "left": 123, "right": 124, "down": 125,
    "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
    "f9": 101, "f10": 109, "f11": 103, "f12": 111,
]

func pressKey(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
    let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true)
    down?.flags = flags
    down?.post(tap: .cghidEventTap)
    pause(12)
    let up = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)
    up?.flags = flags
    up?.post(tap: .cghidEventTap)
    pause(12)
}

func typeText(_ text: String) {
    let lines = text.components(separatedBy: "\n")
    for (li, line) in lines.enumerated() {
        for ch in line {
            let units = Array(String(ch).utf16)
            let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
            down?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            down?.post(tap: .cghidEventTap)
            let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
            up?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            up?.post(tap: .cghidEventTap)
            pause(4)
        }
        if li < lines.count - 1 { pressKey(36) }
    }
}

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

func str(_ el: AXUIElement, _ name: String) -> String {
    guard let v = attr(el, name) else { return "" }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n.stringValue }
    return ""
}

func frame(_ el: AXUIElement) -> CGRect? {
    guard let pv = attr(el, kAXPositionAttribute as String), let sv = attr(el, kAXSizeAttribute as String) else { return nil }
    var p = CGPoint.zero
    var s = CGSize.zero
    AXValueGetValue(pv as! AXValue, .cgPoint, &p)
    AXValueGetValue(sv as! AXValue, .cgSize, &s)
    return CGRect(origin: p, size: s)
}

switch cmd {
case "screen":
    let id = CGMainDisplayID()
    let b = CGDisplayBounds(id)
    let pw = CGDisplayCopyDisplayMode(id)?.pixelWidth ?? Int(b.width)
    emit(["width": b.width, "height": b.height, "scale": Double(pw) / Double(b.width)])

case "permissions":
    let prompt = args.count > 1 && args[1] == "prompt"
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
    let ax = AXIsProcessTrustedWithOptions(opts)
    var screen = CGPreflightScreenCaptureAccess()
    if prompt && !screen { screen = CGRequestScreenCaptureAccess() }
    emit(["accessibility": ax, "screenRecording": screen])

case "ocr":
    guard args.count > 1 else { fail("pad naar afbeelding ontbreekt") }
    let url = URL(fileURLWithPath: args[1])
    guard let isrc = CGImageSourceCreateWithURL(url as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(isrc, 0, nil) else { fail("kan afbeelding niet openen") }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    req.recognitionLanguages = ["nl-NL", "en-US", "de-DE", "fr-FR"]
    do { try VNImageRequestHandler(cgImage: img, options: [:]).perform([req]) } catch { fail("OCR mislukt: \(error)") }
    var items: [[String: Any]] = []
    for o in req.results ?? [] {
        guard let c = o.topCandidates(1).first else { continue }
        let bb = o.boundingBox
        items.append(["text": c.string, "x": bb.minX, "y": 1 - bb.maxY, "w": bb.width, "h": bb.height])
    }
    emit(["width": img.width, "height": img.height, "items": items])

case "move":
    mouse(.mouseMoved, CGPoint(x: num(1), y: num(2)))
    emit(["ok": true])

case "click":
    let p = CGPoint(x: num(1), y: num(2))
    let which = args.count > 3 ? args[3] : "left"
    let count = Int(num(4, 1))
    let (btn, downT, upT): (CGMouseButton, CGEventType, CGEventType) =
        which == "right" ? (.right, .rightMouseDown, .rightMouseUp)
        : which == "middle" ? (.center, .otherMouseDown, .otherMouseUp)
        : (.left, .leftMouseDown, .leftMouseUp)
    mouse(.mouseMoved, p)
    pause(40)
    for i in 1...max(1, count) {
        mouse(downT, p, btn, clicks: Int64(i))
        pause(30)
        mouse(upT, p, btn, clicks: Int64(i))
        pause(60)
    }
    emit(["ok": true])

case "drag":
    let a = CGPoint(x: num(1), y: num(2))
    let b = CGPoint(x: num(3), y: num(4))
    mouse(.mouseMoved, a)
    pause(50)
    mouse(.leftMouseDown, a)
    pause(80)
    let steps = 20
    for i in 1...steps {
        let t = CGFloat(i) / CGFloat(steps)
        mouse(.leftMouseDragged, CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
        pause(15)
    }
    mouse(.leftMouseUp, b)
    emit(["ok": true])

case "scroll":
    mouse(.mouseMoved, CGPoint(x: num(1), y: num(2)))
    pause(30)
    let dy = Int32(num(3))
    let dx = Int32(num(4, 0))
    let e = CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
    e?.post(tap: .cghidEventTap)
    emit(["ok": true])

case "type":
    guard args.count > 1 else { fail("tekst ontbreekt") }
    typeText(args[1])
    emit(["ok": true])

case "key":
    guard args.count > 1 else { fail("toetscombinatie ontbreekt") }
    var flags: CGEventFlags = []
    var code: CGKeyCode?
    for raw in args[1].lowercased().split(separator: "+").map(String.init) {
        let part = raw.trimmingCharacters(in: .whitespaces)
        switch part {
        case "cmd", "command", "meta", "super": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "ctrl", "control": flags.insert(.maskControl)
        case "alt", "option", "opt": flags.insert(.maskAlternate)
        case "fn": flags.insert(.maskSecondaryFn)
        default:
            guard let c = keyCodes[part] else { fail("onbekende toets: \(part)") }
            code = c
        }
    }
    guard let c = code else { fail("geen toets in combinatie") }
    pressKey(c, flags)
    emit(["ok": true])

case "cursor":
    let p = CGEvent(source: nil)?.location ?? .zero
    emit(["x": p.x, "y": p.y])

case "windows":
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    var wins: [[String: Any]] = []
    for w in list {
        guard (w[kCGWindowLayer as String] as? Int) == 0 else { continue }
        let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        wins.append([
            "app": w[kCGWindowOwnerName as String] as? String ?? "",
            "title": w[kCGWindowName as String] as? String ?? "",
            "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "w": b["Width"] ?? 0, "h": b["Height"] ?? 0,
        ])
    }
    let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
    emit(["frontmost": front, "windows": wins])

case "ax":
    let maxItems = Int(num(1, 350))
    guard let app = NSWorkspace.shared.frontmostApplication else { fail("geen voorste app") }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 1.5)
    var lines: [String] = []
    let interesting: Set<String> = ["AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton",
                                    "AXPopUpButton", "AXMenuButton", "AXLink", "AXTab", "AXComboBox", "AXSlider",
                                    "AXStaticText", "AXImage", "AXCell", "AXRow", "AXMenuItem", "AXSearchField",
                                    "AXDisclosureTriangle", "AXIncrementor", "AXHeading", "AXWindow", "AXSheet"]
    func walk(_ el: AXUIElement, _ depth: Int) {
        if lines.count >= maxItems || depth > 30 { return }
        let role = str(el, kAXRoleAttribute as String)
        var label = str(el, kAXTitleAttribute as String)
        if label.isEmpty { label = str(el, kAXDescriptionAttribute as String) }
        var value = str(el, kAXValueAttribute as String)
        if value.count > 80 { value = String(value.prefix(80)) + "…" }
        if interesting.contains(role) && !(label.isEmpty && value.isEmpty && role == "AXStaticText"),
           let f = frame(el), f.width > 1, f.height > 1 {
            var line = String(repeating: " ", count: min(depth, 12)) + role.replacingOccurrences(of: "AX", with: "")
            if !label.isEmpty { line += " \"\(label)\"" }
            if !value.isEmpty && value != label { line += " = \"\(value)\"" }
            line += " @(\(Int(f.midX)),\(Int(f.midY))) \(Int(f.width))x\(Int(f.height))"
            lines.append(line)
        }
        guard let kids = attr(el, kAXChildrenAttribute as String) as? [AXUIElement] else { return }
        for k in kids { walk(k, depth + 1) }
    }
    if let win = attr(root, kAXFocusedWindowAttribute as String) {
        walk(win as! AXUIElement, 0)
    } else if let wins = attr(root, kAXWindowsAttribute as String) as? [AXUIElement], let first = wins.first {
        walk(first, 0)
    }
    emit(["app": app.localizedName ?? "", "truncated": lines.count >= maxItems, "elements": lines])

default:
    fail("onbekend commando: \(cmd)")
}
