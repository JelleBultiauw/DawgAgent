// penuraplicatie Browser — Chrome-extensie die de penuraplicatie-app op deze Mac bedient.
//
// Werking: de app draait een lokale brug op 127.0.0.1 (poort 8798+). Deze service worker
// long-pollt die brug, voert opdrachten uit in je eigen Chrome en stuurt het resultaat terug.
// Resultaten zijn tekst (paginatekst, HTML of een genummerde elementenlijst) — geen
// screenshots — zodat het tokengebruik laag blijft.

const PORTS = [8798, 8799, 8800, 8801, 8802, 8803, 8804, 8805, 8806, 8807];
const HOLD_MS = 20000; // hoe lang de brug een poll openhoudt
const WAKE_RE = /^https?:\/\/127\.0\.0\.1:\d+\/(wake|ping)\b/;

let port = null;
let running = false;
let paused = false;
let connected = false;
let busy = false;
const recent = [];
const panels = new Set();
let lastTab = { id: null, title: '', url: '' };

// ---------- zijpaneel ----------
function panelStatus() {
  return { port, connected, paused, busy, recent: recent.slice(0, 8), tab: lastTab };
}

function pushPanel(msg) {
  const open = [];
  for (const p of panels) {
    try {
      p.postMessage(msg);
      open.push(p);
    } catch {}
  }
  if (open.length !== panels.size) panels.clear(), open.forEach((p) => panels.add(p));
}

function pushTab(tab) {
  lastTab = { id: tab?.id ?? null, title: (tab?.title || '').slice(0, 200), url: (tab?.url || '').slice(0, 300) };
  pushPanel({ kind: 'tab', data: lastTab });
}

function refreshTab() {
  chrome.tabs
    .query({ active: true, lastFocusedWindow: true })
    .then((tabs) => {
      const t = tabs[0] || null;
      if (!t) return;
      if (t.id !== lastTab.id || t.title !== lastTab.title || t.url !== lastTab.url) pushTab(t);
      pushPanel({ kind: 'status', data: panelStatus() });
    })
    .catch(() => {});
}

chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab && tab.active) refreshTab();
  if (info.title || info.url) refreshTab();
});
chrome.tabs.onRemoved.addListener(refreshTab);
chrome.windows.onFocusChanged.addListener(refreshTab);

chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'orka-panel') return;
  panels.add(p);
  p.onDisconnect.addListener(() => panels.delete(p));
  refreshTab();
  try {
    p.postMessage({ kind: 'status', data: panelStatus() });
  } catch {}
});

// Klik op het icoon in de werkbalk: zijpaneel openen.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab?.windowId });
  } catch {
    try {
      await chrome.sidePanel.open({ tabId: tab?.id });
    } catch {}
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi, d) => {
  n = Number(n);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const short = (s, n = 60) => {
  const t = String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function setBadge(state) {
  const map = {
    on: ['', '#2c8a52', 'verbonden met penuraplicatie'],
    off: ['uit', '#9a9a95', 'geen verbinding — start penuraplicatie'],
    paused: ['ii', '#c8871a', 'gepauzeerd'],
  };
  const [text, color, title] = map[state] || map.off;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title: `penuraplicatie Browser — ${title}` });
}

function markConnected() {
  const was = connected;
  connected = true;
  if (!was) {
    setBadge('on');
    pushPanel({ kind: 'status', data: panelStatus() });
  }
}

function markDisconnected() {
  const was = connected;
  connected = false;
  setBadge(paused ? 'paused' : 'off');
  if (was) pushPanel({ kind: 'status', data: panelStatus() });
}

function pushRecent(entry) {
  recent.unshift(entry);
  if (recent.length > 12) recent.length = 12;
}

// ---------- verbinding met de app ----------
async function detect() {
  for (const p of PORTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 900);
      const res = await fetch(`http://127.0.0.1:${p}/ping`, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const info = await res.json();
      if (info && info.app === 'penuraplicatie') return p;
    } catch {}
  }
  return null;
}

async function activeTabInfo() {
  try {
    const tab = await getActiveTab();
    if (tab && (tab.title !== lastTab.title || tab.url !== lastTab.url)) pushTab(tab);
    return { title: (tab?.title || '').slice(0, 90), url: (tab?.url || '').slice(0, 200) };
  } catch {
    return {};
  }
}

