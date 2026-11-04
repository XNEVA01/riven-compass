/**
 * 近战第一期（平砍口径）：面板、元素合成、暴击/触发、攻速与流派配卡。
 * 近战没有弹匣/装填；连击与重击倍率不在本期范围。
 */
import { describe, expect, it } from "vitest";
import combat from "../data/combat.json";
import { suggestBuild } from "./build";
import { RIVEN_TAG_TO_KEY } from "./data";
import type { ModCard, WeaponPanel } from "./engine";
import { computeBuild } from "./engine";

const weapons = combat.weapons as unknown as WeaponPanel[];
const allMods = combat.mods as unknown as ModCard[];

const weapon = (en: string): WeaponPanel => {
  const w = weapons.find((x) => x.en === en);
  if (!w) throw new Error(`weapon not found: ${en}`);
  return w;
};
const byName = (en: string): ModCard => {
  const m = allMods.find((x) => x.en === en && x.compat === "melee");
  if (!m) throw new Error(`melee mod not found: ${en}`);
  return m;
};

const galatine = weapon("Galatine");
const meleePool = allMods.filter((m) => m.compat === "melee");

describe("近战面板（第一期：平砍）", () => {
  it("迦伦提恩：182 总伤、无弹匣/装填、持续射速=攻速", () => {
    const r = computeBuild(galatine);
    expect(r.panelTotal).toBeCloseTo(182, 1);
    expect(r.dmg.slash).toBeCloseTo(172.9, 1);
    expect(r.cc).toBeCloseTo(0.1, 6);
    expect(r.cd).toBeCloseTo(2, 6);
    expect(r.sc).toBeCloseTo(0.2, 4);
    expect(r.mag).toBeNull();
    expect(r.rl).toBe(0); // 无装填：结果里按 0 计
    expect(r.fr).toBeCloseTo(1, 6);
    expect(r.sustainedFr).toBeCloseTo(r.fr, 6);
    expect(r.sustainedDps).toBeCloseTo(r.burstDps, 6);
  });

  it("近战元素按槽位序合成（毒素+火焰 → 毒气）", () => {
    const r = computeBuild(galatine, [byName("Fever Strike"), byName("Molten Impact")]);
    expect(r.dmg.gas).toBeCloseTo(182 * 1.8, 1);
    expect(r.dmg.slash).toBeCloseTo(172.9, 1);
    expect(r.dmg.toxin).toBeUndefined();
    expect(r.dmg.heat).toBeUndefined();
  });

  it("压迫点 +120% 近战伤害线性放大面板", () => {
    const r = computeBuild(galatine, [byName("Pressure Point")]);
    expect(r.perShot).toBeCloseTo(182 * 2.2, 1);
    expect(r.dmg.slash).toBeCloseTo(172.9 * 2.2, 1);
  });

  it("斩铁 +120% 暴击率、肢解 +90% 暴伤（平砍口径，不含重击翻倍）", () => {
    const r = computeBuild(galatine, [byName("True Steel"), byName("Organ Shatter")]);
    expect(r.cc).toBeCloseTo(0.22, 6);
    expect(r.cd).toBeCloseTo(3.8, 6);
  });

  it("狂暴 +30% 攻击速度", () => {
    const r = computeBuild(galatine, [byName("Fury")]);
    expect(r.fr).toBeCloseTo(1.3, 6);
    expect(r.sustainedFr).toBeCloseTo(1.3, 6);
  });
});

describe("近战紫卡词条映射", () => {
  it("近战基伤与近战阵营卡都有对应引擎键", () => {
    expect(RIVEN_TAG_TO_KEY.WeaponMeleeDamageMod).toBe("dmg");
    expect(RIVEN_TAG_TO_KEY.WeaponMeleeFactionDamageGrineer).toBe("facGrineer");
    expect(RIVEN_TAG_TO_KEY.WeaponMeleeFactionDamageCorpus).toBe("facCorpus");
    expect(RIVEN_TAG_TO_KEY.WeaponMeleeFactionDamageInfested).toBe("facInfested");
  });

  it("近战紫卡的元素按槽位参与合成", () => {
    const r = computeBuild(galatine, [byName("Molten Impact")], { stats: { tox: 0.9 } }, null, undefined, 1);
    expect(r.dmg.gas).toBeCloseTo(182 * 1.8, 1);
  });
});

describe("近战流派配卡（硬约束）", () => {
  it("腐蚀流派真的配出腐蚀", () => {
    const s = suggestBuild({ weapon: galatine, pool: meleePool, preset: "corrosive", slots: 8 });
    expect(s.result.dmg.corrosive ?? 0).toBeGreaterThan(0);
    expect(s.mods.length).toBeGreaterThan(0);
    expect(s.mods.length).toBeLessThanOrEqual(8);
  });

  it("病毒流派真的配出病毒", () => {
    const s = suggestBuild({ weapon: galatine, pool: meleePool, preset: "viral", slots: 8 });
    expect(s.result.dmg.viral ?? 0).toBeGreaterThan(0);
  });
});
