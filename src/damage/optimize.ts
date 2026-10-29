/**
 * V2 riven optimization: the god-roll solver, the three-tier comparison
 * (no riven / yours / god) and per-stat marginals.
 *
 * The god riven is scored with the same metric the build suggester uses
 * (adversarial 1/TTK, else sustained DPS):
 *   1. rank positive stats greedily on the fixed current build — the order is
 *      layout-invariant, because every layout scales all positives uniformly
 *   2. compare the four real layouts (2/3 positives x curse / no curse) at
 *      true max-roll values — rawValue at W = 1.1 with the game's own
 *      attenuation tables and the current disposition — choosing the least
 *      harmful negative: an unmodelled curse (zoom & co) costs nothing
 *   3. re-run suggestBuild so the mod set adapts to the solved riven
 */

import { GAME, type RivenClass, type StatDef, statsOf, type Weapon } from "../engine/data";
import { displayNumber, type Layout, rawValue, W_MAX } from "../engine/formula";
import { poolFor } from "../engine/pool";
import { type BuildSuggestion, type PresetId, scoreResult, suggestBuild } from "./build";
import { RIVEN_TAG_TO_KEY, type StatKey } from "./data";
import type { BuildResult, EnemyContext, ModCard, RivenContribution, WeaponPanel } from "./engine";
import { computeBuild } from "./engine";

/** one stat of a solved riven at a max roll */
export interface RivenStat {
  /** the game's stat tag (StatDef) */
  tag: string;
  /** engine key; null when the damage engine does not model the stat (zoom & co) */
  key: StatKey | null;
  /** the number the game shows for this roll */
  shown: number;
  /** engine contribution, signed (negative for curses) */
  value: number;
}

export interface GodRiven {
  stats: RivenStat[];
  neg: RivenStat | null;
  /** the assembled contribution for computeBuild; never null from the solver */
  riven: RivenContribution | null;
}

export interface TierRow {
  score: number;
  result: BuildResult;
  mods: ModCard[];
  riven: RivenContribution | null;
}

/** per-stat marginal: loss = score with the stat − score without it (negative = the stat hurts) */
export interface StatMarginal {
  stat: StatKey;
  loss: number;
  pct: number;
}

export interface ThreeTier {
  /** the no-riven baseline, 8 mod slots */
  none: TierRow;
  /** the page's current build; null without a recorded riven */
  yours: TierRow | null;
  /** the god-roll build, 7 slots + the solved riven; null when unsolvable */
  god: TierRow | null;
  godRiven: GodRiven | null;
}

const RANK = GAME.layout.maxRank;

/** one stat's engine contribution + shown number at a roll in a given layout */
function rollStat(def: StatDef, curse: boolean, posCount: 2 | 3, withNeg: boolean, w = W_MAX): RivenStat | null {
  const layout: Layout = { pos: posCount, neg: curse || withNeg ? 1 : 0 };
  const raw = rawValue(def, layout, curse, w, RANK);
  if (!Number.isFinite(raw)) return null;
  const key = RIVEN_TAG_TO_KEY[def.tag] ?? null;
  const shown = displayNumber(def, raw);
  if (!Number.isFinite(shown)) return null;
  const value = key ? (key.startsWith("fac") ? shown - 1 : shown / 100) : 0;
  return { tag: def.tag, key, shown, value };
}

function rivenOf(parts: Array<RivenStat | null>): RivenContribution | null {
  const stats: Partial<Record<StatKey, number>> = {};
  for (const p of parts) {
    if (!p || !p.key || !p.value) continue;
    stats[p.key] = (stats[p.key] ?? 0) + p.value;
  }
  return Object.keys(stats).length ? { stats } : null;
}

/**
 * The best riven this weapon can roll, evaluated on a fixed mod build.
 * Values are true max rolls (W = 1.1) with the game's attenuation tables.
 */
