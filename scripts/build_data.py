#!/usr/bin/env python3
"""Build data/hsr-data.js from the Mar-7th/StarRailRes dataset.

Usage: python3 scripts/build_data.py [--no-images]
Re-run after a game patch to pick up new characters, light cones and relic sets.
Relic set and light cone images are saved under assets/ (existing files are skipped).
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SRC = "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_new/en/"
FILES = [
    "characters", "character_promotions", "character_skills", "character_skill_trees",
    "character_ranks", "light_cones", "light_cone_ranks", "light_cone_promotions",
    "relic_sets", "relic_main_affixes", "paths",
]
# Per-ability energy, Ultimate cost, Toughness, base stats and Novaflare (enhanced) kits come
# from Project Yatta. Characters with a Novaflare kit always use it.
YATTA = "https://sr.yatta.moe/api/v2/en/avatar"
# Elation Skill order during an Aha Instant (lowest first), from the HSR wiki.
ELATION_PID = {"1503": "104", "1502": "116", "8010": "120", "8009": "120", "1501": "144",
               "1505": "146", "1513": "156", "1506": "999"}
# Yatta trace-node icons -> stat keys used by the calculator.
STAT_ICON = {
    "IconMaxHP": "hpPct", "IconAttack": "atkPct", "IconDefence": "defPct", "IconSpeed": "spd",
    "IconCriticalChance": "cr", "IconCriticalDamage": "cd", "IconBreakUp": "be",
    "IconStatusProbability": "ehr", "IconStatusResistance": "res", "IconEnergyRecovery": "err",
    "IconHealRatio": "heal", "IconElation": "elation", "IconJoy": "elation",
    "IconPhysicalAddedRatio": "dmg", "IconFireAddedRatio": "dmg", "IconIceAddedRatio": "dmg",
    "IconThunderAddedRatio": "dmg", "IconWindAddedRatio": "dmg", "IconQuantumAddedRatio": "dmg",
    "IconImaginaryAddedRatio": "dmg",
}
ABILITY_TYPE = {"Basic ATK": "Basic", "Skill": "Skill", "Ultimate": "Ult", "Talent": "Talent",
                "Elation Skill": "Elation", "Assist Skill": "Assist", "Technique": "Technique",
                "Memosprite Skill": "MemoSkill", "Memosprite Talent": "MemoTalent"}
# Ultimates paid with a kit resource instead of Energy.
SPECIAL_RESOURCE = {"1308", "1220", "1408", "1415", "1506", "1407"}
ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "hsr-data.js")
RES = "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/"
WIKI = "https://honkai-star-rail.fandom.com/api.php"
UA = {"User-Agent": "HSR-Tools data builder (github.com HSR-Tools)"}
# Chibis come from the Pom-Pom Gallery sticker packs on the HSR Fandom wiki. By default the
# lowest-numbered sticker for a character is used; list a specific file here to override it.
CHIBI_OVERRIDES = {
    "1101": "Sticker_PPG_15_Bronya_01.png",
    "1109": "Sticker_PPG_08_Hook_01.png",
    "1206": "Sticker_PPG_06_Sushang_01.png",
    "1225": "Sticker_PPG_19_Fugue_02.png",
    "1502": "Sticker_PPG_26_Yao_Guang_02.png",
}

# Signature light cone per character (character id -> light cone id). The game data has no
# such link, so it is maintained by hand; add new limited 5★ characters here each patch.
SIGNATURES = {
    "1003": "23000", "1102": "23001", "1107": "23002", "1101": "23003", "1004": "23004",
    "1104": "23005", "1005": "23006", "1006": "23007", "1203": "23008", "1205": "23009",
    "1204": "23010", "1208": "23011", "1209": "23012", "1211": "23013", "1212": "23014",
    "1213": "23015", "1112": "23016", "1217": "23017", "1302": "23018", "1303": "23019",
    "1305": "23020", "1306": "23021", "1307": "23022", "1304": "23023", "1308": "23024",
    "1310": "23025", "1309": "23026", "1315": "23027", "1314": "23028", "1218": "23029",
    "1221": "23030", "1220": "23031", "1222": "23032", "1317": "23033", "1313": "23034",
    "1225": "23035", "1402": "23036", "1401": "23037", "1403": "23038", "1404": "23039",
    "1407": "23040", "1405": "23041", "1409": "23042", "1406": "23043", "1408": "23044",
    "1014": "23045", "1015": "23046", "1410": "23047", "1412": "23048", "1413": "23049",
    "1321": "23050", "1414": "23051", "1415": "23052", "1501": "23053", "1502": "23054",
    "1503": "23055", "1504": "23056", "1506": "23057", "1505": "23058", "1507": "23059",
    "1510": "23060", "1508": "23061", "1509": "23062", "1512": "23063", "1513": "23064",
}

# The engine only needs these skill types for scaling values by level.
SKILL_TYPES = {"Normal", "BPSkill", "Ultra", "Talent"}
SPEED_RE = re.compile(
    r"SPD|action advance|advances? .{0,40}action|action.{0,20}advance|Advanced Forward|"
    r"extra turn|immediately take|take action|countdown|delay",
    re.I,
)
TB_NAMES = {
    "Warrior": "Destruction", "Knight": "Preservation", "Shaman": "Harmony",
    "Memory": "Remembrance", "Elation": "Elation",
}


def load(name):
    with urllib.request.urlopen(SRC + name + ".json") as r:
        return json.load(r)


def load_yatta(ids):
    def get(cid):
        req = urllib.request.Request(f"{YATTA}/{cid}", headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            return cid, json.load(r)["data"]
    with ThreadPoolExecutor(8) as pool:
        return dict(pool.map(get, ids))


def yatta_kit(y):
    """(traces, eidolons) of the kit in use: the Novaflare one when the character has it."""
    if y.get("enhancement") and y.get("enhancementList"):
        return y["enhancementList"]["traces"]["1"], y["enhancementList"]["eidolons"]["1"]
    return y["traces"], y.get("eidolons") or {}


# ---- damage clauses: "#1[i]% of X's ATK to ..." / "#3[i]% Fire Elation DMG to ..." ----
_OF = r"of\s+(?:his|her|its|their|this unit's|[^\n]{0,48}?'s)\s+(ATK|Max HP|DEF)"
DMG_CLAUSE = re.compile(r"#(\d+)\[[if]\d?\]%\s+" + _OF, re.S)
ELATION_CLAUSE = re.compile(r"#(\d+)\[[if]\d?\]%\s+(?:\w+\s+)?Elation DMG", re.S)
STAT_KEY = {"ATK": "atk", "Max HP": "hp", "DEF": "def"}
LEVEL_KEY = {"Basic": "Normal", "Skill": "BPSkill", "Ult": "Ultra", "Talent": "Talent", "Elation": "Elation",
             "MemoSkill": "Memo", "MemoTalent": "Memo", "Assist": "BPSkill"}


# Target phrases, checked by where they first appear ("to a random single enemy, and enemies
# adjacent to it..." is a random hit). Ties go to the earlier entry (blast before main).
_TARGETS = (
    ("split", r"split evenly|distributed evenly"),
    ("blast", r"one designated enemy(?: target)? and (?:its |their )?(?:enemies )?adjacent"),
    ("adj", r"adjacent"),
    ("others", r"other (?:enemy )?targets|other enemies"),
    ("all", r"all enem"),
    ("random", r"random"),
    ("main", r"one (?:designated )?enemy|single (?:enemy|target)|designated enemy"),
)


def _first_target(text):
    best = None
    for kind, rx in _TARGETS:
        m = re.search(rx, text)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), kind)
    return best and best[1]


def clause_target(lt, lp):
    """Who a damage clause hits: the first target phrase after it, else the one in the same
    sentence before it ("deals Wind DMG to adjacent targets equal to X%")."""
    if "a total of" in lp[-40:] or "split evenly" in lp[-60:]:
        return "split"
    t = _first_target(lt)
    if t:
        return t
    # The same sentence before the number; when it already holds another clause, only the part
    # after the last "deal(s)" (the earlier target phrase belongs to that clause).
    before = re.split(r"[.;\n]", lp)[-1]
    if re.search(r"#\d+\[", before):
        before = re.split(r"\bdeal(?:s|ing)?\b", before)[-1]
    return _first_target(before) or "main"


def parse_damage(desc):
    """Damage clauses of an ability description (placeholders still in place)."""
    d = re.sub(r"<[^>]+>", "", desc or "").replace("\\n", "\n")
    hits = []
    for rx, kind in ((DMG_CLAUSE, None), (ELATION_CLAUSE, "elation")):
        for m in rx.finditer(d):
            tail = d[m.end(): m.end() + 140]
            # The clause ends at the sentence end or where the next multiplier starts.
            tail = re.split(r"[.;]|#\d+\[", tail)[0]
            pre = d[max(0, m.start() - 170): m.start()]
            lt, lp = tail.lower(), pre.lower()
            # Only damage: "... DMG equal to X%", "deals / dealing X% ... DMG". Buffs such as
            # "ATK by an amount equal to X% of Robin's ATK" are skipped.
            if kind is None and re.search(r"(?:offset|absorb|block)(?:s|ing)? dmg equal to\s*$", lp[-40:]):
                continue
            if kind is None and not re.search(r"(?:dmg|dot) (?:equal to|to [^.]{0,40}equal to)(?: a total of)?(?: up to)?\s*\(?$|deal(?:s|ing)?\s+$|dmg equal to up to\s*$", lp[-60:]):
                continue
            # Damage over time (at the start of each turn) is not a hit of this ability.
            is_dot = bool(re.search(r"\bdot\b", lp[-40:])) or bool(re.search(r"(?:beginning|start) of each turn", lt))
            target = clause_target(lt, lp)
            cnt = None
            cm = re.search(r"(?:#(\d+)\[i\]|(\d+))\s+(?:additional\s+|extra\s+)?(?:instance|hit|time)s?(?:\(s\))?[^#]{0,80}$", pre)
            if cm and target in ("random", "main", "all", "adj"):
                cnt = {"p": int(cm.group(1)) - 1} if cm.group(1) else int(cm.group(2))
            hit = {"p": int(m.group(1)) - 1, "stat": kind or STAT_KEY[m.group(2)], "target": target}
            if is_dot:
                hit["dot"] = True
            if cnt is not None:
                hit["cnt"] = cnt
            hits.append(hit)
    return hits


# Abilities whose text lists both a total and its parts (or effect-only numbers): hand-set hits.
DMG_OVERRIDES = {
    ("1220", "Terrasplit"): [{"p": 3, "stat": "atk", "target": "main"}],      # "up to 700%" total
    ("1506", "God Mode: ON!"): [],                                              # Top Loot Box, not Ult DMG
    ("1308", "Slashed Dream Cries in Red"): [{"p": 5, "stat": "atk", "target": "main"}, {"p": 6, "stat": "atk", "target": "others"}],
    ("1309", "Vox Harmonique, Opus Cosmique"): [],                              # Concerto buffs / additional DMG
    ("1221", "Earthbind, Etherbreak"): [],                                      # the Counter it sets up deals the DMG
    ("1503", "Appraise Soul's Ground"): [],
    ("1314", "Acquisition Surety"): [],                                         # Debt Collector's Additional DMG: kit
    ("1317", "Ningu: Demonbane Petalblade"): [{"p": 0, "stat": "atk", "target": "main", "cnt": 2},
                                              {"p": 1, "stat": "atk", "target": "adj", "cnt": 2},
                                              {"p": 2, "stat": "atk", "target": "all"}],
    ("1401", "Big Brain Energy"): [{"p": 0, "stat": "atk", "target": "main", "cnt": 3}, {"p": 0, "stat": "atk", "target": "adj", "cnt": 2}],
    ("1401", "Hear Me Out"): [{"p": 0, "stat": "atk", "target": "main", "cnt": 3}, {"p": 0, "stat": "atk", "target": "adj", "cnt": 2},
                              {"p": 2, "stat": "atk", "target": "all"}],
    ("1402", "Slash by a Thousandfold Kiss"): [{"p": 0, "stat": "atk", "target": "main"}, {"p": 1, "stat": "atk", "target": "adj"},
                                               {"p": 2, "stat": "atk", "target": "main"}, {"p": 3, "stat": "atk", "target": "adj"}],
    ("1403", "Guess Who Lives Here"): [{"p": 0, "stat": "hp", "target": "all"}],  # the Zone's Additional DMG: kit
    ("1312", "G—Gonna Be Late!"): [{"p": 1, "stat": "atk", "target": "main"}],  # per hit; hit count in the kit                                     # Deep Learning buffs later attacks
}


def combat_data(y, cid):
    """Energy, abilities, base stats and trace stats for the combat simulator."""
    traces, eidolons = yatta_kit(y)
    abilities, skills, by_skill_id = [], {}, {}
    type_map = {"Basic": "Normal", "Skill": "BPSkill", "Ult": "Ultra", "Talent": "Talent", "Elation": "Elation"}
    for group in ("mainSkills", "servantSkills"):
        for point in (traces.get(group) or {}).values():
            for sid, sk in (point.get("skillList") or {}).items():
                t = ABILITY_TYPE.get(sk.get("type"), sk.get("type"))
                sp = sk.get("skillPoints") or {}
                ab = {
                    "type": t, "name": re.sub(r"<[^>]+>", "", sk["name"]), "memo": group == "servantSkills",
                    "energy": sp.get("base"), "cost": sp.get("need"), "tough": sk.get("weaknessBreak"),
                    "atk": sk.get("attackType"), "dmg": sk.get("damageType"), "tag": sk.get("tag"),
                }
                name = re.sub(r"<[^>]+>", "", sk["name"])
                # Talents (follow-ups, Numby, Lightning-Lord...) carry no attack type but deal DMG.
                can_hit = (sk.get("attackType") or t in ("Talent", "MemoTalent", "MemoSkill")) and t != "Technique"
                hits = parse_damage(sk.get("description")) if can_hit else []
                # Elation characters' Talents describe Certified Banger bonuses on other abilities
                # (handled by the damage kits), not a hit of their own.
                if t == "Talent" and cid in ELATION_PID:
                    hits = [h for h in hits if h["stat"] != "elation"]
                if (cid, name) in DMG_OVERRIDES:
                    hits = DMG_OVERRIDES[(cid, name)]
                if hits and sk.get("params"):
                    cols = [sk["params"][k] for k in sorted(sk["params"], key=int)]
                    n = max(len(c) for c in cols)
                    ab["hits"] = hits
                    ab["lvl"] = "Memo" if group == "servantSkills" else LEVEL_KEY.get(t, "Talent")
                    ab["params"] = [[c[min(i, len(c) - 1)] for c in cols] for i in range(n)]
                abilities.append(ab)
                # Level-scaled parameters of the first ability of each main type (what P() reads).
                key = type_map.get(t)
                if key and group == "mainSkills" and key not in skills and sk.get("params"):
                    cols = [sk["params"][k] for k in sorted(sk["params"], key=int)]
                    n = max(len(c) for c in cols)
                    skills[key] = {"id": sid, "max": sk.get("maxLevel") or n,
                                   "params": [[c[min(i, len(c) - 1)] for c in cols] for i in range(n)]}
                    by_skill_id[str(sid)] = key
    ult = next((a for a in abilities if a["type"] == "Ult" and a["cost"]), None)
    max_energy = 0 if cid in SPECIAL_RESOURCE or not ult else ult["cost"]

    trace = {}
    for node in (traces.get("subSkills") or {}).values():
        for st in node.get("statusList") or []:
            k = STAT_ICON.get(st.get("icon"))
            if k:
                trace[k] = round(trace.get(k, 0) + st["value"], 6)

    top = y["upgrade"][-1]
    b, a = top["skillBase"], top["skillAdd"]
    base = {
        "hp": round(b["hPBase"] + a["hPAdd"] * 79, 4), "atk": round(b["attackBase"] + a["attackAdd"] * 79, 4),
        "def": round(b["defenceBase"] + a["defenceAdd"] * 79, 4), "spd": b["speedBase"],
        "cr": b["criticalChance"], "cd": b["criticalDamage"], "taunt": b["baseAggro"],
    }
    level_ups = {}
    for e in eidolons.values():
        for sid, n in (e.get("skillAddLevelList") or {}).items():
            if str(sid) in by_skill_id:
                level_ups.setdefault(e["rank"], {})[by_skill_id[str(sid)]] = n
    return {
        "novaflare": bool(y.get("enhancement")), "maxEnergy": max_energy, "abilities": abilities,
        "base": base, "trace": trace, "skills": skills, "levelUps": level_ups,
        **({"elationPid": int(ELATION_PID[cid])} if cid in ELATION_PID else {}),
    }


def fetch_images(d):
    """Mirror relic set and light cone art into assets/ so the site can use it locally."""
    jobs = []
    for rid, rs in d["relic_sets"].items():
        jobs.append((rs["icon"], f"assets/relics/{rid}.png"))
    for lid, lc in d["light_cones"].items():
        jobs.append((lc["icon"], f"assets/light-cones/icon/{lid}.png"))
        jobs.append((lc["preview"], f"assets/light-cones/preview/{lid}.png"))
    todo = [(src, os.path.join(ROOT, dst)) for src, dst in jobs
            if not os.path.exists(os.path.join(ROOT, dst))]

    def get(job):
        src, dst = job
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with urllib.request.urlopen(RES + src) as r:
            data = r.read()
        with open(dst, "wb") as f:
            f.write(data)

    with ThreadPoolExecutor(8) as pool:
        list(pool.map(get, todo))
    print(f"{len(todo)} new images ({len(jobs) - len(todo)} already present) -> assets/")


def wiki(params):
    q = urllib.parse.urlencode({"format": "json", **params})
    with urllib.request.urlopen(urllib.request.Request(f"{WIKI}?{q}", headers=UA)) as r:
        return json.load(r)


def chibi_name(ch):
    """The name a character's stickers are filed under on the wiki."""
    if ch["name"].startswith("Trailblazer"):
        return "Stelle"
    if ch["name"].startswith("March 7th"):
        return "March_7th"
    return ch["name"].replace(" & ", "_and_").replace(" ", "_")


