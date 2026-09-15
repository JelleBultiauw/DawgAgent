// BloxCode: verbinding met de Roblox Studio MCP-server (StudioMCP).
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Tools die minuten kunnen duren (AI-generatie, wachten op jobs).
const LONG_RUNNING = new Set([
  'generate_mesh', 'generate_procedural_model', 'generate_texture', 'generate_material',
  'segment_mesh', 'wait_job_finished', 'subagent', 'insert_asset', 'execute_luau',
]);

const withTimeout = (promise, ms, msg) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

function cleanSchema(schema, hideStudioId) {
  const s = JSON.parse(JSON.stringify(schema || {}));
  delete s.$schema;
  s.type = 'object';
  s.properties ||= {};
  if (hideStudioId) {
    delete s.properties.studio_id;
    if (Array.isArray(s.required)) s.required = s.required.filter((r) => r !== 'studio_id');
  }
  return s;
}

class Studio extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.tools = new Map();
    this.studios = [];
    this.studioId = null;
    this.state = 'off'; // off | connecting | connected | error
    this.error = null;
    this.serverName = '';
    this.connecting = null;
  }

  get connected() {
    return this.state === 'connected' && Boolean(this.client);
  }

  get studioName() {
    return this.studios.find((s) => s.id === this.studioId)?.name || null;
  }

  status() {
    return {
      state: this.state,
      error: this.error,
      serverName: this.serverName,
      tools: this.tools.size,
      studios: this.studios,
      studioId: this.studioId,
      studioName: this.studioName,
    };
  }

  // Verbindt als dat nog niet zo is (meerdere gelijktijdige aanroepen delen één poging).
  ensure(cfg) {
    if (this.connected) return Promise.resolve();
    this.connecting ||= this.connect(cfg).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async connect({ mcpCommand, mcpArgs = [], logPath }) {
    await this.close();
    this.state = 'connecting';
    this.error = null;
    this.emit('change');
    try {
      if (!fs.existsSync(mcpCommand)) throw new Error(`StudioMCP niet gevonden op: ${mcpCommand}. Is Roblox Studio geïnstalleerd?`);
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
      const transport = new StdioClientTransport({ command: mcpCommand, args: mcpArgs, stderr: 'pipe', env: process.env });
      if (logPath) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        transport.stderr?.on('data', (d) => fs.appendFile(logPath, d, () => {}));
      }
      const client = new Client({ name: 'penuraplicatie-bloxcode', version: '1.0.0' });
      await withTimeout(client.connect(transport), 30000, 'Time-out bij verbinden met StudioMCP (30s)');
      const tools = [];
      let cursor;
      do {
        const res = await withTimeout(client.listTools(cursor ? { cursor } : undefined), 30000, 'Time-out bij ophalen van Studio-tools');
        tools.push(...res.tools);
        cursor = res.nextCursor;
      } while (cursor);
      this.client = client;
      this.tools = new Map(tools.map((t) => [t.name, t]));
      this.serverName = client.getServerVersion()?.name || 'RobloxStudio';
      this.state = 'connected';
      client.onclose = () => {
        if (this.client !== client) return;
        this.client = null;
        this.state = 'error';
        this.error = 'Verbinding met Roblox Studio verbroken';
        this.emit('change');
      };
      await this.refreshStudios();
    } catch (e) {
      this.state = 'error';
      this.error = e.message;
      this.client = null;
    }
    this.emit('change');
  }

  async close() {
    const client = this.client;
    this.client = null;
    this.tools = new Map();
    if (client) {
      try {
        await client.close();
      } catch {}
    }
    this.state = 'off';
  }

  async refreshStudios() {
    if (!this.client || !this.tools.has('list_roblox_studios')) return this.studios;
    let studios = [];
    try {
      const out = await this.call('list_roblox_studios', {}, { timeoutSec: 30 });
      studios = JSON.parse(out.text).studios || [];
    } catch {}
    this.studios = studios.filter((s) => s && typeof s === 'object');
    const ids = this.studios.map((s) => s.id);
    if (!ids.includes(this.studioId)) this.studioId = ids.length === 1 ? ids[0] : null;
    this.emit('change');
    return this.studios;
  }

  select(id) {
    if (!this.studios.some((s) => s.id === id)) throw new Error('Dat Studio-venster bestaat niet (meer). Ververs de lijst.');
    this.studioId = id;
    this.emit('change');
  }

  toolDefs() {
    const hide = Boolean(this.studioId);
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: String(t.description || t.title || t.name).slice(0, 6000),
      parameters: cleanSchema(t.inputSchema, hide),
      annotations: t.annotations || null,
    }));
  }

  // Resultaat: { text, images: [paden], isError }
  async call(name, args = {}, { signal, timeoutSec = 900, filesDir } = {}) {
    const client = this.client;
    if (!client) throw new Error('Niet verbonden met Roblox Studio. Klik op "Opnieuw verbinden".');
    const tool = this.tools.get(name);
    const a = { ...(args || {}) };
    if (this.studioId && tool?.inputSchema?.properties?.studio_id && !a.studio_id) a.studio_id = this.studioId;
    const seconds = LONG_RUNNING.has(name) ? timeoutSec : Math.min(timeoutSec, 120);
    const res = await client.callTool({ name, arguments: a }, undefined, {
      signal,
      timeout: seconds * 1000,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: seconds * 1000,
    });
    const texts = [];
    const images = [];
    for (const part of res.content || []) {
      if (part.type === 'text') texts.push(part.text);
      else if (part.type === 'image') {
        if (filesDir) {
          const ext = String(part.mimeType || 'image/png').split('/')[1].replace('jpeg', 'jpg');
          const file = path.join(filesDir, `studio-${Date.now()}-${images.length}.${ext}`);
          fs.writeFileSync(file, Buffer.from(part.data, 'base64'));
          images.push(file);
        }
      } else if (part.type === 'resource') texts.push(part.resource?.text ?? `[bron: ${part.resource?.uri || ''}]`);
      else texts.push(`[${part.type || 'onbekende'} inhoud weggelaten]`);
    }
    if (!texts.length && res.structuredContent) texts.push(JSON.stringify(res.structuredContent));
    const text = texts.join('\n').trim() || (images.length ? '(afbeelding)' : '(geen uitvoer)');
    return { text, images, isError: Boolean(res.isError) };
  }
}

module.exports = { studio: new Studio(), LONG_RUNNING };
