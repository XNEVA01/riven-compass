/**
 * warframe.market 行情数据：类型、词条映射、加载。
 *
 * market.json 由服务器管线每日产出，部署在同源 `/data/market.json`
 * （主站与 /preview/ 共用同一份，前端按 meta.generated_at 判断新鲜度，
 * 因此这里运行时 fetch 而不是打进 bundle——数据每日刷新，应用不必重发）。
 */
import { type Lang, type RivenClass, statsOf } from "../engine/data";
import { remapTag, statName } from "../state";

export interface MarketPrice {
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
}

export interface MarketCombo {
  count: number;
  median_price: number;
  min_price: number;
  max_price: number;
  re_rolls_mean: number | null;
  age_days_median: number;
  pos: string[];
  neg: string[];
  /**
   * 「从零洗到该组合」的期望赤毒（服务器管线 solve.cjs 预算，与前端 worker 同一条数学）：
   * null = 映射不进类/不可达；字段缺席 = 未预算（旧数据），行情页 worker 现算兜底。
   */
  cost_kuva?: number | null;
}

export interface MarketWeapon {
  name: { en: string; zh: string; tc: string; cn: string };
  cls: string;
  n_total: number;
  n_active: number;
  n_stale: number;
  n_private: number;
  n_no_price: number;
  n_hidden: number;
  price?: MarketPrice;
  freshness_days?: number;
  re_rolls_mean?: number | null;
  combos?: MarketCombo[];
  /** DE 官方周成交（管线从社区归档聚合，每周一随 cron 更新；缺 = 该周无成交记录） */
  de?: DeStats;
}

/** DE 周成交的 洗过/未洗 分组（spec §3.1：rerolled 维度对商人有价值） */
export interface DeGroup {
  pop: number;
  median: number | null;
}

/** DE 官方周成交（全渠道真实成交，武器级；与 WM 挂单供给互补构成周转指数） */
export interface DeStats {
  /** 周成交笔数（unrolled + rerolled） */
  pop: number;
  /** pop 加权成交中位价 */
  median: number | null;
  unrolled?: DeGroup;
  rerolled?: DeGroup;
}

export interface MarketMeta {
  generated_at: string;
  scan_date: string;
  source: string;
  filters: { max_age_days: number; combo_min_count: number; top_combos: number };
  counts: {
    weapons: number;
    weapons_with_listings: number;
    listings_active: number;
    listings_stale: number;
  };
  /** DE 周成交的周标识与命中面（拉不到时管线写 null，schema 向后兼容） */
  de?: { week: string; weapons: number; trades: number } | null;
  /** 组合成本预计算覆盖率（solve.cjs 跑过才有；失败写 null，前端退化到 worker 兜底） */
  costs?: { rows: number; costed: number; nulls: number; ms: number; solved?: number; cached?: number } | null;
}

export interface Market {
  meta: MarketMeta;
  attributes: string[];
  weapons: Record<string, MarketWeapon>;
}

/** 行情数据里的武器类别（聚合时来自 game.json，与 RivenClass 同源） */
export type MarketClass = RivenClass;

export const MARKET_CLASSES: readonly MarketClass[] = ["Rifle", "Shotgun", "Pistol", "Kitgun", "Archgun", "Melee", "Zaw"];

export function isMeleeCls(cls: string): boolean {
  return cls === "Melee" || cls === "Zaw";
}

/**
 * WM 词条 url_name → 游戏 StatDef tag。
 * 元组为 [远程系, 近战系]：faction 伤害与基础伤害两系 tag 不同，其余共用。
 * null = 该系武器没有此词条（如近战无多重射击）。
 */
