// Turns the calculator's UI state into simulator units and runs the simulation.
(function () {
  const { Sim } = window.AVEngine;
  const { kits, lightCones, relics } = window.AVEffects;
  const energyKits = window.AVEnergyKits || {};
  const ROPE_ERR = 0.1944; // 5★ Energy Regeneration Rate Link Rope at +15
  const DATA = window.HSR_DATA;
  const BOOTS_SPD = 25.032; // 5★ SPD boots at +15
  const MAX_SPD = 500; // the Speed field is capped here so a typo can't flood the simulation

  // Every endgame mode uses 150 AV then 100 AV per cycle, except Anomaly Arbitration (300 first).
  const MODES = {
    aa: { name: 'Anomaly Arbitration', first: 300, len: 100 },
    std: { name: 'MOC / PF / APOC', first: 150, len: 100 },
    custom: { name: 'Custom', first: 150, len: 100 },
  };
  const DEFAULT_CYCLES = 4;

  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const CHARS = byId(DATA.characters);
  const LCS = byId(DATA.lightCones);
  const RELICS = byId(DATA.relicSets);

  // Relic/LC/kit hook objects that apply to a slot.
  function effectsFor(slot, ch) {
    const out = [];
    const kit = kits[ch.id];
    if (kit) out.push({ src: 'kit', label: ch.name, ...kit });
    const ek = energyKits[ch.id];
    if (ek) out.push({ src: 'energy', label: ch.name, ...ek });
    const dk = window.AVDamage && window.AVDamage.kits[ch.id];
    if (dk) out.push({ src: 'damage', label: ch.name, ...dk });
    const lc = LCS[slot.lcId];
    // A light cone's passive only works on a character of the same Path.
    if (lc && lightCones[lc.id] && lc.path === ch.path) out.push({ src: 'lc', label: lc.name, ...lightCones[lc.id] });
    const sets = [];
    if (slot.set1 && slot.set2 === 'same') sets.push([slot.set1, 'two'], [slot.set1, 'four']);
    else {
      if (slot.set1) sets.push([slot.set1, 'two']);
      if (slot.set2 && slot.set2 !== 'same' && slot.set2 !== slot.set1) sets.push([slot.set2, 'two']);
    }
    if (slot.planar) sets.push([slot.planar, 'two']);
    for (const [id, pcs] of sets) {
      const e = relics[id] && relics[id][pcs];
      if (e) out.push({ src: 'relic', label: `${RELICS[id].name} (${pcs === 'two' ? '2' : '4'}pc)`, ...e });
    }
    return out;
  }

  // Energy Regeneration Rate: traces + relic set / light cone properties + ER rope.
  function errOf(slot) {
    const ch = CHARS[slot.charId];
    // A character-screen value typed in the Stats panel wins.
    if (slot.statTotals && slot.statTotals.err != null && slot.statTotals.err !== '') return +slot.statTotals.err;
    let err = (ch.combat.trace.err || 0);
    const add = (props) => (props || []).forEach((p) => { if (p.type === 'SPRatioBase') err += p.value; });
    const lc = LCS[slot.lcId];
    if (lc && lc.path === ch.path && lc.props) add(lc.props[(slot.lcS || 1) - 1]);
    const sets = [];
    if (slot.set1 && slot.set2 === 'same') sets.push([slot.set1, 0], [slot.set1, 1]);
    else { if (slot.set1) sets.push([slot.set1, 0]); if (slot.set2 && slot.set2 !== 'same') sets.push([slot.set2, 0]); }
    if (slot.planar) sets.push([slot.planar, 0]);
    for (const [id, k] of sets) { const r = RELICS[id]; if (r && r.props) add(r.props[k]); }
    if (slot.errRope) err += slot.errRopeValue != null ? +slot.errRopeValue : ROPE_ERR;
    return err;
  }

  // Does this build's Ultimate advance allies? 'single' (one chosen ally: Pearl, Robin •
  // Summeretto...), 'team' (everyone: Robin, Fugue E2, Dance! Dance! Dance!...) or null.
  function ultAdvanceKind(slot) {
    const kit = kits[slot.charId];
    if (kit && kit.advance === 'ult') return 'single';
    const team = kit && (typeof kit.ultAdvance === 'function' ? kit.ultAdvance({ eidolon: slot.eidolon || 0 }) : kit.ultAdvance);
    if (team) return 'team';
    const lc = LCS[slot.lcId], ch = CHARS[slot.charId];
    if (lc && ch && lc.id === '21018' && lc.path === ch.path) return 'team'; // Dance! Dance! Dance!
    return null;
  }
  // Single-target advancers default to holding the Ultimate until their target has acted;
  // team advancers default to firing as soon as it's ready. Both can be switched in the UI.
  // Ultimate timing: 'ready' (as soon as Energy / the kit resource is full), 'target' (held
  // until the ability target has acted; single-target advancers default to it) or 'schedule'
  // (manual "Ult after # / then every").
  function ultTimingOf(slot) {
    const kind = ultAdvanceKind(slot);
    const t = slot.ultTiming;
    if (t === 'schedule') return 'schedule';
    if (t === 'target' && kind) return 'target';
    if (t === 'ready') return 'ready';
    return kind === 'single' ? 'target' : 'ready';
  }

  // Out-of-combat SPD (what the character screen shows).
  function panelStats(slot) {
    const ch = CHARS[slot.charId];
    const unit = { cfg: { ...slot, char: ch, lc: LCS[slot.lcId], lcS: slot.lcS || 1, eidolon: slot.eidolon || 0 }, state: {} };
    let base = ch.spd, pct = (+slot.extraPct || 0) / 100;
    // Imported boots carry their exact main-stat value (level / rarity); otherwise assume 5★ +15.
    let flat = ch.traceSpd + (slot.boots ? (+slot.bootsSpd || BOOTS_SPD) : 0) + (+slot.subSpd || 0) + (+slot.extraFlat || 0);
    const effects = effectsFor(slot, ch);
    for (const e of effects) {
      if (!e.static) continue;
      const s = e.static(unit);
      base += s.base || 0;
      pct += s.pct || 0;
      flat += s.flat || 0;
    }
    let panel = base * (1 + pct) + flat;
    // The Speed field (character-screen SPD) wins unless it is still following the estimate.
    const typed = parseFloat(slot.spd);
    const override = !slot.spdAuto && typed > 0 ? Math.min(MAX_SPD, typed) : parseFloat(slot.override);
    if (!Number.isNaN(override) && override > 0) { flat += override - panel; panel = override; }
    return { ch, base, pct, flat, panel, effects };
  }

  function simulate(state) {
    const mode = MODES[state.mode] || MODES.std;
    const first = state.mode === 'custom' ? +state.customFirst || 150 : mode.first;
    const len = state.mode === 'custom' ? +state.customLen || 100 : mode.len;
    const cycles = Math.max(1, Math.min(60, +state.showCycles || DEFAULT_CYCLES));
    const maxAV = first + (cycles - 1) * len;
    const sim = new Sim({
      firstCycle: first, cycleLen: len, maxAV,
      enemies: state.enemies == null ? 2 : +state.enemies,
      enemySpd: +state.enemySpd || 120,
      enemyHits: state.enemyHits == null ? 1 : +state.enemyHits,
      enemyLevel: +state.enemyLevel || 95,
      enemyRes: state.enemyRes == null || state.enemyRes === '' ? 0.2 : +state.enemyRes / 100,
      enemyBroken: !!state.enemyBroken,
      enemyToughness: +state.enemyToughness || 160,
      elationAttacks: state.elationAttacks !== false,
    });

    const units = [];
    state.slots.forEach((slot, i) => {
      if (!slot || !CHARS[slot.charId]) return;
      const st = panelStats(slot);
      const u = sim.addUnit({
        key: `s${i}`, lane: `s${i}`, kind: 'char', name: st.ch.name, icon: slot.charId,
        base: st.base, pct: st.pct, flat: st.flat,
        maxEnergy: st.ch.combat.maxEnergy, errBase: errOf(slot),
        stats0: window.AVDamage ? window.AVDamage.staticStats(slot, { CHARS, LCS, RELICS }) : null,
        cfg: {
          ...slot, slot: i, char: st.ch, lc: LCS[slot.lcId], lcS: slot.lcS || 1, eidolon: slot.eidolon || 0,
          ultFirst: slot.ultMode === 'never' ? -1 : Math.max(1, +slot.ultFirst || 1),
          ultEvery: Math.max(1, +slot.ultEvery || 1),
          target: slot.target == null ? null : +slot.target,
          opts: slot.opts || {},
          ultTiming: ultTimingOf(slot),
        },
        hooks: st.effects,
      });
      units.push({ unit: u, stats: st, slot: i });
    });

    const events = sim.run();
    return { sim, events, units, first, len, cycles, maxAV, mode };
  }

  window.AVCalc = { errOf, ROPE_ERR, MAX_SPD, MODES, CHARS, LCS, RELICS, simulate, panelStats, effectsFor, BOOTS_SPD, ultAdvanceKind, ultTimingOf };
})();
