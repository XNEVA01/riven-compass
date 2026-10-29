/**
 * 期望利润桥接（V3a，spec §9.4）：把行情组合接进目标系统，回答「自己洗还是直接买」。
 *
 * 模型（落地修正）：求解器的路线是必然命中的（reachable 时），随机变量是赤毒成本——
 *   期望成本（白金）= E[赤毒] / 赤毒时薪 × 白金时薪   （时薪模型：两类农活的换算率）
 *   期望利润       = 组合中位价 − 期望成本
 * 预算内命中率直接取路线的 withinBudget（当前赤毒余额作预算）。
 * 价格是组合中位（各档位 roll 混合），成本是带档位目标的精确解 → 利润偏保守，UI 标「≈」。
 */
import type { RivenClass } from "../engine/data";
import { complete, effectiveLayouts, type GroupDraft, remapTag, type TargetDraft } from "../state";
import { type MarketCombo, type MarketWeapon, wmTag } from "./wm";

/** 市场组合在该武器类别下的游戏词条视图；任一词条映射不进该类词条池时为 null */
export interface ComboTags {
  pos: string[];
  neg: string[];
}

export function comboTags(cls: RivenClass, c: MarketCombo): ComboTags | null {
  const map = (urls: string[]): string[] | null => {
    const out: string[] = [];
    for (const u of urls) {
      const tag = wmTag(cls, u);
      // wmTag 对双系词条按近战/远程取一侧，取到的 tag 还必须是这一类武器真有的词条
      if (tag == null) return null;
      const own = remapTag(cls, tag);
      if (own == null) return null;
      out.push(own);
    }
    return out;
  };
  const pos = map(c.pos);
  if (!pos) return null;
  const neg = map(c.neg);
  if (!neg) return null;
  return { pos, neg };
}

/** 目标里能参与规划的一组（与 state.ts 的 usableSets 同语义，那边未导出） */
const usableSets = (t: TargetDraft) => t.sets.filter((gs) => gs.length > 0 && gs.every(complete));

/**
 * 市场组合是否严格满足目标的某一组：
 * 布局对齐（2+0/2+1/3+0/3+1 是目标接受的）、负词条在白名单里、
 * 组合词条无多余、目标每一行都被命中（组内 alternatives 命中任一即可）。
 * 档位不参与：组内词条在 any 档位下即算「洗出这个组合」。
 */
export function comboMatchesSet(t: TargetDraft, set: GroupDraft[], tags: ComboTags): boolean {
  const key = `${tags.pos.length}${tags.neg.length}`;
  if (!effectiveLayouts(t).includes(key)) return false;
  if (tags.neg.length > 1) return false;
  if (tags.neg.length === 1 && !t.allowedNeg.includes(tags.neg[0])) return false;
  const wanted = new Set(set.flatMap((g) => g.tags));
  if (!tags.pos.every((tag) => wanted.has(tag))) return false;
  return set.every((g) => g.tags.some((tag) => tags.pos.includes(tag)));
}

export interface ComboMatch {
  combo: MarketCombo;
  tags: ComboTags;
}

export interface MarketMatch {
  /** 严格匹配：词条集完全对应目标的某一组 */
  exact: ComboMatch[];
  /** 无严格匹配时的行情参考：与目标共享 ≥2 个正词条（UI 标「相似」） */
  similar: ComboMatch[];
}

const comboKey = (c: MarketCombo) => `${c.pos.join("+")}|${c.neg.join("-")}`;

/** 按管线热度序取匹配；组合聚类可能非常多，`n` 条够商人做判断了 */
export function matchCombos(cls: RivenClass, t: TargetDraft, w: MarketWeapon, n = 5): MarketMatch {
  const out: MarketMatch = { exact: [], similar: [] };
  const sets = usableSets(t);
  if (!sets.length || !w.combos?.length) return out;
  const seen = new Set<string>();
  for (const c of w.combos) {
    if (out.exact.length >= n) break;
    const tags = comboTags(cls, c);
    if (!tags || seen.has(comboKey(c))) continue;
    if (sets.some((set) => comboMatchesSet(t, set, tags))) {
      seen.add(comboKey(c));
      out.exact.push({ combo: c, tags });
    }
  }
  if (out.exact.length) return out;
  for (const c of w.combos) {
    if (out.similar.length >= n) break;
    const tags = comboTags(cls, c);
    if (!tags || seen.has(comboKey(c))) continue;
    const shared = sets.some((set) => {
      const wanted = new Set(set.flatMap((g) => g.tags));
      return tags.pos.filter((tag) => wanted.has(tag)).length >= 2;
    });
    if (shared) {
      seen.add(comboKey(c));
      out.similar.push({ combo: c, tags });
    }
  }
  return out;
}

/** 时薪模型：赤毒/小时 与 白金/小时，相除即「每点赤毒的白金机会成本」 */
export interface Wage {
  kuvaPerHour: number;
  platPerHour: number;
}

/** 时薪设置（V3a/V3b 共享）：主页 panel 输入，行情页利润列同源读取 */
export const WAGE_KEY = "riven-roll:wage:v1";
export const DEFAULT_WAGE: Wage = { kuvaPerHour: 10_000, platPerHour: 30 };

export function loadWage(): Wage {
  try {
    const raw = localStorage.getItem(WAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Wage>;
      const k = v.kuvaPerHour;
      const p = v.platPerHour;
      if (typeof k === "number" && Number.isFinite(k) && k > 0 && typeof p === "number" && Number.isFinite(p) && p >= 0) return { kuvaPerHour: k, platPerHour: p };
    }
  } catch {
    // storage blocked: the default wage still makes the numbers work
  }
  return DEFAULT_WAGE;
}

/** 赤毒成本折白金 */
export function costPlat(kuva: number, wage: Wage): number {
  return wage.kuvaPerHour > 0 ? (kuva / wage.kuvaPerHour) * wage.platPerHour : Number.POSITIVE_INFINITY;
}

/** 赤毒成本的等效刷取小时 */
export function hoursOf(kuva: number, wage: Wage): number {
  return wage.kuvaPerHour > 0 ? kuva / wage.kuvaPerHour : Number.POSITIVE_INFINITY;
}

/**
 * 「从行情填入」（spec §9.3）：市场组合 → 目标。
 * 每个正词条一行（组内单词条 = 全部都要）、tier any（洗出该组合即可卖，价位≈组合中位）、
 * 布局精确到该组合的 2/3 正 + 负/无负。词条映射不进该类别时返回 null（按钮不显示）。
 */
export function targetFromCombo(cls: RivenClass, t: TargetDraft, c: MarketCombo): TargetDraft | null {
  const tags = comboTags(cls, c);
  if (!tags) return null;
  const neg = tags.neg[0] ?? null;
  return {
    ...t,
    sets: [tags.pos.map((tag) => ({ tags: [tag], tier: "any" as const }))],
    atLeast: { on: false, k: t.atLeast.k, tier: t.atLeast.tier },
    wantNeg: neg != null,
    allowedNeg: neg ? [neg] : [],
    layouts: [`${tags.pos.length}${neg ? 1 : 0}`],
    layoutsAuto: false,
  };
}
