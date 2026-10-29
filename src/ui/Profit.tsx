/**
 * 「洗 vs 买」panel（V3a）：主页路线旁边的行情对照。
 * 复用当前 plan 的最优路线成本（零额外求解），把行情组合匹配到当前目标，
 * 时薪模型折算期望成本，逐组合给期望利润与结论——行情数据桥接洗卡求解器的闭环出口。
 * cn（国服）无 warframe.market，App 层不渲染本 panel。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Lang, RivenClass } from "../engine/data";
import type { RouteStats } from "../engine/engine.worker";
import { fmtPct, type Strings } from "../i18n";
import { type ComboMatch, costPlat, DEFAULT_WAGE, hoursOf, loadWage, matchCombos, WAGE_KEY, type Wage } from "../market/profit";
import { lookupMarket } from "../market/variants";
import { loadMarketOnce, type Market, wmStatName } from "../market/wm";
import type { TargetDraft } from "../state";

interface Props {
  s: Strings;
  lang: Lang;
  cls: RivenClass;
  /** 武器的 en 名（market.json 的 name.en 与 game.json 同源，据此查行情条目） */
  weaponEn: string | null;
  target: TargetDraft;
  routes: RouteStats[];
  /** 当前赤毒余额：路线的 withinBudget 以它为预算，即「现有赤毒内命中率」 */
  kuva: number | null;
}

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ok"; data: Market };

const fmtPlat = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");
const fmtHours = (n: number) => (Number.isFinite(n) ? (n < 10 ? n.toFixed(1) : String(Math.round(n))) : "—");
const num = (n: number) => Math.round(n).toLocaleString("en-US");

