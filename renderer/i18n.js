// Vertalingen voor de interface (de taal waarin de app geschreven is: Nederlands).
//
// Een taal toevoegen:
//   1. maak renderer/locales/<code>.js (kopieer en.js als voorbeeld),
//   2. zet hem hieronder in de importlijst,
//   3. klaar — DawgAgent pakt hem automatisch als je Mac in die taal staat.
import en from './locales/en.js';

const DICTS = { en };

// De taal die het hoofdproces heeft gekozen (systeemtaal, of wat je in Instellingen koos).
const fromMain = typeof window !== 'undefined' && window.orka && window.orka.locale ? window.orka.locale : null;

export const SOURCE_LOCALE = 'nl';
export const FALLBACK_LOCALE = 'en';

export const locale = (() => {
  const code = String(fromMain || '').toLowerCase();
  if (code === SOURCE_LOCALE) return SOURCE_LOCALE;
  if (DICTS[code]) return code;
  const short = code.split('-')[0];
  if (DICTS[short]) return short;
  return FALLBACK_LOCALE;
})();

/** Is er voor deze taal een echte vertaling (dus niet het Nederlands van de bron)? */
export const translated = locale !== SOURCE_LOCALE && Boolean(DICTS[locale]);

// Voor datums, tijden en getallen: dezelfde taal als de interface.
export const dateLocale = locale === 'nl' ? 'nl-NL' : locale === 'en' ? 'en-GB' : locale;

const dict = DICTS[locale] || { strings: {}, patterns: [] };
const strings = dict.strings || {};
const patterns = (dict.patterns || []).map(([re, to]) => [re instanceof RegExp ? re : new RegExp(re), to]);

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Vertaalt één stukje tekst. Onbekend blijft zoals het is. Wat tussen de wisselende
// stukken van een patroon staat (een modus, een titel) gaat er zelf ook doorheen.
function tDepth(text, depth) {
  const str = String(text);
  if (!str) return str;
  if (has(strings, str)) return strings[str];
  for (const [re, to] of patterns) {
    if (!re.test(str)) continue;
    return str.replace(re, (...args) => {
      const groups = args.slice(0, -2);
      return String(to).replace(/\$(\d+)/g, (m, i) => {
        const value = groups[Number(i)];
        if (value == null) return m;
        return depth > 0 ? tDepth(value, depth - 1) : value;
      });
    });
  }
  return str;
}

/** Vertaalt één stukje tekst. Onbekend blijft zoals het is. */
export function t(text) {
  if (text == null) return text;
  if (!translated) return String(text);
  return tDepth(text, 2);
}

// ---------------------------------------------------------------------------
// De interface zelf: tekst en labels in de pagina worden bijgehouden en vertaald.
// Zo hoeft niemand alle teksten in de code aan te raken: wat op het scherm komt,
// gaat er langs hier.
// ---------------------------------------------------------------------------

// Hier blijft de tekst staan die van de gebruiker of van het model komt. Die vertalen
// we nooit: een Nederlands antwoord in een Engelse app zou onleesbaar worden.
const SKIP = [
  '.md',
  '.bubble',
  '.user-msg',
  '.step-out',
  '.reasoning-text',
  '.diff',
  'pre',
  'code',
  'textarea',
  'input',
  'select',
  'option',
  'script',
  'style',
  'xterm',
  '.pterm',
  '.pb-view',
  '[data-i18n-skip]',
  '[contenteditable]',
].join(',');

const ATTRS = ['title', 'placeholder', 'aria-label'];
const applied = new WeakMap(); // node -> de tekst die wij er het laatst neerzetten

let running = false;

function skipped(el) {
  return !el || !el.closest || el.closest(SKIP);
}

function translateTextNode(node) {
  const el = node.parentElement;
  if (skipped(el)) return;
  const raw = node.nodeValue;
  if (!raw || !/[a-zA-Z]/.test(raw)) return;
  if (applied.get(node) === raw) return; // al gedaan, niet nog een keer (voorkomt lussen)
  const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = m[2];
  if (!core) return;
  const out = t(core);
  if (out === core) return;
  applied.set(node, `${m[1]}${out}${m[3]}`);
  node.nodeValue = `${m[1]}${out}${m[3]}`;
}

function translateAttrs(el) {
  if (!el || el.nodeType !== 1) return;
  const isField = el.matches?.('input, textarea, select');
  // Van invoervelden vertalen we alleen het label (placeholder, title), nooit de inhoud.
  if (!isField && skipped(el)) return;
  for (const name of ATTRS) {
    if (!el.hasAttribute(name)) continue;
    const raw = el.getAttribute(name);
    if (!raw || !/[a-zA-Z]/.test(raw)) continue;
    if (applied.get(el) === `${name}:${raw}`) continue;
    const out = t(raw);
    if (out === raw) continue;
    applied.set(el, `${name}:${out}`);
    el.setAttribute(name, out);
  }
}

function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) return translateTextNode(root);
  if (root.nodeType !== 1) return;
  translateAttrs(root);
  if (skipped(root)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  while (node) {
    if (node.nodeType === 3) translateTextNode(node);
    else translateAttrs(node);
    node = walker.nextNode();
  }
}

function applyToPage() {
  if (running || !translated) return;
  running = true;
  try {
    walk(document.body);
    const title = t(document.title);
    if (title !== document.title) document.title = title;
    const html = document.documentElement;
    if (html.lang !== locale) html.lang = locale;
  } finally {
    running = false;
  }
}

let observer = null;
function startObserver() {
  if (observer || !translated) return;
  observer = new MutationObserver((mutations) => {
    if (running) return;
    running = true;
    try {
      for (const m of mutations) {
        if (m.type === 'characterData') translateTextNode(m.target);
        else if (m.type === 'attributes') translateAttrs(m.target);
        else for (const node of m.addedNodes) walk(node);
      }
    } finally {
      running = false;
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

/** Vertaalt de pagina nu en houdt daarna alles wat erbij komt bij. */
export function startI18n() {
  if (!translated) return;
  applyToPage();
  startObserver();
  // Sommige onderdelen worden pas na de eerste ronde gevuld (status, menu's, lijsten).
  setTimeout(applyToPage, 60);
  setTimeout(applyToPage, 400);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startI18n, { once: true });
  else startI18n();
}

export default { t, locale, translated, dateLocale, startI18n, SOURCE_LOCALE, FALLBACK_LOCALE };
