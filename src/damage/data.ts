/**
 * V1 damage-engine constants.
 *
 * Damage 2.0 multipliers and enemy scaling are cross-checked against
 * Riven Mirror (MIT, https://github.com/pa001024/riven-mirror) — kept as
 * plain data here so the engine stays a pure-function layer.
 */

/** semantic stat keys used by combat.json mods and by this engine */
export type StatKey =
  | "dmg"
  | "ms"
  | "cc"
  | "cd"
  | "sc"
  | "fr"
  | "mag"
  | "rl"
  | "pt"
  | "imp"
  | "pun"
  | "sla"
  | "heat"
  | "cold"
  | "elec"
  | "tox"
  | "rad"
  | "mgn"
  | "bla"
  | "cor"
  | "gas"
  | "vir"
  | "facGrineer"
  | "facCorpus"
  | "facInfested"
  | "facOrokin"
  | "facMurmur";

export type DamageTypeKey =
  | "impact"
  | "puncture"
  | "slash"
  | "heat"
  | "cold"
  | "electricity"
  | "toxin"
  | "blast"
  | "corrosive"
  | "gas"
  | "magnetic"
  | "radiation"
  | "viral"
  | "void"
  | "tau"
  | "true";

/** base elements that participate in pairing */
export type BaseElement = "heat" | "cold" | "electricity" | "toxin";

/** compound recipes (DE): the two base elements combine in slot order */
export const COMPOUND: Record<string, [BaseElement, BaseElement]> = {
  blast: ["cold", "heat"],
  corrosive: ["electricity", "toxin"],
  gas: ["heat", "toxin"],
  magnetic: ["cold", "electricity"],
  radiation: ["electricity", "heat"],
  viral: ["cold", "toxin"],
};

export const ELEMENT_PAIR_KEY: Record<string, string> = {
  "cold+heat": "blast",
  "electricity+toxin": "corrosive",
  "heat+toxin": "gas",
  "cold+electricity": "magnetic",
  "electricity+heat": "radiation",
  "cold+toxin": "viral",
};

/** DE Damage 2.0: multipliers per health/armor class, index into FLESH_ORDER */
export const FLESH_ORDER = [
  "flesh",
  "clonedFlesh",
  "fossilized",
  "infested",
  "infestedFlesh",
  "infestedSinew",
  "machinery",
  "robotic",
  "object",
  "shield",
  "protoShield",
  "ferriteArmor",
  "alloyArmor",
] as const;

export type FleshType = (typeof FLESH_ORDER)[number];

const M = (
  flesh: number,
  cloned: number,
  fossil: number,
  inf: number,
  infFlesh: number,
  infSinew: number,
  mach: number,
  robot: number,
  obj: number,
  shield: number,
  proto: number,
  ferrite: number,
  alloy: number,
) => [flesh, cloned, fossil, inf, infFlesh, infSinew, mach, robot, obj, shield, proto, ferrite, alloy];

