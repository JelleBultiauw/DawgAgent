// Taal van de app.
//
// De app volgt standaard de taal van de Mac: staat je computer in het Nederlands, dan is
// DawgAgent Nederlands; in het Engels Engels. In Instellingen kun je daarvan afwijken.
//
// Een taal toevoegen = één bestand: renderer/locales/<code>.js (zie renderer/locales/en.js).
// Dit bestand (het hoofdproces) leest die map om te weten wat er beschikbaar is en gebruikt
// dezelfde code voor de teksten die het zelf aan de gebruiker laat zien (dialoogvensters,
// foutmeldingen, de HUD).
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'renderer', 'locales');
const FALLBACK = 'en';
const NATIVE = 'nl'; // de taal waarin de app geschreven is

// De teksten die het hoofdproces zelf produceert. Alles wat de interface toont loopt via
// renderer/locales; dit is alleen voor dialoogvensters, foutmeldingen en de HUD.
const MAIN_STRINGS = {
  en: {
    'Kies een werkmap': 'Choose a workspace',
    'Kies de projectmap': 'Choose the project folder',
    'Bestanden toevoegen': 'Add files',
    'Map toevoegen': 'Add folder',
    "Foto's toevoegen": 'Add photos',
    'Skill importeren (map, SKILL.md of .zip)': 'Import skill (folder, SKILL.md or .zip)',
    'Skill niet gevonden': 'Skill not found',
    'Map niet gevonden.': 'Folder not found.',
    'Chat niet gevonden.': 'Chat not found.',
    'Wacht tot deze chat klaar is met de beurt en probeer het opnieuw.': 'Wait until this chat has finished its turn and try again.',
    'Geen SKILL.md gevonden in wat je hebt gekozen.': 'No SKILL.md found in what you picked.',
    'Dit lijkt geen geldige DeepSeek-sleutel. Hij begint met "sk-" — kopieer hem opnieuw van platform.deepseek.com.': 'This does not look like a valid DeepSeek key. It starts with "sk-" — copy it again from platform.deepseek.com.',
    'DawgAgent bestuurt je computer': 'DawgAgent is controlling your computer',
    'Bezig…': 'Working…',
    'Stop': 'Stop',
    'Geen geldige map.': 'Not a valid folder.',
    'Onbekende modus': 'Unknown mode',
    'Dit bestand kan niet gelezen worden.': 'This file cannot be read.',
    'Dit bestand is te groot om te openen.': 'This file is too large to open.',
    'Deze map kan niet gesynchroniseerd worden.': 'This folder cannot be synced.',
    'Geen wijzigingen om te pushen.': 'Nothing to push.',
    'Geen repo opgegeven.': 'No repo given.',
    'Geen URL opgegeven.': 'No URL given.',
    'De repo bestaat nog niet op GitHub.': 'The repo does not exist on GitHub yet.',
    'Deze repo bestaat nog niet op GitHub.': 'This repo does not exist on GitHub yet.',
    'Gebruiker heeft geannuleerd.': 'The user cancelled.',
    'Geannuleerd.': 'Cancelled.',
    // The Brain
    'Titel ontbreekt.': 'A title is required.',
    'Deze herinnering bestaat niet (meer).': 'This memory no longer exists.',
    'Eerste herinnering niet gevonden: ': 'First memory not found: ',
    'Tweede herinnering niet gevonden: ': 'Second memory not found: ',
    'Een herinnering kan niet aan zichzelf hangen.': 'A memory cannot link to itself.',
    'Verbinding niet gevonden.': 'Connection not found.',
    'Deze verbinding bestaat niet.': 'That connection does not exist.',
    'The Brain is vol (5000 herinneringen). Verwijder eerst iets.': 'The Brain is full (5000 memories). Delete something first.',
    // Study: teksten in de gegenereerde bronweergave (zijpaneel).
    "dia's": 'slides',
    'tabblad(en)': 'sheet(s)',
    'Study telt deze dia’s als dekking — niets wordt overgeslagen': 'Study counts these slides as coverage — nothing gets skipped',
    'Study gebruikt deze tabel als bron': 'Study uses this table as a source',
    'Study gebruikt dit bestand als bron': 'Study uses this file as a source',
    'Notities': 'Notes',
    'Geen tekst op deze dia.': 'No text on this slide.',
    'Let op:': 'Note:',
    'formule(s) of diagram(men) staan als wmf/emf en zijn hier niet zichtbaar. Vraag DawgAgent het deck als pdf te openen (via PowerPoint) voor de volledige weergave.':
      'formula(e) or diagram(s) are stored as wmf/emf and are not visible here. Ask DawgAgent to open the deck as pdf (via PowerPoint) for the full view.',
    '(leeg document)': '(empty document)',
    'document': 'document',
    'tekstbestand': 'text file',
    'Kon dit document niet lezen:': 'Could not read this document:',
  },
};

