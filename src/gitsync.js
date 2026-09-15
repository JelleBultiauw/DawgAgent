// GitHub-sync: elk project (een map) heeft zijn eigen repo. In één klik wordt alles
// gecommit en gepusht — met een commitnaam die je zelf kunt aanpassen.
// Geheimen (API-sleutels, tokens, .env-bestanden) komen nooit mee: voor elke push wordt
// de inhoud gescand en worden zulke bestanden automatisch in .gitignore gezet.
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');

const execFileP = promisify(execFile);
const HOME = os.homedir();
const APP_DIR = path.join(__dirname, '..');

// ---------- instellingen ----------
function defaultProjects() {
  const projects = [
    { id: 'penuraplicatie', name: 'penuraplicatie', path: APP_DIR, repo: 'git@github.com:JelleBultiauw/penuraplicatie.git', branch: 'main', enabled: true },
  ];
  // Een map met Roblox-broncode of een eigen .git: dat is vrijwel zeker het game-project.
  const candidates = [path.join(HOME, 'Documents', 'Robloxgimma'), path.join(HOME, 'Documents', 'HunterX'), path.join(HOME, 'Documents', 'Roblox')];
  const game = candidates.find((d) => fs.existsSync(d));
  if (game) projects.push({ id: 'roblox', name: 'Roblox-game', path: game, repo: '', branch: 'main', enabled: true });
  return projects;
}

function getGitConfig() {
  const cfg = store.getConfig();
  const git = cfg.git || {};
  const projects = Array.isArray(git.projects) && git.projects.length ? git.projects : defaultProjects();
  return { auto: Boolean(git.auto), projects: projects.map((p) => ({ ...p, id: String(p.id || p.path) })) };
}

function setGitConfig(patch = {}) {
  const next = { ...getGitConfig(), ...patch };
  next.projects = (next.projects || []).map((p) => ({ ...p, id: String(p.id || p.path), enabled: p.enabled !== false }));
  store.setConfig({ git: next });
  return next;
}

function project(id) {
  const p = getGitConfig().projects.find((x) => x.id === id);
  if (!p) throw new Error('Onbekend project.');
  if (!p.path || p.path === HOME || p.path === path.join(HOME, 'Library')) throw new Error('Deze map kan niet gesynchroniseerd worden.');
  return p;
}

// ---------- git-hulpjes ----------
async function git(cwd, args, { timeout = 180000 } = {}) {
  try {
    const { stdout, stderr } = await execFileP('git', args, {
      cwd,
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    });
    return { ok: true, out: stdout, err: stderr };
  } catch (e) {
    return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message || 'git-fout') };
  }
}

const isRepo = (dir) => fs.existsSync(path.join(dir, '.git'));

