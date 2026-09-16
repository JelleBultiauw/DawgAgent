import { marked } from '../node_modules/marked/lib/marked.esm.js';
import DOMPurify from '../node_modules/dompurify/dist/purify.es.mjs';
import hljs from './vendor/highlight.js';
import { createBlox, BLOX_ICONS, BLOX_TOOL_META } from './bloxui.js';
import { createGit } from './gitui.js';
import { createBrain, BRAIN_ICONS } from './brainui.js';
import { t, dateLocale } from './i18n.js';

const api = window.orka;

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  sparkles:
    '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  settings:
    '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  sheet: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2Z"/>',
  list: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  pointer: '<path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>',
  keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  wave: '<path d="M2 14c2.5 0 3.5-3.5 6.5-3.5S12 14 14.5 14 18 10.5 21.5 10.5"/><path d="M5 18.5c1.5 0 2.5-1.5 4.5-1.5s3 1.5 4.5 1.5 3-1.5 4.5-1.5"/><circle cx="16" cy="6" r="1.3" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  git: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  github:
    '<path fill="currentColor" stroke="none" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
};
Object.assign(ICONS, BLOX_ICONS, BRAIN_ICONS);

function icon(name, size = 16) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

// Het app-logo: de DawgAgent-hond (assets/logo.png) met de oude robot als terugval.
function appLogo(size = 52) {
  const img = document.createElement('img');
  img.className = 'app-logo';
  img.src = appLogoFile();
  img.alt = 'DawgAgent';
  img.style.width = `${size}px`;
  img.style.height = `${size}px`;
  img.addEventListener('error', () => img.replaceWith(robotArt(size)), { once: true });
  return img;
}

function robotArt(size = 34) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <circle cx="32" cy="8.5" r="4.2" fill="#ffd166"/>
    <path d="M32 12.5v6" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>
    <rect x="4" y="29" width="7" height="13" rx="3.5" fill="#fff"/>
    <rect x="53" y="29" width="7" height="13" rx="3.5" fill="#fff"/>
    <rect x="10" y="18.5" width="44" height="37" rx="13" fill="#fff"/>
    <circle cx="24" cy="33.5" r="4.8" fill="#16244f"/>
    <circle cx="40" cy="33.5" r="4.8" fill="#16244f"/>
    <circle cx="25.6" cy="31.9" r="1.6" fill="#fff"/>
    <circle cx="41.6" cy="31.9" r="1.6" fill="#fff"/>
    <path d="M24.5 43.5c2.4 3.2 12.6 3.2 15 0" stroke="#16244f" stroke-width="3.4" stroke-linecap="round" fill="none"/>
  </svg>`;
  return span;
}

async function call(channel, ...args) {
  try {
    return await api.invoke(channel, ...args);
  } catch (e) {
    throw new Error(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fileUrl = (p) => `file://${String(p).split('/').map(encodeURIComponent).join('/')}`;
const basename = (p) => String(p).split('/').filter(Boolean).pop() || p;
const clipText = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}\n…` : String(s));
function shortPath(p) {
  if (!p) return '';
  const home = state.info?.home;
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}
function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));

let toastTimer;
function toast(text, kind = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === 'error' ? 6000 : 2600);
}

// ---------- markdown ----------
let fastCode = false;
marked.use({
  gfm: true,
  renderer: {
    code(token) {
      const lang = (token.lang || '').split(/\s/)[0];
      let html;
      try {
        if (fastCode) html = escapeHtml(token.text);
        else if (lang && hljs.getLanguage(lang)) html = hljs.highlight(token.text, { language: lang }).value;
        else html = token.text.length < 20000 ? hljs.highlightAuto(token.text).value : escapeHtml(token.text);
      } catch {
        html = escapeHtml(token.text);
      }
      return `<div class="codeblock"><div class="codebar"><span>${escapeHtml(lang || 'code')}</span><button class="copy" data-copy>Kopieer</button></div><pre><code class="hljs">${html}</code></pre></div>`;
    },
  },
});
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener');
  }
});
const md = (text) => DOMPurify.sanitize(marked.parse(text || ''), { ADD_ATTR: ['target', 'data-copy'] });

// ---------- paden in berichten → knop naar de Finder ----------
// Elke map of bestand die in een bericht genoemd wordt (zoals `~/Downloads/gen`)
// wordt een knopje dat de Finder op die plek opent.
const PATH_RE = /(?<![\w/:@.-])(?:~\/|\/(?:Users|Volumes|Applications|System|Library|opt|usr|local|tmp|private|etc|var)\/)[^\s"'`<>|]+/g;
const PATH_TAIL = /[.,;:!?)\]}]+\*?$|[*]+$/;

function pathChip(p) {
  const isFile = /\.[A-Za-z0-9]{1,10}$/.test(p);
  return h(
    'button',
    {
      class: 'path-chip',
      title: `Open in Finder: ${p}`,
      onclick: async () => {
        const r = await call('app:openInFinder', p);
        if (!r?.ok) toast('Die locatie bestaat niet (meer)', 'error');
      },
    },
    icon(isFile ? 'file' : 'folder', 13),
    h('span', { class: 'path-chip-text' }, shortPath(p)),
    icon('external', 12),
  );
}

// Vervangt paden in de tekst van een gerenderd bericht door Finder-knopjes.
function decoratePaths(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || (!n.nodeValue.includes('~/') && !PATH_RE.test(n.nodeValue))) continue;
    PATH_RE.lastIndex = 0;
    const parent = n.parentElement;
    if (!parent || parent.closest('pre, a, textarea, .path-chip')) continue;
    nodes.push(n);
  }
  for (const node of nodes) {
    // parentNode, niet isConnected: bij het renderen staat het bericht nog buiten de DOM.
    if (!node.parentNode) continue;
    // Staat er een pad (al dan niet met spaties) in een inline code-span?
    // Dan het hele code-chipje vervangen, anders wordt het een knop in een knop.
    const code = node.parentElement?.tagName === 'CODE' && !node.parentElement.closest('pre') ? node.parentElement : null;
    if (code && code.childNodes.length === 1) {
      const raw = node.nodeValue.trim();
      PATH_RE.lastIndex = 0;
      const m = PATH_RE.exec(raw);
      if (m && m.index === 0) {
        const tail = (raw.match(PATH_TAIL) || [''])[0];
        const p = tail ? raw.slice(0, -tail.length) : raw;
        if (p && p !== '~' && p !== '~/') {
          code.replaceWith(pathChip(p));
          continue;
        }
      }
    }
    const text = node.nodeValue;
    let frag = null;
    let last = 0;
    PATH_RE.lastIndex = 0;
    for (let m; (m = PATH_RE.exec(text)); ) {
      let p = m[0];
      const tail = (p.match(PATH_TAIL) || [''])[0];
      if (tail) p = p.slice(0, -tail.length);
      if (!p || p === '~' || p === '~/') continue;
      if (!frag) frag = document.createDocumentFragment();
      frag.append(document.createTextNode(text.slice(last, m.index)));
      frag.append(pathChip(p));
      frag.append(document.createTextNode(tail));
      last = m.index + m[0].length;
    }
    if (frag) {
      frag.append(document.createTextNode(text.slice(last)));
      node.replaceWith(frag);
    }
  }
}

// ---------- state ----------
const state = {
  cfg: null,
  info: null,
  sessions: [],
  session: null,
  view: 'chat',
  pending: [],
  live: null,
  connectors: [],
  todosOpen: true,
  panel: {
    open: false,
    tab: 'chat',
    width: 400,
    side: null, // de zijchat-sessie (deelt de context van de hoofdchat)
    live: null,
    term: null, // xterm-instantie
    termId: null, // pty-id in het hoofdproces
    browserReady: false,
    browserUrl: '',
    loading: false,
  },
};
let browserRefresh = null; // verversfunctie van de browser-statusrij in Instellingen

// De naam die de app nu gebruikt. In de DawgSecretAgent-modus verandert alleen de naam in de
// teksten en het logo — verder gebeurt er niets.
const appName = () => (state.cfg?.secretAgent ? 'DawgSecretAgent' : `DawgAgent`);
const appLogoFile = () => (state.cfg?.secretAgent ? '../assets/logo-secret.png' : '../assets/logo.png');

const TOOL_META = {
  list_dir: ['Map bekeken', 'folder'],
  read_file: ['Gelezen', 'file'],
  write_file: ['Geschreven', 'pencil'],
  edit_file: ['Bewerkt', 'pencil'],
  search_files: ['Gezocht', 'search'],
  find_files: ['Bestanden gezocht', 'search'],
  run_shell: ['Commando', 'terminal'],
  run_applescript: ['AppleScript', 'terminal'],
  web_search: ['Web doorzocht', 'globe'],
  web_fetch: ['Pagina gelezen', 'globe'],
  read_spreadsheet: ['Spreadsheet gelezen', 'sheet'],
  use_skill: ['Skill gebruikt', 'sparkles'],
  create_skill: ['Skill gemaakt', 'sparkles'],
  todo_write: ['Takenlijst', 'list'],
  reload_self: ['Herladen', 'refresh'],
  computer_screenshot: ['Scherm bekeken', 'monitor'],
  computer_ui_elements: ['Scherm gelezen', 'eye'],
  computer_click: ['Klik', 'pointer'],
  computer_type: ['Typen', 'keyboard'],
  computer_key: ['Toets', 'keyboard'],
  computer_scroll: ['Scrollen', 'pointer'],
  computer_drag: ['Slepen', 'pointer'],
  computer_move: ['Muis', 'pointer'],
  computer_open_app: ['App geopend', 'monitor'],
  computer_wait: ['Wachten', 'clock'],
  browser: ['Browser', 'globe'],
  brain_search: ['The Brain doorzocht', 'search'],
  brain_read: ['Herinnering gelezen', 'brain'],
  brain_write: ['Onthouden', 'brain'],
  brain_link: ['Verbonden', 'link'],
  brain_delete: ['Vergeten', 'trash'],
};
const toolLabel = (n) => {
  const label = TOOL_META[n]?.[0] || BLOX_TOOL_META[n]?.[0];
  if (label) return t(label);
  return n?.startsWith('mcp__') ? t('Connector') : n;
};
const toolIcon = (n) => TOOL_META[n]?.[1] || BLOX_TOOL_META[n]?.[1] || (n?.startsWith('mcp__') ? 'plug' : 'cpu');

const MODES = {
  ask: { label: 'Vraag eerst', icon: 'hand', desc: () => `DawgAgent vraagt toestemming voor elke wijziging, elk commando en elke computeractie.` },
  edits: { label: 'Auto-bewerken', icon: 'pencil', desc: 'Bestanden bewerken mag direct; commando’s en computeracties eerst vragen.' },
  auto: { label: 'Volledig automatisch', icon: 'zap', desc: () => `Alles zonder te vragen. Alleen gebruiken als je DawgAgent vertrouwt met de taak.` },
};
// Study-stand van deze chat: uit, Study (tutor) of Proeftoets (examenmodus).
const STUDY_MODES = {
  off: { label: 'Study', icon: 'bulb', desc: 'Gewone chat: vragen en antwoorden.' },
  study: {
    label: 'Study',
    icon: 'bulb',
    desc: 'Tutor: pittige vragen op examenniveau, nooit het antwoord, niets overgeslagen van je slides.',
  },
  test: {
    label: 'Proeftoets',
    icon: 'list',
    desc: 'Examenmodus: alleen toetsen, geen hints, daarna een streng rapport.',
  },
};
const MODELS = [
  { id: 'deepseek-flash', label: 'DeepSeek Flash', desc: 'V4.1 · snel, goedkoop, ziet afbeeldingen', vision: true },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: 'Groot model · geen afbeeldingen', vision: false },
];
const THINKING = { off: 'Niet denken', low: 'Denken: laag', high: 'Denken: hoog', max: 'Denken: max' };
const modelLabel = (id) => MODELS.find((m) => m.id === id)?.label.replace('DeepSeek ', '') || id;

// ---------- menu & modal ----------
function closeMenu() {
  $('#menu').hidden = true;
}

function openMenu(anchor, items, { align = 'left' } = {}) {
  const menu = $('#menu');
  menu.textContent = '';
  for (const item of items) {
    if (item === '-') menu.append(h('div', { class: 'menu-sep' }));
    else if (item.label && item.header) menu.append(h('div', { class: 'menu-label' }, item.label));
    else {
      menu.append(
        h(
          'button',
          {
            class: 'menu-item',
            onclick: () => {
              closeMenu();
              item.action();
            },
          },
          item.icon ? icon(item.icon, 15) : null,
          h('span', { class: 'menu-text' }, item.label, item.desc ? h('small', {}, item.desc) : null),
          item.checked ? h('span', { class: 'check' }, icon('check', 15)) : null,
        ),
      );
    }
  }
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const mw = menu.offsetWidth;
  let top = r.top - mh - 8;
  if (top < 8) top = r.bottom + 8;
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

document.addEventListener('mousedown', (e) => {
  if (!$('#menu').hidden && !e.target.closest('#menu')) closeMenu();
});

function openModal(content, cls = '') {
  const bd = $('#modal');
  const box = $('.modal', bd);
  box.className = `modal ${cls}`;
  box.textContent = '';
  box.append(content);
  bd.hidden = false;
  bd.onmousedown = (e) => {
    if (e.target === bd) closeModal();
  };
  setTimeout(() => box.querySelector('input, textarea')?.focus(), 30);
}

function closeModal() {
  $('#modal').hidden = true;
}

function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const done = (v) => {
      closeModal();
      resolve(v);
    };
    openModal(
      h(
        'div',
        {},
        h('h2', {}, title),
        h('p', { class: 'lead' }, text),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn ghost', onclick: () => done(false) }, 'Annuleren'),
          h('button', { class: `btn ${danger ? 'primary danger' : 'primary'}`, onclick: () => done(true) }, okLabel),
        ),
      ),
    );
  });
}

function promptDialog(title, value = '') {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value });
    const done = (v) => {
      closeModal();
      resolve(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim());
    });
    openModal(
      h(
        'div',
        {},
        h('h2', {}, title),
        h('div', { class: 'field' }, input),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn ghost', onclick: () => done(null) }, 'Annuleren'),
          h('button', { class: 'btn primary', onclick: () => done(input.value.trim()) }, 'Opslaan'),
        ),
      ),
    );
  });
}

function openImage(p) {
  openModal(
    h(
      'div',
      {},
      h('img', { src: fileUrl(p) }),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn ghost', onclick: () => call('app:reveal', p) }, icon('folder', 14), 'Toon in Finder'),
        h('button', { class: 'btn primary', onclick: closeModal }, 'Sluiten'),
      ),
    ),
    'image-view',
  );
}

const btn = (label, cls, onclick, ic) => h('button', { class: `btn ${cls || ''}`, onclick }, ic ? icon(ic, 14) : null, label);
const iconBtn = (ic, title, onclick, cls = '') =>
  h(
    'button',
    {
      class: `icon-btn small ${cls}`,
      title,
      onclick: (e) => {
        e.stopPropagation();
        onclick(e);
      },
    },
    icon(ic, 14),
  );
