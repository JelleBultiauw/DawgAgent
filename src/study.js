// Study-modus.
//
// Drie taken:
//  1. bronmateriaal (pdf, pptx, docx, spreadsheet, tekst, afbeelding) klaarzetten zodat het
//     in het zijpaneel te bekijken is (diaweergave, tabel, tekstpagina);
//  2. de leerstatus per chat bijhouden in study/state.json: welke bronnen er zijn, welke
//     items (dia's, pagina's, concepten) al gedaan zijn, mastery, due-datums en
//     foutpatronen. Dat bestand is de bron van waarheid voor "nooit iets overslaan";
//  3. die status samenvatten voor de systeemprompt, zodat de agent elke beurt weet wat er
//     nog open staat.
//
// De tutorregels zelf (Socratisch, nooit het antwoord weggeven, pittige vragen op
// examenniveau, uitgestelde toetsing) staan in prompt.js; dit bestand levert de feiten
// en het gereedschap.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const { PATHS, readJson, loadSession } = require('./store');
const i18n = require('./i18n');

const T = (text) => i18n.t(text);

const execFileP = promisify(execFile);

const MODES = ['off', 'study', 'test'];
const STATUSES = ['open', 'bezig', 'geoefend', 'beheerst'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
const DOC_EXT = ['.docx', '.doc', '.rtf', '.odt'];
const SHEET_EXT = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv', '.tsv'];
const TEXT_EXT = ['.md', '.txt', '.json', '.js', '.mjs', '.ts', '.tsx', '.py', '.java', '.c', '.h', '.cpp', '.cs', '.rb', '.go', '.rs', '.php', '.sql', '.sh', '.yml', '.yaml', '.toml', '.ini', '.tex', '.r', '.ipynb'];

// ---------- paden ----------
const studyDir = (sessionId) => path.join(PATHS.sessions, sessionId, 'study');
const statePath = (sessionId) => path.join(studyDir(sessionId), 'state.json');
const panelDir = (sessionId) => path.join(studyDir(sessionId), 'panel');

// ---------- leerstatus ----------
function emptyState() {
  return { version: 1, updated: null, sources: [], concepts: [], misconceptions: [], log: [] };
}

function loadState(sessionId) {
  const raw = readJson(statePath(sessionId), null);
  if (!raw || typeof raw !== 'object') return emptyState();
  const state = { ...emptyState(), ...raw };
  for (const key of ['sources', 'concepts', 'misconceptions', 'log']) if (!Array.isArray(state[key])) state[key] = [];
  return state;
}

function saveState(sessionId, state) {
  state.version = 1;
  state.updated = new Date().toISOString();
  fs.mkdirSync(studyDir(sessionId), { recursive: true });
  const file = statePath(sessionId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
  return state;
}

// Zet een bron in de statuslijst (met per item een dekking-status). Bestaande statussen
// blijven staan; alleen de lijst zelf wordt waar nodig aangevuld.
function registerSource(sessionId, info = {}) {
  const state = loadState(sessionId);
  const abs = info.path ? path.resolve(info.path) : null;
  let src = state.sources.find((s) => (abs && s.path && path.resolve(s.path) === abs) || (info.name && s.name === info.name));
  if (!src) {
    src = { id: `s${state.sources.length + 1}`, name: info.name || path.basename(abs || 'bron'), path: abs, kind: info.kind || null, items: [] };
    state.sources.push(src);
  }
  if (info.url) src.panelUrl = info.url;
  src.kind = info.kind || src.kind || null;
  if (info.outline?.length) {
    const prev = new Map((src.items || []).map((i) => [Number(i.n), i]));
    src.items = info.outline
      .map((o) => {
        const old = prev.get(Number(o.n));
        return { n: Number(o.n), label: o.label || old?.label || '', status: old?.status || 'open' };
      })
      .sort((a, b) => a.n - b.n);
  }
  src.items ||= [];
  saveState(sessionId, state);
  return src;
}

// Study-stand van deze chat (ook als het een zijchat is: dan die van de hoofdchat).
function modeFor(session) {
  if (!session) return 'off';
  if (session.study && session.study !== 'off') return session.study;
  if (session.parentId) {
    const parent = loadSession(session.parentId);
    if (parent?.study && parent.study !== 'off') return parent.study;
  }
  return 'off';
}

// Bij welke chat hoort de leerstatus? Een zijchat deelt die van de hoofdchat,
// zodat dia's en concepten niet in twee lijsten uiteenvallen.
function studySessionId(session) {
  if (!session) return null;
  const s = typeof session === 'string' ? loadSession(session) : session;
  if (!s) return typeof session === 'string' ? session : null;
  if (s.study && s.study !== 'off') return s.id;
  if (s.parentId) {
    const parent = loadSession(s.parentId);
    if (parent?.study && parent.study !== 'off') return parent.id;
  }
  return s.id;
}

// ---------- samenvatting voor de prompt ----------
function compactRanges(numbers) {
  const nums = [...new Set(numbers.map(Number).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    const start = nums[i];
    let end = start;
    while (i + 1 < nums.length && nums[i + 1] === end + 1) end = nums[++i];
    parts.push(start === end ? String(start) : `${start}–${end}`);
  }
  return parts.join(', ');
}

function sourceLines(src) {
  const items = src.items || [];
  const done = items.filter((i) => i.status && i.status !== 'open');
  const mastered = items.filter((i) => i.status === 'beheerst');
  const open = items.filter((i) => !i.status || i.status === 'open').map((i) => i.n);
  const head = `${src.name}${src.kind ? ` (${src.kind})` : ''}`;
  if (!items.length) return `- ${head} — nog geen dekkinglijst; maak die eerst (per dia, pagina of sectie).`;
  return `- ${head} — ${items.length} items · gedaan ${done.length}/${items.length} · beheerst ${mastered.length}${open.length ? ` · NOG OPEN: ${compactRanges(open)}` : ' · alles minstens één keer gedaan'}`;
}

function stateSummary(state, { today = new Date() } = {}) {
  const lines = [];
  lines.push(state.sources.length ? `Bronnen en dekking:\n${state.sources.map(sourceLines).join('\n')}` : 'Bronnen: nog niets geregistreerd.');
  const concepts = (state.concepts || []).filter((c) => c && c.name);
  if (concepts.length) {
    const day = (d) => String(d || '').slice(0, 10);
    const iso = today.toISOString().slice(0, 10);
    lines.push(
      `Concepten (${concepts.length}):\n${concepts
        .slice(0, 60)
        .map((c) => `- ${c.name} — mastery ${c.mastery ?? '?'}${c.due ? ` · due ${day(c.due)}` : ''}${c.reps ? ` · ${c.reps}× herhaald` : ''}${c.lapses ? ` · ${c.lapses}× fout` : ''}`)
        .join('\n')}`,
    );
    const due = concepts.filter((c) => c.due && day(c.due) <= iso);
    if (due.length) lines.push(`Achterstallig — eerst ophalen zonder aantekeningen: ${due.map((c) => c.name).join(', ')}`);
  }
  const mis = (state.misconceptions || []).filter((m) => m && (m.concept || m.pattern));
  if (mis.length) {
    lines.push(
      `Foutpatronen (hier moet je op doorvragen):\n${mis
        .slice(0, 25)
        .map((m) => `- ${m.pattern || m.concept}${m.count ? ` (${m.count}× gezien)` : ''}${m.concept ? ` — concept: ${m.concept}` : ''}`)
        .join('\n')}`,
    );
  }
  return lines.join('\n\n');
}

function promptState(session) {
  const id = studySessionId(session) || session?.id;
  const text = stateSummary(loadState(id));
  return text.length > 7000 ? `${text.slice(0, 7000)}\n… (status is groter; lees ${statePath(id)} zelf voor de rest)` : text;
}

// ---------- status bijwerken (tool study_state) ----------
function applyStatePatch(sessionOrId, patch = {}) {
  const sessionId = typeof sessionOrId === 'string' ? studySessionId(sessionOrId) || sessionOrId : studySessionId(sessionOrId);
  const state = loadState(sessionId);
  const notes = [];
  const findSource = (ref = {}) =>
    state.sources.find((s) => (ref.source && s.name === ref.source) || (ref.path && s.path && path.resolve(s.path) === path.resolve(ref.path))) || null;

  for (const src of patch.sources || []) {
    if (!src || (!src.name && !src.path)) continue;
    let found = findSource(src);
    if (!found) {
      found = { id: `s${state.sources.length + 1}`, name: src.name || path.basename(src.path), path: src.path ? path.resolve(src.path) : null, kind: src.kind || null, panelUrl: src.url || null, items: [] };
      state.sources.push(found);
      notes.push(`bron "${found.name}" toegevoegd`);
    } else {
      if (src.url) found.panelUrl = src.url;
      if (src.kind) found.kind = src.kind;
      notes.push(`bron "${found.name}" bijgewerkt`);
    }
  }

  for (const cov of patch.coverage || []) {
    if (!cov) continue;
    const src = findSource({ ...cov, path: cov.sourcePath }) || state.sources[0];
    if (!src) {
      notes.push('dekking overgeslagen: er is nog geen bron bekend');
      continue;
    }
    const byN = new Map((src.items || []).map((i) => [Number(i.n), i]));
    const put = (n, status, label) => {
      const num = Number(n);
      if (!Number.isFinite(num)) return;
      const prev = byN.get(num) || { n: num, label: '', status: 'open' };
      byN.set(num, { ...prev, status, label: label ? String(label).slice(0, 120) : prev.label || '' });
    };
    for (const raw of cov.items || []) put(raw?.n ?? raw?.item, STATUSES.includes(raw?.status) ? raw.status : 'open', raw?.label);
    for (const [key, status] of [['done', 'geoefend'], ['gedaan', 'geoefend'], ['bezig', 'bezig'], ['open', 'open'], ['mastered', 'beheerst'], ['beheerst', 'beheerst']]) {
      for (const n of cov[key] || []) put(n, status);
    }
    if (!byN.size) continue;
    src.items = [...byN.values()].sort((a, b) => a.n - b.n);
    const counts = src.items.reduce((acc, i) => ((acc[i.status] = (acc[i.status] || 0) + 1), acc), {});
    const open = src.items.filter((i) => i.status === 'open').map((i) => i.n);
    notes.push(`dekking "${src.name}": ${src.items.length} items (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})${open.length ? ` · nog open: ${compactRanges(open)}` : ''}`);
  }

  for (const c of patch.concepts || []) {
    if (!c || !c.name) continue;
    let found = state.concepts.find((x) => String(x.name).toLowerCase() === String(c.name).toLowerCase());
    if (!found) {
      found = { name: String(c.name) };
      state.concepts.push(found);
    }
    for (const key of ['mastery', 'due', 'reps', 'lapses', 'prereqs', 'note']) if (c[key] != null) found[key] = c[key];
    notes.push(`concept "${found.name}": mastery ${found.mastery ?? '?'}${found.due ? ` · due ${String(found.due).slice(0, 10)}` : ''}`);
  }

  for (const m of patch.misconceptions || []) {
    if (!m || (!m.pattern && !m.concept)) continue;
    const found = state.misconceptions.find((x) => x.pattern === m.pattern && x.concept === m.concept);
    if (found) {
      found.count = (found.count || 1) + (m.count != null ? Number(m.count) : 1);
      found.last_seen = new Date().toISOString();
    } else {
      state.misconceptions.push({ concept: m.concept || null, pattern: String(m.pattern || m.concept), count: Number(m.count) || 1, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() });
    }
    notes.push(`foutpatroon genoteerd: ${m.pattern || m.concept}`);
  }

  if (patch.note) {
    state.log.push({ ts: new Date().toISOString(), note: String(patch.note).slice(0, 500) });
    if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
  }

  saveState(sessionId, state);
  return { state, notes };
}

// ---------- welk bestand kan in het paneel? ----------
function viewKind(file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (ext === '.pptx') return 'slides';
  if (ext === '.ppt') return 'ppt-legacy';
  if (DOC_EXT.includes(ext)) return 'doc';
  if (SHEET_EXT.includes(ext)) return 'sheet';
  if (ext === '.html' || ext === '.htm') return 'page';
  if (TEXT_EXT.includes(ext)) return 'text';
  return null;
}

const isViewable = (file) => Boolean(viewKind(file));

// ---------- pptx uitlezen ----------
function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function parasOf(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const body = m[1];
    const lvl = Math.min(Number((body.match(/<a:pPr[^>]*\blvl="(\d+)"/) || [])[1] || 0) || 0, 5);
    // a:t = gewone tekst, m:t = formuletekst (OMML); samen houden we de leesorde aan.
    const text = [...body.matchAll(/<(?:a|m):t>([\s\S]*?)<\/(?:a|m):t>/g)].map((x) => unescapeXml(x[1])).join('').replace(/\s+/g, ' ').trim();
    if (text) out.push({ lvl, text });
  }
  return out;
}

// Een dia met alleen het dianummer in de titel-placeholder levert anders "2" als titel op.
const isPageNumber = (text, n) => /^\d{1,3}$/.test(String(text || '').trim()) && Number(text) === Number(n);

function relsOf(xml) {
  const map = {};
  for (const m of String(xml).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/\bId="([^"]+)"/) || [])[1];
    const target = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
    const type = (m[0].match(/\bType="([^"]+)"/) || [])[1] || '';
    if (id && target) map[id] = { target, type, external: /\bTargetMode="External"/i.test(m[0]) };
  }
  return map;
}

