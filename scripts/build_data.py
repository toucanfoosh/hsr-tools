#!/usr/bin/env python3
"""Build data/hsr-data.js from the Mar-7th/StarRailRes dataset.

Usage: python3 scripts/build_data.py
Re-run after a game patch to pick up new characters, light cones and relic sets.
"""
import json
import os
import re
import urllib.request

SRC = "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_new/en/"
FILES = [
    "characters", "character_promotions", "character_skills", "character_skill_trees",
    "character_ranks", "light_cones", "light_cone_ranks", "relic_sets", "paths",
]
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "hsr-data.js")

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

        chars.append({
            "id": cid, "name": name, "rarity": ch["rarity"],
            "path": paths[ch["path"]]["name"], "element": ch["element"],
            "spd": promo["spd"]["base"], "traceSpd": trace_spd,
            "skills": skills, "levelUps": level_ups, "eidolons": eidolons, "notes": notes,
        })

    lcs = []
    for lid, lc in d["light_cones"].items():
        r = d["light_cone_ranks"][lid]
        lcs.append({
            "id": lid, "name": lc["name"], "rarity": lc["rarity"],
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
            "text": [fmt(t, p) for t, p in zip(rs["desc"], params)],
        })

    chars.sort(key=lambda c: c["name"])
    lcs.sort(key=lambda c: (-c["rarity"], c["name"]))
    data = {"characters": chars, "lightCones": lcs, "relicSets": relics}
    with open(OUT, "w") as f:
        f.write("// Generated by scripts/build_data.py from Mar-7th/StarRailRes. Do not edit.\n")
        f.write("window.HSR_DATA = ")
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")
    print(f"{len(chars)} characters, {len(lcs)} light cones, {len(relics)} relic sets -> {OUT}")


if __name__ == "__main__":
    main()