// ---------- geheimen ----------
// Sterke patronen: hiermee wordt de push tegengehouden.
const HARD_SECRETS = [
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'API-sleutel (sk-…)'],
  [/\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'GitHub-token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS-sleutel'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack-token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API-sleutel'],
  [/\bsk_live_[A-Za-z0-9]{20,}\b|\bpk_live_[A-Za-z0-9]{20,}\b/, 'Stripe-sleutel'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'privésleutel'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\./, 'JWT/supabase-sleutel'],
];
// Zachte patronen: alleen een waarschuwing.
const SOFT_SECRETS = [[/(?:api[_-]?key|apikey|secret|token|password|passwd)\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{16,}["']/i, 'lijkt op een sleutel in code']];

// Bestanden die nooit mee mogen (worden automatisch verborgen).
const SECRET_FILES = /(^|\/)(\.env(\.[^/]*)?|\.envrc|credentials\.json|secrets?\.(json|ya?ml)|service[-_]?account\.json|id_rsa|id_ed25519|\.npmrc|\.pypirc|auth\.json)$|\.(pem|p12|pfx|keystore|jks|key)$/i;
const GITIGNORE_BLOCK = [
  '# penuraplicatie: nooit meepushen',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  'credentials.json',
  'service-account.json',
  '.DS_Store',
  'node_modules/',
];

function scanText(text, file, out) {
  for (const [re, label] of HARD_SECRETS) {
    const m = text.match(re);
    if (m && !out.block.some((h) => h.file === file && h.label === label)) out.block.push({ file, line: text.slice(0, m.index).split('\n').length, label });
  }
  for (const [re, label] of SOFT_SECRETS) {
    const m = text.match(re);
    if (m && !out.soft.some((h) => h.file === file && h.label === label)) out.soft.push({ file, line: text.slice(0, m.index).split('\n').length, label });
  }
}

function readTextFile(abs, max = 2_000_000) {
  try {
    if (fs.statSync(abs).size > max) return null;
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) return null; // binair
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

// Scant de bestanden die klaarstaan om te committen.
function scanFiles(dir, files) {
  const out = { block: [], soft: [], hidden: [] };
  for (const f of files.slice(0, 400)) {
    if (SECRET_FILES.test(f)) {
      out.hidden.push(f);
      continue;
    }
    const text = readTextFile(path.join(dir, f));
    if (text) scanText(text, f, out);
  }
  return out;
}

// .gitignore aanvullen met de basisregels (laat bestaande inhoud staan).
function ensureGitignore(dir) {
  const file = path.join(dir, '.gitignore');
  let cur = '';
  try {
    cur = fs.readFileSync(file, 'utf8');
  } catch {}
  const lines = new Set(cur.split('\n').map((l) => l.trim()));
  const missing = GITIGNORE_BLOCK.filter((l) => !l.startsWith('#') && !lines.has(l));
  if (!missing.length) return false;
  const head = cur.trim() ? `${cur.replace(/\s*$/, '')}\n\n` : '';
  fs.writeFileSync(file, `${head}# penuraplicatie: nooit meepushen\n${missing.join('\n')}\n`);
  return true;
}

// ---------- status van een project ----------
function parseStatus(out) {
  const items = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    let file = line.slice(3);
    if (file.includes(' -> ')) file = file.split(' -> ').pop();
    const status = code === '??' ? 'nieuw' : code.includes('D') ? 'verwijderd' : code.includes('R') ? 'hernoemd' : 'gewijzigd';
    items.push({ path: file, status });
  }
  return items;
}

async function changedFiles(dir) {
  return parseStatus((await git(dir, ['status', '--porcelain', '-uall'])).out || '');
}

// Voor een map die nog geen repo is: welke bestanden zouden mee gaan?
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'Pods', '.build']);
function listFiles(dir, cap = 400) {
  const out = [];
  const walk = (d, rel) => {
    if (out.length >= cap) return;
    let items = [];
    try {
      items = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (out.length >= cap) return;
      if (it.name === '.DS_Store') continue;
      const r = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name)) continue;
        walk(path.join(d, it.name), r);
      } else if (it.isSymbolicLink()) {
        continue;
      } else {
        out.push(r);
      }
    }
  };
  walk(dir, '');
  return out;
}

async function diffStat(dir, files) {
  const map = new Map();
  let r = await git(dir, ['diff', '--numstat', 'HEAD', '--']);
  if (!r.ok) r = await git(dir, ['diff', '--cached', '--numstat', '--']); // repo zonder commits
  for (const line of (r.out || '').split('\n')) {
    const [ins, del, ...rest] = line.split('\t');
    const file = rest.join('\t');
    if (!file) continue;
    map.set(file, { insertions: ins === '-' ? 0 : Number(ins) || 0, deletions: del === '-' ? 0 : Number(del) || 0 });
  }
  // Nieuwe bestanden die nog niet in de diff staan: regels tellen voor tekstbestanden.
  for (const f of files.filter((x) => x.status === 'nieuw' && !map.has(x.path))) {
    const text = readTextFile(path.join(dir, f.path), 400_000);
    if (text != null) map.set(f.path, { insertions: text.split('\n').length, deletions: 0 });
  }
  return map;
}

