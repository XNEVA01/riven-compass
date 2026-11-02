/**
 * V1 build suggester: archetype presets + greedy + hill-climb swap.
 *
 * Candidate units are either a single mod or a pre-paired element couple
 * (e.g. Stormbringer + Infected Clip -> corrosive), because greedy alone is
 * short-sighted about DE slot-order element pairing: the second element of a
 * couple carries the pairing payoff, so couples must compete as one unit.
 *
 * Scoring: 1 / timeToKill when an enemy context is present (adversarial
 * mode), otherwise sustainedDps. Hill climbing keeps the result monotone
 * better than the greedy seed.
 */

import type { StatKey } from "./data";
import { COMPOUND } from "./data";
import type { BuildResult, EnemyContext, ModCard, RivenContribution, WeaponPanel } from "./engine";
import { computeBuild } from "./engine";

export type PresetId = "auto" | "corrosive" | "viral" | "radiation" | "gas" | "magnetic" | "blast";

/** archetype presets: which compound element pairs may enter the candidate set */
export const PRESETS: Record<PresetId, { zh: string; compounds: string[] | null }> = {
  auto: { zh: "自动", compounds: null },
  corrosive: { zh: "腐蚀", compounds: ["corrosive"] },
  viral: { zh: "病毒", compounds: ["viral"] },
  radiation: { zh: "辐射", compounds: ["radiation"] },
  gas: { zh: "毒气", compounds: ["gas"] },
  magnetic: { zh: "磁力", compounds: ["magnetic"] },
  blast: { zh: "爆炸", compounds: ["blast"] },
};

export interface BuildRequest {
  weapon: WeaponPanel;
  /** compat-filtered mod pool (from combat.json) */
  pool: ModCard[];
  /** total mod slots incl. riven slot, default 8 */
  slots?: number;
  riven?: RivenContribution | null;
  enemy?: EnemyContext | null;
  preset?: PresetId;
  /** mod ids to exclude from the pool */
  ban?: string[];
  /** hill-climb budget, default 60 */
  maxSwaps?: number;
}

export interface SuggestStep {
  added: string[];
  gain: number;
  score: number;
}

export interface MarginalRow {
  mod: ModCard;
  /** score lost if this mod is removed (bigger = more valuable) */
  loss: number;
  pct: number;
}

export interface BuildSuggestion {
  mods: ModCard[];
  score: number;
  result: BuildResult;
  steps: SuggestStep[];
  /** 紫卡所在的合成槽位（1 起，按 Wiki 槽位层级；无紫卡 = 1） */
  rivenSlot?: number;
}

const BASE_ELE_KEYS: ReadonlyArray<StatKey> = ["heat", "cold", "elec", "tox"];

/** scoring: adversarial ttk when an enemy is set, else sustained dps */
export function scoreResult(r: BuildResult): number {
  return r.vsEnemy ? 1 / Math.max(r.vsEnemy.timeToKill, 1e-6) : r.sustainedDps;
}

interface Unit {
  mods: ModCard[];
}

function elementKeysOf(mod: ModCard): StatKey[] {
  const out: StatKey[] = [];
  for (const [k, v] of Object.entries(mod.stats) as Array<[StatKey, number]>) {
    if ((v ?? 0) > 0 && BASE_ELE_KEYS.includes(k)) out.push(k);
  }
  return out;
}

/** faction damage keys this mod carries (e.g. facGrineer) */
function factionKeysOf(mod: ModCard): StatKey[] {
  return (Object.keys(mod.stats) as StatKey[]).filter((k) => k.startsWith("fac"));
}

/** two mods of one faction (regular + Primed Bane) cannot be equipped together */
function clashFaction(a: ModCard, b: ModCard): boolean {
  const ka = factionKeysOf(a);
  return ka.length > 0 && factionKeysOf(b).some((k) => ka.includes(k));
}

/** a mod whose stats are all base elements of one kind -> pairs into compounds */
function isPureElement(mod: ModCard): boolean {
  const keys = Object.keys(mod.stats) as StatKey[];
  if (keys.length === 0) return false;
  const eles = elementKeysOf(mod);
  return eles.length === 1 && eles.length === keys.length;
}

