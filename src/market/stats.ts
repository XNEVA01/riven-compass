/**
 * 行情查询与排序：选品榜（P0-3）的纯数据层。
 *
 * 排序模式：
 *  - liquidity  在架挂单数（市场供给/活跃度，默认）
 *  - price      中位价（值密度）
 *  - fresh      挂单更新新鲜度（freshness_days 升序 = 市场最活跃）
 *  - combos     组合聚类数量（有行情的词条组合多 = 市场成熟）
 *  - turnover   周转指数（V3d：DE 周成交 ÷ 在架数 = 每周在架供给被成交的比例）
 *  - profit     利润（V3d 跨武器利润榜：最优组合的中位价 − 时薪折算的自洗期望成本）
 *
 * 利润排序不再拍脑袋：管线已把 E[赤毒] 预算进组合行（cost_kuva，solve.cjs 与前端引擎
 * 同一条数学），这里只做武器级聚合（max over combos），worker 现算只是前端兜底。
 */

import { costPlat, DEFAULT_WAGE, type Wage } from "./profit";
import { matchesFamilyAlias } from "./variants";
import type { Market, MarketCombo, MarketWeapon } from "./wm";

export type MarketSort = "liquidity" | "price" | "fresh" | "combos" | "turnover" | "profit";

export interface RankOpts {
  cls?: string | null;
  sort?: MarketSort;
  search?: string;
  minActive?: number;
  limit?: number;
  /** 时薪（利润排序用）：不传用默认时薪 */
  wage?: Wage;
}

export interface RankRow {
  url: string;
  w: MarketWeapon;
}

export function rankWeapons(m: Market, opts: RankOpts = {}): RankRow[] {
  const { cls, sort = "liquidity", search, minActive = 0, limit, wage } = opts;
  const q = search?.trim().toLowerCase() ?? "";
  let rows: RankRow[] = Object.entries(m.weapons).map(([url, w]) => ({ url, w }));
  if (cls) rows = rows.filter((r) => r.w.cls === cls);
  if (minActive > 0) rows = rows.filter((r) => r.w.n_active >= minActive);
  if (q) {
    // 变体全名精确命中其家族基础行（如 "Bo Prime" → bo 行）；只吃全名，"prime" 这类泛词不泛滥
    rows = rows.filter((r) => r.url.includes(q) || Object.values(r.w.name).some((n) => n?.toLowerCase().includes(q)) || matchesFamilyAlias(m, r.w.name.en, q));
  }
  const key = (r: RankRow): number => {
    switch (sort) {
      case "price":
        return r.w.price?.median ?? -1;
      case "fresh":
        return r.w.freshness_days != null ? -r.w.freshness_days : Number.NEGATIVE_INFINITY;
      case "combos":
        return r.w.combos?.length ?? 0;
      case "turnover":
        return turnover(r.w) ?? -1;
      case "profit":
        return bestProfit(r.w, wage ?? DEFAULT_WAGE) ?? Number.NEGATIVE_INFINITY;
      default:
        return r.w.n_active;
    }
  };
  rows.sort((a, b) => key(b) - key(a));
  return limit ? rows.slice(0, limit) : rows;
}

/** 该武器最热的词条组合（管线已按 数量×中位价 排好序，这里只截取） */
export function hotCombos(w: MarketWeapon, n = 6): MarketCombo[] {
  return w.combos?.slice(0, n) ?? [];
}

/**
 * 展开详情的组合列表：热门前 6；行级利润的全局最优组合不在其中时补挂尾部。
 * 利润最优的高价组合往往挂单数少、进不了热门榜——不补挂的话行数字在展开里找不到出处。
 */
export function shownCombos(w: MarketWeapon, wage: Wage): MarketCombo[] {
  const hot = hotCombos(w, 6);
  const best = bestCombo(w, wage);
  if (!best) return hot;
  const k = (c: MarketCombo) => `${c.pos.join("+")}|${c.neg.join("-")}`;
  return hot.some((c) => k(c) === k(best.c)) ? hot : [...hot, best.c];
}

/**
 * 周转指数（V3d，spec §9.4）：DE 周成交笔数 ÷ WM 在架挂单数 ——
 * 每周在架供给被全渠道成交消耗的比例，直接回答「挂出去多快能出手」。
 * DE 成交含游戏内全渠道、WM 只是在架供给，两者不是同一市场面 →
 * 只作跨武器排序的相对指标，绝对值无意义；缺任一侧时 null（排序沉底）。
 */
export function turnover(w: MarketWeapon): number | null {
  const pop = w.de?.pop;
  if (!pop || !w.n_active) return null;
  return pop / w.n_active;
}

/**
 * 武器级利润最优的那个组合（V3d 跨武器利润榜），与 bestProfit 同一条数学：
 * 只读管线预算的 cost_kuva（null/缺席 = 映射不进类/未预算，跳过）；
 * 一个能算的组合都没有 → null（排序沉底，展开详情由 worker 兜底现算）。
 * 展开详情靠它把行级数字落到具体组合上（不在热门前 6 时补挂展示，见 shownCombos）。
 */
export function bestCombo(w: MarketWeapon, wage: Wage): { c: MarketCombo; profit: number } | null {
  let best: { c: MarketCombo; profit: number } | null = null;
  for (const c of w.combos ?? []) {
    if (c.cost_kuva == null) continue;
    const profit = c.median_price - costPlat(c.cost_kuva, wage);
    if (best == null || profit > best.profit) best = { c, profit };
  }
  return best;
}

/** 该武器的最优组合期望利润：max over combos(中位价 − 时薪折算的自洗成本)；全不可算 → null（排序沉底） */
export function bestProfit(w: MarketWeapon, wage: Wage): number | null {
  return bestCombo(w, wage)?.profit ?? null;
}

/** 行情数据年龄（小时），UI 据此显示「数据新鲜度」 */
export function marketAgeHours(m: Market): number {
  const t = Date.parse(m.meta.generated_at);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}
