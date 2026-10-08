// Inventory: everything synced from Reliquary Archiver (characters, light cones, relics), with
// manual edits. Edits change the saved account directly, so the Combat Sim and the optimizer
// use them; the next "Sync all" replaces everything with the real account again.
(function () {
  const { esc, openModal, CDN } = window.HSRTools;
  const Account = window.HSRAccount;
  const DATA = window.HSR_DATA;
  const byId = (list) => Object.fromEntries(list.map((x) => [String(x.id), x]));
  const CHARS = byId(DATA.characters), LCS = byId(DATA.lightCones), SETS = byId(DATA.relicSets);
  const img = {
    avatar: (id) => (CHARS[id] && CHARS[id].chibi ? `assets/chibi/${id}.png` : `${CDN}icon/avatar/${id}.png`),
    lc: (id) => `assets/light-cones/icon/${id}.png`,
    relic: (id) => `assets/relics/${id}.png`,
  };
  const attr = (s) => String(s).replace(/"/g, '&quot;');
  const SLOTS = ['Head', 'Hands', 'Body', 'Feet', 'Planar Sphere', 'Link Rope'];
  const SLOT_SHORT = { 'Planar Sphere': 'Sphere', 'Link Rope': 'Rope' };
  const ELEMENT_MAINS = ['Physical', 'Fire', 'Ice', 'Lightning', 'Wind', 'Quantum', 'Imaginary'].map((e) => `${e} DMG Boost`);
  const MAINS = {
    Head: ['HP'], Hands: ['ATK'],
    Body: ['HP', 'ATK', 'DEF', 'CRIT Rate', 'CRIT DMG', 'Effect Hit Rate', 'Outgoing Healing Boost'],
    Feet: ['HP', 'ATK', 'DEF', 'SPD'],
    'Planar Sphere': ['HP', 'ATK', 'DEF', ...ELEMENT_MAINS],
    'Link Rope': ['HP', 'ATK', 'DEF', 'Break Effect', 'Energy Regeneration Rate'],
  };
  const SUBS = [['HP', 'HP'], ['ATK', 'ATK'], ['DEF', 'DEF'], ['HP_', 'HP%'], ['ATK_', 'ATK%'], ['DEF_', 'DEF%'], ['SPD', 'SPD'],
    ['CRIT Rate_', 'CRIT Rate%'], ['CRIT DMG_', 'CRIT DMG%'], ['Effect Hit Rate_', 'Effect Hit Rate%'], ['Effect RES_', 'Effect RES%'], ['Break Effect_', 'Break Effect%']];
  const SUB_NAME = Object.fromEntries(SUBS);
  const isPlanarSlot = (slot) => slot === 'Planar Sphere' || slot === 'Link Rope';
  const relicSets = DATA.relicSets.filter((r) => !r.planar), planarSets = DATA.relicSets.filter((r) => r.planar);
  const norm = (id) => (Account.normId ? Account.normId(id) : String(id));
  const charName = (id) => (CHARS[norm(id)] ? CHARS[norm(id)].name : `#${id}`);
  const subText = (x) => `${SUB_NAME[x.key] ? SUB_NAME[x.key].replace('%', '') : x.key} ${x.key.endsWith('_') ? `${(+x.value).toFixed(1)}%` : Math.round(+x.value * 10) / 10}`;
  const PAGE = 240;

  let root = null, view = 'chars', relicFilter = { slot: '', set: '', main: '', owner: '', q: '' }, shown = PAGE;

  function mount(el) {
    root = el;
    root.innerHTML = `
      <h1 class="tool-title">Inventory</h1>
      <p class="tool-sub">Everything synced from your account. Edit anything here to test builds; <b>Sync all</b> (next to the archiver status) replaces it all with your real account again.</p>
      <div class="card inv-bar" data-bar></div>
      <div class="inv-tabs" data-tabs></div>
      <div data-view></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    if (!mount.listening) { mount.listening = true; Account.onChange(() => { if (root && root.isConnected) render(); }); }
    render();
  }

  function render() {
    const acc = Account.data;
    const exp = acc && acc.export;
    root.querySelector('[data-bar]').innerHTML = exp
      ? `<div><b>${exp.metadata && exp.metadata.uid ? `UID ${exp.metadata.uid}` : 'Account'}</b> · ${exp.characters.length} characters · ${exp.light_cones.length} light cones · ${exp.relics.length} relics
          ${acc.edited ? '<span class="inv-edited">edited here</span>' : ''}</div>
          <div class="muted small">${acc.source === 'archiver' ? 'From Reliquary Archiver' : acc.source === 'file' ? 'From an imported file' : 'Made by hand'}${acc.edited ? '. Sync all to undo your edits.' : ''}</div>`
      : `<div class="muted">No account yet. <a href="#" data-account>Connect Reliquary Archiver or import a file</a>, or start adding characters by hand below.</div>`;
    const counts = { chars: exp ? exp.characters.length : 0, lcs: exp ? exp.light_cones.length : 0, relics: exp ? exp.relics.length : 0 };
    root.querySelector('[data-tabs]').innerHTML = [['chars', 'Characters'], ['lcs', 'Light cones'], ['relics', 'Relics']]
      .map(([k, l]) => `<button class="pill toggle${view === k ? ' on' : ''}" data-view-tab="${k}">${l} <span class="dim">${counts[k]}</span></button>`).join('');
    const v = root.querySelector('[data-view]');
    v.innerHTML = view === 'chars' ? charsView(exp) : view === 'lcs' ? lcsView(exp) : relicsView(exp);
  }

  // ---------------------------------------------------------------- characters
  function charsView(exp) {
    const list = exp ? [...exp.characters].sort((a, b) => charName(a.id).localeCompare(charName(b.id))) : [];
    const lcOf = (cid) => exp.light_cones.find((l) => l.location && norm(l.location) === norm(cid));
    const relicsOf = (cid) => exp.relics.filter((r) => r.location && norm(r.location) === norm(cid));
    return `<div class="inv-actions"><button class="btn" data-add-char>+ Add character</button></div>
      <div class="inv-grid">${list.map((c) => {
        const id = norm(c.id), ch = CHARS[id], lc = lcOf(c.id), rs = relicsOf(c.id);
        const sets = [...new Set(rs.map((r) => String(r.set_id)))];
        return `<div class="card inv-char">
          <img class="inv-avatar" src="${img.avatar(id)}" alt="">
          <div class="inv-char-body">
            <div class="inv-char-name">${esc(ch ? ch.name : `#${c.id}`)} <span class="muted small">Lv. ${c.level || 80}</span></div>
            <div class="inv-row">
              <select data-char-eid="${attr(c.id)}" aria-label="Eidolon">${[0, 1, 2, 3, 4, 5, 6].map((e) => `<option value="${e}"${(c.eidolon || 0) === e ? ' selected' : ''}>E${e}</option>`).join('')}</select>
              <select data-char-lc="${attr(c.id)}" aria-label="Light cone"><option value="">No light cone</option>${exp.light_cones.map((l) => `<option value="${attr(l._uid)}"${lc && lc._uid === l._uid ? ' selected' : ''}>${esc(LCS[String(l.id)] ? LCS[String(l.id)].name : l.id)} S${l.superimposition || 1}${l.location && (!lc || l._uid !== lc._uid) ? ` (on ${esc(charName(l.location))})` : ''}</option>`).join('')}</select>
            </div>
            <div class="inv-sets">${sets.map((sid) => `<img src="${img.relic(sid)}" title="${attr(SETS[sid] ? SETS[sid].name : sid)}" alt="">`).join('')}<span class="muted small">${rs.length}/6 relics</span></div>
          </div>
          <button class="btn ghost inv-x" data-del-char="${attr(c.id)}" title="Remove from inventory">✕</button>
        </div>`;
      }).join('') || '<div class="muted small">No characters.</div>'}</div>`;
  }

  // ---------------------------------------------------------------- light cones
  function lcsView(exp) {
    const list = exp ? [...exp.light_cones].sort((a, b) => (LCS[String(b.id)] || {}).rarity - (LCS[String(a.id)] || {}).rarity || String((LCS[String(a.id)] || {}).name).localeCompare(String((LCS[String(b.id)] || {}).name))) : [];
    return `<div class="inv-actions"><button class="btn" data-add-lc>+ Add light cone</button></div>
      <div class="inv-grid">${list.map((l) => {
        const d = LCS[String(l.id)];
        return `<div class="card inv-lc">
          <img src="${img.lc(String(l.id))}" alt="">
          <div class="inv-char-body">
            <div class="inv-char-name">${esc(d ? d.name : `#${l.id}`)}</div>
            <div class="muted small">${d ? `${'★'.repeat(d.rarity)} · ${esc(d.path)}` : ''}</div>
            <div class="inv-row">
              <select data-lc-s="${attr(l._uid)}" aria-label="Superimposition">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${(l.superimposition || 1) === n ? ' selected' : ''}>S${n}</option>`).join('')}</select>
              <select data-lc-on="${attr(l._uid)}" aria-label="Equipped on"><option value="">Not equipped</option>${exp.characters.map((c) => `<option value="${attr(c.id)}"${l.location && norm(l.location) === norm(c.id) ? ' selected' : ''}>${esc(charName(c.id))}</option>`).join('')}</select>
            </div>
          </div>
          <button class="btn ghost inv-x" data-del-lc="${attr(l._uid)}" title="Remove from inventory">✕</button>
        </div>`;
      }).join('') || '<div class="muted small">No light cones.</div>'}</div>`;
  }

  // ---------------------------------------------------------------- relics
  function relicMatches(r) {
    const f = relicFilter;
    if (f.slot && r.slot !== f.slot) return false;
    if (f.set && String(r.set_id) !== f.set) return false;
    if (f.main && r.mainstat !== f.main) return false;
    if (f.owner === '-' && r.location) return false;
    if (f.owner && f.owner !== '-' && !(r.location && norm(r.location) === norm(f.owner))) return false;
    if (f.q) {
      const hay = `${SETS[String(r.set_id)] ? SETS[String(r.set_id)].name : ''} ${r.mainstat} ${(r.substats || []).map((x) => SUB_NAME[x.key] || x.key).join(' ')}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  }
  function relicCard(r) {
    const set = SETS[String(r.set_id)];
    return `<button type="button" class="card inv-relic${r._custom ? ' custom' : ''}" data-edit-relic="${attr(r._uid)}" title="${attr(set ? set.name : '')}">
      <img class="inv-relic-set" src="${img.relic(String(r.set_id))}" alt="">
      <div class="inv-relic-body">
        <div><b>${SLOT_SHORT[r.slot] || r.slot}</b> <span class="muted">+${r.level || 0}</span> <span class="inv-stars">${'★'.repeat(r.rarity || 5)}</span></div>
        <div class="inv-main">${esc(r.mainstat)}</div>
        <div class="inv-subs">${(r.substats || []).map(subText).map(esc).join(' · ')}</div>
        ${r.location ? `<div class="inv-on"><img src="${img.avatar(norm(r.location))}" alt=""> ${esc(charName(r.location))}</div>` : ''}
        ${r._custom ? '<div class="inv-edited">custom</div>' : ''}
      </div></button>`;
  }
  function relicsView(exp) {
    if (!exp) return '<div class="muted small">No relics.</div>';
    const f = relicFilter;
    const all = exp.relics.filter(relicMatches);
    const list = all.slice(0, shown);
    const mains = [...new Set(exp.relics.filter((r) => !f.slot || r.slot === f.slot).map((r) => r.mainstat))].sort();
    const setIds = [...new Set(exp.relics.map((r) => String(r.set_id)))].filter((id) => SETS[id]).sort((a, b) => SETS[a].name.localeCompare(SETS[b].name));
    return `<div class="inv-actions inv-filters">
        <input type="search" placeholder="Search set, main or substat…" data-rf="q" value="${attr(f.q)}">
        <select data-rf="slot"><option value="">All slots</option>${SLOTS.map((sl) => `<option value="${sl}"${f.slot === sl ? ' selected' : ''}>${SLOT_SHORT[sl] || sl}</option>`).join('')}</select>
        <select data-rf="set"><option value="">All sets</option>${setIds.map((id) => `<option value="${id}"${f.set === id ? ' selected' : ''}>${esc(SETS[id].name)}</option>`).join('')}</select>
        <select data-rf="main"><option value="">All main stats</option>${mains.map((m) => `<option value="${attr(m)}"${f.main === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>
        <select data-rf="owner"><option value="">Anyone</option><option value="-"${f.owner === '-' ? ' selected' : ''}>Not equipped</option>${exp.characters.map((c) => `<option value="${attr(c.id)}"${f.owner && f.owner !== '-' && norm(f.owner) === norm(c.id) ? ' selected' : ''}>${esc(charName(c.id))}</option>`).join('')}</select>
        <button class="btn" data-add-relic>+ Add relic</button>
      </div>
      <div class="muted small inv-count">${all.length} of ${exp.relics.length} relics${all.length > list.length ? ` · showing ${list.length}` : ''}</div>
      <div class="inv-relics">${list.map(relicCard).join('')}</div>
      ${all.length > list.length ? '<div class="inv-actions"><button class="btn" data-more>Show more</button></div>' : ''}`;
  }

  // Relic editor (new or existing).
  function openRelicEditor(uid) {
    const exp = Account.data && Account.data.export;
    const orig = uid && exp ? exp.relics.find((r) => r._uid === uid) : null;
    const r = orig ? JSON.parse(JSON.stringify(orig)) : { _uid: `custom-${Date.now().toString(36)}`, _custom: true, slot: 'Head', set_id: Number(relicSets[0].id), rarity: 5, level: 15, mainstat: 'HP', substats: [], location: '' };
    while (r.substats.length < 4) r.substats.push({ key: '', value: 0 });
    const chars = exp ? exp.characters : [];
    const m = openModal(`<div class="card modal-box inv-editor" role="dialog" aria-label="Edit relic">
        <div class="modal-head"><div class="top"><h3>${orig ? 'Edit relic' : 'New relic'}</h3><button class="btn ghost" data-close>Close</button></div></div>
        <div class="inv-form" data-form></div>
        <div class="inv-form-actions">${orig ? '<button class="btn ghost danger" data-delete>Delete</button>' : ''}<button class="btn primary" data-save>Save</button></div>
      </div>`);
    const form = m.el.querySelector('[data-form]');
    const draw = () => {
      const sets = isPlanarSlot(r.slot) ? planarSets : relicSets;
      if (!sets.some((x) => String(x.id) === String(r.set_id))) r.set_id = Number(sets[0].id);
      if (!MAINS[r.slot].includes(r.mainstat)) r.mainstat = MAINS[r.slot][0];
      form.innerHTML = `
        <label class="field"><span>Slot</span><select data-e="slot">${SLOTS.map((sl) => `<option${r.slot === sl ? ' selected' : ''}>${sl}</option>`).join('')}</select></label>
        <label class="field"><span>Set</span><select data-e="set_id">${sets.map((x) => `<option value="${x.id}"${String(r.set_id) === String(x.id) ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Main stat</span><select data-e="mainstat">${MAINS[r.slot].map((mn) => `<option${r.mainstat === mn ? ' selected' : ''}>${esc(mn)}</option>`).join('')}</select></label>
        <label class="field num"><span>Level</span><input type="number" min="0" max="15" data-e="level" value="${r.level}"></label>
        <label class="field num"><span>Rarity</span><select data-e="rarity">${[5, 4, 3, 2].map((n) => `<option value="${n}"${r.rarity === n ? ' selected' : ''}>${n}★</option>`).join('')}</select></label>
        <label class="field"><span>Equipped on</span><select data-e="location"><option value="">Not equipped</option>${chars.map((c) => `<option value="${attr(c.id)}"${r.location && norm(r.location) === norm(c.id) ? ' selected' : ''}>${esc(charName(c.id))}</option>`).join('')}</select></label>
        <div class="field inv-subs-edit"><span>Substats (percent stats in %)</span>${r.substats.map((x, k) => `<div class="inv-row">
          <select data-sub-key="${k}"><option value="">None</option>${SUBS.map(([key, lab]) => `<option value="${attr(key)}"${x.key === key ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>
          <input type="number" step="0.1" min="0" data-sub-val="${k}" value="${x.key ? x.value : ''}" ${x.key ? '' : 'disabled'}></div>`).join('')}</div>`;
    };
    draw();
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.e) {
        const k = t.dataset.e;
        r[k] = ['level', 'rarity', 'set_id'].includes(k) ? +t.value : t.value;
        if (k === 'slot' || k === 'set_id') draw();
        return;
      }
      if (t.dataset.subKey !== undefined) { r.substats[+t.dataset.subKey].key = t.value; draw(); }
      if (t.dataset.subVal !== undefined) r.substats[+t.dataset.subVal].value = +t.value || 0;
    });
    m.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return m.close();
      if (e.target.closest('[data-delete]')) {
        Account.edit((x) => { x.relics = x.relics.filter((q) => q._uid !== uid); });
        return m.close();
      }
      if (e.target.closest('[data-save]')) {
        const clean = { ...r, substats: r.substats.filter((x) => x.key && +x.value > 0), level: Math.max(0, Math.min(15, +r.level || 0)) };
        Account.edit((x) => {
          // One piece per slot on a character: the old one comes off.
          if (clean.location) x.relics.forEach((q) => { if (q._uid !== clean._uid && q.slot === clean.slot && q.location && norm(q.location) === norm(clean.location)) q.location = ''; });
          const at = x.relics.findIndex((q) => q._uid === clean._uid);
          if (at >= 0) x.relics[at] = clean; else x.relics.push(clean);
        });
        m.close();
      }
    });
  }

  // Add a character / light cone from the full list.
  function openAddPicker(kind) {
    const exp = Account.data && Account.data.export;
    const owned = new Set(exp ? exp.characters.map((c) => norm(c.id)) : []);
    const items = kind === 'char'
      ? DATA.characters.filter((c) => !owned.has(String(c.id))).map((c) => ({ id: String(c.id), name: c.name, src: img.avatar(String(c.id)), sub: `${c.path}` }))
      : DATA.lightCones.map((l) => ({ id: String(l.id), name: l.name, src: img.lc(String(l.id)), sub: `${'★'.repeat(l.rarity)} · ${l.path}` }));
    const m = openModal(`<div class="card modal-box" role="dialog" aria-label="Add">
        <div class="modal-head"><div class="top"><h3>Add ${kind === 'char' ? 'a character' : 'a light cone'}</h3><button class="btn ghost" data-close>Close</button></div>
        <input type="search" placeholder="Search…" data-q></div>
        <div class="inv-add-list" data-list></div></div>`);
    const listEl = m.el.querySelector('[data-list]');
    const draw = (q = '') => {
      listEl.innerHTML = items.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase())).map((x) =>
        `<button type="button" class="inv-add-item" data-pick="${attr(x.id)}"><img src="${x.src}" alt=""><span><b>${esc(x.name)}</b><span class="muted small">${esc(x.sub)}</span></span></button>`).join('') || '<div class="muted small">Nothing to add.</div>';
    };
    draw();
    m.el.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
    m.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return m.close();
      const p = e.target.closest('[data-pick]');
      if (!p) return;
      const id = p.dataset.pick;
      Account.edit((x) => {
        if (kind === 'char') x.characters.push({ id, eidolon: 0, level: 80, _custom: true });
        else x.light_cones.push({ _uid: `custom-${Date.now().toString(36)}`, id: Number(id), superimposition: 1, level: 80, location: '', _custom: true });
      });
      m.close();
    });
  }

  // ---------------------------------------------------------------- events
  function onClick(e) {
    const t = e.target;
    if (t.closest('[data-account]')) { e.preventDefault(); window.HSRTools.openAccount(); return; }
    const tab = t.closest('[data-view-tab]');
    if (tab) { view = tab.dataset.viewTab; shown = PAGE; render(); return; }
    if (t.closest('[data-add-char]')) return openAddPicker('char');
    if (t.closest('[data-add-lc]')) return openAddPicker('lc');
    if (t.closest('[data-add-relic]')) return openRelicEditor(null);
    if (t.closest('[data-more]')) { shown += PAGE; render(); return; }
    const er = t.closest('[data-edit-relic]');
    if (er) return openRelicEditor(er.dataset.editRelic);
    const dc = t.closest('[data-del-char]');
    if (dc && confirm(`Remove ${charName(dc.dataset.delChar)} from the inventory? Their gear is unequipped.`)) {
      const id = norm(dc.dataset.delChar);
      Account.edit((x) => {
        x.characters = x.characters.filter((c) => norm(c.id) !== id);
        [...x.relics, ...x.light_cones].forEach((q) => { if (q.location && norm(q.location) === id) q.location = ''; });
      });
      return;
    }
    const dl = t.closest('[data-del-lc]');
    if (dl) Account.edit((x) => { x.light_cones = x.light_cones.filter((l) => l._uid !== dl.dataset.delLc); });
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.charEid) { const id = norm(t.dataset.charEid); Account.edit((x) => { const c = x.characters.find((q) => norm(q.id) === id); if (c) c.eidolon = +t.value; }); return; }
    if (t.dataset.charLc !== undefined) {
      const id = norm(t.dataset.charLc), uid = t.value;
      Account.edit((x) => {
        x.light_cones.forEach((l) => { if (l.location && norm(l.location) === id) l.location = ''; });
        const l = x.light_cones.find((q) => q._uid === uid);
        if (l) l.location = id;
      });
      return;
    }
    if (t.dataset.lcS) { Account.edit((x) => { const l = x.light_cones.find((q) => q._uid === t.dataset.lcS); if (l) l.superimposition = +t.value; }); return; }
    if (t.dataset.lcOn !== undefined) {
      const uid = t.dataset.lcOn, id = t.value ? norm(t.value) : '';
      Account.edit((x) => {
        if (id) x.light_cones.forEach((l) => { if (l._uid !== uid && l.location && norm(l.location) === id) l.location = ''; });
        const l = x.light_cones.find((q) => q._uid === uid);
        if (l) l.location = id;
      });
      return;
    }
    if (t.dataset.rf && t.dataset.rf !== 'q') { relicFilter[t.dataset.rf] = t.value; if (t.dataset.rf === 'slot') relicFilter.main = ''; shown = PAGE; render(); }
  }
  function onInput(e) {
    if (e.target.dataset.rf === 'q') {
      relicFilter.q = e.target.value; shown = PAGE;
      const pos = e.target.selectionStart;
      render();
      const q = root.querySelector('[data-rf="q"]'); q.focus(); q.setSelectionRange(pos, pos);
    }
  }

  window.HSRTools.register({ id: 'inventory', title: 'Inventory', mount });
})();