async function pollOnce() {
  const tab = await activeTabInfo();
  const q = new URLSearchParams({ t: tab.title || '', u: tab.url || '' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HOLD_MS + 12000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/poll?${q}`, { cache: 'no-store', signal: ctrl.signal });
    if (res.status === 204) {
      markConnected();
      return null;
    }
    if (!res.ok) throw new Error(`brug gaf status ${res.status}`);
    markConnected();
    return await res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') return null;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function post(path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return res.json().catch(() => ({}));
}

async function loop() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      if (paused) {
        setBadge('paused');
        await sleep(4000);
        continue;
      }
      if (!port) port = await detect();
      if (!port) {
        if (connected) markDisconnected();
        else setBadge('off');
        await sleep(2500);
        continue;
      }
      let cmd = null;
      try {
        cmd = await pollOnce();
      } catch {
        port = null;
        markDisconnected();
        await sleep(2000);
        continue;
      }
      if (!cmd) continue;
      if (cmd.type === 'push') {
        // Bericht van de app (bv. het antwoord van de agent) → meteen naar het zijpaneel.
        pushPanel({ kind: 'push', data: cmd.payload || {} });
        continue;
      }
      if (!cmd.action) continue;
      busy = true;
      pushPanel({ kind: 'status', data: panelStatus() });
      let result;
      try {
        result = await handle(cmd);
      } catch (e) {
        result = { ok: false, error: String((e && e.message) || e) };
      }
      busy = false;
      result.id = cmd.id;
      const shortText = String(result.text || result.error || '').split('\n').slice(0, 2).join(' · ').slice(0, 160);
      pushRecent({
        ts: Date.now(),
        action: cmd.action,
        ok: result.ok !== false,
        text: shortText,
      });
      pushPanel({ kind: 'log', data: { ts: Date.now(), action: cmd.action, ok: result.ok !== false, text: shortText } });
      if ((cmd.action === 'read' || cmd.action === 'snapshot' || cmd.action === 'html') && result.ok !== false && result.text) {
        pushPanel({ kind: 'view', data: { text: String(result.text).slice(0, 8000), url: result.url || '' } });
      }
      pushPanel({ kind: 'status', data: panelStatus() });
      try {
        await post('/result', result);
      } catch {
        port = null;
        markDisconnected();
      }
    }
  } finally {
    running = false;
  }
}

// Een slapende service worker wordt gewekt door een tabbladsgebeurtenis: de app opent
// kort http://127.0.0.1:poort/wake in Chrome en wij sluiten dat tabblad meteen weer.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = info.url || tab?.url || '';
  if (!WAKE_RE.test(url)) return;
  chrome.tabs.remove(tabId).catch(() => {});
  port = null;
  loop();
});

chrome.alarms.create('orka-poll', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'orka-poll') loop();
});
chrome.runtime.onStartup.addListener(() => loop());
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('orka-poll', { periodInMinutes: 0.5 });
  loop();
});
chrome.storage.local.get('paused').then((v) => {
  paused = !!v.paused;
  loop();
});
loop();

// ---------- popup / zijpaneel ----------
async function handleMessage(msg) {
  if (msg.what === 'status') return panelStatus();
  if (msg.what === 'pause') {
    paused = !!msg.value;
    chrome.storage.local.set({ paused });
    if (!paused) {
      port = null;
      loop();
    } else setBadge('paused');
    pushPanel({ kind: 'status', data: panelStatus() });
    return { ok: true, paused };
  }
  if (msg.what === 'reconnect') {
    port = null;
    loop();
    return { ok: true };
  }
  if (msg.what === 'ask') {
    // Vraag uit het zijpaneel: gaat als bericht naar penuraplicatie, met de actieve tab erbij.
    if (paused) return { error: 'De extensie staat gepauzeerd.' };
    if (!port) {
      port = await detect();
      if (!port) return { error: 'Geen verbinding met penuraplicatie — is de app open?' };
    }
    const res = await fetch(`http://127.0.0.1:${port}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ text: String(msg.text || '').slice(0, 8000), tab: lastTab }),
    });
    return await res.json().catch(() => ({ error: `penuraplicatie antwoordde met status ${res.status}` }));
  }
  if (msg.what === 'stop') {
    if (!port) return { ok: false, error: 'Geen verbinding met penuraplicatie.' };
    const res = await fetch(`http://127.0.0.1:${port}/stop`, { method: 'POST', body: '{}' });
    return await res.json().catch(() => ({ ok: res.ok }));
  }
  return { ok: false, error: 'onbekend verzoek' };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg || msg.type !== 'orka') return;
  handleMessage(msg)
    .then((r) => respond(r))
    .catch((e) => respond({ error: String((e && e.message) || e) }));
  return true;
});

// ---------- hulpmiddelen: tabbladen ----------
async function getActiveTab() {
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs.length) tabs = await chrome.tabs.query({ active: true });
  if (!tabs.length) tabs = await chrome.tabs.query({});
  return tabs[0] || null;
}

async function resolveTab(tabId) {
  if (tabId != null && tabId !== '') {
    try {
      return await chrome.tabs.get(Number(tabId));
    } catch {
      return null;
    }
  }
  return getActiveTab();
}

function normaliseUrl(url) {
  const s = String(url || '').trim();
  if (!s) return 'about:blank';
  if (/^[a-z]+:\/\//i.test(s) || s.startsWith('about:') || s.startsWith('chrome://')) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^127\.0\.0\.1(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  if (/^[\w-]+(\.[\w-]+)+(\/|:|$)/.test(s)) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

async function waitReady(tabId, timeout = 25000) {
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > timeout) return false;
    await sleep(Date.now() - start < 400 ? 400 : 250);
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }
    if (tab.status === 'complete') {
      const ready = await runInPage(tabId, 'probe', {}).catch(() => null);
      if (ready && Date.now() - start > 500) return true;
    }
  }
}

const friendlyInjectError = (e) => {
  const m = String((e && e.message) || e);
  if (/showing error page/i.test(m)) {
    return 'De pagina kon niet laden (netwerkfout of een verkeerd adres). Controleer de URL of probeer het opnieuw.';
  }
  if (/Cannot access|chrome:\/\/|extension|not allowed|The extensions gallery/i.test(m)) {
    return 'Deze pagina kan Chrome niet aanpassen (chrome://, de Web Store, een PDF of een lege tab). Open een gewone website en probeer opnieuw.';
  }
  if (/No tab with id/i.test(m)) return 'Dit tabblad bestaat niet meer — vraag een nieuw overzicht met action "tabs".';
  if (/Frame with ID|The frame/i.test(m)) return 'Kon de pagina niet bereiken: hij is aan het laden of het tabblad is net gewisseld. Probeer opnieuw.';
  if (/Another debugger|Cannot attach/i.test(m)) return 'Kon geen verbinding met de pagina maken (staat DevTools open op dit tabblad?).';
  return m;
};

