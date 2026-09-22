// DawgAgent — hoofdproces (Electron).
const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, nativeTheme, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
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
const study = require('./study');
const { bridge, syncExtension, EXT_DIR } = require('./browser');
const { Connectors, parseServersJson } = require('./mcp');
const { Terminals, ensureTermHelper } = require('./term');
const { Agent } = require('./agent');
const { testKey, quickChat, isDeepSeek } = require('./llm');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const i18n = require('./i18n');
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
// Study laat via de interface weten wanneer PowerPoint even aan het werk is.
study.init((text) => send('ui:toast', { text }));
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
  hud.webContents.once('did-finish-load', () => hud.webContents.send('hud:lang', { locale: i18n.locale(), strings: i18n.hudStrings() }));
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
      // The Brain: staat "automatisch onthouden" aan, dan haalt DawgAgent zelf de
      // duurzame dingen uit deze beurt en schrijft ze weg — zonder dat je erom vraagt.
      if (!turn?.reload) brainAutoCapture(_sessionId).catch(() => {});
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
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      webviewTag: true,
      // De taal van de app gaat mee het venster in, zodat de interface direct goed staat.
      additionalArguments: [`--orka-locale=${i18n.locale()}`],
    },
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
  locale: i18n.locale(),
}));
// Taal: welke taal de app nu gebruikt, wat de Mac zelf vraagt en welke talen er zijn.
handle('i18n:info', () => i18n.info());
handle('i18n:set', async (code) => {
  const choice = String(code || 'auto');
  store.setConfig({ lang: choice === 'auto' ? 'auto' : i18n.available().includes(choice) ? choice : 'auto' });
  return i18n.info();
});
// Taal gewisseld: opnieuw starten is het simpelst en het schoonst.
handle('i18n:restart', () => {
  app.relaunch();
  app.exit(0);
});
handle('app:openPath', (p) => shell.openPath(p));
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
    throw new Error(i18n.t('Dit lijkt geen geldige DeepSeek-sleutel. Hij begint met "sk-" — kopieer hem opnieuw van platform.deepseek.com.'));
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
    s.title = `${i18n.t('Zijchat')} · ${parent.title || i18n.t('chat')}`.slice(0, 60);
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
  s.title = `${i18n.t('Zijchat')} · ${parent.title || i18n.t('chat')}`.slice(0, 60);
  store.saveSession(s);
  return { id: s.id };
});

handle('sessions:sideContext', (id) => {
  const s = store.loadSession(id);
  const parent = s?.parentId ? agent.live(s.parentId) || store.loadSession(s.parentId) : null;
  return parent ? { id: parent.id, title: parent.title } : null;
});
handle('sessions:rename', (id, title) => store.renameSession(id, title));

// Vastzetten en groeperen: de zijbalk toont vastgezette chats bovenaan en per groep.
// Staat er een beurt te draaien, dan krijgt het live-object dezelfde vlag — anders zou de
// agent hem bij de volgende opslag weer wissen.
handle('sessions:pin', (id, pinned) => {
  const live = agent.live(id);
  if (live) live.pinned = Boolean(pinned);
  return store.setSessionFlags(id, { pinned: Boolean(pinned) });
});
handle('sessions:setGroup', (id, groupId) => {
  const live = agent.live(id);
  if (live) live.group = groupId || null;
  return store.setSessionFlags(id, { group: groupId || null });
});
handle('groups:list', () => store.chatGroups());
handle('groups:create', (name) => store.createChatGroup(name));
handle('groups:rename', (id, name) => store.renameChatGroup(id, name));
handle('groups:delete', (id) => store.deleteChatGroup(id));
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
  // Geen map (of een map die niet meer bestaat) = terug naar de thuismap. Zo kun je een
  // werkmap ook weer loslaten.
  const target = dir && fs.existsSync(dir) ? dir : os.homedir();
  const s = agent.live(id) || store.loadSession(id);
  if (s) {
    s.workspace = target;
    store.saveSession(s);
  }
  store.setConfig({ workspace: target });
  return target;
});

// Study-modus per chat: 'off' | 'study' | 'test' (proeftoets).
handle('sessions:setStudy', async (id, mode) => {
  const next = study.MODES.includes(mode) ? mode : 'off';
  const s = agent.live(id) || store.loadSession(id);
  if (!s) throw new Error(i18n.t('Chat niet gevonden.'));
  s.study = next;
  store.saveSession(s);
  let opened = null;
  if (next !== 'off') {
    // Staat er al materiaal in deze chat? Zet het meteen in het zijpaneel.
    const file = study.latestDocument(s);
    if (file) {
      try {
        opened = await study.openInPanel({ sessionId: id, file, panelRun: (op, args) => panel.run(op, args, 40000) });
      } catch {}
    }
  }
  return { mode: next, opened };
});

