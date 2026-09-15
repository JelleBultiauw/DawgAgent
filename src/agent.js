// De agent-lus: model aanroepen, tools uitvoeren, goedkeuring vragen, alles opslaan.
// Chats met BloxCode aan (session.kind === 'blox') gebruiken dezelfde lus, maar met de Roblox
// Studio-tools, de BloxCode-prompt en het BloxCode-veiligheidsbeleid (plan/ask/auto/yolo).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { streamChat, quickChat } = require('./llm');
const { buildTools, toApiTools, needsApproval } = require('./tools');
const { buildSystemPrompt } = require('./prompt');
const { attachmentBlock } = require('./attachments');
const i18n = require('./i18n');
const { isInsideApp, createSnapshot, APP_DIR } = require('./snapshots');

const MAX_TOOL_TEXT = 40000;
const MAX_AUTO_NUDGES = 3;
const MIME = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// BloxCode-modules pas laden als ze nodig zijn.
const blox = () => ({
  core: require('./blox/core'),
  studio: require('./blox/studio').studio,
  tools: require('./blox/tools'),
  safety: require('./blox/safety'),
});

function clip(text) {
  const s = String(text ?? '');
  if (s.length <= MAX_TOOL_TEXT) return s;
  const half = MAX_TOOL_TEXT / 2;
  return `${s.slice(0, half)}\n\n… [${s.length - MAX_TOOL_TEXT} tekens weggelaten] …\n\n${s.slice(-half)}`;
}

function validDir(dir) {
  try {
    if (dir && fs.statSync(dir).isDirectory()) return dir;
  } catch {}
  return os.homedir();
}

// Zorgt dat elke tool-aanroep een resultaat heeft (bv. na een crash midden in een beurt).
function repair(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    out.push(m);
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue;
    const seen = new Set();
    let j = i + 1;
    while (j < messages.length && messages[j].role === 'tool') {
      seen.add(messages[j].tool_call_id);
      out.push(messages[j]);
      j++;
    }
    for (const c of m.tool_calls) {
      if (!seen.has(c.id)) {
        out.push({ role: 'tool', tool_call_id: c.id, content: 'Afgebroken voordat deze actie werd uitgevoerd.', _name: c.function.name, _ok: false, _ts: Date.now() });
      }
    }
    i = j - 1;
  }
  return out;
}

const dataUrlCache = new Map();
function dataUrl(p) {
  if (!dataUrlCache.has(p)) {
    if (dataUrlCache.size > 60) dataUrlCache.delete(dataUrlCache.keys().next().value);
    dataUrlCache.set(p, `data:${MIME[path.extname(p).toLowerCase()] || 'image/jpeg'};base64,${fs.readFileSync(p).toString('base64')}`);
  }
  return dataUrlCache.get(p);
}

function validArgs(s) {
  try {
    JSON.parse(s || '{}');
    return s || '{}';
  } catch {
    return '{}';
  }
}

// Zet opgeslagen berichten om naar API-formaat. Oude afbeeldingen vallen in blokken van 8 weg,
// zodat de prompt-cache van DeepSeek zo lang mogelijk geldig blijft. Samengevatte berichten
// (_compacted) blijven zichtbaar in de app maar gaan niet meer mee naar het model.
function toApiMessages(session, cfg) {
  const msgs = session.messages.filter((m) => !m.role.startsWith('_') && !m._compacted);
  const refs = [];
  msgs.forEach((m, i) => {
    if (m.role === 'user') (m._images || []).forEach((_, j) => refs.push(`${i}:${j}`));
  });
  const total = refs.length;
  const drop = !cfg.vision ? total : total <= 12 ? 0 : 8 * Math.ceil((total - 12) / 8);
  const dropped = new Set(refs.slice(0, drop));

  return msgs.map((m, i) => {
    if (m.role === 'user') {
      const content = m._summaryPrefix ? `${m._summaryPrefix}\n\n[Huidig bericht]\n${m.content}` : m.content;
      const kept = (m._images || []).filter((p, j) => !dropped.has(`${i}:${j}`) && fs.existsSync(p));
      if (!kept.length) return { role: 'user', content };
      return {
        role: 'user',
        content: [{ type: 'text', text: content }, ...kept.map((p) => ({ type: 'image_url', image_url: { url: dataUrl(p) } }))],
      };
    }
    if (m.role === 'assistant') {
      const a = { role: 'assistant', content: m.content || '' };
      if (m.reasoning_content) a.reasoning_content = m.reasoning_content;
      if (m.tool_calls?.length) {
        a.tool_calls = m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: validArgs(c.function.arguments) } }));
      }
      return a;
    }
    return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content || '' };
  });
}