async function runInPage(tabId, action, params, world) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: pageAction,
    args: [action, params || {}],
    world: world === 'main' ? 'MAIN' : 'ISOLATED',
  });
  const v = res ? res.result : null;
  if (v && typeof v === 'object' && v.__error) throw new Error(v.__error);
  return v;
}

async function pageStep(tabId, action, params, world) {
  try {
    return await runInPage(tabId, action, params, world);
  } catch (e) {
    const m = friendlyInjectError(e);
    const err = new Error(m);
    err.friendly = true;
    throw err;
  }
}

// ---------- opdrachten ----------
async function handle(cmd) {
  const p = cmd.params || {};
  switch (cmd.action) {
    case 'status':
      return doStatus();
    case 'tabs':
      return doTabs();
    case 'open':
      return doOpen(p);
    case 'navigate':
      return doNavigate(p);
    case 'back':
    case 'forward':
      return doHistory(cmd.action, p);
    case 'close':
      return doClose(p);
    case 'focus':
      return doFocus(p);
    case 'read':
      return doSimple('read', p);
    case 'snapshot':
      return doSimple('snapshot', p);
    case 'html':
      return doSimple('html', p);
    case 'click':
      return doClick(p);
    case 'type':
      return doType(p);
    case 'keys':
      return doKeys(p);
    case 'scroll':
      return doScroll(p);
    case 'wait':
      return doWait(p);
    case 'eval':
      return doEval(p);
    case 'screenshot':
      return doScreenshot(p);
    default:
      return { ok: false, error: `Onbekende actie: ${cmd.action}` };
  }
}

async function doStatus() {
  const tabs = await chrome.tabs.query({});
  const windows = await chrome.windows.getAll();
  const tab = await getActiveTab();
  const lines = [
    `Verbonden met penuraplicatie (poort ${port}).`,
    `${tabs.length} tabbladen in ${windows.length} venster(s).`,
    tab ? `Actief: ${tab.title || '(geen titel)'} — ${tab.url || ''}` : 'Geen actief tabblad.',
  ];
  return { ok: true, text: lines.join('\n') };
}

async function doTabs() {
  const tabs = await chrome.tabs.query({});
  const lines = tabs
    .filter((t) => !t.url?.startsWith('chrome-extension://'))
    .slice(0, 40)
    .map((t) => `[${t.id}]${t.active ? ' (actief)' : ''} ${(t.title || '').slice(0, 70)} — ${t.url || ''}`);
  return { ok: true, text: lines.length ? lines.join('\n') : 'Geen tabbladen.' };
}

async function doOpen(p) {
  const url = normaliseUrl(p.url);
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const tab = await chrome.tabs.create({
    url,
    active: p.active !== false,
    windowId: win && win.type === 'normal' ? win.id : undefined,
  });
  await waitReady(tab.id);
  return afterNav(tab.id, `Nieuw tabblad: ${url}`, p);
}

async function doNavigate(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  const url = normaliseUrl(p.url);
  await chrome.tabs.update(tab.id, { url, active: p.active !== false });
  await waitReady(tab.id);
  return afterNav(tab.id, `Naar ${url}`, p);
}

async function doHistory(dir, p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  try {
    if (dir === 'back') await chrome.tabs.goBack(tab.id);
    else await chrome.tabs.goForward(tab.id);
  } catch (e) {
    return { ok: false, error: dir === 'back' ? 'Geen geschiedenis om terug te gaan.' : 'Geen geschiedenis om vooruit te gaan.' };
  }
  await waitReady(tab.id);
  return afterNav(tab.id, dir === 'back' ? 'Terug' : 'Vooruit', p);
}

async function doClose(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  await chrome.tabs.remove(tab.id);
  return { ok: true, text: `Tabblad gesloten: ${(tab.title || '').slice(0, 60)}` };
}

async function doFocus(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  return { ok: true, text: `Naar voren gehaald: ${tab.title || ''} — ${tab.url || ''}` };
}

async function doSimple(action, p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  const text = await pageStep(tab.id, action, p, p.world);
  return { ok: true, text, url: tab.url, title: tab.title };
}

async function doClick(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  const info = await pageStep(tab.id, 'click', p);
  await sleep(clamp(p.settle_ms, 0, 10000, 700));
  if (tab.status === 'loading') await waitReady(tab.id, 15000);
  const after = await pageStep(tab.id, 'probe', {}).catch(() => null);
  const changed = !!after && (after.url !== info.before || after.hash !== info.hash);
  const head = `Geklikt: ${info.tag}${info.label ? ` "${info.label}"` : ''}${info.href ? ` → ${String(info.href).slice(0, 100)}` : ''}`;
  const where = after ? `${after.title || '(geen titel)'} — ${after.url}` : `${tab.url || ''}`;
  if (!changed) return { ok: true, text: `${head}\n${where}\n(geen zichtbare verandering op de pagina)` };
  const snap = await pageStep(tab.id, 'snapshot', {
    max_chars: clamp(p.max_chars, 100, 4000, 900),
    max_elements: clamp(p.max_elements, 0, 60, 20),
    header: false,
  }).catch(() => '');
  return { ok: true, text: `${head}\n${where}\n${snap}` };
}

