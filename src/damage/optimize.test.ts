/**
 * God-roll solver tests against real combat.json + game.json data.
 */
import { describe, expect, it } from "vitest";
import combat from "../data/combat.json";
import { weaponById } from "../engine/data";
import { poolFor } from "../engine/pool";
import { scoreResult, suggestBuild } from "./build";
import { ENEMIES } from "./data";
import type { EnemyContext, ModCard, RivenContribution, WeaponPanel } from "./engine";
import { computeBuild } from "./engine";
import { expectedRiven, solveGodRiven, statMarginals, threeTier, type WantedRow } from "./optimize";

const weapons = combat.weapons as unknown as WeaponPanel[];
const allMods = combat.mods as unknown as ModCard[];

const weapon = (en: string): WeaponPanel => {
  const w = weapons.find((x) => x.en === en);
  if (!w) throw new Error(`weapon not found: ${en}`);
  return w;
};
const riflePool = allMods.filter((m) => m.compat === "rifle");
const gunner = (level: number): EnemyContext => ({ spec: ENEMIES[0], level });

/** narrows for tsc: a null here fails the test loudly */
const must = <T>(x: T | null | undefined): T => {
  if (x == null) throw new Error("unexpected null");
  return x;
};

describe("solveGodRiven", () => {
  const w = weapon("Braton Prime");
  const rw = must(weaponById(w.id));
  const s = suggestBuild({ weapon: w, pool: riflePool, preset: "corrosive" });
  const god = () => must(solveGodRiven(w, rw, s.mods, null));

  it("returns a legal 2-3 positive riven from the weapon's own pool", () => {
    const g = god();
    const pool = poolFor(rw);
    for (const st of g.stats) {
      expect(pool.pos).toContain(st.tag);
      expect(st.value).toBeGreaterThan(0);
    }
    expect(g.stats.length).toBeGreaterThanOrEqual(2);
    expect(g.stats.length).toBeLessThanOrEqual(3);
    if (g.neg) {
      expect(pool.neg).toContain(g.neg.tag);
      expect(g.neg.value).toBeLessThanOrEqual(0);
    }
  });

  it("picks pure damage multipliers first (no utility or faction rolls)", () => {
    const keys = god().stats.map((st) => st.key);
    // honest panel scoring ranks the uniform multipliers (ms/cd/dmg) and the
    // corrosive-completing element top; faction rolls pay nothing without an enemy
    for (const k of keys) expect(["dmg", "ms", "cd", "elec"]).toContain(k);
    expect(keys).toContain("ms");
  });

  it("the god curse is free: it is the least harmful stat of the whole negative pool", () => {
    const g = god();
    expect(g.neg).not.toBeNull();
    // sc/pt/zoom & co never move the score, so the solved curse must be one of
    // them: removing it changes nothing (a harmful curse would raise the score)
    const full = scoreResult(computeBuild(w, s.mods, g.riven, null));
    const rest = { ...g.riven?.stats };
    if (g.neg?.key) delete rest[g.neg.key];
    const without = scoreResult(computeBuild(w, s.mods, { stats: rest }, null));
    expect(full - without).toBeLessThanOrEqual(1e-9);
    expect(full - without).toBeGreaterThanOrEqual(-1e-9);
  });

  it("solves adversarially too, and does not crash on high levels", () => {
    const g = must(solveGodRiven(w, rw, s.mods, gunner(9999)));
    expect(g.riven).not.toBeNull();
  });
});

describe("threeTier", () => {
  const w = weapon("Braton Prime");
  const rw = must(weaponById(w.id));

  it("without a riven the current build is the none tier and god beats it", () => {
    const current = suggestBuild({ weapon: w, pool: riflePool, preset: "corrosive" });
    const tt = threeTier({ weapon: w, rivenWeapon: rw, pool: riflePool, preset: "corrosive", riven: null, current });
    expect(tt.yours).toBeNull();
    expect(tt.none.score).toBeCloseTo(current.score, 6);
    expect(tt.none.mods).toBe(current.mods);
    const g = must(tt.god);
    expect(g.score).toBeGreaterThanOrEqual(tt.none.score);
    expect(g.mods.length).toBeLessThanOrEqual(7);
  });

  it("with a riven yours mirrors the current build and god still tops it", () => {
    const riven = { stats: { dmg: 1.0 } } as RivenContribution;
    const current = suggestBuild({ weapon: w, pool: riflePool, slots: 7, riven, preset: "corrosive" });
    const tt = threeTier({ weapon: w, rivenWeapon: rw, pool: riflePool, preset: "corrosive", riven, current });
    expect(must(tt.yours).score).toBeCloseTo(current.score, 6);
    expect(tt.none.score).toBeGreaterThan(0);
    const g = must(tt.god);
    expect(g.score).toBeGreaterThanOrEqual(tt.none.score);
    // three max-rolled stats must not lose to a single +100% damage riven
    expect(g.score).toBeGreaterThan(must(tt.yours).score);
  });

  it("works without riven data for the weapon (no god tier, no crash)", () => {
    const current = suggestBuild({ weapon: w, pool: riflePool, preset: "corrosive" });
    const tt = threeTier({ weapon: w, rivenWeapon: null, pool: riflePool, preset: "corrosive", riven: null, current });
    expect(tt.god).toBeNull();
    expect(tt.godRiven).toBeNull();
    expect(tt.none.score).toBeCloseTo(current.score, 6);
  });
});

