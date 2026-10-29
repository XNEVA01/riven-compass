/**
 * profit.ts（V3a）测试：组合↔目标匹配、相似回退、时薪模型、从行情填入。
 * 合成用例锁规则语义；对真实 market.json 只做关系性断言（数据每日刷新）。
 */
import { describe, expect, it, vi } from "vitest";
import market from "../data/market.json";
import type { RivenClass } from "../engine/data";
import { defaultTarget, type GroupDraft, type TargetDraft } from "../state";
import { type ComboTags, comboMatchesSet, comboTags, costPlat, DEFAULT_WAGE, hoursOf, loadWage, matchCombos, targetFromCombo, type Wage } from "./profit";
import { rankWeapons } from "./stats";
import type { Market, MarketCombo, MarketWeapon } from "./wm";

const m = market as unknown as Market;

// ---- 合成数据的构造器 ----

const T = (sets: GroupDraft[][], extra: Partial<TargetDraft> = {}): TargetDraft => ({
  ...defaultTarget(),
  sets,
  allowedNeg: ["WeaponZoomFovMod"],
  ...extra,
});

const tags = (cls: RivenClass, c: MarketCombo): ComboTags => {
  const t = comboTags(cls, c);
  if (!t) throw new Error(`combo should map on ${cls}`);
  return t;
};

/** Rifle 目标：暴击+暴伤+多重（wantNeg=true 时第三组可以是 alternatives 形式） */
const crit3 = (...third: string[]): GroupDraft[][] => [
  [
    { tags: ["WeaponCritChanceMod"], tier: "any" },
    { tags: ["WeaponCritDamageMod"], tier: "any" },
    { tags: third.length ? third : ["WeaponFireIterationsMod"], tier: "any" },
  ],
];

const C = (pos: string[], neg: string[] = [], median = 100): MarketCombo => ({
  pos,
  neg,
  count: 10,
  median_price: median,
  min_price: median,
  max_price: median,
  re_rolls_mean: 5,
  age_days_median: 3,
});

const W = (combos: MarketCombo[]): MarketWeapon => ({
  name: { en: "Test", zh: "测试", tc: "測試", cn: "测试" },
  cls: "Rifle",
  n_total: combos.length * 10,
  n_active: combos.length * 10,
  n_stale: 0,
  n_private: 0,
  n_no_price: 0,
  n_hidden: 0,
  combos,
});

describe("comboTags", () => {
  it("maps gun stats per class", () => {
    expect(comboTags("Rifle", C(["critical_chance", "multishot"], ["zoom"]))).toEqual({
      pos: ["WeaponCritChanceMod", "WeaponFireIterationsMod"],
      neg: ["WeaponZoomFovMod"],
    });
  });

  it("rejects stats the class cannot roll (melee multishot, rifle range)", () => {
    expect(comboTags("Melee", C(["multishot"]))).toBeNull();
    expect(comboTags("Rifle", C(["range"]))).toBeNull();
  });
});

describe("comboMatchesSet", () => {
  it("accepts an exact 3+1 combo", () => {
    expect(comboMatchesSet(T(crit3()), crit3()[0], tags("Rifle", C(["critical_chance", "critical_damage", "multishot"], ["zoom"])))).toBe(true);
  });

  it("accepts an alternative stat within a group (viral or corrosive)", () => {
    const set = crit3("WeaponViralDamageMod", "WeaponCorrosiveDamageMod")[0];
    expect(comboMatchesSet(T([set], { wantNeg: false }), set, tags("Rifle", C(["critical_chance", "critical_damage", "viral"])))).toBe(true);
  });

  it("rejects a combo with an extra stat outside the target", () => {
    expect(comboMatchesSet(T(crit3()), crit3()[0], tags("Rifle", C(["critical_chance", "critical_damage", "toxin_damage"])))).toBe(false);
  });

  it("rejects a disallowed negative", () => {
    expect(comboMatchesSet(T(crit3()), crit3()[0], tags("Rifle", C(["critical_chance", "critical_damage", "multishot"], ["impact_damage"])))).toBe(false);
  });

  it("rejects a neg-less combo when the target only accepts layouts with a negative", () => {
    expect(comboMatchesSet(T(crit3()), crit3()[0], tags("Rifle", C(["critical_chance", "critical_damage", "multishot"])))).toBe(false);
  });

  it("rejects a combo that leaves a group unmet", () => {
    expect(comboMatchesSet(T(crit3()), crit3()[0], tags("Rifle", C(["critical_chance", "critical_damage"])))).toBe(false);
  });
});

