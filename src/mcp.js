// Connectors: MCP-servers (lokaal via stdio of op afstand via HTTP).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

let sdk = null;
function loadSdk() {
  sdk ||= {
    Client: require('@modelcontextprotocol/sdk/client/index.js').Client,
    StdioClientTransport: require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport,
    StreamableHTTPClientTransport: require('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport,
    SSEClientTransport: require('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransport,
  };
  return sdk;
}

const safeName = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'connector';

const withTimeout = (promise, ms, msg) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

const signature = (c) => JSON.stringify([c.type, c.command, c.args, c.env, c.url, c.headers, c.name]);

class Connectors extends EventEmitter {
  constructor() {
    super();
    this.conns = new Map();
    this.lookup = new Map();
  }

  async sync(configs = []) {
    const wanted = new Map(configs.filter((c) => c.enabled !== false).map((c) => [c.id, c]));
    for (const [id, conn] of this.conns) {
      const c = wanted.get(id);
      if (!c || signature(c) !== conn.sig) await this.stop(id);
    }
    await Promise.allSettled([...wanted.values()].filter((c) => !this.conns.has(c.id)).map((c) => this.start(c)));
  }

  async start(config) {
    const { Client, StdioClientTransport, StreamableHTTPClientTransport, SSEClientTransport } = loadSdk();
    const conn = { config, sig: signature(config), status: 'connecting', error: null, tools: [], client: null, stderr: '' };
    this.conns.set(config.id, conn);
    this.emit('change');
    try {
      if (config.type === 'http') {
        const url = new URL(config.url);
        const requestInit = { headers: config.headers || {} };
        try {
          conn.client = new Client({ name: 'orka', version: '1.0.0' });
          await withTimeout(conn.client.connect(new StreamableHTTPClientTransport(url, { requestInit })), 30000, 'Time-out bij verbinden');
        } catch (e) {
          try {
            await conn.client.close();
          } catch {}
          conn.client = new Client({ name: 'orka', version: '1.0.0' });
          await withTimeout(conn.client.connect(new SSEClientTransport(url, { requestInit })), 30000, `Kon niet verbinden: ${e.message}`);
        }
      } else {
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: { ...process.env, ...(config.env || {}) },
          cwd: config.cwd || os.homedir(),
          stderr: 'pipe',
        });
        transport.stderr?.on('data', (d) => {
          conn.stderr = (conn.stderr + d.toString()).slice(-3000);
        });
        conn.client = new Client({ name: 'orka', version: '1.0.0' });
        await withTimeout(conn.client.connect(transport), 90000, 'Time-out bij starten (90s)');
      }
      const tools = [];
      let cursor;
      do {
        const res = await withTimeout(conn.client.listTools(cursor ? { cursor } : undefined), 30000, 'Time-out bij ophalen van tools');
        tools.push(...res.tools);
        cursor = res.nextCursor;
      } while (cursor);
      conn.tools = tools;
      conn.status = 'connected';
      conn.client.onclose = () => {
        if (this.conns.get(config.id) === conn && conn.status === 'connected') {
          conn.status = 'error';
          conn.error = 'Verbinding verbroken';
          this.emit('change');
        }
      };
    } catch (e) {
      conn.status = 'error';
      conn.error = `${e.message}${conn.stderr ? `\n${conn.stderr.trim().slice(-800)}` : ''}`;
      try {
        await conn.client?.close();
      } catch {}
      conn.client = null;
    }
    this.emit('change');
  }

  async stop(id) {
    const conn = this.conns.get(id);
    if (!conn) return;
    this.conns.delete(id);
    try {
      await conn.client?.close();
    } catch {}
    this.emit('change');
  }

  async restart(config) {
    await this.stop(config.id);
    if (config.enabled !== false) await this.start(config);
  }

  status() {
    return [...this.conns.values()].map((c) => ({
      id: c.config.id,
      name: c.config.name,
      status: c.status,
      error: c.error,
      tools: c.tools.map((t) => ({ name: t.name, description: t.description || '' })),
    }));
  }

  toolDefs() {
    const defs = [];
    this.lookup = new Map();
    for (const c of this.conns.values()) {
      if (c.status !== 'connected') continue;
      for (const t of c.tools) {
        let name = `mcp__${safeName(c.config.name)}__${t.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        if (name.length > 64) name = `${name.slice(0, 55)}_${crypto.createHash('md5').update(name).digest('hex').slice(0, 8)}`;
        this.lookup.set(name, { conn: c, tool: t.name });
        defs.push({ name, toolName: t.name, connectorName: c.config.name, description: t.description || '', parameters: t.inputSchema });
      }
    }
    return defs;
  }

  async call(name, args, ctx) {
    const hit = this.lookup.get(name);
    if (!hit?.conn.client) throw new Error('Deze connector is niet (meer) verbonden');
    const res = await hit.conn.client.callTool({ name: hit.tool, arguments: args || {} }, undefined, {
      signal: ctx.signal,
      timeout: 600000,
      resetTimeoutOnProgress: true,
    });
    const texts = [];
    const images = [];
    for (const item of res.content || []) {
      if (item.type === 'text') texts.push(item.text);
      else if (item.type === 'image') {
        const ext = (item.mimeType || 'image/png').split('/')[1].replace('jpeg', 'jpg');
        const file = path.join(ctx.filesDir, `connector-${Date.now()}-${images.length}.${ext}`);
        fs.writeFileSync(file, Buffer.from(item.data, 'base64'));
        images.push(file);
        texts.push(`[afbeelding opgeslagen: ${file}]`);
      } else if (item.type === 'resource') texts.push(item.resource?.text ?? `[resource ${item.resource?.uri}]`);
      else if (item.type === 'resource_link') texts.push(`[link ${item.uri}]`);
      else texts.push(JSON.stringify(item));
    }
    if (!texts.length && res.structuredContent) texts.push(JSON.stringify(res.structuredContent, null, 2));
    return { ok: !res.isError, text: texts.join('\n') || '(leeg resultaat)', images };
  }

  async stopAll() {
    await Promise.allSettled([...this.conns.keys()].map((id) => this.stop(id)));
  }
}

// Leest het formaat van Claude Desktop / Cursor: { "mcpServers": { naam: {command,args,env} | {url,headers} } }
function parseServersJson(text) {
  const json = JSON.parse(text);
  const servers = json.mcpServers || json.servers || json;
  return Object.entries(servers).map(([name, s]) => {
    const id = crypto.randomBytes(5).toString('hex');
    if (s.url) return { id, name, type: 'http', url: s.url, headers: s.headers || {}, enabled: true };
    return { id, name, type: 'stdio', command: s.command, args: s.args || [], env: s.env || {}, enabled: true };
  });
}

module.exports = { Connectors, parseServersJson };
