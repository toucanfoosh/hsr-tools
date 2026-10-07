// Damage estimates for the combat sim.
//
// Stats: base (Lv. 80 character + light cone) × (1 + %) + flat, from traces, light cone and
// relic set bonuses, and relic main/sub stats (from Reliquary Archiver when imported; without
// it relic stats are 0 unless entered by hand). Buffs from allies are applied at hit time.
//
// DMG = Σ(multiplier × stat) × (1 + DMG%) × (1 + CRIT Rate × CRIT DMG) × DEF × RES × Vulnerability × Broken
// Elation DMG = 7535.107 (Lv. 80) × multiplier × CRIT × (1 + Elation) × Punchline × (1 + Merrymake)
//               × DEF × RES × Vulnerability × Broken   (not affected by DMG%; wiki formula)
// Punchline multiplier = 1 + 5P / (P + 240), P = Punchline counted (or Certified Banger).
// Crits use the expected value. Break / Super Break DMG and DoT are not included yet.
(function () {
  const ELATION_LEVEL_MULT = 7535.107;
  const BREAK_LEVEL_MULT = 3767.5533; // Lv. 80
  const BREAK_ELEMENT = { Physical: 2, Fire: 2, Wind: 1.5, Ice: 1, Thunder: 1, Quantum: 0.5, Imaginary: 0.5 };
  const ELEMENT_PROP = {
    Physical: 'PhysicalAddedRatio', Fire: 'FireAddedRatio', Ice: 'IceAddedRatio', Thunder: 'ThunderAddedRatio',
    Wind: 'WindAddedRatio', Quantum: 'QuantumAddedRatio', Imaginary: 'ImaginaryAddedRatio',
  };
  const PROP = {
    AttackAddedRatio: 'atkPct', HPAddedRatio: 'hpPct', DefenceAddedRatio: 'defPct',
    CriticalChanceBase: 'cr', CriticalDamageBase: 'cd', BreakDamageAddedRatioBase: 'be',
    StatusProbabilityBase: 'ehr', StatusResistanceBase: 'res', SPRatioBase: 'err', HealRatioBase: 'heal',
    AllDamageTypeAddedRatio: 'dmg', ElationDamageAddedRatioBase: 'elation',
  };
  const emptyStats = () => ({
    atkBase: 0, hpBase: 0, defBase: 0, atkPct: 0, hpPct: 0, defPct: 0, atk: 0, hp: 0, def: 0,
    cr: 0, cd: 0, dmg: 0, be: 0, ehr: 0, res: 0, err: 0, heal: 0, elation: 0, merrymake: 0, resPen: 0, defIgnore: 0,
  });

  // Out-of-combat stats of a slot (before ally buffs).
  function staticStats(slot, { CHARS, LCS, RELICS }) {
    const ch = CHARS[slot.charId];
    const st = emptyStats();
    const b = ch.combat.base;
    st.atkBase = b.atk; st.hpBase = b.hp; st.defBase = b.def; st.cr = b.cr; st.cd = b.cd;
    const lc = LCS[slot.lcId];
    if (lc && lc.base) { st.atkBase += lc.base.atk; st.hpBase += lc.base.hp; st.defBase += lc.base.def; }
    for (const [k, v] of Object.entries(ch.combat.trace)) if (k in st) st[k] += v;
    const addProps = (props) => (props || []).forEach((p) => {
      if (PROP[p.type]) st[PROP[p.type]] += p.value;
      else if (p.type === ELEMENT_PROP[ch.element]) st.dmg += p.value;
    });
    if (lc && lc.path === ch.path && lc.props) addProps(lc.props[(slot.lcS || 1) - 1]);
    const sets = [];
    if (slot.set1 && slot.set2 === 'same') sets.push([slot.set1, 0], [slot.set1, 1]);
    else { if (slot.set1) sets.push([slot.set1, 0]); if (slot.set2 && slot.set2 !== 'same') sets.push([slot.set2, 0]); }
    if (slot.planar) sets.push([slot.planar, 0]);
    for (const [id, k] of sets) { const r = RELICS[id]; if (r && r.props) addProps(r.props[k]); }
    // Relic main + sub stats (imported from the archiver or typed in).
    const rs = slot.relicStats || {};
    for (const [k, v] of Object.entries(rs)) if (k in st && k !== 'spd') st[k] += v;
    // Character-screen totals typed by the user replace the calculated values.
    const tot = slot.statTotals || {};
    for (const [K, base, pct, flat] of [['ATK', 'atkBase', 'atkPct', 'atk'], ['HP', 'hpBase', 'hpPct', 'hp'], ['DEF', 'defBase', 'defPct', 'def']]) {
      if (tot[K] > 0) st[flat] += tot[K] - (st[base] * (1 + st[pct]) + st[flat]);
    }
    for (const k of ['cr', 'cd', 'dmg', 'be', 'elation', 'err']) if (tot[k] != null && tot[k] !== '') st[k] = +tot[k];
    return st;
  }

  // Current stats of a unit: static stats plus buffs on it.
  function liveStats(sim, u) {
    const s = { ...(u.stats0 || emptyStats()) };
    for (const b of u.buffs) {
      if (!b.stats) continue;
      const n = b.stacks || 1;
      for (const [k, v] of Object.entries(b.stats)) {
        const val = typeof v === 'function' ? v(sim, u) : v;
        s[k] = (s[k] || 0) + val * n;
      }
    }
    return {
      ...s,
      el: u.cfg && u.cfg.char ? u.cfg.char.element : null,
      ATK: s.atkBase * (1 + s.atkPct) + s.atk,
      HP: s.hpBase * (1 + s.hpPct) + s.hp,
      DEF: s.defBase * (1 + s.defPct) + s.def,
    };
  }

  // Which ability an event uses. Kits can override with a `dmgAbility` hook.
  function abilityFor(sim, u, act, extra) {
    const kit = sim.fire(u, 'dmgAbility', act, extra);
    const abs = (u.cfg.char.combat.abilities || []);
    if (kit !== undefined) return kit && abs.find((a) => a.name === kit) || null;
    const main = abs.filter((a) => !a.memo && a.hits && a.hits.length);
    const of = (t) => main.filter((a) => a.type === t);
    switch (act) {
      case 'Basic': return of('Basic')[0] || null;
      case 'Skill': return of('Skill')[0] || null;
      case 'Enhanced': return of('Basic')[1] || of('Skill')[1] || of('Skill')[0] || null;
      case 'Ult': return of('Ult')[0] || null;
      case 'FollowUp': return of('Talent')[0] || null;
      case 'Assist': {
        // Himeko • Nova's Assist: the first two hits are an ally's version, the last two hers.
        const a = abs.find((x) => x.type === 'Assist' && x.hits && x.hits.length);
        if (!a) return null;
        return { ...a, hits: extra && extra.self ? a.hits.slice(2) : a.hits.slice(0, 2) };
      }
      case 'Elation': {
        const el = of('Elation');
        if (extra && extra.label && el.length > 1) return el.find((a) => a.name.startsWith(extra.label.replace('!', ''))) || el[0];
        return el[el.length > 1 && sim.inAha ? 1 : 0] || el[0] || null;
      }
      default: return null;
    }
  }
  function abilityLevel(u, ab) {
    const E = u.cfg.eidolon || 0;
    if (ab.lvl === 'Elation') return Math.min(ab.params.length, 10 + (E >= 3 ? 1 : 0) + (E >= 5 ? 1 : 0));
    if (ab.lvl === 'Memo') return Math.min(ab.params.length, 6);
    const def = ab.lvl === 'Normal' ? 6 : 10;
    let lvl = def;
    for (const [rank, ups] of Object.entries(u.cfg.char.levelUps || {})) if (+rank <= E && ups[ab.lvl]) lvl += ups[ab.lvl];
    return Math.max(1, Math.min(lvl, ab.params.length));
  }
  // Σ multiplier × targets, split by scaling stat.
  function multipliers(sim, u, ab) {
    const row = ab.params[abilityLevel(u, ab) - 1];
    const n = Math.max(1, sim.enemyCount || 1);
    const out = { atk: 0, hp: 0, def: 0, elation: 0 };
    for (const h of ab.hits) {
      if (h.dot) continue;
      const m = row[h.p] || 0;
      const cnt = h.cnt == null ? 1 : typeof h.cnt === 'number' ? h.cnt : (row[h.cnt.p] || 1);
      const targets = { main: 1, adj: Math.min(2, n - 1), blast: 1 + Math.min(2, n - 1), all: n, others: n - 1, random: 1, split: 1 }[h.target] || 1;
      out[h.stat] += m * cnt * targets;
    }
    return out;
  }

  function enemyMods(sim, el) {
    const m = { vuln: 0, def: 0, res: 0 };
    for (const d of sim.enemyMods || []) {
      m.vuln += d.vuln || 0; m.def += d.def || 0; m.res += d.res || 0;
      if (el && d.resEl) m.res += d.resEl[el] || 0; // e.g. Pela E4: Ice RES −12%
    }
    return m;
  }
  // Ability types for type-specific buffs: dmg_Ult, cd_FUA, defIgnore_Skill, resPen_Basic...
  const pick = (st, key, type) => (st[key] || 0) + (type ? st[`${key}_${type}`] || 0 : 0);
  function common(sim, st, type) {
    const em = enemyMods(sim, st.el);
    st = { ...st, defIgnore: pick(st, 'defIgnore', type), resPen: pick(st, 'resPen', type), cd: pick(st, 'cd', type), cr: pick(st, 'cr', type) };
    em.vuln += type ? (sim.enemyMods || []).reduce((a, m) => a + ((m.vulnType && m.vulnType[type]) || 0), 0) : 0;
    const L = sim.enemyLevel || 95;
    const defMult = 100 / ((L + 20) * Math.max(0, 1 - em.def - st.defIgnore) + 100);
    const resMult = Math.min(2, Math.max(0.1, 1 - ((sim.enemyRes == null ? 0.2 : sim.enemyRes) - st.resPen - em.res)));
    const vuln = 1 + em.vuln + (st.vulnSelf || 0);
    const broken = sim.enemyBroken ? 1 : 0.9 + 0.1 * (sim.brokenShare ? sim.brokenShare() : 0);
    const crit = 1 + Math.min(1, Math.max(0, st.cr)) * Math.max(0, st.cd);
    return defMult * resMult * vuln * broken * crit;
  }
  const punchlineMult = (p) => 1 + (p * 5) / (p + 240);

  // Standard (non-Elation) DMG from explicit multipliers (used by kits for extra hits).
  function standard(sim, src, mult, extraDmg = 0, type = null) {
    const st = liveStats(sim, src);
    const base = (mult.atk || 0) * st.ATK + (mult.hp || 0) * st.HP + (mult.def || 0) * st.DEF;
    return base * (1 + pick(st, 'dmg', type) + extraDmg) * common(sim, st, type);
  }
  function elation(sim, src, mult, punchline) {
    const st = liveStats(sim, src);
    return ELATION_LEVEL_MULT * mult * (1 + st.elation) * punchlineMult(punchline) * (1 + st.merrymake) * common(sim, st, 'Elation');
  }
  // Ability type of an event, for type-specific buffs.
  function typeOf(act, ab, unit) {
    if (act === 'FollowUp' || (unit && unit.kind === 'summon' && !unit.memo)) return 'FUA';
    if (unit && unit.memo) return 'Memo';
    if (act === 'Elation') return 'Elation';
    if (act === 'Assist') return 'Skill';
    return ab ? { Basic: 'Basic', Skill: 'Skill', Ult: 'Ult', Talent: 'FUA' }[ab.type] || null : null;
  }

  // Damage of one event. Summons and memosprites hit with their owner's stats.
  function dealDamage(sim, u, act, extra = {}) {
    const src = u.kind === 'summon' ? u.owner : u;
    if (!src || !src.cfg || !src.stats0) return 0;
    let total = 0;
    let ab = null;
    if (u.kind === 'summon') {
      const abs = src.cfg.char.combat.abilities || [];
      ab = (u.memo ? abs.find((a) => a.memo && a.hits && a.hits.length) : null) || abs.find((a) => a.type === 'Talent' && a.hits && a.hits.length) || null;
    } else ab = abilityFor(sim, u, act, extra);
    if (ab) {
      applyToughness(sim, src, ab, u);
      const m = multipliers(sim, src, ab);
      const scale = sim.fireProduct(src, 'dmgScale', act, extra, u);
      total += standard(sim, src, m, 0, typeOf(act, ab, u)) * scale;
      if (m.elation) total += elation(sim, src, m.elation, extra.punchline != null ? extra.punchline : sim.punchline) * scale;
    }
    // Abilities with a DoT clause apply it to the enemies (ticks on enemy turns). Talent DoTs
    // (Arcana, Ashen Roast, Wind Shear...) are applied by the character's attacks.
    const applyDot = (a) => {
      if (!a || !a.hits.some((h) => h.dot)) return;
      const row = a.params[abilityLevel(src, a) - 1];
      const mult = { atk: 0, hp: 0, def: 0 };
      for (const h of a.hits) if (h.dot && h.stat in mult) mult[h.stat] += row[h.p] || 0;
      sim.addDot({ id: `${src.key}:${a.name}`, src, mult, turns: sim.fire(src, 'dotTurns', a) || 2 });
    };
    applyDot(ab);
    if (u === src && ['Basic', 'Skill', 'Enhanced', 'Ult'].includes(act) && sim.isAttack(u, act)) {
      applyDot((src.cfg.char.combat.abilities || []).find((a) => a.type === 'Talent' && a.hits && a.hits.some((h) => h.dot)));
    }
    // Kit extras (Certified Banger Elation hits, additional DMG...): return a DMG amount.
    const more = sim.fireSum(src, 'extraDamage', act, extra, u);
    if (more) total += more;
    return total;
  }

  // ------------------------------------------------------------------ kits
  // Ally buffs (`stats`) and enemy debuffs (sim.addEnemyMod) that raise damage. Values are the
  // Lv. 10 figures from the game text. Only the most common supports are covered so far.
  const allChars = (sim) => sim.chars();
  const team = (sim, id, stats, turns = 2, extra = {}) => allChars(sim).forEach((a) => sim.addBuff(a, { id, stats, turns, ...extra }));
  const cbElation = (sim, u, act, table) => {
    // "While holding Certified Banger": extra Elation DMG on some abilities.
    const cb = sim.cbTotal(u);
    if (!(cb > 0) || !table[act]) return 0;
    const n = Math.max(1, sim.enemyCount || 1);
    const mult = table[act](n);
    return mult > 0 ? elation(sim, u, mult, cb) : 0;
  };
  const kits = {
    1204: { // Jing Yuan: Lightning-Lord hits once per stored Hit (3–10).
      dmgScale(sim, u, act, extra, unit) { return unit && unit.name === 'Lightning-Lord' ? (u.state.lastHits || 3) : 1; },
    },
    1112: { // Topaz: Proof of Debt +50% Follow-Up DMG taken (Numby and her Skill are Follow-Ups); Windfall +150% multiplier.
      dmgScale(sim, u, act, extra, unit) {
        if (unit && unit.name === 'Numby') return 1.5 * (u.state.bonanza > 0 ? 2 : 1);
        return act === 'Skill' || act === 'Basic' || act === 'FollowUp' ? 1.5 : 1;
      },
    },
    1220: { // Feixiao: Skill +48% ATK (3 turns); after her Talent follow-up +60% DMG (2 turns); follow-up CD +36%.
      action(sim, u, t) { if (t === 'Skill') sim.addBuff(u, { id: 'boltcatch', stats: { atkPct: 0.48 }, turns: 3 }); },
      followUpDone(sim, u) { sim.addBuff(u, { id: 'thunderhunt', stats: { dmg: 0.6 }, turns: 2 }); },
      // Formshift: Follow-Up (and Ultimate, counted as Follow-Up) CRIT DMG +36%.
      dmgScale(sim, u, act) {
        if (act !== 'Ult' && act !== 'FollowUp') return 1;
        const st = liveStats(sim, u), cr = Math.min(1, st.cr);
        return (1 + cr * (st.cd + 0.36)) / (1 + cr * st.cd);
      },
    },
    8006: { // Trailblazer • Harmony: Ult Backup Dancer (3 of TB's turns): +30% BE and Super Break (×(1 + 60/50/40/30/20%) for 1/2/3/4/5+ enemies).
      ult(sim, u) {
        const bonus = [0, 0.6, 0.5, 0.4, 0.3, 0.2][Math.min(5, Math.max(1, sim.enemyCount))];
        team(sim, 'backupDancer', { be: 0.3, superBreak: 1 + bonus }, 3, { tick: 'owner', owner: u });
      },
    },
    1225: { // Fugue: while on field, allies' hits on broken enemies → 100% Super Break; Skill target +30% BE.
      battleStart(sim, u) { team(sim, 'fugueSB', { superBreak: 1 }, Infinity); },
      action(sim, u, t) {
        if (t === 'Skill') { sim.addEnemyMod({ id: 'foxian', def: 0.18, turns: 3 }); const tg = sim.targetOf(u); if (tg) sim.addBuff(tg, { id: 'foxianBE', stats: { be: 0.3 }, turns: 3 }); }
      },
    },
    1310: { // Firefly: Combustion: +50% WBE, +25% BE, Super Break 100% (BE ≥150%) / 150% (BE ≥300%), +20% Break DMG.
      ult(sim, u) {
        // fireflySB: Super Break 100% / 150% at 150% / 300% Break Effect (resolved in applyToughness).
        sim.addBuff(u, { id: 'combustDmg', stats: { wbe: 0.5 + (u.cfg.eidolon >= 6 ? 0.5 : 0), be: 0.25, breakDmg: 0.2, fireflySB: 1 }, turns: Infinity });
      },
      turnStart(sim, u) { if (!u.state.combust) sim.removeBuff(u, 'combustDmg'); },
    },
    1317: { // Rappa: Sealform +50% WBE, +30% BE; Enhanced Basic vs broken → 60% Super Break.
      ult(sim, u) { sim.addBuff(u, { id: 'sealform', stats: { wbe: 0.5, be: 0.3, superBreak: 0.6 }, turns: Infinity }); },
      turnStart(sim, u) { if (!(u.state.ink > 0)) sim.removeBuff(u, 'sealform'); },
    },
    1321: { // The Dahlia: Zone +50% WBE for all; Dance Partners' attacks on broken → 60% Super Break.
      action(sim, u, t) {
        if (t !== 'Skill') return;
        team(sim, 'dahliaZone', { wbe: 0.5 }, 3, { tick: 'owner', owner: u });
        const tg = sim.targetOf(u);
        [u, tg].filter(Boolean).forEach((a) => sim.addBuff(a, { id: 'dancePartner', stats: { superBreak: 0.6 }, turns: Infinity }));
      },
      ult(sim, u) { sim.addEnemyMod({ id: 'wilt', def: 0.18, turns: 4 }); },
    },
    1309: { // Robin: Skill +50% DMG (3 of her turns); Concerto ATK + 22.8% of her ATK + 200; talent CD +20%.
      battleStart(sim, u) { team(sim, 'robinCD', { cd: 0.2 }, Infinity); },
      action(sim, u, t) { if (t === 'Skill') team(sim, 'robinSkill', { dmg: 0.5 }, 3, { tick: 'owner', owner: u }); },
      ult(sim, u) {
        const flat = 0.228 * liveStats(sim, u).ATK + 200;
        team(sim, 'concerto', { atk: flat }, Infinity);
        u.state.concertoBuff = true;
      },
      turnStart(sim, u) { if (u.state.concertoBuff && !u.state.concerto) { sim.units.forEach((x) => sim.removeBuff(x, 'concerto')); u.state.concertoBuff = false; } },
      // Concerto: Physical Additional DMG 120% ATK (fixed 100% CRIT, 150% CRIT DMG) after every ally attack.
      allyAttack(sim, u) {
        if (!u.state.concerto) return;
        const st = liveStats(sim, u);
        const dmg = 1.2 * st.ATK * (1 + st.dmg) * (1 + 1.5) * common(sim, { ...st, cr: 0, cd: 0 });
        sim.addDamage(u, dmg, 'Concerto');
      },
    },
    1313: { // Sunday: Skill target +30% DMG (+50% with a summon) 2 turns, +20% CR 3 turns; Ult: Beatified CD.
      action(sim, u, t) {
        if (t !== 'Skill') return;
        const tg = sim.targetOf(u); if (!tg) return;
        const summon = sim.units.some((x) => x.alive && x.owner === tg && x.kind === 'summon');
        sim.addBuff(tg, { id: 'sundayDmg', stats: { dmg: summon ? 0.8 : 0.3 }, turns: 2 });
        sim.addBuff(tg, { id: 'sundayCR', stats: { cr: 0.2 }, turns: 3 });
      },
      ult(sim, u) {
        const tg = sim.targetOf(u); if (!tg) return;
        const cd = 0.3 * liveStats(sim, u).cd + 0.12;
        sim.units.forEach((x) => sim.removeBuff(x, 'beatified'));
        sim.addBuff(tg, { id: 'beatified', stats: { cd }, turns: 3, tick: 'owner', owner: u });
      },
    },
    1101: { // Bronya: Skill +66% DMG 1 turn; Ult +55% ATK, CD 16% of hers +20% for 2 turns; +10% DMG trace.
      battleStart(sim, u) { team(sim, 'bronyaTrace', { dmg: 0.1 }, Infinity); },
      action(sim, u, t) { if (t === 'Skill') { const tg = sim.targetOf(u); if (tg) sim.addBuff(tg, { id: 'bronyaSkill', stats: { dmg: 0.66 }, turns: 1 }); } },
      ult(sim, u) { const cd = 0.16 * liveStats(sim, u).cd + 0.2; team(sim, 'bronyaUlt', { atkPct: 0.55, cd }, 2); },
    },
    1306: { // Sparkle (Novaflare): Skill CD 24% of hers +45% (2 turns); +45% ATK trace; Figment vuln 4%/SP (3).
      battleStart(sim, u) { team(sim, 'sparkleATK', { atkPct: 0.45 }, Infinity); },
      action(sim, u, t) { if (t === 'Skill') { const tg = sim.targetOf(u); if (tg) sim.addBuff(tg, { id: 'sparkleCD', stats: { cd: 0.24 * liveStats(sim, u).cd + 0.45, resPen: 0.1 }, turns: 2 }); } },
      spUsed(sim, u, by, n) { u.state.fig = Math.min(3, (u.state.fig || 0) + n); sim.addEnemyMod({ id: 'figment', vuln: 0.04 * u.state.fig, turns: 2 }); },
    },
    1303: { // Ruan Mei: Skill +32% DMG (3 turns); Ult zone +25% RES PEN (2 turns); +20% BE.
      battleStart(sim, u) { team(sim, 'rmBE', { be: 0.2 }, Infinity); },
      action(sim, u, t) { if (t === 'Skill') team(sim, 'rmSkill', { dmg: 0.32, wbe: 0.5 }, 3, { tick: 'owner', owner: u }); },
      ult(sim, u) { team(sim, 'rmZone', { resPen: 0.25 }, 2, { tick: 'owner', owner: u }); },
    },
    1202: { // Tingyun: Benediction +50% ATK (max 25% of hers; simplified to 50%), Ult +50% DMG 2 turns.
      action(sim, u, t) { if (t === 'Skill') { const tg = sim.targetOf(u); if (tg) sim.addBuff(tg, { id: 'benediction', stats: { atk: Math.min(0.5 * liveStats(sim, tg).ATK, 0.25 * liveStats(sim, u).ATK) }, turns: 3 }); } },
      ult(sim, u) { const tg = sim.targetOf(u); if (tg) sim.addBuff(tg, { id: 'tingyunUlt', stats: { dmg: 0.5 }, turns: 2 }); },
    },
    1215: { // Hanya: Ult target +60% ATK 2 turns; Burden +30% DMG.
      ult(sim, u) { const tg = sim.targetOf(u); if (tg) sim.addBuff(tg, { id: 'hanyaUlt', stats: { atkPct: 0.6 }, turns: 2 }); },
      action(sim, u, t) { if (t === 'Skill') team(sim, 'burden', { dmg: 0.3 }, 2); },
    },
    1106: { // Pela: Ult Exposed −40% DEF 2 turns; +10% EHR.
      ult(sim, u) { sim.addEnemyMod({ id: 'exposed', def: 0.4, turns: 2 }); },
    },
    1006: { // Silver Wolf (Novaflare): Skill −13% All RES (+20% implant), Ult −45% DEF 3 turns, Bug −12% DEF.
      action(sim, u, t) {
        if (t === 'Skill') sim.addEnemyMod({ id: 'swRes', res: 0.13 + 0.2, turns: 2 });
        if (t === 'Basic' || t === 'Skill') sim.addEnemyMod({ id: 'swBug', def: 0.12, turns: 4 });
      },
      ult(sim, u) { sim.addEnemyMod({ id: 'swUlt', def: 0.45, turns: 3 }); },
    },
    1218: { // Jiaoqiu: Ashen Roast vuln 15% +5%/stack (to 35%); Ult zone +15% Ultimate DMG taken.
      action(sim, u, t) { if (t === 'Basic' || t === 'Skill') { u.state.roast = Math.min(5, (u.state.roast || 0) + 1); this.roast(sim, u); } },
      ult(sim, u) { u.state.roast = Math.max(u.state.roast || 1, 1); this.roast(sim, u); },
      roast(sim, u) { sim.addEnemyMod({ id: 'ashenRoast', vuln: 0.15 + 0.05 * (u.state.roast - 1), turns: 2 }); },
    },
    1403: { // Tribbie: Numinosity +24% RES PEN; Zone +30% DMG taken (2 turns).
      action(sim, u, t) { if (t === 'Skill') team(sim, 'numinosity', { resPen: 0.24 }, 3, { tick: 'owner', owner: u }); },
      ult(sim, u) { sim.addEnemyMod({ id: 'tribbieZone', vuln: 0.3, turns: 2 }); },
    },
    1412: { // Cerydra: Military Merit +24% of her ATK as ATK.
      action(sim, u, t) { if (t === 'Skill') { const tg = sim.targetOf(u); if (tg) sim.addBuff(tg, { id: 'merit', stats: { atk: 0.24 * liveStats(sim, u).ATK }, turns: Infinity }); } },
    },
    1406: { // Cipher: while on field, enemies take +40% DMG.
      battleStart(sim, u) { sim.addEnemyMod({ id: 'cipher', vuln: 0.4, turns: Infinity }); },
    },
    1307: { // Black Swan: Skill DEF −20.8% 3 turns; Ult Epiphany +25% DMG taken 2 turns.
      // Arcana: 240% + 12% per stack; assume ~15 stacks on average (not halved during Epiphany).
      dotScale() { return (2.4 + 0.12 * 15) / 2.4; },
      dotTurns() { return 3; },
      action(sim, u, t) { if (t === 'Skill' || t === 'Basic') sim.addEnemyMod({ id: 'bsDef', def: 0.208, turns: 3 }); },
      ult(sim, u) { sim.addEnemyMod({ id: 'epiphany', vuln: 0.25, turns: 2 }); },
    },
    1410: { // Hysilens: Skill +20% DMG taken 3 turns; Zone DEF −25%.
      battleStart(sim, u) { sim.addEnemyMod({ id: 'hysZone', def: 0.25, turns: 3 }); },
      action(sim, u, t) { if (t === 'Skill') sim.addEnemyMod({ id: 'hysSkill', vuln: 0.2, turns: 3 }); },
      ult(sim, u) { sim.addEnemyMod({ id: 'hysZone', def: 0.25, turns: 3 }); },
    },
    1405: { // Anaxa: 2+ Erudition: all allies +50% DMG.
      battleStart(sim, u) { if (sim.chars().filter((a) => a.cfg.char.path === 'Erudition').length >= 2) team(sim, 'anaxa', { dmg: 0.5 }, Infinity); },
    },
    1401: { // The Herta: 2+ Erudition: all allies +80% CRIT DMG.
      battleStart(sim, u) { if (sim.chars().filter((a) => a.cfg.char.path === 'Erudition').length >= 2) team(sim, 'theHerta', { cd: 0.8 }, Infinity); },
    },
    1508: { // Rin: Ult +20% DMG taken 3 turns; SP use/recovery: +70% CD 2 turns.
      ult(sim, u) { sim.addEnemyMod({ id: 'rinUlt', vuln: 0.2, turns: 3 }); },
      spUsed(sim, u, by) { if (by && by.kind === 'char') sim.addBuff(by, { id: 'rinCD', stats: { cd: 0.7 }, turns: 2 }); },
    },
    1504: { // Ashveil: allies +40% CRIT DMG.
      battleStart(sim, u) { team(sim, 'ashveil', { cd: 0.4 }, Infinity); },
    },
    1509: { // Gilgamesh: allies +20% ATK, +20% CRIT DMG.
      battleStart(sim, u) { team(sim, 'gil', { atkPct: 0.2, cd: 0.2 }, Infinity); },
    },
    1510: { // Himeko • Nova: Navigator's Semaphore +20% DMG (3 turns after Skill).
      action(sim, u, t) { if (t === 'Skill') team(sim, 'semaphore', { dmg: 0.2 }, 3, { tick: 'owner', owner: u }); },
    },
    1407: { // Castorice: Lost Netherland −20% All RES while Netherwing is out (3 turns).
      ult(sim, u) { sim.addEnemyMod({ id: 'netherland', res: 0.2, turns: 3 }); },
    },
    1308: { // Acheron: −20% All RES during her Ultimate; 2 other Nihility: ×1.6 (1: ×1.15).
      dmgScale(sim, u, act) {
        const n = sim.allies(u).filter((a) => a.cfg.char.path === 'Nihility').length;
        return act === 'Basic' || act === 'Skill' || act === 'Ult' ? (n >= 2 ? 1.6 : n === 1 ? 1.15 : 1) : 1;
      },
    },
    1304: { // Aventurine: Ult Unnerved: allies +15% CRIT DMG vs it (3 turns).
      ult(sim, u) { team(sim, 'unnerved', { cd: 0.15 }, 3); },
    },
    1413: { // Evernight: Darkest Riddle: enemies +30% DMG taken.
      ult(sim, u) { sim.addEnemyMod({ id: 'darkestRiddle', vuln: 0.3, turns: 2 }); },
    },
    1507: { // Mortenax Blade: Zone: allies +50% DMG.
      ult(sim, u) { if (!u.state.furyBuff) { u.state.furyBuff = true; team(sim, 'balefireZone', { dmg: 0.5 }, 3, { tick: 'owner', owner: u }); } },
    },
    // ---------------------------------------------------------------- Elation
    1501: { // Sparxie: +8% CRIT DMG per Punchline (max 80%). CB: Enhanced Basic 40%/20%, Ult 48% all.
      battleStart(sim, u) { team(sim, 'sparxieCD', { cd: (s) => Math.min(0.8, 0.08 * s.punchline) }, Infinity); },
      extraDamage(sim, u, act) { return cbElation(sim, u, act, { Enhanced: (n) => 0.4 + 0.2 * Math.min(2, n - 1), Ult: (n) => 0.48 * n }); },
    },
    1502: { // Yao Guang: Ult +20% RES PEN 3 turns; Elation Skill: Woe's Whisper +16% DMG taken 3 turns.
      ult(sim, u) { team(sim, 'yaoPen', { resPen: 0.2 }, 3); },
      elation(sim, u) { sim.addEnemyMod({ id: 'woe', vuln: 0.16, turns: 3 }); },
      // Great Boon: 20% Elation DMG after each ally attack (+1 more if it used SP) while holding CB.
      allyAttack(sim, u, actor, t) {
        if (!(sim.cbTotal(u) > 0) || actor.kind !== 'char') return;
        const k = t === 'Skill' ? 2 : 1;
        sim.addDamage(u, k * elation(sim, u, 0.2, sim.cbTotal(u)), 'Great Boon');
      },
    },
    1503: { // Pearl: CB Enhanced Basic +15% Elation (all). Elation Skill: allies' next attack +40% Elation (4 Elation).
      extraDamage(sim, u, act) { return cbElation(sim, u, act, { Enhanced: () => 0.15 }); },
    },
    1505: { // Evanescia: CB: Skill 16% (targets hit), Ult 24% all + 28% per bounce, Master Fox 25% all.
      extraDamage(sim, u, act, extra) {
        return cbElation(sim, u, act, {
          Skill: (n) => 0.16 * Math.min(3, n), Ult: (n) => 0.24 * n + 0.28 * 5,
          FollowUp: (n) => (extra && extra.label === 'Master Fox' ? 0.25 * n : 0),
        });
      },
    },
    1506: { // Silver Wolf LV.999: CB: Basic / Skill +40% Elation on hit targets.
      extraDamage(sim, u, act) { return cbElation(sim, u, act, { Basic: () => 0.4, Skill: (n) => 0.4 * n }); },
    },
    1513: { // Aventurine • Waveflair: CB: Skill 40% all, Ult 72% all.
      extraDamage(sim, u, act) { return cbElation(sim, u, act, { Skill: (n) => 0.4 * n, Ult: (n) => 0.72 * n }); },
    },
    8010: { // Trailblazer • Elation: CB: Skill 30% all (highest CB among allies). Ult target +50% CRIT DMG 3 turns.
      extraDamage(sim, u, act) {
        if (act !== 'Skill') return 0;
        const cb = Math.max(0, ...sim.chars().map((a) => sim.cbTotal(a)));
        return sim.cbTotal(u) > 0 ? elation(sim, u, 0.3 * Math.max(1, sim.enemyCount), cb) : 0;
      },
      ult(sim, u) { const tg = sim.targetOf(u); if (tg) sim.addBuff(tg, { id: 'tbElationCD', stats: { cd: 0.5 }, turns: 3 }); },
    },
  };

  // Break DMG on one enemy (no CRIT; the enemy is broken → ×1.0).
  function breakDamage(sim, u) {
    const st = liveStats(sim, u);
    const el = BREAK_ELEMENT[u.cfg.char.element] || 1;
    const tough = sim.enemyToughness || 160;
    return BREAK_LEVEL_MULT * el * (0.5 + tough / 40) * (1 + st.be) * (1 + (st.breakDmg || 0))
      * common(sim, { ...st, cr: 0 }) / (0.9 + 0.1 * (sim.brokenShare ? sim.brokenShare() : 0));
  }
  // Toughness: reduce every enemy by its share of the hit (main target: one + all; adjacent:
  // spread + all; others: all). Returns the reduction per broken enemy for Super Break.
  function applyToughness(sim, src, ab, attacker) {
    const t = ab && ab.tough;
    if (!t || !sim.enemies) return;
    const es = sim.enemies();
    if (!es.length) return;
    const st = liveStats(sim, src);
    const wbe = 1 + (st.wbe || 0);
    let sbTough = 0, sbHits = 0;
    es.forEach((e, i) => {
      const raw = ((i === 0 ? t.one || 0 : i <= 2 ? t.spread || 0 : 0) + (t.all || 0)) / 3 * wbe;
      if (!raw) return;
      if (e.broken) { sbTough += raw; sbHits += 1; return; }
      e.tough -= raw;
      if (e.tough <= 1e-9) sim.breakEnemy(e, src);
    });
    // Super Break: Toughness reduction dealt to already-broken enemies.
    const sb = (st.superBreak || 0) + (st.fireflySB ? (st.be >= 3 ? 1.5 : st.be >= 1.5 ? 1 : 0) : 0);
    if (sbTough > 0 && sb > 0) {
      const dmg = BREAK_LEVEL_MULT * (sbTough / 10) * (1 + st.be) * sb * common(sim, { ...st, cr: 0 }) / (0.9 + 0.1 * sim.brokenShare());
      sim.addDamage(src, dmg, 'Super Break');
    }
  }

  // One DoT tick on one enemy: DMG% applies, CRIT doesn't.
  function dotDamage(sim, d) {
    const st = liveStats(sim, d.src);
    const base = (d.mult.atk || 0) * st.ATK + (d.mult.hp || 0) * st.HP + (d.mult.def || 0) * st.DEF;
    return base * (1 + st.dmg + (st.dotDmg || 0)) * common(sim, { ...st, cr: 0 }, 'DoT') * sim.fireProduct(d.src, 'dotScale', d);
  }

  window.AVDamage = { breakDamage, applyToughness, dotDamage, staticStats, liveStats, dealDamage, standard, elation, punchlineMult, kits, ELATION_LEVEL_MULT };
})();
