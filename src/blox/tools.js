// BloxCode-tools: alle Roblox Studio-tools plus load_skill en remember, in het toolformaat van de app.
const { studio } = require('./studio');
const core = require('./core');
const safety = require('./safety');

const SUMMARY_KEYS = {
  multi_edit: 'file_path',
  script_read: 'target_file',
  inspect_instance: 'path',
  search_game_tree: 'path',
  script_grep: 'query',
  script_search: 'keywords',
  generate_mesh: 'textPrompt',
  generate_procedural_model: 'prompt',
  generate_texture: 'textPrompt',
  generate_material: 'materialDescription',
  search_asset: 'query',
  http_get: 'url',
  skill: 'skill_name',
  subagent: 'description',
  wait_job_finished: 'jobId',
  store_image: 'image_path',
};

const short = (s, n = 120) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function summarize(name, a = {}) {
  if (name === 'start_stop_play') return a.is_start ? 'playtest starten' : 'playtest stoppen';
  if (name === 'insert_asset') return `${a.assetName || ''} (id ${a.assetId}, ${a.assetType || 'type?'})`;
  if (name === 'execute_luau') return short(String(a.code || '').split('\n').find((l) => l.trim() && !l.trim().startsWith('--')) || 'Luau', 100);
  const key = SUMMARY_KEYS[name];
  if (key && a[key]) return short(a[key]);
  const rest = Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'studio_id'));
  const json = JSON.stringify(rest);
  return json === '{}' ? '' : short(json);
}

function detail(name, a = {}) {
  if (name === 'execute_luau' && a.code) {
    const lines = String(a.code).split('\n');
    return lines.slice(0, 60).join('\n') + (lines.length > 60 ? '\n-- …' : '');
  }
  if (name === 'multi_edit') {
    return [a.file_path || '', ...(a.edits || []).slice(0, 6).map((e) => `− ${String(e.old_string || '').slice(0, 600)}\n+ ${String(e.new_string || '').slice(0, 900)}`)].join('\n\n');
  }
  return JSON.stringify(a, null, 1).slice(0, 2500);
}

const LOCAL = [
  {
    name: 'load_skill',
    description: 'Laad een BloxCode-skill met diepgaande Roblox-kennis en best practices. Doe dit VOORDAT je aan een taak in dat domein begint.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'Naam van de skill uit de lijst.' } }, required: ['name'] },
    summary: (a) => a.name,
    async run(a) {
      const skills = core.loadSkills();
      const s = skills.get(String(a.name || '').trim());
      if (!s) return { ok: false, text: `Skill niet gevonden. Beschikbaar: ${[...skills.keys()].join(', ')}` };
      return { text: `# Skill: ${s.name}\n\n${s.body}` };
    },
  },
  {
    name: 'remember',
    description: 'Sla een blijvend feit op in het langetermijngeheugen (bijv. naam/genre van de game, stijlkeuzes, conventies, voorkeuren). Wordt in elke toekomstige sessie meegegeven.',
    parameters: { type: 'object', properties: { fact: { type: 'string', description: 'Eén kort, zelfstandig feit.' } }, required: ['fact'] },
    summary: (a) => short(a.fact, 90),
    async run(a, ctx) {
      const ok = core.addMemory(a.fact);
      ctx.emit({ type: 'blox_memory' });
      return { text: ok ? 'Opgeslagen in het geheugen.' : 'Stond al in het geheugen (of was leeg).' };
    },
  },
];

function buildBloxTools({ bcfg }) {
  const tools = [];
  if (studio.connected) {
    for (const def of studio.toolDefs()) {
      tools.push({
        name: def.name,
        kind: 'blox',
        bloxAnnotations: def.annotations,
        description: def.description,
        parameters: def.parameters,
        summary: (a) => summarize(def.name, a),
        detail: (a) => detail(def.name, a),
        async run(a, ctx) {
          let out;
          try {
            out = await studio.call(def.name, a, { signal: ctx.signal, timeoutSec: bcfg.toolTimeoutSeconds, filesDir: ctx.filesDir });
          } catch (e) {
            let text = `Fout bij ${def.name}: ${e.message}`;
            if (!studio.connected) text += ' (verbinding met Studio verbroken; de gebruiker kan op "Opnieuw verbinden" klikken)';
            return { ok: false, text };
          }
          let text = out.text;
          const max = bcfg.toolResultMaxChars || 24000;
          if (text.length > max) text = `${text.slice(0, max)}\n… [ingekort: ${text.length - max} tekens weggelaten. Vraag specifieker op, bijvoorbeeld met regelnummers, een pad of filters.]`;
          if (out.images.length && !ctx.cfg.vision) text += '\n(Er is een afbeelding gemaakt, maar het model kan die niet zien.)';
          return { ok: !out.isError, text, images: out.images };
        },
      });
    }
  }
  for (const t of LOCAL) tools.push({ ...t, kind: 'blox' });
  return tools;
}

// Wat mag er met deze aanroep? { verdict: {level, reasons}, decision: 'run'|'ask'|'block' }
function bloxDecision(tool, args, session, bcfg) {
  const verdict = safety.classify(tool.name, args, tool.bloxAnnotations, bcfg);
  const decision = safety.decide(verdict, bcfg.mode, tool.name, session.allow || {});
  return { verdict, decision };
}

module.exports = { buildBloxTools, bloxDecision, summarize };
