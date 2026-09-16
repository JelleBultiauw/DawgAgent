// The Brain — het tweede geheugen van DawgAgent.
//
// Eén graaf in <userData>/brain/graph.json:
//   nodes: herinneringen (notitie, project, persoon, beslissing, actiepunt, idee, vergadering, bron)
//   links: verbindingen tussen die herinneringen (soms automatisch op gedeelde tags)
//
// De agent schrijft er zelf in via de tools brain_search / brain_read / brain_write /
// brain_link / brain_delete; de gebruiker ziet en bewerkt alles in de zijbalk onder
// "The Brain". Dit bestand levert de opslag, het zoeken, het automatisch verbinden,
// de statistieken en het overzicht dat elke beurt in de systeemprompt meegaat.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS, readJson, writeJson } = require('./store');
const i18n = require('./i18n');

const T = (text) => i18n.t(text);

const DIR = path.join(PATHS.data, 'brain');
const FILE = path.join(DIR, 'graph.json');

const TYPES = ['note', 'project', 'person', 'decision', 'task', 'idea', 'meeting', 'source'];
const MAX_NODES = 5000;
const MAX_CONTENT = 20000;
const MAX_TAGS = 8;
const MAX_TAG_LEN = 28;

// Kleine stopwoordenlijst voor het afleiden van tags en het opschonen van zoekvragen.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'een', 'het', 'van', 'voor', 'met', 'dat', 'die',
  'deze', 'zijn', 'haar', 'wordt', 'worden', 'over', 'naar', 'bij', 'ook', 'maar', 'niet', 'dan', 'nog',
  'wat', 'wie', 'hoe', 'waar', 'als', 'aan', 'uit', 'tot', 'per', 'via', 'heb', 'heeft', 'had', 'kan',
  'kon', 'zal', 'zou', 'weer', 'meer', 'meest', 'door', 'ende', 'alle', 'elke', 'iets', 'alles',
]);

const now = () => Date.now();
const newId = () => `m${now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

function emptyGraph() {
  return { version: 1, updated: null, nodes: [], links: [] };
}

// ---------- opschonen ----------
function cleanText(value, max) {
  const s = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function cleanOneLine(value, max) {
  return cleanText(value, max).replace(/\s+/g, ' ').trim();
}

function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(/[,;]/);
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const tag = cleanOneLine(raw, MAX_TAG_LEN).replace(/^#/, '').toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// Als er geen tags zijn opgegeven: haal er een paar uit de titel ("automatisch taggen").
function autoTags(title, content = '') {
  const words = String(title || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
  const out = [];
  for (const w of words) {
    if (!out.includes(w)) out.push(w);
    if (out.length >= 3) break;
  }
  if (!out.length) {
    const fromContent = String(content || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 5 && !STOP.has(w));
    if (fromContent[0]) out.push(fromContent[0]);
  }
  return out;
}

function cleanType(type) {
  const t = String(type || '').toLowerCase().trim();
  return TYPES.includes(t) ? t : 'note';
}

// ---------- laden / bewaren ----------
function load() {
  const raw = readJson(FILE, null);
  const g = emptyGraph();
  if (!raw || typeof raw !== 'object') return g;
  g.updated = raw.updated || null;
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (!n || typeof n !== 'object' || !n.id || !n.title) continue;
    g.nodes.push({
      id: String(n.id),
      type: cleanType(n.type),
      title: cleanOneLine(n.title, 300),
      content: cleanText(n.content, MAX_CONTENT),
      tags: cleanTags(n.tags),
      pinned: Boolean(n.pinned),
      origin: cleanOneLine(n.origin, 40),
      created: Number(n.created) || now(),
      updated: Number(n.updated) || Number(n.created) || now(),
    });
  }
  const ids = new Set(g.nodes.map((n) => n.id));
  const seen = new Set();
  for (const l of Array.isArray(raw.links) ? raw.links : []) {
    if (!l || !ids.has(l.from) || !ids.has(l.to) || l.from === l.to) continue;
    const key = l.from < l.to ? `${l.from}|${l.to}` : `${l.to}|${l.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    g.links.push({
      from: l.from,
      to: l.to,
      label: cleanOneLine(l.label, 80),
      auto: Boolean(l.auto),
      created: Number(l.created) || now(),
    });
  }
  return g;
}

function save(g) {
  g.version = 1;
  g.updated = new Date().toISOString();
  fs.mkdirSync(DIR, { recursive: true });
  writeJson(FILE, g);
  return g;
}

