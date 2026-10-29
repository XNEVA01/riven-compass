/**
 * 行情页（P0-3 选品榜）：warframe.market 紫卡挂单行情 + 热门词条组合。
 *
 * 数据从同源 /data/market.json 运行时拉取（服务器 cron 每日刷新，应用不必重发），
 * 这里只做展示与排序；点击「设为目标」把武器交给主页 session，
 * 洗卡规划器（Target 系统）随即接管——选品到洗卡的闭环入口。
 * cn（国服）无 warframe.market，App 层门控整个 tab。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { GAME, type Lang, type RivenClass } from "../engine/data";
import { comboCost } from "../market/comboCost";
import { costKey } from "../market/costCore";
import { comboTags, costPlat, loadWage } from "../market/profit";
import { bestProfit, hotCombos, type MarketSort, marketAgeHours, rankWeapons, shownCombos, turnover } from "../market/stats";
import { isoWeekRange, loadMarketOnce, MARKET_CLASSES, type MarketCombo, type Market as MarketData, readCachedMarket, wmStatName } from "../market/wm";
import { Segmented } from "./controls";

interface Strings {
  title: string;
  source: string;
  loading: string;
  error: string;
  retry: string;
  freshHours: string;
  freshDays: string;
  sort: { liquidity: string; price: string; fresh: string; combos: string; turnover: string; profit: string };
  all: string;
  /** 同伴武器伪类 tab（game.json 里它们的大类仍是步枪/手枪，行情页单独一栏） */
  sentinel: string;
  search: string;
  listings: string;
  median: string;
  hot: string;
  noCombos: string;
  perListing: string;
  setTarget: string;
  fillTarget: string;
  /** 组合行利润数字的 title：自己洗到它的期望白金成本（|C| 占位） */
  profitHint: string;
  /** 热门组合标题旁的利润列说明 */
  profitNote: string;
  /** 行级利润列的口径：最优组合的利润 */
  profitRowNote: string;
  /** 表头两列的单位标注（白金） */
  platProfit: string;
  platPrice: string;
  /** 首屏渲染上次缓存数据时，新鲜度行旁的提示 */
  updating: string;
  /** 周转列的 title：指数构成（|P| 周成交笔数 |N| 在架挂单数） */
  turnoverHint: string;
  /** 展开详情的 DE 周成交行（|W| 数据周区间 |P| 笔数 |PU|/|PR| 未洗/洗过分组 |M| 成交中位） */
  deRow: string;
  /** 数据周的日期区间拼法（|A| 周一 |B| 数据更新到的日期），替代 ISO 标签给玩家看 */
  weekRange: string;
}

const num = (n: number) => Math.round(n).toLocaleString("en-US");

/** cachedAt = 这份数据来自 localStorage 里上次拉取的缓存（首屏秒开），网络拉新成功后消失 */
type Load = { kind: "loading" } | { kind: "error" } | { kind: "ok"; data: MarketData; cachedAt?: number };