// Leesbare versie van een gesprek, voor het samenvatten.
function transcript(messages, toolChars = 1500) {
  const lines = [];
  for (const m of messages) {
    if (m.role === 'user') lines.push(`GEBRUIKER: ${m.content || ''}`);
    else if (m.role === 'assistant') {
      if (m.content) lines.push(`ASSISTENT: ${m.content}`);
      for (const c of m.tool_calls || []) lines.push(`TOOL-AANROEP ${c.function.name}: ${String(c.function.arguments || '').slice(0, 800)}`);
    } else if (m.role === 'tool') lines.push(`TOOL-RESULTAAT: ${String(m.content || '').slice(0, toolChars)}`);
  }
  return lines.join('\n');
}

const isTurnStart = (m) => m.role === 'user' && !m._auto && !m._compacted;

class Agent {
  constructor({ connectors, emit, hooks = {} }) {
    this.connectors = connectors;
    this.emitRaw = emit;
    this.hooks = hooks;
    this.runs = new Map();
    this.approvals = new Map();
  }

  emit(sessionId, ev) {
    this.emitRaw({ sessionId, ...ev });
  }

  live(id) {
    return this.runs.get(id)?.session;
  }

  isRunning(id) {
    return this.runs.has(id);
  }

  runningIds() {
    return [...this.runs.keys()];
  }

  pendingApprovals(id) {
    return [...this.approvals.values()].filter((a) => a.sessionId === id).map((a) => a.info);
  }

  stop(id) {
    this.runs.get(id)?.controller.abort();
    for (const [rid, a] of this.approvals) {
      if (a.sessionId === id) {
        this.approvals.delete(rid);
        a.resolve('deny');
      }
    }
  }

  stopAll() {
    for (const id of this.runs.keys()) this.stop(id);
  }

  resolveApproval(requestId, decision) {
    const a = this.approvals.get(requestId);
    if (!a) return;
    this.approvals.delete(requestId);
    a.resolve(decision);
  }

  note(session, text, level = 'info') {
    const msg = { role: '_note', level, text, _ts: Date.now() };
    session.messages.push(msg);
    store.saveSession(session);
    this.emit(session.id, { type: 'note', message: msg });
  }

