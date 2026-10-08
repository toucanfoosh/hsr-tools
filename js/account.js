// Your in-game account, loaded from Reliquary Archiver (https://github.com/IceDynamix/reliquary-archiver).
//
// The archiver hosts a WebSocket at ws://<host>:23313/ws. It sends
//   { event: "InitialScan", data: Export }                         on connect / account switch
//   { event: "UpdateRelics" | "UpdateLightCones" | "UpdateCharacters", data: [...] }
//   { event: "DeleteRelics" | "DeleteLightCones", data: ["<_uid>", ...] }
// Its JSON export file has the same `Export` shape, so it can be imported by hand too.
// The merged export is kept in IndexedDB so it survives reloads and browser restarts.
(function () {
  const DB_NAME = 'hsr-tools';
  const STORE = 'kv';
  const KEY = 'account';
  const SETTINGS_KEY = 'hsr-tools:archiver';
  const DEFAULTS = { host: 'localhost', port: 23313, auto: true };
  // Boots main stat: SPD = base + step * level, by relic rarity (StarRailRes relic_main_affixes).
  const BOOTS = { 2: [1.6128, 1], 3: [2.4192, 1], 4: [3.2256, 1.1], 5: [4.032, 1.4] };
  const CAVERN = ['Head', 'Hands', 'Body', 'Feet'];
  const PLANAR = ['Planar Sphere', 'Link Rope'];

  let account = null; // { export, updatedAt, source }
  let status = 'idle'; // idle | searching | connected | offline
  let ws = null;
  let retryTimer = null;
  let retryDelay = 3000;
  const listeners = new Set();

  // ---------------------------------------------------------------- persistence
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbGet() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbPut(value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (value) tx.objectStore(STORE).put(value, KEY); else tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  let saveTimer = null;
  function persist() {
    // Live updates can arrive in bursts (e.g. levelling a relic), so batch the writes.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => dbPut(account).catch((e) => console.warn('Could not save account data', e)), 400);
  }

  function settings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) { return { ...DEFAULTS }; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings(), ...s })); } catch (e) { /* ignore */ }
    reconnect();
  }

  function emit() { listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // ---------------------------------------------------------------- data updates
  function setExport(exp, source) {
    if (!exp || !Array.isArray(exp.characters)) throw new Error('This file is not a Reliquary Archiver export.');
    account = { export: exp, updatedAt: Date.now(), source };
    persist();
    emit();
  }

  // Manual edits from the Inventory tab. Starts an empty account if none is loaded yet.
  // The next archiver scan (Sync all) replaces everything, edits included.
  function edit(fn) {
    if (!account) account = { export: { metadata: {}, characters: [], light_cones: [], relics: [] }, updatedAt: Date.now(), source: 'manual' };
    fn(account.export);
    account.updatedAt = Date.now();
    account.edited = true;
    persist();
    emit();
  }

  function upsert(list, items, key) {
    const byKey = new Map(list.map((x, i) => [String(x[key]), i]));
    for (const it of items) {
      const i = byKey.get(String(it[key]));
      if (i === undefined) list.push(it); else list[i] = it;
    }
  }

  function handleEvent(msg) {
    const { event, data } = msg;
    if (event === 'InitialScan') return setExport(data, 'archiver');
    if (!account) return; // updates before a scan have nothing to apply to
    const exp = account.export;
    switch (event) {
      case 'UpdateRelics': upsert(exp.relics, data, '_uid'); break;
      case 'UpdateLightCones': upsert(exp.light_cones, data, '_uid'); break;
      case 'UpdateCharacters': upsert(exp.characters, data, 'id'); break;
      case 'DeleteRelics': { const d = new Set(data.map(String)); exp.relics = exp.relics.filter((r) => !d.has(String(r._uid))); break; }
      case 'DeleteLightCones': { const d = new Set(data.map(String)); exp.light_cones = exp.light_cones.filter((l) => !d.has(String(l._uid))); break; }
      default: return; // gacha / material events aren't used yet
    }
    account.updatedAt = Date.now();
    persist();
    emit();
  }

  // ---------------------------------------------------------------- websocket
  function setStatus(s) { if (status !== s) { status = s; emit(); } }

  function connect() {
    const s = settings();
    if (ws || !s.auto) return;
    clearTimeout(retryTimer);
    setStatus(status === 'connected' ? 'connected' : 'searching');
    let sock;
    try { sock = new WebSocket(`ws://${s.host}:${s.port}/ws`); } catch (e) { scheduleRetry(); return; }
    ws = sock;
    sock.onopen = () => { retryDelay = 3000; setStatus('connected'); };
    sock.onmessage = (m) => {
      try { handleEvent(JSON.parse(m.data)); } catch (e) { console.warn('Bad archiver message', e); }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      setStatus('offline');
      scheduleRetry();
    };
    sock.onerror = () => { /* onclose follows and handles the retry */ };
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (!settings().auto) return;
    // Keep looking quietly: fast at first, then every 30s. Pause while the tab is hidden.
    retryTimer = setTimeout(() => { if (!document.hidden) connect(); else scheduleRetry(); }, retryDelay);
    retryDelay = Math.min(30000, retryDelay * 1.6);
  }

  function reconnect() {
    clearTimeout(retryTimer);
    retryDelay = 3000;
    if (ws) { const old = ws; ws = null; old.close(); }
    if (settings().auto) connect(); else setStatus('idle');
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !ws && settings().auto) { retryDelay = 3000; connect(); }
  });

  // ---------------------------------------------------------------- queries
  // Trailblazer ids come in Caelus (odd) / Stelle (even) pairs; the site uses the even ids.
  const normId = (id) => {
    const n = +id;
    return n >= 8001 && n <= 8100 && n % 2 ? String(n + 1) : String(id);
  };

  function character(charId) {
    if (!account) return null;
    return account.export.characters.find((c) => normId(c.id) === String(charId)) || null;
  }
  const ownedIds = () => new Set(account ? account.export.characters.map((c) => normId(c.id)) : []);

  function ownedLightCones() {
    const out = new Map(); // id -> best superimposition
    if (!account) return out;
    for (const l of account.export.light_cones) {
      const id = String(l.id);
      out.set(id, Math.max(out.get(id) || 0, l.superimposition || 1));
    }
    return out;
  }

  // Everything the Combat Sim needs to pre-fill a character's slot.
  function buildFor(charId) {
    const ch = character(charId);
    if (!ch) return null;
    const exp = account.export;
    const worn = (x) => x.location && normId(x.location) === String(charId);
    const lc = exp.light_cones.find(worn);
    return {
      ...relicBuild(exp.relics.filter(worn), charId),
      eidolon: ch.eidolon || 0,
      lcId: lc ? String(lc.id) : '',
      lcS: lc ? lc.superimposition || 1 : 1,
      level: ch.level,
    };
  }

  // The slot fields a set of relic pieces gives a character: sets, SPD from boots and
  // substats, ER rope and the summed main / sub stats. Used for the equipped build and by the
  // optimizer for candidate builds.
  function relicBuild(relics, charId) {

    const count = (slots) => {
      const n = new Map();
      relics.filter((r) => slots.includes(r.slot)).forEach((r) => n.set(String(r.set_id), (n.get(String(r.set_id)) || 0) + 1));
      return [...n.entries()].sort((a, b) => b[1] - a[1]);
    };
    const cavern = count(CAVERN).filter(([, n]) => n >= 2);
    let set1 = '', set2 = 'same';
    if (cavern.length && cavern[0][1] >= 4) set1 = cavern[0][0];
    else if (cavern.length) { set1 = cavern[0][0]; if (cavern[1]) set2 = cavern[1][0]; }
    const planar = count(PLANAR).find(([, n]) => n >= 2);

    const feet = relics.find((r) => r.slot === 'Feet');
    const bootsSpd = feet && feet.mainstat === 'SPD'
      ? (BOOTS[feet.rarity] || BOOTS[5])[0] + (BOOTS[feet.rarity] || BOOTS[5])[1] * feet.level
      : 0;
    const subSpd = relics.reduce((sum, r) => sum + r.substats.filter((s) => s.key === 'SPD').reduce((a, s) => a + s.value, 0), 0);
    // Energy Regeneration Rate Link Rope: exact main-stat value for its rarity and level.
    const rope = relics.find((r) => r.slot === 'Link Rope' && /Energy Regen/i.test(r.mainstat));
    const ropeAffix = rope && window.HSR_DATA.relicMain[String(rope.rarity)] && window.HSR_DATA.relicMain[String(rope.rarity)]['Link Rope'].SPRatioBase;
    const errRopeValue = ropeAffix ? ropeAffix[0] + ropeAffix[1] * rope.level : undefined;

    // Relic main + sub stats in the calculator's stat keys (for damage).
    const relicStats = relicTotals(relics, (window.HSR_DATA.characters.find((c) => c.id === String(charId)) || {}).element);
    return {
      relicStats,
      set1, set2: set1 ? set2 : 'same',
      planar: planar ? planar[0] : '',
      boots: bootsSpd > 0,
      bootsSpd: bootsSpd ? Math.round(bootsSpd * 1000) / 1000 : undefined,
      subSpd: Math.round(subSpd * 1000) / 1000,
      errRope: !!rope, errRopeValue: errRopeValue != null ? Math.round(errRopeValue * 10000) / 10000 : undefined,
      relicCount: relics.length,
    };
  }

  const MAIN_PROP = {
    'CRIT Rate': 'CriticalChanceBase', 'CRIT DMG': 'CriticalDamageBase', 'Outgoing Healing Boost': 'HealRatioBase',
    'SPD': 'SpeedDelta', 'Effect Hit Rate': 'StatusProbabilityBase', 'Break Effect': 'BreakDamageAddedRatioBase',
    'Energy Regeneration Rate': 'SPRatioBase', DEF: 'DefenceAddedRatio',
  };
  const PROP_KEY = {
    HPDelta: 'hp', AttackDelta: 'atk', HPAddedRatio: 'hpPct', AttackAddedRatio: 'atkPct', DefenceAddedRatio: 'defPct',
    CriticalChanceBase: 'cr', CriticalDamageBase: 'cd', HealRatioBase: 'heal', SpeedDelta: 'spd',
    StatusProbabilityBase: 'ehr', BreakDamageAddedRatioBase: 'be', SPRatioBase: 'err',
  };
  const ELEMENT_NAME = { Physical: 'Physical', Fire: 'Fire', Ice: 'Ice', Thunder: 'Lightning', Wind: 'Wind', Quantum: 'Quantum', Imaginary: 'Imaginary' };
  const ELEMENT_PROP = { Physical: 'PhysicalAddedRatio', Fire: 'FireAddedRatio', Ice: 'IceAddedRatio', Thunder: 'ThunderAddedRatio', Wind: 'WindAddedRatio', Quantum: 'QuantumAddedRatio', Imaginary: 'ImaginaryAddedRatio' };
  const SUB_KEY = {
    HP: 'hp', ATK: 'atk', DEF: 'def', HP_: 'hpPct', ATK_: 'atkPct', DEF_: 'defPct', 'CRIT Rate_': 'cr', 'CRIT DMG_': 'cd',
    'Effect Hit Rate_': 'ehr', 'Effect RES_': 'res', 'Break Effect_': 'be', SPD: 'spd',
  };
  // Sum of relic main stats (exact for rarity and level) and substats.
  function relicTotals(relics, element) {
    const out = {};
    const add = (k, v) => { if (k) out[k] = Math.round(((out[k] || 0) + v) * 1e6) / 1e6; };
    for (const r of relics) {
      let prop = MAIN_PROP[r.mainstat];
      if (r.mainstat === 'HP') prop = r.slot === 'Head' ? 'HPDelta' : 'HPAddedRatio';
      if (r.mainstat === 'ATK') prop = r.slot === 'Hands' ? 'AttackDelta' : 'AttackAddedRatio';
      if (/DMG Boost$/.test(r.mainstat)) prop = r.mainstat.startsWith(ELEMENT_NAME[element] || '?') ? ELEMENT_PROP[element] : null;
      const table = window.HSR_DATA.relicMain[String(r.rarity)];
      const aff = prop && table && table[r.slot] && table[r.slot][prop];
      if (aff) add(PROP_KEY[prop] || (prop === ELEMENT_PROP[element] ? 'dmg' : null), aff[0] + aff[1] * r.level);
      for (const sub of r.substats || []) {
        const k = SUB_KEY[sub.key];
        if (k) add(k, sub.key.endsWith('_') ? sub.value / 100 : sub.value);
      }
    }
    delete out.spd; // SPD is handled by the Speed field
    return out;
  }

  async function importFile(file) {
    const text = await file.text();
    setExport(JSON.parse(text), 'file');
  }

  async function clear() {
    account = null;
    await dbPut(null).catch(() => {});
    emit();
  }

  async function init() {
    try { account = await dbGet(); } catch (e) { console.warn('IndexedDB unavailable; account data will not persist', e); }
    emit();
    connect();
  }

  window.HSRAccount = {
    init, onChange, connect: reconnect, importFile, clear, settings, saveSettings,
    buildFor, relicBuild, relicTotals, normId, character, ownedIds, ownedLightCones, edit,
    get status() { return status; },
    get data() { return account; },
  };
})();
