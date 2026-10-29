/**
 * Market layer tests against the real market.json fixture (server pipeline output).
 * Assertions stay relational (no hardcoded weapon counts — the file refreshes daily).
 */
import { afterEach, describe, expect, it } from "vitest";
import market from "../data/market.json";
import { CLASSES, GAME } from "../engine/data";
import { DEFAULT_WAGE } from "./profit";
import { bestCombo, bestProfit, hotCombos, marketAgeHours, rankWeapons, shownCombos, turnover } from "./stats";
import { familyEn, lookupMarket } from "./variants";
import { isoWeekRange, loadMarket, type Market, type MarketCombo, type MarketWeapon, WM_TAG, wmStatName } from "./wm";

const m = market as unknown as Market;

describe("fixture sanity", () => {
  it("meta counts agree with the weapon table", () => {
    expect(Object.keys(m.weapons)).toHaveLength(m.meta.counts.weapons);
    expect(m.meta.counts.weapons).toBeGreaterThan(100);
    for (const w of Object.values(m.weapons)) {
      expect(w.n_active).toBeGreaterThan(0);
      expect(CLASSES.includes(w.cls as (typeof CLASSES)[number])).toBe(true);
    }
  });

  it("is fresh enough to develop against (generated within a week)", () => {
    expect(marketAgeHours(m)).toBeLessThan(24 * 7);
  });
});

describe("WM attribute mapping", () => {
  it("covers every attribute url_name the pipeline has ever seen", () => {
    const missing = m.attributes.filter((a) => !(a in WM_TAG));
    expect(missing).toEqual([]);
  });

  it("every mapped tag exists in game.json (ground truth)", () => {
    const known = new Set<string>(Object.values(GAME.classes).flatMap((c) => c.stats.map((s) => s.tag)));
    for (const [url, pair] of Object.entries(WM_TAG)) {
      for (const tag of pair) {
        if (tag != null) {
          expect(known.has(tag), `${url} -> ${tag}`).toBe(true);
        }
      }
    }
  });

  it("splits gun/melee tags where they differ", () => {
    expect(WM_TAG["base_damage_/_melee_damage"]).toEqual(["WeaponDamageAmountMod", "WeaponMeleeDamageMod"]);
    expect(WM_TAG.damage_vs_grineer[1]).toBe("WeaponMeleeFactionDamageGrineer");
    expect(WM_TAG.multishot[1]).toBeNull();
    expect(WM_TAG.range[0]).toBeNull();
  });

  it("resolves display names per class, falls back cross-class by name", () => {
    expect(wmStatName("Rifle", "critical_chance", "zh")).toBe("暴击几率");
    expect(wmStatName("Melee", "base_damage_/_melee_damage", "zh")).toBe("近战伤害");
    expect(wmStatName("Rifle", "base_damage_/_melee_damage", "zh")).toBe("伤害");
    expect(wmStatName("Zaw", "range", "zh")).toBeTruthy();
    // unknown url → null (UI falls back to the raw name)
    expect(wmStatName("Rifle", "not_a_real_attr", "zh")).toBeNull();
  });
});

