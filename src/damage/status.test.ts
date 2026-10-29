/**
 * 异常状态稳态模型测试（wiki 口径，见 status.ts 头注）：
 * 触发率按伤害占比分配、叠层公式（病毒/磁力/腐蚀）、DoT（阵营²/暴击快照/元素加成），
 * 以及 combat.json 真实面板的引擎集成（野猪Prime灵化灼烧剥甲、病毒/磁力叠层）。
 */
import { describe, expect, it } from "vitest";
import combat from "../data/combat.json";
import { ENEMIES, scaledArmor } from "./data";
import type { ModCard, WeaponPanel } from "./engine";
import { computeBuild, incarnonPanel } from "./engine";
import { corrosiveArmorStrip, dotPerSecond, HEAT_ARMOR_STRIP, magneticShieldMul, procRates, viralHealthMul } from "./status";

describe("procRates", () => {
  it("distributes procs by damage share (27.2: pure proportion)", () => {
    const r = procRates({ slash: 60, heat: 40 }, 100, 0.5, 2, 10);
    expect(r.total).toBeCloseTo(10, 6); // ms 2 × sc 0.5 × 10 发/s
    expect(r.byType.slash).toBeCloseTo(6, 6);
    expect(r.byType.heat).toBeCloseTo(4, 6);
  });

  it("clamps negatives and skips zero-damage types", () => {
    const r = procRates({ slash: 30, cold: 0 }, 30, -1, 2, 10);
    expect(r.total).toBe(0);
    expect(r.byType.slash).toBeUndefined();
  });
});

describe("stack formulas", () => {
  it("viral: first stack +100%, then +25%/stack, cap +325% (6s window)", () => {
    expect(viralHealthMul(0).mul).toBe(1);
    expect(viralHealthMul(1 / 12).mul).toBe(1); // 0.5 层：未满 1 层不给增伤
    const one = viralHealthMul(1 / 6);
    expect(one.stacks).toBeCloseTo(1, 6);
    expect(one.mul).toBeCloseTo(2, 6);
    expect(viralHealthMul(0.5).mul).toBeCloseTo(2.5, 6); // 3 层
    const cap = viralHealthMul(10); // 窗口内 60 层 → 钳到 10
    expect(cap.stacks).toBe(10);
    expect(cap.mul).toBeCloseTo(4.25, 6);
  });

  it("magnetic mirrors viral on shields", () => {
    expect(magneticShieldMul(1 / 6).mul).toBeCloseTo(2, 6);
    expect(magneticShieldMul(10).mul).toBeCloseTo(4.25, 6);
  });

  it("corrosive: 26% first, +6%/stack, cap 80% (8s window)", () => {
    expect(corrosiveArmorStrip(0).strip).toBe(0);
    expect(corrosiveArmorStrip(1 / 12).strip).toBe(0); // <1 层：不剥
    expect(corrosiveArmorStrip(1 / 8).strip).toBeCloseTo(0.26, 6);
    expect(corrosiveArmorStrip(1).strip).toBeCloseTo(0.68, 6); // 8 层
    expect(corrosiveArmorStrip(10).strip).toBeCloseTo(0.8, 6);
  });
});

describe("dotPerSecond", () => {
  const rates = procRates({ slash: 60, heat: 40 }, 100, 1, 1, 1); // 1 触发/s：0.6 流血 + 0.4 灼烧
  const zero = { heat: 0, toxin: 0, gas: 0 };

  it("bleed: 6 ticks x 0.35, no element bonus", () => {
    const d = dotPerSecond(rates, 100, zero, 1, 1);
    expect(d.slash).toBeCloseTo(0.6 * 6 * 0.35 * 100, 6);
  });

  it("faction applies twice; crit factor snapshots; heat eats its element bonus", () => {
    const d = dotPerSecond(rates, 100, { heat: 0.6, toxin: 0, gas: 0 }, 1.5, 1.3);
    const f2 = 1.3 * 1.3;
    expect(d.slash).toBeCloseTo(0.6 * 6 * 0.35 * 100 * f2 * 1.5, 6);
    expect(d.heat).toBeCloseTo(0.4 * 6 * 0.5 * 100 * 1.6 * f2 * 1.5, 6);
  });

  it("blast is a single 0.3 tick", () => {
    const d = dotPerSecond(procRates({ blast: 100 }, 100, 1, 1, 1), 100, zero, 1, 1);
    expect(d.blast).toBeCloseTo(30, 6);
  });
});

describe("engine integration (combat.json real panels)", () => {
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
  const gunner = { spec: ENEMIES[0], level: 150 };

  it("Boar Prime Incarnon: pure heat keeps the 50% strip on and halves armor", () => {
    const p = incarnonPanel(weapon("Boar Prime"));
    const r = computeBuild(p, [], null, gunner);
    expect(r.sc).toBeCloseTo(0.24, 6); // 灵化 cc/sc 按小数口径入库（÷100 修复的回归位）
    const st = r.vsEnemy?.status;
    expect(st).toBeDefined();
    expect(st?.procsPerSec).toBeGreaterThan(0);
    expect(st?.heatStrip).toBe(HEAT_ARMOR_STRIP);
    expect(st?.corrosiveStrip).toBe(0);
    expect(st?.viralMul).toBe(1);
    expect(st?.dotDps.heat).toBeGreaterThan(0);
    expect(st?.dotDps.slash).toBe(0);
    // 护甲 = 等级缩放值 ×(1 − 火焰剥甲 50%)
    expect(r.vsEnemy?.armor).toBeCloseTo(scaledArmor(ENEMIES[0], 150) * 0.5, -1);
  });

  it("viral procs push health dps beyond the direct part", () => {
    // 冰冻+毒素 → 病毒；Braton Prime 的切割占比保证流血 DoT 同时存在
    const r = computeBuild(weapon("Braton Prime"), [byName("Serration"), byName("Cryo Rounds"), byName("Infected Clip")], null, gunner);
    const st = r.vsEnemy?.status;
    expect(st?.viralStacks).toBeGreaterThan(1);
    expect(st?.viralMul).toBeGreaterThan(1);
    expect(st?.dotDps.slash).toBeGreaterThan(0);
    expect(r.vsEnemy?.sustainedDps).toBeGreaterThan(r.vsEnemy?.directSustainedDps ?? 0);
  });

  it("magnetic procs stack on shielded enemies", () => {
    // 冰冻+电击 → 磁力；堕落船员（原生Prot盾）有护盾可乘
    const crewman = { spec: ENEMIES[2], level: 150 };
    const r = computeBuild(weapon("Braton Prime"), [byName("Serration"), byName("Cryo Rounds"), byName("Stormbringer")], null, crewman);
    expect(r.vsEnemy?.shield).toBeGreaterThan(0);
    expect(r.vsEnemy?.status?.magneticStacks).toBeGreaterThan(1);
    expect(r.vsEnemy?.status?.magneticMul).toBeGreaterThan(1);
  });
});