  async send({ sessionId, text = '', attachments = [] }) {
    if (this.runs.has(sessionId)) throw new Error('DawgAgent is nog bezig in deze chat.');
    const session = store.loadSession(sessionId);
    if (!session) throw new Error('Chat niet gevonden.');
    session.messages = repair(session.messages);
    const isBlox = session.kind === 'blox';

    const content = [text.trim(), ...attachments.map(attachmentBlock)].filter(Boolean).join('\n\n') || '(zie bijlagen)';
    // Waar kijkt de gebruiker naar? Zo snapt "vat deze pagina samen" meteen welke tab bedoeld is.
    let chromeCtx = '';
    if (!isBlox && store.getConfig().browser !== false) {
      try {
        const { bridge } = require('./browser');
        const st = bridge.status();
        if (st.connected && /^https?:/i.test(st.tab?.url || '')) {
          chromeCtx = `\n\n[Chrome: de gebruiker kijkt naar "${st.tab.title || st.tab.url}" — ${st.tab.url}]`;
        }
      } catch {}
    }
    // BloxCode: foto's klaarmaken voor store_image (png/jpg, niet te groot) en het pad meegeven.
    let photoNotes = '';
    if (isBlox) {
      const notes = [];
      for (const a of attachments.filter((x) => x.kind === 'image')) {
        try {
          const p = await blox().core.preparePhoto(a.path);
          notes.push(`[Foto van de gebruiker: ${a.name} — pad voor store_image: ${p.studioPath}]`);
        } catch {}
      }
      if (notes.length) photoNotes = `\n\n${notes.join('\n')}`;
    }
    const images = attachments.filter((a) => a.kind === 'image').map((a) => a.apiPath || a.path);
    const msg = {
      role: 'user',
      content: `${content}${chromeCtx}${photoNotes}`,
      _text: text,
      _attachments: attachments.map(({ id, kind, name, path: p, size }) => ({ id, kind, name, path: p, size })),
      _ts: Date.now(),
    };
    if (images.length) msg._images = images;

    const isFirst = !session.messages.some((m) => m.role === 'user');
    if (isFirst && !session.parentId) session.title = (text.trim() || attachments[0]?.name || i18n.t('Nieuwe chat')).replace(/\s+/g, ' ').slice(0, 60);
    session.messages.push(msg);
    store.saveSession(session);

    const controller = new AbortController();
    this.runs.set(session.id, { controller, session });
    this.emit(session.id, { type: 'user_message', message: msg, title: session.title });
    this.emit(session.id, { type: 'running', running: true });
    if (isFirst && text.trim() && !session.parentId) this.makeTitle(session, text);

    let turn = { reload: null, computer: false };
    let failed = false;
    this.loop(session, controller, turn)
      .catch((e) => {
        failed = true;
        if (!controller.signal.aborted) this.note(session, e.message, 'error');
      })
      .finally(() => {
        this.runs.delete(session.id);
        // Na een beurt is niets meer "bezig". Herladen is altijd de laatste stap, dus dan zijn die taken klaar.
        if (session.todos?.some((t) => t.status === 'in_progress')) {
          const finished = turn.reload && !failed && !controller.signal.aborted;
          session.todos = session.todos.map((t) => (t.status === 'in_progress' ? { ...t, status: finished ? 'completed' : 'pending' } : t));
          this.emit(session.id, { type: 'todos', todos: session.todos });
        }
        store.saveSession(session);
        this.emit(session.id, { type: 'running', running: false });
        this.hooks.onTurnEnd?.(session.id, turn);
      });
  }

