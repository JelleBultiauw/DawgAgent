// orka-term — start een shell in een echte pty en brug stdin↔stdout, voor het terminalpaneel.
//
//   gebruik: orka-term <cols> <rows> <cwd> [commando ...]
//
// Op stdin: gewone bytes gaan naar de shell. Een besturingsbericht
// "\0ORKA:RESIZE:<cols>:<rows>\n" past de pty-grootte aan (de shell krijgt SIGWINCH).
// Op stdout: alles wat de shell produceert, ongewijzigd. De exitcode is die van de shell.

import Darwin
import Foundation

signal(SIGPIPE, SIG_IGN)

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 3 else {
    FileHandle.standardError.write("gebruik: orka-term <cols> <rows> <cwd> [commando ...]\n".data(using: .utf8)!)
    exit(2)
}
let startCols = UInt16(args[0]) ?? 80
let startRows = UInt16(args[1]) ?? 24
let workDir = args[2]
let shell = args.count > 3 ? args[3] : (ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
let login = args.count > 4 ? args[4] == "login" : true

var master: Int32 = -1
var ws = winsize(ws_row: startRows, ws_col: startCols, ws_xpixel: 0, ws_ypixel: 0)

// Alles wat het kind nodig heeft vóór de fork klaarzetten (na fork geen allocaties meer).
var argv: [UnsafeMutablePointer<CChar>?] = [strdup(shell), strdup(login ? "-l" : "-i"), nil]
let term = strdup("xterm-256color")
let colorterm = strdup("truecolor")
let lang = strdup("en_US.UTF-8")

let pid = forkpty(&master, nil, nil, &ws)
if pid == 0 {
    // kind
    chdir(workDir)
    setenv("TERM", term, 1)
    setenv("COLORTERM", colorterm, 1)
    setenv("LANG", lang, 1)
    signal(SIGPIPE, SIG_DFL)
    execvp(argv[0], argv)
    exit(127)
}
if pid < 0 {
    FileHandle.standardError.write("kon geen pty openen\n".data(using: .utf8)!)
    exit(1)
}

let done = DispatchSemaphore(value: 0)

// stdin → pty (met het resize-protocol)
DispatchQueue.global().async {
    var buf = [UInt8](repeating: 0, count: 65536)
    var pending = [UInt8]()
    loop: while true {
        let n = read(0, &buf, buf.count)
        if n < 0 && errno == EINTR { continue }
        if n <= 0 { break }
        pending.append(contentsOf: buf[0..<n])
        while !pending.isEmpty {
            if pending[0] == 0 {
                guard let nl = pending.firstIndex(of: 10) else { break }
                let line = String(bytes: pending[1..<nl], encoding: .utf8) ?? ""
                pending.removeFirst(nl + 1)
                if line.hasPrefix("ORKA:RESIZE:") {
                    let parts = line.dropFirst("ORKA:RESIZE:".count).split(separator: ":")
                    if parts.count == 2, let c = UInt16(parts[0]), let r = UInt16(parts[1]), master >= 0 {
                        var w = winsize(ws_row: r, ws_col: c, ws_xpixel: 0, ws_ypixel: 0)
                        _ = ioctl(master, TIOCSWINSZ, &w)
                    }
                }
            } else {
                let ok = pending.withUnsafeBufferPointer { writeAll(master, $0.baseAddress, $0.count) }
                pending.removeAll(keepingCapacity: true)
                if !ok { break loop }
            }
        }
    }
}

// pty → stdout
DispatchQueue.global().async {
    var buf = [UInt8](repeating: 0, count: 65536)
    while true {
        let n = read(master, &buf, buf.count)
        if n < 0 && errno == EINTR { continue }
        if n <= 0 { break }
        let ok = buf.withUnsafeBufferPointer { writeAll(1, $0.baseAddress, n) }
        if !ok { break }
    }
    done.signal()
}

var status: Int32 = 0
while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
// Nog even de laatste uitvoer laten doorstromen, maar niet eeuwig wachten op
// achtergrondprocessen die de pty openhouden.
_ = done.wait(timeout: .now() + 1.5)
let code = (status & 0x7f) == 0 ? (status >> 8) & 0xff : (status & 0x7f) + 128
exit(code)

func writeAll(_ fd: Int32, _ ptr: UnsafePointer<UInt8>?, _ count: Int) -> Bool {
    guard let ptr = ptr, count > 0 else { return true }
    var off = 0
    while off < count {
        let w = write(fd, ptr + off, count - off)
        if w < 0 {
            if errno == EINTR { continue }
            return false
        }
        off += w
    }
    return true
}
