// AV Calculator UI: team builder, character picker, timeline chart and tables.
(function () {
  const { CDN, esc } = window.HSRTools;
  const { MODES, CHARS, LCS, simulate, panelStats } = window.AVCalc;
  const DATA = window.HSR_DATA;
  const STORE_KEY = 'hsr-tools:av-calculator';
  const EL_NAME = { Thunder: 'Lightning' };
  const PATHS = ['Destruction', 'The Hunt', 'Erudition', 'Harmony', 'Nihility', 'Preservation', 'Abundance', 'Remembrance', 'Elation'];
  const ELEMENTS = ['Physical', 'Fire', 'Ice', 'Thunder', 'Wind', 'Quantum', 'Imaginary'];
  const PATTERNS = ['S', 'B', 'SB', 'SSB', 'BBS', 'BS'];
  const SUMMON_ROW = 30;
  const CHAR_ROW = 64;

  const img = {
    icon: (id) => `${CDN}icon/character/${id}.png`,
    avatar: (id) => `${CDN}icon/avatar/${id}.png`,
    lc: (id) => `${CDN}icon/light_cone/${id}.png`,
    element: (el) => `${CDN}icon/element/${el}.png`,
  };
  const elColor = (el) => `var(--el-${el})`;
  const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);

  const relicSets = DATA.relicSets.filter((r) => !r.planar);
  const planars = DATA.relicSets.filter((r) => r.planar);
  // ⚡ marks gear whose speed / turn-order effect the simulator models.
  const speedy = (r) => !!window.AVEffects.relics[r.id];

  // ---------------------------------------------------------------- state
  function newSlot(charId) {
    return {
      charId, eidolon: 0, lcId: '', lcS: 1, set1: '', set2: 'same', planar: '',
      boots: true, subSpd: 0, extraPct: 0, extraFlat: 0, override: '',
      pattern: 'S', ultMode: 'on', ultFirst: 3, ultEvery: 3, target: null,
    };
  }
  const DEMO = {
    mode: 'moc', showCycles: 5, customFirst: 150, customLen: 100, zoom: 3,
    slots: [
      { ...newSlot('1310'), lcId: '23025', set1: '119', planar: '316', subSpd: 6, ultFirst: 2, ultEvery: 5 },
      { ...newSlot('1303'), set1: '111', planar: '308', subSpd: 12, target: 0 },
      { ...newSlot('8006'), set1: '118', planar: '307', subSpd: 8, ultFirst: 2 },
      { ...newSlot('1222'), set1: '114', planar: '316', subSpd: 6, target: 0 },
    ],
  };

  let state;
  function load() {
    const m = location.hash.match(/[?&]t=([^&]+)/);
    if (m) { try { return JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { /* fall through */ } }
    try { const s = localStorage.getItem(STORE_KEY); if (s) return JSON.parse(s); } catch (e) { /* storage blocked */ }
    return JSON.parse(JSON.stringify(DEMO));
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  function shareLink() {
    const t = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    return `${location.origin}${location.pathname}#/av-calculator?t=${t}`;
  }

  // ---------------------------------------------------------------- layout
  let root;
  function mount(el) {
    root = el;
    state = load();
    state.slots = (state.slots || []).concat([null, null, null, null]).slice(0, 4);
    root.innerHTML = `
      <h1 class="tool-title">AV Calculator</h1>
      <p class="tool-sub">Pick your team, gear and eidolons to see exactly when each character acts.
        Action Value (AV) = 10,000 ÷ SPD. The first cycle of a wave is 150 AV and every cycle after is 100 AV
        (Anomaly Arbitration starts with 300).</p>
      <div class="card mode-bar" id="mode-bar"></div>
      <div class="section">
        <div class="section-head">
          <h2>Team</h2>
          <div style="display:flex;gap:8px">
            <button class="btn ghost" data-action="demo">Load example</button>
            <button class="btn ghost" data-action="clear">Clear team</button>
            <button class="btn" data-action="share">Copy share link</button>
          </div>
        </div>
        <div class="team" id="team"></div>
      </div>
      <div id="results"></div>
      <div class="section card info-card">
        <h3>How the simulation works</h3>
        <ul>
          <li>Each unit's remaining distance on a 10,000-unit track ÷ its current SPD gives the AV until its turn. SPD changes keep the distance, so remaining AV scales by old ÷ new SPD.</li>
          <li>Action advance of X% removes X% of the full track; "acts immediately" sets it to 0.</li>
          <li>Buffs "for N turns" tick at the end of the holder's turn, and the turn they are applied in does not count.</li>
          <li>Ultimates fire right after the listed action (you set the timing, since energy depends on fights). Light cone passives only work on matching Paths.</li>
          <li>Displayed SPD uses 5★ +15 SPD boots (${fmt(window.AVCalc.BOOTS_SPD, 3)}) when enabled. Enemy speed and kills are not simulated.</li>
        </ul>
      </div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    renderModeBar();
    renderTeam();
    renderResults();
  }

  function renderModeBar() {
    const mode = MODES[state.mode] || MODES.moc;
    const bar = root.querySelector('#mode-bar');
    bar.innerHTML = `
      <label class="field mode-select"><span>Game mode</span>
        <select data-g="mode">${Object.entries(MODES).map(([k, m]) =>
          `<option value="${k}"${k === state.mode ? ' selected' : ''}>${m.name}${m.limit ? ` (${m.limit} cycles)` : ''}</option>`).join('')}
        </select></label>
      <label class="field num"><span>Cycles shown</span>
        <input type="number" min="1" max="60" data-g="showCycles" value="${state.showCycles || mode.show}"></label>
      ${state.mode === 'custom' ? `
        <label class="field num"><span>1st cycle AV</span><input type="number" min="1" data-g="customFirst" value="${state.customFirst}"></label>
        <label class="field num"><span>Cycle AV</span><input type="number" min="1" data-g="customLen" value="${state.customLen}"></label>` : ''}
      <div class="mode-note">${esc(mode.note)}</div>`;
  }

  // ---------------------------------------------------------------- team cards
  function renderTeam() {
    const team = root.querySelector('#team');
    team.innerHTML = state.slots.map((s, i) => (s && CHARS[s.charId] ? slotCard(s, i) : emptySlot(i))).join('');
    updateSpeeds();
  }

  const emptySlot = (i) => `
    <div class="card slot slot-empty" data-action="pick" data-slot="${i}">
      <div><span class="plus">+</span>Add character</div>
    </div>`;

  function options(list, value, label = (x) => x.name) {
    return list.map((x) => `<option value="${x.id}"${String(x.id) === String(value) ? ' selected' : ''}>${esc(label(x))}</option>`).join('');
  }

  function slotCard(s, i) {
    const ch = CHARS[s.charId];
    const lcs = DATA.lightCones.filter((l) => l.path === ch.path);
    const lc = LCS[s.lcId];
    const others = state.slots.map((x, j) => ({ x, j })).filter(({ x, j }) => j !== i && x && CHARS[x.charId]);
    const f = (field) => `data-slot="${i}" data-f="${field}"`;
    const stars = '★'.repeat(ch.rarity);
    const relicLabel = (r) => `${speedy(r) ? '⚡ ' : ''}${r.name}`;

    return `
    <div class="card slot" style="--el:${elColor(ch.element)}">
      <div class="slot-hero" data-action="pick" data-slot="${i}" title="Change character">
        <img class="portrait" src="${img.icon(ch.id)}" alt="" loading="lazy">
        <div class="info">
          <div class="name">${esc(ch.name)}</div>
          <div class="meta"><img src="${img.element(ch.element)}" alt="">${EL_NAME[ch.element] || ch.element} · ${esc(ch.path)}</div>
          <div class="stars">${stars}</div>
        </div>
        <div class="spd-badge">
          <div><div class="lbl">SPD</div><b data-spd="${i}">–</b></div>
          <div><div class="lbl">Base AV</div><b data-av="${i}">–</b></div>
        </div>
      </div>
      <button class="slot-remove" data-action="remove" data-slot="${i}" title="Remove">✕</button>
      <div class="slot-body">
        <div class="field"><span>Eidolon</span>
          <div class="pill-group">${[0, 1, 2, 3, 4, 5, 6].map((e) =>
            `<button class="pill${s.eidolon === e ? ' on' : ''}" data-action="set" ${f('eidolon')} data-v="${e}">E${e}</button>`).join('')}</div>
        </div>

        <div class="field"><span>Light cone</span>
          <div class="lc-row">
            <img class="${lc ? '' : 'blank'}" src="${lc ? img.lc(lc.id) : ''}" alt="">
            <select ${f('lcId')}><option value="">None</option>${options(lcs, s.lcId, (l) => `${'★'.repeat(l.rarity)} ${window.AVEffects.lightCones[l.id] ? '⚡ ' : ''}${l.name}`)}</select>
          </div>
          ${lc ? `<div class="pill-group">${[1, 2, 3, 4, 5].map((n) =>
            `<button class="pill${s.lcS === n ? ' on' : ''}" data-action="set" ${f('lcS')} data-v="${n}">S${n}</button>`).join('')}</div>
            <div class="muted small">${esc(lc.skill)}: ${esc(lc.text[(s.lcS || 1) - 1])}</div>` : ''}
        </div>

        <div class="row row-2">
          <label class="field"><span>Relic set</span>
            <select ${f('set1')}><option value="">None</option>${options(relicSets, s.set1, relicLabel)}</select></label>
          <label class="field"><span>2nd set</span>
            <select ${f('set2')}><option value="same"${s.set2 === 'same' ? ' selected' : ''}>4-piece</option>${options(relicSets, s.set2, relicLabel)}</select></label>
        </div>
        <label class="field"><span>Planar ornament</span>
          <select ${f('planar')}><option value="">None</option>${options(planars, s.planar, relicLabel)}</select></label>

        <div class="row row-2" style="align-items:end">
          <label class="check"><input type="checkbox" ${f('boots')} ${s.boots ? 'checked' : ''}> SPD boots</label>
          <label class="field"><span>SPD substats</span><input type="number" step="0.1" min="0" ${f('subSpd')} value="${s.subSpd}"></label>
        </div>

        <div class="row row-3">
          <label class="field"><span>Actions</span>
            <input type="text" list="patterns" ${f('pattern')} value="${esc(s.pattern)}" title="S = Skill, B = Basic ATK. Repeats, e.g. SSB"></label>
          <label class="field"><span>Ult after #</span>
            <input type="number" min="0" ${f('ultFirst')} value="${s.ultFirst}" ${s.ultMode === 'never' ? 'disabled' : ''} title="0 = at battle start"></label>
          <label class="field"><span>Then every</span>
            <input type="number" min="1" ${f('ultEvery')} value="${s.ultEvery}" ${s.ultMode === 'never' ? 'disabled' : ''}></label>
        </div>
        <label class="check"><input type="checkbox" ${f('ultNever')} ${s.ultMode === 'never' ? 'checked' : ''}> Never use Ultimate</label>

        ${others.length ? `<label class="field"><span>Ability target (Skill / Ult buffs)</span>
          <select ${f('target')}>${others.map(({ x, j }) =>
            `<option value="${j}"${+s.target === j ? ' selected' : ''}>${esc(CHARS[x.charId].name)}</option>`).join('')}</select></label>` : ''}

        <details class="more"><summary>Manual SPD adjustments</summary>
          <div class="row row-3">
            <label class="field"><span>Extra SPD %</span><input type="number" step="0.1" ${f('extraPct')} value="${s.extraPct}"></label>
            <label class="field"><span>Extra flat</span><input type="number" step="0.1" ${f('extraFlat')} value="${s.extraFlat}"></label>
            <label class="field"><span>Final SPD</span><input type="number" step="0.1" ${f('override')} value="${s.override}" placeholder="auto"></label>
          </div>
          <div class="muted small" style="margin-top:6px">"Final SPD" overrides the character-screen value (e.g. copy it from your game). Base ${ch.spd} + traces ${ch.traceSpd}.</div>
        </details>

        <details class="more"><summary>Simulated effects</summary><div data-effects="${i}"></div></details>
        <details class="more"><summary>Eidolons &amp; kit speed text</summary>${kitText(ch, s)}</details>
      </div>
    </div>`;
  }

  function kitText(ch, s) {
    const e = ch.eidolons.map((x) => `
      <div class="e${x.rank <= s.eidolon ? ' active' : ''}${x.speed ? ' speed' : ''}">
        <b>E${x.rank} ${esc(x.name)}</b>${x.speed ? ' <span class="tag">⚡ speed</span>' : ''}<br>${esc(x.text)}</div>`).join('');
    const n = ch.notes.map((x) => `<div class="e speed"><b>${esc(x.src)}: ${esc(x.name)}</b><br>${esc(x.text)}</div>`).join('');
    return `<div class="eido-list">${n}${e}</div>`;
  }

  function updateSpeeds() {
    state.slots.forEach((s, i) => {
      if (!s || !CHARS[s.charId]) return;
      const st = panelStats(s);
      const spdEl = root.querySelector(`[data-spd="${i}"]`);
      if (spdEl) spdEl.textContent = fmt(st.panel, 1);
      const avEl = root.querySelector(`[data-av="${i}"]`);
      if (avEl) avEl.textContent = fmt(10000 / st.panel, 1);
      const effEl = root.querySelector(`[data-effects="${i}"]`);
      if (effEl) {
        const lc = LCS[s.lcId];
        const pathWarn = lc && lc.path !== st.ch.path ? `<div class="warn">Light cone Path doesn't match; passive inactive.</div>` : '';
        effEl.innerHTML = pathWarn + (st.effects.length
          ? `<ul class="sim-list">${st.effects.map((e) => `<li><b>${esc(e.label)}</b>: ${esc(e.desc || '')}</li>`).join('')}</ul>`
          : '<div class="muted small">No speed or turn-order effects are simulated for this setup yet. Use Manual SPD adjustments for anything missing.</div>');
      }
    });
  }

  // ---------------------------------------------------------------- events
  function onClick(ev) {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const i = +t.dataset.slot;
    switch (t.dataset.action) {
      case 'pick': openPicker(i); break;
      case 'remove':
        ev.stopPropagation();
        state.slots[i] = null;
        state.slots.forEach((s) => { if (s && +s.target === i) s.target = null; });
        changed(true);
        break;
      case 'set': {
        const v = +t.dataset.v;
        state.slots[i][t.dataset.f] = v;
        changed(true);
        break;
      }
      case 'demo': state = JSON.parse(JSON.stringify(DEMO)); renderModeBar(); changed(true); break;
      case 'clear': state.slots = [null, null, null, null]; changed(true); break;
      case 'share': {
        const link = shareLink();
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
          .then(() => { t.textContent = 'Link copied!'; }, () => { prompt('Copy this link:', link); })
          .finally(() => setTimeout(() => { t.textContent = 'Copy share link'; }, 1600));
        break;
      }
      default:
    }
  }

  const STRUCTURAL = new Set(['lcId', 'ultNever', 'set1', 'set2', 'planar']);
  function onInput(ev) {
    const t = ev.target;
    if (t.dataset.g) {
      const v = t.type === 'number' ? t.value : t.value;
      state[t.dataset.g] = t.type === 'number' ? (v === '' ? '' : +v) : v;
      if (t.dataset.g === 'mode') { state.showCycles = MODES[v].show; renderModeBar(); }
      changed(false);
      return;
    }
    if (t.dataset.zoom !== undefined) { state.zoom = +t.value; renderTimelineOnly(); save(); return; }
    if (t.dataset.f === undefined) return;
    const s = state.slots[+t.dataset.slot];
    const f = t.dataset.f;
    if (f === 'boots') s.boots = t.checked;
    else if (f === 'ultNever') s.ultMode = t.checked ? 'never' : 'on';
    else if (f === 'target') s.target = +t.value;
    else if (t.type === 'number') s[f] = t.value === '' ? (f === 'override' ? '' : 0) : +t.value;
    else s[f] = t.value;
    // Re-render the cards only when their layout depends on the value (and never mid-typing).
    changed(STRUCTURAL.has(f) && ev.type === 'change');
  }

  function changed(rerenderTeam) {
    // Default the ability target to the first other character.
    state.slots.forEach((s, i) => {
      if (!s) return;
      const valid = s.target != null && state.slots[s.target] && +s.target !== i;
      if (!valid) { const j = state.slots.findIndex((x, k) => x && k !== i); s.target = j >= 0 ? j : null; }
    });
    if (rerenderTeam) renderTeam(); else updateSpeeds();
    renderResults();
    save();
    if (/[?&]t=/.test(location.hash)) history.replaceState(null, '', '#/av-calculator');
  }

  // ---------------------------------------------------------------- picker
  function openPicker(slotIdx) {
    const modal = document.getElementById('modal');
    const filt = { q: '', path: '', el: '' };
    const taken = new Set(state.slots.filter((s, j) => s && j !== slotIdx).map((s) => s.charId));
    modal.hidden = false;
    modal.innerHTML = `
      <div class="card modal-box" role="dialog" aria-label="Choose a character">
        <div class="modal-head">
          <div class="top"><h3>Choose a character</h3><button class="btn ghost" data-close>Close</button></div>
          <input type="search" placeholder="Search…" data-q>
          <div class="filters" data-els>${ELEMENTS.map((e) => `<button class="pill" data-el="${e}" title="${EL_NAME[e] || e}"><img src="${img.element(e)}" alt=""> ${EL_NAME[e] || e}</button>`).join('')}</div>
          <div class="filters" data-paths>${PATHS.map((p) => `<button class="pill" data-path="${p}">${p}</button>`).join('')}</div>
        </div>
        <div class="picker-grid" data-grid></div>
      </div>`;
    const grid = modal.querySelector('[data-grid]');
    const draw = () => {
      const q = filt.q.toLowerCase();
      const list = DATA.characters.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!filt.path || c.path === filt.path) && (!filt.el || c.element === filt.el));
      grid.innerHTML = list.map((c) => `
        <button class="pick r${c.rarity}${taken.has(c.id) ? ' taken' : ''}" style="--el:${elColor(c.element)}" data-pick="${c.id}" title="${esc(c.name)} · ${c.path}">
          <img src="${img.icon(c.id)}" alt="" loading="lazy"><img class="el" src="${img.element(c.element)}" alt="">
          <div class="nm">${esc(c.name)}</div>
        </button>`).join('') || '<div class="muted">No matches.</div>';
    };
    const close = () => { modal.hidden = true; modal.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal.onclick = (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) return close();
      const el = e.target.closest('[data-el]');
      if (el) { filt.el = filt.el === el.dataset.el ? '' : el.dataset.el; modal.querySelectorAll('[data-el]').forEach((b) => b.classList.toggle('on', b.dataset.el === filt.el)); return draw(); }
      const p = e.target.closest('[data-path]');
      if (p) { filt.path = filt.path === p.dataset.path ? '' : p.dataset.path; modal.querySelectorAll('[data-path]').forEach((b) => b.classList.toggle('on', b.dataset.path === filt.path)); return draw(); }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const prev = state.slots[slotIdx];
        const s = newSlot(pick.dataset.pick);
        if (prev) Object.assign(s, { boots: prev.boots, subSpd: prev.subSpd });
        state.slots[slotIdx] = s;
        close();
        changed(true);
      }
    };
    const q = modal.querySelector('[data-q]');
    q.oninput = () => { filt.q = q.value; draw(); };
    draw();
    setTimeout(() => q.focus(), 0);
  }

  // ---------------------------------------------------------------- results
  let lastResult = null;
  function renderResults() {
    const out = root.querySelector('#results');
    const any = state.slots.some((s) => s && CHARS[s.charId]);
    if (!any) {
      lastResult = null;
      out.innerHTML = '<div class="section card empty-state">Add a character to see their action timeline.</div>';
      return;
    }
    const r = simulate(state);
    lastResult = r;
    out.innerHTML = `
      <div class="section">
        <div class="section-head"><h2>Summary</h2><span class="muted small">${esc(r.mode.name)} · ${r.cycles} cycle${r.cycles > 1 ? 's' : ''} · ${fmt(r.maxAV, 0)} AV</span></div>
        <div class="results-grid">${summaryCards(r)}</div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Timeline</h2></div>
        <div class="card timeline-card">
          <div class="timeline-tools">
            <label class="check">Zoom <input type="range" min="1.2" max="10" step="0.2" data-zoom value="${state.zoom || 3}"></label>
            <div class="legend">
              <span><i style="background:var(--gold)"></i>Ultimate</span>
              <span><i style="background:var(--accent)"></i>Extra turn</span>
              <span><i style="background:#8891b5"></i>Summon / countdown</span>
            </div>
          </div>
          <div class="timeline-scroll" id="timeline"></div>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><h2>AV per action</h2><span class="muted small">Cumulative AV when each action happens</span></div>
        <div class="card table-wrap">${actionTable(r)}</div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Action order</h2></div>
        <div class="card order-list">${orderList(r)}</div>
      </div>`;
    renderTimelineOnly();
  }

  function summaryCards(r) {
    return r.units.map(({ unit, stats }) => {
      const acts = r.events.filter((e) => e.unit === unit && e.kind === 'char' && e.type !== 'Ultimate');
      const firstAv = acts.length ? fmt(acts[0].av) : '–';
      const c0 = acts.filter((e) => e.cycle === 0).length;
      return `
        <div class="card sum-card" style="--el:${elColor(stats.ch.element)}">
          <img src="${img.avatar(stats.ch.id)}" alt="">
          <div>
            <div class="nm">${esc(stats.ch.name)}</div>
            <div class="kv"><span>SPD <b>${fmt(stats.panel)}</b></span><span>Base AV <b>${fmt(10000 / stats.panel)}</b></span></div>
            <div class="kv"><span>1st action <b>${firstAv}</b></span><span>Cycle 0 <b>${c0}</b></span><span>Total <b>${acts.length}</b></span></div>
          </div>
        </div>`;
    }).join('');
  }

  function actionTable(r) {
    const cols = r.units.map(({ unit, stats }) => ({
      unit, ch: stats.ch,
      acts: r.events.filter((e) => e.unit === unit && e.type !== 'Ultimate'),
      ults: r.events.filter((e) => e.unit === unit && e.type === 'Ultimate'),
    }));
    const rows = Math.max(0, ...cols.map((c) => c.acts.length));
    if (!rows) return '<div class="empty-state">No actions inside the shown cycles.</div>';
    let html = `<table class="av-table"><thead><tr><th>Action</th>${cols.map((c) =>
      `<th><span class="th-char"><img src="${img.avatar(c.ch.id)}" alt="">${esc(c.ch.name)}</span></th>`).join('')}</tr></thead><tbody>`;
    for (let k = 0; k < rows; k++) {
      html += `<tr><td class="num">${ordinal(k + 1)}</td>${cols.map((c) => {
        const e = c.acts[k];
        if (!e) return '<td></td>';
        const ult = c.ults.some((u) => u.n === e.n && Math.abs(u.av - e.av) < 1e-6);
        return `<td>${fmt(e.av)}<span class="cyc">C${e.cycle}</span>${e.type === 'Extra' ? '<span class="ex">extra</span>' : ''}${ult ? '<span class="ult">★ ult</span>' : ''}</td>`;
      }).join('')}</tr>`;
    }
    return html + '</tbody></table>';
  }
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

  function orderList(r) {
    let cyc = -1, html = '';
    for (const e of r.events) {
      if (e.cycle !== cyc) { cyc = e.cycle; html += `<div class="order-cycle">Cycle ${cyc}</div>`; }
      const iconId = e.unit.icon;
      const label = e.kind === 'char' ? (e.type === 'Ultimate' ? 'Ult' : `#${e.n}${e.type === 'Extra' ? ' extra' : ''}`) : esc(e.unit.name);
      html += `<span class="order-item${e.kind !== 'char' ? ' summon' : ''}${e.type === 'Ultimate' ? ' ultimate' : ''}">
        <img src="${img.avatar(iconId)}" alt="">${e.kind === 'char' ? esc(shortName(e.unit.name)) : ''} ${label} <span class="av">${fmt(e.av)}</span></span>`;
    }
    return html;
  }
  const shortName = (n) => n.split(' • ')[0];

  // ---------------------------------------------------------------- timeline svg
  function renderTimelineOnly() {
    const host = root.querySelector('#timeline');
    if (!host || !lastResult) return;
    host.innerHTML = timelineSvg(lastResult, state.zoom || 3);
    bindTooltips(host);
  }

  function timelineSvg(r, scale) {
    const GUT = 150, TOP = 34, PADR = 30;
    // Lanes: each character, followed by its summons / countdowns.
    const lanes = [];
    for (const { unit, stats } of r.units) {
      lanes.push({ key: unit.key, unit, ch: stats.ch, h: CHAR_ROW, main: true });
      const subs = [...new Map(r.events.filter((e) => e.kind !== 'char' && e.owner === unit.key).map((e) => [e.lane, e])).values()];
      for (const s of subs) lanes.push({ key: s.lane, unit: s.unit, ch: stats.ch, h: SUMMON_ROW, main: false });
    }
    let y = TOP;
    lanes.forEach((l) => { l.y = y; y += l.h; });
    const H = y + 24;
    const W = GUT + r.maxAV * scale + PADR;
    const X = (av) => GUT + av * scale;
    const laneOf = new Map(lanes.map((l) => [l.key, l]));
    const parts = [];

    parts.push(`<defs>${r.units.map(({ stats }) => `<clipPath id="clip-${stats.ch.id}"><circle r="15" cx="0" cy="0"/></clipPath>`).join('')}</defs>`);

    // Cycle bands
    for (let c = 0; c < r.cycles; c++) {
      const a = c === 0 ? 0 : r.first + (c - 1) * r.len;
      const b = c === 0 ? r.first : a + r.len;
      parts.push(`<rect x="${X(a)}" y="${TOP - 26}" width="${(b - a) * scale}" height="${H - TOP + 26}" fill="${c % 2 ? 'rgba(255,255,255,.025)' : 'rgba(122,167,255,.05)'}"/>`);
      parts.push(`<line x1="${X(b)}" x2="${X(b)}" y1="${TOP - 26}" y2="${H - 18}" stroke="rgba(231,194,125,.45)" stroke-dasharray="4 4"/>`);
      parts.push(`<text x="${X(a) + 6}" y="${TOP - 12}" fill="#f5dca7" font-size="12" font-weight="700">Cycle ${c}</text>`);
      parts.push(`<text x="${X(b) - 4}" y="${TOP - 12}" fill="#9aa3c2" font-size="10" text-anchor="end">${fmt(b, 0)}</text>`);
    }
    // AV ticks
    const step = scale >= 5 ? 10 : scale >= 2.5 ? 25 : 50;
    for (let av = 0; av <= r.maxAV + 1e-6; av += step) {
      parts.push(`<line x1="${X(av)}" x2="${X(av)}" y1="${TOP}" y2="${H - 18}" stroke="rgba(255,255,255,.05)"/>`);
      parts.push(`<text x="${X(av)}" y="${H - 4}" fill="#6f789a" font-size="10" text-anchor="middle">${av}</text>`);
    }
    // Lane backgrounds + labels
    for (const l of lanes) {
      parts.push(`<line x1="0" x2="${W}" y1="${l.y + l.h}" y2="${l.y + l.h}" stroke="rgba(42,52,88,.8)"/>`);
      if (l.main) {
        parts.push(`<g transform="translate(24,${l.y + l.h / 2})"><circle r="17" fill="${elColor(l.ch.element)}"/><image href="${img.avatar(l.ch.id)}" x="-15" y="-15" width="30" height="30" clip-path="url(#clip-${l.ch.id})"/></g>`);
        parts.push(`<text x="48" y="${l.y + l.h / 2 + 4}" fill="#e7e9f3" font-size="13" font-weight="600">${esc(truncate(l.ch.name, 15))}</text>`);
      } else {
        parts.push(`<text x="48" y="${l.y + l.h / 2 + 4}" fill="#9aa3c2" font-size="11">↳ ${esc(l.unit.name)}</text>`);
      }
    }
    // Events
    const stackAt = new Map();
    for (const e of r.events) {
      const l = laneOf.get(e.lane);
      if (!l) continue;
      const cx = X(e.av), cy = l.y + l.h / 2;
      const tip = `${esc(e.unit.name)}<br>${e.type === 'Ultimate' ? '<b>Ultimate</b>' : e.kind === 'countdown' ? 'Countdown ends' : `<b>Action ${e.n ?? ''}</b> (${e.type})`}<br>AV <b>${fmt(e.av, 2)}</b> · Cycle ${e.cycle}${e.kind !== 'countdown' ? `<br>SPD ${fmt(e.spd, 1)}` : ''}`;
      if (e.kind === 'char' && e.type === 'Ultimate') {
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx},${cy - 22})"><rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" fill="#e7c27d" stroke="#0b0f1d" stroke-width="1.5"/></g>`);
      } else if (e.kind === 'char') {
        const k = `${e.lane}@${fmt(e.av, 3)}`;
        const dup = stackAt.get(k) || 0;
        stackAt.set(k, dup + 1);
        const ox = dup * 10;
        const ring = e.type === 'Extra' ? '#7aa7ff' : elColor(l.ch.element);
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx + ox},${cy})" style="cursor:default">
          <circle r="17" fill="#0b0f1d" stroke="${ring}" stroke-width="2.5"/>
          <image href="${img.avatar(l.ch.id)}" x="-15" y="-15" width="30" height="30" clip-path="url(#clip-${l.ch.id})"/>
          <g transform="translate(12,12)"><circle r="8" fill="#e7c27d"/><text y="3.5" text-anchor="middle" font-size="10" font-weight="700" fill="#1a1406">${e.n}</text></g>
        </g>`);
      } else if (e.kind === 'countdown') {
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx},${cy})"><path d="M-6,-8 H6 L-6,8 H6 Z" fill="none" stroke="#b9c0dc" stroke-width="1.6"/></g>`);
      } else {
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx},${cy})"><circle r="9" fill="#2a3458" stroke="#8891b5"/><text y="3.5" text-anchor="middle" font-size="9" font-weight="700" fill="#e7e9f3">${e.n}</text></g>`);
      }
    }
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Action timeline">${parts.join('')}</svg>`;
  }
  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const attr = (s) => s.replace(/"/g, '&quot;');

  function bindTooltips(host) {
    const tip = document.getElementById('tooltip');
    host.onmousemove = (e) => {
      const g = e.target.closest('[data-tip]');
      if (!g) { tip.hidden = true; return; }
      tip.innerHTML = g.getAttribute('data-tip');
      tip.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = `${x}px`;
      tip.style.top = `${e.clientY + 14}px`;
    };
    host.onmouseleave = () => { tip.hidden = true; };
  }

  // Suggestions for the action pattern field.
  const dl = document.createElement('datalist');
  dl.id = 'patterns';
  dl.innerHTML = PATTERNS.map((p) => `<option value="${p}">`).join('');
  document.body.appendChild(dl);

  window.HSRTools.register({ id: 'av-calculator', title: 'AV Calculator', mount });
})();