function toggleSwitch(on, onChange) {
  const el = h('button', { class: `switch ${on ? 'on' : ''}`, role: 'switch' });
  el.addEventListener('click', async () => {
    const next = !el.classList.contains('on');
    el.classList.toggle('on', next);
    await onChange(next);
  });
  return el;
}

// ---------- views ----------
function showView(view) {
  state.view = view;
  for (const v of ['chat', 'skills', 'connectors', 'brain', 'settings']) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('.side-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#usage').hidden = view !== 'chat' || !state.session?.usage?.lastPrompt;
  if (view === 'chat') {
    setTopTitle(state.session?.messages?.length ? state.session.title : '');
    $('#input').focus();
  } else {
    setTopTitle('');
    if (view === 'skills') renderSkills();
    if (view === 'connectors') renderConnectors();
    if (view === 'brain') brainui.open();
    if (view === 'settings') renderSettings();
  }
  renderSessionList();
}

function setTopTitle(t) {
  $('#topbar-title').textContent = t || '';
}

// ---------- merkblok: logo + naam + modus (DawgAgent / DawgSecretAgent) ----------
// De switch raakt alleen de sidebar: ander logo, andere naam en in secret-modus de kleine
// regel "Business Friendly" eronder. De rest van de app blijft DawgAgent heten.
function applyBrand() {
  const secret = Boolean(state.cfg?.secretAgent);
  const img = $('#brand-logo');
  if (img) img.src = appLogoFile();
  const name = $('#brand-name');
  if (name) name.textContent = appName();
  const mode = $('#brand-mode');
  if (mode) mode.hidden = !secret;
  const b = $('#brand');
  if (b) b.title = secret ? 'DawgSecretAgent — klik om te wisselen' : 'DawgAgent — klik om te wisselen';
}

function brandMenu(anchor) {
  const secret = Boolean(state.cfg?.secretAgent);
  openMenu(
    anchor,
    [
      { header: true, label: 'Modus' },
      { label: 'DawgAgent', icon: 'sparkles', checked: !secret, action: () => setAgentMode(false) },
      { label: 'DawgSecretAgent', icon: 'eye', checked: secret, action: () => setAgentMode(true) },
    ],
    { align: 'left' },
  );
}

async function setAgentMode(secret) {
  if (Boolean(state.cfg?.secretAgent) === Boolean(secret)) return;
  await saveCfg({ secretAgent: Boolean(secret) });
  applyBrand();
  renderChat();
}

// ---------- sidebar ----------
async function refreshSessions() {
  [state.sessions] = await Promise.all([call('sessions:list'), blox ? blox.refreshSessions() : null]);
  renderSessionList();
}

function renderSessionList() {
  const list = $('#chat-list');
  list.textContent = '';
  const isBlox = state.session?.kind === 'blox';
  $('#btn-blox')?.classList.toggle('active', Boolean(isBlox) && state.view === 'chat');
  $('#btn-new').title = isBlox ? 'Nieuwe BloxCode-chat (⌘N)' : 'Nieuwe chat (⌘N)';
  const sessions = state.sessions;
  if (!sessions.length) {
    list.append(h('div', { class: 'chat-group' }, 'Chats'), h('div', { class: 'chat-empty' }, 'Nog geen chats'));
    return;
  }
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = [
    ['Vandaag', (t) => t >= startToday],
    ['Gisteren', (t) => t >= startToday - 864e5],
    ['Afgelopen 7 dagen', (t) => t >= startToday - 7 * 864e5],
    ['Ouder', () => true],
  ];
  const used = new Set();
  for (const [name, test] of groups) {
    const items = sessions.filter((s) => !used.has(s.id) && test(s.updated));
    if (!items.length) continue;
    list.append(h('div', { class: 'chat-group' }, name));
    for (const s of items) {
      used.add(s.id);
      const active = state.view === 'chat' && state.session?.id === s.id;
      const badges = [
        s.kind === 'blox' ? h('span', { class: 'chat-kind', title: 'BloxCode staat aan in deze chat' }, icon('cube', 12)) : null,
        s.study ? h('span', { class: 'chat-kind study', title: s.study === 'test' ? 'Proeftoets staat aan in deze chat' : 'Study staat aan in deze chat' }, icon('bulb', 12)) : null,
      ].filter(Boolean);
      list.append(
        h(
          'div',
          { class: `chat-item ${active ? 'active' : ''}`, onclick: () => openSession(s.id), title: `${s.title}${s.kind === 'blox' ? ' · BloxCode' : ''}${s.study ? (s.study === 'test' ? ' · Proeftoets' : ' · Study') : ''}` },
          ...badges,
          s.running ? h('span', { class: 'run-dot' }) : null,
          h('span', { class: 'chat-title' }, s.title || 'Chat'),
          h(
            'span',
            { class: 'chat-actions' },
            iconBtn('pencil', 'Hernoemen', async () => {
              const naam = await promptDialog('Chat hernoemen', s.title);
              if (!naam) return;
              await call('sessions:rename', s.id, naam);
              if (state.session?.id === s.id) {
                state.session.title = naam;
                setTopTitle(naam);
              }
              refreshSessions();
            }),
            iconBtn('trash', 'Verwijderen', async () => {
              if (!(await confirmDialog('Chat verwijderen?', `"${s.title}" gaat naar de prullenmand.`, 'Verwijderen', true))) return;
              await call('sessions:delete', s.id);
              if (state.session?.id === s.id) await newChat();
              refreshSessions();
            }),
          ),
        ),
      );
    }
  }
}

// ---------- chat ----------
// Een nieuwe chat erft de BloxCode-schakelaar van de chat waarin je zit,
// zodat je in dezelfde "modus" doorwerkt.
async function newChat() {
  closeMenu();
  const cur = state.session;
  const wantBlox = cur?.kind === 'blox';
  const wantStudy = cur?.study || 'off'; // de leerstand gaat mee naar de nieuwe chat
  if (cur && !cur.messages.length && !cur.running) {
    state.pending = [];
  } else {
    state.session = await call('sessions:new', state.cfg.workspace);
    if (wantBlox) state.session = await call('blox:setSession', state.session.id, true);
    if (wantStudy !== 'off') {
      try {
        const res = await call('sessions:setStudy', state.session.id, wantStudy);
        state.session.study = res?.mode || wantStudy;
      } catch {}
    }
    state.pending = [];
  }
  state.live = null;
  renderChat();
  showView('chat');
  if (state.panel.open && state.panel.tab === 'chat') ensureSideChat();
}

async function openSession(id) {
  const s = await call('sessions:get', id);
  if (!s) return refreshSessions();
  state.session = s;
  if (s.kind === 'blox') blox.ensureConnected();
  state.pending = [];
  state.live = null;
  renderChat();
  showView('chat');
  if (state.panel.open && state.panel.tab === 'chat') ensureSideChat();
}

function renderChat() {
  renderThread();
  renderPending();
  renderComposer();
  renderTodos();
  renderUsage();
}

function renderUsage() {
  const u = state.session?.usage;
  const el = $('#usage');
  if (!u?.lastPrompt) {
    el.hidden = true;
    return;
  }
  const cachePct = u.input ? Math.round((u.cached / u.input) * 100) : 0;
  el.textContent = `${fmtTokens(u.lastPrompt)} context · ${fmtTokens(u.output)} uit · ${cachePct}% cache`;
  el.title = `Totaal in: ${u.input.toLocaleString(dateLocale)} tokens (${u.cached.toLocaleString(dateLocale)} uit cache) · uit: ${u.output.toLocaleString(dateLocale)}`;
  el.hidden = state.view !== 'chat';
}

// Het startscherm: geen voorbeeldopdrachten, maar een statusoverzicht van deze Mac
// plus de chats waar je gebleven was.
function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 864e5).toDateString() === d.toDateString();
  if (sameDay) return d.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
  if (yesterday) return 'gisteren';
  return d.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });
}

function emptyState() {
  if (state.session?.kind === 'blox' && blox && !state.session.messages.length) return blox.renderHome();
  try {
    return emptyStateInner();
  } catch {
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'logo photo' }, appLogo()),
      h('h1', {}, 'Waar gaan we aan werken?'),
      h('p', {}, `Werkmap: ${shortPath(state.session?.workspace || state.cfg.workspace)}`),
    );
  }
}

function emptyStateInner() {
  const root = h(
    'div',
    { class: 'empty' },
    h('div', { class: 'logo photo' }, appLogo()),
    h('h1', {}, 'Waar gaan we aan werken?'),
    h('p', {}, `Werkmap: ${shortPath(state.session?.workspace || state.cfg.workspace)}`),
  );

  const facts = h('div', { class: 'facts' });
  root.append(facts);
  hydrateFacts(facts);

  const recent = (state.sessions || []).slice(0, 3);
  if (recent.length) {
    root.append(
      h(
        'div',
        { class: 'recent' },
        h('div', { class: 'recent-head' }, 'Verder waar je gebleven was'),
        recent.map((s) =>
          h(
            'button',
            { class: 'recent-item', onclick: () => openSession(s.id), title: s.title },
            h('span', { class: 'recent-title' }, s.title || 'Chat'),
            h('span', { class: 'recent-time' }, s.running ? 'bezig…' : fmtWhen(s.updated)),
          ),
        ),
      ),
    );
  }

  root.append(h('div', { class: 'empty-foot' }, 'Sleep bestanden of mappen hierheen om ze mee te geven · ⌘N nieuwe chat · ⌘, instellingen'));
  return root;
}

// Vult het statusrijtje op het startscherm (browser, computer, connectors, skills).
async function hydrateFacts(box) {
  let browserStatus = null;
  let skills = [];
  let conns = state.connectors || [];
  try {
    [browserStatus, skills, conns] = await Promise.all([
      call('browser:status').catch(() => null),
      call('skills:list').catch(() => []),
      call('connectors:status').catch(() => state.connectors || []),
    ]);
  } catch {
    /* status is optioneel — het startscherm werkt ook zonder */
  }
  try {
    state.connectors = conns;
    if (!box.isConnected) return;
    box.textContent = '';
    const fact = (ic, label, value, onclick, on, title) =>
      box.append(
        h(
          'button',
          { class: `fact${on ? ' on' : ''}`, onclick, title },
          icon(ic, 15),
          h('span', { class: 'fact-text' }, label, h('small', {}, value)),
        ),
      );

    const tabs = (browserStatus?.tab?.title || '').trim();
    fact(
      'globe',
      'Browser',
      browserStatus?.connected ? 'verbonden' : 'niet verbonden',
      () => showView('settings'),
      browserStatus?.connected,
      browserStatus?.connected ? `Chrome-extensie verbonden${tabs ? ` — ${tabs}` : ''}` : 'Extensie nog niet verbonden met Chrome',
    );
    fact(
      'monitor',
      'Computer use',
      state.cfg.computerUse ? 'aan' : 'uit',
      async () => {
        await toggleComputer();
        hydrateFacts(box);
      },
      state.cfg.computerUse,
      'Scherm zien en muis/toetsenbord bedienen',
    );
    fact('plug', 'Connectoren', conns.length ? `${conns.length}` : 'geen', () => showView('connectors'), conns.some((c) => c.status === 'connected'), 'MCP-koppelingen');
    fact('sparkles', 'Skills', skills.length ? `${skills.length}` : 'geen', () => showView('skills'), skills.length > 0, 'Herbruikbare werkwijzen');
  } catch {
    box.textContent = '';
  }
}

function renderThread() {
  const thread = $('#thread');
  thread.textContent = '';
  const s = state.session;
  if (!s) return;
  setTopTitle(s.messages.length ? s.title : '');
  if (!s.messages.some((m) => m.role === 'user')) {
    thread.append(emptyState());
    return;
  }
  const results = new Map(s.messages.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m]));
  let turn = null;
  for (const m of s.messages) {
    if (m.role === 'user') {
      if (m._auto) continue;
      thread.append(userBubble(m));
      turn = null;
    } else if (m.role === 'assistant') {
      if (!turn) thread.append((turn = h('div', { class: 'turn' })));
      appendAssistant(turn, m, results);
    } else if (m.role === '_note') {
      thread.append(noteEl(m));
      turn = null;
    }
  }
  if (s.running) {
    ensureLive();
    setWorking('Bezig…');
  }
  for (const a of s.approvals || []) showApproval(a);
  scrollToBottom(true);
}

function userBubble(m) {
  const wrap = h('div', { class: 'user-msg' });
  if (m._attachments?.length) wrap.append(h('div', { class: 'user-atts' }, m._attachments.map((a) => attChip(a))));
  const text = m._text ?? m.content;
  if (String(text || '').trim()) {
    const bubble = h('div', { class: 'bubble' }, text);
    decoratePaths(bubble);
    wrap.append(bubble);
  }
  return wrap;
}

function attChip(a, onRemove) {
  if (!a || a.loading) return h('div', { class: 'att loading' }, 'Bezig met verwerken…');
  const name = String(a.name || '');
  const remove = onRemove ? h('button', { class: 'att-remove', title: 'Verwijderen', onclick: onRemove }, icon('x', 11)) : null;
  if (a.kind === 'image') {
    return h(
      'div',
      { class: 'att image', title: name },
      h('img', { src: fileUrl(a.path), onclick: () => openImage(a.path) }),
      h('div', { class: 'att-caption' }, name),
      remove,
    );
  }
  const ic = { folder: 'folder', sheet: 'sheet', pdf: 'file', doc: 'file' }[a.kind] || 'file';
  const meta = a.kind === 'folder' ? 'Map' : `${(name.split('.').pop() || '').toUpperCase()} · ${fmtSize(a.size)}`;
  return h(
    'div',
    { class: 'att', title: a.path, ondblclick: () => call('app:reveal', a.path) },
    h('span', { class: 'att-icon' }, icon(ic, 16)),
    h('span', { style: 'min-width:0' }, h('div', { class: 'att-name' }, name), h('div', { class: 'att-meta' }, meta)),
    remove,
  );
}

function reasoningEl(text, live) {
  const d = h(
    'details',
    { class: 'reasoning' },
    h('summary', {}, icon('chevron', 13), h('span', { class: live ? 'shimmer' : '' }, live ? 'Denkt na…' : 'Nagedacht')),
    h('div', { class: 'reasoning-text' }, text),
  );
  $('.ic', d).classList.add('chev');
  return d;
}

function noteEl(m) {
  return h('div', { class: `note ${m.level === 'error' ? 'error' : ''}` }, m.text);
}

function stepsContainer(turn) {
  const children = [...turn.children].filter((c) => !c.classList.contains('working'));
  const last = children[children.length - 1];
  if (last?.classList.contains('steps')) return last;
  const steps = h('div', { class: 'steps' });
  insertInTurn(turn, steps);
  return steps;
}

function insertInTurn(turn, el) {
  const working = turn.querySelector(':scope > .working');
  if (working) turn.insertBefore(el, working);
  else turn.append(el);
}