describe("rankWeapons", () => {
  it("default liquidity sort is monotonic", () => {
    const rows = rankWeapons(m);
    expect(rows).toHaveLength(Object.keys(m.weapons).length);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].w.n_active).toBeGreaterThanOrEqual(rows[i].w.n_active);
    }
  });

  it("filters by class and search, honors limit", () => {
    const melee = rankWeapons(m, { cls: "Melee" });
    expect(melee.length).toBeGreaterThan(0);
    expect(melee.every((r) => r.w.cls === "Melee")).toBe(true);
    const q = rankWeapons(m, { search: "nukor" });
    expect(q.length).toBeGreaterThan(0);
    expect(q.some((r) => r.w.name.en === "Kuva Nukor" || r.w.name.en === "Nukor")).toBe(true);
    expect(rankWeapons(m, { limit: 5 })).toHaveLength(5);
  });

  it("price sort sinks weapons without a price block", () => {
    const rows = rankWeapons(m, { sort: "price" });
    const priceless = rows.findIndex((r) => !r.w.price);
    if (priceless >= 0) {
      expect(rows.slice(priceless).every((r) => !r.w.price)).toBe(true);
      expect(rows[priceless - 1].w.price?.median).toBeGreaterThan(0);
    }
  });

  it("hot combos are sorted by count then price", () => {
    const top = rankWeapons(m, { sort: "combos", limit: 1 })[0];
    const combos = hotCombos(top.w);
    expect(combos.length).toBeGreaterThan(0);
    for (let i = 1; i < combos.length; i++) {
      const a = combos[i - 1];
      const b = combos[i];
      expect(a.count > b.count || (a.count === b.count && a.median_price >= b.median_price)).toBe(true);
    }
    expect(combos[0].pos.length).toBeGreaterThan(0);
  });

  it("search finds a row by a family variant's full name, but not by a partial one", () => {
    expect(rankWeapons(m, { search: "kuva nukor" }).some((r) => r.w.name.en === "Nukor")).toBe(true);
    expect(rankWeapons(m, { search: "bo prime" }).some((r) => r.w.name.en === "Bo")).toBe(true);
    // 本地化全名同样命中
    expect(rankWeapons(m, { search: "玻之武杖 prime" }).some((r) => r.w.name.en === "Bo")).toBe(true);
    // 只吃全名：半截词不吃别名，"prime" 这类泛词不把全部带变体的行都拉进来
    expect(rankWeapons(m, { search: "bo pri" }).some((r) => r.w.name.en === "Bo")).toBe(false);
  });

  it("turnover sort ranks by DE-pop-per-listing and sinks the nulls to the tail", () => {
    const rows = rankWeapons(m, { sort: "turnover" });
    const keys = rows.map((r) => turnover(r.w));
    const firstNull = keys.findIndex((k) => k == null);
    if (firstNull >= 0) {
      // null 全沉在尾部，且尾前一位仍是有效值
      expect(keys.slice(firstNull).every((k) => k == null)).toBe(true);
      if (firstNull > 0) expect(keys[firstNull - 1]).not.toBeNull();
    }
    for (let i = 1; i < (firstNull < 0 ? keys.length : firstNull); i++) {
      const a = keys[i - 1];
      const b = keys[i];
      if (a != null && b != null) expect(a).toBeGreaterThanOrEqual(b);
    }
  });
});