describe("statMarginals", () => {
  const w = weapon("Braton Prime");

  it("one row per modelled stat, positive stats lose score when removed", () => {
    const riven = { stats: { dmg: 1.0, cc: 0.9 } } as RivenContribution;
    const mods = suggestBuild({ weapon: w, pool: riflePool, slots: 7, riven, preset: "corrosive" }).mods;
    const rows = statMarginals(w, mods, riven);
    expect(rows.map((r) => r.stat).sort()).toEqual(["cc", "dmg"]);
    for (const row of rows) {
      expect(row.loss).toBeGreaterThan(0);
      expect(row.pct).toBeGreaterThan(0);
      expect(row.pct).toBeLessThan(1);
    }
  });

  it("a harmful stat has negative loss (removing it improves the score)", () => {
    const riven = { stats: { dmg: 1.0, fr: -0.3 } } as RivenContribution;
    const mods = suggestBuild({ weapon: w, pool: riflePool, slots: 7, riven, preset: "corrosive" }).mods;
    const rows = statMarginals(w, mods, riven);
    const fr = must(rows.find((r) => r.stat === "fr"));
    expect(fr.loss).toBeLessThan(0);
    expect(fr.pct).toBeLessThan(0);
  });
});

describe("expectedRiven", () => {
  const w = weapon("Braton Prime");
  const rw = must(weaponById(w.id));
  const mods = suggestBuild({ weapon: w, pool: riflePool, preset: "corrosive" }).mods;
  const row = (tags: string[], weight = 1.07): WantedRow => ({ tags, w: weight });

  it("returns null when a set has no known stat", () => {
    expect(expectedRiven(rw.cls, { sets: [[row([])]], wantNeg: false, allowedNeg: [] }, w, mods, null)).toBeNull();
    expect(expectedRiven(rw.cls, { sets: [], wantNeg: false, allowedNeg: [] }, w, mods, null)).toBeNull();
  });

  it("builds a legal wanted card: best stat per row, at most three positives, no curse when none is wanted", () => {
    const e = must(
      expectedRiven(
        rw.cls,
        {
          sets: [[row(["WeaponDamageAmountMod"]), row(["WeaponFireIterationsMod", "WeaponCritChanceMod"]), row(["WeaponFireRateMod"]), row(["WeaponReloadSpeedMod"])]],
          wantNeg: false,
          allowedNeg: [],
        },
        w,
        mods,
        null,
      ),
    );
    expect(e.stats.length).toBeLessThanOrEqual(3);
    expect(new Set(e.stats.map((s) => s.tag)).size).toBe(e.stats.length);
    expect(e.neg).toBeNull();
    expect(e.riven).not.toBeNull();
    for (const st of e.stats) expect(st.value).toBeGreaterThan(0);
  });

  it("the curse comes from the accepted list and never adds value", () => {
    const e = must(
      expectedRiven(
        rw.cls,
        { sets: [[row(["WeaponDamageAmountMod"]), row(["WeaponFireIterationsMod"])]], wantNeg: true, allowedNeg: ["WeaponClipMaxMod", "WeaponReloadSpeedMod"] },
        w,
        mods,
        null,
      ),
    );
    expect(e.neg).not.toBeNull();
    expect(["WeaponClipMaxMod", "WeaponReloadSpeedMod"]).toContain(e.neg?.tag);
    expect(e.neg?.value).toBeLessThanOrEqual(0);
  });

  it("a typed value passes through as the game-shown number", () => {
    const e = must(expectedRiven(rw.cls, { sets: [[{ tags: ["WeaponDamageAmountMod"], w: 1, shown: 123.4 }]], wantNeg: false, allowedNeg: [] }, w, mods, null));
    expect(e.stats[0].shown).toBeCloseTo(123.4, 6);
    expect(e.stats[0].value).toBeCloseTo(1.234, 6);
  });

  it("picks the better of two alternative sets", () => {
    const weak = [row(["WeaponReloadSpeedMod"]), row(["WeaponZoomFovMod"])];
    const strong = [row(["WeaponDamageAmountMod"]), row(["WeaponFireIterationsMod"])];
    const e = must(expectedRiven(rw.cls, { sets: [weak, strong], wantNeg: false, allowedNeg: [] }, w, mods, null));
    expect(e.stats.map((s) => s.tag)).toContain("WeaponDamageAmountMod");
  });

  it("scores adversarially against an enemy context", () => {
    const e = expectedRiven(rw.cls, { sets: [[row(["WeaponCorrosiveDamageMod", "WeaponViralDamageMod"])]], wantNeg: false, allowedNeg: [] }, w, mods, gunner(150));
    expect(e?.riven).not.toBeNull();
  });
});