function appendAssistant(turn, m, results) {
  if (m.reasoning_content) insertInTurn(turn, reasoningEl(m.reasoning_content, false));
  if (m.content && m.content !== '(onderbroken)') {
    const body = h('div', { class: 'md', html: md(m.content) });
    decoratePaths(body);
    insertInTurn(turn, body);
  }
  for (const c of m.tool_calls || []) {
    const r = results.get(c.id);
    if (c.function.name === 'todo_write' && r) continue;
    stepsContainer(turn).append(stepEl({ callId: c.id, name: c.function.name, summary: r?._summary }, r));
  }
}

function stepEl({ callId, name, summary }, result) {
  const status = h('span', { class: 'step-status' });
  const head = h(
    'button',
    { class: 'step-head' },
    icon(toolIcon(name), 15),
    h('span', { class: 'step-label' }, toolLabel(name)),
    h('span', { class: 'step-sum' }, summary || ''),
    status,
    icon('chevron', 13),
  );
  head.lastChild.classList.add('chev');
  const body = h('div', { class: 'step-body', hidden: true });
  const row = h('div', { class: 'step', dataset: { callId, name } }, head, body);
  head.addEventListener('click', () => {
    body.hidden = !body.hidden;
    row.classList.toggle('open', !body.hidden);
  });
  if (result) fillStep(row, result);
  else row.classList.add('running');
  return row;
}

function fillStep(row, msg) {
  row.classList.remove('running');
  row.classList.toggle('failed', msg._ok === false);
  const status = $('.step-status', row);
  status.textContent = '';
  if (msg._ok === false) status.append(icon('x', 13));
  if (msg._summary) $('.step-sum', row).textContent = msg._summary;
  const body = $('.step-body', row);
  body.textContent = '';
  const ui = msg._ui;
  if (ui?.kind === 'diff' || (ui?.kind === 'write' && ui.before)) {
    body.append(
      h(
        'div',
        { class: 'diff' },
        h('div', { class: 'diff-path' }, shortPath(ui.path)),
        h('pre', { class: 'del' }, ui.before.split('\n').map((l) => `− ${l}`).join('\n')),
        h('pre', { class: 'add' }, ui.after.split('\n').map((l) => `+ ${l}`).join('\n')),
      ),
    );
  } else if (ui?.kind === 'write') {
    body.append(h('div', { class: 'diff' }, h('div', { class: 'diff-path' }, `${shortPath(ui.path)} · ${ui.lines} regels`), h('pre', { class: 'add' }, ui.after)));
  }
  if (msg._images?.length) {
    body.append(h('div', { class: 'step-images' }, msg._images.map((p) => h('img', { src: fileUrl(p), onclick: () => openImage(p) }))));
    if (msg._name?.startsWith('computer_') && !$('.step-thumb', row)) {
      $('.step-head', row).insertBefore(h('img', { class: 'step-thumb', src: fileUrl(msg._images[msg._images.length - 1]) }), status);
    }
  }
  if (msg.content) body.append(h('pre', { class: 'step-out' }, clipText(msg.content, 8000)));
  decoratePaths(body);
  $('.approval', row)?.remove();
}

function findStep(callId) {
  return document.querySelector(`.step[data-call-id="${CSS.escape(callId)}"]`);
}

// ---------- live streaming ----------
function ensureLive() {
  const thread = $('#thread');
  if (state.live?.turn?.isConnected) return state.live;
  $('.empty', thread)?.remove();
  const last = thread.lastElementChild;
  const turn = last?.classList.contains('turn') ? last : thread.appendChild(h('div', { class: 'turn' }));
  state.live = { turn, text: null, textBuf: '', reasoning: null, reasoningBuf: '', raf: 0 };
  return state.live;
}

function setWorking(label) {
  const L = ensureLive();
  let w = L.turn.querySelector(':scope > .working');
  if (!label) {
    w?.remove();
    return;
  }
  if (!w) {
    w = h('div', { class: 'working' }, h('span', { class: 'shimmer' }, label));
    L.turn.append(w);
  } else w.firstChild.textContent = label;
  scrollToBottom();
}

function scheduleLiveRender() {
  const L = state.live;
  if (!L || L.raf) return;
  L.raf = requestAnimationFrame(() => {
    L.raf = 0;
    if (L.text) {
      fastCode = true;
      L.text.innerHTML = md(L.textBuf);
      fastCode = false;
    }
    if (L.reasoning) $('.reasoning-text', L.reasoning).textContent = L.reasoningBuf;
    scrollToBottom();
  });
}

function onAgentEvent(ev) {
  // De zijchat in het paneel heeft zijn eigen sessie; die events gaan daarheen.
  if (state.panel.side && ev.sessionId === state.panel.side.id) return panelAgentEvent(ev);
  if (ev.type === 'blox_mode' || ev.type === 'blox_memory') blox?.refreshStatus();
  if (ev.type === 'running' || ev.type === 'title' || ev.type === 'user_message') {
    const s = state.sessions.find((x) => x.id === ev.sessionId) || blox?.state.sessions.find((x) => x.id === ev.sessionId);
    if (ev.type === 'running' && s) s.running = ev.running;
    if (ev.type === 'title' && s) s.title = ev.title;
    if (ev.type === 'user_message' || (ev.type === 'running' && !ev.running)) refreshSessions();
    else renderSessionList();
  }
  if (ev.type === 'skills_changed' && state.view === 'skills') renderSkills();
  const s = state.session;
  if (!s || ev.sessionId !== s.id) return;

  switch (ev.type) {
    case 'user_message': {
      s.messages.push(ev.message);
      if (ev.title) s.title = ev.title;
      $('#thread .empty')?.remove();
      $('#thread').append(userBubble(ev.message));
      state.live = null;
      if (state.view === 'chat') setTopTitle(s.title);
      scrollToBottom(true);
      break;
    }
    case 'title':
      s.title = ev.title;
      if (state.view === 'chat') setTopTitle(ev.title);
      break;
    case 'running':
      s.running = ev.running;
      renderComposer();
      if (ev.running) setWorking('Bezig…');
      else {
        if (state.live?.turn) setWorking(null);
        if (state.live?.turn && !state.live.turn.children.length) state.live.turn.remove();
        state.live = null;
        s.approvals = [];
        renderTodos();
      }
      break;
    case 'assistant_start': {
      const L = ensureLive();
      Object.assign(L, { text: null, textBuf: '', reasoning: null, reasoningBuf: '' });
      setWorking('Denkt na…');
      break;
    }
    case 'reasoning': {
      const L = ensureLive();
      L.reasoningBuf += ev.text;
      if (!L.reasoning) {
        L.reasoning = reasoningEl('', true);
        insertInTurn(L.turn, L.reasoning);
        setWorking(null);
      }
      scheduleLiveRender();
      break;
    }
    case 'content': {
      const L = ensureLive();
      L.textBuf += ev.text;
      if (!L.text) {
        L.text = h('div', { class: 'md' });
        insertInTurn(L.turn, L.text);
        setWorking(null);
        if (L.reasoning) $('summary span:last-child', L.reasoning).className = '';
        if (L.reasoning) $('summary span:last-child', L.reasoning).textContent = 'Nagedacht';
      }
      scheduleLiveRender();
      break;
    }
    case 'tool_call_start':
      setWorking(`${toolLabel(ev.name)}…`);
      break;
    case 'retry':
      // Het verzoek begint opnieuw: half binnengekomen tekst weghalen, anders staat die er dubbel.
      if (ev.reset && state.live) {
        if (state.live.raf) cancelAnimationFrame(state.live.raf), (state.live.raf = 0);
        state.live.text?.remove();
        state.live.reasoning?.remove();
        Object.assign(state.live, { text: null, textBuf: '', reasoning: null, reasoningBuf: '' });
      }
      setWorking(`Verbinding hapert — opnieuw proberen (${ev.attempt})…`);
      break;
    case 'assistant_done': {
      s.messages.push(ev.message);
      const L = ensureLive();
      if (L.raf) cancelAnimationFrame(L.raf), (L.raf = 0);
      if (L.reasoning) {
        const span = $('summary span:last-child', L.reasoning);
        span.className = '';
        span.textContent = 'Nagedacht';
        $('.reasoning-text', L.reasoning).textContent = L.reasoningBuf;
      }
      if (L.text) {
        if (ev.message.content && ev.message.content !== '(onderbroken)') {
          L.text.innerHTML = md(ev.message.content);
          decoratePaths(L.text);
        } else L.text.remove();
      }
      Object.assign(L, { text: null, textBuf: '', reasoning: null, reasoningBuf: '' });
      if (ev.message.tool_calls?.length) setWorking(null);
      break;
    }
    case 'tool_start': {
      const L = ensureLive();
      setWorking(null);
      if (ev.name === 'todo_write') break;
      if (!findStep(ev.callId)) stepsContainer(L.turn).append(stepEl(ev));
      scrollToBottom();
      break;
    }
    case 'tool_output': {
      const row = findStep(ev.callId);
      if (!row) break;
      const body = $('.step-body', row);
      let pre = $('.step-out.live', body);
      if (!pre) body.append((pre = h('pre', { class: 'step-out live' })));
      pre.textContent = (pre.textContent + ev.chunk).slice(-12000);
      pre.scrollTop = pre.scrollHeight;
      const lastLine = ev.chunk.trim().split('\n').pop();
      if (lastLine && body.hidden) $('.step-sum', row).textContent = clipText(lastLine, 120);
      break;
    }
    case 'approval':
      s.approvals = [...(s.approvals || []).filter((a) => a.requestId !== ev.requestId), ev];
      showApproval(ev);
      break;
    case 'approval_done':
      s.approvals = (s.approvals || []).filter((a) => a.callId !== ev.callId);
      if (findStep(ev.callId)) $('.approval', findStep(ev.callId))?.remove();
      break;
    case 'tool_end': {
      s.messages.push(ev.message);
      const row = findStep(ev.callId);
      if (row) fillStep(row, ev.message);
      setWorking('Bezig…');
      break;
    }
    case 'note':
      s.messages.push(ev.message);
      if (state.live?.turn) setWorking(null);
      $('#thread').append(noteEl(ev.message));
      state.live = null;
      scrollToBottom(true);
      break;
    case 'todos':
      s.todos = ev.todos;
      renderTodos();
      break;
    case 'usage':
      s.usage = ev.usage;
      renderUsage();
      break;
  }
}

