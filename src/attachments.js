// Verwerkt geüploade foto's, spreadsheets, documenten, PDF's en mappen.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const XLSX = require('xlsx');

const execFileP = promisify(execFile);

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tif', '.tiff'];
const SHEET_EXT = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv', '.tsv', '.numbers'];
const DOC_EXT = ['.docx', '.doc', '.rtf', '.odt', '.html', '.htm', '.webarchive'];
const PRESENTATION_EXT = ['.pptx', '.ppt'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build', '.DS_Store']);
const MAX_TEXT = 40000;

function kindOf(p) {
  const ext = path.extname(p).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (SHEET_EXT.includes(ext)) return 'sheet';
  if (ext === '.pdf') return 'pdf';
  if (PRESENTATION_EXT.includes(ext)) return 'presentation';
  if (DOC_EXT.includes(ext)) return 'doc';
  return 'file';
}

function isTextFile(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return !buf.subarray(0, n).includes(0);
  } catch {
    return false;
  }
}

function clip(text, max = MAX_TEXT) {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n… [ingekort: ${text.length - max} tekens weggelaten]`, truncated: true };
}

function uniqueCopy(src, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(src);
  const base = path.basename(src, ext);
  let dest = path.join(dir, `${base}${ext}`);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base}-${i}${ext}`);
  fs.copyFileSync(src, dest);
  return dest;
}

function sheetToText(p, { maxRows = 200, sheet } = {}) {
  const wb = XLSX.readFile(p, { cellDates: true, dense: true });
  const names = sheet ? wb.SheetNames.filter((n) => n === sheet) : wb.SheetNames;
  if (sheet && !names.length) throw new Error(`Tabblad "${sheet}" niet gevonden. Tabbladen: ${wb.SheetNames.join(', ')}`);
  const parts = [`Tabbladen: ${wb.SheetNames.map((n) => `"${n}"`).join(', ')}`];
  for (const name of names) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_csv(ws, { blankrows: false }).split('\n');
    const ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
    const cols = ref ? ref.e.c - ref.s.c + 1 : 0;
    parts.push(`\n## Tabblad "${name}" — ${rows.length} rijen × ${cols} kolommen (CSV)`);
    parts.push(rows.slice(0, maxRows).join('\n'));
    if (rows.length > maxRows) parts.push(`… nog ${rows.length - maxRows} rijen (gebruik read_spreadsheet met max_rows voor meer)`);
  }
  return parts.join('\n');
}

async function pdfText(p) {
  const script =
    "ObjC.import('PDFKit'); function run(argv){ var d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0])); if(!d||d.isNil()) return ''; var s=d.string; return (s&&!s.isNil())?('Pagina\\'s: '+d.pageCount+'\\n\\n'+s.js):''; }";
  const { stdout } = await execFileP('osascript', ['-l', 'JavaScript', '-e', script, p], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

async function docText(p) {
  const { stdout } = await execFileP('textutil', ['-convert', 'txt', '-stdout', p], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

function tree(dir, { maxEntries = 400, maxDepth = 4 } = {}) {
  const lines = [];
  let count = 0;
  const visit = (d, depth) => {
    if (depth > maxDepth || count >= maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      if (count++ >= maxEntries) {
        lines.push(`${'  '.repeat(depth)}…`);
        return;
      }
      lines.push(`${'  '.repeat(depth)}${e.name}${e.isDirectory() ? '/' : ''}`);
      if (e.isDirectory()) visit(path.join(d, e.name), depth + 1);
    }
  };
  visit(dir, 0);
  return lines.join('\n');
}

// Maakt van een afbeelding een API-vriendelijke JPEG/PNG (max 2048px).
async function prepareImage(p, dir) {
  const ext = path.extname(p).toLowerCase();
  const needsConvert = !['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
  const big = fs.statSync(p).size > 4 * 1024 * 1024;
  if (!needsConvert && !big) return p;
  const out = path.join(dir, `${path.basename(p, ext)}-api.jpg`);
  await execFileP('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', '2048', p, '--out', out], { timeout: 30000 });
  return out;
}

async function extractText(p) {
  const kind = kindOf(p);
  if (kind === 'sheet') return sheetToText(p);
  if (kind === 'pdf') return (await pdfText(p)) || '(Geen tekst gevonden — mogelijk een gescande PDF.)';
  if (kind === 'presentation') return presentationText(p);
  if (kind === 'doc') return docText(p);
  if (isTextFile(p)) return fs.readFileSync(p, 'utf8');
  return null;
}

// Presentaties: alle dia's met hun tekst en notities. Study gebruikt dit als
// volledige inhoudsopgave, zodat er geen dia wordt overgeslagen.
function presentationText(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext !== '.pptx') {
    return '(Oud .ppt-formaat — niet uit te lezen. Vraag de gebruiker het als .pptx of pdf op te slaan, of open het in het paneel via PowerPoint.)';
  }
  try {
    return require('./study').slidesText(p);
  } catch (e) {
    return `(Kon de presentatie niet uitlezen: ${e.message})`;
  }
}

async function processPath(src, filesDir) {
  const stat = fs.statSync(src);
  const id = crypto.randomBytes(6).toString('hex');
  if (stat.isDirectory()) {
    return { id, kind: 'folder', name: path.basename(src), path: src, text: tree(src) };
  }
  const inside = path.resolve(src).startsWith(path.resolve(filesDir));
  const dest = inside ? src : uniqueCopy(src, filesDir);
  const kind = kindOf(dest);
  const att = { id, kind, name: path.basename(src), path: dest, original: src, size: stat.size };
  try {
    if (kind === 'image') {
      att.apiPath = await prepareImage(dest, filesDir);
    } else {
      const text = await extractText(dest);
      if (text != null) Object.assign(att, clip(text, kind === 'presentation' ? 60000 : MAX_TEXT));
      else att.text = '(Binair bestand — gebruik tools zoals run_shell om het te inspecteren.)';
    }
  } catch (e) {
    att.text = `(Kon inhoud niet lezen: ${e.message})`;
  }
  return att;
}

// Tekstblok dat samen met het bericht naar het model gaat.
function attachmentBlock(att) {
  if (att.kind === 'folder') return `<map naam="${att.name}" pad="${att.path}">\n${att.text}\n</map>`;
  if (att.kind === 'image') return `<afbeelding naam="${att.name}" pad="${att.path}" />`;
  return `<bestand naam="${att.name}" soort="${att.kind}" pad="${att.path}"${att.truncated ? ' ingekort="ja"' : ''}>\n${att.text || ''}\n</bestand>`;
}

module.exports = { processPath, attachmentBlock, sheetToText, extractText, kindOf, tree, isTextFile, prepareImage, clip };
