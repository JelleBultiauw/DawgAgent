// Skills: mappen met een SKILL.md (frontmatter: name, description) — zelfde formaat als Claude Code.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PATHS, getConfig } = require('./store');

const execFileP = promisify(execFile);

function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const meta = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

function slug(name) {
  return (
    String(name)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `skill-${Date.now()}`
  );
}

function listSkills() {
  const disabled = new Set(getConfig().disabledSkills || []);
  const out = [];
  for (const entry of fs.readdirSync(PATHS.skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(PATHS.skills, entry.name);
    const file = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const { meta } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const name = meta.name || entry.name;
    out.push({ id: entry.name, name, description: meta.description || '', dir, enabled: !disabled.has(entry.name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function getSkill(name) {
  const skill = listSkills().find((s) => s.name === name || s.id === name);
  if (!skill) return null;
  const content = fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf8');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name !== 'SKILL.md') files.push(path.relative(skill.dir, abs));
    }
  };
  walk(skill.dir);
  return { ...skill, content, files };
}

function createSkill({ name, description, instructions }) {
  const id = slug(name);
  const dir = path.join(PATHS.skills, id);
  fs.mkdirSync(dir, { recursive: true });
  const md = `---\nname: ${name}\ndescription: ${String(description || '').replace(/\n/g, ' ')}\n---\n\n${instructions || ''}\n`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), md);
  return { id, dir };
}

function findSkillRoot(dir) {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return [dir];
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('__MACOSX')) found.push(...findSkillRoot(path.join(dir, e.name)));
  }
  return found;
}

// Importeer een skill-map, een .md-bestand of een .zip/.skill-archief.
async function importSkill(src) {
  const stat = fs.statSync(src);
  const imported = [];
  const copyDir = (dir) => {
    const { meta } = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
    const id = slug(meta.name || path.basename(dir));
    const dest = path.join(PATHS.skills, id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(dir, dest, { recursive: true });
    imported.push(meta.name || id);
  };
  if (stat.isDirectory()) {
    findSkillRoot(src).forEach(copyDir);
  } else if (/\.(zip|skill)$/i.test(src)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orka-skill-'));
    await execFileP('ditto', ['-x', '-k', src, tmp]);
    findSkillRoot(tmp).forEach(copyDir);
    fs.rmSync(tmp, { recursive: true, force: true });
  } else if (/\.md$/i.test(src)) {
    const text = fs.readFileSync(src, 'utf8');
    const { meta, body } = parseFrontmatter(text);
    const name = meta.name || path.basename(src, path.extname(src));
    createSkill({ name, description: meta.description || body.split('\n').find((l) => l.trim()) || '', instructions: body });
    imported.push(name);
  }
  if (!imported.length) throw new Error('Geen SKILL.md gevonden in wat je hebt gekozen.');
  return imported;
}

async function removeSkill(id) {
  const { shell } = require('electron');
  const dir = path.join(PATHS.skills, path.basename(id));
  if (fs.existsSync(dir)) await shell.trashItem(dir);
}

const SEED = [
  {
    name: 'skill-maker',
    description: 'Gebruik dit wanneer de gebruiker een nieuwe skill wil maken of een terugkerende werkwijze wil vastleggen.',
    instructions: `# Een skill maken

Een skill is een map in de skills-map van DawgAgent met een \`SKILL.md\`:

\`\`\`markdown
---
name: korte-naam
description: Eén zin die zegt WANNEER deze skill gebruikt moet worden.
---

# Titel
Stapsgewijze instructies, voorbeelden, valkuilen.
\`\`\`

Werkwijze:
1. Vraag (als het niet duidelijk is) wat de skill moet doen en wanneer hij moet triggeren.
2. Gebruik \`create_skill\` om hem aan te maken. Extra bestanden (scripts, sjablonen) kun je met \`write_file\` in dezelfde map zetten.
3. Houd de beschrijving specifiek: die bepaalt wanneer de skill later wordt gekozen.
`,
  },
  {
    name: 'spreadsheet-analyse',
    description: 'Gebruik dit bij het analyseren, opschonen of samenvatten van Excel-, CSV- of Numbers-bestanden.',
    instructions: `# Spreadsheets analyseren

1. Lees eerst de structuur met \`read_spreadsheet\` (tabbladen, kolommen, aantal rijen).
2. Voor berekeningen op veel rijen: schrijf een klein Python-script (pandas als het beschikbaar is, anders csv-module) en voer het uit met \`run_shell\`.
3. Rapporteer bevindingen kort: belangrijkste cijfers, opvallende uitschieters, en wat je hebt aangenomen.
4. Maak nooit het originele bestand kapot — schrijf resultaten naar een nieuw bestand naast het origineel.
`,
  },
];

function seedSkills() {
  const marker = path.join(PATHS.data, '.skills-seeded');
  if (fs.existsSync(marker)) return;
  for (const s of SEED) createSkill(s);
  fs.writeFileSync(marker, String(Date.now()));
}

module.exports = { listSkills, getSkill, createSkill, importSkill, removeSkill, seedSkills, parseFrontmatter };
