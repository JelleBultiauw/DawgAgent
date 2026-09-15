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
const MAX_IMAGE_WIDTH = 1600;

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

async function screenshot(outDir, { ocr = true } = {}) {
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
      lines.push('Tekst op scherm (OCR, middelpunt):');
      for (const it of res.items.slice(0, 320)) {
        const cx = Math.round((it.x + it.w / 2) * g.imgW);
        const cy = Math.round((it.y + it.h / 2) * g.imgH);
        lines.push(`"${it.text}" @(${cx},${cy})`);
      }
    }
  }
  fs.rmSync(png, { force: true });
  return { text: lines.join('\n'), images: [jpg] };
}

async function uiElements() {
  await geometry();
  const res = await helper(['ax', 350], 25000);
  const scale = (line) => line.replace(/@\((\d+),(\d+)\) (\d+)x(\d+)/, (_, x, y, w, h) => `@(${toImage(x)},${toImage(y)}) ${toImage(w)}x${toImage(h)}`);
  return `Elementen in ${res.app}${res.truncated ? ' (ingekort)' : ''} — rol "label" = waarde @(klik-x,klik-y) grootte:\n${res.elements.map(scale).join('\n') || '(geen toegankelijke elementen gevonden)'}`;
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

module.exports = { ensureHelper, screenshot, uiElements, click, move, drag, scroll, typeText, key, openApp, permissions, geometry, ocrText };