export function makeUnits(pool: ModCard[], preset: PresetId, riven?: RivenContribution | null): Unit[] {
  const buckets: Record<string, ModCard[]> = { heat: [], cold: [], elec: [], tox: [] };
  const singles: ModCard[] = [];
  for (const m of pool) {
    if (isPureElement(m)) {
      buckets[elementKeysOf(m)[0]].push(m);
    } else {
      singles.push(m);
    }
  }
  const units: Unit[] = singles.map((m) => ({ mods: [m] }));
  const { compounds } = PRESETS[preset];
  const list = compounds ?? (Object.keys(COMPOUND) as string[]);
  // COMPOUND values use pair-element names (electricity/toxin), buckets use
  // semantic stat keys (elec/tox) — translate
  const pair2key: Record<string, string> = {
    heat: "heat",
    cold: "cold",
    electricity: "elec",
    toxin: "tox",
  };
  for (const c of list) {
    const [a, b] = COMPOUND[c];
    const bucketA = buckets[pair2key[a] ?? a] ?? [];
    const bucketB = buckets[pair2key[b] ?? b] ?? [];
    for (const ma of bucketA) {
      for (const mb of bucketB) {
        units.push({ mods: [ma, mb] });
      }
    }
  }
  // riven base elements can be completed by a single opposite-side card
  // (the riven itself does not consume a slot)
  if (riven) {
    const rivenEles = new Set<string>();
    for (const [k, v] of Object.entries(riven.stats) as Array<[StatKey, number]>) {
      if ((v ?? 0) > 0 && BASE_ELE_KEYS.includes(k)) rivenEles.add(k);
    }
    for (const c of list) {
      const [a, b] = COMPOUND[c];
      const ka = pair2key[a] ?? a;
      const kb = pair2key[b] ?? b;
      for (const e of rivenEles) {
        const other = e === ka ? kb : e === kb ? ka : null;
        if (other) {
          for (const m of buckets[other]) units.push({ mods: [m] });
        }
      }
    }
  }
  // auto also allows lone element cards (odd builds / triple-element edge cases)
  if (compounds === null) {
    for (const k of BASE_ELE_KEYS) {
      for (const m of buckets[k]) units.push({ mods: [m] });
    }
  }
  return units;
}

/** compound recipe base element ("electricity") -> semantic stat key ("elec") */
const PAIR_TO_KEY: Record<string, StatKey> = { heat: "heat", cold: "cold", electricity: "elec", toxin: "tox" };

/** base-element keys physically present in the chosen mods plus the riven */
function elementKeysIn(mods: ModCard[], riven?: RivenContribution | null): Set<StatKey> {
  const out = new Set<StatKey>();
  const add = (stats: Partial<Record<StatKey, number>>) => {
    for (const [k, v] of Object.entries(stats) as Array<[StatKey, number]>) {
      if ((v ?? 0) > 0 && BASE_ELE_KEYS.includes(k)) out.add(k);
    }
  };
  for (const m of mods) add(m.stats);
  if (riven) add(riven.stats);
  return out;
}

/**
 * Does the build actually roll the preset compound? With `keys`, the compound's two base elements must also be
 * physically on the build (mods or riven) — that rejects a compound that only survives as an innate/standalone value.
 */
function carries(r: BuildResult, compound: string, keys: Set<StatKey> | null): boolean {
  if (((r.dmg as Record<string, number | undefined>)[compound] ?? 0) <= 0) return false;
  if (!keys) return true;
  const pair = COMPOUND[compound];
  return pair != null && keys.has(PAIR_TO_KEY[pair[0]]) && keys.has(PAIR_TO_KEY[pair[1]]);
}

