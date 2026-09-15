// Brug tussen penuraplicatie en de Chrome-extensie ("penuraplicatie Browser").
//
// De app luistert op 127.0.0.1 (poort 8798 en verder). De extensie long-pollt /poll,
// voert de opdracht uit in Chrome en stuurt het antwoord naar /result. Alle antwoorden
// zijn tekst (paginatekst, HTML of een genummerde elementenlijst), zodat het aantal
// tokens klein blijft — screenshots zijn alleen op verzoek.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const { PATHS } = require('./store');
const { APP_DIR } = require('./snapshots');

const PORTS = [8798, 8799, 8800, 8801, 8802, 8803, 8804, 8805, 8806, 8807];
const HOLD_MS = 20000; // hoe lang /poll wacht op een opdracht
const ALIVE_MS = 25000; // zo lang na het laatste contact vinden we de extensie "verbonden"
const BROWSERS = ['Google Chrome', 'Google Chrome Canary', 'Chromium', 'Brave Browser', 'Microsoft Edge', 'Arc'];

const EXT_SOURCE = path.join(APP_DIR, 'browser-extension');
const EXT_DIR = path.join(PATHS.data, 'browser-extension');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- extensiemap klaarzetten in de datamap (stabiel pad voor Chrome) ----------
function copyTree(src, dst) {
  let changed = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) changed += copyTree(from, to);
    else {
      const a = fs.statSync(from);
      let upToDate = false;
      try {
        const b = fs.statSync(to);
        upToDate = b.size === a.size && b.mtimeMs >= a.mtimeMs;
      } catch {}
      if (!upToDate) {
        fs.copyFileSync(from, to);
        changed++;
      }
    }
  }
  return changed;
}

function syncExtension() {
  try {
    if (!fs.existsSync(EXT_SOURCE)) return { dir: EXT_DIR, changed: 0 };
    return { dir: EXT_DIR, changed: copyTree(EXT_SOURCE, EXT_DIR) };
  } catch (e) {
    return { dir: EXT_DIR, changed: 0, error: e.message };
  }
}

function openInBrowser(url) {
  return new Promise((resolve) => {
    let i = 0;
    const attempt = () => {
      if (i >= BROWSERS.length) return resolve(false);
      const app = BROWSERS[i++];
      execFile('open', ['-a', app, url], (err) => (err ? attempt() : resolve(true)));
    };
    attempt();
  });
}

