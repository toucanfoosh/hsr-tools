// Energy, Skill Point and Elation behaviour per character (Novaflare kits), layered on top of
// the turn-order kits in effects.js. The engine already handles the standard gains: Basic ATK
// / Skill / Ultimate / Elation Skill Energy from the game data, Skill Point use and recovery,
// 50% starting Energy and Energy from enemy hits. These hooks add everything else: off-turn
// gains, battle-start gains, follow-ups, Energy given to allies, SP generators and the Elation
// resources (Punchline, Certified Banger).
//
// Conventions: `G(sim, u, n)` regenerates Energy (scaled by Energy Regeneration Rate);
// `F(sim, u, n)` is a fixed amount. Values are the Lv. 10 / Lv. 12 (Eidolon) figures.
(function () {
  const ATTACKS = new Set(['Basic', 'Skill', 'Enhanced', 'Extra', 'Final']);
  const E = (u) => u.cfg.eidolon;
  const G = (sim, u, n) => sim.gainEnergy(u, n);
  const F = (sim, u, n) => sim.gainEnergy(u, n, { fixed: true });
  const target = (sim, u) => sim.targetOf(u);
  const isAttack = (t) => ATTACKS.has(t);
  const elationCount = (sim) => sim.chars().filter((a) => a.cfg.char.path === 'Elation').length;
  // A unit's own follow-up attack: recorded on its lane, gives Energy, and lets allies react.
  function followUp(sim, u, energy, name = 'Follow-up', extra = {}) {
    const ev = sim.record(u, 'FollowUp', { label: name, n: u.actions, ...extra });
    ev.dmg = sim.dealDamage(u, 'FollowUp', { label: name });
    if (energy) G(sim, u, energy);
    sim.snap(ev, u);
    sim.fire(u, 'followUpDone', name);
    sim.fireAll('allyAttack', u, 'FollowUp');
  }
  // Which abilities apply debuffs (Acheron's Slashed Dream). Nihility Skills and Ultimates by
  // default, plus known Basic ATK debuffers and non-Nihility debuffers.
  const DEBUFF_BASIC = new Set(['1006', '1218', '1307', '1410', '1405', '1004']);
  const DEBUFF_OTHER = { 1305: ['Skill'], 1112: ['Skill'], 1215: ['Skill'], 1304: ['Ult'], 1405: ['Skill', 'Ult'],
    1223: ['Skill'], 1001: ['Ult'], 1104: ['Skill'], 1303: ['Ult'], 1502: ['Elation'] };
  function appliesDebuff(u, t) {
    if (!u.cfg) return false;
    const ch = u.cfg.char;
    if (t === 'Basic' && DEBUFF_BASIC.has(ch.id)) return true;
    if (DEBUFF_OTHER[ch.id]) return DEBUFF_OTHER[ch.id].includes(t);
    return ch.path === 'Nihility' && (t === 'Skill' || t === 'Ult' || t === 'Enhanced');
  }
  function O(u, key, def) {
    const v = u.cfg.opts && u.cfg.opts[key];
    return v === undefined || v === '' ? def : v;
  }

  const kits = {
    // ------------------------------------------------------------------ 1xxx
    1001: { // March 7th (Preservation): counters when a shielded ally is hit (2/turn, E4: 3).
      desc: 'Energy: Counter (+10) when a shielded ally is hit (up to 2 per turn, E4: 3).',
      turnStart(sim, u) { u.state.counters = 0; },
      allyHit(sim, u, victim) { this.counter(sim, u); },
      hit(sim, u) { this.counter(sim, u); },
      counter(sim, u) {
        if ((u.state.counters || 0) >= (E(u) >= 4 ? 3 : 2)) return;
        u.state.counters = (u.state.counters || 0) + 1;
        followUp(sim, u, 10, 'Counter');
      },
    },
    1003: { desc: 'Energy: standard (Victory Rush is in the audit kit).' }, // Himeko
    1004: { // Welt (Novaflare): Skill bounces 5 hits at 6 Energy each; +30 at battle start; Ult +5 more.
      desc: 'Energy: Skill 5 hits × 6. +30 at battle start. Ultimate restores 5 more.',
      energyFor(sim, u, t) { return t === 'Skill' ? 30 : undefined; },
      battleStart(sim, u) { G(sim, u, 30); },
      ult(sim, u) { G(sim, u, 5); },
    },
    1005: { // Kafka (Novaflare): follow-up after a teammate attacks (2 charges, 1 back per turn).
      desc: 'Energy: Follow-up (+10) after a teammate attacks; 2 charges, 1 regained at the end of her turn, +1 after Ultimate. E4: +2 per Shock tick.',
      battleStart(sim, u) { u.state.fua = 2; },
      turnEnd(sim, u) { u.state.fua = Math.min(2, u.state.fua + 1); },
      ult(sim, u) { u.state.fua = Math.min(2, u.state.fua + 1); u.state.shock = true; },
      allyAttack(sim, u, actor, t) {
        if (actor.kind !== 'char' || u.state.fua <= 0) return;
        u.state.fua -= 1;
        u.state.shock = true;
        followUp(sim, u, 10);
      },
      enemyTurnStart(sim, u) { if (E(u) >= 4 && u.state.shock) G(sim, u, 2); },
    },
    1006: { // Silver Wolf (Novaflare): +20 at battle start, +5 at turn start.
      desc: 'Energy: +20 at battle start and +5 at the start of each turn.',
      battleStart(sim, u) { G(sim, u, 20); },
      turnStart(sim, u) { G(sim, u, 5); },
    },
    1008: { desc: 'Energy: standard.' }, // Arlan
    1009: { // Asta: Skill bounces 5 hits at 6 Energy each.
      desc: 'Energy: Skill 5 hits × 6.',
      energyFor(sim, u, t) { return t === 'Skill' ? 30 : undefined; },
    },
    1013: { // Herta: follow-up when an enemy drops to 50% HP (roughly once per wave; not simulated).
      desc: 'Energy: standard. Her follow-up (enemy below 50% HP) depends on enemy HP and is not simulated.',
    },
    1014: { desc: 'Energy: see the audit kit (Core Resonance).' }, // Saber
    1015: { // Archer: SP cap +2; follow-ups (Charge) after teammates attack recover SP.
      desc: 'SP: max +2. Skill doesn\'t end the turn (repeats while SP allows, up to 5; simplified to one Skill). Charge (+1 at start, +2 per Ultimate) → follow-up (+5 Energy, +1 SP) after a teammate attacks. E6: +1 SP at turn start.',
      battleStart(sim, u) { sim.spMax += 2; u.state.charge = 1; },
      ult(sim, u) { u.state.charge = Math.min(4, (u.state.charge || 0) + 2); },
      turnStart(sim, u) { if (E(u) >= 6) sim.gainSP(1, u); },
      allyAttack(sim, u, actor, t) {
        if (actor.kind !== 'char' || !(u.state.charge > 0)) return;
        u.state.charge -= 1;
        followUp(sim, u, 5);
        sim.gainSP(1, u);
      },
    },
    1101: { // Bronya: E1 50% chance to refund the Skill Point (expected value).
      desc: 'SP: E1 refunds the Skill\'s SP half the time (modelled as every other Skill).',
      action(sim, u, t) { if (t === 'Skill' && E(u) >= 1) { u.state.e1 = !u.state.e1; if (!u.state.e1) sim.gainSP(1, u); } },
    },
    1102: { // Seele: standard (Resurgence extra turns need kills).
      desc: 'Energy: standard. Resurgence (extra turn on kill) is not simulated.',
    },
    1103: { desc: 'Energy: +15 at battle start.', battleStart(sim, u) { G(sim, u, 15); } }, // Serval
    1104: { desc: 'Energy: standard.' }, // Gepard
    1105: { desc: 'Energy: standard. E4: +5 when hit.', hit(sim, u) { if (E(u) >= 4) G(sim, u, 5); } }, // Natasha
    1106: { // Pela: +10 Energy after attacking a debuffed enemy (her attacks debuff, so assume yes).
      desc: 'Energy: +10 after each attack (the enemy is assumed debuffed).',
      action(sim, u, t) { if (isAttack(t)) G(sim, u, 10); },
      ult(sim, u) { G(sim, u, 10); },
    },
    1107: { // Clara: counters when hit (+5); Ult: counters on any ally hit (2).
      desc: 'Energy: Counter (+5) whenever she is hit; after her Ultimate, also when allies are hit (2 enhanced counters).',
      hit(sim, u) { followUp(sim, u, 5, 'Counter'); },
      ult(sim, u) { u.state.enhanced = E(u) >= 6 ? 3 : 2; },
      allyHit(sim, u, victim) {
        if (u.state.enhanced > 0) { u.state.enhanced -= 1; followUp(sim, u, 5, 'Enhanced Counter'); }
      },
    },
    1108: { // Sampo: Skill 5 hits × 6; Ult +10.
      desc: 'Energy: Skill 5 hits × 6. Ultimate +10.',
      energyFor(sim, u, t) { return t === 'Skill' ? 30 : undefined; },
      ult(sim, u) { G(sim, u, 10); },
    },
    1109: { // Hook: +5 when attacking a Burned enemy (her Skill Burns); Ult +5.
      desc: 'Energy: +5 per attack on a Burned enemy (after her first Skill). Ultimate +5.',
      action(sim, u, t) { if (isAttack(t) && u.state.burn) G(sim, u, 5); if (t === 'Skill') u.state.burn = true; },
      ult(sim, u) { G(sim, u, 5); },
    },
    1110: { desc: 'Energy: standard.' }, // Lynx
    1111: { // Luka: +3 per Fighting Will (Skill +1, Enhanced Basic uses 2).
      desc: 'Energy: +3 per Fighting Will gained (+1 per Skill, +1 at battle start).',
      battleStart(sim, u) { G(sim, u, 3); },
      action(sim, u, t) { if (t === 'Skill') G(sim, u, 3); },
    },
    1112: { // Topaz: Numby turns; Windfall +10 per Numby attack; E2 +5.
      desc: 'Energy: +10 after each Numby attack during Windfall Bonanza (2 attacks, E6: 3); E2: +5 after every Numby attack.',
      numbyAttack(sim, u) {
        if (u.state.bonanza > 0) { u.state.bonanza -= 1; G(sim, u, 10); }
        if (E(u) >= 2) G(sim, u, 5);
      },
      ult(sim, u) { u.state.bonanza = E(u) >= 6 ? 3 : 2; },
      allyAction(sim, u, actor) { if (actor === u.state.numby) this.numbyAttack(sim, u); },
    },
    1201: { // Qingque: Skill free and restores 1 SP (trace); Enhanced Basic no SP. Simplified.
      desc: 'SP: Skill costs 1 and restores 1 (net 0). E6: Enhanced Basic restores 1 SP.',
      spCost(sim, u, t) { return t === 'Skill' ? 0 : t === 'Enhanced' ? (E(u) >= 6 ? -1 : 0) : undefined; },
    },
    1202: { // Tingyun: +5 at turn start; Ult gives the Benediction target 50 (+10 E6); technique 50.
      desc: 'Energy: +5 at the start of each turn. Ultimate gives the target 50 Energy (E6: 60).',
      turnStart(sim, u) { G(sim, u, 5); },
      ult(sim, u) { const tg = target(sim, u); if (tg) F(sim, tg, E(u) >= 6 ? 60 : 50); },
    },
    1203: { desc: 'Energy: standard.' }, // Luocha
    1204: { // Jing Yuan: +15 at battle start; E4 +2 per Lightning-Lord hit.
      desc: 'Energy: +15 at battle start. E4: +2 per Lightning-Lord hit.',
      battleStart(sim, u) { G(sim, u, 15); },
      allyAction(sim, u, actor) {
        if (E(u) >= 4 && actor === u.state.ll) G(sim, u, 2 * (u.state.lastHits || 3));
      },
    },
    1205: { // Blade (Novaflare): Charge from HP loss → follow-up (+10 +15).
      desc: 'Energy: Skill gives none. Charge (+1 per Enhanced Basic, per hit taken) → follow-up at 5 (E6: 4) for 10 + 15 Energy.',
      energyFor(sim, u, t) { return t === 'Skill' ? 0 : t === 'Enhanced' ? 30 : undefined; },
      spCost(sim, u, t) { return t === 'Skill' || t === 'Enhanced' ? 0 : undefined; },
      charge(sim, u) {
        u.state.charge = (u.state.charge || 0) + 1;
        if (u.state.charge >= (E(u) >= 6 ? 4 : 5)) { u.state.charge = 0; followUp(sim, u, 25); }
      },
      action(sim, u, t) { if (t === 'Skill' || t === 'Enhanced') this.charge(sim, u); },
      hit(sim, u) { this.charge(sim, u); },
    },
    1206: { desc: 'Energy: standard.' }, // Sushang
    1207: { // Yukong: +2 per ally action while Roaring Bowstrings is up (after her Skill, 2 turns).
      desc: 'Energy: +2 each time an ally acts while Roaring Bowstrings is active (2 of her turns after Skill).',
      action(sim, u, t) { if (t === 'Skill') u.state.bow = 2; },
      turnStart(sim, u) { if (u.state.bow > 0) u.state.bow -= 1; },
      allyAction(sim, u, actor) { if (u.state.bow > 0 && actor.kind === 'char') G(sim, u, 2); },
    },
    1208: { // Fu Xuan: Skill +20 while Matrix is active (always after first Skill).
      desc: 'Energy: Skill +20 more while Matrix of Prescience is active (from the second Skill on).',
      action(sim, u, t) { if (t === 'Skill') { if (u.state.matrix) G(sim, u, 20); u.state.matrix = true; } },
      allyHit(sim, u) { if (E(u) >= 4 && u.state.matrix) G(sim, u, 5); },
    },
    1209: { // Yanqing: follow-up 60% after attacks (+10), modelled as 3 in 5.
      desc: 'Energy: follow-up (+10) after 60% of his attacks (every 5 attacks: 3 follow-ups).',
      action(sim, u, t) {
        if (!isAttack(t)) return;
        u.state.roll = ((u.state.roll || 0) + 3) % 5;
        if (u.state.roll < 3) followUp(sim, u, 10);
      },
    },
    1210: { desc: 'Energy: standard. E4: +2 per Burn tick.', enemyTurnStart(sim, u) { if (E(u) >= 4 && u.state.burn) G(sim, u, 2); }, action(sim, u, t) { if (t === 'Skill') u.state.burn = true; } }, // Guinaifen
    1211: { desc: 'Energy: standard.' }, // Bailu
    1212: { // Jingliu (Novaflare): Transcendent Flash +15; Moon on Glacial River +8 (on top of data).
      desc: 'Energy: Transcendent Flash +15 more; Moon On Glacial River +8 more.',
      action(sim, u, t) { if (t === 'Skill') G(sim, u, 15); else if (t === 'Enhanced') G(sim, u, 8); },
      spCost(sim, u, t) { return t === 'Enhanced' ? 0 : undefined; },
    },
    1213: { desc: 'Energy: +15 at battle start.', battleStart(sim, u) { G(sim, u, 15); } }, // DHIL
    1214: { // Xueyi: Karma from Toughness reduction → follow-up (+2).
      desc: 'Energy: follow-up (+2) at 8 Karma (E6: 6); Karma from her attacks and teammates\' attacks (simplified: +3 per own attack, +1 per ally attack).',
      action(sim, u, t) { if (isAttack(t)) this.karma(sim, u, 3); },
      allyAttack(sim, u, actor) { if (actor.kind === 'char') this.karma(sim, u, 1); },
      karma(sim, u, n) {
        u.state.karma = (u.state.karma || 0) + n;
        const cap = E(u) >= 6 ? 6 : 8;
        if (u.state.karma >= cap) { u.state.karma -= cap; followUp(sim, u, 2); }
      },
    },
    1215: { // Hanya: Burden — every 2 ally attacks on it recovers 1 SP (2 times), +2 Energy each.
      desc: 'SP: Burden (from her Skill) recovers 1 SP per 2 ally Basic/Skill/Ultimate uses, twice; +2 Energy each time.',
      allyAttack(sim, u, actor, t) { if (actor.kind === 'char' && t !== 'FollowUp') this.hitBurden(sim, u); },
      action(sim, u, t) { if (t === 'Skill') { u.state.burden = 2; u.state.hits = 0; } else if (t === 'Basic') this.hitBurden(sim, u); },
      hitBurden(sim, u) {
        if (!(u.state.burden > 0)) return;
        if (++u.state.hits >= 2) { u.state.hits = 0; u.state.burden -= 1; sim.gainSP(1, u); G(sim, u, 2); }
      },
    },
    1217: { // Huohuo (Novaflare): +30 at battle start; Ult gives teammates 20% of their max.
      desc: 'Energy: +30 at battle start. Ultimate gives teammates 20% of their Max Energy. +1 per Talent heal (not simulated).',
      battleStart(sim, u) { G(sim, u, 30); },
      ult(sim, u) { sim.allies(u).forEach((a) => F(sim, a, a.maxEnergy * 0.2)); },
    },
    1218: { desc: 'Energy: +15 at battle start.', battleStart(sim, u) { G(sim, u, 15); } }, // Jiaoqiu
    1220: { // Feixiao: Flying Aureus (1 per 2 ally attacks); follow-up after teammates attack.
      autoUlt: 'Automatic at 6 Flying Aureus.',
      desc: 'Ultimate resource: Flying Aureus, +1 per 2 ally attacks (3 at battle start, max 12); Ultimate at 6. Follow-up after a teammate attacks (once per turn).',
      battleStart(sim, u) { u.state.aureus = 3; u.state.count = 0; u.state.fua = 1; },
      ultReady(sim, u) { return u.state.aureus >= 6; },
      ult(sim, u) { u.state.aureus -= 6; },
      turnStart(sim, u) {
        if (!u.state.fuaUsed) this.count(sim, u);
        u.state.fua = 1; u.state.fuaUsed = false;
      },
      count(sim, u) { if (++u.state.count >= 2) { u.state.count = 0; u.state.aureus = Math.min(12, u.state.aureus + 1); } },
      action(sim, u, t) { if (isAttack(t)) this.count(sim, u); },
      allyAttack(sim, u, actor, t) {
        this.count(sim, u);
        if (actor.kind === 'char' && u.state.fua > 0) {
          u.state.fua -= 1; u.state.fuaUsed = true;
          followUp(sim, u, 0);
          this.count(sim, u);
        }
      },
    },
    1221: { // Yunli: counter when hit (+10 +15); Ult: Parry, then Intuit counter.
      desc: 'Energy: Counter when hit (10 + 15). Ultimate: Parry until the next enemy action, which triggers "Intuit: Cull".',
      hit(sim, u) { u.state.parry = false; followUp(sim, u, 25, 'Counter'); },
      ult(sim, u) { u.state.parry = true; },
      enemyTurnStart(sim, u) {
        // If nothing hits her while Parry is up, she casts "Intuit: Slash" anyway.
        if (u.state.parry) { u.state.parry = false; followUp(sim, u, 0, 'Intuit'); }
      },
    },
    1222: { // Lingsha: Basic +10.
      desc: 'Energy: Basic ATK +10 more.',
      action(sim, u, t) { if (t === 'Basic') G(sim, u, 10); },
    },
    1223: { // Moze: Departed; Charge-based follow-ups; SP from Nightfeather.
      desc: 'Energy: follow-up (+10) for every 3 Charge spent when allies hit Prey (Skill: 9 Charge); Nightfeather +1 SP per follow-up (once per turn). E1: +20 at battle start, +2 per Additional DMG.',
      battleStart(sim, u) { if (E(u) >= 1) G(sim, u, 20); },
      action(sim, u, t) { if (t === 'Skill') { u.state.charge = 9; u.state.spent = 0; } },
      ult(sim, u) { followUp(sim, u, 10); this.nightfeather(sim, u); },
      allyAttack(sim, u, actor, t) {
        if (actor.kind !== 'char' || !(u.state.charge > 0)) return;
        u.state.charge -= 1;
        if (E(u) >= 1) G(sim, u, 2);
        if (++u.state.spent >= 3) { u.state.spent = 0; followUp(sim, u, 10); this.nightfeather(sim, u); }
      },
      nightfeather(sim, u) { if (!u.state.nfTurn || u.state.nfTurn !== u.actions) { u.state.nfTurn = u.actions; sim.gainSP(1, u); } },
    },
    1224: { // March 7th (Hunt): Enhanced Basic 30 Energy, no SP; E4 +5 at turn start; E2 follow-up.
      desc: 'Energy: Enhanced Basic 30 (no SP). E2: follow-up after Shifu\'s Basic/Skill (once per turn). E4: +5 at turn start.',
      spCost(sim, u, t) { return t === 'Enhanced' ? 0 : undefined; },
      turnStart(sim, u) { if (E(u) >= 4) G(sim, u, 5); u.state.e2 = true; },
      allyAction(sim, u, actor, t) {
        if (E(u) >= 2 && u.state.e2 && actor === target(sim, u) && (t === 'Basic' || t === 'Skill')) {
          u.state.e2 = false;
          followUp(sim, u, 0);
        }
      },
    },

    // ------------------------------------------------------------------ 13xx
    1301: { desc: 'Energy: E1 +20 at battle start.', battleStart(sim, u) { if (E(u) >= 1) G(sim, u, 20); } }, // Gallagher
    1302: { // Argenti: +3 per enemy hit by Basic/Skill/Ultimate; +2 per enemy entering combat.
      desc: 'Energy: +3 per enemy hit by his Basic ATK, Skill and Ultimate; +2 per enemy at battle start.',
      battleStart(sim, u) { G(sim, u, 2 * Math.max(1, sim.enemyCount)); },
      action(sim, u, t) { if (t === 'Basic' || t === 'Skill') G(sim, u, 3 * sim.targetsHit(u, t)); },
      ult(sim, u) { G(sim, u, 3 * sim.targetsHit(u, 'Ult')); },
    },
    1303: { desc: 'Energy: +5 at the start of each turn.', turnStart(sim, u) { G(sim, u, 5); } }, // Ruan Mei
    1304: { // Aventurine: Blind Bet → 7-hit follow-up (+1 Energy per hit).
      desc: 'Energy: follow-up at 7 Blind Bet (+1 per hit = 7). Blind Bet: +1 when a shielded ally is hit (+1 more when he is hit), +1 per teammate follow-up (3 per turn), Ultimate +4 (1–7 random).',
      turnStart(sim, u) { u.state.bingo = 3; },
      bet(sim, u, n) {
        u.state.bb = Math.min(10, (u.state.bb || 0) + n);
        while (u.state.bb >= 7) { u.state.bb -= 7; followUp(sim, u, 7); }
      },
      hit(sim, u) { this.bet(sim, u, 2); },
      allyHit(sim, u) { this.bet(sim, u, 1); },
      ult(sim, u) { this.bet(sim, u, 4); },
      allyAttack(sim, u, actor, t) { if (t === 'FollowUp' && u.state.bingo > 0) { u.state.bingo -= 1; this.bet(sim, u, 1); } },
    },
    1305: { // Dr. Ratio: Skill follow-up (40% + 20%/debuff); Wiseman's Folly after Ult.
      desc: 'Energy: follow-up (+5, E4: +20) after his Skill (100% with 3+ debuffs on the target, setting below), and on the next 2 teammate attacks after his Ultimate (E6: 3).',
      options: [{ key: 'debuffs', label: 'Debuffs on his target', type: 'number', def: 3, min: 0, max: 5, step: 1 }],
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const chance = Math.min(1, 0.4 + 0.2 * (+O(u, 'debuffs', 3) || 0));
        u.state.acc = (u.state.acc || 0) + chance;
        if (u.state.acc >= 1 - 1e-9) { u.state.acc -= 1; this.fua(sim, u); }
      },
      fua(sim, u) { followUp(sim, u, E(u) >= 4 ? 20 : 5); },
      ult(sim, u) { u.state.folly = E(u) >= 6 ? 3 : 2; },
      allyAttack(sim, u, actor) { if (actor.kind === 'char' && u.state.folly > 0) { u.state.folly -= 1; this.fua(sim, u); } },
    },
    1306: { // Sparkle (Novaflare): SP cap +2 (E4 +1); Ult +6 SP (E4 +1), overflow stored up to 10.
      desc: 'SP: max +2 (E4: +3). Ultimate recovers 6 SP (E4: 7); overflow (up to 10) refills SP at the end of each ally turn. Basic ATK +10 Energy; +1 Energy when her Skill target spends SP.',
      battleStart(sim, u) { sim.spMax += E(u) >= 4 ? 3 : 2; u.state.bank = 0; },
      action(sim, u, t) { if (t === 'Basic') G(sim, u, 10); },
      ult(sim, u) {
        const n = E(u) >= 4 ? 7 : 6;
        const room = sim.spMax - sim.sp;
        sim.gainSP(n, u);
        u.state.bank = Math.min(10, (u.state.bank || 0) + Math.max(0, n - room));
      },
      spUsed(sim, u, by) { if (by && by !== u && by === target(sim, u)) G(sim, u, 1); },
      allyAction(sim, u, actor) {
        if (actor.kind !== 'char' || !(u.state.bank > 0)) return;
        const need = Math.min(u.state.bank, sim.spMax - sim.sp);
        if (need > 0) { u.state.bank -= need; sim.gainSP(need, u); }
      },
    },
    1307: { // Black Swan (Novaflare): E4 +8 per enemy turn start while Epiphany.
      desc: 'Energy: E4: +8 at the start of each enemy turn while Epiphany (2 turns after her Ultimate) is up.',
      ult(sim, u) { u.state.epiphany = 2 * Math.max(1, sim.enemyCount); },
      enemyTurnStart(sim, u) { if (E(u) >= 4 && u.state.epiphany > 0) { u.state.epiphany -= 1; G(sim, u, 8); } },
    },
    1308: { // Acheron: Slashed Dream from debuffs applied by any ally ability.
      autoUlt: 'Automatic at 9 Slashed Dream.',
      desc: 'Ultimate resource: Slashed Dream (9). +5 at battle start, +1 per Skill, +1 per ally ability that applies a debuff (Nihility Skills/Ultimates and other known debuffers), E2: +1 at turn start.',
      battleStart(sim, u) { u.state.sd = 5; },
      ultReady(sim, u) { return u.state.sd >= 9; },
      ult(sim, u) { u.state.sd = Math.max(0, u.state.sd - 9); },
      gain(u, n) { u.state.sd = Math.min(9 + 3, (u.state.sd || 0) + n); },
      turnStart(sim, u) { if (E(u) >= 2) this.gain(u, 1); },
      action(sim, u, t) { if (t === 'Skill') this.gain(u, 1); },
      allyAction(sim, u, actor, t) { if (actor.kind === 'char' && appliesDebuff(actor, t)) this.gain(u, 1); },
      allyUlt(sim, u, ulter) { if (appliesDebuff(ulter, 'Ult')) this.gain(u, 1); },
      spCost(sim, u, t) { return undefined; },
    },
    1309: { // Robin: +2 per ally attack (E2: +3); Skill +5.
      desc: 'Energy: +2 after each ally attack (E2: +3), Skill +5 more.',
      allyAttack(sim, u) { G(sim, u, E(u) >= 2 ? 3 : 2); },
      action(sim, u, t) { if (t === 'Skill') G(sim, u, 5); },
    },
    1310: { // Firefly (Novaflare): Skill gives a fixed 60% of Max Energy; Enhanced Skill is free.
      desc: 'Energy: starts at 50%+. Skill regenerates a fixed 60% of Max Energy (144). Enhanced Skill uses no SP.',
      energyFor(sim, u, t) { return t === 'Skill' || t === 'Enhanced' ? 0 : undefined; },
      action(sim, u, t) { if (t === 'Skill') F(sim, u, u.maxEnergy * 0.6); },
      spCost(sim, u, t) { return t === 'Enhanced' ? 0 : undefined; },
    },
    1312: { // Misha: +2 per SP allies consume.
      desc: 'Energy: +2 per Skill Point the team consumes.',
      spUsed(sim, u, by, n) { if (by && by.kind === 'char') G(sim, u, 2 * n); },
    },
    1313: { // Sunday: +25 at battle start; Ult gives target 20% (min 40); Skill on Beatified +1 SP.
      desc: 'Energy: +25 at battle start; E4: +8 at turn start. Ultimate gives the target 20% of their Max Energy (at least 40). SP: Skill on The Beatified recovers 1; E2: first Ultimate +2.',
      battleStart(sim, u) { G(sim, u, 25); },
      turnStart(sim, u) { if (E(u) >= 4) G(sim, u, 8); },
      ult(sim, u) {
        const tg = target(sim, u);
        if (tg) { F(sim, tg, Math.max(40, tg.maxEnergy * 0.2)); u.state.beatified = tg; }
        if (E(u) >= 2 && !u.state.e2) { u.state.e2 = true; sim.gainSP(2, u); }
      },
      action(sim, u, t) { if (t === 'Skill' && u.state.beatified && u.state.beatified === target(sim, u)) sim.gainSP(1, u); },
    },
    1314: { // Jade: Charge from Jade / Debt Collector attacks → follow-up (+10).
      desc: 'Energy: follow-up (+10) at 8 Charge. Charge: +1 per enemy hit by Jade or the Debt Collector (E1: at least 3 per Debt Collector attack).',
      charge(sim, u, n) {
        u.state.charge = (u.state.charge || 0) + n;
        while (u.state.charge >= 8) { u.state.charge -= 8; followUp(sim, u, 10); }
      },
      action(sim, u, t) { if (t === 'Basic') this.charge(sim, u, 1); },
      ult(sim, u) { this.charge(sim, u, sim.targetsHit(u, 'Ult')); },
      allyAttack(sim, u, actor, t) {
        if (actor !== target(sim, u) || t === 'FollowUp') return;
        let n = sim.targetsHit(actor, t);
        if (E(u) >= 1) n = Math.max(n, 3);
        this.charge(sim, u, n);
      },
    },
    1315: { // Boothill: Skill (Standoff) gives no Energy and doesn't end the turn; Enhanced Basic 30, no SP.
      desc: 'Energy: Skill gives none (Standoff: his next 2 turns use the Enhanced Basic, 30 Energy, no SP). Pocket Trickshot (on Weakness Break) is not simulated.',
      action(sim, u, t) { if (t === 'Skill') u.state.standoff = 2; else if (t === 'Enhanced') u.state.standoff -= 1; },
      actionType(sim, u) { return u.state.standoff > 0 ? 'Enhanced' : undefined; },
      energyFor(sim, u, t) { return t === 'Skill' ? 0 : t === 'Enhanced' ? 30 : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? 0 : undefined; },
    },
    1317: { // Rappa: Sealform (3 Enhanced Basics, 20 Energy each, no SP); E1 +20 on exit.
      desc: 'Energy: Sealform (after Ultimate): 3 Enhanced Basic ATKs (20 Energy each, no SP), then E1: +20.',
      ult(sim, u) { u.state.ink = 3; },
      actionType(sim, u) { return u.state.ink > 0 ? 'Enhanced' : undefined; },
      canUlt(sim, u) { return !(u.state.ink > 0); },
      energyFor(sim, u, t) { return t === 'Enhanced' ? 20 : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? 0 : undefined; },
      action(sim, u, t) { if (t === 'Enhanced' && --u.state.ink <= 0 && E(u) >= 1) G(sim, u, 20); },
    },
    1321: { // The Dahlia: +35 at battle start; follow-up after the other Dance Partner attacks.
      targetLabel: 'Dance Partner',
      desc: 'Energy: +35 at battle start. Follow-up (5 hits × 2 Energy) after her Dance Partner attacks (once per turn); every 2 follow-ups recover 1 SP.',
      battleStart(sim, u) { G(sim, u, 35); },
      turnStart(sim, u) { u.state.fua = true; },
      allyAttack(sim, u, actor, t) {
        if (actor !== target(sim, u) || !u.state.fua) return;
        u.state.fua = false;
        followUp(sim, u, 10);
        if ((u.state.count = (u.state.count || 0) + 1) % 2 === 0) sim.gainSP(1, u);
      },
    },

    // ------------------------------------------------------------------ 14xx
    1401: { // The Herta: 3 fixed Energy per target hit; Inspiration → Enhanced Skill.
      desc: 'Energy: 3 fixed per enemy hit (at least 3 targets with 2+ Erudition characters). Ultimate gives 1 Inspiration (E2: 2; E2 also 1 at battle start) → Enhanced Skill; E2: Enhanced Skill advances her 35%.',
      battleStart(sim, u) { u.state.insp = E(u) >= 2 ? 1 : 0; },
      hitsFor(sim, u, t) {
        let n = sim.targetsHit(u, t);
        if (sim.chars().filter((a) => a.cfg.char.path === 'Erudition').length >= 2) n = Math.max(3, n);
        return Math.min(5, n);
      },
      actionType(sim, u) { return u.state.insp > 0 ? 'Enhanced' : undefined; },
      energyFor(sim, u, t) { return t === 'Enhanced' ? 30 : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? 1 : undefined; },
      action(sim, u, t) {
        if (isAttack(t)) F(sim, u, 3 * this.hitsFor(sim, u, t === 'Enhanced' ? 'Skill' : t));
        if (t === 'Enhanced') { u.state.insp -= 1; if (E(u) >= 2) sim.advance(u, 0.35); }
      },
      ult(sim, u) { u.state.insp = Math.min(4, (u.state.insp || 0) + (E(u) >= 2 ? 2 : 1)); F(sim, u, 3 * this.hitsFor(sim, u, 'Ult')); },
    },
    1402: { // Aglaea: E1 +20 per attack on Seam Stitch; starts at 50%.
      desc: 'Energy: E1: +20 after Aglaea or Garmentmaker attacks the Seam Stitch target.',
      action(sim, u, t) { if (E(u) >= 1 && isAttack(t)) G(sim, u, 20); },
      allyAttack(sim, u, actor) { if (E(u) >= 1 && actor.owner === u) G(sim, u, 20); },
    },
    1403: { // Tribbie: +30 at battle start; +1.5 per target hit by other allies; follow-up after ally Ults.
      desc: 'Energy: +30 at battle start; +1.5 per enemy hit by other allies\' attacks. Follow-up (+5) after each other ally\'s Ultimate (once per ally until her next Ultimate).',
      battleStart(sim, u) { G(sim, u, 30); u.state.done = new Set(); },
      allyAttack(sim, u, actor, t) { G(sim, u, 1.5 * sim.targetsHit(actor, t === 'Ult' ? 'Ult' : t)); },
      allyUlt(sim, u, ulter) {
        if (ulter.kind !== 'char' || u.state.done.has(ulter)) return;
        u.state.done.add(ulter);
        followUp(sim, u, 5);
      },
      ult(sim, u) { u.state.done = new Set(); if (E(u) >= 6) followUp(sim, u, 5); },
    },
    1404: { desc: 'Energy: standard.' }, // Mydei
    1405: { // Anaxa: Skill 5 hits × 6; Basic +10; +30 at turn start without Qualitative Disclosure; extra free Skill.
      desc: 'Energy: Skill 5 hits × 6; Basic ATK +10; +30 on his first turn (no Qualitative Disclosure yet). From then on, each Skill triggers a free extra Skill (+30).',
      energyFor(sim, u, t) { return t === 'Skill' ? 30 : undefined; },
      turnStart(sim, u) { if (!u.state.qd) G(sim, u, 30); },
      action(sim, u, t) {
        if (t === 'Basic') G(sim, u, 10);
        if ((t === 'Skill' || t === 'Basic') && u.state.qd) { sim.record(u, 'FollowUp', { label: 'Extra Skill', n: u.actions }); G(sim, u, 30); sim.fireAll('allyAttack', u, 'Skill'); }
        if (t === 'Skill') u.state.qd = true;
        if (t === 'Skill' && E(u) >= 1 && !u.state.e1) { u.state.e1 = true; sim.gainSP(1, u); }
      },
    },
    1406: { // Cipher: follow-up when the Patron is attacked by another ally (once per turn).
      desc: 'Energy: follow-up (+5) when a teammate attacks the Patron (once per turn).',
      turnStart(sim, u) { u.state.fua = true; },
      battleStart(sim, u) { u.state.fua = true; },
      allyAttack(sim, u, actor) { if (actor.kind === 'char' && u.state.fua) { u.state.fua = false; followUp(sim, u, 5); } },
    },
    1409: { desc: 'Energy: standard.' }, // Hyacine
    1410: { // Hysilens: Zone at battle start and on Ultimate recovers 1 SP.
      desc: 'SP: +1 each time she deploys a Zone (battle start and Ultimate).',
      battleStart(sim, u) { sim.gainSP(1, u); },
      ult(sim, u) { sim.gainSP(1, u); },
    },
    1412: { // Cerydra: +5 when Military Merit uses Basic/Skill; Skill gives them 2.
      desc: 'Energy: +5 when the Military Merit holder uses Basic ATK or Skill; her Skill gives them 2.',
      allyAction(sim, u, actor, t) { if (actor === target(sim, u) && (t === 'Basic' || t === 'Skill')) G(sim, u, 5); },
      action(sim, u, t) { const tg = target(sim, u); if (t === 'Skill' && tg) G(sim, tg, 2); },
    },
    1413: { // Evernight: +70 at battle start; +5 per ability by her or an ally memosprite.
      desc: 'Energy: +70 at battle start; +5 whenever she or an ally memosprite uses an ability. SP: +1 after Evey\'s "Dream, Dissolving, as Dew" (not simulated).',
      battleStart(sim, u) { G(sim, u, 70); },
      action(sim, u) { G(sim, u, 5); },
      allyAction(sim, u, actor) { if (actor.memo || (actor.kind === 'summon' && actor.owner === u)) G(sim, u, 5); },
    },
    1414: { // Dan Heng PT: +6 when the Bondmate attacks; E1 Ult +1 SP.
      desc: 'Energy: +6 whenever the Bondmate attacks. SP: E1: Ultimate recovers 1.',
      allyAttack(sim, u, actor) { if (actor === u.state.bond) G(sim, u, 6); },
      ult(sim, u) { if (E(u) >= 1) sim.gainSP(1, u); },
    },
    // ------------------------------------------------------------------ 15xx
    1504: { // Ashveil: Bait attacked by teammates → 8 fixed Energy + follow-up (Charge).
      desc: 'Energy: when a teammate attacks the Bait, 8 fixed Energy and a follow-up (+5) using 1 Charge (2 at start, max 3; Ultimate +3). SP: Skill on the Bait recovers 1.',
      battleStart(sim, u) { u.state.charge = 2; },
      ult(sim, u) { u.state.charge = 3; followUp(sim, u, 5, 'Enhanced Follow-up'); },
      action(sim, u, t) { if (t === 'Skill') { if (u.state.bait) sim.gainSP(1, u); u.state.bait = true; } },
      allyAttack(sim, u, actor) {
        if (actor.kind !== 'char' || !u.state.bait) return;
        F(sim, u, 8);
        if (u.state.charge > 0) { u.state.charge -= 1; followUp(sim, u, 5); }
      },
    },
    1507: { // Mortenax Blade: overflow 80; starts at 75%; Infinite Fury Charges → +25 and a free Skill.
      desc: 'Energy: starts at 75%, overflow up to 80. Ultimate enters Infinite Fury (70 SPD countdown): ally attacks give Charge; at 9 (E2: 7) +25 Energy and an extra Skill (follow-up). His Skill is free and only usable in Fury.',
      battleStart(sim, u) { u.energyOverflow = 80; u.energy = Math.max(u.energy, u.maxEnergy * 0.75); },
      actionType(sim, u) { return u.state.fury ? 'Skill' : 'Basic'; },
      spCost(sim, u, t) { return t === 'Skill' ? 0 : undefined; },
      ult(sim, u) {
        if (u.state.fury) return; // Tenax Per Ignem
        u.state.fury = true; u.state.charge = 0;
        sim.spawnCountdown({
          key: `${u.key}:fury`, name: 'Infinite Fury', owner: u, icon: u.icon, fixedSpd: 70,
          onTurn(s) { u.state.fury = false; if (u.energy < u.maxEnergy * 0.75) u.energy = u.maxEnergy * 0.75; },
        });
      },
      allyAttack(sim, u, actor) { if (u.state.fury) this.charge(sim, u); },
      hit(sim, u) { if (u.state.fury) this.charge(sim, u); },
      charge(sim, u) {
        if (++u.state.charge >= (E(u) >= 2 ? 7 : 9)) {
          u.state.charge = 0;
          G(sim, u, 25);
          followUp(sim, u, 30, 'Extra Skill');
        }
      },
      tauntMult(sim, u) { return u.state.fury ? 3 : 1; },
    },
    1508: { // Rin Tohsaka: SP cap +2; Ult +1 SP; E6 extra turn.
      desc: 'SP: max +2; Ultimate recovers 1. E6: Ultimate also gives an extra turn.',
      battleStart(sim, u) { sim.spMax += 2; },
      ult(sim, u) { sim.gainSP(1, u); if (E(u) >= 6) sim.extraTurn(u); },
    },
    1509: { // Gilgamesh: 30% of Energy spent by other allies' Ultimates; E1 Skill +40; E4 ERR +20%.
      desc: 'Energy: regenerates a fixed 30% of the Energy each teammate spends on their Ultimate. E1: Skill +40 fixed. E4: +20% Energy Regeneration Rate.',
      battleStart(sim, u) { if (E(u) >= 4) u.errBase += 0.2; },
      allyUlt(sim, u, ulter, info) { if (ulter.kind === 'char' && info && info.spent) F(sim, u, 0.3 * info.spent); },
      action(sim, u, t) { if (t === 'Skill' && E(u) >= 1) F(sim, u, 40); },
    },
    1510: { // Himeko • Nova: Assist Skills for the whole team.
      desc: 'Assist Skill: every ally starts with 1 use (E2: cap 2). Using it replaces that ally\'s action (no SP) and gives them 18 + 4 Energy; Trailblaze Companions also get an extra turn (E2: everyone), and trigger a Special Effect: Verdict (Trailblazer, Dan Hengs, Sunday): after 2 teammate Ultimates (E1: 1) Himeko launches a free Assist; Decimation (March 7th, Evernight, Welt, Himeko): every 9 enemies hit by allies (E1: 6) she launches one. Free Assists: 2 per battle (E1: 3), reset by her Ultimate. Her Skill restores all uses; Navigator\'s Semaphore (3 of her turns) restores 1 per ally turn (E2: 2). +5 Energy at her turn start if her uses are full.',
      options: [{ key: 'assist', label: 'Allies use Assist Skill', type: 'select', def: 'companions',
        choices: [['companions', 'Trailblaze Companions'], ['all', 'Everyone'], ['none', 'Nobody (pattern "A" only)']] }],
      COMPANIONS: new Set(['8002', '8004', '8006', '8008', '8010', '1003', '1510', '1001', '1224', '1413', '1002', '1213', '1414', '1004', '1313']),
      VERDICT: new Set(['8002', '8004', '8006', '8008', '8010', '1002', '1213', '1414', '1313']),
      battleStart(sim, u) {
        const kit = this, cap = E(u) >= 2 ? 2 : 1;
        u.state.uses = new Map(sim.chars().map((a) => [a, 1]));
        u.state.cap = cap; u.state.free = E(u) >= 1 ? 3 : 2; u.state.protocol = null; u.state.ults = 0; u.state.charge = 0;
        const policy = O(u, 'assist', 'companions');
        sim.assist = {
          wants(s, a) {
            if (a === u || policy === 'none' || a.state.assistExtra) return false;
            if (policy === 'companions' && !kit.COMPANIONS.has(a.cfg.char.id)) return false;
            return (u.state.uses.get(a) || 0) > 0;
          },
        };
      },
      turnStart(sim, u) {
        if (u.state.semaphore > 0) u.state.semaphore -= 1;
        if ((u.state.uses.get(u) || 0) >= u.state.cap) G(sim, u, 5);
      },
      allyTurnStart(sim, u, a) {
        if (u.state.semaphore > 0) u.state.uses.set(a, Math.min(u.state.cap, (u.state.uses.get(a) || 0) + (E(u) >= 2 ? 2 : 1)));
      },
      action(sim, u, t) {
        if (t === 'Skill') { sim.chars().forEach((a) => u.state.uses.set(a, u.state.cap)); u.state.semaphore = 3; }
        if (t === 'Assist') sim.fire(u, 'assistUsed', u);
      },
      energyFor(sim, u, t) { return t === 'Assist' ? 18 : undefined; },
      spCost(sim, u, t) { return t === 'Assist' ? 0 : undefined; },
      allyAction(sim, u, a, t) {
        if (t !== 'Assist' || a.kind !== 'char') return;
        u.state.uses.set(a, Math.max(0, (u.state.uses.get(a) || 0) - 1));
        F(sim, a, 4);
        sim.fire(a, 'assistUsed', u);
        const companion = this.COMPANIONS.has(a.cfg.char.id);
        if (companion) u.state.protocol = this.VERDICT.has(a.cfg.char.id) ? 'verdict' : 'decimation';
        if ((companion || E(u) >= 2) && !a.state.assistExtra) {
          a.state.assistExtra = true;
          sim.withCause({ by: u, label: 'Hark! The Express\'s Pulse Roars', hook: 'trace' }, () => sim.extraTurn(a));
        }
      },
      allyTurnEnd(sim, u, a) { a.state.assistExtra = false; },
      freeAssist(sim, u) {
        if (!(u.state.free > 0)) return;
        u.state.free -= 1;
        const ev = sim.record(u, 'FollowUp', { label: 'Assist Skill (free)', n: u.actions });
        ev.dmg = sim.dealDamage(u, 'Assist', { self: true, label: 'Assist Skill' });
        G(sim, u, 18);
        sim.snap(ev, u);
        sim.fire(u, 'assistUsed', u);
        sim.fireAll('allyAttack', u, 'FollowUp');
      },
      allyUlt(sim, u, ulter, info) {
        if (u.state.protocol !== 'verdict' || ulter.kind !== 'char' || (info && info.activated)) return;
        if (++u.state.ults >= (E(u) >= 1 ? 1 : 2)) { u.state.ults = 0; this.freeAssist(sim, u); }
      },
      allyAttack(sim, u, a, t) {
        if (u.state.protocol !== 'decimation' || u.state.freeAssisting) return;
        u.state.charge += sim.targetsHit(a, t === 'Ult' ? 'Ult' : t);
        if (u.state.charge >= (E(u) >= 1 ? 6 : 9)) { u.state.charge = 0; u.state.freeAssisting = true; this.freeAssist(sim, u); u.state.freeAssisting = false; }
      },
      ult(sim, u) { u.state.free = E(u) >= 1 ? 3 : 2; },
    },
    1512: { // Robin • Summeretto: Ult gives target a fixed 20% of Max Energy.
      desc: 'Energy: Ultimate gives the target a fixed 20% of their Max Energy.',
      ult(sim, u) { const tg = target(sim, u); if (tg) F(sim, tg, tg.maxEnergy * 0.2); },
    },

    // ------------------------------------------------------------------ Elation
    1501: { // Sparxie
      desc: 'Turn: Skill starts a livestream (Engagement Farming ×N, each costs 1 SP and gives 2 Punchline + 2 SP or 1 Punchline, alternating), then the Enhanced Basic "Bloom!" (40 Energy). Ultimate: +2 Punchline, +2/4/8 more for 1/2/3+ Elation (and Thrill), E4 +5. Elation Skill: +2 Thrill (Thrill pays for SP). E1: +5 Punchline after each Aha Instant; E2: extra turn after each Aha Instant.',
      options: [{ key: 'farm', label: 'Engagement Farming uses per Skill', type: 'number', def: 2, min: 1, max: 20, step: 1 }],
      battleStart(sim, u) { u.state.thrill = 0; },
      actionType(sim, u) { return 'Enhanced'; },
      energyFor(sim, u, t) { return t === 'Enhanced' ? 40 : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? 0 : undefined; },
      action(sim, u, t) {
        if (t !== 'Enhanced') return;
        const n = +O(u, 'farm', 2) || 1;
        for (let i = 0; i < n; i++) {
          if (u.state.thrill > 0) { u.state.thrill -= 1; sim.fireEvery('spUsed', u, 1); }
          else if (sim.sp >= 1) sim.useSP(1, u);
          else break;
          u.state.gift = !u.state.gift;
          if (u.state.gift) { sim.addPunchline(2, u); sim.gainSP(2, u); } else sim.addPunchline(1, u);
        }
      },
      ult(sim, u) {
        const el = elationCount(sim);
        sim.addPunchline(2 + [0, 2, 4, 8][Math.min(3, el)] + (E(u) >= 4 ? 5 : 0), u);
        u.state.thrill += [0, 1, 1, 4][Math.min(3, el)];
      },
      elation(sim, u) { u.state.thrill += 2; },
      ahaEnd(sim, u, by, info) {
        if (info && info.fixed != null) return;
        if (E(u) >= 1) sim.addPunchline(5, u);
        if (E(u) >= 2) { u.state.thrill += 2; sim.extraTurn(u); }
      },
    },
    1502: { // Yao Guang
      desc: 'Punchline: +3 after Basic ATK or Skill, +5 on Ultimate. Skill deploys a Zone for 3 of her turns (E2: allies +12% SPD). Technique: Skill at battle start (free). Ultimate: Aha gets an extra turn with a fixed 20 Punchline (E1: 40). Elation Skill recovers 1 SP. Her Certified Banger lasts 1 turn longer.',
      options: [{ key: 'tech', label: 'Technique use', type: 'check', def: true }],
      cbTurns() { return 1; },
      battleStart(sim, u) { if (O(u, 'tech', true)) this.zone(sim, u); },
      turnStart(sim, u) {
        if (u.state.zone > 0 && --u.state.zone <= 0) sim.units.forEach((x) => sim.removeBuff(x, 'yaoE2'));
      },
      zone(sim, u) {
        u.state.zone = 3;
        if (E(u) >= 2) sim.chars().forEach((a) => sim.addBuff(a, { id: 'yaoE2', pct: 0.12, turns: Infinity }));
      },
      action(sim, u, t) {
        if (t === 'Basic' || t === 'Skill') sim.addPunchline(3, u);
        if (t === 'Skill') this.zone(sim, u);
      },
      ult(sim, u) { sim.addPunchline(5, u); sim.ahaExtraTurn(E(u) >= 1 ? 40 : 20); },
      elation(sim, u) { sim.gainSP(1, u); },
    },
    1503: { // Pearl
      desc: 'Certified Banger: never expires, max 50. Skill +15, Ultimate +20, +5 whenever an ally\'s turn begins (up to 50 per Pearl turn). Ultimate: Deep Learning on the target (her next 3 Basic ATKs are Enhanced, 30 Energy); with 4+ Elation the target\'s extra turn also gets +30 Certified Banger and +60 Punchline (E2: doubled) for that turn. Aesthetic Firewall: the Archetype\'s next Ultimate gives Pearl a fixed 90 Energy.',
      cbMode() { return { cap: 50, turns: Infinity }; },
      battleStart(sim, u) { u.state.firewall = true; u.state.gotThisTurn = 0; },
      turnStart(sim, u) { u.state.gotThisTurn = 0; },
      allyTurnStart(sim, u, ally) {
        if (u.state.gotThisTurn < 50) {
          u.state.gotThisTurn += 5;
          sim.gainCB(u, 5, { src: 'Pearl trace' });
        }
        if (sim.inExtraTurn && u.state.extraFor === ally) {
          const k = E(u) >= 2 ? 2 : 1;
          sim.gainCB(ally, 30 * k, { src: 'Pearl' });
          sim.addPunchline(60 * k, u);
          u.state.tempPl = 60 * k;
          u.state.extraFor = null;
          u.state.extraOwner = ally;
        }
      },
      allyAction(sim, u, actor) {
        // The temporary Punchline is removed at the end of that extra turn.
        if (u.state.tempPl && actor === u.state.extraOwner) { sim.punchline = Math.max(0, sim.punchline - u.state.tempPl); u.state.tempPl = 0; u.state.extraOwner = null; }
      },
      actionType(sim, u) { return u.state.deep > 0 ? 'Enhanced' : undefined; },
      energyFor(sim, u, t) { return t === 'Enhanced' ? 30 : undefined; },
      spCost(sim, u, t) { return t === 'Enhanced' ? -1 : undefined; },
      action(sim, u, t) {
        if (t === 'Skill') sim.gainCB(u, 15, { src: 'Skill' });
        if (t === 'Enhanced') u.state.deep -= 1;
      },
      ult(sim, u) {
        sim.gainCB(u, 20, { src: 'Ultimate' });
        u.state.deep = 3;
        u.state.firewall = true;
        if (elationCount(sim) >= 4) u.state.extraFor = target(sim, u);
      },
      allyUlt(sim, u, ulter) {
        const arch = target(sim, u);
        if (u.state.firewall && ulter === arch && arch.cfg.char.path === 'Elation') { u.state.firewall = false; F(sim, u, 90); }
      },
    },
    1505: { // Evanescia
      desc: 'Energy ↔ Certified Banger: every Energy gain also gives that much Certified Banger and vice versa (max 100 per instance). Every 240 Energy regenerated: Master Fox follow-up (+10 Energy; E1: also an Elation Skill). Skill: +10 Punchline. Elation Skill: +5 Certified Banger (E1: +10 more). Converts 50% of lower-Participant-ID teammates\' Certified Banger gains and 50% of teammates\' expiring Certified Banger (E2: +50% / +100% more). E6: first Ultimate +120 fixed Energy; her Certified Banger lasts 1 turn longer.',
      battleStart(sim, u) { u.state.acc = 0; },
      cbTurns(sim, u) { return E(u) >= 6 ? 1 : 0; },
      energyGained(sim, u, eff) {
        // Every Energy regeneration counts toward Master Fox, including Energy mirrored from
        // Certified Banger; only the Energy → Certified Banger mirror is skipped mid-mirror.
        if (!u.state.mirroring) {
          u.state.mirroring = true;
          sim.gainCB(u, Math.min(100, eff), { src: 'Energy' });
          u.state.mirroring = false;
        }
        u.state.acc = (u.state.acc || 0) + Math.min(240, eff);
        while (u.state.acc >= 240) {
          u.state.acc -= 240;
          followUp(sim, u, 0, 'Master Fox');
          G(sim, u, 10);
          if (E(u) >= 1) sim.elationSkill(u, null, { label: 'E1' });
        }
      },
      cbGained(sim, u, amt, src) {
        if (u.state.mirroring) return;
        u.state.mirroring = true;
        G(sim, u, Math.min(100, amt));
        u.state.mirroring = false;
      },
      action(sim, u, t) { if (t === 'Skill') sim.addPunchline(10, u); },
      elation(sim, u) { sim.gainCB(u, 5 + (E(u) >= 1 ? 10 : 0), { src: 'Elation Skill' }); },
      allyCBGained(sim, u, ally, amt, src) {
        const pa = ally.cfg.char.combat.elationPid, pu = u.cfg.char.combat.elationPid;
        if (!pa || !(pa < pu) || src === 'Evanescia') return;
        sim.gainCB(u, amt * 0.5 * (E(u) >= 2 ? 1.5 : 1), { src: 'Evanescia' });
      },
      allyCBEnd(sim, u, ally, amt) { sim.gainCB(u, amt * 0.5 * (E(u) >= 2 ? 2 : 1), { src: 'Evanescia' }); },
      ult(sim, u) { if (E(u) >= 6 && !u.state.e6) { u.state.e6 = true; F(sim, u, 120); } },
    },
    1506: { // Silver Wolf LV.999: Hidden MMR (60) instead of Energy.
      autoUlt: 'Automatic at 60 Hidden MMR.',
      desc: 'Ultimate resource: Hidden MMR (60). +1 per Punchline the team gains, +15 per Elation Skill (+20 with 20+ Punchline, +40 with 40+), +20 on entering Godmode. Skill: +5 Punchline. In Godmode, SP spent can open a Top Loot Box (first, then every 5th): Kaboom Eggsplosion +2 SP / Funky Munch Bean +3 Punchline. Leaving Godmode clears MMR (E1: keeps 20%). E2: entering Godmode extends her buffs by 1 turn, and every 120 MMR gained in Godmode (counting what she had) gives an extra turn and 1 more Enhanced Basic ATK.',
      battleStart(sim, u) { u.state.mmr = 0; },
      ultReady(sim, u) { return u.state.mmr >= 60; },
      // All Hidden MMR gains go through here: cap 300, and in Godmode E2 counts every 120 gained
      // (including the MMR held on entry) for an extra turn and 1 more Enhanced Basic ATK.
      mmr(sim, u, n) {
        u.state.mmr = Math.min(60 + 240, u.state.mmr + n);
        if (u.state.god > 0 && E(u) >= 2) {
          u.state.godGain = (u.state.godGain || 0) + n;
          while (u.state.godGain >= 120 * ((u.state.e2Turns || 0) + 1)) {
            u.state.e2Turns = (u.state.e2Turns || 0) + 1;
            u.state.god += 1;
            sim.extraTurn(u);
          }
        }
      },
      punchline(sim, u, by, n) { this.mmr(sim, u, n); },
      action(sim, u, t) {
        if (t === 'Skill') sim.addPunchline(5, u);
        // Leaving Godmode clears Hidden MMR (E1: keeps 20%).
        if (t === 'Enhanced' && u.state.god === 0) u.state.mmr = E(u) >= 1 ? u.state.mmr * 0.2 : 0;
      },
      // Secret Level Maxed: +20 on entering Godmode (MMR isn't spent; it clears when Godmode ends).
      ult(sim, u) {
        u.state.box = 0;
        u.state.godGain = u.state.mmr; u.state.e2Turns = 0;
        if (E(u) >= 2) { u.buffs.forEach((b) => { if (b.turns !== Infinity) b.turns += 1; }); u.cb.forEach((c) => { if (c.turns !== Infinity) c.turns += 1; }); }
        this.mmr(sim, u, 20);
      },
      elation(sim, u, info) {
        let n = u.state.god ? 0 : 15;
        if (info.punchline >= 20) n += 20;
        if (info.punchline >= 40) n += 20;
        this.mmr(sim, u, n);
        u.state.box = 0;
      },
      spUsed(sim, u, by, n) {
        if (!u.state.god || sim.cbTotal(u) <= 0) return;
        for (let i = 0; i < n; i++) {
          const k = u.state.box = (u.state.box || 0) + 1;
          if (k === 1 || (k - 1) % 5 === 0) {
            u.state.loot = ((u.state.loot || 0) + 1) % 3;
            if (u.state.loot === 1) sim.gainSP(2, u);
            else if (u.state.loot === 2) sim.addPunchline(3, u);
          }
        }
      },
      spCost(sim, u, t) { return t === 'Enhanced' ? 0 : undefined; },
      energyFor() { return 0; },
    },
    1513: { // Aventurine • Waveflair
      desc: 'Fervor & Punchline: Skill +4/+4, Ultimate +6 Punchline +8 Fervor, +1 each per teammate attack; Sift: +2 Fervor after a teammate\'s Basic/Skill/Follow-up/Ultimate (6 times, reset by his Skill). At 10 Fervor (E1: 10/20/30) he uses "Cheers!" (an Elation Skill with a fixed 20 Punchline). Solo Elation: teammate attacks give +2 Certified Banger and Aha +25 SPD until the next Aha Instant. His Certified Banger lasts 1 turn longer.',
      options: [{ key: 'tech', label: 'Technique use', type: 'check', def: true }],
      cbTurns() { return 1; },
      battleStart(sim, u) {
        u.state.fervor = 0; u.state.sift = 6; u.state.next = 10;
        if (O(u, 'tech', true)) { this.fervor(sim, u, 2); sim.gainCB(u, 20, { src: 'Technique' }); }
      },
      cap(u) { return E(u) >= 2 ? 50 : 30; },
      fervor(sim, u, n) {
        u.state.fervor = Math.min(this.cap(u), u.state.fervor + n);
        while (u.state.fervor >= u.state.next) {
          sim.elationSkill(u, 20, { label: 'Cheers!' });
          if (E(u) >= 1 && u.state.next < this.cap(u)) u.state.next += 10;
          else { u.state.next = Infinity; break; }
        }
      },
      action(sim, u, t) { if (t === 'Skill') { sim.addPunchline(4, u); this.fervor(sim, u, 4); u.state.sift = 6; } },
      ult(sim, u) { sim.addPunchline(6, u); this.fervor(sim, u, 8); },
      allyAttack(sim, u, actor, t) {
        if (actor.kind !== 'char') return;
        sim.addPunchline(1, u);
        let f = 1;
        if (u.state.sift > 0 && t !== 'Extra') { u.state.sift -= 1; f += 2; }
        this.fervor(sim, u, f);
        if (elationCount(sim) === 1) { sim.gainCB(u, 2, { src: 'Solo' }); sim.ahaSpdBonus = 25; }
      },
      elation(sim, u, info) {
        if (sim.inAha) { u.state.fervor = 0; u.state.next = 10; if (E(u) >= 2) this.fervor(sim, u, 5); }
      },
    },
    8010: { // Trailblazer • Elation (8009 is the Caelus id)
      desc: 'Energy: +10 fixed and +3 Punchline after each attack. Skill: +20 Certified Banger (+2 per ally Elation Skill since the last Skill). Ultimate: +5 Punchline, +1 SP; an Elation target gets +10 Certified Banger and uses their Elation Skill (fixed 20 Punchline).',
      action(sim, u, t) {
        if (isAttack(t)) { F(sim, u, 10); sim.addPunchline(3, u); }
        if (t === 'Skill') { sim.gainCB(u, 20 + 2 * (u.state.bonus || 0), { src: 'Skill' }); u.state.bonus = 0; }
      },
      allyElation(sim, u) { u.state.bonus = (u.state.bonus || 0) + 1; },
      elation(sim, u) { u.state.bonus = (u.state.bonus || 0) + 1; },
      ult(sim, u) {
        sim.addPunchline(5, u);
        sim.gainSP(1, u);
        const tg = target(sim, u);
        if (tg && tg.cfg.char.combat.elationPid) { sim.gainCB(tg, 10, { src: 'Trailblazer' }); sim.elationSkill(tg, 20, { label: 'Trailblazer Ult' }); }
      },
    },

    // ------------------------------------------------------------------ Trailblazers
    8002: { desc: 'Energy: +15 at battle start.', battleStart(sim, u) { G(sim, u, 15); } },
    8004: { desc: 'Energy: standard (+5 on turns that start with a Shield is not simulated).' },
    8006: { // Harmony: Skill 5 hits × 6; E2 +25% ERR for 3 turns at battle start; +10 on Weakness Break.
      weaknessBreak(sim, u) { G(sim, u, 10); },
      desc: 'Energy: Skill 5 hits × 6. +10 whenever an enemy is Weakness Broken. E2: +25% Energy Regeneration Rate for 3 turns at battle start.',
      energyFor(sim, u, t) { return t === 'Skill' ? 30 : undefined; },
      battleStart(sim, u) { if (E(u) >= 2) sim.addBuff(u, { id: 'tbHarmonyE2', err: 0.25, turns: 3 }); },
    },
    8008: { // Remembrance: E2 +8 when other memosprites act.
      desc: 'Energy: E2: +8 when an ally memosprite other than Mem takes action.',
      allyAction(sim, u, actor) { if (E(u) >= 2 && actor.memo && actor.name !== 'Mem') G(sim, u, 8); },
    },
  };

  window.AVEnergyKits = kits;
  window.AVEnergyHelpers = { G, F, followUp, isAttack, elationCount, O };
})();