// ---------- verbindingen ----------
function linkKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function hasLink(g, a, b) {
  const key = linkKey(a, b);
  return g.links.some((l) => linkKey(l.from, l.to) === key);
}

function addLink(g, from, to, label, auto = false) {
  if (!from || !to || from === to) return null;
  const existing = g.links.find((l) => linkKey(l.from, l.to) === linkKey(from, to));
  if (existing) {
    if (label && !existing.label) existing.label = label;
    if (!auto) existing.auto = false;
    return existing;
  }
  const link = { from, to, label: cleanOneLine(label, 80), auto, created: now() };
  g.links.push(link);
  return link;
}

// Verbindt een herinnering met alles wat dezelfde tag draagt (max 4 per tag, nieuwste eerst).
function autoLink(g, node) {
  let added = 0;
  for (const tag of node.tags) {
    const others = g.nodes
      .filter((n) => n.id !== node.id && n.tags.includes(tag))
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 4);
    for (const other of others) {
      if (hasLink(g, node.id, other.id)) continue;
      if (addLink(g, node.id, other.id, tag, true)) added++;
    }
  }
  return added;
}

// ---------- verwijzingen (id of titel) ----------
function findNode(g, ref) {
  const needle = cleanOneLine(ref, 300).toLowerCase();
  if (!needle) return null;
  const byId = g.nodes.find((n) => n.id.toLowerCase() === needle);
  if (byId) return byId;
  const exact = g.nodes.find((n) => n.title.toLowerCase() === needle);
  if (exact) return exact;
  const starts = g.nodes.filter((n) => n.title.toLowerCase().startsWith(needle));
  if (starts.length === 1) return starts[0];
  const contains = g.nodes.filter((n) => n.title.toLowerCase().includes(needle));
  if (contains.length === 1) return contains[0];
  // Laatste redmiddel: het beste zoekresultaat.
  const hit = search(needle, { limit: 1 })[0];
  return hit ? g.nodes.find((n) => n.id === hit.id) || null : null;
}

// ---------- schrijven ----------
function upsert(input = {}) {
  const g = load();
  if (g.nodes.length >= MAX_NODES) throw new Error(T('The Brain is vol (5000 herinneringen). Verwijder eerst iets.'));

  const title = cleanOneLine(input.title, 300);
  if (!title) throw new Error(T('Titel ontbreekt.'));

  let node = input.id ? g.nodes.find((n) => n.id === input.id) : null;
  if (!node) node = g.nodes.find((n) => n.title.toLowerCase() === title.toLowerCase());

  const created = !node;
  if (created) {
    node = {
      id: input.id && String(input.id).startsWith('m') ? String(input.id) : newId(),
      type: cleanType(input.type),
      title,
      content: '',
      tags: [],
      pinned: Boolean(input.pinned),
      origin: cleanOneLine(input.origin, 40) || 'agent',
      created: now(),
      updated: now(),
    };
    g.nodes.push(node);
  }

  if (!created) {
    node.title = title;
    if (input.content !== undefined) node.content = cleanText(input.content, MAX_CONTENT);
    if (input.type !== undefined) node.type = cleanType(input.type);
    if (input.pinned !== undefined) node.pinned = Boolean(input.pinned);
    if (input.origin) node.origin = cleanOneLine(input.origin, 40);
    if (input.tags !== undefined) node.tags = cleanTags(input.tags);
    node.updated = now();
  } else {
    node.content = cleanText(input.content, MAX_CONTENT);
    node.tags = cleanTags(input.tags);
  }

  if (!node.tags.length) node.tags = autoTags(node.title, node.content);

  // Expliciete verbindingen uit de aanroep: [{to, label}] of [{id, label}] of losse titels.
  const notes = [];
  const wanted = Array.isArray(input.links) ? input.links : [];
  for (const item of wanted) {
    const ref = typeof item === 'string' ? item : item?.to || item?.id || item?.title;
    const label = typeof item === 'string' ? '' : item?.label || '';
    const target = ref ? findNode(g, ref) : null;
    if (!target || target.id === node.id) {
      if (ref) notes.push(`Niet gevonden om te koppelen: "${cleanOneLine(ref, 60)}"`);
      continue;
    }
    addLink(g, node.id, target.id, label || 'gerelateerd', false);
  }

  const auto = autoLink(g, node);
  save(g);
  notify({ kind: created ? 'create' : 'update', nodeId: node.id });
  return { node, created, auto, notes };
}

