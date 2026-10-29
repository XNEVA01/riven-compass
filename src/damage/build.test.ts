/**
 * Build suggester tests against real combat.json data.
 */
import { describe, expect, it } from "vitest";
import combat from "../data/combat.json";
import { makeUnits, marginalTable, suggestBuild } from "./build";
import { ENEMIES } from "./data";
import type { ModCard, WeaponPanel } from "./engine";
import { computeBuild, incarnonPanel } from "./engine";

const weapons = combat.weapons as unknown as WeaponPanel[];
const allMods = combat.mods as unknown as ModCard[];

const weapon = (en: string): WeaponPanel => {
  const w = weapons.find((x) => x.en === en);
  if (!w) throw new Error(`weapon not found: ${en}`);
  return w;
};
const byName = (en: string): ModCard => {
  const m = allMods.find((x) => x.en === en);
  if (!m) throw new Error(`mod not found: ${en}`);
  return m;
};
// Braton Prime is an Auto trigger: semi-auto-only mods (Cannonade) cannot equip, mirroring the UI pool filter
const riflePool = allMods.filter((m) => m.compat === "rifle" && !m.trigger);

describe("makeUnits", () => {
  it("separates element couples from singles and dedupes pools", () => {
    const units = makeUnits(riflePool, "corrosive");
    const ids = units.flatMap((u) => u.mods.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
    const couple = units.find((u) => u.mods.length === 2 && u.mods.some((m) => m.en === "Stormbringer") && u.mods.some((m) => m.en === "Infected Clip"));
    expect(couple).toBeDefined();
    // preset mode excludes lone element cards
    expect(units.filter((u) => u.mods.length === 1 && u.mods[0].en === "Stormbringer")).toHaveLength(0);
  });

  it("auto mode allows every compound pair and lone elements", () => {
    const units = makeUnits(riflePool, "auto");
    const couples = units.filter((u) => u.mods.length === 2);
    expect(couples.length).toBeGreaterThanOrEqual(6);
    expect(units.filter((u) => u.mods.length === 1 && u.mods[0].en === "Stormbringer")).toHaveLength(1);
  });
});

describe("suggestBuild", () => {
  it("greedy picks the canonical core first and stays within slots", () => {
    const s = suggestBuild({ weapon: weapon("Braton Prime"), pool: riflePool });
    expect(s.mods.length).toBeLessThanOrEqual(8);
    expect(s.mods.length).toBeGreaterThanOrEqual(6);
    const names = s.mods.map((m) => m.en);
    expect(names).toContain("Serration");
    expect(names).toContain("Split Chamber");
    // no duplicate ids
    expect(new Set(s.mods.map((m) => m.id)).size).toBe(s.mods.length);
  });

  it("corrosive preset yields exactly one working corrosive couple", () => {
    const s = suggestBuild({
      weapon: weapon("Braton Prime"),
      pool: riflePool,
      preset: "corrosive",
      // the app always fights a chosen enemy: with no enemy the panel-honest
      // scoring may skip the couple for plain multipliers instead
      enemy: { spec: ENEMIES[0], level: 150 },
    });
    const r = computeBuild(weapon("Braton Prime"), s.mods);
    // electric + toxin entered slot order and paired into corrosive
    expect(r.dmg.corrosive).toBeGreaterThan(0);
    // no stray unpaired base elements on the panel
    expect(r.dmg.electricity ?? 0).toBe(0);
    expect(r.dmg.toxin ?? 0).toBe(0);
    expect(r.dmg.cold ?? 0).toBe(0);
    expect(r.dmg.heat ?? 0).toBe(0);
  });

  it("beats the hand-picked six-mod baseline", () => {
    const w = weapon("Braton Prime");
    const baseline = [byName("Serration"), byName("Split Chamber"), byName("Point Strike"), byName("Vital Sense"), byName("Stormbringer"), byName("Infected Clip")];
    const baseScore = computeBuild(w, baseline).sustainedDps;
    const s = suggestBuild({ weapon: w, pool: riflePool, preset: "corrosive" });
    expect(s.score).toBeGreaterThanOrEqual(baseScore * 0.999);
  });

  it("adversarial mode follows Damage 2.0 armor-class direction", () => {
    const w = weapon("Braton Prime");
    // ferrite heavy gunner: corrosive strips armor (x1.75), radiation does not
    const gunner = { spec: ENEMIES[0], level: 150 };
    const corOnFerrite = suggestBuild({
      weapon: w,
      pool: riflePool,
      preset: "corrosive",
      enemy: gunner,
    });
    const radOnFerrite = suggestBuild({
      weapon: w,
      pool: riflePool,
      preset: "radiation",
      enemy: gunner,
    });
    expect(corOnFerrite.score).toBeGreaterThan(radOnFerrite.score);
    // alloy-armor bombard flips the direction: radiation +75% vs alloy
    const bombard = { spec: ENEMIES[1], level: 150 };
    const radOnAlloy = suggestBuild({
      weapon: w,
      pool: riflePool,
      preset: "radiation",
      enemy: bombard,
    });
    const corOnAlloy = suggestBuild({
      weapon: w,
      pool: riflePool,
      preset: "corrosive",
      enemy: bombard,
    });
    expect(radOnAlloy.score).toBeGreaterThan(corOnAlloy.score);
  });

  it("ban list removes mods from consideration", () => {
    const s = suggestBuild({
      weapon: weapon("Braton Prime"),
      pool: riflePool,
      ban: [byName("Serration").id],
    });
    expect(s.mods.map((m) => m.en)).not.toContain("Serration");
  });

  it("hill climbing never decreases the score vs its greedy steps", () => {
    const s = suggestBuild({ weapon: weapon("Braton Prime"), pool: riflePool });
    for (const step of s.steps) {
      expect(s.score).toBeGreaterThanOrEqual(step.score - 1e-6);
    }
    // final score must be consistent with a fresh recompute
    expect(s.score).toBeCloseTo(s.result.sustainedDps, 6);
  });

  it("riven base element is completed by a single opposite card", () => {
    const w = weapon("Braton Prime");
    const riven = { stats: { elec: 1.2 } };
    const pool = [byName("Serration"), byName("Infected Clip"), byName("Stormbringer")];
    const s = suggestBuild({
      weapon: w,
      pool,
      slots: 2,
      riven,
      preset: "corrosive",
    });
    // two slots: Serration (biggest multiplier) + the toxin completion card
    expect(s.mods.map((m) => m.en)).toEqual(["Serration", "Infected Clip"]);
    const r = computeBuild(w, s.mods, riven);
    // toxin (mod slot) + electricity (riven, later in order) -> corrosive
    // increment = 0.9 + 1.2, scaled by Serration's 2.65 damage multiplier
    expect(r.dmg.corrosive).toBeCloseTo(35 * (0.9 + 1.2) * 2.65, -1);
    expect(r.dmg.electricity ?? 0).toBe(0);
    expect(r.dmg.toxin ?? 0).toBe(0);
  });
});

describe("marginalTable", () => {
  it("lists one positive-contribution row per mod", () => {
    const w = weapon("Braton Prime");
    const mods = [byName("Serration"), byName("Split Chamber"), byName("Point Strike"), byName("Vital Sense"), byName("Stormbringer"), byName("Infected Clip")];
    const rows = marginalTable(w, mods);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.loss).toBeGreaterThan(0);
      expect(row.pct).toBeGreaterThan(0);
      expect(row.pct).toBeLessThan(1);
    }
    // Serration should be the single most valuable mod here
    const top = [...rows].sort((a, b) => b.loss - a.loss)[0];
    expect(top.mod.en).toBe("Serration");
  });
});

