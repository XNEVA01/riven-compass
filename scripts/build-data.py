"""Build display data from local Warframe-Algorithm export repositories.

Usage: python scripts/build-data.py --data-dir /path/to/Warframe-Algorithm
WF_DATA_DIR is also accepted. No network access is performed.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

CLASSES = {
    'Rifle': ('LotusRifleRandomModRare.json', '/Lotus/Language/Items/RifleCategoryName'),
    'Shotgun': ('LotusShotgunRandomModRare.json', '/Lotus/Language/Items/ShotgunCategoryName'),
    'Pistol': ('LotusPistolRandomModRare.json', '/Lotus/Language/Items/PistolCategoryName'),
    'Kitgun': ('LotusModularPistolRandomModRare.json', '/Lotus/Language/Weapons/LotusModularGunName'),
    'Archgun': ('LotusArchgunRandomModRare.json', '/Lotus/Language/Items/ArchwingGun'),
    'Melee': ('PlayerMeleeWeaponRandomModRare.json', '/Lotus/Language/Categories/MELEE'),
    'Zaw': ('LotusModularMeleeRandomModRare.json', '/Lotus/Language/Weapons/LotusModularWeaponName'),
}
UI_KEYS = {
    'kuva': '/Lotus/Language/Items/Kuva',
    'riven': '/Lotus/Language/Items/OmegaModGenericName',
    'cycle': '/Lotus/Language/Menu/REROLL_Title',
    'cycleFor': '/Lotus/Language/Menu/REROLL_ShortForm',
    'lockTrait': '/Lotus/Language/SystemMessages/OmegaLockTrait',
    'splicing': '/Lotus/Language/SystemMessages/OmegaEvolution',
    'splicer': '/Lotus/Language/Iceblade/RivenSplicer',
    'showRanked': '/Lotus/Language/Railjack/Inventory_ShowRanked',
    'fitsIn': '/Lotus/Language/SystemMessages/ItemCompatibilityLabel',
    'masteryShort': '/Lotus/Language/Omega/OmegaMasteryRequirementShort',
    'kuvaRemaining': '/Lotus/Language/Menu/KuvaRemaining',
    'cycleConfirm': '/Lotus/Language/Omega/OmegaRerollSelectionConfirm',
    'companion': '/Lotus/Language/Categories/SENTINEL',
}
# Riven families that warframe.market listings show rolling a stat the rules leave out (2026-10-25), by the family's
# base weapon. Karak has exactly 25% slash, where the rule needs more (Tiberon at 25% has no slash or impact listing),
# yet 16 Karak rivens are listed with slash.
ALSO_ROLLS = {
    '/Lotus/Weapons/Grineer/LongGuns/GrineerM16Homage/GrineerM16Rifle': ['WeaponSlashDamageMod'],  # Karak
}


def hant_pairs(zh: dict, tc: dict) -> str:
    """繁中 characters, each followed by the 简中 one it stands for, read off the two dictionaries: where a string reads
    the same in both scripts, its characters line up one for one. A pair is kept when the 简中 text hardly uses the 繁中
    character and it lines up with one 简中 character far more often than with any other (wordings that differ are
    noise)."""
    han = re.compile(r'[一-鿿]')
    lined_up: dict[str, dict[str, int]] = {}
    zh_uses: dict[str, int] = {}
    tc_uses: dict[str, int] = {}
    for key, simplified in zh.items():
        traditional = tc.get(key)
        if not isinstance(simplified, str) or not isinstance(traditional, str):
            continue
        for text, uses in ((simplified, zh_uses), (traditional, tc_uses)):
            for ch in text:
                if han.match(ch):
                    uses[ch] = uses.get(ch, 0) + 1
        if len(simplified) != len(traditional) or simplified == traditional:
            continue
        differ = [(t, s) for t, s in zip(traditional, simplified) if t != s]
        if len(differ) * 2 > len(simplified):
            continue
        for t, s in differ:
            if han.match(t) and han.match(s):
                lined_up.setdefault(t, {})
                lined_up[t][s] = lined_up[t].get(s, 0) + 1
    pairs = []
    for t, counts in sorted(lined_up.items()):
        ranked = sorted(counts.items(), key=lambda kv: -kv[1])
        s, n = ranked[0]
        second = ranked[1][1] if len(ranked) > 1 else 0
        if n >= 2 and n >= 4 * second and zh_uses.get(t, 0) <= 0.02 * tc_uses.get(t, 0):
            pairs.append(t + s)
    return ''.join(pairs)


def build(root: Path) -> dict:
    def read(relative: str) -> dict:
        return json.loads((root / relative).read_text(encoding='utf-8'))

    dictionaries = {
        'zh': read('warframe-export-data/dict/dict.zh.json'),
        'tc': read('warframe-export-data/dict/dict.tc.json'),
        'cn': read('warframe-export-data-cn/dict/dict.zh.json'),
        'en': read('warframe-export-data/dict/dict.en.json'),
    }

    def localize(key: str, template: bool = False) -> dict | None:
        result = {}
        for language, dictionary in dictionaries.items():
            text = dictionary.get(key, dictionaries['en'].get(key))
            if text is None:
                return None
            text = re.sub(r'<[^>]+>', '', text)
            if not template:
                # the number goes with its "%": 繁中 writes two melee stats with it inside the name (滑行攻擊 |STAT1|% 暴擊機率)
                text = re.sub(r'\|[A-Z0-9_]+\|\s*%?', '', text, flags=re.I)
                text = re.sub(r'\s+', ' ', text).strip()
                # with the number gone, nothing is spaced after full-width punctuation (重擊時，近戰傷害)
                text = re.sub(r'(?<=[，、：；])\s+', '', text)
                # a value written after the name ("收起武器时弹匣每秒自动装填 |val| %") leaves its % at the end
                text = re.sub(r'^[\s%:：]+|[\s%:：]+$', '', text)
            result[language] = text.strip()
        return result

    parent = read('warframe-packages-data/Lotus/Types/Game/RandomizedArtifactUpgrade.json')['data']
    cn_parent = read('warframe-packages-data-cn/Lotus/Types/Game/RandomizedArtifactUpgrade.json')['data']
    for key in ('NumBuffs', 'NumCurses', 'NumBuffsAtten', 'NumBuffsCurseAtten', 'CurseAtten', 'SpecificFitAttenuation'):
        if parent.get(key) != cn_parent.get(key):
            raise ValueError(f'International and CN layouts differ on {key}; review the model before updating')
    exported_weapons = read('warframe-export-data/export/ExportWeapons.json')
    images = read('warframe-export-data/export/ExportImages.json')
    classes, names, weapon_classes = {}, {}, {}
    for cls, (filename, name_key) in CLASSES.items():
        intl = read(f'warframe-packages-data/Lotus/Upgrades/Mods/Randomized/{filename}')['data']
        stats = []
        for entry in intl['UpgradeEntries']:
            upgrade = entry['Upgrades'][0]
            schema = upgrade.get('Schema', {})
            tag = entry['Tag']
            names.setdefault(tag, {'tag': tag, 'prefix': localize(entry['LocalizePrefixTag']), 'suffix': localize(entry['LocalizeSuffixTag'])})
            mode = schema.get('RoundingMode', 'RM_ROUND')
            if mode not in ('RM_ROUND', 'RM_FLOOR', 'RM_CEIL'):
                raise ValueError(f'Unknown rounding mode for {cls}/{tag}: {mode}')
            step = schema.get('RoundTo', .1)
            if not isinstance(step, (float, int)) or not 0 < step < float('inf'):
                raise ValueError(f'Invalid rounding step for {cls}/{tag}: {step}')
            key = schema['LocTag']
            fmt = ('mult' if schema.get('DisplayAsMultiplier') else
                   ('sec' if 'Combo Duration' in dictionaries['en'].get(key, '') else 'flat') if schema.get('DisplayAsPercent') == 0 else 'pct')
            name, template = localize(key), localize(key, template=True)
            if name is None or template is None:
                raise ValueError(f'Missing stat localization: {cls}/{tag}/{key}')
            stats.append(dict(tag=tag, base=upgrade['Upgrade']['Value'], buff=entry['CanBeBuff'] == 1,
                              curse=entry['CanBeCurse'] == 1, spliced=entry['IsAdvancedTrait'] == 1,
                              compat=entry.get('CompatibilityTags', []), buffRestr=entry.get('BuffRestrictions', []),
                              curseRestr=entry.get('CurseRestrictions', []), fmt=fmt,
                              smaller=schema.get('SmallerIsBetter') == 1, reverse=schema.get('ReverseValueSymbol') == 1,
                              roundTo=step, roundingMode=mode, name=name, template=template))
        classes[cls] = dict(name=localize(name_key), stats=stats,
                            splices=[dict(result=m['ResultTag'], a=m['PrimaryIngredient'], b=m['SecondaryIngredient']) for m in intl.get('MergeOptions', [])])
        for field, sentinel in (('ItemCompatibilities', False), ('SentinelItemCompatibilities', True)):
            for item in intl.get(field, []):
                if item['Attenuation'] != 1.2 or any(a != 1.2 for a in item.get('AlternateAttenuations', [])):
                    raise ValueError(f'Unsupported disposition for {item["ItemType"]}; update the model before generating data')
                weapon_classes[item['ItemType']] = (cls, sentinel)
    weapons, damage_of = [], {}
    for identifier, (cls, sentinel) in weapon_classes.items():
        weapon = exported_weapons.get(identifier)
        if not weapon or identifier.startswith('/Lotus/Powersuits/') or re.search(r'/Gear/|LotusHandCompass|CoHLoaner|LotusPistol$|LotusModular', identifier):
            continue
        name = localize(weapon['name'])
        if not name or not name.get('en'):
            continue
        damage_of[identifier] = weapon.get('damagePerShot', [])
        icon = weapon.get('icon')
        tags = weapon.get('compatibilityTags', [])
        weapons.append(dict(id=identifier, cls=cls, name=name, tags=tags,
                            ips=None, also=[], sentinel=sentinel, grimoire='Grimoire' in identifier,
                            variant=weapon.get('variantType', 'VT_NORMAL'),
                            icon=f'{icon[1:]}!{images[icon]["contentHash"]}' if icon and icon in images else None))
    # One weapon exported twice under one name (a Duviri weapon and its empty shell, the Grimoire and its doppelganger
    # copy): keep the player's real one and send the other id to it, so saved sessions still find their weapon.
    aliases, by_name = {}, {}
    for w in weapons:
        by_name.setdefault((w['cls'], w['name']['en']), []).append(w)
    for group in by_name.values():
        keep = [w for w in group if 'Doppelganger' not in w['id']] or group
        if len(keep) > 1 and any(sum(damage_of[w['id']]) for w in keep):
            keep = [w for w in keep if sum(damage_of[w['id']])]
        for w in group:
            if w is not keep[0] and w in keep:
                raise ValueError(f'Two weapons named {w["name"]["en"]}; decide which one the riven belongs to')
            if w not in keep:
                aliases[w['id']] = keep[0]['id']
    weapons = [w for w in weapons if w['id'] not in aliases]
    by_id = {w['id']: w for w in weapons}

    def base_of(w: dict) -> str:
        # a riven belongs to its weapon family: a variant (Prime, Wraith, MK1, Tenet...) rolls for the weapon it
        # derives from, when that one takes rivens of the same class
        cur, seen = w['id'], {w['id']}
        while True:
            parent = exported_weapons[cur].get('parentName')
            if parent not in by_id or by_id[parent]['cls'] != w['cls'] or parent in seen:
                return cur
            seen.add(parent)
            cur = parent

    for base in ALSO_ROLLS:
        if base not in by_id:
            raise ValueError(f'{base} no longer takes rivens; review ALSO_ROLLS')
    for w in weapons:
        w['also'] = ALSO_ROLLS.get(base_of(w), [])
        if w['cls'] in ('Zaw', 'Kitgun'):
            # modular weapons are exported as parts without damage; impact, puncture and slash count a third each
            w['ips'] = [.333, .333, .333]
            continue
        # each physical type's share of the physical damage (not of all damage): Penta, Zarr and Kuva Bramma roll impact
        # and Tonkor puncture though elements make up most of their damage (warframe.market listings, 2026-10-25)
        damage = damage_of[base_of(w)][:3]
        physical = sum(damage) or 1
        w['ips'] = [math.floor((damage[i] if i < len(damage) else 0) / physical * 1000 + .5) / 1000 for i in range(3)]
    weapons.sort(key=lambda w: (w['cls'], w['name']['en'].casefold()))
    ui = {}
    for short, key in UI_KEYS.items():
        text = localize(key, template=True)
        if text is None:
            raise ValueError(f'Missing UI localization: {key}')
        ui[short] = {language: re.sub(r'\s*\|CHECK\|', '', value).strip() for language, value in text.items()}
    version = {name: read(f'{repository}/_meta/version.json')['buildLabel'].split('/')[0]
               for name, repository in [('intl', 'warframe-packages-data'), ('cn', 'warframe-packages-data-cn')]}
    layout = dict(numBuffsAtten=parent['NumBuffsAtten'], numBuffsCurseAtten=parent['NumBuffsCurseAtten'],
                  curseAtten=parent['CurseAtten'], specificFit=parent['SpecificFitAttenuation'],
                  disposition=1.2, maxRank=parent.get('FusionLimitRange', [0, 8])[1])
    return dict(version=version, layout=layout, ui=ui, statNames=names, classes=classes, weapons=weapons, aliases=aliases,
                hant=hant_pairs(dictionaries['zh'], dictionaries['tc']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=os.environ.get('WF_DATA_DIR'))
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'src/data/game.json')
    args = parser.parse_args()
    if args.data_dir is None:
        parser.error('provide --data-dir or set WF_DATA_DIR')
    data = build(args.data_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Wrote {args.output}: {len(data["classes"])} classes, {len(data["weapons"])} weapons; {data["version"]}')
    # V3d-2（spec §9.4）：默认 game.json 变更 → 立即重写版本戳并重打 solve.cjs（管线预算内联这份数据）。
    # 服务器 solve_costs 有 sha256 握手，bundle 落后会被响亮拒绝（宁缺毋滥，前端 worker 兜底）。
    if args.output == Path(__file__).resolve().parents[1] / 'src/data/game.json':
        scripts = Path(__file__).resolve().parent
        stamp = subprocess.run([sys.executable, str(scripts / 'game_stamp.py')], capture_output=True, text=True)
        print((stamp.stdout or stamp.stderr).strip())
        if stamp.returncode != 0:
            print('!! game_stamp.py 失败——版本戳未更新，上线前必须先跑 scripts/build-solve.sh')
            sys.exit(1)
        bundle = subprocess.run(['sh', str(scripts / 'build-solve.sh')], capture_output=True, text=True)
        if bundle.returncode == 0:
            print(bundle.stdout.strip())
            print('!! 记得上传：dist-pipeline/solve.cjs 与 src/data/game.json → 服务器 /opt/rivenroll/pipeline/')
        else:
            # game.json 已写出，但 bundle 内联的还是旧数据：非零退出让 npm run data 响亮失败（代码审查 P2）
            print('!! solve.cjs 重打包失败——bundle 内联的还是旧 game 数据，上线前必须先跑 scripts/build-solve.sh')
            print((bundle.stderr or bundle.stdout).strip()[-1500:])
            sys.exit(1)


if __name__ == '__main__':
    main()
