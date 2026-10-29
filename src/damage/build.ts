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

export function suggestBuild(req: BuildRequest): BuildSuggestion {
  const slots = req.slots ?? 8;
  const ban = new Set(req.ban ?? []);
  const pool = req.pool.filter((m) => !ban.has(m.id));
  const preset = req.preset ?? "auto";
  const units = makeUnits(pool, preset, req.riven ?? null);

  const score = (mods: ModCard[]): number => scoreResult(computeBuild(req.weapon, mods, req.riven ?? null, req.enemy ?? null));

  const fits = (chosen: ModCard[], u: Unit): boolean => chosen.length + u.mods.length <= slots && !u.mods.some((m) => chosen.some((c) => c.id === m.id));

  // 1) greedy seed
  let chosen: ModCard[] = [];
  let cur = score(chosen);
  const steps: SuggestStep[] = [];
  for (;;) {
    if (chosen.length >= slots) break;
    let best: Unit | null = null;
    let bestScore = cur;
    for (const u of units) {
      if (!fits(chosen, u)) continue;
      const s = score([...chosen, ...u.mods]);
      if (s > bestScore * (1 + 1e-9) + 1e-9) {
        best = u;
        bestScore = s;
      }
    }
    if (!best) break;
    chosen = [...chosen, ...best.mods];
    steps.push({
      added: best.mods.map((m) => m.zh),
      gain: bestScore - cur,
      score: bestScore,
    });
    cur = bestScore;
  }

  // 2) hill climb: remove one mod, try to fit a better unit in its place
  let guard = req.maxSwaps ?? 60;
  let improved = true;
  while (improved && guard > 0) {
    improved = false;
    for (let i = 0; i < chosen.length; i++) {
      const without = chosen.filter((_, j) => j !== i);
      for (const u of units) {
        if (!fits(without, u)) continue;
        const s = score([...without, ...u.mods]);
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

  const result = computeBuild(req.weapon, chosen, req.riven ?? null, req.enemy ?? null);
  return { mods: chosen, score: cur, result, steps };
}

/** per-mod marginal value of a finished build (for the UI table) */
export function marginalTable(weapon: WeaponPanel, mods: ModCard[], riven?: RivenContribution | null, enemy?: EnemyContext | null): MarginalRow[] {
  const score = (ms: ModCard[]): number => scoreResult(computeBuild(weapon, ms, riven ?? null, enemy ?? null));
  const full = score(mods);
  return mods.map((m, i) => {
    const loss = full - score(mods.filter((_, j) => j !== i));
    return { mod: m, loss, pct: full > 0 ? loss / full : 0 };
  });
}
