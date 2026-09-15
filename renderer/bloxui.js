// BloxCode in de interface: startscherm, Studio-kiezer, modi, /-commando's en vensters.
// app.js geeft zijn hulpfuncties mee via createBlox(ctx).

export const BLOX_ICONS = {
  cube: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.99.13A4 4 0 0 0 3 9a4 4 0 0 0 1.5 3.1A4 4 0 0 0 6 19a3 3 0 0 0 6 0Z"/><path d="M12 5a3 3 0 1 1 5.99.13A4 4 0 0 1 21 9a4 4 0 0 1-1.5 3.1A4 4 0 0 1 18 19a3 3 0 0 1-6 0Z"/><path d="M12 5v14"/>',
  stethoscope: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
  slash: '<path d="M22 2 2 22"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  box: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
};

// Nette labels voor Studio-tools in de stappenlijst.
export const BLOX_TOOL_META = {
  list_roblox_studios: ['Studio-vensters', 'cube'],
  get_studio_state: ['Studio-status', 'cube'],
  search_game_tree: ['Game doorzocht', 'search'],
  inspect_instance: ['Instance bekeken', 'eye'],
  script_read: ['Script gelezen', 'file'],
  script_grep: ['Scripts doorzocht', 'search'],
  script_search: ['Scripts gezocht', 'search'],
  multi_edit: ['Script bewerkt', 'pencil'],
  execute_luau: ['Luau-code', 'terminal'],
  generate_mesh: ['Mesh gegenereerd', 'wand'],
  generate_procedural_model: ['Model gegenereerd', 'wand'],
  generate_texture: ['Textuur gegenereerd', 'wand'],
  generate_material: ['Materiaal gegenereerd', 'wand'],
  segment_mesh: ['Mesh opgesplitst', 'wand'],
  search_asset: ['Assets gezocht', 'search'],
  insert_asset: ['Asset ingevoegd', 'download'],
  store_image: ['Foto naar Studio', 'image'],
  upload_image: ['Afbeelding geüpload', 'image'],
  screen_capture: ['Screenshot Studio', 'monitor'],
  start_stop_play: ['Playtest', 'play'],
  get_console_output: ['Console gelezen', 'terminal'],
  character_navigation: ['Karakter bewogen', 'pointer'],
  user_keyboard_input: ['Toetsen (playtest)', 'keyboard'],
  user_mouse_input: ['Muis (playtest)', 'pointer'],
  wait_job_finished: ['Wachten op job', 'clock'],
  subagent: ['Sub-agent', 'cpu'],
  http_get: ['Web opgehaald', 'globe'],
  skill: ['Roblox-skill', 'sparkles'],
  load_skill: ['Skill geladen', 'sparkles'],
  remember: ['Onthouden', 'brain'],
};

