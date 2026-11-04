/**
 * 元素合成顺序审计（Wiki Damage / Modding）：
 * 用一份**独立重写**的参考实现，遍历全部已收录武器 × 伪随机 MOD 组合 × 紫卡槽位，
 * 与引擎 computeBuild 的分属性结果逐项比对。参考实现只照 Wiki 规则写，不引用引擎的合成代码：
 *  1. MOD 按槽位序从左上到右下；同一元素多次出现合并到**首次出现**的槽位
 *  2. 固有元素永远排在最后；若卡组里有同名元素，则并入该元素首次出现的槽位
 *  3. 相邻两两配对成复合元素，落单者独立存在；配对增量相加
 */
import { describe, expect, it } from "vitest";
import combat from "../data/combat.json";
import type { DamageTypeKey, StatKey } from "./data";
import type { ModCard, WeaponPanel } from "./engine";
import { computeBuild } from "./engine";

const weapons = combat.weapons as unknown as WeaponPanel[];

type Ele = "heat" | "cold" | "elec" | "tox";
const ELES: Ele[] = ["heat", "cold", "elec", "tox"];
const TYPE: Record<Ele, DamageTypeKey> = { heat: "heat", cold: "cold", elec: "electricity", tox: "toxin" };
const PAIR: Record<string, DamageTypeKey> = {
  "cold+heat": "blast",
  "elec+heat": "radiation",
  "heat+tox": "gas",
  "cold+elec": "magnetic",
  "cold+tox": "viral",
  "elec+tox": "corrosive",
};
const COMPOUND: DamageTypeKey[] = ["blast", "corrosive", "gas", "magnetic", "radiation", "viral"];

/** 参考实现：槽位序列 + 固有元素 → 各分属性伤害 */
function reference(w: WeaponPanel, slots: Array<Partial<Record<Ele, number>>>): Partial<Record<DamageTypeKey, number>> {
  const entries: Array<{ ele: Ele; inc: number }> = [];
  const first = new Map<Ele, number>();
  const add = (ele: Ele, inc: number) => {
    if (inc <= 0) return;
    const i = first.get(ele);
    if (i == null) {
      first.set(ele, entries.length);
      entries.push({ ele, inc });
    } else {
      entries[i].inc += inc;
    }
  };
  for (const slot of slots) for (const e of ELES) add(e, slot[e] ?? 0);
  // 固有元素殿后（HCET），同名并入首现槽
  for (const e of ELES) {
    const base = (w.dmg as Record<string, number | undefined>)[TYPE[e]] ?? 0;
    if (base > 0) add(e, base / w.total);
  }
  const out: Partial<Record<DamageTypeKey, number>> = {};
  for (let i = 0; i < entries.length; i += 2) {
    const a = entries[i];
    const b = entries[i + 1];
    if (b) {
      const compound = PAIR[[a.ele, b.ele].sort().join("+")];
      if (compound) {
        out[compound] = (out[compound] ?? 0) + w.total * (a.inc + b.inc);
      } else {
        out[TYPE[a.ele]] = (out[TYPE[a.ele]] ?? 0) + w.total * a.inc;
        out[TYPE[b.ele]] = (out[TYPE[b.ele]] ?? 0) + w.total * b.inc;
      }
    } else {
      out[TYPE[a.ele]] = (out[TYPE[a.ele]] ?? 0) + w.total * a.inc;
    }
  }
  // 武器自带的复合元素直接透传（与配对无关）
  for (const c of COMPOUND) {
    const v = w.dmg[c] ?? 0;
    if (v > 0) out[c] = (out[c] ?? 0) + v;
  }
  return out;
}

/** 确定性伪随机（不依赖 Math.random，失败可复现） */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const modOf = (ele: Ele, inc: number, i: number): ModCard => ({
  id: `m${i}-${ele}`,
  zh: `m${i}`,
  en: `m${i}`,
  compat: "rifle",
  stats: { [ele]: inc } as Partial<Record<StatKey, number>>,
});

describe("元素合成顺序：引擎 vs Wiki 参考实现（全武器）", () => {
  it("任意 MOD 组合与紫卡槽位下分属性一致", () => {
    let cases = 0;
    for (const w of weapons) {
      const rand = rng(w.total * 7919 + w.en.length);
      for (let n = 0; n < 40; n++) {
        const count = 1 + Math.floor(rand() * 5);
        const slots: Array<Partial<Record<Ele, number>>> = [];
        const mods: ModCard[] = [];
        for (let i = 0; i < count; i++) {
          const ele = ELES[Math.floor(rand() * ELES.length)];
          const inc = [0.6, 0.9, 1.2][Math.floor(rand() * 3)];
          slots.push({ [ele]: inc });
          mods.push(modOf(ele, inc, i));
        }
        const rivenSlot = 1 + Math.floor(rand() * (count + 1));
        const useRiven = rand() < 0.5;
        const rivenEle = ELES[Math.floor(rand() * ELES.length)];
        const rivenInc = 0.9;
        if (useRiven) {
          slots.splice(rivenSlot - 1, 0, { [rivenEle]: rivenInc });
        }
        const want = reference(w, slots);
        const got = computeBuild(w, mods, useRiven ? { stats: { [rivenEle]: rivenInc } } : null, null, undefined, rivenSlot).dmg;

        for (const k of [...ELES.map((e) => TYPE[e]), ...COMPOUND]) {
          expect(got[k] ?? 0, `${w.en} #${n} ${k}`).toBeCloseTo(want[k] ?? 0, 3);
        }
        cases++;
      }
    }
    expect(cases).toBe(weapons.length * 40);
  });

  it("近战/Archgun 等未收录武器不在计算器里（武器表只有枪械）", () => {
    for (const w of weapons) expect(["rifle", "shotgun", "pistol"]).toContain(w.compat);
  });
});
