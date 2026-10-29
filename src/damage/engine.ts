/**
 * V1 damage engine (guns): pure functions, no DOM / state deps.
 *
 * Pipeline: build-stats -> element synthesis -> panel -> dps -> vs-enemy.
 * Core formulas cross-checked against Riven Mirror (MIT):
 *   total = base_total x (1+sum dmg) x (1 + extraMul)
 *   extraMul = sum(element mods) + sum(phys mods x phys share)
 *   sustained fr = m.f / (m-1+max(1, r.f));  charge: 1 / (1/f + r/m)
 *   crit factor = 1 + cc x (cd - 1)
 */

import type { DamageTypeKey, EnemySpec, FleshType, StatKey } from "./data";
import { COMPOUND, DMG_CLASS_MUL, ELEMENT_PAIR_KEY, ENEMIES, FLESH_ORDER, RIVEN_TAG_TO_KEY, scaledArmor, scaledHealth, scaledShield } from "./data";

/** 灵化形态面板（Incarnon Genesis）：dmg/total 为每光束/弹丸口径 */
export interface IncarnonSpec {
  dmg: Partial<Record<DamageTypeKey, number>>;
  total: number;
  cc: number;
  cd: number;
  sc: number;
  fr: number;
  /** 固有光束/弹丸数（Wiki 核验，如野猪 3 条链式光束）：并入多重射击基数 */
  beams?: number;
  /** 形态独立弹匣（固定值，不受弹匣 MOD 影响；缺省回落基础弹匣） */
  mag?: number;
}

export interface WeaponPanel {
  id: string;
  en: string;
  zh: string;
  compat: "rifle" | "shotgun" | "pistol";
  dmg: Partial<Record<DamageTypeKey, number>>;
  total: number;
  cc: number;
  cd: number;
  sc: number;
  fr: number;
  mag: number;
  rl: number;
  ms: number;
  omega?: number;
  trigger?: string;
  charge?: number;
  /** 灵化形态（Incarnon Genesis）面板，存在即代表该武器可灵化 */
  incarnon?: IncarnonSpec;
  /** 弹匣为形态固定值：弹匣容量 MOD 不生效（Wiki：形态弹匣不受 MOD 影响） */
  fixedMag?: boolean;
  /** game.json 名录的武器类别（同族版本一致，用于家族归组） */
  cls?: string;
}

/** 灵化形态面板替换：伤害/暴击/射速换成形态值，ms=固有光束数，弹匣固定 */
export function incarnonPanel(w: WeaponPanel): WeaponPanel {
  const i = w.incarnon;
  if (!i) return w;
  return {
    ...w,
    dmg: i.dmg,
    total: i.total,
    cc: i.cc,
    cd: i.cd,
    sc: i.sc,
    fr: i.fr,
    ms: i.beams ?? 1,
    mag: i.mag ?? w.mag,
    fixedMag: i.mag != null,
    trigger: undefined,
    charge: undefined,
  };
}

export interface ModCard {
  id: string;
  zh: string;
  en: string;
  compat: "rifle" | "shotgun" | "pistol";
  polarity?: string;
  drain?: number;
  rank?: number;
  stats: Partial<Record<StatKey, number>>;
  /** equip restriction from the mod description (Cannonade etc.): must equal the weapon's trigger */
  trigger?: string;
  /** kill-stack conditional (镀层): contribution = (base ?? 0) + count x per while count > 0 */
  stack?: { stat: StatKey; per: number; max: number; base?: number };
  /** carries unmodelable conditional bonuses: displayed as a note, never counted */
  cond?: true;
}

/** riven contribution, already normalized to semantic keys (use RIVEN_TAG_TO_KEY) */
export interface RivenContribution {
  stats: Partial<Record<StatKey, number>>;
}

export interface EnemyContext {
  spec: EnemySpec;
  level: number;
  /** fractional armor already stripped, 0..1 */
  armorStrip?: number;
}