def fetch_chibis(chars):
    """Save one chibi sticker per character to assets/chibi/<id>.png; returns ids that have one."""
    files, cont = [], {}
    while True:
        d = wiki({"action": "query", "list": "allimages", "aiprefix": "Sticker_PPG",
                  "ailimit": "500", "aiprop": "url", **cont})
        files += d["query"]["allimages"]
        if "continue" not in d:
            break
        cont = d["continue"]
    by_name = {}
    for f in files:
        m = re.match(r"Sticker_PPG_(\d+)_(.+)_(\d+)\.png$", f["name"])
        if m:
            key = (int(m.group(1)), int(m.group(3)))
            by_name.setdefault(m.group(2), []).append((key, f))
    have, todo = set(), []
    for ch in chars:
        pick = None
        if ch["id"] in CHIBI_OVERRIDES:
            pick = next((f for f in files if f["name"] == CHIBI_OVERRIDES[ch["id"]]), None)
        elif chibi_name(ch) in by_name:
            pick = min(by_name[chibi_name(ch)], key=lambda x: x[0])[1]
        if not pick:
            continue
        have.add(ch["id"])
        dst = os.path.join(ROOT, "assets", "chibi", f"{ch['id']}.png")
        if not os.path.exists(dst):
            todo.append((pick["url"].split("/revision")[0] + "/revision/latest?format=original", dst))

    def get(job):
        src, dst = job
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(src, headers=UA)) as r:
            data = r.read()
        with open(dst, "wb") as f:
            f.write(data)

    with ThreadPoolExecutor(8) as pool:
        list(pool.map(get, todo))
    missing = [c["name"] for c in chars if c["id"] not in have]
    print(f"{len(have)} chibis ({len(todo)} new); no sticker for: {', '.join(missing) or 'none'}")
    return have


