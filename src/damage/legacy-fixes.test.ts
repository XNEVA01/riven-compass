/**
 * 遗留问题回归：紫卡状态词条（触发/异常时间/异常伤害）与缺失弹匣的武器。
 */
import { describe, expect, it } from "vitest";
import combat from "../data/combat.json";
import { ENEMIES, RIVEN_TAG_TO_KEY } from "./data";
import type { ModCard, WeaponPanel } from "./engine";
import { computeBuild } from "./engine";
import { viralHealthMul } from "./status";

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
const magModFor = (compat: WeaponPanel["compat"]): ModCard => {
  const m = allMods.find((x) => x.compat === compat && (x.stats.mag ?? 0) > 0);
  if (!m) throw new Error(`no magazine mod for ${compat}`);
  return m;
};
const gunner = { spec: ENEMIES[0], level: 150 };

describe("riven status tags", () => {
  it("maps trigger chance / status duration / status damage to their own keys", () => {
    expect(RIVEN_TAG_TO_KEY.WeaponStunChanceMod).toBe("sc");
    expect(RIVEN_TAG_TO_KEY.WeaponProcTimeMod).toBe("sdur");
    expect(RIVEN_TAG_TO_KEY.WeaponStatusDamage).toBe("sdmg");
  });

  it("a trigger-chance riven raises the panel status chance", () => {
    const w = weapon("Braton Prime");
    const base = computeBuild(w);
    const withRiven = computeBuild(w, [], { stats: { sc: 1 } });
    expect(withRiven.sc).toBeCloseTo(base.sc * 2, 6);
  });

  it("status duration widens the stack windows through the engine", () => {
    const w = weapon("Braton Prime");
    const mods = [byName("Cryo Rounds"), byName("Infected Clip")]; // 病毒
    const base = computeBuild(w, mods, null, gunner);
    const longer = computeBuild(w, mods, { stats: { sdur: 2 } }, gunner);
    expect(base.vsEnemy?.status?.viralStacks ?? 0).toBeGreaterThan(0);
    expect(longer.vsEnemy?.status?.viralStacks ?? 0).toBeGreaterThan(base.vsEnemy?.status?.viralStacks ?? 0);
    // 纯函数口径：6s 窗口 ×2 后叠层翻倍
    expect(viralHealthMul(0.1, 2).stacks).toBeCloseTo(1.2, 6);
  });

  it("status damage multiplies DoT ticks but leaves direct damage alone", () => {
    const w = weapon("Braton Prime");
    const mods = [byName("Cryo Rounds"), byName("Infected Clip")];
    const base = computeBuild(w, mods, null, gunner);
    const boosted = computeBuild(w, mods, { stats: { sdmg: 1 } }, gunner);
    expect(boosted.vsEnemy?.directSustainedDps).toBeCloseTo(base.vsEnemy?.directSustainedDps ?? 0, 6);
    expect(boosted.vsEnemy?.status?.dotDpsTotal ?? 0).toBeCloseTo((base.vsEnemy?.status?.dotDpsTotal ?? 0) * 2, 4);
  });
});

describe("missing magazine sizes", () => {
  it("ships the filled-in values and keeps the no-magazine weapons null", () => {
    expect(weapon("Convectrix").mag).toBe(70);
    expect(weapon("Helstrum").mag).toBe(80);
    expect(weapon("Nataruk").mag).toBe(1);
    for (const en of ["Grimoire", "Akaten", "Batoten", "Lacerten", "Deconstructor", "Deconstructor Prime"]) {
      expect(weapon(en).mag, en).toBeNull();
    }
  });

  it("reads a null magazine as no magazine and no reload cycle", () => {
    for (const en of ["Grimoire", "Deconstructor"]) {
      const w = weapon(en);
      const r = computeBuild(w, [magModFor(w.compat)]);
      expect(r.mag, en).toBeNull(); // 弹匣 MOD 不生效
      expect(r.sustainedFr, en).toBeCloseTo(r.fr, 6); // 持续射速就是射速本身
    }
  });

  it("Convectrix cycles its 70-round magazine and takes magazine mods", () => {
    const w = weapon("Convectrix");
    const r = computeBuild(w);
    expect(r.mag).toBe(70);
    const fr = w.fr;
    const want = (70 * fr) / (70 + Math.max(1, (w.rl ?? 0) * fr));
    expect(r.sustainedFr).toBeCloseTo(want, 6);
    const mag = magModFor("shotgun");
    const boosted = computeBuild(w, [mag]);
    expect(boosted.mag).toBe(Math.round(70 * (1 + (mag.stats.mag ?? 0))));
  });

  it("Grimoire is no longer cut in half by a phantom one-round magazine", () => {
    const w = weapon("Grimoire");
    const r = computeBuild(w);
    expect(r.fr).toBeGreaterThan(0);
    expect(r.sustainedFr).toBeCloseTo(r.fr, 6);
    // 旧口径：1 发弹匣 + 0.01s 装填 → 持续射速 ≈ fr/2
    expect(r.sustainedFr).toBeGreaterThan(r.fr * 0.9);
  });
});