function remove(id) {
  const g = load();
  const node = findNode(g, id);
  if (!node) throw new Error(T('Deze herinnering bestaat niet (meer).'));
  g.nodes = g.nodes.filter((n) => n.id !== node.id);
  g.links = g.links.filter((l) => l.from !== node.id && l.to !== node.id);
  save(g);
  notify({ kind: 'delete', nodeId: node.id });
  return node;
}

function link(fromRef, toRef, label) {
  const g = load();
  const a = findNode(g, fromRef);
  const b = findNode(g, toRef);
  if (!a) throw new Error(T('Eerste herinnering niet gevonden: ') + cleanOneLine(fromRef, 60));
  if (!b) throw new Error(T('Tweede herinnering niet gevonden: ') + cleanOneLine(toRef, 60));
  if (a.id === b.id) throw new Error(T('Een herinnering kan niet aan zichzelf hangen.'));
  const l = addLink(g, a.id, b.id, label || 'gerelateerd', false);
  save(g);
  notify({ kind: 'link', nodeId: a.id, otherId: b.id });
  return { from: a, to: b, link: l };
}

function unlink(fromRef, toRef) {
  const g = load();
  const a = findNode(g, fromRef);
  const b = findNode(g, toRef);
  if (!a || !b) throw new Error(T('Verbinding niet gevonden.'));
  const key = linkKey(a.id, b.id);
  const before = g.links.length;
  g.links = g.links.filter((l) => linkKey(l.from, l.to) !== key);
  if (g.links.length === before) throw new Error(T('Deze verbinding bestaat niet.'));
  save(g);
  notify({ kind: 'unlink', nodeId: a.id, otherId: b.id });
  return { from: a, to: b };
}

// ---------- lezen ----------
function connections(g, id) {
  const out = [];
  for (const l of g.links) {
    if (l.from !== id && l.to !== id) continue;
    const otherId = l.from === id ? l.to : l.from;
    const other = g.nodes.find((n) => n.id === otherId);
    if (other) out.push({ id: other.id, title: other.title, type: other.type, label: l.label, auto: l.auto, direction: l.from === id ? 'out' : 'in' });
  }
  return out;
}

function snippetFor(node, needle) {
  const content = node.content.replace(/\s+/g, ' ').trim();
  if (!content) return '';
  if (!needle) return content.slice(0, 160);
  const at = content.toLowerCase().indexOf(needle);
  if (at < 0) return content.slice(0, 160);
  const start = Math.max(0, at - 60);
  return `${start > 0 ? '…' : ''}${content.slice(start, start + 200)}${start + 200 < content.length ? '…' : ''}`;
}

const tokenize = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP.has(w));

function scoreNode(node, tokens, phrase) {
  const title = node.title.toLowerCase();
  const tags = node.tags.join(' ').toLowerCase();
  const content = node.content.toLowerCase();
  let score = 0;
  if (phrase && phrase.length >= 3 && title.includes(phrase)) score += 6;
  let hits = 0;
  for (const tk of tokens) {
    let s = 0;
    if (title.includes(tk)) s += 3;
    if (tags.includes(tk)) s += 2;
    const occurrences = content.split(tk).length - 1;
    if (occurrences) s += Math.min(occurrences, 3);
    if (s) hits++;
    score += s;
  }
  if (!hits) return 0;
  score += hits === tokens.length ? 2 : 0; // alle woorden gevonden
  if (node.pinned) score += 0.5;
  score += Math.max(0, 0.5 - (now() - node.updated) / (1000 * 60 * 60 * 24 * 180)); // licht voordeel voor recent
  return score;
}

function search(query, { limit = 8, type = null } = {}) {
  const g = load();
  const phrase = cleanOneLine(query, 200).toLowerCase();
  const tokens = tokenize(phrase);
  if (!tokens.length) return [];
  const scored = [];
  for (const node of g.nodes) {
    if (type && node.type !== type) continue;
    const score = scoreNode(node, tokens, phrase);
    if (score > 0) scored.push({ node, score });
  }
  scored.sort((a, b) => b.score - a.score || b.node.updated - a.node.updated);
  return scored.slice(0, Math.max(1, Math.min(Number(limit) || 8, 50))).map(({ node, score }) => ({
    id: node.id,
    title: node.title,
    type: node.type,
    tags: node.tags,
    pinned: node.pinned,
    updated: node.updated,
    score: Math.round(score * 10) / 10,
    snippet: snippetFor(node, tokens.find((tk) => node.content.toLowerCase().includes(tk)) || ''),
  }));
}

