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
  // A kit option's value, falling back to its default.
  function O(u, key) {
    const k = kits[u.cfg.char.id], opt = k && k.options && k.options.find((o) => o.key === key);
    const v = u.cfg.opts && u.cfg.opts[key];
    return v === undefined || v === '' ? opt && opt.def : v;
  }
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
        if (isAtk(t) && sim.chance(u, 'burn', 0.5)) sim.addDot({ id: `${u.key}:burn`, src: u, mult: { atk: 0.3 }, turns: 2, targets: sim.dotTargets(AD().abilityFor(sim, u, t)) });
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
      shock(sim, u, targets = 1) { sim.addDot({ id: `${u.key}:Twilight Trill`, src: u, mult: { atk: 2.9 }, turns: this.dotTurns(sim, u), targets: Math.max(targets, this.shockTargets(sim)) }); },
      shockTargets(sim) { const d = (sim.dots || []).find((x) => x.id.endsWith(':Twilight Trill')); return d ? d.targets : 1; },
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
        const hp = (+O(u, 'hp') || 50) / 100;
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

    // ------------------------------------------------------------------ 1013 Herta
    1013: {
      desc: 'Skill +45% DMG vs enemies ≥50% HP (half). Talent follow-up (40% ATK all, +5 Energy) when an ally drops an enemy to 50% HP: setting below. Ultimate +20% vs Frozen. E1: Basic +40% ATK vs ≤50% HP (half). E2: +3% CRIT Rate per follow-up (5). E4: follow-up +10% DMG. E6: +25% ATK for 1 turn after Ultimate.',
      options: [{ key: 'fua', label: 'Herta follow-ups per cycle', type: 'number', def: 1, min: 0, max: 5, step: 0.5 }],
      battleStart(sim, u) { u.state.acc = 0; if (E(u) >= 4) self(sim, u, 'hertaE4', { dmg_FUA: 0.1 }, Infinity); },
      enemyTurnStart(sim, u, e) {
        // Spread the per-cycle follow-ups over enemy turns.
        const per = (+O(u, 'fua') || 0) / Math.max(1, sim.enemies().length);
        u.state.acc += per;
        while (u.state.acc >= 1) {
          u.state.acc -= 1;
          const ev = sim.record(u, 'FollowUp', { label: 'Fine, I\'ll Do It Myself', n: u.actions });
          ev.dmg = sim.dealDamage(u, 'FollowUp');
          G(sim, u, 5); sim.snap(ev, u);
          if (E(u) >= 2) sim.addBuff(u, { id: 'hertaE2', stats: { cr: 0.03 }, turns: Infinity, maxStacks: 5 });
          sim.fireAll('allyAttack', u, 'FollowUp');
        }
      },
      ult(sim, u) { if (E(u) >= 6) self(sim, u, 'hertaE6', { atkPct: 0.25 }, 1); },
      dmgScale(sim, u, act) {
        if (act === 'Skill') return 1 + 0.45 * HALF / (1 + st(sim, u).dmg);
        if (act === 'Ult' && sim.enemies().some((e) => e.frozen)) return 1.2;
        return 1;
      },
      extraDamage(sim, u, act) { return E(u) >= 1 && act === 'Basic' ? std(sim, u, { atk: 0.4 * HALF }, 'Basic') : 0; },
    },
    // ------------------------------------------------------------------ 1014 Saber
    1014: {
      desc: 'Core Resonance (CR): +1 at battle start, +3 whenever any ally uses an Ultimate (also +60% DMG for 2 turns), Skill +3 unless it can refill her Energy, Release +2, E1 +1 per Basic / Skill. Skill: if spending CR (8 fixed Energy each) fills her Energy, the Skill gets +14% multiplier per CR (E2: +21%) and spends it. Mana Burst (battle start, after Release): when the Skill could refill her, +1 SP and she acts immediately. After Ultimate the next Basic is Release (150% all, +150%/+220% vs 2/1 enemies). Starts at 60% Energy, stores 120 overflow (E6: 200). Crown: Skill +50% CRIT DMG 2 turns; +4% CRIT DMG per CR gained (8). E1: Ult DMG +60%. E2: ignore 1% DEF per CR gained (15). E4: +8% Wind RES PEN, +4% per Ult (3). E6: Ult +20% RES PEN; first Ult then every 3rd refunds 300 fixed Energy.',
      battleStart(sim, u) {
        u.energyOverflow = E(u) >= 6 ? 200 : 120; u.energy = Math.max(u.energy, u.maxEnergy * 0.6);
        u.state.cr = 0; u.state.gained = 0; u.state.mana = true; u.state.ults = 0;
        self(sim, u, 'knight', { cr: 0.2 }, Infinity);
        if (E(u) >= 1) self(sim, u, 'saberE1', { dmg_Ult: 0.6 }, Infinity);
        if (E(u) >= 4) self(sim, u, 'saberE4', { resPen: 0.08 }, Infinity);
        if (E(u) >= 6) self(sim, u, 'saberE6', { resPen_Ult: 0.2 }, Infinity);
        this.gainCR(sim, u, 1);
      },
      gainCR(sim, u, k) {
        u.state.cr += k; u.state.gained += k;
        self(sim, u, 'crown', { cd: 0.04 * Math.min(8, u.state.gained) }, Infinity);
        if (E(u) >= 2) self(sim, u, 'saberE2', { defIgnore: 0.01 * Math.min(15, u.state.gained) }, Infinity);
        this.checkMana(sim, u);
      },
      canRefill(sim, u) { return u.state.cr > 0 && u.energy + 30 * (1 + sim.err(u)) + 8 * u.state.cr >= u.maxEnergy - 1e-6; },
      checkMana(sim, u) {
        if (!u.state.mana || !this.canRefill(sim, u)) return;
        u.state.mana = false;
        sim.gainSP(1, u);
        sim.actNow(u);
      },
      actionType(sim, u) { return u.state.release ? 'Enhanced' : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? -1 : undefined; },
      energyFor(sim, u, t) { return t === 'Enhanced' ? 30 : undefined; },
      action(sim, u, t) {
        if (t === 'Skill') {
          self(sim, u, 'crownSkill', { cd: 0.5 }, 2);
          if (this.canRefill(sim, u)) { u.state.boost = u.state.cr; F(sim, u, 8 * u.state.cr); u.state.cr = 0; }
          else { u.state.boost = 0; this.gainCR(sim, u, 3); }
        }
        if (t === 'Enhanced') { u.state.release = false; u.state.mana = true; this.gainCR(sim, u, 2); }
        if (E(u) >= 1 && (t === 'Basic' || t === 'Skill')) this.gainCR(sim, u, 1);
      },
      ult(sim, u) {
        u.state.release = true; u.state.ults += 1;
        if (E(u) >= 4) sim.addBuff(u, { id: 'saberE4ult', stats: { resPen: 0.04 }, turns: Infinity, maxStacks: 3 });
        if (E(u) >= 6 && (u.state.ults - 1) % 3 === 0) F(sim, u, 300);
        this.allyUlt(sim, u);
      },
      allyUlt(sim, u) { self(sim, u, 'dragonCore', { dmg: 0.6 }, 2); this.gainCR(sim, u, 3); },
      dmgScale(sim, u, act) {
        if (act === 'Ult' && u.state.gilDouble) { u.state.gilDouble = false; return 2; }
        if (act === 'Skill' && u.state.boost) return 1 + u.state.boost * (0.14 + (E(u) >= 2 ? 0.07 : 0)) / 1.5;
        if (act === 'Enhanced') { const k = n(sim); return k === 1 ? (1.5 + 2.2) / 1.5 : k === 2 ? 2 : 1; }
        return 1;
      },
    },
    // ------------------------------------------------------------------ 1015 Archer
    1015: {
      desc: 'Circuit Connection: after a Skill his turn continues and he repeats it (up to 5 Skills, while SP lasts), each repeat +100% Skill DMG (2 stacks; E6: 3), 30 Energy each. Guardian: after allies gain SP with 4+ SP, +120% CRIT DMG for 1 turn. E1: 3 Skills in one turn recover 2 SP. E2: Ultimate −20% Quantum RES for 2 turns. E4: Ult DMG +150%. E6: Skill ignores 20% DEF.',
      battleStart(sim, u) {
        if (E(u) >= 4) self(sim, u, 'archerE4', { dmg_Ult: 1.5 }, Infinity);
        if (E(u) >= 6) self(sim, u, 'archerE6', { defIgnore_Skill: 0.2 }, Infinity);
      },
      action(sim, u, t) {
        if (t !== 'Skill' || u.state.circuit) return;
        u.state.circuit = true;
        let casts = 1;
        sim.addBuff(u, { id: 'circuit', stats: { dmg_Skill: 1 }, turns: Infinity, maxStacks: E(u) >= 6 ? 3 : 2 });
        while (casts < 5 && sim.sp >= 1) {
          casts += 1;
          sim.useSP(1, u);
          const ev = sim.record(u, 'FollowUp', { label: `Skill ×${casts} (Circuit Connection)`, n: u.actions });
          ev.dmg = sim.dealDamage(u, 'Skill');
          G(sim, u, 30); sim.snap(ev, u);
          sim.fireAll('allyAttack', u, 'Skill');
          sim.addBuff(u, { id: 'circuit', stats: { dmg_Skill: 1 }, turns: Infinity, maxStacks: E(u) >= 6 ? 3 : 2 });
          if (E(u) >= 1 && casts === 3) sim.gainSP(2, u);
        }
        sim.removeBuff(u, 'circuit');
        u.state.circuit = false;
      },
      spGained(sim, u) { if (sim.sp >= 4) self(sim, u, 'guardian', { cd: 1.2 }, 1); },
      ult(sim, u) { if (E(u) >= 2) emod(sim, 'archerE2', { res: 0.2 }, 2); },
    },
    // ------------------------------------------------------------------ 1101 Bronya
    1101: {
      desc: 'Basic ATK always CRITs. E4: after another ally\'s Basic ATK, a follow-up for 80% of her Basic DMG (once per turn). E6: the Skill\'s DMG boost lasts 1 more turn.',
      battleStart(sim, u) { self(sim, u, 'command', { cr_Basic: 1 }, Infinity); },
      turnStart(sim, u) { u.state.e4 = true; },
      allyAction(sim, u, a, t) {
        if (E(u) >= 6 && t && a === sim.targetOf(u) && sim.hasBuff(a, 'bronyaSkill')) { /* duration handled below */ }
        if (E(u) < 4 || t !== 'Basic' || a.kind !== 'char' || !u.state.e4) return;
        u.state.e4 = false;
        const ev = sim.record(u, 'FollowUp', { label: 'E4 Follow-up', n: u.actions });
        ev.dmg = std(sim, u, { atk: 0.8 * 1.0 }, 'FUA');
        sim.addDamage(u, ev.dmg, 'Follow-up');
        sim.fireAll('allyAttack', u, 'FollowUp');
      },
      action(sim, u, t) {
        if (t === 'Skill' && E(u) >= 6) { const tg = sim.targetOf(u); const b = tg && tg.buffs.find((x) => x.id === 'bronyaSkill'); if (b) b.turns = 2; }
      },
    },
    // ------------------------------------------------------------------ 1102 Seele
    1102: {
      desc: 'Novaflare Skill: after an ally attacks a target at ≤50% HP (half the time), she auto-casts her Skill on it once per turn (no SP, no Energy, with its SPD buff). Ultimate enters Amplification: +80% DMG and +25% Quantum RES PEN for 3 turns. E1: +15% CRIT Rate and 20% DEF ignore vs ≤80% HP (80% of the time). E6: Ultimate inflicts Butterfly Flurry (3 turns): the target takes 30% of her Ult DMG as True DMG after each attack. Kills (Resurgence extra turns, Nightshade) aren\'t simulated.',
      battleStart(sim, u) { u.state.auto = true; if (E(u) >= 1) self(sim, u, 'seeleE1', { cr: 0.15 * 0.8, defIgnore: 0.2 * 0.8 }, Infinity); },
      turnStart(sim, u) { u.state.auto = true; if (u.state.flurry > 0) u.state.flurry -= 1; },
      allyAttack(sim, u, a) {
        this.flurryHit(sim, u);
        if (!u.state.auto || a.kind !== 'char' || !sim.chance(u, 'low', HALF / 0.8)) return;
        u.state.auto = false;
        const ev = sim.record(u, 'FollowUp', { label: 'Sheathed Blade (auto)', n: u.actions });
        ev.dmg = sim.dealDamage(u, 'Skill');
        sim.snap(ev, u);
        sim.addBuff(u, { id: 'seele', pct: 0.25, turns: 3, maxStacks: E(u) >= 2 ? 2 : 1 });
        sim.fireAll('allyAttack', u, 'Skill');
      },
      ult(sim, u) {
        self(sim, u, 'amplification', { dmg: 0.8, resPen: 0.25 }, 3);
        if (E(u) >= 6) u.state.flurry = 3;
      },
      flurryHit(sim, u) { if (u.state.flurry > 0 && u.state.ultDmg) sim.addDamage(u, 0.3 * u.state.ultDmg, 'Butterfly Flurry'); },
      afterDamage(sim, u, act) {
        if (act === 'Ult') {
          // Her Ultimate's own DMG on its single target (the Ultimate event, not a Break logged after it).
          const ev = [...sim.events].reverse().find((e) => e.unit === u && e.type === 'Ultimate');
          u.state.ultDmg = ev && ev.dmg;
        } else if (isAtk(act)) this.flurryHit(sim, u);
      },
    },
    // ------------------------------------------------------------------ 1103 Serval
    1103: {
      desc: 'Skill Shock: 100% base chance (80% + 20%) on the target and adjacent. Ultimate extends Shock by 2 turns (E4: Shocks everyone). Talent: after attacking, 72% ATK Additional DMG to every Shocked enemy (E2: +4 Energy). E1: Basic hits an adjacent enemy for 60%. E6: +30% DMG vs Shocked.',
      shocked(sim, u) { return (sim.dots || []).filter((d) => d.src === u).reduce((a, d) => Math.max(a, d.targets), 0); },
      ult(sim, u) {
        (sim.dots || []).filter((d) => d.src === u).forEach((d) => { d.turns += 2; });
        if (E(u) >= 4 && !this.shocked(sim, u)) sim.addDot({ id: `${u.key}:Lightning Flash`, src: u, mult: { atk: 1.04 }, turns: 2, targets: n(sim) });
      },
      extraDamage(sim, u, act) {
        let d = 0;
        if (isAtk(act) && this.shocked(sim, u)) { d += std(sim, u, { atk: 0.72 }) * this.shocked(sim, u); if (E(u) >= 2) G(sim, u, 4); }
        if (E(u) >= 1 && act === 'Basic' && n(sim) > 1) d += std(sim, u, { atk: 0.6 }, 'Basic');
        return d;
      },
      dmgScale(sim, u) { return E(u) >= 6 && this.shocked(sim, u) ? 1 + 0.3 / (1 + st(sim, u).dmg) : 1; },
    },
    // ------------------------------------------------------------------ 1104 Gepard
    1104: {
      desc: 'Skill: 65% base chance (E1: 100%) to Freeze the target for 1 turn (60% ATK Freeze DMG; E2: Slow 20% for 1 turn after). Grit: ATK +35% of DEF.',
      battleStart(sim, u) { const s = st(sim, u); self(sim, u, 'grit', { atk: 0.35 * s.DEF }, Infinity); },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const e = sim.enemies()[0];
        if (e && sim.chance(u, 'freeze', 0.65 + (E(u) >= 1 ? 0.35 : 0))) {
          sim.freezeEnemy(e, u, { atk: 0.6 });
          if (E(u) >= 2) sim.addBuff(e, { id: 'gepardE2', pct: -0.2, turns: 2, debuff: true });
        }
      },
    },
    // ------------------------------------------------------------------ 1105 Natasha
    1105: {
      desc: 'E6: Basic ATK adds Physical DMG equal to 40% of her Max HP.',
      extraDamage(sim, u, act) { return E(u) >= 6 && act === 'Basic' ? std(sim, u, { hp: 0.4 }, 'Basic') : 0; },
    },

    // ------------------------------------------------------------------ 1106 Pela
    1106: {
      desc: 'Bash: +20% DMG vs debuffed enemies. All allies +10% Effect Hit Rate. E4: Skill −12% Ice RES for 2 turns. E6: after attacking a debuffed enemy, +40% ATK Ice Additional DMG. (Buff dispels need enemy buffs, which aren\'t simulated.)',
      battleStart(sim, u) { team(sim, 'secretStrategy', { ehr: 0.1 }, Infinity); },
      action(sim, u, t) { if (E(u) >= 4 && t === 'Skill') emod(sim, 'pelaE4', { resEl: { Ice: 0.12 } }, 2); },
      dmgScale(sim, u) { return sim.debuffCount() > 0 ? 1 + 0.2 / (1 + st(sim, u).dmg) : 1; },
      extraDamage(sim, u, act) { return E(u) >= 6 && isAtk(act) && sim.debuffCount() > 0 ? std(sim, u, { atk: 0.4 }) * (act === 'Ult' ? n(sim) : 1) : 0; },
    },
    // ------------------------------------------------------------------ 1107 Clara
    1107: {
      desc: 'Enemies that hit her are marked; her Skill deals +120% ATK to each marked enemy and clears the marks (E1: keeps them). Counter 160% ATK; Revenge +30% Counter DMG; Enhanced Counter +160% multiplier and 50% splash to adjacent. Ultimate: much higher chance to be attacked for 2 turns. E2: +30% ATK for 2 turns after Ultimate. E6: 50% chance to counter when other allies are hit; +1 Enhanced Counter.',
      battleStart(sim, u) { u.state.marked = new Set(); self(sim, u, 'revenge', { dmg_FUA: 0.3 }, Infinity); },
      hit(sim, u, e) { if (e) u.state.marked.add(e); },
      allyHit(sim, u, v, e) {
        if (E(u) < 6 || u.state.enhancedLeft > 0) return;
        if (sim.chance(u, 'e6', 0.5 / 0.8)) { if (e) u.state.marked.add(e); const ev = sim.record(u, 'FollowUp', { label: 'Counter', n: u.actions }); ev.dmg = sim.dealDamage(u, 'FollowUp', { label: 'Counter' }); G(sim, u, 5); sim.snap(ev, u); sim.fireAll('allyAttack', u, 'FollowUp'); }
      },
      ult(sim, u) { u.state.taunt = 2; u.state.enhancedLeft = E(u) >= 6 ? 3 : 2; if (E(u) >= 2) self(sim, u, 'claraE2', { atkPct: 0.3 }, 2); },
      turnStart(sim, u) { if (u.state.taunt > 0) u.state.taunt -= 1; },
      tauntMult(sim, u) { return u.state.taunt > 0 ? 5 : 1; },
      action(sim, u, t) { if (t === 'Skill') { u.state.skillMarks = u.state.marked.size; if (E(u) < 1) u.state.marked.clear(); } },
      dmgScale(sim, u, act, extra) {
        if (act === 'Skill') { const k = n(sim); return (1.2 * k + 1.2 * Math.min(k, u.state.skillMarks || 0)) / (1.2 * k + 1.2); }
        if (act === 'FollowUp' && extra && extra.label === 'Enhanced Counter') return (1.6 + 1.6) / 1.6 * (1 + 0.5 * Math.min(2, n(sim) - 1));
        return 1;
      },
    },
    // ------------------------------------------------------------------ 1108 Sampo
    1108: {
      desc: 'Wind Shear: each hit has a 65% base chance to add a stack (max 5, 4 turns), 52% ATK per stack per turn (E6: +15%). Ultimate: enemies take +30% DoT for 2 turns. E1: Skill +1 bounce. E4: Skill on 5 stacks detonates 8% of the Shear DMG.',
      battleStart(sim, u) { u.state.stacks = 0; },
      addShear(sim, u, hits) {
        for (let i = 0; i < hits; i++) if (sim.chance(u, 'shear', 0.65)) u.state.stacks = Math.min(5, u.state.stacks + 1);
        if (u.state.stacks > 0) sim.addDot({ id: `${u.key}:Windtorn Dagger`, src: u, mult: { atk: (0.52 + (E(u) >= 6 ? 0.15 : 0)) * u.state.stacks }, turns: 4 });
      },
      afterDamage(sim, u, act) {
        if (act === 'Skill') {
          if (E(u) >= 4 && u.state.stacks >= 5) { const d = (sim.dots || []).find((x) => x.id === `${u.key}:Windtorn Dagger`); if (d) sim.addDamage(u, 0.08 * AD().dotDamage(sim, d), 'DoT detonation'); }
          this.addShear(sim, u, 5 + (E(u) >= 1 ? 1 : 0));
        } else if (act === 'Ult') { emod(sim, 'surprisePresent', { vulnType: { DoT: 0.3 } }, 2); this.addShear(sim, u, n(sim)); }
        else if (isAtk(act)) this.addShear(sim, u, 1);
        if ((sim.dots || []).length === 0) u.state.stacks = 0;
      },
      dmgScale(sim, u, act) { return E(u) >= 1 && act === 'Skill' ? 6 / 5 : 1; },
    },
    // ------------------------------------------------------------------ 1109 Hook
    1109: {
      desc: 'Skill Burns (65% ATK, 2 turns; E2: 3). After Ultimate the next Skill is Enhanced (blast; E1 +20% DMG). Talent: attacking a Burned enemy adds 100% ATK (E4: also Burns adjacent). E6: +20% DMG vs Burned.',
      burned(sim, u) { return (sim.dots || []).some((d) => d.src === u); },
      ult(sim, u) { u.state.enhanced = true; },
      actionType(sim, u) { return u.state.enhanced ? 'Enhanced' : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? 1 : undefined; },
      energyFor(sim, u, t) { return t === 'Enhanced' ? 30 : undefined; },
      dotTurns(sim, u) { return E(u) >= 2 ? 3 : 2; },
      action(sim, u, t) { if (t === 'Enhanced') u.state.enhanced = false; },
      extraDamage(sim, u, act) { return isAtk(act) && act !== 'Ult' && this.burned(sim, u) ? std(sim, u, { atk: 1 }) : 0; },
      dmgScale(sim, u, act) {
        let k = 1;
        if (E(u) >= 1 && act === 'Enhanced') k *= 1.2;
        if (E(u) >= 6 && this.burned(sim, u)) k *= 1 + 0.2 / (1 + st(sim, u).dmg);
        return k;
      },
    },
    // ------------------------------------------------------------------ 1110 Lynx
    1110: {
      desc: 'Skill: Survival Response on the target (2 turns; Destruction / Preservation targets draw more attacks); +2 Energy when that target is hit. E4: the target gets +3% of Lynx\'s Max HP as ATK for 1 turn.',
      allyTarget: { Skill: 1, Ultimate: 1 },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const tg = sim.targetOf(u); if (!tg) return;
        u.state.sr = { who: tg, left: 2 };
        if (E(u) >= 4) sim.addBuff(tg, { id: 'lynxE4', stats: { atk: 0.03 * st(sim, u).HP }, turns: 1 });
        if (['Destruction', 'Preservation'].includes(tg.cfg.char.path)) sim.addBuff(tg, { id: 'srTaunt', turns: 2, tauntMult: 3 });
      },
      allyHit(sim, u, v) { if (u.state.sr && u.state.sr.who === v && u.state.sr.left > 0) G(sim, u, 2); },
      allyTurnEnd(sim, u, a) { if (u.state.sr && u.state.sr.who === a) u.state.sr.left -= 1; },
    },
    // ------------------------------------------------------------------ 1111 Luka
    1111: {
      desc: 'Fighting Will: +1 per Basic or Skill (E2: Skill +1 more), +2 per Ultimate, start with 1, max 4; at 2+ the Basic is Sky-Shatter Fist (uses 2; 3 + 50% bonus hits of 20%, then 80%), whose uppercut detonates Bleed for 85% (E6: +8% per punch). +3 Energy per stack gained. Skill Bleeds (338% ATK cap per turn, 3 turns). Ultimate: target takes +20% DMG for 3 turns. E1: +15% DMG while the target Bleeds. E4: +5% ATK per stack gained (4).',
      battleStart(sim, u) { u.state.fw = 1; },
      gain(sim, u, k) {
        for (let i = 0; i < k; i++) {
          if (u.state.fw < 4) u.state.fw += 1;
          G(sim, u, 3);
          if (E(u) >= 4) sim.addBuff(u, { id: 'lukaE4', stats: { atkPct: 0.05 }, turns: Infinity, maxStacks: 4 });
        }
      },
      actionType(sim, u, t) { return u.state.fw >= 2 ? 'Enhanced' : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? -1 : undefined; },
      energyFor(sim, u, t) { return t === 'Enhanced' ? 20 : undefined; },
      bleeding(sim, u) { return (sim.dots || []).some((d) => d.id === `${u.key}:Lacerating Fist`); },
      afterDamage(sim, u, act) {
        if (act === 'Skill') { sim.addDot({ id: `${u.key}:Lacerating Fist`, src: u, mult: { atk: 3.38 }, turns: 3 }); this.gain(sim, u, 1 + (E(u) >= 2 ? 1 : 0)); }
        if (act === 'Basic') this.gain(sim, u, 1);
        if (act === 'Enhanced') {
          u.state.fw -= 2;
          const d = (sim.dots || []).find((x) => x.id === `${u.key}:Lacerating Fist`);
          if (d) sim.addDamage(u, AD().dotDamage(sim, d) * (0.85 + (E(u) >= 6 ? 0.08 * 4.5 : 0)), 'DoT detonation');
        }
        if (E(u) >= 1 && this.bleeding(sim, u)) self(sim, u, 'lukaE1', { dmg: 0.15 }, 2);
      },
      ult(sim, u) { this.gain(sim, u, 2); emod(sim, 'lukaUlt', { vuln: 0.2 / n(sim) }, 3); },
      dmgScale(sim, u, act) { return act === 'Enhanced' ? (4.5 * 0.2 + 0.8) / (3 * 0.2 + 0.8) : 1; },
    },
    // ------------------------------------------------------------------ 1112 Topaz & Numby
    1112: {
      desc: 'Financial Turmoil: +15% DMG vs Fire-weak enemies (assumed). Windfall Bonanza: Numby +25% CRIT DMG. E1: Follow-ups vs Proof of Debt make it a Debtor: +25% CRIT DMG to Follow-ups (2 stacks). E6: Numby +10% Fire RES PEN.',
      battleStart(sim, u) { self(sim, u, 'turmoil', { dmg: 0.15 }, Infinity); },
      allyAttack(sim, u, a, t) { if (E(u) >= 1 && t === 'FollowUp') team(sim, 'debtor', { cd_FUA: 0.25 }, Infinity, { maxStacks: 2 }); },
      dmgScale(sim, u, act, extra, unit) {
        if (!unit || unit.name !== 'Numby') return 1;
        const s = st(sim, u), cr = Math.min(1, s.cr);
        let k = u.state.bonanza > 0 ? (1 + cr * (s.cd + 0.25)) / (1 + cr * s.cd) : 1;
        if (E(u) >= 6) k *= (1 - (0.2 - 0.1)) / 0.8;
        return k;
      },
    },
    // ------------------------------------------------------------------ 1201 Qingque
    1201: {
      desc: 'Tiles: on turns without Hidden Hand she uses Skill twice (1 SP each, +38% DMG per use this turn), then a Basic ATK; the next turn starts in Hidden Hand (+72% ATK, Basic becomes Cherry on Top!, no SP). Ultimate grants 4 matching tiles. Tile Battle: her first Skill each battle refunds 1 SP. Winning Hand: +10% SPD for 1 turn after Cherry on Top!. E1: Ult +10% DMG. E2: +1 Energy per tile drawn (1 per ally turn start, 2 per Skill). E4: 24% chance of a 100% follow-up after a Basic. E6: Cherry on Top! recovers 1 SP.',
      battleStart(sim, u) { u.state.hidden = false; u.state.refund = true; if (E(u) >= 1) self(sim, u, 'qqE1', { dmg_Ult: 0.1 }, Infinity); },
      allyTurnStart(sim, u) { if (E(u) >= 2) G(sim, u, 1); },
      turnStart(sim, u) { if (E(u) >= 2) G(sim, u, 1); if (u.state.next) { u.state.hidden = true; u.state.next = false; self(sim, u, 'hiddenHand', { atkPct: 0.72 }, Infinity); } },
      actionType(sim, u) { return u.state.hidden ? 'Enhanced' : 'Basic'; },
      spCost(sim, u, t) { return t === 'Enhanced' ? (E(u) >= 6 ? -1 : 0) : undefined; },
      energyFor(sim, u, t) { return t === 'Enhanced' ? 20 : undefined; },
      action(sim, u, t) {
        if (t === 'Basic') {
          let k = 0;
          while (k < 2 && sim.sp >= 1) {
            k += 1; sim.useSP(1, u);
            if (u.state.refund) { u.state.refund = false; sim.gainSP(1, u); }
            sim.record(u, 'FollowUp', { label: `Skill ×${k} (A Scoop of Moon)`, n: u.actions });
            self(sim, u, 'scoop', { dmg: 0.38 }, Infinity, { maxStacks: 4 });
            if (E(u) >= 2) G(sim, u, 2);
          }
          u.state.next = true;
          if (E(u) >= 4 && sim.chance(u, 'e4', 0.24 / 0.8)) u.state.e4 = true;
        }
        if (t === 'Enhanced') { u.state.hidden = false; sim.removeBuff(u, 'hiddenHand'); sim.addBuff(u, { id: 'winningHand', pct: 0.1, turns: 1 }); }
      },
      afterDamage(sim, u, act) {
        if (u.state.e4 && (act === 'Basic' || act === 'Enhanced')) {
          u.state.e4 = false;
          const last = [...sim.events].reverse().find((e) => e.unit === u && !e.nonTurn);
          if (last && last.dmg) { sim.record(u, 'FollowUp', { label: 'Self-Sufficer', n: u.actions }); sim.addDamage(u, last.dmg, 'Follow-up'); }
        }
      },
      turnEnd(sim, u) { sim.removeBuff(u, 'scoop'); },
      ult(sim, u) { u.state.next = true; },
    },

    // ------------------------------------------------------------------ 1202 Tingyun
    1202: {
      desc: 'Benediction: when the target attacks, +40% of their ATK as Lightning Additional DMG (E4: 60%); when Tingyun attacks, the target adds 60% of their ATK. Knell Subdual: Basic ATK +40% DMG.',
      blessed(sim, u) { const tg = sim.targetOf(u); return tg && sim.hasBuff(tg, 'benediction') ? tg : null; },
      allyAttack(sim, u, a, t) {
        if (t === 'Elation' || this.blessed(sim, u) !== a) return;
        sim.addDamage(a, std(sim, a, { atk: E(u) >= 4 ? 0.6 : 0.4 }), 'Benediction');
      },
      afterDamage(sim, u, act) {
        const tg = this.blessed(sim, u);
        if (tg && isAtk(act)) sim.addDamage(tg, std(sim, tg, { atk: 0.6 }), 'Violet Sparknado');
      },
      dmgScale(sim, u, act) { return act === 'Basic' ? 1 + 0.4 / (1 + st(sim, u).dmg) : 1; },
    },
    // ------------------------------------------------------------------ 1203 Luocha
    1203: {
      desc: 'Abyss Flower: +1 per Skill and Ultimate; at 2 he deploys the Zone for 2 of his turns. E1: all allies +20% ATK while the Zone is up. E6: Ultimate −20% All-Type RES for 2 turns. (His automatic Skill at ≤50% HP needs HP tracking, which isn\'t simulated; Skills come from the action pattern.)',
      battleStart(sim, u) { u.state.flower = 0; },
      flower(sim, u) {
        u.state.flower += 1;
        if (u.state.flower < 2) return;
        u.state.flower = 0;
        if (E(u) >= 1) team(sim, 'luochaZone', { atkPct: 0.2 }, 2, { tick: 'owner', owner: u });
      },
      action(sim, u, t) { if (t === 'Skill') this.flower(sim, u); },
      ult(sim, u) { this.flower(sim, u); if (E(u) >= 6) emod(sim, 'luochaE6', { res: 0.2 }, 2); },
    },
    // ------------------------------------------------------------------ 1204 Jing Yuan
    1204: {
      desc: 'Lightning-Lord hits splash 25% to adjacent enemies (E1: 50%). War Marshal: +10% CRIT Rate for 2 turns after Skill. Battalia Crush: Lightning-Lord +25% CRIT DMG when it acts with 6+ hits. E2: after Lightning-Lord acts, Basic / Skill / Ultimate +20% DMG for 2 turns. E6: each hit makes the target take +12% DMG until the turn ends (3 stacks).',
      action(sim, u, t) { if (t === 'Skill') self(sim, u, 'warMarshal', { cr: 0.1 }, 2); },
      allyAction(sim, u, actor) {
        if (E(u) >= 2 && actor === u.state.ll) self(sim, u, 'jyE2', { dmg_Basic: 0.2, dmg_Skill: 0.2, dmg_Ult: 0.2 }, 2);
      },
      dmgScale(sim, u, act, extra, unit) {
        if (!unit || unit.name !== 'Lightning-Lord') return 1;
        const k = n(sim), hits = u.state.lastHits || 3;
        let f = 1 + (E(u) >= 1 ? 0.5 : 0.25) * (k > 1 ? 2 * (k - 1) / k : 0);
        if (hits >= 6) { const s = st(sim, u), cr = Math.min(1, s.cr + (s.cr_FUA || 0)); const cd = s.cd + (s.cd_FUA || 0); f *= (1 + cr * (cd + 0.25)) / (1 + cr * cd); }
        if (E(u) >= 6) { let v = 0; for (let i = 0; i < hits; i++) v += 1 + 0.12 * Math.min(3, i); f *= v / hits; }
        return f;
      },
    },
    // ------------------------------------------------------------------ 1205 Blade
    1205: {
      desc: 'Hellscape (Skill, 1 SP, doesn\'t end the turn): +40% DMG and Enhanced Basic ATK (Forest of Swords) for 3 turns; consuming HP adds Charge. Ultimate adds 120% (adjacent 60%) of the HP-loss tally, assumed at its cap of 90% Max HP (E1: +150% of the tally to the target). Talent follow-up +20% DMG (E6: +50% Max HP). E2: +15% CRIT Rate in Hellscape. E4: +20% Max HP each time HP drops to 50% (2 stacks; from his Ultimate).',
      turnStart(sim, u) {
        if (sim.hasBuff(u, 'hellscape') || sim.sp < 1) return;
        sim.useSP(1, u);
        const ev = sim.record(u, 'FollowUp', { label: 'Hellscape (Skill)', n: u.actions + 1 });
        const b = self(sim, u, 'hellscape', { dmg: 0.4, ...(E(u) >= 2 ? { cr: 0.15 } : {}) }, 3);
        if (b) b.appliedTurn = -1; // this turn's Forest of Swords is the first of the 3
        window.AVEnergyKits[1205].charge(sim, u);
        sim.snap(ev, u);
      },
      actionType(sim, u) { return sim.hasBuff(u, 'hellscape') ? 'Enhanced' : undefined; },
      ult(sim, u) { if (E(u) >= 4) self(sim, u, 'bladeE4', { hpPct: 0.2 }, Infinity, { maxStacks: 2 }); },
      extraDamage(sim, u, act) {
        const tally = 0.9 * st(sim, u).HP;
        if (act === 'Ult') return this.flat(sim, u, tally * (1.2 + (E(u) >= 1 ? 1.5 : 0)) + tally * 0.6 * Math.min(2, n(sim) - 1), 'Ult');
        if (E(u) >= 1 && act === 'Enhanced') return this.flat(sim, u, tally * 1.5, null);
        if (E(u) >= 6 && act === 'FollowUp') return std(sim, u, { hp: 0.5 }, 'FUA') * n(sim);
        return 0;
      },
      // Damage of a flat base amount with Blade's multipliers (std scales a stat multiplier).
      flat(sim, u, base, type) { const hp = st(sim, u).HP; return hp > 0 ? std(sim, u, { hp: base / hp }, type) : 0; },
      dmgScale(sim, u, act) { return act === 'FollowUp' ? 1 + 0.2 / (1 + st(sim, u).dmg) : 1; },
    },
    // ------------------------------------------------------------------ 1206 Sushang
    1206: {
      desc: 'Talent: any Weakness Break gives +20% SPD for 2 turns (E6: stacks to 2, start with 1). Vanquisher: after Basic / Skill, advance 15% if an enemy is Broken. Sword Stance: Skill 33% chance (certain vs Broken) of +100% ATK; Ultimate +30% ATK and 2 extra chances at half DMG for 2 turns; Riposte +2.5% per Sword Stance (10). E1: Skill vs a Broken target refunds 1 SP. E4: +40% Break Effect.',
      battleStart(sim, u) { u.state.riposte = 0; if (E(u) >= 4) self(sim, u, 'sushangE4', { be: 0.4 }, Infinity); if (E(u) >= 6) sim.addBuff(u, { id: 'dancingBlade', pct: 0.2, turns: 2, maxStacks: 2 }); },
      weaknessBreak(sim, u) {
        const b = sim.addBuff(u, { id: 'dancingBlade', pct: 0.2, turns: 2, maxStacks: E(u) >= 6 ? 2 : 1 });
        if (b && b.stacks > 1 && E(u) >= 6) b.pct = 0.4;
      },
      ult(sim, u) { self(sim, u, 'dawnHerald', { atkPct: 0.3 }, 2); },
      action(sim, u, t) { if (E(u) >= 1 && t === 'Skill' && sim.enemies()[0] && sim.enemies()[0].broken) sim.gainSP(1, u); },
      afterDamage(sim, u, act) { if ((act === 'Basic' || act === 'Skill') && sim.brokenShare() > 0) sim.advance(u, 0.15); },
      extraDamage(sim, u, act) {
        if (act !== 'Skill') return 0;
        const e0 = sim.enemies()[0], p = e0 && e0.broken ? 1 : 0.33;
        const count = p + (sim.hasBuff(u, 'dawnHerald') ? 2 * p * 0.5 : 0);
        const dmg = std(sim, u, { atk: 1 }) * count * (1 + 0.025 * u.state.riposte);
        u.state.riposte = Math.min(10, u.state.riposte + p * (sim.hasBuff(u, 'dawnHerald') ? 3 : 1));
        return dmg;
      },
    },
    // ------------------------------------------------------------------ 1207 Yukong
    1207: {
      desc: 'Roaring Bowstrings: Skill gives 2 stacks; each ally turn end removes 1 (not the turn she gains them). While active: all allies +80% ATK, +2 Energy per ally action, E4: +30% DMG for her; Ultimate adds +28% CRIT Rate and +65% CRIT DMG to all allies for as long as it lasts (E6: Ultimate gives 1 stack). Bowmaster: Imaginary allies +12% DMG. Talent: Basic ATK +80% ATK and double Toughness DMG, every other turn. E2: +5 Energy the first time each ally is at full Energy (resets on her Ultimate).',
      battleStart(sim, u) {
        u.state.bow = 0; u.state.full = new Set(); u.state.talentCd = 0;
        sim.chars().filter((a) => a.cfg.char.element === 'Imaginary').forEach((a) => sim.addBuff(a, { id: 'bowmaster', stats: { dmg: 0.12 }, turns: Infinity }));
      },
      setBow(sim, u, k) {
        u.state.bow = k;
        if (k > 0) { team(sim, 'bowstrings', { atkPct: 0.8 }, Infinity); if (E(u) >= 4) self(sim, u, 'yukongE4', { dmg: 0.3 }, Infinity); }
        else sim.units.forEach((x) => { sim.removeBuff(x, 'bowstrings'); sim.removeBuff(x, 'bowUlt'); sim.removeBuff(x, 'yukongE4'); });
      },
      action(sim, u, t) {
        if (t === 'Skill') { this.setBow(sim, u, 2); u.state.fresh = true; }
        if (u.state.bow > 0) G(sim, u, 2);
      },
      allyAction(sim, u, a) { if (u.state.bow > 0 && a.kind === 'char') G(sim, u, 2); },
      tick(sim, u) { if (u.state.fresh) { u.state.fresh = false; return; } if (u.state.bow > 0) this.setBow(sim, u, u.state.bow - 1); },
      turnEnd(sim, u) { this.tick(sim, u); },
      allyTurnEnd(sim, u) { this.tick(sim, u); },
      ult(sim, u) {
        if (E(u) >= 6) this.setBow(sim, u, Math.min(2, u.state.bow + 1));
        if (u.state.bow > 0) team(sim, 'bowUlt', { cr: 0.28, cd: 0.65 }, Infinity);
        u.state.full.clear();
      },
      allyTurnStart(sim, u) {
        if (E(u) < 2) return;
        for (const a of sim.chars()) if (a.maxEnergy > 0 && a.energy >= a.maxEnergy && !u.state.full.has(a)) { u.state.full.add(a); G(sim, u, 5); }
      },
      turnStart(sim, u) { if (u.state.talentCd > 0) u.state.talentCd -= 1; },
      extraDamage(sim, u, act) {
        if (act !== 'Basic' || u.state.talentCd > 0) return 0;
        u.state.talentCd = 1;
        const ab = u.cfg.char.combat.abilities.find((a) => a.type === 'Basic');
        AD().applyToughness(sim, u, ab, u);
        return std(sim, u, { atk: 0.8 }, 'Basic');
      },
    },
    // ------------------------------------------------------------------ 1208 Fu Xuan
    1208: {
      desc: 'Matrix of Prescience (Skill, 3 of her turns): all allies +12% CRIT Rate (E1: +30% CRIT DMG) and +6% of her Max HP. Taiyi: Skill +20 Energy if the Matrix is still active. E4: +5 Energy when another ally is hit under the Matrix. E6: Ultimate adds 200% of the team\'s HP-loss tally, assumed at its cap of 120% of her Max HP.',
      action(sim, u, t) {
        if (t !== 'Skill') return;
        if (sim.hasBuff(u, 'knowledge')) G(sim, u, 20);
        const hp = 0.06 * st(sim, u).HP;
        team(sim, 'knowledge', { cr: 0.12, hp, ...(E(u) >= 1 ? { cd: 0.3 } : {}) }, 3, { tick: 'owner', owner: u });
      },
      allyHit(sim, u, v) { if (E(u) >= 4 && sim.hasBuff(u, 'knowledge')) G(sim, u, 5); },
      extraDamage(sim, u, act) { return E(u) >= 6 && act === 'Ult' ? std(sim, u, { hp: 2 * 1.2 }, 'Ult') : 0; },
    },
    // ------------------------------------------------------------------ 1209 Yanqing
    1209: {
      desc: 'Soulsteel Sync (Skill, 1 turn, lost when hit): +20% CRIT Rate, +30% CRIT DMG, lower aggro (E2: +10% Energy Regen). Ultimate: +60% CRIT Rate, +50% CRIT DMG with Sync, for 1 turn. Talent follow-ups have a 65% base chance to Freeze for 1 turn. Icing on the Kick: +30% ATK Additional DMG after attacks (enemy assumed Ice-weak). Gentle Blade: +10% SPD for 2 turns on CRIT. E1: +60% ATK vs Frozen. E4: +12% Ice RES PEN.',
      battleStart(sim, u) { if (E(u) >= 4) self(sim, u, 'yanqingE4', { resPen: 0.12 }, Infinity); },
      action(sim, u, t) {
        if (t === 'Skill') { self(sim, u, 'sync', { cr: 0.2, cd: 0.3, ...(E(u) >= 2 ? { err: 0.1 } : {}) }, 1); }
        if (isAtk(t)) this.after(sim, u);
      },
      ult(sim, u) { self(sim, u, 'raining', { cr: 0.6, ...(sim.hasBuff(u, 'sync') ? { cd: 0.5 } : {}) }, 1); this.after(sim, u); },
      after(sim, u) { if (sim.chance(u, 'gentle', Math.min(1, st(sim, u).cr) / 0.8)) sim.addBuff(u, { id: 'gentleBlade', pct: 0.1, turns: 2 }); },
      followUpDone(sim, u) {
        const e = sim.enemies()[0];
        if (e && sim.chance(u, 'freeze', 0.65)) sim.freezeEnemy(e, u, { atk: 0.5 });
      },
      hit(sim, u) { sim.removeBuff(u, 'sync'); },
      tauntMult(sim, u) { return sim.hasBuff(u, 'sync') ? 0.4 : 1; },
      extraDamage(sim, u, act) {
        if (!isAtk(act)) return 0;
        let d = std(sim, u, { atk: 0.3 });
        const e = sim.enemies()[0];
        if (E(u) >= 1 && e && e.frozen) d += std(sim, u, { atk: 0.6 });
        return d;
      },
    },

    // ------------------------------------------------------------------ 1210 Guinaifen
    1210: {
      desc: 'Skill Burns the target and adjacent enemies; High Poles: Basic ATK has an 80% base chance to Burn too. Ultimate: each Burn instantly deals 92% of its DMG. Firekiss: each Burn tick adds a 7% vulnerability stack (3 turns, max 3; E6: 4). Walking on Knives: +20% DMG vs Burned. E2: Burn multiplier +40% when reapplied to a Burned enemy. E4: +2 Energy per Burn tick. (E1\'s Effect RES shred only raises hit chances; the sim\'s chance roll uses the base chance.)',
      burn(sim, u) { return (sim.dots || []).find((d) => d.src === u); },
      battleStart(sim, u) { u.state.kiss = 0; },
      action(sim, u, t) {
        if (E(u) >= 2 && (t === 'Basic' || t === 'Skill') && this.burn(sim, u)) u.state.e2 = true;
        if (t === 'Basic' && sim.chance(u, 'highPoles', 0.8)) {
          const old = this.burn(sim, u);
          sim.addDot({ id: `${u.key}:Blazing Welcome`, src: u, mult: { atk: window.AVEffects.P(u, 'BPSkill', 3) }, turns: 2, targets: old ? old.targets : 1 });
        }
      },
      afterDamage(sim, u, act) {
        if (act !== 'Ult') return;
        const d = this.burn(sim, u);
        if (d) sim.addDamage(u, 0.92 * AD().dotDamage(sim, d) * d.targets, 'DoT detonation');
      },
      dotScale(sim, u, d) { return u.state.e2 && d && d.src === u ? (window.AVEffects.P(u, 'BPSkill', 3) + 0.4) / window.AVEffects.P(u, 'BPSkill', 3) : 1; },
      enemyTurnStart(sim, u, e) {
        const d = this.burn(sim, u);
        if (!d || sim.enemies().indexOf(e) >= d.targets) return;
        if (E(u) >= 4) G(sim, u, 2);
        u.state.kiss = Math.min(E(u) >= 6 ? 4 : 3, u.state.kiss + 1);
        emod(sim, 'firekiss', { vuln: 0.07 * u.state.kiss * d.targets / n(sim) }, 3);
      },
      dmgScale(sim, u) { return this.burn(sim, u) ? 1 + 0.2 / (1 + st(sim, u).dmg) : 1; },
    },
    // ------------------------------------------------------------------ 1211 Bailu
    1211: {
      desc: 'Skill heals the target, then 2 more allies; Qihuang Analects: overhealed allies +10% Max HP for 2 turns. Ultimate: Invigoration for 2 turns. E1: +8 Energy to each ally when their Invigoration ends (assumed at full HP). E4: each Skill heal gives +10% DMG for 2 turns (3 stacks).',
      allyTarget: { Skill: 1 },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const tg = sim.targetOf(u) || u;
        const order = [tg, ...sim.chars().filter((a) => a !== tg)];
        for (const a of order.slice(0, 3)) {
          sim.addBuff(a, { id: 'qihuang', stats: { hpPct: 0.1 }, turns: 2 });
          if (E(u) >= 4) sim.addBuff(a, { id: 'bailuE4', stats: { dmg: 0.1 }, turns: 2, maxStacks: 3 });
        }
      },
      ult(sim, u) {
        u.state.inv = u.state.inv || new Set();
        for (const a of sim.chars()) { sim.addBuff(a, { id: 'invigoration', turns: 2 }); u.state.inv.add(a); }
      },
      checkInv(sim, u, a) {
        if (E(u) < 1 || !u.state.inv || !u.state.inv.has(a) || sim.hasBuff(a, 'invigoration')) return;
        u.state.inv.delete(a);
        G(sim, a, 8);
      },
      turnEnd(sim, u) { this.checkInv(sim, u, u); },
      allyTurnEnd(sim, u, a) { this.checkInv(sim, u, a); },
    },
    // ------------------------------------------------------------------ 1212 Jingliu
    1212: {
      desc: 'Spectral Transmigration: +50% CRIT Rate; Deathrealm +20% Ultimate DMG; Moonlight +44% CRIT DMG per stack (E4: +64%, max 5), from teammates\' HP she consumes per attack (3) and allies being hit. Every 20 times allies take DMG or lose HP: +1 Syzygy. Frost Wraith: gaining Syzygy at the cap makes the next attack ignore 25% DEF. E1: Ultimate / Enhanced Skill +36% CRIT DMG for 1 turn and an extra 80% Max HP hit. E2: after Ultimate, the next Enhanced Skill +80% DMG. E6: +30% Ice RES PEN in Spectral Transmigration.',
      battleStart(sim, u) { u.state.hpLoss = 0; },
      spectralBuffs(sim, u) {
        if (sim.hasBuff(u, 'spectral')) return;
        self(sim, u, 'spectral', { cr: 0.5, dmg_Ult: 0.2, ...(E(u) >= 6 ? { resPen: 0.3 } : {}) }, Infinity);
      },
      moon(sim, u, k) {
        for (let i = 0; i < k; i++) self(sim, u, 'moonlight', { cd: 0.44 + (E(u) >= 4 ? 0.2 : 0) }, Infinity, { maxStacks: 5 });
      },
      loss(sim, u, k) {
        u.state.hpLoss += k;
        while (u.state.hpLoss >= 20) { u.state.hpLoss -= 20; window.AVEffects.kits[1212].gain(sim, u); }
      },
      action(sim, u, t) {
        if (u.state.spectral && isAtk(t)) {
          this.spectralBuffs(sim, u);
          const mates = sim.allies(u).length;
          this.moon(sim, u, mates);
          this.loss(sim, u, mates);
        }
        if (E(u) >= 1 && t === 'Enhanced') self(sim, u, 'jingliuE1', { cd: 0.36 }, 1);
        if (u.state.wraith && isAtk(t)) { u.state.wraith = false; self(sim, u, 'frostWraith', { defIgnore: 0.25 }, Infinity); }
      },
      ult(sim, u) {
        if (u.state.spectral) this.spectralBuffs(sim, u);
        if (E(u) >= 1) self(sim, u, 'jingliuE1', { cd: 0.36 }, 1);
        if (u.state.wraith) { u.state.wraith = false; self(sim, u, 'frostWraith', { defIgnore: 0.25 }, Infinity); }
      },
      syzygyGained(sim, u, capped) { if (capped) u.state.wraith = true; },
      allyHit(sim, u) { if (u.state.spectral) this.moon(sim, u, 1); this.loss(sim, u, 1); },
      hit(sim, u) { if (u.state.spectral) this.moon(sim, u, 1); this.loss(sim, u, 1); },
      extraDamage(sim, u, act) { return E(u) >= 1 && (act === 'Ult' || act === 'Enhanced') ? std(sim, u, { hp: 0.8 }, act === 'Ult' ? 'Ult' : 'Skill') : 0; },
      dmgScale(sim, u, act) {
        if (E(u) >= 2 && act === 'Enhanced' && u.state.e2) { u.state.e2 = false; return 1 + 0.8 / (1 + st(sim, u).dmg); }
        return 1;
      },
      afterDamage(sim, u, act) {
        if (act === 'Ult') u.state.e2 = true;
        sim.removeBuff(u, 'frostWraith');
        if (!u.state.spectral) { sim.removeBuff(u, 'spectral'); sim.removeBuff(u, 'moonlight'); }
      },
    },
    // ------------------------------------------------------------------ 1213 Dan Heng • Imbibitor Lunae
    1213: {
      desc: 'Dracore Libre: each turn he enhances his Basic ATK up to the chosen level (1–3 SP, paid with Squama Sacrosancta first): Transcendence (3 hits), Divine Spear (5), Fulgurant Leap (7). Ultimate gives 2 Squama (E2: 3, max 3). Righteous Heart: +10% DMG per hit this turn (max 6; E1: 2 per hit, max 10). Outroar: +12% CRIT DMG before each hit from the 4th (max 4; E4: kept into the next turn). Jolt Anew: +24% CRIT DMG (enemy assumed Imaginary-weak). E6: each teammate Ultimate gives his next Fulgurant Leap +20% Imaginary RES PEN (3 stacks).',
      options: [{ key: 'lvl', label: 'Enhancement level', type: 'select', def: '3', choices: [['3', 'Fulgurant Leap (3 SP)'], ['2', 'Divine Spear (2 SP)'], ['1', 'Transcendence (1 SP)'], ['0', 'Beneficent Lotus (Basic)']] }],
      NAMES: ['Beneficent Lotus', 'Transcendence', 'Divine Spear', 'Fulgurant Leap'],
      HITS: [2, 3, 5, 7],
      battleStart(sim, u) { u.state.squama = 0; u.state.outroar = 0; u.state.e6 = 0; self(sim, u, 'joltAnew', { cd: 0.24 }, Infinity); },
      actionType(sim, u) {
        const lvl = Math.max(0, Math.min(+O(u, 'lvl') || 0, Math.floor(sim.sp + u.state.squama + 1e-9)));
        u.state.lvl = lvl;
        return lvl > 0 ? 'Enhanced' : 'Basic';
      },
      spCost(sim, u, t) {
        if (t !== 'Enhanced') return undefined;
        u.state.useSq = Math.min(u.state.squama, u.state.lvl);
        return u.state.lvl - u.state.useSq;
      },
      energyFor(sim, u, t) { return t === 'Enhanced' ? [20, 30, 35, 40][u.state.lvl] : undefined; },
      dmgAbility(sim, u, act) { return act === 'Enhanced' ? this.NAMES[u.state.lvl] : undefined; },
      action(sim, u, t) {
        if (t === 'Enhanced') { u.state.squama -= u.state.useSq || 0; u.state.useSq = 0; }
        if (E(u) >= 6 && t === 'Enhanced' && u.state.lvl === 3 && u.state.e6 > 0) { self(sim, u, 'dhilE6', { resPen: 0.2 * u.state.e6 }, Infinity); u.state.e6 = 0; }
      },
      ult(sim, u) { u.state.squama = Math.min(3, u.state.squama + 2 + (E(u) >= 2 ? 1 : 0)); },
      allyUlt(sim, u) { if (E(u) >= 6) u.state.e6 = Math.min(3, u.state.e6 + 1); },
      dmgScale(sim, u, act) {
        const hits = act === 'Ult' ? 3 : act === 'Basic' ? 2 : act === 'Enhanced' ? this.HITS[u.state.lvl] : 0;
        if (!hits) return 1;
        const s = st(sim, u), per = E(u) >= 1 ? 2 : 1, cap = E(u) >= 1 ? 10 : 6;
        const cr = Math.min(1, s.cr), crit = (k) => (1 + cr * (s.cd + 0.12 * k)) / (1 + cr * s.cd);
        const start = E(u) >= 4 ? u.state.outroar : 0;
        const spear = act === 'Enhanced' && u.state.lvl >= 2;
        let f = 0, roar = start;
        for (let i = 0; i < hits; i++) {
          if (spear && i >= 3) roar = Math.min(4, roar + 1);
          f += (1 + s.dmg + 0.1 * Math.min(cap, i * per)) / (1 + s.dmg) * crit(roar);
        }
        if (act !== 'Ult') u.state.outroar = spear ? roar : 0;
        return f / hits;
      },
      afterDamage(sim, u) { sim.removeBuff(u, 'dhilE6'); },
    },
    // ------------------------------------------------------------------ 1214 Xueyi
    1214: {
      desc: 'Clairvoyant Loom: DMG +100% of Break Effect (max 240%). Ultimate: up to +60% DMG by the Toughness it removes, +10% when the target has ≥50% Toughness. E1: follow-up +40% DMG. E4: Ultimate +40% Break Effect for 2 turns.',
      action(sim, u) { const e = sim.enemies()[0]; u.state.preTough = e && !e.broken ? e.tough : 0; },
      ult(sim, u) { const e = sim.enemies()[0]; u.state.preTough = e && !e.broken ? e.tough : 0; if (E(u) >= 4) self(sim, u, 'xueyiE4', { be: 0.4 }, 2); },
      dmgScale(sim, u, act) {
        const s = st(sim, u);
        let f = (1 + s.dmg + Math.min(2.4, s.be || 0)) / (1 + s.dmg);
        if (act === 'Ult') {
          const ab = u.cfg.char.combat.abilities.find((a) => a.type === 'Ult');
          const ut = ((ab && ab.tough && ab.tough.one) || 120) / 3;
          const pre = u.state.preTough || 0;
          f *= 1 + 0.6 * Math.min(1, pre / ut) + (pre >= 0.5 * (sim.enemyToughness || 1) ? 0.1 : 0);
        }
        if (E(u) >= 1 && act === 'FollowUp') f *= 1 + 0.4 / (1 + s.dmg);
        return f;
      },
    },
    // ------------------------------------------------------------------ 1215 Hanya
    1215: {
      desc: 'Sanction: an ally using Basic ATK / Skill / Ultimate on the Burdened enemy gets +30% DMG for 2 turns (E6: 40%). Scrivener: the ally who triggers Burden\'s SP recovery +10% ATK for 1 turn. E4: Ultimate lasts 1 more turn.',
      sanction(sim, u, a, t) {
        if (!u.state.burdenOn || !['Basic', 'Skill', 'Ult', 'Enhanced'].includes(t)) return;
        sim.addBuff(a, { id: 'sanction', stats: { dmg: E(u) >= 6 ? 0.4 : 0.3 }, turns: 2 });
        if (u.state.burden !== u.state.lastBurden) sim.addBuff(a, { id: 'scrivener', stats: { atkPct: 0.1 }, turns: 1 });
        u.state.lastBurden = u.state.burden;
        if (!(u.state.burden > 0)) u.state.burdenOn = false;
      },
      action(sim, u, t) { if (t === 'Skill') { u.state.burdenOn = true; u.state.lastBurden = 2; } },
      afterDamage(sim, u, act) {
        if (act === 'Basic' || act === 'Skill') this.sanction(sim, u, u, act);
        if (act === 'Ult' && E(u) >= 4) { const tg = sim.targetOf(u); if (tg) tg.buffs.filter((b) => b.id === 'hanya' || b.id === 'hanyaUlt').forEach((b) => { b.turns = 3; }); }
      },
      allyAttack(sim, u, a, t) { if (a.kind === 'char') this.sanction(sim, u, a, t); },
    },
    // ------------------------------------------------------------------ 1217 Huohuo
    1217: {
      desc: 'Divine Provision: 2 turns at battle start, 3 after Skill / Ultimate (E1: 4), counting down at her turn start; while up, each ally turn start or Ultimate triggers a heal (6 per Provision), +1 Energy each (Stress Reaction). Ultimate: teammates +40% ATK for 2 turns (+24% more with 160+ Max Energy). E1: all allies +12% SPD while Provision is up. E6: each heal gives +50% DMG for 2 turns.',
      battleStart(sim, u) { this.provide(sim, u, 2); },
      provide(sim, u, turns) {
        u.state.prov = turns; u.state.heals = 6;
        if (E(u) >= 1) sim.chars().forEach((a) => sim.addBuff(a, { id: 'huohuoE1', pct: 0.12, turns, tick: 'owner', owner: u }));
      },
      turnStart(sim, u) { if (u.state.prov > 0) u.state.prov -= 1; this.heal(sim, u, u); },
      action(sim, u, t) { if (t === 'Skill') this.provide(sim, u, E(u) >= 1 ? 4 : 3); },
      ult(sim, u) {
        sim.allies(u).forEach((a) => sim.addBuff(a, { id: 'huohuoUlt', stats: { atkPct: 0.4 + (a.maxEnergy >= 160 ? 0.24 : 0) }, turns: 2 }));
        this.heal(sim, u, u);
        this.provide(sim, u, E(u) >= 1 ? 4 : 3);
      },
      heal(sim, u, a) {
        if (!(u.state.prov > 0) || !(u.state.heals > 0)) return;
        u.state.heals -= 1;
        G(sim, u, 1);
        if (E(u) >= 6) sim.addBuff(a, { id: 'huohuoE6', stats: { dmg: 0.5 }, turns: 2 });
      },
      allyTurnStart(sim, u, a) { if (a.kind === 'char') this.heal(sim, u, a); },
      allyUlt(sim, u, a) { if (a.kind === 'char') this.heal(sim, u, a); },
    },
    // ------------------------------------------------------------------ 1218 Jiaoqiu
    1218: {
      desc: 'Ashen Roast: +1 stack per Basic / Skill / Ultimate hit (E1: +2; max 5, E6: 9), 2 turns; 15% vulnerability +5% per extra stack, and it counts as Burn (180% ATK DoT; E2: +300%). Ultimate: sets stacks to the highest, then a Zone for 3 of his turns: +15% Ultimate DMG taken, 60% base chance of +1 stack when an enemy acts (6 times). Hearth Kindle: +60% ATK per 15% Effect Hit Rate above 80% (max 240%). E1: allies +40% DMG vs Roasted enemies. E6: −3% All-Type RES per stack.',
      battleStart(sim, u) {
        u.state.roast = 0; u.state.zone = 0;
        const ehr = st(sim, u).ehr || 0;
        const k = Math.min(4, Math.max(0, Math.floor((ehr - 0.8 + 1e-9) / 0.15)));
        if (k) self(sim, u, 'hearthKindle', { atkPct: 0.6 * k }, Infinity);
      },
      roast(sim, u, add) {
        u.state.roast = Math.min(E(u) >= 6 ? 9 : 5, u.state.roast + add);
        const s = u.state.roast;
        emod(sim, 'ashenRoast', { vuln: 0.15 + 0.05 * (s - 1), ...(E(u) >= 6 ? { res: 0.03 * s } : {}) }, 2);
        if (E(u) >= 1) team(sim, 'jiaoqiuE1', { dmg: 0.4 }, Infinity);
      },
      action(sim, u, t) { if (t === 'Basic' || t === 'Skill') this.roast(sim, u, 1 + (E(u) >= 1 ? 1 : 0)); },
      ult(sim, u) {
        u.state.zone = 3; u.state.zoneProcs = 6;
        emod(sim, 'jiaoqiuZone', { vulnType: { Ult: 0.15 } }, 3);
        this.roast(sim, u, 1 + (E(u) >= 1 ? 1 : 0));
      },
      turnStart(sim, u) { if (u.state.zone > 0 && --u.state.zone === 0) sim.enemyMods = (sim.enemyMods || []).filter((m) => m.id !== 'jiaoqiuZone'); },
      enemyTurnStart(sim, u) {
        if (u.state.zone > 0 && u.state.zoneProcs > 0 && sim.chance(u, 'jqZone', 0.6)) { u.state.zoneProcs -= 1; this.roast(sim, u, 1); }
      },
      dotScale(sim, u, d) { return E(u) >= 2 && d && d.id.endsWith(':Quartet Finesse, Octave Finery') ? (1.8 + 3) / 1.8 : 1; },
    },

    // ------------------------------------------------------------------ 1220 Feixiao
    1220: {
      desc: 'Skill: launches 1 extra Talent follow-up. E1: each Boltsunder Blitz / Waraxe Skyward raises the rest of the Ultimate by 10% (5 stacks). E2: +1 Flying Aureus per ally follow-up (6 per turn). E4: Talent follow-ups double Toughness DMG and give +8% SPD for 2 turns. E6: Ultimate +20% RES PEN; Talent follow-ups count as Ultimate DMG with +140% multiplier.',
      battleStart(sim, u) { u.state.e2n = 0; if (E(u) >= 6) self(sim, u, 'feixiaoE6', { resPen_Ult: 0.2 }, Infinity); },
      turnStart(sim, u) { u.state.e2n = 0; },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        window.AVEnergyHelpers.followUp(sim, u, 0, 'Follow-up');
        window.AVEnergyKits[1220].count(sim, u);
      },
      allyAttack(sim, u, a, t) {
        if (E(u) < 2 || t !== 'FollowUp' || a.kind !== 'char' || u.state.e2n >= 6) return;
        u.state.e2n += 1;
        u.state.aureus = Math.min(12, u.state.aureus + 1);
      },
      followUpDone(sim, u) {
        if (E(u) < 4) return;
        sim.addBuff(u, { id: 'feixiaoE4', pct: 0.08, turns: 2 });
        AD().applyToughness(sim, u, u.cfg.char.combat.abilities.find((a) => a.type === 'Talent'), u);
      },
      dmgScale(sim, u, act) {
        if (act === 'Ult' && E(u) >= 1) return (0.9 * (6 + 0.1 * (0 + 1 + 2 + 3 + 4 + 5)) + 1.6 * 1.5) / (0.9 * 6 + 1.6);
        if (act === 'FollowUp' && E(u) >= 6) {
          const s = st(sim, u), p = window.AVEffects.P(u, 'Talent', 0);
          return (p + 1.4) / p * (1 + s.dmg + (s.dmg_FUA || 0) + (s.dmg_Ult || 0)) / (1 + s.dmg + (s.dmg_FUA || 0));
        }
        return 1;
      },
    },
    // ------------------------------------------------------------------ 1221 Yunli
    1221: {
      desc: 'Counter when hit (120% ATK + 60% adjacent; True Sunder: +30% ATK for 1 turn on each Counter). Ultimate: Parry and Taunt until the next ally or enemy turn ends; being hit launches "Intuit: Cull" (220% + 110% adjacent + 6 × 72% random; E1: 9 and +20% DMG), otherwise "Intuit: Slash" (220% + 110%; Fiery Wheel: the next Slash becomes Cull). Intuit is Ultimate DMG with +100% CRIT DMG. E2: Counters ignore 20% DEF. E6: any enemy action triggers Cull; Intuit +15% CRIT Rate and +20% Physical RES PEN.',
      battleStart(sim, u) { if (E(u) >= 2) self(sim, u, 'yunliE2', { defIgnore_FUA: 0.2 }, Infinity); },
      counter(sim, u, label, energy) {
        self(sim, u, 'trueSunder', { atkPct: 0.3 }, 1);
        window.AVEnergyHelpers.followUp(sim, u, energy, label);
      },
      intuit(sim, u, cull) {
        u.state.parry = false;
        if (!cull && u.state.wheel) cull = true;
        u.state.wheel = !cull;
        self(sim, u, 'intuit', { cd: 1, ...(E(u) >= 2 ? { defIgnore: 0.2 } : {}), ...(E(u) >= 6 ? { cr: 0.15, resPen: 0.2 } : {}), ...(E(u) >= 1 ? { dmg: 0.2 } : {}) }, Infinity);
        this.counter(sim, u, cull ? 'Intuit: Cull' : 'Intuit: Slash', cull ? 25 : 0);
        sim.removeBuff(u, 'intuit');
      },
      hit(sim, u) { if (u.state.parry) this.intuit(sim, u, true); else this.counter(sim, u, 'Counter', 25); },
      ult(sim, u) { u.state.parry = true; },
      tauntMult(sim, u) { return u.state.parry ? 1000 : 1; },
      enemyTurnStart(sim, u) { if (u.state.parry && E(u) >= 6) this.intuit(sim, u, true); },
      turnEnd(sim, u) { if (u.state.parry) this.intuit(sim, u, false); },
      allyTurnEnd(sim, u) { if (u.state.parry) this.intuit(sim, u, false); },
      isIntuit: (extra) => extra && /^Intuit/.test(extra.label || ''),
      dmgScale(sim, u, act, extra) { return this.isIntuit(extra) ? 0 : 1; },
      extraDamage(sim, u, act, extra) {
        if (!this.isIntuit(extra)) return 0;
        const adj = Math.min(2, n(sim) - 1);
        const cull = extra.label === 'Intuit: Cull' ? 0.72 * (E(u) >= 1 ? 9 : 6) : 0;
        return std(sim, u, { atk: 2.2 + 1.1 * adj + cull }, 'Ult');
      },
    },
    // ------------------------------------------------------------------ 1222 Lingsha
    1222: {
      desc: 'Vermilion Waft: +25% of Break Effect as ATK (max 50%). Ultimate: Befog, enemies take +25% Break DMG for 2 turns. Ember\'s Echo: when an ally is hit while Fuyuan is out and someone is at ≤60% HP (assumed half the time), Fuyuan attacks without using an action (every 2 of her turns). E1: +50% Weakness Break Efficiency; Broken enemies −20% DEF. E2: Ultimate +40% Break Effect to all allies for 3 turns. E6: Fuyuan out: enemies −20% All-Type RES, and each Fuyuan attack adds 4 × 50% ATK hits.',
      battleStart(sim, u) {
        u.state.ember = 0; u.state.emberCd = 0;
        self(sim, u, 'vermilion', { atkPct: Math.min(0.5, 0.25 * ((u.stats0 && u.stats0.be) || 0)) }, Infinity);
        if (E(u) >= 1) self(sim, u, 'lingshaE1', { wbe: 0.5 }, Infinity);
      },
      fuyuan(sim, u) { return sim.units.find((x) => x.owner === u && x.name === 'Fuyuan' && x.alive); },
      turnStart(sim, u) { if (u.state.emberCd > 0) u.state.emberCd -= 1; },
      ult(sim, u) {
        emod(sim, 'befog', { vulnType: { Break: 0.25 } }, 2);
        if (E(u) >= 2) team(sim, 'lingshaE2', { be: 0.4 }, 3);
      },
      weaknessBreak(sim, u) { if (E(u) >= 1) emod(sim, 'lingshaE1', { def: 0.2 * sim.brokenShare() }, 1); },
      ember(sim, u) {
        const f = this.fuyuan(sim, u);
        if (!f || u.state.emberCd > 0) return;
        u.state.ember += 0.5;
        if (u.state.ember < 1) return;
        u.state.ember -= 1; u.state.emberCd = 2;
        const ev = sim.record(f, 'FollowUp', { label: 'Ember\'s Echo' });
        ev.dmg = sim.dealDamage(f, 'Summon');
        sim.fireAll('allyAttack', f, 'FollowUp');
      },
      hit(sim, u) { this.ember(sim, u); },
      allyHit(sim, u) { this.ember(sim, u); },
      allyAction(sim, u, a) { if (E(u) >= 6 && a.name === 'Fuyuan' && a.owner === u) emod(sim, 'lingshaE6', { res: 0.2 }, 2); },
      action(sim, u, t) { if (E(u) >= 6 && t === 'Skill') emod(sim, 'lingshaE6', { res: 0.2 }, 2); },
      extraDamage(sim, u, act, extra, unit) { return E(u) >= 6 && unit && unit.name === 'Fuyuan' ? std(sim, u, { atk: 4 * 0.5 }, 'FUA') : 0; },
    },
    // ------------------------------------------------------------------ 1223 Moze
    1223: {
      desc: 'Skill marks Prey with 9 Charge and Moze Departs (no turns; he can still use his Ultimate). Each ally attack on Prey: 30% ATK Additional DMG and −1 Charge (E1: +2 Energy); every 3 Charge spent: a 160% follow-up (+10 Energy; Nightfeather +1 SP, once per turn). At 0 Charge he returns with a 20% advance. Ultimate is a follow-up that also launches the Talent follow-up. Vengewise: Prey takes +25% follow-up DMG. E1: +20 Energy at battle start. E2: allies +40% CRIT DMG vs Prey. E4: Ultimate +30% DMG for 2 turns. E6: follow-up multiplier +25%.',
      ultWhileSuspended: true,
      battleStart(sim, u) { u.state.charge = 0; if (E(u) >= 1) G(sim, u, 20); },
      action(sim, u, t) { if (t === 'Skill') { u.state.charge = 9; u.state.spent = 0; } },
      afterDamage(sim, u, act) {
        if (act === 'Ult') this.fua(sim, u);
        if (act !== 'Skill') return;
        u.suspended = true;
        emod(sim, 'prey', { vulnType: { FUA: 0.25 } }, Infinity);
        if (E(u) >= 2) team(sim, 'mozeE2', { cd: 0.4 }, Infinity);
      },
      endPrey(sim, u) {
        u.suspended = false;
        sim.enemyMods = (sim.enemyMods || []).filter((m) => m.id !== 'prey');
        sim.units.forEach((x) => sim.removeBuff(x, 'mozeE2'));
        sim.advance(u, 0.2);
      },
      fua(sim, u) {
        window.AVEnergyHelpers.followUp(sim, u, 10);
        if (u.state.nfTurn !== u.actions) { u.state.nfTurn = u.actions; sim.gainSP(1, u); }
      },
      allyAttack(sim, u, a) {
        if (a.kind !== 'char' || !(u.state.charge > 0)) return;
        sim.addDamage(u, std(sim, u, { atk: window.AVEffects.P(u, 'Talent', 0) }), 'Additional');
        if (E(u) >= 1) G(sim, u, 2);
        u.state.charge -= 1;
        if (++u.state.spent >= 3) { u.state.spent = 0; this.fua(sim, u); }
        if (u.state.charge <= 0) this.endPrey(sim, u);
      },
      ult(sim, u) { if (E(u) >= 4) self(sim, u, 'mozeE4', { dmg: 0.3 }, 2); },
      dmgScale(sim, u, act) {
        if (act !== 'FollowUp') return 1;
        const p0 = window.AVEffects.P(u, 'Talent', 0), p2 = window.AVEffects.P(u, 'Talent', 2);
        return (p2 + (E(u) >= 6 ? 0.25 : 0)) / (p0 + p2);
      },
    },
    // ------------------------------------------------------------------ 1224 March 7th (The Hunt)
    1224: {
      desc: 'Charge: +1 per Basic ATK and per Shifu attack or Ultimate (max 10); at 7 she acts immediately with +80% DMG and an Enhanced Basic ATK (uses 7): 3 hits of 80% plus up to 3 more at a 60% fixed chance each (Ultimate: +2 hits and +20% chance). Her first turn uses Skill to name Shifu. Shifu path effect per Basic ATK hit: DPS paths add 20% ATK Additional DMG; Harmony / Nihility / Preservation / Abundance double the Toughness DMG. Tide Tamer: after an Enhanced Basic ATK, Shifu +60% CRIT DMG and +36% Break Effect for 2 turns. E2: Shifu\'s Basic / Skill triggers a 60% follow-up (+1 Charge). E6: after Ultimate, the next Enhanced Basic ATK +50% CRIT DMG.',
      DPS: new Set(['Erudition', 'Destruction', 'The Hunt', 'Remembrance', 'Elation']),
      battleStart(sim, u) { u.state.charge = 0; u.state.boost = false; },
      shifu(sim, u) { return u.state.named ? sim.targetOf(u) : null; },
      actionType(sim, u) {
        if (u.state.charge >= 7) return 'Enhanced';
        if (!u.state.named && sim.targetOf(u) && sim.sp >= 1) return 'Skill';
        return 'Basic';
      },
      gain(sim, u, k = 1) {
        u.state.charge = Math.min(10, u.state.charge + k);
        if (u.state.charge >= 7 && !u.state.pending && sim.current !== u) { u.state.pending = true; sim.actNow(u); }
      },
      hits(sim, u) { const b = u.state.boost, p = 0.6 + (b ? 0.2 : 0); return 3 + (b ? 2 : 0) + p + p * p + p * p * p; },
      pathEffect(sim, u, k) {
        const sf = this.shifu(sim, u);
        if (!sf) return 0;
        if (this.DPS.has(sf.cfg.char.path)) return std(sim, u, { atk: 0.2 * k });
        const ab = u.cfg.char.combat.abilities.find((a) => a.type === 'Basic');
        for (let i = 0; i < Math.round(k); i++) AD().applyToughness(sim, u, ab, u);
        return 0;
      },
      action(sim, u, t) {
        if (t === 'Skill') u.state.named = true;
        if (t === 'Basic') this.gain(sim, u);
        if (t === 'Enhanced') { u.state.charge -= 7; u.state.pending = false; self(sim, u, 'ascended', { dmg: 0.8, ...(E(u) >= 6 && u.state.boost ? { cd: 0.5 } : {}) }, Infinity); }
      },
      afterDamage(sim, u, act) {
        if (act === 'Enhanced') {
          sim.removeBuff(u, 'ascended');
          u.state.boost = false;
          const sf = this.shifu(sim, u);
          if (sf) sim.addBuff(sf, { id: 'tideTamer', stats: { cd: 0.6, be: 0.36 }, turns: 2 });
        }
      },
      ult(sim, u) { u.state.boost = true; },
      allyAttack(sim, u, a, t) { if (a === this.shifu(sim, u) && t !== 'Ult') this.gain(sim, u); },
      allyUlt(sim, u, a) { if (a === this.shifu(sim, u)) this.gain(sim, u); },
      followUpDone(sim, u) { this.gain(sim, u); },
      dmgScale(sim, u, act) { return act === 'Enhanced' ? this.hits(sim, u) / 3 : 1; },
      extraDamage(sim, u, act) {
        if (act === 'Basic') return this.pathEffect(sim, u, 1);
        if (act === 'Enhanced') return this.pathEffect(sim, u, this.hits(sim, u));
        if (act === 'FollowUp') return std(sim, u, { atk: 0.6 }, 'FUA') + this.pathEffect(sim, u, 1);
        return 0;
      },
    },
    // ------------------------------------------------------------------ 1225 Fugue
    1225: {
      desc: 'Skill: Foxian Prayer on the target (+30% Break Effect; E1: +50% Weakness Break Efficiency; E4: +20% Break DMG) and Torrid Scorch for 3 of her turns (Basic ATK becomes the blast Fiery Caress); each Prayer-holder attack lowers the enemy\'s DEF by 18% for 2 turns. Cloudflame Luster: Broken enemies get 40% more Toughness that, once depleted, deals Break DMG again. Verdantia: Weakness Break delays the enemy 15%. Sylvan Enigma: +30% Break Effect; her first Skill refunds 1 SP. Phecda: each Break gives teammates +6% Break Effect (+12% more at her 220% BE) for 2 turns (2 stacks). E2: +3 Energy per Break. E6: +50% Weakness Break Efficiency; Prayer on all allies during Torrid Scorch.',
      battleStart(sim, u) {
        u.state.scorch = 0; u.state.firstSkill = true;
        sim.lusterPct = 0.4;
        self(sim, u, 'sylvan', { be: 0.3 }, Infinity);
        if (E(u) >= 6) self(sim, u, 'fugueE6', { wbe: 0.5 }, Infinity);
      },
      turnStart(sim, u) { if (u.state.scorch > 0) u.state.scorch -= 1; },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        u.state.scorch = 3;
        if (u.state.firstSkill) { u.state.firstSkill = false; sim.gainSP(1, u); }
        const tg = sim.targetOf(u);
        sim.units.forEach((x) => sim.removeBuff(x, 'foxianPrayer'));
        const holders = E(u) >= 6 ? sim.chars() : tg ? [tg] : [];
        for (const a of holders) sim.addBuff(a, { id: 'foxianPrayer', stats: { be: 0.3, ...(E(u) >= 1 ? { wbe: 0.5 } : {}), ...(E(u) >= 4 ? { breakDmg: 0.2 } : {}) }, turns: 3, tick: 'owner', owner: u });
      },
      dmgAbility(sim, u, act) { return act === 'Basic' && u.state.scorch > 0 ? 'Fiery Caress' : undefined; },
      allyAttack(sim, u, a) { if (sim.hasBuff(a, 'foxianPrayer')) emod(sim, 'foxianDef', { def: 0.18 }, 2); },
      afterDamage(sim, u, act) { if (isAtk(act) && sim.hasBuff(u, 'foxianPrayer')) emod(sim, 'foxianDef', { def: 0.18 }, 2); },
      weaknessBreak(sim, u, by, e) {
        if (e) sim.delay(e, 0.15);
        const k = 0.06 + (st(sim, u).be >= 2.2 ? 0.12 : 0);
        sim.allies(u).forEach((a) => sim.addBuff(a, { id: 'phecda', stats: { be: k }, turns: 2, maxStacks: 2 }));
        if (E(u) >= 2) G(sim, u, 3);
      },
    },

    // ------------------------------------------------------------------ 1301 Gallagher
    1301: {
      desc: 'Ultimate: Besotted on all enemies for 2 turns (E4: 3), +12% Break DMG taken; his next Basic ATK becomes Nectar Blitz (250%, −15% enemy ATK). E6: +20% Break Effect and Weakness Break Efficiency.',
      battleStart(sim, u) { if (E(u) >= 6) self(sim, u, 'gallagherE6', { be: 0.2, wbe: 0.2 }, Infinity); },
      ult(sim, u) { u.state.nectar = true; emod(sim, 'besotted', { vulnType: { Break: 0.12 } }, E(u) >= 4 ? 3 : 2); },
      actionType(sim, u) { return u.state.nectar ? 'Enhanced' : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? -1 : undefined; },
      action(sim, u, t) { if (t === 'Enhanced') u.state.nectar = false; },
    },
    // ------------------------------------------------------------------ 1302 Argenti
    1302: {
      desc: 'Ultimate: the 180-Energy version by default (option). Apotheosis: +2.5% CRIT Rate per stack (E1: +4% CRIT DMG too), +1 per enemy hit by Basic / Skill / Ultimate and +1 at turn start, max 10 (E4: 12, starts with 2). Courage: +15% DMG vs enemies ≤50% HP (half). E2: Ultimate with 3+ enemies: +40% ATK for 1 turn. E6: Ultimate ignores 30% DEF.',
      options: [{ key: 'ult', label: 'Ultimate', type: 'select', def: '180', choices: [['180', '180 Energy (Merit Bestowed)'], ['90', '90 Energy (Supreme Beauty)']] }],
      battleStart(sim, u) {
        if (O(u, 'ult') !== '90') { u.maxEnergy = 180; u.energy += 45; }
        u.state.apo = 0;
        self(sim, u, 'courage', { dmg: 0.15 * HALF }, Infinity);
        if (E(u) >= 6) self(sim, u, 'argentiE6', { defIgnore_Ult: 0.3 }, Infinity);
        if (E(u) >= 4) this.apo(sim, u, 2);
      },
      apo(sim, u, k) {
        u.state.apo = Math.min(E(u) >= 4 ? 12 : 10, u.state.apo + k);
        sim.removeBuff(u, 'apotheosis');
        self(sim, u, 'apotheosis', { cr: 0.025 * u.state.apo, ...(E(u) >= 1 ? { cd: 0.04 * u.state.apo } : {}) }, Infinity);
      },
      turnStart(sim, u) { this.apo(sim, u, 1); },
      dmgAbility(sim, u, act) { return act === 'Ult' ? (O(u, 'ult') === '90' ? 'For In This Garden, Supreme Beauty Bestows' : 'Merit Bestowed in "My" Garden') : undefined; },
      ult(sim, u) { if (E(u) >= 2 && n(sim) >= 3) self(sim, u, 'argentiE2', { atkPct: 0.4 }, 1); },
      afterDamage(sim, u, act) { if (act === 'Basic' || act === 'Skill' || act === 'Ult') this.apo(sim, u, sim.targetsHit(u, act)); },
    },
    // ------------------------------------------------------------------ 1303 Ruan Mei
    1303: {
      desc: 'Talent: allies breaking a Weakness trigger 120% of her Ice Break DMG on that enemy (E6: 320%). Ultimate Zone (2 of her turns; E6: 3): enemies about to recover from Break get Thanatoplum Rebloom instead: their Break is extended and their action delayed by 20% of her Break Effect + 10%, plus 50% of her Ice Break DMG (once per Break). Candle Lights: Skill +6% DMG per 10% Break Effect above 120% (max 36%). E1: Zone ignores 20% DEF. E2: allies +40% ATK vs Broken enemies. E4: +100% Break Effect for 3 turns on any Break.',
      battleStart(sim, u) {
        u.state.zone = 0;
        if (E(u) >= 2) team(sim, 'ruanMeiE2', { atkPct: (s) => 0.4 * s.brokenShare() }, Infinity);
      },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const be = st(sim, u).be || 0;
        const k = Math.min(0.36, 0.06 * Math.floor(Math.max(0, be - 1.2 + 1e-9) / 0.1));
        if (k) team(sim, 'candleLights', { dmg: k }, 3, { tick: 'owner', owner: u });
      },
      ult(sim, u) {
        u.state.zone = E(u) >= 6 ? 3 : 2;
        if (E(u) >= 1) team(sim, 'ruanMeiE1', { defIgnore: 0.2 }, u.state.zone, { tick: 'owner', owner: u });
      },
      afterDamage(sim, u, act) { if (act === 'Ult' && E(u) >= 6) sim.chars().forEach((a) => a.buffs.filter((b) => b.id === 'rmZone').forEach((b) => { b.turns = 3; })); },
      turnStart(sim, u) { if (u.state.zone > 0) u.state.zone -= 1; },
      weaknessBreak(sim, u, by, e) {
        if (by && by.kind === 'char') sim.addDamage(u, AD().breakDamage(sim, u) * (1.2 + (E(u) >= 6 ? 2 : 0)), 'Break (Ruan Mei)');
        if (E(u) >= 4) self(sim, u, 'ruanMeiE4', { be: 1 }, 3);
      },
      breakRecover(sim, u, e) {
        if (!(u.state.zone > 0) || e.rebloomed) return;
        e.rebloomed = true;
        e.rebloom = 0.2 * (st(sim, u).be || 0) + 0.1;
        sim.addDamage(u, 0.5 * AD().breakDamage(sim, u), 'Thanatoplum Rebloom');
      },
    },
    // ------------------------------------------------------------------ 1304 Aventurine
    1304: {
      desc: 'Leverage: +2% CRIT Rate per 100 DEF above 1600 (max 48%). E1: shielded allies +20% CRIT DMG (shields are kept up). E2: Basic ATK −12% All-Type RES for 3 turns. E4: before his follow-up, +40% DEF for 2 turns and 3 more hits. E6: +50% DMG per shielded teammate (max 150%).',
      battleStart(sim, u) {
        const def = st(sim, u).DEF;
        const cr = Math.min(0.48, 0.02 * Math.floor(Math.max(0, def - 1600) / 100));
        if (cr) self(sim, u, 'leverage', { cr }, Infinity);
        if (E(u) >= 1) team(sim, 'aventurineE1', { cd: 0.2 }, Infinity);
        if (E(u) >= 6) self(sim, u, 'aventurineE6', { dmg: Math.min(1.5, 0.5 * sim.allies(u).length) }, Infinity);
      },
      action(sim, u, t) { if (E(u) >= 2 && t === 'Basic') emod(sim, 'aventurineE2', { res: 0.12 }, 3); },
      dmgScale(sim, u, act) {
        if (act !== 'FollowUp' || E(u) < 4) return 1;
        self(sim, u, 'aventurineE4', { defPct: 0.4 }, 2);
        return 10 / 7;
      },
    },
    // ------------------------------------------------------------------ 1305 Dr. Ratio
    1305: {
      desc: 'Uses the "Debuffs on his target" setting. Summation: Skill gives +2.5% CRIT Rate and +5% CRIT DMG per debuff for 1 turn (max 6; E1: max 10 and 4 more stacks). Deduction: with 3+ debuffs, +10% DMG per debuff (max 50%). E2: follow-ups add 20% ATK Additional DMG per debuff (max 4). E6: follow-ups +50% DMG.',
      deb(u) { const v = u.cfg.opts && u.cfg.opts.debuffs; return v === undefined || v === '' ? 3 : +v; },
      battleStart(sim, u) { const d = this.deb(u); if (d >= 3) self(sim, u, 'deduction', { dmg: Math.min(0.5, 0.1 * d) }, Infinity); },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const k = Math.min(E(u) >= 1 ? 10 : 6, this.deb(u) + (E(u) >= 1 ? 4 : 0));
        if (k) self(sim, u, 'summation', { cr: 0.025 * k, cd: 0.05 * k }, 1);
      },
      dmgScale(sim, u, act) { return act === 'FollowUp' && E(u) >= 6 ? 1 + 0.5 / (1 + st(sim, u).dmg) : 1; },
      extraDamage(sim, u, act) { return act === 'FollowUp' && E(u) >= 2 ? std(sim, u, { atk: 0.2 * Math.min(4, this.deb(u)) }) : 0; },
    },
    // ------------------------------------------------------------------ 1306 Sparkle
    1306: {
      desc: 'Ultimate: Cipher on all allies for 3 turns: each Figment stack adds 6% more vulnerability (E1: Cipher +40% ATK). Artificial Flower: if an ally spends 3+ SP in one turn, her next Skill is free. E1: +15% SPD for 2 turns at battle start and after Skill. E2: each Figment stack −10% DEF. E6: Skill CRIT DMG +30% of hers, and it spreads to all Cipher holders.',
      battleStart(sim, u) { u.state.fig = 0; u.state.cipher = 0; if (E(u) >= 1) sim.addBuff(u, { id: 'sparkleE1', pct: 0.15, turns: 2 }); },
      figment(sim, u) {
        const f = u.state.fig;
        emod(sim, 'figment', { vuln: (0.04 + (u.state.cipher > 0 ? 0.06 : 0)) * f, ...(E(u) >= 2 ? { def: 0.1 * f } : {}) }, 2);
      },
      spUsed(sim, u, by, k) {
        u.state.fig = Math.min(3, u.state.fig + k);
        this.figment(sim, u);
        if (by && by.kind === 'char') {
          if (u.state.spTurn !== sim.turnId) { u.state.spTurn = sim.turnId; u.state.spThisTurn = 0; }
          u.state.spThisTurn += k;
          if (u.state.spThisTurn >= 3) u.state.freeSkill = true;
        }
      },
      spCost(sim, u, t) { return t === 'Skill' && u.state.freeSkill ? 0 : undefined; },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        if (u.state.freeSkill && u.state.spTurn !== sim.turnId) u.state.freeSkill = false;
        if (E(u) >= 1) sim.addBuff(u, { id: 'sparkleE1', pct: 0.15, turns: 2 });
      },
      afterDamage(sim, u, act) {
        if (act !== 'Skill' || E(u) < 6) return;
        const tg = sim.targetOf(u), b = tg && tg.buffs.find((x) => x.id === 'sparkleCD');
        if (!b) return;
        b.stats = { ...b.stats, cd: b.stats.cd + 0.3 * st(sim, u).cd };
        if (u.state.cipher > 0) sim.chars().forEach((a) => sim.addBuff(a, { id: 'sparkleCD', stats: b.stats, turns: 2 }));
      },
      ult(sim, u) {
        u.state.cipher = 3;
        if (E(u) >= 1) team(sim, 'cipherATK', { atkPct: 0.4 }, 3, { tick: 'owner', owner: u });
        this.figment(sim, u);
      },
      turnStart(sim, u) { if (u.state.cipher > 0) u.state.cipher -= 1; },
    },

    // ------------------------------------------------------------------ 1307 Black Swan
    1307: {
      desc: 'Arcana stacks are tracked: +5 at a 65% base chance when she attacks, +1 at 65% per other DoT tick, Epiphany adds 50% more and stops the halving after each tick (max 50; E2: +30 at battle start; E6: max 80, teammates\' attacks add 1 at 65%, every application doubled). Arcana: 240% + 12% per stack, ignores 20% DEF. Candleflame: all allies +60% of her Effect Hit Rate as DMG (max 72%). Goblet: Basic ATK / Ultimate and battle start also apply the Skill DEF shred. E1: enemies −25% Wind / Physical / Fire / Lightning RES. E4: Epiphany +20% DMG taken.',
      battleStart(sim, u) {
        u.state.arc = 0;
        this.add(sim, u, E(u) >= 2 ? 30 : 0, true);
        if (sim.chance(u, 'arcStart', 0.65)) this.add(sim, u, 1);
        const ehr = (u.stats0 && u.stats0.ehr) || 0;
        team(sim, 'candleflame', { dmg: Math.min(0.72, 0.6 * ehr) }, Infinity);
        emod(sim, 'bsDef', { def: 0.208 }, 3);
        if (E(u) >= 1) emod(sim, 'bsE1', { resEl: { Wind: 0.25, Physical: 0.25, Fire: 0.25, Thunder: 0.25 } }, Infinity);
      },
      epiphany(sim) { return (sim.enemyMods || []).some((m) => m.id === 'epiphany'); },
      add(sim, u, k, fixed) {
        if (!k) return;
        let v = k * (E(u) >= 6 && !fixed ? 2 : 1);
        if (this.epiphany(sim) && !fixed) v *= 1.5;
        u.state.arc = Math.min(E(u) >= 6 ? 80 : 50, u.state.arc + v);
      },
      afterDamage(sim, u, act) {
        if (isAtk(act) && sim.chance(u, 'viscera', 0.65)) this.add(sim, u, 5);
        if (act === 'Basic') emod(sim, 'bsDef', { def: 0.208 }, 3);
      },
      ult(sim, u) { emod(sim, 'bsDef', { def: 0.208 }, 3); if (E(u) >= 4) emod(sim, 'bsE4', { vuln: 0.2 }, 2); },
      allyAttack(sim, u, a) { if (E(u) >= 6 && a.kind === 'char' && sim.chance(u, 'arcE6', 0.65)) this.add(sim, u, 1); },
      enemyTurnStart(sim, u, e) {
        if (e !== sim.enemies()[0]) return;
        const others = (sim.dots || []).filter((d) => !d.id.endsWith(":Loom of Fate's Caprice")).length;
        for (let i = 0; i < others; i++) if (sim.chance(u, 'arcDot', 0.65)) this.add(sim, u, 1);
        if (!this.epiphany(sim)) u.state.arc = Math.floor(u.state.arc / 2);
      },
      dotScale(sim, u, d) {
        if (!d || !d.id.endsWith(":Loom of Fate's Caprice")) return 1;
        const P = window.AVEffects.P, base = P(u, 'Talent', 0), adj = P(u, 'Talent', 4);
        const k = (sim.enemyLevel || 95) + 20, shred = (sim.enemyMods || []).reduce((a, m) => a + (m.def || 0), 0);
        const ign = (k * Math.max(0, 1 - shred) + 100) / (k * Math.max(0, 1 - shred - 0.2) + 100);
        return (base + 0.12 * u.state.arc + adj) / (base + adj) * ign;
      },
    },
    // ------------------------------------------------------------------ 1308 Acheron
    1308: {
      desc: 'Ultimate: −20% All-Type RES for its duration; Thunder Core: Rainblade hits on Crimson Knot targets give +30% DMG per stack (3) for 3 turns, and Stygian Resurge adds 6 × 25% ATK random Ultimate DMG hits. E1: +18% CRIT Rate vs debuffed enemies. E2: The Abyss needs one fewer Nihility teammate. E4: enemies take +8% Ultimate DMG. E6: +20% Ultimate RES PEN; Basic ATK and Skill count as Ultimate DMG.',
      battleStart(sim, u) {
        if (E(u) >= 1) self(sim, u, 'acheronE1', { cr: (s) => (s.debuffCount() > 0 ? 0.18 : 0) }, Infinity);
        if (E(u) >= 4) emod(sim, 'acheronE4', { vulnType: { Ult: 0.08 } }, Infinity);
        if (E(u) >= 6) self(sim, u, 'acheronE6', { resPen_Ult: 0.2 }, Infinity);
      },
      ult(sim, u) {
        emod(sim, 'acheronUlt', { res: 0.2 }, Infinity);
        self(sim, u, 'thunderCore', { dmg: 0.3 }, 3, { maxStacks: 3 });
        self(sim, u, 'thunderCore', { dmg: 0.3 }, 3, { maxStacks: 3 });
        self(sim, u, 'thunderCore', { dmg: 0.3 }, 3, { maxStacks: 3 });
      },
      afterDamage(sim, u, act) { if (act === 'Ult') sim.enemyMods = (sim.enemyMods || []).filter((m) => m.id !== 'acheronUlt'); },
      extraDamage(sim, u, act) { return act === 'Ult' ? std(sim, u, { atk: 6 * 0.25 }, 'Ult') : 0; },
      dmgType(sim, u, act) { return E(u) >= 6 && (act === 'Basic' || act === 'Skill') ? 'Ult' : undefined; },
      dmgScale(sim, u, act) {
        if (E(u) < 2 || !['Basic', 'Skill', 'Ult'].includes(act)) return 1;
        const k = sim.allies(u).filter((a) => a.cfg.char.path === 'Nihility').length;
        return k === 1 ? 1.6 / 1.15 : k === 0 ? 1.15 : 1;
      },
    },
    // ------------------------------------------------------------------ 1309 Robin
    1309: {
      desc: 'Concerto: Impromptu Flourish +25% follow-up CRIT DMG for all allies; E1: +24% All-Type RES PEN. E6: Concerto hits get +450% CRIT DMG for the first 8 per Ultimate.',
      ult(sim, u) { team(sim, 'flourish', { cd_FUA: 0.25, ...(E(u) >= 1 ? { resPen: 0.24 } : {}) }, Infinity); },
      turnStart(sim, u) { if (!u.state.concerto) sim.units.forEach((x) => sim.removeBuff(x, 'flourish')); },
    },
    // ------------------------------------------------------------------ 1310 Firefly
    1310: {
      desc: 'Complete Combustion: Enhanced Skill (Deathstar Overload: 200% + 20% of Break Effect, adjacent half; Break Effect counted up to 360%) when SP allows (E1: always, and it ignores 15% DEF), else Enhanced Basic ATK. Module α: breaking a Weakness with them delays the Combustion countdown 10% (3 times). Module γ: +0.8% Break Effect per 10 ATK above 1800. E2: a Break in Combustion gives an extra turn (once per turn). E6: +20% Fire RES PEN in Combustion.',
      battleStart(sim, u) {
        const atk = st(sim, u).ATK;
        const be = 0.008 * Math.floor(Math.max(0, atk - 1800) / 10);
        if (be) self(sim, u, 'moduleGamma', { be }, Infinity);
      },
      turnStart(sim, u) { u.state.e2Used = false; u.state.skill = u.state.combust && (E(u) >= 1 || sim.sp >= 1); },
      spCost(sim, u, t) { return t === 'Enhanced' ? (u.state.skill ? (E(u) >= 1 ? 0 : 1) : -1) : undefined; },
      dmgAbility(sim, u, act) { return act === 'Enhanced' && u.state.skill ? 'Fyrefly Type-IV: Deathstar Overload' : undefined; },
      action(sim, u, t) {
        if (t === 'Enhanced') { u.state.alpha = u.state.alpha || 0; if (E(u) >= 1 && u.state.skill) self(sim, u, 'fireflyE1', { defIgnore: 0.15 }, Infinity); }
      },
      ult(sim, u) { u.state.alpha = 0; if (E(u) >= 6) self(sim, u, 'fireflyE6', { resPen: 0.2 }, Infinity); },
      afterDamage(sim, u) { sim.removeBuff(u, 'fireflyE1'); if (!u.state.combust) sim.removeBuff(u, 'fireflyE6'); },
      weaknessBreak(sim, u, by) {
        if (by !== u || !u.state.combust || sim.current !== u) return;
        if (u.state.alpha < 3) { u.state.alpha += 1; const cd = sim.units.find((x) => x.key === `${u.key}:combust` && x.alive); if (cd) sim.delay(cd, 0.1); }
        if (E(u) >= 2 && !u.state.e2Used) { u.state.e2Used = true; sim.extraTurn(u); }
      },
      extraDamage(sim, u, act) {
        if (act !== 'Enhanced' || !u.state.skill) return 0;
        const be = Math.min(3.6, st(sim, u).be || 0);
        return std(sim, u, { atk: 2 + 0.2 * be + (1 + 0.1 * be) * Math.min(2, n(sim) - 1) }, 'Skill');
      },
    },
    // ------------------------------------------------------------------ 1312 Misha
    1312: {
      desc: 'Ultimate: 3 hits of 60% (E4: 66%), +1 per Skill Point allies spend and per Skill, max 10 (E1: +1 per enemy, up to 5 more). Each hit has a 20% base chance to Freeze its target (first hit +80%; +60% Effect Hit Rate during the Ultimate); Freeze: 1 turn, 30% ATK. Transmission: +30% CRIT DMG vs Frozen enemies. E2: each hit has a 24% base chance of −16% DEF for 3 turns. E6: +30% DMG during the Ultimate; the next Skill recovers 1 SP.',
      battleStart(sim, u) { u.state.hits = 3; },
      spUsed(sim, u, by, k) { if (by && by.kind === 'char') u.state.hits = Math.min(10, u.state.hits + k); },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        u.state.hits = Math.min(10, u.state.hits + 1);
        if (u.state.e6) { u.state.e6 = false; sim.gainSP(1, u); }
      },
      ult(sim, u) {
        u.state.ultHits = Math.min(10 + (E(u) >= 1 ? 5 : 0), u.state.hits + (E(u) >= 1 ? Math.min(5, n(sim)) : 0));
        u.state.hits = 3;
        self(sim, u, 'interlock', { ehr: 0.6, ...(E(u) >= 6 ? { dmg: 0.3 } : {}) }, Infinity);
        const es = sim.enemies();
        for (let i = 0; i < u.state.ultHits; i++) {
          const e = es[i === 0 ? 0 : i % es.length];
          if (e && !e.frozen && sim.chance(u, 'mishaFreeze', i === 0 ? 1 : 0.2)) sim.freezeEnemy(e, u, { atk: 0.3 });
          if (E(u) >= 2 && sim.chance(u, 'mishaE2', 0.24)) emod(sim, 'mishaE2', { def: 0.16 }, 3);
        }
        if (E(u) >= 6) u.state.e6 = true;
      },
      afterDamage(sim, u, act) { if (act === 'Ult') sim.removeBuff(u, 'interlock'); },
      dmgScale(sim, u, act) {
        if (act !== 'Ult') return 1;
        const s = st(sim, u), cr = Math.min(1, s.cr), es = sim.enemies();
        const fz = es.length ? es.filter((e) => e.frozen).length / es.length : 0;
        return (u.state.ultHits || 3) * (E(u) >= 4 ? 0.66 / 0.6 : 1) * (1 + fz * cr * 0.3 / (1 + cr * s.cd));
      },
    },

    // ------------------------------------------------------------------ 1313 Sunday
    1313: {
      desc: 'E1: his Skill target ignores 16% DEF for 2 turns. E2: The Beatified +30% DMG. E6: the Talent CRIT Rate buff stacks to 3 and lasts 4 turns, his Ultimate applies it too, and CRIT Rate above 100% becomes CRIT DMG at 2×.',
      cr6(sim, u, tg) {
        sim.removeBuff(tg, 'sundayCR');
        sim.addBuff(tg, { id: 'sundayCR6', stats: { cr: 0.2, cd: (s, a) => {
          const base = ((a.stats0 && a.stats0.cr) || 0) + a.buffs.reduce((t, b) => t + (b.stats && typeof b.stats.cr === 'number' ? b.stats.cr * (b.stacks || 1) : 0), 0);
          return 2 * Math.max(0, base - 1) / Math.max(1, (a.buffs.find((b) => b.id === 'sundayCR6') || {}).stacks || 1);
        } }, turns: 4, maxStacks: 3 });
      },
      afterDamage(sim, u, act) {
        const tg = sim.targetOf(u); if (!tg) return;
        if (act === 'Skill') {
          if (E(u) >= 1) sim.addBuff(tg, { id: 'sundayE1', stats: { defIgnore: 0.16 }, turns: 2 });
          if (E(u) >= 6) this.cr6(sim, u, tg);
        }
        if (act === 'Ult') {
          if (E(u) >= 2) { sim.units.forEach((x) => sim.removeBuff(x, 'sundayE2')); sim.addBuff(tg, { id: 'sundayE2', stats: { dmg: 0.3 }, turns: 3, tick: 'owner', owner: u }); }
          if (E(u) >= 6) this.cr6(sim, u, tg);
        }
      },
    },
    // ------------------------------------------------------------------ 1314 Jade
    1314: {
      desc: 'Debt Collector: after their attack, 25% ATK Quantum Additional DMG per enemy hit (from Jade); her Skill can\'t be used while one exists. Pawned Asset: +2.4% CRIT DMG and +0.5% ATK per stack (max 50): +5 per Talent follow-up, +3 at each Debt Collector turn start, +1 per enemy at battle start. Ultimate: the next 2 Talent follow-ups +80% multiplier. E1: Talent follow-up +32% DMG. E2: +18% CRIT Rate at 15+ stacks. E4: Ultimate: ignore 12% DEF for 3 turns. E6: +20% Quantum RES PEN and she counts as a Debt Collector while one exists.',
      battleStart(sim, u) { u.state.pawn = 0; u.state.enh = 0; this.pawn(sim, u, n(sim)); },
      pawn(sim, u, k) {
        u.state.pawn = Math.min(50, u.state.pawn + k);
        const p = u.state.pawn;
        sim.removeBuff(u, 'pawned');
        self(sim, u, 'pawned', { cd: 0.024 * p, atkPct: 0.005 * p, ...(E(u) >= 2 && p >= 15 ? { cr: 0.18 } : {}) }, Infinity);
      },
      dc(sim, u) { const tg = sim.targetOf(u); return tg && sim.hasBuff(tg, 'jade') ? tg : null; },
      actionType(sim, u) { return this.dc(sim, u) ? 'Basic' : undefined; },
      allyTurnStart(sim, u, a) { if (a === this.dc(sim, u)) this.pawn(sim, u, 3); },
      turnStart(sim, u) { if (this.dc(sim, u) === u) this.pawn(sim, u, 3); },
      collect(sim, u, a, t) {
        if (!['Basic', 'Skill', 'Ult', 'Enhanced', 'FollowUp', 'Assist'].includes(t)) return;
        sim.addDamage(u, std(sim, u, { atk: 0.25 * sim.targetsHit(a, t) }), 'Debt Collector');
      },
      allyAttack(sim, u, a, t) { if (a === this.dc(sim, u)) this.collect(sim, u, a, t); },
      afterDamage(sim, u, act) {
        const dc = this.dc(sim, u);
        if (dc && (dc === u || E(u) >= 6) && act !== 'FollowUp') this.collect(sim, u, u, act);
        if (E(u) >= 6) { if (dc) self(sim, u, 'jadeE6', { resPen: 0.2 }, Infinity); else sim.removeBuff(u, 'jadeE6'); }
      },
      ult(sim, u) { u.state.enh = 2; if (E(u) >= 4) self(sim, u, 'jadeE4', { defIgnore: 0.12 }, 3); },
      followUpDone(sim, u) { this.pawn(sim, u, 5); },
      dmgScale(sim, u, act) {
        if (act !== 'FollowUp') return 1;
        let f = E(u) >= 1 ? 1 + 0.32 / (1 + st(sim, u).dmg) : 1;
        if (u.state.enh > 0) { u.state.enh -= 1; const p = window.AVEffects.P(u, 'Talent', 4); f *= (p + 0.8) / p; }
        return f;
      },
    },
    // ------------------------------------------------------------------ 1315 Boothill
    1315: {
      desc: 'Skill (1 SP, no Energy, doesn\'t end the turn): Standoff for 2 of his turns, Basic ATK becomes Fanning the Hammer (30 Energy, no SP); the Standoff enemy takes +30% DMG from him (E4: +12%) and is Taunted. Breaking it ends the Standoff and gives Pocket Trickshot (max 3; +50% Enhanced Basic Toughness DMG each; Point Blank +10 Energy; E2: +1 SP and +30% Break Effect for 2 turns). Breaking with the Enhanced Basic ATK deals 70/120/170% of his Physical Break DMG (Toughness counted up to 160; E6: +40% and 70% to adjacent). Ghost Load: +10% / 50% of Break Effect as CRIT Rate / CRIT DMG (max 30% / 150%). E1: starts with 1 Trickshot; ignores 16% DEF.',
      battleStart(sim, u) {
        u.state.trick = E(u) >= 1 ? 1 : 0; u.state.standoff = 0;
        const be = (u.stats0 && u.stats0.be) || 0;
        self(sim, u, 'ghostLoad', { cr: Math.min(0.3, 0.1 * be), cd: Math.min(1.5, 0.5 * be) }, Infinity);
        if (E(u) >= 1) self(sim, u, 'boothillE1', { defIgnore: 0.16 }, Infinity);
      },
      turnStart(sim, u) {
        if (u.state.standoff > 0) u.state.standoff -= 1;
        if (u.state.standoff > 0 || sim.sp < 1) return;
        sim.useSP(1, u);
        const ev = sim.record(u, 'FollowUp', { label: 'Sizzlin\' Tango (Skill)', n: u.actions + 1 });
        u.state.standoff = 2;
        sim.snap(ev, u);
      },
      actionType(sim, u) { return u.state.standoff > 0 ? 'Enhanced' : undefined; },
      energyFor(sim, u, t) { return t === 'Enhanced' ? 30 : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? 0 : undefined; },
      action(sim, u, t) {
        if (t !== 'Enhanced' || !u.state.trick) return;
        const ab = u.cfg.char.combat.abilities.find((a) => a.name === 'Fanning the Hammer');
        if (ab && ab.tough) AD().applyToughness(sim, u, { tough: { one: ab.tough.one * 0.5 * u.state.trick } }, u);
      },
      tauntMult(sim, u) { return u.state.standoff > 0 ? 1 + 4 / n(sim) : 1; },
      dmgScale(sim, u) {
        if (!(u.state.standoff > 0)) return 1;
        const v = (sim.enemyMods || []).reduce((a, m) => a + (m.vuln || 0), 0);
        return (1 + v + 0.3 + (E(u) >= 4 ? 0.12 : 0)) / (1 + v);
      },
      weaknessBreak(sim, u, by, e) {
        if (!(u.state.standoff > 0) || e !== sim.enemies()[0]) return;
        if (by === u && sim.current === u && u.state.trick > 0) {
          const tough = sim.enemyToughness || 160, cap = (0.5 + Math.min(tough, 160) / 40) / (0.5 + tough / 40);
          const k = [0, 0.7, 1.2, 1.7][u.state.trick] * cap;
          const bd = AD().breakDamage(sim, u);
          sim.addDamage(u, bd * k * (1 + (E(u) >= 6 ? 0.4 : 0)) + (E(u) >= 6 ? bd * k * 0.7 * Math.min(2, n(sim) - 1) : 0), 'Break (Trickshot)');
        }
        u.state.trick = Math.min(3, u.state.trick + 1);
        G(sim, u, 10);
        if (E(u) >= 2 && u.state.e2Turn !== sim.turnId) { u.state.e2Turn = sim.turnId; sim.gainSP(1, u); self(sim, u, 'boothillE2', { be: 0.3 }, 2); }
        u.state.standoff = 0;
      },
    },
    // ------------------------------------------------------------------ 1317 Rappa
    1317: {
      desc: 'Talent Charge: +1 per Weakness Break (main enemy assumed elite: +1 more and +10 Energy), max 10 (E6: 15, starts with 5). The 3rd hit of each Enhanced Basic ATK adds Break DMG to all enemies: 60% + 50% per Charge of her Imaginary Break DMG, with 2 + Charge Toughness DMG ignoring Weakness, using all Charge (E6: +5 after). Withered Leaf: a Break makes enemies take +2% Break DMG (+1% per 100 ATK above 2400, max +8%) for 2 turns. E1: Sealform ignores 15% DEF. E2: the first 2 hits deal 50% more Toughness DMG to the target. E4: Sealform: all allies +12% SPD.',
      battleStart(sim, u) { u.state.charge = E(u) >= 6 ? 5 : 0; },
      cap(u) { return E(u) >= 6 ? 15 : 10; },
      weaknessBreak(sim, u, by, e) {
        u.state.charge = Math.min(this.cap(u), u.state.charge + 1 + (e === sim.enemies()[0] ? 1 : 0));
        if (e === sim.enemies()[0]) G(sim, u, 10);
        const atk = st(sim, u).ATK;
        emod(sim, 'witheredLeaf', { vulnType: { Break: 0.02 + Math.min(0.08, 0.01 * Math.floor(Math.max(0, atk - 2400) / 100)) } }, 2);
      },
      ult(sim, u) {
        if (E(u) >= 1) self(sim, u, 'rappaE1', { defIgnore: 0.15 }, Infinity);
        if (E(u) >= 4) team(sim, 'rappaE4', { }, Infinity, { pct: 0.12 });
      },
      action(sim, u, t) {
        if (t !== 'Enhanced' || E(u) < 2) return;
        const ab = AD().abilityFor(sim, u, 'Enhanced');
        if (ab && ab.tough) AD().applyToughness(sim, u, { tough: { one: (ab.tough.one - 15) * 0.5 } }, u);
      },
      afterDamage(sim, u, act) {
        if (act === 'Enhanced') {
          const c = u.state.charge;
          AD().applyToughness(sim, u, { tough: { all: (2 + c) * 3 } }, u);
          sim.addDamage(u, AD().breakDamage(sim, u) * (0.6 + 0.5 * c) * n(sim), 'Break (Talent)');
          u.state.charge = E(u) >= 6 ? Math.min(this.cap(u), 5) : 0;
        }
        if (!(u.state.ink > 0)) { sim.removeBuff(u, 'rappaE1'); sim.units.forEach((x) => sim.removeBuff(x, 'rappaE4')); }
      },
    },
    // ------------------------------------------------------------------ 1321 The Dahlia
    1321: {
      desc: 'Dance Partners (her and the chosen teammate): their attacks on Broken enemies convert Toughness DMG into 60% Super Break (E1: everyone, Partners 100%); her follow-up (5 × 30%, E4: 10) converts at 200%. Zone (Skill, 3 turns): +50% Weakness Break Efficiency and Toughness DMG on unbroken enemies also becomes Super Break. Ultimate: Wilt (−18% DEF, 4 turns) implants Weakness; Outgrow: +30% SPD for 2 turns, 20 Fire Toughness DMG to all enemies and +10% Max Energy (up to 50% total). Yet Another Funeral: teammates +24% of her Break Effect + 50% for 1 turn at battle start, re-applied for 3 turns whenever a healer / shielder teammate acts. E1: Partners\' first attack on each enemy removes 25% of its Toughness. E2: −20% All-Type RES; Wilt at battle start. E4: follow-up: +12% DMG taken for 2 turns. E6: Partners +150% Break Effect; follow-up advances Partners 20%.',
      partners(sim, u) { const tg = sim.targetOf(u); return tg && tg !== u ? [u, tg] : [u]; },
      battleStart(sim, u) {
        u.state.outgrow = 0; u.state.e1Done = new Set();
        const ps = this.partners(sim, u);
        if (E(u) >= 1) sim.chars().forEach((a) => sim.addBuff(a, { id: 'dancePartner', stats: { superBreak: ps.includes(a) ? 1.0 : 0.6 }, turns: Infinity }));
        else ps.forEach((a) => sim.addBuff(a, { id: 'dancePartner', stats: { superBreak: 0.6 }, turns: Infinity }));
        self(sim, u, 'dahliaFUA', { superBreak_FollowUp: 2 }, Infinity);
        if (E(u) >= 6) ps.forEach((a) => sim.addBuff(a, { id: 'dahliaE6', stats: { be: 1.5 }, turns: Infinity }));
        if (E(u) >= 2) { emod(sim, 'dahliaE2', { res: 0.2 }, Infinity); emod(sim, 'wilt', { def: 0.18 }, 3); }
        this.funeral(sim, u, 1);
      },
      funeral(sim, u, turns) {
        const k = 0.24 * (st(sim, u).be || 0) + 0.5;
        sim.allies(u).forEach((a) => sim.addBuff(a, { id: 'funeral', stats: { be: k }, turns }));
      },
      allyAction(sim, u, a) {
        if (a.kind === 'char' && ['Abundance', 'Preservation'].includes(a.cfg.char.path) && u.state.funTurn !== sim.turnId) { u.state.funTurn = sim.turnId; this.funeral(sim, u, 3); }
      },
      allyAttack(sim, u, a, t) {
        if (E(u) < 1 || !this.partners(sim, u).includes(a)) return;
        const e = sim.enemies()[0];
        if (e && !u.state.e1Done.has(e) && !e.broken) {
          u.state.e1Done.add(e);
          e.tough -= 0.25 * (sim.enemyToughness || 160);
          if (e.tough <= 1e-9) sim.breakEnemy(e, a);
        }
      },
      ult(sim, u) {
        sim.addBuff(u, { id: 'outgrow', pct: 0.3, turns: 2 });
        if (u.state.outgrow < 0.5) { u.state.outgrow += 0.1; F(sim, u, 0.1 * u.maxEnergy); }
      },
      afterDamage(sim, u, act) {
        if (act === 'Ult') AD().applyToughness(sim, u, { tough: { all: 20 * 3 } }, u);
        if (isAtk(act) && act !== 'FollowUp') this.allyAttack(sim, u, u, act);
      },
      followUpDone(sim, u) {
        if (E(u) >= 4) emod(sim, 'dahliaE4', { vuln: 0.12 }, 2);
        if (E(u) >= 6) this.partners(sim, u).forEach((a) => sim.advance(a, 0.2));
      },
      dmgScale(sim, u, act) { return act === 'FollowUp' && E(u) >= 4 ? 2 : 1; },
    },

    // ------------------------------------------------------------------ 1401 The Herta
    1401: {
      desc: 'Interpretation on the main enemy: 25 at battle start, +1 per ally attack and +1 more to it (+2 more from Erudition attackers), max 42; her Enhanced Skill adds 8% (2+ Erudition: 16%) of ATK per stack to every hit on it (E1: counts 1.5× the stacks) and resets it to 1 (E1: 15); at 42 it also gets +50% Ice DMG. Answer: +1 per Interpretation stack applied (max 99); Ultimate +1% multiplier per Answer. Ultimate: +80% ATK for 3 turns. E6: +20% Ice RES PEN; Ultimate +140% multiplier (3+ enemies, 250% at 2, 400% at 1).',
      battleStart(sim, u) {
        u.state.interp = 0; u.state.answer = 0;
        this.add(sim, u, 25 + n(sim) - 1);
        if (E(u) >= 6) self(sim, u, 'thehertaE6', { resPen: 0.2 }, Infinity);
      },
      erudites(sim) { return sim.chars().filter((a) => a.cfg.char.path === 'Erudition').length; },
      add(sim, u, k) { u.state.interp = Math.min(42, u.state.interp + k); u.state.answer = Math.min(99, u.state.answer + k); },
      onAttack(sim, u, a) { this.add(sim, u, 2 + (a.cfg && a.cfg.char.path === 'Erudition' ? 2 : 0)); },
      allyAttack(sim, u, a) { if (a.kind === 'char' || a.memo) this.onAttack(sim, u, a); },
      action(sim, u, t) {
        if (t === 'Enhanced') {
          u.state.useInterp = Math.min(42, u.state.interp * (E(u) >= 1 ? 1.5 : 1));
          if (u.state.interp >= 42) self(sim, u, 'aloofly', { dmg: 0.5 }, Infinity);
        }
      },
      afterDamage(sim, u, act) {
        sim.removeBuff(u, 'aloofly');
        if (act === 'Enhanced') u.state.interp = E(u) >= 1 ? 15 : 1;
        if (isAtk(act)) this.onAttack(sim, u, u);
      },
      ult(sim, u) { self(sim, u, 'toldYa', { atkPct: 0.8 }, 3); },
      extraDamage(sim, u, act) {
        if (act !== 'Enhanced') return 0;
        const per = this.erudites(sim) >= 2 ? 0.16 : 0.08;
        return std(sim, u, { atk: per * (u.state.useInterp || 0) * 4 }, 'Skill');
      },
      dmgScale(sim, u, act) {
        if (act !== 'Ult') return 1;
        const k = n(sim), e6 = E(u) >= 6 ? (k >= 3 ? 1.4 : k === 2 ? 2.5 : 4) : 0;
        return (2 + 0.01 * u.state.answer + e6) / 2;
      },
    },
    // ------------------------------------------------------------------ 1402 Aglaea
    1402: {
      desc: 'Seam Stitch (while Garmentmaker is out): after Aglaea or Garmentmaker attacks it, +30% ATK Lightning Additional DMG (E1: it takes +15% DMG). The Myopic\'s Doom: in Supreme Stance, ATK + 720% of her SPD + 360% of Garmentmaker\'s. E2: each Aglaea / Garmentmaker action: ignore 14% DEF (3 stacks) until another unit acts. E6: Supreme Stance +20% Lightning RES PEN; Joint ATK +10/30/60% at 160/240/320 SPD.',
      gm(sim, u) { return sim.units.find((x) => x.owner === u && x.name === 'Garmentmaker' && x.alive); },
      battleStart(sim, u) {
        u.state.e2 = 0;
        self(sim, u, 'myopic', { atk: (s, a) => { if (!a.state.stance) return 0; const gm = this.gm(s, a); return 7.2 * s.spd(a) + (gm ? 3.6 * s.spd(gm) : 0); } }, Infinity);
        if (E(u) >= 6) self(sim, u, 'aglaeaE6', { resPen: (s, a) => (a.state.stance ? 0.2 : 0) }, Infinity);
      },
      stitch(sim, u) {
        if (!this.gm(sim, u)) return;
        sim.addDamage(u, std(sim, u, { atk: 0.3 }), 'Seam Stitch');
        if (E(u) >= 1) emod(sim, 'seamStitch', { vuln: 0.15 / n(sim) }, Infinity);
      },
      e2(sim, u) { if (E(u) < 2) return; u.state.e2 = Math.min(3, u.state.e2 + 1); sim.removeBuff(u, 'aglaeaE2'); self(sim, u, 'aglaeaE2', { defIgnore: 0.14 * u.state.e2 }, Infinity); },
      action(sim, u) { this.e2(sim, u); },
      afterDamage(sim, u, act) { if (isAtk(act)) { this.stitch(sim, u); if (u.state.romance) { u.state.romance = false; F(sim, u, 70); } } },
      allyAction(sim, u, a) {
        if (a.owner === u) { this.e2(sim, u); return; }
        if (E(u) >= 2 && u.state.e2) { u.state.e2 = 0; sim.removeBuff(u, 'aglaeaE2'); }
      },
      allyAttack(sim, u, a) { if (a.owner === u) this.stitch(sim, u); },
      dmgScale(sim, u, act) {
        if (E(u) < 6 || act !== 'Enhanced') return 1;
        const sp = sim.spd(u);
        return 1 + (sp > 320 ? 0.6 : sp > 240 ? 0.3 : sp > 160 ? 0.1 : 0) / (1 + st(sim, u).dmg);
      },
    },
    // ------------------------------------------------------------------ 1403 Tribbie
    1403: {
      desc: 'Zone (2 of her turns): after an ally attacks, 12% of her Max HP Quantum Additional DMG per enemy hit (E2: 120% and 1 more instance); Glass Ball: +9% of the team\'s total Max HP as Max HP. Lamb Outside the Wall: after her follow-up, +72% DMG for 3 turns (3 stacks). E1: in the Zone, +24% of each attack\'s DMG as True DMG. E4: Numinosity: allies ignore 18% DEF. E6: Ultimate launches her follow-up; follow-up +729% DMG.',
      battleStart(sim, u) { u.state.zone = 0; },
      turnStart(sim, u) { if (u.state.zone > 0 && --u.state.zone === 0) sim.removeBuff(u, 'glassBall'); },
      ult(sim, u) {
        u.state.zone = 2;
        const total = sim.chars().reduce((a, c) => a + (c.stats0 ? st(sim, c).HP : 0), 0);
        self(sim, u, 'glassBall', { hp: 0.09 * total }, Infinity);
      },
      action(sim, u, t) { if (E(u) >= 4 && t === 'Skill') team(sim, 'tribbieE4', { defIgnore: 0.18 }, 3, { tick: 'owner', owner: u }); },
      zoneHit(sim, u, a, t) {
        if (!(u.state.zone > 0) || t === 'Elation') return;
        const hits = sim.targetsHit(a, t), k = E(u) >= 2 ? 1.2 * 2 : 1;
        sim.addDamage(u, std(sim, u, { hp: 0.12 * hits * k }), 'Zone');
        if (E(u) >= 1) {
          const ev = [...sim.events].reverse().find((e) => e.unit === a && e.dmg);
          if (ev) sim.addDamage(u, 0.24 * ev.dmg, 'True DMG');
        }
      },
      allyAttack(sim, u, a, t) { if (a.kind === 'char' || a.memo) this.zoneHit(sim, u, a, t); },
      afterDamage(sim, u, act) { if (isAtk(act) && act !== 'FollowUp') this.zoneHit(sim, u, u, act); },
      followUpDone(sim, u) { self(sim, u, 'lamb', { dmg: 0.72 }, 3, { maxStacks: 3 }); },
      dmgScale(sim, u, act) { return act === 'FollowUp' && E(u) >= 6 ? 1 + 7.29 / (1 + st(sim, u).dmg) : 1; },
    },
    // ------------------------------------------------------------------ 1404 Mydei
    1404: {
      desc: 'Vendetta: Max HP ×1.5 (E2: ignore 15% DEF; E4: +30% CRIT DMG). Godslayer Be God uses its own multipliers (E1: +30% and every enemy takes the primary target\'s DMG). Bloodied Chiton: +1.2% CRIT Rate per 100 Max HP above 4000 (max 48%).',
      battleStart(sim, u) {
        const hp = st(sim, u).HP, s0 = u.stats0 || {};
        self(sim, u, 'chiton', { cr: Math.min(0.48, 0.012 * Math.floor(Math.max(0, hp - 4000) / 100)) }, Infinity);
        self(sim, u, 'vendetta', { hpPct: (s, a) => (a.state.vendetta ? 0.5 * (1 + (s0.hpPct || 0)) : 0), defIgnore: (s, a) => (a.state.vendetta && E(a) >= 2 ? 0.15 : 0), cd: (s, a) => (a.state.vendetta && E(a) >= 4 ? 0.3 : 0) }, Infinity);
      },
      turnStart(sim, u) { u.state.godNow = !!u.state.god; },
      dmgAbility(sim, u, act) { return act === 'Enhanced' && u.state.godNow ? 'Godslayer Be God' : undefined; },
      dmgScale(sim, u, act) {
        if (act !== 'Enhanced' || !u.state.godNow || E(u) < 1) return 1;
        const k = n(sim), adj = Math.min(2, k - 1);
        return (2.8 * 1.3 * k) / (2.8 + 1.68 * adj);
      },
      afterDamage(sim, u) { u.state.godNow = false; },
    },
    // ------------------------------------------------------------------ 1405 Anaxa
    1405: {
      desc: 'Qualitative Disclosure (from his first Skill on): +30% DMG and his Basic ATK / Skill unleash a free extra Skill. Qualitative Shift: ignores 4% DEF per enemy Weakness Type (7 once Disclosed, 3 before). Skill: +20% DMG per enemy. Imperative Hiatus: alone as Erudition, +140% CRIT DMG (2+: allies +50% DMG). E1: first Skill refunds 1 SP; Skill −16% DEF for 2 turns. E2: −20% All-Type RES. E4: Skill +30% ATK for 2 turns (2 stacks). E6: ×1.3 DMG and both Hiatus effects.',
      battleStart(sim, u) {
        const er = sim.chars().filter((a) => a.cfg.char.path === 'Erudition').length;
        if (er === 1 || E(u) >= 6) self(sim, u, 'hiatus', { cd: 1.4 }, Infinity);
        if (E(u) >= 6 && er < 2) team(sim, 'anaxa', { dmg: 0.5 }, Infinity);
        if (E(u) >= 2) emod(sim, 'anaxaE2', { res: 0.2 }, Infinity);
        self(sim, u, 'shift', { defIgnore: (s, a) => (a.state.qd ? 0.28 : 0.12), dmg: (s, a) => (a.state.qd ? 0.3 : 0) }, Infinity);
      },
      turnStart(sim, u) { u.state.qdNow = !!u.state.qd; },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        if (E(u) >= 1) emod(sim, 'anaxaE1', { def: 0.16 }, 2);
        if (E(u) >= 4) self(sim, u, 'anaxaE4', { atkPct: 0.3 }, 2, { maxStacks: 2 });
      },
      dmgScale(sim, u, act) {
        let f = E(u) >= 6 ? 1.3 : 1;
        if (act === 'Skill') f *= 1 + 0.2 * n(sim) / (1 + st(sim, u).dmg);
        if (act === 'Skill' && u.state.reason) { u.state.reason = false; f *= 8 / 5; }
        return f;
      },
      afterDamage(sim, u, act) {
        if (!u.state.qdNow || (act !== 'Basic' && act !== 'Skill') || u.state.extra) return;
        u.state.extra = true;
        if (E(u) >= 4) self(sim, u, 'anaxaE4', { atkPct: 0.3 }, 2, { maxStacks: 2 });
        sim.dealDamage(u, 'Skill', { label: 'Extra Skill' });
        u.state.extra = false;
      },
    },

    // ------------------------------------------------------------------ 1406 Cipher
    1406: {
      desc: 'Tally: 12% of the non-True DMG allies deal to the Patron (main enemy) and 8% of the rest (spread by enemy count; E1: ×1.5; Empyrean Strides: +50% at 140 SPD, +100% at 170; E6: +16%). Ultimate adds the whole tally as True DMG and clears it (E6: 20% returned). Skill: +30% ATK for 2 turns. Empyrean Strides: +25% / 50% CRIT Rate at 140 / 170 SPD. Sleight of Sky: follow-up +100% CRIT DMG. E1: follow-up +80% ATK for 2 turns. E2: her hits make enemies take +30% DMG for 2 turns. E4: allies hitting the Patron add 50% ATK Additional DMG. E6: follow-up +350% DMG.',
      battleStart(sim, u) {
        u.state.tally = 0;
        self(sim, u, 'empyrean', { cr: (s, a) => { const sp = s.spd(a); return sp >= 170 ? 0.5 : sp >= 140 ? 0.25 : 0; } }, Infinity);
        self(sim, u, 'sleight', { cd_FUA: 1 }, Infinity);
      },
      damageDealt(sim, u, by, amt, label) {
        if (!amt || /True/.test(label || '') || !by || (by.kind !== 'char' && !by.owner)) return;
        const k = n(sim), sp = sim.spd(u);
        let rate = (0.12 + 0.08 * (k - 1)) / k;
        rate *= (E(u) >= 1 ? 1.5 : 1) * (sp >= 170 ? 2 : sp >= 140 ? 1.5 : 1);
        if (E(u) >= 6) rate += 0.16 / k;
        u.state.tally += amt * rate;
      },
      action(sim, u, t) { if (t === 'Skill') self(sim, u, 'cipherSkill', { atkPct: 0.3 }, 2); },
      afterDamage(sim, u, act) {
        if (isAtk(act) && E(u) >= 2) emod(sim, 'cipherE2', { vuln: 0.3 }, 2);
        if (act === 'Ult') {
          const t = u.state.tally;
          u.state.tally = E(u) >= 6 ? 0.2 * t : 0;
          if (t > 0) sim.addDamage(u, t, 'True DMG');
        }
      },
      followUpDone(sim, u) { if (E(u) >= 1) self(sim, u, 'cipherE1', { atkPct: 0.8 }, 2); },
      allyAttack(sim, u, a) { if (E(u) >= 4 && a.kind === 'char') sim.addDamage(u, std(sim, u, { atk: 0.5 }), 'Additional'); },
      dmgScale(sim, u, act) { return act === 'FollowUp' && E(u) >= 6 ? 1 + 3.5 / (1 + st(sim, u).dmg) : 1; },
    },
    // ------------------------------------------------------------------ 1407 Castorice
    1407: {
      autoUlt: 'Automatic at full Newbud.',
      options: [{ key: 'hit', label: 'HP lost per enemy hit (% of Max HP)', type: 'number', def: 10, min: 0, max: 100, step: 1 }],
      desc: 'Newbud (max 34,000 at Equilibrium Level 5-6): +1 per HP any ally loses — her Skill takes 30% of every ally\'s current HP, enemy hits per the setting — and healing from Abundance teammates (25% Max HP, up to 12% of max Newbud each). Ultimate at full Newbud summons Netherwing (HP = max Newbud). While it\'s out, ally HP loss refills Netherwing instead, and her Skill becomes Boneclaw (Joint ATK: 30% + 50% of her Max HP to all; 40% of allies\' HP). Netherwing spends each turn on Breath Scorches the Shadow (25% of its HP each: 24% → 28% → 34% of her Max HP to all, +30% DMG per Breath this turn, max 6); at ≤25% HP the last Breath drops it to 1 HP and triggers Wings Sweep the Ruins (6 × 40% bounces; E6: 9), which also fires when it leaves. Talent: +20% DMG per ally HP loss (3 stacks, 3 turns). Inverted Torch: +40% SPD at ≥50% HP. E1: ×1.25 DMG (enemy HP thresholds averaged). E2: 2 Ardent Will pay for Breaths and advance her 100%; the next Boneclaw gives 30% Newbud. E6: +20% Quantum RES PEN. (Cyrene\'s Ode to Life and Death lets Newbud overflow, but the sim fires her Ultimate as soon as Newbud is full, so no overflow builds up.)',
      battleStart(sim, u) {
        u.state.hp = new Map(sim.chars().map((a) => [a, 1]));
        u.state.newbud = 0; u.state.max = 34000; // Equilibrium Level 5-6
        u.state.nwHp = 0; u.state.prog = 0; u.state.ardent = 0;
        if (E(u) >= 6) self(sim, u, 'castoriceE6', { resPen: 0.2 }, Infinity);
        this.torch(sim, u);
      },
      ultReady(sim, u) { return u.state.newbud >= u.state.max - 1e-6; },
      canUlt(sim, u) { return !this.nw(sim, u) && u.state.newbud >= u.state.max - 1e-6; },
      nw(sim, u) { return sim.units.find((x) => x.owner === u && x.name === 'Netherwing' && x.alive); },
      torch(sim, u) { if ((u.state.hp.get(u) || 0) >= 0.5) sim.addBuff(u, { id: 'torch', pct: 0.4, turns: Infinity }); else sim.removeBuff(u, 'torch'); },
      lose(sim, u, a, frac, ofCurrent) {
        const cur = u.state.hp.get(a); if (cur === undefined) return;
        const amt = Math.max(0, Math.min(cur - 0.001, ofCurrent ? cur * frac : frac));
        if (amt <= 0) return;
        u.state.hp.set(a, cur - amt);
        const abs = amt * (a.stats0 ? st(sim, a).HP : 0);
        if (this.nw(sim, u)) u.state.nwHp = Math.min(1, u.state.nwHp + abs / u.state.max);
        else u.state.newbud = Math.min(u.state.max, u.state.newbud + abs);
        self(sim, u, 'desolation', { dmg: 0.2 }, 3, { maxStacks: 3 });
        if (a === u) this.torch(sim, u);
      },
      hit(sim, u) { this.lose(sim, u, u, (+O(u, 'hit') || 0) / 100, false); },
      allyHit(sim, u, v) { if (v.kind === 'char') this.lose(sim, u, v, (+O(u, 'hit') || 0) / 100, false); },
      allyAction(sim, u, a) {
        if (a.kind !== 'char' || a.cfg.char.path !== 'Abundance') return;
        for (const c of sim.chars()) {
          const cur = u.state.hp.get(c); if (cur === undefined) continue;
          const heal = Math.min(1 - cur, 0.25);
          u.state.hp.set(c, cur + heal);
          const abs = Math.min(heal * (c.stats0 ? st(sim, c).HP : 0), 0.12 * u.state.max);
          if (this.nw(sim, u)) u.state.nwHp = Math.min(1, u.state.nwHp + abs / u.state.max);
          else u.state.newbud = Math.min(u.state.max, u.state.newbud + abs);
        }
        this.torch(sim, u);
      },
      actionType(sim, u) { return this.nw(sim, u) ? 'Enhanced' : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? 1 : undefined; },
      energyFor(sim, u, t) { return t === 'Enhanced' || t === 'Skill' ? 0 : undefined; },
      action(sim, u, t) {
        if (t === 'Skill' || t === 'Enhanced') {
          for (const a of sim.chars()) this.lose(sim, u, a, t === 'Enhanced' ? 0.4 : 0.3, true);
          if (t === 'Enhanced' && u.state.e2Bud) { u.state.e2Bud = false; u.state.newbud = Math.min(u.state.max, u.state.newbud + 0.3 * u.state.max); }
        }
      },
      ult(sim, u) {
        u.state.newbud = 0; u.state.nwHp = 1; u.state.prog = 0;
        if (E(u) >= 2) { u.state.ardent = 2; u.state.e2Bud = true; }
      },
      sweep(sim, u) { return std(sim, u, { hp: 0.4 * (E(u) >= 6 ? 9 : 6) }, 'Memo'); },
      memoGone(sim, u, m) { if (m.name === 'Netherwing') sim.addDamage(u, this.sweep(sim, u), 'Wings Sweep the Ruins'); },
      dmgType(sim, u, act, extra, unit) { return unit && unit.name === 'Netherwing' ? 'Memo' : undefined; },
      dmgScale(sim, u, act, extra, unit) {
        let f = E(u) >= 1 ? 1.25 : 1;
        if ((unit && unit.name === 'Netherwing') || act === 'Enhanced') f = 0;
        return f;
      },
      extraDamage(sim, u, act, extra, unit) {
        const e1 = E(u) >= 1 ? 1.25 : 1;
        if (act === 'Enhanced' && unit === u) return std(sim, u, { hp: (0.3 + 0.5) * n(sim) }, 'Skill') * e1;
        if (!unit || unit.name !== 'Netherwing') return 0;
        const MULT = [0.24, 0.28, 0.34], s = st(sim, u);
        let total = 0;
        for (let k = 0; k < 12; k++) {
          let last = false;
          if (u.state.ardent > 0) { u.state.ardent -= 1; sim.advance(u, 1); }
          else if (u.state.nwHp > 0.25 + 1e-9) u.state.nwHp -= 0.25;
          else { last = true; u.state.nwHp = 0.0001; }
          const m = MULT[Math.min(2, u.state.prog)]; u.state.prog += 1;
          const ww = 0.3 * Math.min(6, k + 1);
          total += std(sim, u, { hp: m * n(sim) }, 'Memo') * (1 + s.dmg + ww) / (1 + s.dmg);
          if (last) { total += this.sweep(sim, u); break; }
        }
        return total * e1;
      },
    },
    // ------------------------------------------------------------------ 1408 Phainon
    1408: {
      desc: 'Khaslana: +80% ATK and +270% Max HP; Enhanced Skill alternates Calamity: Soulscorch Edict (Counter after enemies act, +20% per Soulscorch stack: 1 + each enemy; E4: +4) and, at 4 Scourge, Foundation: Stardeath Verdict (16 × 45% bounces + 450% split); the final hit is his Ultimate. Shine with Valor: +50% ATK at battle start and each time the transformation ends (2 stacks). Talent: +30% CRIT DMG for 3 turns when a teammate\'s ability targets him. Bide in Flames: +45% DMG for 4 turns when a healer / shielder teammate acts. E1: Ultimate +50% CRIT DMG for 3 turns. E2: Khaslana +20% Physical RES PEN. E6: Stardeath Verdict adds 36% of its DMG as True DMG.',
      battleStart(sim, u) {
        self(sim, u, 'valor', { atkPct: 0.5 }, Infinity, { maxStacks: 2 });
        self(sim, u, 'khaslana', { atkPct: (s, a) => (a.state.khas ? 0.8 : 0), hpPct: (s, a) => (a.state.khas ? 2.7 : 0), resPen: (s, a) => (a.state.khas && E(a) >= 2 ? 0.2 : 0) }, Infinity);
      },
      targetedCD(sim, u) { self(sim, u, 'pyricCD', { cd: 0.3 }, 3); },
      allyAction(sim, u, a, t) {
        const kit = a.kind === 'char' && sim.kitOf(a);
        if (kit && kit.allyTarget && kit.allyTarget[t] && sim.targetOf(a) === u) this.targetedCD(sim, u);
        if (a.kind === 'char' && ['Abundance', 'Preservation'].includes(a.cfg.char.path) && u.state.bideTurn !== sim.turnId) { u.state.bideTurn = sim.turnId; self(sim, u, 'bide', { dmg: 0.45 }, 4); }
      },
      allyUlt(sim, u, a) { const kit = sim.kitOf(a); if (kit && kit.allyTarget && kit.allyTarget.Ultimate && sim.targetOf(a) === u) this.targetedCD(sim, u); },
      ult(sim, u) { if (E(u) >= 1) self(sim, u, 'phainonE1', { cd: 0.5 }, 3); u.state.wasKhas = true; },
      turnStart(sim, u) {
        u.state.pre = u.state.scourge || 0;
        if (u.state.wasKhas && !u.state.khas) { u.state.wasKhas = false; self(sim, u, 'valor', { atkPct: 0.5 }, Infinity, { maxStacks: 2 }); }
      },
      dmgAbility(sim, u, act) {
        if (act === 'Final') return 'He Who Bears the World Must Burn';
        if (act !== 'Enhanced') return undefined;
        if ((u.state.pre || 0) >= 4) return 'Foundation: Stardeath Verdict';
        return n(sim) >= 2 ? 'Calamity: Soulscorch Edict' : 'Creation: Bloodthorn Ferry';
      },
      dmgType(sim, u, act) { return act === 'Final' ? 'Ult' : act === 'Enhanced' && (u.state.pre || 0) < 4 && n(sim) < 2 ? 'Basic' : act === 'Enhanced' ? 'Skill' : undefined; },
      dmgScale(sim, u, act) {
        if (act === 'Enhanced' && (u.state.pre || 0) < 4 && n(sim) >= 2) return 1 + 0.2 * (1 + n(sim) + (E(u) >= 4 ? 4 : 0));
        return 1;
      },
      afterDamage(sim, u, act) {
        if (u.state.worldbearing && u.state.khas && isAtk(act)) sim.addDamage(u, std(sim, u, { atk: 5 * 0.1 }), 'Additional');
        if (E(u) >= 6 && act === 'Enhanced' && (u.state.pre || 0) >= 4) {
          const ev = [...sim.events].reverse().find((e) => e.unit === u && e.dmg);
          if (ev) sim.addDamage(u, 0.36 * ev.dmg, 'True DMG');
        }
      },
    },
    // ------------------------------------------------------------------ 1409 Hyacine
    1409: {
      desc: 'Healing tally from her Skill (8% Max HP + 160 to everyone), Ultimate (10% + 200) and Little Ica\'s Talent (2% + 20 to an ally whose HP drops, and to everyone during After Rain), with Outgoing Healing. After Rain (Ultimate, 3 of her turns): allies +30% Max HP + 600 (E1: +50% more), and after each of her abilities Little Ica uses Rainclouds: 20% of the tally as Wind DMG to all enemies, clearing 50% of it (E6: 12%). Talent: each heal gives Ica +80% DMG for 2 turns (3 stacks). Gloomy Grin: +100% CRIT Rate. Tempestuous Halt: above 200 SPD, +20% Max HP and +1% Outgoing Healing per excess SPD (E4: +2% CRIT DMG too; max 200). E2: allies whose HP drops get +30% SPD for 2 turns. E6: while Ica is out, allies +20% All-Type RES PEN.',
      battleStart(sim, u) {
        u.state.tally = 0; u.state.rain = 0; u.state.ica = false;
        self(sim, u, 'gloomy', { cr: 1 }, Infinity);
        const ex = Math.min(200, Math.max(0, sim.spd(u) - 200));
        if (sim.spd(u) > 200) self(sim, u, 'tempest', { hpPct: 0.2, heal: 0.01 * ex, ...(E(u) >= 4 ? { cd: 0.02 * ex } : {}) }, Infinity);
      },
      heal(sim, u, pct, flat, targets) {
        const s = st(sim, u);
        u.state.tally += (pct * s.HP + flat) * (1 + (s.heal || 0)) * targets * (u.state.sky > 0 ? 1.72 : 1);
        self(sim, u, 'icaDmg', { dmg_Memo: 0.8 }, 2, { maxStacks: 3 });
      },
      summonIca(sim, u) { if (!u.state.ica) { u.state.ica = true; if (E(u) >= 6) team(sim, 'hyacineE6', { resPen: 0.2 }, Infinity); } },
      action(sim, u, t) {
        if (t === 'Skill') { this.summonIca(sim, u); this.heal(sim, u, 0.08, 160, sim.chars().length); this.heal(sim, u, 0.1, 200, 1); if (u.state.sky > 0) u.state.sky -= 1; }
      },
      ult(sim, u) {
        this.summonIca(sim, u);
        this.heal(sim, u, 0.1, 200, sim.chars().length); this.heal(sim, u, 0.12, 240, 1);
        u.state.rain = 3;
        if (u.state.sky > 0) u.state.sky -= 1;
        team(sim, 'afterRain', { hpPct: 0.3 + (E(u) >= 1 ? 0.5 : 0), hp: 600 }, Infinity);
      },
      turnStart(sim, u) { if (u.state.rain > 0 && --u.state.rain === 0) sim.units.forEach((x) => sim.removeBuff(x, 'afterRain')); },
      icaHeal(sim, u, v) {
        if (!u.state.ica) return;
        this.heal(sim, u, 0.02, 20, 1 + (u.state.rain > 0 ? sim.chars().length : 0));
        if (E(u) >= 2 && v) sim.addBuff(v, { id: 'hyacineE2', pct: 0.3, turns: 2 });
      },
      hit(sim, u) { this.icaHeal(sim, u, u); },
      allyHit(sim, u, v) { if (v.kind === 'char') this.icaHeal(sim, u, v); },
      afterDamage(sim, u, act) {
        if (!(u.state.rain > 0) || !u.state.ica) return;
        const s = st(sim, u), base = 0.2 * u.state.tally;
        u.state.tally *= E(u) >= 6 ? 0.88 : 0.5;
        if (base > 0 && s.HP > 0) {
          const ev = sim.record(u, 'FollowUp', { label: 'Little Ica: Rainclouds' });
          ev.dmg = std(sim, u, { hp: base / s.HP * n(sim) }, 'Memo');
          sim.addDamage(u, ev.dmg, 'Little Ica');
        }
      },
    },
    // ------------------------------------------------------------------ 1410 Hysilens
    1410: {
      desc: 'Talent: each ally attack inflicts Wind Shear / Bleed / Burn / Shock in turn on the enemies it hit (25% ATK DoT, 2 turns; E1: twice). Zone (battle start, Ultimate; 3 of her turns): each DoT instance an enemy takes, and each ally attack on a DoT\'d enemy, triggers an 80% ATK Physical DoT (8 times per Zone; E6: 12 and +20%). The Bubble of Banquets: Ultimate makes all DoTs deal 150% of their DMG at once. The Fiddle of Pearls: +15% DMG per 10% Effect Hit Rate above 60% (max 90%; E2: all allies while the Zone is up). E1: allies\' DoT ×1.16. E4: Zone −20% All-Type RES.',
      STATES: ['Wind Shear', 'Bleed', 'Burn', 'Shock'],
      battleStart(sim, u) {
        u.state.next = 0;
        const ehr = st(sim, u).ehr || 0;
        u.state.fiddle = Math.min(0.9, 0.15 * Math.floor(Math.max(0, ehr - 0.6 + 1e-9) / 0.1));
        self(sim, u, 'fiddle', { dmg: u.state.fiddle }, Infinity);
        if (E(u) >= 1) team(sim, 'hysE1', { dotMult: 0.16 }, Infinity);
        this.zone(sim, u);
      },
      zone(sim, u) {
        u.state.zone = 3; u.state.procs = E(u) >= 6 ? 12 : 8;
        if (E(u) >= 4) emod(sim, 'hysE4', { res: 0.2 }, Infinity);
        if (E(u) >= 2) sim.allies(u).forEach((a) => sim.addBuff(a, { id: 'fiddleTeam', stats: { dmg: u.state.fiddle }, turns: Infinity }));
      },
      endZone(sim, u) {
        sim.enemyMods = (sim.enemyMods || []).filter((m) => m.id !== 'hysE4');
        sim.units.forEach((x) => sim.removeBuff(x, 'fiddleTeam'));
      },
      turnStart(sim, u) { if (u.state.zone > 0 && --u.state.zone === 0) this.endZone(sim, u); },
      zoneDot(sim, u, k) {
        for (let i = 0; i < k && u.state.zone > 0 && u.state.procs > 0; i++) {
          u.state.procs -= 1;
          const d = { src: u, mult: { atk: 0.8 * (E(u) >= 6 ? 1.2 : 1) }, id: `${u.key}:zone`, targets: 1 };
          sim.addDamage(u, AD().dotDamage(sim, d), 'Zone DoT');
        }
      },
      enemyTurnStart(sim, u, e) { const k = (sim.dots || []).filter((d) => sim.enemies().indexOf(e) < d.targets).length; if (k) this.zoneDot(sim, u, k); },
      inflict(sim, u, a, t) {
        const id = this.STATES[u.state.next++ % 4];
        const ab = a.kind === 'char' ? AD().abilityFor(sim, a, t) : null;
        sim.addDot({ id: `${u.key}:${id}`, src: u, mult: { atk: 0.25 * (E(u) >= 1 ? 2 : 1) }, turns: 2, targets: ab ? sim.dotTargets(ab) : 1 });
        if ((sim.dots || []).length) this.zoneDot(sim, u, 1);
      },
      allyAttack(sim, u, a, t) { if (t !== 'Elation') this.inflict(sim, u, a, t); },
      afterDamage(sim, u, act) {
        if (isAtk(act)) this.inflict(sim, u, u, act);
        if (u.state.ocean && isAtk(act)) {
          if (!u.state.oceanEnergy) { u.state.oceanEnergy = true; F(sim, u, 60); }
          if (act === 'Basic' || act === 'Skill') {
            const per = (sim.dots || []).reduce((s, d) => s + AD().dotDamage(sim, d), 0);
            if (per > 0) sim.addDamage(u, per * (act === 'Skill' ? 0.8 : 0.6), 'DoT detonation');
          }
        }
        if (act === 'Ult') {
          const per = (sim.dots || []).reduce((s, d) => s + AD().dotDamage(sim, d) * d.targets, 0);
          if (per > 0) sim.addDamage(u, 1.5 * per, 'DoT detonation');
        }
      },
      ult(sim, u) { this.zone(sim, u); },
    },

    // ------------------------------------------------------------------ 1412 Cerydra
    1412: {
      desc: 'Charge: +1 per Skill, +2 per Ultimate, +1 when the Military Merit holder uses Basic ATK / Skill (Vidi: +1 once on their Ultimate), max 8. At 6 Merit becomes Peerage: the holder\'s Skill gets +72% CRIT DMG and +10% RES PEN (Coup de Main), then 6 Charge is spent. Talent: after the holder attacks, 60% ATK Wind Additional DMG (20 per Ultimate cycle; E6: +300%). Veni: +18% CRIT DMG per 100 ATK above 2000 (max 360%). Vidi: +100% CRIT Rate. E1: holder ignores 16% DEF (+20% on Peerage Skills). E2: holder +40% DMG; Cerydra +160% DMG. E4: Ultimate +240% multiplier. E6: holder and Cerydra +20% RES PEN.',
      battleStart(sim, u) {
        u.state.charge = 0; u.state.adds = 20; u.state.vidi = true;
        const atk = st(sim, u).ATK;
        self(sim, u, 'veni', { cd: Math.min(3.6, 0.18 * Math.floor(Math.max(0, atk - 2000) / 100)), cr: 1 }, Infinity);
        if (E(u) >= 2) self(sim, u, 'cerydraE2', { dmg: 1.6 }, Infinity);
        if (E(u) >= 6) self(sim, u, 'cerydraE6', { resPen: 0.2 }, Infinity);
      },
      holder(sim, u) { const tg = sim.targetOf(u); return tg && sim.hasBuff(tg, 'merit') ? tg : null; },
      charge(sim, u, k) {
        if (u.state.coup) return;
        u.state.charge = Math.min(8, u.state.charge + k);
        const h = this.holder(sim, u);
        if (h && u.state.charge >= 6 && !sim.hasBuff(h, 'peerage')) sim.addBuff(h, { id: 'peerage', stats: { cd_Skill: 0.72, resPen: 0.1, ...(E(u) >= 1 ? { defIgnore_Skill: 0.2 } : {}) }, turns: Infinity });
      },
      afterDamage(sim, u, act) {
        if (act === 'Skill') {
          const h = sim.targetOf(u);
          if (h) {
            if (E(u) >= 1) sim.addBuff(h, { id: 'cerydraE1', stats: { defIgnore: 0.16 }, turns: Infinity });
            if (E(u) >= 2) sim.addBuff(h, { id: 'cerydraE2h', stats: { dmg: 0.4 }, turns: Infinity });
            if (E(u) >= 6) sim.addBuff(h, { id: 'cerydraE6h', stats: { resPen: 0.2 }, turns: Infinity });
            if (u.state.law) sim.addBuff(h, { id: 'odeLaw', stats: { cd: 0.3 }, turns: Infinity });
          }
          this.charge(sim, u, 1);
        }
      },
      ult(sim, u) { u.state.adds = 20; this.charge(sim, u, 2); },
      dmgScale(sim, u, act) { if (act !== 'Ult' || E(u) < 4) return 1; const p = window.AVEffects.P(u, 'Ultra', 0); return (p + 2.4) / p; },
      allyAction(sim, u, a, t) {
        const h = this.holder(sim, u);
        if (a !== h) return;
        if (t === 'Skill' && sim.hasBuff(h, 'peerage')) {
          sim.removeBuff(h, 'peerage');
          u.state.charge -= 6;
          if (u.state.law) u.state.charge += 1;
          this.charge(sim, u, 0);
        } else if (t === 'Basic' || t === 'Skill') this.charge(sim, u, 1);
      },
      allyUlt(sim, u, a) { if (a === this.holder(sim, u) && u.state.vidi && u.state.charge < 8) { u.state.vidi = false; this.charge(sim, u, 1); } },
      allyAttack(sim, u, a) {
        if (a !== this.holder(sim, u) || !(u.state.adds > 0)) return;
        u.state.adds -= 1;
        sim.addDamage(u, std(sim, u, { atk: 0.6 + (E(u) >= 6 ? 3 : 0) }), 'Additional');
      },
    },
    // ------------------------------------------------------------------ 1413 Evernight
    1413: {
      desc: 'Evey has 50% of her Max HP (its DMG and her Ultimate scale with it). Memoria: +1 at battle start and per ability by her or an ally memosprite, +2 when she loses HP (her abilities cost HP), +2 per Skill (+12 in Darkest Riddle), +1 after Evey\'s Skill (E2: +2 on every gain). Evey\'s Skill adds 14% of its HP per 4 Memoria; at 16+ Memoria Evey acts at once with Dream, Dissolving, as Dew (16.8% / 8.4% of its HP per Memoria to the target / others), uses it all, recovers 1 SP and leaves (Skill re-summons it). Skill: memosprites +24% of her CRIT DMG for 2 turns (+5/15/50/65% for 1/2/3/4 Remembrance allies). Talent / trace: +60% and +15% CRIT DMG while she and Evey keep losing HP; +35% CRIT Rate. Darkest Riddle (Ultimate; 2 Charges, 1 per Dream; E2: 4): enemies +30% DMG taken, she and Evey +60% DMG. E1: memosprites ×1.2–1.5 DMG by enemy count. E2: +40% CRIT DMG. E6: allies +20% RES PEN; Dream refunds 30% of the Memoria.',
      battleStart(sim, u) {
        u.state.mem = 0; u.state.riddle = 0;
        this.gain(sim, u, 1);
        self(sim, u, 'evernightTrace', { cr: 0.35, ...(E(u) >= 2 ? { cd: 0.4 } : {}) }, Infinity);
        if (E(u) >= 6) team(sim, 'evernightE6', { resPen: 0.2 }, Infinity);
      },
      evey(sim, u) { return sim.units.find((x) => x.owner === u && x.name === 'Evey' && x.alive); },
      gain(sim, u, k) {
        u.state.mem += k + (E(u) >= 2 ? 2 : 0);
        const ev = this.evey(sim, u);
        if (ev && u.state.mem >= 16 && !u.state.dream) { u.state.dream = true; sim.actNow(ev); }
      },
      hpLoss(sim, u) { self(sim, u, 'withMe', { cd: 0.6 }, 2); this.gain(sim, u, 2); },
      action(sim, u, t) {
        self(sim, u, 'darkNight', { cd: 0.15 }, 2);
        this.hpLoss(sim, u);
        this.gain(sim, u, 1);
        if (t === 'Skill') {
          if (!this.evey(sim, u)) sim.actNow(this.resummon(sim, u));
          const s = st(sim, u), rem = sim.chars().filter((a) => a.cfg.char.path === 'Remembrance').length;
          self(sim, u, 'everSkill', { cd_Memo: 0.24 * s.cd + [0, 0.05, 0.15, 0.5, 0.65][Math.min(4, rem)] + (u.state.time ? 0.12 * s.cd : 0) }, 2, { tick: 'owner', owner: u });
          this.gain(sim, u, 2 + (u.state.riddle > 0 ? 12 : 0) + (u.state.time ? 1 : 0));
        }
      },
      resummon(sim, u) {
        return sim.spawn({ key: `${u.key}:Evey`, name: 'Evey', owner: u, icon: u.icon, memo: true, fixedSpd: window.AVEffects.P(u, 'Talent', 3) });
      },
      hit(sim, u) { this.hpLoss(sim, u); },
      ult(sim, u) {
        u.state.riddle = E(u) >= 2 ? 4 : 2;
        self(sim, u, 'riddle', { dmg: 0.6 }, Infinity);
        if (!this.evey(sim, u)) this.resummon(sim, u);
        this.gain(sim, u, 1 + (u.state.time ? 1 : 0));
      },
      turnStart(sim, u) {
        if (u.state.riddleOn && !(u.state.riddle > 0)) {
          u.state.riddleOn = false;
          sim.removeBuff(u, 'riddle');
          sim.enemyMods = (sim.enemyMods || []).filter((m) => m.id !== 'darkestRiddle');
        }
      },
      afterDamage(sim, u, act) { if (act === 'Ult') { u.state.riddleOn = true; emod(sim, 'darkestRiddle', { vuln: 0.3 }, Infinity); } },
      e1(sim) { const k = n(sim); return k >= 4 ? 1.2 : k === 3 ? 1.25 : k === 2 ? 1.3 : 1.5; },
      dmgScale(sim, u, act, extra, unit) {
        if (unit && unit.name === 'Evey') return u.state.dream ? 0 : 0.5 * (E(u) >= 1 ? this.e1(sim) : 1);
        if (act === 'Ult') return 0.5 * (E(u) >= 1 ? this.e1(sim) : 1);
        return 1;
      },
      extraDamage(sim, u, act, extra, unit) {
        if (!unit || unit.name !== 'Evey') return 0;
        const e1 = E(u) >= 1 ? this.e1(sim) : 1, m = u.state.mem;
        if (u.state.dream) return std(sim, u, { hp: 0.5 * m * (0.168 + 0.084 * (n(sim) - 1)) }, 'Memo') * e1 * (u.state.time ? 1.18 : 1);
        return std(sim, u, { hp: 0.5 * 0.14 * Math.floor(m / 4) }, 'Memo') * e1;
      },
      allyAction(sim, u, a) {
        if (a.memo || (a.kind === 'summon' && a.owner)) {
          if (a.owner === u && a.name === 'Evey') {
            self(sim, u, 'darkNight', { cd: 0.15 }, 2);
            if (u.state.dream) {
              u.state.dream = false;
              const used = u.state.mem;
              u.state.mem = E(u) >= 6 ? 0.3 * used : 0;
              sim.gainSP(1, u);
              if (u.state.riddle > 0) u.state.riddle -= 1;
              sim.remove(a);
            } else this.gain(sim, u, 1);
          }
          this.gain(sim, u, 1);
        }
      },
    },
    // ------------------------------------------------------------------ 1414 Dan Heng • Permansor Terrae
    1414: {
      desc: 'Empyreanity: his Skill gives the Bondmate +15% of his ATK as ATK. Ultimate: Souldragon is enhanced for 2 actions (E2: 4): each deals 80% of his ATK to all enemies as a follow-up, plus 80% of the Bondmate\'s ATK as Additional DMG to all (E2: 160%) and 40% of it to one enemy (Sublimity). E1: Ultimate gives the Bondmate +18% RES PEN for 3 turns. E6: enemies take +20% DMG while the Bondmate is out, the Bondmate ignores 12% DEF, and his Ultimate adds 330% of the Bondmate\'s ATK to all enemies.',
      battleStart(sim, u) { u.state.enh = 0; },
      bond(sim, u) { const b = u.state.bond; return b && b.alive ? b : null; },
      afterDamage(sim, u, act) {
        const b = this.bond(sim, u);
        if (act === 'Skill' && b) {
          sim.units.forEach((x) => sim.removeBuff(x, 'empyreanity'));
          sim.addBuff(b, { id: 'empyreanity', stats: { atk: 0.15 * st(sim, u).ATK }, turns: Infinity });
          if (E(u) >= 6) { emod(sim, 'dhptE6', { vuln: 0.2 }, Infinity); sim.addBuff(b, { id: 'dhptE6', stats: { defIgnore: 0.12 }, turns: Infinity }); }
        }
        if (act === 'Ult') {
          u.state.enh = E(u) >= 2 ? 4 : 2;
          if (b && E(u) >= 1) sim.addBuff(b, { id: 'dhptE1', stats: { resPen: 0.18 }, turns: 3 });
          if (b && E(u) >= 6) sim.addDamage(u, std(sim, b, { atk: 3.3 * n(sim) }), 'Bondmate Additional');
        }
      },
      extraDamage(sim, u, act, extra, unit) {
        if (!unit || unit.name !== 'Souldragon' || !(u.state.enh > 0)) return 0;
        u.state.enh -= 1;
        const b = this.bond(sim, u);
        let d = std(sim, u, { atk: 0.8 * n(sim) }, 'FUA');
        if (b) d += std(sim, b, { atk: 0.8 * (E(u) >= 2 ? 2 : 1) * n(sim) + 0.4 });
        return d;
      },
    },
    // ------------------------------------------------------------------ 1415 Cyrene
    1415: {
      desc: 'Talent: allies +20% DMG. Causality in Trichotomy: at 180+ SPD allies +20% DMG and she / Demiurge get +2% Ice RES PEN per SPD above 180 (max 60). Skill Zone (2 of her turns; permanent after her first Ultimate): every ally DMG instance adds 24% as True DMG (E2: +6% per Ode-buffed ally, max +24%). Ripples: she and Demiurge +50% CRIT Rate. Demiurge\'s Minuet: 60% of its Max HP (= hers) to all, plus Ode to Ego bounces of 60% per teammate who gave Recollection (E1: +12; E4: +6% per Minuet, max 24 stacks); its Ode turns (see the Demiurge\'s turns setting) buff an ally instead of attacking: +40% DMG for 2 turns, or for Chrysos Heirs their special Ode (Genesis, Romance, Passage, Strife, Reason, Sky, Trickery, Worldbearing, Ocean, Law, Time, Earth). E6: first Ego: enemies −20% DEF.',
      CHRYSOS: { 8008: 'Genesis', 1402: 'Romance', 1403: 'Passage', 1404: 'Strife', 1407: 'LifeDeath', 1405: 'Reason', 1409: 'Sky', 1406: 'Trickery', 1408: 'Worldbearing', 1410: 'Ocean', 1412: 'Law', 1413: 'Time', 1414: 'Earth' },
      battleStart(sim, u) {
        u.state.zone = 0; u.state.minuets = 0; u.state.givers = new Set();
        team(sim, 'cyreneTalent', { dmg: 0.2 }, Infinity);
        const sp = sim.spd(u);
        if (sp >= 180) team(sim, 'causality', { dmg: 0.2 }, Infinity);
        self(sim, u, 'causalityPen', { resPen: 0.02 * Math.min(60, Math.max(0, sp - 180)) }, Infinity);
      },
      turnStart(sim, u) { if (!u.state.ripples && u.state.zone > 0) u.state.zone -= 1; },
      action(sim, u, t) { if (t === 'Skill') u.state.zone = 2; },
      ult(sim, u) { self(sim, u, 'ripplesCR', { cr: 0.5 }, Infinity); },
      damageDealt(sim, u, by, amt, label) {
        if (!(u.state.zone > 0 || u.state.ripples) || !amt || /True/.test(label || '')) return;
        if (!by || (by.kind !== 'char' && !by.owner)) return;
        const k = 0.24 + (E(u) >= 2 ? Math.min(0.24, 0.06 * (u.state.odeAllies || 0)) : 0);
        sim.addDamage(u, k * amt, 'True DMG (Zone)');
      },
      allyAction(sim, u, a) {
        if (a.kind === 'char' && a !== u) u.state.givers.add(a);
        if (a.name !== 'Demiurge' || a.owner !== u) return;
        if (u.state.demiOde) { this.ode(sim, u, u.state.demiOde); return; }
        u.state.minuets += 1;
        if (E(u) >= 6 && u.state.minuets === 1) emod(sim, 'cyreneE6', { def: 0.2 }, Infinity);
        for (const h of sim.chars()) {
          if (h.state.sky !== undefined) h.state.sky = (h.state.sky || 0) + 2;
          if (h.cfg.char.id === '1414' && h.state.bond) sim.addBuff(h.state.bond, { id: 'odeEarth', stats: { dmg: 0.24 }, turns: Infinity });
        }
      },
      ode(sim, u, tg) {
        u.state.demiOde = false;
        u.state.odeSet = u.state.odeSet || new Set();
        u.state.odeSet.add(tg);
        u.state.odeAllies = u.state.odeSet.size; // E2 counts different allies
        const kind = this.CHRYSOS[tg.cfg.char.id];
        const add = (stats, turns = Infinity) => sim.addBuff(tg, { id: `ode${kind || ''}`, stats, turns });
        const s = st(sim, u);
        switch (kind) {
          case 'Genesis': add({ atk: 0.16 * s.HP, cr: 0.72 * Math.min(1, s.cr) }); break;
          case 'Romance': add({ dmg: (sm, a) => (a.state.stance ? 0.72 : 0), defIgnore: (sm, a) => (a.state.stance ? 0.36 : 0) }); tg.state.romance = true; break;
          case 'Passage': add({ defIgnore: 0.12 }); break;
          case 'Strife': sim.addBuff(tg, { id: 'odeStrife', stats: { cd: 2 }, turns: 1 }); break;
          case 'Reason': tg.state.reason = true; sim.gainSP(1, u); sim.chars().filter((a) => a.cfg.char.path === 'Erudition').forEach((a) => sim.addBuff(a, { id: 'trueKnowledge', stats: { atkPct: 0.6, dmg_Skill: 0.4 }, turns: 2 })); break;
          case 'Sky': F(sim, tg, 24); tg.state.sky = 2; break;
          case 'Trickery': add({ dmg: 0.36 }); emod(sim, 'odeTrickery', { def: (0.2 + 0.12 * (n(sim) - 1)) / n(sim) }, Infinity); break;
          case 'Worldbearing': add({ cr: (sm, a) => (a.state.khas ? 0.16 : 0), cd: (sm, a) => (a.state.khas ? Math.min(0.72, 0.12 * (a.state.overflow || 0)) : 0) }); tg.state.worldbearing = true; break;
          case 'Ocean': add({ dmg: 1.2 }); tg.state.ocean = true; break;
          case 'Law': { tg.state.law = true; const h = sim.targetOf(tg); if (h && sim.hasBuff(h, 'merit')) sim.addBuff(h, { id: 'odeLaw', stats: { cd: 0.3 }, turns: Infinity }); break; }
          case 'Time': tg.state.time = true; break;
          case 'Earth': tg.state.odeEarth = true; if (tg.state.bond) sim.addBuff(tg.state.bond, { id: 'odeEarth', stats: { dmg: 0.24 }, turns: Infinity }); break;
          case 'LifeDeath': break;
          default: sim.addBuff(tg, { id: 'odeAllLives', stats: { dmg: 0.4 }, turns: 2 });
        }
      },
      dmgScale(sim, u, act, extra, unit) { return unit && unit.name === 'Demiurge' && u.state.demiOde ? 0 : 1; },
      extraDamage(sim, u, act, extra, unit) {
        if (!unit || unit.name !== 'Demiurge' || u.state.demiOde) return 0;
        const bounces = Math.min(3, u.state.givers.size) + (E(u) >= 1 ? 12 : 0);
        const e4 = E(u) >= 4 ? 1 + 0.06 * Math.min(24, u.state.minuets) / 0.6 : 1;
        return std(sim, u, { hp: 0.6 * bounces }, 'Memo') * e4;
      },
    },

    // ------------------------------------------------------------------ 1501 Sparxie
    1501: {
      desc: 'Bloom! gets +20% / +10% multiplier (target / adjacent) per Engagement Farming, and with Certified Banger 20% Elation DMG per Farming. Ultimate: (60% of Elation + 50%) ATK to all enemies. Elation Skill: 50% to all + 20 bounces of 25% (E6: +1 per Punchline, max 40). Sweet!: +5% Elation per 100 ATK above 2000 (max 80%). E1: allies +1.5% RES PEN per Punchline (max 15%). E2: +10% CRIT DMG per Thrill spent for 2 turns (4 stacks). E4: Ultimate +36% Elation for 3 turns. E6: +20% RES PEN.',
      battleStart(sim, u) {
        const atk = st(sim, u).ATK;
        self(sim, u, 'sweet', { elation: Math.min(0.8, 0.05 * Math.floor(Math.max(0, atk - 2000) / 100)) }, Infinity);
        if (E(u) >= 1) team(sim, 'sparxieE1', { resPen: (s) => Math.min(0.15, 0.015 * s.punchline) }, Infinity);
        if (E(u) >= 6) self(sim, u, 'sparxieE6', { resPen: 0.2 }, Infinity);
      },
      farms(u) { const v = u.cfg.opts && u.cfg.opts.farm; return +(v === undefined || v === '' ? 2 : v) || 1; },
      action(sim, u, t) { if (E(u) >= 2 && t === 'Enhanced') { const k = Math.min(4, this.farms(u)); for (let i = 0; i < k; i++) self(sim, u, 'sparxieE2', { cd: 0.1 }, 2, { maxStacks: 4 }); } },
      ult(sim, u) { if (E(u) >= 4) self(sim, u, 'sparxieE4', { elation: 0.36 }, 3); },
      dmgScale(sim, u, act) {
        if (act === 'Enhanced') { const f = this.farms(u), k = n(sim), adj = Math.min(2, k - 1); return (1 + 0.2 * f + (0.5 + 0.1 * f) * adj) / (1 + 0.5 * adj); }
        if (act === 'Elation' && E(u) >= 6) return (0.5 * n(sim) + 0.25 * Math.min(40, 20 + sim.punchline)) / (0.5 * n(sim) + 0.25 * 20);
        return 1;
      },
      extraDamage(sim, u, act) {
        if (act === 'Ult') return std(sim, u, { atk: (0.6 * (st(sim, u).elation || 0) + 0.5) * n(sim) }, 'Ult');
        if (act === 'Enhanced' && sim.cbTotal(u) > 0) return AD().elation(sim, u, 0.2 * this.farms(u), sim.cbTotal(u));
        return 0;
      },
    },
    // ------------------------------------------------------------------ 1502 Yao Guang
    1502: {
      desc: 'Zone (Skill / Technique, 3 of her turns): allies +20% of her Elation as Elation (E2: +16% more). Amaze-In Grace: at 120+ SPD, +30% Elation and +1% per SPD above 120 (max 200). Poised and Sated: +60% CRIT DMG. E1: allies\' Elation DMG ignores 20% DEF. E4: in the Aha extra turn from her Ultimate, Elation Skills deal 150%. E6: allies\' Elation DMG merrymakes 25%; her Elation Skill multiplier doubled.',
      battleStart(sim, u) {
        const sp = sim.spd(u);
        self(sim, u, 'amaze', { elation: sp >= 120 ? 0.3 + 0.01 * Math.min(200, sp - 120) : 0, cd: 0.6 }, Infinity);
        if (E(u) >= 1) team(sim, 'yaoE1', { defIgnore_Elation: 0.2 }, Infinity);
        if (E(u) >= 6) team(sim, 'yaoE6', { merrymake: 0.25 }, Infinity);
        team(sim, 'yaoZone', { elation: (s, a) => {
          const yao = s.chars().find((c) => c.cfg.char.id === '1502');
          if (!yao || !(yao.state.zone > 0)) return 0;
          const own = a === yao ? 0 : 0.2 * (((yao.stats0 && yao.stats0.elation) || 0) + 0.3 + 0.01 * Math.min(200, Math.max(0, s.spd(yao) - 120)));
          return own + (E(yao) >= 2 ? 0.16 : 0);
        } }, Infinity);
      },
      ult(sim, u) { if (E(u) >= 4) u.state.e4 = true; },
      allyElation(sim, u, a) {},
      dmgScale(sim, u, act) { return act === 'Elation' && E(u) >= 6 ? 2 : 1; },
    },
    // ------------------------------------------------------------------ 1503 Pearl
    1503: {
      desc: 'Enhanced Basic ATK: Imagenate the Starry Night if the Aesthetic Archetype is Elation, else Render the Great Wave; after it, 60% Ice Elation DMG with the Archetype\'s stats (E6: +240%). Elation Skill: every ally\'s next attack adds 10/15/20/40% Elation DMG for 1/2/3/4+ Elation characters (E4: doubled). Panoptic Vision: +32% Elation at 2400 DEF, +3% per 100 DEF above (max 3600). E1: allies +10/20/60% Elation with 2/3/4+ Elation characters. E2: allies\' Elation DMG merrymakes 15%. E6: +20% RES PEN while Deep Learning lasts.',
      battleStart(sim, u) {
        const def = st(sim, u).DEF;
        if (def >= 2400) self(sim, u, 'panoptic', { elation: 0.32 + 0.03 * Math.floor(Math.min(3600, def - 2400) / 100) }, Infinity);
        const el = sim.chars().filter((a) => a.cfg.char.path === 'Elation').length;
        if (E(u) >= 1) team(sim, 'pearlE1', { elation: el >= 4 ? 0.6 : el === 3 ? 0.2 : el === 2 ? 0.1 : 0 }, Infinity);
        if (E(u) >= 2) team(sim, 'pearlE2', { merrymake: 0.15 }, Infinity);
        if (E(u) >= 6) team(sim, 'pearlE6', { resPen: (s, a) => { const p = s.chars().find((c) => c.cfg.char.id === '1503'); return p && p.state.deep > 0 ? 0.2 : 0; } }, Infinity);
        u.state.dissolve = new Set();
      },
      arch(sim, u) { return sim.targetOf(u); },
      dmgAbility(sim, u, act) {
        if (act !== 'Enhanced') return undefined;
        const a = this.arch(sim, u);
        return a && a.cfg.char.path === 'Elation' ? 'Brushstroke: Imagenate the Starry Night' : 'Brushstroke: Render the Great Wave';
      },
      afterDamage(sim, u, act) {
        if (act === 'Enhanced') {
          const a = this.arch(sim, u) || u;
          sim.addDamage(u, AD().elation(sim, a, 0.6 + (E(u) >= 6 ? 2.4 : 0), sim.punchline), 'Deep Learning');
        }
        if (isAtk(act)) this.dissolve(sim, u, u);
      },
      elation(sim, u) {
        const el = sim.chars().filter((a) => a.cfg.char.path === 'Elation').length;
        u.state.dissolveMult = [0, 0.1, 0.15, 0.2, 0.4][Math.min(4, el)] * (E(u) >= 4 ? 2 : 1);
        u.state.dissolve = new Set(sim.chars());
      },
      dissolve(sim, u, a) {
        if (!u.state.dissolve || !u.state.dissolve.has(a)) return;
        u.state.dissolve.delete(a);
        sim.addDamage(a, AD().elation(sim, a, u.state.dissolveMult, sim.punchline), 'Dissolve Reason');
      },
      allyAttack(sim, u, a, t) { if (a.kind === 'char' && t !== 'Elation') this.dissolve(sim, u, a); },
    },
    // ------------------------------------------------------------------ 1504 Ashveil
    1504: {
      desc: 'Bait (always one, from battle start): all enemies −40% DEF (E6: −20% All-Type RES). Gluttony: +2 per Talent follow-up, +1 per Skill, +2 per Ultimate (max 12; E2: 18). Phantom Limb: follow-ups +80% DMG, +10% per Gluttony. Ultimate: the enhanced follow-up spends 4 Gluttony for an extra 200% hit (E2: refunds 35%). First Fang: allies\' follow-ups +80% CRIT DMG. E1: enemies take +24% DMG (36% at ≤50% HP; averaged). E4: Ultimate +40% ATK for 3 turns. E6: +4% DMG per Gluttony gained (30 stacks).',
      battleStart(sim, u) {
        u.state.glut = 0; u.state.gained = 0; u.state.bait = true; // a Bait is picked as soon as there's none
        emod(sim, 'bait', { def: 0.4, ...(E(u) >= 6 ? { res: 0.2 } : {}) }, Infinity);
        team(sim, 'firstFang', { cd_FUA: 0.8 }, Infinity);
        self(sim, u, 'phantom', { dmg_FUA: (s, a) => 0.8 + 0.1 * a.state.glut, dmg: (s, a) => (E(a) >= 6 ? 0.04 * Math.min(30, a.state.gained) : 0) }, Infinity);
        if (E(u) >= 1) emod(sim, 'ashveilE1', { vuln: 0.3 }, Infinity);
      },
      glut(sim, u, k) { u.state.glut = Math.min(E(u) >= 2 ? 18 : 12, u.state.glut + k); u.state.gained += k; },
      action(sim, u, t) { if (t === 'Skill') this.glut(sim, u, 1); },
      ult(sim, u) { this.glut(sim, u, 2); if (E(u) >= 4) self(sim, u, 'ashveilE4', { atkPct: 0.4 }, 3); },
      followUpDone(sim, u, label) {
        if (label === 'Enhanced Follow-up' && u.state.glut >= 4) {
          u.state.glut -= 4;
          sim.addDamage(u, std(sim, u, { atk: 2 }, 'FUA'), 'Gluttony');
          if (E(u) >= 2) u.state.glut += Math.round(4 * 0.35);
        }
        this.glut(sim, u, 2);
      },
    },
    // ------------------------------------------------------------------ 1505 Evanescia
    1505: {
      desc: 'Talent: Elation equal to 20% of CRIT DMG. Watch All Revels: +30% CRIT Rate; Ultimate bounces +1 / 2 / 4 with 3+ / 2 / 1 enemies. Weigh All Truths: Master Fox makes enemies take +12% DMG for 3 turns. E1: +20% RES PEN. E2: +36% CRIT DMG. E4: ignores 15% DEF. E6: Elation DMG merrymakes 15% (+2% per 100 Certified Banger, max 1000).',
      battleStart(sim, u) {
        self(sim, u, 'halcyon', { elation: (s, a) => 0.2 * ((a.stats0 && a.stats0.cd) || 0) + (E(a) >= 2 ? 0.072 : 0), cr: 0.3, ...(E(u) >= 2 ? { cd: 0.36 } : {}), ...(E(u) >= 1 ? { resPen: 0.2 } : {}), ...(E(u) >= 4 ? { defIgnore: 0.15 } : {}) }, Infinity);
        if (E(u) >= 6) self(sim, u, 'evanesciaE6', { merrymake: (s, a) => 0.15 + 0.02 * Math.floor(Math.min(1000, s.cbTotal(a)) / 100) }, Infinity);
      },
      followUpDone(sim, u, label) { if (label === 'Master Fox') emod(sim, 'weigh', { vuln: 0.12 }, 3); },
      dmgScale(sim, u, act) {
        if (act !== 'Ult') return 1;
        const k = n(sim), extra = k >= 3 ? 1 : k === 2 ? 2 : 4;
        const P = window.AVEffects.P, a = P(u, 'Ultra', 0), b = P(u, 'Ultra', 2);
        return (a * k + b * (5 + extra)) / (a * k + b * 5);
      },
    },

    // ------------------------------------------------------------------ 1506 Silver Wolf LV.999
    1506: {
      desc: 'Hidden MMR: +0.4% CRIT Rate per point; past 100% CRIT Rate, +0.8% CRIT DMG per point instead. Enhanced Basic ATK: +15% DMG per 60 MMR (2 stacks); with Certified Banger it deals Elation DMG at the same multiplier (E6: merrymakes 50%). Top Loot Box (Godmode, Certified Banger, on SP spent): 90% Imaginary Elation DMG split across enemies (Big Flipping Sword: +20% of it as True DMG). Only her Godmode Elation Skill (Honkai-DMG Demo: 6 × 90%) deals DMG (E4: counts 5× the Punchline). False Ending Speedrun: at 160+ SPD +50% Elation and +2% per SPD above 160 (max 100). E1: in Godmode enemies take +20% DMG. E6: Absolute Weakness: enemies\' base RES drops to 0.',
      battleStart(sim, u) {
        const sp = sim.spd(u);
        self(sim, u, 'mmrStats', {
          cr: (s, a) => Math.min(Math.max(0, 1 - ((a.stats0 && a.stats0.cr) || 0)), 0.004 * (a.state.mmr || 0)),
          cd: (s, a) => { const base = (a.stats0 && a.stats0.cr) || 0, crPts = Math.max(0, (1 - base) / 0.004); return 0.008 * Math.max(0, (a.state.mmr || 0) - crPts); },
          elation: sp >= 160 ? 0.5 + 0.02 * Math.min(100, sp - 160) : 0,
        }, Infinity);
        if (E(u) >= 6) emod(sim, 'absoluteWeakness', { res: sim.enemyRes != null ? sim.enemyRes : 0.2 }, Infinity);
        u.state.lastLoot = 0;
      },
      ult(sim, u) { if (E(u) >= 1) emod(sim, 'sw999E1', { vuln: 0.2 }, Infinity); },
      action(sim, u, t) {
        if (t === 'Enhanced') { u.state.mmrAtHit = u.state.mmr || 0; if (E(u) >= 6) self(sim, u, 'sw999E6', { merrymake: 0.5 }, Infinity); }
      },
      afterDamage(sim, u, act) {
        sim.removeBuff(u, 'sw999E6');
        if (act === 'Enhanced' && !u.state.god) sim.enemyMods = (sim.enemyMods || []).filter((m) => m.id !== 'sw999E1');
      },
      dmgScale(sim, u, act, extra) {
        if (act === 'Elation') {
          if (!u.state.god) return 0;
          if (E(u) >= 4 && extra && extra.punchline > 0) { const pm = AD().punchlineMult; return pm(5 * extra.punchline) / pm(extra.punchline); }
          return 1;
        }
        if (act === 'Enhanced') return (sim.cbTotal(u) > 0 ? 0 : 1) * (1 + 0.15 * Math.min(2, Math.floor((u.state.mmrAtHit || 0) / 60)));
        return 1;
      },
      extraDamage(sim, u, act) {
        if (act !== 'Enhanced' || !(sim.cbTotal(u) > 0)) return 0;
        const P = window.AVEffects.P, ab = u.cfg.char.combat.abilities.find((a) => a.name === 'Bonus Stage: αWolf Instant');
        const row = ab && ab.params ? ab.params[Math.min(ab.params.length, 6) - 1] : [2.4, 0, 100, 1];
        return AD().elation(sim, u, (row[0] + row[3]) * (1 + 0.15 * Math.min(2, Math.floor((u.state.mmrAtHit || 0) / 60))), sim.cbTotal(u));
      },
      spUsed(sim, u) {
        if (u.state.loot === u.state.lastLoot || u.state.loot === undefined) return;
        u.state.lastLoot = u.state.loot;
        const d = AD().elation(sim, u, 0.9, sim.cbTotal(u));
        sim.addDamage(u, d, 'Top Loot Box');
        if (u.state.loot === 0) sim.addDamage(u, 0.2 * d, 'True DMG');
      },
    },
    // ------------------------------------------------------------------ 1507 Mortenax Blade
    1507: {
      desc: 'Fornax Ex Corpore (first Ultimate) deals no DMG; in Infinite Fury his Ultimate is Tenax Per Ignem (E6: ×1.5). Balefire Bind (Ultimate, and each ally attack in the Zone): −30% DEF and +50% DMG taken for 2 turns. Infinite Fury: +20% CRIT Rate, +60% CRIT DMG. Heart, Refined: with other Nihility teammates allies\' Ultimate DMG +75%, otherwise his DMG +75% (in the Zone). E1: Zone −20% All-Type RES; extra Skills delay the countdown 15%. E2: allies\' Ultimates count as follow-ups; follow-up DMG +75%. E4: Zone +50% DMG to allies.',
      battleStart(sim, u) {
        self(sim, u, 'fury', { cr: (s, a) => (a.state.fury ? 0.2 : 0), cd: (s, a) => (a.state.fury ? 0.6 : 0) }, Infinity);
        u.state.nih = sim.allies(u).some((a) => a.cfg.char.path === 'Nihility');
      },
      zoneOn(sim, u) { return !!u.state.fury; },
      ult(sim, u) {
        u.state.tenax = !!u.state.inFury; u.state.inFury = true;
        emod(sim, 'balefire', { def: 0.3, vuln: 0.5 }, 2);
        if (!u.state.tenax) {
          if (u.state.nih) team(sim, 'heart', { dmg_Ult: (s, a) => (u.state.fury ? 0.75 : 0) }, Infinity);
          else self(sim, u, 'heart', { dmg: (s, a) => (a.state.fury ? 0.75 : 0) }, Infinity);
          if (E(u) >= 1) emod(sim, 'mortenaxE1', { res: 0.2 }, Infinity);
          if (E(u) >= 2) team(sim, 'mortenaxE2', { dmg_FUA: (s, a) => (u.state.fury ? 0.75 : 0) }, Infinity);
          if (E(u) >= 4) team(sim, 'mortenaxE4', { dmg: (s, a) => (u.state.fury ? 0.5 : 0) }, Infinity);
        }
      },
      sync(sim, u) {
        if (u.state.fury) return;
        if (u.state.inFury) { u.state.inFury = false; sim.enemyMods = (sim.enemyMods || []).filter((m) => m.id !== 'mortenaxE1'); }
      },
      turnStart(sim, u) { this.sync(sim, u); },
      allyAction(sim, u) { this.sync(sim, u); },
      allyAttack(sim, u, a) { if (u.state.fury && a.kind === 'char') emod(sim, 'balefire', { def: 0.3, vuln: 0.5 }, 2); },
      followUpDone(sim, u, label) {
        if (label !== 'Extra Skill' || E(u) < 1) return;
        const cd = sim.units.find((x) => x.key === `${u.key}:fury` && x.alive);
        if (cd) sim.delay(cd, 0.15);
      },
      dmgAbility(sim, u, act) { return act === 'Ult' ? (u.state.tenax ? 'Tenax Per Ignem' : 'Fornax Ex Corpore') : undefined; },
      dmgScale(sim, u, act) { return act === 'Ult' && u.state.tenax && E(u) >= 6 ? 1.5 : 1; },
    },
    // ------------------------------------------------------------------ 1508 Rin Tohsaka
    1508: {
      desc: 'Gem Energy: 20 at battle start, +1 per SP any ally spends or recovers, Ultimate +12 (E6: +24). At 15+ Gem Energy (or 7+ SP) her Skill becomes Second Magic Experiment: 90% to all, then 90% to a random enemy per 3 Gem Energy (max 33), first turning SP above 2 into 2 Gem Energy each; Ladylike Poise: +20% SPD for 3 turns after it. Gem Magecraft: +70% CRIT DMG for 2 turns to allies who spend or recover SP (E4: stacks twice on her). Elegant Conduct: +150% ATK and +15% Quantum RES PEN (Archer too). Freeform Tohsaka Style: after Archer\'s Skill with ≤3 SP (or his 5th in one Circuit Connection), a Joint follow-up: 300% of her ATK and 300% of his to all enemies, +4 SP (once per her turn). E1: an Enhanced Skill spending 30+ Gem Energy leaves an equal Shadow Gem that pays for the next one. E2: her Skill +30% DMG; allies\' Skill DMG ×1.3. E6: +20% RES PEN.',
      battleStart(sim, u) {
        u.state.gem = 20; u.state.shadow = 0;
        const archer = sim.chars().find((a) => a.cfg.char.id === '1015');
        [u, archer].filter(Boolean).forEach((a) => sim.addBuff(a, { id: 'elegant', stats: { atkPct: 1.5, resPen: 0.15 }, turns: Infinity }));
        if (E(u) >= 2) { self(sim, u, 'rinE2', { dmg_Skill: 0.3 }, Infinity); team(sim, 'rinE2team', { dmg_Skill: 0.3 }, Infinity); }
        if (E(u) >= 6) self(sim, u, 'rinE6', { resPen: 0.2 }, Infinity);
      },
      spUsed(sim, u, by, k) { u.state.gem += k; if (by === u && E(u) >= 4) self(sim, u, 'rinCD4', { cd: 0.7 }, 2, { maxStacks: 2 }); },
      spGained(sim, u, by, k) { u.state.gem += k || 1; if (by && by.kind === 'char') sim.addBuff(by, { id: 'rinCD', stats: { cd: 0.7 }, turns: 2 }); },
      ult(sim, u) { u.state.gem += E(u) >= 6 ? 24 : 12; },
      enhanced(sim, u) { return u.state.shadow > 0 || u.state.gem >= 15 || sim.sp >= 7; },
      dmgAbility(sim, u, act) { return act === 'Skill' && u.state.second ? 'Second Magic Experiment' : undefined; },
      action(sim, u, t) {
        u.state.second = t === 'Skill' && this.enhanced(sim, u);
        if (!u.state.second) return;
        let gems, fromShadow = false;
        if (u.state.shadow > 0) { gems = u.state.shadow; u.state.shadow = 0; fromShadow = true; }
        else {
          while (sim.sp > 2) { sim.useSP(1, u); u.state.gem += 2; }
          gems = u.state.gem;
        }
        u.state.cycles = Math.min(33, Math.floor(gems / 3));
        const spent = 3 * u.state.cycles;
        if (!fromShadow) { u.state.gem -= Math.min(u.state.gem, spent); if (E(u) >= 1 && spent >= 30) u.state.shadow = spent; }
        sim.addBuff(u, { id: 'ladylike', pct: 0.2, turns: 3 });
      },
      dmgScale(sim, u, act) {
        if (act !== 'Skill' || !u.state.second) return 1;
        const k = n(sim);
        return (0.9 * k + 0.9 * u.state.cycles) / (0.9 * k + 0.9);
      },
      allyAttack(sim, u, a, t) {
        if (!a.cfg || a.cfg.char.id !== '1015' || t !== 'Skill' || u.state.joint) return;
        a.state.rinCasts = (a.state.rinCasts || 0) + 1;
        if (sim.sp > 3 && a.state.rinCasts < 5) return;
        u.state.joint = true; a.state.rinCasts = 0;
        const ev = sim.record(u, 'FollowUp', { label: 'Freeform Tohsaka Style (Joint)' });
        const k = n(sim);
        ev.dmg = std(sim, u, { atk: 3 * k }, 'FUA');
        sim.addDamage(u, ev.dmg, 'Joint Follow-up');
        sim.addDamage(a, std(sim, a, { atk: 3 * k }, 'FUA'), 'Joint Follow-up');
        sim.gainSP(4, u);
        sim.snap(ev, u);
      },
      turnEnd(sim, u) { u.state.joint = false; },
    },
    // ------------------------------------------------------------------ 1509 Gilgamesh
    1509: {
      desc: 'Interest also from his Ultimate (+2), teammates\' Ultimates (+2) and the Joint follow-up (+3) (E2: +5 at battle start and per Ultimate). Hero\'s Hauteur: +25% CRIT DMG per Interest gained (max 6). King\'s Burden: a teammate\'s Ultimate gives him +40% Ultimate DMG for 3 turns. Gate of Babylon: King\'s Acknowledgement ignores 30% DEF for 3 turns (E1: for all allies, and +60% ATK for him). Hegemon\'s Strife: allies with more than 140 Max Energy get +1% ATK and CRIT DMG per extra point (max 100%). With Saber: every 8 attacks by them, a Joint follow-up: 400% of his ATK (Lightning) and 600% of hers (Wind) to all enemies; Saber +120 fixed Energy and her next Ultimate ×2. E2: Skill +100% / +50% multiplier. E6: Ultimate bounces +80%; allies +20% RES PEN; Golden Rule: +100% Ultimate CRIT DMG per teammate Ultimate since his last (max 3).',
      battleStart(sim, u) {
        u.state.tally = 0; u.state.gainedI = 0; u.state.golden = 0;
        sim.allies(u).concat([u]).forEach((a) => { const x = Math.min(1, Math.max(0, (a.maxEnergy || 0) - 140) * 0.01); if (x) sim.addBuff(a, { id: 'hegemonX', stats: { atkPct: x, cd: x }, turns: Infinity }); });
        if (E(u) >= 6) team(sim, 'gilE6', { resPen: 0.2 }, Infinity);
        if (E(u) >= 2) this.interest(sim, u, 5);
      },
      interest(sim, u, k) {
        u.state.interest = (u.state.interest || 0) + k;
        u.state.gainedI += k;
        if (u.state.interest >= 10) u.state.piqued = true;
        sim.addBuff(u, { id: 'interest', pct: 0.1 * u.state.interest, turns: Infinity });
        self(sim, u, 'hauteur', { cd: 0.25 * Math.min(6, u.state.gainedI) }, Infinity);
      },
      action(sim, u, t) {
        if (t === 'Skill') { self(sim, u, 'acknowledgement', { defIgnore: 0.3, ...(E(u) >= 1 ? { atkPct: 0.6 } : {}) }, 3); if (E(u) >= 1) sim.allies(u).forEach((a) => sim.addBuff(a, { id: 'acknowledgementTeam', stats: { defIgnore: 0.3 }, turns: 3 })); }
      },
      ult(sim, u) {
        this.interest(sim, u, 2 + (E(u) >= 2 ? 5 : 0));
        if (E(u) >= 6 && u.state.golden) { self(sim, u, 'goldenRule', { cd_Ult: u.state.golden }, Infinity); u.state.golden = 0; }
      },
      allyUlt(sim, u, a) {
        if (a.kind !== 'char') return;
        this.interest(sim, u, 2);
        self(sim, u, 'kingsBurden', { dmg_Ult: 0.4 }, 3);
        if (E(u) >= 6) u.state.golden = Math.min(3, u.state.golden + 1);
      },
      dmgScale(sim, u, act) {
        if (act === 'Skill' && E(u) >= 2) { const k = n(sim), adj = Math.min(2, k - 1), P = window.AVEffects.P, a = P(u, 'BPSkill', 0), b = P(u, 'BPSkill', 1); return ((a + 1) + (b + 0.5) * adj) / (a + b * adj); }
        if (act === 'Ult' && E(u) >= 6) { const k = n(sim), P = window.AVEffects.P, a = P(u, 'Ultra', 0), b = P(u, 'Ultra', 1); return (a * k + (b + 0.8) * 10) / (a * k + b * 10); }
        return 1;
      },
      saberAttack(sim, u) {
        const saber = sim.chars().find((a) => a.cfg.char.id === '1014');
        if (!saber || ++u.state.tally < 8) return;
        u.state.tally = 0;
        const ev = sim.record(u, 'FollowUp', { label: 'Joint follow-up (Saber)' });
        const k = n(sim);
        ev.dmg = std(sim, u, { atk: 4 * k }, 'FUA');
        sim.addDamage(u, ev.dmg, 'Joint Follow-up');
        sim.addDamage(saber, std(sim, saber, { atk: 6 * k }, 'FUA'), 'Joint Follow-up');
        this.interest(sim, u, 3);
        F(sim, saber, 120);
        saber.state.gilDouble = true;
        sim.snap(ev, u);
      },
      afterDamage(sim, u, act) { if (isAtk(act)) this.saberAttack(sim, u); if (act === 'Skill') { u.state.interest = 0; } },
      allyAttack(sim, u, a) { if (a.cfg && a.cfg.char.id === '1014') this.saberAttack(sim, u); },
    },

    // ------------------------------------------------------------------ 1510 Himeko • Nova
    1510: {
      desc: 'Talent: +20% RES PEN and +80% CRIT DMG (E4: after an Assist Skill the RES PEN goes to all allies, +10% more for her). Ultimate uses its "up to" totals (Starblazer beams and pulses) plus the 3-hit Final Hit. Companion Protocol: Verdict: she gets +100% DMG and +100% Ultimate DMG; Decimation: allies +100% CRIT DMG and +100% Skill CRIT DMG (Assist Skills count as Skills). E2: Ultimate and Assist Skill DMG ×1.3. E6: +20% Fire RES PEN; Assist Skills +75% DMG; pulses at 6 Source Energy add 160% to all enemies.',
      battleStart(sim, u) {
        self(sim, u, 'novaTalent', { resPen: 0.2, cd: 0.8, ...(E(u) >= 6 ? { resPen_Assist: 0 } : {}) }, Infinity);
        if (E(u) >= 6) self(sim, u, 'novaE6', { resPen: 0.2 }, Infinity);
        self(sim, u, 'verdict', { dmg: (s, a) => (a.state.protocol === 'verdict' ? 1 : 0), dmg_Ult: (s, a) => (a.state.protocol === 'verdict' ? 1 : 0) }, Infinity);
        team(sim, 'decimation', { cd: (s, a) => (u.state.protocol === 'decimation' ? 1 : 0), cd_Skill: (s, a) => (u.state.protocol === 'decimation' ? 1 : 0) }, Infinity);
      },
      assistUsed(sim, u) { if (E(u) >= 4) { team(sim, 'novaE4', { resPen: 0.2 }, Infinity); self(sim, u, 'novaE4self', { resPen: 0.1 }, Infinity); } },
      allyAction(sim, u, a, t) { if (t === 'Assist') this.assistUsed(sim, u); },
      dmgScale(sim, u, act) {
        let f = 1;
        if (E(u) >= 2 && (act === 'Ult' || act === 'Assist')) f *= 1.3;
        if (E(u) >= 6 && act === 'Assist') f *= 1 + 0.75 / (1 + st(sim, u).dmg);
        return f;
      },
      extraDamage(sim, u, act) { return act === 'Ult' && E(u) >= 6 ? std(sim, u, { atk: 1.6 * n(sim) }, 'Ult') : 0; },
    },
    // ------------------------------------------------------------------ 1512 Robin • Summeretto
    1512: {
      desc: 'Summer Songbirds have 70% of her Max HP (their Chirrup Quartet scales with it; E6: ×2). Rebuilt Harmony: +50% CRIT Rate. Fever Zone: allies ignore 15% + 0.5% per Vibe of DEF. Deviated Chords: allies who give her Vibes get +(16% + 0.4% per Vibe) of her Max HP as ATK if their ATK is higher, else +(40% + 1.5% per Vibe) CRIT DMG, for 2 turns. Improvised Blues: with a healer / shielder on the team, the first Vibes gain each turn regenerates 3 fixed Energy. E1: the Songbirds tally 100% of allies\' non-True DMG; each Chirrup adds (11% + 0.1% per Vibe) of it as True DMG and clears half. E2: allies +18% RES PEN; the first ability each turn that gives Vibes gives 2 more.',
      battleStart(sim, u) {
        u.state.tally = 0;
        self(sim, u, 'rebuilt', { cr: 0.5 }, Infinity);
        team(sim, 'feverZone', { defIgnore: (s) => (u.state.fever ? 0.15 + 0.005 * (u.state.vibes || 0) : 0) }, Infinity);
        if (E(u) >= 2) team(sim, 'robinSE2', { resPen: 0.18 }, Infinity);
        u.state.groove = sim.allies(u).some((a) => ['Abundance', 'Preservation'].includes(a.cfg.char.path));
      },
      chords(sim, u, a) {
        if (!a || a.kind !== 'char' || a === u) return;
        const s = st(sim, u), v = u.state.vibes || 0;
        if (st(sim, a).ATK > s.ATK) sim.addBuff(a, { id: 'deviated', stats: { atk: (0.16 + 0.004 * v) * s.HP }, turns: 2 });
        else sim.addBuff(a, { id: 'deviated', stats: { cd: 0.4 + 0.015 * v }, turns: 2 });
      },
      allyAction(sim, u, a, t) {
        const K = window.AVEffects.kits[1512];
        if (a.kind === 'countdown' || !(isAtk(t) || t === 'Summon')) return;
        const who = a.owner && a.kind === 'summon' ? a.owner : a;
        this.chords(sim, u, who);
        if (u.state.turnSeen !== sim.turnId) {
          u.state.turnSeen = sim.turnId;
          if (u.state.groove) F(sim, u, 3);
          if (E(u) >= 2 && K && K.vibes) K.vibes(sim, u, 2);
        }
      },
      damageDealt(sim, u, by, amt, label) {
        if (E(u) < 1 || !amt || /True/.test(label || '') || !by || (by.kind !== 'char' && !by.owner)) return;
        u.state.tally += amt;
      },
      dmgScale(sim, u, act, extra, unit) { return unit && unit.name === 'Summer Songbirds' ? 0.7 * (E(u) >= 6 ? 2 : 1) : 1; },
      extraDamage(sim, u, act, extra, unit) {
        if (!unit || unit.name !== 'Summer Songbirds' || E(u) < 1) return 0;
        const d = (0.11 + 0.001 * (u.state.vibes || 0)) * u.state.tally;
        u.state.tally *= 0.5;
        if (d > 0) sim.addDamage(u, d, 'True DMG');
        return 0;
      },
    },
    // ------------------------------------------------------------------ 1513 Aventurine • Waveflair
    1513: {
      desc: 'Party in Perfect Paradise: at 140+ SPD +30% Elation and +1% per SPD above 140 (max 200). Revel in Raging Tides: with other Elation allies, all allies +20% Elation and him +80% more. Sift Through Gilded Dreams: +48% CRIT DMG; a teammate\'s Basic / Skill / follow-up / Ultimate gives all allies +48% CRIT DMG for 3 turns (6 times per his Skill). "All In!" (his next Aha Elation Skill after "Cheers!"): +21% Elation DMG per Fervor it spends. E1: +24% RES PEN. E4: his Skill: allies ignore 18% DEF for 3 turns. E6: merrymakes 25%; from his 3rd Elation Skill on, all are "All In!" (outside Aha it keeps the Fervor).',
      battleStart(sim, u) {
        const sp = sim.spd(u), others = sim.allies(u).some((a) => a.cfg.char.path === 'Elation');
        self(sim, u, 'party', { elation: sp >= 140 ? 0.3 + 0.01 * Math.min(200, sp - 140) : 0, cd: 0.48, ...(E(u) >= 1 ? { resPen: 0.24 } : {}), ...(E(u) >= 6 ? { merrymake: 0.25 } : {}) }, Infinity);
        if (others) { team(sim, 'revel', { elation: 0.2 }, Infinity); self(sim, u, 'revelSelf', { elation: 0.8 }, Infinity); }
        u.state.sift2 = 6; u.state.elations = 0;
      },
      snapF(u) { u.state.fervorSnap = u.state.fervor || 0; },
      action(sim, u, t) {
        if (t === 'Skill') { u.state.sift2 = 6; if (E(u) >= 4) team(sim, 'waveE4', { defIgnore: 0.18 }, 3); }
        this.snapF(u);
      },
      ult(sim, u) { this.snapF(u); },
      allyAttack(sim, u, a, t) {
        if (a.kind === 'char' && ['Basic', 'Skill', 'FollowUp', 'Ult', 'Enhanced'].includes(t) && u.state.sift2 > 0) { u.state.sift2 -= 1; team(sim, 'sift', { cd: 0.48 }, 3); }
        this.snapF(u);
      },
      elation(sim, u, info) {
        u.state.elations += 1;
        const allIn = (sim.inAha && u.state.allIn) || (E(u) >= 6 && u.state.elations > 2);
        u.state.allInNow = allIn ? u.state.fervorSnap || 0 : 0;
        if (allIn && sim.inAha) u.state.allIn = false;
        if (info && info.label === 'Cheers!') u.state.allIn = true;
        this.snapF(u);
      },
      extraDamage(sim, u, act, extra) {
        if (act !== 'Elation' || !(u.state.allInNow > 0)) return 0;
        const d = AD().elation(sim, u, 0.21 * u.state.allInNow, extra && extra.punchline != null ? extra.punchline : sim.punchline);
        u.state.allInNow = 0;
        return d;
      },
    },

    // ------------------------------------------------------------------ 8002 Trailblazer • Destruction
    8002: {
      desc: 'Ultimate: Blowout: RIP Home Run (blast) with 2+ enemies, else Blowout: Farewell Hit. Talent: +20% ATK per Weakness Break he causes (2 stacks); Tenacity: +10% DEF per stack. Fighting Will: Skill and RIP Home Run +25% DMG to the target. E4: +25% CRIT Rate vs Broken enemies.',
      battleStart(sim, u) { if (E(u) >= 4) self(sim, u, 'tbE4', { cr: (s) => 0.25 * s.brokenShare() }, Infinity); },
      dmgAbility(sim, u, act) { return act === 'Ult' ? (n(sim) >= 2 ? 'Blowout: RIP Home Run' : 'Blowout: Farewell Hit') : undefined; },
      weaknessBreak(sim, u, by) { if (by === u) self(sim, u, 'pickoff', { atkPct: 0.2, defPct: 0.1 }, Infinity, { maxStacks: 2 }); },
      dmgScale(sim, u, act) {
        const adj = Math.min(2, n(sim) - 1);
        if (act === 'Skill') return (1.25 + adj) / (1 + adj);
        if (act === 'Ult' && n(sim) >= 2) return (2.7 * 1.25 + 1.62 * adj) / (2.7 + 1.62 * adj);
        return 1;
      },
    },
    // ------------------------------------------------------------------ 8004 Trailblazer • Preservation
    8004: {
      desc: 'Magma Will: +1 per Basic ATK, Skill and hit taken (max 8; E4: starts with 4); at 4 the Basic ATK is Enhanced (blast, uses 4), and after his Ultimate the next one is Enhanced for free. Ultimate: 100% ATK + 150% DEF to all enemies. Action Beats Overthinking: his Talent shields keep him shielded, so from his 2nd turn on each turn starts with +15% ATK and +5 Energy. E1: Basic +25% DEF (Enhanced +50%) as extra DMG. E6: Enhanced Basic / Ultimate +10% DEF (3 stacks).',
      battleStart(sim, u) { u.state.will = E(u) >= 4 ? 4 : 0; u.state.shield = false; },
      hit(sim, u) { u.state.will = Math.min(8, u.state.will + 1); },
      turnStart(sim, u) { if (u.state.shield) { G(sim, u, 5); self(sim, u, 'actionBeats', { atkPct: 0.15 }, 1); } },
      actionType(sim, u) { return u.state.free || u.state.will >= 4 ? 'Enhanced' : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? -1 : undefined; },
      action(sim, u, t) {
        if (t === 'Enhanced') { if (u.state.free) u.state.free = false; else u.state.will -= 4; }
        if (t === 'Basic' || t === 'Skill') u.state.will = Math.min(8, u.state.will + 1);
        if (['Basic', 'Skill', 'Enhanced'].includes(t)) u.state.shield = true;
      },
      ult(sim, u) { u.state.free = true; u.state.shield = true; },
      afterDamage(sim, u, act) { if (E(u) >= 6 && (act === 'Enhanced' || act === 'Ult')) self(sim, u, 'tbPresE6', { defPct: 0.1 }, Infinity, { maxStacks: 3 }); },
      extraDamage(sim, u, act) {
        if (E(u) < 1) return 0;
        if (act === 'Basic') return std(sim, u, { def: 0.25 }, 'Basic');
        if (act === 'Enhanced') return std(sim, u, { def: 0.5 }, 'Basic');
        return 0;
      },
    },
    // ------------------------------------------------------------------ 8006 Trailblazer • Harmony
    8006: {
      desc: 'Hat of the Theater: allies breaking a Weakness delay that enemy 30%. Shuffle Along: the Skill\'s first hit deals double Toughness DMG. E1: first Skill refunds 1 SP. E4: teammates +15% of his Break Effect. E6: Skill +2 bounces.',
      battleStart(sim, u) {
        if (E(u) >= 4) sim.allies(u).forEach((a) => sim.addBuff(a, { id: 'tbHarmE4', stats: { be: 0.15 * (st(sim, u).be || 0) }, turns: Infinity }));
      },
      weaknessBreak(sim, u, by, e) { if (e && by && (by.kind === 'char' || by.owner)) sim.delay(e, 0.3); },
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const ab = AD().abilityFor(sim, u, 'Skill');
        if (ab && ab.tough && ab.tough.one) AD().applyToughness(sim, u, { tough: { one: ab.tough.one / 5 } }, u);
        if (E(u) >= 1 && !u.state.e1) { u.state.e1 = true; sim.gainSP(1, u); }
      },
      dmgScale(sim, u, act) { return act === 'Skill' && E(u) >= 6 ? 7 / 5 : 1; },
    },
    // ------------------------------------------------------------------ 8008 Trailblazer • Remembrance
    8008: {
      desc: 'Mem\'s Charge: 40% when first summoned, +1% per 10 Energy any ally regenerates, +10% per Skill / Enhanced Basic, +40% per Ultimate, +5% per "Baddies! Trouble!"; at 100% Mem acts at once with "Lemme! Help You!": the ability target (or the first teammate) advances 100% and gets Mem\'s Support for 3 turns: each DMG instance they deal adds 28% of it as True DMG (+2% per 10 Max Energy above 100, max 20%; E4: +6% for 0-Energy allies). Unfinished Epilogue: his Ultimate gives an Epic; with an Epic and Mem out, his Basic ATK is the Joint ATK "Together, We Script Tomorrow!". E1: supported allies +10% CRIT Rate. E6: Ultimate CRIT Rate 100%.',
      battleStart(sim, u) { u.state.charge = 0; u.state.epic = 0; u.state.lastE = 0; u.state.summoned = false; },
      mem(sim, u) { return sim.units.find((x) => x.owner === u && x.name === 'Mem' && x.alive); },
      energySync(sim, u) {
        const tot = sim.chars().reduce((a, c) => a + (c.energyTotal || 0), 0);
        this.charge(sim, u, (tot - u.state.lastE) / 1000);
        u.state.lastE = tot;
      },
      charge(sim, u, k) {
        if (!this.mem(sim, u)) return;
        u.state.charge += k;
        if (u.state.charge >= 1 && !u.state.supportPending) { u.state.supportPending = true; this.support(sim, u); }
      },
      support(sim, u) {
        const m = this.mem(sim, u);
        u.state.charge = 0; u.state.supportPending = false;
        const tg = (sim.targetOf(u) && sim.targetOf(u) !== u ? sim.targetOf(u) : sim.allies(u)[0]) || u;
        sim.record(m, 'FollowUp', { label: 'Lemme! Help You!' });
        sim.units.forEach((x) => sim.removeBuff(x, 'memSupport'));
        const extraPct = Math.min(0.2, 0.02 * Math.floor(Math.max(0, (tg.maxEnergy || 0) - 100) / 10)) + (E(u) >= 4 && !(tg.maxEnergy > 0) ? 0.06 : 0);
        sim.addBuff(tg, { id: 'memSupport', stats: E(u) >= 1 ? { cr: 0.1 } : {}, turns: 3, pct0: 0.28 + extraPct });
        if (tg !== u) sim.actNow(tg);
      },
      damageDealt(sim, u, by, amt, label) {
        if (!amt || /True/.test(label || '') || !by) return;
        const holder = by.buffs && by.buffs.find((b) => b.id === 'memSupport') || (E(u) >= 1 && by.owner && by.owner.buffs.find((b) => b.id === 'memSupport'));
        if (holder) sim.addDamage(by.kind === 'summon' ? by.owner : by, holder.pct0 * amt, 'True DMG (Mem)');
      },
      turnStart(sim, u) { this.energySync(sim, u); },
      allyAction(sim, u, a, t) {
        this.energySync(sim, u);
        if (a.name === 'Mem' && a.owner === u && t === 'Summon') this.charge(sim, u, 0.05);
      },
      actionType(sim, u) { return u.state.epic > 0 && this.mem(sim, u) ? 'Enhanced' : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? -1 : undefined; },
      action(sim, u, t) {
        if (t === 'Skill') {
          if (!u.state.summoned && this.mem(sim, u)) { u.state.summoned = true; this.charge(sim, u, 0.4); }
          else this.charge(sim, u, 0.1);
        }
        if (t === 'Enhanced') { u.state.epic -= 1; }
        this.energySync(sim, u);
      },
      afterDamage(sim, u, act) { if (act === 'Enhanced') this.charge(sim, u, 0.1); },
      ult(sim, u) {
        u.state.epic = Math.min(2, u.state.epic + 1);
        if (!this.mem(sim, u)) { window.AVEffects.kits[8008].action(sim, u, 'Skill'); }
        if (!u.state.summoned) { u.state.summoned = true; this.charge(sim, u, 0.4); }
        this.charge(sim, u, 0.4);
        if (E(u) >= 6) self(sim, u, 'tbRemE6', { cr_Ult: 1 }, Infinity);
      },
    },
    // ------------------------------------------------------------------ 8010 Trailblazer • Elation
    8010: {
      desc: 'On Cloud Nine: +10% Elation per 200 ATK above 1000 (max 60%). Screw It, We Ball: +15% CRIT Rate. E1: each Skill makes his next Ultimate give the target 2 more Certified Banger (3 stacks). E2: Ultimate target +12% Elation for 2 turns. E4: his Elation Skill: enemies take +10% DMG for 2 turns. E6: his Elation Skill: +100% CRIT DMG for 3 turns.',
      battleStart(sim, u) {
        const atk = st(sim, u).ATK;
        self(sim, u, 'cloudNine', { elation: Math.min(0.6, 0.1 * Math.floor(Math.max(0, atk - 1000) / 200)), cr: 0.15 }, Infinity);
        u.state.e1 = 0;
      },
      action(sim, u, t) { if (t === 'Skill' && E(u) >= 1) u.state.e1 = Math.min(3, u.state.e1 + 1); },
      ult(sim, u) {
        const tg = sim.targetOf(u);
        if (tg && E(u) >= 1 && u.state.e1 && tg.cfg.char.combat.elationPid) sim.gainCB(tg, 2 * u.state.e1, { src: 'Trailblazer' });
        u.state.e1 = 0;
        if (tg && E(u) >= 2) sim.addBuff(tg, { id: 'tbElE2', stats: { elation: 0.12 }, turns: 2 });
      },
      elation(sim, u) {
        if (E(u) >= 4) emod(sim, 'tbElE4', { vuln: 0.1 }, 2);
        if (E(u) >= 6) self(sim, u, 'tbElE6', { cd: 1 }, 3);
      },
    },
  };

  window.AVAuditKits = kits;
})();
