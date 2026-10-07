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
  };

  window.AVLightConeKits = lc;
})();