export function Market({
  s,
  lang,
  onWeapon,
  onCombo,
}: {
  s: { market: Strings };
  lang: Lang;
  onWeapon: (id: string) => void;
  /** 组合级「填入目标」：武器 + 词条组合一起写进主页 session（词条映射不进该类别时按钮不显示） */
  onCombo: (id: string, combo: MarketCombo) => void;
}) {
  const t = s.market;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [sort, setSort] = useState<MarketSort>("liquidity");
  const [cls, setCls] = useState<string>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  // 挂载时读一次主页设置的时薪：利润列与「洗还是买」panel 同一换算率（切页回来会重读）
  const wage = useMemo(() => loadWage(), []);

  // 拉取/重试共用一个入口：先渲染上次缓存（P0-5 秒开），同时后台拉新；拉新失败但有缓存就继续用缓存，
  // 首访无缓存才走骨架屏。effect 首次挂载跑一次，出错后点「重试」再跑（React 19 里卸载后的 setState 是无警告的 no-op）
  const start = useCallback(() => {
    const cached = readCachedMarket();
    setLoad(cached ? { kind: "ok", data: cached.market, cachedAt: cached.at } : { kind: "loading" });
    loadMarketOnce()
      .then((data) => setLoad({ kind: "ok", data }))
      .catch(() => {
        const again = readCachedMarket();
        setLoad(again ? { kind: "ok", data: again.market, cachedAt: again.at } : { kind: "error" });
      });
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  // market.json 的 en 名来自 game.json，据此反查武器 id 交回主页 session
  const idByEn = useMemo(() => new Map(GAME.weapons.map((w) => [w.name.en, w.id])), []);
  // 同伴武器按 en 名辨出（它们的 cls 仍是步枪/手枪，但行情页有自己的 tab，不混进类型栏）
  const sentinelEn = useMemo(() => new Set(GAME.weapons.filter((w) => w.sentinel).map((w) => w.name.en)), []);

  const rows = useMemo(() => {
    if (load.kind !== "ok") return [];
    const rs = rankWeapons(load.data, { sort, cls: cls && cls !== "Sentinel" ? cls : null, search: q, wage });
    if (cls === "Sentinel") return rs.filter((r) => sentinelEn.has(r.w.name.en));
    if (cls) return rs.filter((r) => !sentinelEn.has(r.w.name.en));
    return rs;
  }, [load, sort, cls, q, wage, sentinelEn]);

  // 展开一把武器时把它的热门组合排进求解队列（独立 worker，不挤主页的 plan）；
  // market.json 已预算 cost_kuva 的组合（含确定性 null）不再现算，缺的才入队。
  // 结果按 (武器, 组合) 缓存，收起再展开、切排序回来都直接命中
  useEffect(() => {
    if (load.kind !== "ok" || !open) return;
    const r = rows.find((x) => x.url === open);
    const id = r ? idByEn.get(r.w.name.en) : undefined;
    if (!r || id == null) return;
    const wcls = r.w.cls as RivenClass;
    for (const c of hotCombos(r.w, 6)) {
      if (c.cost_kuva !== undefined) continue;
      comboCost(id, wcls, c).then((kuva) => setCosts((prev) => ({ ...prev, [costKey(id, c)]: kuva })));
    }
  }, [open, rows, load, idByEn]);

  /** 组合的期望赤毒成本：market.json 预计算优先（undefined = 未预算），worker 结果兜底 */
  const comboKuva = (id: string, c: MarketCombo): number | null | undefined => (c.cost_kuva !== undefined ? c.cost_kuva : costs[costKey(id, c)]);

  // 组合行的利润数字：在途 …、求解不出 —、其余 = 中位 − 时薪折算的期望成本（与主页 panel 同一公式）
  const profitCell = (id: string, c: MarketCombo) => {
    const kuva = comboKuva(id, c);
    if (kuva === undefined)
      return (
        <span className="profit-num pending" aria-hidden="true">
          …
        </span>
      );
    if (kuva == null) return <span className="profit-num muted">—</span>;
    const cost = costPlat(kuva, wage);
    const profit = c.median_price - cost;
    return (
      <span className={`profit-num${profit >= 0 ? " up" : " down"}`} title={t.profitHint.replace("|C|", num(cost))}>
        {profit >= 0 ? "+" : "−"}
        {num(Math.abs(profit))}
      </span>
    );
  };

  if (load.kind === "loading") {
    return (
      <main className="market">
        <section className="panel" role="status" aria-label={t.loading}>
          {/* 骨架屏（P0-5）：首次访问无缓存时也有一块稳定结构，不是一句干巴巴的文案 */}
          <div className="market-skeleton" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 骨架行没有身份，序号即内容
              <span key={i} />
            ))}
          </div>
        </section>
      </main>
    );
  }
  if (load.kind === "error") {
    return (
      <main className="market">
        <section className="panel">
          <p className="empty">{t.error}</p>
          <p>
            <button type="button" className="text-btn" onClick={start}>
              {t.retry}
            </button>
          </p>
        </section>
      </main>
    );
  }

  const m = load.data;
  // DE 数据周 ISO 标签（2026-W44）→ 周一起算、更新到 meta.generated_at 那天的区间（随周推进到周日）；解析失败回退原标签，缺数据为空串
  const wk = m.meta.de?.week;
  const range = wk ? isoWeekRange(wk, m.meta.generated_at.slice(0, 10)) : null;
  const weekText = range ? t.weekRange.replace("|A|", range.start).replace("|B|", range.end) : (wk ?? "");
  const age = marketAgeHours(m);
  const fresh = age < 48 ? t.freshHours.replace("|H|", String(Math.max(1, Math.round(age)))) : t.freshDays.replace("|D|", String(Math.round(age / 24)));

  const sortOptions = (
    [
      ["liquidity", t.sort.liquidity],
      ["price", t.sort.price],
      ["fresh", t.sort.fresh],
      ["combos", t.sort.combos],
      ["turnover", t.sort.turnover],
      ["profit", t.sort.profit],
    ] as Array<[MarketSort, string]>
  ).map(([value, label]) => ({ value, label }));

  return (
    <main className="market">
      <section className="panel market-head">
        <div className="panel-h">
          <h2>{t.title}</h2>
        </div>
        <p className="muted small">
          {fresh}
          {load.cachedAt != null ? ` · ${t.updating}` : ""} · {t.source}
        </p>
        <div className="market-controls">
          <Segmented label={t.title} value={sort} options={sortOptions} onChange={(v) => setSort(v)} />
          <Segmented
            label={t.all}
            value={cls}
            options={[
              { value: "", label: t.all },
              ...MARKET_CLASSES.map((c) => ({ value: c as string, label: GAME.classes[c].name[lang] })),
              { value: "Sentinel", label: t.sentinel },
            ]}
            onChange={(v) => setCls(v)}
          />
          <input className="market-q" type="search" placeholder={t.search} value={q} aria-label={t.search} onChange={(e) => setQ(e.target.value)} />
        </div>
      </section>

      <section className="panel">
        {/* 行内横排数字的名字：在架挂单 / 周转 / 利润 / 中位价（与下方各列一一对应） */}
        <div className="market-head-row" aria-hidden="true">
          <span />
          <span />
          <span />
          <span className="whdr">{t.listings}</span>
          <span className="whdr">{t.sort.turnover}</span>
          <span className="whdr">{t.platProfit}</span>
          <span className="whdr">{t.platPrice}</span>
        </div>
        <ol className="market-list">
          {rows.map((r, i) => {
            const combos = shownCombos(r.w, wage);
            const id = idByEn.get(r.w.name.en);
            const to = turnover(r.w);
            const bp = bestProfit(r.w, wage);
            // 展开时高亮期望利润最优的组合（worker 结果未回/不可解的行不参与）
            let bestIdx = -1;
            if (id != null && open === r.url) {
              let bv = Number.NEGATIVE_INFINITY;
              combos.forEach((c, ci) => {
                const kuva = comboKuva(id, c);
                if (kuva == null) return;
                const p = c.median_price - costPlat(kuva, wage);
                if (p > bv) {
                  bv = p;
                  bestIdx = ci;
                }
              });
            }
            return (
              <li key={r.url} className={open === r.url ? "open" : undefined}>
                <button type="button" className="market-row" aria-expanded={open === r.url} onClick={() => setOpen(open === r.url ? null : r.url)}>
                  <span className="rank">{i + 1}</span>
                  <span className="wname">{r.w.name[lang] || r.w.name.en}</span>
                  <span className="wcls">{GAME.classes[r.w.cls as keyof typeof GAME.classes]?.name[lang]}</span>
                  <span className="wlistings" title={t.listings}>
                    {num(r.w.n_active)}
                    <span className="cl" aria-hidden="true">
                      {t.sort.liquidity}
                    </span>
                  </span>
                  <span className="wturnover" title={t.turnoverHint.replace("|P|", num(r.w.de?.pop ?? 0)).replace("|N|", num(r.w.n_active))}>
                    {to == null ? "—" : `${Math.round(to * 100)}%`}
                    <span className="cl" aria-hidden="true">
                      {t.sort.turnover}
                    </span>
                  </span>
                  <span className={`wprofit${bp == null ? "" : bp >= 0 ? " up" : " down"}`} title={t.profitRowNote}>
                    {bp == null ? "—" : `${bp >= 0 ? "+" : "−"}${num(Math.abs(Math.round(bp)))}`}
                  </span>
                  <span className="wprice">
                    {r.w.price ? num(r.w.price.median) : "—"}
                    <span className="cl" aria-hidden="true">
                      {t.median}
                    </span>
                  </span>
                </button>
                {open === r.url && (
                  <div className="market-detail">
                    {r.w.price && (
                      <p className="muted small">
                        {t.median} {num(r.w.price.median)} · P25 {num(r.w.price.p25)} / P75 {num(r.w.price.p75)}
                      </p>
                    )}
                    {r.w.de && (
                      <p className="muted small">
                        {t.deRow
                          .replace("|W|", weekText)
                          .replace("|P|", num(r.w.de.pop))
                          .replace("|PU|", num(r.w.de.unrolled?.pop ?? 0))
                          .replace("|PR|", num(r.w.de.rerolled?.pop ?? 0))
                          .replace("|M|", r.w.de.median != null ? num(r.w.de.median) : "—")}
                      </p>
                    )}
                    {combos.length ? (
                      <>
                        <p className="muted small">
                          {t.hot} · {t.profitNote}
                        </p>
                        <ul className="market-combos">
                          {combos.map((c, ci) => (
                            <li key={`${c.pos.join("+")}|${c.neg.join("-")}`} className={ci === bestIdx ? "best" : undefined}>
                              <span className="combo-chips">
                                {c.pos.map((u) => (
                                  <span key={u} className="chip">
                                    {wmStatName(r.w.cls, u, lang) ?? u}
                                  </span>
                                ))}
                                {c.neg.map((u) => (
                                  <span key={u} className="chip neg">
                                    −{wmStatName(r.w.cls, u, lang) ?? u}
                                  </span>
                                ))}
                              </span>
                              <span className="combo-meta">
                                {t.perListing.replace("|N|", num(c.count))} · {t.median} {num(c.median_price)}
                              </span>
                              {id != null && profitCell(id, c)}
                              {id != null && comboTags(r.w.cls as RivenClass, c) && (
                                <button
                                  type="button"
                                  className="text-btn gold"
                                  onClick={() => {
                                    onCombo(id, c);
                                    location.hash = "#/";
                                  }}
                                >
                                  {t.fillTarget}
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="muted small">{t.noCombos}</p>
                    )}
                    {id != null && (
                      <p>
                        <button
                          type="button"
                          className="text-btn gold"
                          onClick={() => {
                            onWeapon(id);
                            location.hash = "#/";
                          }}
                        >
                          {t.setTarget}
                        </button>
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {!rows.length && <p className="empty">{t.search}</p>}
      </section>
    </main>
  );
}