function showApproval(a, getLive = ensureLive) {
  let row = findStep(a.callId) || pFindStep(a.callId);
  if (!row) {
    const L = getLive();
    row = stepEl(a);
    stepsContainer(L.turn).append(row);
  }
  $('.approval', row)?.remove();
  // BloxCode heeft eigen keuzes: altijd deze tool, meteen auto-modus, of nee met feedback.
  if (String(a.kind || '').startsWith('blox')) {
    const card = blox.approvalCard(a, async (decision) => {
      card.remove();
      try {
        await call('chat:approve', a.requestId, decision);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
    row.append(card);
    scrollToBottom(true);
    return;
  }
  const titles = {
    exec: a.name === 'run_applescript' ? 'AppleScript uitvoeren?' : 'Commando uitvoeren?',
    edit: 'Bestand wijzigen?',
    computer: 'Computer bedienen?',
    'browser-act': 'Website bedienen?',
    mcp: 'Connector gebruiken?',
  };
  const decide = async (decision) => {
    card.remove();
    try {
      await call('chat:approve', a.requestId, decision);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const card = h(
    'div',
    { class: 'approval' },
    h('div', { class: 'approval-title' }, icon('shield', 15), titles[a.kind] || 'Toestaan?', h('span', { style: 'font-weight:400;color:var(--muted)' }, a.summary || '')),
    a.detail ? h('pre', { class: 'approval-detail' }, a.detail) : null,
    h(
      'div',
      { class: 'approval-actions' },
      btn('Toestaan', 'primary', () => decide('allow')),
      btn(a.kind === 'mcp' ? 'Altijd voor deze tool' : 'Altijd in deze chat', '', () => decide('always')),
      btn('Weigeren', 'ghost danger', () => decide('deny')),
    ),
  );
  row.append(card);
  scrollToBottom(true);
}

function scrollToBottom(force = false) {
  const sc = $('#scroller');
  const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
  if (force || near) sc.scrollTop = sc.scrollHeight;
}

// ---------- todos ----------
function renderTodos() {
  renderPanelTodos();
  const box = $('#todos');
  const todos = state.session?.todos || [];
  const show = todos.length && (state.session.running || todos.some((t) => t.status !== 'completed'));
  box.hidden = !show;
  if (!show) return;
  const done = todos.filter((t) => t.status === 'completed').length;
  const running = Boolean(state.session.running);
  box.textContent = '';
  const head = h(
    'div',
    {
      class: 'todos-head',
      onclick: () => {
        state.todosOpen = !state.todosOpen;
        renderTodos();
      },
    },
    icon('list', 15),
    `Taken ${done}/${todos.length}${running ? '' : ' · gestopt'}`,
    h('span', { style: 'margin-left:auto' }, icon(state.todosOpen ? 'down' : 'chevron', 14)),
  );
  box.append(head);
  if (state.todosOpen) {
    box.append(
      h(
        'div',
        { class: 'todos-list' },
        todos.map((t) => {
          // Alleen een draaiend rondje als er echt iets bezig is.
          const status = t.status === 'in_progress' && !running ? 'pending' : t.status;
          return h('div', { class: `todo ${status}` }, h('span', { class: 'box' }, status === 'completed' ? icon('check', 10) : null), h('span', {}, t.content));
        }),
      ),
    );
  }
}

// ---------- composer ----------
const input = () => $('#input');

function autosize() {
  const el = input();
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  renderSendState();
}

function renderSendState() {
  const s = state.session;
  const b = $('#btn-send');
  b.textContent = '';
  if (s?.running) {
    b.className = 'send stop';
    b.title = 'Stoppen (Esc)';
    b.disabled = false;
    b.append(icon('stop', 16));
  } else {
    b.className = 'send';
    b.title = 'Versturen (Enter)';
    b.disabled = !input().value.trim() && !state.pending.filter((a) => !a.loading).length;
    b.append(icon('up', 17));
  }
}

function renderComposer() {
  const cfg = state.cfg;
  const s = state.session;
  const ws = s?.workspace || cfg.workspace;
  const chip = (el, ic, label, on) => {
    el.textContent = '';
    el.append(icon(ic, 14), h('span', { class: 'label' }, label));
    el.classList.toggle('on', Boolean(on));
  };
  $('#btn-attach').textContent = '';
  $('#btn-attach').append(icon('plus', 17));
  const isBlox = Boolean(state.session?.kind === 'blox' && blox);
  const studyMode = STUDY_MODES[s?.study || 'off'] || STUDY_MODES.off;
  $('#chip-study').hidden = isBlox;
  chip($('#chip-study'), studyMode.icon, studyMode.label, (s?.study || 'off') !== 'off');
  $('#chip-study').className = `chip study-chip${(s?.study || 'off') !== 'off' ? ' on' : ''}`;
  $('#chip-study').append(icon('down', 12));
  $('#chip-study').disabled = Boolean(s?.running);
  $('#chip-study').title =
    (s?.study || 'off') === 'off'
      ? 'Study aanzetten: DawgAgent stelt pittige vragen op examenniveau, geeft nooit het antwoord en slaat niets over van je slides'
      : s.study === 'test'
        ? 'Proeftoets staat aan: toetsen zonder hints · klik om te wisselen'
        : 'Study staat aan: pittige vragen, nooit het antwoord, niets overgeslagen · klik om te wisselen';
  $('#chip-computer').hidden = isBlox;
  chip($('#chip-blox'), 'cube', isBlox ? 'BloxCode aan' : 'BloxCode', isBlox);
  $('#chip-blox').title = isBlox
    ? `BloxCode staat aan in deze chat — klik om uit te zetten${blox.state.status?.studioName ? ` · ${blox.state.status.studioName}` : ''}`
    : 'BloxCode aanzetten: je Roblox-developer die rechtstreeks in Studio bouwt, script en test';
  $('#chip-blox').disabled = Boolean(s?.running);
  input().placeholder = isBlox
    ? "Vraag BloxCode iets, typ / voor commando's, of sleep een foto hierheen…"
    : (s?.study || 'off') === 'off'
      ? `Vraag DawgAgent iets, of sleep bestanden hierheen…`
      : s.study === 'test'
        ? 'Proeftoets: laat je overhoren uit je hoofd — antwoorden komen pas in het rapport…'
        : 'Study: sleep je slides of cursus hierheen, of vraag om een vraag over de stof…';
  if (isBlox) {
    // BloxCode: de werkmap-chip wordt de Studio-kiezer, de modus-chip plan/vragen/veilig auto/alles auto.
    const c = blox.composerChips();
    chip($('#chip-workspace'), c.studio.icon, c.studio.label, c.studio.state === 'on');
    $('#chip-workspace').classList.toggle('warn', c.studio.state !== 'on');
    $('#chip-workspace').title = c.studio.title;
    chip($('#chip-mode'), c.mode.icon, c.mode.label, c.modeAuto);
    $('#chip-mode').classList.toggle('danger-mode', blox.state.status?.mode === 'yolo');
    $('#chip-mode').title = c.mode.title;
  } else {
    $('#chip-workspace').classList.remove('warn');
    chip($('#chip-workspace'), 'folder', ws === state.info.home ? '~' : basename(ws));
    $('#chip-workspace').title = `Werkmap: ${ws}`;
    const mode = MODES[cfg.approval] || MODES.edits;
    chip($('#chip-mode'), mode.icon, mode.label);
    $('#chip-mode').classList.remove('danger-mode');
    $('#chip-mode').title = 'Goedkeuring';
    chip($('#chip-computer'), 'monitor', cfg.computerUse ? 'Computer aan' : 'Computer', cfg.computerUse);
  }
  const thinkLabel = t(THINKING[cfg.thinking] || '');
  const think = cfg.thinking === 'off' ? '' : ` · ${thinkLabel.replace(/^(Denken|Thinking):\s*/, '')}`;
  $('#chip-model').textContent = '';
  $('#chip-model').append(h('span', { class: 'label' }, `${modelLabel(cfg.model)}${think}`), icon('down', 13));
  $('#composer-hint').textContent = s?.running ? `DawgAgent werkt… druk op Esc om te stoppen` : cfg.hasKey ? '' : 'Voeg eerst je DeepSeek API-sleutel toe in Instellingen';
  renderSendState();
}

async function saveCfg(patch) {
  state.cfg = await call('config:set', patch);
  renderComposer();
}

function renderPending() {
  const box = $('#pending');
  box.textContent = '';
  box.hidden = !state.pending.length;
  for (const a of state.pending) {
    box.append(
      attChip(a, () => {
        state.pending = state.pending.filter((x) => x !== a);
        renderPending();
      }),
    );
  }
  renderSendState();
}

// Eén geplakt of gesleept bestand klaarzetten: via het pad als het op schijf staat,
// anders via de bytes (dat is wat je krijgt bij een screenshot of "Afbeelding kopiëren").
async function attachFromFile(sid, f) {
  const p = api.pathForFile ? api.pathForFile(f) : null;
  if (p) return addAttachments(call('attach:paths', sid, [p]));
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const generic = !f.name || /^(image|blob|afbeelding)\.?/i.test(f.name);
  const name = generic ? `geplakt-${stamp}.${ext}` : f.name;
  return addAttachments(call('attach:data', sid, name, btoa(bin)));
}

async function addAttachments(promise) {
  const placeholder = { loading: true };
  state.pending.push(placeholder);
  renderPending();
  try {
    const atts = await promise;
    state.pending.splice(state.pending.indexOf(placeholder), 1, ...(atts || []));
    for (const a of atts || []) {
      if (a?.panel?.error) toast(a.panel.error, 'error');
      else if (a?.panel?.title) {
        const unit = a.panel.kind === 'pdf' ? "pagina's" : "dia's";
        const extra = a.panel.pages ? ` · ${a.panel.pages} ${unit}` : '';
        const warn = a.panel.unrenderable ? ` · ${a.panel.unrenderable} formule(s) niet zichtbaar in de diaweergave` : '';
        toast(`${a.panel.title} staat in het paneel${extra}${warn}`, 'success');
      }
    }
  } catch (e) {
    state.pending = state.pending.filter((x) => x !== placeholder);
    toast(e.message, 'error');
  }
  renderPending();
  input().focus();
}

async function sendMessage() {
  const s = state.session;
  if (!s) return;
  if (s.running) {
    await call('chat:stop', s.id);
    return;
  }
  const text = input().value;
  const atts = state.pending.filter((a) => !a.loading);
  if (!text.trim() && !atts.length) return;
  // BloxCode: /-commando's worden in de app uitgevoerd, niet naar het model gestuurd.
  if (s.kind === 'blox' && blox && text.trim().startsWith('/') && !atts.length) {
    input().value = '';
    autosize();
    blox.hideSlash();
    blox.runCommand(text.trim());
    return;
  }
  if (state.pending.some((a) => a.loading)) return toast('Wacht even tot de bijlagen verwerkt zijn');
  if (!state.cfg.hasKey) return showOnboarding();
  input().value = '';
  state.pending = [];
  autosize();
  renderPending();
  try {
    await call('chat:send', { sessionId: s.id, text, attachments: atts });
  } catch (e) {
    toast(e.message, 'error');
    input().value = text;
    state.pending = atts;
    autosize();
    renderPending();
  }
}

function attachMenu(anchor) {
  const sid = state.session.id;
  openMenu(anchor, [
    { label: "Foto's", icon: 'image', desc: 'PNG, JPG, HEIC…', action: () => addAttachments(call('attach:pick', sid, 'images')) },
    { label: 'Bestanden', icon: 'file', desc: 'Spreadsheets, PDF, Word, code, tekst', action: () => addAttachments(call('attach:pick', sid, 'files')) },
    { label: 'Map', icon: 'folder', desc: `DawgAgent krijgt de structuur en het pad`, action: () => addAttachments(call('attach:pick', sid, 'folder')) },
    '-',
    { label: 'Skill importeren', icon: 'sparkles', action: importSkills },
    { label: 'Connector toevoegen', icon: 'plug', action: () => connectorModal() },
  ]);
}

function modeMenu(anchor) {
  openMenu(
    anchor,
    Object.entries(MODES).map(([id, m]) => ({
      label: m.label,
      icon: m.icon,
      desc: typeof m.desc === 'function' ? m.desc() : m.desc,
      checked: state.cfg.approval === id,
      action: () => saveCfg({ approval: id }),
    })),
  );
}

// Study: de leerstand van deze chat (blijft bij de chat bewaard).
function studyMenu(anchor) {
  const current = state.session?.study || 'off';
  openMenu(
    anchor,
    [
      { header: true, label: 'Study-modus' },
      ...Object.entries(STUDY_MODES).map(([id, m]) => ({
        label: id === 'off' ? 'Uit' : m.label,
        icon: m.icon,
        desc: m.desc,
        checked: current === id,
        action: () => setStudy(id),
      })),
      '-',
      { label: 'Wat Study doet', icon: 'bulb', desc: 'Pittige vragen, nooit het antwoord, dekking van al je slides · uitleg', action: studyExplain },
    ],
    { align: 'left' },
  );
}

async function setStudy(id) {
  const s = state.session;
  if (!s) return;
  try {
    const res = await call('sessions:setStudy', s.id, id);
    s.study = res?.mode || 'off';
    renderComposer();
    if (s.study === 'off') toast('Study uit');
    else {
      const opened = res?.opened?.title ? ` · ${res.opened.title} staat in het paneel` : '';
      toast(s.study === 'test' ? `Proeftoets aan — geen hints, alleen toetsen${opened}` : `Study aan — pittige vragen, niets overgeslagen${opened}`, 'success');
      if (!state.panel.open) panelToggle(true, 'browser');
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

function studyExplain() {
  openModal(
    h(
      'div',
      {},
      h('h2', {}, 'Hoe Study werkt'),
      h(
        'ul',
        { class: 'lead' },
        h('li', {}, 'DawgAgent is je tutor: hij stelt pittige vragen op examenniveau en laat jou het werk doen.'),
        h('li', {}, 'Het antwoord krijg je niet — wel hints in stapjes, en pas na een echte poging.'),
        h('li', {}, 'Je slides, cursus of notities gaan mee: elke dia wordt als dekking geteld en komt minstens één keer als vraag terug. Wat nog openstaat zie je in het Taken-paneel en in zijn dekkingrapport.'),
        h('li', {}, 'Sleep je materiaal in de chat (bv. een PowerPoint): het opent meteen in het zijpaneel zodat je kunt meelezen.'),
        h('li', {}, 'Foutpatronen en wat je al beheerst blijven bewaard in de leerstatus van deze chat, zodat herhaling op de juiste momenten terugkomt.'),
      ),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn primary', onclick: () => closeModal() }, 'Begrepen'),
      ),
    ),
  );
}

function modelMenu(anchor) {
  const cfg = state.cfg;
  const items = [{ header: true, label: 'Model' }];
  for (const m of MODELS) {
    items.push({ label: m.label, desc: m.desc, checked: cfg.model === m.id, action: () => saveCfg({ model: m.id, vision: m.vision }) });
  }
  if (!MODELS.some((m) => m.id === cfg.model)) items.push({ label: cfg.model, desc: 'Eigen model (Instellingen)', checked: true, action: () => {} });
  items.push('-', { header: true, label: 'Nadenken' });
  for (const [id, label] of Object.entries(THINKING)) items.push({ label, checked: cfg.thinking === id, action: () => saveCfg({ thinking: id }) });
  openMenu(anchor, items, { align: 'right' });
}

async function pickWorkspace() {
  const dir = await call('workspace:pick');
  if (!dir) return;
  await call('sessions:setWorkspace', state.session.id, dir);
  state.session.workspace = dir;
  state.cfg.workspace = dir;
  renderComposer();
  if (!state.session.messages.length) renderThread();
}

async function toggleComputer() {
  const on = !state.cfg.computerUse;
  if (on) {
    toast('Computer use voorbereiden…');
    try {
      const perms = await call('computer:prepare');
      if (!perms.accessibility || !perms.screenRecording) permissionModal(perms);
    } catch (e) {
      return toast(e.message, 'error');
    }
  }
  await saveCfg({ computerUse: on });
  toast(on ? `Computer use staat aan — DawgAgent kan je scherm zien en bedienen` : 'Computer use staat uit');
}

function permissionModal(perms) {
  const rowFor = (label, hint, ok, which) =>
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, label), h('div', { class: 'row-hint' }, hint)),
      h(
        'div',
        { class: 'row-control' },
        h('span', { class: `perm ${ok ? 'ok' : 'no'}` }, icon(ok ? 'check' : 'x', 13), ok ? 'Toegestaan' : 'Nodig'),
        ok
          ? null
          : btn('Open instellingen', '', async () => {
              await call('computer:permissions', true);
              await call('computer:openSettings', which);
            }),
      ),
    );
  openModal(
    h(
      'div',
      {},
      h('h2', {}, `Geef DawgAgent toegang tot je scherm`),
      h(
        'p',
        { class: 'lead' },
        `Voor computer use heeft macOS twee toestemmingen nodig. Zet DawgAgent (of Electron / Terminal, als je DawgAgent zo start) aan in Systeeminstellingen → Privacy en beveiliging.`,
      ),
      h(
        'div',
        { class: 'cards' },
        rowFor('Toegankelijkheid', 'Om de muis en het toetsenbord te bedienen', perms.accessibility, 'accessibility'),
        rowFor('Schermopname', 'Om screenshots te maken van wat er op je scherm staat', perms.screenRecording, 'screen'),
      ),
      h('p', { class: 'row-hint', style: 'margin-top:12px' }, `Na het aanzetten van Schermopname moet DawgAgent meestal even herstarten.`),
      h(
        'div',
        { class: 'modal-actions' },
        btn(`Herstart DawgAgent`, 'ghost', () => call('app:relaunch')),
        btn('Opnieuw controleren', 'primary', async () => {
          const p = await call('computer:permissions', false);
          closeModal();
          if (!p.accessibility || !p.screenRecording) permissionModal(p);
          else toast('Alles is toegestaan ✓');
        }),
      ),
    ),
  );
}

// ---------- onboarding ----------
function showOnboarding() {
  const key = h('input', { class: 'input mono', type: 'password', placeholder: 'sk-…' });
  const status = h('div', { class: 'hint' });
  const save = async () => {
    if (!key.value.trim()) return;
    status.textContent = 'Controleren…';
    try {
      await call('apikey:set', key.value.trim());
      state.cfg = await call('config:get');
      closeModal();
      renderComposer();
      toast('Verbonden met DeepSeek ✓');
      input().focus();
    } catch (e) {
      status.textContent = e.message;
      status.style.color = 'var(--danger)';
    }
  };
  key.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  openModal(
    h(
      'div',
      {},
      h('div', { class: 'logo photo', style: 'margin-bottom:14px' }, appLogo()),
      h('h2', {}, `Welkom bij DawgAgent`),
      h('p', { class: 'lead' }, 'Je eigen agent op DeepSeek. Plak je API-sleutel om te beginnen — hij blijft alleen op deze Mac.'),
      h('div', { class: 'field' }, h('label', {}, 'DeepSeek API-sleutel'), key, status),
      h(
        'div',
        { class: 'modal-actions' },
        btn('Sleutel aanmaken', 'ghost', () => call('app:openExternal', 'https://platform.deepseek.com/api_keys'), 'external'),
        btn('Beginnen', 'primary', save),
      ),
    ),
  );
}

// ---------- skills ----------
function pageShell(view, title, desc, actions) {
  const page = $(`#view-${view}`);
  page.textContent = '';
  const inner = h('div', { class: 'page-inner' });
  inner.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), h('p', {}, desc)), h('div', { class: 'page-actions' }, actions)));
  page.append(inner);
  return inner;
}