describe("matchCombos", () => {
  it("collects exact matches in hot order and skips the rest", () => {
    const w = W([
      C(["critical_chance", "critical_damage", "multishot"], ["zoom"], 300),
      C(["critical_chance", "critical_damage", "multishot"], ["impact_damage"], 250),
      C(["critical_chance", "critical_damage", "fire_rate_/_attack_speed"], ["zoom"], 200),
    ]);
    const hit = matchCombos("Rifle", T(crit3(), { allowedNeg: ["WeaponZoomFovMod", "WeaponImpactDamageMod"] }), w);
    expect(hit.exact.map((x) => x.combo.neg[0])).toEqual(["zoom", "impact_damage"]);
    expect(hit.similar).toEqual([]);
  });

  it("falls back to similar combos (≥2 shared positives) when nothing matches exactly", () => {
    const w = W([
      C(["critical_chance", "critical_damage", "fire_rate_/_attack_speed"], ["zoom"], 200),
      C(["critical_chance", "toxin_damage", "fire_rate_/_attack_speed"], ["zoom"], 150),
      C(["toxin_damage", "impact_damage", "fire_rate_/_attack_speed"], ["zoom"], 100),
    ]);
    const hit = matchCombos("Rifle", T(crit3()), w);
    expect(hit.exact).toEqual([]);
    expect(hit.similar).toHaveLength(1);
    expect(hit.similar[0].combo.pos).toContain("critical_chance");
    expect(hit.similar[0].combo.pos).toContain("critical_damage");
  });

  it("end-to-end against the fixture: a target filled from the top combo matches itself", () => {
    const row = rankWeapons(m, { sort: "combos" }).find((r) => {
      const top = r.w.combos?.[0];
      return !!top && !!comboTags(r.w.cls as RivenClass, top);
    });
    if (!row?.w.combos) throw new Error("fixture has no weapon with a mappable top combo");
    const cls = row.w.cls as RivenClass;
    const top = row.w.combos[0];
    const target = targetFromCombo(cls, defaultTarget(), top);
    if (!target) throw new Error("targetFromCombo should map the top combo");
    const hit = matchCombos(cls, target, row.w);
    expect(hit.exact.length).toBeGreaterThan(0);
    expect(hit.exact[0].combo).toBe(top);
  });
});

describe("wage model", () => {
  const wage: Wage = { kuvaPerHour: 10_000, platPerHour: 30 };

  it("converts kuva cost into platinum and hours", () => {
    expect(costPlat(20_000, wage)).toBe(60);
    expect(hoursOf(20_000, wage)).toBe(2);
    expect(costPlat(1_500, wage)).toBeCloseTo(4.5, 6);
  });

  it("stays finite-proof against a zero rate", () => {
    expect(costPlat(1, { kuvaPerHour: 0, platPerHour: 30 })).toBe(Number.POSITIVE_INFINITY);
    expect(hoursOf(1, { kuvaPerHour: 0, platPerHour: 30 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("shares the saved rates between the panel and the market column", () => {
    // 无 storage（或坏值）都回落默认：node 测试环境本身就没有 localStorage
    expect(loadWage()).toEqual(DEFAULT_WAGE);
    vi.stubGlobal("localStorage", { getItem: () => "{not json" });
    expect(loadWage()).toEqual(DEFAULT_WAGE);
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ kuvaPerHour: -5, platPerHour: 30 }) });
    expect(loadWage()).toEqual(DEFAULT_WAGE);
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ kuvaPerHour: 5000, platPerHour: 25 }) });
    expect(loadWage()).toEqual({ kuvaPerHour: 5000, platPerHour: 25 });
    vi.unstubAllGlobals();
  });
});

describe("targetFromCombo", () => {
  it("fills one row per stat with tier any, neg rules and the exact layout", () => {
    const base = defaultTarget();
    base.tiers = { mid: 1.02, hi: 1.08 };
    const target = targetFromCombo("Rifle", base, C(["critical_chance", "critical_damage", "multishot"], ["zoom"]));
    expect(target?.sets).toEqual([
      [
        { tags: ["WeaponCritChanceMod"], tier: "any" },
        { tags: ["WeaponCritDamageMod"], tier: "any" },
        { tags: ["WeaponFireIterationsMod"], tier: "any" },
      ],
    ]);
    expect(target?.wantNeg).toBe(true);
    expect(target?.allowedNeg).toEqual(["WeaponZoomFovMod"]);
    expect(target?.layouts).toEqual(["31"]);
    expect(target?.layoutsAuto).toBe(false);
    expect(target?.tiers).toEqual({ mid: 1.02, hi: 1.08 });
  });

  it("handles a 2+0 combo and keeps atLeast off", () => {
    const base = defaultTarget();
    base.atLeast = { on: true, k: 2, tier: "hi" };
    const target = targetFromCombo("Rifle", base, C(["critical_chance", "critical_damage"]));
    expect(target?.wantNeg).toBe(false);
    expect(target?.allowedNeg).toEqual([]);
    expect(target?.layouts).toEqual(["20"]);
    expect(target?.atLeast.on).toBe(false);
  });

  it("returns null when a stat cannot roll on this class", () => {
    expect(targetFromCombo("Melee", defaultTarget(), C(["multishot"]))).toBeNull();
  });
});
