// Computer use: schermafbeeldingen, OCR, muis en toetsenbord via de native helper.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PATHS } = require('./store');
const { APP_DIR } = require('./snapshots');

const execFileP = promisify(execFile);
const HELPER_SRC = path.join(APP_DIR, 'native', 'orka-helper.swift');
const HELPER_BIN = path.join(PATHS.bin, 'orka-helper');
// Elke pixel in de breedte kost tokens zodra de afbeelding naar het model gaat; 1280 is
// ruim genoeg om tekst en knoppen te lezen en scheelt tientallen procenten per screenshot.
const MAX_IMAGE_WIDTH = 1280;

let building = null;
let geo = null;

async function ensureHelper() {
  let fresh = false;
  try {
    fresh = fs.statSync(HELPER_BIN).mtimeMs >= fs.statSync(HELPER_SRC).mtimeMs;
  } catch {}
  if (fresh) return HELPER_BIN;
  building ||= execFileP('swiftc', ['-O', HELPER_SRC, '-o', HELPER_BIN], { timeout: 300000 })
    .catch((e) => {
      throw new Error(
        `Kon de computer-use helper niet bouwen. Installeer de Xcode Command Line Tools (xcode-select --install).\n${e.stderr || e.message}`,
      );
    })
    .finally(() => {
      building = null;
    });
  await building;
  return HELPER_BIN;
}

async function helper(args, timeout = 20000) {
  const bin = await ensureHelper();
  let stdout;
  try {
    ({ stdout } = await execFileP(bin, args.map(String), { timeout, maxBuffer: 32 * 1024 * 1024 }));
  } catch (e) {
    stdout = e.stdout;
    if (!stdout) throw new Error(e.killed ? 'Helper reageerde niet op tijd' : e.message);
  }
  const json = JSON.parse(String(stdout).trim().split('\n').pop());
  if (json.error) throw new Error(json.error);
  return json;
}

// Schermgeometrie: modelcoördinaten zijn pixels in de (verkleinde) screenshot.
async function geometry() {
  const s = await helper(['screen']);
  const k = s.width > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / s.width : 1;
  geo = { ...s, k, imgW: Math.round(s.width * k), imgH: Math.round(s.height * k) };
  return geo;
}

async function toScreen(x, y) {
  const g = geo || (await geometry());
  const sx = Math.round(Number(x) / g.k);
  const sy = Math.round(Number(y) / g.k);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) throw new Error('Ongeldige coördinaten');
  if (sx < 0 || sy < 0 || sx > g.width || sy > g.height) {
    throw new Error(`Coördinaten (${x},${y}) vallen buiten het scherm (${g.imgW}×${g.imgH})`);
  }
  return [sx, sy];
}

const toImage = (v) => Math.round(v * (geo?.k || 1));

// Zet helper-coördinaten (echte schermpixels) om naar coördinaten in de verkleinde screenshot.
const scaleLine = (line) =>
  String(line).replace(/@\((\d+),(\d+)\) (\d+)x(\d+)/, (_, x, y, w, h) => `@(${toImage(x)},${toImage(y)}) ${toImage(w)}x${toImage(h)}`);

async function screenshot(outDir, { ocr = true, ocrLimit = 220 } = {}) {
  const g = await geometry();
  const base = path.join(PATHS.tmp, `shot-${Date.now()}`);
  const png = `${base}.png`;
  fs.mkdirSync(outDir, { recursive: true });
  const jpg = path.join(outDir, `scherm-${Date.now()}.jpg`);
  await execFileP('screencapture', ['-x', '-C', '-m', png], { timeout: 15000 });
  await execFileP('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '78', '--resampleWidth', String(g.imgW), png, '--out', jpg], {
    timeout: 15000,
  });

  const lines = [`Screenshot van het hoofdscherm: ${g.imgW}×${g.imgH} (gebruik deze pixelcoördinaten voor acties).`];
  const wins = await helper(['windows']).catch(() => null);
  if (wins) {
    lines.push(`Voorste app: ${wins.frontmost}`);
    const list = wins.windows.slice(0, 12).map((w) => `- ${w.app}${w.title ? ` — "${w.title}"` : ''} [${toImage(w.x)},${toImage(w.y)} ${toImage(w.w)}×${toImage(w.h)}]`);
    if (list.length) lines.push('Zichtbare vensters:', ...list);
  }
  if (ocr) {
    const res = await helper(['ocr', png], 40000).catch(() => null);
    if (res?.items?.length) {
      const limit = Math.max(0, Math.min(400, Number(ocrLimit) || 220));
      lines.push('Tekst op scherm (OCR, middelpunt):');
      for (const it of res.items.slice(0, limit)) {
        const cx = Math.round((it.x + it.w / 2) * g.imgW);
        const cy = Math.round((it.y + it.h / 2) * g.imgH);
        lines.push(`"${it.text}" @(${cx},${cy})`);
      }
      if (res.items.length > limit) lines.push(`… en nog ${res.items.length - limit} stukken tekst (vraag gerust opnieuw als je iets speciaals zoekt)`);
    }
  }
  fs.rmSync(png, { force: true });
  return { text: lines.join('\n'), images: [jpg] };
}

