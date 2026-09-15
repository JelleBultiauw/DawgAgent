// GitHub-sync in de interface: knop in de zijbalk, mini-activiteitsgraph en de vensters.
// app.js geeft zijn hulpfuncties mee via createGit(ctx).
export function createGit(ctx) {
  const { h, icon, call, toast, openModal, closeModal, openMenu, btn, iconBtn, confirmDialog, settingRow, toggleSwitch, fmtWhen, state } = ctx;

  const G = {
    status: null,
    activity: null,
    messages: {}, // commitnaam per project (wat de gebruiker typt)
    expanded: {}, // bestandslijst open/dicht per project
    busy: false,
    body: null, // inhoud van het sync-venster, zodat we opnieuw kunnen tekenen
  };

  const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
  const level = (n) => (n <= 0 ? '' : n === 1 ? 'l1' : n === 2 ? 'l2' : 'l3');
  const cellTitle = (d) =>
    d ? `${dayLabel(d.date)} · ${d.commits} wijziging${d.commits === 1 ? '' : 'en'} · ${d.files} bestand${d.files === 1 ? '' : 'en'}${Object.keys(d.projects).length ? ` · ${Object.keys(d.projects).join(', ')}` : ''}` : '';

  // Dagen netjes in weken (kolommen van maandag t/m zondag), precies `weeks` kolommen breed.
  function toWeeks(days, weeks = 8) {
    if (!days.length) return [];
    const lead = (new Date(`${days[0].date}T12:00:00`).getDay() + 6) % 7;
    const cells = [...Array(lead).fill(null), ...days.slice(-(7 * weeks - lead))];
    const cols = [];
    for (let i = 0; i < cells.length; i += 7) {
      const col = cells.slice(i, i + 7);
      while (col.length < 7) col.push(null);
      cols.push(col);
    }
    return cols;
  }

  function gridEl(days, cellClass = 'git-cell', weeks = 8) {
    const wrap = h('div', { class: 'git-grid' });
    for (const col of toWeeks(days, weeks)) {
      const c = h('div', { class: 'git-mini-col' });
      for (const d of col) {
        const levelCls = d ? level(d.commits) : 'git-off';
        c.append(h('div', { class: `${cellClass} ${levelCls}`, title: cellTitle(d) }));
      }
      wrap.append(c);
    }
    return wrap;
  }

  // ---------- zijbalk ----------
  function renderMini() {
    const box = document.querySelector('#git-mini');
    if (!box) return;
    box.textContent = '';
    const act = G.activity;
    const days = act?.grid || [];
    const week = days.slice(-7).reduce((a, d) => a + (d.commits || 0), 0);
    const projects = G.status?.projects || [];
    const dirty = projects.filter((p) => p.dirty && p.exists && p.remote);
    const noRepo = projects.filter((p) => p.exists && !p.remote);
    box.append(gridEl(days.slice(-7 * 8), 'git-cell', 8));
    const cap = h('div', { class: 'git-mini-cap' });
    cap.append(h('b', {}, String(week)));
    cap.append(h('span', {}, week === 1 ? 'wijziging deze week' : 'wijzigingen deze week'));
    if (G.status?.auto) cap.append(h('span', { class: 'git-auto' }, 'auto'));
    box.append(cap);
    const dot = document.querySelector('#git-dot');
    if (dot) dot.className = `blox-dot ${dirty.length ? 'warn' : projects.some((p) => p.remote) ? 'ok' : ''}`;
    box.title = dirty.length
      ? `${dirty.length} project(en) met nog niet gepushte wijzigingen — klik voor de details`
      : noRepo.length
        ? `Nog geen repo voor: ${noRepo.map((p) => p.name).join(', ')} — klik om te koppelen`
        : act?.total
          ? `${act.total} wijzigingen gepusht · klik voor de activiteit`
          : 'Nog niets gepusht — klik om te beginnen';
    box.onclick = () => activityModal();
  }

  async function refresh() {
    try {
      const [status, activity] = await Promise.all([call('git:status'), call('git:activity')]);
      G.status = status;
      G.activity = activity;
    } catch {}
    renderMini();
    if (G.body) renderBody();
  }

  // ---------- kleine bouwstenen ----------
  function pill(text, cls = '') {
    return h('span', { class: `git-pill ${cls}` }, text);
  }

  function fileList(files, key) {
    const open = G.expanded[key];
    const shown = open ? files : files.slice(0, 8);
    const box = h('div', { class: 'git-files' });
    for (const f of shown) {
      box.append(
        h(
          'div',
          { class: 'git-file' },
          h('span', { class: 'git-file-path' }, f.path),
          f.insertions ? h('span', { class: 'git-file-num' }, `+${f.insertions}`) : null,
          f.deletions ? h('span', { class: 'git-file-num del' }, `−${f.deletions}`) : null,
        ),
      );
    }
    if (files.length > 8) {
      box.append(
        h(
          'button',
          { class: 'git-file', style: 'width:100%;text-align:left;color:var(--muted)', onclick: () => { G.expanded[key] = !open; renderBody(); } },
          open ? '— minder tonen' : `— en ${files.length - 8} meer`,
        ),
      );
    }
    return box;
  }

  function saveProjects(projects) {
    return call('git:setConfig', { projects });
  }

  function projectPayload() {
    return (G.status?.projects || []).map((p) => ({ id: p.id, name: p.name, path: p.path, repo: p.repo, branch: p.branch, enabled: p.enabled !== false }));
  }

  async function patchProject(id, patch) {
    await saveProjects(projectPayload().map((p) => (p.id === id ? { ...p, ...patch } : p)));
    await refresh();
  }

  // ---------- sync-venster ----------
  function openSyncModal() {
    const body = h('div', { class: 'cards' });
    G.body = body;
    const footer = h('div', { class: 'git-actions' });
    footer.append(
      btn('Alles pushen', 'primary', () => pushAll(), 'up'),
      btn('Project toevoegen', 'ghost', (e) => addProjectMenu(e.currentTarget), 'plus'),
      btn('Activiteit', 'ghost', () => activityModal(), 'history'),
      btn('Sluiten', 'ghost', closeModal),
    );
    openModal(
      h(
        'div',
        {},
        h('h2', {}, 'GitHub-sync'),
        h('p', { class: 'lead' }, 'Elk project gaat naar zijn eigen repo. Je ziet wat er klaarstaat, kunt de repo en de commitnaam aanpassen en daarna pushen. API-sleutels en .env-bestanden blijven automatisch thuis.'),
        body,
        footer,
      ),
      'wide',
    );
    refresh();
    renderBody();
  }

  function renderBody() {
    const box = G.body;
    if (!box) return;
    box.textContent = '';
    const st = G.status;

    // Automatisch of handmatig.
    box.append(
      settingRow(
        'Automatisch pushen',
        'Aan: na elke wijziging die penuraplicatie maakt gaat alles meteen naar GitHub (zonder te vragen). Uit: alleen als je hier op Pushen klikt.',
        toggleSwitch(Boolean(st?.auto), (on) => setAuto(on)),
      ),
    );

    if (st && !st.gh?.authed) {
      box.append(
        h(
          'div',
          { class: 'git-note' },
          'Nog niet ingelogd bij GitHub. Log één keer in via de knop hiernaast; daarna kan penuraplicatie repo\u2019s aanmaken en pushen.',
          h('div', { style: 'margin-top:8px' }, btn('Inloggen met GitHub', '', () => login(), 'external')),
        ),
      );
    }

    if (!st?.projects?.length) {
      box.append(h('div', { class: 'empty-card' }, 'Nog geen projecten. Voeg een map toe die naar GitHub mag.'));
      return;
    }

    for (const p of st.projects) box.append(projectCard(p));
  }

  function projectCard(p) {
    const card = h('div', { class: 'card git-card' });
    const commitInput = h('input', { class: 'input', placeholder: 'Wat heb je gedaan? (commitnaam)', value: G.messages[p.id] ?? p.suggestion ?? '' });
    commitInput.addEventListener('input', () => (G.messages[p.id] = commitInput.value));

    card.append(
      h(
        'div',
        { class: 'git-head' },
        icon('git', 15),
        h('span', { class: 'git-name' }, p.name),
        h('span', { class: 'git-branch' }, `${p.branch || 'main'}${p.lastCommit ? ` · ${p.lastCommit.sha}` : ''}`),
        iconBtn('trash', 'Project uit de lijst halen', async () => {
          if (!(await confirmDialog('Project verwijderen?', `"${p.name}" verdwijnt uit de GitHub-sync. De map en de repo blijven bestaan.`, 'Verwijderen', true))) return;
          await call('git:removeProject', p.id);
          delete G.messages[p.id];
          await refresh();
        }),
      ),
    );

    // Naam + map.
    card.append(
      h(
        'div',
        { class: 'git-field' },
        h('label', {}, 'Project'),
        h('input', { class: 'input', value: p.name, onchange: (e) => patchProject(p.id, { name: e.target.value.trim() || p.name }) }),
      ),
      h(
        'div',
        { class: 'git-field' },
        h('label', {}, 'Map'),
        h('input', { class: 'input mono', value: p.path, readonly: true, title: p.path }),
        btn('Kies…', 'ghost', async () => {
          const r = await call('git:pickFolder', p.id);
          if (r) await refresh();
        }, 'folder'),
      ),
      h(
        'div',
        { class: 'git-field' },
        h('label', {}, 'Repo'),
        h('input', { class: 'input mono', placeholder: 'git@github.com:gebruiker/repo.git', value: p.repo || '', onchange: (e) => patchProject(p.id, { repo: e.target.value.trim() }) }),
      ),
      h(
        'div',
        { class: 'git-field' },
        h('label', {}, 'Branch'),
        h('input', { class: 'input mono', style: 'max-width:160px', value: p.branch || 'main', onchange: (e) => patchProject(p.id, { branch: e.target.value.trim() || 'main' }) }),
      ),
    );

    // Wat gaat er mee?
    const stats = h('div', { class: 'git-stats' });
    if (!p.exists) stats.append(pill(p.error || 'Map niet gevonden', 'del'));
    else if (p.dirty) {
      stats.append(pill(`${p.stats.files} bestand${p.stats.files === 1 ? '' : 'en'}`, ''));
      if (p.stats.insertions) stats.append(pill(`+${p.stats.insertions}`, 'add'));
      if (p.stats.deletions) stats.append(pill(`−${p.stats.deletions}`, 'del'));
      if (p.ahead) stats.append(pill(`${p.ahead} commit${p.ahead === 1 ? '' : 's'} nog niet gepusht`, 'warn'));
      if (p.newRepo) stats.append(pill('eerste push', 'warn'));
    } else {
      stats.append(pill(p.isRepo ? 'Geen wijzigingen' : 'Nog geen repo', ''));
      if (p.lastCommit) stats.append(pill(`laatste: ${p.lastCommit.when}`, ''));
    }
    card.append(stats);

    if (p.dirty && p.changes.length) card.append(fileList(p.changes, p.id));

    // Geheimen en grote bestanden.
    if (p.secrets?.block?.length) {
      card.append(
        h(
          'div',
          { class: 'git-warn' },
          h('b', {}, 'Er staan geheimen in deze bestanden — er wordt niets gepusht:'),
          h('ul', { style: 'margin:6px 0 0;padding-left:18px' }, p.secrets.block.map((s) => h('li', {}, `${s.file}${s.line ? `:${s.line}` : ''} — ${s.label}`))),
          h('div', { style: 'margin-top:6px' }, 'Haal de sleutel eruit (of zet hem in een .env-bestand) en probeer opnieuw.'),
        ),
      );
    }
    if (p.secrets?.hidden?.length) {
      card.append(h('div', { class: 'git-note' }, `Automatisch verborgen (nooit meepushen): ${p.secrets.hidden.join(', ')}`));
    }
    if (p.big?.length) card.append(h('div', { class: 'git-warn' }, `Te groot voor GitHub: ${p.big.map((b) => b.path).join(', ')}`));

    // Commitnaam + pushen.
    if (p.dirty) card.append(commitInput);
    const actions = h('div', { class: 'git-actions' });
    if (p.exists) actions.append(btn(p.dirty ? 'Push' : 'Push', 'primary', () => pushProject(p.id), 'up'));
    if (p.exists && !p.remote) {
      if (G.status?.gh?.authed) actions.append(btn('Repo aanmaken', '', () => createRepo(p.id), 'github'));
      else actions.append(btn('Inloggen met GitHub', 'ghost', () => login(), 'github'));
    }
    if (p.remote) {
      actions.append(
        btn('Openen op GitHub', 'ghost', () => call('app:openExternal', String(p.remote).replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')), 'external'),
      );
    }
    card.append(actions);
    return card;
  }

  // ---------- acties ----------
  async function setAuto(on) {
    await call('git:setConfig', { auto: Boolean(on) });
    toast(on ? 'GitHub-sync: automatisch pushen staat aan' : 'GitHub-sync: je pusht nu handmatig');
    await refresh();
  }

  async function pushProject(id) {
    if (G.busy) return;
    G.busy = true;
    toast('Pushen naar GitHub…');
    try {
      const r = await call('git:push', id, { message: G.messages[id] || '' });
      if (r.nothing) toast('Geen wijzigingen om te pushen.');
      else if (r.blocked) toast(`Niets gepusht: geheimen gevonden in ${r.secrets.block.map((s) => s.file).join(', ')}`, 'error');
      else if (!r.ok) toast(r.error || 'Push mislukt', 'error');
      else {
        toast(`Gepusht${r.sha ? ` · ${r.sha}` : ''} — ${r.files.length} bestand${r.files.length === 1 ? '' : 'en'}${r.pushed ? '' : ' (nog geen repo-URL: alleen commit)'}`);
        delete G.messages[id];
      }
    } catch (e) {
      toast(e.message, 'error');
    }
    G.busy = false;
    await refresh();
  }

  async function pushAll() {
    if (G.busy) return;
    G.busy = true;
    toast('Alles pushen…');
    try {
      const r = await call('git:pushAll', { messages: G.messages });
      const ok = (r.results || []).filter((x) => x.ok && !x.nothing).length;
      const nothing = (r.results || []).filter((x) => x.nothing).length;
      const bad = (r.results || []).filter((x) => !x.ok && !x.blocked);
      const blocked = (r.results || []).filter((x) => x.blocked);
      const bits = [];
      if (ok) bits.push(`${ok} project${ok === 1 ? '' : 'en'} gepusht`);
      if (nothing) bits.push(`${nothing} zonder wijzigingen`);
      if (blocked.length) bits.push(`${blocked.length} geblokkeerd door geheimen`);
      if (bad.length) bits.push(`${bad.length} mislukt (${bad.map((b) => b.project).join(', ')})`);
      toast(bits.join(' · ') || 'Klaar', bad.length ? 'error' : '');
    } catch (e) {
      toast(e.message, 'error');
    }
    G.busy = false;
    await refresh();
  }

  async function createRepo(id) {
    if (G.busy) return;
    G.busy = true;
    toast('Privé-repo aanmaken op GitHub…');
    try {
      const r = await call('git:createRepo', id);
      if (r.blocked) toast(`Niets gepusht: geheimen gevonden in ${r.secrets.block.map((s) => s.file).join(', ')}`, 'error');
      else toast(`Repo aangemaakt: ${r.url}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    G.busy = false;
    await refresh();
  }

  async function login() {
    try {
      await call('git:login');
      toast('Rond de login af in Terminal; daarna kun je hier repo\u2019s aanmaken.');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function addProjectMenu(anchor) {
    const detected = (G.status?.detected || []).filter((d) => !(G.status?.projects || []).some((p) => p.path === d.path));
    const items = [{ header: true, label: 'Gevonden mappen' }];
    if (!detected.length) items.push({ label: 'Geen mappen met git of Roblox-code gevonden', action: () => {} });
    for (const d of detected.slice(0, 12)) {
      items.push({
        label: d.name,
        desc: `${String(d.path).replace(state.info?.home || '', '~')}${d.git ? ' · git-repo' : ''}${d.roblox ? ' · Roblox' : ''}`,
        icon: d.roblox ? 'cube' : 'folder',
        action: async () => {
          await call('git:addProject', d.path);
          await refresh();
          toast(`${d.name} toegevoegd`);
        },
      });
    }
    items.push('-', { label: 'Map kiezen…', icon: 'folder', action: async () => {
      const dir = await call('workspace:pick');
      if (!dir) return;
      await call('git:addProject', dir);
      await refresh();
      toast('Project toegevoegd');
    } });
    openMenu(anchor, items, { align: 'left' });
  }

  // ---------- activiteit ----------
  function activityModal() {
    const act = G.activity || { grid: [], entries: [], total: 0, streak: 0 };
    const week = act.grid.slice(-7).reduce((a, d) => a + (d.commits || 0), 0);
    const month = act.grid.slice(-30).reduce((a, d) => a + (d.commits || 0), 0);
    const body = h(
      'div',
      {},
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('small', {}, 'Deze week'), h('b', {}, String(week))),
        h('div', { class: 'stat' }, h('small', {}, 'Laatste 30 dagen'), h('b', {}, String(month))),
        h('div', { class: 'stat' }, h('small', {}, 'Streak'), h('b', {}, `${act.streak} dag${act.streak === 1 ? '' : 'en'}`)),
        h('div', { class: 'stat' }, h('small', {}, 'Totaal'), h('b', {}, String(act.total))),
      ),
      h(
        'div',
        { class: 'git-grid-wrap', style: 'margin-top:14px' },
        gridEl(act.grid.slice(-7 * 26)),
        h(
          'div',
          { class: 'git-legend' },
          'minder',
          h('div', { class: 'git-cell' }),
          h('div', { class: 'git-cell l1' }),
          h('div', { class: 'git-cell l2' }),
          h('div', { class: 'git-cell l3' }),
          'meer — elke kolom is een week, klik op een vakje voor de dag',
        ),
      ),
    );

    const list = h('div', { class: 'cards', style: 'margin-top:16px' });
    if (!act.entries.length) list.append(h('div', { class: 'empty-card' }, 'Nog geen wijzigingen gepusht. Zodra je pusht, verschijnt hier wat je wanneer hebt gedaan.'));
    for (const e of act.entries.slice(0, 40)) {
      const open = G.expanded[`a${e.ts}`];
      const row = h('div', { class: 'card' });
      const when = fmtWhen(e.ts);
      const time = new Date(e.ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      row.append(
        h(
          'div',
          { class: 'git-entry', style: 'cursor:pointer', onclick: () => { G.expanded[`a${e.ts}`] = !open; activityModal(); } },
          h('span', { class: 'git-entry-when' }, /:/.test(when) ? `vandaag ${time}` : `${when} ${time}`),
          h(
            'div',
            { class: 'git-entry-main' },
            h('div', { class: 'git-entry-msg' }, e.message?.split('\n')[0] || 'sync'),
            h('div', { class: 'git-entry-sub' }, `${e.project} · ${e.filesCount} bestand${e.filesCount === 1 ? '' : 'en'} · +${e.insertions} −${e.deletions}${e.sha ? ` · ${e.sha}` : ''}`),
          ),
          icon(open ? 'down' : 'chevron', 14),
        ),
      );
      if (open) {
        const files = h('div', { class: 'git-files', style: 'margin-top:8px' });
        for (const f of (e.files || []).slice(0, 40)) {
          files.append(h('div', { class: 'git-file' }, h('span', { class: 'git-file-path' }, f.path), f.insertions ? h('span', { class: 'git-file-num' }, `+${f.insertions}`) : null, f.deletions ? h('span', { class: 'git-file-num del' }, `−${f.deletions}`) : null));
        }
        if (!e.files?.length) files.append(h('div', { class: 'git-file' }, h('span', { class: 'git-file-path' }, 'Alleen een push (geen nieuwe bestanden)')));
        row.append(files);
        if (e.hidden?.length) row.append(h('div', { class: 'git-note', style: 'margin-top:8px' }, `Verborgen gehouden: ${e.hidden.join(', ')}`));
      }
      list.append(row);
    }

    openModal(
      h(
        'div',
        {},
        h('h2', {}, 'GitHub-activiteit'),
        h('p', { class: 'lead' }, 'Wanneer er iets is gepusht en aan welke bestanden.'),
        body,
        list,
        h('div', { class: 'modal-actions' }, btn('Open sync-venster', 'ghost', () => openSyncModal(), 'git'), btn('Sluiten', 'primary', closeModal)),
      ),
      'wide',
    );
  }

  return { state: G, refresh, renderMini, openSyncModal, activityModal };
}