export const WM_TAG: Record<string, readonly [string | null, string | null]> = {
  ammo_efficiency: ["WeaponAmmoEfficiency", null],
  ammo_maximum: ["WeaponAmmoMaxMod", null],
  "base_damage_/_melee_damage": ["WeaponDamageAmountMod", "WeaponMeleeDamageMod"],
  blast: ["WeaponBlastDamageMod", "WeaponBlastDamageMod"],
  chance_to_gain_combo_count: [null, "WeaponMeleeComboPointsOnHitMod"],
  chance_to_gain_extra_combo_count: [null, "WeaponMeleeComboBonusOnHitMod"],
  // legacy 名：Melee 3.0 后 Channeling Damage/Efficiency → 重击伤害/重击效率
  channeling_damage: [null, "WeaponMeleeHeavyAttackDamageMod"],
  channeling_efficiency: [null, "WeaponMeleeComboEfficiencyMod"],
  cold_damage: ["WeaponFreezeDamageMod", "WeaponFreezeDamageMod"],
  combo_duration: [null, "ComboDurationMod"],
  corrosive: ["WeaponCorrosiveDamageMod", "WeaponCorrosiveDamageMod"],
  critical_chance: ["WeaponCritChanceMod", "WeaponCritChanceMod"],
  critical_chance_on_slide_attack: [null, "SlideAttackCritChanceMod"],
  critical_damage: ["WeaponCritDamageMod", "WeaponCritDamageMod"],
  damage_to_orokin: ["WeaponFactionDamageOrokin", "WeaponFactionDamageOrokin"],
  damage_to_scaldra: ["WeaponFactionDamageScaldra", "WeaponFactionDamageScaldra"],
  damage_to_techrot: ["WeaponFactionDamageTechrot", "WeaponFactionDamageTechrot"],
  damage_vs_corpus: ["WeaponFactionDamageCorpus", "WeaponMeleeFactionDamageCorpus"],
  damage_vs_grineer: ["WeaponFactionDamageGrineer", "WeaponMeleeFactionDamageGrineer"],
  damage_vs_infested: ["WeaponFactionDamageInfested", "WeaponMeleeFactionDamageInfested"],
  electric_damage: ["WeaponElectricityDamageMod", "WeaponElectricityDamageMod"],
  finisher_damage: [null, "WeaponMeleeFinisherDamageMod"],
  "fire_rate_/_attack_speed": ["WeaponFireRateMod", "WeaponFireRateMod"],
  gas: ["WeaponGasDamageMod", "WeaponGasDamageMod"],
  heat_damage: ["WeaponFireDamageMod", "WeaponFireDamageMod"],
  heavy_attack_wind_up_speed: [null, "WeaponMeleeHeavyAttackChargeMod"],
  impact_damage: ["WeaponImpactDamageMod", "WeaponImpactDamageMod"],
  magazine_capacity: ["WeaponClipMaxMod", null],
  magazine_reloaded_s_when_holstered: ["WeaponMagazineReloadHolstered", null],
  magnetic: ["WeaponMagneticDamageMod", "WeaponMagneticDamageMod"],
  melee_damage_on_heavy_attack: [null, "WeaponMeleeHeavyAttackDamageMod"],
  multishot: ["WeaponFireIterationsMod", null],
  parry_angle: [null, "WeaponMeleeParryAngleMod"],
  projectile_speed: ["WeaponProjectileSpeedMod", "WeaponProjectileSpeedMod"],
  punch_through: ["WeaponPunctureDepthMod", "WeaponPunctureDepthMod"],
  puncture_damage: ["WeaponArmorPiercingDamageMod", "WeaponArmorPiercingDamageMod"],
  radiation: ["WeaponRadiationDamageMod", "WeaponRadiationDamageMod"],
  range: [null, "WeaponMeleeRangeIncMod"],
  recoil: ["WeaponRecoilReductionMod", null],
  reload_speed: ["WeaponReloadSpeedMod", "WeaponReloadSpeedMod"],
  slam_attack_damage: [null, "WeaponMeleeSlamDamageMod"],
  slash_damage: ["WeaponSlashDamageMod", "WeaponSlashDamageMod"],
  status_chance: ["WeaponStunChanceMod", "WeaponStunChanceMod"],
  status_damage: ["WeaponStatusDamage", "WeaponStatusDamage"],
  status_duration: ["WeaponProcTimeMod", "WeaponProcTimeMod"],
  toxin_damage: ["WeaponToxinDamageMod", "WeaponToxinDamageMod"],
  viral: ["WeaponViralDamageMod", "WeaponViralDamageMod"],
  weak_point_critical_chance: ["WeaponWeakpointCriticalChance", "WeaponWeakpointCriticalChance"],
  weak_point_damage: ["WeaponWeakpointDamage", "WeaponWeakpointDamage"],
  zoom: ["WeaponZoomFovMod", "WeaponZoomFovMod"],
};