describe("faction mods in suggestions (驱逐/灭亡/净化)", () => {
  it("never slots a faction mod against another faction's enemy", () => {
    const s = suggestBuild({
      weapon: weapon("Braton Prime"),
      pool: riflePool,
      enemy: { spec: ENEMIES[0], level: 150 }, // Corrupted -> Orokin faction
      preset: "corrosive",
    });
    // against the Corrupted only facOrokin mods can pay; every other faction mod must stay out
    for (const m of s.mods) {
      for (const k of Object.keys(m.stats)) {
        if (k.startsWith("fac")) expect(k).toBe("facOrokin");
      }
    }
  });

  it("keeps faction mods out of the no-enemy build", () => {
    const s = suggestBuild({ weapon: weapon("Braton Prime"), pool: riflePool, preset: "corrosive" });
    expect(s.mods.some((m) => Object.keys(m.stats).some((k) => k.startsWith("fac")))).toBe(false);
  });
});

describe("galvanized mods (镀层) & trigger restrictions", () => {
  it("ships stack specs, cond notes and the semi-auto trigger restriction", () => {
    const chamber = byName("Galvanized Chamber");
    expect(chamber.stats).toEqual({ ms: 0.8 });
    expect(chamber.stack).toEqual({ stat: "ms", per: 0.3, max: 5 });
    expect(chamber.cond).toBeUndefined();
    const scope = byName("Galvanized Scope");
    expect(scope.stats).toEqual({});
    expect(scope.stack).toEqual({ stat: "cc", per: 0.4, max: 5, base: 1.2 });
    expect(byName("Galvanized Aptitude").cond).toBe(true);
    expect(byName("Semi-Shotgun Cannonade").trigger).toBe("Semi");
  });

  it("counts kill stacks only once at least one is active", () => {
    const w = weapon("Braton Prime");
    const m = byName("Galvanized Chamber");
    const base = computeBuild(w, [m]);
    const zero = computeBuild(w, [m], null, null, { [m.id]: 0 });
    expect(zero.ms).toBeCloseTo(base.ms, 6); // passive +80% only
    expect(zero.ms).toBeCloseTo(1.8, 6);
    const full = computeBuild(w, [m], null, null, { [m.id]: 5 });
    expect(full.ms).toBeCloseTo(1 * (1 + 0.8 + 5 * 0.3), 6);
    // Scope: the +120% activation buff only rides on an active kill stack
    const scope = byName("Galvanized Scope");
    const off = computeBuild(w, [scope], null, null, { [scope.id]: 0 });
    expect(off.cc).toBeCloseTo(w.cc, 6);
    const one = computeBuild(w, [scope], null, null, { [scope.id]: 1 });
    expect(one.cc).toBeCloseTo(w.cc * (1 + 1.2 + 0.4), 6);
  });
});