// ---------- typen en toetsen via het debug-protocol (echte invoer) ----------
async function withDebugger(tabId, fn) {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    return await fn(target);
  } finally {
    chrome.debugger.detach(target).catch(() => {});
  }
}

async function cdpInsertText(tabId, text) {
  return withDebugger(tabId, async (target) => {
    await chrome.debugger.sendCommand(target, 'Input.insertText', { text });
    return true;
  });
}

const CDP_KEYS = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  a: { key: 'a', code: 'KeyA', vk: 65 },
  c: { key: 'c', code: 'KeyC', vk: 67 },
  v: { key: 'v', code: 'KeyV', vk: 86 },
  x: { key: 'x', code: 'KeyX', vk: 88 },
};

async function cdpKey(tabId, spec) {
  const parts = String(spec || 'Enter').split('+').map((s) => s.trim()).filter(Boolean);
  const raw = (parts.length > 1 ? parts.pop() : spec.trim()).toLowerCase();
  const mods = { ctrl: 0, alt: 0, shift: 0, meta: 0 };
  for (const m of parts) {
    const l = m.toLowerCase();
    if (l === 'ctrl' || l === 'control') mods.ctrl = 2;
    else if (l === 'alt' || l === 'option') mods.alt = 1;
    else if (l === 'shift') mods.shift = 8;
    else if (l === 'meta' || l === 'cmd' || l === 'command') mods.meta = 4;
  }
  const info = CDP_KEYS[raw] || { key: raw, code: raw.length === 1 ? `Key${raw.toUpperCase()}` : raw, vk: 0 };
  const modifiers = mods.ctrl | mods.alt | mods.shift | mods.meta;
  const text = modifiers ? undefined : info.text !== undefined ? info.text : info.key.length === 1 ? info.key : undefined;
  return withDebugger(tabId, async (target) => {
    const base = { key: info.key, code: info.code, modifiers, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk };
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
    if (text && text !== '\r') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'char', ...base, text });
    }
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    return true;
  });
}

async function doType(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  const value = String(p.value ?? '');
  const clear = p.clear !== false;

  // 1) Eerst de gewone weg: waarde zetten met de juiste events (werkt op de meeste sites).
  let info = null;
  try {
    info = await pageStep(tab.id, 'type', { ...p, submit: false });
  } catch {}

  // 2) Controleer of het veld de tekst echt heeft overgenomen; zo niet, typ dan
  //    als een echte gebruiker via het debug-protocol (werkt ook bij React/Vue-velden).
  let check = await pageStep(tab.id, 'value', p).catch(() => null);
  const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
  if (!check || !same(check.value, value)) {
    try {
      await pageStep(tab.id, 'focus', { ...p, select: clear });
      await cdpInsertText(tab.id, value);
      const after = await pageStep(tab.id, 'value', p).catch(() => null);
      if (after && same(after.value, value)) {
        info = { tag: after.tag, label: after.label, value: short(value, 60), submitted: false, hash: after.hash, before: after.url };
        check = after;
      } else if (!info) {
        info = { tag: 'veld', label: '', value: short(value, 60), submitted: false, hash: check ? check.hash : '', before: tab.url };
      }
    } catch (e) {
      if (!info) return { ok: false, error: `Kon niet typen: ${friendlyInjectError(e)}` };
    }
  }

  // 3) Verzenden (Enter) als daarom gevraagd is — eerst als echte toetsaanslag,
  //    anders door het formulier zelf te verzenden.
  let submitted = false;
  if (p.submit) {
    try {
      await cdpKey(tab.id, 'Enter');
      submitted = true;
    } catch {
      const msg = await pageStep(tab.id, 'submit', p).catch(() => null);
      submitted = !!msg && /verzonden/.test(msg);
    }
  }

  await sleep(clamp(p.settle_ms, 0, 10000, 500));
  if (tab.status === 'loading') await waitReady(tab.id, 15000);
  let after = await pageStep(tab.id, 'probe', {}).catch(() => null);
  let changed = !!after && (!info || after.hash !== info.hash || after.url !== (info.before || tab.url));
  // Enter hielp niet? Dan het formulier zelf verzenden (tweede kans, geen extra tokens).
  if (!changed && p.submit) {
    const msg = await pageStep(tab.id, 'submit', p).catch(() => null);
    if (msg && /verzonden/.test(msg)) {
      submitted = true;
      await sleep(600);
      if (tab.status === 'loading') await waitReady(tab.id, 15000);
      after = await pageStep(tab.id, 'probe', {}).catch(() => null);
      changed = !!after && (!info || after.hash !== info.hash || after.url !== (info.before || tab.url));
    }
  }
  const head = `Getypt in ${info ? `${info.tag}${info.label ? ` "${info.label}"` : ''}` : 'veld'}: "${short(value, 60)}"${submitted ? ' + Enter' : ''}`;
  const where = after ? `${after.title || '(geen titel)'} — ${after.url}` : '';
  if (!changed) return { ok: true, text: `${head}\n(geen zichtbare verandering op de pagina)` };
  const snap = await pageStep(tab.id, 'snapshot', {
    max_chars: clamp(p.max_chars, 100, 4000, 800),
    max_elements: clamp(p.max_elements, 0, 60, 20),
    header: false,
  }).catch(() => '');
  return { ok: true, text: `${head}\n${where}\n${snap}` };
}

