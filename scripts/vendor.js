// Bouwt een browserversie van highlight.js voor de interface (het npm-pakket is CommonJS).
// Draait automatisch na `npm install`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lib = path.join(root, 'node_modules', 'highlight.js', 'lib');
const LANGS = [
  'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'dockerfile', 'go', 'ini', 'java', 'javascript', 'json', 'kotlin', 'lua',
  'makefile', 'markdown', 'php', 'plaintext', 'python', 'r', 'ruby', 'rust', 'scss', 'shell', 'sql', 'swift', 'typescript', 'xml', 'yaml',
];

const wrap = (file) => `(() => {\nconst module = { exports: {} };\nconst exports = module.exports;\n${fs.readFileSync(file, 'utf8')}\nreturn module.exports;\n})()`;

let out = '// Automatisch gegenereerd door scripts/vendor.js — niet handmatig bewerken.\n';
out += `const hljs = ${wrap(path.join(lib, 'core.js'))};\n`;
for (const lang of LANGS) {
  const file = path.join(lib, 'languages', `${lang}.js`);
  if (fs.existsSync(file)) out += `hljs.registerLanguage('${lang}', ${wrap(file)});\n`;
}
out += 'export default hljs;\n';

const dest = path.join(root, 'renderer', 'vendor', 'highlight.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(`highlight.js gebundeld → ${path.relative(root, dest)} (${(out.length / 1024).toFixed(0)} KB)`);

// xterm.js voor het terminalpaneel (ES-modules, dus één-op-één over te nemen).
const vendor = path.join(root, 'renderer', 'vendor');
const copies = [
  [path.join(root, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.mjs'), path.join(vendor, 'xterm.js')],
  [path.join(root, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.mjs'), path.join(vendor, 'xterm-fit.js')],
  [path.join(root, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'), path.join(vendor, 'xterm.css')],
];
for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`${path.basename(to)} gekopieerd (${(fs.statSync(to).size / 1024).toFixed(0)} KB)`);
}
