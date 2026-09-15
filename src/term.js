// Terminal: een echte shell in een pty, via de native helper orka-term.
// De helper leeft zolang het terminalpaneel open is; hij geeft de exitcode van de shell door.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { StringDecoder } = require('string_decoder');
const { PATHS } = require('./store');
const { APP_DIR } = require('./snapshots');

const execFileP = promisify(execFile);
const TERM_SRC = path.join(APP_DIR, 'native', 'orka-term.swift');
const TERM_BIN = path.join(PATHS.bin, 'orka-term');

let building = null;
// Bouwt de helper één keer (en opnieuw zodra het bronbestand nieuwer is).
async function ensureTermHelper() {
  let fresh = false;
  try {
    fresh = fs.statSync(TERM_BIN).mtimeMs >= fs.statSync(TERM_SRC).mtimeMs;
  } catch {}
  if (fresh) return TERM_BIN;
  building ||= execFileP('swiftc', ['-O', TERM_SRC, '-o', TERM_BIN], { timeout: 300000 })
    .catch((e) => {
      throw new Error(`Kon de terminal-helper niet bouwen. Installeer de Xcode Command Line Tools (xcode-select --install).\n${e.stderr || e.message}`);
    })
    .finally(() => {
      building = null;
    });
  await building;
  return TERM_BIN;
}

class Terminals {
  constructor(emit) {
    this.emit = emit; // ({type:'data'|'exit', id, ...}) => void
    this.terms = new Map();
  }

  async start({ cols = 80, rows = 24, cwd, shell, login = true } = {}) {
    const bin = await ensureTermHelper();
    const id = crypto.randomBytes(5).toString('hex');
    const c = Math.max(20, Math.min(400, Math.round(Number(cols) || 80)));
    const r = Math.max(5, Math.min(200, Math.round(Number(rows) || 24)));
    let dir = cwd && path.isAbsolute(cwd) ? cwd : os.homedir();
    try {
      if (!fs.statSync(dir).isDirectory()) dir = os.homedir();
    } catch {
      dir = os.homedir();
    }
    const argv = [String(c), String(r), dir, shell || process.env.SHELL || '/bin/zsh', login ? 'login' : 'interactive'];
    const child = spawn(bin, argv, { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });
    const out = new StringDecoder('utf8');
    const err = new StringDecoder('utf8');
    child.stdout.on('data', (buf) => this.emit({ type: 'data', id, chunk: out.write(buf) }));
    child.stderr.on('data', (buf) => this.emit({ type: 'data', id, chunk: err.write(buf) }));
    child.on('error', (e) => this.emit({ type: 'data', id, chunk: `\r\n[terminal] ${e.message}\r\n` }));
    child.on('close', (code) => {
      this.terms.delete(id);
      this.emit({ type: 'exit', id, code });
    });
    this.terms.set(id, { child, cols: c, rows: r });
    return { id, cols: c, rows: r, cwd: dir };
  }

  input(id, data) {
    const t = this.terms.get(id);
    if (!t || t.child.stdin.destroyed) return;
    try {
      t.child.stdin.write(String(data ?? ''));
    } catch {}
  }

  resize(id, cols, rows) {
    const t = this.terms.get(id);
    if (!t) return;
    const c = Math.max(20, Math.min(400, Math.round(Number(cols) || t.cols)));
    const r = Math.max(5, Math.min(200, Math.round(Number(rows) || t.rows)));
    if (c === t.cols && r === t.rows) return;
    t.cols = c;
    t.rows = r;
    try {
      // Besturingsbericht voor de helper: hij zet de pty-grootte (en dus SIGWINCH).
      t.child.stdin.write(`\u0000ORKA:RESIZE:${c}:${r}\n`);
    } catch {}
  }

  stop(id) {
    const t = this.terms.get(id);
    if (!t) return;
    this.terms.delete(id);
    try {
      t.child.kill('SIGHUP');
    } catch {}
  }

  stopAll() {
    for (const id of [...this.terms.keys()]) this.stop(id);
  }
}

module.exports = { Terminals, ensureTermHelper, TERM_BIN };