async function doKeys(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  let text;
  try {
    await cdpKey(tab.id, p.keys || 'Enter');
    text = `Toets "${p.keys || 'Enter'}" als echte toetsaanslag verstuurd.`;
  } catch {
    text = await pageStep(tab.id, 'keys', p);
  }
  await sleep(clamp(p.settle_ms, 0, 10000, 450));
  if (tab.status === 'loading') await waitReady(tab.id, 15000);
  const after = await pageStep(tab.id, 'probe', {}).catch(() => null);
  return { ok: true, text: `${text}${after ? `\nNu: ${after.title || ''} — ${after.url}` : ''}` };
}

async function doScroll(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  const text = await pageStep(tab.id, 'scroll', p);
  return { ok: true, text };
}

async function doWait(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  const timeout = clamp(p.timeout_ms, 500, 60000, 10000);
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await pageStep(tab.id, 'check', p).catch(() => null);
    if (v && v.found) return { ok: true, text: `Gevonden: ${v.what}\n${v.where || tab.url}` };
    if (Date.now() >= deadline) {
      const what = p.selector ? `selector "${p.selector}"` : p.text ? `tekst "${p.text}"` : 'de wachttijd';
      return { ok: false, error: `Niets gevonden binnen ${Math.round(timeout / 1000)}s (${what}). De pagina is er misschien nog niet of de tekst staat er anders.` };
    }
    await sleep(300);
  }
}

async function doEval(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  const max = clamp(p.max_chars, 200, 30000, 4000);
  const code = String(p.code || '');
  try {
    const out = await cdpEval(tab.id, code, max);
    return { ok: true, text: out };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/Another debugger|Cannot attach|not allowed/i.test(msg)) {
      try {
        const out = await evalByInjection(tab.id, code, max, p.world);
        return { ok: true, text: out };
      } catch (e2) {
        return { ok: false, error: `JS-fout: ${friendlyInjectError(e2)}` };
      }
    }
    return { ok: false, error: `JS-fout: ${msg}` };
  }
}

// Code uitvoeren via het debug-protocol (CDP): dat werkt ook op sites met een strenge
// Content-Security-Policy, waar eval in de pagina zelf geblokkeerd is.
async function cdpEval(tabId, code, limit) {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    const res = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: code,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
      timeout: 30000,
    });
    if (res && res.exceptionDetails) {
      const d = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'JS-fout';
      throw new Error(String(d).split('\n')[0]);
    }
    const v = res && res.result ? res.result.value : undefined;
    let out;
    if (v === undefined) out = (res && res.result && res.result.description) || 'undefined';
    else if (typeof v === 'string') out = v;
    else {
      try {
        out = JSON.stringify(v, null, 1);
      } catch {
        out = String(v);
      }
    }
    if (out === undefined) out = String(v);
    return out.length > limit ? `${out.slice(0, limit)}… [${out.length} tekens]` : out;
  } finally {
    chrome.debugger.detach(target).catch(() => {});
  }
}

async function evalByInjection(tabId, code, max, world) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (source, limit) => {
      try {
        const value = (0, eval)(source);
        let out;
        if (value === undefined) out = 'undefined';
        else if (typeof value === 'string') out = value;
        else {
          try {
            out = JSON.stringify(value, null, 1);
          } catch {
            out = String(value);
          }
        }
        if (out === undefined) out = String(value);
        return out.length > limit ? `${out.slice(0, limit)}… [${out.length} tekens]` : out;
      } catch (e) {
        return { __error: String((e && e.message) || e) };
      }
    },
    args: [code, max],
    world: world === 'main' ? 'MAIN' : 'ISOLATED',
  });
  const v = res ? res.result : '';
  if (v && typeof v === 'object' && v.__error) throw new Error(v.__error);
  return `${v}`.trim() || '(geen waarde)';
}

async function doScreenshot(p) {
  const tab = await resolveTab(p.tabId);
  if (!tab) return { ok: false, error: 'Geen tabblad gevonden.' };
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await sleep(350);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
  return { ok: true, text: `Screenshot van ${tab.title || tab.url}`, image: dataUrl };
}

async function afterNav(tabId, prefix, p) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const head = `${prefix}\n${tab ? `${tab.title || '(geen titel)'} — ${tab.url}` : 'onbekend'}`;
  if (p.snapshot === false) return { ok: true, text: head };
  const snap = await pageStep(tabId, 'snapshot', {
    max_chars: clamp(p.max_chars, 100, 4000, 1100),
    max_elements: clamp(p.max_elements, 0, 60, 25),
    header: false,
  }).catch((e) => `(kon de pagina niet lezen: ${friendlyInjectError(e)})`);
  return { ok: true, text: `${head}\n${snap}` };
}

