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
  };

  window.AVLightConeKits = lc;
})();
