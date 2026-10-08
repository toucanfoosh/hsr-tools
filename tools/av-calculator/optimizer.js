// Relic optimizer: picks the 6 relic pieces from the imported inventory that maximize a goal
// (the character's damage, the team's damage, or the character's turns) in the current battle
// settings. Every candidate is scored by the real combat sim, so set effects, SPD breakpoints,
// Energy and buffs all count.
//
// Search:
//   1. Stat values: nudge each stat on the character and measure the goal in the sim.
//   2. Score every piece with those values; measure each relic / planar set bonus in the sim.
//   3. Assemble candidates for every set plan (4pc, 2pc + 2pc, any, × each planar) from the
//      best pieces per slot and set, rank them by score, and run the sim on the top ones.
//   4. Refine the best: swap one piece at a time while the sim improves.
(function () {
  const CAVERN = ['Head', 'Hands', 'Body', 'Feet'];
  const PLANAR = ['Planar Sphere', 'Link Rope'];
  const SLOTS = [...CAVERN, ...PLANAR];
  // Small steps for the stat values (per unit of each stat).
  const STEPS = { atkPct: 0.05, atk: 50, hpPct: 0.05, hp: 200, defPct: 0.05, def: 50, cr: 0.03, cd: 0.06, be: 0.06, ehr: 0.05, dmg: 0.05, elation: 0.05, spd: 3 };
  const SUB_KEY = {
    HP: 'hp', ATK: 'atk', DEF: 'def', HP_: 'hpPct', ATK_: 'atkPct', DEF_: 'defPct', 'CRIT Rate_': 'cr', 'CRIT DMG_': 'cd',
    'Effect Hit Rate_': 'ehr', 'Effect RES_': 'res', 'Break Effect_': 'be', SPD: 'spd',
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const A = () => window.HSRAccount;

  // The goal value of one simulation.
  function measure(r, slotIdx, goal) {
    const row = r.units.find((x) => x.slot === slotIdx);
    if (!row) return 0;
    if (goal === 'team') return r.units.reduce((a, x) => a + (x.unit.dmgTotal || 0), 0);
    if (goal === 'turns') {
      // Turns first, damage as the tie-break.
      const n = r.events.filter((e) => e.unit === row.unit && !e.nonTurn).length;
      return n * 1e12 + (row.unit.dmgTotal || 0);
    }
    return row.unit.dmgTotal || 0;
  }

  // Slot fields for a set of pieces (or a base slot with stat tweaks).
  function slotWith(base, pieces) {
    const b = A().relicBuild(pieces, base.charId);
    return {
      ...base, ...b,
      spd: '', spdAuto: true, override: '', extraPct: 0, extraFlat: 0,
      statTotals: undefined, fromAccount: false,
    };
  }
  function evaluate(state, slotIdx, slot, goal) {
    const st = { ...state, slots: state.slots.map((s, i) => (i === slotIdx ? slot : s)) };
    return measure(window.AVCalc.simulate(st), slotIdx, goal);
  }
  const panelSpd = (slot) => window.AVCalc.panelStats(slot).panel;

  // Main + sub stats of one piece in the sim's stat keys, SPD included.
  function pieceStats(p, element) {
    const out = { ...A().relicTotals([p], element) };
    let spd = 0;
    if (p.slot === 'Feet' && p.mainstat === 'SPD') spd += A().relicBuild([p], '').bootsSpd || 0;
    for (const s of p.substats || []) if (SUB_KEY[s.key] === 'spd') spd += s.value;
    out.spd = spd;
    return out;
  }

  async function run({ state, slotIdx, goal = 'dmg', allowWorn = true, minSpd = 0, mains = {}, minRarity = 5, onProgress = () => {}, isCancelled = () => false }) {
    const acc = A().data;
    if (!acc) throw new Error('Load your account first (Reliquary Archiver or an export file).');
    const base = state.slots[slotIdx];
    const charId = base.charId;
    const ch = window.AVCalc.CHARS[charId];
    const element = ch.element;
    const owner = (r) => (r.location ? A().normId(r.location) : '');
    const names = Object.fromEntries(window.HSR_DATA.characters.map((c) => [c.id, c.name]));

    // ---- piece pools
    const pool = {};
    for (const s of SLOTS) pool[s] = [];
    for (const r of acc.export.relics) {
      if (!pool[r.slot] || (r.rarity || 5) < minRarity) continue;
      const o = owner(r);
      if (o && o !== String(charId) && !allowWorn) continue;
      if (mains[r.slot] && mains[r.slot].length && !mains[r.slot].includes(r.mainstat)) continue;
      pool[r.slot].push(r);
    }
    for (const s of SLOTS) if (!pool[s].length) throw new Error(`No ${s} pieces match the filters.`);
    const equipped = acc.export.relics.filter((r) => owner(r) === String(charId));

    const relicSets = [...new Set(CAVERN.flatMap((s) => pool[s].map((p) => String(p.set_id))))];
    const planarSets = [...new Set(PLANAR.flatMap((s) => pool[s].map((p) => String(p.set_id))))];
    const SHORTLIST = 40, REFINE = 2 * SLOTS.length * 5;
    // The whole run's simulation count, known up front so the progress bar only moves forward.
    let steps = 0;
    let total = 1 + Object.keys(STEPS).length + 1 + relicSets.length * 2 + planarSets.length + SHORTLIST + REFINE;
    const progress = async (phase) => { steps += 1; onProgress({ phase, done: steps, total }); if (steps % 3 === 0) await tick(); if (isCancelled()) throw new Error('cancelled'); };

    // ---- 1. stat values at the current build
    const current = equipped.length ? slotWith(base, equipped) : { ...base };
    const m0 = evaluate(state, slotIdx, current, goal);
    const currentValue = m0;
    await progress('Measuring stat values');
    const weight = {};
    for (const [k, d] of Object.entries(STEPS)) {
      const t = k === 'spd' ? { ...current, subSpd: (+current.subSpd || 0) + d }
        : { ...current, relicStats: { ...(current.relicStats || {}), [k]: ((current.relicStats || {})[k] || 0) + d } };
      weight[k] = (evaluate(state, slotIdx, t, goal) - m0) / d;
      await progress('Measuring stat values');
    }
    const score = (stats) => Object.entries(stats).reduce((a, [k, v]) => a + (weight[k] || 0) * v, 0);
    for (const s of SLOTS) for (const p of pool[s]) { p._stats = pieceStats(p, element); p._score = score(p._stats); }

    // ---- 2. set bonus values (no sets vs 2pc / 4pc / planar)
    const bare = { ...current, set1: '', set2: 'same', planar: '' };
    const mb = evaluate(state, slotIdx, bare, goal);
    await progress('Measuring set bonuses');
    const bonus2 = {}, bonus4 = {}, bonusP = {};
    for (const id of relicSets) {
      bonus2[id] = evaluate(state, slotIdx, { ...bare, set1: id, set2: '__none' }, goal) - mb; await progress('Measuring set bonuses');
      bonus4[id] = evaluate(state, slotIdx, { ...bare, set1: id, set2: 'same' }, goal) - mb; await progress('Measuring set bonuses');
    }
    for (const id of planarSets) { bonusP[id] = evaluate(state, slotIdx, { ...bare, planar: id }, goal) - mb; await progress('Measuring set bonuses'); }

    // ---- 3. candidates per set plan
    const TOP = 3;
    const best = {}; // slot -> set -> top pieces; slot -> '*' -> top pieces
    for (const s of SLOTS) {
      best[s] = { '*': [...pool[s]].sort((a, b) => b._score - a._score).slice(0, TOP) };
      const by = {};
      for (const p of pool[s]) (by[String(p.set_id)] = by[String(p.set_id)] || []).push(p);
      for (const [id, list] of Object.entries(by)) best[s][id] = list.sort((a, b) => b._score - a._score).slice(0, TOP);
    }
    const pick = (s, set, k = 0) => (best[s][set] || [])[k];
    const cavernPlans = [{ name: 'any', slots: CAVERN.map((s) => [s, '*']), bonus: 0 }];
    for (const a of relicSets) {
      if (CAVERN.every((s) => pick(s, a))) cavernPlans.push({ name: `4pc ${a}`, slots: CAVERN.map((s) => [s, a]), bonus: bonus4[a] });
      for (const b of relicSets) {
        if (b <= a) continue;
        for (let mask = 0; mask < 16; mask++) {
          const bits = [0, 1, 2, 3].filter((i) => mask & (1 << i));
          if (bits.length !== 2) continue;
          const slots = CAVERN.map((s, i) => [s, bits.includes(i) ? a : b]);
          if (slots.every(([s, set]) => pick(s, set))) cavernPlans.push({ name: `2pc ${a} + 2pc ${b}`, slots, bonus: bonus2[a] + bonus2[b] });
        }
      }
      // 2pc of one set, the other two pieces anything.
      for (let mask = 0; mask < 16; mask++) {
        const bits = [0, 1, 2, 3].filter((i) => mask & (1 << i));
        if (bits.length !== 2) continue;
        const slots = CAVERN.map((s, i) => [s, bits.includes(i) ? a : '*']);
        if (slots.every(([s, set]) => pick(s, set))) cavernPlans.push({ name: `2pc ${a}`, slots, bonus: bonus2[a] });
      }
    }
    const planarPlans = [{ slots: PLANAR.map((s) => [s, '*']), bonus: 0 }];
    for (const p of planarSets) if (PLANAR.every((s) => pick(s, p))) planarPlans.push({ slots: PLANAR.map((s) => [s, p]), bonus: bonusP[p] });

    const cands = [];
    const seen = new Set();
    for (const cp of cavernPlans) {
      for (const pp of planarPlans) {
        // Best piece per slot for this plan, plus a variant with each slot's runner-up.
        const slots = [...cp.slots, ...pp.slots];
        for (let alt = -1; alt < slots.length; alt++) {
          const pieces = slots.map(([s, set], i) => pick(s, set, i === alt ? 1 : 0));
          if (pieces.some((p) => !p)) continue;
          const key = pieces.map((p) => p._uid).sort().join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          cands.push({ pieces, est: pieces.reduce((a, p) => a + p._score, 0) + cp.bonus + pp.bonus });
        }
      }
    }
    cands.sort((a, b) => b.est - a.est);
    const shortlist = [];
    for (const c of cands) {
      if (shortlist.length >= SHORTLIST) break;
      if (minSpd > 0 && panelSpd(slotWith(base, c.pieces)) < minSpd - 1e-6) continue;
      shortlist.push(c);
    }
    if (!shortlist.length) throw new Error(minSpd > 0 ? `No build reaches ${minSpd} SPD with these pieces.` : 'No builds found.');

    // ---- 4. full sims on the shortlist, then piece swaps on the best
    total -= SHORTLIST - shortlist.length; // fewer candidates than planned
    for (const c of shortlist) { c.slot = slotWith(base, c.pieces); c.value = evaluate(state, slotIdx, c.slot, goal); await progress('Simulating builds'); }
    shortlist.sort((a, b) => b.value - a.value);
    let top = shortlist[0];
    for (let pass = 0; pass < 2; pass++) {
      let improved = false;
      for (let i = 0; i < SLOTS.length; i++) {
        const s = SLOTS[i];
        const alts = [...pool[s]].sort((a, b) => b._score - a._score).filter((p) => p._uid !== top.pieces[i]._uid).slice(0, 5);
        for (const p of alts) {
          const pieces = top.pieces.map((q, k) => (k === i ? p : q));
          const slot = slotWith(base, pieces);
          if (minSpd > 0 && panelSpd(slot) < minSpd - 1e-6) { await progress('Refining'); continue; }
          const value = evaluate(state, slotIdx, slot, goal);
          if (value > top.value * (1 + 1e-9)) { top = { pieces, slot, value }; improved = true; }
          await progress('Refining');
        }
      }
      if (!improved) { total = steps; break; } // converged: skip the remaining refinement
    }
    onProgress({ phase: 'Done', done: total, total });

    const results = [top, ...shortlist.filter((c) => c !== top)]
      .filter((c, i, arr) => arr.findIndex((d) => d.pieces.map((p) => p._uid).sort().join() === c.pieces.map((p) => p._uid).sort().join()) === i)
      .slice(0, 5)
      .map((c) => ({
        value: c.value,
        slot: c.slot,
        spd: panelSpd(c.slot),
        pieces: c.pieces.map((p) => ({ ...p, wornBy: owner(p) && owner(p) !== String(charId) ? names[owner(p)] || 'another character' : '' })),
      }));
    return { results, currentValue, weights: weight, goal };
  }

  window.AVOptimizer = { run, measure, SLOTS };
})();