export function solveGodRiven(weapon: WeaponPanel, rivenWeapon: Weapon, fixedMods: ModCard[], enemy: EnemyContext | null): GodRiven | null {
  const pool = poolFor(rivenWeapon);
  const byTag = new Map(statsOf(rivenWeapon.cls).map((d) => [d.tag, d]));
  const posDefs = pool.pos.map((t) => byTag.get(t)).filter((d): d is StatDef => !!d && RIVEN_TAG_TO_KEY[d.tag] != null);
  if (posDefs.length < 2) return null;
  const negDefs = pool.neg.map((t) => byTag.get(t)).filter((d): d is StatDef => !!d);

  const score = (parts: Array<RivenStat | null>): number => scoreResult(computeBuild(weapon, fixedMods, rivenOf(parts), enemy));

  // 1) rank positives greedily at 3+1 magnitudes (the order holds for every
  //    layout: each layout scales all positives by the same factor). A riven
  //    carries at least two positives, so the first two are taken unconditionally.
  const ranked: RivenStat[] = [];
  const rest = [...posDefs];
  while (ranked.length < 3 && rest.length) {
    let best: RivenStat | null = null;
    let bestDef: StatDef | null = null;
    let bestScore = -Infinity;
    for (const def of rest) {
      const stat = rollStat(def, false, 3, true);
      if (!stat) continue;
      const s = score([...ranked, stat]);
      if (s > bestScore) {
        best = stat;
        bestDef = def;
        bestScore = s;
      }
    }
    if (!best || !bestDef) break;
    // the third positive only when it actually helps
    if (ranked.length >= 2 && bestScore <= score(ranked) * (1 + 1e-9) + 1e-9) break;
    ranked.push(best);
    rest.splice(rest.indexOf(bestDef), 1);
  }

  // 2) compare the four real layouts with their true max-roll values
  let bestRiven: GodRiven | null = null;
  let bestScore = -Infinity;
  for (const posCount of [3, 2] as const) {
    if (ranked.length < posCount) continue;
    for (const withNeg of [true, false]) {
      const stats: RivenStat[] = [];
      for (const r of ranked.slice(0, posCount)) {
        const def = byTag.get(r.tag);
        if (!def) continue;
        const stat = rollStat(def, false, posCount, withNeg);
        if (stat) stats.push(stat);
      }
      if (stats.length < posCount) continue;
      let neg: RivenStat | null = null;
      if (withNeg) {
        let negScore = -Infinity;
        for (const def of negDefs) {
          const stat = rollStat(def, true, posCount, true);
          if (!stat) continue;
          const s = score([...stats, stat]);
          if (s > negScore * (1 + 1e-9) + 1e-9) {
            negScore = s;
            neg = stat;
          }
        }
        if (!neg) continue;
      }
      const s = score([...stats, neg]);
      if (s > bestScore * (1 + 1e-9) + 1e-9) {
        bestScore = s;
        bestRiven = { stats, neg, riven: rivenOf([...stats, neg]) };
      }
    }
  }
  return bestRiven;
}

// ---------- the wanted riven: the card the player is cycling toward ----------

/** one wanted row of the coach target, already normalized: a roll bar per tier, or a typed game-shown value */
export interface WantedRow {
  /** alternative stats: any one of them satisfies the row */
  tags: string[];
  /** the roll bar the tier stands for (hi ≈ 1.07, mid ≈ 1.00, any = 0.90) */
  w: number;
  /** with a typed value: the number as the game shows it ("+110%" -> 110, "x1.5" -> 1.5); its size is what counts */
  shown?: number;
}

export interface WantedSpec {
  /** alternative target sets; the riven is done when any one is met */
  sets: WantedRow[][];
  wantNeg: boolean;
  allowedNeg: string[];
}

/** the curse magnitude a wanted riven averages: the goal never aims at a curse, so the middle roll */
const EXPECTED_CURSE_W = 1;