async function importSkills() {
  try {
    const names = await call('skills:import');
    if (names.length) toast(`Geïmporteerd: ${names.join(', ')}`);
    if (state.view === 'skills') renderSkills();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function renderSkills() {
  const skills = await call('skills:list');
  const inner = pageShell(
    'skills',
    'Skills',
    `Herbruikbare instructies die DawgAgent automatisch inzet als een taak erbij past. Zelfde formaat als Claude Code: een map met SKILL.md. Sleep een map, .md of .zip hierheen om te importeren.`,
    [btn('Importeren', '', importSkills, 'download'), btn('Nieuwe skill', 'primary', () => skillModal(), 'plus')],
  );
  const cards = h('div', { class: 'cards' });
  if (!skills.length) cards.append(h('div', { class: 'empty-card' }, 'Nog geen skills.'));
  for (const s of skills) {
    cards.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, s.name), h('div', { class: 'card-desc' }, s.description || '—')),
        h(
          'div',
          { class: 'card-side' },
          toggleSwitch(s.enabled, (on) => call('skills:toggle', s.id, on)),
          iconBtn('more', 'Meer', (e) =>
            openMenu(
              e.currentTarget,
              [
                { label: 'Bewerken', icon: 'pencil', action: () => skillEditor(s.id) },
                { label: 'Open map', icon: 'folder', action: () => call('app:openPath', s.dir) },
                '-',
                {
                  label: 'Verwijderen',
                  icon: 'trash',
                  action: async () => {
                    if (!(await confirmDialog('Skill verwijderen?', `"${s.name}" gaat naar de prullenmand.`, 'Verwijderen', true))) return;
                    await call('skills:delete', s.id);
                    renderSkills();
                  },
                },
              ],
              { align: 'right' },
            ),
          ),
        ),
      ),
    );
  }
  inner.append(cards, h('p', { class: 'row-hint', style: 'margin-top:12px' }, `Tip: vraag DawgAgent in een chat "maak een skill voor …" en hij schrijft hem zelf.`));
}

function skillModal() {
  const name = h('input', { class: 'input', placeholder: 'bv. factuur-maken' });
  const desc = h('input', { class: 'input', placeholder: `Wanneer moet DawgAgent deze skill gebruiken?` });
  const body = h('textarea', { class: 'textarea mono', rows: 10, placeholder: '# Stappen\n1. …' });
  openModal(
    h(
      'div',
      {},
      h('h2', {}, 'Nieuwe skill'),
      h('div', { class: 'field' }, h('label', {}, 'Naam'), name),
      h('div', { class: 'field' }, h('label', {}, 'Beschrijving'), desc),
      h('div', { class: 'field' }, h('label', {}, 'Instructies (Markdown)'), body),
      h(
        'div',
        { class: 'modal-actions' },
        btn('Annuleren', 'ghost', closeModal),
        btn('Opslaan', 'primary', async () => {
          if (!name.value.trim()) return toast('Geef de skill een naam', 'error');
          await call('skills:create', { name: name.value.trim(), description: desc.value.trim(), instructions: body.value });
          closeModal();
          renderSkills();
        }),
      ),
    ),
  );
}

async function skillEditor(id) {
  const s = await call('skills:get', id);
  const ta = h('textarea', { class: 'textarea mono', rows: 20, value: s.content });
  openModal(
    h(
      'div',
      {},
      h('h2', {}, s.name),
      h('p', { class: 'lead path' }, shortPath(s.dir)),
      ta,
      h(
        'div',
        { class: 'modal-actions' },
        btn('Annuleren', 'ghost', closeModal),
        btn('Opslaan', 'primary', async () => {
          await call('skills:save', id, ta.value);
          closeModal();
          renderSkills();
        }),
      ),
    ),
  );
  $('.modal').style.width = '720px';
}

// ---------- connectors ----------
async function renderConnectors() {
  [state.connectors, state.cfg] = await Promise.all([call('connectors:status'), call('config:get')]);
  const list = state.cfg.connectors || [];
  const inner = pageShell(
    'connectors',
    'Connectors',
    `Koppel DawgAgent aan andere diensten via MCP-servers: lokaal (een commando zoals npx) of op afstand (een URL). Hetzelfde formaat als Claude Desktop en Cursor.`,
    [btn('JSON importeren', '', importJsonModal, 'download'), btn('Toevoegen', 'primary', () => connectorModal(), 'plus')],
  );
  const cards = h('div', { class: 'cards' });
  if (!list.length) {
    cards.append(
      h(
        'div',
        { class: 'empty-card' },
        h('div', { style: 'font-weight:600;color:var(--text);margin-bottom:4px' }, 'Nog geen connectors'),
        'Voorbeeld: bestandssysteem → commando ',
        h('code', {}, 'npx'),
        ' met argumenten ',
        h('code', {}, '-y @modelcontextprotocol/server-filesystem ~/Documents'),
      ),
    );
  }
  for (const c of list) {
    const st = state.connectors.find((x) => x.id === c.id);
    const status = c.enabled === false ? 'off' : st?.status || 'connecting';
    const statusText = { off: 'Uit', connecting: 'Verbinden…', connected: `${st?.tools.length || 0} tools`, error: 'Fout' }[status];
    const where = c.type === 'http' ? c.url : [c.command, ...(c.args || [])].join(' ');
    const toolsBox = h('div', { class: 'card-tools', hidden: true }, (st?.tools || []).map((t) => h('span', { class: 'tag', title: t.description }, t.name)));
    cards.append(
      h(
        'div',
        { class: 'card', style: 'align-items:flex-start' },
        h('span', { class: `status-dot ${status}`, style: 'margin-top:7px' }),
        h(
          'div',
          { class: 'card-main' },
          h(
            'div',
            { class: 'card-title' },
            c.name,
            h(
              'span',
              {
                class: 'tag',
                style: 'font-family:var(--font);cursor:pointer',
                onclick: () => (toolsBox.hidden = !toolsBox.hidden),
              },
              statusText,
            ),
          ),
          h('div', { class: 'card-desc mono', title: where }, where),
          status === 'error' && st?.error ? h('div', { class: 'card-error' }, st.error) : null,
          toolsBox,
        ),
        h(
          'div',
          { class: 'card-side' },
          toggleSwitch(c.enabled !== false, async (on) => {
            const next = list.map((x) => (x.id === c.id ? { ...x, enabled: on } : x));
            await saveConnectors(next);
          }),
          iconBtn('more', 'Meer', (e) =>
            openMenu(
              e.currentTarget,
              [
                { label: 'Bewerken', icon: 'pencil', action: () => connectorModal(c) },
                {
                  label: 'Opnieuw verbinden',
                  icon: 'refresh',
                  action: async () => {
                    await call('connectors:restart', c.id);
                    renderConnectors();
                  },
                },
                '-',
                {
                  label: 'Verwijderen',
                  icon: 'trash',
                  action: async () => {
                    if (!(await confirmDialog('Connector verwijderen?', `"${c.name}" wordt losgekoppeld.`, 'Verwijderen', true))) return;
                    await saveConnectors(list.filter((x) => x.id !== c.id));
                  },
                },
              ],
              { align: 'right' },
            ),
          ),
        ),
      ),
    );
  }
  inner.append(cards);
}

async function saveConnectors(list) {
  state.connectors = await call('connectors:save', list);
  state.cfg = await call('config:get');
  if (state.view === 'connectors') renderConnectors();
}

const parseLines = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function kvToText(obj, sep) {
  return Object.entries(obj || {})
    .map(([k, v]) => `${k}${sep}${v}`)
    .join('\n');
}

function textToKv(text, sep) {
  const out = {};
  for (const line of parseLines(text)) {
    const i = line.indexOf(sep);
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + sep.length).trim();
  }
  return out;
}

function connectorModal(existing) {
  const c = existing ? structuredClone(existing) : { name: '', type: 'stdio', command: '', args: [], env: {}, url: '', headers: {}, enabled: true };
  const name = h('input', { class: 'input', value: c.name, placeholder: 'bv. github' });
  const command = h('input', { class: 'input mono', value: c.command || '', placeholder: 'npx' });
  const args = h('textarea', { class: 'textarea mono', rows: 4, value: (c.args || []).join('\n'), placeholder: '-y\n@modelcontextprotocol/server-filesystem\n/Users/jij/Documents' });
  const env = h('textarea', { class: 'textarea mono', rows: 3, value: kvToText(c.env, '='), placeholder: 'API_KEY=…' });
  const url = h('input', { class: 'input mono', value: c.url || '', placeholder: 'https://voorbeeld.nl/mcp' });
  const headers = h('textarea', { class: 'textarea mono', rows: 3, value: kvToText(c.headers, ': '), placeholder: 'Authorization: Bearer …' });
  const stdioBox = h(
    'div',
    {},
    h('div', { class: 'field' }, h('label', {}, 'Commando'), command),
    h('div', { class: 'field' }, h('label', {}, 'Argumenten'), args, h('span', { class: 'hint' }, 'Eén argument per regel')),
    h('div', { class: 'field' }, h('label', {}, 'Omgevingsvariabelen'), env, h('span', { class: 'hint' }, 'SLEUTEL=waarde, één per regel')),
  );
  const httpBox = h(
    'div',
    {},
    h('div', { class: 'field' }, h('label', {}, 'URL'), url),
    h('div', { class: 'field' }, h('label', {}, 'Headers'), headers, h('span', { class: 'hint' }, 'Naam: waarde, één per regel')),
  );
  const seg = h('div', { class: 'segmented' });
  const setType = (t) => {
    c.type = t;
    seg.textContent = '';
    seg.append(
      h('button', { class: t === 'stdio' ? 'on' : '', onclick: () => setType('stdio') }, 'Lokaal commando'),
      h('button', { class: t === 'http' ? 'on' : '', onclick: () => setType('http') }, 'Op afstand (URL)'),
    );
    stdioBox.hidden = t !== 'stdio';
    httpBox.hidden = t !== 'http';
  };
  setType(c.type || 'stdio');
  openModal(
    h(
      'div',
      {},
      h('h2', {}, existing ? 'Connector bewerken' : 'Connector toevoegen'),
      h('p', { class: 'lead' }, `Een MCP-server geeft DawgAgent nieuwe tools, zoals GitHub, Notion, databases of je agenda.`),
      h('div', { class: 'field' }, h('label', {}, 'Naam'), name),
      h('div', { class: 'field' }, seg),
      stdioBox,
      httpBox,
      h(
        'div',
        { class: 'modal-actions' },
        btn('Annuleren', 'ghost', closeModal),
        btn('Opslaan', 'primary', async () => {
          if (!name.value.trim()) return toast('Geef de connector een naam', 'error');
          const item = {
            ...c,
            id: c.id || (await call('connectors:newId')),
            name: name.value.trim(),
            command: command.value.trim(),
            args: parseLines(args.value),
            env: textToKv(env.value, '='),
            url: url.value.trim(),
            headers: textToKv(headers.value, ':'),
          };
          const list = state.cfg.connectors || [];
          const next = list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
          closeModal();
          await saveConnectors(next);
          if (state.view !== 'connectors') showView('connectors');
        }),
      ),
    ),
  );
}

function importJsonModal() {
  const ta = h('textarea', { class: 'textarea mono', rows: 12, placeholder: '{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/jij/Documents"]\n    }\n  }\n}' });
  openModal(
    h(
      'div',
      {},
      h('h2', {}, 'Connectors importeren'),
      h('p', { class: 'lead' }, 'Plak een configuratie uit Claude Desktop, Cursor of de documentatie van een MCP-server.'),
      ta,
      h(
        'div',
        { class: 'modal-actions' },
        btn('Annuleren', 'ghost', closeModal),
        btn('Importeren', 'primary', async () => {
          try {
            const items = await call('connectors:parse', ta.value);
            closeModal();
            await saveConnectors([...(state.cfg.connectors || []), ...items]);
            toast(`${items.length} connector(s) toegevoegd`);
          } catch (e) {
            toast(`Ongeldige JSON: ${e.message}`, 'error');
          }
        }),
      ),
    ),
  );
}

// ---------- settings ----------
function settingRow(label, hint, control) {
  return h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, label), hint ? h('div', { class: 'row-hint' }, hint) : null), h('div', { class: 'row-control' }, control));
}

