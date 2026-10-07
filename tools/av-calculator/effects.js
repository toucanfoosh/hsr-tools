// Speed / turn-order effects that the simulator models.
// Each entry is a set of hooks the engine calls (see engine.js): battleStart, turnStart,
// actionType, action, allyAction, allyUlt, ult, canUlt, turnEnd, plus static(u) for
// out-of-combat stat changes. `desc` is shown in the UI so users know what is simulated.
// `targetLabel` (string, or fn of the slot) names the teammate picker when the kit's Skill /
// Ultimate changes that teammate's speed or turn order; kits without one get no picker.
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
  // Per-kit settings from the UI (see `options` on a kit); falls back to the option's default.
  function O(u, key) {
    const kit = kits[u.cfg.char.id];
    const opt = kit && kit.options && kit.options.find((o) => o.key === key);
    const v = u.cfg.opts && u.cfg.opts[key];
    return v === undefined || v === '' ? opt && opt.def : v;
  }
  const LP = (u, idx) => u.cfg.lc.params[u.cfg.lcS - 1][idx];
  const target = (sim, u) => sim.targetOf(u);
  // Robin • Summeretto's "Special Guest" can't give other allies action advance.
  const canAdvanceOthers = (sim, u) => !sim.hasBuff(u, 'specialGuest');
  // Advance a character together with its summons / memosprites (Sunday's Skill).
  function actNowWithSummons(sim, tg) {
    sim.actNow(tg);
    summonsOf(sim, tg).forEach((s) => sim.actNow(s));
  }
  const summonsOf = (sim, owner) => sim.units.filter((x) => x.alive && x.kind === 'summon' && x.owner === owner);
  const summonNamed = (sim, owner, name) => summonsOf(sim, owner).find((x) => x.name === name);
  // Chrysos Heirs, for Cyrene's traces and Demiurge's Odes.
  const CHRYSOS = new Set(['1402', '1403', '1404', '1405', '1406', '1407', '1408', '1409', '1410', '1412', '1413', '1414', '1415']);
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
      advance: 'skill', allyTarget: { Skill: 1 },
      desc: 'Skill: target takes action immediately. Talent: Basic ATK advances next action. E2: skill target +30% SPD for 1 turn after acting.',
      action(sim, u, t) {
        if (t === 'Skill') {
          const tg = target(sim, u);
          if (tg && canAdvanceOthers(sim, u)) { sim.actNow(tg); if (E(u) >= 2) u.state.e2 = tg; }
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
      targetLabel: (slot) => (slot.eidolon >= 1 ? 'Benediction target (E1: +20% SPD after their Ult)' : null),
      allyTarget: { Skill: 1, Ultimate: 2 },
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
          onTurn() { u.state.lastHits = u.state.hits; u.state.hits = 3; },
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
      targetLabel: 'Ultimate SPD buff target',
      allyTarget: { Ultimate: 1 },
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
      targetLabel: 'Shifu (SPD buff)',
      allyTarget: { Skill: 1 },
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
    1225: { ultAdvance: (u) => u.eidolon >= 2 && 'team', desc: 'E2: after Ultimate, all allies advance 24%.', ult(sim, u) { if (E(u) >= 2) sim.chars().forEach((a) => sim.advance(a, 0.24)); } }, // Fugue
    1301: { desc: 'Trace: after Ultimate, advances action 100%.', ult(sim, u) { sim.actNow(u); } }, // Gallagher
    1303: { // Ruan Mei
      desc: 'Talent: all teammates +SPD% (not Ruan Mei).',
      battleStart(sim, u) { const v = P(u, 'Talent', 0); sim.allies(u).forEach((a) => sim.addBuff(a, { id: 'ruanmei', pct: v, turns: Infinity })); },
    },
    1306: { // Sparkle
      advance: 'skill', allyTarget: { Skill: 1 },
      desc: 'Skill: target advances 50% (not a full pull, so it only helps if they are already close to acting).',
      action(sim, u, t) { if (t === 'Skill' && canAdvanceOthers(sim, u)) sim.advance(target(sim, u), P(u, 'BPSkill', 3)); },
    },
    1309: { // Robin
      ultAdvance: 'team',
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
      advance: 'skill', allyTarget: { Skill: 1, Ultimate: 2 },
      desc: 'Skill: target and their summon / memosprite take action immediately (no advance on Harmony characters).',
      action(sim, u, t) {
        if (t !== 'Skill' || !canAdvanceOthers(sim, u)) return;
        const tg = target(sim, u);
        if (tg && tg.cfg.char.path !== 'Harmony') actNowWithSummons(sim, tg);
      },
    },
    1314: { // Jade
      targetLabel: 'Debt Collector (+30 SPD)',
      allyTarget: { Skill: 1 },
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
    1402: { // Aglaea
      desc: 'Skill (no Garmentmaker): summons it and Aglaea acts immediately. Garmentmaker: 35% of Aglaea\'s SPD, advances 100% when summoned, +SPD per attack (6 stacks; E4: 7, and Aglaea\'s attacks also stack). Ultimate: Supreme Stance (+15% SPD per stack for Aglaea), acts immediately, 100 SPD countdown; 1 stack is kept afterwards.',
      battleStart(sim, u) { u.state.stacks = 0; },
      actionType(sim, u) { return u.state.stance ? 'Enhanced' : undefined; },
      maxStacks(u) { return E(u) >= 4 ? 7 : 6; },
      perStack(u) { return 55 + (E(u) >= 3 ? 2.2 : 0) + (E(u) >= 5 ? 2.2 : 0); },
      summonGM(sim, u) {
        let gm = summonNamed(sim, u, 'Garmentmaker');
        if (gm) return gm;
        const kit = this;
        gm = sim.spawn({
          key: `${u.key}:gm`, name: 'Garmentmaker', owner: u, icon: u.icon, memo: true,
          // "Initial SPD" is a snapshot of Aglaea's SPD when it is summoned.
          state: { base: P(u, 'Talent', 3) * sim.spd(u) },
          spdFn: (s, me) => me.state.base + kit.perStack(u) * u.state.stacks,
          onTurn() { kit.stack(sim, u); },
        });
        sim.actNow(gm);
        return gm;
      },
      // Cyrene's Ode to Romance: Garmentmaker's SPD stacks jump to the cap.
      ode(sim, u) { u.state.stacks = this.maxStacks(u) - 1; this.stack(sim, u); },
      stack(sim, u) {
        u.state.stacks = Math.min(this.maxStacks(u), u.state.stacks + 1);
        if (u.state.stance) sim.addBuff(u, { id: 'supreme', pct: P(u, 'Ultra', 0) * u.state.stacks, turns: Infinity });
      },
      action(sim, u, t) {
        if (t === 'Skill' && !summonNamed(sim, u, 'Garmentmaker')) { this.summonGM(sim, u); sim.actNow(u); }
        if (E(u) >= 4 && ATTACKS.has(t) && summonNamed(sim, u, 'Garmentmaker')) this.stack(sim, u);
      },
      ult(sim, u) {
        this.summonGM(sim, u);
        u.state.stance = true;
        sim.addBuff(u, { id: 'supreme', pct: P(u, 'Ultra', 0) * u.state.stacks, turns: Infinity });
        sim.actNow(u);
        const old = sim.units.find((x) => x.alive && x.key === `${u.key}:stance`);
        if (old) { old.dist = 10000; return; } // Ult again resets the countdown.
        sim.spawnCountdown({
          key: `${u.key}:stance`, name: 'Supreme Stance', owner: u, icon: u.icon, fixedSpd: 100,
          onTurn(s) {
            const gm = summonNamed(s, u, 'Garmentmaker');
            if (gm) s.remove(gm);
            u.state.stance = false;
            u.state.stacks = Math.min(1, u.state.stacks);
            s.removeBuff(u, 'supreme');
          },
        });
      },
    },
    1407: { // Castorice
      desc: 'Ultimate: summons Netherwing (165 SPD), which acts immediately and leaves after 3 turns.',
      canUlt(sim, u) { return !summonNamed(sim, u, 'Netherwing'); },
      ult(sim, u) {
        const n = summon(sim, u, 'Netherwing', P(u, 'Ultra', 0), { memo: true, state: { left: P(u, 'Ultra', 1) }, onTurn(s, me) { if (--me.state.left <= 0) s.remove(me); } });
        sim.actNow(n);
      },
    },
    1412: { // Cerydra
      targetLabel: 'Military Merit / Peerage target',
      allyTarget: { Skill: 1 },
      desc: 'Trace: Skill gives Cerydra and the Military Merit holder +20 SPD for 3 turns.',
      action(sim, u, t) {
        if (t !== 'Skill') return;
        sim.addBuff(u, { id: 'cerydra', flat: 20, turns: 3 });
        const tg = target(sim, u); if (tg) sim.addBuff(tg, { id: 'cerydra', flat: 20, turns: 3 });
      },
    },
    1413: { // Evernight
      desc: 'Summons Evey (160 SPD) at battle start; Evey acts immediately.',
      battleStart(sim, u) { sim.actNow(summon(sim, u, 'Evey', P(u, 'Talent', 3), { memo: true })); },
    },
    1414: { // Dan Heng • Permansor Terrae
      targetLabel: 'Bondmate (Souldragon follows them)',
      desc: 'Trace: battle start advance 40%. Skill makes target the Bondmate and summons Souldragon (165 SPD); Bondmate attacks advance it 15%. E2: Ultimate advances Souldragon 100%.',
      battleStart(sim, u) { sim.advance(u, 0.4); },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        u.state.bond = target(sim, u);
        if (!u.state.dragon || !u.state.dragon.alive) u.state.dragon = summon(sim, u, 'Souldragon', P(u, 'Talent', 4), { memo: true });
      },
      allyAction(sim, u, actor, t) {
        if (actor === u.state.bond && ATTACKS.has(t) && u.state.dragon) sim.advance(u.state.dragon, 0.15);
      },
      ult(sim, u) { if (E(u) >= 2 && u.state.dragon) sim.actNow(u.state.dragon); },
      // Cyrene's Ode to Earth: Souldragon advances 100%.
      ode(sim, u) { if (u.state.dragon && u.state.dragon.alive) sim.actNow(u.state.dragon); },
    },
    1415: { // Cyrene
      targetLabel: 'Demiurge\'s Ode target',
      autoUlt: 'Automatic: 24 Recollection for the first Ultimate, then 12.',
      desc: 'Recollection: Basic +1, Skill +3, Enhanced Basic +3, +1 when an ally with "Future" acts (Future is re-granted after Cyrene acts; memosprites keep it), plus 2/3/6 at battle start for 1/2/3 Chrysos Heir / Remembrance teammates (E2: +12). First Ultimate (24): summons Demiurge (0 SPD) with an extra turn and activates all teammates\' Ultimates (E6: all allies advance 100%). Later Ultimates (12): Demiurge extra turn. Demiurge\'s first turn uses the Ode on the chosen teammate (Aglaea: max SPD stacks; Mydei: Godslayer or 100% advance; Anaxa: acts immediately; Phainon: +6 Coreflame and a second set of Khaslana turns; Dan Heng PT: Souldragon advances 100%; Trailblazer Remembrance: Demiurge extra turn after each Enhanced Basic), later turns use Minuet. Story: +1 per Ultimate and on summon; at 3 Demiurge gets an extra turn. E6: from the 2nd Ode to Ego on, all allies advance 24%.',
      options: [{ key: 'firstOde', label: 'Demiurge\'s first turn uses the Ode (not Minuet)', type: 'check', def: true }],
      battleStart(sim, u) {
        const heirs = sim.allies(u).filter((a) => CHRYSOS.has(a.cfg.char.id) || a.cfg.char.path === 'Remembrance').length;
        u.state.rec = [0, 2, 3, 6][Math.min(3, heirs)] + (E(u) >= 2 ? 12 : 0);
        u.state.future = new Set(sim.allies(u));
        u.state.story = 0;
        u.state.ego = 0;
      },
      gainRec(u, n) { u.state.rec = Math.min((u.state.ripples ? 12 : 24) + 27, u.state.rec + n); },
      ultReady(sim, u) { return u.state.rec >= (u.state.ripples ? 12 : 24); },
      actionType(sim, u) { return u.state.ripples ? 'Enhanced' : undefined; },
      action(sim, u, t) {
        this.gainRec(u, t === 'Basic' ? 1 : 3);
        sim.allies(u).forEach((a) => u.state.future.add(a));
      },
      allyAction(sim, u, actor, t) {
        if (actor.kind === 'countdown') return;
        if (actor.memo && actor.owner !== u) this.gainRec(u, 1); // memosprites never use up their Future
        else if (u.state.future.has(actor)) { u.state.future.delete(actor); this.gainRec(u, 1); }
        if (actor.kind === 'char' && actor.state.genesis && t === 'Enhanced') this.demiurgeTurn(sim, u);
      },
      story(sim, u) {
        if (++u.state.story >= 3) { u.state.story = 0; this.demiurgeTurn(sim, u); }
      },
      demiurgeTurn(sim, u) {
        if (!u.state.demi || !u.state.demi.alive) return;
        sim.extraTurn(u.state.demi);
      },
      ult(sim, u) {
        if (!u.state.ripples) {
          u.state.rec -= 24;
          u.state.ripples = true;
          const kit = this;
          u.state.demi = sim.spawn({
            key: `${u.key}:demiurge`, name: 'Demiurge', owner: u, icon: u.icon, memo: true, fixedSpd: 1,
            onTurn(s) { kit.demiurgeAct(s, u); },
          });
          u.state.demi.suspended = true; // 0 SPD: only ever acts through extra turns
          this.demiurgeTurn(sim, u);
          // "Activates all teammates' Ultimate".
          for (const a of sim.allies(u)) {
            if (a.state.ultHeld) { sim.releaseUlt(a); continue; }
            if (sim.fire(a, 'canUlt') !== false) sim.ult(a, { activated: true });
          }
          if (E(u) >= 6) sim.chars().forEach((a) => sim.actNow(a));
          this.story(sim, u); // summoned
          this.story(sim, u); // Ultimate used
        } else {
          u.state.rec -= 12;
          this.demiurgeTurn(sim, u);
          this.story(sim, u);
        }
      },
      demiurgeAct(sim, u) {
        const tg = target(sim, u);
        if (!u.state.odeUsed && O(u, 'firstOde') && tg) {
          u.state.odeUsed = true;
          // Being targeted counts as an ability on the ally (Phainon's Coreflame).
          sim.fire(tg, 'targetedBy', u, 'Ode');
          if (CHRYSOS.has(tg.cfg.char.id) || tg.cfg.char.id === '8008') sim.fire(tg, 'ode');
          return;
        }
        // Minuet of Blooms and Plumes, which always triggers Ode to Ego.
        u.state.ego += 1;
        if (E(u) >= 1) this.gainRec(u, 6);
        if (E(u) >= 6 && u.state.ego >= 2) sim.chars().forEach((a) => sim.advance(a, 0.24));
      },
    },
    1405: { // Anaxa
      desc: 'Cyrene\'s Ode to Reason: Anaxa takes action immediately.',
      ode(sim, u) { sim.actNow(u); },
    },
    1404: { // Mydei
      desc: 'Charge = % of Max HP lost (Skill: 50% of current HP; Kingslayer: 35%; enemy hits per the setting; Castorice / Jingliu HP drains). Ultimate: +20 Charge, heals 20%. At 100 Charge enters Vendetta: +50% Max HP, heals 25%, advances 100%, then auto-uses Kingslayer each turn. At 150 Charge (E6: 100) in Vendetta he gets an extra turn for Godslayer. Technique: +50 Charge. E6: starts in Vendetta.',
      options: [
        { key: 'hit', label: 'HP lost to enemies per Mydei turn (% Max HP)', type: 'number', def: 10, min: 0, max: 100, step: 1 },
        { key: 'tech', label: 'Technique use', type: 'check', def: true },
      ],
      battleStart(sim, u) {
        u.state.hp = 1; u.state.charge = O(u, 'tech') ? 50 : 0; u.state.god = 0;
        if (E(u) >= 6) { u.state.vendetta = true; u.state.hp /= 1.5; }
      },
      need(u) { return E(u) >= 6 ? 100 : 150; },
      lose(sim, u, frac, ofCurrent = true) {
        const amt = Math.max(0, Math.min(u.state.hp - 0.001, ofCurrent ? u.state.hp * frac : frac));
        u.state.hp -= amt;
        if (!u.state.godslaying) this.charge(sim, u, amt * 100);
      },
      charge(sim, u, n) {
        u.state.charge = Math.min(200, u.state.charge + n);
        if (!u.state.vendetta && u.state.charge >= 100) {
          u.state.charge -= 100;
          u.state.vendetta = true;
          u.state.hp = Math.min(1, u.state.hp / 1.5 + 0.25);
          sim.actNow(u);
        }
        if (u.state.vendetta && u.state.charge >= this.need(u) && !u.state.god) {
          u.state.god = 1;
          sim.extraTurn(u);
        }
      },
      turnStart(sim, u) { if (!u.state.god) this.lose(sim, u, (+O(u, 'hit') || 0) / 100, false); },
      actionType(sim, u) { return u.state.god || u.state.vendetta ? 'Enhanced' : undefined; },
      action(sim, u, t) {
        if (u.state.god) {
          // Godslayer Be God (free when triggered by Ode to Strife).
          u.state.godslaying = true;
          if (u.state.god !== 'free') u.state.charge -= this.need(u);
          u.state.god = 0;
          u.state.godslaying = false;
          return;
        }
        if (t === 'Enhanced') this.lose(sim, u, 0.35); // Kingslayer Be King
        else if (t === 'Skill') this.lose(sim, u, 0.5);
      },
      ult(sim, u) { u.state.hp = Math.min(1, u.state.hp + 0.2); this.charge(sim, u, P(u, 'Ultra', 4)); },
      allyAction(sim, u, actor, t) {
        if (actor.kind !== 'char') return;
        const id = actor.cfg.char.id;
        if (id === '1407' && t === 'Skill') this.lose(sim, u, summonsOf(sim, actor).some((x) => x.name === 'Netherwing') ? 0.4 : 0.3);
        if (id === '1212' && t === 'Enhanced') this.lose(sim, u, 0.04, false);
      },
      // Cyrene's Ode to Strife.
      ode(sim, u) {
        if (u.state.vendetta) { u.state.god = 'free'; sim.extraTurn(u); } else sim.actNow(u);
      },
    },
    1408: { // Phainon
      autoUlt: 'Automatic at 12 Coreflame.',
      desc: 'Coreflame: +1 at battle start (E6: +6 more), Skill +2, +1 each time a teammate\'s ability targets him (+1 more if it gives Energy), plus the per-turn setting for enemy hits / team-wide buffs. Ultimate at 12 (overflow up to 3): teammates depart, and Khaslana gets a countdown on the action order at 60% of base SPD (E1: 66%), starting from Phainon\'s current gauge. Each countdown turn is one extra turn; the 8th is the final hit. Advancing Khaslana advances the countdown. Khaslana uses Stardeath Verdict at 4+ Scourge (E2: extra turn), otherwise Soulscorch (2+ enemies) or the Enhanced Basic. After it ends, all allies get +15% SPD for 1 turn and Phainon gains 3 Coreflame plus the overflow.',
      options: [
        { key: 'cf', label: 'Extra Coreflame per Phainon turn (enemy hits, team-wide buffs)', type: 'number', def: 1, min: 0, max: 12, step: 1 },
        { key: 'enemies', label: 'Enemies on field', type: 'number', def: 3, min: 1, max: 5, step: 1 },
      ],
      battleStart(sim, u) { u.state.cf = 1 + (E(u) >= 6 ? 6 : 0); },
      cap(u) { return E(u) >= 6 ? Infinity : 15; },
      gain(u, n) { if (!u.state.khas) u.state.cf = Math.min(this.cap(u), u.state.cf + n); },
      ultReady(sim, u) { return u.state.cf >= 12; },
      canUlt(sim, u) { return !u.state.khas; },
      turnStart(sim, u) { if (!u.state.khas) this.gain(u, +O(u, 'cf') || 0); },
      targetedBy(sim, u, src, kind) { this.gain(u, 1); },
      allyAction(sim, u, actor, t) {
        const kit = actor.kind === 'char' && sim.kitOf(actor);
        if (kit && kit.allyTarget && kit.allyTarget[t] && sim.targetOf(actor) === u) this.gain(u, kit.allyTarget[t]);
      },
      allyUlt(sim, u, ulter) {
        const kit = sim.kitOf(ulter);
        if (kit && kit.allyTarget && kit.allyTarget.Ultimate && sim.targetOf(ulter) === u) this.gain(u, kit.allyTarget.Ultimate);
      },
      // Cyrene's Ode to Worldbearing.
      ode(sim, u) { this.gain(u, 6); u.state.eternal = true; },
      actionType(sim, u) { return u.state.khas ? (u.state.final ? 'Final' : 'Enhanced') : undefined; },
      action(sim, u, t) {
        if (t === 'Skill') { this.gain(u, 2); return; }
        if (t !== 'Enhanced') return;
        const st = u.state;
        if (st.scourge >= 4) {
          const used = st.scourge; st.scourge = 0;
          if (E(u) >= 2 && used >= 4) sim.extraTurn(u);
        } else if ((+O(u, 'enemies') || 1) >= 2) st.scourge += +O(u, 'enemies');
        else st.scourge += 2;
      },
      ult(sim, u) {
        const st = u.state;
        st.overflow = Math.max(0, st.cf - 12);
        st.cf = st.cf >= 12 ? 0 : st.cf;
        st.khas = true; st.scourge = 4; st.turn = 0; st.refreshed = false; st.final = false;
        const kit = this;
        const cd = sim.spawnCountdown({
          key: `${u.key}:khaslana`, name: 'Khaslana', owner: u, icon: u.icon,
          fixedSpd: (E(u) >= 1 ? 0.66 : P(u, 'Ultra', 2)) * u.base,
          onTurn(s, me) { kit.countdownTurn(s, u, me); },
        });
        cd.dist = u.dist; // the first countdown starts from Phainon's current gauge
        st.restore = sim.departAll([u, cd]);
        u.suspended = true;
        u.advanceTo = cd;
      },
      countdownTurn(sim, u, me) {
        const st = u.state;
        st.turn += 1;
        if (st.turn >= 8 && st.eternal && !st.refreshed) { st.refreshed = true; st.turn = 0; st.scourge += 4; }
        if (st.turn >= 8) {
          st.final = true;
          sim.takeTurn(u, true); // the final hit
          this.endTransform(sim, u);
          return;
        }
        me.alive = true; me.dist = 10000; // keep ticking
        sim.extraTurn(u);
      },
      endTransform(sim, u) {
        const st = u.state;
        st.khas = false; st.final = false;
        u.advanceTo = null;
        u.suspended = false;
        st.restore();
        sim.chars().forEach((a) => sim.addBuff(a, { id: 'khaslanaEnd', pct: 0.15, turns: 1 }));
        st.cf = Math.min(this.cap(u), st.cf + 3 + Math.min(st.overflow, E(u) >= 6 ? Infinity : 3));
      },
    },
    1503: { // Pearl
      advance: 'ult', allyTarget: { Ultimate: 1 },
      desc: 'Ultimate: target advances 10/15/30% for 1/2/3+ Elation characters on the team (Pearl counts); with 4+ they also get an extra turn. E2: other Elation allies also get the advance.',
      ult(sim, u) {
        const tg = target(sim, u); if (!tg || !canAdvanceOthers(sim, u)) return;
        const n = sim.chars().filter((a) => a.cfg.char.path === 'Elation').length;
        const pct = [0, 0.1, 0.15, 0.3][Math.min(3, n)];
        // "3 or more" includes 4, so a mono-Elation target gets the 30% advance and the extra turn.
        sim.advance(tg, pct);
        if (n >= 4) sim.extraTurn(tg);
        if (E(u) >= 2) {
          sim.chars().filter((a) => a !== u && a !== tg && a.cfg.char.path === 'Elation').forEach((a) => sim.advance(a, pct));
        }
      },
    },
    1212: { // Jingliu
      desc: 'Skill/Ultimate: +1 Syzygy. At 2 Syzygy enters Spectral Transmigration and advances 100%; there only the enhanced Skill is used (−1 Syzygy each) until 0. Trace: Transcendent Flash advances next action 10%.',
      battleStart(sim, u) { u.state.syz = 0; },
      actionType(sim, u) { return u.state.spectral ? 'Enhanced' : undefined; },
      gain(sim, u) {
        u.state.syz = Math.min(3, u.state.syz + 1);
        if (!u.state.spectral && u.state.syz >= 2) { u.state.spectral = true; sim.actNow(u); }
      },
      action(sim, u, t) {
        if (t === 'Enhanced') {
          if (--u.state.syz <= 0) { u.state.syz = 0; u.state.spectral = false; }
        } else if (t === 'Skill') {
          sim.advance(u, 0.1);
          this.gain(sim, u);
        }
      },
      ult(sim, u) { this.gain(sim, u); },
    },
    1506: { // Silver Wolf LV.999
      desc: 'Ultimate: enters Godmode Player and takes action immediately; 3 Enhanced Basic ATKs, then exits. Can\'t use Ultimate in Godmode.',
      canUlt(sim, u) { return !u.state.god; },
      actionType(sim, u) { return u.state.god ? 'Enhanced' : undefined; },
      ult(sim, u) { u.state.god = 3; sim.actNow(u); },
      action(sim, u, t) { if (t === 'Enhanced' && u.state.god) u.state.god -= 1; },
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
      advance: 'ult', allyTarget: { Ultimate: 2 },
      desc: 'Ultimate: target advances 100% and becomes Special Guest (2 turns; can\'t advance others). Vibes: +1 per ally attack (+2 more from the Guest). Skill summons Bessie; at 12 Vibes the Songbirds (180% of her SPD) start Fever, Robin stops taking turns (she can still Ult), and a 140 SPD countdown halves Vibes (min 12) until 0, then she advances 50%. E6: 140 fixed Energy on first Fever and each countdown turn, and she can store 2 Ultimates in Fever.',
      battleStart(sim, u) { u.state.vibes = 0; },
      action(sim, u, t) {
        if (t === 'Skill') {
          if (u.state.bessie) this.vibes(sim, u, 6);
          else { u.state.bessie = true; this.vibes(sim, u, 0); }
        }
        if (ATTACKS.has(t)) this.vibes(sim, u, 1);
      },
      allyAction(sim, u, actor, t) {
        if (actor.kind === 'countdown' || !(ATTACKS.has(t) || t === 'Summon')) return;
        if (actor === u.state.birds) { this.vibes(sim, u, 1); return; }
        const guest = sim.hasBuff(actor, 'specialGuest') || (actor.owner && sim.hasBuff(actor.owner, 'specialGuest'));
        this.vibes(sim, u, guest ? 3 : 1);
      },
      ult(sim, u) {
        const tg = target(sim, u); if (!tg) return;
        sim.actNow(tg);
        sim.units.forEach((x) => sim.removeBuff(x, 'specialGuest'));
        sim.addBuff(tg, { id: 'specialGuest', turns: 2, tick: 'owner', owner: u });
      },
      vibes(sim, u, n) {
        const cap = E(u) >= 2 ? 70 : 50;
        u.state.vibes = Math.min(cap, u.state.vibes + n);
        if (u.state.bessie && !u.state.fever && u.state.vibes >= 12) this.startFever(sim, u);
      },
      // Her Ultimate can still be used while Fever stops her turns.
      ultWhileSuspended: true,
      startFever(sim, u) {
        u.state.fever = true;
        u.suspended = true;
        if (E(u) >= 6) {
          u.energyOverflow = u.maxEnergy; // E6: store up to 2 Ultimates during Fever
          if (!u.state.feverOnce) { u.state.feverOnce = true; sim.gainEnergy(u, 140, { fixed: true }); }
        }
        if (E(u) >= 4) u.state.vibes = Math.min(E(u) >= 2 ? 70 : 50, u.state.vibes + 12);
        const e4 = () => (E(u) >= 4 ? 0.2 + u.state.vibes * 0.005 : 0);
        u.state.birds = sim.spawn({
          key: `${u.key}:birds`, name: 'Summer Songbirds', owner: u, icon: u.icon, memo: true,
          spdFn: (s) => s.spd(u) * P(u, 'Talent', 1) * (1 + e4()),
        });
        sim.spawnCountdown({
          key: `${u.key}:fever`, name: 'Fever', owner: u, icon: u.icon, fixedSpd: 140,
          onTurn(s, me) {
            u.state.vibes = Math.max(0, u.state.vibes - Math.max(12, u.state.vibes * 0.5));
            // E6: each countdown turn regenerates a fixed 140 Energy (she can store 2 Ultimates).
            if (E(u) >= 6 && u.state.vibes > 0) s.gainEnergy(u, 140, { fixed: true });
            if (u.state.vibes > 0) {
              // The countdown keeps ticking: re-arm it for its next turn.
              me.alive = true; me.dist = 10000;
              return;
            }
            s.remove(u.state.birds);
            u.state.birds = null;
            u.state.bessie = false;
            u.state.fever = false;
            u.suspended = false;
            u.energyOverflow = 0;
            u.energy = Math.min(u.energy, u.maxEnergy);
            s.advance(u, 0.5);
          },
        });
      },
    },
    1513: { // Aventurine • Waveflair
      desc: 'Ultimate: +SPD% for 4 turns.',
      ult(sim, u) { sim.addBuff(u, { id: 'avenW', pct: P(u, 'Ultra', 3), turns: P(u, 'Ultra', 4) }); },
    },
    8008: { // Trailblazer • Remembrance
      desc: 'Trace: battle start advance 30%. Skill summons Mem (130 SPD).',
      battleStart(sim, u) { sim.advance(u, 0.3); },
      action(sim, u, t) { if (t === 'Skill' && !summonNamed(sim, u, 'Mem')) summon(sim, u, 'Mem', P(u, 'Talent', 0), { memo: true }); },
      // Cyrene's Ode to Genesis: after each Enhanced Basic ATK, Demiurge gets an extra turn (see Cyrene).
      ode(sim, u) { u.state.genesis = true; },
    },
    8010: { // Trailblazer • Elation
      advance: 'ult', allyTarget: { Ultimate: 1 },
      desc: 'Ultimate: if the target is not an Elation character, they advance 50%.',
      ult(sim, u) { const tg = target(sim, u); if (tg && tg.cfg.char.path !== 'Elation' && canAdvanceOthers(sim, u)) sim.advance(tg, 0.5); },
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
