// GitHub-sync in de interface: knop in de zijbalk, mini-activiteitsgraph en de vensters.
// app.js geeft zijn hulpfuncties mee via createGit(ctx).
import { dateLocale } from './i18n.js';
export function createGit(ctx) {
  const { h, icon, call, toast, openModal, closeModal, openMenu, btn, iconBtn, confirmDialog, settingRow, toggleSwitch, fmtWhen, state } = ctx;

  const G = {
    status: null,
    activity: null,
    messages: {}, // commitnaam per project (wat de gebruiker typt)
    expanded: {}, // bestandslijst open/dicht per project
    repoExists: null, // per project: bestaat de repo op GitHub?
    repos: null, // repo's van je account (voor het beheer-venster)
    scopeNeeded: false, // GitHub vraagt extra toestemming om te mogen verwijderen
    busy: false,
    body: null, // inhoud van het sync-venster, zodat we opnieuw kunnen tekenen
  };

  const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' });
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
      btn("Repo's beheren", 'ghost', () => reposModal(), 'github'),
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
    // Even op de achtergrond kijken of de repo's echt bestaan op GitHub.
    call('git:checkRepos')
      .then((res) => {
        G.repoExists = res || {};
        renderBody();
      })
      .catch(() => {});
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
        'Aan: na elke wijziging die DawgAgent maakt gaat alles meteen naar GitHub (zonder te vragen). Uit: alleen als je hier op Pushen klikt.',
        toggleSwitch(Boolean(st?.auto), (on) => setAuto(on)),
      ),
    );

    if (st && !st.gh?.authed) {
      box.append(
        h(
          'div',
          { class: 'git-note' },
          'Nog niet ingelogd bij GitHub. Log één keer in via de knop hiernaast; daarna kan DawgAgent repo\u2019s aanmaken en pushen.',
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

    // Bestaat de repo op GitHub? (eenmalige controle als het venster opengaat)
    const exists = G.repoExists ? G.repoExists[p.id] : null;
    if (p.repo && exists === false) {
      card.append(
        h(
          'div',
          { class: 'git-warn' },
          h('b', {}, 'Deze repo bestaat nog niet op GitHub. '),
          'De push hierboven faalt zolang hij niet bestaat — maak hem in één klik aan (privé) en push meteen.',
          h('div', { style: 'margin-top:8px' }, btn('Repo aanmaken en pushen', '', () => createRepo(p.id), 'github')),
        ),
      );
    }

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
    if (p.exists) actions.append(btn('Push', 'primary', () => pushProject(p.id), 'up'));
    if (p.exists && (!p.remote || exists === false)) {
      actions.append(btn(exists === false ? 'Repo aanmaken' : 'Repo aanmaken', '', () => createRepo(p.id), 'github'));
    }
    if (p.exists) actions.append(btn('Kies repo…', 'ghost', (e) => pickRepoMenu(e.currentTarget, p), 'list'));
    if (p.remote) {
      actions.append(
        btn('Openen op GitHub', 'ghost', () => call('app:openExternal', String(p.remote).replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')), 'external'),
      );
    }
    card.append(actions);
    return card;
  }

  // Bestaande repo's van jouw account kiezen voor dit project.
  async function pickRepoMenu(anchor, p) {
    let list = G.repos;
    if (!list) {
      try {
        const r = await call('git:listRepos');
        G.repos = r.repos || [];
        list = G.repos;
      } catch (e) {
        return toast(e.message, 'error');
      }
    }
    const items = [{ header: true, label: `${list.length} repo's van je account` }];
    for (const r of list.slice(0, 40)) {
      items.push({
        label: r.nameWithOwner,
        desc: `${r.isPrivate ? 'privé' : 'publiek'}${r.primaryLanguage?.name ? ` · ${r.primaryLanguage.name}` : ''}${r.description ? ` · ${r.description.slice(0, 40)}` : ''}`,
        icon: 'github',
        checked: p.repo?.includes(`/${r.name}.git`),
        action: async () => {
          const res = await call('git:linkRepo', p.id, `git@github.com:${r.nameWithOwner}.git`);
          toast(res.ok ? `Gekoppeld aan ${r.nameWithOwner}` : res.error || 'Gekoppeld', res.ok ? '' : 'error');
          await refresh();
        },
      });
    }
    items.push('-', { label: "Repo's beheren…", icon: 'git', action: () => reposModal() });
    openMenu(anchor, items, { align: 'left' });
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
      else if (!r.ok) {
        if (r.missingRepo) {
          G.repoExists = { ...(G.repoExists || {}), [id]: false };
          toast('De repo bestaat nog niet op GitHub — klik op "Repo aanmaken".', 'error');
        } else toast(r.error || 'Push mislukt', 'error');
      } else {
        toast(`Gepusht${r.sha ? ` · ${r.sha}` : ''} — ${r.files.length} bestand${r.files.length === 1 ? '' : 'en'}${r.pushed ? '' : ' (nog geen repo-URL: alleen commit)'}`);
        delete G.messages[id];
        if (r.pushed) G.repoExists = { ...(G.repoExists || {}), [id]: true };
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
    toast('Privé-repo aanmaken op GitHub en pushen…');
    try {
      const r = await call('git:createRepo', id);
      if (r.blocked) toast(`Niets gepusht: geheimen gevonden in ${r.secrets.block.map((s) => s.file).join(', ')}`, 'error');
      else if (r.ok === false && r.error) toast(r.error, 'error');
      else {
        toast(`Repo klaar: ${r.url}`);
        G.repoExists = { ...(G.repoExists || {}), [id]: true };
        G.repos = null;
      }
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

  // ---------- repo's beheren ----------
  async function reposModal() {
    const listBox = h('div', { class: 'cards blox-list' }, h('div', { class: 'empty-card' }, 'Repo\u2019s ophalen…'));
    const notice = h('div', {});
    const search = h('input', { class: 'input', placeholder: 'Zoek in je repo\u2019s…' });
    let repos = [];
    let query = '';
    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      renderList();
    });

    const load = async () => {
      listBox.textContent = '';
      listBox.append(h('div', { class: 'empty-card' }, 'Repo\u2019s ophalen…'));
      try {
        const r = await call('git:listRepos');
        G.repos = r.repos || [];
        repos = G.repos;
      } catch (e) {
        listBox.textContent = '';
        listBox.append(h('div', { class: 'git-warn' }, e.message));
        return;
      }
      renderList();
    };

    function renderList() {
      listBox.textContent = '';
      const shown = repos.filter((r) => !query || r.nameWithOwner.toLowerCase().includes(query) || (r.description || '').toLowerCase().includes(query));
      if (!shown.length) listBox.append(h('div', { class: 'empty-card' }, repos.length ? 'Geen repo gevonden met die zoekterm.' : 'Nog geen repo\u2019s. Maak er een van een map hierboven.'));
      for (const r of shown) listBox.append(repoRow(r));
      // Extra toestemming nodig om te verwijderen?
      notice.textContent = '';
      if (G.scopeNeeded) {
        notice.append(
          h(
            'div',
            { class: 'git-warn', style: 'margin-bottom:12px' },
            h('b', {}, 'Verwijderen vraagt één keer extra toestemming van GitHub. '),
            'Geef die hier; daarna kun je repo\u2019s gewoon met twee klikken wissen.',
            h('div', { style: 'margin-top:8px' }, btn('Toestemming geven', '', () => authRefresh(), 'key')),
          ),
        );
      }
    }

    function repoRow(r) {
      const linked = (G.status?.projects || []).filter((p) => p.repo && p.repo.includes(`/${r.name}.git`));
      const row = h('div', { class: 'card git-repo' });
      row.append(
        h(
          'div',
          { class: 'git-repo-main' },
          h('div', { class: 'git-repo-name' }, r.nameWithOwner, r.isPrivate ? h('span', { class: 'tag' }, 'privé') : h('span', { class: 'tag' }, 'publiek')),
          h(
            'div',
            { class: 'git-repo-sub' },
            [r.primaryLanguage?.name, r.diskUsage ? `${(r.diskUsage / 1024).toFixed(1)} MB` : '', r.pushedAt ? `laatst gepusht ${fmtWhen(Date.parse(r.pushedAt))}` : '', r.viewerPermission ? r.viewerPermission.toLowerCase() : ''].filter(Boolean).join(' · '),
          ),
          r.description ? h('div', { class: 'git-repo-desc' }, r.description) : null,
          linked.length ? h('div', { class: 'git-repo-linked' }, `gekoppeld aan ${linked.map((p) => p.name).join(', ')}`) : null,
        ),
        h(
          'div',
          { class: 'git-repo-actions' },
          iconBtn('external', 'Openen op GitHub', () => call('app:openExternal', r.url)),
          iconBtn('pencil', 'Naam wijzigen', () => renameRepoFlow(r)),
          iconBtn(r.isPrivate ? 'globe' : 'shield', r.isPrivate ? 'Publiek maken' : 'Privé maken', () => visibilityFlow(r)),
          iconBtn('trash', 'Verwijderen', () => deleteRepoFlow(r), 'danger'),
        ),
      );
      return row;
    }

    openModal(
      h(
        'div',
        {},
        h('h2', {}, 'Mijn GitHub-repo\u2019s'),
        h('p', { class: 'lead' }, 'Beheer je repo\u2019s zonder naar github.com te gaan: openen, koppelen aan een project, hernoemen, privé of publiek maken, en verwijderen (één klik + bevestigen).'),
        notice,
        h('div', { class: 'git-field', style: 'margin-bottom:12px' }, search, btn('Nieuw repo van een map…', 'ghost', () => createRepoFromFolder(), 'plus')),
        listBox,
        h('div', { class: 'modal-actions' }, btn('Vernieuwen', 'ghost', load, 'refresh'), btn('Sluiten', 'primary', closeModal)),
      ),
      'wide',
    );
    load();
  }

  async function deleteRepoFlow(r) {
    const sure = await confirmDialog(
      'Repo verwijderen?',
      `"${r.nameWithOwner}" wordt definitief van GitHub verwijderd, inclusief alle commits en bestanden. Dit kan niet ongedaan gemaakt worden.`,
      'Verwijderen',
      true,
    );
    if (!sure) {
      reposModal();
      return;
    }
    toast(`Verwijderen: ${r.nameWithOwner}…`);
    try {
      const res = await call('git:deleteRepo', r.nameWithOwner);
      if (res.ok) {
        toast(`Verwijderd: ${r.nameWithOwner}`);
        G.repos = null;
        reposModal();
      } else if (res.needsScope) {
        G.scopeNeeded = true;
        toast('GitHub vraagt eerst extra toestemming voor verwijderen.', 'error');
        reposModal();
      } else {
        toast(res.error || 'Verwijderen mislukt', 'error');
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function renameRepoFlow(r) {
    const newName = await promptDialog('Naam van de repo wijzigen', r.name);
    if (!newName || newName === r.name) return;
    try {
      await call('git:renameRepo', r.nameWithOwner, newName.trim());
      toast(`Hernoemd naar ${newName.trim()}`);
      G.repos = null;
      reposModal();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function visibilityFlow(r) {
    const toPrivate = !r.isPrivate;
    const sure = await confirmDialog(
      toPrivate ? 'Repo privé maken?' : 'Repo publiek maken?',
      toPrivate
        ? `"${r.nameWithOwner}" is daarna alleen voor jou zichtbaar.`
        : `"${r.nameWithOwner}" wordt voor iedereen zichtbaar op GitHub. Zet er nooit sleutels in.`,
      toPrivate ? 'Privé maken' : 'Publiek maken',
      !toPrivate,
    );
    if (!sure) {
      reposModal();
      return;
    }
    try {
      await call('git:setVisibility', r.nameWithOwner, toPrivate);
      toast(toPrivate ? 'Repo is nu privé' : 'Repo is nu publiek');
      G.repos = null;
      reposModal();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function createRepoFromFolder() {
    const dir = await call('workspace:pick');
    if (!dir) return;
    toast('Repo aanmaken op GitHub…');
    try {
      const st = await call('git:addProject', dir);
      const proj = (st.projects || []).find((p) => p.path === dir);
      if (!proj) throw new Error('Project niet gevonden.');
      const r = await call('git:createRepo', proj.id);
      if (r.blocked) toast(`Niets gepusht: geheimen gevonden in ${r.secrets.block.map((s) => s.file).join(', ')}`, 'error');
      else toast(`Repo klaar: ${r.url || ''}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    G.repos = null;
    await refresh();
    reposModal();
  }

  async function authRefresh() {
    try {
      await call('git:authRefresh', 'delete_repo');
      toast('Rond de toestemming af in Terminal; daarna kun je hier repo\u2019s verwijderen.');
    } catch (e) {
      toast(e.message, 'error');
    }
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
      const time = new Date(e.ts).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
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