async function projectStatus(p) {
  const out = {
    ...p,
    exists: fs.existsSync(p.path),
    isRepo: false,
    isEmpty: false,
    branch: p.branch || 'main',
    remote: p.repo || '',
    ahead: 0,
    changes: [],
    stats: { files: 0, insertions: 0, deletions: 0 },
    secrets: { block: [], soft: [], hidden: [] },
    big: [],
    lastCommit: null,
    dirty: false,
    error: null,
  };
  if (!out.exists) {
    out.error = 'Map bestaat niet (meer).';
    return out;
  }
  out.isRepo = isRepo(p.path);
  if (!out.isRepo) {
    // Nog geen repo: laat toch zien wat er klaarstaat voor de eerste push.
    const files = listFiles(p.path);
    out.changes = files.map((f) => ({ path: f, status: 'nieuw', insertions: 0, deletions: 0 }));
    const stats = await diffStat(p.path, out.changes);
    for (const c of out.changes) {
      c.insertions = (stats.get(c.path) || {}).insertions || 0;
      c.deletions = (stats.get(c.path) || {}).deletions || 0;
    }
    out.stats = out.changes.reduce((a, c) => ({ files: a.files + 1, insertions: a.insertions + c.insertions, deletions: a.deletions + c.deletions }), { files: 0, insertions: 0, deletions: 0 });
    out.secrets = scanFiles(p.path, files);
    out.dirty = files.length > 0;
    out.newRepo = true;
    out.suggestion = 'Eerste versie via penuraplicatie';
    return out;
  }

  const br = await git(p.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (br.ok) out.branch = br.out.trim() || out.branch;
  const rem = await git(p.path, ['remote', 'get-url', 'origin']);
  if (rem.ok && rem.out.trim()) out.remote = rem.out.trim();
  const head = await git(p.path, ['rev-parse', '--short', 'HEAD']);
  out.isEmpty = !head.ok;
  const log = await git(p.path, ['log', '-1', '--format=%h|%s|%cr']);
  if (log.ok && log.out.trim()) {
    const [sha, subject, when] = log.out.trim().split('|');
    out.lastCommit = { sha, subject, when };
  }
  const changes = await changedFiles(p.path);
  if (changes.length) {
    const stats = await diffStat(p.path, changes);
    for (const c of changes) {
      const s = stats.get(c.path) || {};
      c.insertions = s.insertions || 0;
      c.deletions = s.deletions || 0;
      try {
        if (fs.statSync(path.join(p.path, c.path)).size > 50 * 1024 * 1024) out.big.push({ path: c.path });
      } catch {}
    }
    out.secrets = scanFiles(p.path, changes.map((c) => c.path));
    out.stats = changes.reduce((a, c) => ({ files: a.files + 1, insertions: a.insertions + c.insertions, deletions: a.deletions + c.deletions }), { files: 0, insertions: 0, deletions: 0 });
  }
  const up = await git(p.path, ['rev-list', '--count', '@{u}..HEAD']);
  out.ahead = up.ok ? Number(up.out.trim()) || 0 : 0;
  out.changes = changes.slice(0, 300);
  out.dirty = changes.length > 0 || out.ahead > 0;
  out.suggestion = out.dirty ? suggestMessage({ ...p, stats: out.stats }) : '';
  if (out.newRepo) out.suggestion = 'Eerste versie via penuraplicatie';
  return out;
}

async function status() {
  const { auto, projects } = getGitConfig();
  const list = [];
  for (const p of projects) list.push(await projectStatus(p));
  return { auto, projects: list, gh: await ghStatus(), detected: detect() };
}

// ---------- duwen ----------
// Verbergt geheime bestanden, scant de rest en zet alles in één commit (en pusht).
async function pushProject(id, { message = '', force = false, branch } = {}) {
  const p = project(id);
  if (!fs.existsSync(p.path)) throw new Error(`Map niet gevonden: ${p.path}`);
  const target = branch || p.branch || 'main';
  const steps = [];

  if (!isRepo(p.path)) {
    const init = await git(p.path, ['init', '-b', target]);
    if (!init.ok) throw new Error(`git init mislukte: ${init.err}`);
    steps.push('git init');
  }
  if (ensureGitignore(p.path)) steps.push('.gitignore bijgewerkt');

  // Geheime bestanden uit de index houden (en negeren via .gitignore).
  const before = await changedFiles(p.path);
  const secretFiles = before.filter((c) => SECRET_FILES.test(c.path)).map((c) => c.path);
  for (const f of secretFiles) await git(p.path, ['rm', '--cached', '--ignore-unmatch', '--quiet', '--', f]);

  const add = await git(p.path, ['add', '-A', '--', '.']);
  if (!add.ok) throw new Error(`git add mislukte: ${add.err}`);

  const staged = (await git(p.path, ['diff', '--cached', '--name-only'])).out.split('\n').map((l) => l.trim()).filter(Boolean);
  const ahead = Number((await git(p.path, ['rev-list', '--count', '@{u}..HEAD'])).out.trim()) || 0;
  if (!staged.length && !ahead) {
    return { ok: true, nothing: true, project: p.name, message: 'Geen wijzigingen.', files: [], hidden: secretFiles, activity: activity() };
  }
  const secrets = scanFiles(p.path, staged);
  if (secrets.block.length && !force) {
    return { ok: false, blocked: true, project: p.name, secrets, files: staged.length, hidden: secretFiles, error: 'Geheimen gevonden — er is niets gepusht.' };
  }

  const stat = await diffStat(p.path, await changedFiles(p.path));
  const messageArg = String(message || '').trim();
  let subject = messageArg;
  let commit = { ok: true, out: '' };
  if (staged.length) {
    if (!subject) {
      const st = await projectStatus(p);
      subject = suggestMessage({ ...p, stats: st.stats });
    }
    commit = await git(p.path, ['commit', '-m', subject, '--no-verify']);
    if (!commit.ok && !/nothing to commit|niets toe te voegen|no changes added/i.test(commit.err)) throw new Error(`git commit mislukte: ${commit.err.trim()}`);
    steps.push(`commit (${staged.length} bestanden)`);
  } else if (!messageArg) {
    subject = 'Automatische sync via penuraplicatie';
  }

  const repoUrl = String(p.repo || '').trim();
  let pushed = false;
  if (repoUrl) {
    const cur = await git(p.path, ['remote', 'get-url', 'origin']);
    if (!cur.ok) await git(p.path, ['remote', 'add', 'origin', repoUrl]);
    else if (cur.out.trim() !== repoUrl) await git(p.path, ['remote', 'set-url', 'origin', repoUrl]);
    const push = await git(p.path, ['push', '-u', 'origin', target], { timeout: 900000 });
    if (!push.ok) {
      const err = (push.err.trim() || push.out.trim()).split('\n').slice(-4).join('\n');
      const hint = /Repository not found|does not exist/i.test(err)
        ? ' De repo bestaat nog niet op GitHub: maak hem aan met "Repo aanmaken" of pas de URL aan.'
        : /Permission denied|publickey/i.test(err)
          ? ' Geen toegang via SSH — controleer je SSH-sleutel bij GitHub.'
          : '';
      return { ok: false, project: p.name, error: `git push mislukte: ${err}${hint}`, steps, secrets, files: staged.length, hidden: secretFiles };
    }
    pushed = true;
    steps.push(`push naar ${repoUrl.replace(/^git@github\.com:/, '').replace(/\.git$/, '')}`);
  } else {
    steps.push('alleen commit (nog geen repo-URL)');
  }

  const sha = (await git(p.path, ['rev-parse', '--short', 'HEAD'])).out.trim();
  const files = staged.map((f) => ({ path: f, insertions: (stat.get(f) || {}).insertions || 0, deletions: (stat.get(f) || {}).deletions || 0 }));
  const entry = files.length ? logActivity({ project: p.name, projectId: p.id, repo: repoUrl, sha, message: subject || 'sync', files, hidden: secretFiles }) : null;
  return { ok: true, project: p.name, sha, message: subject, steps, files, hidden: secretFiles, secrets, pushed, entry, activity: activity() };
}

async function pushAll({ messages = {}, force = false } = {}) {
  const results = [];
  for (const p of getGitConfig().projects.filter((x) => x.enabled !== false)) {
    try {
      const st = await projectStatus(p);
      if (!st.exists) {
        results.push({ ok: false, project: p.name, error: st.error });
        continue;
      }
      if (st.isRepo && !st.dirty) {
        results.push({ ok: true, project: p.name, nothing: true, message: 'Geen wijzigingen.' });
        continue;
      }
      results.push(await pushProject(p.id, { message: messages[p.id], force }));
    } catch (e) {
      results.push({ ok: false, project: p.name, error: e.message });
    }
  }
  return { results, activity: activity() };
}

// ---------- automatisch pushen ----------
// Na een beurt waarin iets is gewijzigd: zonder vragen één commit per project.
async function autoPush({ sessionId = null, title = '', request = '' } = {}) {
  const cfg = getGitConfig();
  if (!cfg.auto) return null;
  const done = [];
  for (const p of cfg.projects.filter((x) => x.enabled !== false)) {
    try {
      const st = await projectStatus(p);
      if (!st.exists || !st.isRepo || !st.remote || !st.dirty) continue;
      if (st.secrets.block.length) {
        done.push({ project: p.name, error: `geheimen gevonden in ${st.secrets.block.map((s) => s.file).join(', ')} — niets gepusht` });
        continue;
      }
      const r = await pushProject(p.id, { message: suggestMessage({ ...p, stats: st.stats }, { title, request }) });
      if (r.ok) done.push({ project: p.name, sha: r.sha, files: r.files.length, message: r.message, hidden: r.hidden });
      else done.push({ project: p.name, error: r.error || 'mislukt' });
    } catch (e) {
      done.push({ project: p.name, error: e.message });
    }
  }
  logTurn({ sessionId, title, request, pushed: done });
  return done.length ? done : null;
}

function suggestMessage(p, { title = '', request = '' } = {}) {
  const stat = p.stats || {};
  const base = String(request || title || '').replace(/\s+/g, ' ').trim();
  const subject = base ? base.slice(0, 68) : 'Automatische sync via penuraplicatie';
  const diff = stat.deletions ? `+${stat.insertions || 0} −${stat.deletions}` : `+${stat.insertions || 0}`;
  return `${subject}\n\n${stat.files || 0} bestand(en) · ${diff}\nvia penuraplicatie · GitHub-sync`;
}

// ---------- activiteit ----------
const activityFile = () => path.join(store.PATHS.data, 'git-activity.json');
const readActivity = () => store.readJson(activityFile(), { entries: [], turns: [] });

function logActivity(entry) {
  const data = readActivity();
  const full = {
    ts: Date.now(),
    project: entry.project,
    projectId: entry.projectId,
    repo: entry.repo,
    sha: entry.sha,
    message: entry.message,
    hidden: entry.hidden || [],
    files: (entry.files || []).slice(0, 400),
    filesCount: (entry.files || []).length,
    insertions: (entry.files || []).reduce((a, f) => a + (f.insertions || 0), 0),
    deletions: (entry.files || []).reduce((a, f) => a + (f.deletions || 0), 0),
  };
  data.entries = [full, ...(data.entries || [])].slice(0, 800);
  data.turns = (data.turns || []).slice(0, 200);
  store.writeJson(activityFile(), data);
  return full;
}

function logTurn(turn) {
  const data = readActivity();
  data.turns = [{ ts: Date.now(), ...turn }, ...(data.turns || [])].slice(0, 200);
  store.writeJson(activityFile(), data);
}

const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Per dag: hoeveel commits, hoeveel bestanden en aan welke projecten.
function activity(days = 182) {
  const data = readActivity();
  const entries = data.entries || [];
  const perDay = new Map();
  for (const e of entries) {
    const key = dayKey(e.ts);
    const day = perDay.get(key) || { date: key, commits: 0, files: 0, insertions: 0, deletions: 0, projects: {} };
    day.commits += 1;
    day.files += e.filesCount || 0;
    day.insertions += e.insertions || 0;
    day.deletions += e.deletions || 0;
    day.projects[e.project] = (day.projects[e.project] || 0) + 1;
    perDay.set(key, day);
  }
  const grid = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    grid.push(perDay.get(dayKey(d.getTime())) || { date: dayKey(d.getTime()), commits: 0, files: 0, insertions: 0, deletions: 0, projects: {} });
  }
  return { grid, entries: entries.slice(0, 80), turns: (data.turns || []).slice(0, 40), total: entries.length, streak: streak(grid), last: entries[0] || null };
}

