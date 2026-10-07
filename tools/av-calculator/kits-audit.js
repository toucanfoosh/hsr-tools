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
      shocked(sim, u) { return (sim.dots || []).some((d) => d.src === u); },
      ult(sim, u) {
        (sim.dots || []).filter((d) => d.src === u).forEach((d) => { d.turns += 2; });
        if (E(u) >= 4 && !this.shocked(sim, u)) sim.addDot({ id: `${u.key}:Lightning Flash`, src: u, mult: { atk: 1.04 }, turns: 2 });
      },
      extraDamage(sim, u, act) {
        let d = 0;
        if (isAtk(act) && this.shocked(sim, u)) { d += std(sim, u, { atk: 0.72 }) * Math.min(3, n(sim)); if (E(u) >= 2) G(sim, u, 4); }
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
  };

  window.AVAuditKits = kits;
})();
