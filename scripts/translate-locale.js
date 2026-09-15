// Een nieuwe taal toevoegen aan DawgAgent.
//
//   node_modules/.bin/electron scripts/translate-locale.js <code>
//   bijvoorbeeld:  node_modules/.bin/electron scripts/translate-locale.js fr
//
// Het script pakt de Engelse woordenlijst (renderer/locales/en.js), laat hem door je eigen
// model vertalen en schrijft renderer/locales/<code>.js. Daarna pakt DawgAgent de taal
// automatisch op als je Mac in die taal staat (of kies hem in Instellingen → Taal).
//
// Met --proef doe je een kleine proefvertaling zonder iets weg te schrijven.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { quickChat } = require('../src/llm');
const { getConfig, getApiKey } = require('../src/store');
const { languageName } = require('../src/i18n');

const LOCALES = path.join(__dirname, '..', 'renderer', 'locales');
const BATCH = 40;

const args = process.argv.slice(2).filter((a) => a !== '.');
const PROEF = args.includes('--proef');
const CODE = args.find((a) => /^[a-z]{2}(-[a-z]{2})?$/i.test(a));

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`Geen JSON in het antwoord: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

async function translateBatch({ cfg, apiKey, target, entries }) {
  const payload = Object.fromEntries(entries);
  const prompt = `You translate the user interface of a desktop app from English to ${target}.
Rules:
- Return ONLY a JSON object with exactly the same keys, values translated.
- Keep it short: buttons and labels must stay short.
- Never translate product names: DawgAgent, DawgSecretAgent, BloxCode, DeepSeek, GitHub, Roblox, Studio, Chrome, MCP, SKILL.md, AGENTS.md, Finder, macOS.
- Keep placeholders like $1, $2, {n}, ⌘N, ⌘⇧B and emoji exactly as they are.
- Keep the tone the same (direct, no filler). Do not add punctuation that was not there.
Input JSON:
${JSON.stringify(payload, null, 1)}`;

  const answer = await quickChat({ cfg, apiKey, messages: [{ role: 'user', content: prompt }], maxTokens: 8000 });
  return parseJson(answer);
}

async function main() {
  if (!CODE) {
    console.log('Gebruik: electron scripts/translate-locale.js <taalcode> [--proef]');
    console.log('Voorbeeld: electron scripts/translate-locale.js fr');
    process.exit(1);
  }
  const target = languageName(CODE) === CODE.toUpperCase() ? CODE : languageName(CODE);
  const mod = await import(pathToFileURL(path.join(LOCALES, 'en.js')).href);
  const source = mod.default;

  const entries = PROEF ? Object.entries(source.strings).slice(0, 5) : Object.entries(source.strings);
  const cfg = { ...getConfig(), thinking: 'off' };
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('Geen DeepSeek-sleutel gevonden. Zet hem eerst in DawgAgent bij Instellingen → Model & API.');
    process.exit(1);
  }

  console.log(`Vertaal ${entries.length} teksten naar ${target} (${CODE})…`);
  const result = {};
  const batches = chunk(entries, BATCH);
  for (const [i, batch] of batches.entries()) {
    process.stdout.write(`  ${i + 1}/${batches.length}… `);
    const out = await translateBatch({ cfg, apiKey, target, entries: batch });
    for (const [key] of batch) result[key] = out[key] || key;
    console.log('ok');
  }

  if (PROEF) {
    console.log('Proefvertaling:');
    for (const [k, v] of Object.entries(result)) console.log(`  ${k}  →  ${v}`);
    app.exit(0);
    return;
  }

  // De patronen (teksten met wisselende stukken) gaan in één keer mee.
  let patterns = [];
  if (source.patterns?.length) {
    console.log(`Vertaal ${source.patterns.length} patronen…`);
    const prompt = `You translate user interface text of a desktop app to ${target}.
Below is a JSON array of [regular expression, replacement] pairs. Translate ONLY the replacement part.
Rules:
- Keep every $1, $2 … placeholder exactly where it belongs in the sentence.
- Keep regular expressions unchanged (they stay in English/Dutch input form) — only translate the replacement text.
- The regex matches text from an older version of the app and is NOT translated.
Return ONLY the JSON array with translated replacements.
${JSON.stringify(source.patterns.map(([re, to]) => [re.source, to]), null, 1)}`;
    const answer = await quickChat({ cfg, apiKey, messages: [{ role: 'user', content: prompt }], maxTokens: 8000 });
    const start = answer.indexOf('[');
    const end = answer.lastIndexOf(']');
    const parsed = JSON.parse(answer.slice(start, end + 1));
    patterns = parsed.map(([re, to], i) => [source.patterns[i][0], to]);
  }

  const lines = [
    `// ${target} — automatisch vertaald met scripts/translate-locale.js.`,
    '// Verbeter gerust wat je tegenkomt: het is gewone tekst in een woordenlijst.',
    'export default {',
    '  strings: {',
    ...Object.entries(result).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    '  },',
    '  patterns: [',
    ...patterns.map(([re, to]) => `    [${re}, ${JSON.stringify(to)}],`),
    '  ],',
    '};',
    '',
  ];
  const file = path.join(LOCALES, `${CODE}.js`);
  fs.writeFileSync(file, lines.join('\n'));

  // Zet de nieuwe taal in de importlijst van renderer/i18n.js.
  const i18nFile = path.join(__dirname, '..', 'renderer', 'i18n.js');
  let src = fs.readFileSync(i18nFile, 'utf8');
  const varName = CODE.replace(/[^a-z0-9]/gi, '_');
  if (!src.includes(`./locales/${CODE}.js`)) {
    const importLines = src.match(/^import .*$/gm) || [];
    const last = importLines[importLines.length - 1];
    src = src.replace(last, `${last}\nimport ${varName} from './locales/${CODE}.js';`);
    src = src.replace(/const DICTS = \{([^}]*)\};/, (_m, inner) => {
      const list = inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .concat(varName);
      return `const DICTS = { ${[...new Set(list)].join(', ')} };`;
    });
    fs.writeFileSync(i18nFile, src);
    console.log(`renderer/i18n.js bijgewerkt met ${CODE}.`);
  }

  console.log(`\nKlaar: ${file}`);
  console.log('DawgAgent herstarten en de taal staat erin (automatisch bij een Mac in die taal, anders via Instellingen → Taal).');
  app.exit(0);
}

app.whenReady().then(() => main().catch((e) => {
  console.error('Mislukt:', e.message);
  app.exit(1);
}));