/** WM url_name → 该武器类别的游戏 tag；null = 未收录（新词条，UI 需回退显示原名） */
export function wmTag(cls: string, url: string): string | null {
  const pair = WM_TAG[url];
  if (!pair) return null;
  const [gun, melee] = pair;
  return isMeleeCls(cls) ? (melee ?? gun) : (gun ?? melee);
}

/** WM url_name → 本地化显示名；未收录或该类无此词条时返回 null */
export function wmStatName(cls: string, url: string, lang: Lang): string | null {
  const tag = wmTag(cls, url);
  if (!tag) return null;
  // tag 可能不属于这个类（如近战武器上的 multishot）——remapTag 按名字跨类找回
  if (!statsOf(cls as RivenClass).some((s) => s.tag === tag)) {
    const remapped = remapTag(cls as RivenClass, tag);
    if (!remapped) return null;
    return statName(cls as RivenClass, remapped, lang);
  }
  return statName(cls as RivenClass, tag, lang);
}

/**
 * DE 数据周 ISO 标签（如 2026-W44）→ 该周周一与「数据已更新到」的日期（2026-10-26 / 2026-10-28）。
 * ISO 8601：1 月 4 日恒落在第 1 周，据此定 W1 周一再偏移。
 * asOf = meta.generated_at 的日期部分：数据自周一逐日更新到该日（周日收满整周），
 * 越过周日或早于周一时夹回 [周一, 周日]；缺省或不是日期则给整周（周一～周日）。
 * ISO 标签解析不了返回 null，调用方回退原标签。
 */
export function isoWeekRange(iso: string, asOf?: string): { start: string; end: string } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(iso);
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const dow = new Date(jan4).getUTCDay() || 7; // getUTCDay 周日=0，ISO 周日=7
  const monday = jan4 - (dow - 1) * 86400000 + (Number(m[2]) - 1) * 604800000;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const start = day(monday);
  const sunday = day(monday + 6 * 86400000);
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return { start, end: sunday };
  const asOfT = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(asOfT)) return { start, end: sunday };
  const end = day(Math.min(Math.max(asOfT, Date.parse(`${start}T00:00:00Z`)), Date.parse(`${sunday}T00:00:00Z`)));
  return { start, end };
}

export async function loadMarket(): Promise<Market> {
  const res = await fetch("/data/market.json");
  if (!res.ok) throw new Error(`market.json HTTP ${res.status}`);
  const m = (await res.json()) as Market;
  // 形状守卫（代码审查 P2）：管线自家产出且原子写，但「合法 JSON 错结构」不该把行情页摔成白屏
  if (!asMarket(m)) throw new Error("market.json 结构异常（缺 meta/weapons）");
  cacheMarket(m, Date.now());
  return m;
}

/** 形状守卫：缺 meta/weapons 或 weapons 不是映射的结构一概不认（缓存与网络共用同一套判断） */
function asMarket(m: unknown): Market | null {
  const x = m as Market;
  return typeof x?.meta?.generated_at === "string" && x.weapons != null && !Array.isArray(x.weapons) ? x : null;
}

// 上次成功拉取的行情缓存在 localStorage：打开行情页先渲染它（P0-5 秒开），后台拉新后替换。
// v1 = market.json 现行 schema 的缓存版本，字段结构变化时 +1，旧缓存自然作废。
const CACHE_KEY = "riven-roll:market:v1";

function cacheMarket(m: Market, at: number) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at, market: m }));
  } catch {
    // 存储满或被禁：秒开退回骨架屏，页面照常工作
  }
}

/** 上次缓存的行情与拉取时刻；没有或读不出为 null（首次访问、清了存储、schema 换代） */
export function readCachedMarket(): { market: Market; at: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { at?: unknown; market?: unknown };
    if (typeof c.at !== "number") return null;
    const market = asMarket(c.market);
    return market ? { at: c.at, market } : null;
  } catch {
    return null;
  }
}

let marketOnce: Promise<Market> | null = null;

/**
 * 行情一次加载多页共用（行情页 + 主页利润 panel）；失败清缓存，让「重试」再拉。
 * 只缓存成功：负缓存会让断网后的重试也拿到失败。
 */
export function loadMarketOnce(): Promise<Market> {
  if (!marketOnce) {
    marketOnce = loadMarket().catch((error: unknown) => {
      marketOnce = null;
      throw error;
    });
  }
  return marketOnce;
}
