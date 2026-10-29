/**
 * costCore.ts（V3b 起，跨武器利润榜起与管线 CLI 共享）测试：从零洗的起点卡与请求构造的语义，
 * 加一次主线程 Planner 集成——对 fixture 头号组合发出的「从零洗」请求必须可解，
 * 且最优路线均值是解析解（两次求解完全一致）。worker 队列不在 node 里跑（无 Worker）。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import market from "../data/market.json";
import { GAME, type RivenClass, statsOf } from "../engine/data";
import { Planner, type RouteStats } from "../engine/planner";
import { GAME_SHA256 } from "../pipeline/game.stamp";
import { bestRouteKuva, comboRequest, costKey, junkStart, RUNS } from "./costCore";
import { comboTags } from "./profit";
import { rankWeapons } from "./stats";
import type { Market, MarketCombo } from "./wm";

const m = market as unknown as Market;

const C = (pos: string[], neg: string[] = []): MarketCombo => ({ pos, neg, count: 5, median_price: 400, min_price: 100, max_price: 900, re_rolls_mean: 3, age_days_median: 2 });

describe("costKey", () => {
  it("tells a combo apart by weapon and by traits", () => {
    const c = C(["cold_damage", "toxin_damage"]);
    expect(costKey("glaxion", c)).toBe(costKey("glaxion", c));
    expect(costKey("glaxion", c)).not.toBe(costKey("boltor", c));
    expect(costKey("glaxion", c)).not.toBe(costKey("glaxion", C(["cold_damage", "electric_damage"])));
    expect(costKey("glaxion", c)).not.toBe(costKey("glaxion", C(["cold_damage", "toxin_damage"], ["zoom"])));
  });
});

describe("junkStart", () => {
  it("builds a 3+0 start of plain buffs that have nothing to do with the target", () => {
    const cls: RivenClass = "Rifle";
    const avoid = new Set(["WeaponCritChanceMod", "WeaponCritDamageMod", "WeaponFireIterationsMod", "WeaponZoomFovMod"]);
    const card = junkStart(cls, avoid);
    if (!card) throw new Error("the rifle pool must have three bystander buffs");
    expect(`${card.layout.pos}${card.layout.neg}`).toBe("30");
    expect(card.neg).toBeNull();
    expect(card.pos).toHaveLength(3);
    for (const t of card.pos) {
      expect(avoid.has(t.tag)).toBe(false);
      const def = statsOf(cls).find((d) => d.tag === t.tag);
      expect(def?.buff).toBe(true);
      expect(def?.spliced).toBeFalsy();
    }
  });

  it("finds bystanders on every class the market lists", () => {
    for (const cls of ["Rifle", "Shotgun", "Pistol", "Melee"] as RivenClass[]) {
      // 一组想象目标：池子前四个词条全占
      const avoid = statsOf(cls)
        .filter((d) => d.buff && !d.spliced)
        .slice(0, 4)
        .map((d) => d.tag);
      expect(junkStart(cls, avoid)).not.toBeNull();
    }
  });
});

describe("bestRouteKuva", () => {
  const route = (optimal: boolean, mean: number) => ({ route: { optimal }, kuva: { mean } }) as unknown as RouteStats;

  it("takes the optimal route, then the first", () => {
    expect(bestRouteKuva([route(false, 50), route(true, 100)])).toBe(100);
    expect(bestRouteKuva([route(false, 50)])).toBe(50);
    expect(bestRouteKuva([])).toBeNull();
  });
});

describe("comboRequest, end to end against the fixture", () => {
  it("asks the planner for a solvable plan whose mean is exact", () => {
    // fixture 数据每日刷新：按热度找到首个能映射进词条池的头号组合（与主页实测的 Glaxion 一路）
    const top = rankWeapons(m, { sort: "combos" })
      .flatMap((r) => r.w.combos?.map((c) => ({ w: r.w, c })) ?? [])
      .find(({ w, c }) => {
        const id = GAME.weapons.find((x) => x.name.en === w.name.en)?.id;
        return id != null && comboTags(w.cls as RivenClass, c) != null;
      });
    if (!top) throw new Error("the fixture should have a mappable top combo");
    const weapon = GAME.weapons.find((x) => x.name.en === top.w.name.en);
    if (!weapon) throw new Error("the market's en name should come from game.json");
    const cls = top.w.cls as RivenClass;
    const tags = comboTags(cls, top.c);
    if (!tags) throw new Error("the combo should map");

    const req = comboRequest(1, weapon.id, cls, top.c);
    if (!req) throw new Error("the combo should become a plan request");
    // 商人问的是成本：kuva 目标、从零环起步、无预算、小样本只喂分位数
    expect(req.objective).toBe("kuva");
    expect(req.cyclesDone).toBe(0);
    expect(req.budget).toBeNull();
    expect(req.runs).toBeGreaterThan(0);
    // 目标与「填入目标」同构：每正词条一行，any 档，布局精确到组合
    expect(req.target.groups).toHaveLength(tags.pos.length);
    expect(`${req.target.layouts[0].pos}${req.target.layouts[0].neg}`).toBe(`${tags.pos.length}${tags.neg.length}`);
    // 起点卡的词条与组合无关，环数从零起（头九环的入门价）
    expect(req.card.pos).toHaveLength(3);
    expect(req.card.pos.every((t) => !tags.pos.includes(t.tag) && t.tag !== tags.neg[0])).toBe(true);

    const plan = new Planner().plan(req);
    if (!plan.ok) throw new Error(`plan failed: ${plan.error}`);
    expect(plan.reachable).toBe(true);
    if (!plan.routes.length) throw new Error("a fresh start should have routes");
    const mean = bestRouteKuva(plan.routes);
    expect(mean).not.toBeNull();
    expect(mean).toBeGreaterThan(0);

    // 最优路线的均值是解析解：第二个求解器给出同一个数字（模拟才有随机，均值没有）
    const again = new Planner().plan({ ...req, id: 2 });
    if (!again.ok || !again.routes.length) throw new Error("the same request should plan again");
    expect(bestRouteKuva(again.routes)).toBe(mean);
  });

  it("returns null for a combo whose traits do not map into the class", () => {
    // 近战没有多重射击：这条组合映射不进词条池，也就没有可发的请求
    expect(comboRequest(3, "whatever", "Melee", C(["multishot", "melee_damage"]))).toBeNull();
  });
});

describe("pipeline parity (V3d 跨武器利润榜)", () => {
  it("game.stamp equals the sha256 of the bundled game.json (build-data.py / build-solve.sh regenerate it)", () => {
    const sha = createHash("sha256")
      .update(readFileSync(new URL("../data/game.json", import.meta.url)))
      .digest("hex");
    expect(GAME_SHA256).toBe(sha);
  });
  /** fixture 头号可解组合的 (武器id, cls, 组合)，与 CLI 的求解单元同构 */
  const firstSolvable = (): { id: string; cls: RivenClass; c: MarketCombo } => {
    for (const r of rankWeapons(m, { sort: "combos" })) {
      const id = GAME.weapons.find((x) => x.name.en === r.w.name.en)?.id;
      if (id == null) continue;
      const cls = r.w.cls as RivenClass;
      for (const c of r.w.combos ?? []) {
        if (comboTags(cls, c) != null && comboRequest(1, id, cls, c) != null) return { id, cls, c };
      }
    }
    throw new Error("the fixture should have at least one solvable combo");
  };

  it("runs only feeds quantiles: the pipeline's runs=1 and the front end's RUNS share one mean", () => {
    const { id, cls, c } = firstSolvable();
    const once = comboRequest(1, id, cls, c, 1);
    const many = comboRequest(2, id, cls, c, RUNS);
    if (!once || !many) throw new Error("the combo should map both ways");
    expect(many.runs).not.toBe(once.runs);
    const a = new Planner().plan(once);
    const b = new Planner().plan(many);
    if (!a.ok || !b.ok) throw new Error("both plans should solve");
    expect(bestRouteKuva(b.routes)).toBe(bestRouteKuva(a.routes));
  });

  it("same pool signature weapons cost the same for the same combo (the pipeline's dedup basis)", () => {
    // 池签名 = comboRequest 间接读到的全部池字段（engine/pool.ts 的 poolFor）
    const sig = (w: (typeof GAME.weapons)[number]) => JSON.stringify([w.cls, w.also, w.tags, w.sentinel, w.grimoire, w.ips]);
    const bySig = new Map<string, (typeof GAME.weapons)[number]>();
    let pair: [(typeof GAME.weapons)[number], (typeof GAME.weapons)[number]] | null = null;
    for (const w of GAME.weapons) {
      const s = sig(w);
      const prev = bySig.get(s);
      if (prev) {
        pair = [prev, w];
        break;
      }
      bySig.set(s, w);
    }
    if (!pair) throw new Error("game.json should contain signature-colliding weapons");
    const [w1, w2] = pair;
    const cls = w1.cls as RivenClass;
    // 2+0 是合法布局（1+0 不是）；暴击/爆伤在全类别词条池里都有
    const c = C(["critical_chance", "critical_damage"]);
    const cost = (id: string): number | null => {
      const req = comboRequest(1, id, cls, c, 1);
      if (!req) return null;
      const res = new Planner().plan(req);
      return res.ok ? (res.done ? 0 : res.reachable ? bestRouteKuva(res.routes) : null) : null;
    };
    const a = cost(w1.id);
    const b = cost(w2.id);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  // fixture 还是旧产物（无 cost_kuva 行）时跳过；rsync 新 fixture 后必须真正跑起来
  const costedSamples = (() => {
    const out: Array<{ id: string; cls: RivenClass; c: MarketCombo }> = [];
    for (const r of rankWeapons(m, { sort: "combos" })) {
      const id = GAME.weapons.find((x) => x.name.en === r.w.name.en)?.id;
      if (id == null) continue;
      for (const c of r.w.combos ?? []) {
        if (c.cost_kuva != null) out.push({ id, cls: r.w.cls as RivenClass, c });
      }
    }
    return out;
  })();

  it.skipIf(costedSamples.length === 0)("fixture cost_kuva equals a local recompute (pipeline ↔ front end parity)", () => {
    // 服务器管线预算的 cost_kuva 必须与前端同一条数学的本地复算一致（与 solve.cjs 相同取法）
    expect(costedSamples.length).toBeGreaterThan(50);
    const step = Math.max(1, Math.floor(costedSamples.length / 12));
    for (let i = 0; i < costedSamples.length; i += step) {
      const { id, cls, c } = costedSamples[i];
      const req = comboRequest(1, id, cls, c, 1);
      expect(req).not.toBeNull();
      if (!req) continue;
      const res = new Planner().plan(req);
      const again = res.ok ? (res.done ? 0 : res.reachable ? bestRouteKuva(res.routes) : null) : null;
      expect(again).not.toBeNull();
      // 同一条数学、同输入：JSON 往返不丢精度，浮点逐位一致；相对 epsilon 只防枚举次序的极端平局
      if (again != null) expect(Math.abs(again - (c.cost_kuva ?? 0))).toBeLessThanOrEqual(Math.max(1, Math.abs(again)) * 1e-9);
    }
  });
});