export interface BuildResult {
  /** per-type panel damage (pre-crit, pre-enemy) */
  dmg: Partial<Record<DamageTypeKey, number>>;
  panelTotal: number;
  cc: number;
  cd: number;
  sc: number;
  fr: number;
  ms: number;
  mag: number;
  rl: number;
  /** per-shot damage incl. multishot, pre-crit */
  perShot: number;
  critFactor: number;
  burstDps: number;
  sustainedDps: number;
  /** shots per second after magazine cycle */
  sustainedFr: number;
  vsEnemy?: {
    id: string;
    level: number;
    health: number;
    shield: number;
    armor: number;
    /** per-type post-mitigation damage */
    dmg: Partial<Record<DamageTypeKey, number>>;
    perShot: number;
    burstDps: number;
    sustainedDps: number;
    timeToKill: number;
  };
}

const PHYS: DamageTypeKey[] = ["impact", "puncture", "slash"];
const BASE_ELE: DamageTypeKey[] = ["heat", "cold", "electricity", "toxin"];

/** collect summed stats from mods + riven (+ galvanized kill stacks); mods order defines element pairing order */
export function collectStats(mods: Array<ModCard | null | undefined>, riven?: RivenContribution | null, stacks?: Record<string, number>) {
  const sums: Record<string, number> = {};
  const elementOrder: string[] = [];
  const bump = (k: StatKey, v: number) => {
    sums[k] = (sums[k] ?? 0) + v;
  };
  for (const m of mods) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m.stats) as Array<[StatKey, number]>) {
      bump(k, v);
      if (["heat", "cold", "elec", "tox"].includes(k) && v > 0 && !elementOrder.includes(k)) {
        elementOrder.push(k);
      }
    }
    // 镀层击杀叠层：0 层不生效，≥1 层 = base + count x per
    if (m.stack) {
      const count = stacks?.[m.id] ?? 0;
      if (count > 0) bump(m.stack.stat, (m.stack.base ?? 0) + count * m.stack.per);
    }
  }
  if (riven) {
    for (const [k, v] of Object.entries(riven.stats) as Array<[StatKey, number]>) {
      bump(k, v);
      if (["heat", "cold", "elec", "tox"].includes(k) && v > 0 && !elementOrder.includes(k)) {
        elementOrder.push(k);
      }
    }
  }
  return { sums, elementOrder };
}

/** semantic element key -> damage type key (for base weapon pools) */
const ELE_KEY2TYPE: Record<string, DamageTypeKey> = {
  heat: "heat",
  cold: "cold",
  elec: "electricity",
  tox: "toxin",
};
const ELE_KEY_TO_PAIR_ELEM: Record<string, string> = {
  heat: "heat",
  cold: "cold",
  elec: "electricity",
  tox: "toxin",
};
const PAIR_ELEM_TO_KEY: Record<string, string> = {
  heat: "heat",
  cold: "cold",
  electricity: "elec",
  toxin: "tox",
};

/**
 * Element synthesis (DE pairing):
 *  1. weapon-innate base elements pair first (in fixed type order)
 *  2. mod elements pair in slot order
 *  each pair merges into a compound at the summed increment
 */
