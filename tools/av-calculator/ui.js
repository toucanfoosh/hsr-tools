// AV Calculator UI: team builder, character picker, timeline chart and tables.
(function () {
  const { CDN, esc } = window.HSRTools;
  const { MODES, CHARS, LCS, RELICS, simulate, panelStats } = window.AVCalc;
  const Account = window.HSRAccount;
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
    // Small round portraits use the game's chibi stickers (see scripts/build_data.py),
    // falling back to the regular avatar for characters without one.
    avatar: (id) => (CHARS[id] && CHARS[id].chibi ? `assets/chibi/${id}.png` : `${CDN}icon/avatar/${id}.png`),
    lc: (id) => `assets/light-cones/icon/${id}.png`,
    relic: (id) => `assets/relics/${id}.png`,
    element: (el) => `${CDN}icon/element/${el}.png`,
  };
  const elColor = (el) => `var(--el-${el})`;
  // A character's turn-order kit (effects.js) and energy kit (kits-energy.js) together.
  function kitFor(id) {
    const a = window.AVEffects.kits[id] || {}, b = (window.AVEnergyKits || {})[id] || {};
    return {
      targetLabel: a.targetLabel || b.targetLabel, advance: a.advance, allyTarget: a.allyTarget || b.allyTarget,
      autoUlt: a.autoUlt || b.autoUlt, options: [...(a.options || []), ...(b.options || [])],
    };
  }
  const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);

  const relicSets = DATA.relicSets.filter((r) => !r.planar);
  const planars = DATA.relicSets.filter((r) => r.planar);
  // Each character's signature light cone gets pinned and highlighted in the picker.
  const signatureOf = (charId) => (CHARS[charId] && CHARS[charId].signature) || null;

  // ---------------------------------------------------------------- state
  // 4★ characters and every Trailblazer are easy to max, so they start at E6.
  const defaultEidolon = (charId) => {
    const ch = CHARS[charId];
    return ch && (ch.rarity === 4 || ch.name.startsWith('Trailblazer')) ? 6 : 0;
  };
  function newSlot(charId) {
    return {
      charId, eidolon: defaultEidolon(charId), lcId: '', lcS: 1, set1: '', set2: 'same', planar: '',
      spd: '', spdAuto: true, boots: true, subSpd: 0, extraPct: 0, extraFlat: 0, override: '',
      pattern: 'S', ultMode: 'on', ultFirst: 3, ultEvery: 3, target: null,
    };
  }
  // Gear, eidolon and SPD straight from the loaded account (Reliquary Archiver).
  const ACCOUNT_FIELDS = ['eidolon', 'lcId', 'lcS', 'set1', 'set2', 'planar', 'boots', 'bootsSpd', 'subSpd', 'spd', 'errRope', 'errRopeValue', 'relicStats'];
  function applyAccount(slot) {
    const acc = Account.buildFor(slot.charId);
    if (!acc) return false;
    for (const k of ACCOUNT_FIELDS) if (k !== 'spd') slot[k] = acc[k];
    // Exact character-screen SPD from the imported boots, substats, sets and light cone.
    slot.spd = round3(panelStats({ ...slot, spd: '', spdAuto: true, override: '' }).panel);
    slot.spdAuto = false;
    slot.fromAccount = true;
    return true;
  }
  // Teams saved before the single Speed field: keep their SPD (boots / substats / Final SPD),
  // and drop the removed "Never use Ultimate" and manual adjustment options.
  function migrateSlot(s) {
    if (!s || !CHARS[s.charId]) return;
    if (s.ultMode === 'never') s.ultMode = 'on';
    if (s.spdAuto === undefined) {
      const legacy = +s.override > 0 || +s.subSpd > 0 || !s.boots || +s.extraPct || +s.extraFlat;
      s.spd = legacy ? Math.round(panelStats({ ...s, spd: '', spdAuto: true }).panel * 1000) / 1000 : '';
      s.spdAuto = !legacy;
    }
    s.override = ''; s.extraPct = 0; s.extraFlat = 0;
  }
  function slotFor(charId) {
    const s = newSlot(charId);
    applyAccount(s);
    return s;
  }
  const DEMO = {
    mode: 'std', showCycles: 4, customFirst: 150, customLen: 100, zoom: 3,
    slots: [
      { ...newSlot('1310'), lcId: '23025', set1: '119', planar: '316', spd: 146.3, spdAuto: false, ultFirst: 2, ultEvery: 5 },
      { ...newSlot('1303'), set1: '111', planar: '308', spd: 146, spdAuto: false, target: 0 },
      { ...newSlot('8006'), set1: '118', planar: '307', spd: 138, spdAuto: false, ultFirst: 2 },
      { ...newSlot('1222'), set1: '114', planar: '316', spd: 140.8, spdAuto: false, target: 0 },
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
    state.slots.forEach(migrateSlot);
    if (!MODES[state.mode]) { // saved before the modes were merged (MoC / PF / AS / SU)
      state.mode = 'std';
      state.showCycles = 4;
    }
    root.innerHTML = `
      <h1 class="tool-title">AV Calculator</h1>
      <p class="tool-sub">See when each character acts, turn by turn.</p>
      <div class="card mode-bar" id="mode-bar"></div>
      <div class="section">
        <div class="section-head">
          <h2>Team</h2>
          <div class="head-actions">
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
          <li><b>Turns</b>: each unit's AV until its turn = remaining distance (10,000 per turn) ÷ SPD. A SPD change keeps the distance; X% action advance removes X% of 10,000.</li>
          <li><b>Buffs</b> lasting "N turns" count down at the end of the holder's turn; the turn they're applied in doesn't count.</li>
          <li><b>Energy</b>: characters start at 50%. Basic ATK / Skill / Ultimate / Elation Skill Energy comes from the game data, scaled by Energy Regeneration Rate; kits add their own gains (on ally attacks, turn start, follow-ups, Energy given by allies...). Ultimates fire as soon as Energy is full, unless held for a target or set to a manual schedule.</li>
          <li><b>Skill Points</b>: the team starts with 3 (max 5 plus kit bonuses). A Skill the team can't pay for becomes a Basic ATK.</li>
          <li><b>Enemies</b> act at their own SPD; each turn hits your team (spread by taunt) for 10 Energy per hit and triggers counters and "when hit" effects. At 0 Toughness they are Weakness Broken.</li>
          <li><b>Elation</b>: the team's Punchline summons Aha (SPD 80 + the Elation characters' SPD /5, /10, /20, /40). Each Aha Instant runs every Elation Skill in Participant ID order, then converts the Punchline into Certified Banger (2 turns) and resets it.</li>
          <li><b>Damage</b> is an estimate (average CRIT) from the abilities' multipliers, your stats and modeled buffs; see the note in the Damage section. Each character's Speed is their character-screen SPD: exact from your account, otherwise an estimate with 5★ +15 SPD boots (${fmt(window.AVCalc.BOOTS_SPD, 3)}). Kills are not simulated.</li>
        </ul>
      </div>`;
    root.addEventListener('click', onClick);
    // Hover / focus text for the eye icons, drawn in the page-level tooltip so cards can't clip it.
    const showInfo = (ev) => {
      const icon = ev.target.closest && ev.target.closest('[data-info]');
      const tip = document.getElementById('tooltip');
      if (!icon) { if (tip.classList.contains('info')) { tip.hidden = true; tip.classList.remove('info'); } return; }
      tip.textContent = icon.dataset.info;
      tip.classList.add('info');
      tip.hidden = false;
      const r = icon.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(r.left - 20, window.innerWidth - tip.offsetWidth - 8))}px`;
      tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
    };
    root.addEventListener('mouseover', showInfo);
    root.addEventListener('focusin', showInfo);
    root.addEventListener('focusout', showInfo);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    renderModeBar();
    renderTeam();
    renderResults();
    let lastSeen = null;
    Account.onChange(() => {
      const stamp = Account.data ? Account.data.updatedAt : 0;
      if (stamp === lastSeen) return;
      lastSeen = stamp;
      // Cards that mirror the account follow live gear changes.
      state.slots.forEach((sl) => { if (sl && sl.fromAccount) applyAccount(sl); });
      if (!root.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') { renderTeam(); renderResults(); save(); }
    });
  }

  function renderModeBar() {
    const bar = root.querySelector('#mode-bar');
    bar.innerHTML = `
      <label class="field mode-select"><span>Game mode</span>
        <select data-g="mode">${Object.entries(MODES).map(([k, m]) =>
          `<option value="${k}"${k === state.mode ? ' selected' : ''}>${m.name}</option>`).join('')}
        </select></label>
      <label class="field num"><span>Cycles shown</span>
        <input type="number" min="1" max="60" data-g="showCycles" value="${state.showCycles || 4}"></label>
      <label class="field num"><span class="label-row">Enemies ${infoIcon('Enemies take turns on the timeline. Each enemy turn hits your team (spread by taunt), giving 10 Energy per hit and triggering counters. The count also sets how many targets AoE / Blast abilities hit.')}</span>
        <input type="number" min="0" max="5" data-g="enemies" value="${state.enemies == null ? 2 : state.enemies}"></label>
      <label class="field num"><span>Enemy SPD</span>
        <input type="number" min="1" max="500" data-g="enemySpd" value="${state.enemySpd || 120}"></label>
      <label class="field num"><span>Hits / turn</span>
        <input type="number" min="0" max="5" data-g="enemyHits" value="${state.enemyHits == null ? 1 : state.enemyHits}"></label>
      <label class="field num"><span class="label-row">Toughness ${infoIcon('Each enemy\'s Toughness (enemies are assumed weak to your team). At 0 they are Weakness Broken: Break DMG, their action is delayed, they take full DMG and Super Break applies until their next turn.')}</span>
        <input type="number" min="10" max="2000" data-g="enemyToughness" value="${state.enemyToughness || 160}"></label>
      <label class="field num"><span>Enemy Lv</span>
        <input type="number" min="1" max="120" data-g="enemyLevel" value="${state.enemyLevel || 95}"></label>
      <label class="field num"><span class="label-row">Enemy RES % ${infoIcon('The enemies\' RES to your damage types. 20% is the default for most enemies; 0% if they are weak to your damage type.')}</span>
        <input type="number" min="-100" max="100" data-g="enemyRes" value="${state.enemyRes == null ? 20 : state.enemyRes}"></label>
      ${state.mode === 'custom' ? `
        <label class="field num"><span>1st cycle AV</span><input type="number" min="1" data-g="customFirst" value="${state.customFirst}"></label>
        <label class="field num"><span>Cycle AV</span><input type="number" min="1" data-g="customLen" value="${state.customLen}"></label>` : ''}`;
  }

  // ---------------------------------------------------------------- team cards
  let startEnergy = {};
  function renderTeam() {
    const team = root.querySelector('#team');
    // Energy each character has once battle-start effects resolve (for the battle-start Ult option).
    startEnergy = {};
    try {
      const r0 = simulate(state);
      r0.units.forEach(({ unit, slot }) => { startEnergy[slot] = { have: unit.startEnergy, max: unit.maxEnergy }; });
    } catch (e) { /* the results section reports errors */ }
    team.innerHTML = state.slots.map((s, i) => (s && CHARS[s.charId] ? slotCard(s, i) : emptySlot(i))).join('');
    updateSpeeds();
  }

  const emptySlot = (i) => `
    <div class="card slot slot-empty" data-action="pick" data-slot="${i}">
      <div><span class="plus">+</span>Add character</div>
    </div>`;

  // A relic set / planar slot as an icon tile (name and effects on hover and in the picker).
  function relicTile(i, kind, id, tag) {
    const r = id && RELICS[id];
    const tip = r ? `${r.name}\n${r.text.map((t, k) => (r.planar ? t : `${k ? '4pc' : '2pc'}: ${t}`)).join('\n')}` : '';
    return `<button type="button" class="relic-tile${r ? '' : ' empty'}" data-action="gear" data-kind="${kind}" data-slot="${i}"
      ${r ? `data-info="${attr(esc(tip))}"` : `title="Choose ${kind === 'planar' ? 'a planar ornament' : kind === 'set2' ? 'a 2nd set (2-piece)' : 'a relic set'}"`}>
      ${r ? `<img src="${img.relic(id)}" alt="${attr(esc(r.name))}">` : '<span class="plus">+</span>'}
      <span class="rt-tag">${tag}</span>
    </button>`;
  }

  // A gear slot shown as a button with its icon; opens the searchable gear picker.
  function gearButton(i, kind, src, name, sub, signature) {
    return `<button type="button" class="gear-btn" data-action="gear" data-kind="${kind}" data-slot="${i}">
      ${thumb(src)}
      <span class="gear-txt"><span class="gear-name">${esc(name)}</span>
        <span class="gear-sub">${esc(sub)}${signature ? ' <span class="badge sig">Signature</span>' : ''}</span></span>
      <span class="chev" aria-hidden="true">›</span>
    </button>`;
  }

  function slotCard(s, i) {
    const ch = CHARS[s.charId];
    const lc = LCS[s.lcId];
    const others = state.slots.map((x, j) => ({ x, j })).filter(({ x, j }) => j !== i && x && CHARS[x.charId]);
    const f = (field) => `data-slot="${i}" data-f="${field}"`;
    const stars = '★'.repeat(ch.rarity);

    return `
    <div class="card slot" style="--el:${elColor(ch.element)}">
      <div class="slot-hero" data-action="pick" data-slot="${i}" title="Change character">
        <img class="portrait" src="${img.icon(ch.id)}" alt="" loading="lazy">
        <div class="info">
          <div class="name">${esc(ch.name)}</div>
          <div class="meta"><img src="${img.element(ch.element)}" alt="">${EL_NAME[ch.element] || ch.element} · ${esc(ch.path)}</div>
          <div class="stars">${stars}</div>
        </div>
        ${Account.character(ch.id) ? `<button class="acct-badge${s.fromAccount ? ' synced' : ''}" data-action="sync" data-slot="${i}" title="${s.fromAccount ? 'Using your account build. Click to reload it.' : 'Load eidolon, gear and SPD from your account'}">${s.fromAccount ? 'Your build' : 'Load my build'}</button>` : ''}
      </div>
      <button class="slot-remove" data-action="remove" data-slot="${i}" title="Remove">✕</button>
      <div class="slot-body">
        <div class="field"><span>Eidolon</span>
          <div class="pill-group">${[0, 1, 2, 3, 4, 5, 6].map((e) =>
            `<button class="pill${s.eidolon === e ? ' on' : ''}" data-action="set" ${f('eidolon')} data-v="${e}">E${e}</button>`).join('')}</div>
        </div>

        <div class="field"><span>Light cone</span>
          ${gearButton(i, 'lc', lc && img.lc(lc.id), lc ? lc.name : 'No light cone',
            lc ? `${'★'.repeat(lc.rarity)} · ${lc.path}${lc.path !== ch.path ? ' · wrong Path' : ''}` : 'Tap to choose')}
          ${lc ? `<div class="pill-group">${[1, 2, 3, 4, 5].map((n) =>
            `<button class="pill${s.lcS === n ? ' on' : ''}" data-action="set" ${f('lcS')} data-v="${n}">S${n}</button>`).join('')}</div>
` : ''}
        </div>

        <div class="field"><span>Relics &amp; planar</span>
          <div class="relic-tiles">
            ${relicTile(i, 'set1', s.set1, s.set1 ? (s.set2 === 'same' ? '4pc' : '2pc') : 'Set')}
            ${s.set1 ? relicTile(i, 'set2', s.set2 !== 'same' && s.set2, s.set2 === 'same' ? '+2pc' : '2pc') : ''}
            ${relicTile(i, 'planar', s.planar, 'Planar')}
          </div>
        </div>

        ${spdField(s, ch, i, f)}

        ${kitOptions(s, ch, f, i)}
        ${ultField(s, ch, i, f)}

        ${others.length ? targetField(s, ch, others, f) : ''}

        ${statsPanel(s, ch, i)}
        <details class="more"><summary>Simulated effects</summary><div data-effects="${i}"></div></details>
      </div>
    </div>`;
  }

  // One number: the SPD on the character screen. From the archiver it's the exact value;
  // otherwise it follows an estimate (base + traces + 5★ SPD boots + gear) until edited.
  const round3 = (n) => Math.round(n * 1000) / 1000;
  const { MAX_SPD } = window.AVCalc;
  const clampSpd = (n) => Math.min(MAX_SPD, Math.max(1, n || 1));
  const estimateSpd = (s) => panelStats({ ...s, spd: '', spdAuto: true, override: '', subSpd: 0, boots: true, bootsSpd: undefined, extraPct: 0, extraFlat: 0 }).panel;
  function spdField(s, ch, i, f) {
    const value = s.spdAuto ? Math.round(estimateSpd(s) * 10) / 10 : s.spd;
    const note = s.fromAccount ? 'From your account'
      : s.spdAuto ? 'Estimate with 5★ SPD boots and no SPD substats. Type your in-game SPD.'
        : 'Your value';
    const info = `The SPD shown on the character screen in game, including relics, light cone and traces.\n\n`
      + `AV per turn = 10,000 ÷ SPD (before in-battle buffs).\n\nBase ${ch.spd} + traces ${ch.traceSpd}. In-battle buffs (Ruan Mei, Robin, Messenger 4pc...) are simulated on top of this.`;
    return `<div class="field"><span class="label-row">Speed ${infoIcon(info)}</span>
      <input type="number" step="0.1" min="1" max="${MAX_SPD}" ${f('spd')} value="${value}">
      <span class="hint spd-av">1 turn every <b data-av="${i}">–</b> AV</span>
      <span class="hint">${esc(note)}${!s.spdAuto && !s.fromAccount ? ` · <a href="#" data-action="spdAuto" data-slot="${i}">use estimate</a>` : ''}</span></div>`;
  }

  // Computed stats, and relic stats (from the account, or typed in).
  // Character-screen (pre-combat) totals. Typed values replace the calculated ones; blank fields
  // show the calculated value (from the account, or base + light cone + traces + sets).
  const STAT_FIELDS = [['ATK', 'ATK', 1], ['HP', 'HP', 1], ['DEF', 'DEF', 1], ['cr', 'CRIT Rate %', 100], ['cd', 'CRIT DMG %', 100],
    ['dmg', 'DMG %', 100], ['be', 'Break %', 100], ['err', 'Energy Regen %', 100], ['elation', 'Elation %', 100]];
  function statsPanel(s, ch, i) {
    if (!window.AVDamage) return '';
    const calc = window.AVDamage.staticStats({ ...s, statTotals: null }, { CHARS, LCS, RELICS });
    const val = { ATK: calc.atkBase * (1 + calc.atkPct) + calc.atk, HP: calc.hpBase * (1 + calc.hpPct) + calc.hp, DEF: calc.defBase * (1 + calc.defPct) + calc.def,
      cr: calc.cr, cd: calc.cd, dmg: calc.dmg, be: calc.be, elation: calc.elation,
      err: window.AVCalc.errOf({ ...s, statTotals: null }) };
    const tot = s.statTotals || {};
    const shown = (k, mul) => Math.round(val[k] * mul * 10) / 10;
    return `<details class="more"><summary>Stats</summary>
      <div class="muted small note">Your character-screen stats. Blank fields use the calculated value${s.fromAccount && s.relicStats ? ' (from your account)' : ' (no relic stats)'}.</div>
      <div class="row row-3 relic-grid">${STAT_FIELDS.filter(([k]) => (k !== 'elation' || ch.path === 'Elation') && (k !== 'err' || ch.combat.maxEnergy > 0)).map(([k, label, mul]) => `
        <label class="field"><span>${label}</span><input type="number" step="0.1" data-slot="${i}" data-total="${k}" data-mul="${mul}"
          value="${tot[k] != null ? Math.round(tot[k] * mul * 10) / 10 : ''}" placeholder="${shown(k, mul)}"></label>`).join('')}</div>
    </details>`;
  }

  // Teammate picker, shown only when the choice changes someone's speed or turn order:
  // advancers (who they pull), SPD buffers (who gets the buff, named per character), and
  // team-wide Ult advancers holding their Ult for a teammate.
  function targetField(s, ch, others, f) {
    const kit = kitFor(ch.id);
    const ultKind = window.AVCalc.ultAdvanceKind(s);
    const timing = ultKind ? window.AVCalc.ultTimingOf(s) : null;
    const tl = typeof kit.targetLabel === 'function' ? kit.targetLabel(s) : kit.targetLabel;
    // Phainon gains Coreflame when an ally's ability targets him, so targets matter with him around.
    const phainon = state.slots.some((x) => x && x.charId === '1408') && ch.id !== '1408' && kit.allyTarget;
    const label = kit.advance === 'skill' ? 'Always advances (Skill)'
      : ultKind === 'single' ? 'Always advances (Ultimate)'
        : tl || (ultKind === 'team' && timing === 'target' ? 'Hold Ult until this teammate acts' : null)
          || (phainon ? 'Ability target (Phainon gains Coreflame)' : null);

    const opts = others.map(({ x, j }) => {
      const c = CHARS[x.charId];
      const note = ch.id === '1313' && c.path === 'Harmony' ? ' (Harmony: no advance)' : '';
      return `<option value="${j}"${+s.target === j ? ' selected' : ''}>${esc(c.name + note)}</option>`;
    }).join('');
    let html = label ? `<label class="field"><span>${esc(label)}</span><select ${f('target')}>${opts}</select></label>` : '';

    return html;
  }

  // Small eye icon that shows `text` on hover / focus.
  const infoIcon = (text) => `<span class="info-icon" tabindex="0" role="img" aria-label="${attr(esc(text))}" data-info="${attr(esc(text))}">
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg></span>`;

  const autoUlt = (ch) => kitFor(ch.id).autoUlt;

  // Manual Ultimate schedule: first Ultimate after turn N (or at battle start), then every M of
  // this character's own turns, with a preview of the resulting turns.
  function manualUlt(s, i, f) {
    const se = startEnergy[i];
    // Possible only if Energy is already full once the battle starts.
    const startOk = !se || !(se.max > 0) || se.have >= se.max - 1e-6;
    if (!startOk && +s.ultFirst === 0) s.ultFirst = Math.max(1, +s.ultFirstSaved || 3);
    const atStart = +s.ultFirst === 0;
    const first = atStart ? 0 : Math.max(1, +s.ultFirst || 1);
    const every = Math.max(1, +s.ultEvery || 1);
    const turns = [];
    for (let k = atStart ? 1 : 0; turns.length < 4; k++) turns.push(first + k * every);
    const preview = `${atStart ? 'Battle start, then after turns ' : 'Ultimate after turns '}${turns.join(', ')}…`;
    return `<div class="manual-ult">
      <div class="row row-2">
        <label class="field"><span>First Ult turn</span>
          <input type="number" min="1" ${f('ultFirst')} value="${atStart ? '' : first}" ${atStart ? 'disabled placeholder="Start"' : ''}></label>
        <label class="field"><span>Repeat every</span>
          <input type="number" min="1" ${f('ultEvery')} value="${every}"></label>
      </div>
      ${startOk ? `<label class="check"><input type="checkbox" ${f('ultStart')} ${atStart ? 'checked' : ''}> First Ult at battle start</label>`
        : `<div class="hint muted small">No Ult at battle start: ${Math.round(se.have)}/${se.max} Energy after battle-start effects.</div>`}
      <div class="hint ult-preview">${preview}</div>
    </div>`;
  }

  // Actions pattern, Ultimate timing and the ER rope toggle.
  function ultField(s, ch, i, f) {
    const auto = autoUlt(ch);
    const kind = window.AVCalc.ultAdvanceKind(s);
    const timing = window.AVCalc.ultTimingOf(s);
    const tgt = CHARS[(state.slots[s.target] || {}).charId];
    const who = tgt ? shortName(tgt.name) : 'the target';
    const hasEnergy = ch.combat.maxEnergy > 0;
    const info = [
      hasEnergy ? `When ready: fires as soon as Energy is full (${ch.combat.maxEnergy}). No Energy is wasted, but an Ultimate that advances allies might waste AV.` : '',
      kind ? `Right after ${who} acts: no AV is wasted, but ${shortName(ch.name)} might waste Energy while holding the Ultimate.` : '',
      'Manual: fires on the turns you set, ignoring Energy.',
    ].filter(Boolean).join('\n\n');
    const ult = auto
      ? `<div class="field"><span>Ultimate</span><div class="muted small auto-ult">${esc(auto)}</div></div>`
      : `<div class="field"><span class="label-row">Ultimate ${infoIcon(info)}</span>
          <select ${f('ultTiming')} aria-label="Ultimate timing">
            ${hasEnergy ? `<option value="ready"${timing === 'ready' ? ' selected' : ''}>When ready</option>` : ''}
            ${kind ? `<option value="target"${timing === 'target' ? ' selected' : ''}>Right after ${esc(who)} acts</option>` : ''}
            <option value="schedule"${timing === 'schedule' || (!hasEnergy && timing !== 'target') ? ' selected' : ''}>Manual</option>
          </select></div>`;
    const manual = !auto && (timing === 'schedule' || !hasEnergy);
    return `<div class="row ult-row">
        <label class="field"><span class="label-row">Actions ${infoIcon('S = Skill, B = Basic ATK. The pattern repeats: SSB means Skill, Skill, Basic ATK. A Skill without Skill Points becomes a Basic ATK.')}</span>
          <input type="text" list="patterns" ${f('pattern')} value="${esc(s.pattern)}"></label>
        ${ult}
      </div>
      ${manual ? manualUlt(s, i, f) : ''}
      ${hasEnergy ? `<label class="check"><input type="checkbox" ${f('errRope')} ${s.errRope ? 'checked' : ''}> Energy Regen rope${s.errRope && s.errRopeValue != null ? ` (${fmt(s.errRopeValue * 100, 1)}%)` : ''}
        <span class="muted small">· ERR ${fmt(window.AVCalc.errOf(s) * 100, 1)}%</span></label>` : ''}`;
  }

  // Inputs a kit needs that the simulator can't know (enemy count, HP lost to hits...).
  function kitOptions(s, ch, f, i) {
    const kit = kitFor(ch.id);
    if (!kit.options.length) return '';
    const opts = s.opts || {};
    return `<div class="kit-opts">${kit.options.map((o) => {
      const v = opts[o.key] === undefined ? o.def : opts[o.key];
      const d = `data-slot="${i}" data-opt="${o.key}"`;
      return o.type === 'check'
        ? `<label class="check"><input type="checkbox" ${d} ${v ? 'checked' : ''}> ${esc(o.label)}</label>`
        : `<label class="field"><span>${esc(o.label)}</span><input type="number" ${d} min="${o.min}" max="${o.max}" step="${o.step}" value="${v}"></label>`;
    }).join('')}</div>`;
  }

  // Gear thumbnail; an empty slot keeps its size so the selects stay aligned.
  const thumb = (src) => (src ? `<img class="thumb" src="${src}" alt="">` : '<span class="thumb empty"></span>');

  function updateSpeeds() {
    state.slots.forEach((s, i) => {
      if (!s || !CHARS[s.charId]) return;
      const st = panelStats(s);
      const avEl = root.querySelector(`[data-av="${i}"]`);
      if (avEl) avEl.textContent = fmt(10000 / st.panel, 1);
      const effEl = root.querySelector(`[data-effects="${i}"]`);
      if (effEl) {
        const lc = LCS[s.lcId];
        const pathWarn = lc && lc.path !== st.ch.path ? `<div class="warn">Light cone Path doesn't match; passive inactive.</div>` : '';
        effEl.innerHTML = pathWarn + (st.effects.length
          ? `<ul class="sim-list">${st.effects.filter((e) => e.desc).map((e) => `<li><b>${esc(e.src === 'energy' ? 'Energy & SP' : e.label)}</b>: ${esc(e.desc)}</li>`).join('')}</ul>`
          : '<div class="muted small">No speed or turn-order effects are simulated for this setup yet. Edit the Speed above to test anything missing.</div>');
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
        if (ACCOUNT_FIELDS.includes(t.dataset.f)) state.slots[i].fromAccount = false;
        changed(true);
        break;
      }
      case 'spdAuto': ev.preventDefault(); state.slots[i].spdAuto = true; state.slots[i].spd = ''; changed(true); break;
      case 'gear': ev.stopPropagation(); openGearPicker(i, t.dataset.kind); break;
      case 'sync': ev.stopPropagation(); if (applyAccount(state.slots[i])) changed(true); break;
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

  const STRUCTURAL = new Set(['lcId', 'set1', 'set2', 'planar', 'ultTiming', 'target', 'spd', 'errRope', 'ultStart', 'ultFirst', 'ultEvery']);
  function onInput(ev) {
    const t = ev.target;
    if (t.dataset.g) {
      const v = t.type === 'number' ? t.value : t.value;
      state[t.dataset.g] = t.type === 'number' ? (v === '' ? '' : +v) : v;
      if (t.dataset.g === 'mode') renderModeBar();
      changed(false);
      return;
    }
    if (t.dataset.zoom !== undefined) { state.zoom = +t.value; renderTimelineOnly(); save(); return; }
    if (t.dataset.total !== undefined) {
      const sl = state.slots[+t.dataset.slot];
      sl.statTotals = { ...(sl.statTotals || {}) };
      if (t.value === '') delete sl.statTotals[t.dataset.total];
      else sl.statTotals[t.dataset.total] = +t.value / +t.dataset.mul;
      // ERR also shows next to the rope toggle, so redraw the card once the value is committed.
      changed(t.dataset.total === 'err' && ev.type === 'change');
      return;
    }
    if (t.dataset.opt !== undefined) {
      const s = state.slots[+t.dataset.slot];
      s.opts = s.opts || {};
      s.opts[t.dataset.opt] = t.type === 'checkbox' ? t.checked : (t.value === '' ? '' : +t.value);
      changed(false);
      return;
    }
    if (t.dataset.f === undefined) return;
    const s = state.slots[+t.dataset.slot];
    const f = t.dataset.f;
    if (f === 'spd') { s.spd = t.value === '' ? '' : clampSpd(+t.value); s.spdAuto = t.value === ''; }
    else if (f === 'errRope') { s.errRope = t.checked; delete s.errRopeValue; }
    else if (f === 'ultStart') { if (t.checked) { s.ultFirstSaved = s.ultFirst; s.ultFirst = 0; } else s.ultFirst = Math.max(1, +s.ultFirstSaved || 3); }
    else if (f === 'ultFirst') s.ultFirst = Math.max(1, +t.value || 1);
    else if (f === 'ultEvery') s.ultEvery = Math.max(1, +t.value || 1);
    else if (f === 'target') s.target = +t.value;
    else if (t.type === 'number') s[f] = t.value === '' ? (f === 'override' ? '' : 0) : +t.value;
    else s[f] = t.value;
    if (f === 'set1' && (!s.set1 || s.set2 === s.set1)) s.set2 = 'same';
    if (ACCOUNT_FIELDS.includes(f)) s.fromAccount = false;
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
    const owned = Account.ownedIds();
    const filt = { q: '', path: '', el: '', mine: owned.size > 0 };
    const taken = new Set(state.slots.filter((s, j) => s && j !== slotIdx).map((s) => s.charId));
    modal.hidden = false;
    modal.innerHTML = `
      <div class="card modal-box" role="dialog" aria-label="Choose a character">
        <div class="modal-head">
          <div class="top"><h3>Choose a character</h3><button class="btn ghost" data-close>Close</button></div>
          <input type="search" placeholder="Search…" data-q>
          <div class="filters" data-els>${ELEMENTS.map((e) => `<button class="pill" data-el="${e}" title="${EL_NAME[e] || e}"><img src="${img.element(e)}" alt=""> ${EL_NAME[e] || e}</button>`).join('')}</div>
          <div class="filters" data-paths>${PATHS.map((p) => `<button class="pill" data-path="${p}">${p}</button>`).join('')}</div>
          ${owned.size ? `<div class="filters"><button class="pill toggle${filt.mine ? ' on' : ''}" data-mine>My characters (${owned.size})</button>
            <span class="muted small">Your eidolons, light cone and relics are filled in automatically.</span></div>`
            : '<div class="muted small">Tip: <a href="#" data-account>connect your account</a> to fill in your own eidolons and gear.</div>'}
        </div>
        <div class="picker-grid" data-grid></div>
      </div>`;
    const grid = modal.querySelector('[data-grid]');
    const draw = () => {
      const q = filt.q.toLowerCase();
      const list = DATA.characters.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!filt.path || c.path === filt.path)
        && (!filt.el || c.element === filt.el) && (!filt.mine || owned.has(c.id)));
      grid.innerHTML = list.map((c) => {
        const mine = owned.has(c.id) && Account.character(c.id);
        return `
        <button class="pick r${c.rarity}${taken.has(c.id) ? ' taken' : ''}" style="--el:${elColor(c.element)}" data-pick="${c.id}" title="${esc(c.name)} · ${c.path}">
          <img src="${img.icon(c.id)}" alt="" loading="lazy"><img class="el" src="${img.element(c.element)}" alt="">
          ${mine ? `<span class="owned">E${mine.eidolon}</span>` : ''}
          <div class="nm">${esc(c.name)}</div>
        </button>`;
      }).join('') || '<div class="muted">No matches.</div>';
    };
    const close = () => { modal.hidden = true; modal.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal.onclick = (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) return close();
      if (e.target.closest('[data-account]')) { e.preventDefault(); close(); return window.HSRTools.openAccount(); }
      const mine = e.target.closest('[data-mine]');
      if (mine) { filt.mine = !filt.mine; mine.classList.toggle('on', filt.mine); return draw(); }
      const el = e.target.closest('[data-el]');
      if (el) { filt.el = filt.el === el.dataset.el ? '' : el.dataset.el; modal.querySelectorAll('[data-el]').forEach((b) => b.classList.toggle('on', b.dataset.el === filt.el)); return draw(); }
      const p = e.target.closest('[data-path]');
      if (p) { filt.path = filt.path === p.dataset.path ? '' : p.dataset.path; modal.querySelectorAll('[data-path]').forEach((b) => b.classList.toggle('on', b.dataset.path === filt.path)); return draw(); }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const prev = state.slots[slotIdx];
        const s = newSlot(pick.dataset.pick);
        if (prev) Object.assign(s, { boots: prev.boots, subSpd: prev.subSpd });
        applyAccount(s);
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

  // ---------------------------------------------------------------- gear picker
  // Searchable popup with icons for light cones, relic sets and planar ornaments.
  function openGearPicker(slotIdx, kind) {
    if (kind !== 'lc') return openRelicPicker(slotIdx, kind);
    const s = state.slots[slotIdx];
    const ch = CHARS[s.charId];
    const ownedLc = Account.ownedLightCones();
    const hasAccount = !!Account.data;
    // What this character actually has equipped in game, to pin it to the top of the list.
    const build = Account.buildFor(s.charId);
    const equipped = new Set(build ? (kind === 'lc' ? [build.lcId] : kind === 'planar' ? [build.planar] : [build.set1, build.set2]).filter(Boolean) : []);
    const wornBy = (id) => equipped.has(String(id));

    const cfg = {
      lc: {
        title: 'Choose a light cone', field: 'lcId', current: s.lcId,
        items: DATA.lightCones.map((l) => ({
          id: l.id, name: l.name, src: img.lc(l.id), rarity: l.rarity,
          sub: `${'★'.repeat(l.rarity)} · ${l.path}`, desc: '',
          sig: l.id === signatureOf(s.charId), path: l.path, owned: ownedLc.get(l.id),
          // Hidden search text: the cone's name plus its signature character.
          keys: norm(`${l.name} ${SIG_OWNER[l.id] || ''}`),
        })),
        none: 'No light cone',
        filters: [
          { key: 'path', label: `${ch.path} only`, on: true, test: (x) => x.path === ch.path },
          hasAccount && { key: 'owned', label: 'Owned', on: false, test: (x) => !!x.owned },
        ],
      },
      set1: { title: 'Choose a relic set', field: 'set1', current: s.set1, items: relicItems(relicSets), none: 'No relic set', filters: [] },
      set2: {
        title: 'Choose a 2nd relic set (2-piece)', field: 'set2', current: s.set2,
        items: relicItems(relicSets.filter((r) => r.id !== s.set1)), none: '4-piece (no 2nd set)', noneValue: 'same', filters: [],
      },
      planar: { title: 'Choose a planar ornament', field: 'planar', current: s.planar, items: relicItems(planars), none: 'No planar ornament', filters: [] },
    }[kind];
    cfg.filters = cfg.filters.filter(Boolean);
    const noneValue = cfg.noneValue ?? '';

    const m = window.HSRTools.openModal(`
      <div class="card modal-box gear-box" role="dialog" aria-label="${esc(cfg.title)}">
        <div class="modal-head">
          <div class="top"><h3>${esc(cfg.title)}</h3><button class="btn ghost" data-close>Close</button></div>
          <input type="search" placeholder="Search by name or character…" data-q>
          <div class="filters"${cfg.filters.length ? '' : ' hidden'}>${cfg.filters.map((fl) => `<button class="pill toggle${fl.on ? ' on' : ''}" data-filter="${fl.key}">${esc(fl.label)}</button>`).join('')}</div>
        </div>
        <div class="gear-list" data-list></div>
      </div>`);
    const list = m.el.querySelector('[data-list]');
    let q = '';
    const draw = () => {
      const words = norm(q).split(' ').filter(Boolean);
      const hay = (x) => x.keys || norm(`${x.name} ${x.desc}`);
      // Every word must match. While searching, the Path filter is ignored so a character's
      // signature shows up even if it's on another Path.
      const items = cfg.items.filter((x) => words.every((w) => hay(x).includes(w))
        && cfg.filters.every((fl) => !fl.on || (words.length && fl.key === 'path') || fl.test(x)));
      // Signature first, then what's equipped, then what you own, then by rarity.
      items.sort((a, b) => ((b.sig ? 1 : 0) - (a.sig ? 1 : 0)) || (wornBy(b.id) - wornBy(a.id)) || ((b.owned ? 1 : 0) - (a.owned ? 1 : 0)) || ((b.rarity || 0) - (a.rarity || 0)));
      const row = (x) => `
        <button type="button" class="gear-item${x.none || !x.desc ? ' none' : ''}${x.sig ? ' signature' : ''}${String(x.id) === String(cfg.current) ? ' current' : ''}" data-id="${x.id}">
          ${x.src ? `<img src="${x.src}" alt="" loading="lazy">` : '<span class="gear-none">∅</span>'}
          <span class="gi-txt">
            <span class="gi-name">${esc(x.name)}</span>
            ${x.sub ? `<span class="gi-sub">${esc(x.sub)}</span>` : ''}
            ${x.desc ? `<span class="gi-desc">${esc(x.desc)}</span>` : ''}
            <span class="gi-badges">${x.sig ? '<span class="badge sig">Signature</span>' : ''}${wornBy(x.id) ? '<span class="badge worn">Equipped</span>' : ''}${x.owned ? `<span class="badge owned">Owned${kind === 'lc' ? ` S${x.owned}` : ''}</span>` : ''}</span>
          </span>
        </button>`;
      list.innerHTML = row({ id: noneValue, name: cfg.none, desc: '', none: true }) + (items.map(row).join('') || '<div class="muted gear-empty">No matches. Try turning off a filter.</div>');
    };
    m.el.onclick = (e) => {
      if (e.target.closest('[data-close]')) return m.close();
      const fb = e.target.closest('[data-filter]');
      if (fb) { const fl = cfg.filters.find((x) => x.key === fb.dataset.filter); fl.on = !fl.on; fb.classList.toggle('on', fl.on); return draw(); }
      const it = e.target.closest('[data-id]');
      if (!it) return;
      s[cfg.field] = it.dataset.id;
      if (kind === 'lc') s.lcS = ownedLc.get(it.dataset.id) || defaultSuperimposition(it.dataset.id);
      if (kind === 'set1' && (!s.set1 || s.set2 === s.set1)) s.set2 = 'same';
      s.fromAccount = false;
      m.close();
      changed(true);
    };
    const qi = m.el.querySelector('[data-q]');
    qi.oninput = () => { q = qi.value; draw(); };
    draw();
    setTimeout(() => qi.focus(), 0);
  }

  // Your own superimposition wins; otherwise 4★ and Herta Store (24xxx) cones start at S5,
  // since they're easy to max, and limited 5★ cones at S1.
  function defaultSuperimposition(id) {
    const lc = LCS[id];
    if (!lc) return 1;
    return lc.rarity <= 4 || String(id).startsWith('24') ? 5 : 1;
  }

  const norm = (t) => String(t).toLowerCase().replace(/[•·:'’!?,.()]/g, ' ').replace(/\s+/g, ' ').trim();
  const SIG_OWNER = {};
  DATA.characters.forEach((c) => { if (c.signature) SIG_OWNER[c.signature] = `${SIG_OWNER[c.signature] || ''} ${c.name}`; });

  // Stat categories for filtering sets by their bonus.
  const SET_STATS = [
    ['SPD', /SPD/], ['ATK', /\bATK\b/], ['CRIT Rate', /CRIT Rate/], ['CRIT DMG', /CRIT DMG/], ['Break', /Break/],
    ['Energy', /Energy/], ['HP', /\bHP\b|Max HP/], ['DEF', /\bDEF\b/], ['Effect Hit', /Effect Hit Rate/], ['Effect RES', /Effect RES/],
    ['Healing', /Healing/], ['Element DMG', /(Physical|Fire|Ice|Lightning|Wind|Quantum|Imaginary) DMG/], ['Follow-up', /Follow-Up/],
    ['DoT', /DoT/], ['Shield', /Shield/], ['Elation', /Elation|Punchline/], ['Memosprite', /memosprite/i], ['Skill Points', /Skill Point/],
  ];
  // Icon-grid picker for relic sets and planar ornaments: search by name or effect, filter by stat.
  function openRelicPicker(slotIdx, kind) {
    const s = state.slots[slotIdx];
    const build = Account.buildFor(s.charId);
    const equipped = new Set(build ? (kind === 'planar' ? [build.planar] : [build.set1, build.set2]).filter(Boolean) : []);
    const planar = kind === 'planar';
    const pool = planar ? planars : relicSets.filter((r) => kind !== 'set2' || r.id !== s.set1);
    const current = String(s[kind]);
    const title = planar ? 'Planar ornament' : kind === 'set2' ? '2nd relic set (2-piece)' : 'Relic set';
    const f = { q: '', stat: '', scope: kind === 'set2' || planar ? 0 : 'any' };
    const noneLabel = kind === 'set2' ? 'None: use the 4-piece' : 'None';
    const m = window.HSRTools.openModal(`
      <div class="card modal-box relic-box" role="dialog" aria-label="${esc(title)}">
        <div class="modal-head">
          <div class="top"><h3>${esc(title)}</h3><button class="btn ghost" data-close>Close</button></div>
          <input type="search" placeholder="Search by name or effect…" data-q>
          <div class="filters">${SET_STATS.map(([k]) => `<button class="pill toggle" data-stat="${k}">${k}</button>`).join('')}</div>
          ${planar || kind === 'set2' ? '' : `<div class="filters scope"><span class="muted small">Stat filter looks at:</span>
            <button class="pill toggle on" data-scope="any">Either bonus</button><button class="pill toggle" data-scope="0">2-piece</button><button class="pill toggle" data-scope="1">4-piece</button></div>`}
        </div>
        <div class="relic-grid-pick" data-list></div>
        <div class="relic-preview" data-preview></div>
      </div>`);
    const list = m.el.querySelector('[data-list]');
    const prev = m.el.querySelector('[data-preview]');
    const effects = (r) => r.text.map((t, k) => (r.planar ? t : `<b>${k ? '4pc' : '2pc'}</b> ${esc(t)}`)).join('<br>');
    const show = (id) => {
      const r = RELICS[id];
      prev.innerHTML = r ? `<img src="${img.relic(r.id)}" alt=""><div><div class="rp-name">${esc(r.name)}</div><div class="rp-text">${effects(r)}</div></div>`
        : '<div class="muted small">Hover or focus a set to see its bonuses.</div>';
    };
    const draw = () => {
      const needle = f.q.toLowerCase();
      const re = f.stat && SET_STATS.find(([k]) => k === f.stat)[1];
      const items = pool.filter((r) => (!needle || r.name.toLowerCase().includes(needle) || r.text.join(' ').toLowerCase().includes(needle))
        && (!re || (f.scope === 'any' ? r.text : [r.text[+f.scope] || '']).some((t) => re.test(t))));
      items.sort((a, b) => (equipped.has(b.id) - equipped.has(a.id)) || (+b.id - +a.id));
      const none = kind === 'set2' ? 'same' : '';
      list.innerHTML = `<button type="button" class="rp-tile none${current === none || (!current && !none) ? ' current' : ''}" data-id="${none}" title="${esc(noneLabel)}"><span>∅</span><i>${esc(noneLabel)}</i></button>`
        + (items.map((r) => `<button type="button" class="rp-tile${r.id === current ? ' current' : ''}" data-id="${r.id}" data-hover="${r.id}" title="${attr(esc(r.name))}">
            <img src="${img.relic(r.id)}" alt="${attr(esc(r.name))}" loading="lazy">${equipped.has(r.id) ? '<span class="rp-dot" title="Equipped"></span>' : ''}</button>`).join('')
          || '<div class="muted gear-empty">No matches.</div>');
    };
    m.el.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-hover]'); if (t) show(t.dataset.hover); });
    m.el.addEventListener('focusin', (e) => { const t = e.target.closest('[data-hover]'); if (t) show(t.dataset.hover); });
    m.el.onclick = (e) => {
      if (e.target.closest('[data-close]')) return m.close();
      const st = e.target.closest('[data-stat]');
      if (st) {
        f.stat = f.stat === st.dataset.stat ? '' : st.dataset.stat;
        m.el.querySelectorAll('[data-stat]').forEach((b) => b.classList.toggle('on', b.dataset.stat === f.stat));
        return draw();
      }
      const sc = e.target.closest('[data-scope]');
      if (sc) { f.scope = sc.dataset.scope; m.el.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('on', b === sc)); return draw(); }
      const it = e.target.closest('[data-id]');
      if (!it) return;
      s[kind] = it.dataset.id;
      if (kind === 'set1' && (!s.set1 || s.set2 === s.set1)) s.set2 = 'same';
      s.fromAccount = false;
      m.close();
      changed(true);
    };
    const qi = m.el.querySelector('[data-q]');
    qi.oninput = () => { f.q = qi.value; draw(); };
    draw();
    show(current && current !== 'same' ? current : null);
    setTimeout(() => qi.focus(), 0);
  }

  function relicItems(list) {
    return list.map((r) => ({
      id: r.id, name: r.name, src: img.relic(r.id),
      sub: r.planar ? 'Planar ornament' : '',
      desc: r.text.map((t, k) => (r.planar ? t : `${k ? '4pc' : '2pc'}: ${t}`)).join('  ·  '),
    }));
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
      ${damageSection(r)}
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
              <span><i class="lg-adv"></i>Advanced / pulled (color = who did it)</span>
              <span><i class="lg-extra"></i>Extra turn granted</span>
              <span><i style="background:linear-gradient(135deg,#ffd36e,#ff8fd1,#8fd3ff)"></i>Aha / Elation Skill</span>
              <span><i style="background:#5a2230;border:1px solid #ff7a8a;border-radius:2px"></i>Enemy turn</span>
              <span><i style="background:#ffd36e;border-radius:2px;transform:skewX(-15deg)"></i>Weakness Break</span>
              <span><i style="background:#0b0f1d;border:1.5px solid var(--muted)"></i>Follow-up (F)</span>
              <span><i style="background:transparent;border:1.5px solid var(--gold);height:0;border-radius:0;width:12px"></i>Energy</span>
            </div>
          </div>
          <div class="timeline-scroll" id="timeline"></div>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><h2>AV per action</h2><span class="muted small">The AV at which each action happens, grouped by cycle</span></div>
        <div class="card table-wrap">${actionTable(r)}</div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Action order</h2><span class="muted small">Everything that happens, in order, cycle by cycle</span></div>
        <div class="order-grid">${orderList(r)}</div>
      </div>`;
    renderTimelineOnly();
  }

  // Cycle c spans [start, end] in AV.
  const cycleRange = (r, c) => {
    const a = c === 0 ? 0 : r.first + (c - 1) * r.len;
    return [a, c === 0 ? r.first : a + r.len];
  };

  const fmtBig = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e5 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : Math.round(n).toString());

  // Team damage: total, per 100 AV and per cycle, plus each character's share by source.
  function damageSection(r) {
    const total = r.units.reduce((a, { unit }) => a + (unit.dmgTotal || 0), 0);
    if (!total) return '';
    const rows = r.units.map(({ unit, stats }) => {
      const by = {};
      r.sim.damageLog.filter((d) => d.unit === unit).forEach((d) => { by[d.label] = (by[d.label] || 0) + d.amt; });
      const parts = Object.entries(by).sort((a, b) => b[1] - a[1]);
      const share = (unit.dmgTotal || 0) / total;
      return `<div class="dmg-row" style="--el:${elColor(stats.ch.element)}">
        <img src="${img.avatar(stats.ch.id)}" alt="">
        <div class="dmg-main">
          <div class="dmg-top"><b>${esc(stats.ch.name)}</b><span>${fmtBig(unit.dmgTotal || 0)} · ${Math.round(share * 100)}%</span></div>
          <div class="dmg-bar"><i style="width:${(share * 100).toFixed(1)}%"></i></div>
          <div class="dmg-parts">${parts.map(([k, v]) => `<span>${esc(LABELS[k] || k)} <b>${fmtBig(v)}</b></span>`).join('')}</div>
        </div>
      </div>`;
    }).join('');
    const noRelics = r.units.filter(({ unit }) => (!unit.cfg.relicStats || !Object.keys(unit.cfg.relicStats).length) && !(unit.cfg.statTotals && Object.keys(unit.cfg.statTotals).length)).map(({ stats }) => shortName(stats.ch.name));
    return `<div class="section">
      <div class="section-head"><h2>Damage</h2><span class="muted small">Estimate · ${r.sim.enemyCount} enem${r.sim.enemyCount === 1 ? 'y' : 'ies'}, Lv. ${r.sim.enemyLevel}, ${Math.round(r.sim.enemyRes * 100)}% RES ${infoIcon(DMG_NOTE)}</span></div>
      <div class="card dmg-card">
        <div class="dmg-totals">
          <div><b>${fmtBig(total)}</b><span>Team damage</span></div>
          <div><b>${fmtBig(total / r.maxAV * 100)}</b><span>Per 100 AV</span></div>
          <div><b>${fmtBig(total / r.cycles)}</b><span>Per cycle</span></div>
        </div>
        ${rows}
        ${noRelics.length ? `<div class="muted small dmg-warn">No relic stats for ${esc(noRelics.join(', '))}: load your account or enter your character-screen stats under "Stats" on the card.</div>` : ''}
      </div>
    </div>`;
  }
  const LABELS = { Basic: 'Basic ATK', Skill: 'Skill', Ult: 'Ultimate', Enhanced: 'Enhanced', FollowUp: 'Follow-up', Summon: 'Summon', Elation: 'Elation Skill', Extra: 'Extra turn', Final: 'Final hit' };
  const DMG_NOTE = 'Expected damage (average CRIT) from each ability\'s multipliers in the game data, your stats, and the modeled team buffs and enemy debuffs (Robin, Sunday, Bronya, Sparkle, Ruan Mei, Tingyun, Hanya, Pela, Silver Wolf, Jiaoqiu, Tribbie, Cipher, Black Swan, Elation kits and more). DoT ticks on enemy turns. Not included yet: Break / Super Break DMG, most DPS self-buffs, light cone and relic set conditional effects.';

  function summaryCards(r) {
    return r.units.map(({ unit, stats }) => {
      const acts = r.events.filter((e) => e.unit === unit && e.kind === 'char' && !e.nonTurn);
      const fuas = r.events.filter((e) => e.unit === unit && e.type === 'FollowUp').length;
      const els = r.events.filter((e) => e.unit === unit && e.type === 'Elation').length;
      const ults = r.events.filter((e) => e.unit === unit && e.type === 'Ultimate').length;
      const perCycle = Array.from({ length: r.cycles }, (_, c) => acts.filter((e) => e.cycle === c).length);
      const overActs = r.events.filter((e) => e.unit === unit && e.type === 'Ultimate' && e.heldActs > 0).reduce((n, e) => n + e.heldActs, 0);
      return `
        <div class="card sum-card" style="--el:${elColor(stats.ch.element)}">
          <div class="sum-head">
            <img src="${img.avatar(stats.ch.id)}" alt="">
            <div class="nm">${esc(stats.ch.name)}</div>
          </div>
          <div class="sum-stats">
            <div title="Character-screen SPD"><b>${fmt(stats.panel)}</b><span>Speed</span></div>
            <div title="10,000 ÷ SPD: the AV between two of this character's turns, without buffs"><b>${fmt(10000 / stats.panel)}</b><span>AV per turn</span></div>
            <div title="The AV at which this character first acts"><b>${acts.length ? fmt(acts[0].av) : '–'}</b><span>First turn at</span></div>
            <div title="Turns taken across all ${r.cycles} cycles shown (Ultimates, follow-ups and Elation Skills not counted)"><b>${acts.length}</b><span>Turns · ${ults} Ult${ults === 1 ? '' : 's'}</span></div>
          </div>
          <div class="sum-cycles">
            <span class="lbl">Turns per cycle</span>
            <div class="cyc-chips">${perCycle.map((n, c) => `<span class="cyc-chip${n ? '' : ' zero'}" title="Cycle ${c}: ${n} turn${n === 1 ? '' : 's'}"><i>C${c}</i>${n}</span>`).join('')}</div>
          </div>
          <div class="sum-dmg" title="Estimated damage over the cycles shown"><span>Damage</span><b>${fmtBig(unit.dmgTotal || 0)}</b></div>
          ${fuas || els ? `<div class="muted small">${[fuas ? `${fuas} follow-up${fuas > 1 ? 's' : ''}` : '', els ? `${els} Elation Skill${els > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</div>` : ''}
          ${overActs ? `<div class="warn-kv" title="The Ultimate was ready but held for its target; energy from these turns is wasted.">⚠ ${overActs} turn${overActs > 1 ? 's' : ''} of energy wasted while holding the Ultimate</div>` : ''}
        </div>`;
    }).join('');
  }

  // Grouped by cycle: a full-width header row per cycle, then each character's actions in that
  // cycle top-aligned in their column, so cycle boundaries line up across the whole table.
  function actionTable(r) {
    const cols = r.units.map(({ unit, stats }) => ({
      unit, ch: stats.ch,
      acts: r.events.filter((e) => e.unit === unit && !e.nonTurn),
      ults: r.events.filter((e) => e.unit === unit && e.type === 'Ultimate'),
    }));
    if (!cols.some((c) => c.acts.length)) return '<div class="empty-state">No actions inside the shown cycles.</div>';
    const cell = (c, e) => {
      if (!e) return '<td></td>';
      const k = c.acts.indexOf(e);
      // An Ultimate belongs to the last action before it (it may be held for a while).
      const next = c.acts[k + 1];
      // All Ultimates used after this action and before the next one (Evanescia can chain them).
      const ultsHere = c.ults.filter((u) => u.n === e.n && u.av >= e.av - 1e-6 && (!next || u.av <= next.av + 1e-6));
      const ult = ultsHere[0];
      const held = ultsHere.length > 1 ? ` title="${ultsHere.length} Ultimates before the next turn, at AV ${ultsHere.map((x) => fmt(x.av)).join(', ')}"`
        : ult && ult.heldAV > 1e-6 ? ` title="Held ${fmt(ult.heldAV)} AV for the target; fired at ${fmt(ult.av)}"` : '';
      const warn = ult && ult.heldActs ? ' ⚠' : '';
      const notes = crossMarks(e).map(markText);
      return `<td${notes.length ? ` title="${attr(esc(notes.join('\n')))}"` : ''}><span class="n">${ordinal(k + 1)}</span>${fmt(e.av)}${
        e.type === 'Extra' ? '<span class="ex">extra</span>' : ''}${
        notes.length ? `<span class="src" style="color:${elOf(crossMarks(e)[0].by)}">»</span>` : ''}${
        ult ? `<span class="ult"${held}>★ ult${ultsHere.length > 1 ? ` ×${ultsHere.length}` : ult && ult.heldAV > 1e-6 ? ` @${fmt(ult.av)}` : ''}${warn}</span>` : ''}</td>`;
    };
    let html = `<table class="av-table"><thead><tr>${cols.map((c) =>
      `<th><span class="th-char"><img src="${img.avatar(c.ch.id)}" alt="">${esc(c.ch.name)}</span></th>`).join('')}</tr></thead><tbody>`;
    for (let cy = 0; cy < r.cycles; cy++) {
      const per = cols.map((c) => c.acts.filter((e) => e.cycle === cy));
      const rows = Math.max(0, ...per.map((x) => x.length));
      const [a, b] = cycleRange(r, cy);
      html += `<tr class="cyc-row"><th colspan="${cols.length}">Cycle ${cy}<span>${fmt(a, 0)}–${fmt(b, 0)} AV</span></th></tr>`;
      if (!rows) html += `<tr><td colspan="${cols.length}" class="muted">No actions</td></tr>`;
      for (let k = 0; k < rows; k++) html += `<tr>${cols.map((c, j) => cell(c, per[j][k])).join('')}</tr>`;
    }
    return html + '</tbody></table>';
  }
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

  // One column per cycle, each a top-to-bottom list: AV · who · what happened.
  function orderList(r) {
    const cols = [];
    for (let c = 0; c < r.cycles; c++) {
      const evs = r.events.filter((e) => e.cycle === c);
      const [a, b] = cycleRange(r, c);
      const rows = evs.map((e) => {
        const owner = e.unit.owner || e.unit;
        let who = esc(shortName(owner.name)), what, cls = 'turn';
        if (e.kind === 'countdown') { who = esc(e.unit.name); what = 'ends'; cls = 'sub'; }
        else if (e.kind === 'aha') { who = 'Aha'; what = `${e.type === 'AhaExtra' ? 'Extra ' : ''}Aha Instant <span class="dim">(${fmt(e.punchline, 0)} Punchline)</span>`; cls = 'aha'; }
        else if (e.kind === 'enemy' && e.type === 'Break') { who = esc(e.unit.name); what = `Broken${e.by ? ` <span class="dim">(${esc(shortName(e.by))})</span>` : ''}`; cls = 'enemy break'; }
        else if (e.kind === 'enemy') { who = esc(e.unit.name); what = 'attacks'; cls = 'enemy'; }
        else if (e.kind !== 'char') { who = esc(e.unit.name); what = `acts <span class="dim">(${esc(shortName(owner.name))})</span>`; cls = 'sub'; }
        else if (e.type === 'Ultimate') { what = '★ Ultimate'; cls = 'ult'; }
        else if (e.type === 'Elation') { what = `✦ Elation Skill${e.label ? ` <span class="dim">(${esc(e.label)})</span>` : ''}`; cls = 'elation'; }
        else if (e.type === 'FollowUp') { what = esc(e.label || 'Follow-up'); cls = 'fua'; }
        else what = `Turn ${e.n}${e.type === 'Extra' ? ' <span class="dim">(extra)</span>' : ''}`;
        const notes = crossMarks(e).map(markText);
        const icon = e.kind === 'aha' ? '<span class="ev-glyph aha">A</span>' : e.kind === 'enemy' ? '<span class="ev-glyph enemy"></span>' : `<img src="${img.avatar(e.unit.icon)}" alt="">`;
        return `<li class="ev ${cls}"><span class="av">${fmt(e.av)}</span>${icon}<span class="who">${who}</span><span class="what">${what}</span>${
          notes.map((t) => `<span class="ev-note">» ${esc(t)}</span>`).join('')}</li>`;
      }).join('');
      cols.push(`<div class="card order-col">
        <div class="order-head"><b>Cycle ${c}</b><span>${fmt(a, 0)}–${fmt(b, 0)} AV</span></div>
        ${rows ? `<ol>${rows}</ol>` : '<div class="muted small order-empty">Nothing happens</div>'}
      </div>`);
    }
    return cols.join('');
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
    if (r.events.some((e) => e.kind === 'aha')) lanes.push({ key: 'aha', unit: r.sim.aha, h: 40, special: 'aha' });
    if (r.events.some((e) => e.kind === 'enemy')) lanes.push({ key: 'enemy', unit: null, h: 34, special: 'enemy' });
    let y = TOP;
    lanes.forEach((l) => { l.y = y; y += l.h; });
    const H = y + 24;
    const W = GUT + r.maxAV * scale + PADR;
    const X = (av) => GUT + av * scale;
    const laneOf = new Map(lanes.map((l) => [l.key, l]));
    const parts = [];

    parts.push(`<defs>${r.units.map(({ stats }) => `<clipPath id="clip-${stats.ch.id}"><circle r="15" cx="0" cy="0"/></clipPath>`).join('')}
      <linearGradient id="ahaGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd36e"/><stop offset=".5" stop-color="#ff8fd1"/><stop offset="1" stop-color="#8fd3ff"/></linearGradient></defs>`);

    // Energy: a thin line along the bottom of each character lane (empty → full).
    for (const l of lanes) {
      if (!l.main || !(l.unit.maxEnergy > 0)) continue;
      const pts = r.events.filter((e) => e.unit === l.unit && e.energy != null);
      if (!pts.length) continue;
      const Y = (en) => l.y + l.h - 3 - Math.min(1, en / l.unit.maxEnergy) * 9;
      let d = `M${X(0)},${Y(l.unit.maxEnergy * 0.5)}`;
      for (const e of pts) d += ` H${X(e.av)} V${Y(e.energy)}`;
      d += ` H${X(r.maxAV)}`;
      parts.push(`<path d="${d}" fill="none" stroke="rgba(231,194,125,.55)" stroke-width="1.4"/>`);
    }

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
      if (l.special === 'aha') {
        parts.push(`<g transform="translate(24,${l.y + l.h / 2})"><circle r="13" fill="url(#ahaGrad)"/><text y="4.5" text-anchor="middle" font-size="12" font-weight="800" fill="#1a1406">A</text></g>`);
        parts.push(`<text x="48" y="${l.y + l.h / 2 + 4}" fill="#e7e9f3" font-size="13" font-weight="600">Aha <tspan fill="#9aa3c2" font-size="11" font-weight="500">${fmt(r.sim.spd(r.sim.aha), 0)} SPD</tspan></text>`);
      } else if (l.special === 'enemy') {
        parts.push(`<g transform="translate(24,${l.y + l.h / 2})"><rect x="-9" y="-9" width="18" height="18" rx="4" fill="#5a2230" stroke="#ff7a8a"/></g>`);
        parts.push(`<text x="48" y="${l.y + l.h / 2 + 4}" fill="#e7e9f3" font-size="13" font-weight="600">Enemies <tspan fill="#9aa3c2" font-size="11" font-weight="500">×${r.sim.enemyCount}</tspan></text>`);
      } else if (l.main) {
        parts.push(`<g transform="translate(24,${l.y + l.h / 2})"><circle r="17" fill="${elColor(l.ch.element)}" opacity=".35"/>${chibi(l.ch.id, 38)}</g>`);
        const [nm, sub] = l.ch.name.split(' • ');
        parts.push(sub
          ? `<text x="48" y="${l.y + l.h / 2 - 3}" fill="#e7e9f3" font-size="13" font-weight="600">${esc(truncate(nm, 15))}<tspan x="48" dy="15" fill="#9aa3c2" font-size="11" font-weight="500">${esc(sub)}</tspan></text>`
          : `<text x="48" y="${l.y + l.h / 2 + 4}" fill="#e7e9f3" font-size="13" font-weight="600">${esc(truncate(nm, 15))}</text>`);
      } else {
        parts.push(`<text x="48" y="${l.y + l.h / 2 + 4}" fill="#9aa3c2" font-size="11">↳ ${esc(l.unit.name)}</text>`);
      }
    }
    // Where advances / pulls / extra turns came from: a dashed line from the source's lane to
    // the target's lane at that moment, and a tag on the target's lane ("+30%", "pulled", "+1 turn").
    const tagAt = new Map();
    const tags = [];
    for (const f of r.sim.effects) {
      if (f.av > r.maxAV + 1e-6) continue;
      const tl = laneOf.get(f.target.lane || f.target.key);
      if (!tl) continue;
      const sl = laneOf.get(f.by.lane || f.by.key);
      const x = X(f.av), col = elOf(f.by);
      if (sl && sl !== tl) {
        parts.push(`<line x1="${x}" x2="${x}" y1="${sl.y + sl.h / 2}" y2="${tl.y + tl.h / 2}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3 3" opacity=".6"/>`);
      }
      const label = f.kind === 'extra' ? '+1 turn' : f.kind === 'now' ? 'pulled' : `+${pctStr(f.amount)}`;
      const k = `${tl.key}@${Math.round(x)}`;
      const n = tagAt.get(k) || 0;
      tagAt.set(k, n + 1);
      // Right of the turn marker, stacked downward from just above the lane's centre line.
      const w = label.length * 6 + 10, ty = tl.y + tl.h / 2 - (tl.main ? 18 : 6) + n * 14;
      tags.push(`<g data-tip="${attr(`<b>${esc(f.target.name)}</b><br>${esc(markText(f))}<br>AV ${fmt(f.av, 2)}`)}" transform="translate(${x + (tl.main ? 21 : 12)},${ty})">
        <rect width="${w}" height="12" rx="6" fill="${col}" opacity=".92"/><text x="${w / 2}" y="9" text-anchor="middle" font-size="9" font-weight="700" fill="#0b0f1d">${label}</text></g>`);
    }

    // Events
    const stackAt = new Map();
    for (const e of r.events) {
      const l = laneOf.get(e.lane);
      if (!l) continue;
      const cx = X(e.av), cy = l.y + l.h / 2;
      const heldTip = e.type === 'Ultimate' && e.heldAV > 1e-6 ? `<br>Held ${fmt(e.heldAV)} AV for the target${e.heldActs ? `<br><span style="color:var(--danger)">⚠ ${e.heldActs} own action(s) while held: energy overflow</span>` : ''}` : '';
      const tip = `${esc(e.unit.name)}<br>${e.type === 'Ultimate' ? '<b>Ultimate</b>' : e.kind === 'countdown' ? 'Countdown ends'
        : e.kind === 'aha' ? `<b>${e.type === 'AhaExtra' ? 'Extra ' : ''}Aha Instant</b> (${fmt(e.punchline, 0)} Punchline)`
        : e.kind === 'enemy' ? '<b>Enemy turn</b>'
        : e.type === 'Elation' ? `<b>Elation Skill</b>${e.label ? ` (${esc(e.label)})` : ''} · ${fmt(e.punchline, 0)} Punchline`
        : e.type === 'FollowUp' ? `<b>${esc(e.label || 'Follow-up')}</b>` : `<b>Action ${e.n ?? ''}</b> (${e.type === 'Extra' && e.act && e.act !== 'Extra' ? `extra turn: ${ACT_NAME[e.act] || e.act}` : e.type})`}<br>AV <b>${fmt(e.av, 2)}</b> · Cycle ${e.cycle}${e.kind === 'char' ? `<br>SPD ${fmt(e.spd, 1)}` : ''}${e.dmg ? `<br>DMG <b>${fmtBig(e.dmg)}</b>` : ''}${resTip(e)}${heldTip}${sourceNotes(e).map((t) => `<br><span style="color:var(--accent)">» ${esc(t)}</span>`).join('')}`;
      if (e.kind === 'aha') {
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx},${cy})"><circle r="11" fill="url(#ahaGrad)" stroke="#0b0f1d" stroke-width="1.5"/><text y="4" text-anchor="middle" font-size="10" font-weight="800" fill="#1a1406">${e.type === 'AhaExtra' ? '+' : fmt(e.punchline, 0)}</text></g>`);
        continue;
      }
      if (e.kind === 'enemy' && e.type === 'Break') {
        parts.push(`<g data-tip="${attr(`<b>${esc(e.unit.name)}: Weakness Broken</b>${e.by ? `<br>by ${esc(e.by)}` : ''}<br>AV ${fmt(e.av, 2)}`)}" transform="translate(${cx},${cy - 4}) scale(1.6)"><path d="M-2,-7 L3,-1 L-1,0 L2,7 L-4,0 L0,-1 Z" fill="#ffd36e" stroke="#0b0f1d" stroke-width="0.8"/></g>`);
        continue;
      }
      if (e.kind === 'enemy') {
        const k = `enemy@${fmt(e.av, 3)}`; const dup = stackAt.get(k) || 0; stackAt.set(k, dup + 1);
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx + dup * 8},${cy})"><rect x="-7" y="-7" width="14" height="14" rx="3" fill="#5a2230" stroke="#ff7a8a"/></g>`);
        continue;
      }
      if (e.kind === 'char' && e.type === 'Elation') {
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx - 12},${cy + 21})"><path d="M0,-7 L2,-2 L7,0 L2,2 L0,7 L-2,2 L-7,0 L-2,-2 Z" fill="url(#ahaGrad)" stroke="#0b0f1d" stroke-width="1"/></g>`);
        continue;
      }
      if (e.kind === 'char' && e.type === 'FollowUp') {
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx - 12},${cy + 21})"><circle r="6" fill="#0b0f1d" stroke="${elColor(l.ch.element)}" stroke-width="2"/><text y="3" text-anchor="middle" font-size="7" font-weight="800" fill="#e7e9f3">F</text></g>`);
        continue;
      }
      if (e.kind === 'char' && e.type === 'Ultimate') {
        // Several Ultimates close together: fan the diamonds out so each one is visible.
        const k = `ult:${e.lane}@${Math.round(cx / 14)}`; const dup = stackAt.get(k) || 0; stackAt.set(k, dup + 1);
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx + dup * 13},${cy - 22})"><rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" fill="#e7c27d" stroke="#0b0f1d" stroke-width="1.5"/></g>`);
      } else if (e.kind === 'char') {
        const k = `${e.lane}@${fmt(e.av, 3)}`;
        const dup = stackAt.get(k) || 0;
        stackAt.set(k, dup + 1);
        const ox = dup * 10;
        const ring = e.type === 'Extra' ? '#7aa7ff' : elColor(l.ch.element);
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx + ox},${cy})" style="cursor:default">
          <circle r="17" fill="#0b0f1d" stroke="${ring}" stroke-width="2.5"/>
          ${chibi(l.ch.id, 34)}
          <g transform="translate(12,12)"><circle r="8" fill="#e7c27d"/><text y="3.5" text-anchor="middle" font-size="10" font-weight="700" fill="#1a1406">${e.n}</text></g>
          ${sourceBadge(e)}
        </g>`);
      } else if (e.kind === 'countdown') {
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx},${cy})"><path d="M-6,-8 H6 L-6,8 H6 Z" fill="none" stroke="#b9c0dc" stroke-width="1.6"/></g>`);
      } else {
        parts.push(`<g data-tip="${attr(tip)}" transform="translate(${cx},${cy})"><circle r="9" fill="#2a3458" stroke="${crossMarks(e).length ? elOf(crossMarks(e)[0].by) : '#8891b5'}"/><text y="3.5" text-anchor="middle" font-size="9" font-weight="700" fill="#e7e9f3">${e.n}</text></g>`);
      }
    }
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Action timeline">${parts.join('')}${tags.join('')}</svg>`;
  }
  // Chibis are full-body stickers, so they are drawn unclipped; plain avatars keep the round clip.
  const chibi = (id, size) => (CHARS[id] && CHARS[id].chibi
    ? `<image href="${img.avatar(id)}" x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}"/>`
    : `<image href="${img.avatar(id)}" x="-15" y="-15" width="30" height="30" clip-path="url(#clip-${id})"/>`);
  const ACT_NAME = { Final: 'final hit', Enhanced: 'enhanced', Summon: 'memosprite' };
  // Energy / Certified Banger / team SP after this event.
  const resTip = (e) => {
    if (e.kind !== 'char') return e.kind === 'aha' || e.kind === 'enemy' ? `<br>SP ${e.sp}` : '';
    const bits = [];
    if (e.maxEnergy > 0) bits.push(`Energy ${fmt(e.energy, 0)}/${e.maxEnergy}`);
    if (e.cb > 0) bits.push(`Certified Banger ${fmt(e.cb, 0)}`);
    bits.push(`SP ${e.sp}`);
    return `<br>${bits.join(' · ')}`;
  };

  // ---- where a turn's advances / extra turn came from (see Sim.note in engine.js)
  const pctStr = (p) => `${Math.round(p * 1000) / 10}%`;
  const markText = (m) => (m.kind === 'now' ? `Acts immediately: ${m.text}`
    : m.kind === 'extra' ? `Extra turn from ${m.text}` : `Advanced ${pctStr(m.amount)} by ${m.text}`);
  const sourceNotes = (e) => [...(e.grant ? [e.grant] : []), ...(e.advances || [])].map(markText);
  // Marks caused by someone else (not the unit's own kit, gear or countdown).
  const crossMarks = (e) => [...(e.grant ? [e.grant] : []), ...(e.advances || [])]
    .filter((m) => m.by !== e.unit && m.by !== e.unit.owner && !(e.unit.kind === 'char' && m.by.owner === e.unit));
  const elOf = (unit) => { const c = (unit.owner || unit).cfg; return c ? elColor(c.char.element) : '#8891b5'; };
  // Small badge on a turn marker: ">>" for an advance / pull, "+" for a granted extra turn,
  // in the source's element colour (grey when the character advanced itself).
  function sourceBadge(e) {
    const all = [...(e.grant ? [e.grant] : []), ...(e.advances || [])];
    if (!all.length) return '';
    const cross = crossMarks(e);
    const col = cross.length ? elOf(cross[0].by) : '#8891b5';
    const glyph = e.grant
      ? '<path d="M-3.5,0 H3.5 M0,-3.5 V3.5" stroke="#0b0f1d" stroke-width="1.8"/>'
      : '<path d="M-3.5,-3 L-0.5,0 L-3.5,3 M0.5,-3 L3.5,0 L0.5,3" fill="none" stroke="#0b0f1d" stroke-width="1.5"/>';
    return `<g transform="translate(-13,-13)"><circle r="7" fill="${col}" stroke="#0b0f1d" stroke-width="1.2"/>${glyph}</g>`;
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
