/**
 * V1 damage engine (guns): pure functions, no DOM / state deps.
 *
 * Pipeline: build-stats -> element synthesis -> panel -> dps -> vs-enemy.
 * Core formulas cross-checked against Riven Mirror (MIT):
 *   total = base_total x (1+sum dmg) x (1 + extraMul)
 *   extraMul = sum(element mods) + sum(phys mods x phys share)
 *   sustained fr = m.f / (m+max(1, r.f));  charge: 1 / (1/f + r/m)
 *   crit factor = 1 + cc x (cd - 1)
 */

import type { DamageTypeKey, EnemySpec, FleshType, StatKey } from "./data";
import { COMPOUND, DMG_CLASS_MUL, ELEMENT_PAIR_KEY, ENEMIES, FLESH_ORDER, RIVEN_TAG_TO_KEY, scaledArmor, scaledHealth, scaledShield } from "./data";
import type { StatusDetail } from "./status";
import { corrosiveArmorStrip, dotPerSecond, HEAT_ARMOR_STRIP, magneticShieldMul, procRates, viralHealthMul } from "./status";

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
    /** 生命阶段总持续DPS：直伤 + 异常DoT，已乘病毒增伤 */
    sustainedDps: number;
    /** 直伤部分（护甲/肉体修正后，未乘病毒、不含异常DoT） */
    directSustainedDps: number;
    /** 异常状态稳态层（触发率 / 叠层 / 剥甲 / DoT 明细） */
    status?: StatusDetail;
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

  // mod elements in slot order; a same-named innate element is pulled into
  // that mod's slot (Wiki: innate elements pair LAST unless a mod of the
  // same element drags them to its slot position)
  const queue: Array<{ pair: string; inc: number }> = [];
  const slotOf: Partial<Record<string, number>> = {};
  for (const k of elementOrder) {
    const inc = sums[k] ?? 0;
    if (inc > 0) {
      slotOf[ELE_KEY_TO_PAIR_ELEM[k]] = queue.length;
      queue.push({ pair: ELE_KEY_TO_PAIR_ELEM[k], inc });
    }
    extraMul += inc;
  }
  // innate base elements enter the pairing queue last (merged into their mod slot when same-named)
  for (const t of BASE_ELE) {
    const base = w.dmg[t] ?? 0;
    if (base > 0) {
      const at = slotOf[t];
      if (at != null) queue[at].inc += base / total;
      else queue.push({ pair: t, inc: base / total });
    }
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
  // 暴击层级期望：>100% 的部分不截断（126.3% 就按 1.263 计）
  const critFactor = 1 + cc * (cd - 1);

  // sustained fire rate (Riven Mirror formula)
  let sustainedFr: number;
  if (w.trigger === "Charge" || (w.fr <= 0 && w.charge)) {
    sustainedFr = 1 / (1 / fr + rl / mag);
  } else {
    // 一个弹匣周期 = 弹匣/射速 + 装填（社区通用口径；旧版分母用 弹匣-1，低弹匣武器高估 4~6%）
    sustainedFr = (mag * fr) / (mag + Math.max(1, rl * fr));
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
    // DoT 口径基伤（wiki）：基伤总量 × (1+基伤MOD)，不吃元素/物理%，阵营另在 DoT 层生效
    const dotBase = w.total * (1 + (sums.dmg ?? 0));
    result.vsEnemy = computeVsEnemy({
      dmg: dmgMap,
      panelTotal,
      ms,
      sc,
      critFactor,
      fr,
      sustainedFr,
      factionMul,
      dotBase,
      elemBonus: { heat: sums.heat ?? 0, toxin: sums.tox ?? 0, gas: sums.gas ?? 0 },
      enemy,
    });
  }
  return result;
}

function classIndex(t: FleshType): number {
  return FLESH_ORDER.indexOf(t);
}