export function synthesize(w: WeaponPanel, sums: Record<string, number>, elementOrder: string[]): { dmg: Partial<Record<DamageTypeKey, number>>; extraMul: number } {
  const total = w.total;
  const dmg: Partial<Record<DamageTypeKey, number>> = {};
  let extraMul = 0;

  // per-type multipliers from phys-specific mods
  const physMul: Record<string, number> = {
    impact: 1 + (sums.imp ?? 0),
    puncture: 1 + (sums.pun ?? 0),
    slash: 1 + (sums.sla ?? 0),
  };

  // innate base elements enter the pairing queue first
  const queue: Array<{ pair: string; inc: number }> = [];
  for (const t of BASE_ELE) {
    const base = w.dmg[t] ?? 0;
    if (base > 0) {
      queue.push({ pair: t, inc: base / total });
    }
  }
  // mod elements in slot order
  for (const k of elementOrder) {
    const inc = sums[k] ?? 0;
    if (inc > 0) queue.push({ pair: ELE_KEY_TO_PAIR_ELEM[k], inc });
    extraMul += inc;
  }
  // phys mods contribute share-weighted extra
  for (const t of PHYS) {
    const share = (w.dmg[t] ?? 0) / total;
    extraMul += share * ((physMul[t] ?? 1) - 1);
  }
  // standalone compound mods (rare): rad/bla/etc add directly, no pairing
  const standalone: Record<string, DamageTypeKey> = {
    rad: "radiation",
    mgn: "magnetic",
    bla: "blast",
    cor: "corrosive",
    gas: "gas",
    vir: "viral",
  };
  for (const k of Object.keys(standalone)) {
    const inc = sums[k] ?? 0;
    if (inc > 0) {
      extraMul += inc;
    }
  }

  const baseDmgMul = 1 + (sums.dmg ?? 0);
  // pair the queue (two-by-two, slot order)
  const paired: Array<{ type: DamageTypeKey; inc: number }> = [];
  for (let i = 0; i < queue.length; i += 2) {
    const a = queue[i];
    const b = queue[i + 1];
    if (b) {
      const key = [a.pair, b.pair].sort().join("+");
      const compound = ELEMENT_PAIR_KEY[key];
      if (compound) {
        paired.push({ type: compound as DamageTypeKey, inc: a.inc + b.inc });
      } else {
        paired.push({ type: ELE_KEY2TYPE[PAIR_ELEM_TO_KEY[a.pair]] ?? "heat", inc: a.inc });
        paired.push({ type: ELE_KEY2TYPE[PAIR_ELEM_TO_KEY[b.pair]] ?? "heat", inc: b.inc });
      }
    } else {
      paired.push({ type: ELE_KEY2TYPE[PAIR_ELEM_TO_KEY[a.pair]] ?? "heat", inc: a.inc });
    }
  }
  for (const t of PHYS) {
    const v = (w.dmg[t] ?? 0) * physMul[t] * baseDmgMul;
    if (v > 0) dmg[t] = v;
  }
  for (const p of paired) {
    const v = total * p.inc * baseDmgMul;
    dmg[p.type] = (dmg[p.type] ?? 0) + v;
  }
  // standalone compound stats also land on the panel (post-pairing)
  for (const [k, t] of Object.entries(standalone)) {
    const inc = sums[k] ?? 0;
    if (inc > 0) {
      dmg[t] = (dmg[t] ?? 0) + total * inc * baseDmgMul;
    }
  }
  // innate compound elements pass through untouched by phys mods
  for (const t of ["blast", "corrosive", "gas", "magnetic", "radiation", "viral", "void", "tau"] as DamageTypeKey[]) {
    if (w.dmg[t]) dmg[t] = (dmg[t] ?? 0) + w.dmg[t] * baseDmgMul;
  }
  return { dmg, extraMul };
}

export function computeBuild(
  w: WeaponPanel,
  mods: Array<ModCard | null | undefined> = [],
  riven?: RivenContribution | null,
  enemy?: EnemyContext | null,
  stacks?: Record<string, number>,
): BuildResult {
  const { sums, elementOrder } = collectStats(mods ?? [], riven, stacks);
  const { dmg: dmgMap } = synthesize(w, sums, elementOrder);

  const panelTotal = Object.values(dmgMap).reduce((a, b) => a + (b ?? 0), 0);

  const cc = Math.max(0, w.cc * (1 + (sums.cc ?? 0)));
  const cd = w.cd * (1 + (sums.cd ?? 0));
  const sc = Math.max(0, w.sc * (1 + (sums.sc ?? 0)));
  const ms = (w.ms ?? 1) * (1 + (sums.ms ?? 0));
  const frBase = w.fr > 0 ? w.fr : w.charge ? 1 / w.charge : 0;
  const fr = frBase * (1 + (sums.fr ?? 0));
  const mag = w.fixedMag ? Math.max(1, Math.round(w.mag)) : Math.max(1, Math.round(w.mag * (1 + (sums.mag ?? 0))));
  const rl = w.rl / (1 + (sums.rl ?? 0));

  const perShot = panelTotal * ms;
  const critFactor = 1 + Math.min(1, cc) * (cd - 1);

  // sustained fire rate (Riven Mirror formula)
  let sustainedFr: number;
  if (w.trigger === "Charge" || (w.fr <= 0 && w.charge)) {
    sustainedFr = 1 / (1 / fr + rl / mag);
  } else {
    sustainedFr = (mag * fr) / (mag - 1 + Math.max(1, rl * fr));
  }

  // 阵营伤害（驱逐/灭亡/净化）是条件加成：只对所选敌人所属阵营生效；未选敌人时按游戏面板口径不生效
  const factionKey = enemy?.spec.faction;
  const factionMul = factionKey ? 1 + (sums[factionKey] ?? 0) : 1;

  const burstDps = perShot * critFactor * fr * factionMul;
  const sustainedDps = perShot * critFactor * sustainedFr * factionMul;

  const result: BuildResult = {
    dmg: Object.fromEntries(Object.entries(dmgMap).filter(([, v]) => (v ?? 0) > 0)) as BuildResult["dmg"],
    panelTotal,
    cc,
    cd,
    sc,
    ms,
    fr,
    mag,
    rl,
    perShot,
    critFactor,
    burstDps,
    sustainedDps,
    sustainedFr,
  };

  if (enemy) {
    result.vsEnemy = computeVsEnemy(dmgMap, ms, critFactor, fr, sustainedFr, factionMul, enemy);
  }
  return result;
}

