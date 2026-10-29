/**
 * 异常状态（Status Effect）稳态模型 —— Fandom Wiki 2026-10 口径（Damage 2.0 现行）。
 *
 * 逐条核验过的规则：
 *  - 触发类型按「各伤害类型占面板总伤的比例」分配（Update 27.2 移除了旧的 60/40 物理偏向）
 *  - 每个弹丸独立结算触发：期望触发/秒 = 弹丸数(ms) × 触发率(sc) × 循环射速
 *  - DoT 基伤（Modded Base Damage）= 基伤总量 × (1+基伤MOD) × (1+阵营)，
 *    不吃元素/物理%加成（Buzz Kill 不加流血），但灼烧/中毒/毒气各自再乘 (1+该元素%)；
 *    阵营对 DoT 生效两次（基伤一次、每跳一次）；DoT 快照触发命中的暴击乘数 → 期望 × critFactor
 *  - 流血：1s 延迟后每秒 1 跳共 6 跳 × 0.35；Cinematic 伤害——无视护甲，也无肉体类型修正
 *  - 灼烧：每秒 1 跳共 6 跳 × 0.5 ×(1+火%)；火焰类型；点燃期间剥甲 50%（2s 爬升）
 *  - 中毒：每秒 1 跳共 6 跳 × 0.5 ×(1+毒%)；毒素类型；绕过护盾直击生命
 *  - 毒气：每秒 1 跳共 6 跳 × 0.5 ×(1+毒气%)；毒气类型（单体近似）
 *  - 爆炸：1.5s 后 0.3 × 基伤 ×1 跳（对目标本身的部分）
 *  - 电击：链式只命中周围敌人——单体战斗贡献为 0
 *  - 病毒（6s 窗口）：首层 +100% 生命伤害，后续每层 +25%，10 层上限 +325%（×4.25）
 *  - 腐蚀（8s 窗口）：首层 -26% 护甲，后续每层 -6%，10 层上限 -80%
 *  - 磁力（6s 窗口）：对护盾首层 +100%，后续 +25%，上限 +325%
 *  - 剥甲来源与手动滑杆为乘法叠加（wiki：Heat strip 与 Corrosive/光环乘算）
 *
 * 稳态近似：叠层数 = 触发率 × 窗口时长；DoT 稳态 DPS = 每次触发总伤 × 触发率。
 * 不模拟起跳延迟与短战斗里的叠层爬升（短击杀实际会略低于稳态值）。
 */

import type { DamageTypeKey } from "./data";

/** 有 DoT/数值效果的触发键（流血按 slash 触发，类推） */
export type DotKey = "slash" | "heat" | "toxin" | "gas" | "blast";

export interface ProcRates {
  /** 期望触发/秒（全部类型合计） */
  total: number;
  /** 按面板伤害占比分配后的各类型期望触发/秒 */
  byType: Partial<Record<DamageTypeKey, number>>;
}

/** 期望触发率：每弹丸独立 roll，sc>100% 时每弹可多触发，期望值不设上限 */
export function procRates(dmg: Partial<Record<DamageTypeKey, number>>, panelTotal: number, sc: number, ms: number, shotsPerSec: number): ProcRates {
  const total = ms * Math.max(0, sc) * Math.max(0, shotsPerSec);
  const byType: Partial<Record<DamageTypeKey, number>> = {};
  if (total > 0 && panelTotal > 0) {
    for (const [t, v] of Object.entries(dmg) as Array<[DamageTypeKey, number]>) {
      if (v > 0) byType[t] = (total * v) / panelTotal;
    }
  }
  return { total, byType };
}

const stacksIn = (ratePerSec: number, window: number) => Math.max(0, Math.min(10, ratePerSec * window));

/** 病毒：生命伤害乘数（首层 +100%，后续 +25%/层，上限 +325%） */
export function viralHealthMul(ratePerSec: number): { stacks: number; mul: number } {
  const stacks = stacksIn(ratePerSec, 6);
  return { stacks, mul: stacks < 1 ? 1 : 1 + Math.min(3.25, 1 + 0.25 * (stacks - 1)) };
}

/** 磁力：护盾伤害乘数（首层 +100%，后续 +25%/层，上限 +325%） */
export function magneticShieldMul(ratePerSec: number): { stacks: number; mul: number } {
  const stacks = stacksIn(ratePerSec, 6);
  return { stacks, mul: stacks < 1 ? 1 : 1 + Math.min(3.25, 1 + 0.25 * (stacks - 1)) };
}

/** 腐蚀：护甲削减比例（首层 26%，后续 +6%/层，上限 80%；8s 窗口） */
export function corrosiveArmorStrip(ratePerSec: number): { stacks: number; strip: number } {
  const stacks = stacksIn(ratePerSec, 8);
  return { stacks, strip: stacks < 1 ? 0 : Math.min(0.8, 0.26 + 0.06 * (stacks - 1)) };
}

/** 火焰：点燃期间稳定剥甲 50%（2s 爬升，稳态视为常驻） */
export const HEAT_ARMOR_STRIP = 0.5;

/** 每秒 DoT 面板伤害（未过防具）：rate × 跳数 × 每跳系数 × DoT基伤 × (1+元素%) × 阵营² × 暴击期望 */
export function dotPerSecond(
  rates: ProcRates,
  dotBase: number,
  elemBonus: { heat: number; toxin: number; gas: number },
  critFactor: number,
  factionMul: number,
): Record<DotKey, number> {
  const f2 = factionMul * factionMul;
  const tick = (rate: number, frac: number, ticks: number, bonus = 0) => (rate > 0 ? rate * ticks * frac * dotBase * (1 + bonus) * f2 * critFactor : 0);
  return {
    slash: tick(rates.byType.slash ?? 0, 0.35, 6),
    heat: tick(rates.byType.heat ?? 0, 0.5, 6, elemBonus.heat),
    toxin: tick(rates.byType.toxin ?? 0, 0.5, 6, elemBonus.toxin),
    gas: tick(rates.byType.gas ?? 0, 0.5, 6, elemBonus.gas),
    blast: tick(rates.byType.blast ?? 0, 0.3, 1),
  };
}

/** vs-enemy 结果上暴露的异常层明细（全部为稳态值） */
export interface StatusDetail {
  /** 期望触发/秒（含多重弹丸） */
  procsPerSec: number;
  /** 按伤害占比分配的各类型期望触发/秒 */
  procRate: Partial<Record<DamageTypeKey, number>>;
  viralStacks: number;
  /** 生命伤害乘数，1..4.25 */
  viralMul: number;
  magneticStacks: number;
  /** 护盾伤害乘数，1..4.25 */
  magneticMul: number;
  /** 腐蚀剥甲比例 0..0.8（稳态） */
  corrosiveStrip: number;
  /** 火焰剥甲 0 / 0.5 */
  heatStrip: number;
  /** 各 DoT 过甲后的每秒伤害（生命阶段口径，未乘病毒） */
  dotDps: Partial<Record<DotKey, number>>;
  /** DoT 合计（生命阶段，未乘病毒） */
  dotDpsTotal: number;
}