export function createBlox(ctx) {
  const { h, icon, call, toast, openMenu, openModal, closeModal, confirmDialog, btn, md, state, appName } = ctx;
  const name = () => (typeof appName === 'function' ? appName() : 'DawgAgent');

  const B = {
    status: null,
    sessions: [],
    slash: { open: false, items: [], index: 0 },
  };

  const MODES = {
    plan: { label: 'Plan', long: 'Plan · alleen lezen', icon: 'eye', desc: 'Onderzoeken en een plan maken; wijzigingen worden geblokkeerd.' },
    ask: { label: 'Vragen', long: 'Vragen bij wijzigingen', icon: 'hand', desc: 'Lezen gaat vanzelf; elke wijziging keur je goed.' },
    auto: { label: 'Veilig auto', long: 'Veilig automatisch', icon: 'zap', desc: 'Normale wijzigingen gaan vanzelf; risicovolle acties vragen altijd toestemming.' },
    yolo: {
      label: 'Alles auto',
      long: 'Alles automatisch',
      icon: 'flame',
      desc: 'Geen goedkeuringen: ook risicovolle acties (DataStore-writes, HTTP, uploads, publiceren) gaan direct. Alleen als je BloxCode volledig vertrouwt.',
    },
  };
  const AUTO_MODES = ['auto', 'yolo'];
  const LEVELS = { read: ['lezen', 'lvl-read'], write: ['wijzigt', 'lvl-write'], danger: ['risicovol', 'lvl-danger'] };

  const isBloxSession = () => state.session?.kind === 'blox';

  // ---------- status ----------
  async function refreshStatus() {
    try {
      B.status = await call('blox:status');
    } catch {}
    onStatus(B.status);
    return B.status;
  }

  function onStatus(st) {
    if (!st) return;
    B.status = st;
    const dot = document.querySelector('#blox-dot');
    if (dot) dot.className = `blox-dot ${st.state === 'connected' ? (st.studioName ? 'ok' : 'warn') : st.state === 'connecting' ? 'busy' : ''}`;
    if (state.session?.kind === 'blox') {
      ctx.renderComposer();
      const home = document.querySelector('.blox-home');
      if (home) home.replaceWith(renderHome());
    }
  }

  async function ensureConnected() {
    const st = B.status || (await refreshStatus());
    if (st?.state === 'connected' || st?.state === 'connecting') return;
    call('blox:ensure').then(onStatus).catch(() => {});
  }

  async function refreshSessions() {
    try {
      B.sessions = await call('blox:sessions');
    } catch {
      B.sessions = [];
    }
    return B.sessions;
  }

  // ---------- chips onder het invoerveld ----------
  function studioLabel(st = B.status) {
    if (!st) return 'Studio…';
    if (st.state === 'connecting') return 'Verbinden…';
    if (st.state !== 'connected') return 'Studio niet verbonden';
    if (st.studioName) return st.studioName.replace(/\s*\(placeId:.*\)$/, '');
    return st.studios.length ? 'Kies een Studio' : 'Geen place open';
  }

  function studioChipState(st = B.status) {
    if (!st || st.state !== 'connected') return 'off';
    return st.studioName ? 'on' : 'warn';
  }

  async function studioMenu(anchor) {
    let st = B.status;
    try {
      if (st?.state === 'connected') st = await call('blox:studios');
      onStatus(st);
    } catch {}
    const items = [{ header: true, label: 'Roblox Studio' }];
    if (st?.state === 'connected') {
      if (!st.studios.length) items.push({ label: 'Geen place open', desc: 'Open een place in Roblox Studio en ververs de lijst.', icon: 'cube', action: () => {} });
      for (const s of st.studios) {
        items.push({
          label: s.name.replace(/\s*\(placeId:.*\)$/, ''),
          desc: s.name.match(/placeId:\s*(\d+)/) ? `placeId ${s.name.match(/placeId:\s*(\d+)/)[1]}` : '',
          icon: 'cube',
          checked: s.id === st.studioId,
          action: async () => {
            try {
              onStatus(await call('blox:selectStudio', s.id));
              toast(`Studio gekozen: ${s.name.replace(/\s*\(placeId:.*\)$/, '')}`);
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        });
      }
    } else {
      items.push({ label: st?.state === 'connecting' ? 'Bezig met verbinden…' : 'Niet verbonden', desc: st?.error || 'Open Roblox Studio met een place en zet de MCP-server aan.', icon: 'cube', action: () => {} });
    }
    items.push(
      '-',
      { label: 'Lijst verversen', icon: 'refresh', action: () => call('blox:studios').then(onStatus).catch((e) => toast(e.message, 'error')) },
      { label: 'Opnieuw verbinden', icon: 'plug', desc: 'StudioMCP opnieuw starten (/reconnect)', action: () => reconnect() },
      { label: 'Tools bekijken', icon: 'list', action: () => toolsModal() },
      { label: 'Diagnose', icon: 'stethoscope', action: () => doctorModal() },
      { label: 'Serverlog openen', icon: 'file', action: () => call('blox:openPath', 'log') },
    );
    openMenu(anchor, items);
  }

  async function reconnect() {
    toast('Verbinden met Roblox Studio…');
    try {
      const st = await call('blox:connect');
      onStatus(st);
      if (st.state === 'connected') toast(`Verbonden · ${st.tools} tools${st.studioName ? ` · ${studioLabel(st)}` : ''}`);
      else toast(st.error || 'Verbinden mislukt', 'error');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function modeMenu(anchor) {
    const cur = B.status?.mode || 'ask';
    openMenu(
      anchor,
      Object.entries(MODES).map(([id, m]) => ({ label: m.long, icon: m.icon, desc: m.desc, checked: cur === id, action: () => setMode(id) })),
    );
  }

  async function setMode(mode) {
    try {
      onStatus(await call('blox:setMode', mode));
      toast(
        mode === 'yolo'
          ? 'Alles automatisch: BloxCode voert nu ook risicovolle acties direct uit, zonder te vragen.'
          : `Modus: ${MODES[mode].long}`,
      );
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function composerChips() {
    const st = B.status;
    const mode = MODES[st?.mode || 'ask'];
    return {
      studio: { icon: 'cube', label: studioLabel(st), state: studioChipState(st), title: st?.error || 'Roblox Studio kiezen (/studio)' },
      mode: { icon: mode.icon, label: mode.label, title: `${mode.long} — ${mode.desc}` },
      modeAuto: AUTO_MODES.includes(st?.mode),
    };
  }

  // ---------- startscherm ----------
  function renderHome() {
    const st = B.status;
    const root = h('div', { class: 'empty blox-home' });
    root.append(
      h('div', { class: 'logo blox-logo' }, icon('cube', 30)),
      h('h1', {}, 'BloxCode'),
      h('p', {}, 'Je Roblox-developer die rechtstreeks in Studio bouwt, script en test.'),
    );
    const cards = h('div', { class: 'facts' });
    const fact = (ic, label, value, on, onclick, title) =>
      cards.append(h('button', { class: `fact${on ? ' on' : ''}`, onclick, title }, icon(ic, 15), h('span', { class: 'fact-text' }, label, h('small', {}, value))));
    fact('cube', 'Studio', st?.state === 'connected' ? studioLabel(st) : st?.state === 'connecting' ? 'verbinden…' : 'niet verbonden', st?.state === 'connected' && st.studioName, (e) => studioMenu(e.currentTarget), st?.error || '');
    fact(MODES[st?.mode || 'ask'].icon, 'Modus', MODES[st?.mode || 'ask'].label, AUTO_MODES.includes(st?.mode), (e) => modeMenu(e.currentTarget), MODES[st?.mode || 'ask'].desc);
    fact('sparkles', 'Kennis', `${st?.tools || 0} tools · ${st?.skills || 0} skills`, (st?.tools || 0) > 0, () => skillsModal());
    fact('brain', 'Geheugen', `${st?.memory || 0} feiten`, (st?.memory || 0) > 0, () => memoryModal());
    root.append(cards);
    root.append(
      h('div', { class: 'blox-off-hint' }, icon('cube', 13), 'BloxCode staat aan in deze chat; de chip onder het invoerveld (of de knop links) zet hem weer uit.'),
    );

    if (st && st.state !== 'connected' && st.state !== 'connecting') {
      root.append(
        h(
          'div',
          { class: 'blox-hint' },
          h('b', {}, 'Roblox Studio is niet verbonden. '),
          st.mcpExists ? 'Open Studio met een place, zet de MCP-server aan (Assistant → MCP) en klik op Verbinden.' : 'StudioMCP is niet gevonden — is Roblox Studio geïnstalleerd?',
          st.error ? h('div', { class: 'blox-err' }, st.error) : null,
          h('div', { style: 'margin-top:10px;display:flex;gap:8px;justify-content:center' }, btn('Verbinden', 'primary', reconnect, 'plug'), btn('Diagnose', '', doctorModal, 'stethoscope')),
        ),
      );
    } else if (st?.state === 'connected' && !st.studioName && st.studios.length > 1) {
      root.append(h('div', { class: 'blox-hint' }, h('b', {}, 'Er zijn meerdere Studio-vensters open. '), 'Kies er een met de Studio-knop onder het invoerveld.'));
    }

    const recent = B.sessions.slice(0, 4);
    const legacyBox = h('div', { class: 'recent' });
    if (recent.length) {
      root.append(
        h(
          'div',
          { class: 'recent' },
          h('div', { class: 'recent-head' }, 'Verder waar je gebleven was'),
          recent.map((s) => h('button', { class: 'recent-item', onclick: () => ctx.openSession(s.id), title: s.title }, h('span', { class: 'recent-title' }, s.title), h('span', { class: 'recent-time' }, s.running ? 'bezig…' : ctx.fmtWhen(s.updated)))),
        ),
      );
    }
    root.append(legacyBox);
    call('blox:legacyList')
      .then((list) => {
        const todo = list.filter((l) => !l.imported);
        if (!todo.length || !legacyBox.isConnected) return;
        legacyBox.append(
          h('div', { class: 'recent-head' }, 'Sessies uit de terminalversie'),
          ...todo.slice(0, 3).map((l) =>
            h(
              'button',
              { class: 'recent-item', onclick: () => importLegacy(l.id), title: `Importeren en openen: ${l.title}` },
              h('span', { class: 'recent-title' }, l.title.replace(/[*_`#]+/g, '')),
              h('span', { class: 'recent-time' }, `${l.turns} vragen · importeren`),
            ),
          ),
        );
      })
      .catch(() => {});

    root.append(h('div', { class: 'empty-foot' }, "Typ / voor alle commando's en modi · sleep foto's hierheen als voorbeeld · Esc stopt"));
    return root;
  }

  async function importLegacy(id) {
    try {
      const r = await call('blox:legacyImport', id);
      await refreshSessions();
      await ctx.openSession(r.id);
      toast(`Sessie hervat: ${r.title}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---------- goedkeuring ----------
  function approvalCard(a, decide) {
    const danger = a.kind === 'blox-danger';
    const budget = a.kind === 'blox-budget';
    const feedback = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Wat moet BloxCode anders doen?', hidden: true });
    const card = h(
      'div',
      { class: `approval ${danger ? 'danger' : ''}` },
      h(
        'div',
        { class: 'approval-title' },
        icon(danger ? 'shield' : budget ? 'clock' : 'cube', 15),
        budget ? 'Doorwerken?' : danger ? `Let op: ${a.name}` : 'Wijziging in Studio?',
        h('span', { style: 'font-weight:400;color:var(--muted)' }, a.summary || ''),
      ),
      danger && a.reasons?.length ? h('ul', { class: 'approval-reasons' }, a.reasons.map((r) => h('li', {}, r))) : null,
      a.detail ? h('pre', { class: 'approval-detail' }, a.detail) : null,
      feedback,
    );
    const actions = h('div', { class: 'approval-actions' });
    if (budget) {
      actions.append(btn('Doorgaan', 'primary', () => decide({ decision: 'allow' })), btn('Stoppen', 'ghost danger', () => decide({ decision: 'deny' })));
    } else {
      actions.append(btn('Ja', 'primary', () => decide({ decision: 'allow' })));
      if (a.allowAlways) actions.append(btn('Altijd deze tool', '', () => decide({ decision: 'always' })));
      if (!danger && !AUTO_MODES.includes(B.status?.mode)) actions.append(btn('Ja + auto-modus', '', () => decide({ decision: 'auto' }), 'zap'));
      if (B.status?.mode !== 'yolo') actions.append(btn('Niet meer vragen (alles auto)', 'ghost', () => decide({ decision: 'yolo' }), 'flame'));
      actions.append(btn('Nee', 'ghost danger', () => decide({ decision: 'deny' })));
      const fb = btn('Nee, met feedback', 'ghost', () => {
        if (feedback.hidden) {
          feedback.hidden = false;
          feedback.focus();
          fb.lastChild.textContent = 'Feedback versturen';
        } else decide({ decision: 'deny', feedback: feedback.value });
      });
      actions.append(fb);
      feedback.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          decide({ decision: 'deny', feedback: feedback.value });
        }
      });
    }
    card.append(actions);
    return card;
  }

  // ---------- vensters ----------
  function modal(title, lead, body, actions = []) {
    openModal(h('div', {}, h('h2', {}, title), lead ? h('p', { class: 'lead' }, lead) : null, body, h('div', { class: 'modal-actions' }, ...actions, btn('Sluiten', 'primary', closeModal))), 'wide');
  }

  async function memoryModal() {
    const facts = await call('blox:memory');
    const list = h('div', { class: 'cards blox-list' });
    if (!facts.length) list.append(h('div', { class: 'empty-card' }, 'Het geheugen is nog leeg. BloxCode vult het zelf, of voeg hieronder iets toe.'));
    facts.forEach((f, i) =>
      list.append(
        h(
          'div',
          { class: 'card' },
          h('span', { class: 'tag' }, String(i + 1)),
          h('div', { class: 'card-main' }, h('div', { class: 'card-desc', style: 'color:var(--text)' }, f)),
          ctx.iconBtn('trash', 'Vergeten', async () => {
            await call('blox:forget', String(i + 1));
            memoryModal();
            refreshStatus();
          }),
        ),
      ),
    );
    const input = h('input', { class: 'input', placeholder: 'Nieuw feit, bv. "De game heet HunterX en is first-person"' });
    const add = async () => {
      if (!input.value.trim()) return;
      await call('blox:remember', input.value.trim());
      memoryModal();
      refreshStatus();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    modal('Geheugen', 'Blijvende feiten over jou en je game. Ze gaan mee in elke BloxCode-chat (gedeeld met de terminalversie).', h('div', {}, list, h('div', { class: 'field', style: 'margin-top:12px;flex-direction:row;gap:8px' }, input, btn('Onthouden', '', add))), [
      btn('Bestand openen', 'ghost', () => call('blox:openPath', 'memory'), 'file'),
    ]);
  }

  async function skillsModal() {
    const skills = await call('blox:skills');
    const list = h('div', { class: 'cards blox-list' });
    for (const s of skills) {
      list.append(
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, s.name, h('span', { class: 'tag' }, s.source)), h('div', { class: 'card-desc' }, s.description)),
          btn('In gesprek laden', '', () => {
            closeModal();
            loadSkillIntoChat(s.name);
          }),
        ),
      );
    }
    modal('BloxCode-skills', 'Roblox-kennis die BloxCode zelf inlaadt als een taak erbij past. Eigen skills: zet een .md-bestand (met name: en description:) in de skills-map.', list, [
      btn('Eigen skills-map', 'ghost', () => call('blox:openPath', 'skills'), 'folder'),
    ]);
  }

  async function loadSkillIntoChat(name) {
    const s = await call('blox:skill', name);
    if (!s) return toast(`Onbekende skill: ${name}`, 'error');
    ctx.addPending({ id: `skill-${Date.now()}`, kind: 'doc', name: `Skill · ${s.name}`, path: s.file, size: s.body.length, text: `[Skill geladen: ${s.name}]\n${s.body}` });
    toast(`Skill "${s.name}" gaat mee met je volgende bericht`);
  }

  async function toolsModal() {
    const tools = await call('blox:tools');
    const list = h('div', { class: 'cards blox-list' });
    if (tools.length <= 2) list.append(h('div', { class: 'empty-card' }, 'Geen Studio-tools: BloxCode is niet verbonden met Roblox Studio.'));
    for (const t of tools) {
      const [lbl, cls] = LEVELS[t.level] || LEVELS.write;
      list.append(h('div', { class: 'card' }, h('div', { class: 'card-main' }, h('div', { class: 'card-title mono-title' }, t.name), h('div', { class: 'card-desc' }, t.description)), h('span', { class: `lvl ${cls}` }, lbl)));
    }
    modal('Tools', 'Lezen gaat altijd vanzelf. Wijzigen hangt af van de modus: in "Vragen" keur je elke wijziging goed, in "Veilig automatisch" gaan normale wijzigingen direct en in "Alles automatisch" gaat alles direct — ook risicovolle acties (DataStores, HTTP, bulk-verwijderen, free models, uploads).', list);
  }

  async function sessionsModal() {
    const [mine, legacy] = await Promise.all([refreshSessions(), call('blox:legacyList').catch(() => [])]);
    const list = h('div', { class: 'cards blox-list' });
    if (!mine.length && !legacy.length) list.append(h('div', { class: 'empty-card' }, 'Nog geen sessies.'));
    for (const s of mine) {
      list.append(h('button', { class: 'card card-btn', onclick: () => (closeModal(), ctx.openSession(s.id)) }, h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, s.title), h('div', { class: 'card-desc' }, ctx.fmtWhen(s.updated))), icon('chevron', 14)));
    }
    const todo = legacy.filter((l) => !l.imported);
    if (todo.length) {
      list.append(h('div', { class: 'card-sep' }, 'Terminalversie van BloxCode'));
      for (const l of todo) {
        list.append(h('button', { class: 'card card-btn', onclick: () => (closeModal(), importLegacy(l.id)) }, h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, l.title.replace(/[*_`#]+/g, '')), h('div', { class: 'card-desc' }, `${l.turns} vragen · ${ctx.fmtWhen(l.updated)} · importeren en openen`)), icon('download', 14)));
      }
    }
    modal('Sessies', 'Alles wordt na elke stap opgeslagen. Klik om te hervatten.', list);
  }

  async function logModal() {
    if (!isBloxSession()) return toast('Open eerst een BloxCode-chat', 'error');
    const rows = await call('blox:actions', state.session.id);
    const list = h('div', { class: 'cards blox-list' });
    if (!rows.length) list.append(h('div', { class: 'empty-card' }, 'Nog geen acties in deze sessie.'));
    for (const a of rows) {
      const [lbl, cls] = LEVELS[a.level] || LEVELS.read;
      list.append(
        h(
          'div',
          { class: 'card' },
          h('span', { class: 'tag' }, (a.time || '').slice(11, 19)),
          h('div', { class: 'card-main' }, h('div', { class: 'card-title mono-title' }, a.tool, h('span', { class: `lvl ${cls}` }, lbl)), h('div', { class: 'card-desc' }, `${a.decision}${a.summary ? ` · ${a.summary}` : ''}`)),
        ),
      );
    }
    modal('Recente acties in Studio', null, list);
  }

  function tokensModal() {
    const u = state.session?.usage || { input: 0, output: 0, cached: 0, lastPrompt: 0 };
    const pct = u.input ? Math.round((u.cached / u.input) * 100) : 0;
    const cell = (label, value) => h('div', { class: 'stat' }, h('small', {}, label), h('b', {}, value));
    modal('Tokenverbruik (deze chat)', null, h('div', { class: 'stats' }, cell('Invoer', u.input.toLocaleString('nl-NL')), cell('Waarvan cache', `${u.cached.toLocaleString('nl-NL')} (${pct}%)`), cell('Uitvoer', u.output.toLocaleString('nl-NL')), cell('Laatste prompt', u.lastPrompt.toLocaleString('nl-NL'))), [
      btn('Saldo op DeepSeek', 'ghost', () => call('app:openExternal', 'https://platform.deepseek.com/usage'), 'external'),
    ]);
  }

  async function reasoningModal() {
    if (!isBloxSession()) return toast('Open eerst een BloxCode-chat', 'error');
    const text = await call('blox:reasoning', state.session.id);
    modal('Laatste redenering', null, text ? h('div', { class: 'md reasoning-modal', html: md(text) }) : h('div', { class: 'empty-card' }, 'Nog geen redenering beschikbaar.'));
  }

  async function configModal() {
    const c = await call('blox:config');
    const num = (key, v) => h('input', { class: 'input', type: 'number', min: 0, value: v, style: 'width:120px', onchange: (e) => save({ [key]: Math.max(0, Number(e.target.value) || 0) }) });
    const save = async (patch) => {
      try {
        await call('blox:setConfig', patch);
        toast('Opgeslagen');
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    const protectedPaths = h('textarea', { class: 'textarea mono', rows: 3, value: (c.protectedPaths || []).join('\n'), placeholder: 'DataManager\nServerScriptService.Economy', onchange: (e) => save({ protectedPaths: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) }) });
    const mcp = h('input', { class: 'input mono', value: c.mcpCommand, onchange: (e) => save({ mcpCommand: e.target.value.trim() }) });
    const row = (label, hint, control) => ctx.settingRow(label, hint, control);
    const body = h(
      'div',
      { class: 'cards' },
      row('Max. stappen per vraag', '0 = onbeperkt; daarna vraagt BloxCode of hij door mag', num('maxStepsPerTurn', c.maxStepsPerTurn)),
      row('Auto-budget', 'Automatische wijzigingen per vraag vóór één pauzevraag (0 = onbeperkt)', num('autoActionBudget', c.autoActionBudget)),
      row('Samenvatten vanaf', 'Promptgrootte in tokens waarboven de geschiedenis wordt samengevat', num('compactAtTokens', c.compactAtTokens)),
      row('Tool-time-out', 'Seconden voor lange generaties (overige tools max 120s)', num('toolTimeoutSeconds', c.toolTimeoutSeconds)),
      row('Creator Store-models automatisch', 'Uit = invoegen van free models vraagt altijd toestemming', ctx.toggleSwitch(c.autoApproveStoreModels, (on) => save({ autoApproveStoreModels: on }))),
      h('div', { class: 'row stack' }, h('div', {}, h('div', { class: 'row-label' }, 'Beschermde paden'), h('div', { class: 'row-hint' }, 'Alles wat deze paden raakt vraagt altijd toestemming (één per regel)')), protectedPaths),
      h('div', { class: 'row stack' }, h('div', {}, h('div', { class: 'row-label' }, 'StudioMCP'), h('div', { class: 'row-hint' }, 'Pad naar de MCP-server van Roblox Studio')), mcp),
    );
    modal('BloxCode-instellingen', `Model, nadenken en API-sleutel deel je met de rest van ${name()} (rechtsonder bij het invoerveld en in Instellingen).`, body, [btn('Serverlog', 'ghost', () => call('blox:openPath', 'log'), 'file')]);
  }

  async function doctorModal() {
    const box = h('div', { class: 'cards blox-list' }, h('div', { class: 'empty-card' }, 'Alles controleren…'));
    modal('Diagnose', null, box);
    try {
      const rows = await call('blox:doctor');
      box.textContent = '';
      for (const r of rows) {
        box.append(h('div', { class: 'card' }, h('span', { class: `perm ${r.ok ? 'ok' : 'no'}` }, icon(r.ok ? 'check' : 'x', 13)), h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, r.check), h('div', { class: 'card-desc' }, r.detail))));
      }
      refreshStatus();
    } catch (e) {
      box.textContent = e.message;
    }
  }

  function helpModal() {
    const list = h('div', { class: 'cards blox-list' });
    for (const c of COMMANDS) list.append(h('button', { class: 'card card-btn', onclick: () => (closeModal(), c.arg ? prefill(c.cmd) : runCommand(c.cmd)) }, h('div', { class: 'card-main' }, h('div', { class: 'card-title mono-title' }, `${c.cmd}${c.arg ? ` ${c.arg}` : ''}`), h('div', { class: 'card-desc' }, c.desc)), icon('chevron', 14)));
    modal("Commando's", 'Alles kan ook met de knoppen: de BloxCode-chip onder het invoerveld zet BloxCode in deze chat aan of uit, daarnaast kies je Studio en modus, de rest via dit menu. Enter verstuurt, Shift+Enter is een nieuwe regel, Esc stopt BloxCode.', list);
  }

  // ---------- /-commando's ----------
  const COMMANDS = [
    { cmd: '/help', desc: "alle commando's", run: () => helpModal() },
    { cmd: '/blox', arg: 'aan|uit', desc: 'BloxCode in deze chat aan- of uitzetten', run: (arg) => bloxCommand(arg) },
    { cmd: '/studio', arg: '[nummer]', desc: 'Studio-venster kiezen', run: (arg) => studioCommand(arg) },
    { cmd: '/reconnect', desc: 'opnieuw verbinden met Roblox Studio', run: () => reconnect() },
    { cmd: '/modus', arg: 'plan|ask|auto|yolo', desc: 'modus wisselen', run: (arg) => (MODES[arg] ? setMode(arg) : modeMenu(document.querySelector('#chip-mode'))) },
    { cmd: '/auto', desc: 'veilige auto-approve aan', run: () => setMode('auto') },
    { cmd: '/yolo', desc: 'alles automatisch: nooit meer goedkeuringen', run: () => setMode('yolo') },
    { cmd: '/plan', desc: 'plan-modus (alleen lezen)', run: () => setMode('plan') },
    { cmd: '/nieuw', desc: 'nieuwe BloxCode-chat', run: () => ctx.newChat() },
    { cmd: '/sessies', desc: 'opgeslagen sessies (ook uit de terminal)', run: () => sessionsModal() },
    { cmd: '/hervat', arg: '[id]', desc: 'laatste sessie hervatten', run: (arg) => resumeCommand(arg) },
    { cmd: '/foto', arg: '[pad]', desc: 'foto meesturen als voorbeeld', run: (arg) => ctx.addPhotos(arg) },
    { cmd: '/geheugen', desc: 'langetermijngeheugen', run: () => memoryModal() },
    { cmd: '/onthoud', arg: '<feit>', desc: 'feit onthouden', run: (arg) => rememberCommand(arg) },
    { cmd: '/vergeet', arg: '<nummer of tekst>', desc: 'feit vergeten', run: (arg) => forgetCommand(arg) },
    { cmd: '/skills', desc: 'beschikbare Roblox-skills', run: () => skillsModal() },
    { cmd: '/skill', arg: '<naam>', desc: 'skill in het gesprek laden', run: (arg) => (arg ? loadSkillIntoChat(arg) : skillsModal()) },
    { cmd: '/tools', desc: 'Studio-tools en hun veiligheidsniveau', run: () => toolsModal() },
    { cmd: '/denken', desc: 'laatste redenering van het model', run: () => reasoningModal() },
    { cmd: '/thinking', arg: 'aan|uit', desc: 'thinking mode', run: (arg) => thinkingCommand(arg) },
    { cmd: '/compact', desc: 'geschiedenis samenvatten (bespaart tokens)', run: () => compactCommand() },
    { cmd: '/log', desc: 'recente acties in Studio', run: () => logModal() },
    { cmd: '/tokens', desc: 'tokenverbruik van deze chat', run: () => tokensModal() },
    { cmd: '/config', desc: 'BloxCode-instellingen', run: () => configModal() },
    { cmd: '/key', desc: 'DeepSeek API-sleutel', run: () => ctx.showView('settings') },
    { cmd: '/doctor', desc: 'diagnose van je installatie', run: () => doctorModal() },
  ];
  const ALIASES = { '/mode': '/modus', '/new': '/nieuw', '/clear': '/nieuw', '/sessions': '/sessies', '/resume': '/hervat', '/memory': '/geheugen', '/remember': '/onthoud', '/forget': '/vergeet', '/usage': '/tokens', '/kosten': '/tokens', '/think': '/denken', '/photo': '/foto', '/image': '/foto', '/alles': '/yolo', '/fullauto': '/yolo', '/always': '/yolo' };

  async function bloxCommand(arg) {
    const a = String(arg || '').toLowerCase();
    if (['aan', 'on'].includes(a)) return ctx.toggleBlox(true);
    if (['uit', 'off'].includes(a)) return ctx.toggleBlox(false);
    return ctx.toggleBlox();
  }

  async function studioCommand(arg) {
    const st = await call('blox:studios').catch(() => B.status);
    onStatus(st);
    const n = Number(arg);
    if (arg && Number.isInteger(n) && n >= 1 && n <= (st?.studios || []).length) {
      onStatus(await call('blox:selectStudio', st.studios[n - 1].id));
      return toast(`Studio gekozen: ${studioLabel(B.status)}`);
    }
    studioMenu(document.querySelector('#chip-workspace'));
  }

  async function resumeCommand(arg) {
    const mine = await refreshSessions();
    if (!arg) {
      const other = mine.find((s) => s.id !== state.session?.id);
      if (other) return ctx.openSession(other.id);
      return sessionsModal();
    }
    const hit = mine.find((s) => s.id.startsWith(arg) || s.title.toLowerCase().includes(arg.toLowerCase()));
    if (hit) return ctx.openSession(hit.id);
    const legacy = (await call('blox:legacyList')).find((l) => l.id.startsWith(arg));
    if (legacy) return importLegacy(legacy.id);
    toast('Geen sessie gevonden om te hervatten.', 'error');
  }

  async function rememberCommand(arg) {
    if (!arg) return memoryModal();
    toast((await call('blox:remember', arg)) ? 'Onthouden.' : 'Stond al in het geheugen.');
    refreshStatus();
  }

  async function forgetCommand(arg) {
    if (!arg) return memoryModal();
    const removed = await call('blox:forget', arg);
    toast(removed ? `Vergeten: ${removed}` : 'Niet gevonden. Open /geheugen voor de nummers.', removed ? '' : 'error');
    refreshStatus();
  }

  async function thinkingCommand(arg) {
    const a = String(arg || '').toLowerCase();
    if (['aan', 'on'].includes(a)) await ctx.saveCfg({ thinking: state.cfg.thinking === 'off' ? 'high' : state.cfg.thinking });
    else if (['uit', 'off'].includes(a)) await ctx.saveCfg({ thinking: 'off' });
    toast(`Thinking mode staat ${state.cfg.thinking === 'off' ? 'uit' : `aan (${state.cfg.thinking})`}`);
  }

  async function compactCommand() {
    if (!isBloxSession()) return toast('Open eerst een BloxCode-chat', 'error');
    toast('Geschiedenis samenvatten…');
    try {
      await call('blox:compact', state.session.id);
      toast('Geschiedenis samengevat; de laatste vragen blijven intact.');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function prefill(cmd) {
    const el = document.querySelector('#input');
    el.value = `${cmd} `;
    el.focus();
    el.dispatchEvent(new Event('input'));
  }

  // Voert een regel die met / begint uit. Geeft true terug als het een bekend commando was.
  function runCommand(line) {
    const trimmed = String(line || '').trim();
    const space = trimmed.indexOf(' ');
    let cmd = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
    const arg = space < 0 ? '' : trimmed.slice(space + 1).trim();
    cmd = ALIASES[cmd] || cmd;
    const c = COMMANDS.find((x) => x.cmd === cmd);
    if (!c) {
      toast(`Onbekend commando ${cmd}. Typ /help.`, 'error');
      return true;
    }
    Promise.resolve(c.run(arg)).catch((e) => toast(e.message, 'error'));
    return true;
  }

  // ---- popup met commando's terwijl je typt ----
  function slashEl() {
    let el = document.querySelector('#slash');
    if (!el) {
      el = h('div', { id: 'slash', class: 'slash', hidden: true });
      document.querySelector('#composer').prepend(el);
    }
    return el;
  }

  function updateSlash(value) {
    const el = slashEl();
    const v = String(value || '');
    if (!v.startsWith('/') || v.includes(' ') || v.includes('\n')) return hideSlash();
    const q = v.toLowerCase();
    B.slash.items = COMMANDS.filter((c) => c.cmd.startsWith(q) || (q.length > 1 && c.desc.toLowerCase().includes(q.slice(1))));
    if (!B.slash.items.length) return hideSlash();
    B.slash.index = Math.min(B.slash.index, B.slash.items.length - 1);
    el.textContent = '';
    B.slash.items.forEach((c, i) =>
      el.append(
        h(
          'button',
          {
            class: `slash-item${i === B.slash.index ? ' active' : ''}`,
            onmousedown: (e) => {
              e.preventDefault();
              pickSlash(i);
            },
          },
          h('span', { class: 'slash-cmd' }, c.cmd, c.arg ? h('span', { class: 'slash-arg' }, ` ${c.arg}`) : null),
          h('span', { class: 'slash-desc' }, c.desc),
        ),
      ),
    );
    el.hidden = false;
    B.slash.open = true;
    el.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function hideSlash() {
    const el = document.querySelector('#slash');
    if (el) el.hidden = true;
    B.slash.open = false;
    B.slash.index = 0;
  }

  function pickSlash(i) {
    const c = B.slash.items[i];
    if (!c) return;
    hideSlash();
    const el = document.querySelector('#input');
    if (c.arg) {
      el.value = `${c.cmd} `;
      el.dispatchEvent(new Event('input'));
      el.focus();
    } else {
      el.value = '';
      el.dispatchEvent(new Event('input'));
      runCommand(c.cmd);
    }
  }

  // Toetsen in het invoerveld; true = afgehandeld.
  function onKeydown(e) {
    if (!B.slash.open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = B.slash.items.length;
      B.slash.index = (B.slash.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      updateSlash(document.querySelector('#input').value);
      return true;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      pickSlash(B.slash.index);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlash();
      return true;
    }
    return false;
  }

  return {
    state: B,
    MODES,
    refreshStatus,
    onStatus,
    ensureConnected,
    refreshSessions,
    composerChips,
    studioMenu,
    modeMenu,
    renderHome,
    approvalCard,
    runCommand,
    updateSlash,
    hideSlash,
    onKeydown,
    helpModal,
    sessionsModal,
    isBloxSession,
  };
}