export function suggestBuild(req: BuildRequest): BuildSuggestion {
  const slots = req.slots ?? 8;
  const ban = new Set(req.ban ?? []);
  const pool = req.pool.filter((m) => !ban.has(m.id));
  const preset = req.preset ?? "auto";
  const riven = req.riven ?? null;
  const units = makeUnits(pool, preset, riven);
  const want = PRESETS[preset].compounds?.[0] ?? null;

  const fits = (chosen: ModCard[], u: Unit): boolean =>
    chosen.length + u.mods.length <= slots &&
    !u.mods.some((m) => chosen.some((c) => c.id === m.id)) &&
    // 同名普通/Prime 阵营卡不可同装（游戏里 Primed 与其普通版不能叠加）
    !u.mods.some((m) => chosen.some((c) => clashFaction(c, m)));

  type Found = { mods: ModCard[]; score: number };

  // greedy fill from a starting build; `judge` returns -Infinity for builds that break the preset constraint
  const greedy = (from: ModCard[], candidates: Unit[], judge: (mods: ModCard[]) => number, steps?: SuggestStep[]): Found => {
    let chosen = [...from];
    let cur = judge(chosen);
    for (;;) {
      if (chosen.length >= slots) break;
      let best: Unit | null = null;
      let bestScore = cur;
      for (const u of candidates) {
        if (!fits(chosen, u)) continue;
        const s = judge([...chosen, ...u.mods]);
        if (s > bestScore * (1 + 1e-9) + 1e-9) {
          best = u;
          bestScore = s;
        }
      }
      if (!best) break;
      if (steps) steps.push({ added: best.mods.map((m) => m.zh), gain: bestScore - cur, score: bestScore });
      chosen = [...chosen, ...best.mods];
      cur = bestScore;
    }
    return { mods: chosen, score: cur };
  };

  // remove one mod, try to fit a better unit in its place
  const climb = (start: Found, candidates: Unit[], judge: (mods: ModCard[]) => number): Found => {
    let { mods: chosen, score: cur } = start;
    let guard = req.maxSwaps ?? 60;
    let improved = true;
    while (improved && guard > 0) {
      improved = false;
      for (let i = 0; i < chosen.length; i++) {
        const without = chosen.filter((_, j) => j !== i);
        for (const u of candidates) {
          if (!fits(without, u)) continue;
          const s = judge([...without, ...u.mods]);
          if (s > cur * (1 + 1e-9) + 1e-9) {
            chosen = [...without, ...u.mods];
            cur = s;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      guard--;
    }
    return { mods: chosen, score: cur };
  };

  // multi-seed greedy (a seed is a unit that already satisfies the constraint), then climb the winner
  const searchAll = (candidates: Unit[], judge: (mods: ModCard[]) => number): Found | null => {
    const seeds: Found[] = [];
    for (const u of candidates) {
      const s = judge(u.mods);
      if (Number.isFinite(s)) seeds.push({ mods: [...u.mods], score: s });
    }
    if (!seeds.length) return null;
    seeds.sort((a, b) => b.score - a.score);
    let best: Found | null = null;
    for (const seed of seeds.slice(0, 12)) {
      const found = greedy(seed.mods, candidates, judge);
      if (!best || found.score > best.score) best = found;
    }
    return best ? climb(best, candidates, judge) : null;
  };

  // 一个紫卡槽位下的完整求解；satisfies = 是否满足流派硬约束
  const solve = (pos: number): BuildSuggestion & { satisfies: boolean } => {
    const score = (mods: ModCard[]): number => scoreResult(computeBuild(req.weapon, mods, riven, req.enemy ?? null, undefined, pos));

    // 1) the ordinary search first (auto presets stop here)
    const steps: SuggestStep[] = [];
    const base = climb(greedy([], units, score, steps), units, score);
    let best = base;
    const baseResult = computeBuild(req.weapon, base.mods, riven, req.enemy ?? null, undefined, pos);
    let satisfies = !want || carries(baseResult, want, null);

    // 2) hard preset constraint: a non-auto preset must actually roll its compound
    if (want && !satisfies) {
      const judge =
        (pairRequired: boolean) =>
        (mods: ModCard[]): number => {
          const r = computeBuild(req.weapon, mods, riven, req.enemy ?? null, undefined, pos);
          const keys = pairRequired ? elementKeysIn(mods, riven) : null;
          return carries(r, want, keys) ? scoreResult(r) : Number.NEGATIVE_INFINITY;
        };
      const pair = COMPOUND[want];
      const pairKeys = pair ? new Set<StatKey>([PAIR_TO_KEY[pair[0]], PAIR_TO_KEY[pair[1]]]) : null;
      // phase 1: only the preset's own two base elements may enter as pure element cards, and both must really be
      // on the build; phase 2 falls back to any card that yields the compound (standalone compound stats)
      const pairUnits = pairKeys ? units.filter((u) => u.mods.every((m) => !isPureElement(m) || pairKeys.has(elementKeysOf(m)[0]))) : units;
      const found = searchAll(pairUnits, judge(pairKeys != null)) ?? searchAll(units, judge(false));
      // nothing can reach the preset -> keep the original best instead of failing
      if (found) {
        best = found;
        satisfies = true;
      }
    }

    const result = best === base ? baseResult : computeBuild(req.weapon, best.mods, riven, req.enemy ?? null, undefined, pos);
    return { mods: best.mods, score: best.score, result, steps, rivenSlot: pos, satisfies };
  };

  if (!riven) return solve(1);
  // Wiki 槽位层级（Modding）：紫卡也是 MOD，按所在槽位参与合成，可占任意槽位。
  // 逐槽位求解取最优；满足流派硬约束的解优先于未满足的解，平分时保持更靠前的槽位。
  let pick: (BuildSuggestion & { satisfies: boolean }) | undefined;
  for (let pos = 1; pos <= slots + 1; pos++) {
    const cand = solve(pos);
    if (!pick || (cand.satisfies && !pick.satisfies) || (cand.satisfies === pick.satisfies && cand.score > pick.score * (1 + 1e-9) + 1e-9)) {
      pick = cand;
    }
  }
  return pick ?? solve(1);
}

/** per-mod marginal value of a finished build (for the UI table) */
export function marginalTable(weapon: WeaponPanel, mods: ModCard[], riven?: RivenContribution | null, enemy?: EnemyContext | null, rivenSlot = 1): MarginalRow[] {
  const score = (ms: ModCard[], pos: number): number => scoreResult(computeBuild(weapon, ms, riven ?? null, enemy ?? null, undefined, pos));
  const full = score(mods, rivenSlot);
  return mods.map((m, i) => {
    // 移除的是紫卡之前的卡时，紫卡的合成位次随之上移一格
    const pos = i < rivenSlot - 1 ? rivenSlot - 1 : rivenSlot;
    const loss =
      full -
      score(
        mods.filter((_, j) => j !== i),
        pos,
      );
    return { mod: m, loss, pct: full > 0 ? loss / full : 0 };
  });
}