/** a wanted stat def at its row's roll (or typed value), in a layout */
function wantedStat(def: StatDef, row: WantedRow, layout: Layout): RivenStat | null {
  const shown = row.shown != null ? row.shown : displayNumber(def, rawValue(def, layout, false, row.w, RANK));
  if (!Number.isFinite(shown)) return null;
  const key = RIVEN_TAG_TO_KEY[def.tag] ?? null;
  const value = key ? (key.startsWith("fac") ? shown - 1 : shown / 100) : 0;
  return { tag: def.tag, key, shown, value };
}

/**
 * The wanted riven one target set describes, scored on the fixed current build:
 * the best stat per row at the row's tier, at most three positives (a riven
 * holds no more), and — when the target accepts a curse — the least harmful
 * accepted one at the average roll.
 */
function expectedOfSet(cls: RivenClass, rows: WantedRow[], spec: WantedSpec, weapon: WeaponPanel, fixedMods: ModCard[], enemy: EnemyContext | null): GodRiven | null {
  const byTag = new Map(statsOf(cls).map((d) => [d.tag, d]));
  const score = (parts: Array<RivenStat | null>): number => scoreResult(computeBuild(weapon, fixedMods, rivenOf(parts), enemy));

  // 1) the best stat per row, ranked at 3+1 magnitudes (the order is layout-invariant)
  const ranked: Array<{ stat: RivenStat; row: WantedRow }> = [];
  const used = new Set<string>();
  for (const row of rows) {
    let best: { stat: RivenStat; row: WantedRow } | null = null;
    let bestScore = -Infinity;
    for (const tag of row.tags) {
      if (used.has(tag)) continue;
      const def = byTag.get(tag);
      if (!def) continue;
      const stat = wantedStat(def, row, { pos: 3, neg: 1 });
      if (!stat) continue;
      const s = score([...ranked.map((r) => r.stat), stat]);
      if (s > bestScore * (1 + 1e-9) + 1e-9) {
        bestScore = s;
        best = { stat, row };
      }
    }
    if (best) {
      ranked.push(best);
      used.add(best.stat.tag);
    }
  }
  if (!ranked.length) return null;

  // 2) keep at most three positives: the best rows by gain, at least the first two
  const picked: Array<{ stat: RivenStat; row: WantedRow }> = [];
  let cur = score(picked.map((r) => r.stat));
  while (picked.length < Math.min(3, ranked.length)) {
    let next: { stat: RivenStat; row: WantedRow } | null = null;
    let nextScore = cur;
    for (const r of ranked) {
      if (picked.some((p) => p.stat.tag === r.stat.tag)) continue;
      const s = score([...picked.map((p) => p.stat), r.stat]);
      if (s > nextScore * (1 + 1e-9) + 1e-9) {
        nextScore = s;
        next = r;
      }
    }
    // a riven carries at least two positives: keep the best of the rest even at no gain
    if (!next && picked.length < Math.min(2, ranked.length)) {
      next = ranked.find((r) => !picked.some((p) => p.stat.tag === r.stat.tag)) ?? null;
      if (next) nextScore = score([...picked.map((p) => p.stat), next.stat]);
    }
    if (!next) break;
    picked.push(next);
    cur = nextScore;
  }

  // 3) the curse is not part of the goal: the least harmful accepted one at the average roll
  const curseTags = spec.wantNeg
    ? spec.allowedNeg.length
      ? spec.allowedNeg
      : statsOf(cls)
          .filter((d) => d.curse)
          .map((d) => d.tag)
    : [];
  const negDefs = curseTags.map((tag) => byTag.get(tag)).filter((d): d is StatDef => !!d && !!d.curse);
  const posCount = (picked.length >= 3 ? 3 : 2) as 2 | 3;
  const layout: Layout = { pos: posCount, neg: negDefs.length ? 1 : 0 };

  // 4) re-roll the kept stats at the real layout's magnitudes (a typed value stays as typed)
  const stats: RivenStat[] = [];
  for (const p of picked) {
    const def = byTag.get(p.stat.tag);
    if (!def) continue;
    stats.push(wantedStat(def, p.row, layout) ?? p.stat);
  }

  let neg: RivenStat | null = null;
  if (negDefs.length) {
    let negScore = -Infinity;
    for (const def of negDefs) {
      const stat = rollStat(def, true, posCount, true, EXPECTED_CURSE_W);
      if (!stat) continue;
      const s = score([...stats, stat]);
      if (s > negScore * (1 + 1e-9) + 1e-9) {
        negScore = s;
        neg = stat;
      }
    }
  }
  return { stats, neg, riven: rivenOf([...stats, neg]) };
}

