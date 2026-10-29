/**
 * 组合成本求解的纯构造层（V3b 生成，跨武器利润榜提升为共享核心，spec §9.4）：
 * 行情组合 → 「从零洗到这个组合」的求解请求。浏览器 worker（comboCost.ts）与
 * 服务器管线 CLI（pipeline/solve.ts）共用这一份构造，保证两边给出同一个数。
 */
import { type RivenClass, statsOf } from "../engine/data";
import { currentDisposition, DEFAULT_DISPOSITION, LAYOUTS, setDisposition } from "../engine/formula";
import type { PlanRequest, RouteStats } from "../engine/planner";
import type { Card } from "../engine/solver";
import { defaultTarget, toEngineTarget } from "../state";
import { comboTags, targetFromCombo } from "./profit";
import type { MarketCombo } from "./wm";

/** 每条路线模拟的次数：均值是解析解，这只喂分位数（V3b 展示层只用均值） */
export const RUNS = 64;

/** 一个组合的成本身份：武器 + 正词条集 + 负词条集 */
export const costKey = (weaponId: string, c: MarketCombo) => `${weaponId}|${c.pos.join("+")}|${c.neg.join("-")}`;

/**
 * 「从零洗」的起点卡：3 个与目标无关的普通 buff 词条（roleOfStat 查不到 → JUNK，起点词条不参与达标），
 * 3+0 布局、数值取下限。该类 buff 池被目标占满凑不够 3 个时为 null（实际池子不会）。
 */
export function junkStart(cls: RivenClass, avoid: Iterable<string>): Card | null {
  const skip = new Set(avoid);
  const pool = statsOf(cls).filter((d) => d.buff && !d.spliced && !skip.has(d.tag));
  if (pool.length < 3) return null;
  return {
    layout: LAYOUTS.find((l) => l.pos === 3 && l.neg === 0) ?? { pos: 3, neg: 0 },
    pos: pool.slice(0, 3).map((d) => ({ tag: d.tag, w: 0.9 })),
    neg: null,
    spliced: null,
  };
}

/** 最优路线的期望赤毒：objective=kuva 时第一条就是最省的，均值是解析精确值 */
export function bestRouteKuva(routes: RouteStats[]): number | null {
  const r = routes.find((x) => x.route.optimal) ?? routes[0];
  return r ? r.kuva.mean : null;
}

/**
 * 把行情组合装成一次求解请求。目标与主页「填入目标」同构（每正词条一行、any 档、布局精确到组合），
 * objective 用 kuva：商人问的是成本，不是环数。any 档的达标线与倾向无关，但 minW 仍读全局倾向，
 * 所以算完还原，主线程其余计算不受影响。
 * runs 只喂分位数：展示层与管线 CLI 用小值即可（均值是解析解，与其无关）。
 */
export function comboRequest(id: number, weaponId: string, cls: RivenClass, combo: MarketCombo, runs: number = RUNS): PlanRequest | null {
  const draft = targetFromCombo(cls, defaultTarget(), combo);
  const tags = comboTags(cls, combo);
  const card = draft && tags ? junkStart(cls, [...tags.pos, ...tags.neg]) : null;
  if (!draft || !tags || !card) return null;
  const own = currentDisposition();
  setDisposition(DEFAULT_DISPOSITION);
  const target = toEngineTarget(draft, cls);
  setDisposition(own);
  if (!target) return null;
  return { id, weaponId, card, target, objective: "kuva", cyclesDone: 0, budget: null, runs };
}