// ---------- brug ----------
class BrowserBridge extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = null;
    this.lastSeen = 0;
    this.polling = false;
    this.tab = {};
    this.queue = [];
    this.waiters = []; // opengehouden /poll-verzoeken
    this.pushes = []; // berichten voor het Chrome-zijpaneel (agent-antwoorden, status)
    this.inflight = new Map();
    this.counts = { sent: 0, done: 0, failed: 0 };
    this._lastEmit = 0;
  }

  get connected() {
    return Date.now() - this.lastSeen < ALIVE_MS;
  }

  status() {
    return {
      running: Boolean(this.server),
      port: this.port,
      connected: this.connected,
      lastSeen: this.lastSeen,
      tab: this.tab,
      pending: this.queue.length + this.inflight.size,
      pushes: this.pushes.length,
      counts: this.counts,
      dir: EXT_DIR,
      source: EXT_SOURCE,
      browsers: BROWSERS,
    };
  }

  touch() {
    this.lastSeen = Date.now();
    const now = Date.now();
    if (now - this._lastEmit > 900) {
      this._lastEmit = now;
      this.emit('change', this.status());
    }
  }

  start() {
    if (this.server) return Promise.resolve(this.port);
    return new Promise((resolve) => {
      const tryPort = (i) => {
        if (i >= PORTS.length) return resolve(null);
        const server = http.createServer((req, res) => this.route(req, res));
        server.on('error', () => {
          try {
            server.close();
          } catch {}
          tryPort(i + 1);
        });
        server.listen(PORTS[i], '127.0.0.1', () => {
          this.server = server;
          this.port = PORTS[i];
          resolve(this.port);
        });
      };
      tryPort(0);
    });
  }

  stop() {
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      this.respond(w.res, 204, null);
    }
    for (const [, cmd] of this.inflight) {
      clearTimeout(cmd.timer);
      cmd.reject(new Error('Brug gestopt.'));
    }
    this.inflight.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = null;
    }
  }

  respond(res, code, body, headers = {}) {
    try {
      const data = body == null ? '' : JSON.stringify(body);
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      });
      res.end(data);
    } catch {}
  }

  route(req, res) {
    // Alleen de extensie mag meepraten: verzoeken met een web-origin weren we.
    const origin = String(req.headers.origin || '');
    if (origin && !origin.startsWith('chrome-extension://')) {
      return this.respond(res, 403, { error: 'alleen de extensie mag dit' });
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    if (p === '/ping') return this.respond(res, 200, { app: 'penuraplicatie', port: this.port, pid: process.pid });

    if (p === '/status') return this.respond(res, 200, this.status());

    if (p === '/wake') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(
        `<!doctype html><meta charset="utf-8"><title>penuraplicatie</title>
<body style="font:15px -apple-system,system-ui,sans-serif;padding:40px;max-width:640px;margin:auto;color:#1a1a19">
<h2>penuraplicatie</h2>
<p>Deze tab wordt automatisch gesloten — de Chrome-extensie van penuraplicatie maakt verbinding.</p>
<p style="color:#8a8a86">Blijft dit staan? Dan is de extensie nog niet geladen. Open dan <code>chrome://extensions</code>, zet Ontwikkelaarsmodus aan en kies "Uitgepakte extensie laden" met de map <code>${EXT_DIR.replace(/</g, '&lt;')}</code>.</p></body>`,
      );
    }

    if (p === '/poll') {
      this.touch();
      this.polling = true;
      const t = url.searchParams.get('t');
      const u = url.searchParams.get('u');
      if (t != null || u != null) {
        const next = { title: t || '', url: u || '' };
        if (next.title !== this.tab.title || next.url !== this.tab.url) {
          this.tab = next;
          this.emit('change', this.status());
        }
      }
      if (this.queue.length) return this.respond(res, 200, this.queue.shift());
      if (this.pushes.length) return this.respond(res, 200, { type: 'push', payload: this.pushes.shift() });
      const waiter = { res, timer: null };
      waiter.timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        this.respond(res, 204, null);
      }, HOLD_MS);
      this.waiters.push(waiter);
      req.on('close', () => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          clearTimeout(waiter.timer);
        }
      });
      return;
    }

    if (p === '/result' && req.method === 'POST') {
      this.touch();
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 12 * 1024 * 1024) return req.destroy();
        chunks.push(c);
      });
      req.on('end', () => {
        let body = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {}
        const cmd = body && this.inflight.get(body.id);
        if (cmd) {
          clearTimeout(cmd.timer);
          this.inflight.delete(body.id);
          if (body.ok === false || body.error) {
            this.counts.failed++;
            cmd.reject(new Error(String(body.error || 'De browser kon de actie niet uitvoeren.')));
          } else {
            this.counts.done++;
            cmd.resolve(body);
          }
        }
        this.respond(res, 200, { ok: true });
      });
      return;
    }

    // Handig om te testen: POST /dev/exec {action, params}
    if (p === '/dev/exec' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const out = await this.send(body.action, body.params || {}, { timeoutMs: body.timeout_ms || 60000 });
          this.respond(res, 200, out);
        } catch (e) {
          this.respond(res, 500, { error: e.message });
        }
      });
      return;
    }

    // Vraag uit het zijpaneel van de extensie: "vat deze pagina samen", "zoek …"
    if (p === '/ask' && req.method === 'POST') {
      this.touch();
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {}
        const text = String(body.text || '').trim();
        if (!text) return this.respond(res, 400, { error: 'Geen vraag ontvangen.' });
        if (!this.listenerCount('ask')) return this.respond(res, 503, { error: 'penuraplicatie is nog niet klaar met opstarten.' });
        this.emit('ask', { text, tab: body.tab || this.tab });
        this.respond(res, 200, { ok: true });
      });
      return;
    }

    // Stop de agent (knop in het zijpaneel)
    if (p === '/stop' && req.method === 'POST') {
      this.touch();
      req.resume();
      this.emit('stop');
      return this.respond(res, 200, { ok: true });
    }

    this.respond(res, 404, { error: 'onbekend pad' });
  }

  // Zorgt dat de extensie er is; opent Chrome en tikt de service worker wakker via /wake.
  async ensureConnected({ launch = true, waitMs = 9000 } = {}) {
    if (this.connected) return true;
    if (!this.server) await this.start();
    if (!launch) return false;
    const wake = `http://127.0.0.1:${this.port}/wake`;
    await openInBrowser(wake).catch(() => false);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(350);
      if (this.connected) return true;
    }
    return this.connected;
  }

  // Bericht naar het Chrome-zijpaneel (agent-antwoorden, status, fouten).
  push(payload) {
    if (!payload) return;
    const frame = { type: 'push', payload };
    if (this.waiters.length) {
      const w = this.waiters.shift();
      clearTimeout(w.timer);
      return this.respond(w.res, 200, frame);
    }
    this.pushes.push(payload);
    if (this.pushes.length > 100) this.pushes.splice(0, this.pushes.length - 100);
  }

  async send(action, params = {}, { timeoutMs = 90000, ensure = true } = {}) {
    if (ensure) {
      const ok = await this.ensureConnected();
      if (!ok) {
        throw new Error(
          'De Chrome-extensie "penuraplicatie Browser" is niet verbonden. Open Chrome (het tabblad dat even langskomt sluit zichzelf) of laad de extensie via Instellingen → Browser.',
        );
      }
    } else if (!this.connected) {
      throw new Error('De Chrome-extensie is niet verbonden.');
    }
    const cmd = { id: crypto.randomUUID(), action, params, ts: Date.now() };
    this.counts.sent++;
    this.emit('change', this.status());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inflight.delete(cmd.id);
        this.counts.failed++;
        reject(new Error(`De browser antwoordde niet binnen ${Math.round(timeoutMs / 1000)}s op "${action}".`));
      }, timeoutMs);
      this.inflight.set(cmd.id, { resolve, reject, timer, action });
      if (this.waiters.length) {
        const w = this.waiters.shift();
        clearTimeout(w.timer);
        this.respond(w.res, 200, cmd);
      } else {
        this.queue.push(cmd);
      }
    });
  }
}

const bridge = new BrowserBridge();

module.exports = { bridge, syncExtension, EXT_DIR, EXT_SOURCE, openInBrowser, PORTS };
