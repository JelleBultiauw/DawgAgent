// Opslag: instellingen, API-sleutel en chats in ~/Library/Application Support/DawgAgent
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = app.getPath('userData');
const PATHS = {
  data: DATA_DIR,
  sessions: path.join(DATA_DIR, 'sessions'),
  skills: path.join(DATA_DIR, 'skills'),
  snapshots: path.join(DATA_DIR, 'snapshots'),
  bin: path.join(DATA_DIR, 'bin'),
  tmp: path.join(DATA_DIR, 'tmp'),
};
for (const dir of Object.values(PATHS)) fs.mkdirSync(dir, { recursive: true });

const DEFAULTS = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  thinking: 'high', // off | low | high | max
  vision: true,
  approval: 'edits', // ask | edits | auto
  workspace: os.homedir(),
  computerUse: false,
  hideDuringComputerUse: true,
  browser: true, // Chrome-extensie "DawgAgent Browser"

  customInstructions: '',
  connectors: [],
  disabledSkills: [],
  maxSteps: 150,

  autoTodos: false, // laat DawgAgent standaard een takenlijst bijhouden (Taken-paneel)
  secretAgent: false, // DawgSecretAgent-modus: alleen naam + logo veranderen, verder niets
  brain: { auto: true }, // The Brain: na elke beurt zelf herinneringen opschrijven en relevante herinneringen meesturen
  lang: 'auto', // taal van de app: 'auto' = die van de Mac, anders bijv. 'nl' of 'en'
  panelOpen: false, // zijpaneel open bij het starten
  panelTab: 'chat',
  panelWidth: 400,
  panelUrl: 'https://www.google.com', // startpagina van de browser in het zijpaneel
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data, mode) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

// ---------- instellingen ----------
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const KEY_FILE = path.join(DATA_DIR, 'credentials.json');

function getConfig() {
  return { ...DEFAULTS, ...readJson(CONFIG_FILE, {}) };
}

function setConfig(patch) {
  const next = { ...getConfig(), ...patch };
  writeJson(CONFIG_FILE, next);
  return next;
}

// Haalt onzichtbare tekens, spaties, aanhalingstekens en een eventueel "Bearer " weg uit een geplakte sleutel.
function cleanApiKey(apiKey) {
  return String(apiKey || '')
    .replace(/^\s*(authorization:\s*)?bearer\s+/i, '')
    .replace(/[^\x21-\x7E]/g, '')
    .replace(/^["'`]+|["'`]+$/g, '');
}

function getApiKey() {
  return cleanApiKey(readJson(KEY_FILE, {}).apiKey || process.env.DEEPSEEK_API_KEY || '');
}

function setApiKey(apiKey) {
  writeJson(KEY_FILE, { apiKey: cleanApiKey(apiKey) }, 0o600);
  fs.chmodSync(KEY_FILE, 0o600);
}

// ---------- chats ----------
const INDEX_FILE = path.join(PATHS.sessions, 'index.json');
let index = readJson(INDEX_FILE, {});

function saveIndex() {
  writeJson(INDEX_FILE, index);
}

function sessionFile(id) {
  return path.join(PATHS.sessions, `${id}.json`);
}

function filesDir(id) {
  const dir = path.join(PATHS.sessions, id, 'files');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function newSession(workspace) {
  const id = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  return {
    id,
    title: require('./i18n').t('Nieuwe chat'),
    created: Date.now(),
    updated: Date.now(),
    workspace: workspace || getConfig().workspace,
    messages: [],
    todos: [],
    allow: {},
    usage: { input: 0, output: 0, cached: 0, lastPrompt: 0 },
  };
}

function loadSession(id) {
  return readJson(sessionFile(id), null);
}

function saveSession(s) {
  s.updated = Date.now();
  writeJson(sessionFile(s.id), s);
  const rec = { id: s.id, title: s.title, updated: s.updated, workspace: s.workspace, count: s.messages.length };
  if (s.parentId) rec.parentId = s.parentId; // zijchat: hoort bij de chat in het hoofdvenster
  if (s.kind) rec.kind = s.kind; // 'blox' = BloxCode staat aan in deze chat
  if (s.study && s.study !== 'off') rec.study = s.study; // 'study' | 'test' = study-modus in deze chat
  index[s.id] = rec;
  saveIndex();
}

// Zijchats (het chatpaneel naast de chat) blijven uit de gewone chatlijst.
// Zonder kind: alle chats (ook die met BloxCode aan). Met kind: alleen 'chat' of 'blox'.
function listSessions(kind = null) {
  return Object.values(index)
    .filter((s) => s.count > 0 && !s.parentId && (!kind || (s.kind || 'chat') === kind))
    .sort((a, b) => b.updated - a.updated);
}

// De zijchat die bij deze chat hoort (de meest recente), of null.
function latestSide(parentId) {
  return (
    Object.values(index)
      .filter((s) => s.parentId === parentId)
      .sort((a, b) => b.updated - a.updated)[0] || null
  );
}

// Alle zijchats van een chat (bij het verwijderen van die chat).
function sideSessions(parentId) {
  return Object.values(index).filter((s) => s.parentId === parentId).map((s) => s.id);
}

function renameSession(id, title) {
  const s = loadSession(id);
  if (!s) return;
  s.title = title;
  saveSession(s);
}

async function deleteSession(id) {
  const { shell } = require('electron');
  for (const p of [sessionFile(id), path.join(PATHS.sessions, id)]) {
    if (fs.existsSync(p)) await shell.trashItem(p).catch(() => {});
  }
  delete index[id];
  saveIndex();
}

// Lege chats (nooit een bericht verstuurd) van meer dan een uur oud opruimen.
function cleanupEmptySessions() {
  const cutoff = Date.now() - 3600 * 1000;
  for (const s of Object.values(index)) {
    if (s.count > 0 || s.updated > cutoff) continue;
    fs.rmSync(sessionFile(s.id), { force: true });
    fs.rmSync(path.join(PATHS.sessions, s.id), { recursive: true, force: true });
    delete index[s.id];
  }
  saveIndex();
}

module.exports = {
  cleanupEmptySessions,
  PATHS,
  DEFAULTS,
  readJson,
  writeJson,
  getConfig,
  setConfig,
  getApiKey,
  setApiKey,
  cleanApiKey,
  newSession,
  loadSession,
  saveSession,
  listSessions,
  latestSide,
  sideSessions,
  renameSession,
  deleteSession,
  filesDir,
};