describe("turnover & DE weekly trades (V3d)", () => {
  it("turnover is DE pop ÷ active listings wherever both sides exist, null otherwise", () => {
    let both = 0;
    for (const w of Object.values(m.weapons)) {
      if (w.de?.pop && w.n_active > 0) {
        expect(turnover(w)).toBeCloseTo(w.de.pop / w.n_active);
        both++;
      } else {
        expect(turnover(w)).toBeNull();
      }
    }
    // fixture 关系基线：绝大多数行情武器本周都有 DE 成交记录
    expect(both).toBeGreaterThan(Object.keys(m.weapons).length / 2);
  });

  it("de.pop is exactly the sum of its rerolled groups", () => {
    for (const w of Object.values(m.weapons)) {
      if (!w.de) continue;
      expect((w.de.unrolled?.pop ?? 0) + (w.de.rerolled?.pop ?? 0)).toBe(w.de.pop);
    }
  });

  it("de.median is the pop-weighted blend of the group medians", () => {
    for (const w of Object.values(m.weapons)) {
      const { de } = w;
      if (!de?.median || !de.unrolled?.median || !de.rerolled?.median) continue;
      const blend = (de.unrolled.median * de.unrolled.pop + de.rerolled.median * de.rerolled.pop) / de.pop;
      expect(de.median).toBeCloseTo(blend, 0); // 管线 round 1 位小数
    }
  });

  it("meta.de agrees with the weapon table", () => {
    const withDe = Object.values(m.weapons).filter((w) => w.de);
    expect(m.meta.de?.weapons).toBe(withDe.length);
    expect(m.meta.de?.trades).toBe(withDe.reduce((s, w) => s + (w.de?.pop ?? 0), 0));
    expect(m.meta.de?.week).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("isoWeekRange turns the ISO label into the week's Monday–Sunday dates", () => {
    // 用户给的锚点：2026-W44 = 2026-10-26 至 2026-11-01
    expect(isoWeekRange("2026-W44")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    // 跨年边界：W1 的周一起始于上一年末（ISO 用 1 月 4 日定 W1）
    expect(isoWeekRange("2026-W01")).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    // 2026-01-01 是周四 → 该 ISO 年有 53 周，W53 的周日落到下一年
    expect(isoWeekRange("2026-W53")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    // 非 ISO 周标签（单 digit / 日期 / 空串）解析不动，调用方回退原样显示
    expect(isoWeekRange("2026-W4")).toBeNull();
    expect(isoWeekRange("2026-10-26")).toBeNull();
    expect(isoWeekRange("")).toBeNull();
  });

  it("isoWeekRange clamps the end to the day the data was actually updated (asOf)", () => {
    // 周内中段：从周一更新到 generated_at 那天（用户示例 2026-10-26至2026-10-28）
    expect(isoWeekRange("2026-W44", "2026-10-28")).toEqual({ start: "2026-10-26", end: "2026-10-28" });
    // 跨年的周同样从周一起算到更新日
    expect(isoWeekRange("2026-W01", "2025-12-30")).toEqual({ start: "2025-12-29", end: "2025-12-30" });
    // 更新日越过该周日（下周一才换周标签）→ 夹回周日
    expect(isoWeekRange("2026-W44", "2026-11-03")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    // 更新日早于周一（管线时钟异常）→ 区间收在起点
    expect(isoWeekRange("2026-W44", "2026-10-20")).toEqual({ start: "2026-10-26", end: "2026-10-26" });
    // asOf 不是日期（乱串 / 形似日期但非法）或为空 → 回退整周
    expect(isoWeekRange("2026-W44", "not-a-date")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(isoWeekRange("2026-W44", "2026-13-40")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(isoWeekRange("2026-W44", "")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
  });
});

describe("variant → family market fallback", () => {
  it("strips variant tokens only when the rest is a real weapon", () => {
    expect(familyEn("Bo Prime")).toBe("Bo");
    expect(familyEn("Kuva Nukor")).toBe("Nukor");
    expect(familyEn("Telos Boltor")).toBe("Boltor");
    expect(familyEn("MK1-Braton")).toBe("Braton");
    expect(familyEn("Mara Detron")).toBe("Detron");
    expect(familyEn("Carmine Penta")).toBe("Penta");
    expect(familyEn("Prime Laser Rifle")).toBe("Laser Rifle");
    // 没有基础武器的变体自己就是紫卡页主，不剥
    expect(familyEn("Kuva Bramma")).toBe("Kuva Bramma");
    expect(familyEn("Dakra Prime")).toBe("Dakra Prime");
    expect(familyEn("Prisma Dual Decurions")).toBe("Prisma Dual Decurions");
    // 无变体词根的名字原样返回
    expect(familyEn("Arquebex")).toBe("Arquebex");
    expect(familyEn("Dark Split-Sword")).toBe("Dark Split-Sword");
  });

  it("is idempotent and never invents names, across every game weapon", () => {
    for (const w of GAME.weapons) {
      const f = familyEn(w.name.en);
      expect(
        GAME.weapons.some((x) => x.name.en === f),
        `${w.name.en} -> ${f}`,
      ).toBe(true);
      expect(familyEn(f), `${w.name.en} -> ${f}`).toBe(f);
    }
  });

  it("resolves a variant through the family base's row", () => {
    const bo = lookupMarket(m, "Bo Prime");
    expect(bo?.en).toBe("Bo");
    expect(bo?.w.name.en).toBe("Bo");
    // 站点 demo 武器：V3a 之前显示「暂无在架行情」，现在挂靠到 Epitaph
    expect(lookupMarket(m, "Epitaph Prime")?.en).toBe("Epitaph");
    expect(lookupMarket(m, "Kuva Nukor")?.en).toBe("Nukor");
    // 直接命中不带挂靠标记
    expect(lookupMarket(m, "Nukor")?.en).toBe("Nukor");
    expect(lookupMarket(m, "Not a Weapon")).toBeNull();
  });

  it("family fallback only ever adds coverage over the direct names", () => {
    const direct = GAME.weapons.filter((w) => lookupMarket(m, w.name.en)?.en === w.name.en).length;
    const resolvable = GAME.weapons.filter((w) => lookupMarket(m, w.name.en) !== null).length;
    // 挂靠只能把「查得到行情」的武器变多，不会把直接命中的变没
    expect(resolvable).toBeGreaterThan(direct + 100);
    // 每个挂靠结果都恰是家族基础武器的行
    for (const w of GAME.weapons) {
      const hit = lookupMarket(m, w.name.en);
      if (hit && hit.en !== w.name.en) expect(hit.en).toBe(familyEn(w.name.en));
    }
  });
});

describe("cross-weapon profit ranking (V3d)", () => {
  const combo = (cost_kuva: number | null | undefined, median_price: number): MarketCombo => ({
    count: 5,
    median_price,
    min_price: 1,
    max_price: 9,
    re_rolls_mean: 0,
    age_days_median: 1,
    pos: ["critical_chance"],
    neg: [],
    ...(cost_kuva === undefined ? {} : { cost_kuva }),
  });

  const W = (en: string, combos: MarketCombo[]): MarketWeapon => ({
    name: { en, zh: en, tc: en, cn: en },
    cls: "Rifle",
    n_total: 10,
    n_active: 10,
    n_stale: 0,
    n_private: 0,
    n_no_price: 0,
    n_hidden: 0,
    combos,
  });

  const mk = (weapons: Record<string, MarketWeapon>): Market => ({ ...m, weapons });

  it("bestProfit takes the best median−cost combo, skipping null and unbudgeted rows", () => {
    // 默认时薪 10k 赤毒/时、30 白金/时：100k 赤毒=300 白金，200k=600
    const w = W("A", [combo(100_000, 500), combo(200_000, 900), combo(null, 1000), combo(undefined, 400)]);
    expect(bestProfit(w, DEFAULT_WAGE)).toBe(300);
    // 全部不可算（求解不出或管线没预算）→ null（排序沉底）
    expect(bestProfit(W("B", [combo(null, 1000), combo(undefined, 400)]), DEFAULT_WAGE)).toBeNull();
    expect(bestProfit(W("C", []), DEFAULT_WAGE)).toBeNull();
  });

  it("bestProfit/bestCombo are one math; shownCombos always shows the profit-best combo", () => {
    const missing: string[] = [];
    let seen = 0;
    for (const w of Object.values(m.weapons)) {
      const best = bestCombo(w, DEFAULT_WAGE);
      expect(bestProfit(w, DEFAULT_WAGE)).toBe(best?.profit ?? null);
      const shown = shownCombos(w, DEFAULT_WAGE);
      expect(shown.length).toBeLessThanOrEqual(7);
      if (best == null) continue;
      seen++;
      const k = (c: MarketCombo) => `${c.pos.join("+")}|${c.neg.join("-")}`;
      if (!shown.some((c) => k(c) === k(best.c))) missing.push(w.name.en);
    }
    expect(missing).toEqual([]);
    // 全量预计算上线后，绝大多数武器都应能落到一个最优组合（fixture 是真实线上数据）
    expect(seen).toBeGreaterThan(100);
  });

  it("shownCombos appends the profit-best combo when it is not among the hot 6", () => {
    const cold = Array.from({ length: 7 }, (_, i) => combo(900_000, 100 + i)); // 热门但利润全负
    const star = { ...combo(100_000, 5000), pos: ["critical_damage"] }; // 冷门高价组合 = 行级数字的出处
    const appended = shownCombos(W("A", [...cold.slice(0, 6), star, ...cold.slice(6)]), DEFAULT_WAGE);
    expect(appended).toHaveLength(7);
    expect(appended[appended.length - 1].median_price).toBe(5000);
    // 最优已在热门前 6 内 → 不重复补挂
    expect(shownCombos(W("B", [star, ...cold.slice(0, 6)]), DEFAULT_WAGE)).toHaveLength(6);
  });

  it("profit sort is monotonic, sinks the un-solvable, and follows the wage", () => {
    const data = mk({
      a: W("A", [combo(100_000, 500)]),
      b: W("B", [combo(900_000, 2000)]),
      c: W("C", [combo(null, 999)]),
      d: W("D", [combo(undefined, 700)]),
    });
    // 默认时薪：a=500−300=200，b=2000−2700=−700 → a 在前
    const rows = rankWeapons(data, { sort: "profit", wage: DEFAULT_WAGE });
    expect(rows.slice(0, 2).map((r) => r.url)).toEqual(["a", "b"]);
    expect(
      rows
        .slice(2)
        .map((r) => bestProfit(r.w, DEFAULT_WAGE))
        .every((k) => k == null),
    ).toBe(true);
    // 时薪调贵（100k 赤毒/时）自洗近乎白捡：b=2000−270=1730 反超 a=500−30=470 → 排序与时薪联动
    const flipped = rankWeapons(data, { sort: "profit", wage: { kuvaPerHour: 100_000, platPerHour: 30 } });
    expect(flipped.slice(0, 2).map((r) => r.url)).toEqual(["b", "a"]);
  });

  it("profit sort over the fixture is monotonic in bestProfit and keeps nulls at the tail", () => {
    const rows = rankWeapons(m, { sort: "profit", wage: DEFAULT_WAGE });
    const keys = rows.map((r) => bestProfit(r.w, DEFAULT_WAGE));
    for (let i = 1; i < keys.length; i++) {
      if (keys[i - 1] == null) expect(keys[i]).toBeNull();
      else if (keys[i] != null) expect(keys[i - 1] as number).toBeGreaterThanOrEqual(keys[i] as number);
    }
  });
});

describe("loadMarket guards (代码审查 P2)", () => {
  const realFetch = globalThis.fetch;
  const respond = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as unknown as Response);
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("rejects a non-2xx response", async () => {
    globalThis.fetch = () => respond({}, false);
    await expect(loadMarket()).rejects.toThrow(/HTTP/);
  });

  it("rejects valid JSON with the wrong shape instead of crashing the page", async () => {
    globalThis.fetch = () => respond({ weapons: [] });
    await expect(loadMarket()).rejects.toThrow(/结构/);
  });

  it("accepts the fixture", async () => {
    globalThis.fetch = () => respond(m);
    await expect(loadMarket()).resolves.toBe(m);
  });
});
