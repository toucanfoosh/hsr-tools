// Turns the calculator's UI state into simulator units and runs the simulation.
(function () {
  const { Sim } = window.AVEngine;
  const { kits, lightCones, relics } = window.AVEffects;
  const DATA = window.HSR_DATA;
  const BOOTS_SPD = 25.032; // 5★ SPD boots at +15

  const MODES = {
    moc: { name: 'Memory of Chaos', first: 150, len: 100, limit: 30, show: 5, note: 'First cycle 150 AV, then 100 AV. The cycle count carries across both halves.' },
    pf: { name: 'Pure Fiction', first: 150, len: 100, limit: 4, show: 4, note: 'First cycle 150 AV, then 100 AV. 4 cycles per side.' },
    as: { name: 'Apocalyptic Shadow', first: 150, len: 100, limit: 4, show: 4, note: 'First cycle 150 AV, then 100 AV. 4 cycles per side.' },
    aa: { name: 'Anomaly Arbitration', first: 300, len: 100, limit: 6, show: 6, note: 'First cycle is 300 AV and does not reset between waves, then 100 AV. 6 cycles.' },
    su: { name: 'Simulated / Divergent Universe', first: 150, len: 100, limit: null, show: 5, note: 'No cycle limit. First cycle 150 AV, then 100 AV.' },
    custom: { name: 'Custom', first: 150, len: 100, limit: null, show: 5, note: 'Set your own cycle lengths.' },
  };

  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const CHARS = byId(DATA.characters);
  const LCS = byId(DATA.lightCones);
  const RELICS = byId(DATA.relicSets);

  // Relic/LC/kit hook objects that apply to a slot.
  function effectsFor(slot, ch) {
    const out = [];
    const kit = kits[ch.id];
    if (kit) out.push({ src: 'kit', label: ch.name, ...kit });
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

  // Out-of-combat SPD (what the character screen shows).
  function panelStats(slot) {
    const ch = CHARS[slot.charId];
    const unit = { cfg: { ...slot, char: ch, lc: LCS[slot.lcId], lcS: slot.lcS || 1, eidolon: slot.eidolon || 0 }, state: {} };
    let base = ch.spd, pct = (+slot.extraPct || 0) / 100;
    let flat = ch.traceSpd + (slot.boots ? BOOTS_SPD : 0) + (+slot.subSpd || 0) + (+slot.extraFlat || 0);
    const effects = effectsFor(slot, ch);
    for (const e of effects) {
      if (!e.static) continue;
      const s = e.static(unit);
      base += s.base || 0;
      pct += s.pct || 0;
      flat += s.flat || 0;
    }
    let panel = base * (1 + pct) + flat;
    const override = parseFloat(slot.override);
    if (!Number.isNaN(override) && override > 0) { flat += override - panel; panel = override; }
    return { ch, base, pct, flat, panel, effects };
  }

  function simulate(state) {
    const mode = MODES[state.mode] || MODES.moc;
    const first = state.mode === 'custom' ? +state.customFirst || 150 : mode.first;
    const len = state.mode === 'custom' ? +state.customLen || 100 : mode.len;
    const cycles = Math.max(1, Math.min(60, +state.showCycles || mode.show));
    const maxAV = first + (cycles - 1) * len;
    const sim = new Sim({ firstCycle: first, cycleLen: len, maxAV });

    const units = [];
    state.slots.forEach((slot, i) => {
      if (!slot || !CHARS[slot.charId]) return;
      const st = panelStats(slot);
      const u = sim.addUnit({
        key: `s${i}`, lane: `s${i}`, kind: 'char', name: st.ch.name, icon: slot.charId,
        base: st.base, pct: st.pct, flat: st.flat,
        cfg: {
          ...slot, slot: i, char: st.ch, lc: LCS[slot.lcId], lcS: slot.lcS || 1, eidolon: slot.eidolon || 0,
          ultFirst: slot.ultMode === 'never' ? -1 : Math.max(0, +slot.ultFirst || 0),
          ultEvery: Math.max(1, +slot.ultEvery || 1),
          target: slot.target == null ? null : +slot.target,
        },
        hooks: st.effects,
      });
      units.push({ unit: u, stats: st, slot: i });
    });

    const events = sim.run();
    return { sim, events, units, first, len, cycles, maxAV, mode };
  }

  window.AVCalc = { MODES, CHARS, LCS, RELICS, simulate, panelStats, effectsFor, BOOTS_SPD };
})();
