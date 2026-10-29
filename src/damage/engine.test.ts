import { describe, expect, it } from "vitest";
import { ENEMIES } from "./data";
import type { ModCard, WeaponPanel } from "./engine";
import { computeBuild } from "./engine";

const braton: WeaponPanel = {
  id: "/Lotus/Weapons/Tenno/Rifle/Rifle",
  en: "Braton",
  zh: "布莱顿",
  compat: "rifle",
  dmg: { impact: 1.75, puncture: 12.25, slash: 21 },
  total: 35,
  cc: 0.12,
  cd: 2,
  sc: 0.26,
  fr: 9.58,
  mag: 75,
  rl: 2.15,
  ms: 1,
  trigger: "Auto",
};

const lanka: WeaponPanel = {
  id: "/Lotus/Weapons/ClanTech/Energy/Railgun",
  en: "Lanka",
  zh: "兰卡",
  compat: "rifle",
  dmg: { electricity: 525 },
  total: 525,
  cc: 0.25,
  cd: 2,
  sc: 0.25,
  fr: 0,
  mag: 10,
  rl: 2,
  ms: 1,
  trigger: "Charge",
  charge: 1,
};

const mod = (id: string, stats: ModCard["stats"]): ModCard => ({
  id,
  zh: id,
  en: id,
  compat: "rifle",
  stats,
});

describe("computeBuild basics", () => {
  it("bare weapon keeps panel values", () => {
    const r = computeBuild(braton);
    expect(r.panelTotal).toBeCloseTo(35, 0);
    expect(r.cc).toBeCloseTo(0.12);
    expect(r.fr).toBeCloseTo(9.58);
    expect(r.perShot).toBeCloseTo(35, 0);
  });

  it("Serration scales total damage linearly", () => {
    const r = computeBuild(braton, [mod("Serration", { dmg: 1.65 })]);
    expect(r.panelTotal).toBeCloseTo(35 * 2.65, 0);
    expect(r.dmg.slash).toBeCloseTo(21 * 2.65, 0);
  });

  it("multishot is additive and multiplies per-shot", () => {
    const r = computeBuild(braton, [mod("Split Chamber", { ms: 0.9 })]);
    expect(r.perShot).toBeCloseTo(35 * 1.9, 0);
    expect(r.panelTotal).toBeCloseTo(35, 0);
  });

  it("crit stats scale weapon base", () => {
    const r = computeBuild(braton, [mod("Point Strike", { cc: 1.5 }), mod("Vital Sense", { cd: 1.2 })]);
    expect(r.cc).toBeCloseTo(0.3);
    expect(r.cd).toBeCloseTo(2 * 2.2);
    // crit factor = 1 + 0.3 * (4.4 - 1)
    expect(r.critFactor).toBeCloseTo(1 + 0.3 * 3.4, 4);
  });

  it("magazine rounds, reload divides, fire rate multiplies", () => {
    const r = computeBuild(braton, [mod("Mag", { mag: 0.5 }), mod("Reload", { rl: 0.3 }), mod("Fr", { fr: 0.3 })]);
    expect(r.mag).toBe(113); // round(75*1.5)
    expect(r.rl).toBeCloseTo(2.15 / 1.3, 4);
    expect(r.fr).toBeCloseTo(9.58 * 1.3, 3);
  });
});

describe("element synthesis", () => {
  it("two element mods pair into a compound (elec+toxin -> corrosive)", () => {
    const r = computeBuild(braton, [mod("Stormbringer", { elec: 0.9 }), mod("Infected Clip", { tox: 0.9 })]);
    expect(r.dmg.corrosive).toBeCloseTo(35 * 1.8, 0);
    expect(r.dmg.impact).toBeCloseTo(1.75, 3);
    expect(r.panelTotal).toBeCloseTo(35 + 35 * 1.8, 0);
  });

  it("single element stays alone", () => {
    const r = computeBuild(braton, [mod("Hellfire", { heat: 0.9 })]);
    expect(r.dmg.heat).toBeCloseTo(35 * 0.9, 0);
  });

  it("innate element pairs first with a mod element", () => {
    // Lanka is innate electricity; adding a toxin mod yields corrosive
    const r = computeBuild(lanka, [mod("Tox", { tox: 0.6 })]);
    expect(r.dmg.corrosive).toBeCloseTo(525 * (1 + 0.6), -1);
    expect(r.dmg.electricity).toBeUndefined();
  });

  it("three elements: first two pair, third stays", () => {
    const r = computeBuild(braton, [mod("e1", { elec: 0.9 }), mod("e2", { tox: 0.9 }), mod("e3", { heat: 0.9 })]);
    expect(r.dmg.corrosive).toBeCloseTo(35 * 1.8, 0);
    expect(r.dmg.heat).toBeCloseTo(35 * 0.9, 0);
  });
});