function computeVsEnemy(p: {
  dmg: Partial<Record<DamageTypeKey, number>>;
  panelTotal: number;
  ms: number;
  sc: number;
  critFactor: number;
  fr: number;
  sustainedFr: number;
  factionMul: number;
  dotBase: number;
  elemBonus: { heat: number; toxin: number; gas: number };
  enemy: EnemyContext;
}): BuildResult["vsEnemy"] {
  const spec = p.enemy.spec;
  const lvl = p.enemy.level;
  const manualStrip = Math.min(1, Math.max(0, p.enemy.armorStrip ?? 0));
  const health = scaledHealth(spec, lvl);
  const shield = scaledShield(spec, lvl);
  const fi = classIndex(spec.fleshType);
  const ai = classIndex(spec.armorType);
  const si = classIndex(spec.shieldType);

  // ---- 异常稳态层（status.ts：触发率按伤害占比分配，叠层 = 触发率×窗口时长） ----
  const rates = procRates(p.dmg, p.panelTotal, p.sc, p.ms, p.sustainedFr);
  const viral = viralHealthMul(rates.byType.viral ?? 0);
  const magnetic = magneticShieldMul(rates.byType.magnetic ?? 0);
  const corrosive = corrosiveArmorStrip(rates.byType.corrosive ?? 0);
  const heatStrip = (rates.byType.heat ?? 0) > 0 ? HEAT_ARMOR_STRIP : 0;
  // 剥甲各来源乘法叠加（wiki：手动/腐蚀/火焰相乘）
  const armor = scaledArmor(spec, lvl) * (1 - manualStrip) * (1 - corrosive.strip) * (1 - heatStrip);

  // ---- 直伤逐类型过甲（护甲值已计入异常剥甲） ----
  const eff: Partial<Record<DamageTypeKey, number>> = {};
  let effPerShot = 0;
  for (const [t, v] of Object.entries(p.dmg) as Array<[DamageTypeKey, number]>) {
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
  // 直伤护盾池：毒素/毒气绕过（与 DoT 口径一致）；护盾吃暴击（修正 v1 的忽略）
  let shieldPerShot = 0;
  for (const [t, v] of Object.entries(p.dmg) as Array<[DamageTypeKey, number]>) {
    if (!v || t === "toxin" || t === "gas") continue;
    const table = DMG_CLASS_MUL[t];
    const shieldMul = 1 + (table ? (table[si] ?? 0) : 0);
    shieldPerShot += v * shieldMul;
  }

  const perShot = effPerShot * p.ms;
  const burst = perShot * p.critFactor * p.fr * p.factionMul;
  const directPerSec = perShot * p.critFactor * p.sustainedFr * p.factionMul;
  const directShieldPerSec = shieldPerShot * p.ms * p.critFactor * p.sustainedFr * p.factionMul;

  // ---- 异常 DoT 过甲 ----
  const raw = dotPerSecond(rates, p.dotBase, p.elemBonus, p.critFactor, p.factionMul);
  const throughArmor = (value: number, t: DamageTypeKey) => {
    if (value <= 0) return 0;
    const table = DMG_CLASS_MUL[t];
    const armorMul = 1 + (table ? (table[ai] ?? 0) : 0);
    const effArmor = armor > 0 ? armor / Math.max(0.1, armorMul) : 0;
    const typeDr = effArmor > 0 ? effArmor / (effArmor + 300) : 0;
    const healthMul = 1 + (table ? (table[fi] ?? 0) : 0);
    return value * (1 - typeDr) * healthMul;
  };
  const shieldSide = (value: number, t: DamageTypeKey) => {
    if (value <= 0) return 0;
    const table = DMG_CLASS_MUL[t];
    return value * (1 + (table ? (table[si] ?? 0) : 0));
  };
  const dotDps: StatusDetail["dotDps"] = {
    slash: raw.slash, // Cinematic：无视护甲、无类型修正，直通生命
    heat: throughArmor(raw.heat, "heat"),
    toxin: throughArmor(raw.toxin, "toxin"),
    gas: throughArmor(raw.gas, "gas"),
    blast: throughArmor(raw.blast, "blast"),
  };
  const dotHealth = (dotDps.slash ?? 0) + (dotDps.heat ?? 0) + (dotDps.toxin ?? 0) + (dotDps.gas ?? 0) + (dotDps.blast ?? 0);
  // 打盾 DoT：毒素/毒气绕过（与直伤一致），流血/灼烧/爆炸先扣盾（流血按真实行 → 护盾修正 ×1）
  const dotShield = shieldSide(raw.slash, "true") + shieldSide(raw.heat, "heat") + shieldSide(raw.blast, "blast");

  // ---- TTK：先盾后血；磁力只放大护盾伤害、病毒只放大生命伤害 ----
  const shieldDps = (directShieldPerSec + dotShield) * magnetic.mul;
  const healthDps = (directPerSec + dotHealth) * viral.mul;
  const ttkShield = shieldDps > 0 ? shield / shieldDps : 0;
  const timeToKill = ttkShield + health / Math.max(1e-9, healthDps);

  return {
    id: spec.id,
    level: lvl,
    health,
    shield,
    armor,
    dmg: eff,
    perShot,
    burstDps: burst,
    sustainedDps: healthDps,
    directSustainedDps: directPerSec,
    status: {
      procsPerSec: rates.total,
      procRate: rates.byType,
      viralStacks: viral.stacks,
      viralMul: viral.mul,
      magneticStacks: magnetic.stacks,
      magneticMul: magnetic.mul,
      corrosiveStrip: corrosive.strip,
      heatStrip,
      dotDps,
      dotDpsTotal: dotHealth,
    },
    timeToKill,
  };
}

export { COMPOUND, ENEMIES, RIVEN_TAG_TO_KEY };