async function renderSettings() {
  state.cfg = await call('config:get');
  const cfg = state.cfg;
  const inner = pageShell('settings', 'Instellingen', 'Alles blijft lokaal op deze Mac.', []);

  // Taal: standaard die van de Mac, maar je kunt er ook zelf een kiezen.
  const langInfo = await call('i18n:info').catch(() => null);
  if (langInfo) {
    const langSelect = h('select', { class: 'input', style: 'width:230px' });
    langSelect.append(h('option', { value: 'auto' }, `${t('Automatisch')} — ${langInfo.systemName}`));
    for (const l of langInfo.available) langSelect.append(h('option', { value: l.code }, l.name));
    langSelect.value = cfg.lang && langInfo.available.some((l) => l.code === cfg.lang) ? cfg.lang : 'auto';
    langSelect.addEventListener('change', async () => {
      const previous = cfg.lang || 'auto';
      const ok = await confirmDialog(t('Taal wijzigen?'), t('Om de nieuwe taal te gebruiken start DawgAgent opnieuw op.'), t('Herstarten'));
      if (!ok) {
        langSelect.value = previous;
        return;
      }
      await call('i18n:set', langSelect.value);
      call('i18n:restart');
    });
    inner.append(
      h(
        'div',
        { class: 'section' },
        h('h2', {}, 'Taal'),
        h('div', { class: 'cards' }, settingRow('Taal van de app', 'Standaard volgt DawgAgent de taal van je Mac.', langSelect)),
      ),
    );
  }

  // Model & API
  const keyInput = h('input', { class: 'input mono', type: 'password', placeholder: cfg.hasKey ? '•••••••• (opgeslagen)' : 'sk-…', style: 'width:230px' });
  const keyStatus = h('div', { class: 'row-hint' }, cfg.hasKey ? 'Sleutel is opgeslagen.' : 'Nog geen sleutel.');
  const saveKey = async () => {
    if (!keyInput.value.trim()) return;
    keyStatus.textContent = 'Controleren…';
    keyStatus.style.color = '';
    try {
      const res = await call('apikey:set', keyInput.value.trim());
      keyInput.value = '';
      state.cfg = await call('config:get');
      keyStatus.textContent = `Verbonden ✓ ${res.models?.length ? `— modellen: ${res.models.join(', ')}` : ''}`;
      keyStatus.style.color = 'var(--ok)';
      renderComposer();
    } catch (e) {
      keyStatus.textContent = e.message;
      keyStatus.style.color = 'var(--danger)';
    }
  };
  keyInput.addEventListener('keydown', (e) => e.key === 'Enter' && saveKey());

  const baseUrl = h('input', { class: 'input mono', value: cfg.baseUrl, style: 'width:260px' });
  baseUrl.addEventListener('change', () => saveCfg({ baseUrl: baseUrl.value.trim() || 'https://api.deepseek.com' }));
  const model = h('input', { class: 'input mono', value: cfg.model, style: 'width:200px' });
  model.addEventListener('change', () => saveCfg({ model: model.value.trim() || 'deepseek-flash' }));
  const thinking = h('div', { class: 'segmented' });
  const drawThinking = () => {
    thinking.textContent = '';
    for (const [id, label] of Object.entries({ off: 'Uit', low: 'Laag', high: 'Hoog', max: 'Max' })) {
      thinking.append(
        h(
          'button',
          {
            class: state.cfg.thinking === id ? 'on' : '',
            onclick: async () => {
              await saveCfg({ thinking: id });
              drawThinking();
            },
          },
          label,
        ),
      );
    }
  };
  drawThinking();
  const maxSteps = h('input', { class: 'input', type: 'number', min: 5, max: 1000, value: cfg.maxSteps, style: 'width:90px' });
  maxSteps.addEventListener('change', () => saveCfg({ maxSteps: Math.max(5, Number(maxSteps.value) || 150) }));

  inner.append(
    h(
      'div',
      { class: 'section' },
      h('h2', {}, 'Model & API'),
      h(
        'div',
        { class: 'cards' },
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, 'DeepSeek API-sleutel'), keyStatus),
          h('div', { class: 'row-control' }, keyInput, btn('Opslaan', 'primary', saveKey)),
        ),
        settingRow('Model', 'deepseek-flash (ziet afbeeldingen) of deepseek-v4-pro', model),
        settingRow('Nadenken', 'Meer denken = slimmer maar trager', thinking),
        settingRow('Model ziet afbeeldingen', 'Uit = foto’s en screenshots worden als herkende tekst (OCR) doorgegeven', toggleSwitch(cfg.vision, (on) => saveCfg({ vision: on }))),
        settingRow('API-adres', 'Werkt met elke OpenAI-compatibele API', baseUrl),
        settingRow('Max. stappen per beurt', `Hoeveel tool-aanroepen DawgAgent achter elkaar mag doen`, maxSteps),
      ),
    ),
  );

  // Gedrag
  const instructions = h('textarea', { class: 'textarea', rows: 5, value: cfg.customInstructions || '', placeholder: 'bv. Antwoord altijd in het Nederlands. Ik werk vooral met Python en Shopify.' });
  instructions.addEventListener('change', () => saveCfg({ customInstructions: instructions.value }));
  const modeSeg = h('div', { class: 'segmented' });
  const drawMode = () => {
    modeSeg.textContent = '';
    for (const [id, m] of Object.entries(MODES)) {
      modeSeg.append(
        h(
          'button',
          {
            class: state.cfg.approval === id ? 'on' : '',
            title: typeof m.desc === 'function' ? m.desc() : m.desc,
            onclick: async () => {
              await saveCfg({ approval: id });
              drawMode();
            },
          },
          m.label,
        ),
      );
    }
  };
  drawMode();
  inner.append(
    h(
      'div',
      { class: 'section' },
      h('h2', {}, 'Gedrag'),
      h(
        'div',
        { class: 'cards' },
        settingRow('Goedkeuring', `Wanneer DawgAgent jou om toestemming vraagt`, modeSeg),
        h('div', { class: 'row stack' }, h('div', {}, h('div', { class: 'row-label' }, 'Eigen instructies'), h('div', { class: 'row-hint' }, 'Worden bij elke chat meegegeven. Een AGENTS.md in je werkmap wordt ook automatisch gelezen.')), instructions),
      ),
    ),
  );

  // Browser (Chrome-extensie)
  const browserInfo = h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, 'Status'), h('div', { class: 'row-hint' }, 'Controleren…'));
  const browserActions = h('div', { class: 'row-control' });
  const refreshBrowser = async () => {
    if (!browserInfo.isConnected) return;
    const b = await call('browser:status').catch(() => null);
    if (!b || !browserInfo.isConnected) return;
    browserInfo.textContent = '';
    browserInfo.append(
      h('div', { class: 'row-label' }, b.connected ? 'Extensie verbonden met Chrome' : 'Extensie nog niet verbonden'),
      h(
        'div',
        { class: 'row-hint' },
        b.connected
          ? `Chrome praat met DawgAgent op poort ${b.port}${b.tab?.title ? ` · ${b.tab.title.slice(0, 60)}` : ''}`
          : 'Laad hem eenmalig in Chrome: Ontwikkelaarsmodus aan, "Uitgepakte extensie laden" en kies de map hieronder.',
      ),
      h('div', { class: 'path' }, `Extensiemap: ${shortPath(b.dir)}`),
    );
    browserActions.textContent = '';
    browserActions.append(
      b.connected
        ? btn('Testen', '', async () => {
            try {
              toast(await call('browser:test'));
            } catch (e) {
              toast(e.message, 'error');
            }
          }, 'globe')
        : btn('Verbinden', 'primary', async () => {
            await call('browser:connect');
            setTimeout(refreshBrowser, 1200);
          }, 'refresh'),
      btn('Open chrome://extensions', '', () => call('browser:openExtensions'), 'external'),
      btn('Map tonen', '', () => call('browser:openFolder'), 'folder'),
    );
  };
  browserRefresh = refreshBrowser;
  refreshBrowser();
  inner.append(
    h(
      'div',
      { class: 'section' },
      h('h2', {}, 'Browser (Chrome)'),
      h(
        'p',
        { class: 'row-hint', style: 'margin:-4px 0 10px' },
        `Met de eigen extensie leest en bedient DawgAgent je eigen Chrome. Dat is veel zuiniger dan screenshots: hij krijgt de tekst van de pagina en een genummerde lijst met knoppen en velden, en ziet dus precies wat hij doet. Zeg in een chat bijvoorbeeld "gebruik de browser extensie en zoek …".`,
      ),
      h(
        'div',
        { class: 'cards' },
        settingRow('Browser-gereedschap', `Laat DawgAgent je browser lezen en bedienen`, toggleSwitch(cfg.browser !== false, (on) => saveCfg({ browser: on }))),
        h('div', { class: 'row' }, browserInfo, browserActions),
      ),
    ),
  );

  // Computer use
  const permsBox = h('div', { class: 'row-hint' }, 'Status wordt gecontroleerd…');
  const cuSection = h(
    'div',
    { class: 'section' },
    h('h2', {}, 'Computer use'),
    h(
      'div',
      { class: 'cards' },
      settingRow('Computer use', `DawgAgent mag je scherm zien en muis en toetsenbord bedienen`, toggleSwitch(cfg.computerUse, async (on) => {
        if (on !== state.cfg.computerUse) await toggleComputer();
      })),
      settingRow(`Verberg DawgAgent tijdens het werk`, 'Het venster gaat opzij; een klein balkje met Stop blijft zichtbaar', toggleSwitch(cfg.hideDuringComputerUse, (on) => saveCfg({ hideDuringComputerUse: on }))),
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, 'Toestemmingen van macOS'), permsBox),
        h(
          'div',
          { class: 'row-control' },
          btn('Controleren', '', async () => {
            try {
              permissionModal(await call('computer:prepare'));
            } catch (e) {
              toast(e.message, 'error');
            }
          }),
        ),
      ),
    ),
    h('p', { class: 'row-hint', style: 'margin-top:8px' }, `Noodstop: ⌘⇧⎋ (Command-Shift-Escape) werkt altijd, ook als DawgAgent verborgen is.`),
  );
  inner.append(cuSection);
  call('computer:permissions', false)
    .then((p) => {
      permsBox.textContent = '';
      permsBox.append(
        h('span', { class: `perm ${p.accessibility ? 'ok' : 'no'}` }, icon(p.accessibility ? 'check' : 'x', 12), 'Toegankelijkheid'),
        '   ',
        h('span', { class: `perm ${p.screenRecording ? 'ok' : 'no'}` }, icon(p.screenRecording ? 'check' : 'x', 12), 'Schermopname'),
      );
    })
    .catch(() => (permsBox.textContent = 'Helper nog niet gebouwd — klik op Controleren.'));

  // Versies
  const snaps = await call('snapshots:list');
  const snapCards = h('div', { class: 'cards' });
  snapCards.append(
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, `Broncode van DawgAgent`), h('div', { class: 'path' }, shortPath(state.info.appDir))),
      h(
        'div',
        { class: 'row-control' },
        btn('Open map', '', () => call('app:openPath', state.info.appDir), 'folder'),
        btn('Back-up maken', '', async () => {
          await call('snapshots:create');
          toast('Back-up gemaakt');
          renderSettings();
        }),
      ),
    ),
  );
  if (!snaps.length) snapCards.append(h('div', { class: 'empty-card' }, `Nog geen back-ups. Er wordt er automatisch één gemaakt zodra DawgAgent zijn eigen code aanpast.`));
  for (const s of snaps.slice(0, 15)) {
    snapCards.append(
      settingRow(
        new Date(s.created).toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }),
        s.reason,
        btn('Herstellen', 'ghost', async () => {
          if (!(await confirmDialog('Deze versie herstellen?', `De broncode van DawgAgent wordt teruggezet naar deze back-up en DawgAgent herstart. De huidige versie wordt eerst zelf ook bewaard.`, 'Herstellen'))) return;
          await call('snapshots:restore', s.id);
        }, 'history'),
      ),
    );
  }
  inner.append(
    h(
      'div',
      { class: 'section' },
      h('h2', {}, 'Zelf-aanpassing & versies'),
      h('p', { class: 'row-hint', style: 'margin:-4px 0 10px' }, `DawgAgent kan zijn eigen code aanpassen als je daarom vraagt ("voeg een knop toe die…"). Vóór elke aanpassing wordt een back-up gemaakt. Start DawgAgent niet meer? Dubbelklik dan op Herstel.command in de app-map.`),
      snapCards,
    ),
  );

  inner.append(
    h(
      'div',
      { class: 'section' },
      h('h2', {}, 'Opslag'),
      h(
        'div',
        { class: 'cards' },
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, 'Chats, skills en instellingen'), h('div', { class: 'path' }, shortPath(state.info.dataDir))),
          h('div', { class: 'row-control' }, btn('Open map', '', () => call('app:openPath', state.info.dataDir), 'folder')),
        ),
      ),
    ),
  );
}

// ---------- zijpaneel ----------
// Rechts naast de chat: een zijchat (met de context van deze chat), de takenlijst,
// een eigen browser en een terminal. Alles blijft staan als je van tab wisselt.
const PANEL_START_URL = 'https://www.google.com';

function setPanelWidth(w) {
  state.panel.width = Math.max(280, Math.min(Math.round(w), Math.round(window.innerWidth - 460)));
  document.documentElement.style.setProperty('--panel-w', `${state.panel.width}px`);
}

function panelToggle(open = !state.panel.open, tab) {
  state.panel.open = open;
  $('#panel').hidden = !open;
  $('#btn-panel').classList.toggle('active', open);
  if (open) {
    setPanelWidth(state.panel.width);
    setPanelTab(tab || state.panel.tab);
  }
  saveCfg({ panelOpen: open });
}