export function Profit({ s, lang, cls, weaponEn, target, routes, kuva }: Props) {
  const t = s.profit;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [kuvaW, setKuvaW] = useState(() => String(loadWage().kuvaPerHour));
  const [platW, setPlatW] = useState(() => String(loadWage().platPerHour));

  // 拉取/重试共用一个入口：effect 首次挂载跑一次，出错后点「重试」再跑
  const start = useCallback(() => {
    setLoad({ kind: "loading" });
    loadMarketOnce()
      .then((data) => setLoad({ kind: "ok", data }))
      .catch(() => setLoad({ kind: "error" }));
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  const wage = useMemo<Wage>(() => {
    const k = Number(kuvaW);
    const p = Number(platW);
    return {
      kuvaPerHour: Number.isFinite(k) && k > 0 ? k : DEFAULT_WAGE.kuvaPerHour,
      platPerHour: Number.isFinite(p) && p >= 0 ? p : DEFAULT_WAGE.platPerHour,
    };
  }, [kuvaW, platW]);

  useEffect(() => {
    try {
      localStorage.setItem(WAGE_KEY, JSON.stringify(wage));
    } catch {
      // blocked storage: this visit just does not remember the rates
    }
  }, [wage]);

  // 洗卡成本取求解器推荐路线（玩家实际会跟的那条）
  const route = routes.find((r) => r.route.optimal) ?? routes[0];
  const cost = route ? costPlat(route.kuva.mean, wage) : Number.POSITIVE_INFINITY;
  const costP90 = route ? costPlat(route.kuva.p90, wage) : Number.POSITIVE_INFINITY;
  const hours = route ? hoursOf(route.kuva.mean, wage) : Number.POSITIVE_INFINITY;

  // 直接命中或挂靠到家族基础武器（WM 不为变体单列紫卡页，Prime 等与基础共用挂单）
  const res = useMemo(() => (load.kind === "ok" && weaponEn ? lookupMarket(load.data, weaponEn) : null), [load, weaponEn]);
  const w = res?.w;
  const match = useMemo(() => (w && cls ? matchCombos(cls, target, w) : { exact: [], similar: [] }), [w, cls, target]);
  const rows: { m: ComboMatch; similar: boolean }[] = match.exact.length ? match.exact.map((m) => ({ m, similar: false })) : match.similar.map((m) => ({ m, similar: true }));
  // 结论按最高中位价的组合算：卖出的上限场景
  const best = rows.length ? rows.reduce((a, b) => (b.m.combo.median_price > a.m.combo.median_price ? b : a)) : null;
  const bestProfit = best ? best.m.combo.median_price - cost : null;

  return (
    <section className="panel profit">
      <header className="panel-h">
        <h2>{t.title}</h2>
      </header>
      {load.kind === "loading" && <p className="empty">{s.market.loading}</p>}
      {load.kind === "error" && (
        <p className="empty">
          {s.market.error}{" "}
          <button type="button" className="text-btn" onClick={start}>
            {s.market.retry}
          </button>
        </p>
      )}
      {/* 期望成本不依赖行情：即使该武器无在架挂单，洗卡要花多少仍然成立 */}
      {load.kind === "ok" && route && (
        <p className="profit-cost">
          {t.cost} <b>{fmtPlat(cost)}</b> <small>{t.platUnit}</small>
          <small>
            {" "}
            {t.hours.replace("|H|", fmtHours(hours))} · {t.p90} {fmtPlat(costP90)} {t.platUnit}
          </small>
          {route.withinBudget != null && kuva != null && <small> · {t.hit.replace("|P|", fmtPct(route.withinBudget))}</small>}
        </p>
      )}
      {load.kind === "ok" && res && res.en !== weaponEn && <p className="muted small">{t.family.replace("|W|", res.w.name[lang] || res.en)}</p>}
      {load.kind === "ok" && !w && <p className="empty">{t.noMarket}</p>}
      {load.kind === "ok" && w && !rows.length && <p className="empty">{t.noMatch}</p>}
      {load.kind === "ok" && w && rows.length > 0 && (
        <>
          <ul className="market-combos">
            {rows.map(({ m, similar }) => {
              const c = m.combo;
              const profit = c.median_price - cost;
              return (
                <li key={`${c.pos.join("+")}|${c.neg.join("-")}`}>
                  <span className="combo-chips">
                    {c.pos.map((u) => (
                      <span key={u} className="chip">
                        {wmStatName(cls, u, lang) ?? u}
                      </span>
                    ))}
                    {c.neg.map((u) => (
                      <span key={u} className="chip neg">
                        −{wmStatName(cls, u, lang) ?? u}
                      </span>
                    ))}
                    {similar && <span className="chip soft">{t.similar}</span>}
                  </span>
                  <span className="combo-meta">
                    {s.market.perListing.replace("|N|", num(c.count))} · {s.market.median} {num(c.median_price)}
                  </span>
                  <span className={`profit-num${profit >= 0 ? " up" : " down"}`} title={t.est}>
                    {profit >= 0 ? "+" : "−"}
                    {fmtPlat(Math.abs(profit))}
                  </span>
                </li>
              );
            })}
          </ul>
          {bestProfit != null && (
            <p className={bestProfit > 0 ? "profit-verdict good" : "profit-verdict warn"}>{bestProfit > 0 ? t.save.replace("|P|", fmtPlat(bestProfit)) : t.buy}</p>
          )}
        </>
      )}
      <div className="profit-wage">
        <label>
          <span>{t.kuvaWage}</span>
          <input type="number" min={1} inputMode="numeric" value={kuvaW} aria-label={t.kuvaWage} onChange={(e) => setKuvaW(e.target.value)} />
        </label>
        <label>
          <span>{t.platWage}</span>
          <input type="number" min={0} inputMode="numeric" value={platW} aria-label={t.platWage} onChange={(e) => setPlatW(e.target.value)} />
        </label>
      </div>
      <p className="muted small profit-formula">{t.formula}</p>
      {/* 公式底下代入当前数值：期望赤毒与用户时薪实时换算，一眼看懂成本怎么来的 */}
      {route && (
        <p className="muted small profit-formula">
          {t.formulaCalc.replace("|K|", num(route.kuva.mean)).replace("|KW|", num(wage.kuvaPerHour)).replace("|PW|", num(wage.platPerHour)).replace("|C|", fmtPlat(cost))}
        </p>
      )}
      <p className="muted small">{t.est}</p>
    </section>
  );
}