function streak(grid) {
  let n = 0;
  for (let i = grid.length - 1; i >= 0; i--) {
    if (grid[i].commits > 0) n++;
    else if (i < grid.length - 1) break;
  }
  return n;
}

// ---------- GitHub CLI ----------
function run(cmd, args, opts = {}) {
  return execFileP(cmd, args, { timeout: 30000, ...opts }).then(({ stdout, stderr }) => ({ ok: true, out: `${stdout}${stderr}` }), (e) => ({ ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }));
}

async function ghStatus() {
  const v = await run('gh', ['--version']);
  if (!v.ok) return { installed: false, authed: false, user: null };
  const s = await run('gh', ['auth', 'status']);
  const user = (s.out.match(/Logged in to github\.com account (\S+)/) || [])[1] || null;
  return { installed: true, authed: Boolean(user) || /Logged in to github\.com/.test(s.out), user };
}

// Maakt een privé-repo aan op GitHub en pusht de eerste versie.
async function createRepo(id) {
  const p = project(id);
  if (!fs.existsSync(p.path)) throw new Error(`Map niet gevonden: ${p.path}`);
  const gh = await ghStatus();
  if (!gh.authed) throw new Error('Log eerst in met GitHub (knop "Inloggen met GitHub").');
  const branch = p.branch || 'main';
  if (!isRepo(p.path)) {
    const init = await git(p.path, ['init', '-b', branch]);
    if (!init.ok) throw new Error(init.err);
  }
  ensureGitignore(p.path);
  const secretFiles = (await changedFiles(p.path)).filter((c) => SECRET_FILES.test(c.path)).map((c) => c.path);
  for (const f of secretFiles) await git(p.path, ['rm', '--cached', '--ignore-unmatch', '--quiet', '--', f]);
  await git(p.path, ['add', '-A', '--', '.']);
  const staged = (await git(p.path, ['diff', '--cached', '--name-only'])).out.split('\n').map((l) => l.trim()).filter(Boolean);
  const secrets = scanFiles(p.path, staged);
  if (secrets.block.length) return { ok: false, blocked: true, secrets, error: 'Geheimen gevonden — er is niets gepusht.' };
  if (!(await git(p.path, ['rev-parse', 'HEAD'])).ok) {
    const msg = p.firstMessage || 'Eerste versie via penuraplicatie';
    const c = await git(p.path, ['commit', '--allow-empty', '-m', msg, '--no-verify']);
    if (!c.ok) throw new Error(c.err);
  }
  const name = String(p.repoName || path.basename(p.path)).replace(/[^\w.-]+/g, '-');
  const create = await run('gh', ['repo', 'create', name, '--private', '--source', p.path, '--remote', 'origin', '--push', '--disable-wiki'], { cwd: p.path, timeout: 900000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (!create.ok) throw new Error(create.out.replace(/\s+/g, ' ').slice(0, 400));
  const url = (create.out.match(/https:\/\/github\.com\/\S+/) || [])[0]?.replace(/\/$/, '') || `https://github.com/${gh.user}/${name}`;
  const remote = `${url.replace(/^https:\/\/github\.com\//, 'git@github.com:')}${url.endsWith('.git') ? '' : '.git'}`;
  setGitConfig({ projects: getGitConfig().projects.map((x) => (x.id === id ? { ...x, repo: remote, branch } : x)) });
  return { ok: true, url, remote, branch };
}

// Opent Terminal met de inlogopdracht; de gebruiker rondt het zelf af in de browser.
async function openLogin() {
  const script = `tell application "Terminal"
  activate
  do script "gh auth login --web --hostname github.com --git-protocol ssh"
end tell`;
  await execFileP('osascript', ['-e', script], { timeout: 15000 }).catch(() => {});
  return true;
}

// ---------- mappen om te koppelen ----------
function detect() {
  const found = [];
  const roots = [path.join(HOME, 'Projects'), path.join(HOME, 'Documents'), path.join(HOME, 'Desktop')];
  for (const root of roots) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
    } catch {}
    for (const name of dirs) {
      const dir = path.join(root, name);
      const hasGit = fs.existsSync(path.join(dir, '.git'));
      const roblox = /roblox|rbxl|gimma|hunter/i.test(name) || fs.existsSync(path.join(dir, 'studio_sources'));
      if (!hasGit && !roblox) continue;
      let updated = 0;
      try {
        updated = fs.statSync(dir).mtimeMs;
      } catch {}
      found.push({ path: dir, name, git: hasGit, roblox, updated });
    }
  }
  return found.sort((a, b) => b.updated - a.updated).slice(0, 24);
}

module.exports = {
  getGitConfig,
  setGitConfig,
  status,
  pushProject,
  pushAll,
  autoPush,
  activity,
  detect,
  ghStatus,
  createRepo,
  openLogin,
  suggestMessage,
  projectStatus,
};
