// Speed / turn-order effects that the simulator models.
// Each entry is a set of hooks the engine calls (see engine.js): battleStart, turnStart,
// actionType, action, allyAction, allyUlt, ult, canUlt, turnEnd, plus static(u) for
// out-of-combat stat changes. `desc` is shown in the UI so users know what is simulated.
(function () {
  const ATTACKS = new Set(['Basic', 'Skill', 'Enhanced', 'Extra']);
  const DEFAULT_LEVEL = { Normal: 6, BPSkill: 10, Ultra: 10, Talent: 10 };

  // Skill parameter at the level implied by the character's eidolon (E3/E5 add levels).
  function P(u, type, idx) {
    const ch = u.cfg.char, s = ch.skills[type];
    if (!s) return 0;
    let lvl = DEFAULT_LEVEL[type];
    for (const [rank, ups] of Object.entries(ch.levelUps || {})) {
      if (+rank <= u.cfg.eidolon && ups[type]) lvl += ups[type];
    }
    lvl = Math.min(lvl, s.max, s.params.length);
    return s.params[lvl - 1][idx];
  }
  const E = (u) => u.cfg.eidolon;
  const LP = (u, idx) => u.cfg.lc.params[u.cfg.lcS - 1][idx];
  function target(sim, u) {
    const allies = sim.allies(u);
    return allies.find((a) => a.cfg.slot === u.cfg.target) || allies[0] || null;
  }
  const summonsOf = (sim, owner) => sim.units.filter((x) => x.alive && x.kind === 'summon' && x.owner === owner);
  const summonNamed = (sim, owner, name) => summonsOf(sim, owner).find((x) => x.name === name);
  function summon(sim, owner, name, spd, extra = {}) {
    return sim.spawn({ key: `${owner.key}:${name}`, name, owner, fixedSpd: spd, icon: owner.icon, ...extra });
  }

  // ---------------------------------------------------------------- characters
  const kits = {
    1009: { // Asta
      desc: 'Ultimate: all allies +SPD (flat) for 2 turns.',
      ult(sim, u) { const v = P(u, 'Ultra', 0); sim.chars().forEach((a) => sim.addBuff(a, { id: 'asta', flat: v, turns: 2 })); },
    },
    1101: { // Bronya
      desc: 'Skill: target takes action immediately. Talent: Basic ATK advances next action. E2: skill target +30% SPD for 1 turn after acting.',
      action(sim, u, t) {
        if (t === 'Skill') {
          const tg = target(sim, u);
          if (tg) { sim.actNow(tg); if (E(u) >= 2) u.state.e2 = tg; }
        }
        if (t === 'Basic') sim.advance(u, P(u, 'Talent', 0));
      },
      allyAction(sim, u, actor) {
        if (u.state.e2 === actor) { sim.addBuff(actor, { id: 'bronyaE2', pct: 0.3, turns: 1 }); u.state.e2 = null; }
      },
    },
    1102: { // Seele
      desc: 'Skill: +SPD% for 2 turns (E2: stacks twice). Trace: Basic ATK advances next action 20%.',
      action(sim, u, t) {
        if (t === 'Skill') sim.addBuff(u, { id: 'seele', pct: P(u, 'BPSkill', 1), turns: P(u, 'BPSkill', 2), maxStacks: E(u) >= 2 ? 2 : 1 });
        if (t === 'Basic') sim.advance(u, 0.2);
      },
    },
    1109: { desc: 'Trace: after Ultimate, advances action 20%.', ult(sim, u) { sim.advance(u, 0.2); } }, // Hook
    1112: { // Topaz & Numby
      desc: 'Summons Numby (80 SPD). Skill advances Numby 50%. Ultimate: next 2 Numby turns, ally attacks advance Numby 50%. E4: Numby turn advances Topaz 20%.',
      battleStart(sim, u) {
        u.state.numby = summon(sim, u, 'Numby', P(u, 'Talent', 0), {
          onTurn(s, n) {
            if (u.state.windfall > 0) u.state.windfall -= 1;
            if (E(u) >= 4) s.advance(u, 0.2);
          },
        });
      },
      action(sim, u, t) { if (ATTACKS.has(t)) sim.advance(u.state.numby, 0.5); },
      allyAction(sim, u, actor, t) {
        if (actor.kind === 'char' && u.state.windfall > 0 && ATTACKS.has(t)) sim.advance(u.state.numby, 0.5);
      },
      ult(sim, u) { u.state.windfall = 2; },
    },
    1202: { // Tingyun
      desc: 'Trace: after Skill, +20% SPD for 1 turn. E1: Benediction target +20% SPD for 1 turn after their Ultimate.',
      action(sim, u, t) { if (t === 'Skill') sim.addBuff(u, { id: 'tingyun', pct: 0.2, turns: 1 }); },
      allyUlt(sim, u, ulter) { if (E(u) >= 1 && ulter === target(sim, u)) sim.addBuff(ulter, { id: 'tingyunE1', pct: 0.2, turns: 1 }); },
    },
    1204: { // Jing Yuan
      desc: 'Summons Lightning-Lord (60 SPD +10 per extra hit). Skill +2 hits, Ultimate +3 hits; resets after it acts.',
      battleStart(sim, u) {
        u.state.hits = 3;
        u.state.ll = sim.spawn({
          key: `${u.key}:ll`, name: 'Lightning-Lord', owner: u, icon: u.icon,
          spdFn: () => P(u, 'Talent', 0) + 10 * (u.state.hits - 3),
          onTurn() { u.state.hits = 3; },
        });
      },
      action(sim, u, t) { if (t === 'Skill') u.state.hits = Math.min(10, u.state.hits + P(u, 'BPSkill', 1)); },
      ult(sim, u) { u.state.hits = Math.min(10, u.state.hits + P(u, 'Ultra', 1)); },
    },
    1206: { desc: 'Ultimate: takes action immediately.', ult(sim, u) { sim.actNow(u); } }, // Sushang
    1207: { // Yukong
      desc: 'E1: at battle start, all allies +10% SPD for 2 turns.',
      battleStart(sim, u) { if (E(u) >= 1) sim.chars().forEach((a) => sim.addBuff(a, { id: 'yukongE1', pct: 0.1, turns: 2 })); },
    },
    1210: { desc: 'Trace: battle start, advances action 25%.', battleStart(sim, u) { sim.advance(u, 0.25); } }, // Guinaifen
    1213: { desc: 'E2: after Ultimate, advances action 100%.', ult(sim, u) { if (E(u) >= 2) sim.actNow(u); } }, // DHIL
    1215: { // Hanya
      desc: 'Ultimate: target +SPD equal to 20% of Hanya\'s SPD for 2 turns. E2: after Skill, +20% SPD for 1 turn.',
      ult(sim, u) { const tg = target(sim, u); if (tg) sim.addBuff(tg, { id: 'hanya', flat: P(u, 'Ultra', 2) * sim.spd(u), turns: 2 }); },
      action(sim, u, t) { if (t === 'Skill' && E(u) >= 2) sim.addBuff(u, { id: 'hanyaE2', pct: 0.2, turns: 1 }); },
    },
    1217: { // Huohuo
      desc: 'E1: while Divine Provision is up (after Skill/Ultimate, 3 of Huohuo\'s turns), all allies +12% SPD.',
      action(sim, u, t) { if (t === 'Skill') this.provision(sim, u); },
      ult(sim, u) { this.provision(sim, u); },
      provision(sim, u) { if (E(u) >= 1) sim.chars().forEach((a) => sim.addBuff(a, { id: 'huohuoE1', pct: 0.12, turns: 3, tick: 'owner', owner: u })); },
    },
    1222: { // Lingsha
      desc: 'Skill summons Fuyuan (90 SPD, 3 actions, +3 per Skill up to 5) and advances it 20%. Ultimate advances Fuyuan 100%.',
      action(sim, u, t) {
        if (t !== 'Skill') return;
        let f = summonNamed(sim, u, 'Fuyuan');
        if (!f) {
          f = summon(sim, u, 'Fuyuan', P(u, 'Talent', 0), {
            state: { left: 3 },
            onTurn(s, me) { if (--me.state.left <= 0) s.remove(me); },
          });
        } else f.state.left = Math.min(5, f.state.left + 3);
        sim.advance(f, P(u, 'BPSkill', 3));
      },
      ult(sim, u) { const f = summonNamed(sim, u, 'Fuyuan'); if (f) sim.actNow(f); },
    },
    1223: { desc: 'Trace: at the start of each wave, advances action 30%.', battleStart(sim, u) { sim.advance(u, 0.3); } }, // Moze
    1224: { // March 7th (Hunt)
      desc: 'Skill: Shifu gets +SPD%. Trace: battle start advance 25%. E1: +10% SPD while Shifu exists.',
      battleStart(sim, u) { sim.advance(u, 0.25); },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const tg = target(sim, u);
        if (!tg) return;
        sim.units.forEach((x) => sim.removeBuff(x, 'shifu'));
        sim.addBuff(tg, { id: 'shifu', pct: P(u, 'BPSkill', 0), turns: Infinity });
        if (E(u) >= 1) sim.addBuff(u, { id: 'marchE1', pct: 0.1, turns: Infinity });
      },
    },
    1225: { desc: 'E2: after Ultimate, all allies advance 24%.', ult(sim, u) { if (E(u) >= 2) sim.chars().forEach((a) => sim.advance(a, 0.24)); } }, // Fugue
    1301: { desc: 'Trace: after Ultimate, advances action 100%.', ult(sim, u) { sim.actNow(u); } }, // Gallagher
    1303: { // Ruan Mei
      desc: 'Talent: all teammates +SPD% (not Ruan Mei).',
      battleStart(sim, u) { const v = P(u, 'Talent', 0); sim.allies(u).forEach((a) => sim.addBuff(a, { id: 'ruanmei', pct: v, turns: Infinity })); },
    },
    1306: { // Sparkle
      desc: 'Skill: target advances 50%.',
      action(sim, u, t) { if (t === 'Skill') sim.advance(target(sim, u), P(u, 'BPSkill', 3)); },
    },
    1309: { // Robin
      desc: 'Trace: battle start advance 25%. Ultimate: teammates act immediately; Robin waits on a 90 SPD Concerto countdown, then acts immediately. E2: allies +16% SPD during Concerto.',
      battleStart(sim, u) { sim.advance(u, 0.25); },
      canUlt(sim, u) { return !u.state.concerto; },
      ult(sim, u) {
        sim.allies(u).forEach((a) => sim.actNow(a));
        u.state.concerto = true;
        u.suspended = true;
        if (E(u) >= 2) sim.chars().forEach((a) => sim.addBuff(a, { id: 'robinE2', pct: 0.16, turns: Infinity }));
        sim.spawnCountdown({
          key: `${u.key}:concerto`, name: 'Concerto', owner: u, icon: u.icon, fixedSpd: P(u, 'Ultra', 1),
          onTurn(s) {
            u.state.concerto = false;
            u.suspended = false;
            s.units.forEach((x) => s.removeBuff(x, 'robinE2'));
            s.actNow(u);
          },
        });
      },
    },
    1310: { // Firefly
      desc: 'Skill advances next action 25%. Ultimate: acts immediately, +SPD (flat) during Complete Combustion (ends on a 70 SPD countdown).',
      canUlt(sim, u) { return !u.state.combust; },
      actionType(sim, u) { return u.state.combust ? 'Enhanced' : undefined; },
      action(sim, u, t) { if (t === 'Skill') sim.advance(u, P(u, 'BPSkill', 3)); },
      ult(sim, u) {
        u.state.combust = true;
        sim.addBuff(u, { id: 'combust', flat: P(u, 'Ultra', 2), turns: Infinity });
        sim.actNow(u);
        sim.spawnCountdown({
          key: `${u.key}:combust`, name: 'Combustion', owner: u, icon: u.icon, fixedSpd: P(u, 'Ultra', 3),
          onTurn(s) { u.state.combust = false; s.removeBuff(u, 'combust'); },
        });
      },
    },
    1313: { // Sunday
      desc: 'Skill: target and their summons take action immediately.',
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const tg = target(sim, u);
        if (tg) { sim.actNow(tg); summonsOf(sim, tg).filter((s) => s.kind === 'summon').forEach((s) => sim.actNow(s)); }
      },
    },
    1314: { // Jade
      desc: 'Trace: battle start advance 50%. Skill: Debt Collector +30 SPD for 3 of Jade\'s turns.',
      battleStart(sim, u) { sim.advance(u, 0.5); },
      action(sim, u, t) {
        const tg = target(sim, u);
        if (t === 'Skill' && tg) sim.addBuff(tg, { id: 'jade', flat: P(u, 'BPSkill', 0), turns: P(u, 'BPSkill', 3), tick: 'owner', owner: u });
      },
    },
    1317: { desc: 'Ultimate: gains 1 extra turn immediately.', ult(sim, u) { sim.extraTurn(u); } }, // Rappa
    1401: { // The Herta
      desc: 'Ultimate: takes action immediately. E4: Erudition allies +12% SPD.',
      battleStart(sim, u) {
        if (E(u) >= 4) sim.chars().filter((a) => a.cfg.char.path === 'Erudition').forEach((a) => sim.addBuff(a, { id: 'thehertaE4', pct: 0.12, turns: Infinity }));
      },
      ult(sim, u) { sim.actNow(u); },
    },
    1407: { // Castorice
      desc: 'Ultimate: summons Netherwing (165 SPD), which acts immediately and leaves after 3 turns.',
      canUlt(sim, u) { return !summonNamed(sim, u, 'Netherwing'); },
      ult(sim, u) {
        const n = summon(sim, u, 'Netherwing', P(u, 'Ultra', 0), { state: { left: P(u, 'Ultra', 1) }, onTurn(s, me) { if (--me.state.left <= 0) s.remove(me); } });
        sim.actNow(n);
      },
    },
    1412: { // Cerydra
      desc: 'Trace: Skill gives Cerydra and the Military Merit holder +20 SPD for 3 turns.',
      action(sim, u, t) {
        if (t !== 'Skill') return;
        sim.addBuff(u, { id: 'cerydra', flat: 20, turns: 3 });
        const tg = target(sim, u); if (tg) sim.addBuff(tg, { id: 'cerydra', flat: 20, turns: 3 });
      },
    },
    1413: { // Evernight
      desc: 'Summons Evey (160 SPD) at battle start; Evey acts immediately.',
      battleStart(sim, u) { sim.actNow(summon(sim, u, 'Evey', P(u, 'Talent', 3))); },
    },
    1414: { // Dan Heng • Permansor Terrae
      desc: 'Trace: battle start advance 40%. Skill makes target the Bondmate and summons Souldragon (165 SPD); Bondmate attacks advance it 15%. E2: Ultimate advances Souldragon 100%.',
      battleStart(sim, u) { sim.advance(u, 0.4); },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        u.state.bond = target(sim, u);
        if (!u.state.dragon || !u.state.dragon.alive) u.state.dragon = summon(sim, u, 'Souldragon', P(u, 'Talent', 4));
      },
      allyAction(sim, u, actor, t) {
        if (actor === u.state.bond && ATTACKS.has(t) && u.state.dragon) sim.advance(u.state.dragon, 0.15);
      },
      ult(sim, u) { if (E(u) >= 2 && u.state.dragon) sim.actNow(u.state.dragon); },
    },
    1415: { // Cyrene
      desc: 'E6: first Ultimate advances all allies 100%.',
      ult(sim, u) { if (E(u) >= 6 && !u.state.e6) { u.state.e6 = true; sim.chars().forEach((a) => sim.actNow(a)); } },
    },
    1503: { // Pearl
      desc: 'Ultimate: target advances 10/15/30% for 1/2/3+ Elation allies; with 4 Elation allies they get an extra turn instead.',
      ult(sim, u) {
        const tg = target(sim, u); if (!tg) return;
        const n = sim.chars().filter((a) => a.cfg.char.path === 'Elation').length;
        if (n >= 4) sim.extraTurn(tg);
        else sim.advance(tg, [0, 0.1, 0.15, 0.3][n]);
      },
    },
    1508: { // Rin Tohsaka
      desc: 'Trace: on entering combat, +20% SPD for 3 turns.',
      battleStart(sim, u) { sim.addBuff(u, { id: 'rin', pct: 0.2, turns: 3 }); },
    },
    1509: { // Gilgamesh
      desc: 'Talent: +10% SPD per Interest (1 per other ally action). At 10 Interest, uses Skill and resets.',
      actionType(sim, u) { return u.state.piqued ? 'Skill' : 'Basic'; },
      allyAction(sim, u, actor) {
        if (actor.kind === 'countdown') return;
        u.state.interest = (u.state.interest || 0) + 1;
        if (u.state.interest >= 10) u.state.piqued = true;
        sim.addBuff(u, { id: 'interest', pct: 0.1 * u.state.interest, turns: Infinity });
      },
      action(sim, u, t) {
        if (t === 'Skill') { u.state.interest = 0; sim.removeBuff(u, 'interest'); }
      },
    },
    1512: { // Robin • Summeretto
      desc: 'Ultimate: target advances 100%.',
      ult(sim, u) { sim.actNow(target(sim, u)); },
    },
    1513: { // Aventurine • Waveflair
      desc: 'Ultimate: +SPD% for 4 turns.',
      ult(sim, u) { sim.addBuff(u, { id: 'avenW', pct: P(u, 'Ultra', 3), turns: P(u, 'Ultra', 4) }); },
    },
    8008: { // Trailblazer • Remembrance
      desc: 'Trace: battle start advance 30%. Skill summons Mem (130 SPD).',
      battleStart(sim, u) { sim.advance(u, 0.3); },
      action(sim, u, t) { if (t === 'Skill' && !summonNamed(sim, u, 'Mem')) summon(sim, u, 'Mem', P(u, 'Talent', 0)); },
    },
    8010: { // Trailblazer • Elation
      desc: 'Ultimate: if the target is not an Elation character, they advance 50%.',
      ult(sim, u) { const tg = target(sim, u); if (tg && tg.cfg.char.path !== 'Elation') sim.advance(tg, 0.5); },
    },
  };

  // ---------------------------------------------------------------- light cones
  const lightCones = {
    20015: { desc: 'After Basic ATK, next action advances.', action(sim, u, t) { if (t === 'Basic') sim.advance(u, LP(u, 0)); } },
    20019: { desc: 'Battle start: all allies +flat SPD for 1 turn.', battleStart(sim, u) { sim.chars().forEach((a) => sim.addBuff(a, { id: 'mediation', flat: LP(u, 0), turns: 1 })); } },
    21018: { desc: 'Ultimate: all allies advance.', ult(sim, u) { sim.chars().forEach((a) => sim.advance(a, LP(u, 0))); } },
    21024: { desc: '+SPD% (assumes the wearer is not hit).', static: (u) => ({ pct: LP(u, 0) }) },
    21045: { desc: 'After Ultimate, +SPD% for 2 turns.', ult(sim, u) { sim.addBuff(u, { id: 'charmony', pct: LP(u, 1), turns: 2 }); } },
    21047: { desc: 'Battle start: +SPD% for 2 turns.', battleStart(sim, u) { sim.addBuff(u, { id: 'shadowed', pct: LP(u, 1), turns: 2 }); } },
    21048: { desc: '+SPD%.', static: (u) => ({ pct: LP(u, 0) }) },
    23006: { desc: 'Each attack: +SPD%, stacks 3 times.', action(sim, u, t) { if (ATTACKS.has(t)) sim.addBuff(u, { id: 'patience', pct: LP(u, 2), turns: Infinity, maxStacks: 3 }); } },
    23008: { desc: 'After Ultimate, all allies +flat SPD for 1 turn.', ult(sim, u) { sim.chars().forEach((a) => sim.addBuff(a, { id: 'coffin', flat: LP(u, 1), turns: 1 })); } },
    23027: { desc: '+SPD% (assumes Break Effect ≥ 150%).', static: (u) => ({ pct: LP(u, 3) }) },
    23033: {
      desc: 'After Ultimate, the 2nd Basic ATK advances action.',
      ult(sim, u) { u.state.raiton = 0; },
      action(sim, u, t) {
        if (u.state.raiton === undefined || t !== 'Basic') return;
        if (++u.state.raiton >= 2) { sim.advance(u, LP(u, 2)); u.state.raiton = undefined; }
      },
    },
    23036: { desc: '+base SPD.', static: (u) => ({ base: LP(u, 0) }) },
    23042: { desc: '+SPD%.', static: (u) => ({ pct: LP(u, 0) }) },
    23043: { desc: '+SPD%.', static: (u) => ({ pct: LP(u, 0) }) },
    23044: { desc: '+base SPD.', static: (u) => ({ base: LP(u, 0) }) },
    23052: { desc: '+SPD%.', static: (u) => ({ pct: LP(u, 0) }) },
    23054: { desc: '+SPD%.', static: (u) => ({ pct: LP(u, 0) }) },
    23057: { desc: '+SPD%.', static: (u) => ({ pct: LP(u, 0) }) },
    23063: {
      desc: 'Battle start: advance, and all allies +SPD% for 2 of the wearer\'s turns.',
      battleStart(sim, u) {
        sim.advance(u, LP(u, 1));
        sim.chars().forEach((a) => sim.addBuff(a, { id: 'riseandsing', pct: LP(u, 2), turns: 2, tick: 'owner', owner: u }));
      },
    },
    24005: { desc: '+SPD%.', static: (u) => ({ pct: LP(u, 0) }) },
  };

  // ---------------------------------------------------------------- relics
  // Keyed by set id; `two`/`four` are the 2-piece and 4-piece effects.
  const relics = {
    102: { four: { desc: '+6% SPD.', static: () => ({ pct: 0.06 }) } },
    110: { four: { desc: 'After Ultimate, advances action 25%.', ult(sim, u) { sim.advance(u, 0.25); } } },
    114: {
      two: { desc: '+6% SPD.', static: () => ({ pct: 0.06 }) },
      four: { desc: 'Ultimate: all allies +12% SPD for 1 turn (no stacking).', ult(sim, u) { sim.chars().forEach((a) => sim.addBuff(a, { id: 'messenger', pct: 0.12, turns: 1 })); } },
    },
    121: { two: { desc: '+6% SPD.', static: () => ({ pct: 0.06 }) } },
    123: { four: { desc: '+6% SPD while memosprite is on field (assumed).', static: () => ({ pct: 0.06 }) } },
    124: { four: { desc: '−8% SPD.', static: () => ({ pct: -0.08 }) } },
    125: {
      two: { desc: '+6% SPD.', static: () => ({ pct: 0.06 }) },
      four: { desc: '+6% SPD with Gentle Rain (assumed active).', static: () => ({ pct: 0.06 }) },
    },
    130: { two: { desc: '+6% SPD.', static: () => ({ pct: 0.06 }) } },
    133: { two: { desc: '+6% SPD.', static: () => ({ pct: 0.06 }) } },
    // Planar ornaments (2-piece only).
    308: { two: { desc: 'If SPD ≥ 120 on entering battle, advances action 40%.', battleStart(sim, u) { if (sim.spd(u) >= 120 - 1e-9) sim.advance(u, 0.4); } } },
    316: { two: { desc: '+6% SPD.', static: () => ({ pct: 0.06 }) } },
    320: { two: { desc: '+6% SPD.', static: () => ({ pct: 0.06 }) } },
    323: { two: { desc: 'All allies +8% SPD while memosprite is on field (assumed, no stacking).', battleStart(sim) { sim.chars().forEach((a) => sim.addBuff(a, { id: 'amphoreus', pct: 0.08, turns: Infinity })); } } },
  };

  window.AVEffects = { kits, lightCones, relics, P };
})();