describe("incarnon form (灵化形态)", () => {
  it("ships per-beam panels with wiki-verified beams and fixed magazine", () => {
    const boar = weapon("Boar Prime");
    expect(boar.incarnon?.dmg).toEqual({ heat: 30 });
    expect(boar.incarnon?.total).toBe(30);
    expect(boar.incarnon?.beams).toBe(3);
    expect(boar.incarnon?.mag).toBe(150);
    // 69 Incarnon Genesis guns made it into combat.json
    expect(weapons.filter((w) => w.incarnon).length).toBeGreaterThanOrEqual(69);
  });

  it("swaps the panel: per-beam damage x beams, magazine mods do not apply", () => {
    const boar = weapon("Boar Prime");
    const p = incarnonPanel(boar);
    expect(p.ms).toBe(3);
    expect(p.mag).toBe(150);
    expect(p.fixedMag).toBe(true);
    expect(p.trigger).toBeUndefined();
    const mag = byName("Ammo Stock");
    const r = computeBuild(p, [mag]);
    expect(r.mag).toBe(150); // 形态弹匣固定
    expect(r.perShot).toBeCloseTo(30 * 3, 6); // 单发 = 每光束30 × 3条光束
    expect(r.fr).toBeCloseTo(8, 6);
    expect(computeBuild(boar, [mag]).mag).toBe(32); // 基础形态弹匣照吃MOD：20×1.6
  });

  it("keeps the pure-heat form pure: heat mods amplify, no phantom types", () => {
    const p = incarnonPanel(weapon("Boar Prime"));
    const r = computeBuild(p, [byName("Incendiary Coat")]); // +90% heat
    expect(Object.keys(r.dmg)).toEqual(["heat"]);
    expect(r.dmg.heat).toBeCloseTo(30 * 1.9, 6);
  });
});

describe("weapon family (同族版本)", () => {
  it("keeps base and variant panels apart (丧钟 vs 丧钟 Prime)", () => {
    const knell = weapon("Knell");
    const prime = weapon("Knell Prime");
    expect(knell.total).toBe(150);
    expect(prime.total).toBe(180);
    expect(prime.cc).toBeGreaterThan(knell.cc);
  });
});