def fmt(desc, params):
    """Render '#1[i]%' style placeholders with concrete values."""
    def rep(m):
        i, f, pct = int(m.group(1)) - 1, m.group(2), m.group(3)
        if i >= len(params):
            return m.group(0)
        v = params[i] * (100 if pct else 1)
        dec = int(f[1:]) if f.startswith("f") else 0
        s = f"{v:.{dec}f}" if dec else f"{round(v, 2):g}"
        return s + ("%" if pct else "")
    return re.sub(r"#(\d+)\[(i|f\d)\](%?)", rep, desc).replace("\\n", "\n")


def main():
    d = {n: load(n) for n in FILES}
    yatta = load_yatta(list(d["characters"].keys()))
    paths = d["paths"]
    chars = []
    seen_tb = set()
    for cid, ch in d["characters"].items():
        name = ch["name"]
        if name == "{NICKNAME}":
            # One Trailblazer entry per path (the even ids are Stelle).
            if int(cid) % 2:  # odd ids are Caelus; keep Stelle only
                continue
            tb_path = TB_NAMES.get(ch["path"], ch["path"])
            if tb_path in seen_tb:
                continue
            seen_tb.add(tb_path)
            name = f"Trailblazer • {tb_path}"
        elif name == "March 7th":
            name = f"March 7th • {paths[ch['path']]['name'].replace('The ', '')}"

        promo = d["character_promotions"][cid]["values"][-1]
        # 8-digit ids are alternate "enhanced" trees; use the base kit.
        trace_spd = sum(
            p["value"]
            for sid in ch["skill_trees"] if len(sid) == 7
            for lvl in d["character_skill_trees"][sid]["levels"]
            for p in lvl.get("properties", []) if p["type"] == "SpeedDelta"
        )

        skills, notes = {}, []
        for sid in ch["skills"]:
            s = d["character_skills"].get(sid)
            if not s or len(sid) != 6:
                continue
            if s["type"] in SKILL_TYPES and s["type"] not in skills:
                skills[s["type"]] = {"id": sid, "max": s["max_level"], "params": s["params"]}
            text = fmt(s["desc"], s["params"][min(9, len(s["params"]) - 1)] if s["params"] else [])
            if SPEED_RE.search(text):
                notes.append({"src": s["type_text"] or s["type"], "name": s["name"], "text": text})
        for sid in ch["skill_trees"]:
            t = d["character_skill_trees"][sid]
            if len(sid) != 7 or not t["desc"]:
                continue
            text = fmt(t["desc"], t["params"][-1] if t.get("params") else [])
            if SPEED_RE.search(text):
                notes.append({"src": "Trace", "name": t["name"], "text": text})

        eidolons, level_ups = [], {}
        type_by_id = {v["id"]: k for k, v in skills.items()}
        for rid in ch["ranks"]:
            r = d["character_ranks"][rid]
            eidolons.append({"rank": r["rank"], "name": r["name"], "text": r["desc"],
                             "speed": bool(SPEED_RE.search(r["desc"]))})
            for lu in r["level_up_skills"]:
                if lu["id"] in type_by_id:
                    level_ups.setdefault(r["rank"], {})[type_by_id[lu["id"]]] = lu["num"]

        combat = combat_data(yatta[cid], cid)
        # The Novaflare kit's numbers (skill params, eidolon level-ups, trace SPD) win.
        skills.update(combat.pop("skills"))
        level_ups = combat.pop("levelUps") or level_ups
        chars.append({
            "id": cid, "name": name, "rarity": ch["rarity"],
            "path": paths[ch["path"]]["name"], "element": ch["element"],
            "spd": combat["base"]["spd"], "traceSpd": combat["trace"].get("spd", trace_spd),
            "skills": skills, "levelUps": level_ups, "eidolons": eidolons, "notes": notes,
            "combat": combat,
            **({"signature": SIGNATURES[cid]} if cid in SIGNATURES else {}),
        })

    lcs = []
    for lid, lc in d["light_cones"].items():
        r = d["light_cone_ranks"][lid]
        lp = d["light_cone_promotions"][lid]["values"][-1]
        lcs.append({
            "id": lid, "name": lc["name"], "rarity": lc["rarity"],
            "base": {k: round(lp[k]["base"] + lp[k]["step"] * 79, 4) for k in ("hp", "atk", "def")},
            "props": r.get("properties") or [],
            "path": paths[lc["path"]]["name"], "skill": r["skill"],
            "text": [fmt(r["desc"], p) for p in r["params"]],
            "params": r["params"],
            "speed": bool(SPEED_RE.search(fmt(r["desc"], r["params"][0]))),
        })

    relics = []
    for rid, rs in d["relic_sets"].items():
        params = rs.get("params") or [[] for _ in rs["desc"]]
        relics.append({
            "id": rid, "name": rs["name"], "planar": int(rid) >= 300,
            "props": rs.get("properties") or [],
            "text": [fmt(t, p) for t, p in zip(rs["desc"], params)],
        })

    chars.sort(key=lambda c: c["name"])
    if "--no-images" not in sys.argv:
        chibis = fetch_chibis(chars)
    else:
        chibis = {c["id"] for c in chars if os.path.exists(os.path.join(ROOT, "assets", "chibi", f"{c['id']}.png"))}
    for c in chars:
        c["chibi"] = c["id"] in chibis
    lcs.sort(key=lambda c: (-c["rarity"], c["name"]))
    # Relic main stats: value = base + step * level, per rarity and slot (5★ and 4★ only).
    slots = {"1": "Head", "2": "Hands", "3": "Body", "4": "Feet", "5": "Planar Sphere", "6": "Link Rope"}
    main_affix = {}
    for gid, g in d["relic_main_affixes"].items():
        rarity, slot = gid[0], slots.get(gid[1])
        if rarity in ("4", "5") and slot:
            main_affix.setdefault(rarity, {})[slot] = {a["property"]: [a["base"], a["step"]] for a in g["affixes"].values()}
    data = {"characters": chars, "lightCones": lcs, "relicSets": relics, "relicMain": main_affix}
    with open(OUT, "w") as f:
        f.write("// Generated by scripts/build_data.py from Mar-7th/StarRailRes. Do not edit.\n")
        f.write("window.HSR_DATA = ")
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")
    if "--no-images" not in sys.argv:
        fetch_images(d)
    print(f"{len(chars)} characters, {len(lcs)} light cones, {len(relics)} relic sets -> {OUT}")


if __name__ == "__main__":
    main()