// ---------- de functie die in de pagina zelf draait ----------
// Let op: deze functie wordt naar de pagina gekopieerd. Hij mag dus niets van buitenaf
// gebruiken — alles staat binnenin.
function pageAction(action, P) {
  P = P || {};
  const MAXCH = 30000;
  const clamp = (n, lo, hi, d) => {
    n = Number(n);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  const flat = (s) =>
    String(s == null ? '' : s)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const short = (s, n) => {
    const t = flat(s);
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) return false;
    return true;
  };
  const labelOf = (el) => {
    const own = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('value');
    if (own) return short(own, 70);
    if (el.labels && el.labels[0]) return short(el.labels[0].innerText, 70);
    return short(el.innerText || el.textContent || '', 70);
  };
  const pageText = (el) => flat(((el || document.body).innerText || (el || document.body).textContent || ''));
  const header = () => `${short(document.title, 90) || '(geen titel)'} — ${location.href}`;
  const hash = () => {
    const s = pageText(document.body).slice(0, 30000);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${h}:${s.length}`;
  };
  const highlight = (el) => {
    try {
      const prevOutline = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      el.style.outline = '3px solid #3b6cf0';
      el.style.outlineOffset = '2px';
      setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.outlineOffset = prevOffset;
      }, 900);
    } catch {}
  };
  const scrollInfo = () => {
    const el = document.scrollingElement || document.documentElement;
    const max = Math.max(0, el.scrollHeight - window.innerHeight);
    const pct = max ? Math.round((el.scrollTop / max) * 100) : 100;
    return `scroll ${Math.round(el.scrollTop)}/${Math.round(max)} (${pct}%) · venster ${window.innerWidth}x${window.innerHeight}`;
  };
  const mainRoot = () => {
    if (P.selector) {
      const el = document.querySelector(P.selector);
      if (!el) throw new Error(`Selector niet gevonden: ${P.selector}`);
      return el;
    }
    const bodyLen = pageText(document.body).length;
    let best = null;
    let bestLen = 0;
    for (const sel of ['main', '[role="main"]', 'article', '#content', '#main', '.content', '.main-content']) {
      for (const el of document.querySelectorAll(sel)) {
        const len = pageText(el).length;
        if (len > bestLen) {
          best = el;
          bestLen = len;
        }
        if (bestLen > bodyLen * 0.9) break;
      }
    }
    if (best && bestLen > 400) return best;
    return document.body;
  };

  function collectElements(maxEls, root) {
    document.querySelectorAll('[data-orka-ref]').forEach((e) => e.removeAttribute('data-orka-ref'));
    const sel =
      'button, input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="radio"], [role="combobox"], [role="textbox"], [role="searchbox"], summary, [contenteditable="true"], a[href], [role="link"]';
    // Rangschikking: eerst velden (daar wil je in typen), dan knoppen, dan links.
    const rank = (el) => {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable || role === 'textbox' || role === 'combobox' || role === 'searchbox') return 1;
      if (tag === 'button' || tag === 'summary' || ['button', 'tab', 'checkbox', 'switch', 'menuitem', 'radio', 'option'].includes(role)) return 2;
      return 3;
    };
    const seen = new Set();
    const nodes = [];
    for (const scope of [document.body, root]) {
      if (!scope) continue;
      for (const el of scope.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        nodes.push(el);
      }
    }
    nodes.sort((a, b) => rank(a) - rank(b));
    const out = [];
    let n = 0;
    for (let i = 0; i < nodes.length && n < maxEls; i++) {
      const el = nodes[i];
      if (!visible(el) || el.disabled) continue;
      const lbl0 = labelOf(el);
      if (!lbl0 && !(el.tagName === 'INPUT' && /^(text|search|email|url|tel|password)$/.test(el.type || ''))) continue;
      const tag = el.tagName.toLowerCase();
      const elRole = (el.getAttribute('role') || '').toLowerCase();
      const kind =
        tag === 'a'
          ? elRole === 'button'
            ? 'knop'
            : 'link'
          : tag === 'input' || tag === 'textarea' || tag === 'select'
            ? 'veld'
            : 'knop';
      n++;
      el.setAttribute('data-orka-ref', String(n));
      const bits = [];
      if (kind === 'link') {
        const h = String(el.getAttribute('href') || '').replace(/^https?:\/\/[^/]+/, '');
        if (h && !h.startsWith('javascript')) bits.push(short(h, 50));
      }
      if (kind === 'veld') {
        bits.push(el.type || tag);
        if (el.name) bits.push(`name=${el.name}`);
        if (el.placeholder) bits.push(`“${short(el.placeholder, 30)}”`);
        if (el.type === 'checkbox' || el.type === 'radio') bits.push(el.checked ? 'aan' : 'uit');
        else if (el.value && String(el.value).length <= 40) bits.push(`waarde="${short(el.value, 40)}"`);
        if (el.tagName === 'SELECT' && el.options && el.selectedIndex >= 0) bits.push(`gekozen="${short(el.options[el.selectedIndex]?.text || '', 30)}"`);
      }
      const lbl = labelOf(el);
      out.push(`[${n}] ${kind}${lbl ? ` "${lbl}"` : ''}${bits.length ? ` — ${bits.join(', ')}` : ''}`);
    }
    return out;
  }

  function target() {
    if (P.ref != null && P.ref !== '') {
      const el = document.querySelector(`[data-orka-ref="${String(P.ref).replace(/[^\d]/g, '')}"]`);
      if (!el) throw new Error(`Element [${P.ref}] bestaat niet meer op deze pagina. Maak eerst een nieuwe snapshot.`);
      return el;
    }
    if (P.selector) {
      const el = document.querySelector(P.selector);
      if (!el) throw new Error(`Selector niet gevonden: ${P.selector}`);
      if (!visible(el)) throw new Error(`Selector gevonden, maar het element is niet zichtbaar: ${P.selector}`);
      return el;
    }
    const txt = flat(P.text || '').toLowerCase();
    if (!txt) throw new Error('Geef een ref, selector of tekst om iets aan te wijzen.');
    const clickableSel = 'a, button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], summary, label, input[type="submit"], input[type="button"], [onclick], [tabindex]';
    const find = (selector) => {
      let best = null;
      let bestLen = Infinity;
      for (const el of document.querySelectorAll(selector)) {
        const raw = el.textContent || '';
        if (!raw || !raw.toLowerCase().includes(txt)) continue;
        if (!visible(el)) continue;
        const lbl = flat(el.innerText || raw || el.value || el.getAttribute('aria-label') || '').toLowerCase();
        if (!lbl || !lbl.includes(txt)) continue;
        if (lbl.length < bestLen) {
          best = el;
          bestLen = lbl.length;
        }
      }
      return best;
    };
    let best = find(clickableSel);
    if (!best) {
      const loose = find('td, th, li, span, div, p, h1, h2, h3, h4, section, article');
      if (loose) {
        const inside = loose.querySelector(clickableSel);
        best = inside && visible(inside) ? inside : loose.closest(clickableSel) || loose;
      }
    }
    if (!best) throw new Error(`Geen zichtbaar element met de tekst "${P.text}" op deze pagina. Maak een snapshot om te zien wat er wel staat.`);
    return best;
  }

  function pressEnter(el) {
    const base = { bubbles: true, cancelable: true, composed: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
    const down = el.dispatchEvent(new KeyboardEvent('keydown', base));
    el.dispatchEvent(new KeyboardEvent('keypress', base));
    el.dispatchEvent(new KeyboardEvent('keyup', base));
    let submitted = false;
    if (down) {
      const form = el.form || el.closest('form');
      if (form) {
        try {
          if (form.requestSubmit) form.requestSubmit();
          else form.submit();
          submitted = true;
        } catch {}
      }
    }
    return submitted;
  }

  const KEY_ALIAS = {
    enter: ['Enter', 'Enter'],
    return: ['Enter', 'Enter'],
    escape: ['Escape', 'Escape'],
    esc: ['Escape', 'Escape'],
    tab: ['Tab', 'Tab'],
    space: [' ', 'Space'],
    backspace: ['Backspace', 'Backspace'],
    delete: ['Delete', 'Delete'],
    up: ['ArrowUp', 'ArrowUp'],
    down: ['ArrowDown', 'ArrowDown'],
    left: ['ArrowLeft', 'ArrowLeft'],
    right: ['ArrowRight', 'ArrowRight'],
    pageup: ['PageUp', 'PageUp'],
    pagedown: ['PageDown', 'PageDown'],
    home: ['Home', 'Home'],
    end: ['End', 'End'],
  };

  try {
    switch (action) {
      case 'probe':
        return { url: location.href, title: document.title, hash: hash(), scroll: scrollInfo() };

      case 'focus': {
        const el = target();
        try {
          el.scrollIntoView({ block: 'center' });
        } catch {}
        highlight(el);
        try {
          el.focus({ preventScroll: true });
        } catch {}
        const val = el.isContentEditable ? el.textContent || '' : el.value == null ? '' : String(el.value);
        if (P.select && !el.isContentEditable && el.setSelectionRange) {
          try {
            el.setSelectionRange(0, val.length);
          } catch {}
        }
        return { tag: el.tagName.toLowerCase(), label: labelOf(el), value: val, editable: !!el.isContentEditable };
      }

      case 'submit': {
        const el = target();
        const form = el.form || (el.closest ? el.closest('form') : null);
        if (form) {
          try {
            if (form.requestSubmit) form.requestSubmit();
            else form.submit();
            return 'formulier verzonden';
          } catch (e) {
            return `formulier verzenden mislukte: ${String((e && e.message) || e)}`;
          }
        }
        return pressEnter(el) ? 'formulier verzonden via Enter' : 'geen formulier gevonden om te verzenden';
      }

      case 'value': {
        const el = target();
        const val = el.isContentEditable ? el.textContent || '' : el.value == null ? '' : String(el.value);
        return { value: val, tag: el.tagName.toLowerCase(), label: labelOf(el), hash: hash(), url: location.href, title: document.title };
      }

      case 'read': {
        const t = pageText(mainRoot());
        const offset = clamp(P.offset, 0, 10000000, 0);
        const max = clamp(P.max_chars, 200, MAXCH, 4000);
        const slice = t.slice(offset, offset + max);
        const meta = t.length > max || offset ? `[${t.length} tekens${offset ? `, vanaf ${offset}` : ''}]\n` : '';
        const tail = offset + max < t.length ? `\n… [nog ${t.length - offset - max} tekens — gebruik offset=${offset + max}]` : '';
        return `${header()}\n${meta}${slice}${tail}`;
      }

      case 'snapshot': {
        const root = mainRoot();
        const t = pageText(root);
        const max = clamp(P.max_chars, 100, MAXCH, 1500);
        const maxEls = clamp(P.max_elements, 0, 200, 40);
        const els = maxEls ? collectElements(maxEls, root) : [];
        const parts = [];
        if (P.header !== false) parts.push(header());
        parts.push(`[${t.length} tekens tekst · ${scrollInfo()}]`);
        if (max) parts.push(t.slice(0, max) + (t.length > max ? ' …' : ''));
        parts.push(els.length ? `--- knoppen, links en velden (klik met ref) ---\n${els.join('\n')}` : '(geen zichtbare knoppen of velden)');
        return parts.join('\n');
      }

      case 'html': {
        const el = P.selector ? mainRoot() : document.body;
        let html = el.outerHTML || '';
        html = html.replace(/></g, '>\n<');
        const max = clamp(P.max_chars, 200, MAXCH, 6000);
        return `${header()}\n${html.length > max ? `${html.slice(0, max)}\n… [${html.length} tekens totaal]` : html}`;
      }

      case 'click': {
        const el = target();
        try {
          el.scrollIntoView({ block: 'center', inline: 'center' });
        } catch {}
        highlight(el);
        const r = el.getBoundingClientRect();
        const opt = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          button: 0,
          buttons: 1,
        };
        try {
          el.focus({ preventScroll: true });
        } catch {}
        el.dispatchEvent(new PointerEvent('pointerover', opt));
        el.dispatchEvent(new PointerEvent('pointerdown', opt));
        el.dispatchEvent(new MouseEvent('mousedown', opt));
        el.dispatchEvent(new PointerEvent('pointerup', opt));
        el.dispatchEvent(new MouseEvent('mouseup', opt));
        el.dispatchEvent(new MouseEvent('click', opt));
        return {
          tag: el.tagName.toLowerCase(),
          label: labelOf(el),
          href: el.href || null,
          before: location.href,
          hash: hash(),
        };
      }

      case 'type': {
        const el = target();
        try {
          el.scrollIntoView({ block: 'center' });
        } catch {}
        highlight(el);
        const value = String(P.value ?? '');
        const clear = P.clear !== false;
        try {
          el.focus({ preventScroll: true });
        } catch {}
        if (el.isContentEditable) {
          if (clear) el.textContent = '';
          let ok = false;
          try {
            ok = document.execCommand('insertText', false, value);
          } catch {}
          if (!ok) el.textContent = (clear ? '' : el.textContent) + value;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
        } else {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          const setter = desc && desc.set;
          const set = (v) => {
            if (setter) setter.call(el, v);
            else el.value = v;
          };
          set(clear ? value : `${el.value == null ? '' : el.value}${value}`);
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const submitted = P.submit ? pressEnter(el) : false;
        return {
          tag: el.tagName.toLowerCase(),
          label: labelOf(el),
          value: short(value, 60),
          submitted,
          hash: hash(),
          before: location.href,
        };
      }

      case 'keys': {
        const spec = String(P.keys || 'Enter');
        const parts = spec.split('+').map((s) => s.trim()).filter(Boolean);
        const rawKey = parts.length > 1 ? parts.pop() : spec.trim();
        const mods = { ctrl: false, alt: false, shift: false, meta: false };
        for (const m of parts) {
          const l = m.toLowerCase();
          if (l === 'ctrl' || l === 'control') mods.ctrl = true;
          else if (l === 'alt' || l === 'option') mods.alt = true;
          else if (l === 'shift') mods.shift = true;
          else if (l === 'meta' || l === 'cmd' || l === 'command') mods.meta = true;
        }
        const alias = KEY_ALIAS[rawKey.toLowerCase()];
        const key = alias ? alias[0] : rawKey;
        const code = alias ? alias[1] : /^[a-z]$/i.test(rawKey) ? `Key${rawKey.toUpperCase()}` : rawKey;
        const targetEl =
          document.activeElement && document.activeElement !== document.body
            ? document.activeElement
            : P.selector
              ? document.querySelector(P.selector)
              : document.body;
        if (!targetEl) throw new Error(`Selector niet gevonden: ${P.selector}`);
        highlight(targetEl);
        const ev = {
          bubbles: true,
          cancelable: true,
          composed: true,
          key,
          code,
          ctrlKey: mods.ctrl,
          altKey: mods.alt,
          shiftKey: mods.shift,
          metaKey: mods.meta,
        };
        const okDown = targetEl.dispatchEvent(new KeyboardEvent('keydown', ev));
        targetEl.dispatchEvent(new KeyboardEvent('keypress', ev));
        targetEl.dispatchEvent(new KeyboardEvent('keyup', ev));
        if (key === 'Enter' && okDown) {
          const form = targetEl.form || targetEl.closest?.('form');
          if (form) {
            try {
              form.requestSubmit ? form.requestSubmit() : form.submit();
            } catch {}
          }
        }
        return `Toets "${spec}" naar <${targetEl.tagName.toLowerCase()}>${
          okDown ? '' : ' — de pagina hield de toets tegen'
        }`;
      }

      case 'scroll': {
        if (P.ref != null || P.selector || P.text) {
          const el = target();
          el.scrollIntoView({ block: 'center', inline: 'center' });
          highlight(el);
          return `Naar het element gescrold. ${scrollInfo()}`;
        }
        const dir = P.direction || 'down';
        const amount = clamp(P.amount, 1, 30, 6);
        const step = Math.round(window.innerHeight * 0.85);
        const dx = dir === 'left' ? -step : dir === 'right' ? step : 0;
        const dy = dir === 'down' ? step : dir === 'up' ? -step : 0;
        const el = document.scrollingElement || document.documentElement;
        const before = Math.round(el.scrollTop);
        window.scrollBy({ left: dx * amount, top: dy * amount, behavior: 'instant' });
        return `${scrollInfo()}${before === Math.round(el.scrollTop) ? ' — niet verder gescrold (einde van de pagina of een eigen scrollvlak)' : ''}`;
      }

      case 'check': {
        if (P.selector && document.querySelector(P.selector)) {
          const el = document.querySelector(P.selector);
          return { found: true, what: `selector "${P.selector}"`, where: visible(el) ? 'zichtbaar' : 'aanwezig maar onzichtbaar' };
        }
        if (P.text) {
          const t = pageText(document.body).toLowerCase();
          if (t.includes(flat(P.text).toLowerCase())) return { found: true, what: `tekst "${short(P.text, 50)}"`, where: header() };
        }
        if (!P.selector && !P.text) return { found: true, what: 'wachttijd', where: header() };
        return { found: false, what: P.selector ? `selector "${P.selector}"` : `tekst "${short(P.text, 50)}"`, where: header() };
      }

      default:
        return { __error: `Onbekende pagina-actie: ${action}` };
    }
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

markDisconnected();
