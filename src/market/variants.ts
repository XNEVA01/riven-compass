/**
 * 变体 → 家族基础武器的行情挂靠（spec §9.4 V3 遗留项）。
 *
 * warframe.market 的紫卡页按「家族基础武器」归档：Prime/Vandal/Wraith/Prisma/Dex/Ceti/Mara/
 * Carmine/MK1/Kuva/Tenet/Coda/六派系前缀的变体没有独立挂单页（管线负缓存实证：候选 slug
 * 全部 400，120 个），而紫卡本身就以基础武器为名——Karak 紫卡适用于 Karak Wraith 与 Kuva
 * Karak（pool.ts 的家族同源语义）。没有基础武器的变体（Kuva Bramma、Dakra Prime）自己就是
 * 紫卡页主，行情数据里直接命中，无需挂靠。
 *
 * 查询因此分两级：先按武器名直接命中，未命中再剥词根找基础武器——剥离结果必须是 game.json
 * 里的真实武器才生效，名字恰好撞车的外来名不会误伤。
 */
import { GAME } from "../engine/data";
import type { Market, MarketWeapon } from "./wm";

const VARIANT_PREFIXES = [
  "Prisma ",
  "Dex ",
  "Ceti ",
  "Mara ",
  "Carmine ",
  "Rakta ",
  "Sancti ",
  "Secura ",
  "Synoid ",
  "Telos ",
  "Vaykor ",
  "Kuva ",
  "Tenet ",
  "Coda ",
  "Prime ",
  "MK1-",
];
const VARIANT_SUFFIXES = [" Prime", " Vandal", " Wraith"];

const gameEn = new Set(GAME.weapons.map((w) => w.name.en));

/** 家族基础武器名：剥掉变体前后缀且结果是真实武器；剥不动（或本就是基础）时原样返回 */
export function familyEn(en: string): string {
  for (const p of VARIANT_PREFIXES) {
    if (en.startsWith(p) && gameEn.has(en.slice(p.length))) return en.slice(p.length);
  }
  for (const s of VARIANT_SUFFIXES) {
    if (en.endsWith(s) && gameEn.has(en.slice(0, -s.length))) return en.slice(0, -s.length);
  }
  return en;
}

export interface MarketLookup {
  w: MarketWeapon;
  /** 实际命中的行情武器名；与查询名不同即为变体挂靠（UI 据此注明） */
  en: string;
}

/** 武器名 → 行情行：直接命中，未命中挂靠到家族基础武器的行 */
export function lookupMarket(m: Market, en: string): MarketLookup | null {
  const idx = index(m);
  const direct = idx.byEn.get(en);
  if (direct) return { w: direct, en };
  const fam = familyEn(en);
  if (fam !== en) {
    const base = idx.byEn.get(fam);
    if (base) return { w: base, en: fam };
  }
  return null;
}

interface MarketIndex {
  byEn: Map<string, MarketWeapon>;
  /** 行 name.en → 家族变体的完整名（小写，含各语言）；搜索按变体全名精确命中 */
  aliases: Map<string, Set<string>>;
}

const indexCache = new WeakMap<Market, MarketIndex>();

function index(m: Market): MarketIndex {
  const cached = indexCache.get(m);
  if (cached) return cached;
  const byEn = new Map(Object.values(m.weapons).map((w) => [w.name.en, w]));
  const aliases = new Map<string, Set<string>>();
  for (const g of GAME.weapons) {
    const fam = familyEn(g.name.en);
    if (fam === g.name.en || !byEn.has(fam)) continue;
    const set = aliases.get(fam) ?? new Set<string>();
    for (const n of Object.values(g.name)) {
      if (n) set.add(n.toLowerCase());
    }
    aliases.set(fam, set);
  }
  const built = { byEn, aliases };
  indexCache.set(m, built);
  return built;
}

/** 搜索词是否精确命中某行情行的家族变体全名（不分大小写；只吃全名，泛词不泛滥） */
export function matchesFamilyAlias(m: Market, marketEn: string, q: string): boolean {
  return index(m).aliases.get(marketEn)?.has(q) ?? false;
}