function resolveTarget(rootDir, baseDir, target) {
  const t = String(target || '');
  if (!t || /^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null;
  return path.normalize(t.startsWith('/') ? path.join(rootDir, t) : path.join(baseDir, t));
}

function titleOfSlide(xml) {
  const shapes = [...String(xml).matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map((m) => m[1]);
  for (const shape of shapes) {
    const ph = (shape.match(/<p:ph\b[^>]*\btype="([^"]+)"/) || [])[1] || '';
    if (ph === 'title' || ph === 'ctrTitle') return parasOf(shape)[0]?.text || '';
  }
  // Decks zonder echte titel-placeholder: een los tekstvak bovenaan met korte tekst
  // geldt als titel (dianummer-placeholders en body-placeholders juist niet).
  for (const shape of shapes) {
    if (/<p:ph\b/.test(shape)) continue;
    const text = parasOf(shape)[0]?.text || '';
    if (text && text.length <= 120) return text;
    if (text) return '';
    break;
  }
  return '';
}

// Leest een pptx volledig uit. mediaOutDir: map waarin afbeeldingen worden geplaatst
// (voor de paneelweergave). Zonder die map krijg je alleen tekst.
function parsePptx(file, { mediaOutDir = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orka-pptx-'));
  try {
    execFileSync('unzip', ['-o', '-q', file, '-d', tmp], { timeout: 180000, maxBuffer: 128 * 1024 * 1024 });
    const read = (p) => {
      try {
        return fs.readFileSync(path.join(tmp, p), 'utf8');
      } catch {
        return '';
      }
    };
    const has = (p) => p && fs.existsSync(p) && fs.statSync(p).isFile();

    // Dia's in de volgorde van de presentatie.
    const presRels = relsOf(read('ppt/_rels/presentation.xml.rels'));
    const presentation = read('ppt/presentation.xml');
    let order = [...presentation.matchAll(/<p:sldId\b[^>]*?r:id="([^"]+)"/g)]
      .map((m) => resolveTarget(tmp, path.join(tmp, 'ppt'), presRels[m[1]]?.target))
      .filter(has);
    if (!order.length) {
      const dir = path.join(tmp, 'ppt/slides');
      order = fs
        .readdirSync(dir)
        .filter((f) => /^slide\d+\.xml$/.test(f))
        .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
        .map((f) => path.join(dir, f));
    }

    const mediaDir = mediaOutDir ? path.join(mediaOutDir, 'media') : null;
    if (mediaDir) fs.mkdirSync(mediaDir, { recursive: true });
    let mediaCount = 0;

    const slides = order.map((slideFile, index) => {
      const slideRel = path.relative(tmp, slideFile);
      const n = index + 1;
      const xml = fs.readFileSync(slideFile, 'utf8');
      const slideRels = relsOf(read(path.join(path.dirname(slideRel), '_rels', `${path.basename(slideRel)}.rels`)));
      let title = titleOfSlide(xml);
      if (isPageNumber(title, n)) title = '';
      const allParas = parasOf(xml);
      // De titel staat in de dia zelf ook als alinea; die halen we er één keer uit.
      let dropped = false;
      const withoutTitle = allParas.filter((p) => {
        if (!dropped && title && p.text === title) {
          dropped = true;
          return false;
        }
        return true;
      });
      const paras = withoutTitle.filter((p) => !isPageNumber(p.text, n));

      // Afbeeldingen in leesorde (r:embed/r:link in de dia-XML).
      const images = [];
      const unrenderable = [];
      const seen = new Set();
      for (const m of xml.matchAll(/r:(?:embed|link)="([^"]+)"/g)) {
        const r = slideRels[m[1]];
        if (!r || r.external) continue;
        const abs = resolveTarget(tmp, path.join(tmp, path.dirname(slideRel)), r.target);
        if (!has(abs) || seen.has(abs)) continue;
        seen.add(abs);
        const name = path.basename(abs);
        const ext = path.extname(abs).toLowerCase();
        if (mediaDir && IMAGE_EXT.includes(ext)) {
          mediaCount += 1;
          const outName = `${String(index + 1).padStart(3, '0')}-${mediaCount}-${name.replace(/[^\w.\-]+/g, '_')}`;
          try {
            fs.copyFileSync(abs, path.join(mediaDir, outName));
            images.push({ name, src: `media/${outName}` });
          } catch {}
        } else {
          const label = ext === '.emf' || ext === '.wmf' ? 'formule of diagram in Windows-formaat (wmf/emf) — niet weer te geven in het paneel' : 'niet weer te geven';
          images.push({ name, src: null, note: label });
          unrenderable.push({ name, note: label });
        }
      }

      // Notities onder de dia.
      let notes = [];
      const notesRel = Object.values(slideRels).find((r) => /\/notesSlide$/.test(r.type || ''));
      if (notesRel) {
        const notesFile = resolveTarget(tmp, path.join(tmp, path.dirname(slideRel)), notesRel.target);
        if (has(notesFile)) notes = parasOf(fs.readFileSync(notesFile, 'utf8')).map((p) => p.text).filter((t) => !/^\d+$/.test(t));
      }

      return { n, title: title || '', label: title || paras[0]?.text || '', paras, images, notes, unrenderable };
    });

    return { slides, media: mediaCount, unrenderable: slides.reduce((acc, s) => acc + s.unrenderable.length, 0) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function pptxOutline(parsed) {
  return parsed.slides.map((s) => ({ n: s.n, label: String(s.label || s.title || s.paras[0]?.text || '').slice(0, 90) }));
}

function pptxText(parsed) {
  const parts = [];
  for (const s of parsed.slides) {
    parts.push(`## Dia ${s.n}${s.title ? ` — ${s.title}` : ''}`);
    for (const p of s.paras) parts.push(`${'  '.repeat(p.lvl)}- ${p.text}`);
    if (s.notes.length) parts.push(`  Notities: ${s.notes.join(' ')}`);
    if (!s.paras.length && !s.notes.length) parts.push('  (geen tekst op deze dia — afbeelding of diagram)');
    for (const im of s.images) parts.push(`  [afbeelding: ${im.name}${im.note ? ` (${im.note})` : ''}]`);
  }
  return parts.join('\n');
}

// Volledige tekst van een presentatie (voor de bijlagen bij het bericht).
function slidesText(file) {
  return pptxText(parsePptx(file));
}

// ---------- pagina's voor het paneel ----------
const PAGE_CSS = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0 0 60px; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; background: #f5f5f4; color: #1c1c1b; }
.toolbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: rgba(245,245,244,.93); backdrop-filter: blur(12px); border-bottom: 1px solid #e2e2df; }
.toolbar b { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toolbar .meta { color: #6b6b68; font-size: 12px; white-space: nowrap; }
.toolbar .hint { margin-left: auto; color: #8a8a86; font-size: 11px; text-align: right; min-width: 0; }
.jump { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 14px 0; }
.jump a { display: inline-block; min-width: 26px; text-align: center; padding: 2px 6px; border: 1px solid #dcdcd8; border-radius: 6px; font-size: 11px; color: #43423f; text-decoration: none; background: #fff; }
.jump a:hover { border-color: #b9b9b4; }
main { padding: 14px; display: flex; flex-direction: column; gap: 14px; }
.slide, .sheet { background: #fff; border: 1px solid #e6e6e2; border-radius: 12px; padding: 16px 18px; scroll-margin-top: 76px; box-shadow: 0 1px 2px rgba(0,0,0,.03); }
.slide .head { display: flex; gap: 10px; align-items: baseline; }
.slide .num { flex: none; font-size: 11px; font-weight: 700; color: #fff; background: #5a5a56; border-radius: 999px; padding: 2px 7px; }
.slide h2, .sheet h2 { font-size: 16px; margin: 0 0 4px; }
.slide ul { margin: 10px 0 0; padding-left: 18px; }
.slide li { margin: 3px 0 3px calc(var(--lvl, 0) * 14px); }
.slide li[style*="--lvl:1"] { list-style: circle; }
.slide li[style*="--lvl:2"], .slide li[style*="--lvl:3"] { list-style: square; }
.slide figure { margin: 12px 0 0; }
.slide img { max-width: 100%; border: 1px solid #e6e6e2; border-radius: 8px; background: #fff; }
.slide figcaption { font-size: 11px; color: #8a8a86; margin-top: 4px; }
.slide .empty { color: #8a8a86; font-style: italic; margin: 8px 0 0; }
.notes { margin-top: 12px; border-top: 1px dashed #e2e2df; padding-top: 8px; }
.notes summary { cursor: pointer; font-size: 12px; color: #6b6b68; }
.notes p { margin: 6px 0; font-size: 13px; color: #43423f; }
table { border-collapse: collapse; font-size: 13px; }
td, th { border: 1px solid #e6e6e2; padding: 3px 7px; white-space: nowrap; }
pre { white-space: pre-wrap; word-break: break-word; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.warn { margin: 0 0 4px; padding: 9px 12px; border: 1px solid #e8d9a8; background: #fdf7e3; border-radius: 10px; font-size: 12px; color: #6b5a1e; }
@media (prefers-color-scheme: dark) {
  body { background: #1a1a19; color: #ececea; }
  .toolbar { background: rgba(26,26,25,.93); border-bottom-color: #33332f; }
  .slide, .sheet { background: #232322; border-color: #35352f; }
  .slide .num { background: #6b6b66; }
  .jump a { background: #232322; border-color: #3a3a35; color: #d6d6d2; }
  td, th { border-color: #3a3a35; }
  .notes { border-top-color: #33332f; }
  .warn { background: #33301f; border-color: #4d472c; color: #e2d6a8; }
}`;

function pageHtml({ title, meta, hint, body, jump = '' }) {
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head>
<body>
<div class="toolbar"><b>${escapeHtml(title)}</b><span class="meta">${escapeHtml(meta)}</span><span class="hint">${escapeHtml(hint)}</span></div>
${jump}
<main>${body}</main>
</body></html>`;
}

function slidesPageHtml(parsed, { title }) {
  const body = parsed.slides
    .map((s) => {
      const items = s.paras.map((p) => `<li style="--lvl:${p.lvl}">${escapeHtml(p.text)}</li>`).join('');
      const imgs = s.images
        .map((im) => (im.src ? `<figure><img src="${im.src}" alt=""><figcaption>${escapeHtml(im.name)}</figcaption></figure>` : `<p class="empty">[${escapeHtml(im.name)} — ${escapeHtml(im.note || 'niet weer te geven')}]</p>`))
        .join('');
      const notes = s.notes.length ? `<details class="notes"><summary>${T('Notities')} (${s.notes.length})</summary>${s.notes.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}</details>` : '';
      const empty = !s.paras.length && !s.images.length && !s.title ? `<p class="empty">${T('Geen tekst op deze dia.')}</p>` : '';
      return `<section class="slide" id="s${s.n}">
  <div class="head"><span class="num">${s.n}</span><h2>${escapeHtml(s.title || '')}</h2></div>
  ${items ? `<ul>${items}</ul>` : ''}${empty}${imgs}${notes}
</section>`;
    })
    .join('\n');
  const jump = `<nav class="jump">${parsed.slides.map((s) => `<a href="#s${s.n}" title="${escapeHtml(s.title || '')}">${s.n}</a>`).join('')}</nav>`;
  const warn = parsed.unrenderable
    ? `<p class="warn">${T('Let op:')} ${parsed.unrenderable} ${T("formule(s) of diagram(men) staan als wmf/emf en zijn hier niet zichtbaar. Vraag DawgAgent het deck als pdf te openen (via PowerPoint) voor de volledige weergave.")}</p>`
    : '';
  return pageHtml({ title, meta: `${parsed.slides.length} ${T("dia's")}`, hint: T('Study telt deze dia’s als dekking — niets wordt overgeslagen'), jump, body: `${warn}${body}` });
}

function sheetPageHtml(sheets, { title }) {
  const body = sheets.map(({ name, html }) => `<section class="sheet"><h2>${escapeHtml(name)}</h2>${html}</section>`).join('\n');
  return pageHtml({ title, meta: `${sheets.length} ${T('tabblad(en)')}`, hint: T('Study gebruikt deze tabel als bron'), body });
}

function textPageHtml(text, { title, meta }) {
  return pageHtml({ title, meta, hint: T('Study gebruikt dit bestand als bron'), body: `<section class="sheet"><pre>${escapeHtml(text)}</pre></section>` });
}

// ---------- pdf-info (pagina-aantal + eerste regel per pagina) ----------
async function pdfInfo(file) {
  const script =
    "ObjC.import('PDFKit'); function run(argv){ var d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0])); if(!d||d.isNil()) return '{}'; var out=[]; var n=Math.min(d.pageCount,1500); for(var i=0;i<n;i++){ var pg=d.pageAtIndex(i); var s=pg.string; var t=(s&&!s.isNil())?s.js.replace(/\\s+/g,' ').trim().slice(0,70):''; out.push(t);} return JSON.stringify({pages:d.pageCount, labels:out}); }";
  const { stdout } = await execFileP('osascript', ['-l', 'JavaScript', '-e', script, file], { timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(stdout.trim() || '{}');
  return { pages: Number(parsed.pages) || 0, labels: Array.isArray(parsed.labels) ? parsed.labels : [] };
}

// ---------- pptx → pdf via PowerPoint (voor decks met formules/diagrammen) ----------
function hasPowerpoint() {
  return fs.existsSync('/Applications/Microsoft PowerPoint.app');
}

// De app laat de gebruiker weten dat er even iets gebeurt (main geeft de functie door).
let notifyToast = () => {};
function init(fn) {
  if (typeof fn === 'function') notifyToast = fn;
}

async function pptxToPdf(file, outDir) {
  if (!hasPowerpoint()) return { error: 'Microsoft PowerPoint staat niet in /Applications.' };
  fs.mkdirSync(outDir, { recursive: true });
  const stat = fs.statSync(file);
  const hash = crypto.createHash('sha1').update(`${file}|${stat.size}|${Math.round(stat.mtimeMs)}`).digest('hex').slice(0, 8);
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const out = path.join(outDir, `${base}-${hash}.pdf`);
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) return { pdf: out, cached: true };

  // PowerPoint is een sandbox-app: hij mag alleen schrijven in mappen waar hij al toegang
  // toe heeft (de map van het bestand zelf) en niet in onze datamap. Daarom exporteren we
  // naast het origineel en verplaatsen we het pdf-bestand daarna naar de study-map.
  const attempts = [path.join(path.dirname(file), `.dawgagent-${hash}.pdf`), path.join(os.tmpdir(), `dawgagent-${hash}.pdf`)];
  notifyToast(`PowerPoint zet "${path.basename(file)}" even om naar pdf — dat duurt ongeveer een halve minuut.`);

  // PowerPoint's `open` geeft het document niet terug; via "active presentation" werkt het wel.
  const script = `on run argv
  set inPath to item 1 of argv
  set outPath to item 2 of argv
  tell application "Microsoft PowerPoint"
    activate
    open POSIX file inPath
    repeat 60 times
      if (count of presentations) > 0 then exit repeat
      delay 1
    end repeat
    delay 3
    set pres to active presentation
    save pres in POSIX file outPath as save as PDF
    close pres saving no
  end tell
  return "ok"
end run`;

  let lastError = null;
  for (const tmpPdf of attempts) {
    try {
      fs.rmSync(tmpPdf, { force: true });
      await execFileP('osascript', ['-e', script, file, tmpPdf], { timeout: 240000, maxBuffer: 32 * 1024 * 1024 });
      if (!fs.existsSync(tmpPdf) || fs.statSync(tmpPdf).size < 1000) {
        lastError = 'PowerPoint maakte geen pdf-bestand.';
        continue;
      }
      try {
        fs.renameSync(tmpPdf, out);
      } catch {
        fs.copyFileSync(tmpPdf, out);
        fs.rmSync(tmpPdf, { force: true });
      }
      return { pdf: out };
    } catch (e) {
      lastError = `PowerPoint-export mislukt: ${String(e.message || e).slice(0, 200)}`;
      fs.rmSync(tmpPdf, { force: true });
    }
  }
  return { error: lastError || 'PowerPoint-export mislukt.' };
}

// ---------- bron klaarzetten voor het paneel ----------
// presentaties: standaard de échte dia's (via PowerPoint → pdf, daarna uit de cache);
// html:true geeft de snelle tekstweergave in plaats daarvan — alleen als terugval of
// als de gebruiker expliciet om tekst vraagt.
async function documentUrl(sessionId, file, { pdf = false, html = false } = {}) {
  const kind = viewKind(file);
  if (!kind) return null;
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) return null;
  const title = path.basename(abs);

  if (kind === 'slides' || kind === 'ppt-legacy') {
    if (!html) {
      const outDir = path.join(panelDir(sessionId), 'pdf');
      const res = await pptxToPdf(abs, outDir);
      if (res.pdf) {
        let outline = null;
        let pages = null;
        if (kind === 'slides') {
          try {
            const parsed = parsePptx(abs);
            outline = pptxOutline(parsed);
            pages = parsed.slides.length;
          } catch {}
        }
        if (!pages || !outline) {
          try {
            const info = await pdfInfo(res.pdf);
            pages = pages || info.pages;
            if (!outline) outline = info.labels.map((label, i) => ({ n: i + 1, label }));
          } catch {}
        }
        return {
          url: pathToFileURL(res.pdf).href,
          kind: 'pdf',
          title,
          path: res.pdf,
          sourcePath: abs,
          outline,
          pages,
          real: true,
          note: res.cached ? null : 'De echte dia’s zijn via PowerPoint als pdf klaargezet.',
        };
      }
      // Exporteren lukte niet (geen PowerPoint, of het bestand laat zich niet openen):
      // dan de tekstweergave, met de reden erbij.
      const fallback = await documentUrl(sessionId, file, { html: true });
      return fallback ? { ...fallback, warning: `${res.error} De dia’s zijn daarom als tekst weergegeven.` } : null;
    }
    if (kind === 'ppt-legacy') {
      return {
        kind,
        title,
        path: abs,
        unsupported: 'Dit is het oude .ppt-formaat en PowerPoint kon het niet openen. Exporteer het zelf naar .pptx of pdf en sleep het opnieuw in deze chat.',
      };
    }
  }
  if (kind === 'pdf' || kind === 'image' || kind === 'page') return { url: pathToFileURL(abs).href, kind, title, path: abs };

  const stat = fs.statSync(abs);
  const hash = crypto.createHash('sha1').update(`${abs}|${stat.size}|${Math.round(stat.mtimeMs)}`).digest('hex').slice(0, 8);
  const slug = title.replace(/[^\w.\-]+/g, '_').slice(0, 48);
  const outDir = path.join(panelDir(sessionId), `${slug}-${hash}`);
  const index = path.join(outDir, 'index.html');
  const metaFile = path.join(outDir, 'meta.json');

  if (fs.existsSync(index)) {
    const meta = readJson(metaFile, {});
    return { url: pathToFileURL(index).href, kind, title, path: abs, outline: meta.outline || null, pages: meta.pages || null, unrenderable: meta.unrenderable || 0, cached: true };
  }

  fs.mkdirSync(outDir, { recursive: true });
  // Oude versies van hetzelfde bestand (andere hash) opruimen, anders groeit de map.
  try {
    for (const name of fs.readdirSync(panelDir(sessionId))) {
      if (name.startsWith(`${slug}-`) && name !== path.basename(outDir)) fs.rmSync(path.join(panelDir(sessionId), name), { recursive: true, force: true });
    }
  } catch {}
  let meta = {};
  try {
    if (kind === 'slides') {
      const parsed = parsePptx(abs, { mediaOutDir: outDir });
      fs.writeFileSync(index, slidesPageHtml(parsed, { title }));
      meta = { outline: pptxOutline(parsed), pages: parsed.slides.length, unrenderable: parsed.unrenderable };
    } else if (kind === 'sheet') {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(abs, { cellDates: true });
      const sheets = wb.SheetNames.map((name) => ({ name, html: XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false }) }));
      fs.writeFileSync(index, sheetPageHtml(sheets, { title }));
      meta = { pages: sheets.length };
    } else if (kind === 'doc') {
      let text = '';
      try {
        const { stdout } = await execFileP('textutil', ['-convert', 'txt', '-stdout', abs], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
        text = stdout.trim();
      } catch (e) {
        text = `(${T('Kon dit document niet lezen:')} ${e.message})`;
      }
      fs.writeFileSync(index, textPageHtml(text || T('(leeg document)'), { title, meta: T('document') }));
    } else {
      const text = fs.readFileSync(abs, 'utf8').slice(0, 400000);
      fs.writeFileSync(index, textPageHtml(text, { title, meta: T('tekstbestand') }));
    }
  } catch (e) {
    return { kind, title, path: abs, unsupported: `Kon "${title}" niet omzetten voor het paneel: ${String(e.message || e).slice(0, 200)}` };
  }
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  return { url: pathToFileURL(index).href, kind, title, path: abs, outline: meta.outline || null, pages: meta.pages || null, unrenderable: meta.unrenderable || 0 };
}

// Het bestand in het paneel openen en als bron in de leerstatus zetten.
async function openInPanel({ sessionId, file, slide = null, pdf = false, html = false, panelRun, register = true }) {
  if (!sessionId || !file) return null;
  const doc = await documentUrl(sessionId, file, { pdf, html });
  if (!doc || doc.unsupported) return doc;

  const url = slide ? `${doc.url}${doc.kind === 'pdf' ? `#page=${Number(slide)}` : `#s${Number(slide)}`}` : doc.url;
  const res = panelRun ? await panelRun('navigate', { url }) : null;

  if (!register) return { ...doc, error: res?.error || null };
  let outline = doc.outline;
  if (!outline && doc.kind === 'pdf') {
    const target = doc.sourcePath || doc.path;
    try {
      const info = await pdfInfo(target);
      if (info.pages) {
        doc.pages = info.pages;
        outline = info.labels.map((label, i) => ({ n: i + 1, label }));
      }
    } catch {}
  }
  const source = registerSource(sessionId, { name: doc.sourcePath ? path.basename(doc.sourcePath) : doc.title, path: doc.sourcePath || doc.path, kind: doc.kind, url: doc.url, outline });
  return { ...doc, source, error: res?.error || null, state: statePath(sessionId) };
}

// Het nieuwste bekijkbare document uit de chat (voor als Study net wordt aangezet).
function latestDocument(session) {
  const pick = (filter) => {
    for (const m of [...(session?.messages || [])].reverse()) {
      for (const a of [...(m._attachments || [])].reverse()) if (a?.path && filter(a)) return a.path;
    }
    return null;
  };
  return pick((a) => isViewable(a.path) && a.kind !== 'image') || pick((a) => isViewable(a.path));
}

module.exports = {
  MODES,
  STATUSES,
  modeFor,
  studySessionId,
  init,
  statePath,
  studyDir,
  panelDir,
  loadState,
  saveState,
  registerSource,
  applyStatePatch,
  stateSummary,
  promptState,
  viewKind,
  isViewable,
  documentUrl,
  openInPanel,
  latestDocument,
  parsePptx,
  pptxText,
  pptxOutline,
  slidesText,
  pdfInfo,
  pptxToPdf,
  hasPowerpoint,
  compactRanges,
};