  async makeTitle(session, text) {
    try {
      const title = await quickChat({
        cfg: store.getConfig(),
        apiKey: store.getApiKey(),
        maxTokens: 30,
        messages: [
          { role: 'system', content: 'Geef een korte titel (max 6 woorden, zonder aanhalingstekens of punt) in de taal van het bericht.' },
          { role: 'user', content: text.slice(0, 2000) },
        ],
      });
      // Soms komt er markdown of een hele eerste regel terug; maak daar een nette titel van.
      const clean = title
        .split('\n')[0]
        .replace(/[*_`#>]+/g, '')
        .replace(/^["'\s]+|["'.\s]+$/g, '')
        .trim()
        .slice(0, 60);
      if (!clean) return;
      const live = this.live(session.id);
      if (live) live.title = clean;
      else store.renameSession(session.id, clean);
      if (!live) return this.emit(session.id, { type: 'title', title: clean });
      store.saveSession(live);
      this.emit(session.id, { type: 'title', title: clean });
    } catch {}
  }

  // Context voor een zijchat: het recente verloop van de chat waarnaast hij staat,
  // zodat "leg dat stukje eens uit" verwijst naar wat daar net besproken is.
  sideContext(session) {
    if (!session.parentId) return null;
    const parent = this.live(session.parentId) || store.loadSession(session.parentId);
    if (!parent) return null;
    const maxChars = 24000;
    const parts = [];
    let total = 0;
    const msgs = (parent.messages || []).filter((m) => !m.role.startsWith('_') && !(m.role === 'user' && m._auto));
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const text = String((m.role === 'user' ? m._text ?? m.content ?? '' : m.role === 'assistant' ? m.content || '' : '') || '').trim();
      if (!text) continue;
      let chunk = `${m.role === 'user' ? 'Gebruiker' : 'DawgAgent'}: ${text}`;
      if (chunk.length > 6000) chunk = `${chunk.slice(0, 6000)} …`;
      if (total + chunk.length > maxChars) {
        const room = maxChars - total;
        if (room < 400) break;
        chunk = `…${chunk.slice(-(room - 2))}`;
      }
      parts.unshift(chunk);
      total += chunk.length + 2;
      if (total >= maxChars) break;
    }
    if (!parts.length) return null;
    return { title: parent.title || 'chat', text: parts.join('\n\n') };
  }

  // BloxCode: lange geschiedenis samenvatten (automatisch vanaf compactAtTokens, of via /compact).
  // Alles behalve de laatste twee beurten wordt samengevat; de oude berichten blijven zichtbaar.
  async compactSession(session, { force = false } = {}) {
    const { core } = blox();
    const bcfg = core.getBloxConfig();
    if (!force && (session.usage?.lastPrompt || 0) < bcfg.compactAtTokens) return false;
    const starts = [];
    session.messages.forEach((m, i) => isTurnStart(m) && starts.push(i));
    if (starts.length <= 2) {
      if (force) throw new Error('Het gesprek is nog te kort om samen te vatten.');
      return false;
    }
    const cut = starts[starts.length - 2];
    const old = session.messages.slice(0, cut).filter((m) => !m.role.startsWith('_') && !m._compacted);
    const earlier = session.messages.slice(0, cut).find((m) => m._summaryPrefix)?._summaryPrefix || '';
    const summary = await quickChat({
      cfg: store.getConfig(),
      apiKey: store.getApiKey(),
      maxTokens: 4000,
      messages: [
        { role: 'system', content: core.SUMMARY_PROMPT },
        { role: 'user', content: `${earlier}\n${transcript(old)}`.slice(-300000) },
      ],
    });
    for (let i = 0; i < cut; i++) {
      const m = session.messages[i];
      if (!m.role.startsWith('_')) m._compacted = true;
      delete m._summaryPrefix;
    }
    session.messages[cut]._summaryPrefix = `[Samenvatting van het eerdere gesprek]\n${summary.trim()}`;
    if (session.usage) session.usage.lastPrompt = 0;
    const note = { role: '_note', level: 'info', text: 'Geschiedenis samengevat — de laatste twee vragen blijven volledig bewaard.', _ts: Date.now() };
    session.messages.splice(cut, 0, note);
    store.saveSession(session);
    this.emit(session.id, { type: 'note', message: note });
    return true;
  }

  async compactNow(sessionId) {
    if (this.runs.has(sessionId)) throw new Error('Wacht tot BloxCode klaar is met deze beurt.');
    const session = store.loadSession(sessionId);
    if (!session) throw new Error('Chat niet gevonden.');
    return this.compactSession(session, { force: true });
  }

  async loop(session, controller, turn) {
    const { signal } = controller;
    const apiKey = store.getApiKey();
    if (!apiKey) throw new Error('Nog geen API-sleutel ingesteld. Voeg je DeepSeek-sleutel toe in Instellingen.');
    turn.snapshotted = false;
    const isBlox = session.kind === 'blox';
    let B = null;
    let bcfg = null;
    if (isBlox) {
      B = blox();
      bcfg = B.core.getBloxConfig();
      if (!B.studio.connected) {
        this.emit(session.id, { type: 'retry', attempt: 0, reason: 'Verbinden met Roblox Studio…' });
        await Promise.race([B.studio.ensure({ ...bcfg, logPath: B.core.PATHS.log }), sleep(35000)]);
      }
    }
    const maxSteps = isBlox ? (bcfg.maxStepsPerTurn > 0 ? bcfg.maxStepsPerTurn : 2000) : store.getConfig().maxSteps || 150;
    let nudges = 0;
    let toolCallsTotal = 0;
    turn.autoUsed = 0;
    turn.budgetConfirmed = false;

    for (let step = 0; step < maxSteps; step++) {
      const cfg = store.getConfig();
      let tools;
      let system;
      if (isBlox) {
        bcfg = B.core.getBloxConfig(); // de modus kan tijdens een beurt wisselen
        try {
          await this.compactSession(session);
        } catch (e) {
          this.note(session, `Samenvatten lukte niet (${e.message}); ik ga verder met de volledige geschiedenis.`);
        }
        tools = B.tools.buildBloxTools({ bcfg });
        system = B.core.buildBloxPrompt({ mode: bcfg.mode, status: B.studio.status(), vision: cfg.vision, skills: B.core.loadSkills() });
      } else {
        tools = buildTools({ cfg, session, connectors: this.connectors });
        system = buildSystemPrompt({ cfg, session, connectors: this.connectors, side: this.sideContext(session) });
      }
      const out = {};
      let failed = null;

      this.emit(session.id, { type: 'assistant_start' });
      try {
        await streamChat({
          cfg,
          apiKey,
          signal,
          out,
          body: { messages: [{ role: 'system', content: system }, ...toApiMessages(session, cfg)], tools: toApiTools(tools) },
          onEvent: (ev) => this.emit(session.id, ev),
        });
      } catch (e) {
        failed = e;
      }

      const msg = { role: 'assistant', content: out.content || '', _ts: Date.now() };
      if (out.reasoning_content) msg.reasoning_content = out.reasoning_content;
      if (!failed && out.tool_calls?.length) msg.tool_calls = out.tool_calls;
      if (failed && !msg.content && msg.reasoning_content) msg.content = '(onderbroken)';
      if (msg.content || msg.tool_calls) session.messages.push(msg);

      if (out.usage) {
        const u = (session.usage ||= { input: 0, output: 0, cached: 0, lastPrompt: 0 });
        u.input += out.usage.prompt_tokens || 0;
        u.output += out.usage.completion_tokens || 0;
        u.cached += out.usage.prompt_cache_hit_tokens || 0;
        u.lastPrompt = out.usage.prompt_tokens || 0;
        this.emit(session.id, { type: 'usage', usage: u });
      }
      store.saveSession(session);
      this.emit(session.id, { type: 'assistant_done', message: msg });

      if (failed) {
        if (signal.aborted) return;
        throw failed;
      }
      if (!msg.tool_calls) {
        if (out.finish_reason === 'length') this.note(session, 'Het antwoord is afgekapt omdat de maximale lengte is bereikt. Stuur "ga door" om verder te gaan.');
        // BloxCode auto/yolo-modus: stopte het model met een tussenstatus ("Nu de HUD…")? Dan zelf doorgaan.
        const text = msg.content.trim();
        if (
          isBlox &&
          (bcfg.mode === 'auto' || bcfg.mode === 'yolo') &&
          toolCallsTotal > 0 &&
          nudges < MAX_AUTO_NUDGES &&
          out.finish_reason === 'stop' &&
          !text.includes(B.core.DONE_MARKER) &&
          !text.endsWith('?') &&
          text.length < 600
        ) {
          nudges++;
          this.note(session, '↻ Nog niet klaar — BloxCode gaat automatisch verder…');
          session.messages.push({ role: 'user', content: B.core.AUTO_CONTINUE_PROMPT, _auto: true, _ts: Date.now() });
          store.saveSession(session);
          continue;
        }
        return;
      }
      toolCallsTotal += msg.tool_calls.length;
      nudges = 0; // het model werkt weer echt

      const images = [];
      for (const call of msg.tool_calls) {
        const result = signal.aborted ? { ok: false, text: 'Afgebroken door gebruiker.' } : await this.runTool(session, call, tools, { turn, signal, cfg });
        const toolMsg = {
          role: 'tool',
          tool_call_id: call.id,
          content: clip(result.text),
          _name: call.function.name,
          _args: String(call.function.arguments || '').slice(0, 20000),
          _summary: result.summary,
          _ok: result.ok !== false,
          _ts: Date.now(),
        };
        if (result.images?.length) toolMsg._images = result.images;
        if (result.ui) toolMsg._ui = result.ui;
        if (result.level) toolMsg._level = result.level;
        session.messages.push(toolMsg);
        store.saveSession(session);
        this.emit(session.id, { type: 'tool_end', callId: call.id, message: toolMsg });
        if (result.images?.length) images.push(...result.images);
      }

      if (images.length && cfg.vision) {
        session.messages.push({
          role: 'user',
          content: `[Automatisch bericht van DawgAgent] Afbeelding(en) uit de vorige tool-aanroep: ${images.map((p) => path.basename(p)).join(', ')}`,
          _images: images,
          _auto: true,
          _ts: Date.now(),
        });
        store.saveSession(session);
      }
      if (signal.aborted) return;
      if (step === maxSteps - 1) {
        this.note(session, isBlox ? `${maxSteps} stappen gezet voor deze vraag. Stuur "ga door" om verder te gaan.` : `Gestopt na ${maxSteps} stappen. Stuur "ga door" om verder te gaan.`);
      }
    }
  }

  askApproval(session, info) {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const full = { requestId, ...info };
      this.approvals.set(requestId, { sessionId: session.id, resolve, info: full });
      this.emit(session.id, { type: 'approval', ...full });
      this.hooks.onApproval?.(session.id, full);
    });
  }

  // BloxCode-beleid: plan blokkeert wijzigingen, ask vraagt bij elke wijziging,
  // auto draait normale wijzigingen (risicovol vraagt nog), yolo draait alles zonder vragen.
  // Geeft null terug als de tool mag draaien, anders het tool-resultaat (geweigerd/geblokkeerd).
  async bloxGate(session, tool, args, { callId, name, summary, turn, logAction }) {
    const B = blox();
    const bcfg = B.core.getBloxConfig();
    const { verdict, decision } = B.tools.bloxDecision(tool, args, session, bcfg);
    turn.bloxLevel = verdict.level;
    turn.bloxLabel = 'automatisch';

    if (decision === 'block') {
      logAction('geblokkeerd', verdict.level);
      return {
        ok: false,
        summary,
        level: verdict.level,
        text: 'Geblokkeerd: BloxCode staat in plan-modus (alleen lezen). Onderzoek verder en lever een plan op; de gebruiker schakelt de modus om het uit te voeren.',
      };
    }

    // Vangnet in auto-modus: na veel wijzigingen in één vraag één keer checken of je door wilt.
    if (decision === 'run' && bcfg.mode === 'auto' && verdict.level === B.safety.WRITE && !B.safety.BUDGET_EXEMPT_TOOLS.has(name)) {
      turn.autoUsed = (turn.autoUsed || 0) + 1;
      if (bcfg.autoActionBudget > 0 && turn.autoUsed > bcfg.autoActionBudget && !turn.budgetConfirmed) {
        const raw = await this.askApproval(session, {
          callId,
          name,
          summary,
          kind: 'blox-budget',
          detail: `Al ${bcfg.autoActionBudget} automatische wijzigingen voor deze vraag. Doorgaan?`,
        });
        this.emit(session.id, { type: 'approval_done', callId, decision: raw?.decision || raw });
        if ((raw?.decision || raw) === 'deny') {
          logAction('geweigerd', verdict.level);
          return { ok: false, summary, level: verdict.level, text: 'De gebruiker heeft het automatisch doorwerken gestopt. Rond af en vat samen wat er al gedaan is.' };
        }
        turn.budgetConfirmed = true;
      }
    }

    if (decision === 'ask') {
      let detailText = '';
      try {
        detailText = tool.detail?.(args) || '';
      } catch {}
      const raw = await this.askApproval(session, {
        callId,
        name,
        summary,
        kind: verdict.level === B.safety.DANGER ? 'blox-danger' : 'blox-write',
        detail: detailText,
        reasons: verdict.reasons || [],
        allowAlways: verdict.level !== B.safety.DANGER,
      });
      const d = typeof raw === 'string' ? { decision: raw } : raw || { decision: 'deny' };
      this.emit(session.id, { type: 'approval_done', callId, decision: d.decision });
      if (d.decision === 'deny') {
        logAction('geweigerd', verdict.level);
        const feedback = String(d.feedback || '').trim();
        return {
          ok: false,
          summary,
          level: verdict.level,
          text: `De gebruiker heeft deze actie geweigerd.${feedback ? ` Feedback van de gebruiker: ${feedback}` : ''}`,
        };
      }
      if (d.decision === 'always') {
        session.allow ||= {};
        session.allow[name] = true;
      }
      if (d.decision === 'auto') {
        B.core.setBloxConfig({ mode: 'auto' });
        this.emit(session.id, { type: 'blox_mode', mode: 'auto' });
      }
      if (d.decision === 'yolo') {
        B.core.setBloxConfig({ mode: 'yolo' });
        this.emit(session.id, { type: 'blox_mode', mode: 'yolo' });
      }
      turn.bloxLabel = 'goedgekeurd';
    }
    return null;
  }

  async runTool(session, call, tools, { turn, signal, cfg }) {
    const name = call.function.name;
    const callId = call.id;
    const isBlox = session.kind === 'blox';
    let args;
    try {
      args = call.function.arguments?.trim() ? JSON.parse(call.function.arguments) : {};
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('argumenten moeten een JSON-object zijn');
    } catch (e) {
      return { ok: false, text: `Ongeldige JSON in de argumenten (${e.message}). Probeer opnieuw met geldige JSON.` };
    }
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      if (isBlox && !blox().studio.connected) {
        return { ok: false, text: 'Roblox Studio is niet verbonden. Vraag de gebruiker Roblox Studio te openen (met de MCP-server aan) en op "Opnieuw verbinden" te klikken.' };
      }
      return { ok: false, text: `Onbekende tool: ${name}` };
    }

    let kind = tool.kind;
    try {
      kind = tool.dynamicKind?.(args) || tool.kind;
    } catch {}

    let summary = '';
    try {
      summary = tool.summary?.(args) || '';
    } catch {}
    this.emit(session.id, { type: 'tool_start', callId, name, summary, kind });

    const logAction = (decision, level) => {
      if (!isBlox) return;
      session.actions ||= [];
      session.actions.push({ time: new Date().toISOString(), tool: name, level, decision, summary: String(summary).slice(0, 200) });
      if (session.actions.length > 500) session.actions.splice(0, session.actions.length - 500);
    };

    if (isBlox) {
      const blocked = await this.bloxGate(session, tool, args, { callId, name, summary, turn, logAction });
      if (blocked) return blocked;
    } else if (needsApproval(tool, cfg, session, kind)) {
      let detail = '';
      try {
        detail = tool.detail?.(args) || '';
      } catch {}
      const raw = await this.askApproval(session, { callId, name, summary, kind, detail });
      const decision = typeof raw === 'string' ? raw : raw?.decision || 'deny';
      this.emit(session.id, { type: 'approval_done', callId, decision });
      if (decision === 'deny') {
        return { ok: false, summary, text: 'De gebruiker heeft deze actie geweigerd. Probeer niet hetzelfde opnieuw; pas je aanpak aan of vraag wat de gebruiker wil.' };
      }
      if (decision === 'always') {
        session.allow ||= {};
        session.allow[kind === 'mcp' ? tool.name : kind] = true;
      }
    }
    if (signal.aborted) return { ok: false, summary, text: 'Afgebroken door gebruiker.' };

    let buf = '';
    let timer = null;
    const flush = () => {
      if (buf) this.emit(session.id, { type: 'tool_output', callId, chunk: buf });
      buf = '';
      timer = null;
    };
    const ctx = {
      session,
      cfg,
      signal,
      connectors: this.connectors,
      cwd: validDir(session.workspace),
      filesDir: store.filesDir(session.id),
      beforeWrite: (abs) => {
        if (!turn.snapshotted && isInsideApp(abs)) {
          createSnapshot(`Vóór zelf-aanpassing: ${path.relative(APP_DIR, abs)}`);
          turn.snapshotted = true;
        }
      },
      emitOutput: (chunk) => {
        buf += chunk;
        timer ||= setTimeout(flush, 120);
      },
      emit: (ev) => this.emit(session.id, ev),
      requestReload: (scope) => {
        turn.reload = turn.reload === 'app' ? 'app' : scope;
      },
    };

    if (kind.startsWith('computer') && tool.hideOnRun !== false) {
      turn.computer = true;
      await this.hooks.onComputer?.(session.id, summary || name);
    }
    if (kind.startsWith('browser')) turn.computer = true;
    const started = Date.now();
    try {
      const r = await tool.run(args, ctx);
      if (isBlox) logAction(turn.bloxLabel || 'automatisch', turn.bloxLevel);
      return { ok: r.ok !== false, summary, text: r.text ?? '', images: r.images, ui: r.ui, level: isBlox ? turn.bloxLevel : undefined, seconds: (Date.now() - started) / 1000 };
    } catch (e) {
      if (isBlox) logAction('fout', turn.bloxLevel);
      return { ok: false, summary, text: `Fout: ${e.message}` };
    } finally {
      if (timer) clearTimeout(timer);
      flush();
    }
  }
}

module.exports = { Agent, toApiMessages, repair };