function get(id) {
  const g = load();
  const node = findNode(g, id);
  if (!node) throw new Error(T('Deze herinnering bestaat niet (meer).'));
  return { node, connections: connections(g, node.id) };
}

function clipContent(node, max) {
  const copy = { ...node };
  if (copy.content.length > max) copy.content = copy.content.slice(0, max);
  return copy;
}

function stats(g = load()) {
  const byType = {};
  for (const t of TYPES) byType[t] = 0;
  for (const n of g.nodes) byType[n.type] = (byType[n.type] || 0) + 1;
  const tags = new Map();
  for (const n of g.nodes) for (const tag of n.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
  const degrees = {};
  for (const l of g.links) {
    degrees[l.from] = (degrees[l.from] || 0) + 1;
    degrees[l.to] = (degrees[l.to] || 0) + 1;
  }
  let topId = null;
  for (const [id, deg] of Object.entries(degrees)) if (!topId || deg > degrees[topId]) topId = id;
  return {
    nodes: g.nodes.length,
    links: g.links.length,
    types: byType,
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([tag, count]) => ({ tag, count })),
    updated: g.updated,
    daysSince: g.updated ? Math.floor((now() - Date.parse(g.updated)) / 86400000) : null,
    hub: topId ? { id: topId, title: g.nodes.find((n) => n.id === topId)?.title || '', degree: degrees[topId] } : null,
  };
}

function list() {
  const g = load();
  return {
    nodes: g.nodes.map((n) => clipContent(n, 600)),
    links: g.links,
    stats: stats(g),
  };
}

// ---------- overzicht voor de systeemprompt ----------
function promptOverview(maxChars = 2000) {
  const g = load();
  if (!g.nodes.length) {
    return 'The Brain is empty. Write the first memories yourself as soon as you learn something durable about the user or their work (brain_write).';
  }
  const s = stats(g);
  const label = (n) => `[${n.id}] "${n.title}" (${n.type})${n.tags.length ? ` · #${n.tags.join(' #')}` : ''}`;
  const lines = [];
  lines.push(`The Brain holds ${s.nodes} memor${s.nodes === 1 ? 'y' : 'ies'} and ${s.links} connection${s.links === 1 ? '' : 's'}${s.hub ? `; most connected: "${s.hub.title}"` : ''}.`);
  const typeBits = TYPES.filter((t) => s.types[t]).map((t) => `${t} ${s.types[t]}`);
  if (typeBits.length) lines.push(`Types: ${typeBits.join(' · ')}`);
  const pinned = g.nodes.filter((n) => n.pinned).sort((a, b) => b.updated - a.updated).slice(0, 6);
  if (pinned.length) lines.push('Pinned:', ...pinned.map((n) => `- ${label(n)} — ${snippetFor(n, '').slice(0, 120)}`));
  const recent = [...g.nodes].sort((a, b) => b.updated - a.updated).slice(0, 8);
  lines.push('Recently updated:', ...recent.map((n) => `- ${label(n)} — ${snippetFor(n, '').slice(0, 140)}`));
  let text = lines.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}…`;
  return text;
}

// ---------- automatisch onthouden ----------
// Na elke beurt vraagt de app het model om de duurzame dingen uit het gesprek te halen
// (als JSON). Hier wordt dat antwoord streng nagelopen en omgezet in herinneringen.
function parseCapture(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  let body = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1];
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let arr;
  try {
    arr = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const title = cleanOneLine(item.title, 200);
    const content = cleanText(item.content, 4000);
    if (title.length < 3 || !content) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, content, type: cleanType(item.type), tags: cleanTags(item.tags) });
    if (out.length >= 5) break;
  }
  return out;
}

// Schrijft de gevonden herinneringen weg (bestaande titel = bijwerken, geen duplicaat).
function applyCapture(items, origin = 'auto') {
  const created = [];
  const updated = [];
  for (const item of items || []) {
    try {
      const { node, created: isNew } = upsert({ ...item, origin });
      (isNew ? created : updated).push(node);
    } catch {}
  }
  return { created, updated };
}

// ---------- luisteraar (main stuurt er brain:changed mee naar de interface) ----------
let watcher = null;
function setWatcher(fn) {
  watcher = typeof fn === 'function' ? fn : null;
}
function notify(info) {
  try {
    watcher?.(info || {});
  } catch {}
}

module.exports = {
  TYPES,
  DIR,
  FILE,
  load,
  save,
  list,
  get,
  search,
  stats,
  upsert,
  remove,
  link,
  unlink,
  connections,
  promptOverview,
  parseCapture,
  applyCapture,
  setWatcher,
  findNode,
};