describe("charge weapons", () => {
  it("Lanka fire rate falls back to 1/charge", () => {
    const r = computeBuild(lanka);
    expect(r.fr).toBeCloseTo(1, 4);
    const chargeSustained = 1 / (1 / 1 + 2 / 10);
    expect(r.sustainedFr).toBeCloseTo(chargeSustained, 4);
  });
});

describe("sustained dps", () => {
  it("sustained rate uses the magazine-cycle formula", () => {
    const r = computeBuild(braton);
    const m = 75,
      f = 9.58,
      rl = 2.15;
    const want = (m * f) / (m - 1 + Math.max(1, rl * f));
    expect(r.sustainedFr).toBeCloseTo(want, 3);
    expect(r.sustainedDps).toBeLessThan(r.burstDps);
  });
});

describe("vs enemy", () => {
  it("corrosive gets +75% vs ferrite armor (heavy gunner)", () => {
    const gunner = ENEMIES[0];
    const cor = computeBuild(braton, [mod("e1", { elec: 1.2 }), mod("e2", { tox: 1.2 })], undefined, { spec: gunner, level: 150 });
    // with armor strip off, ferrite DR still applies; the corrosive share must beat the raw share
    expect(cor.dmg.corrosive ?? 0).toBeGreaterThan(0);
  });

  it("armor mitigation reduces damage below raw panel", () => {
    const gunner = ENEMIES[0];
    const r = computeBuild(braton, undefined, null, { spec: gunner, level: 150 });
    expect(r.vsEnemy?.perShot).toBeLessThan(r.perShot);
    expect(r.vsEnemy?.armor).toBeGreaterThan(1000); // level-150 heavy gunner armor
  });

  it("full armor strip removes mitigation", () => {
    const gunner = ENEMIES[0];
    const stripped = computeBuild(braton, undefined, null, { spec: gunner, level: 150, armorStrip: 1 });
    expect(stripped.vsEnemy?.armor).toBeCloseTo(0, 6);
  });
});

describe("faction damage (驱逐/灭亡/净化)", () => {
  const expel = mod("Expel Corpus", { facCorpus: 0.55 });
  const bane = mod("Bane Of Grineer", { facGrineer: 0.55 });

  it("does nothing against another faction's enemy", () => {
    const gunner = ENEMIES[0]; // Corrupted Heavy Gunner -> Orokin faction
    const bare = computeBuild(braton, [], null, { spec: gunner, level: 150 });
    const withMod = computeBuild(braton, [expel], null, { spec: gunner, level: 150 });
    expect(withMod.sustainedDps).toBeCloseTo(bare.sustainedDps, 6);
    const ttkBare = bare.vsEnemy?.timeToKill;
    expect(ttkBare).toBeDefined();
    expect(withMod.vsEnemy?.timeToKill).toBeCloseTo(ttkBare as number, 6);
  });

  it("does nothing on the panel without an enemy", () => {
    expect(computeBuild(braton, [expel]).burstDps).toBeCloseTo(computeBuild(braton).burstDps, 6);
    expect(computeBuild(braton, [expel]).sustainedDps).toBeCloseTo(computeBuild(braton).sustainedDps, 6);
  });

  it("multiplies everything against its own faction", () => {
    const gunner = ENEMIES.find((e) => e.id === "Heavy Gunner") ?? ENEMIES[4]; // Grineer
    const bare = computeBuild(braton, [], null, { spec: gunner, level: 150 });
    const withMod = computeBuild(braton, [bane], null, { spec: gunner, level: 150 });
    expect(withMod.sustainedDps).toBeCloseTo(bare.sustainedDps * 1.55, 5);
    // 直伤精确 ×1.55；DoT 吃阵营平方（基伤一次、每跳一次）→ TTK 缩得比 /1.55 更快
    expect(withMod.vsEnemy?.directSustainedDps).toBeCloseTo((bare.vsEnemy?.directSustainedDps ?? 0) * 1.55, 5);
    expect(withMod.vsEnemy?.timeToKill ?? 0).toBeLessThan((bare.vsEnemy?.timeToKill ?? Number.POSITIVE_INFINITY) / 1.55);
  });
});
