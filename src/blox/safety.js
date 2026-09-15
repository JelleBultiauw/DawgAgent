// BloxCode-veiligheidsbeleid: welke Roblox-acties mogen zonder toestemming draaien?
//   read   – alleen lezen, draait altijd automatisch
//   write  – wijzigt je place; automatisch in 'auto', anders vragen
//   danger – risicovol; vraagt toestemming in 'ask' en 'auto', draait direct in 'yolo'
// Modi: plan (alleen lezen) · ask (elke wijziging vragen) · auto (veilig automatisch)
//       · yolo (alles automatisch, zonder enige goedkeuring)
const READ = 'read';
const WRITE = 'write';
const DANGER = 'danger';

const MODES = ['plan', 'ask', 'auto', 'yolo'];

const READ_TOOLS = new Set([
  'list_roblox_studios', 'get_studio_state', 'get_console_output', 'script_read', 'script_grep', 'script_search',
  'search_game_tree', 'inspect_instance', 'search_asset', 'http_get', 'skill', 'wait_job_finished', 'screen_capture',
]);
const WRITE_TOOLS = new Set([
  'multi_edit', 'execute_luau', 'generate_mesh', 'generate_procedural_model', 'generate_texture', 'generate_material',
  'segment_mesh', 'start_stop_play', 'character_navigation', 'user_keyboard_input', 'user_mouse_input', 'store_image',
  'subagent', 'insert_asset',
]);
const DANGER_TOOLS = { upload_image: 'uploadt afbeeldingen als asset naar je Roblox-account' };

// Playtest-bediening verandert je place niet en telt niet mee voor het auto-budget.
const BUDGET_EXEMPT_TOOLS = new Set(['start_stop_play', 'user_keyboard_input', 'user_mouse_input', 'character_navigation']);

// Asset-types die geen scripts kunnen bevatten (dus geen backdoors).
const SCRIPT_FREE_ASSET_TYPES = new Set(['Mesh', 'MeshPart', 'Image', 'Decal', 'Audio', 'Video', 'Animation']);

// Brede doelen: de hele game, Workspace of een service. Opruimen in een eigen map is normaal werk.
const BROAD =
  '(?:\\bgame\\s*:\\s*GetService\\s*\\([^)]*\\)|\\bgame(?:\\.\\w+)?|\\b(?:workspace|Workspace|ServerScriptService' +
  '|ServerStorage|ReplicatedStorage|ReplicatedFirst|StarterGui|StarterPack|StarterPlayer|Lighting|SoundService|Teams|Players))';

const LUAU_DANGER = [
  ['\\b(SetAsync|UpdateAsync|RemoveAsync|IncrementAsync|RemoveVersionAsync)\\s*\\(', 'schrijft naar DataStores/MemoryStores (echte spelerdata)'],
  ['\\bHttpService\\b[\\s\\S]*\\b(RequestAsync|PostAsync|GetAsync)\\b', 'stuurt HTTP-verzoeken naar buiten'],
  ['\\b(loadstring|getfenv|setfenv)\\b', 'gebruikt loadstring/getfenv/setfenv (typisch voor backdoors)'],
  ['\\brequire\\s*\\(\\s*\\d{5,}\\s*\\)', 'laadt een externe module via asset-id (backdoor-risico)'],
  ['\\b(LoadAsset|LoadAssetVersion|GetObjects)\\s*\\(', 'laadt externe assets van de marketplace'],
  [`${BROAD}\\s*:\\s*ClearAllChildren\\s*\\(`, 'verwijdert alles uit Workspace of een service'],
  [`${BROAD}\\s*:\\s*Get(?:Descendants|Children)\\s*\\(\\s*\\)[\\s\\S]{0,400}?:\\s*Destroy\\s*\\(`, 'verwijdert objecten in bulk uit je game'],
  ['\\bTerrain\\s*:\\s*Clear\\s*\\(', 'wist het volledige terrain'],
  ['\\b(SavePlaceAsync|CreatePlaceAsync|PublishAsync)\\b', 'publiceert of stuurt berichten naar live servers'],
  ['\\bAwardBadge\\b', 'deelt echte badges uit'],
  [`${BROAD}\\s*:\\s*GetDescendants\\s*\\(\\s*\\)[\\s\\S]{0,400}?\\.Source\\s*=`, 'herschrijft scripts in bulk'],
].map(([p, reason]) => [new RegExp(p), reason]);

function scanLuau(code) {
  const reasons = [];
  for (const [re, reason] of LUAU_DANGER) if (re.test(code) && !reasons.includes(reason)) reasons.push(reason);
  return reasons;
}

function classify(name, args = {}, annotations = null, cfg = {}) {
  if (DANGER_TOOLS[name]) return { level: DANGER, reasons: [DANGER_TOOLS[name]] };
  let level;
  if (READ_TOOLS.has(name) || name === 'load_skill' || name === 'remember') level = READ;
  else if (WRITE_TOOLS.has(name)) level = WRITE;
  else if (annotations?.readOnlyHint) level = READ;
  else level = WRITE; // onbekende tools: voorzichtig
  if (level === READ) return { level: READ, reasons: [] };

  const reasons = [];
  if (name === 'execute_luau') reasons.push(...scanLuau(String(args.code || '')));
  if (name === 'insert_asset' && !cfg.autoApproveStoreModels && !SCRIPT_FREE_ASSET_TYPES.has(args.assetType)) {
    reasons.push('modellen uit de Creator Store kunnen verborgen (kwaadaardige) scripts bevatten');
  }
  const blob = JSON.stringify(args).toLowerCase();
  for (const p of cfg.protectedPaths || []) {
    if (p && blob.includes(String(p).toLowerCase())) reasons.push(`raakt beschermd pad '${p}'`);
  }
  return reasons.length ? { level: DANGER, reasons } : { level };
}

// 'run', 'ask' of 'block'
function decide(verdict, mode, name, alwaysAllowed = {}) {
  if (verdict.level === READ) return 'run';
  if (mode === 'plan') return 'block';
  if (mode === 'yolo') return 'run'; // alles automatisch: nooit om toestemming vragen
  if (verdict.level === DANGER) return 'ask';
  if (mode === 'auto' || alwaysAllowed[name]) return 'run';
  return 'ask';
}

module.exports = { READ, WRITE, DANGER, MODES, BUDGET_EXEMPT_TOOLS, classify, decide, scanLuau };
