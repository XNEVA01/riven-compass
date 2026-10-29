/**
 * Acceptance tests against real combat.json data (built by scripts/build-combat.py).
 * These guard the data pipeline + engine together.
 */
import { describe, expect, it } from "vitest";
import combat from "../data/combat.json";
import { GAME } from "../engine/data";
import { ENEMIES } from "./data";
import type { ModCard, WeaponPanel } from "./engine";
import { computeBuild } from "./engine";

const weapons = combat.weapons as unknown as WeaponPanel[];
const mods = combat.mods as unknown as ModCard[];

const byName = (en: string): ModCard => {
  const m = mods.filter((x) => x.en === en).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))[0];
  if (!m) throw new Error(`mod not found: ${en}`);
  return m;
};
const weapon = (en: string): WeaponPanel => {
  const w = weapons.find((x) => x.en === en);
  if (!w) throw new Error(`weapon not found: ${en}`);
  return w;
};

describe("combat.json pipeline", () => {
  it("has the v1 gun roster with sane panels", () => {
    expect(weapons.length).toBeGreaterThan(300);
    const braton = weapon("Braton Prime");
    expect(braton.dmg.slash).toBeCloseTo(21, 1);
    expect(braton.mag).toBe(75);
  });

  it("carries every companion (sentinel) weapon with a usable mod pool", () => {
    const sentinels = GAME.weapons.filter((w) => w.sentinel);
    expect(sentinels.length).toBe(24);
    const byId = new Map(weapons.map((w) => [w.id, w]));
    for (const s of sentinels) {
      const panel = byId.get(s.id);
      expect(panel, `combat.json missing ${s.name.en}`).toBeDefined();
      expect(panel?.total ?? 0).toBeGreaterThan(0);
      expect(mods.filter((m) => m.compat === panel?.compat).length).toBeGreaterThan(0);
    }
    const verglas = weapon("Verglas");
    expect(verglas.compat).toBe("rifle");
    expect(verglas.dmg.cold).toBeCloseTo(26, 1);
    expect(mods.filter((m) => m.compat === "rifle").length).toBeGreaterThan(10);
  });

  it("core damage mods are present with correct values", () => {
    expect(byName("Serration").stats.dmg).toBeCloseTo(1.65, 2);
    expect(byName("Split Chamber").stats.ms).toBeCloseTo(0.9, 2);
    expect(byName("Primed Bane Of Grineer").stats.facGrineer).toBeCloseTo(0.55, 2);
    // zh localization came through from @wfcd/items i18n
    const zhSerration = mods.find((x) => x.zh === "膛线");
    expect(zhSerration?.en).toBe("Serration");
    expect(zhSerration?.stats.dmg).toBeCloseTo(1.65, 2);
  });
});

describe("real build acceptance", () => {
  it("Braton Prime 6-mod build produces sane numbers", () => {
    const w = weapon("Braton Prime");
    const build = [byName("Serration"), byName("Split Chamber"), byName("Point Strike"), byName("Vital Sense"), byName("Stormbringer"), byName("Infected Clip")];
    const r = computeBuild(w, build);
    // panel = phys(35x2.65) + corrosive(35 x 2.65 x 1.8), per-shot x1.9 multishot
    const wantPanel = 35 * 2.65 * (1 + 1.8);
    expect(r.perShot).toBeCloseTo(wantPanel * 1.9, -1);
    expect(r.cc).toBeCloseTo(0.3, 2);
    expect(r.dmg.corrosive).toBeCloseTo(35 * 2.65 * 1.8, -1);
    expect(r.burstDps).toBeGreaterThan(5000);
    expect(r.burstDps).toBeLessThan(12000);
  });

  it("Bramma keeps its innate blast through mods", () => {
    const r = computeBuild(weapon("Kuva Bramma"), [byName("Serration")]);
    expect(r.dmg.blast).toBeCloseTo(839 * 2.65, -1);
  });

  it("Lanka charge fallback works with real panel", () => {
    const r = computeBuild(weapon("Lanka"));
    expect(r.fr).toBeCloseTo(1, 3);
    expect(r.sustainedFr).toBeCloseTo(1 / (1 + 2 / 10), 3);
  });

  it("150 heavy gunner: full adversarial mode", () => {
    const w = weapon("Braton Prime");
    const build = [byName("Serration"), byName("Split Chamber"), byName("Point Strike"), byName("Vital Sense"), byName("Primed Bane Of Grineer")];
    const r = computeBuild(w, build, null, { spec: ENEMIES[0], level: 150 });
    expect(r.vsEnemy).toBeDefined();
    expect(r.vsEnemy?.armor).toBeGreaterThan(7000);
    expect(r.vsEnemy?.health).toBeGreaterThan(50000);
    expect(r.vsEnemy?.sustainedDps).toBeGreaterThan(100);
    expect(r.vsEnemy?.timeToKill).toBeGreaterThan(1);
  });
});
