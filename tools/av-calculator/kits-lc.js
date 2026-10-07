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

    24004: {
      desc: 'After attacking: +ATK per enemy hit (max 5) until the next attack; hitting 3+ enemies also gives +SPD for 1 turn.',
      afterDamage(sim, u, act) {
        if (!isAtk(act)) return;
        const k = sim.targetsHit(u, act);
        sim.removeBuff(u, 'lc24004');
        self(sim, u, 'lc24004', { atkPct: L(u, 1) * Math.min(5, k) }, Infinity);
        if (k >= L(u, 2)) sim.addBuff(u, { id: 'lc24004spd', pct: L(u, 3), turns: L(u, 4) });
      },
    },
    // ================================================================ Harmony
    20005: { desc: 'All allies +ATK.', battleStart(sim, u) { team(sim, 'lc20005', { atkPct: L(u, 0) }, Infinity); } },
    20012: {
      desc: 'Attacking or being hit: +Energy (once per turn).',
      once(sim, u) { if (u.state.lc20012 !== sim.turnId) { u.state.lc20012 = sim.turnId; G(sim, u, L(u, 0)); } },
      action(sim, u, t) { if (isAtk(t)) this.once(sim, u); },
      hit(sim, u) { this.once(sim, u); },
    },
    21004: { desc: 'Attacking: +Energy (once per turn).', action(sim, u, t) { if (isAtk(t) && u.state.lc21004 !== sim.turnId) { u.state.lc21004 = sim.turnId; G(sim, u, L(u, 1)); } } },
    21011: { desc: 'Allies of her Type +DMG.', battleStart(sim, u) { sim.chars().filter((a) => a.cfg.char.element === u.cfg.char.element).forEach((a) => sim.addBuff(a, { id: 'lc21011', stats: { dmg: L(u, 0) }, turns: Infinity })); } },
    21025: {
      desc: 'Skill: the next ally to act gets +DMG for 1 turn.',
      action(sim, u, t) { if (t === 'Skill') u.state.lc21025 = true; },
      allyTurnStart(sim, u, a) { if (u.state.lc21025 && a.kind === 'char') { u.state.lc21025 = false; sim.addBuff(a, { id: 'lc21025', stats: { dmg: L(u, 0) }, turns: L(u, 1) }); } },
    },
    21032: {
      desc: 'Battle start and each of her turns: rotates all allies between +ATK, +CRIT DMG and +Energy Regeneration Rate.',
      KINDS: ['atkPct', 'cd', 'err'],
      roll(sim, u) {
        u.state.lc21032 = ((u.state.lc21032 ?? -1) + 1) % 3;
        const k = this.KINDS[u.state.lc21032];
        sim.units.forEach((x) => sim.removeBuff(x, 'lc21032'));
        team(sim, 'lc21032', { [k]: L(u, u.state.lc21032) }, Infinity);
      },
      battleStart(sim, u) { this.roll(sim, u); },
      turnStart(sim, u) { this.roll(sim, u); },
    },
    21036: {
      desc: 'Childishness: all allies +DMG for the ability type she last used (Basic ATK / Skill / Ultimate).',
      give(sim, u, type) { sim.units.forEach((x) => sim.removeBuff(x, 'childishness')); team(sim, 'childishness', { [`dmg_${type}`]: L(u, 0) }, Infinity); },
      action(sim, u, t) { if (t === 'Basic' || t === 'Skill') this.give(sim, u, t); },
      ult(sim, u) { this.give(sim, u, 'Ult'); },
    },
    21046: {
      desc: 'Characters sharing a Path with another ally: +CRIT DMG.',
      battleStart(sim, u) { const cs = sim.chars(); cs.filter((a) => cs.filter((b) => b.cfg.char.path === a.cfg.char.path).length >= 2).forEach((a) => sim.addBuff(a, { id: 'lc21046', stats: { cd: L(u, 1) }, turns: Infinity })); },
    },
    21056: { desc: 'All allies +Break DMG.', battleStart(sim, u) { team(sim, 'lc21056', { breakDmg: L(u, 0) }, Infinity); } },
    22002: { desc: 'Ultimate: +DMG for 1 turn.', ult(sim, u) { self(sim, u, 'lc22002', { dmg: L(u, 1) }, L(u, 2)); } },
    22005: { desc: 'Skill: +ATK (3 stacks).', action(sim, u, t) { if (t === 'Skill') self(sim, u, 'lc22005', { atkPct: L(u, 1) }, Infinity, { maxStacks: L(u, 2) }); } },
    23003: {
      desc: 'Ultimate on an ally: +1 SP (every other Ultimate). Skill: the next ally to act gets +DMG for 1 turn.',
      ult(sim, u) { if (!sim.targetOf(u)) return; u.state.lc23003 = (u.state.lc23003 || 0) + 1; if (u.state.lc23003 % 2 === 1) sim.gainSP(1, u); },
      action(sim, u, t) { if (t === 'Skill') u.state.lc23003n = true; },
      allyTurnStart(sim, u, a) { if (u.state.lc23003n && a.kind === 'char') { u.state.lc23003n = false; sim.addBuff(a, { id: 'lc23003', stats: { dmg: L(u, 1) }, turns: L(u, 2) }); } },
    },
    23019: {
      desc: 'Battle start: all allies +10 Energy. Ultimate: all allies +DMG for 3 turns; at 150% Break Effect also +1 SP.',
      battleStart(sim, u) { sim.chars().forEach((a) => G(sim, a, L(u, 4))); },
      ult(sim, u) { team(sim, 'lc23019', { dmg: L(u, 1) }, L(u, 2)); if ((st(sim, u).be || 0) >= L(u, 3)) sim.gainSP(1, u); },
    },
    23021: {
      desc: 'Mask (battle start, 3 turns; again for 4 turns after every 4 SP she recovers): teammates +CRIT Rate and +CRIT DMG.',
      mask(sim, u, turns) { sim.allies(u).forEach((a) => sim.addBuff(a, { id: 'mask', stats: { cr: L(u, 4), cd: L(u, 1) }, turns, tick: 'owner', owner: u })); },
      battleStart(sim, u) { u.state.flame = 0; this.mask(sim, u, L(u, 5)); },
      spGained(sim, u, by, gained, over) {
        if (by !== u) return;
        u.state.flame += (gained || 0) + (over || 0);
        while (u.state.flame >= L(u, 2)) { u.state.flame -= L(u, 2); this.mask(sim, u, L(u, 3)); }
      },
    },
    23026: {
      desc: 'Each ally attack: Cantillation, +Energy Regeneration Rate (5 stacks). Ultimate: Cadenza for 1 turn: +ATK, all allies +DMG.',
      allyAttack(sim, u, a) { if (a.kind === 'char') self(sim, u, 'cantillation', { err: L(u, 0) }, Infinity, { maxStacks: L(u, 1) }); },
      action(sim, u, t) { if (isAtk(t)) self(sim, u, 'cantillation', { err: L(u, 0) }, Infinity, { maxStacks: L(u, 1) }); },
      ult(sim, u) { sim.removeBuff(u, 'cantillation'); self(sim, u, 'cadenza', { atkPct: L(u, 3) }, L(u, 4)); team(sim, 'cadenzaTeam', { dmg: L(u, 2) }, L(u, 4)); },
    },
    23034: {
      desc: 'Skill / Ultimate on an ally: +Energy, the target gets Hymn (+DMG, 3 stacks, 3 turns); every 2 such uses recover 1 SP.',
      give(sim, u, kind) {
        const kit = sim.kitOf(u), tg = sim.targetOf(u);
        if (!tg || tg === u || !(kit && kit.allyTarget && kit.allyTarget[kind])) return;
        G(sim, u, L(u, 0));
        sim.addBuff(tg, { id: 'hymn', stats: { dmg: L(u, 1) }, turns: L(u, 2), maxStacks: L(u, 3) });
        if (++u.state.lc23034 % L(u, 4) === 0) sim.gainSP(1, u);
      },
      battleStart(sim, u) { u.state.lc23034 = 0; },
      action(sim, u, t) { if (t === 'Skill') this.give(sim, u, 'Skill'); },
      ult(sim, u) { this.give(sim, u, 'Ultimate'); },
    },
    23038: {
      desc: 'Battle start: +21 Energy and Presage. After her follow-up: +12 Energy and Presage. Presage (2 turns): all allies +CRIT DMG.',
      presage(sim, u) { team(sim, 'presage', { cd: L(u, 3) }, L(u, 2), { tick: 'owner', owner: u }); },
      battleStart(sim, u) { G(sim, u, L(u, 4)); this.presage(sim, u); },
      followUpDone(sim, u) { G(sim, u, L(u, 1)); this.presage(sim, u); },
    },
    23048: {
      desc: 'Ultimate attacks recover 1 SP. Skill on an ally: their Skill +DMG for 3 turns.',
      afterDamage(sim, u, act) { if (act === 'Ult') sim.gainSP(1, u); if (act === 'Skill') { const tg = sim.targetOf(u); if (tg && tg !== u) sim.addBuff(tg, { id: 'lc23048', stats: { dmg_Skill: L(u, 3) }, turns: L(u, 4) }); } },
    },
    // ================================================================ Nihility
    20004: { desc: 'Battle start: +Effect Hit Rate for 3 turns.', battleStart(sim, u) { self(sim, u, 'lc20004', { ehr: L(u, 0) }, L(u, 1)); } },
    20011: { desc: '+DMG vs Slowed enemies.', battleStart(sim, u) { self(sim, u, 'lc20011', { dmg: (s) => (s.isSlowed() ? L(u, 0) : 0) }, Infinity); } },
    20018: {
      desc: 'After Skill, the next Basic ATK adds 60% ATK Additional DMG.',
      action(sim, u, t) { if (t === 'Skill') u.state.lc20018 = true; },
      extraDamage(sim, u, act) { if (act === 'Basic' && u.state.lc20018) { u.state.lc20018 = false; return std(sim, u, { atk: L(u, 0) }); } return 0; },
    },
    21001: { desc: '+DMG per debuff on the target (3), DoT included.', battleStart(sim, u) { self(sim, u, 'lc21001', { dmg: (s) => L(u, 0) * Math.min(L(u, 1), s.debuffCount()) }, Infinity); } },
    21008: { desc: '+DoT DMG.', battleStart(sim, u) { self(sim, u, 'lc21008', { dotDmg: L(u, 1) }, Infinity); } },
    21015: { desc: 'Hits: 60% base chance to Ensnare (−DEF for 1 turn).', afterDamage(sim, u, act) { if (isAtk(act) && sim.chance(u, 'ensnare', L(u, 0))) emod(sim, 'ensnare', { def: L(u, 1) }, L(u, 2)); } },
    21022: { desc: '+DMG (and DoT) vs Shocked / Wind Sheared enemies (any DoT counted).', battleStart(sim, u) { self(sim, u, 'lc21022', { dmg: (s) => ((s.dots || []).length ? L(u, 1) : 0) }, Infinity); } },
    21029: { desc: 'After Basic ATK / Skill: 48% ATK Additional DMG.', afterDamage(sim, u, act) { if (act === 'Basic' || act === 'Skill') sim.addDamage(u, std(sim, u, { atk: L(u, 0) }), 'Additional (LC)'); } },
    21041: {
      desc: 'Inflicting a debuff (her Skill / Ultimate): Trick, +DMG for 1 turn (3 stacks). At 80% Effect Hit Rate: +ATK.',
      battleStart(sim, u) { if (((u.stats0 && u.stats0.ehr) || 0) >= L(u, 3)) self(sim, u, 'lc21041atk', { atkPct: L(u, 4) }, Infinity); },
      action(sim, u, t) { if (t === 'Skill') self(sim, u, 'trick', { dmg: L(u, 0) }, L(u, 2), { maxStacks: L(u, 1) }); },
      ult(sim, u) { self(sim, u, 'trick', { dmg: L(u, 0) }, L(u, 2), { maxStacks: L(u, 1) }); },
    },
    21044: { desc: '+CRIT DMG vs Slowed or DEF-reduced enemies.', battleStart(sim, u) { self(sim, u, 'lc21044', { cd: (s) => (s.isSlowed() || (s.enemyMods || []).some((m) => m.def > 0) ? L(u, 1) : 0) }, Infinity); } },
    21061: { desc: 'After attacking: enemies take +DMG for 2 turns.', afterDamage(sim, u, act) { if (isAtk(act)) emod(sim, 'lc21061', { vuln: L(u, 2) }, L(u, 3)); } },
    22000: { desc: 'Attacking a DEF-reduced enemy: +Energy.', action(sim, u, t) { if (isAtk(t) && (sim.enemyMods || []).some((m) => m.def > 0)) G(sim, u, L(u, 1)); } },
    23004: {
      desc: '+DMG vs debuffed enemies. Skill: +Effect Hit Rate and +ATK for that attack.',
      battleStart(sim, u) { self(sim, u, 'lc23004', { dmg: (s) => (s.debuffCount() > 0 ? L(u, 0) : 0) }, Infinity); },
      action(sim, u, t) { if (t === 'Skill') self(sim, u, 'lc23004s', { ehr: L(u, 1), atkPct: L(u, 2) }, Infinity); },
      afterDamage(sim, u) { sim.removeBuff(u, 'lc23004s'); },
    },
    23006: {
      desc: 'Hits inflict Erode: 60% ATK Lightning DoT for 1 turn (counts as Shock).',
      afterDamage(sim, u, act) {
        if (!isAtk(act)) return;
        const ab = AD().abilityFor(sim, u, act);
        sim.addDot({ id: `${u.key}:erode`, src: u, mult: { atk: L(u, 0) }, turns: L(u, 4), targets: ab ? sim.dotTargets(ab) : 1 });
      },
    },
    23007: {
      desc: '+CRIT Rate vs enemies with 3+ debuffs. Basic ATK / Skill / Ultimate: Aether Code on a hit enemy, +DMG taken for 1 turn.',
      battleStart(sim, u) { self(sim, u, 'lc23007', { cr: (s) => (s.debuffCount() >= 3 ? L(u, 2) : 0) }, Infinity); },
      afterDamage(sim, u, act) { if (['Basic', 'Skill', 'Ult', 'Enhanced'].includes(act)) emod(sim, 'aetherCode', { vuln: L(u, 4) / Math.max(1, sim.enemyCount || 1) * Math.min(sim.targetsHit(u, act), sim.enemyCount || 1) }, L(u, 3)); },
    },
    23022: {
      desc: 'Prophet: one stack per DoT kind present when she deals DMG (4): +ATK and her DoT ignores DEF.',
      afterDamage(sim, u, act) {
        if (!isAtk(act)) return;
        const kinds = new Set((sim.dots || []).map((d) => d.id)).size;
        const k = Math.min(L(u, 3), Math.max(u.state.lc23022 || 0, kinds));
        u.state.lc23022 = k;
        sim.removeBuff(u, 'prophet');
        if (k) self(sim, u, 'prophet', { atkPct: L(u, 1) * k, defIgnore_DoT: L(u, 2) * k }, Infinity);
      },
    },
    23024: { desc: 'Mirage Fizzle on hit enemies: +DMG to them, and Ultimate +DMG more.', battleStart(sim, u) { self(sim, u, 'lc23024', { dmg: L(u, 1), dmg_Ult: L(u, 2) }, Infinity); } },
    23029: {
      desc: 'Basic ATK / Skill / Ultimate: 60% base chance of Unarmored (+DMG taken, 2 turns); on enemies with her DoT, 60% to upgrade to Cornered (+more).',
      afterDamage(sim, u, act) {
        if (!['Basic', 'Skill', 'Ult', 'Enhanced'].includes(act) || !sim.chance(u, 'unarmored', L(u, 1))) return;
        const mine = (sim.dots || []).some((d) => d.src === u);
        const cornered = mine && sim.chance(u, 'cornered', L(u, 4));
        emod(sim, 'unarmored', { vuln: L(u, 2) + (cornered ? L(u, 5) : 0) }, L(u, 3));
      },
    },

    23035: { desc: 'Any Weakness Break: Charring, +Break DMG taken for 2 turns (2 stacks).', weaknessBreak(sim, u) { u.state.lc23035 = Math.min(L(u, 4), (u.state.lc23035 || 0) + 1); emod(sim, 'charring', { vulnType: { Break: L(u, 2) * u.state.lc23035 } }, L(u, 3)); } },
    23043: { desc: 'After attacking: Bamboozle (−DEF, 2 turns) on all enemies; at 170 SPD also Theft (−DEF more).', afterDamage(sim, u, act) { if (isAtk(act)) emod(sim, 'bamboozle', { def: L(u, 2) + (sim.spd(u) >= L(u, 6) ? L(u, 5) : 0) }, L(u, 3)); } },
    23047: {
      desc: 'Her debuffs (Skill / Ultimate): Enthrallment for 3 turns: +DoT taken per debuff she applied (6); allies attacking it get +SPD for 3 turns.',
      enthrall(sim, u) { u.state.lc23047 = Math.min(L(u, 4), (u.state.lc23047 || 0) + 1); emod(sim, 'enthrallment', { vulnType: { DoT: L(u, 3) * u.state.lc23047 } }, L(u, 2)); },
      action(sim, u, t) { if (t === 'Skill') this.enthrall(sim, u); },
      ult(sim, u) { this.enthrall(sim, u); },
      allyAttack(sim, u, a) { if (a.kind === 'char' && (sim.enemyMods || []).some((m) => m.id === 'enthrallment')) sim.addBuff(a, { id: 'lc23047spd', pct: L(u, 5), turns: L(u, 6) }); },
      afterDamage(sim, u, act) { if (isAtk(act) && (sim.enemyMods || []).some((m) => m.id === 'enthrallment')) sim.addBuff(u, { id: 'lc23047spd', pct: L(u, 5), turns: L(u, 6) }); },
    },
    23050: {
      desc: 'Battle start: she and the teammate with the highest Break Effect +Break DMG. Implanting a Weakness (implanters only) recovers 1 SP, once per Ultimate.',
      battleStart(sim, u) {
        const mate = sim.allies(u).sort((a, b) => ((b.stats0 && b.stats0.be) || 0) - ((a.stats0 && a.stats0.be) || 0))[0];
        [u, mate].filter(Boolean).forEach((a) => sim.addBuff(a, { id: 'lc23050', stats: { breakDmg: L(u, 1) }, turns: Infinity }));
        u.state.lc23050 = ['1405', '1321', '1006', '1315', '1506'].includes(u.cfg.char.id);
      },
      action(sim, u, t) { if (u.state.lc23050 && (t === 'Skill' || t === 'Ult')) { u.state.lc23050 = false; sim.gainSP(1, u); } },
      ult(sim, u) { u.state.lc23050 = ['1405', '1321', '1006', '1315', '1506'].includes(u.cfg.char.id); },
    },
    23059: {
      desc: 'First turn: +20 fixed Energy. Skill attacks: Purgatory for 2 turns: allies +CRIT DMG against it, her more.',
      turnStart(sim, u) { if (!u.state.lc23059) { u.state.lc23059 = true; F(sim, u, L(u, 1)); } },
      afterDamage(sim, u, act) { if (act === 'Skill') { team(sim, 'purgatory', { cd: L(u, 3) }, L(u, 2)); self(sim, u, 'purgatorySelf', { cd: L(u, 4) }, L(u, 2)); } },
    },
    24003: { desc: 'Ultimate: +DoT DMG for 2 turns.', ult(sim, u) { self(sim, u, 'lc24003', { dotDmg: L(u, 1) }, L(u, 2)); } },
    // ================================================================ Preservation
    20003: { desc: '+DEF below 50% HP (half).', battleStart(sim, u) { self(sim, u, 'lc20003', { defPct: L(u, 2) * HALF }, Infinity); } },
    20010: { desc: 'Self-healing only (not simulated).' },
    20017: { desc: 'Self-healing only (not simulated).' },
    21002: { desc: 'All-Type RES for allies (not simulated).' },
    21009: { desc: 'Higher aggro (damage reduction isn\'t simulated).', tauntMult(sim, u) { return 1 + L(u, 0); } },
    21016: { desc: 'When hit: Burns the attacker (DEF-based DoT, 2 turns).', hit(sim, u) { sim.addDot({ id: `${u.key}:lc21016`, src: u, mult: { def: L(u, 2) }, turns: L(u, 3) }); } },
    21023: { desc: 'Damage reduction and healing only (not simulated).' },
    21030: { desc: 'Ultimate: +60% DEF as DMG per enemy hit.', extraDamage(sim, u, act) { return act === 'Ult' ? std(sim, u, { def: L(u, 1) * sim.targetsHit(u, 'Ult') }, 'Ult') : 0; } },
    21039: { desc: '+DMG per 100 DEF (max 32%).', battleStart(sim, u) { self(sim, u, 'lc21039', { dmg: Math.min(L(u, 3), L(u, 2) * Math.floor(st(sim, u).DEF / L(u, 1))) }, Infinity); } },
    21043: { desc: '+DMG per shielded character (all, with a shielder on the team).', battleStart(sim, u) { if (healerOnTeam(sim)) self(sim, u, 'lc21043', { dmg: L(u, 1) * sim.chars().length }, Infinity); } },
    21053: { desc: 'Shielded allies +DMG (her shields assumed up).', battleStart(sim, u) { team(sim, 'lc21053', { dmg: L(u, 1) }, Infinity); } },
    23005: { desc: 'Higher aggro. When hit: +DEF until the end of her turn.', tauntMult(sim, u) { return 1 + L(u, 0); }, hit(sim, u) { self(sim, u, 'lc23005', { defPct: L(u, 3) }, 1); } },
    23011: { desc: 'When her HP drops (hit): all allies +DMG for 2 turns.', hit(sim, u) { team(sim, 'lc23011', { dmg: L(u, 1) }, 2); } },
    23023: {
      desc: 'Shielding allies (Skill / Ultimate): +CRIT DMG for 2 turns. Her follow-ups: enemies take +DMG for 2 turns.',
      action(sim, u, t) { if (t === 'Skill') self(sim, u, 'lc23023', { cd: L(u, 1) }, L(u, 2)); },
      ult(sim, u) { self(sim, u, 'lc23023', { cd: L(u, 1) }, L(u, 2)); },
      followUpDone(sim, u) { emod(sim, 'lc23023', { vuln: L(u, 4) }, L(u, 5)); },
    },
    23051: { desc: 'Ultimate: Redoubt for 3 turns: all allies +DMG (more with a summon).', ult(sim, u) { sim.chars().forEach((a) => sim.addBuff(a, { id: 'redoubt', stats: { dmg: L(u, 1) + (sim.units.some((x) => x.alive && x.owner === a && x.kind === 'summon') ? L(u, 2) : 0) }, turns: L(u, 3) })); } },
    24002: { desc: 'Shields and damage reduction only (not simulated).' },
    // ================================================================ Remembrance
    20021: { desc: 'First memosprite summon: +1 SP and +Energy.', memoSummoned(sim, u) { if (!u.state.lc20021) { u.state.lc20021 = true; sim.gainSP(L(u, 0), u); G(sim, u, L(u, 1)); } } },
    20022: {
      desc: 'Each memosprite turn: Commemoration, +DMG for her and the memosprite (4 stacks); cleared when it leaves.',
      allyAction(sim, u, a) { if (a.owner === u && a.memo) self(sim, u, 'commemoration', { dmg: L(u, 0) }, Infinity, { maxStacks: L(u, 1) }); },
      memoGone(sim, u) { sim.removeBuff(u, 'commemoration'); },
    },
    21050: { desc: 'Her memosprite\'s ally-targeted abilities (Mem\'s Support, Demiurge\'s Ode): all allies +DMG for 3 turns.', allyAction(sim, u, a) { if (a.owner === u && a.memo && ['8008', '1415'].includes(u.cfg.char.id)) team(sim, 'lc21050', { dmg: L(u, 1) }, L(u, 2)); } },
    21051: { desc: 'Ultimate: she and her memosprite +Basic ATK DMG for 3 turns.', ult(sim, u) { self(sim, u, 'lc21051', { dmg_Basic: L(u, 1) }, L(u, 2)); } },
    21052: { desc: '+DMG while her memosprite is out.', battleStart(sim, u) { self(sim, u, 'lc21052', { dmg: (s, a) => (s.units.some((x) => x.alive && x.owner === a && x.memo) ? L(u, 1) : 0) }, Infinity); } },
    21054: { desc: 'Outgoing Healing only (not simulated).' },
    21057: { desc: 'Memosprite +CRIT DMG.', battleStart(sim, u) { self(sim, u, 'lc21057', { cd_Memo: L(u, 1) }, Infinity); } },
    22006: {
      desc: 'On Trailblazer (Remembrance): all allies +DMG, and "Together, We Script Tomorrow!" +60% DMG.',
      battleStart(sim, u) { if (u.cfg.char.id === '8008') team(sim, 'lc22006', { dmg: L(u, 1) }, Infinity); },
      dmgScale(sim, u, act) { return u.cfg.char.id === '8008' && act === 'Enhanced' ? 1 + L(u, 2) / (1 + st(sim, u).dmg) : 1; },
    },
    23036: {
      desc: 'Her and her memosprite\'s attacks: Brocade, +CRIT DMG (6 stacks); at 6 also +Basic ATK DMG.',
      stack(sim, u) { const b = self(sim, u, 'brocade', { cd: L(u, 2) }, Infinity, { maxStacks: L(u, 1) }); if (b && b.stacks >= L(u, 1)) self(sim, u, 'brocadeMax', { dmg_Basic: L(u, 3) * L(u, 1) }, Infinity); },
      afterDamage(sim, u, act) { if (isAtk(act)) this.stack(sim, u); },
      allyAttack(sim, u, a) { if (a.owner === u && a.memo) this.stack(sim, u); },
    },
    23040: {
      desc: 'Losing HP on her own turn (HP-spending characters): Death Flower, she and her memosprite ignore DEF for 2 turns. Her memosprite leaving: advance 12% (once per Ultimate).',
      battleStart(sim, u) { u.state.lc23040 = true; },
      action(sim, u, t) { if (HP_USERS.has(u.cfg.char.id) && (t === 'Skill' || t === 'Enhanced' || t === 'Basic')) self(sim, u, 'deathFlower', { defIgnore: L(u, 1) }, L(u, 2)); },
      memoGone(sim, u) { if (u.state.lc23040) { u.state.lc23040 = false; sim.advance(u, L(u, 3)); } },
      ult(sim, u) { u.state.lc23040 = true; },
    },
    23042: {
      desc: 'Basic ATK / Skill / Ultimate: every ally loses 1% of current HP; her memosprite\'s next attack adds 250% of the total as Additional DMG. Memosprite Skill: enemies take +DMG for 2 turns.',
      take(sim, u) { u.state.lc23042 = (u.state.lc23042 || 0) + sim.chars().reduce((a, c) => a + L(u, 1) * (c.stats0 ? st(sim, c).HP : 0), 0); },
      action(sim, u, t) { if (['Basic', 'Skill', 'Enhanced'].includes(t)) this.take(sim, u); },
      ult(sim, u) { this.take(sim, u); },
      allyAction(sim, u, a) {
        if (a.owner !== u || !a.memo) return;
        emod(sim, 'lc23042', { vuln: L(u, 3) }, L(u, 4));
        if (u.state.lc23042) { sim.addDamage(u, L(u, 5) * u.state.lc23042, 'Additional (LC)'); u.state.lc23042 = 0; }
      },
    },
    23049: {
      desc: 'She and her memosprite +DMG. Memosprite abilities: Noctis, all memosprites ignore DEF. Memosprite leaving: +8 Energy.',
      battleStart(sim, u) { self(sim, u, 'lc23049', { dmg: L(u, 2) }, Infinity); },
      allyAction(sim, u, a) { if (a.owner === u && a.memo) team(sim, 'noctis', { defIgnore_Memo: L(u, 1) }, Infinity); },
      memoGone(sim, u) { G(sim, u, L(u, 3)); },
    },
    23052: {
      desc: 'Memosprite Skill on an enemy: Verse (all allies +CRIT DMG); on an ally (Mem / Demiurge): Blank (enemies +DMG taken); both: ×1.6.',
      allyAction(sim, u, a) {
        if (a.owner !== u || !a.memo) return;
        u.state.verse = true;
        if (['8008', '1415'].includes(u.cfg.char.id)) u.state.blank = true;
        const k = u.state.verse && u.state.blank ? 1 + L(u, 3) : 1;
        team(sim, 'verse', { cd: L(u, 1) * k }, Infinity);
        if (u.state.blank) emod(sim, 'blank', { vuln: L(u, 2) * k }, Infinity);
      },
    },
    23063: { desc: 'Ultimate: +1 SP for allies.', ult(sim, u) { sim.gainSP(1, u); } },
    24005: { desc: 'Skill: all allies +DMG for 3 turns.', action(sim, u, t) { if (t === 'Skill') team(sim, 'lc24005', { dmg: L(u, 1) }, L(u, 2)); } },
    // ================================================================ The Hunt
    20000: { desc: 'Battle start: +CRIT Rate for 3 turns.', battleStart(sim, u) { self(sim, u, 'lc20000', { cr: L(u, 0) }, L(u, 1)); } },
    20007: { desc: 'On-kill ATK (kills aren\'t simulated).' },
    20014: { desc: 'On-kill SPD (kills aren\'t simulated).' },
    21003: { desc: '+CRIT Rate with 2 or fewer enemies.', battleStart(sim, u) { if ((sim.enemyCount || 1) <= 2) self(sim, u, 'lc21003', { cr: L(u, 1) }, Infinity); } },
    21010: { desc: 'Each hit on the same target: +DMG (5 stacks).', afterDamage(sim, u, act) { if (isAtk(act)) self(sim, u, 'lc21010', { dmg: L(u, 0) }, Infinity, { maxStacks: L(u, 1) }); } },
    21017: { desc: 'Basic ATK and Skill +DMG, more at full Energy.', battleStart(sim, u) { self(sim, u, 'lc21017', { dmg_Basic: (s, a) => L(u, 0) + (s.energyFull(a) ? L(u, 1) : 0), dmg_Skill: (s, a) => L(u, 0) + (s.energyFull(a) ? L(u, 1) : 0) }, Infinity); } },
    21024: {
      desc: '+DMG until she is hit; back after the end of her next turn.',
      battleStart(sim, u) { self(sim, u, 'lc21024', { dmg: (s, a) => (a.state.lc21024off ? 0 : L(u, 1)) }, Infinity); },
      hit(sim, u) { u.state.lc21024off = 2; },
      turnEnd(sim, u) { if (u.state.lc21024off && --u.state.lc21024off <= 0) u.state.lc21024off = 0; },
    },

    21031: { desc: 'Buff dispel only (enemy buffs aren\'t simulated).' },
    21037: {
      desc: 'CRIT hits: Good Fortune, +CRIT DMG (4 stacks) until the end of her turn.',
      afterDamage(sim, u, act) { if (isAtk(act) && sim.chance(u, 'lc21037', Math.min(1, st(sim, u).cr) / 0.8)) self(sim, u, 'goodFortune', { cd: L(u, 1) }, Infinity, { maxStacks: L(u, 2) }); },
      turnEnd(sim, u) { sim.removeBuff(u, 'goodFortune'); },
    },
    21047: { desc: 'Dealing Break DMG: +SPD for 2 turns (once per turn).', weaknessBreak(sim, u, by) { if (by === u && u.state.lc21047 !== sim.turnId) { u.state.lc21047 = sim.turnId; sim.addBuff(u, { id: 'shadowed', pct: L(u, 1), turns: L(u, 2) }); } } },
    21062: { desc: 'Skill and Follow-up +DMG.', battleStart(sim, u) { self(sim, u, 'lc21062', { dmg_Skill: L(u, 1), dmg_FUA: L(u, 1) }, Infinity); } },
    22008: { desc: 'After a follow-up: +CRIT DMG for 2 turns (10 stacks).', followUpDone(sim, u) { self(sim, u, 'lc22008', { cd: L(u, 1) }, L(u, 2), { maxStacks: L(u, 3) }); } },
    23001: {
      desc: 'Per 10 SPD above 100 (6 stacks): Basic ATK / Skill +DMG, Ultimate +CRIT DMG.',
      battleStart(sim, u) {
        const k = (s, a) => Math.min(L(u, 4), Math.max(0, Math.floor((s.spd(a) - 100) / L(u, 1))));
        self(sim, u, 'lc23001', { dmg_Basic: (s, a) => L(u, 2) * k(s, a), dmg_Skill: (s, a) => L(u, 2) * k(s, a), cd_Ult: (s, a) => L(u, 3) * k(s, a) }, Infinity);
      },
    },
    23012: {
      desc: 'A Basic ATK / Skill without a CRIT: +CRIT Rate for 1 turn (once per 3 turns).',
      turnStart(sim, u) { if (u.state.lc23012cd > 0) u.state.lc23012cd -= 1; },
      afterDamage(sim, u, act) {
        if (!(act === 'Basic' || act === 'Skill') || u.state.lc23012cd > 0) return;
        u.state.lc23012acc = (u.state.lc23012acc || 0) + (1 - Math.min(1, st(sim, u).cr));
        if (u.state.lc23012acc >= 1) { u.state.lc23012acc -= 1; u.state.lc23012cd = L(u, 3); self(sim, u, 'lc23012', { cr: L(u, 1) }, L(u, 2)); }
      },
    },
    23016: {
      desc: 'Follow-up +DMG. Her follow-ups Tame the target (2 stacks): allies +CRIT DMG against it.',
      battleStart(sim, u) { self(sim, u, 'lc23016', { dmg_FUA: L(u, 1) }, Infinity); },
      followUpDone(sim, u) { team(sim, 'tame', { cd: L(u, 2) }, Infinity, { maxStacks: L(u, 3) }); },
    },
    23020: {
      desc: '+CRIT DMG per debuff on the target (3). Ultimate attacks: Disputation for 2 turns, +DMG and follow-ups ignore DEF.',
      battleStart(sim, u) { self(sim, u, 'lc23020', { cd: (s) => L(u, 1) * Math.min(L(u, 2), s.debuffCount()) }, Infinity); },
      afterDamage(sim, u, act) { if (act === 'Ult') self(sim, u, 'disputation', { dmg: L(u, 3), defIgnore_FUA: L(u, 4) }, L(u, 5)); },
    },
    23027: { desc: 'Break DMG ignores DEF.', battleStart(sim, u) { self(sim, u, 'lc23027', { defIgnore_Break: L(u, 2) }, Infinity); } },
    23031: {
      desc: 'Follow-ups: Luminflux (2 stacks), her Ultimate ignores DEF per stack; one stack fades at the end of her turn.',
      followUpDone(sim, u) { self(sim, u, 'luminflux', { defIgnore_Ult: L(u, 1) }, Infinity, { maxStacks: L(u, 2) }); },
      turnEnd(sim, u) { const b = u.buffs.find((x) => x.id === 'luminflux'); if (b) { if (b.stacks > 1) b.stacks -= 1; else sim.removeBuff(u, 'luminflux'); } },
    },
    23046: {
      desc: '+ATK if the team\'s SP limit is 6+. Each Skill: +ATK (4 stacks).',
      afterBattleStart(sim, u) { if (sim.spMax >= L(u, 1)) self(sim, u, 'lc23046', { atkPct: L(u, 2) }, Infinity); },
      action(sim, u, t) { if (t === 'Skill') self(sim, u, 'lc23046s', { atkPct: L(u, 3) }, Infinity, { maxStacks: L(u, 4) }); },
    },
    23056: {
      desc: 'Battle start and every 4 follow-ups: Umbra Devourer for 3 turns: +ATK, enemies take +DMG.',
      umbra(sim, u) { self(sim, u, 'umbra', { atkPct: L(u, 3) }, L(u, 2)); emod(sim, 'umbra', { vuln: L(u, 4) }, L(u, 2)); },
      battleStart(sim, u) { u.state.lc23056 = 0; this.umbra(sim, u); },
      followUpDone(sim, u) { if (++u.state.lc23056 >= L(u, 1)) { u.state.lc23056 = 0; this.umbra(sim, u); } },
    },
    24001: { desc: '+CRIT Rate vs enemies at ≤50% HP (half). On-kill ATK isn\'t simulated.', battleStart(sim, u) { self(sim, u, 'lc24001', { cr: L(u, 2) * HALF }, Infinity); } },
  };

  window.AVLightConeKits = lc;

  // ---------------------------------------------------------------- relic sets and planars
  // Conditional effects of each set (unconditional stats come from the data's props).
  const COMPANIONS = new Set(['8002', '8004', '8006', '8008', '8010', '1003', '1510', '1001', '1224', '1413', '1002', '1213', '1414', '1004', '1313']);
  const allyTargetOf = (sim, a, kind) => { const k = sim.kitOf(a); return k && k.allyTarget && k.allyTarget[kind] ? sim.targetOf(a) : null; };
  const relic = {
    101: { four: { desc: 'Battle start: +1 SP.', battleStart(sim, u) { sim.gainSP(1, u); } } },
    102: { four: { desc: 'Basic ATK +10% DMG.', battleStart(sim, u) { self(sim, u, 'r102', { dmg_Basic: 0.1 }, Infinity); } } },
    104: { four: { desc: 'Ultimate: +25% CRIT DMG for 2 turns.', ult(sim, u) { self(sim, u, 'r104', { cd: 0.25 }, 2); } } },
    105: { four: { desc: 'Attacking or being hit: +5% ATK (5 stacks).', action(sim, u, t) { if (isAtk(t)) self(sim, u, 'r105', { atkPct: 0.05 }, Infinity, { maxStacks: 5 }); }, hit(sim, u) { self(sim, u, 'r105', { atkPct: 0.05 }, Infinity, { maxStacks: 5 }); } } },
    106: { four: { desc: 'Turn start at ≤50% HP (half the turns): +5 Energy.', turnStart(sim, u) { u.state.r106 = !u.state.r106; if (u.state.r106) G(sim, u, 5 * 2 * HALF); } } },
    107: { four: { desc: 'Skill +12% DMG; after Ultimate the next attack +12% Fire DMG.', battleStart(sim, u) { self(sim, u, 'r107', { dmg_Skill: 0.12 }, Infinity); }, ult(sim, u) { u.state.r107 = true; }, action(sim, u, t) { if (u.state.r107 && isAtk(t)) { u.state.r107 = false; if (u.cfg.char.element === 'Fire') self(sim, u, 'r107b', { dmg: 0.12 }, Infinity); } }, afterDamage(sim, u) { sim.removeBuff(u, 'r107b'); } } },
    108: { four: { desc: 'Ignores 10% DEF (20% vs Quantum-weak enemies, assumed for Quantum wearers).', battleStart(sim, u) { self(sim, u, 'r108', { defIgnore: u.cfg.char.element === 'Quantum' ? 0.2 : 0.1 }, Infinity); } } },
    109: { four: { desc: 'Skill: +20% ATK for 1 turn.', action(sim, u, t) { if (t === 'Skill') self(sim, u, 'r109', { atkPct: 0.2 }, 1); } } },
    111: { four: { desc: 'Breaking a Weakness: +3 Energy.', weaknessBreak(sim, u, by) { if (by === u) G(sim, u, 3); } } },
    112: { four: { desc: '+10% CRIT Rate vs debuffed enemies (Imprison isn\'t simulated).', battleStart(sim, u) { self(sim, u, 'r112', { cr: (s) => (s.debuffCount() > 0 ? 0.1 : 0) }, Infinity); } } },
    113: { four: { desc: 'Hit or spending HP: +8% CRIT Rate for 2 turns (2 stacks).', hit(sim, u) { self(sim, u, 'r113', { cr: 0.08 }, 2, { maxStacks: 2 }); }, action(sim, u, t) { if (HP_USERS.has(u.cfg.char.id) && (t === 'Skill' || t === 'Enhanced')) self(sim, u, 'r113', { cr: 0.08 }, 2, { maxStacks: 2 }); } } },
    115: {
      two: { desc: 'Follow-up +20% DMG.', battleStart(sim, u) { self(sim, u, 'r115', { dmg_FUA: 0.2 }, Infinity); } },
      four: { desc: 'Each follow-up: +6% ATK per hit (8 stacks, 3 turns), reset by the next follow-up.', followUpDone(sim, u) { sim.removeBuff(u, 'r115b'); self(sim, u, 'r115b', { atkPct: 0.06 * Math.min(8, 2 * sim.targetsHit(u, 'FollowUp')) }, 3); } },
    },
    116: { four: { desc: 'Ignores 6% DEF per DoT on the target (3).', battleStart(sim, u) { self(sim, u, 'r116', { defIgnore: (s) => 0.06 * Math.min(3, (s.dots || []).length) }, Infinity); } } },
    117: {
      two: { desc: '+12% DMG vs debuffed enemies.', battleStart(sim, u) { self(sim, u, 'r117', { dmg: (s) => (s.debuffCount() > 0 ? 0.12 : 0) }, Infinity); } },
      four: {
        desc: '+8% / 12% CRIT DMG vs enemies with 2 / 3+ debuffs; doubled for 1 turn after she inflicts a debuff (her Skill / Ultimate).',
        battleStart(sim, u) { self(sim, u, 'r117b', { cd: (s, a) => { const d = s.debuffCount(); return (d >= 3 ? 0.12 : d >= 2 ? 0.08 : 0) * (s.hasBuff(a, 'r117x') ? 2 : 1); }, cr: (s, a) => (s.hasBuff(a, 'r117x') ? 0.04 : 0) }, Infinity); },
        action(sim, u, t) { if (t === 'Skill') self(sim, u, 'r117x', {}, 1); },
        ult(sim, u) { self(sim, u, 'r117x', {}, 1); },
      },
    },
    118: { four: { desc: 'Ultimate on an ally: all allies +30% Break Effect for 2 turns.', ult(sim, u) { if (allyTargetOf(sim, u, 'Ultimate')) team(sim, 'r118', { be: 0.3 }, 2); } } },
    119: { four: { desc: 'At 150% Break Effect, Break DMG ignores 10% DEF; at 250%, 15% more (Super Break).', battleStart(sim, u) { const be = st(sim, u).be || 0; if (be >= 1.5) self(sim, u, 'r119', { defIgnore_Break: 0.1 + (be >= 2.5 ? 0.15 : 0) }, Infinity); } } },
    120: { four: { desc: 'After a follow-up: Ultimate +36% DMG for 1 turn.', followUpDone(sim, u) { self(sim, u, 'r120', { dmg_Ult: 0.36 }, 1); } } },
    121: {
      four: {
        desc: 'Skill / Ultimate on an ally: their CRIT DMG +18% for 2 turns (2 stacks).',
        give(sim, u, kind) { const tg = allyTargetOf(sim, u, kind); if (tg && tg !== u) sim.addBuff(tg, { id: 'r121', stats: { cd: 0.18 }, turns: 2, maxStacks: 2 }); },
        action(sim, u, t) { if (t === 'Skill') this.give(sim, u, 'Skill'); },
        ult(sim, u) { this.give(sim, u, 'Ultimate'); },
      },
    },
    122: { four: { desc: 'Skill and Ultimate +20% DMG; after Ultimate the next Skill +25%.', battleStart(sim, u) { self(sim, u, 'r122', { dmg_Skill: 0.2, dmg_Ult: 0.2 }, Infinity); }, ult(sim, u) { self(sim, u, 'r122b', { dmg_Skill: 0.25 }, Infinity); }, afterDamage(sim, u, act) { if (act === 'Skill') sim.removeBuff(u, 'r122b'); } } },
    123: { four: { desc: 'Memosprite attacks: she and it +30% CRIT DMG for 2 turns.', allyAttack(sim, u, a) { if (a.owner === u && a.memo) self(sim, u, 'r123', { cd: 0.3 }, 2); } } },
    124: { four: { desc: 'SPD below 110 / 95 at battle start: +20% / 32% CRIT Rate (memosprite too).', battleStart(sim, u) { const sp = sim.spd(u); if (sp < 110) self(sim, u, 'r124', { cr: sp < 95 ? 0.32 : 0.2 }, Infinity); } } },
    125: { four: { desc: 'Healing allies (healer\'s actions): Gentle Rain for 2 turns, all allies +15% CRIT DMG.', action(sim, u) { if (u.cfg.char.path === 'Abundance') team(sim, 'gentleRain', { cd: 0.15 }, 2, { tick: 'owner', owner: u }); } } },
    126: {
      four: {
        desc: 'Targeted by an ally\'s ability: Help (2 stacks); Ultimate at 2 stacks: +48% ATK for 1 turn.',
        allyAction(sim, u, a, t) { if (a.kind === 'char' && allyTargetOf(sim, a, t) === u) u.state.r126 = Math.min(2, (u.state.r126 || 0) + 1); },
        allyUlt(sim, u, a) { if (allyTargetOf(sim, a, 'Ultimate') === u) u.state.r126 = Math.min(2, (u.state.r126 || 0) + 1); },
        ult(sim, u) { if (u.state.r126 >= 2) { u.state.r126 = 0; self(sim, u, 'r126', { atkPct: 0.48 }, 1); } },
      },
    },
    127: { four: { desc: 'Basic ATK / Skill with her memosprite out: +24% Max HP for her and it, all allies +15% DMG (until her next Basic ATK / Skill).', action(sim, u, t) { if ((t === 'Basic' || t === 'Skill' || t === 'Enhanced') && sim.units.some((x) => x.alive && x.owner === u && x.memo)) { self(sim, u, 'r127', { hpPct: 0.24 }, Infinity); team(sim, 'r127t', { dmg: 0.15 }, Infinity); } } } },
    128: { four: { desc: 'Allies holding her Shield: +15% CRIT DMG.', battleStart(sim, u) { if (u.cfg.char.path === 'Preservation') team(sim, 'r128', { cd: 0.15 }, Infinity); } } },
    129: {
      four: {
        desc: 'Her (and her memosprite\'s) Elation DMG ignores 10% DEF, +1% per 5 Punchline allies gain (10).',
        battleStart(sim, u) { u.state.r129 = 0; self(sim, u, 'r129', { defIgnore_Elation: (s, a) => 0.1 + 0.01 * Math.min(10, Math.floor(a.state.r129 / 5)) }, Infinity); },
        punchline(sim, u, by, k) { u.state.r129 += k; },
      },
    },
    130: { four: { desc: 'SPD 120 / 160 at battle start: +10% / 18% CRIT Rate. First Elation Skill: all allies +10% Elation.', battleStart(sim, u) { const sp = sim.spd(u); if (sp >= 120) self(sim, u, 'r130', { cr: sp >= 160 ? 0.18 : 0.1 }, Infinity); }, elation(sim, u) { if (!u.state.r130) { u.state.r130 = true; team(sim, 'r130e', { elation: 0.1 }, Infinity); } } } },
    131: {
      four: {
        desc: 'Battle start and each Skill: Skill and Ultimate +18% DMG (3 stacks); one stack fades at her turn start and after her Ultimate.',
        add(sim, u) { self(sim, u, 'r131', { dmg_Skill: 0.18, dmg_Ult: 0.18 }, Infinity, { maxStacks: 3 }); },
        drop(sim, u) { const b = u.buffs.find((x) => x.id === 'r131'); if (b) { if (b.stacks > 1) b.stacks -= 1; else sim.removeBuff(u, 'r131'); } },
        battleStart(sim, u) { this.add(sim, u); },
        action(sim, u, t) { if (t === 'Skill') this.add(sim, u); },
        turnStart(sim, u) { this.drop(sim, u); },
        afterDamage(sim, u, act) { if (act === 'Ult') this.drop(sim, u); },
      },
    },
    132: {
      four: {
        desc: '+28% CRIT DMG vs DEF-reduced enemies. After she attacks with a DEF reduction up: Comburent, all allies +15% DMG for 2 turns.',
        battleStart(sim, u) { self(sim, u, 'r132', { cd: (s) => ((s.enemyMods || []).some((m) => m.def > 0) ? 0.28 : 0) }, Infinity); },
        afterDamage(sim, u, act) { if (isAtk(act) && (sim.enemyMods || []).some((m) => m.def > 0)) team(sim, 'comburent', { dmg: 0.15 }, 2); },
      },
    },
    133: {
      four: {
        desc: 'Skill / Ultimate on another ally: their Elation +16% for 3 turns; with 10+ Certified Banger also all allies +12% CRIT DMG for 3 turns.',
        give(sim, u, kind) { const tg = allyTargetOf(sim, u, kind); if (!tg || tg === u) return; sim.addBuff(tg, { id: 'r133', stats: { elation: 0.16 }, turns: 3 }); if (sim.cbTotal(u) >= 10) team(sim, 'r133cd', { cd: 0.12 }, 3); },
        action(sim, u, t) { if (t === 'Skill') this.give(sim, u, 'Skill'); },
        ult(sim, u) { this.give(sim, u, 'Ultimate'); },
      },
    },
    134: { four: { desc: 'Basic ATK +36% DMG; Basic ATK gives +20% ATK for 2 turns.', battleStart(sim, u) { self(sim, u, 'r134', { dmg_Basic: 0.36 }, Infinity); }, action(sim, u, t) { if (t === 'Basic' || t === 'Enhanced') self(sim, u, 'r134b', { atkPct: 0.2 }, 2); } } },
    // Planar ornaments
    301: { two: { desc: 'At 120+ SPD: +12% ATK more.', battleStart(sim, u) { self(sim, u, 'r301', { atkPct: (s, a) => (s.spd(a) >= 120 ? 0.12 : 0) }, Infinity); } } },
    302: { two: { desc: 'At 120+ SPD: all allies +8% ATK.', battleStart(sim, u) { team(sim, 'r302', { atkPct: (s) => (s.spd(u) >= 120 ? 0.08 : 0) }, Infinity); } } },
    303: { two: { desc: '+ATK equal to 25% of Effect Hit Rate (max 25%).', battleStart(sim, u) { self(sim, u, 'r303', { atkPct: Math.min(0.25, 0.25 * (st(sim, u).ehr || 0)) }, Infinity); } } },
    305: { two: { desc: 'At 120% CRIT DMG: +60% CRIT Rate until her first attack ends.', battleStart(sim, u) { if ((st(sim, u).cd || 0) >= 1.2) self(sim, u, 'r305', { cr: 0.6 }, Infinity); }, afterDamage(sim, u, act) { if (isAtk(act)) sim.removeBuff(u, 'r305'); } } },
    306: { two: { desc: 'At 50% CRIT Rate: Ultimate and Follow-up +15% DMG.', battleStart(sim, u) { if ((st(sim, u).cr || 0) >= 0.5) self(sim, u, 'r306', { dmg_Ult: 0.15, dmg_FUA: 0.15 }, Infinity); } } },
    307: { two: { desc: 'At 145+ SPD: +20% Break Effect.', battleStart(sim, u) { self(sim, u, 'r307', { be: (s, a) => (s.spd(a) >= 145 ? 0.2 : 0) }, Infinity); } } },
    309: { two: { desc: 'At 70% CRIT Rate: Basic ATK and Skill +20% DMG.', battleStart(sim, u) { if ((st(sim, u).cr || 0) >= 0.7) self(sim, u, 'r309', { dmg_Basic: 0.2, dmg_Skill: 0.2 }, Infinity); } } },
    310: { two: { desc: 'At 30% Effect RES: all allies +10% CRIT DMG.', battleStart(sim, u) { if (((u.stats0 && u.stats0.res) || 0) >= 0.3) team(sim, 'r310', { cd: 0.1 }, Infinity); } } },
    311: { two: { desc: 'At 135 / 160 SPD: +12% / 18% DMG.', battleStart(sim, u) { self(sim, u, 'r311', { dmg: (s, a) => { const sp = s.spd(a); return sp >= 160 ? 0.18 : sp >= 135 ? 0.12 : 0; } }, Infinity); } } },
    312: { two: { desc: 'Other allies of her Type +10% DMG.', battleStart(sim, u) { sim.allies(u).filter((a) => a.cfg.char.element === u.cfg.char.element).forEach((a) => sim.addBuff(a, { id: 'r312', stats: { dmg: 0.1 }, turns: Infinity })); } } },
    313: { two: { desc: 'On-kill CRIT DMG (kills aren\'t simulated).' } },
    314: { two: { desc: 'A teammate on the same Path: +12% CRIT Rate.', battleStart(sim, u) { if (sim.allies(u).some((a) => a.cfg.char.path === u.cfg.char.path)) self(sim, u, 'r314', { cr: 0.12 }, Infinity); } } },
    315: {
      two: {
        desc: 'Ally follow-ups: Merit (5 stacks), her Follow-up +5% DMG each; at 5, +25% CRIT DMG.',
        merit(sim, u) { const b = self(sim, u, 'merit315', { dmg_FUA: 0.05 }, Infinity, { maxStacks: 5 }); if (b && b.stacks >= 5) self(sim, u, 'merit315cd', { cd: 0.25 }, Infinity); },
        allyAttack(sim, u, a, t) { if (t === 'FollowUp' && a.kind === 'char') this.merit(sim, u); },
        followUpDone(sim, u) { this.merit(sim, u); },
      },
    },
    316: { two: { desc: 'Hitting a Fire-weak enemy (assumed): +40% Break Effect for 1 turn.', action(sim, u, t) { if (isAtk(t)) self(sim, u, 'r316', { be: 0.4 }, 1); } } },
    317: { two: { desc: 'Not first in the lineup: the first character +12% ATK.', battleStart(sim, u) { const first = sim.chars()[0]; if (first && first !== u) sim.addBuff(first, { id: 'r317', stats: { atkPct: 0.12 }, turns: Infinity }); } } },
    318: { two: { desc: 'With her summon out: +32% CRIT DMG.', battleStart(sim, u) { self(sim, u, 'r318', { cd: (s, a) => (s.units.some((x) => x.alive && x.owner === a && x.kind === 'summon') ? 0.32 : 0) }, Infinity); } } },
    319: { two: { desc: 'At 5000+ Max HP: she and her memosprite +28% CRIT DMG.', battleStart(sim, u) { if (st(sim, u).HP >= 5000) self(sim, u, 'r319', { cd: 0.28 }, Infinity); } } },
    320: { two: { desc: 'Outgoing Healing only (not simulated).' } },
    321: {
      two: {
        desc: 'Ally targets on the field other than 4: +9% DMG per extra (4) / +12% per missing (3), for her and her memosprite.',
        battleStart(sim, u) { self(sim, u, 'r321', { dmg: (s) => { const k = s.chars().length + s.units.filter((x) => x.alive && x.kind === 'summon' && x.memo).length; return k > 4 ? 0.09 * Math.min(4, k - 4) : 0.12 * Math.min(3, 4 - k); } }, Infinity); },
      },
    },
    322: { two: { desc: 'At 2400 / 3600 ATK: +12% / 24% DoT DMG.', battleStart(sim, u) { const atk = st(sim, u).ATK; if (atk >= 2400) self(sim, u, 'r322', { dotDmg: atk >= 3600 ? 0.24 : 0.12 }, Infinity); } } },
    324: {
      two: {
        desc: '3+ SP spent in one turn: +32% CRIT DMG for 3 turns.',
        spUsed(sim, u, by, k) { if (u.state.r324Turn !== sim.turnId) { u.state.r324Turn = sim.turnId; u.state.r324 = 0; } u.state.r324 += k; if (u.state.r324 >= 3) self(sim, u, 'r324', { cd: 0.32 }, 3); },
      },
    },
    325: { two: { desc: 'Elation 40% / 80%: +20% / 32% CRIT DMG.', battleStart(sim, u) { const e = st(sim, u).elation || 0; if (e >= 0.4) self(sim, u, 'r325', { cd: e >= 0.8 ? 0.32 : 0.2 }, Infinity); } } },
    326: { two: { desc: 'Her follow-ups: +24% ATK for 2 turns (on-kill CRIT DMG isn\'t simulated).', followUpDone(sim, u) { self(sim, u, 'r326', { atkPct: 0.24 }, 2); } } },
    327: { two: { desc: 'She and a teammate are both Trailblaze Companions: +32% CRIT DMG.', battleStart(sim, u) { if (COMPANIONS.has(u.cfg.char.id) && sim.allies(u).some((a) => COMPANIONS.has(a.cfg.char.id))) self(sim, u, 'r327', { cd: 0.32 }, Infinity); } } },
    328: { two: { desc: 'Max Energy 200+: +0.2% DMG per point above (max 32%).', battleStart(sim, u) { if (u.maxEnergy >= 200) self(sim, u, 'r328', { dmg: Math.min(0.32, 0.002 * (u.maxEnergy - 200)) }, Infinity); } } },
  };
  window.AVRelicKits = relic;
})();