let cachedAvailable = null;
function available() {
  if (cachedAvailable) return cachedAvailable;
  try {
    cachedAvailable = fs
      .readdirSync(LOCALES_DIR)
      .map((f) => (f.match(/^([a-z]{2}(?:-[a-z]{2})?)\.js$/i) || [])[1])
      .filter(Boolean)
      .map((c) => c.toLowerCase())
      .sort();
  } catch {
    cachedAvailable = [];
  }
  if (!cachedAvailable.length) cachedAvailable = [NATIVE, FALLBACK];
  return cachedAvailable;
}

function base(code) {
  return String(code || '').toLowerCase().replace('_', '-');
}

// Alle talen die de Mac zelf aandraagt, in volgorde van voorkeur.
function systemLanguages() {
  const out = [];
  try {
    const { app } = require('electron');
    if (typeof app.getPreferredSystemLanguages === 'function') out.push(...app.getPreferredSystemLanguages());
    if (typeof app.getLocale === 'function') out.push(app.getLocale());
  } catch {}
  return out.map(base).filter(Boolean);
}

// Welke taal gebruiken we? Handmatige keuze uit de instellingen, anders de systeemtaal.
function detect() {
  const av = available();
  for (const lang of systemLanguages()) {
    if (av.includes(lang)) return lang;
    const short = lang.split('-')[0];
    if (av.includes(short)) return short;
  }
  return FALLBACK;
}

let current = null;
function locale() {
  if (current) return current;
  let chosen = 'auto';
  try {
    chosen = require('./store').getConfig().lang || 'auto';
  } catch {}
  current = chosen && chosen !== 'auto' && available().includes(base(chosen)) ? base(chosen) : detect();
  return current;
}

function systemLocale() {
  return systemLanguages()[0] || FALLBACK;
}

function t(text) {
  const str = String(text);
  const dict = MAIN_STRINGS[locale()];
  return (dict && dict[str]) || str;
}

// Naam van een taal in die taal zelf, voor het keuzemenu in Instellingen.
const LANGUAGE_NAMES = {
  nl: 'Nederlands',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  pl: 'Polski',
  sv: 'Svenska',
  da: 'Dansk',
  no: 'Norsk',
  fi: 'Suomi',
  tr: 'Türkçe',
  ru: 'Русский',
  uk: 'Українська',
  ar: 'العربية',
  he: 'עברית',
  hi: 'हिन्दी',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  id: 'Bahasa Indonesia',
  cs: 'Čeština',
  el: 'Ελληνικά',
  hu: 'Magyar',
  ro: 'Română',
  th: 'ไทย',
  vi: 'Tiếng Việt',
};
const languageName = (code) => LANGUAGE_NAMES[String(code).split('-')[0]] || String(code).toUpperCase();

function info() {
  const system = detect();
  return {
    locale: locale(),
    system,
    systemLanguages: systemLanguages(),
    systemName: languageName(system),
    available: available().map((code) => ({ code, name: languageName(code) })),
    currentName: languageName(locale()),
  };
}

// De teksten van het kleine venster dat verschijnt als DawgAgent de computer overneemt.
function hudStrings() {
  return {
    title: t('DawgAgent bestuurt je computer'),
    busy: t('Bezig…'),
    stop: t('Stop'),
  };
}

module.exports = { locale, detect, available, systemLanguages, systemLocale, languageName, info, t, hudStrings, NATIVE, FALLBACK };