// Lesmateriaal dat in een study-chat wordt toegevoegd, gaat direct naar het paneel.
async function openStudyMaterial(sessionId, atts) {
  try {
    const s = store.loadSession(sessionId);
    if (!s || study.modeFor(s) === 'off') return atts;
    const doc = (atts || []).find((a) => a?.path && a.kind !== 'folder' && study.isViewable(a.path));
    if (!doc) return atts;
    const out = await study.openInPanel({ sessionId, file: doc.path, panelRun: (op, args) => panel.run(op, args, 40000) });
    if (out && !out.unsupported) doc.panel = { title: out.title, url: out.url, pages: out.pages || null, kind: out.kind, unrenderable: out.unrenderable || 0, warning: out.warning || null };
    else if (out?.unsupported) doc.panel = { error: out.unsupported };
  } catch (e) {
    // Het paneel is bijzaak: een bron die niet te tonen is mag het toevoegen nooit blokkeren.
  }
  return atts;
}

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
  const r = await dialog.showOpenDialog(win, { title: i18n.t('Kies een werkmap'), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

const IMAGE_FILTER = [{ name: "Foto's", extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp'] }];
handle('attach:pick', async (sessionId, kind) => {
  const opts = {
    images: { title: i18n.t("Foto's toevoegen"), properties: ['openFile', 'multiSelections'], filters: IMAGE_FILTER },
    files: { title: i18n.t('Bestanden toevoegen'), properties: ['openFile', 'multiSelections'] },
    folder: { title: i18n.t('Map toevoegen'), properties: ['openDirectory', 'multiSelections'] },
  }[kind];
  const r = await dialog.showOpenDialog(win, opts);
  if (r.canceled) return [];
  const dir = store.filesDir(sessionId);
  const atts = await Promise.all(r.filePaths.map((p) => attachments.processPath(p, dir)));
  return openStudyMaterial(sessionId, atts);
});
handle('attach:paths', async (sessionId, paths) => {
  const dir = store.filesDir(sessionId);
  // Alleen wat echt bestaat; een geplakt pad dat nergens heen wijst mag geen foutmelding geven.
  const found = (paths || []).filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  const atts = await Promise.all(found.map((p) => attachments.processPath(p, dir)));
  return openStudyMaterial(sessionId, atts);
});
handle('attach:data', async (sessionId, name, base64) => {
  const dir = store.filesDir(sessionId);
  const pretty = path.basename(name || 'plakken.png');
  const file = path.join(dir, `${Date.now()}-${pretty}`);
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  const att = await attachments.processPath(file, dir);
  att.name = pretty; // de gebruiker hoeft de tijdstempel van het bestand niet te zien
  return openStudyMaterial(sessionId, [att]);
});

handle('skills:list', () => skills.listSkills());
handle('skills:get', (id) => skills.getSkill(id));
handle('skills:create', (data) => skills.createSkill(data));
handle('skills:save', (id, content) => {
  const s = skills.getSkill(id);
  if (!s) throw new Error(i18n.t('Skill niet gevonden'));
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
    title: i18n.t('Skill importeren (map, SKILL.md of .zip)'),
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

// Jobsearch: de vaste job-MCP-servers (LinkedIn, JobSpy/Indeed, Indeed via Bright Data, Randstad) met absolute paden,
// zodat de Jobsearch-pagina ze met één klik kan toevoegen en meteen kan verbinden.
const JOBSEARCH_DIR = path.join(store.PATHS.data, 'jobsearch-mcp');
handle('jobsearch:presets', () => {
  const py = path.join(JOBSEARCH_DIR, '.venv', 'bin', 'python');
  const lokaal = (bestand) => {
    const script = path.join(JOBSEARCH_DIR, bestand);
    return {
      type: 'stdio',
      command: py,
      args: [script],
      env: { PYTHONUNBUFFERED: '1' },
      ready: fs.existsSync(py) && fs.existsSync(script),
    };
  };
  return [
    {
      id: 'job-linkedin',
      site: 'LinkedIn',
      name: 'LinkedIn',
      blurb:
        'Vacatures zoeken, profielen en bedrijven bekijken en je LinkedIn-inbox lezen — via je eigen ingelogde sessie. De eerste keer opent de server eenmalig een Chrome-venster om in te loggen (of neemt hij je bestaande Chrome-sessie over).',
      source: 'https://github.com/stickerdaniel/linkedin-mcp-server',
      command: '/bin/zsh',
      args: ['-lc', 'exec uvx mcp-server-linkedin@latest'],
      env: { UV_HTTP_TIMEOUT: '300' },
      type: 'stdio',
      ready: true,
    },
    {
      id: 'job-jobspy',
      site: 'JobSpy',
      name: 'Indeed · Glassdoor · ZipRecruiter · Google',
      blurb:
        'Vacatures zoeken op meerdere sites tegelijk via JobSpy: Indeed (ook België en Nederland), Glassdoor, ZipRecruiter en Google. Geen API-sleutel nodig.',
      source: 'https://github.com/Bunsly/JobSpy',
      ...lokaal('jobspy_server.py'),
    },
    {
      id: 'job-brightdata-indeed',
      site: 'Indeed',
      name: 'Indeed (Bright Data)',
      blurb:
        'Publieke Indeed-data rechtstreeks bij de bron: vacatures, bedrijfsprofielen, salarissen en reviews. De gehoste MCP-server van Bright Data omzeilt zelf blokkades en CAPTCHA\'s; nieuwe accounts krijgen 5.000 requests per maand gratis.',
      source: 'https://github.com/brightdata/brightdata-mcp',
      needsToken: true,
      hint: 'Vraagt een (gratis) Bright Data API-token: plak die in de URL bij token=. Je vindt hem in je Bright Data-account onder Settings → Users & API.',
      type: 'http',
      url: 'https://mcp.brightdata.com/mcp?token=<BRIGHT-DATA-API-TOKEN>',
      headers: {},
    },
    {
      id: 'job-randstad',
      site: 'Randstad',
      name: 'Randstad (NL)',
      blurb:
        'Vacatures zoeken en volledig lezen op randstad.nl — met plaats, salarisindicatie, uren en opleidingsniveau.',
      source: 'https://www.randstad.nl/vacatures',
      ...lokaal('randstad_server.py'),
    },
  ];
});

// Jobsearch-chats: een eigen chatomgeving voor alles rond werk zoeken
// (session.kind === 'job'), net zoals BloxCode zijn eigen chats heeft.
handle('job:sessions', () => store.listSessions('job').map((s) => ({ ...s, running: agent.isRunning(s.id) })));
handle('job:newSession', () => {
  const s = store.newSession(store.getConfig().workspace);
  s.kind = 'job';
  s.title = i18n.t('Nieuwe job-chat');
  store.saveSession(s);
  return s;
});
// Deze chat wel/niet in de Jobsearch-map zetten.
handle('job:setSession', (sessionId, on) => {
  if (agent.isRunning(sessionId)) throw new Error(i18n.t('Wacht tot deze chat klaar is met de beurt en probeer het opnieuw.'));
  const s = store.loadSession(sessionId);
  if (!s) throw new Error(i18n.t('Chat niet gevonden.'));
  if (on) s.kind = 'job';
  else delete s.kind;
  store.saveSession(s);
  send('sessions:changed');
  return { ...s, running: agent.isRunning(s.id) };
});

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
  const r = await dialog.showOpenDialog(win, { title: i18n.t('Kies de projectmap'), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const projects = gitsync.getGitConfig().projects.map((p) => (p.id === id ? { ...p, path: r.filePaths[0] } : p));
  gitsync.setGitConfig({ projects });
  send('git:changed');
  return gitsync.status();
});
handle('git:addProject', (dir) => {
  if (!dir || !fs.existsSync(dir)) throw new Error(i18n.t('Map niet gevonden.'));
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

// ---------- The Brain (tweede geheugen) ----------
const brain = require('./brain');

// Wanneer de agent (of de gebruiker in de interface) iets in The Brain schrijft,
// licht de graaf in de zijbalk op. Daarvoor gaat er een event naar de interface.
brain.setWatcher((info) => send('brain:changed', info || {}));

// De laatste berichten van een chat als leesbare tekst (voor het automatisch onthouden).
function recentTranscript(session, maxChars = 7000) {
  const msgs = (session.messages || []).filter((m) => !m.role.startsWith('_') && !(m.role === 'user' && m._auto));
  const parts = [];
  let total = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const text = String((m.role === 'user' ? m._text ?? m.content ?? '' : m.role === 'assistant' ? m.content || '' : '') || '').trim();
    if (!text) continue;
    let chunk = `${m.role === 'user' ? 'Gebruiker' : 'DawgAgent'}: ${text}`;
    if (chunk.length > 2600) chunk = `${chunk.slice(0, 2600)} …`;
    if (total + chunk.length > maxChars) break;
    parts.unshift(chunk);
    total += chunk.length + 2;
  }
  return parts.join('\n\n');
}

// Wat het model moet doen: alleen duurzame dingen eruit halen, als strikte JSON.
const CAPTURE_PROMPT = `Je bent het langetermijngeheugen van DawgAgent. Je leest het laatste stuk van een gesprek tussen de gebruiker en DawgAgent en haalt er alleen de DUURZAME herinneringen uit: voorkeuren en gewoontes van de gebruiker, beslissingen, projectdetails, plannen en afspraken, personen, terugkerende werkwijzen, en conclusies die later nog van belang zijn.

Regels:
- Maximaal 3 herinneringen. Liever niets dan ruis: losse chit-chat, dingen die alleen in dit gesprek gelden, en dingen die al in de lijst hieronder staan sla je over.
- Geen geheimen: nooit wachtwoorden, API-sleutels, tokens of pincodes opschrijven.
- Eén feit per herinnering, in de taal van het gesprek. Korte titel (max 8 woorden), 1 tot 3 zinnen inhoud, 2 tot 5 tags in kleine letters.
- "type" is één van: note, project, person, decision, task, idea, meeting, source.
- Niks duurzaams gevonden? Antwoord met [].

Antwoord met ALLEEN JSON, geen uitleg en geen codeblok:
[{"title":"…","content":"…","type":"note","tags":["…","…"]}]`;

// Na elke beurt: zelf herinneringen maken. Staat standaard aan (Instellingen → The Brain).
const capturedSignatures = new Map(); // sessie-id → laatste verwerkte gesprek (voorkomt dubbel werk)
const capturing = new Set();

async function brainAutoCapture(sessionId, { force = false, silent = false } = {}) {
  const cfg = store.getConfig();
  if (!force && cfg.brain?.auto === false) return null;
  const apiKey = store.getApiKey();
  if (!apiKey || capturing.has(sessionId)) return null;
  const s = agent.live(sessionId) || store.loadSession(sessionId);
  if (!s || s.parentId) return null; // zijchats en losse vragen: niets om te onthouden
  const text = recentTranscript(s);
  if (text.length < 200) return null;
  const signature = crypto.createHash('sha1').update(text).digest('hex');
  if (!force && capturedSignatures.get(sessionId) === signature) return null;
  capturedSignatures.set(sessionId, signature);

  const known = brain
    .list()
    .nodes.slice(-80)
    .map((n) => `- ${n.title}${n.tags.length ? ` (#${n.tags.join(' #')})` : ''}`)
    .join('\n');
  capturing.add(sessionId);
  let raw = '';
  try {
    // Voor dit achtergrondwerkje het goedkoopste model van de aanbieder (bij DeepSeek: flash),
    // zodat automatisch onthouden bijna niets kost.
    const captureCfg = isDeepSeek(cfg.baseUrl) && cfg.model !== 'deepseek-flash' ? { ...cfg, model: 'deepseek-flash' } : cfg;
    raw = await quickChat({
      cfg: captureCfg,
      apiKey,
      maxTokens: 900,
      messages: [
        { role: 'system', content: known ? `${CAPTURE_PROMPT}\n\nWat er al in The Brain staat (niet opnieuw opschrijven):\n${known}` : CAPTURE_PROMPT },
        { role: 'user', content: text },
      ],
    });
  } catch (e) {
    if (!silent) console.error('[brain] automatisch onthouden mislukte:', e.message);
    capturing.delete(sessionId);
    return null;
  }
  capturing.delete(sessionId);

  const items = brain.parseCapture(raw);
  if (!items.length) return { created: [], updated: [] };
  const { created, updated } = brain.applyCapture(items);
  const bits = [];
  if (created.length) bits.push(`${i18n.t('onthouden:')} ${created.map((n) => n.title).join(' · ')}`);
  if (updated.length) bits.push(`${i18n.t('bijgewerkt:')} ${updated.map((n) => n.title).join(' · ')}`);
  if (bits.length && !silent) noteToSession(sessionId, `The Brain — ${bits.join(' · ')}`);
  return { created, updated };
}

handle('brain:list', () => brain.list());
handle('brain:stats', () => brain.stats());
handle('brain:get', (id) => brain.get(id));
handle('brain:search', (query, opts) => brain.search(query, opts || {}));
handle('brain:save', (patch) => brain.upsert({ ...(patch || {}), origin: (patch && patch.origin) || 'user' }));
handle('brain:delete', (id) => brain.remove(id));
handle('brain:link', (from, to, label) => brain.link(from, to, label));
handle('brain:unlink', (from, to) => brain.unlink(from, to));
handle('brain:overview', () => ({ text: brain.promptOverview(), ...brain.stats() }));
handle('brain:capture', (sessionId, opts) => brainAutoCapture(sessionId, { silent: true, ...(opts || {}) }));

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
  if (agent.isRunning(sessionId)) throw new Error(i18n.t('Wacht tot deze chat klaar is met de beurt en probeer het opnieuw.'));
  const s = store.loadSession(sessionId);
  if (!s) throw new Error(i18n.t('Chat niet gevonden.'));
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
