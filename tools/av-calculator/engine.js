// Action Value simulation engine.
//
// Model (matches the in-game turn system):
// - Every unit runs along a 10,000-unit track. Its remaining distance / SPD = AV until its turn.
// - Action advance X% removes 10,000 * X of distance (floor 0); delay adds it back.
// - A SPD change keeps the remaining distance, so remaining AV scales by oldSPD / newSPD.
// - After a turn the unit's distance resets to 10,000 (base AV = 10000 / SPD).
// - Cycles: the first lasts `firstCycle` AV (150 in most modes), each later cycle 100 AV.
(function () {
  const GAUGE = 10000;
  const EPS = 1e-7;

  function cycleOf(av, firstCycle, cycleLen) {
    if (av <= firstCycle + EPS) return 0;
    return Math.ceil((av - firstCycle - EPS) / cycleLen);
  }

  class Sim {
    constructor({ firstCycle, cycleLen, maxAV }) {
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
    }

    // ---------- units ----------
    addUnit(u) {
      Object.assign(u, {
        dist: GAUGE, buffs: [], actions: 0, alive: true, suspended: false,
        pendingAdvance: 0, extraTurns: 0, state: u.state || {}, hooks: u.hooks || [],
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
      return u;
    }
    spawnCountdown(opts) { return this.spawn({ kind: 'countdown', ...opts }); }
    remove(u) { u.alive = false; }

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
      if (!u || !u.alive) return;
      // Advancing the unit that is mid-turn applies to its *next* action (after the gauge reset).
      if (u === this.current) { u.pendingAdvance += pct; return; }
      u.dist = Math.max(0, u.dist - GAUGE * pct);
      if (u.dist <= EPS) this.markImmediate(u);
    }
    delay(u, pct) { if (u && u.alive) u.dist += GAUGE * pct; }
    actNow(u) {
      if (!u || !u.alive) return;
      if (u === this.current) { u.pendingAdvance += 1; return; }
      u.dist = 0;
      this.markImmediate(u);
    }
    markImmediate(u) { u.dist = 0; u.tb = this.seq++; }
    extraTurn(u) { u.extraTurns += 1; }

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

    // ---------- hooks ----------
    fire(u, name, ...args) {
      let res;
      for (const h of u.hooks) if (h[name]) { const r = h[name](this, u, ...args); if (r !== undefined) res = r; }
      return res;
    }
    fireAll(name, source, ...args) {
      for (const u of [...this.units]) if (u.alive && u !== source) this.fire(u, name, source, ...args);
    }

    record(u, type, extra = {}) {
      this.events.push({
        unit: u, key: u.key, lane: u.lane || u.key, owner: u.owner ? u.owner.key : u.key,
        kind: u.kind, type, av: this.now, cycle: cycleOf(this.now, this.firstCycle, this.cycleLen),
        n: u.kind === 'countdown' ? null : u.actions, spd: this.spd(u), ...extra,
      });
    }

    // ---------- main loop ----------
    run() {
      for (const u of this.chars()) this.fire(u, 'battleStart');
      for (const u of this.chars()) this.fire(u, 'afterBattleStart');
      for (const u of this.chars()) if (this.wantsUlt(u, 0)) this.ult(u);

      let guard = 0;
      while (guard++ < this.maxEvents) {
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

    takeTurn(u, isExtra = false) {
      this.turnId += 1;
      this.current = u;
      if (u.kind === 'countdown') {
        this.record(u, 'Countdown');
        this.remove(u);
        this.current = null;
        u.onTurn && u.onTurn(this, u);
        return;
      }

      this.tickBuffs(u, 'start');
      this.fire(u, 'turnStart');
      const type = u.kind === 'summon' ? 'Summon' : (this.fire(u, 'actionType') || this.patternAction(u));
      u.actions += 1;
      this.record(u, isExtra ? 'Extra' : type);
      if (u.onTurn) u.onTurn(this, u);
      this.fire(u, 'action', type);
      this.fireAll('allyAction', u, type);
      this.tickBuffs(u, 'end');
      this.fire(u, 'turnEnd', type);
      this.current = null;

      if (!u.alive) return;
      if (!isExtra) {
        u.dist = GAUGE;
        u.tb = u.defaultTb;
      }
      if (u.pendingAdvance) { const p = u.pendingAdvance; u.pendingAdvance = 0; this.advance(u, p); }

      if (u.kind === 'char' && this.wantsUlt(u, u.actions)) this.ult(u);

      while (u.extraTurns > 0 && u.alive) {
        u.extraTurns -= 1;
        this.takeTurn(u, true);
      }
    }

    patternAction(u) {
      const p = (u.cfg && u.cfg.pattern) || 'S';
      const ch = p[(u.actions) % p.length].toUpperCase();
      return ch === 'B' ? 'Basic' : ch === 'U' ? 'Enhanced' : 'Skill';
    }

    wantsUlt(u, n) {
      const c = u.cfg;
      if (!c || c.ultFirst < 0) return false;
      if (this.fire(u, 'canUlt') === false) return false;
      if (n < c.ultFirst) return false;
      const every = Math.max(1, c.ultEvery || 1);
      return (n - c.ultFirst) % every === 0;
    }

    ult(u) {
      const prev = this.current;
      this.current = null;
      this.record(u, 'Ultimate', { n: u.actions });
      this.fire(u, 'ult');
      this.fireAll('allyUlt', u);
      this.current = prev;
    }
  }

  window.AVEngine = { Sim, GAUGE, cycleOf };
})();
