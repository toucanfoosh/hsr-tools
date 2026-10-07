// Action Value simulation engine.
//
// Model (matches the in-game turn system):
// - Every unit runs along a 10,000-unit track. Its remaining distance / SPD = AV until its turn.
// - Action advance X% removes 10,000 * X of distance (floor 0); delay adds it back.
// - A SPD change keeps the remaining distance, so remaining AV scales by oldSPD / newSPD.
// - After a turn the unit's distance resets to 10,000 (base AV = 10000 / SPD).
// - Cycles: the first lasts `firstCycle` AV (150 in most modes), each later cycle 100 AV.
// Resources:
// - Energy: characters start at 50%. Gains are multiplied by 1 + Energy Regen Rate unless
//   "fixed". Ultimates fire as soon as Energy is full (or per the slot's timing setting).
// - Skill Points: team pool (3 to start, 5 max + kit bonuses). Basic ATK +1, Skill −1; a
//   Skill that can't be paid for becomes a Basic ATK.
// - Elation: team Punchline; Aha acts on the timeline (SPD from the Elation characters) and
//   each Aha Instant runs every Elation Skill in Participant ID order, then converts the
//   Punchline into Certified Banger (2 turns, tracked per stack) and resets it.
(function () {
  const GAUGE = 10000;
  const EPS = 1e-7;
  // Events that happen on a character's lane but are not one of their turns.
  const NON_TURN = new Set(['Ultimate', 'Elation', 'FollowUp', 'AhaInstant', 'AhaExtra', 'Countdown', 'Enemy', 'Break', 'Frozen']);

  function cycleOf(av, firstCycle, cycleLen) {
    if (av <= firstCycle + EPS) return 0;
    return Math.ceil((av - firstCycle - EPS) / cycleLen);
  }

  class Sim {
    constructor({ elationAttacks = true, firstCycle, cycleLen, maxAV, enemies = 1, enemySpd = 120, enemyHits = 1, enemyLevel = 95, enemyRes = 0.2, enemyBroken = false, enemyToughness = 160 }) {
      this.enemyToughness = enemyToughness;
      this.elationAttacks = elationAttacks;
      this.enemyLevel = enemyLevel;
      this.enemyRes = enemyRes;
      this.enemyBroken = enemyBroken;
      this.enemyMods = [];
      this.damageLog = [];
      this.enemyCount = Math.max(0, enemies);
      this.enemySpd = enemySpd;
      this.enemyHits = enemyHits;
      this.hitsTaken = new Map();
      this.hitsTotal = 0;
      this.inExtraTurn = false;
      this.firstCycle = firstCycle;
      this.cycleLen = cycleLen;
      this.maxAV = maxAV;
      this.now = 0;
      this.units = [];
      this.events = [];
      this.seq = 0;
      this.turnId = 0;
      this.current = null;
      this.maxEvents = 4000;
      this.extraQueue = [];
      // What is currently acting on the timeline (set while hooks run), so advances and extra
      // turns can say where they came from. Cross-unit ones are also listed in `effects`.
      this.cause = null;
      this.effects = [];
      this.sp = 3;
      this.spMax = 5;
      this.punchline = 0;
      this.aha = null;
      this.ahaSpdBonus = 0;
      this.inAha = false;
    }

    // ---------- units ----------
    addUnit(u) {
      Object.assign(u, {
        dist: GAUGE, buffs: [], actions: 0, alive: true, suspended: false,
        pendingAdvance: 0, extraTurns: 0, extraGrants: [], marks: [], state: u.state || {}, hooks: u.hooks || [],
        energy: 0, maxEnergy: u.maxEnergy || 0, errBase: u.errBase || 0, energyOverflow: 0, energyTotal: 0, cb: [],
      });
      u.defaultTb = 1e6 + this.units.length;
      u.tb = u.defaultTb;
      this.units.push(u);
      return u;
    }
    chars() { return this.units.filter((u) => u.kind === 'char' && u.alive); }
    allies(u) { return this.chars().filter((x) => x !== u); }

    spawn(opts) {
      const u = this.addUnit({ kind: 'summon', ...opts });
      u.lane = opts.lane || u.key;
      if (u.memo && u.owner) this.fire(u.owner, 'memoSummoned', u);
      return u;
    }
    spawnCountdown(opts) { return this.spawn({ kind: 'countdown', ...opts }); }
    remove(u) {
      if (!u.alive) return;
      u.alive = false;
      if (u.kind === 'summon' && u.memo && u.owner) this.fire(u.owner, 'memoGone', u);
    }

    spd(u) {
      if (u.spdFn) return Math.max(1, u.spdFn(this, u));
      if (u.fixedSpd) return u.fixedSpd;
      let pct = u.pct, flat = u.flat;
      for (const b of u.buffs) { pct += (b.pct || 0) * (b.stacks || 1); flat += (b.flat || 0) * (b.stacks || 1); }
      return Math.max(1, u.base * (1 + pct) + flat);
    }
    av(u) { return u.dist / this.spd(u); }

    // ---------- turn manipulation ----------
    advance(u, pct) {
      if (u && u.advanceTo) u = u.advanceTo; // e.g. advancing Khaslana advances his countdown
      if (!u || !u.alive || !pct) return;
      this.note(u, 'advance', pct);
      // Advancing the unit that is mid-turn applies to its *next* action (after the gauge reset).
      if (u === this.current) { u.pendingAdvance += pct; return; }
      this.applyAdvance(u, pct);
    }
    applyAdvance(u, pct) {
      u.dist = Math.max(0, u.dist - GAUGE * pct);
      if (u.dist <= EPS) this.markImmediate(u);
    }
    delay(u, pct) { if (u && u.alive) u.dist += GAUGE * pct; }
    actNow(u) {
      if (u && u.advanceTo) u = u.advanceTo;
      if (!u || !u.alive) return;
      this.note(u, 'now');
      if (u === this.current) { u.pendingAdvance += 1; return; }
      u.dist = 0;
      this.markImmediate(u);
    }
    markImmediate(u) { u.dist = 0; u.tb = this.seq++; }
    // An extra turn granted during the unit's own turn runs right after it; one granted from
    // outside (e.g. an ally's Ultimate) runs as soon as the current action resolves.
    extraTurn(u) {
      if (!u || !u.alive) return;
      const grant = this.note(u, 'extra');
      if (u === this.current) { u.extraTurns += 1; u.extraGrants.push(grant); }
      else this.extraQueue.push([u, grant]);
    }
    flushExtraTurns() {
      while (this.extraQueue.length) {
        const [u, grant] = this.extraQueue.shift();
        if (u.alive) this.takeTurn(u, true, grant);
      }
    }

    // ---------- attribution ----------
    // Records why `target` was advanced / pulled / given an extra turn. Advances are attached
    // to the target's next turn (see record); ones caused by another unit also go in `effects`.
    note(target, kind, amount) {
      const c = this.cause;
      if (!c) return null;
      const m = { kind, amount, by: c.by, text: causeText(c), av: this.now };
      if (kind !== 'extra') target.marks.push(m);
      if (c.by !== target) this.effects.push({ ...m, target });
      return m;
    }
    withCause(cause, fn) {
      const prev = this.cause;
      this.cause = cause;
      try { return fn(); } finally { this.cause = prev; }
    }
    // The ally a character's Skill/Ultimate is aimed at (the "Ability target" in the UI).
    targetOf(u) {
      const allies = this.allies(u);
      return allies.find((a) => a.cfg.slot === u.cfg.target) || allies[0] || null;
    }

    // ---------- buffs ----------
    // tick: 'end'   -> counts down at the end of the holder's turns (default in HSR)
    //       'start' -> counts down at the start of the holder's turns
    //       'owner' -> counts down at the start of the owner's (caster's) turns
    addBuff(target, b) {
      if (!target || !target.alive) return;
      const existing = target.buffs.find((x) => x.id === b.id);
      const applied = this.current === target ? this.turnId : -1;
      if (existing) {
        existing.turns = b.turns ?? existing.turns;
        existing.appliedTurn = applied;
        if (b.maxStacks) existing.stacks = Math.min(b.maxStacks, (existing.stacks || 1) + 1);
        if (b.pct !== undefined) existing.pct = b.pct;
        if (b.flat !== undefined) existing.flat = b.flat;
        return existing;
      }
      const nb = { tick: 'end', turns: 1, stacks: 1, ...b, appliedTurn: applied };
      target.buffs.push(nb);
      return nb;
    }
    removeBuff(target, id) { target.buffs = target.buffs.filter((b) => b.id !== id); }
    hasBuff(target, id) { return target.buffs.some((b) => b.id === id); }

    tickBuffs(u, phase) {
      for (const holder of this.units) {
        holder.buffs = holder.buffs.filter((b) => {
          const mine = phase === 'start'
            ? (b.tick === 'start' && holder === u) || (b.tick === 'owner' && b.owner === u)
            : b.tick === 'end' && holder === u && b.appliedTurn !== this.turnId;
          if (!mine || b.turns === Infinity) return true;
          b.turns -= 1;
          return b.turns > 0;
        });
      }
    }

    // Suspend every unit except `keep` (e.g. teammates "depart" during Khaslana's transformation).
    // Returns a function that restores exactly the units it suspended.
    departAll(keep) {
      // Only the party departs: enemies and Aha keep acting.
      const gone = this.units.filter((x) => x.alive && !x.suspended && !keep.includes(x) && x.kind !== 'enemy' && x.kind !== 'aha');
      gone.forEach((x) => { x.suspended = true; });
      return () => gone.forEach((x) => { x.suspended = false; });
    }
    kitOf(u) { return u.hooks && u.hooks.find((h) => h.src === 'kit'); }

    // ---------- energy ----------
    err(u) {
      let e = u.errBase || 0;
      for (const b of u.buffs) e += ((b.err || 0) + ((b.stats && typeof b.stats.err === 'number') ? b.stats.err : 0)) * (b.stacks || 1);
      return e;
    }
    // Returns the Energy actually added. `fixed` gains ignore Energy Regeneration Rate.
    gainEnergy(u, amt, { fixed = false } = {}) {
      if (!u || !u.alive || u.kind !== 'char' || !(u.maxEnergy > 0) || !amt) return 0;
      const eff = fixed ? amt : amt * (1 + this.err(u));
      const before = u.energy;
      u.energy = Math.min(u.maxEnergy + (u.energyOverflow || 0), u.energy + eff);
      u.energyTotal += eff;
      this.fire(u, 'energyGained', eff, { fixed });
      return u.energy - before;
    }
    energyFull(u) { return u.maxEnergy > 0 && u.energy >= u.maxEnergy - 1e-6; }
    // Base Energy from an ability of the given type, per the game data (first of that type).
    abilityEnergy(u, type, nth = 0) {
      const list = (u.cfg.char.combat.abilities || []).filter((a) => a.type === type && !a.memo);
      const a = list[nth] || list[0];
      return (a && a.energy) || 0;
    }
    actionEnergy(u, act) {
      const kitE = this.fire(u, 'energyFor', act);
      if (kitE !== undefined) return kitE;
      if (act === 'Basic') return this.abilityEnergy(u, 'Basic');
      if (act === 'Skill') return this.abilityEnergy(u, 'Skill');
      if (act === 'Enhanced') {
        // Usually the enhanced variant is listed second (Basic first, then Skill).
        const b = (u.cfg.char.combat.abilities || []).filter((a) => a.type === 'Basic' && !a.memo);
        const k = (u.cfg.char.combat.abilities || []).filter((a) => a.type === 'Skill' && !a.memo);
        return (b[1] && b[1].energy) || (k[1] && k[1].energy) || 0;
      }
      return 0;
    }

    // "When X becomes the target of an ally's ability": kits list single-ally abilities in
    // `allyTarget` ({ Skill: 1, Ultimate: 1 }).
    fireTargeted(u, type) {
      if (u.kind !== 'char') return;
      if (!u.hooks.some((h) => h.allyTarget && h.allyTarget[type])) return;
      const tg = this.targetOf(u);
      if (tg) this.fire(tg, 'targeted', u, type);
    }

    // Is this action an attack (for "after an ally attacks" effects)? Support Skills / Ultimates
    // (Robin, Sunday, Bronya...) are not; damaging ones are, per the ability's tag in the data.
    isAttack(u, act) {
      if (u.kind === 'summon') return !u.noAttack;
      if (u.kind !== 'char') return false;
      const kit = this.fire(u, 'isAttack', act);
      if (kit !== undefined) return kit;
      if (act === 'Basic' || act === 'Enhanced' || act === 'Final' || act === 'FollowUp' || act === 'Assist') return true;
      const type = act === 'Skill' ? 'Skill' : act === 'Ult' ? 'Ult' : null;
      if (!type) return false;
      const a = (u.cfg.char.combat.abilities || []).find((x) => x.type === type && !x.memo);
      return !!(a && /Single Target|Blast|AoE|Bounce/.test(a.tag || ''));
    }

    // ---------- skill points ----------
    // Positive = consumed, negative = recovered. Kits override with `spCost`.
    spCost(u, act) {
      const k = this.fire(u, 'spCost', act);
      if (k !== undefined) return k;
      return act === 'Basic' ? -1 : act === 'Skill' ? 1 : 0;
    }
    gainSP(n, by = null) {
      if (!n) return;
      const before = this.sp;
      this.sp = Math.min(this.spMax, this.sp + n);
      this.fireEvery('spGained', by, this.sp - before, n - (this.sp - before));
    }
    useSP(n, by = null) {
      if (!n) return;
      this.sp = Math.max(0, this.sp - n);
      this.fireEvery('spUsed', by, n);
    }

    // ---------- damage ----------
    // Enemy debuffs (DEF / RES down, DMG taken up). Same id replaces; ticks once per enemy round.
    addEnemyMod(mod) {
      this.enemyMods = this.enemyMods.filter((m) => m.id !== mod.id);
      this.enemyMods.push({ turns: 2, ...mod });
    }
    tickEnemyMods() {
      this.enemyMods = this.enemyMods.filter((m) => m.turns === Infinity || --m.turns > 0);
    }
    // DMG of one event (0 if the damage module isn't loaded). Summons credit their owner.
    dealDamage(u, act, extra = {}) {
      if (!window.AVDamage) return 0;
      const amt = window.AVDamage.dealDamage(this, u, act, extra) || 0;
      if (amt) this.creditDamage(u.kind === 'summon' ? u.owner : u, amt, extra.label || act);
      return amt;
    }
    // Damage over time on the enemies: applied by an ability, ticks at each enemy's turn start.
    addDot(dot) {
      this.dots = (this.dots || []).filter((d) => d.id !== dot.id);
      this.dots.push({ turns: 2, ...dot });
    }
    tickDots(enemy) {
      if (!this.dots || !window.AVDamage) return;
      for (const d of this.dots) this.addDamage(d.src, window.AVDamage.dotDamage(this, d), 'DoT');
      if (enemy === this.enemies()[0]) this.dots = this.dots.filter((d) => d.turns === Infinity || --d.turns > 0);
    }
    // Damage not tied to an event marker (e.g. Robin's Concerto hits).
    addDamage(u, amt, label) { if (amt) this.creditDamage(u, amt, label); }
    creditDamage(u, amt, label) {
      if (!u) return;
      u.dmgTotal = (u.dmgTotal || 0) + amt;
      this.damageLog.push({ unit: u, av: this.now, amt, label, cycle: cycleOf(this.now, this.firstCycle, this.cycleLen) });
    }

    // ---------- enemies ----------
    // Enemies take turns at a fixed SPD. Each turn: DoT ticks (hook), then `enemyHits` hits on
    // allies. Hits go to allies in proportion to their taunt (deterministic: the ally furthest
    // below their fair share is hit next). A hit gives 10 Energy and triggers "when hit" kits.
    initEnemies() {
      for (let i = 0; i < this.enemyCount; i++) {
        this.addUnit({ kind: 'enemy', key: `enemy${i}`, lane: 'enemy', name: `Enemy ${i + 1}`, base: this.enemySpd, pct: 0, flat: 0, tough: this.enemyToughness, broken: false });
      }
    }
    enemies() { return this.units.filter((u) => u.kind === 'enemy' && u.alive); }
    taunt(u) {
      const k = this.fireProduct(u, 'tauntMult');
      const b = u.buffs.reduce((a, x) => a * (x.tauntMult || 1), 1);
      return (u.cfg.char.combat.base.taunt || 100) * k * b;
    }
    pickVictim() {
      const pool = this.chars().filter((u) => !u.suspended);
      if (!pool.length) return null;
      const total = pool.reduce((a, u) => a + this.taunt(u), 0);
      let best = null, bestGap = -Infinity;
      for (const u of pool) {
        const gap = (this.hitsTotal + 1) * this.taunt(u) / total - (this.hitsTaken.get(u) || 0);
        if (gap > bestGap + 1e-9) { best = u; bestGap = gap; }
      }
      return best;
    }
    // Weakness Break: the enemy's Toughness hit 0. It takes full DMG until its next turn, when it
    // recovers; its action is delayed 25%.
    breakEnemy(e, by) {
      e.broken = true;
      e.tough = 0;
      this.delay(e, 0.25);
      this.record(e, 'Break', { by: by && by.name });
      if (window.AVDamage) this.addDamage(by, window.AVDamage.breakDamage(this, by), 'Break');
      this.fireEvery('weaknessBreak', by, e);
    }
    brokenShare() {
      const es = this.enemies();
      return es.length ? es.filter((e) => e.broken).length / es.length : 0;
    }
    enemyTurn(e) {
      if (e.broken) { e.broken = false; e.tough = this.enemyToughness; }
      this.tickDots(e);
      this.fireEvery('enemyTurnStart', e);
      if (e === this.enemies()[0]) this.tickEnemyMods();
      for (let h = 0; h < this.enemyHits; h++) {
        const v = this.pickVictim();
        if (!v) break;
        this.hitsTaken.set(v, (this.hitsTaken.get(v) || 0) + 1);
        this.hitsTotal += 1;
        this.gainEnergy(v, 10);
        this.withCause({ by: e, label: e.name, hook: 'enemy' }, () => {
          this.fire(v, 'hit', e);
          this.fireAll('allyHit', v, e);
        });
      }
    }
    // ---- debuffs on enemies
    // Deterministic effect chance: base × (1 + EHR) × (1 − 20% Effect RES), accumulated so e.g.
    // a 50% chance succeeds every other try.
    chance(u, key, base) {
      const ehr = u && u.stats0 && window.AVDamage ? window.AVDamage.liveStats(this, u).ehr : 0;
      const p = Math.min(1, base * (1 + ehr) * 0.8);
      u.state.chanceAcc = u.state.chanceAcc || {};
      const acc = (u.state.chanceAcc[key] || 0) + p;
      if (acc >= 1 - 1e-9) { u.state.chanceAcc[key] = acc - 1; return true; }
      u.state.chanceAcc[key] = acc;
      return false;
    }
    // Targets of an enemy-side effect: 'main' (first enemy), 'blast' (main + adjacent), 'all'.
    enemyTargets(scope = 'all') {
      const es = this.enemies();
      return scope === 'main' ? es.slice(0, 1) : scope === 'blast' ? es.slice(0, 3) : es;
    }
    // SPD reduction (Slow) on enemies: a buff with negative pct on each targeted enemy.
    slowEnemies(id, pct, turns, scope = 'all') {
      for (const e of this.enemyTargets(scope)) this.addBuff(e, { id, pct: -pct, turns, debuff: true });
    }
    delayEnemies(pct, scope = 'all') { for (const e of this.enemyTargets(scope)) this.delay(e, pct); }
    freezeEnemy(e, src, mult) { if (e && e.alive) e.frozen = { src, mult }; }
    isSlowed(e = this.enemies()[0]) { return !!(e && e.buffs.some((b) => b.debuff && (b.pct || 0) < 0)); }
    // Number of debuffs on an enemy (DEF / RES / vulnerability mods, DoTs, slows, Freeze).
    debuffCount(e = this.enemies()[0]) {
      const mods = (this.enemyMods || []).filter((m) => m.def || m.res || m.vuln || m.vulnType || m.debuff).length;
      const slows = e ? e.buffs.filter((b) => b.debuff).length : 0;
      return mods + (this.dots || []).length + slows + (e && e.frozen ? 1 : 0);
    }

    // How many enemies an ability hits (for "per target hit" effects).
    targetsHit(u, act) {
      const n = Math.max(1, this.enemyCount);
      if (u.kind === 'summon') return 1;
      const type = act === 'Skill' ? 'Skill' : act === 'Ult' ? 'Ult' : 'Basic';
      const a = (u.cfg.char.combat.abilities || []).find((x) => x.type === type && !x.memo);
      const tag = (a && a.tag) || '';
      return /AoE|Bounce/.test(tag) ? n : /Blast/.test(tag) ? Math.min(3, n) : 1;
    }

    // ---------- elation ----------
    elationChars() {
      return this.chars().filter((u) => u.cfg.char.combat.elationPid)
        .sort((a, b) => a.cfg.char.combat.elationPid - b.cfg.char.combat.elationPid);
    }
    addPunchline(n, by = null) {
      if (!n) return;
      this.punchline += n;
      this.fireEvery('punchline', by, n);
    }
    cbTotal(u) { return u.cb.reduce((a, x) => a + x.amt, 0); }
    // Certified Banger: each gain is its own stack lasting `turns` of the holder's turns.
    gainCB(u, amt, { turns = 2, src = null } = {}) {
      if (!u || !u.alive || !(amt > 0)) return;
      const mode = this.fire(u, 'cbMode');
      if (mode && mode.cap) {
        const cur = this.cbTotal(u);
        amt = Math.max(0, Math.min(amt, mode.cap - cur));
        if (!amt) return;
      }
      const ext = this.fire(u, 'cbTurns') || 0;
      u.cb.push({ amt, turns: mode && mode.turns ? mode.turns : turns + ext, appliedTurn: this.current === u ? this.turnId : -1 });
      this.fire(u, 'cbGained', amt, src);
      this.fireAll('allyCBGained', u, amt, src);
    }
    tickCB(u) {
      const keep = [];
      for (const st of u.cb) {
        if (st.turns === Infinity || st.appliedTurn === this.turnId) { keep.push(st); continue; }
        st.turns -= 1;
        if (st.turns > 0) keep.push(st);
        else { this.fire(u, 'cbEnd', st.amt); this.fireAll('allyCBEnd', u, st.amt); }
      }
      u.cb = keep;
    }
    initElation() {
      const el = this.elationChars();
      if (!el.length) return;
      this.punchline = el.length;
      for (const u of el) this.gainCB(u, 20, { src: 'battle start' });
      this.aha = this.addUnit({
        kind: 'aha', key: 'aha', lane: 'aha', name: 'Aha', icon: null,
        spdFn: (s) => {
          const spds = s.elationChars().map((x) => s.spd(x)).sort((a, b) => b - a);
          return 80 + (spds[0] || 0) / 5 + (spds[1] || 0) / 10 + (spds[2] || 0) / 20 + (spds[3] || 0) / 40 + s.ahaSpdBonus;
        },
      });
    }
    // Aha's extra turn (e.g. Yao Guang's Ultimate): an Aha Instant with a fixed Punchline.
    ahaExtraTurn(fixed) {
      if (!this.aha) return;
      this.aha.state.fixedQueue = (this.aha.state.fixedQueue || []).concat([fixed]);
      this.extraTurn(this.aha);
    }
    ahaInstant(fixed = null) {
      const parts = this.elationChars().filter((u) => !u.suspended);
      this.inAha = true;
      for (const u of parts) this.elationSkill(u, fixed);
      this.inAha = false;
      const amt = fixed != null ? fixed : this.punchline;
      for (const u of parts) this.gainCB(u, amt, { src: 'Aha Instant' });
      this.ahaSpdBonus = 0;
      if (fixed == null) {
        this.punchline = 0;
        this.addPunchline(this.elationChars().length);
      }
      this.fireEvery('ahaEnd', null, { fixed });
    }
    // One use of a character's Elation Skill (inside an Aha Instant or triggered by a kit).
    elationSkill(u, fixed = null, extra = {}) {
      const pl = fixed != null ? fixed : this.punchline;
      const prev = this.current;
      this.current = null;
      const ev = this.record(u, 'Elation', { punchline: pl, n: u.actions, ...extra });
      this.withCause({ by: u, label: u.name, hook: 'elation' }, () => this.fire(u, 'elation', { punchline: pl, fixed, ...extra }));
      ev.dmg = this.dealDamage(u, 'Elation', { punchline: pl, label: extra.label });
      // Damaging Elation Skills count as attacks unless the team setting turns that off.
      if (this.elationAttacks && ev.dmg > 0) this.fireAll('allyAttack', u, 'Elation');
      this.gainEnergy(u, this.abilityEnergy(u, 'Elation'));
      this.snap(ev, u);
      this.fireAll('allyElation', u, { punchline: pl });
      this.current = prev;
    }

    // ---------- hooks ----------
    fire(u, name, ...args) {
      let res;
      for (const h of u.hooks) {
        if (!h[name]) continue;
        const r = this.withCause({ by: u, label: h.label, src: h.src, hook: name, act: args[0] }, () => h[name](this, u, ...args));
        if (r !== undefined) res = r;
      }
      return res;
    }
    fireAll(name, source, ...args) {
      for (const u of [...this.units]) if (u.alive && u !== source) this.fire(u, name, source, ...args);
    }
    // Hooks whose results combine: multiply (damage scales) or add (extra damage).
    fireProduct(u, name, ...args) {
      let r = 1;
      for (const h of u.hooks) if (h[name]) { const v = h[name](this, u, ...args); if (typeof v === 'number') r *= v; }
      return r;
    }
    fireSum(u, name, ...args) {
      let r = 0;
      for (const h of u.hooks) if (h[name]) { const v = h[name](this, u, ...args); if (typeof v === 'number') r += v; }
      return r;
    }
    // Like fireAll but includes the source (team-wide resources: SP, Punchline...).
    fireEvery(name, source, ...args) {
      for (const u of [...this.units]) if (u.alive) this.fire(u, name, source, ...args);
    }

    record(u, type, extra = {}) {
      const ev = {
        unit: u, key: u.key, lane: u.lane || u.key, owner: u.owner ? u.owner.key : u.key,
        kind: u.kind, type, av: this.now, cycle: cycleOf(this.now, this.firstCycle, this.cycleLen),
        n: u.kind === 'countdown' ? null : u.actions, spd: this.spd(u),
        nonTurn: NON_TURN.has(type), sp: this.sp, punchline: this.punchline,
        ...(u.kind === 'char' ? { energy: u.energy, maxEnergy: u.maxEnergy, cb: this.cbTotal(u) } : {}),
        ...extra,
      };
      this.events.push(ev);
      return ev;
    }
    // Resources after an event resolves (tooltips and the Energy line show the result).
    snap(ev, u) {
      if (!ev) return;
      ev.sp = this.sp; ev.punchline = ev.kind === 'aha' || ev.type === 'Elation' ? ev.punchline : this.punchline;
      if (u && u.kind === 'char') { ev.energy = u.energy; ev.cb = this.cbTotal(u); }
    }

    // ---------- main loop ----------
    run() {
      for (const u of this.chars()) u.energy = u.maxEnergy * 0.5;
      this.initElation();
      this.initEnemies();
      for (const u of this.chars()) this.fire(u, 'battleStart');
      for (const u of this.chars()) this.fire(u, 'afterBattleStart');
      // Energy after battle-start effects: a battle-start Ultimate needs it full.
      for (const u of this.chars()) u.startEnergy = u.energy;
      for (const u of this.chars()) if (!(u.maxEnergy > 0) || this.energyFull(u)) this.checkUlt(u, 0);
      // Holders whose target is missing fire straight away.
      for (const u of this.chars()) if (u.state.ultHeld && !this.targetOf(u)) this.releaseUlt(u);

      let guard = 0;
      while (guard++ < this.maxEvents) {
        this.flushExtraTurns();
        if (this.autoUlts()) continue;
        const u = this.pickNext();
        if (!u) break;
        const dt = this.av(u);
        if (this.now + dt > this.maxAV + EPS) break;
        this.elapse(dt);
        this.takeTurn(u);
      }
      return this.events;
    }

    pickNext() {
      let best = null, bestAv = Infinity;
      for (const u of this.units) {
        if (!u.alive || u.suspended) continue;
        const a = this.av(u);
        if (a < bestAv - EPS || (Math.abs(a - bestAv) <= EPS && u.tb < best.tb)) { best = u; bestAv = a; }
      }
      return best;
    }

    elapse(dt) {
      if (dt <= 0) return;
      for (const u of this.units) if (u.alive && !u.suspended) u.dist = Math.max(0, u.dist - this.spd(u) * dt);
      this.now += dt;
    }

    takeTurn(u, isExtra = false, grant = null) {
      this.turnId += 1;
      this.current = u;
      if (u.kind === 'countdown') {
        this.record(u, 'Countdown');
        this.remove(u);
        this.current = null;
        if (u.onTurn) this.withCause({ by: u.owner || u, label: u.name, hook: 'countdown' }, () => u.onTurn(this, u));
        return;
      }

      if (u.kind === 'enemy') {
        this.tickBuffs(u, 'start');
        if (u.frozen) {
          // Frozen: the turn is skipped (Freeze DMG ticks), then the next action is advanced 50%.
          const fz = u.frozen; u.frozen = null;
          this.record(u, 'Frozen');
          this.current = null;
          if (fz.src && window.AVDamage && fz.mult) this.addDamage(fz.src, window.AVDamage.standard(this, fz.src, fz.mult), 'Freeze');
          this.tickBuffs(u, 'end');
          u.dist = GAUGE; u.tb = u.defaultTb;
          this.applyAdvance(u, 0.5);
          return;
        }
        this.record(u, 'Enemy');
        this.current = null;
        this.enemyTurn(u);
        this.tickBuffs(u, 'end');
        u.dist = GAUGE; u.tb = u.defaultTb;
        return;
      }
      if (u.kind === 'aha') {
        const fixed = isExtra && u.state.fixedQueue && u.state.fixedQueue.length ? u.state.fixedQueue.shift() : null;
        this.record(u, isExtra ? 'AhaExtra' : 'AhaInstant', { punchline: fixed != null ? fixed : this.punchline, grant });
        this.current = null;
        this.withCause({ by: u, label: 'Aha', hook: 'aha' }, () => this.ahaInstant(fixed));
        if (!isExtra) { u.dist = GAUGE; u.tb = u.defaultTb; }
        return;
      }

      const prevExtra = this.inExtraTurn;
      this.inExtraTurn = isExtra;
      this.tickBuffs(u, 'start');
      this.fire(u, 'turnStart');
      if (u.kind === 'char') this.fireAll('allyTurnStart', u);
      let type = u.kind === 'summon' ? 'Summon' : (this.fire(u, 'actionType') || this.patternAction(u));
      // Himeko • Nova's Assist Skill replaces the action when the team setting says to use it.
      if (u.kind === 'char' && this.assist && (type === 'Basic' || type === 'Skill') && this.assist.wants(this, u)) type = 'Assist';
      // A Skill the team can't pay for becomes a Basic ATK.
      if (u.kind === 'char' && type === 'Skill' && this.spCost(u, 'Skill') > this.sp + 1e-9) type = 'Basic';
      u.actions += 1;
      // A regular turn uses up the advances since the last one; an extra turn doesn't touch
      // the action gauge, so those stay attached to the next regular turn.
      let ev;
      if (isExtra) ev = this.record(u, 'Extra', { act: type, grant });
      else { ev = this.record(u, type, { act: type, advances: u.marks }); u.marks = []; }
      if (u.onTurn) this.withCause({ by: u, label: u.name, hook: 'turn' }, () => u.onTurn(this, u));
      if (u.kind === 'char') {
        const c = this.spCost(u, type);
        if (c > 0) this.useSP(c, u); else if (c < 0) this.gainSP(-c, u);
        this.gainEnergy(u, this.actionEnergy(u, type));
      }
      this.fire(u, 'action', type);
      this.fireTargeted(u, type);
      ev.dmg = this.dealDamage(u, type);
      this.fire(u, 'afterDamage', type);
      this.fireAll('allyAction', u, type);
      if (this.isAttack(u, type)) this.fireAll('allyAttack', u, type);
      this.tickBuffs(u, 'end');
      if (u.kind === 'char') this.tickCB(u);
      this.snap(ev, u);
      this.fire(u, 'turnEnd', type);
      if (u.kind === 'char' && !u.extraTurns) this.fireAll('allyTurnEnd', u);
      this.current = null;
      this.inExtraTurn = prevExtra;

      if (!u.alive) return;
      if (!isExtra) {
        u.dist = GAUGE;
        u.tb = u.defaultTb;
      }
      if (u.pendingAdvance) { const p = u.pendingAdvance; u.pendingAdvance = 0; this.applyAdvance(u, Math.min(1, p)); }

      if (u.kind === 'char') {
        if (u.state.ultHeld) u.state.ultHeld.acts += 1;
        this.checkUlt(u, u.actions);
      }

      while (u.extraTurns > 0 && u.alive) {
        u.extraTurns -= 1;
        this.takeTurn(u, true, u.extraGrants.shift() || null);
      }

      // Ultimates held for this character fire right after its turn.
      if (!isExtra && u.kind === 'char') {
        for (const h of this.chars()) if (h !== u && h.state.ultHeld && this.targetOf(h) === u) this.releaseUlt(h);
      }
    }

    // How a character's Ultimate becomes available: a kit resource (Coreflame, Recollection...),
    // Energy, or (no Energy data / manual timing) the "Ult after # / then every" schedule.
    // The hook object (kit or energy layer) that owns a resource-based Ultimate, if any.
    ultKit(u) { return u.hooks && u.hooks.find((h) => h.ultReady); }
    ultResource(u) {
      if (this.ultKit(u)) return 'kit';
      if (u.maxEnergy > 0 && u.cfg.ultTiming !== 'schedule') return 'energy';
      return 'schedule';
    }
    ultIsReady(u) {
      const r = this.ultResource(u);
      if (r === 'kit') { const k = this.ultKit(u); return k.ultReady(this, u); }
      if (r === 'energy') return this.energyFull(u);
      return false;
    }
    // Schedule-based Ultimates, checked after each of the character's own actions.
    // 'target' timing holds the Ultimate until the ability target finishes a turn.
    checkUlt(u, n) {
      const c = u.cfg;
      if (!c || c.ultFirst < 0 || this.ultResource(u) !== 'schedule') return;
      if (c.ultTiming !== 'target') { if (this.wantsUlt(u, n)) this.ult(u); return; }
      if (u.state.ultHeld || this.fire(u, 'canUlt') === false) return;
      if (u.state.nextUlt === undefined) u.state.nextUlt = c.ultFirst;
      if (n < u.state.nextUlt) return;
      u.state.ultHeld = { since: this.now, acts: 0 };
      if (!this.targetOf(u)) this.releaseUlt(u);
    }
    // Resource-based Ultimates fire as soon as they're ready, between any two actions (or are
    // held for the target with 'target' timing). Returns true if one fired.
    autoUlts() {
      for (const u of this.chars()) {
        if ((u.suspended && !u.hooks.some((h) => h.ultWhileSuspended)) || u.cfg.ultFirst < 0 || u.state.ultHeld) continue;
        if (this.ultResource(u) === 'schedule') continue;
        if (this.fire(u, 'canUlt') === false || !this.ultIsReady(u)) continue;
        if (u.cfg.ultTiming === 'target' && this.targetOf(u)) {
          u.state.ultHeld = { since: this.now, acts: 0 };
          continue;
        }
        this.ult(u);
        return true;
      }
      return false;
    }

    releaseUlt(u) {
      const h = u.state.ultHeld;
      u.state.ultHeld = null;
      u.state.nextUlt = u.actions + Math.max(1, u.cfg.ultEvery || 1);
      this.ult(u, { heldAV: this.now - h.since, heldActs: h.acts });
    }

    patternAction(u) {
      const p = (u.cfg && u.cfg.pattern) || 'S';
      const ch = p[(u.actions) % p.length].toUpperCase();
      return ch === 'B' ? 'Basic' : ch === 'U' ? 'Enhanced' : ch === 'A' && this.assist ? 'Assist' : 'Skill';
    }

    wantsUlt(u, n) {
      const c = u.cfg;
      if (!c || c.ultFirst < 0) return false;
      if (this.fire(u, 'canUlt') === false) return false;
      if (n < c.ultFirst) return false;
      const every = Math.max(1, c.ultEvery || 1);
      return (n - c.ultFirst) % every === 0;
    }

    ult(u, extra = {}) {
      const prev = this.current;
      this.current = null;
      // Energy is spent (overflow above the max carries over); "activated" Ultimates are free.
      const spent = u.maxEnergy > 0 && !extra.activated ? Math.min(u.energy, u.maxEnergy) : 0;
      if (spent) u.energy -= spent;
      const ev = this.record(u, 'Ultimate', { n: u.actions, spent, ...extra });
      this.fire(u, 'ult', { spent });
      this.fireTargeted(u, 'Ultimate');
      ev.dmg = this.dealDamage(u, 'Ult');
      this.fire(u, 'afterDamage', 'Ult');
      this.fireAll('allyUlt', u, { spent });
      if (this.isAttack(u, 'Ult')) this.fireAll('allyAttack', u, 'Ult');
      this.gainEnergy(u, this.abilityEnergy(u, 'Ult'));
      this.snap(ev, u);
      this.current = prev;
    }
  }

  // "Pearl's Ultimate", "Dance! Dance! Dance! (Tingyun's Ultimate)", "Sprightly Vonwacq (2pc) at battle start"...
  const PHRASE = {
    ult: 'Ultimate', battleStart: 'battle start', afterBattleStart: 'battle start',
    allyAction: 'talent', allyUlt: 'talent', trace: 'trace', turnStart: 'turn start', turnEnd: 'turn end', turn: 'turn',
  };
  const ACT = { Basic: 'Basic ATK', Skill: 'Skill', Enhanced: 'enhanced attack', Summon: 'turn', Extra: 'extra turn', Final: 'final hit' };
  function causeText(c) {
    if (c.hook === 'countdown') return `${c.label} ending`;
    const who = c.by.name;
    const phrase = c.hook === 'action' ? ACT[c.act] || c.act : PHRASE[c.hook] || c.hook;
    const atStart = phrase === 'battle start';
    if (!c.label || c.src === 'kit' || c.label === who) return atStart ? `${who} at battle start` : `${who}'s ${phrase}`;
    return atStart ? `${c.label} at battle start` : `${c.label} (${who}'s ${phrase})`;
  }

  window.AVEngine = { Sim, GAUGE, cycleOf };
})();
