// Zijpaneel van penuraplicatie: hier zie je je vragen en de antwoorden van de agent,
// niets meer. Het denk- en werkproces (welke stappen hij zet, wat hij leest) blijft in
// penuraplicatie zelf; wat hij het laatst las kun je hier opvragen met "Wat leest hij?".
// Elke Chrome-tab houdt zijn eigen chat: wissel je van tab, dan wisselt het paneel mee.
const $ = (id) => document.getElementById(id);
const feed = $('feed');
const dot = $('dot');
const tabTitle = $('tabTitle');
const tabUrl = $('tabUrl');
const askInput = $('askInput');
const askSend = $('askSend');
const pauseBtn = $('pause');
const stopBtn = $('stop');
const summarizeBtn = $('summarize');
const whatBtn = $('what');

let paused = false;
let agentRunning = false; // de agent werkt aan een vraag uit dit paneel
let busy = false; // het paneel of de agent is bezig (agent telt zwaarder dan een pagina-actie)
let port = null;

// Per tab een eigen gesprek: eigen berichten en eigen "wat leest hij".
// activityTab is de tab waar de lopende vraag over gaat; het antwoord van de agent
// komt daar terecht, ook als je ondertussen naar een andere tab bent gewisseld.
const chats = new Map(); // tab → { nodes: [], lastView: '' }
let currentTab = null; // de tab die je nu in het paneel ziet
let activityTab = null; // de tab waar de agent nu voor werkt

const keyOf = (tab) => (tab && tab.id != null && tab.id !== '' ? String(tab.id) : 'onbekend');

function chatFor(key) {
  let c = chats.get(key);
  if (!c) {
    c = { nodes: [], lastView: '' };
    chats.set(key, c);
  }
  return c;
}

