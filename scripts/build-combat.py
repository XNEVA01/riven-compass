#!/usr/bin/env python3
"""Build combat data (weapon panels + damage-mod subset) for the damage calculator.

Sources:
  - @wfcd/items npm package (MIT, https://github.com/WFCD/warframe-items)
    weapons: Primary/Secondary/SentinelWeapons JSON; mods: Mods.json; zh names: i18n/zh.json
  - src/data/game.json: riven weapon roster (join key: uniqueName == weapon id)

Usage:
  # Recommended: from the npm tarball (no install needed, fully self-contained)
  npm pack @wfcd/items                     # produces wfcd-items-<ver>.tgz
  python scripts/build-combat.py --tgz wfcd-items-1.1276.37.tgz

  # Or from an unpacked package directory
  python scripts/build-combat.py --dir /tmp/wfitems/package

Output: src/data/combat.json
  weapons[]: panel per weapon (join game.json roster, gun classes only in v1)
  mods[]:    damage-related mod subset, normalized stats keyed by engine semantics
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import tarfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------- stat template parsing ----------------
# Mod stat text (top rank) -> engine semantic key.
# Values are stored as multiplicative increments (dmg 1.65 == +165% Damage).
DT = r"(?:<DT_[A-Z_]+_COLOR>)?"

STAT_RULES: list[tuple[str, str, re.Pattern]] = [
    ("dmg", "base damage", re.compile(rf"^[+-]?([\d.]+)% Damage$")),
    ("ms", "multishot", re.compile(r"^[+-]?([\d.]+)% Multishot$")),
    ("sc", "status chance", re.compile(r"^[+-]?([\d.]+)% Status Chance$")),
    ("cc", "critical chance", re.compile(r"^[+-]?([\d.]+)% Critical Chance$")),
    ("cd", "critical damage", re.compile(r"^[+-]?([\d.]+)% Critical Damage$")),
    # fire rate: bows use the doubled value on their native charge model; v1 treats all as flat
    ("fr", "fire rate", re.compile(r"^[+-]?([\d.]+)% Fire Rate(?: \(x[\d.]+ for Bows\))?$")),
    ("mag", "magazine", re.compile(r"^[+-]?([\d.]+)% Magazine Capacity$")),
    ("rl", "reload", re.compile(r"^[+-]?([\d.]+)% Reload Speed$")),
    ("pt", "punch through", re.compile(r"^[+-]?([\d.]+) Punch Through$")),
]

ELE_KEYS = {
    "heat": "Heat", "cold": "Cold", "elec": "Electricity", "tox": "Toxin",
    "rad": "Radiation", "mgn": "Magnetic", "bla": "Blast",
    "cor": "Corrosive", "gas": "Gas", "vir": "Viral",
}
IPS_KEYS = {"imp": "Impact", "pun": "Puncture", "sla": "Slash"}
FAC_KEYS = {
    "facGrineer": "Grineer", "facCorpus": "Corpus", "facInfested": "Infested",
    "facOrokin": "Orokin", "facMurmur": "Murmur",
}

for k, label in ELE_KEYS.items():
    STAT_RULES.append((k, label, re.compile(rf"^[+-]?([\d.]+)% {DT}{label}$")))
for k, label in IPS_KEYS.items():
    STAT_RULES.append((k, label, re.compile(rf"^[+-]?([\d.]+)% {DT}{label}$")))

def _parse_fac(text: str) -> tuple[str, float] | None:
    """Faction banes: 'x1.3 Damage to Grineer' or '+30% Damage to X' -> increment."""
    clean = text.replace("*", "").strip()
    for k, label in FAC_KEYS.items():
        m = re.match(rf"^x([\d.]+) Damage to {label}$", clean)
        if m:
            return k, float(m.group(1)) - 1.0
        m = re.match(rf"^[+-]?([\d.]+)% Damage to {label}$", clean)
        if m:
            return k, float(m.group(1)) / 100.0
    return None

# Reject: conditional / situational / non-panel stats (Galvanized, Arcane-style,
# conversions, ammo economy, handling). Kept out of v1 to guarantee a pure subset.
REJECT_MARKERS = (
    "On Kill", "On Hit", "On Headshot", "On Weak Point", "On Ability Cast",
    "On Ability", "when Aiming", "while ", "Stacks", "converted", "Converts",
    "Orbs", "Minimap", "Reveals", "Reduces the chance", "Ammo Pick",
    "Status Duration", "Ammo Maximum", "Projectile Speed", "Accuracy",
    "Recoil", "Zoom", "Blast Range", "Movement Speed", "Melee",
    "Initial Combo", "Combo Count", "Combo Duration", "Heavy Attack",
    "Range", "Slam Attack", "Life Steal", "Chance to", "per Status",
    "Damage Over", "Damage Reflection", "Ice Status", "Electric Status",
)

STAT_ZH = {
    "dmg": "伤害", "ms": "多重射击", "sc": "异常触发", "cc": "暴击率", "cd": "暴击伤害",
    "fr": "射速", "mag": "弹匣容量", "rl": "装填速度", "pt": "穿透",
    "imp": "冲击", "pun": "穿刺", "sla": "切割",
    "heat": "火焰", "cold": "冰冻", "elec": "电击", "tox": "毒素",
    "rad": "辐射", "mgn": "磁力", "bla": "爆炸", "cor": "腐蚀", "gas": "毒气", "vir": "病毒",
    "facGrineer": "对Grineer伤害", "facCorpus": "对Corpus伤害", "facInfested": "对Infested伤害",
    "facOrokin": "对Orokin伤害", "facMurmur": "对Murmur伤害",
}

# weapon type (wfcd) -> mod compatibility group
WEAPON_COMPAT = {
    "Rifle": "rifle", "Sniper": "rifle", "Bow": "rifle", "Launcher": "rifle",
    "Shotgun": "shotgun",
    "Pistol": "pistol", "Throwing": "pistol", "Dual Pistols": "pistol",
}
# companion weapons (wfcd type "Companion Weapon", from SentinelWeapons.json)
# all share one type, so their mod group follows the roster class instead:
# sentinel guns accept regular gun mods of their class (Verglas -> rifle,
# Sweeper -> shotgun, Burst Laser -> pistol); melee companions (Deconstructor
# and pet claws) have no melee mod pool in v1, so they fall back to rifle.
COMPANION_CLS_COMPAT = {
    "Rifle": "rifle", "Shotgun": "shotgun", "Pistol": "pistol", "Melee": "rifle",
}
MOD_COMPAT_NORM = {"Rifle": "rifle", "Shotgun": "shotgun", "Pistol": "pistol"}
# DE variant suffixes in uniqueName: tutorial tiers + unobtainable Expert cards
VARIANT_RX = re.compile(r"(Beginner|Intermediate|Expert|Advanced|Hard|Easy)$")
DAMAGE_TYPES = (
    "impact", "puncture", "slash", "heat", "cold", "electricity", "toxin",
    "blast", "radiation", "gas", "magnetic", "viral", "corrosive", "void", "tau",
)


def parse_stat(text: str) -> tuple[str, float] | tuple[str, None]:
    """Parse one top-rank stat line -> (semantic_key, value) or (key, None) if rejected."""
    clean = text.replace("*", "").strip()
    if any(m in clean for m in REJECT_MARKERS):
        return "", None
    fac = _parse_fac(clean)
    if fac:
        return fac
    for key, _label, rx in STAT_RULES:
        m = rx.match(clean)
        if m:
            return key, float(m.group(1)) / 100.0
    return "", None


# ---------------- galvanized (镀层) kill stacks ----------------
# Galvanized mods: passive line(s) + an On Kill / On Weak Point section; wfcd
# joins those sections with a literal "\n" (backslash + n, not a newline).
# Modelable kill stacks become a stack spec (contribution = base? + count x per
# once the player maintains count > 0); "per Status Type" style conditionals
# are not modelable -> cond: true (displayed as a note, never counted).
STACK_STATS = {"Multishot": "ms", "Critical Chance": "cc", "Status Chance": "sc", "Damage": "dmg"}
_STACK_ALT = "|".join(STACK_STATS)
STACK_LINE_RX = re.compile(rf"^[+-]?([\d.]+)% ({_STACK_ALT})(?: when Aiming)? for [\d.]+s\.? Stacks up to (\d+)x")
STACK_BASE_RX = re.compile(rf"^[+-]?([\d.]+)% ({_STACK_ALT})(?: when Aiming)? for [\d.]+s")


def parse_galvanized(lines: list[str]) -> tuple[dict[str, float], dict | None, bool]:
    """Galvanized top-rank lines -> (passive stats, stack spec, has-unmodeled-cond)."""
    frags: list[str] = []
    for el in lines:
        frags.extend(re.split(r"\\n", el))
    stats: dict[str, float] = {}
    stack: dict | None = None
    base: tuple[str, float] | None = None
    cond = False
    mode = "passive"
    for f in (x.strip() for x in frags):
        if not f:
            continue
        low = f.lower()
        if low.startswith("on kill") or low.startswith("on weak point kill"):
            mode = "kill"
            continue
        if low.startswith("on weak point hit") or low.startswith("on hit"):
            mode = "hit"
            continue
        if mode == "passive":
            key, val = parse_stat(f)
            if key:
                stats[key] = round(val, 4)
        elif mode == "kill":
            m = STACK_LINE_RX.match(f)
            if m:
                stat = STACK_STATS[m.group(2)]
                stack = {"stat": stat, "per": round(float(m.group(1)) / 100.0, 4), "max": int(m.group(3))}
                if base and base[0] == stat:
                    stack["base"] = base[1]
            else:
                cond = True
        else:  # on-hit activation buff, e.g. Scope's +120% CC while aiming
            m = STACK_BASE_RX.match(f)
            if m:
                base = (STACK_STATS[m.group(2)], round(float(m.group(1)) / 100.0, 4))
            else:
                cond = True
    if base is not None and stack is None:
        cond = True  # activation buff with no kill stack to piggyback on
    return stats, stack, cond


# mod description equip restrictions, e.g. Cannonade:
#   "Only compatible with Semi-Auto Trigger." -> must equal the weapon's
#   wfcd trigger value (normalized: Semi-Auto -> Semi)
RESTRICT_TRIGGER_RX = re.compile(r"Only compatible with ([\w-]+) Trigger")
TRIGGER_NORM = {"Semi-Auto": "Semi"}

# Incarnon form mechanics verified on the wiki (wfcd carries only the panel
# numbers, not the form behavior): beams = innate beam count (enters the
# multishot base, all beams can lock a single target), mag = the form's fixed
# separate magazine (3 rounds per charge, NOT affected by magazine mods).
INCARNON_WIKI = {
    "/Lotus/Weapons/Tenno/Shotgun/FullAutoShotgun": {"beams": 3, "mag": 150},  # Boar
    "/Lotus/Weapons/Tenno/Shotgun/PrimeBoar": {"beams": 3, "mag": 150},         # Boar Prime
}


# ---------------- source loading ----------------

def load_from_tgz(tgz: Path) -> dict[str, dict]:
    """Read the needed JSON members straight out of the npm tarball."""
    out: dict[str, dict] = {}
    want = {
        "package/data/json/Primary.json": "primary",
        "package/data/json/Secondary.json": "secondary",
        "package/data/json/SentinelWeapons.json": "sentinel",
        "package/data/json/Mods.json": "mods",
        "package/data/json/i18n/zh.json": "zh",
        "package/package.json": "pkg",
    }
    with tarfile.open(tgz, "r:gz") as tf:
        for member in tf.getmembers():
            if member.name in want and member.isfile():
                data = json.load(io.TextIOWrapper(tf.extractfile(member), encoding="utf-8"))
                out[want[member.name]] = data
    missing = [v for k, v in want.items() if v not in out]
    if missing:
        sys.exit(f"[combat] tgz missing members: {missing}")
    return out


def load_from_dir(src_dir: Path) -> dict[str, dict]:
    d = src_dir / "data" / "json"
    if not (d / "Primary.json").exists():
        d = src_dir  # allow pointing directly at data/json
    out: dict[str, dict] = {}
    for name, key in [
        ("Primary.json", "primary"), ("Secondary.json", "secondary"),
        ("SentinelWeapons.json", "sentinel"),
        ("Mods.json", "mods"), ("zh.json", "zh"),
    ]:
        p = d / name if name != "zh.json" else d / "i18n" / "zh.json"
        if not p.exists():
            sys.exit(f"[combat] missing {p}")
        out[key] = json.load(open(p, encoding="utf-8"))
    pkg = src_dir / "package.json"
    out["pkg"] = json.load(open(pkg, encoding="utf-8")) if pkg.exists() else {"version": "unknown"}
    return out


def build(items: dict, game_path: Path, out_path: Path, include_melees: bool) -> None:
    game = json.load(open(game_path, encoding="utf-8"))
    roster = {w["id"]: w for w in game["weapons"]}
    zh_mods = items["zh"]
    version = items["pkg"].get("version", "unknown")

    # ---- weapons: join roster with wfcd panels ----
    panel: dict[str, dict] = {}
    for src in ("primary", "secondary", "sentinel"):
        for w in items[src]:
            uid = w.get("uniqueName")
            if uid not in roster or uid in panel:
                continue
            compat = WEAPON_COMPAT.get(w.get("type", ""))
            if not compat and roster[uid].get("sentinel"):
                # companion weapons: one wfcd type, mod group by roster class
                compat = COMPANION_CLS_COMPAT.get(roster[uid].get("cls", ""))
            if not compat:
                continue
            dmg_obj = w.get("damage") or {}
            dmg = {k: round(v, 4) for k, v in dmg_obj.items()
                   if k in DAMAGE_TYPES and v}
            if not dmg:
                continue
            # charge weapons (bows, launchers) carry fireRate=0; real cadence
            # comes from attacks[].charge_time -> engine fallback 1/charge
            charge = None
            if w.get("trigger") == "Charge":
                atks = w.get("attacks") or []
                main = max(atks, key=lambda a: sum(
                    v for v in (a.get("damage") or {}).values() if isinstance(v, (int, float))
                ), default=None)
                if main and main.get("charge_time"):
                    charge = main["charge_time"]
            # 灵化形态（Incarnon Genesis）：wfcd 把形态面板放在 attacks[] 里；
            # damage 是每光束/弹丸口径，AoE/Radial 段是着点爆炸（对单体也生效，并入）
            inc = None
            inc_atks = [a for a in (w.get("attacks") or []) if "Incarnon" in (a.get("name") or "")]
            if inc_atks:
                main_inc = next((a for a in inc_atks if a.get("name") == "Incarnon Form"), inc_atks[0])
                extras = [a for a in inc_atks if a is not main_inc and a.get("name") in ("Incarnon Form AoE", "Incarnon Form Radial Attack")]
                idmg: dict[str, float] = {}
                for a in [main_inc, *extras]:
                    for k, v in (a.get("damage") or {}).items():
                        if k in DAMAGE_TYPES and v:
                            idmg[k] = round(idmg.get(k, 0) + v, 4)
                if idmg and main_inc.get("speed"):
                    # wfcd attack 层的 crit_chance/status_chance 是百分数（20 = 20%），武器层才是小数
                    inc = {
                        "dmg": idmg,
                        "total": round(sum(idmg.values()), 3),
                        "cc": (main_inc.get("crit_chance") or 0) / 100.0,
                        "cd": main_inc.get("crit_mult"),
                        "sc": (main_inc.get("status_chance") or 0) / 100.0,
                        "fr": main_inc.get("speed"),
                    }
                    extra = INCARNON_WIKI.get(uid)
                    if extra:
                        inc.update(extra)
            panel[uid] = {
                "id": uid,
                "zh": roster[uid]["name"]["zh"],
                "en": w["name"],
                "compat": compat,
                "dmg": dmg,
                "total": round(w.get("totalDamage") or sum(dmg.values()), 3),
                "cc": w.get("criticalChance"),
                "cd": w.get("criticalMultiplier"),
                "sc": w.get("procChance"),
                "fr": w.get("fireRate"),
                "mag": w.get("magazineSize"),
                "rl": w.get("reloadTime"),
                "ms": w.get("multishot") or 1,
                "omega": w.get("omegaAttenuation"),
                "trigger": w.get("trigger"),
                **({"charge": round(charge, 3)} if charge else {}),
                **({"incarnon": inc} if inc else {}),
                "cls": roster[uid]["cls"],
                "ips": roster[uid].get("ips"),
                "tags": roster[uid].get("tags"),
            }

    # ---- mods: damage-related subset ----
    mods_out = []
    skipped_conditional = 0
    skipped_unparsed = 0
    seen_best: dict[str, dict] = {}  # by uniqueName
    for m in items["mods"]:
        compat = MOD_COMPAT_NORM.get(m.get("compatName", ""))
        if not compat or m.get("isAugment") or m.get("isExilus") or m.get("conclave"):
            continue
        if m.get("category") == "Mods" and "Riven" in (m.get("type") or ""):
            continue
        ls = m.get("levelStats") or []
        if not ls:
            continue
        top = ls[-1].get("stats") or []
        stats: dict[str, float] = {}
        stack: dict | None = None
        cond = False
        rejected = False
        if (m.get("name") or "").startswith("Galvanized"):
            # 镀层：击杀叠层可建模；其余条件词条以 cond 注记展示
            stats, stack, cond = parse_galvanized(top)
        else:
            for line in top:
                key, val = parse_stat(line)
                if key:
                    stats[key] = round(val, 4)
                elif val is None and any(mk in line for mk in REJECT_MARKERS):
                    rejected = True
                    break
        if rejected:
            skipped_conditional += 1
            continue
        if not stats and not stack:
            skipped_unparsed += 1
            continue
        uid = m["uniqueName"]
        zh = (zh_mods.get(uid) or {}).get("name") or m["name"]
        mt = RESTRICT_TRIGGER_RX.search(m.get("description") or "")
        trigger = TRIGGER_NORM.get(mt.group(1), mt.group(1)) if mt else None
        entry = {
            "id": uid,
            "zh": zh,
            "en": m["name"],
            "compat": compat,
            "polarity": m.get("polarity"),
            "drain": m.get("baseDrain"),
            "rank": m.get("fusionLimit"),
            "rarity": m.get("rarity"),
            "stats": stats,
            "variant": bool(VARIANT_RX.search(uid)),
            **({"trigger": trigger} if trigger else {}),
            **({"stack": stack} if stack else {}),
            **({"cond": True} if cond else {}),
        }
        prev = seen_best.get(uid)
        if prev is None or (entry["rank"] or 0) >= (prev["rank"] or 0):
            seen_best[uid] = entry
    # same-name variant cleanup: if a mainline card exists, drop its
    # Beginner/Intermediate/Expert clones (Expert cards are not player-obtainable)
    by_name: dict[str, list[dict]] = {}
    for e in seen_best.values():
        by_name.setdefault(e["en"], []).append(e)
    mods_out = []
    for _n, group in by_name.items():
        main = [g for g in group if not g["variant"]]
        mods_out.extend(main if main else group)
    for e in mods_out:
        e.pop("variant", None)

    # ---- melee: v1.5 flag (panels only extraction when requested) ----
    if include_melees:
        for w in items.get("melee", []):
            pass  # v1.5: melee attack model, not covered yet

    combat = {
        "meta": {
            "built": date.today().isoformat(),
            "source": f"@wfcd/items@{version} (MIT)",
            "scope": "guns v1 (primary+secondary+companion), damage-mod subset",
        },
        "weapons": list(panel.values()),
        "mods": mods_out,
        "statZh": STAT_ZH,
    }
    out_path.write_text(json.dumps(combat, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
    print(f"[combat] weapons: {len(panel)}  mods: {len(mods_out)} "
          f"(conditional-skipped {skipped_conditional}, unparsed {skipped_unparsed})")
    print(f"[combat] wrote {out_path} ({out_path.stat().st_size // 1024} KB)")


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--tgz", type=Path, help="path to wfcd-items-<ver>.tgz from `npm pack @wfcd/items`")
    g.add_argument("--dir", type=Path, help="path to unpacked @wfcd/items package")
    ap.add_argument("--game", type=Path, default=ROOT / "src/data/game.json")
    ap.add_argument("-o", "--out", type=Path, default=ROOT / "src/data/combat.json")
    a = ap.parse_args()
    items = load_from_tgz(a.tgz) if a.tgz else load_from_dir(a.dir)
    build(items, a.game, a.out, include_melees=False)


if __name__ == "__main__":
    main()