/**
 * The wanted riven: the card the player is cycling toward, read from the coach
 * target. Each usable set is assembled and scored on the current build; the
 * best set wins. Null when no set is filled in enough.
 */
export function expectedRiven(cls: RivenClass, spec: WantedSpec, weapon: WeaponPanel, fixedMods: ModCard[], enemy: EnemyContext | null): GodRiven | null {
  let best: GodRiven | null = null;
  let bestScore = -Infinity;
  for (const rows of spec.sets) {
    if (!rows.length) continue;
    const cand = expectedOfSet(cls, rows, spec, weapon, fixedMods, enemy);
    if (!cand?.riven) continue;
    const s = scoreResult(computeBuild(weapon, fixedMods, cand.riven, enemy));
    if (s > bestScore * (1 + 1e-9) + 1e-9) {
      bestScore = s;
      best = cand;
    }
  }
  return best;
}

const rowOf = (s: BuildSuggestion, riven: RivenContribution | null): TierRow => ({
  score: s.score,
  result: s.result,
  mods: s.mods,
  riven,
});

/** The three tiers for the Build page: no riven / the recorded riven / the solved god roll. */
export function threeTier(req: {
  weapon: WeaponPanel;
  /** game-data weapon (riven pools); omit when the weapon is not riven-capable */
  rivenWeapon?: Weapon | null;
  pool: ModCard[];
  preset?: PresetId;
  enemy?: EnemyContext | null;
  /** the recorded riven's contribution, null when none */
  riven: RivenContribution | null;
  /** the page's suggestion computed with that riven */
  current: BuildSuggestion;
}): ThreeTier {
  const { weapon, pool, preset, enemy, riven, current } = req;
  const none: TierRow = riven ? rowOf(suggestBuild({ weapon, pool, slots: 8, riven: null, preset, enemy }), null) : rowOf(current, null);
  const yours: TierRow | null = riven ? rowOf(current, riven) : null;

  let god: TierRow | null = null;
  let godRiven: GodRiven | null = null;
  if (req.rivenWeapon) {
    const solved = solveGodRiven(weapon, req.rivenWeapon, current.mods, enemy ?? null);
    if (solved?.riven) {
      godRiven = solved;
      god = rowOf(suggestBuild({ weapon, pool, slots: 7, riven: solved.riven, preset, enemy }), solved.riven);
    }
  }
  return { none, yours, god, godRiven };
}

/** per-stat marginals of a riven on a fixed mod build (loss < 0 = the stat hurts) */
export function statMarginals(weapon: WeaponPanel, mods: ModCard[], riven: RivenContribution, enemy?: EnemyContext | null): StatMarginal[] {
  const full = scoreResult(computeBuild(weapon, mods, riven, enemy ?? null));
  return (Object.entries(riven.stats) as Array<[StatKey, number]>)
    .filter(([, v]) => v)
    .map(([stat]) => {
      const rest = { ...riven.stats };
      delete rest[stat];
      const loss = full - scoreResult(computeBuild(weapon, mods, { stats: rest }, enemy ?? null));
      return { stat, loss, pct: full > 0 ? loss / full : 0 };
    });
}