/** +0.5 == +50% damage against that class */
export const DMG_CLASS_MUL: Record<string, readonly number[]> = {
  impact: M(-0.25, -0.25, 0, 0, 0, 0, 0.25, 0, 0, 0.5, 0.25, 0, 0),
  puncture: M(0, 0, 0, 0, 0, 0.25, 0, 0.25, 0, -0.2, -0.5, 0.5, 0.15),
  slash: M(0.25, 0.25, 0.15, 0.25, 0.5, 0, 0, -0.25, 0, 0, 0, -0.15, -0.5),
  heat: M(0, 0.25, 0, 0.25, 0.5, 0, 0, 0, 0, 0, -0.5, 0, 0),
  cold: M(0, 0, -0.25, 0, -0.5, 0.25, 0, 0, 0, 0.5, 0, 0, 0.25),
  electricity: M(0, 0, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 0, -0.5),
  toxin: M(0.5, 0, -0.5, 0, 0, 0, -0.25, -0.25, 0, Number.NaN, Number.NaN, 0, 0),
  blast: M(0, 0, 0.5, 0, 0, -0.5, 0.75, 0, 0, 0, 0, -0.25, 0),
  corrosive: M(0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0, -0.5, 0.75, 0),
  gas: M(-0.25, -0.5, 0, 0.75, 0.5, 0, 0, 0, 0, 0, 0, 0, 0),
  magnetic: M(0, 0, 0, 0, 0, 0, 0, 0, 0, 0.75, 0.75, 0, -0.5),
  radiation: M(0, 0, -0.75, -0.5, 0, 0.5, 0, 0.25, 0, -0.25, 0, 0, 0.75),
  viral: M(0.5, 0.75, 0, -0.5, 0, 0, -0.25, 0, 0, 0, 0, 0, 0),
  true: M(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Number.NaN, Number.NaN),
  void: M(0, -0.5, -0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
};

/** DE armor damage-reduction: armor / (armor + 300) */
export function armorDR(armor: number): number {
  return armor > 0 ? armor / (armor + 300) : 0;
}

/** enemy level scaling (Riven Mirror / huijiwiki formula) */
function trans(start: number, end: number, lvl: number): number {
  return Math.min(1, (Math.max(lvl, start) - start) / (end - start));
}

export function scaledHealth(base: { health: number; baseLevel: number }, lvl: number): number {
  const d = lvl - base.baseLevel;
  const low = 1 + d * d * 0.015;
  const high = 1 + Math.sqrt(d) * 10.75;
  const r = trans(70 + base.baseLevel, 85, lvl);
  return base.health * ((1 - r) * low + r * high);
}

export function scaledArmor(base: { armor: number; baseLevel: number }, lvl: number): number {
  const d = lvl - base.baseLevel;
  const low = 1 + d ** 1.75 * 0.005;
  const high = 1 + d ** 0.75 * 0.4;
  const r = trans(70 + base.baseLevel, 85, lvl);
  return base.armor * ((1 - r) * low + r * high);
}

export function scaledShield(base: { shield: number; baseLevel: number }, lvl: number): number {
  const d = lvl - base.baseLevel;
  const low = 1 + d * d * 0.0075;
  const high = 1 + d ** 0.75 * 1.6;
  const r = trans(70 + base.baseLevel, 85, lvl);
  return base.shield * ((1 - r) * low + r * high);
}

/** benchmark enemies for v1 "full adversarial" mode */
export interface EnemySpec {
  id: string;
  zh: string;
  /** the faction this enemy belongs to: faction damage (驱逐/灭亡/净化) only applies on a match */
  faction?: "facGrineer" | "facCorpus" | "facInfested" | "facOrokin" | "facMurmur";
  baseLevel: number;
  health: number;
  shield: number;
  armor: number;
  fleshType: FleshType;
  shieldType: FleshType;
  armorType: FleshType;
}

export const ENEMIES: EnemySpec[] = [
  {
    id: "Corrupted Heavy Gunner",
    zh: "堕落重枪兵",
    faction: "facOrokin",
    baseLevel: 8,
    health: 700,
    shield: 0,
    armor: 500,
    fleshType: "clonedFlesh",
    shieldType: "shield",
    armorType: "ferriteArmor",
  },
  {
    id: "Corrupted Bombard",
    zh: "堕落轰击者",
    faction: "facOrokin",
    baseLevel: 4,
    health: 300,
    shield: 0,
    armor: 500,
    fleshType: "clonedFlesh",
    shieldType: "shield",
    armorType: "alloyArmor",
  },
  {
    id: "Corrupted Crewman",
    zh: "堕落船员",
    faction: "facOrokin",
    baseLevel: 4,
    health: 60,
    shield: 150,
    armor: 0,
    fleshType: "flesh",
    shieldType: "protoShield",
    armorType: "ferriteArmor",
  },
  {
    id: "Corrupted MOA",
    zh: "堕落MOA",
    faction: "facOrokin",
    baseLevel: 4,
    health: 250,
    shield: 250,
    armor: 0,
    fleshType: "robotic",
    shieldType: "shield",
    armorType: "alloyArmor",
  },
  // ---- faction benchmarks: riven-mirror enemy.ts, cross-checked with the wiki ----
  {
    id: "Heavy Gunner",
    zh: "重型机枪兵",
    faction: "facGrineer",
    baseLevel: 8,
    health: 300,
    shield: 0,
    armor: 500,
    fleshType: "clonedFlesh",
    shieldType: "shield",
    armorType: "ferriteArmor",
  },
  {
    id: "Bombard",
    zh: "轰炸兵",
    faction: "facGrineer",
    baseLevel: 4,
    health: 300,
    shield: 0,
    armor: 500,
    fleshType: "clonedFlesh",
    shieldType: "shield",
    armorType: "alloyArmor",
  },
  {
    id: "Corpus Tech",
    zh: "技术员",
    faction: "facCorpus",
    baseLevel: 15,
    health: 700,
    shield: 250,
    armor: 0,
    fleshType: "flesh",
    shieldType: "protoShield",
    armorType: "ferriteArmor",
  },
  {
    id: "Nullifier Crewman",
    zh: "虚无船员",
    faction: "facCorpus",
    baseLevel: 15,
    health: 90,
    shield: 40,
    armor: 0,
    fleshType: "flesh",
    shieldType: "protoShield",
    armorType: "ferriteArmor",
  },
  {
    id: "Charger",
    zh: "冲撞者",
    faction: "facInfested",
    baseLevel: 1,
    health: 80,
    shield: 0,
    armor: 0,
    fleshType: "infested",
    shieldType: "shield",
    armorType: "ferriteArmor",
  },
  {
    id: "Ancient Healer",
    zh: "治愈远古",
    faction: "facInfested",
    baseLevel: 1,
    health: 400,
    shield: 0,
    armor: 0,
    fleshType: "fossilized",
    shieldType: "shield",
    armorType: "ferriteArmor",
  },
  {
    id: "Toxic Ancient",
    zh: "毒素远古",
    faction: "facInfested",
    baseLevel: 1,
    health: 400,
    shield: 0,
    armor: 0,
    fleshType: "fossilized",
    shieldType: "shield",
    armorType: "ferriteArmor",
  },
];

/** DE riven stat tag -> engine semantic key (gun subset) */
export const RIVEN_TAG_TO_KEY: Record<string, StatKey> = {
  WeaponDamageAmountMod: "dmg",
  WeaponFireIterationsMod: "ms",
  WeaponCritChanceMod: "cc",
  WeaponCritDamageMod: "cd",
  WeaponProcTimeMod: "sc",
  WeaponFireRateMod: "fr",
  WeaponClipMaxMod: "mag",
  WeaponReloadSpeedMod: "rl",
  WeaponImpactDamageMod: "imp",
  WeaponArmorPiercingDamageMod: "pun",
  WeaponSlashDamageMod: "sla",
  WeaponFireDamageMod: "heat",
  WeaponFreezeDamageMod: "cold",
  WeaponElectricityDamageMod: "elec",
  WeaponToxinDamageMod: "tox",
  WeaponGasDamageMod: "gas",
  WeaponCorrosiveDamageMod: "cor",
  WeaponViralDamageMod: "vir",
  WeaponRadiationDamageMod: "rad",
  WeaponBlastDamageMod: "bla",
  WeaponMagneticDamageMod: "mgn",
  WeaponFactionDamageGrineer: "facGrineer",
  WeaponFactionDamageCorpus: "facCorpus",
  WeaponFactionDamageInfested: "facInfested",
  WeaponFactionDamageOrokin: "facOrokin",
  WeaponPunctureDepthMod: "pt",
};

export const TYPE_ZH: Record<string, string> = {
  impact: "冲击",
  puncture: "穿刺",
  slash: "切割",
  heat: "火焰",
  cold: "冰冻",
  electricity: "电击",
  toxin: "毒素",
  blast: "爆炸",
  corrosive: "腐蚀",
  gas: "毒气",
  magnetic: "磁力",
  radiation: "辐射",
  viral: "病毒",
  void: "虚空",
  tau: "Tau",
  true: "真实",
};