function setPanelTab(tab) {
  state.panel.tab = tab;
  for (const t of ['chat', 'taken', 'browser', 'terminal']) $(`#pview-${t}`).hidden = t !== tab;
  document.querySelectorAll('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.ptab === tab));
  saveCfg({ panelTab: tab });
  if (tab === 'chat') ensureSideChat();
  if (tab === 'taken') renderPanelTodos();
  if (tab === 'browser') initPanelBrowser();
  if (tab === 'terminal') ensureTerminal();
}

// ---- zijchat: deelt de context van de hoofdchat, houdt eigen berichten ----
async function ensureSideChat() {
  const parent = state.session;
  if (!parent) return;
  const cur = state.panel.side;
  if (cur && cur.parentId === parent.id) return;
  // Zolang de hoofdchat leeg is valt er nog niets te verwijzen: de zijchat-sessie
  // maken we pas als de gebruiker er echt iets vraagt.
  if (!(parent.messages || []).length) {
    state.panel.side = { id: null, parentId: parent.id, parentTitle: parent.title, messages: [], running: false, approvals: [] };
    state.panel.live = null;
    renderPanelChat();
    return;
  }
  try {
    const s = await call('sessions:sideFor', parent.id);
    if (!s) return;
    state.panel.side = s;
    state.panel.live = null;
    renderPanelChat();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// De echte sessie aanmaken op het moment dat de eerste vraag komt.
async function materializeSideChat() {
  const parent = state.session;
  const s = state.panel.side;
  if (!s || s.id) return s;
  const real = await call('sessions:sideFor', parent.id);
  if (!real) return null;
  state.panel.side = real;
  renderPanelChat();
  return real;
}

function pScroll(force = false) {
  const sc = $('#pchat-scroller');
  const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
  if (force || near) sc.scrollTop = sc.scrollHeight;
}

function pEmpty() {
  const s = state.panel.side;
  const title = s?.parentTitle || state.session?.title || 'deze chat';
  return h(
    'div',
    { class: 'pempty' },
    h('div', {}, 'Deze zijchat hoort bij ', h('b', {}, title), '.'),
    h('div', { style: 'margin-top:8px' }, 'Vraag hier om extra uitleg over iets uit die chat — de context gaat mee, de hoofdchat blijft rustig.'),
  );
}

function renderPanelChat() {
  const thread = $('#pchat-thread');
  const s = state.panel.side;
  thread.textContent = '';
  if (!s) return;
  $('#pchat-note').textContent = '';
  $('#pchat-note').append(
    icon('columns', 14),
    h('span', {}, 'Zijchat bij ', h('b', {}, s.parentTitle || state.session?.title || 'deze chat')),
  );
  const msgs = s.messages || [];
  if (!msgs.some((m) => m.role === 'user')) thread.append(pEmpty());
  const results = new Map(msgs.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m]));
  let turn = null;
  for (const m of msgs) {
    if (m.role === 'user') {
      if (m._auto) continue;
      thread.append(userBubble(m));
      turn = null;
    } else if (m.role === 'assistant') {
      if (!turn) thread.append((turn = h('div', { class: 'turn' })));
      appendAssistant(turn, m, results);
    } else if (m.role === '_note') {
      thread.append(noteEl(m));
      turn = null;
    }
  }
  if (s.running) {
    pEnsureLive();
    pSetWorking('Bezig…');
  }
  for (const a of s.approvals || []) showApproval(a, pEnsureLive);
  renderPanelSend();
  pScroll(true);
}

function pEnsureLive() {
  const thread = $('#pchat-thread');
  const P = state.panel;
  if (P.live?.turn?.isConnected) return P.live;
  $('#pchat-thread .pempty')?.remove();
  const last = thread.lastElementChild;
  const turn = last?.classList.contains('turn') ? last : thread.appendChild(h('div', { class: 'turn' }));
  P.live = { turn, text: null, textBuf: '', reasoning: null, reasoningBuf: '', raf: 0 };
  return P.live;
}

function pSetWorking(label) {
  const L = pEnsureLive();
  let w = L.turn.querySelector(':scope > .working');
  if (!label) {
    w?.remove();
    return;
  }
  if (!w) {
    w = h('div', { class: 'working' }, h('span', { class: 'shimmer' }, label));
    L.turn.append(w);
  } else w.firstChild.textContent = label;
  pScroll();
}

function pScheduleLive() {
  const L = state.panel.live;
  if (!L || L.raf) return;
  L.raf = requestAnimationFrame(() => {
    L.raf = 0;
    if (L.text) {
      fastCode = true;
      L.text.innerHTML = md(L.textBuf);
      fastCode = false;
    }
    if (L.reasoning) $('.reasoning-text', L.reasoning).textContent = L.reasoningBuf;
    pScroll();
  });
}

function pFindStep(callId) {
  return $('#pchat-thread')?.querySelector(`.step[data-call-id="${CSS.escape(callId)}"]`);
}

function panelAgentEvent(ev) {
  const s = state.panel.side;
  if (!s) return;
  const P = state.panel;
  switch (ev.type) {
    case 'user_message': {
      s.messages.push(ev.message);
      $('#pchat-thread .pempty')?.remove();
      $('#pchat-thread').append(userBubble(ev.message));
      P.live = null;
      pScroll(true);
      break;
    }
    case 'running':
      s.running = ev.running;
      renderPanelSend();
      if (ev.running) pSetWorking('Bezig…');
      else {
        if (P.live?.turn) pSetWorking(null);
        if (P.live?.turn && !P.live.turn.children.length) P.live.turn.remove();
        P.live = null;
        s.approvals = [];
      }
      break;
    case 'assistant_start': {
      const L = pEnsureLive();
      Object.assign(L, { text: null, textBuf: '', reasoning: null, reasoningBuf: '' });
      pSetWorking('Denkt na…');
      break;
    }
    case 'reasoning': {
      const L = pEnsureLive();
      L.reasoningBuf += ev.text;
      if (!L.reasoning) {
        L.reasoning = reasoningEl('', true);
        insertInTurn(L.turn, L.reasoning);
        pSetWorking(null);
      }
      pScheduleLive();
      break;
    }
    case 'content': {
      const L = pEnsureLive();
      L.textBuf += ev.text;
      if (!L.text) {
        L.text = h('div', { class: 'md' });
        insertInTurn(L.turn, L.text);
        pSetWorking(null);
        if (L.reasoning) {
          const span = $('summary span:last-child', L.reasoning);
          span.className = '';
          span.textContent = 'Nagedacht';
        }
      }
      pScheduleLive();
      break;
    }
    case 'tool_call_start':
      pSetWorking(`${toolLabel(ev.name)}…`);
      break;
    case 'retry':
      if (ev.reset && P.live) {
        if (P.live.raf) cancelAnimationFrame(P.live.raf), (P.live.raf = 0);
        P.live.text?.remove();
        P.live.reasoning?.remove();
        Object.assign(P.live, { text: null, textBuf: '', reasoning: null, reasoningBuf: '' });
      }
      pSetWorking(`Verbinding hapert — opnieuw proberen (${ev.attempt})…`);
      break;
    case 'assistant_done': {
      s.messages.push(ev.message);
      const L = pEnsureLive();
      if (L.raf) cancelAnimationFrame(L.raf), (L.raf = 0);
      if (L.reasoning) {
        const span = $('summary span:last-child', L.reasoning);
        span.className = '';
        span.textContent = 'Nagedacht';
        $('.reasoning-text', L.reasoning).textContent = L.reasoningBuf;
      }
      if (L.text) {
        if (ev.message.content && ev.message.content !== '(onderbroken)') {
          L.text.innerHTML = md(ev.message.content);
          decoratePaths(L.text);
        } else L.text.remove();
      }
      Object.assign(L, { text: null, textBuf: '', reasoning: null, reasoningBuf: '' });
      if (ev.message.tool_calls?.length) pSetWorking(null);
      break;
    }
    case 'tool_start': {
      const L = pEnsureLive();
      pSetWorking(null);
      if (ev.name === 'todo_write') break;
      if (!pFindStep(ev.callId)) stepsContainer(L.turn).append(stepEl(ev));
      pScroll();
      break;
    }
    case 'tool_output': {
      const row = pFindStep(ev.callId);
      if (!row) break;
      const body = $('.step-body', row);
      let pre = $('.step-out.live', body);
      if (!pre) body.append((pre = h('pre', { class: 'step-out live' })));
      pre.textContent = (pre.textContent + ev.chunk).slice(-12000);
      pre.scrollTop = pre.scrollHeight;
      break;
    }
    case 'tool_end': {
      s.messages.push(ev.message);
      const row = pFindStep(ev.callId);
      if (row) fillStep(row, ev.message);
      pSetWorking('Bezig…');
      break;
    }
    case 'approval':
      s.approvals = [...(s.approvals || []).filter((a) => a.requestId !== ev.requestId), ev];
      showApproval(ev, pEnsureLive);
      break;
    case 'approval_done':
      s.approvals = (s.approvals || []).filter((a) => a.callId !== ev.callId);
      pFindStep(ev.callId)?.querySelector('.approval')?.remove();
      break;
    case 'note':
      s.messages.push(ev.message);
      if (P.live?.turn) pSetWorking(null);
      $('#pchat-thread').append(noteEl(ev.message));
      P.live = null;
      pScroll(true);
      break;
    case 'usage':
      s.usage = ev.usage;
      break;
  }
}

function pAutosize() {
  const el = $('#pchat-input');
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 170)}px`;
  renderPanelSend();
}

function renderPanelSend() {
  const b = $('#pchat-send');
  if (!b) return;
  const s = state.panel.side;
  b.textContent = '';
  if (s?.running) {
    b.className = 'send sm stop';
    b.title = 'Stoppen';
    b.append(icon('stop', 14));
  } else {
    b.className = 'send sm';
    b.title = 'Versturen (Enter)';
    b.append(icon('up', 15));
  }
  $('#pchat-hint').textContent = s?.running ? 'bezig…' : '';
}

async function panelSendMessage() {
  let s = state.panel.side;
  if (!s) return;
  const el = $('#pchat-input');
  if (s.running) return call('chat:stop', s.id);
  if (!s.id) {
    s = await materializeSideChat();
    if (!s) return;
  }
  const text = el.value;
  if (!text.trim()) return;
  if (!state.cfg.hasKey) return showOnboarding();
  el.value = '';
  pAutosize();
  renderPanelSend();
  try {
    await call('chat:send', { sessionId: s.id, text });
  } catch (e) {
    toast(e.message, 'error');
    el.value = text;
    pAutosize();
  }
}

async function panelNewSideChat() {
  const parent = state.session;
  if (!parent) return;
  const go = await confirmDialog('Nieuw zijgesprek?', 'De huidige zijchat blijft bewaard maar verdwijnt uit het paneel.', 'Beginnen');
  if (!go) return;
  const r = await call('sessions:newSide', parent.id);
  if (!r) return;
  state.panel.side = null;
  await ensureSideChat();
}

// ---- taken ----
function renderPanelTodos() {
  const box = $('#ptodos');
  if (!box || !state.cfg) return;
  const check = $('#ptodos-auto');
  if (check) check.checked = Boolean(state.cfg.autoTodos);
  const todos = state.session?.todos || [];
  box.textContent = '';
  if (!todos.length) {
    box.append(h('div', { class: 'pempty-small' }, 'Nog geen taken in deze chat.'));
    return;
  }
  const running = Boolean(state.session?.running);
  for (const t of todos) {
    const status = t.status === 'in_progress' && !running ? 'pending' : t.status;
    box.append(
      h(
        'div',
        { class: `ptodo ${status}` },
        h('span', { class: 'box' }, status === 'completed' ? icon('check', 11) : null),
        h('span', { class: 'content' }, t.content),
      ),
    );
  }
}

// ---- browser ----
function normalizePanelUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (/^[a-z]+:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}/.test(s)) return `http://${s}`;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s) && !s.includes(' ')) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

// Is dit een adres (dan openen we het hier) of een vraag (dan gaat hij naar DawgAgent)?
function looksLikePanelUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || /\s/.test(s)) return false;
  if (/^(https?|file):\/\//i.test(s)) return true;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(s)) return true;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(s)) return true;
  return false;
}

// Vraag uit de adresbalk van het paneel: eerst naar DawgAgent (in de chat),
// die zoekt het op en opent het resultaat met de paneelbrowser.
async function panelAskFromBar(text) {
  if (!state.cfg.hasKey) return showOnboarding();
  const main = state.session;
  try {
    if (main && !main.running) {
      await call('chat:send', { sessionId: main.id, text: `[via de adresbalk van het browserpaneel] ${text}` });
      return;
    }
    await ensureSideChat();
    let s = state.panel.side;
    if (!s) return;
    if (!s.id) s = await materializeSideChat();
    if (!s) return;
    if (s.running) return toast(`DawgAgent is nog bezig — wacht heel even.`, 'error');
    setPanelTab('chat');
    await call('chat:send', { sessionId: s.id, text: `[via de adresbalk van het browserpaneel] ${text}` });
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Wacht tot de webview aangesloten is (nodig als het paneel net opengaat).
async function panelWaitReady(wv, timeout = 5000) {
  const t0 = Date.now();
  for (;;) {
    try {
      wv.getURL();
      return true;
    } catch {}
    if (Date.now() - t0 > timeout) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

function waitPanelLoad(wv, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      wv.removeEventListener('did-stop-loading', finish);
      wv.removeEventListener('did-fail-load', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    wv.addEventListener('did-stop-loading', finish);
    wv.addEventListener('did-fail-load', finish);
  });
}

function initPanelBrowser() {
  const P = state.panel;
  const wv = $('#pb-view');
  if (!wv || P.browserReady) return wv;
  P.browserReady = true;
  const setUrl = (url) => {
    P.browserUrl = url || '';
    $('#pb-url').value = url && url !== 'about:blank' ? url : '';
  };
  $('#pb-url').value = state.cfg.panelUrl || PANEL_START_URL;
  // De webview bestaat al sinds het starten van het venster, dus "dom-ready" kan al
  // geweest zijn; we proberen het direct en vallen anders terug op de gebeurtenis.
  const start = () => {
    let current;
    try {
      current = wv.getURL();
    } catch {
      return false; // nog niet aangesloten
    }
    if (current && current !== 'about:blank') return true;
    wv.loadURL(state.cfg.panelUrl || PANEL_START_URL).catch(() => {});
    return true;
  };
  wv.addEventListener('dom-ready', start);
  if (!start()) setTimeout(start, 400);
  wv.addEventListener('did-start-loading', () => {
    P.loading = true;
    const st = $('#pb-status');
    st.hidden = false;
    st.textContent = 'Laden…';
  });
  wv.addEventListener('did-stop-loading', () => {
    P.loading = false;
    const st = $('#pb-status');
    st.hidden = true;
    setUrl(wv.getURL());
  });
  wv.addEventListener('did-navigate', (e) => setUrl(e.url));
  wv.addEventListener('did-navigate-in-page', (e) => e.isMainFrame && setUrl(e.url));
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;
    const st = $('#pb-status');
    st.hidden = false;
    st.textContent = `Kon niet laden: ${e.errorDescription || e.errorCode}`;
  });
  wv.addEventListener('page-title-updated', (e) => {
    P.title = e.title;
  });
  return wv;
}

// De agent kan deze browser lezen en bedienen (tool: paneel_browser).
const PANEL_SNAPSHOT_FN = function (max) {
  document.querySelectorAll('[data-orka-ref]').forEach((el) => el.removeAttribute('data-orka-ref'));
  const out = [];
  const els = document.querySelectorAll('a[href], button, input, textarea, select, [role="button"], [onclick], [contenteditable="true"], summary');
  let n = 0;
  for (const el of els) {
    if (n >= max) break;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
    const tag = el.tagName.toLowerCase();
    let label;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      label = `${tag}${el.type ? `[${el.type}]` : ''}${el.placeholder ? ` "${el.placeholder}"` : ''}${el.value ? ` = "${String(el.value).slice(0, 40)}"` : ''}`;
    } else {
      const text = (el.innerText || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 70);
      if (!text) continue;
      label = `${tag} "${text}"`;
    }
    n++;
    el.setAttribute('data-orka-ref', String(n));
    out.push(`[${n}] ${label}`);
  }
  return out.join('\n');
};

