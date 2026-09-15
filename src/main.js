// DawgAgent — hoofdproces (Electron).
const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, nativeTheme, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');

app.setName('DawgAgent');
// De datamap: hierin staan je chats, skills, API-sleutel en back-ups.
// De map heette eerst "penuraplicatie" en daarna "Orka"; bij de eerste start wordt
// hij eenmalig omgedoopt zodat je al je chats en instellingen houdt.
function appDataDir() {
  const base = app.getPath('appData');
  const target = path.join(base, 'DawgAgent');
  if (process.env.DAWGAGENT_DATA_DIR) return process.env.DAWGAGENT_DATA_DIR;
  if (process.env.ORKA_DATA_DIR) return process.env.ORKA_DATA_DIR;
  const older = ['Orka', 'penuraplicatie']; // oude namen van de datamap
  for (const old of older) {
    const from = path.join(base, old);
    try {
      if (fs.existsSync(from) && !fs.existsSync(target)) fs.renameSync(from, target);
    } catch {}
  }
  return target;
}
app.setPath('userData', appDataDir());

// Apps die vanuit Finder starten krijgen een minimale PATH; neem die van de login-shell over.
try {
  const out = execFileSync('/bin/zsh', ['-lc', 'printf "__ORKA_PATH__%s" "$PATH"'], { timeout: 8000 }).toString();
  const p = out.split('__ORKA_PATH__').pop();
  if (p) process.env.PATH = p;
} catch {
  process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`;
}

if (!app.requestSingleInstanceLock()) app.exit(0);

const store = require('./store');
const skills = require('./skills');
const snapshots = require('./snapshots');
const computer = require('./computer');
const attachments = require('./attachments');
const { bridge, syncExtension, EXT_DIR } = require('./browser');
const { Connectors, parseServersJson } = require('./mcp');
const { Terminals, ensureTermHelper } = require('./term');
const { Agent } = require('./agent');
const { testKey } = require('./llm');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let win = null;
let hud = null;
let hiddenForComputer = false;
let activeSessionId = null; // de chat die in de app open staat (voor vragen uit het zijpaneel)
const connectors = new Connectors();
const terminals = new Terminals((ev) => send('term:event', ev));

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// ---------- verzoeken van de agent aan het zijpaneel ----------
// De agent kan de browser in het zijpaneel lezen en bedienen; het paneel voert dat uit
// en stuurt het antwoord terug. Zo hoeft de agent niet via screenshots te werken.
const panel = require('./panel');
panel.init((channel, data) => send(channel, data));
ipcMain.handle('panel:response', (_e, payload) => panel.resolve(payload));

// ---------- HUD tijdens computer use ----------
function ensureHud() {
  if (hud && !hud.isDestroyed()) return hud;
  const { workArea } = screen.getPrimaryDisplay();
  hud = new BrowserWindow({
    width: 360,
    height: 70,
    x: workArea.x + workArea.width - 380,
    y: workArea.y + workArea.height - 90,
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  hud.setAlwaysOnTop(true, 'screen-saver');
  hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hud.setContentProtection(true);
  hud.setIgnoreMouseEvents(false);
  hud.loadFile(path.join(RENDERER, 'hud.html'));
  return hud;
}

function showHud(text) {
  const h = ensureHud();
  const show = () => {
    h.webContents.send('hud:update', { text });
    if (!h.isVisible()) h.showInactive();
  };
  if (h.webContents.isLoading()) h.webContents.once('did-finish-load', show);
  else show();
}

function hideHud() {
  if (hud && !hud.isDestroyed()) hud.hide();
}

function restoreWindow() {
  if (!hiddenForComputer) return;
  hiddenForComputer = false;
  app.show();
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
}

// ---------- agent ----------
const agent = new Agent({
  connectors,
  emit: (ev) => {
    send('agent:event', ev);
    // Doorsturen naar het Chrome-zijpaneel. Dat paneel toont alleen de antwoorden:
    // het denk- en werkproces (stappen, tussenstappen, wat hij leest) blijft in de app.
    if (ev.type === 'assistant_done' && ev.message?.content && !ev.message.tool_calls?.length) {
      bridge.push({ kind: 'answer', text: String(ev.message.content).slice(0, 4000) });
    } else if (ev.type === 'note' && ev.message) {
      bridge.push({ kind: ev.message.level === 'error' ? 'error' : 'note', text: String(ev.message.text || '').slice(0, 600) });
    } else if (ev.type === 'running') {
      bridge.push({ kind: 'state', running: ev.running, status: bridge.status() });
    }
    if (ev.type === 'tool_start' && (ev.kind?.startsWith('computer') || ev.kind?.startsWith('browser'))) {
      // Bij browser-werk blijft het venster staan; het balkje met Stop verschijnt wel.
      if (ev.kind?.startsWith('browser')) showHud(ev.summary || ev.name);
      else if (hud?.isVisible()) hud.webContents.send('hud:update', { text: ev.summary || ev.name });
    }
  },
  hooks: {
    onComputer: async (_sessionId, summary) => {
      const cfg = store.getConfig();
      if (cfg.hideDuringComputerUse && win && !win.isDestroyed() && win.isVisible() && !hiddenForComputer) {
        hiddenForComputer = true;
        app.hide();
        await sleep(450);
      }
      showHud(summary);
    },
    onApproval: () => {
      restoreWindow();
    },
    onTurnEnd: async (_sessionId, turn) => {
      if (!agent.runningIds().length) {
        hideHud();
        restoreWindow();
      }
      // GitHub-sync: staat "automatisch pushen" aan, dan gaat alles wat deze beurt
      // opleverde meteen naar GitHub — zonder te vragen.
      await gitAutoPush(_sessionId);
      if (turn?.reload === 'app') {
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, 700);
      } else if (turn?.reload === 'window') {
        setTimeout(() => win?.webContents.reloadIgnoringCache(), 500);
      }
    },
  },
});

connectors.on('change', () => send('connectors:changed', connectors.status()));
bridge.on('change', () => send('browser:changed', bridge.status()));

// ---------- elke Chrome-tab zijn eigen chat ----------
// Vragen uit het browser-zijpaneel komen terecht in de chat van de tab waar je naar kijkt.
// Een tab die nog geen chat heeft begint er een nieuwe; die openen we meteen in de app.
// De kaart tab → chat wordt bewaard, zodat hij ook na een herstart blijft kloppen
// (Chrome-tab-id's leven zolang Chrome open is).
const TABCHATS_FILE = path.join(store.PATHS.data, 'tab-chats.json');
const tabChats = new Map(); // Chrome-tab-id → chat-id

try {
  const raw = JSON.parse(fs.readFileSync(TABCHATS_FILE, 'utf8'));
  for (const [tabId, chatId] of Object.entries(raw || {})) if (tabId && chatId) tabChats.set(String(tabId), String(chatId));
} catch {}

function saveTabChats() {
  try {
    fs.writeFileSync(TABCHATS_FILE, JSON.stringify(Object.fromEntries([...tabChats.entries()].slice(-300)), null, 1));
  } catch {}
}

// De chat die bij deze tab hoort — alleen als hij nog bestaat.
function chatForTab(tabId) {
  const id = tabChats.get(String(tabId));
  return id && store.loadSession(id) ? id : null;
}

function chatForTabAsk(tab) {
  const tabId = tab && tab.id != null && tab.id !== '' ? String(tab.id) : null;
  if (tabId) {
    const known = chatForTab(tabId);
    if (known) return known;
  }
  // Nog geen chat voor deze tab: een lege chat die al openstaat is het startpunt,
  // anders beginnen we een nieuwe. (Niet in een chat met BloxCode aan: daar horen de
  // Roblox-tools bij, geen browservragen.)
  const open = activeSessionId ? store.loadSession(activeSessionId) : null;
  let id = open && !(open.messages || []).length && !agent.isRunning(open.id) && open.kind !== 'blox' ? open.id : null;
  if (!id) {
    const s = store.newSession(store.getConfig().workspace);
    store.saveSession(s);
    id = s.id;
  }
  if (tabId) {
    tabChats.set(tabId, id);
    saveTabChats();
  }
  return id;
}

// Vraag uit het Chrome-zijpaneel: komt hier binnen als een gewoon chatbericht, in de
// chat van die tab. De eerste vraag uit een tab begint een nieuwe chat en opent die.
bridge.on('ask', async ({ text, tab }) => {
  try {
    let id;
    if (tab && tab.id != null && tab.id !== '') {
      id = chatForTabAsk(tab);
    } else {
      id = activeSessionId && store.loadSession(activeSessionId) ? activeSessionId : store.listSessions()[0]?.id;
      if (!id) {
        const s = store.newSession(store.getConfig().workspace);
        store.saveSession(s);
        id = s.id;
      }
    }
    activeSessionId = id;
    send('sessions:changed');
    send('session:open', id);
    await agent.send({ sessionId: id, text: `[via het browser-zijpaneel] ${text}` });
    send('sessions:changed');
  } catch (e) {
    bridge.push({ kind: 'error', text: e.message });
  }
});

bridge.on('stop', () => {
  agent.stopAll();
  hideHud();
  restoreWindow();
});

// ---------- venster ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 760,
    minHeight: 540,
    title: 'DawgAgent',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 19 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a19' : '#ffffff',
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, spellcheck: false, webviewTag: true },
  });
  win.loadFile(path.join(RENDERER, 'index.html'));
  win.once('ready-to-show', () => win.show());
  // De browser in het zijpaneel: nieuwe vensters (target=_blank) openen we in datzelfde
  // paneel, zodat de agent en de gebruiker dezelfde pagina blijven volgen.
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) wc.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

// ---------- IPC ----------
const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

handle('app:info', () => ({
  appDir: snapshots.APP_DIR,
  dataDir: store.PATHS.data,
  skillsDir: store.PATHS.skills,
  version: app.getVersion(),
  home: require('os').homedir(),
}));handle('app:openPath', (p) => shell.openPath(p));
handle('app:reveal', (p) => shell.showItemInFolder(p));
// "Open in Finder"-knoppen bij paden in chatberichten.
handle('app:openInFinder', (p) => {
  let target = String(p || '').trim();
  if (!target) return { ok: false };
  if (target === '~' || target.startsWith('~/')) target = path.join(require('os').homedir(), target.slice(1));
  if (!path.isAbsolute(target)) target = path.join(require('os').homedir(), target);
  if (target.length > 1) target = target.replace(/\/+$/, '') || '/';
  const openIfExists = (t) => {
    try {
      if (fs.statSync(t).isDirectory()) {
        shell.openPath(t);
        return { ok: true, kind: 'dir', path: t };
      }
      shell.showItemInFolder(t);
      return { ok: true, kind: 'file', path: t };
    } catch {
      return null;
    }
  };
  // 1) het pad zoals het er staat, 2) anders het laatste stuk na elke spatie weglaten
  // ("~/Library/Application Support/DawgAgent voor je data" → het bestaande deel),
  // 3) anders de dichtstbijzijnde bestaande map erboven.
  let cand = target;
  for (;;) {
    const hit = openIfExists(cand);
    if (hit) return hit;
    const cut = cand.lastIndexOf(' ');
    if (cut <= 0) break;
    cand = cand.slice(0, cut).replace(/\/+$/, '');
  }
  let dir = path.dirname(target);
  while (dir && dir !== path.dirname(dir)) {
    const hit = openIfExists(dir);
    if (hit) return hit;
    dir = path.dirname(dir);
  }
  return { ok: false, path: target };
});
handle('app:openExternal', (url) => /^https?:/i.test(url) && shell.openExternal(url));
handle('app:relaunch', () => {
  app.relaunch();
  app.exit(0);
});

handle('config:get', () => ({ ...store.getConfig(), hasKey: Boolean(store.getApiKey()) }));
handle('config:set', async (patch) => {
  const cfg = store.setConfig(patch);
  if (patch.connectors) connectors.sync(cfg.connectors);
  return { ...cfg, hasKey: Boolean(store.getApiKey()) };
});
handle('apikey:set', async (key) => {
  const clean = store.cleanApiKey(key);
  if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(clean) && clean.length < 20) {
    throw new Error('Dit lijkt geen geldige DeepSeek-sleutel. Hij begint met "sk-" — kopieer hem opnieuw van platform.deepseek.com.');
  }
  const models = await testKey({ cfg: store.getConfig(), apiKey: clean });
  store.setApiKey(clean);
  return { ok: true, models };
});
handle('apikey:test', async () => testKey({ cfg: store.getConfig(), apiKey: store.getApiKey() }));

handle('sessions:list', () => store.listSessions().map((s) => ({ ...s, running: agent.isRunning(s.id) })));
handle('sessions:new', (workspace) => {
  const s = store.newSession(workspace);
  store.saveSession(s);
  activeSessionId = s.id;
  return s;
});
handle('sessions:get', (id) => {
  const s = agent.live(id) || store.loadSession(id);
  if (!s) return null;
  if (!s.parentId) activeSessionId = id; // een zijchat verandert niet waar je naar kijkt
  return { ...s, running: agent.isRunning(id), approvals: agent.pendingApprovals(id) };
});

// Het chatpaneel: de zijchat die bij deze chat hoort, of een nieuwe.
// De zijchat deelt de context van de hoofdchat (zie agent.js) maar heeft eigen berichten.
handle('sessions:sideFor', (parentId) => {
  const parent = store.loadSession(parentId);
  if (!parent) return null;
  let rec = store.latestSide(parentId);
  if (!rec) {
    const s = store.newSession(parent.workspace);
    s.parentId = parentId;
    s.title = `Zijchat · ${parent.title || 'chat'}`.slice(0, 60);
    store.saveSession(s);
    rec = { id: s.id };
  }
  const s = agent.live(rec.id) || store.loadSession(rec.id);
  if (!s) return null;
  return { ...s, running: agent.isRunning(rec.id), approvals: agent.pendingApprovals(rec.id), parentTitle: parent.title };
});

handle('sessions:newSide', (parentId) => {
  const parent = store.loadSession(parentId) || store.loadSession(activeSessionId);
  if (!parent) return null;
  const s = store.newSession(parent.workspace);
  s.parentId = parent.id;
  s.title = `Zijchat · ${parent.title || 'chat'}`.slice(0, 60);
  store.saveSession(s);
  return { id: s.id };
});

handle('sessions:sideContext', (id) => {
  const s = store.loadSession(id);
  const parent = s?.parentId ? agent.live(s.parentId) || store.loadSession(s.parentId) : null;
  return parent ? { id: parent.id, title: parent.title } : null;
});
handle('sessions:rename', (id, title) => store.renameSession(id, title));
handle('sessions:delete', async (id) => {
  agent.stop(id);
  // De zijchats van deze chat gaan mee.
  for (const sideId of store.sideSessions(id)) {
    agent.stop(sideId);
    await store.deleteSession(sideId);
  }
  await store.deleteSession(id);
  let changed = false;
  for (const [tabId, chatId] of [...tabChats]) {
    if (chatId === id) {
      tabChats.delete(tabId);
      changed = true;
    }
  }
  if (changed) saveTabChats();
});
handle('sessions:setWorkspace', (id, dir) => {
  const s = agent.live(id) || store.loadSession(id);
  if (s) {
    s.workspace = dir;
    store.saveSession(s);
  }
  store.setConfig({ workspace: dir });
  return dir;
});

handle('chat:send', async (payload) => {
  const s = store.loadSession(payload.sessionId);
  if (s && !s.parentId) activeSessionId = payload.sessionId;
  await agent.send(payload);
  return { ok: true };
});

// ---------- terminal in het zijpaneel ----------
handle('term:prepare', () => ensureTermHelper().then(() => true));
handle('term:start', (opts) => terminals.start(opts || {}));
handle('term:input', (id, data) => terminals.input(id, data));
handle('term:resize', (id, cols, rows) => terminals.resize(id, cols, rows));
handle('term:stop', (id) => terminals.stop(id));

// ---------- zijpaneel ←→ agent (browser in het paneel) ----------
handle('panel:run', (op, args) => panel.run(op, args));
handle('chat:stop', (id) => agent.stop(id));
handle('chat:stopAll', () => agent.stopAll());
handle('chat:approve', (requestId, decision) => agent.resolveApproval(requestId, decision));

handle('workspace:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Kies een werkmap', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

const IMAGE_FILTER = [{ name: "Foto's", extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp'] }];
handle('attach:pick', async (sessionId, kind) => {
  const opts = {
    images: { title: "Foto's toevoegen", properties: ['openFile', 'multiSelections'], filters: IMAGE_FILTER },
    files: { title: 'Bestanden toevoegen', properties: ['openFile', 'multiSelections'] },
    folder: { title: 'Map toevoegen', properties: ['openDirectory', 'multiSelections'] },
  }[kind];
  const r = await dialog.showOpenDialog(win, opts);
  if (r.canceled) return [];
  const dir = store.filesDir(sessionId);
  return Promise.all(r.filePaths.map((p) => attachments.processPath(p, dir)));
});
handle('attach:paths', (sessionId, paths) => {
  const dir = store.filesDir(sessionId);
  return Promise.all(paths.map((p) => attachments.processPath(p, dir)));
});
handle('attach:data', (sessionId, name, base64) => {
  const dir = store.filesDir(sessionId);
  const file = path.join(dir, `${Date.now()}-${path.basename(name || 'plakken.png')}`);
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  return attachments.processPath(file, dir);
});

handle('skills:list', () => skills.listSkills());
handle('skills:get', (id) => skills.getSkill(id));
handle('skills:create', (data) => skills.createSkill(data));
handle('skills:save', (id, content) => {
  const s = skills.getSkill(id);
  if (!s) throw new Error('Skill niet gevonden');
  fs.writeFileSync(path.join(s.dir, 'SKILL.md'), content);
});
handle('skills:delete', (id) => skills.removeSkill(id));
handle('skills:toggle', (id, enabled) => {
  const set = new Set(store.getConfig().disabledSkills || []);
  if (enabled) set.delete(id);
  else set.add(id);
  store.setConfig({ disabledSkills: [...set] });
});
handle('skills:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Skill importeren (map, SKILL.md of .zip)',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Skills', extensions: ['md', 'zip', 'skill'] }],
  });
  if (r.canceled) return [];
  const names = [];
  for (const p of r.filePaths) names.push(...(await skills.importSkill(p)));
  return names;
});
handle('skills:importPaths', async (paths) => {
  const names = [];
  for (const p of paths) names.push(...(await skills.importSkill(p)));
  return names;
});

handle('connectors:status', () => connectors.status());
handle('connectors:save', async (list) => {
  store.setConfig({ connectors: list });
  connectors.sync(list);
  return connectors.status();
});
handle('connectors:restart', async (id) => {
  const c = store.getConfig().connectors.find((x) => x.id === id);
  if (c) await connectors.restart(c);
  return connectors.status();
});
handle('connectors:parse', (text) => parseServersJson(text));
handle('connectors:newId', () => crypto.randomBytes(5).toString('hex'));

// Browser (Chrome-extensie)
handle('browser:status', () => ({ ...bridge.status(), extDir: EXT_DIR }));
handle('browser:sync', () => syncExtension());
handle('browser:openExtensions', async () => {
  // chrome:// werkt alleen via `open`, niet via shell.openExternal.
  return new Promise((resolve) => {
    const apps = ['Google Chrome', 'Google Chrome Canary', 'Chromium', 'Brave Browser', 'Microsoft Edge'];
    let i = 0;
    const attempt = () => {
      if (i >= apps.length) return resolve(false);
      execFile('open', ['-a', apps[i++], 'chrome://extensions'], (err) => (err ? attempt() : resolve(true)));
    };
    attempt();
  });
});
handle('browser:openFolder', () => {
  syncExtension();
  return shell.openPath(EXT_DIR);
});
handle('browser:connect', () => bridge.ensureConnected({ waitMs: 10000 }));
handle('browser:test', async () => {
  const res = await bridge.send('status', {}, { timeoutMs: 30000 });
  return res.text;
});

handle('computer:prepare', async () => {
  await computer.ensureHelper();
  return computer.permissions(false);
});
handle('computer:permissions', (prompt) => computer.permissions(Boolean(prompt)));
handle('computer:openSettings', (which) => {
  const pane = which === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Accessibility';
  return shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
});

handle('snapshots:list', () => snapshots.listSnapshots());
handle('snapshots:create', () => snapshots.createSnapshot('Handmatige back-up'));
handle('snapshots:restore', (id) => {
  snapshots.restoreSnapshot(id);
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 400);
});

// ---------- BloxCode (Roblox Studio) ----------
const bloxCore = require('./blox/core');
const bloxSafety = require('./blox/safety');
const { studio } = require('./blox/studio');

studio.on('change', () => send('blox:changed', bloxStatus()));

function bloxStatus() {
  const bcfg = bloxCore.getBloxConfig();
  return {
    ...studio.status(),
    mode: bcfg.mode,
    config: bcfg,
    memory: bloxCore.readMemory().length,
    skills: bloxCore.loadSkills().size,
    mcpExists: fs.existsSync(bcfg.mcpCommand),
    logPath: bloxCore.PATHS.log,
    memoryPath: bloxCore.PATHS.memory,
    userSkillsDir: bloxCore.PATHS.userSkills,
  };
}

const bloxConnect = () => studio.connect({ ...bloxCore.getBloxConfig(), logPath: bloxCore.PATHS.log }).then(bloxStatus);

// ---------- GitHub-sync ----------
const gitsync = require('./gitsync');

// Een notitie in de chat zetten (bv. "3 bestanden gepusht naar GitHub").
function noteToSession(sessionId, text, level = 'info') {
  const s = agent.live(sessionId) || store.loadSession(sessionId);
  if (!s) return;
  const msg = { role: '_note', level, text, _ts: Date.now() };
  s.messages.push(msg);
  store.saveSession(s);
  send('agent:event', { sessionId, type: 'note', message: msg });
}

// Automatisch pushen na een beurt (alleen als de schakelaar aanstaat).
async function gitAutoPush(sessionId) {
  try {
    const cfg = store.getConfig().git;
    if (!cfg?.auto) return null;
    const s = agent.live(sessionId) || store.loadSession(sessionId);
    const request = [...(s?.messages || [])].reverse().find((m) => m.role === 'user' && !m._auto && !m._compacted)?._text || '';
    const done = await gitsync.autoPush({ sessionId, title: s?.title || '', request });
    if (!done?.length) return null;
    const ok = done.filter((d) => !d.error);
    const bad = done.filter((d) => d.error);
    const parts = [];
    if (ok.length) parts.push(ok.map((d) => `${d.project} (${d.files} bestand${d.files === 1 ? '' : 'en'} · ${String(d.sha || '').slice(0, 7)})`).join(', '));
    if (bad.length) parts.push(`mislukt: ${bad.map((d) => `${d.project} — ${d.error}`).join('; ')}`);
    noteToSession(sessionId, `GitHub-sync: ${parts.join(' · ')}`, bad.length && !ok.length ? 'error' : 'info');
    send('git:changed', { pushed: done });
    return done;
  } catch (e) {
    noteToSession(sessionId, `GitHub-sync mislukte: ${e.message}`, 'error');
    return null;
  }
}

handle('git:status', () => gitsync.status());
handle('git:activity', () => gitsync.activity());
handle('git:setConfig', (patch) => {
  const next = gitsync.setGitConfig(patch || {});
  send('git:changed');
  return next;
});
handle('git:push', async (id, opts) => {
  const r = await gitsync.pushProject(id, opts || {});
  send('git:changed', { pushed: r });
  return r;
});
handle('git:pushAll', async (opts) => {
  const r = await gitsync.pushAll(opts || {});
  send('git:changed', { pushed: r.results });
  return r;
});
handle('git:createRepo', async (id) => {
  const r = await gitsync.createRepo(id);
  send('git:changed');
  return r;
});
handle('git:checkRepos', () => gitsync.checkRepos());
handle('git:listRepos', () => gitsync.listRepos());
handle('git:deleteRepo', async (nameWithOwner) => {
  const r = await gitsync.deleteRepo(nameWithOwner);
  send('git:changed');
  return r;
});
handle('git:renameRepo', async (nameWithOwner, name) => {
  const r = await gitsync.renameRepo(nameWithOwner, name);
  send('git:changed');
  return r;
});
handle('git:setVisibility', async (nameWithOwner, isPrivate) => {
  const r = await gitsync.setVisibility(nameWithOwner, isPrivate);
  send('git:changed');
  return r;
});
handle('git:linkRepo', async (id, url) => {
  const r = await gitsync.linkRepo(id, url);
  send('git:changed');
  return r;
});
handle('git:authRefresh', (scope) => gitsync.openAuthRefresh(scope || 'delete_repo'));
handle('git:login', () => gitsync.openLogin());
handle('git:pickFolder', async (id) => {
  const r = await dialog.showOpenDialog(win, { title: 'Kies de projectmap', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const projects = gitsync.getGitConfig().projects.map((p) => (p.id === id ? { ...p, path: r.filePaths[0] } : p));
  gitsync.setGitConfig({ projects });
  send('git:changed');
  return gitsync.status();
});
handle('git:addProject', (dir) => {
  if (!dir || !fs.existsSync(dir)) throw new Error('Map niet gevonden.');
  const projects = gitsync.getGitConfig().projects.filter((p) => p.path !== dir);
  projects.push({ id: `p${Date.now().toString(36)}`, name: path.basename(dir), path: dir, repo: '', branch: 'main', enabled: true });
  gitsync.setGitConfig({ projects });
  send('git:changed');
  return gitsync.status();
});
handle('git:removeProject', (id) => {
  gitsync.setGitConfig({ projects: gitsync.getGitConfig().projects.filter((p) => p.id !== id) });
  send('git:changed');
  return gitsync.status();
});

handle('blox:status', () => bloxStatus());
handle('blox:connect', () => bloxConnect());
handle('blox:ensure', async () => {
  if (!studio.connected && studio.state !== 'connecting') await studio.ensure({ ...bloxCore.getBloxConfig(), logPath: bloxCore.PATHS.log });
  return bloxStatus();
});
handle('blox:studios', async () => {
  if (!studio.connected) await studio.ensure({ ...bloxCore.getBloxConfig(), logPath: bloxCore.PATHS.log });
  await studio.refreshStudios();
  return bloxStatus();
});
handle('blox:selectStudio', (id) => {
  studio.select(id);
  return bloxStatus();
});
handle('blox:setMode', (mode) => {
  if (!bloxSafety.MODES.includes(mode)) throw new Error(`Onbekende modus: ${mode}`);
  bloxCore.setBloxConfig({ mode });
  send('blox:changed', bloxStatus());
  return bloxStatus();
});
handle('blox:config', () => bloxCore.getBloxConfig());
handle('blox:setConfig', async (patch) => {
  const before = bloxCore.getBloxConfig();
  const next = bloxCore.setBloxConfig(patch || {});
  if (patch && (patch.mcpCommand !== undefined || patch.mcpArgs !== undefined) && (next.mcpCommand !== before.mcpCommand || JSON.stringify(next.mcpArgs) !== JSON.stringify(before.mcpArgs))) {
    await bloxConnect();
  }
  send('blox:changed', bloxStatus());
  return next;
});

handle('blox:memory', () => bloxCore.readMemory());
handle('blox:remember', (fact) => {
  const ok = bloxCore.addMemory(fact);
  send('blox:changed', bloxStatus());
  return ok;
});
handle('blox:forget', (query) => {
  const removed = bloxCore.removeMemory(query);
  send('blox:changed', bloxStatus());
  return removed;
});

handle('blox:skills', () => [...bloxCore.loadSkills().values()].map(({ name, description, source, file }) => ({ name, description, source, file })));
handle('blox:skill', (name) => bloxCore.loadSkills().get(name) || null);
handle('blox:tools', () => {
  const tools = studio.toolDefs().map((t) => ({
    name: t.name,
    level: bloxSafety.classify(t.name, {}, t.annotations, {}).level,
    description: String(t.description || '').split('\n')[0].slice(0, 160),
  }));
  tools.push(
    { name: 'load_skill', level: 'read', description: 'lokaal (BloxCode): Roblox-kennis inladen' },
    { name: 'remember', level: 'read', description: 'lokaal (BloxCode): feit onthouden' },
  );
  return tools;
});

handle('blox:sessions', () => store.listSessions('blox').map((s) => ({ ...s, running: agent.isRunning(s.id) })));
handle('blox:newSession', () => {
  const s = store.newSession(require('os').homedir());
  s.kind = 'blox';
  s.title = 'Nieuwe BloxCode-chat';
  store.saveSession(s);
  return s;
});
// BloxCode aan/uit voor deze chat (het is een functie per chat, geen aparte ruimte).
handle('blox:setSession', (sessionId, on) => {
  if (agent.isRunning(sessionId)) throw new Error('Wacht tot deze chat klaar is met de beurt en probeer het opnieuw.');
  const s = store.loadSession(sessionId);
  if (!s) throw new Error('Chat niet gevonden.');
  if (on) s.kind = 'blox';
  else delete s.kind;
  store.saveSession(s);
  send('sessions:changed');
  return { ...s, running: agent.isRunning(s.id) };
});
handle('blox:legacyList', () => bloxCore.listLegacySessions());
handle('blox:legacyImport', (id) => {
  const s = bloxCore.convertLegacySession(id);
  return { id: s.id, title: s.title };
});
handle('blox:compact', (sessionId) => agent.compactNow(sessionId));
handle('blox:actions', (sessionId) => {
  const s = agent.live(sessionId) || store.loadSession(sessionId);
  return (s?.actions || []).slice(-50).reverse();
});
handle('blox:reasoning', (sessionId) => {
  const s = agent.live(sessionId) || store.loadSession(sessionId);
  return [...(s?.messages || [])].reverse().find((m) => m.role === 'assistant' && m.reasoning_content)?.reasoning_content || '';
});
handle('blox:openPath', (which) => {
  const p = { log: bloxCore.PATHS.log, memory: bloxCore.PATHS.memory, skills: bloxCore.PATHS.userSkills, home: bloxCore.PATHS.home }[which];
  if (!p) return false;
  if (which === 'skills') fs.mkdirSync(p, { recursive: true });
  if (which === 'memory' && !fs.existsSync(p)) bloxCore.addMemory('');
  return fs.existsSync(p) ? shell.openPath(p) : false;
});
handle('blox:doctor', async () => {
  const bcfg = bloxCore.getBloxConfig();
  const cfg = store.getConfig();
  const rows = [];
  const add = (check, ok, detail) => rows.push({ check, ok, detail });
  add('API-sleutel', Boolean(store.getApiKey()), store.getApiKey() ? 'opgeslagen in DawgAgent' : 'niet ingesteld — Instellingen → Model & API');
  if (store.getApiKey()) {
    try {
      const models = await testKey({ cfg, apiKey: store.getApiKey() });
      add('DeepSeek API', true, `bereikbaar · modellen: ${models.join(', ') || '?'}`);
      if (models.length && !models.includes(cfg.model)) add('Model', false, `"${cfg.model}" staat niet in de lijst`);
    } catch (e) {
      add('DeepSeek API', false, e.message);
    }
  }
  add('Endpoint', true, `${cfg.baseUrl} · model ${cfg.model} · nadenken ${cfg.thinking}`);
  add('StudioMCP', fs.existsSync(bcfg.mcpCommand), bcfg.mcpCommand);
  if (!studio.connected) await studio.ensure({ ...bcfg, logPath: bloxCore.PATHS.log });
  add('Roblox MCP', studio.connected, studio.connected ? `${studio.tools.size} tools` : studio.error || 'niet verbonden');
  if (studio.connected) {
    await studio.refreshStudios();
    add('Studio-place', studio.studios.length > 0, studio.studios.map((s) => s.name).join(', ') || 'geen place open in Studio');
  }
  add('Skills', bloxCore.loadSkills().size > 0, `${bloxCore.loadSkills().size} geladen`);
  add('Geheugen', true, `${bloxCore.readMemory().length} feiten · ${bloxCore.PATHS.memory}`);
  add('Log', true, bloxCore.PATHS.log);
  return rows;
});

app.on('will-quit', () => {
  studio.close();
});

// ---------- levenscyclus ----------
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(() => {
  skills.seedSkills();
  store.cleanupEmptySessions();
  syncExtension();
  bridge.start();
  // Zet ook in dev het robot-icoon in de Dock.
  if (app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, '..', 'assets', 'icon.png'));
    } catch {}
  }
  createWindow();
  connectors.sync(store.getConfig().connectors);
  globalShortcut.register('CommandOrControl+Shift+Escape', () => {
    agent.stopAll();
    hideHud();
    restoreWindow();
  });
  app.on('activate', () => {
    if (!win) createWindow();
    else win.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  connectors.stopAll();
  bridge.stop();
  terminals.stopAll();
});
