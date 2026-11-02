/**
 * 流派（preset）硬约束：非 auto 流派必须真的组出该化合物。
 * 回归报告场景：布莱顿 Prime 的 爆炸/磁力/辐射 曾全部配不出；迅发电浆炮 + 毒素紫卡 + 辐射曾配成病毒。
 */
import { describe, expect, it } from "vitest";
import combat from "../data/combat.json";
import { suggestBuild } from "./build";
import { ENEMIES } from "./data";
import type { ModCard, WeaponPanel } from "./engine";

const weapons = combat.weapons as unknown as WeaponPanel[];
const allMods = combat.mods as unknown as ModCard[];

const weapon = (en: string): WeaponPanel => {
  const w = weapons.find((x) => x.en === en);
  if (!w) throw new Error(`weapon not found: ${en}`);
  return w;
};
const riflePool = allMods.filter((m) => m.compat === "rifle" && !m.trigger);

describe("preset hard constraint", () => {
  it("Braton Prime really rolls blast / magnetic / radiation when asked", () => {
    for (const preset of ["blast", "magnetic", "radiation"] as const) {
      const s = suggestBuild({ weapon: weapon("Braton Prime"), pool: riflePool, preset, slots: 8 });
      expect(s.result.dmg[preset], preset).toBeGreaterThan(0);
      expect(s.mods.length).toBeLessThanOrEqual(8);
    }
  });

  it("Acceltra + toxin riven + radiation rolls radiation, not viral", () => {
    // 用户截图工单：多重 +110%、对 Grineer +49%、毒素 +102.6%、弹匣 −47.1%
    const s = suggestBuild({
      weapon: weapon("Acceltra"),
      pool: riflePool,
      preset: "radiation",
      slots: 7,
      riven: { stats: { ms: 1.1, facGrineer: 0.49, tox: 1.026, mag: -0.471 } },
      enemy: { spec: ENEMIES[0], level: 150 },
    });
    expect(s.result.dmg.radiation ?? 0).toBeGreaterThan(0);
  });

  it("auto stays unconstrained and still returns a usable build", () => {
    const s = suggestBuild({ weapon: weapon("Braton Prime"), pool: riflePool, preset: "auto" });
    expect(s.mods.length).toBeGreaterThan(0);
    expect(s.mods.length).toBeLessThanOrEqual(8);
    expect(Number.isFinite(s.score)).toBe(true);
  });
});