async function panelOp(op, args = {}) {
  const wv = initPanelBrowser();
  if (!wv) throw new Error('De browser in het zijpaneel is niet beschikbaar.');
  await panelWaitReady(wv);
  const run = (code) => wv.executeJavaScript(code, true);
  const snap = (max = 40) => run(`(${PANEL_SNAPSHOT_FN.toString()})(${Math.max(1, Math.min(Number(max) || 40, 80))})`);
  const pick = async (a) => {
    const sel = a.ref != null && a.ref !== '' ? `[data-orka-ref="${Number(a.ref)}"]` : a.selector;
    if (!sel) throw new Error('Geef een ref (uit read) of een CSS-selector.');
    return sel;
  };
  switch (op) {
    case 'state': {
      const url = wv.getURL() || '';
      const title = await run('document.title').catch(() => '');
      return { text: `Browserpaneel: ${title || '(geen titel)'} — ${url || 'about:blank'}` };
    }
    case 'read': {
      const max = Math.min(Number(args.max_chars) || 6000, 60000);
      const url = wv.getURL() || '';
      if (!url || url === 'about:blank') throw new Error('De browser in het paneel heeft nog geen pagina geladen. Gebruik eerst navigate.');
      const text = String(await run('(document.body ? document.body.innerText : "").slice(0, 200000)')).slice(0, max);
      const els = await snap(args.max_elements || 40);
      return { text: `${url}\n\n${text}${els ? `\n\nKlikbare elementen (refs voor click/type):\n${els}` : ''}` };
    }
    case 'navigate': {
      const url = normalizePanelUrl(args.url);
      if (!url) throw new Error('Geen URL opgegeven.');
      setPanelTab('browser');
      wv.loadURL(url).catch(() => {});
      await waitPanelLoad(wv, 20000);
      const title = await run('document.title').catch(() => '');
      const els = await snap(40);
      return { text: `Geladen: ${title || url} — ${wv.getURL()}\n\n${els || '(geen klikbare elementen)'}` };
    }
    case 'click': {
      const sel = await pick(args);
      const ok = await run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
      if (!ok) throw new Error('Element niet gevonden — maak eerst een nieuwe read.');
      await waitPanelLoad(wv, 8000);
      const els = await snap(40);
      return { text: `Geklikt. Nu: ${await run('document.title').catch(() => '')} — ${wv.getURL()}\n\n${els}` };
    }
    case 'type': {
      const sel = await pick(args);
      const res = await run(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return 'niet gevonden';
        el.focus();
        const value = ${JSON.stringify(String(args.value ?? ''))};
        if (el.isContentEditable) { el.textContent = value; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
        else {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          setter ? setter.call(el, value) : (el.value = value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        ${args.submit ? "el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); el.form?.requestSubmit?.();" : ''}
        return 'ok';
      })()`);
      if (res !== 'ok') throw new Error('Veld niet gevonden — maak eerst een nieuwe read.');
      if (args.submit) await waitPanelLoad(wv, 12000);
      return { text: `Getypt in ${sel}${args.submit ? ' en verzonden' : ''}. Nu: ${wv.getURL()}` };
    }
    case 'scroll':
      await run(`window.scrollBy(0, ${Number(args.amount) || 600}); true`);
      return { text: 'Gescrold.' };
    case 'eval': {
      const r = await run(String(args.code || 'null'));
      return { text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) };
    }
    default:
      throw new Error(`Onbekende actie: ${op}`);
  }
}

// ---- terminal ----
async function ensureTerminal(force = false) {
  const P = state.panel;
  const host = $('#pterm');
  if (!host || host.offsetParent === null) return; // pas starten als het paneel zichtbaar is
  if (!P.term) {
    const [{ Terminal }, { FitAddon }] = await Promise.all([import('./vendor/xterm.js'), import('./vendor/xterm-fit.js')]);
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    P.fit = new FitAddon();
    P.term = new Terminal({
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.22,
      cursorBlink: true,
      scrollback: 5000,
      theme: dark
        ? { background: '#1f1f1d', foreground: '#ecebe6', cursor: '#ecebe6', selectionBackground: '#3b3a36' }
        : { background: '#f6f6f8', foreground: '#18181b', cursor: '#18181b', selectionBackground: '#d8d8de' },
    });
    P.term.loadAddon(P.fit);
    P.term.open(host);
    P.term.onData((d) => P.termId && call('term:input', P.termId, d));
    P.term.onResize(({ cols, rows }) => P.termId && call('term:resize', P.termId, cols, rows));
    new ResizeObserver(() => {
      try {
        P.fit.fit();
      } catch {}
    }).observe(host);
  }
  try {
    P.fit.fit();
  } catch {}
  if (force || !P.termId) {
    if (P.termId) {
      await call('term:stop', P.termId);
      P.termId = null;
    }
    P.term.reset();
    // De eerste keer bouwt het hoofdproces de native helper; dat duurt even.
    if (!P.helperReady) {
      P.term.write('\x1b[2m[shell wordt gestart…]\x1b[0m\r\n');
      try {
        await call('term:prepare');
        P.helperReady = true;
      } catch (e) {
        P.term.write(`\r\n[terminal] ${e.message}\r\n`);
      }
    }
    try {
      const r = await call('term:start', { cols: P.term.cols || 80, rows: P.term.rows || 24, cwd: state.session?.workspace });
      P.termId = r.id;
      $('#pterm-info').textContent = `shell · ${shortPath(r.cwd)}`;
    } catch (e) {
      P.term.write(`\r\n[terminal] ${e.message}\r\n`);
    }
    P.term.focus();
  }
}

function onTermEvent(ev) {
  const P = state.panel;
  if (!P.term || (ev.id && ev.id !== P.termId)) return;
  if (ev.type === 'data') P.term.write(ev.chunk);
  else if (ev.type === 'exit') {
    P.term.write(`\r\n[shell gestopt${ev.code ? ` (code ${ev.code})` : ''}] — klik op ↻ voor een nieuwe\r\n`);
    P.termId = null;
  }
}

// ---- bedrading ----
function bindPanel() {
  $('#btn-panel').addEventListener('click', () => panelToggle());
  $('#panel-close').addEventListener('click', () => panelToggle(false));
  document.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => setPanelTab(b.dataset.ptab)));

  const rz = $('#panel-resizer');
  rz.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('resizing');
    const move = (ev) => setPanelWidth(window.innerWidth - ev.clientX);
    const up = () => {
      document.body.classList.remove('resizing');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      saveCfg({ panelWidth: state.panel.width });
      try {
        state.panel.fit?.fit();
      } catch {}
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  const el = $('#pchat-input');
  el.addEventListener('input', pAutosize);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      panelSendMessage();
    }
  });
  $('#pchat-send').addEventListener('click', panelSendMessage);
  $('#pchat-new').addEventListener('click', panelNewSideChat);

  $('#ptodos-auto').addEventListener('change', (e) => saveCfg({ autoTodos: e.target.checked }));

  const url = $('#pb-url');
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = url.value.trim();
      url.blur();
      if (!raw) return;
      if (looksLikePanelUrl(raw)) initPanelBrowser()?.loadURL(normalizePanelUrl(raw)).catch(() => {});
      else {
        // Geen adres maar een vraag of zoekopdracht: die gaat eerst naar DawgAgent,
        // die het opzoekt en het resultaat hier in het paneel opent.
        url.value = '';
        panelAskFromBar(raw);
      }
    } else if (e.key === 'Escape') {
      url.value = state.panel.browserUrl || '';
      url.blur();
    }
  });
  $('#pb-back').addEventListener('click', () => {
    const wv = initPanelBrowser();
    wv?.canGoBack?.() && wv.goBack();
  });
  $('#pb-fwd').addEventListener('click', () => {
    const wv = initPanelBrowser();
    wv?.canGoForward?.() && wv.goForward();
  });
  $('#pb-reload').addEventListener('click', () => initPanelBrowser()?.reload());
  $('#pb-external').addEventListener('click', () => {
    const u = state.panel.browserUrl || url.value;
    if (/^https?:/i.test(u)) call('app:openExternal', u);
  });
  $('#pterm-restart').addEventListener('click', () => ensureTerminal(true));
  $('#pterm-clear').addEventListener('click', () => state.panel.term?.clear());

  api.on('term:event', onTermEvent);
  api.on('ui:toast', (d) => toast(typeof d === 'string' ? d : d?.text || '', 'info'));
  api.on('panel:open', (d) => {
    // De zichtbaarheid van het paneel is leidend, niet de onthouden stand: als de agent
    // iets in het paneel wil zetten, moet het paneel ook echt openstaan.
    const visible = !$('#panel').hidden;
    if (!visible || (d?.tab && state.panel.tab !== d.tab)) panelToggle(true, d?.tab || state.panel.tab);
  });
  api.on('panel:request', async ({ id, op, args }) => {
    let result = null;
    let error = null;
    try {
      if ($('#panel').hidden) panelToggle(true, 'browser');
      result = await panelOp(op, args || {});
    } catch (e) {
      error = e.message;
    }
    call('panel:response', { id, result, error });
  });
}

// ---------- binding ----------
function bindUI() {
  document.querySelectorAll('.ic-slot').forEach((el) => el.replaceWith(icon(el.dataset.icon, 16)));
  $('#btn-new').addEventListener('click', newChat);
  document.querySelectorAll('.side-btn[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#panel-close').append(icon('x', 15));
  $('#pb-back').append(icon('back', 15));
  $('#pb-fwd').append(icon('forward', 15));
  $('#pb-reload').append(icon('refresh', 15));
  $('#pb-external').append(icon('external', 15));
  $('#pterm-restart').append(icon('refresh', 15));
  $('#pterm-clear').append(icon('x', 15));
  bindPanel();

  const el = input();
  el.addEventListener('input', () => {
    autosize();
    if (state.session?.kind === 'blox') blox.updateSlash(el.value);
    else blox?.hideSlash();
  });
  el.addEventListener('blur', () => setTimeout(() => blox?.hideSlash(), 150));
  el.addEventListener('keydown', (e) => {
    if (state.session?.kind === 'blox' && blox.onKeydown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!state.session?.running) sendMessage();
    }
  });
  el.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const sid = state.session.id;
    // Foto's en bestanden van het klembord: een screenshot, "Afbeelding kopiëren" in de browser,
    // of een bestand dat je in Finder hebt gekopieerd.
    const picked = [...(cd.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    const files = picked.length ? picked : [...(cd.files || [])];
    if (files.length) {
      e.preventDefault();
      for (const f of files) await attachFromFile(sid, f);
      return;
    }
    // Een gekopieerd bestand plakt als tekst met een pad. Bestaat het echt, dan wordt het een bijlage.
    const text = (cd.getData('text/uri-list') || cd.getData('text/plain') || '').trim();
    if (!text || /[\r\n]/.test(text) || !/^(file:\/\/|\/|~\/)/.test(text)) return;
    e.preventDefault();
    const path = text.replace(/^file:\/\//, '').split('#')[0].replace(/%20/g, ' ');
    const atts = await call('attach:paths', sid, [path]);
    if (atts?.length) addAttachments(Promise.resolve(atts));
    else document.execCommand('insertText', false, text); // geen bestaand bestand: gewoon als tekst plakken
  });

  $('#btn-send').addEventListener('click', sendMessage);
  $('#btn-attach').addEventListener('click', (e) => attachMenu(e.currentTarget));
  $('#chip-workspace').addEventListener('click', (e) => (state.session?.kind === 'blox' ? blox.studioMenu(e.currentTarget) : pickWorkspace()));
  $('#chip-mode').addEventListener('click', (e) => (state.session?.kind === 'blox' ? blox.modeMenu(e.currentTarget) : modeMenu(e.currentTarget)));
  $('#chip-study').addEventListener('click', (e) => studyMenu(e.currentTarget));
  $('#chip-blox').addEventListener('click', () => toggleBlox());
  $('#btn-blox').addEventListener('click', () => toggleBlox());
  $('#btn-git').addEventListener('click', () => git.openSyncModal());
  $('#brand').addEventListener('click', (e) => brandMenu(e.currentTarget));
  $('#chip-model').addEventListener('click', (e) => modelMenu(e.currentTarget));
  $('#chip-computer').addEventListener('click', toggleComputer);

  document.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const code = copy.closest('.codeblock')?.querySelector('code');
      if (code) navigator.clipboard.writeText(code.innerText);
      copy.textContent = 'Gekopieerd';
      setTimeout(() => (copy.textContent = 'Kopieer'), 1400);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newChat();
    } else if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      panelToggle();
    } else if (e.metaKey && e.key === ',') {
      e.preventDefault();
      showView('settings');
    } else if (e.key === 'Escape' && !e.defaultPrevented) {
      if (!$('#menu').hidden) closeMenu();
      else if (!$('#modal').hidden) closeModal();
      else if (state.session?.running && state.view === 'chat') call('chat:stop', state.session.id);
    }
  });

  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    $('#drop').hidden = false;
    $('.drop-inner').textContent = state.view === 'skills' ? 'Laat los om skills te importeren' : 'Laat los om toe te voegen';
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) $('#drop').hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    $('#drop').hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    const paths = files.map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length && !files.length) return;
    if (state.view === 'skills' && paths.length) {
      try {
        const names = await call('skills:importPaths', paths);
        toast(`Geïmporteerd: ${names.join(', ')}`);
        renderSkills();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    if (state.view !== 'chat') showView('chat');
    if (paths.length) addAttachments(call('attach:paths', state.session.id, paths));
    else for (const f of files) await attachFromFile(state.session.id, f); // uit een browser gesleept: geen bestand op schijf
  });

  window.addEventListener('resize', closeMenu);
}

// ---------- BloxCode ----------
let blox = null;

// ---------- GitHub-sync ----------
let git = null;

// ---------- The Brain ----------
let brainui = null;

// De agent (of de gebruiker) schrijft in The Brain: laat de graaf oplichten.
// Vraag in de chat stellen vanuit The Brain: het bericht klaarzetten in het invoerveld.
function askInChat(text) {
  showView('chat');
  const el = input();
  el.value = text;
  autosize();
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

function addPending(att) {
  state.pending.push(att);
  renderPending();
  input().focus();
}

// /foto <pad> of het foto-kiesvenster.
function addPhotos(arg) {
  const sid = state.session.id;
  const paths = (String(arg || '').match(/"[^"]+"|'[^']+'|(?:[^\s\\]|\\ )+/g) || [])
    .map((p) => p.replace(/^["']|["']$/g, '').replace(/\\ /g, ' ').replace(/^~(?=\/)/, state.info.home))
    .filter(Boolean);
  if (paths.length) return addAttachments(call('attach:paths', sid, paths));
  return addAttachments(call('attach:pick', sid, 'images'));
}

// BloxCode is geen aparte ruimte meer, maar een schakelaar per chat (zoals Computer use):
// aan = deze chat gebruikt de Roblox Studio-tools, het BloxCode-geheugen en de BloxCode-modi.
async function toggleBlox(force) {
  const s = state.session;
  if (!s) return;
  if (s.running) return toast('Wacht tot deze chat klaar is met de beurt.', 'error');
  const on = force === undefined ? s.kind !== 'blox' : Boolean(force);
  try {
    state.session = await call('blox:setSession', s.id, on);
  } catch (e) {
    return toast(e.message, 'error');
  }
  if (on) {
    blox.ensureConnected();
    blox.refreshStatus();
    toast('BloxCode staat aan in deze chat — Studio, geheugen en de BloxCode-modi zijn actief.');
  } else {
    blox.hideSlash();
    toast('BloxCode staat uit in deze chat.');
  }
  await refreshSessions();
  renderChat();
  showView('chat');
}

async function init() {
  [state.cfg, state.info] = await Promise.all([call('config:get'), call('app:info')]);
  blox = createBlox({
    h, icon, call, toast, openMenu, openModal, closeModal, confirmDialog, btn, iconBtn, toggleSwitch, md, state,
    settingRow, fmtWhen, saveCfg, showView, newChat, openSession, addPending, addPhotos, toggleBlox,
    renderComposer: () => renderComposer(),
  });
  git = createGit({ h, icon, call, toast, openModal, closeModal, openMenu, btn, iconBtn, confirmDialog, settingRow, toggleSwitch, fmtWhen, state });
  brainui = createBrain({ h, icon, call, toast, openModal, closeModal, confirmDialog, btn, iconBtn, md, state, askInChat });
  bindUI();
  applyBrand();
  api.on('blox:changed', (st) => blox.onStatus(st));
  blox.refreshStatus();
  git.refresh();
  brainui.refresh();
  api.on('git:changed', () => git.refresh());
  api.on('brain:changed', (info) => brainui.onChanged(info));
  api.on('agent:event', onAgentEvent);
  api.on('browser:changed', () => browserRefresh?.());
  api.on('sessions:changed', () => refreshSessions());
  // Een chat die vanuit het browser-zijpaneel begint, openen we meteen in het venster.
  api.on('session:open', (id) => {
    if (id) openSession(id);
  });
  api.on('connectors:changed', (list) => {
    state.connectors = list;
    if (state.view === 'connectors') renderConnectors();
  });
  await refreshSessions();
  await newChat();
  // Zijpaneel in dezelfde stand zetten als bij het afsluiten.
  setPanelWidth(state.cfg.panelWidth || 400);
  state.panel.tab = state.cfg.panelTab || 'chat';
  document.querySelectorAll('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.ptab === state.panel.tab));
  if (state.cfg.panelOpen) panelToggle(true, state.panel.tab);
  if (!state.cfg.hasKey) showOnboarding();
}

init().catch((e) => {
  document.body.innerHTML = `<pre style="padding:30px;color:#c33;white-space:pre-wrap">DawgAgent kon niet starten:\n${escapeHtml(e.stack || e.message)}</pre>`;
});