// Lijst met elementen van het voorste venster (toegankelijkheid). `limit` houdt het klein,
// `filter` laat alleen regels zien waar de tekst in voorkomt (bv. één knop opzoeken).
async function uiElements({ limit = 350, filter = '' } = {}) {
  await geometry();
  const max = Math.max(1, Math.min(600, Number(limit) || 350));
  const res = await helper(['ax', max], 25000);
  const needle = String(filter || '').trim().toLowerCase();
  const all = res.elements || [];
  const lines = (needle ? all.filter((l) => String(l).toLowerCase().includes(needle)) : all).map(scaleLine);
  const extra = [res.truncated ? 'ingekort' : '', needle ? `gefilterd op "${filter}"` : ''].filter(Boolean).join(', ');
  return `Elementen in ${res.app}${extra ? ` (${extra})` : ''} — rol "label" = waarde @(klik-x,klik-y) grootte:\n${lines.join('\n') || '(geen toegankelijke elementen gevonden)'}`;
}

// Goedkope tekstupdate na een actie: voorste app + de elementen van het voorste venster.
// Dit vervangt de dure screenshot-per-actie (die duizenden tokens per stap kostte) en is
// meestal zelfs preciezer, want je ziet de echte knoppen en velden met klikpunten.
// Levert het niets op (app zonder toegankelijkheid), dan pakt de aanroeper alsnog een beeld.
async function uiDigest({ limit = 60 } = {}) {
  await geometry();
  let res;
  try {
    res = await helper(['ax', Math.max(10, Math.min(120, Number(limit) || 60))], 20000);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const lines = (res.elements || []).map(scaleLine).filter((l) => l.trim());
  if (lines.length < 3) return { ok: false, app: res.app };
  return {
    ok: true,
    app: res.app,
    text: `Voorste app: ${res.app}${res.truncated ? ' (lijst ingekort)' : ''} — elementen van het venster (label @(klik-x,klik-y)):\n${lines.join('\n')}`,
  };
}

async function click(x, y, button = 'left', clicks = 1) {
  const [sx, sy] = await toScreen(x, y);
  await helper(['click', sx, sy, button, Math.max(1, Math.min(3, clicks))]);
}

async function move(x, y) {
  const [sx, sy] = await toScreen(x, y);
  await helper(['move', sx, sy]);
}

async function drag(x1, y1, x2, y2) {
  const [a, b] = await toScreen(x1, y1);
  const [c, d] = await toScreen(x2, y2);
  await helper(['drag', a, b, c, d]);
}

async function scroll(x, y, direction = 'down', amount = 5) {
  const [sx, sy] = await toScreen(x, y);
  const n = Math.max(1, Math.min(50, Math.round(amount)));
  const dy = direction === 'up' ? n : direction === 'down' ? -n : 0;
  const dx = direction === 'left' ? n : direction === 'right' ? -n : 0;
  await helper(['scroll', sx, sy, dy, dx]);
}

async function typeText(text) {
  await helper(['type', text], 10000 + String(text).length * 20);
}

async function key(combo) {
  await helper(['key', combo]);
}

async function openApp(name) {
  await execFileP('open', ['-a', name], { timeout: 15000 });
}

async function ocrText(p) {
  const res = await helper(['ocr', p], 40000);
  return res.items.map((i) => i.text).join('\n');
}

async function permissions(prompt = false) {
  return helper(prompt ? ['permissions', 'prompt'] : ['permissions']);
}

module.exports = { ensureHelper, screenshot, uiElements, uiDigest, click, move, drag, scroll, typeText, key, openApp, permissions, geometry, ocrText };