function classIndex(t: FleshType): number {
  return FLESH_ORDER.indexOf(t);
}

function computeVsEnemy(
  dmgMap: Partial<Record<DamageTypeKey, number>>,
  ms: number,
  critFactor: number,
  fr: number,
  sustainedFr: number,
  factionMul: number,
  enemy: EnemyContext,
): BuildResult["vsEnemy"] {
  const spec = enemy.spec;
  const lvl = enemy.level;
  const strip = Math.min(1, Math.max(0, enemy.armorStrip ?? 0));
  const health = scaledHealth(spec, lvl);
  const shield = scaledShield(spec, lvl);
  const armor = scaledArmor(spec, lvl) * (1 - strip);
  const fi = classIndex(spec.fleshType);
  const ai = classIndex(spec.armorType);
  const si = classIndex(spec.shieldType);

  const eff: Partial<Record<DamageTypeKey, number>> = {};
  let effPerShot = 0;
  for (const [t, v] of Object.entries(dmgMap) as Array<[DamageTypeKey, number]>) {
    if (!v) continue;
    const table = DMG_CLASS_MUL[t];
    // DE armor rule: the type's armor-class modifier scales the *armor value*
    // (e.g. corrosive vs ferrite x1.75 -> armor / 1.75), then health-class
    // multiplier applies to the mitigated remainder
    const armorMul = 1 + (table ? (table[ai] ?? 0) : 0);
    const effArmor = armor > 0 ? armor / Math.max(0.1, armorMul) : 0;
    const typeDr = effArmor > 0 ? effArmor / (effArmor + 300) : 0;
    const healthMul = 1 + (table ? (table[fi] ?? 0) : 0);
    const effV = v * (1 - typeDr) * healthMul;
    eff[t] = effV;
    effPerShot += effV;
  }
  // shields: toxin bypasses; shield takes shield-class multiplier
  let shieldPerShot = 0;
  for (const [t, v] of Object.entries(dmgMap) as Array<[DamageTypeKey, number]>) {
    if (!v || t === "toxin" || t === "gas") continue;
    const table = DMG_CLASS_MUL[t];
    const shieldMul = 1 + (table ? (table[si] ?? 0) : 0);
    shieldPerShot += v * shieldMul;
  }

  const perShot = effPerShot * ms;
  const burst = perShot * critFactor * fr * factionMul;
  const sustained = perShot * critFactor * sustainedFr * factionMul;
  // TTK: burn shields first (shield ignores crit in v1), then health
  const sustainedShield = shieldPerShot * ms * sustainedFr * factionMul;
  const ttkShield = sustainedShield > 0 ? shield / sustainedShield : 0;
  const timeToKill = ttkShield + health / Math.max(1e-9, sustained);

  return {
    id: spec.id,
    level: lvl,
    health,
    shield,
    armor,
    dmg: eff,
    perShot,
    burstDps: burst,
    sustainedDps: sustained,
    timeToKill,
  };
}

export { COMPOUND, ENEMIES, RIVEN_TAG_TO_KEY };