function clock(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function makeEntry(kind, title, text) {
  const el = document.createElement('div');
  el.className = `entry ${kind} clip`;
  const head = document.createElement('div');
  head.className = 'head';
  const t = document.createElement('span');
  t.textContent = clock();
  const b = document.createElement('b');
  b.textContent = title;
  head.append(t, b);
  const body = document.createElement('div');
  body.className = 'body';
  body.textContent = text;
  el.append(head, body);
  if (text.length > 320) {
    const more = document.createElement('span');
    more.className = 'more';
    more.textContent = 'meer';
    more.addEventListener('click', () => {
      const clipped = el.classList.toggle('clip');
      more.textContent = clipped ? 'meer' : 'minder';
    });
    el.append(more);
  }
  return el;
}

// Bericht in de chat van de tab waar het bij hoort (standaard: de lopende vraag,
// anders de tab die je bekijkt). Staat die chat open, dan zie je het meteen.
function entry(kind, title, text, key) {
  const k = key || activityTab || currentTab || 'onbekend';
  const c = chatFor(k);
  const el = makeEntry(kind, title, text);
  c.nodes.push(el);
  if (c.nodes.length > 60) {
    const gone = c.nodes.shift();
    if (gone.parentNode === feed) gone.remove();
  }
  if (k === currentTab) {
    feed.append(el);
    feed.scrollTop = feed.scrollHeight;
    updateWorking();
  }
}

// "bezig…" onderaan de chat van de tab waar de agent nu voor werkt — zodat je ziet
// dat er iets loopt zonder de tussenstappen te tonen.
function updateWorking() {
  const old = feed.querySelector('.entry.working');
  const on = busy && !paused && !!activityTab && activityTab === currentTab;
  if (!on) {
    if (old) old.remove();
    return;
  }
  if (old && feed.lastElementChild === old) return;
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'entry working';
  el.textContent = 'bezig…';
  feed.append(el);
  feed.scrollTop = feed.scrollHeight;
}

function showChat(key) {
  const c = chatFor(key);
  if (!c.nodes.length) {
    c.nodes.push(makeEntry('chat', 'nieuwe chat', 'Deze tab heeft nog geen geschiedenis. Vraag hieronder over de pagina.'));
  }
  feed.replaceChildren(...c.nodes);
  feed.scrollTop = feed.scrollHeight;
  updateWorking();
}

function setStatus(s) {
  const wasBusy = busy;
  const wasPaused = paused;
  busy = agentRunning || !!s.busy;
  paused = !!s.paused;
  dot.className = `dot ${busy && s.connected && !paused ? 'busy' : paused ? 'paused' : s.connected ? 'on' : ''}`;
  dot.title = paused ? 'gepauzeerd' : s.connected ? `verbonden (poort ${s.port})` : 'geen verbinding met penuraplicatie';
  pauseBtn.textContent = paused ? '>' : 'ii';
  pauseBtn.title = paused ? 'Doorgaan' : 'Pauzeren';
  stopBtn.hidden = !busy;
  summarizeBtn.disabled = !s.connected || paused;
  whatBtn.disabled = !s.connected || paused;
  askSend.disabled = !s.connected || paused;
  if (s.tab) setTab(s.tab);
  if (wasBusy !== busy || wasPaused !== paused) updateWorking();
}

function setTab(tab) {
  tabTitle.textContent = tab.title || '(geen titel)';
  tabUrl.textContent = tab.url || '';
  tabTitle.title = tab.title || '';
  tabUrl.title = tab.url || '';
  const key = keyOf(tab);
  if (key === 'onbekend' && currentTab) return;
  if (key !== currentTab) {
    currentTab = key;
    showChat(key);
  }
}

function showView(text) {
  chatFor(activityTab || currentTab || 'onbekend').lastView = text || '';
  whatBtn.textContent = 'Wat leest hij?';
}

async function send(what, extra = {}) {
  try {
    return await chrome.runtime.sendMessage({ type: 'orka', what, ...extra });
  } catch (e) {
    entry('error', 'fout', String((e && e.message) || e));
    return null;
  }
}

function connect() {
  port = chrome.runtime.connect({ name: 'orka-panel' });
  port.onMessage.addListener((msg) => {
    if (!msg || !msg.kind) return;
    if (msg.kind === 'status') setStatus(msg.data || {});
    else if (msg.kind === 'tab') setTab(msg.data || {});
    else if (msg.kind === 'view') showView(msg.data?.text || ''); // alleen onthouden voor "Wat leest hij?"
    // Acties, paginalezingen en tussenstappen komen hier bewust niet in de chat:
    // dit paneel toont alleen de antwoorden; de rest staat in penuraplicatie.
    else if (msg.kind === 'push') {
      const d = msg.data || {};
      if (d.kind === 'answer') entry('answer', 'antwoord', String(d.text || '').slice(0, 6000));
      else if (d.kind === 'note') entry('note', 'systeem', String(d.text || '').slice(0, 600));
      else if (d.kind === 'error') entry('error', 'let op', String(d.text || ''));
      else if (d.kind === 'state') {
        agentRunning = !!d.running;
        setStatus({ ...(d.status || {}), busy: d.running });
        if (!d.running) activityTab = null;
        updateWorking();
      }
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 1500);
  });
  send('status').then((s) => s && setStatus(s));
}

pauseBtn.addEventListener('click', async () => {
  const r = await send('pause', { value: !paused });
  if (r) setStatus({ ...(await send('status')), paused: r.paused });
});

stopBtn.addEventListener('click', async () => {
  await send('stop');
  entry('note', 'stop', 'De agent is gestopt.');
});

summarizeBtn.addEventListener('click', async () => {
  const key = currentTab || 'onbekend';
  entry('user', 'jij', 'Vat deze pagina samen', key);
  activityTab = currentTab;
  updateWorking();
  const r = await send('ask', { text: 'Vat de pagina samen waar ik naar kijk. Kort en met de belangrijkste punten.' });
  if (r?.error) {
    entry('error', 'let op', r.error, key);
    activityTab = null;
    updateWorking();
  }
});

whatBtn.addEventListener('click', () => {
  const key = currentTab || 'onbekend';
  const v = chatFor(key).lastView;
  if (!v) return entry('view', 'nog niets', 'De agent heeft in deze chat nog geen pagina gelezen.', key);
  entry('view', 'wat hij leest', v, key);
});

async function ask(text) {
  if (!text) return;
  const key = currentTab || 'onbekend';
  entry('user', 'jij', text, key);
  activityTab = currentTab;
  updateWorking();
  const r = await send('ask', { text });
  if (r?.error) {
    entry('error', 'let op', r.error, key);
    activityTab = null;
    updateWorking();
  }
}

function askFromInput() {
  const text = askInput.value.trim();
  if (!text) return;
  askInput.value = '';
  ask(text);
}

askSend.addEventListener('click', askFromInput);
askInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    askFromInput();
  }
});

connect();
setInterval(() => send('status').then((s) => s && setStatus(s)), 5000);
