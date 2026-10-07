// Light cone audit layer: each light cone's Energy, SP, turn order and damage effects (with
// their durations) that effects.js (SPD) and the data's static stats don't already cover.
// Values come from the cone's superimposition params via L(u, index). Same conventions as
// kits-audit.js: HP-threshold conditions count at half value, kills aren't simulated.
(function () {
  const AD = () => window.AVDamage;
  const st = (sim, u) => AD().liveStats(sim, u);
  const std = (sim, u, mult, type) => AD().standard(sim, u, mult, 0, type);
  const L = (u, i) => u.cfg.lc.params[(u.cfg.lcS || 1) - 1][i];
  const G = (sim, u, n) => sim.gainEnergy(u, n);
  const F = (sim, u, n) => sim.gainEnergy(u, n, { fixed: true });
  const self = (sim, u, id, stats, turns, extra = {}) => sim.addBuff(u, { id, stats, turns, ...extra });
  const team = (sim, id, stats, turns, extra = {}) => sim.chars().forEach((a) => sim.addBuff(a, { id, stats, turns, ...extra }));
  const emod = (sim, id, props, turns) => sim.addEnemyMod({ id, turns, ...props });
  const isAtk = (t) => ['Basic', 'Skill', 'Enhanced', 'Extra', 'Final', 'Ult', 'FollowUp', 'Assist'].includes(t);
  const HALF = 0.5;
  // Characters whose own abilities consume their HP.
  const HP_USERS = new Set(['1205', '1404', '1310', '1407', '1413', '1408', '1507']);
  const healerOnTeam = (sim) => sim.chars().some((a) => ['Abundance', 'Preservation'].includes(a.cfg.char.path));

  const lc = {
    // ================================================================ Abundance
    20001: { desc: 'Outgoing Healing only (not simulated).' },
    20008: { desc: 'Battle start: all allies regenerate Energy.', battleStart(sim, u) { sim.chars().forEach((a) => G(sim, a, L(u, 0))); } },
    21000: { desc: 'Outgoing Healing only (not simulated).' },
    21007: { desc: 'Skill: all allies regenerate Energy.', action(sim, u, t) { if (t === 'Skill') sim.chars().forEach((a) => G(sim, a, L(u, 1))); } },
    21014: { desc: 'Outgoing Healing only (not simulated).' },
    21021: {
      desc: 'Turn start: the teammate with the lowest Energy, if below 50%, regenerates Energy.',
      turnStart(sim, u) {
        const a = sim.allies(u).filter((x) => x.maxEnergy > 0 && x.energy < x.maxEnergy * L(u, 0)).sort((x, y) => x.energy / x.maxEnergy - y.energy / y.maxEnergy)[0];
        if (a) G(sim, a, L(u, 1));
      },
    },
    21028: { desc: 'Healing only (not simulated).' },
    21035: { desc: 'Self-healing only (not simulated).' },
    21048: { desc: 'Attacking while an enemy is Broken: +Energy (2 per turn).', turnStart(sim, u) { u.state.lc21048 = 0; }, action(sim, u, t) { if (isAtk(t) && sim.brokenShare() > 0 && (u.state.lc21048 || 0) < L(u, 2)) { u.state.lc21048 = (u.state.lc21048 || 0) + 1; G(sim, u, L(u, 1)); } } },
    21055: { desc: '+DMG while allies are at 50%+ HP (assumed).', battleStart(sim, u) { self(sim, u, 'lc21055', { dmg: L(u, 2) }, Infinity); } },
    22001: { desc: 'Outgoing Healing only (not simulated).' },
    23008: { desc: 'After attacking: +Energy per enemy hit (max 3).', action(sim, u, t) { if (isAtk(t)) G(sim, u, L(u, 2) * Math.min(L(u, 3), sim.targetsHit(u, t))); } },
    23013: {
      desc: 'Records her healing (Skill / Ultimate: ~12% Max HP to each ally); each ally attack (once per turn) deals that × the multiplier as Additional DMG, unaffected by buffs.',
      action(sim, u, t) { if (t === 'Skill' || t === 'Ult') { const s = st(sim, u); u.state.lc23013 = 0.12 * s.HP * (1 + (s.heal || 0)) * sim.chars().length; } },
      ult(sim, u) { this.action(sim, u, 'Ult'); },
      allyAttack(sim, u, a) {
        if (!u.state.lc23013 || u.state.lc23013Turn === sim.turnId) return;
        u.state.lc23013Turn = sim.turnId;
        sim.addDamage(u, L(u, 2) * u.state.lc23013, 'Additional (LC)');
      },
    },
    23017: {
      desc: 'Her heals (Skill / Ultimate) give allies +ATK for 2 turns (5 stacks); ally Ultimates heal the lowest-HP ally (first teammate assumed) for a stack too.',
      action(sim, u, t) { if (t === 'Skill') team(sim, 'lc23017', { atkPct: L(u, 2) }, 2, { maxStacks: L(u, 3) }); },
      ult(sim, u) { team(sim, 'lc23017', { atkPct: L(u, 2) }, 2, { maxStacks: L(u, 3) }); },
      allyUlt(sim, u) { const a = sim.allies(u)[0]; if (a) sim.addBuff(a, { id: 'lc23017', stats: { atkPct: L(u, 2) }, turns: 2, maxStacks: L(u, 3) }); },
    },
    23032: {
      desc: 'Ultimate attacks: Woefree, enemies take +DMG for 2 turns (more at 150% Break Effect).',
      afterDamage(sim, u, act) { if (act === 'Ult') emod(sim, 'woefree', { vuln: L(u, 1) + ((st(sim, u).be || 0) >= L(u, 2) ? L(u, 3) : 0) }, 2); },
    },
    // ================================================================ Destruction
    20002: { desc: 'Basic ATK and Skill +DMG.', battleStart(sim, u) { self(sim, u, 'lc20002', { dmg_Basic: L(u, 0), dmg_Skill: L(u, 0) }, Infinity); } },
    20009: { desc: '+DMG vs enemies above 50% HP (half).', battleStart(sim, u) { self(sim, u, 'lc20009', { dmg: L(u, 1) * HALF }, Infinity); } },
    20016: { desc: '+CRIT Rate below 80% HP (half).', battleStart(sim, u) { self(sim, u, 'lc20016', { cr: L(u, 1) * HALF }, Infinity); } },
    21005: { desc: 'Basic ATK / Skill / Ultimate attacks: +ATK per stack (3).', action(sim, u, t) { if (['Basic', 'Skill', 'Enhanced'].includes(t)) self(sim, u, 'lc21005', { atkPct: L(u, 0) }, Infinity, { maxStacks: 3 }); }, ult(sim, u) { self(sim, u, 'lc21005', { atkPct: L(u, 0) }, Infinity, { maxStacks: 3 }); } },
    21012: { desc: '+DMG vs enemies at or above her HP % (half).', battleStart(sim, u) { self(sim, u, 'lc21012', { dmg: L(u, 1) * HALF }, Infinity); } },
    21019: { desc: 'On-kill CRIT Rate (kills aren\'t simulated).' },
    21026: { desc: '+DMG (and DoT) vs Burned / Bleeding enemies.', battleStart(sim, u) { self(sim, u, 'lc21026', { dmg: (s) => ((s.dots || []).length ? L(u, 1) : 0) }, Infinity); } },
    21033: { desc: 'On-kill healing (not simulated).' },
    21038: {
      desc: 'Consuming 25%+ Max HP (HP-spending characters\' Skills) or being hit hard: +DMG for 2 turns, once per 3 turns.',
      turnStart(sim, u) { if (u.state.lc21038cd > 0) u.state.lc21038cd -= 1; },
      action(sim, u, t) {
        if (u.state.lc21038cd > 0 || !(HP_USERS.has(u.cfg.char.id) && (t === 'Skill' || t === 'Enhanced'))) return;
        u.state.lc21038cd = L(u, 4);
        self(sim, u, 'lc21038', { dmg: L(u, 0) }, L(u, 3));
      },
    },
    21042: { desc: 'Ultimate: +CRIT Rate for 2 turns.', ult(sim, u) { self(sim, u, 'lc21042', { cr: L(u, 1) }, L(u, 2)); } },
    21058: { desc: 'Skill and Ultimate +DMG.', battleStart(sim, u) { self(sim, u, 'lc21058', { dmg_Skill: L(u, 1), dmg_Ult: L(u, 1) }, Infinity); } },
    22003: {
      desc: 'Losing or restoring HP: +CRIT DMG for 2 turns (when hit, using HP, or healed by a teammate).',
      buff(sim, u) { self(sim, u, 'lc22003', { cd: L(u, 1) }, L(u, 2)); },
      hit(sim, u) { this.buff(sim, u); },
      action(sim, u) { if (HP_USERS.has(u.cfg.char.id) || healerOnTeam(sim)) this.buff(sim, u); },
    },
    23002: { desc: 'When hit: +DMG until the end of her next turn.', hit(sim, u) { self(sim, u, 'lc23002', { dmg: L(u, 2) }, 1); } },
    23009: {
      desc: 'When attacked or spending HP: +DMG, removed after her next attack.',
      hit(sim, u) { self(sim, u, 'lc23009', { dmg: L(u, 2) }, Infinity); },
      action(sim, u, t) { if (HP_USERS.has(u.cfg.char.id) && (t === 'Skill' || t === 'Enhanced')) self(sim, u, 'lc23009', { dmg: L(u, 2) }, Infinity); },
      afterDamage(sim, u, act) { if (isAtk(act)) sim.removeBuff(u, 'lc23009'); },
    },
    23014: {
      desc: 'Eclipse: +1 when a teammate is hit (max 3); her next attack +DMG per stack, at 3 also ignores DEF.',
      allyHit(sim, u, v) {
        if (v.kind !== 'char') return;
        const b = self(sim, u, 'lc23014', { dmg: L(u, 2) }, Infinity, { maxStacks: L(u, 1) });
        if (b && b.stacks >= L(u, 1)) self(sim, u, 'lc23014def', { defIgnore: L(u, 3) }, Infinity);
      },
      afterDamage(sim, u, act) { if (isAtk(act)) { sim.removeBuff(u, 'lc23014'); sim.removeBuff(u, 'lc23014def'); } },
    },
    23015: { desc: 'Basic ATK: Dragon\'s Call (2 stacks, 2 turns): +ATK and +Energy Regeneration Rate.', action(sim, u, t) { if (t === 'Basic' || t === 'Enhanced') self(sim, u, 'lc23015', { atkPct: L(u, 3), err: L(u, 4) }, L(u, 2), { maxStacks: L(u, 1) }); } },
    23025: {
      desc: 'Breaking an enemy: Routed for 2 turns: +Break DMG taken from the wearer, −SPD.',
      weaknessBreak(sim, u, by) { if (by !== u) return; emod(sim, 'routed', { vulnType: { Break: L(u, 1) } }, L(u, 3)); sim.slowEnemies('routed', L(u, 2), L(u, 3), 'main'); },
    },
    23030: { desc: 'Higher aggro. Ultimate: Firedance (2 stacks, 2 turns): +Follow-up DMG.', tauntMult() { return 5; }, ult(sim, u) { self(sim, u, 'lc23030', { dmg_FUA: L(u, 2) }, L(u, 1), { maxStacks: 2 }); } },
    23039: {
      desc: 'Skill / Ultimate spend 6% Max HP: that attack +DMG (doubled if more than 500 HP).',
      boost(sim, u) { const hp = st(sim, u).HP; self(sim, u, 'lc23039', { dmg: L(u, 2) + (hp * L(u, 1) > L(u, 3) ? L(u, 4) : 0) }, Infinity); },
      action(sim, u, t) { if (t === 'Skill' || t === 'Enhanced') this.boost(sim, u); },
      ult(sim, u) { this.boost(sim, u); },
      afterDamage(sim, u) { sim.removeBuff(u, 'lc23039'); },
    },

    23044: {
      desc: 'Ignores DEF. After Ultimate: Blazing Sun (+DMG) until her next turn starts.',
      battleStart(sim, u) { self(sim, u, 'lc23044', { defIgnore: L(u, 1) }, Infinity); },
      ult(sim, u) { self(sim, u, 'blazingSun', { dmg: L(u, 2) }, Infinity); },
      turnStart(sim, u) { sim.removeBuff(u, 'blazingSun'); },
    },
    23045: {
      desc: 'Ultimate: +ATK for 2 turns; at 300+ Max Energy also 10% of it back as fixed Energy and +ATK again.',
      ult(sim, u) {
        const big = u.maxEnergy >= L(u, 2);
        self(sim, u, 'lc23045', { atkPct: L(u, 1) + (big ? L(u, 5) : 0) }, L(u, 3));
        if (big) F(sim, u, L(u, 4) * u.maxEnergy);
      },
    },
    23062: {
      desc: 'Ultimate: +0.2% Ultimate DMG per Energy spent (max 72%). Battle start and Ultimate: King\'s Entertainment, all allies +CRIT DMG for 3 turns.',
      battleStart(sim, u) { team(sim, 'kingsEntertainment', { cd: L(u, 4) }, L(u, 3)); },
      ult(sim, u, info) {
        team(sim, 'kingsEntertainment', { cd: L(u, 4) }, L(u, 3));
        self(sim, u, 'lc23062', { dmg_Ult: Math.min(L(u, 5), L(u, 2) * ((info && info.spent) || 0)) }, Infinity);
      },
      afterDamage(sim, u, act) { if (act === 'Ult') sim.removeBuff(u, 'lc23062'); },
    },
    24000: {
      desc: 'Each attack: +ATK (4 stacks, whole battle). Breaking a Weakness: +DMG for 2 turns.',
      action(sim, u, t) { if (isAtk(t)) self(sim, u, 'lc24000', { atkPct: L(u, 0) }, Infinity, { maxStacks: L(u, 1) }); },
      ult(sim, u) { self(sim, u, 'lc24000', { atkPct: L(u, 0) }, Infinity, { maxStacks: L(u, 1) }); },
      weaknessBreak(sim, u, by) { if (by === u) self(sim, u, 'lc24000b', { dmg: L(u, 2) }, L(u, 3)); },
    },
    // ================================================================ Elation
    20023: { desc: '+Elation during Aha Instants.', battleStart(sim, u) { self(sim, u, 'lc20023', { elation: (s) => (s.inAha ? L(u, 0) : 0) }, Infinity); } },
    20024: { desc: '+CRIT DMG at 10+ Punchline.', battleStart(sim, u) { self(sim, u, 'lc20024', { cd: (s) => (s.punchline >= L(u, 0) ? L(u, 1) : 0) }, Infinity); } },
    21064: { desc: 'Elation Skill: enemies take +Elation DMG for 2 turns.', elation(sim, u) { emod(sim, 'lc21064', { vulnType: { Elation: L(u, 1) } }, L(u, 2)); } },
    21065: { desc: 'Elation Skill: +Elation (2 stacks).', elation(sim, u) { self(sim, u, 'lc21065', { elation: L(u, 1) }, Infinity, { maxStacks: L(u, 2) }); } },
    21066: { desc: 'Elation Skills ignore DEF.', battleStart(sim, u) { self(sim, u, 'lc21066', { defIgnore_Elation: L(u, 1) }, Infinity); } },
    22007: { desc: 'Ultimate: all allies +Elation for 1 turn.', ult(sim, u) { team(sim, 'lc22007', { elation: L(u, 1) }, L(u, 2)); } },
    23053: {
      desc: '+1 max SP per Elation character (max 3). Each SP she spends: her Elation DMG ignores 5% DEF (4 stacks). Spending 4+ SP in one turn: Stream Promo, all allies +Elation.',
      battleStart(sim, u) { sim.spMax += Math.min(L(u, 2), sim.chars().filter((a) => a.cfg.char.path === 'Elation').length * L(u, 1)); },
      spUsed(sim, u, by, k) {
        if (by !== u) return;
        for (let i = 0; i < k; i++) self(sim, u, 'lc23053', { defIgnore_Elation: L(u, 5) }, Infinity, { maxStacks: L(u, 6) });
        if (u.state.lc23053Turn !== sim.turnId) { u.state.lc23053Turn = sim.turnId; u.state.lc23053Sp = 0; }
        u.state.lc23053Sp += k;
        if (u.state.lc23053Sp >= L(u, 4)) team(sim, 'streamPromo', { elation: L(u, 3) }, Infinity);
      },
    },
    23054: {
      desc: 'Battle start (+15 fixed Energy) and Ultimate on an ally: Great Fortune for 3 turns: all allies +CRIT Rate and +CRIT DMG, her Energy Regeneration Rate +12%.',
      fortune(sim, u) { team(sim, 'greatFortune', { cr: L(u, 1), cd: L(u, 2) }, L(u, 3), { tick: 'owner', owner: u }); self(sim, u, 'greatFortuneErr', { err: L(u, 4) }, L(u, 3)); },
      battleStart(sim, u) { this.fortune(sim, u); F(sim, u, L(u, 5)); },
      ult(sim, u) { if (sim.targetOf(u)) this.fortune(sim, u); },
    },
    23055: { desc: 'Elation Skill: enemies take +DMG for 3 turns; +10 fixed Energy.', elation(sim, u) { emod(sim, 'lc23055', { vuln: L(u, 3) }, L(u, 2)); F(sim, u, L(u, 1)); } },
    23057: {
      desc: 'Elation DMG ignores DEF. Ultimate on herself: +20 Punchline (again after 3 Basic ATKs).',
      battleStart(sim, u) { self(sim, u, 'lc23057', { defIgnore_Elation: L(u, 1) }, Infinity); u.state.lc23057 = true; u.state.lc23057b = 0; },
      ult(sim, u) { const tg = sim.targetOf(u); if (u.state.lc23057 && (!tg || tg === u)) { u.state.lc23057 = false; sim.addPunchline(L(u, 2), u); } },
      action(sim, u, t) { if (t === 'Basic' && !u.state.lc23057 && ++u.state.lc23057b >= L(u, 3)) { u.state.lc23057 = true; u.state.lc23057b = 0; } },
    },
    23058: {
      desc: '+10% Energy Regeneration Rate, +0.3% per 10 Max Energy above 120 (max 360). Elation Skill: enemies take +DMG for 2 turns.',
      battleStart(sim, u) { self(sim, u, 'lc23058', { err: L(u, 3) + L(u, 5) * Math.floor(Math.min(L(u, 6), Math.max(0, u.maxEnergy - L(u, 4))) / 10) }, Infinity); },
      elation(sim, u) { emod(sim, 'lc23058', { vuln: L(u, 1) }, L(u, 2)); },
    },
    23064: {
      desc: 'Elation Skill: Updraft +SPD (3 turns); a different Elation Skill than last time also gives Uptrend +Elation. +1 SP at battle start and every 3 Elation Skills.',
      battleStart(sim, u) { sim.gainSP(1, u); u.state.lc23064 = 0; },
      elation(sim, u, info) {
        sim.addBuff(u, { id: 'updraft', pct: L(u, 1), turns: L(u, 3) });
        const kind = (info && info.label) || 'Elation';
        if (u.state.lc23064Last && u.state.lc23064Last !== kind) self(sim, u, 'uptrend', { elation: L(u, 2) }, L(u, 3));
        u.state.lc23064Last = kind;
        if (++u.state.lc23064 >= 3) { u.state.lc23064 = 0; sim.gainSP(1, u); }
      },
    },
    24006: {
      desc: 'Skill / Ultimate on an ally: the target +Elation for 2 turns.',
      give(sim, u) { const tg = sim.targetOf(u); if (tg && tg !== u) sim.addBuff(tg, { id: 'lc24006', stats: { elation: L(u, 1) }, turns: L(u, 2) }); },
      action(sim, u, t) { if (t === 'Skill') this.give(sim, u); },
      ult(sim, u) { this.give(sim, u); },
    },
    // ================================================================ Erudition
    20006: { desc: 'Ultimate +DMG.', battleStart(sim, u) { self(sim, u, 'lc20006', { dmg_Ult: L(u, 0) }, Infinity); } },
    20013: { desc: 'Skill: +Energy (once per turn).', action(sim, u, t) { if (t === 'Skill' && u.state.lc20013 !== sim.turnId) { u.state.lc20013 = sim.turnId; G(sim, u, L(u, 0)); } } },
    20020: { desc: 'Ultimate: +ATK for 2 turns.', ult(sim, u) { self(sim, u, 'lc20020', { atkPct: L(u, 0) }, L(u, 1)); } },
    21006: { desc: 'Follow-up +DMG (more vs enemies at ≤50% HP, half).', battleStart(sim, u) { self(sim, u, 'lc21006', { dmg_FUA: L(u, 0) + L(u, 2) * HALF }, Infinity); } },
    21013: { desc: 'Battle start +Energy; Ultimate +DMG.', battleStart(sim, u) { G(sim, u, L(u, 1)); self(sim, u, 'lc21013', { dmg_Ult: L(u, 0) }, Infinity); } },
    21020: { desc: 'On-kill CRIT DMG (kills aren\'t simulated).' },
    21027: { desc: 'On-kill ATK (kills aren\'t simulated).' },
    21034: { desc: '+DMG per point of Max Energy (max 160).', battleStart(sim, u) { self(sim, u, 'lc21034', { dmg: L(u, 0) * Math.min(L(u, 1), u.maxEnergy || 0) }, Infinity); } },
    21040: { desc: 'Attacks hitting 2+ enemies (assumed weak): +CRIT DMG for 2 turns.', action(sim, u, t) { if (isAtk(t) && sim.targetsHit(u, t) >= 2) self(sim, u, 'lc21040', { cd: L(u, 1) }, L(u, 2)); }, ult(sim, u) { if (sim.targetsHit(u, 'Ult') >= 2) self(sim, u, 'lc21040', { cd: L(u, 1) }, L(u, 2)); } },
    21060: { desc: 'Ultimate and Follow-up +DMG.', battleStart(sim, u) { self(sim, u, 'lc21060', { dmg_Ult: L(u, 1), dmg_FUA: L(u, 1) }, Infinity); } },
    22004: { desc: '+DMG per enemy Weakness Type (3 assumed; 7 with Anaxa implanting).', battleStart(sim, u) { const k = sim.chars().some((a) => a.cfg.char.id === '1405') ? 7 : 3; self(sim, u, 'lc22004', { dmg: L(u, 1) * k }, Infinity); } },
    23000: { desc: '+ATK per enemy (max 5). Any Weakness Break: +DMG for 1 turn.', battleStart(sim, u) { self(sim, u, 'lc23000', { atkPct: L(u, 1) * Math.min(5, Math.max(1, sim.enemyCount || 1)) }, Infinity); }, weaknessBreak(sim, u) { self(sim, u, 'lc23000b', { dmg: L(u, 0) }, 1); } },
    23010: {
      desc: 'Skill and Ultimate +DMG. After Skill / Ultimate: Somnus Corpus, the next follow-up +DMG.',
      battleStart(sim, u) { self(sim, u, 'lc23010', { dmg_Skill: L(u, 1), dmg_Ult: L(u, 1) }, Infinity); },
      afterDamage(sim, u, act) { if (act === 'Skill' || act === 'Ult') self(sim, u, 'somnus', { dmg_FUA: L(u, 2) }, Infinity); },
      followUpDone(sim, u) { sim.removeBuff(u, 'somnus'); },
    },
    23018: { desc: 'Ultimate +DMG per point of Max Energy (max 180).', battleStart(sim, u) { self(sim, u, 'lc23018', { dmg_Ult: L(u, 1) * Math.min(L(u, 2), u.maxEnergy || 0) }, Infinity); } },
    23028: {
      desc: 'Follow-up +DMG per 20% CRIT DMG above 120% (4 stacks). Battle start and after Basic ATK: Ultimate / Follow-up ignore DEF for 2 turns.',
      battleStart(sim, u) {
        const cd = (st(sim, u).cd || 0);
        self(sim, u, 'lc23028', { dmg_FUA: L(u, 3) * Math.min(L(u, 4), Math.floor(Math.max(0, cd - L(u, 1)) / L(u, 2))) }, Infinity);
        self(sim, u, 'lc23028b', { defIgnore_Ult: L(u, 5), defIgnore_FUA: L(u, 5) }, L(u, 6));
      },
      action(sim, u, t) { if (t === 'Basic') self(sim, u, 'lc23028b', { defIgnore_Ult: L(u, 5), defIgnore_FUA: L(u, 5) }, L(u, 6)); },
    },
    23033: { desc: 'Battle start: +Energy.', battleStart(sim, u) { G(sim, u, L(u, 1)); } },
    23037: {
      desc: 'Ultimate: Skill and Ultimate +DMG for 3 turns; an Ultimate costing 140+ Energy recovers 1 SP.',
      ult(sim, u, info) { self(sim, u, 'lc23037', { dmg_Skill: L(u, 3), dmg_Ult: L(u, 3) }, L(u, 4)); if (info && info.spent >= L(u, 2)) sim.gainSP(1, u); },
    },
    23041: {
      desc: 'Turn start: +10 Energy. Her attacks: −12% DEF for 2 turns. +DMG vs Weaknesses she implanted (Anaxa / The Dahlia / Silver Wolf / Boothill).',
      battleStart(sim, u) { if (['1405', '1321', '1006', '1315', '1506'].includes(u.cfg.char.id)) self(sim, u, 'lc23041', { dmg: L(u, 2) }, Infinity); },
      turnStart(sim, u) { G(sim, u, L(u, 4)); },
      afterDamage(sim, u, act) { if (isAtk(act)) emod(sim, 'lc23041', { def: L(u, 1) }, L(u, 3)); },
    },
    23060: {
      desc: 'Ignores DEF. Assist Skill: +6 Energy and Sail (3 stacks, 2 turns): +Assist Skill DMG; at 3 stacks also +Ultimate DMG.',
      battleStart(sim, u) { self(sim, u, 'lc23060', { defIgnore: L(u, 6) }, Infinity); },
      action(sim, u, t) {
        if (t !== 'Assist') return;
        G(sim, u, L(u, 1));
        const b = self(sim, u, 'sail', { dmg_Assist: L(u, 3) }, L(u, 2), { maxStacks: L(u, 4) });
        if (b && b.stacks >= L(u, 4)) self(sim, u, 'sailUlt', { dmg_Ult: L(u, 5) * L(u, 4) }, L(u, 2));
      },
    },
    23061: {
      desc: 'Any ally spending 4+ SP in one turn: Radiant Crown for 3 turns: all allies ignore DEF, her Skill +DMG.',
      spUsed(sim, u, by, k) {
        if (u.state.lc23061Turn !== sim.turnId) { u.state.lc23061Turn = sim.turnId; u.state.lc23061Sp = 0; }
        u.state.lc23061Sp += k;
        if (u.state.lc23061Sp >= L(u, 2)) { team(sim, 'radiantCrown', { defIgnore: L(u, 4) }, L(u, 3), { tick: 'owner', owner: u }); self(sim, u, 'radiantSkill', { dmg_Skill: L(u, 1) }, L(u, 3)); }
      },
    },
  };

  window.AVLightConeKits = lc;
})();
