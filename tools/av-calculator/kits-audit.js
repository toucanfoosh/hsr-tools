// Per-character audit layer: everything from each Novaflare kit that changes Energy, Skill
// Points, turn order (advances, extra turns, slows / delays on enemies) or damage (buffs and
// debuffs with their durations) and isn't already covered by effects.js, kits-energy.js or
// damage.js. Each entry was written against the full kit text, one character at a time.
//
// Conventions: buffs tick at the end of the holder's turn unless `tick: 'owner'` (the caster's
// turn start, for effects that "decrease at the start of X's turn"). Enemy-side debuffs use
// sim.addEnemyMod (DEF / RES / vulnerability) or sim.slowEnemies / sim.delayEnemies.
// Effects tied to enemy HP thresholds count at half value (the enemy spends about half the
// fight on each side of the threshold). Kills aren't simulated, so on-kill effects are skipped.
(function () {
  const E = (u) => u.cfg.eidolon;
  const AD = () => window.AVDamage;
  const st = (sim, u) => AD().liveStats(sim, u);
  const std = (sim, u, mult, type) => AD().standard(sim, u, mult, 0, type);
  const G = (sim, u, n) => sim.gainEnergy(u, n);
  const F = (sim, u, n) => sim.gainEnergy(u, n, { fixed: true });
  const team = (sim, id, stats, turns, extra = {}) => sim.chars().forEach((a) => sim.addBuff(a, { id, stats, turns, ...extra }));
  const self = (sim, u, id, stats, turns, extra = {}) => sim.addBuff(u, { id, stats, turns, ...extra });
  const emod = (sim, id, props, turns) => sim.addEnemyMod({ id, turns, ...props });
  const isAtk = (t) => ['Basic', 'Skill', 'Enhanced', 'Extra', 'Final', 'Ult', 'FollowUp', 'Assist'].includes(t);
  const HALF = 0.5;
  const n = (sim) => Math.max(1, sim.enemyCount || 1);
  const lowestEnergyAlly = (sim, u) => sim.allies(u).filter((a) => a.maxEnergy > 0).sort((a, b) => a.energy / a.maxEnergy - b.energy / b.maxEnergy)[0];

  const kits = {
    // ------------------------------------------------------------------ 1001 March 7th
    1001: {
      desc: 'Ultimate: 65% base chance to Freeze each enemy for 1 turn (Freeze DMG 60% ATK, the enemy skips its turn). E1: +6 Energy per Frozen enemy. E4: Counters add 30% of DEF.',
      allyTarget: { Skill: 1 },
      ult(sim, u) {
        for (const e of sim.enemies()) {
          if (sim.chance(u, `freeze${e.key}`, 0.65)) { sim.freezeEnemy(e, u, { atk: 0.6 }); if (E(u) >= 1) G(sim, u, 6); }
        }
      },
      extraDamage(sim, u, act, extra) { return E(u) >= 4 && act === 'FollowUp' && extra && extra.label === 'Counter' ? std(sim, u, { def: 0.3 }, 'FUA') : 0; },
    },
    // ------------------------------------------------------------------ 1002 Dan Heng
    1002: {
      desc: 'Talent: when an ally\'s ability targets him, his next attack gets +36% Wind RES PEN (every 2 turns; E2: 1). Trace: after attacking, 50% chance of +20% SPD for 2 turns. Skill CRIT: Slow 12% (E6: 20%) for 2 turns; Ultimate +120% multiplier vs Slowed; Basic +40% DMG vs Slowed. E1: +12% CRIT Rate vs enemies ≥50% HP (half).',
      battleStart(sim, u) { u.state.reachCd = 0; if (E(u) >= 1) self(sim, u, 'dhE1', { cr: 0.12 * HALF }, Infinity); },
      turnStart(sim, u) { if (u.state.reachCd > 0) u.state.reachCd -= 1; },
      targeted(sim, u) {
        if (u.state.reachCd > 0) return;
        u.state.reachCd = E(u) >= 2 ? 1 : 2;
        self(sim, u, 'reach', { resPen: 0.36 }, Infinity);
      },
      action(sim, u, t) {
        if (!isAtk(t)) return;
        if (sim.chance(u, 'ftl', 0.5 / 0.8)) sim.addBuff(u, { id: 'ftl', pct: 0.2, turns: 2 });
        if (t === 'Skill' && sim.chance(u, 'slowCrit', Math.min(1, st(sim, u).cr) / 0.8)) sim.slowEnemies('dhSlow', E(u) >= 6 ? 0.2 : 0.12, 2, 'main');
      },
      dmgScale(sim, u, act) {
        if (act === 'Ult' && sim.isSlowed()) return (4 + 1.2) / 4;
        if (act === 'Basic' && sim.isSlowed()) return 1.4;
        return 1;
      },
      afterDamage(sim, u, act) { if (isAtk(act)) sim.removeBuff(u, 'reach'); },
    },
    // ------------------------------------------------------------------ 1003 Himeko
    1003: {
      desc: 'Victory Rush: +1 Charge per Weakness Break (start with 1; E4: +1 more when her Skill breaks), at 3 the next ally attack triggers her follow-up (140% ATK all, +10 Energy). E1: +20% SPD for 2 turns after it. Trace: 50% chance to Burn (30% ATK, 2 turns) after attacking; Skill +20% vs Burned; +15% CRIT Rate (HP ≥80%). E2: +15% DMG vs enemies ≤50% HP (half). E6: Ultimate 2 extra instances of 40% DMG.',
      battleStart(sim, u) { u.state.charge = 1; self(sim, u, 'benchmark', { cr: 0.15 }, Infinity); if (E(u) >= 2) self(sim, u, 'himekoE2', { dmg: 0.15 * HALF }, Infinity); },
      weaknessBreak(sim, u, by) {
        u.state.charge = Math.min(3, u.state.charge + 1 + (E(u) >= 4 && by === u && u.state.lastAct === 'Skill' ? 1 : 0));
      },
      action(sim, u, t) {
        u.state.lastAct = t;
        if (isAtk(t) && sim.chance(u, 'burn', 0.5)) sim.addDot({ id: `${u.key}:burn`, src: u, mult: { atk: 0.3 }, turns: 2 });
        this.victory(sim, u);
      },
      allyAttack(sim, u) { this.victory(sim, u); },
      victory(sim, u) {
        if (u.state.charge < 3 || u.state.fua) return;
        u.state.fua = true; u.state.charge = 0;
        const ev = sim.record(u, 'FollowUp', { label: 'Victory Rush', n: u.actions });
        ev.dmg = sim.dealDamage(u, 'FollowUp', { label: 'Victory Rush' });
        G(sim, u, 10);
        sim.snap(ev, u);
        if (E(u) >= 1) sim.addBuff(u, { id: 'himekoE1', pct: 0.2, turns: 2 });
        sim.fireAll('allyAttack', u, 'FollowUp');
        u.state.fua = false;
      },
      dmgScale(sim, u, act) {
        if (act === 'Skill' && (sim.dots || []).some((d) => d.id === `${u.key}:burn`)) return 1.2;
        if (act === 'Ult' && E(u) >= 6) return 1 + 0.8 / n(sim);
        return 1;
      },
    },
    // ------------------------------------------------------------------ 1004 Welt
    1004: {
      desc: 'Skill: 75% base chance to Slow 10% for 2 turns. Ultimate: Imprison (delay 12%, Slow 10%, 1 turn) and Weightless for 2 turns: DEF −40% (E4: All RES −30%), Slow 5%, attacks on it delay 4% (up to 8 per turn) and give allies +10% DMG per attack (10 stacks, 2 turns). Talent: +100% ATK Additional DMG on Slowed enemies (E2: +3 Energy). Judgment: Basic / Skill add 80% / 120% of their multiplier. Punishment: +20% ATK per 10% Effect Hit Rate over 40% (max 80%). E1: Skill / Ult on Weightless add 40% of the Ult multiplier. E6: vs Slowed +30% CRIT Rate, +60% CRIT DMG.',
      battleStart(sim, u) {
        const ehr = st(sim, u).ehr;
        self(sim, u, 'punishment', { atkPct: Math.min(0.8, Math.max(0, Math.floor((ehr - 0.4) * 10 + 1e-9)) * 0.2) }, Infinity);
      },
      action(sim, u, t) { if (t === 'Skill' && sim.chance(u, 'slow', 0.75)) sim.slowEnemies('weltSlow', 0.1, 2, 'blast'); },
      ult(sim, u) {
        sim.delayEnemies(0.12); sim.slowEnemies('imprison', 0.1, 1);
        sim.slowEnemies('weightless', 0.05, 2);
        emod(sim, 'weightless', { def: 0.4, res: E(u) >= 4 ? 0.3 : 0 }, 2);
        u.state.weightless = 2 * n(sim);
      },
      enemyTurnStart(sim, u) { if (u.state.weightless > 0) u.state.weightless -= 1; },
      allyAttack(sim, u, a) { this.weight(sim, u); },
      afterDamage(sim, u, act) { if (isAtk(act)) this.weight(sim, u); },
      weight(sim, u) {
        if (!(u.state.weightless > 0)) return;
        sim.delayEnemies(0.04);
        sim.chars().forEach((a) => sim.addBuff(a, { id: 'retribution', stats: { dmg: 0.1 }, turns: 2, maxStacks: 10 }));
      },
      extraDamage(sim, u, act) {
        let d = 0;
        if (sim.isSlowed() && isAtk(act)) { d += std(sim, u, { atk: 1 }); if (E(u) >= 2) G(sim, u, 3); }
        if (act === 'Basic') d += std(sim, u, { atk: 0.8 * 1.0 }, 'Basic');
        if (act === 'Skill') d += std(sim, u, { atk: 1.2 * 0.72 }, 'Skill');
        if (E(u) >= 1 && (act === 'Skill' || act === 'Ult') && u.state.weightless > 0) d += std(sim, u, { atk: 0.4 * 1.5 }) * (act === 'Ult' ? n(sim) : 1);
        return d;
      },
      dmgScale(sim, u, act) {
        if (E(u) < 6 || !(act === 'Skill' || act === 'Ult') || !sim.isSlowed()) return 1;
        const s = st(sim, u), cr = Math.min(1, s.cr);
        return (1 + Math.min(1, cr + 0.3) * (s.cd + 0.6)) / (1 + cr * s.cd);
      },
    },
    // ------------------------------------------------------------------ 1005 Kafka
    1005: {
      desc: 'Follow-ups also Shock (290% ATK DoT, 2 turns; E6 +156% and 1 more turn). Skill detonates DoTs: 75% on the target, 50% on adjacent. Ultimate detonates 120%; follow-ups 80%. Torture: allies with ≥75% Effect Hit Rate get +100% ATK. E1: attacks make enemies take +30% DoT (2 turns). E2: allies\' DoT +33%.',
      battleStart(sim, u) {
        sim.chars().forEach((a) => { if (a.stats0 && st(sim, a).ehr >= 0.75) sim.addBuff(a, { id: 'torture', stats: { atkPct: 1 }, turns: Infinity }); });
        if (E(u) >= 2) team(sim, 'kafkaE2', { dotDmg: 0.33 }, Infinity);
      },
      // One Shock DoT (same id as the one her Ultimate applies); E6 boost via dotScale / dotTurns.
      shock(sim, u) { sim.addDot({ id: `${u.key}:Twilight Trill`, src: u, mult: { atk: 2.9 }, turns: this.dotTurns(sim, u) }); },
      dotTurns(sim, u) { return 2 + (E(u) >= 6 ? 1 : 0); },
      dotScale(sim, u, d) { return E(u) >= 6 && d && d.id === `${u.key}:Twilight Trill` ? (2.9 + 1.56) / 2.9 : 1; },
      detonate(sim, u, main, adj) {
        const per = (sim.dots || []).reduce((a, d) => a + AD().dotDamage(sim, d), 0);
        if (per > 0) sim.addDamage(u, per * (main + adj * Math.min(2, n(sim) - 1)), 'DoT detonation');
      },
      action(sim, u, t) { if (t === 'Skill') this.detonate(sim, u, 0.75, 0.5); if (E(u) >= 1 && isAtk(t)) emod(sim, 'kafkaE1', { vulnType: { DoT: 0.3 } }, 2); },
      ult(sim, u) { this.detonate(sim, u, 1.2, 0); },
      followUpDone(sim, u) { this.shock(sim, u); this.detonate(sim, u, 0.8, 0); if (E(u) >= 1) emod(sim, 'kafkaE1', { vulnType: { DoT: 0.3 } }, 2); },
    },
    // ------------------------------------------------------------------ 1006 Silver Wolf
    1006: {
      desc: 'Side Note: +10% ATK per 10% Effect Hit Rate (max 50%). E1: +7 Energy per debuff on the target after Ultimate (max 5). E2: enemies take +20% DMG. E4: Ultimate adds 20% ATK per debuff (max 5). E6: +20% DMG per debuff on the target (max 100%).',
      battleStart(sim, u) {
        self(sim, u, 'sideNote', { atkPct: Math.min(0.5, Math.floor(st(sim, u).ehr * 10 + 1e-9) * 0.1) }, Infinity);
        if (E(u) >= 2) emod(sim, 'swE2', { vuln: 0.2 }, Infinity);
      },
      ult(sim, u) { if (E(u) >= 1) G(sim, u, 7 * Math.min(5, sim.debuffCount())); },
      extraDamage(sim, u, act) { return E(u) >= 4 && act === 'Ult' ? std(sim, u, { atk: 0.2 * Math.min(5, sim.debuffCount()) }) * n(sim) : 0; },
      dmgScale(sim, u) { return E(u) >= 6 ? 1 + Math.min(1, 0.2 * sim.debuffCount()) / (1 + st(sim, u).dmg) : 1; },
    },
    // ------------------------------------------------------------------ 1008 Arlan
    1008: {
      desc: 'Talent: +DMG up to 72% by missing HP (setting). Skill costs 15% HP. E1: Skill +10% at ≤50% HP. E6: at ≤50% HP, Ultimate +20% and adjacent targets take the full multiplier.',
      options: [{ key: 'hp', label: 'Arlan HP % (average)', type: 'number', def: 50, min: 1, max: 100, step: 1 }],
      battleStart(sim, u) {
        const hp = (+(u.cfg.opts && u.cfg.opts.hp) || 50) / 100;
        u.state.low = hp <= 0.5;
        self(sim, u, 'painAnger', { dmg: 0.72 * (1 - hp) }, Infinity);
        if (E(u) >= 1 && u.state.low) self(sim, u, 'arlanE1', { dmg_Skill: 0.1 }, Infinity);
        if (E(u) >= 6 && u.state.low) self(sim, u, 'arlanE6', { dmg_Ult: 0.2 }, Infinity);
      },
      dmgScale(sim, u, act) { return E(u) >= 6 && u.state.low && act === 'Ult' ? (3.2 + 3.2 * Math.min(2, n(sim) - 1)) / (3.2 + 1.6 * Math.min(2, n(sim) - 1)) : 1; },
    },
    // ------------------------------------------------------------------ 1009 Asta
    1009: {
      desc: 'Charging: +1 per different enemy hit (+1 more each for Fire Weakness, assumed), max 5; all allies +14% ATK per stack; from her 2nd turn −3 per turn (E6: −2; E2: none the turn after her Ultimate). Fire allies +18% DMG. Basic ATK: 80% chance to Burn (50% of the Basic\'s DMG, 3 turns). E1: Skill +1 bounce. E4: +15% Energy Regen at 2+ stacks.',
      battleStart(sim, u) { u.state.chg = 0; sim.chars().forEach((a) => { if (a.cfg.char.element === 'Fire') sim.addBuff(a, { id: 'ignite', stats: { dmg: 0.18 }, turns: Infinity }); }); },
      turnStart(sim, u) {
        if (u.actions >= 1 && !u.state.noLoss) u.state.chg = Math.max(0, u.state.chg - (E(u) >= 6 ? 2 : 3));
        u.state.noLoss = false;
        this.apply(sim, u);
      },
      ult(sim, u) { if (E(u) >= 2) u.state.noLoss = true; },
      action(sim, u, t) {
        const hit = t === 'Skill' ? Math.min(n(sim), 5 + (E(u) >= 1 ? 1 : 0)) : 1;
        u.state.chg = Math.min(5, u.state.chg + hit * 2);
        this.apply(sim, u);
        if (t === 'Basic' && sim.chance(u, 'burn', 0.8)) sim.addDot({ id: `${u.key}:burn`, src: u, mult: { atk: 0.5 * 1.0 }, turns: 3 });
      },
      apply(sim, u) {
        team(sim, 'astaCharging', { atkPct: 0.14 * u.state.chg }, Infinity);
        if (E(u) >= 4) { if (u.state.chg >= 2) sim.addBuff(u, { id: 'astaE4', err: 0.15, turns: Infinity }); else sim.removeBuff(u, 'astaE4'); }
      },
      dmgScale(sim, u, act) { return E(u) >= 1 && act === 'Skill' ? 6 / 5 : 1; },
    },
  };

  window.AVAuditKits = kits;
})();
