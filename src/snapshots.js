// Back-ups van penuraplicatie's eigen broncode, zodat zelf-aanpassingen altijd terug te draaien zijn.
const fs = require('fs');
const path = require('path');
const { PATHS, readJson, writeJson } = require('./store');

const APP_DIR = fs.realpathSync(path.resolve(__dirname, '..'));
const EXCLUDE = new Set(['node_modules', '.git', 'dist', '.DS_Store']);
const MAX_SNAPSHOTS = 40;

function included(abs, root) {
  const rel = path.relative(root, abs);
  if (!rel) return true;
  return !rel.split(path.sep).some((part) => EXCLUDE.has(part));
}

function isInsideApp(p) {
  let abs = path.resolve(p);
  try {
    abs = fs.realpathSync(abs);
  } catch {
    try {
      abs = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {}
  }
  const rel = path.relative(APP_DIR, abs);
  return !rel.startsWith('..') && !path.isAbsolute(rel) && included(abs, APP_DIR);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${d.getMilliseconds()}`;
}

function createSnapshot(reason) {
  const id = stamp();
  const dest = path.join(PATHS.snapshots, id);
  fs.cpSync(APP_DIR, path.join(dest, 'files'), { recursive: true, filter: (src) => included(src, APP_DIR) });
  writeJson(path.join(dest, 'meta.json'), { id, created: Date.now(), reason });
  prune();
  return id;
}

function listSnapshots() {
  return fs
    .readdirSync(PATHS.snapshots)
    .map((id) => readJson(path.join(PATHS.snapshots, id, 'meta.json'), null))
    .filter(Boolean)
    .sort((a, b) => b.created - a.created);
}

function prune() {
  for (const s of listSnapshots().slice(MAX_SNAPSHOTS)) {
    fs.rmSync(path.join(PATHS.snapshots, s.id), { recursive: true, force: true });
  }
}

function walk(dir, root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (!included(abs, root)) continue;
    if (entry.isDirectory()) walk(abs, root, out);
    else out.push(path.relative(root, abs));
  }
  return out;
}

function restoreSnapshot(id) {
  const src = path.join(PATHS.snapshots, id, 'files');
  if (!fs.existsSync(src)) throw new Error(`Back-up ${id} bestaat niet`);
  createSnapshot(`Automatisch vóór herstel naar ${id}`);
  const keep = new Set(walk(src, src));
  for (const rel of walk(APP_DIR, APP_DIR)) {
    if (!keep.has(rel)) fs.rmSync(path.join(APP_DIR, rel), { force: true });
  }
  fs.cpSync(src, APP_DIR, { recursive: true, force: true });
}

module.exports = { APP_DIR, isInsideApp, createSnapshot, listSnapshots, restoreSnapshot };
