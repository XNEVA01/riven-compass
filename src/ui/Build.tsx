/**
 * 配卡 / Build page: full adversarial damage calculator + build workbench.
 *
 * Left: weapon (from the coach session) + the recorded riven + enemy context.
 * Right: mod slots (manual picking, or the suggestion while following it),
 * the mod pool, panel/DPS breakdown, tier comparison and per-mod marginal
 * value.
 *
 * Pure presentation over src/damage (computeBuild + suggestBuild +
 * expectedRiven); it never touches the cycling engine or mutates the session.
 */
import { useEffect, useMemo, useState } from "react";
import type { PresetId } from "../damage/build";
import { marginalTable, PRESETS, scoreResult, suggestBuild } from "../damage/build";
import type { StatKey } from "../damage/data";
import { ENEMIES, RIVEN_TAG_TO_KEY, TYPE_ZH } from "../damage/data";
import type { EnemyContext, ModCard, RivenContribution, WeaponPanel } from "../damage/engine";
import { computeBuild } from "../damage/engine";
import type { StatMarginal, TierRow, WantedRow, WantedSpec } from "../damage/optimize";
import { expectedRiven, statMarginals, threeTier } from "../damage/optimize";
import combat from "../data/combat.json";
import type { Lang } from "../engine/data";
import { statOf, weaponById } from "../engine/data";
import { formatDisplay } from "../engine/formula";
import type { CardDraft, Session } from "../state";
import { complete, minW, statName, weaponClass, weaponName } from "../state";
import { NumberField, Segmented } from "./controls";

interface Strings {
  needWeapon: string;
  riven: string;
  noRiven: string;
  enemy: string;
  level: string;
  strip: string;
  preset: string;
  slots: string;
  slotsManual: string;
  autoHint: string;
  manualHint: string;
  optimize: string;
  follow: string;
  clear: string;
  pool: string;
  poolSearch: string;
  remove: string;
  up: string;
  down: string;
  panel: string;
  perShot: string;
  dps: { burst: string; sustain: string };
  ttk: string;
  enemyBody: { health: string; armor: string; shield: string };
  marginal: string;
  tiers: { title: string; none: string; yours: string; expected: string; god: string; uplift: string; expectedUp: string; reach: string };
  /** 伤害面板前的四档结论行（|Y| 你的紫卡 |N| 无紫卡 |E| 期望 |G| 最优） */
  verdict: { yours: string; expected: string; god: string };
  godStats: string;
  expected: { stats: string; missing: string };
  statMarginal: string;
  statHint: string;
  stat: { cc: string; cd: string; sc: string; ms: string; fr: string; mag: string; rl: string };
  /** 镀层击杀叠层：步进器标签与文案（|P| 百分数 / |S| 词条名 / |M| 满层） */
  killStacks: string;
  stackKill: string;
  stackBase: string;
  condNote: string;
}

const weapons = combat.weapons as unknown as WeaponPanel[];
const allMods = combat.mods as unknown as ModCard[];
const statZh = combat.statZh as Record<string, string>;

const STAT_EN: Record<string, string> = {
  dmg: "damage",
  ms: "multishot",
  cc: "crit chance",
  cd: "crit damage",
  sc: "status chance",
  fr: "fire rate",
  mag: "magazine",
  rl: "reload",
  pt: "punch through",
  imp: "impact",
  pun: "puncture",
  sla: "slash",
  heat: "heat",
  cold: "cold",
  elec: "electricity",
  tox: "toxin",
  rad: "radiation",
  mgn: "magnetic",
  bla: "blast",
  cor: "corrosive",
  gas: "gas",
  vir: "viral",
  facGrineer: "damage to Grineer",
  facCorpus: "damage to Corpus",
  facInfested: "damage to Infested",
  facOrokin: "damage to Orokin",
  facMurmur: "damage to Murmur",
};

/** game-shown riven values -> engine contribution (+144.5% -> 1.445, x1.49 -> 0.49) */
function rivenFromCard(card: CardDraft): RivenContribution | null {
  const stats: Partial<Record<StatKey, number>> = {};
  let any = false;
  const add = (tag: string, shown: number | null) => {
    const key = RIVEN_TAG_TO_KEY[tag];
    if (!key || shown == null || !Number.isFinite(shown)) return;
    const v = key.startsWith("fac") ? shown - 1 : shown / 100;
    stats[key] = (stats[key] ?? 0) + v;
    any = true;
  };
  for (const t of card.pos) add(t.tag, t.shown);
  if (card.neg) add(card.neg.tag, card.neg.shown);
  return any ? { stats } : null;
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
/** |P| templates already carry their own % sign: fill with the bare number */
const pctN = (n: number) => `${Math.round(n * 1000) / 10}`;
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const sec = (n: number) => (n > 600 ? `${num(n / 60)} min` : `${Math.round(n * 10) / 10} s`);

function typeLabel(t: string, lang: Lang): string {
  if (lang === "en") return t === "impact" ? "Impact" : t === "puncture" ? "Puncture" : t === "slash" ? "Slash" : t[0].toUpperCase() + t.slice(1);
  return TYPE_ZH[t] ?? t;
}

function modStatLine(m: ModCard, lang: Lang, t: Strings): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(m.stats) as Array<[StatKey, number]>) {
    if (!v) continue;
    const label = lang === "en" ? (STAT_EN[k] ?? k) : (statZh[k] ?? k);
    // 穿透是平值（如 +1.8），不带百分号；其余词条沿用百分比写法
    parts.push(`${v > 0 ? "+" : "−"}${k === "pt" ? pctN(Math.abs(v)) : pct(Math.abs(v))} ${label}`);
  }
  if (m.stack) {
    const label = lang === "en" ? (STAT_EN[m.stack.stat] ?? m.stack.stat) : (statZh[m.stack.stat] ?? m.stack.stat);
    if (m.stack.base) parts.push(t.stackBase.replace("|P|", pctN(m.stack.base)).replace("|S|", label));
    parts.push(t.stackKill.replace("|P|", pctN(m.stack.per)).replace("|S|", label).replace("|M|", String(m.stack.max)));
  }
  if (m.cond) parts.push(t.condNote);
  return parts.join("，");
}

const STRIPS: Array<{ label: string; v: number }> = [
  { label: "0%", v: 0 },
  { label: "80%", v: 0.8 },
  { label: "100%", v: 1 },
];

export function Build({ s, lang, session, onShare }: { s: { build: Strings; share: { button: string }; noMatch: string }; lang: Lang; session: Session; onShare: () => void }) {
  const t = s.build;
  const [preset, setPreset] = useState<PresetId>("corrosive");
  const [enemyIdx, setEnemyIdx] = useState(0);
  const [level, setLevel] = useState(150);
  const [stripIdx, setStripIdx] = useState(0);
  /** picked mod ids once the player edits anything; null = follow the suggestion */
  const [manualIds, setManualIds] = useState<string[] | null>(null);
  /** the mod-library search box: filter by name (zh / en), empty shows everything */
  const [poolQuery, setPoolQuery] = useState("");
  /** 镀层击杀叠层：按 mod id 的当前层数（0 = 未触发） */
  const [stackCounts, setStackCounts] = useState<Record<string, number>>({});

  const weapon = useMemo(() => (session.weaponId ? (weapons.find((w) => w.id === session.weaponId) ?? null) : null), [session.weaponId]);
  const cls = weaponClass(session.weaponId);
  const riven = useMemo(() => rivenFromCard(session.card), [session.card]);
  const pool = useMemo(() => (weapon ? allMods.filter((m) => m.compat === weapon.compat && (!m.trigger || m.trigger === weapon.trigger)) : []), [weapon]);
  const engineWeapon = useMemo(() => (session.weaponId ? weaponById(session.weaponId) : undefined), [session.weaponId]);
  const enemy: EnemyContext | null = useMemo(() => {
    if (!weapon) return null;
    return { spec: ENEMIES[enemyIdx], level, armorStrip: STRIPS[stripIdx].v };
  }, [weapon, enemyIdx, level, stripIdx]);

  // a manual build belongs to one weapon's pool: reset when the weapon changes
  useEffect(() => {
    if (session.weaponId) {
      setManualIds(null);
      setStackCounts({});
    }
  }, [session.weaponId]);

  const slots = 8 - (riven ? 1 : 0);

  const suggestion = useMemo(() => {
    if (!weapon || manualIds != null) return null;
    return suggestBuild({ weapon, pool, slots, riven, preset, enemy });
  }, [weapon, pool, slots, riven, preset, enemy, manualIds]);

  const manualMods = useMemo(() => {
    if (manualIds == null || !weapon) return null;
    return manualIds.map((id) => pool.find((m) => m.id === id)).filter((m): m is ModCard => !!m);
  }, [manualIds, pool, weapon]);

  /** the build the page shows: the player's own mods, or the suggestion while following it */
  const active = useMemo(() => {
    if (!weapon) return null;
    if (manualMods) {
      const result = computeBuild(weapon, manualMods, riven, enemy, stackCounts);
      return { mods: manualMods, result, score: scoreResult(result) };
    }
    if (!suggestion) return null;
    // 跟随建议时同样叠算手动设置的击杀层数（无镀层层数时与建议结果一致）
    const result = computeBuild(weapon, suggestion.mods, riven, enemy, stackCounts);
    return { mods: suggestion.mods, result, score: scoreResult(result) };
  }, [weapon, manualMods, riven, enemy, suggestion, stackCounts]);

  const marginals = useMemo(() => (weapon && active ? marginalTable(weapon, active.mods, riven, enemy) : null), [weapon, active, riven, enemy]);

  const tiers = useMemo(() => {
    if (!weapon || !active) return null;
    return threeTier({ weapon, rivenWeapon: engineWeapon, pool, preset, enemy, riven, current: { mods: active.mods, score: active.score, result: active.result, steps: [] } });
  }, [weapon, engineWeapon, pool, preset, enemy, riven, active]);

  const statMargins = useMemo(() => (weapon && active && riven ? statMarginals(weapon, active.mods, riven, enemy) : null), [weapon, active, riven, enemy]);

  /** the coach target as the expected riven's spec: rows of alternatives with a roll bar or a typed value */
  const wanted = useMemo<WantedSpec | null>(() => {
    if (!engineWeapon || !cls) return null;
    const t = session.target;
    const sets = t.sets
      .filter((gs) => gs.length > 0 && gs.every(complete))
      .map((gs) =>
        gs.map(
          (g): WantedRow => ({
            tags: g.tags,
            w: minW(t, g.tier, g),
            ...(g.tier === "value" && g.value != null ? { shown: g.value } : {}),
          }),
        ),
      );
    return sets.length ? { sets, wantNeg: t.wantNeg, allowedNeg: t.allowedNeg } : null;
  }, [engineWeapon, cls, session.target]);

  const expected = useMemo(() => (weapon && cls && active && wanted ? expectedRiven(cls, wanted, weapon, active.mods, enemy) : null), [weapon, cls, active, wanted, enemy]);

  const expectedRow = useMemo<TierRow | null>(() => {
    if (!weapon || !expected?.riven) return null;
    const sug = suggestBuild({ weapon, pool, slots: 7, riven: expected.riven, preset, enemy });
    return { score: sug.score, result: sug.result, mods: sug.mods, riven: expected.riven };
  }, [weapon, pool, expected, preset, enemy]);

  const traitRows = useMemo(() => {
    if (!statMargins || !cls) return [];
    const rows: Array<{ tag: string; shown: number; neg: boolean; m: StatMarginal }> = [];
    const find = (tag: string) => {
      const key = RIVEN_TAG_TO_KEY[tag];
      return key ? statMargins.find((x) => x.stat === key) : undefined;
    };
    for (const tr of session.card.pos) {
      if (tr.shown == null) continue;
      const m = find(tr.tag);
      if (m) rows.push({ tag: tr.tag, shown: tr.shown, neg: false, m });
    }
    const n = session.card.neg;
    if (n && n.shown != null) {
      const m = find(n.tag);
      if (m) rows.push({ tag: n.tag, shown: n.shown, neg: true, m });
    }
    return rows;
  }, [statMargins, cls, session.card]);

  if (!weapon || !cls) {
    return (
      <main className="coach">
        <section className="panel">
          <p className="empty">{t.needWeapon}</p>
        </section>
      </main>
    );
  }

  const enterManual = (): string[] => {
    const ids = active ? active.mods.map((m) => m.id) : [];
    setManualIds(ids);
    return ids;
  };
  const addMod = (m: ModCard) => {
    const ids = manualIds ?? enterManual();
    if (ids.includes(m.id) || ids.length >= slots) return;
    setManualIds([...ids, m.id]);
  };
  const removeSlot = (i: number) => {
    const ids = manualIds ?? (active ? active.mods.map((m) => m.id) : []);
    setManualIds(ids.filter((_, j) => j !== i));
  };
  const moveSlot = (i: number, dir: -1 | 1) => {
    if (manualIds == null) return;
    const j = i + dir;
    if (j < 0 || j >= manualIds.length) return;
    const next = [...manualIds];
    [next[i], next[j]] = [next[j], next[i]];
    setManualIds(next);
  };
  const applyOptimal = () => {
    if (!weapon) return;
    const sug = suggestBuild({ weapon, pool, slots, riven, preset, enemy });
    setManualIds(sug.mods.map((m) => m.id));
  };

  const equipped = new Set(active ? active.mods.map((m) => m.id) : []);
  const poolFull = (active?.mods.length ?? 0) >= slots;
  const q = poolQuery.trim().toLowerCase();
  const shownPool = q ? pool.filter((m) => m.en.toLowerCase().includes(q) || m.zh.toLowerCase().includes(q)) : pool;

  const r = active?.result;
  const vs = r?.vsEnemy;
  const panelRows = r ? (Object.entries(r.dmg) as Array<[string, number]>).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) : [];
  const maxRow = panelRows[0]?.[1] ?? 1;
  const metric = (row: TierRow): string => (row.result.vsEnemy ? `${t.ttk} ${sec(row.result.vsEnemy.timeToKill)}` : `${num(row.result.sustainedDps)} DPS`);
  /** 四档结论行用的裸指标（无前缀）：有对敌就给击杀时长，否则给持续 DPS */
  const vMetric = (row: TierRow): string => (row.result.vsEnemy ? sec(row.result.vsEnemy.timeToKill) : `${num(row.result.sustainedDps)} DPS`);

  return (
    <main className="coach">
      <div className="col-left">
        <section className="panel">
          <div className="panel-h">
            <h2>{weaponName(session.weaponId, lang)}</h2>
          </div>
          <p className="muted small">
            {num(weapon.total)} · CC {pct(weapon.cc)} / CD x{weapon.cd} / SC {pct(weapon.sc)}
          </p>
          <div className="build-riven">
            <p className="muted small">{t.riven}</p>
            {riven ? (
              <ul className="build-traits">
                {session.card.pos.map((tr, i) => (
                  <li key={tr.tag || i}>
                    {statName(cls, tr.tag, lang)} <b>{formatDisplay(statOf(cls, tr.tag), tr.shown ?? 0)}</b>
                  </li>
                ))}
                {session.card.neg && (
                  <li className="neg">
                    {statName(cls, session.card.neg.tag, lang)} <b>{formatDisplay(statOf(cls, session.card.neg.tag), session.card.neg.shown ?? 0)}</b>
                  </li>
                )}
              </ul>
            ) : (
              <p className="empty good">{t.noRiven}</p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-h">
            <h2>{t.enemy}</h2>
          </div>
          <Segmented
            label={t.enemy}
            value={ENEMIES[enemyIdx].id}
            onChange={(id) =>
              setEnemyIdx(
                Math.max(
                  0,
                  ENEMIES.findIndex((e) => e.id === id),
                ),
              )
            }
            options={ENEMIES.map((e) => ({ value: e.id, label: lang === "en" ? e.id : e.zh }))}
          />
          <div className="build-controls">
            <span>
              {t.level}
              <NumberField
                label={t.level}
                value={level}
                onCommit={(n) => setLevel(n == null ? 150 : Math.round(Math.max(1, Math.min(9999, n))))}
                min={1}
                max={9999}
                step={10}
                size={5}
              />
            </span>
            <span>
              {t.strip}
              <Segmented
                label={t.strip}
                value={String(stripIdx)}
                onChange={(v) => setStripIdx(Number(v))}
                options={STRIPS.map((st, i) => ({ value: String(i), label: st.label }))}
              />
            </span>
          </div>
          <div className="build-controls">
            <span>
              {t.preset}
              <Segmented label={t.preset} value={preset} onChange={setPreset} options={(Object.keys(PRESETS) as PresetId[]).map((p) => ({ value: p, label: PRESETS[p].zh }))} />
            </span>
          </div>
        </section>
      </div>

      <div className="col-right">
        {active && r ? (
          <>
            <section className="panel">
              <div className="panel-h">
                <h2>{manualMods ? t.slotsManual : t.slots}</h2>
                <span className="build-mode-btns">
                  <button type="button" className="text-btn" onClick={applyOptimal}>
                    {t.optimize}
                  </button>
                  {manualMods && (
                    <>
                      <button type="button" className="text-btn" onClick={() => setManualIds(null)}>
                        {t.follow}
                      </button>
                      <button type="button" className="text-btn" onClick={() => setManualIds([])}>
                        {t.clear}
                      </button>
                    </>
                  )}
                </span>
              </div>
              <p className="muted small">{manualMods ? t.manualHint : t.autoHint}</p>
              <ol className="build-slots">
                {riven && (
                  <li className="riven-slot">
                    <span className="slot-no">1</span>
                    <span className="slot-name">{t.riven}</span>
                    <span className="slot-stats">
                      {session.card.pos.map((tr) => `${statName(cls, tr.tag, lang)} ${formatDisplay(statOf(cls, tr.tag), tr.shown ?? 0)}`).join("，")}
                      {session.card.neg ? `，${statName(cls, session.card.neg.tag, lang)} ${formatDisplay(statOf(cls, session.card.neg.tag), session.card.neg.shown ?? 0)}` : ""}
                    </span>
                  </li>
                )}
                {active.mods.map((m, i) => {
                  const st = m.stack;
                  return (
                    <li key={m.id}>
                      <span className="slot-no">{i + 1 + (riven ? 1 : 0)}</span>
                      <span className="slot-name">{lang === "en" ? m.en : m.zh}</span>
                      <span className="slot-stats">{modStatLine(m, lang, t)}</span>
                      {st && (
                        <span className="slot-stack">
                          <button
                            type="button"
                            className="text-btn"
                            aria-label={t.killStacks}
                            disabled={(stackCounts[m.id] ?? 0) <= 0}
                            onClick={() => setStackCounts((c) => ({ ...c, [m.id]: Math.max(0, (c[m.id] ?? 0) - 1) }))}
                          >
                            −
                          </button>
                          <span className="stack-n">
                            {t.killStacks} {stackCounts[m.id] ?? 0}/{st.max}
                          </span>
                          <button
                            type="button"
                            className="text-btn"
                            aria-label={t.killStacks}
                            disabled={(stackCounts[m.id] ?? 0) >= st.max}
                            onClick={() => setStackCounts((c) => ({ ...c, [m.id]: Math.min(st.max, (c[m.id] ?? 0) + 1) }))}
                          >
                            +
                          </button>
                        </span>
                      )}
                      {manualMods && (
                        <span className="slot-ops">
                          <button type="button" className="text-btn" aria-label={t.up} title={t.up} disabled={i === 0} onClick={() => moveSlot(i, -1)}>
                            ↑
                          </button>
                          <button type="button" className="text-btn" aria-label={t.down} title={t.down} disabled={i === active.mods.length - 1} onClick={() => moveSlot(i, 1)}>
                            ↓
                          </button>
                          <button type="button" className="text-btn" aria-label={t.remove} title={t.remove} onClick={() => removeSlot(i)}>
                            ✕
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="panel">
              <div className="panel-h">
                <h2>{t.pool}</h2>
                <input
                  type="search"
                  className="pool-search"
                  value={poolQuery}
                  placeholder={t.poolSearch}
                  aria-label={t.poolSearch}
                  onChange={(e) => setPoolQuery(e.target.value)}
                />
              </div>
              <ul className="build-pool">
                {shownPool.map((m) => {
                  const on = equipped.has(m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={on ? "on" : undefined}
                        disabled={poolFull && !on}
                        title={on ? t.remove : undefined}
                        onClick={() => {
                          if (!active) return;
                          const i = active.mods.findIndex((x) => x.id === m.id);
                          if (i >= 0) removeSlot(i);
                          else addMod(m);
                        }}
                      >
                        <span className="slot-name">{lang === "en" ? m.en : m.zh}</span>
                        <span className="slot-stats">{modStatLine(m, lang, t)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {shownPool.length === 0 && <p className="muted small">{s.noMatch}</p>}
            </section>

            {/* 伤害面板前的四档结论行（评测指令 13）：一眼看完你的紫卡把击杀线拉到了哪里 */}
            {tiers?.yours && (
              <p className="build-verdict">
                {t.verdict.yours.replace("|Y|", vMetric(tiers.yours)).replace("|N|", vMetric(tiers.none))}
                {expectedRow && ` · ${t.verdict.expected.replace("|E|", vMetric(expectedRow))}`}
                {tiers.god && ` · ${t.verdict.god.replace("|G|", vMetric(tiers.god))}`}
              </p>
            )}

            <section className="panel">
              <div className="panel-h">
                <h2>{t.panel}</h2>
              </div>
              <dl className="build-figs">
                <div>
                  <dt>{t.perShot}</dt>
                  <dd className="fig">{num(vs ? vs.perShot : r.perShot)}</dd>
                </div>
                <div>
                  <dt>{t.dps.burst}</dt>
                  <dd className="fig">{num(vs ? vs.burstDps : r.burstDps)}</dd>
                </div>
                <div>
                  <dt>{t.dps.sustain}</dt>
                  <dd className="fig">{num(vs ? vs.sustainedDps : r.sustainedDps)}</dd>
                </div>
                <div>
                  <dt>{t.stat.cc}</dt>
                  <dd className="fig">{pct(Math.min(1, r.cc))}</dd>
                </div>
                <div>
                  <dt>{t.stat.cd}</dt>
                  <dd className="fig">x{Math.round(r.cd * 100) / 100}</dd>
                </div>
                <div>
                  <dt>{t.stat.sc}</dt>
                  <dd className="fig">{pct(r.sc)}</dd>
                </div>
                <div>
                  <dt>{t.stat.ms}</dt>
                  <dd className="fig">x{Math.round(r.ms * 100) / 100}</dd>
                </div>
                <div>
                  <dt>{t.stat.fr}</dt>
                  <dd className="fig">{Math.round(r.fr * 100) / 100}/s</dd>
                </div>
              </dl>
              <ul className="build-panel">
                {panelRows.map(([k, v]) => (
                  <li key={k}>
                    <span className="type">{typeLabel(k, lang)}</span>
                    <span className="bar" style={{ width: `${(v / maxRow) * 100}%` }} />
                    <span className="val">{num(v)}</span>
                  </li>
                ))}
              </ul>
              {vs && (
                <ul className="build-vs">
                  <li>
                    <span>
                      {lang === "en" ? ENEMIES[enemyIdx].id : ENEMIES[enemyIdx].zh} · Lv{level}
                    </span>
                    <b>
                      {t.ttk} {sec(vs.timeToKill)}
                    </b>
                  </li>
                  <li>
                    <span>{t.enemyBody.health}</span>
                    <b>{num(vs.health)}</b>
                  </li>
                  {vs.armor > 0 && (
                    <li>
                      <span>{t.enemyBody.armor}</span>
                      <b>{num(vs.armor)}</b>
                    </li>
                  )}
                  {vs.shield > 0 && (
                    <li>
                      <span>{t.enemyBody.shield}</span>
                      <b>{num(vs.shield)}</b>
                    </li>
                  )}
                </ul>
              )}
            </section>

            {tiers && (
              <section className="panel">
                <div className="panel-h">
                  <h2>{t.tiers.title}</h2>
                  <span className="panel-tools">
                    <button type="button" className="share-btn" title={s.share.button} onClick={onShare}>
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M10 14a5 5 0 0 0 7.07 0l3.18-3.18a5 5 0 0 0-7.07-7.07l-1.7 1.7" />
                        <path d="M14 10a5 5 0 0 0-7.07 0L3.75 13.18a5 5 0 0 0 7.07 7.07l1.7-1.7" />
                      </svg>
                      {s.share.button}
                    </button>
                  </span>
                </div>
                <ul className="build-tiers">
                  {(() => {
                    const rows: Array<{ id: string; cls: string; label: string; row: TierRow; base: TierRow }> = [
                      { id: "none", cls: "", label: t.tiers.none, row: tiers.none, base: tiers.none },
                    ];
                    if (tiers.yours) rows.push({ id: "yours", cls: "mine", label: t.tiers.yours, row: tiers.yours, base: tiers.none });
                    if (expectedRow) rows.push({ id: "expected", cls: "wish", label: t.tiers.expected, row: expectedRow, base: tiers.yours ?? tiers.none });
                    if (tiers.god) rows.push({ id: "god", cls: "gold", label: t.tiers.god, row: tiers.god, base: tiers.none });
                    const top = Math.max(...rows.map((x) => x.row.score)) || 1;
                    return rows.map((x) => {
                      const up = x.row.score / x.base.score - 1;
                      const reach = tiers.god ? x.row.score / tiers.god.score : null;
                      const upText = x.id === "expected" && tiers.yours ? t.tiers.expectedUp : t.tiers.uplift;
                      const note =
                        x.id === "none"
                          ? ""
                          : `${upText.replace("|P|", pctN(Math.max(0, up)))}${reach != null && x.id !== "god" ? ` · ${t.tiers.reach.replace("|P|", pctN(reach))}` : ""}`;
                      return (
                        <li key={x.id} className={x.cls}>
                          <span className="name">{x.label}</span>
                          <span className="bar" style={{ width: `${Math.max(2, (x.row.score / top) * 100)}%` }} />
                          <span className="val">{metric(x.row)}</span>
                          <span className="note">{note}</span>
                        </li>
                      );
                    });
                  })()}
                </ul>
                {tiers.godRiven && (
                  <div className="build-god">
                    <span className="god-label">{t.godStats}</span>
                    {tiers.godRiven.stats.map((st) => (
                      <span key={st.tag} className="chip">
                        {statName(cls, st.tag, lang)} <b>{formatDisplay(statOf(cls, st.tag), st.shown)}</b>
                      </span>
                    ))}
                    {tiers.godRiven.neg && (
                      <span className="chip neg">
                        {statName(cls, tiers.godRiven.neg.tag, lang)} <b>{formatDisplay(statOf(cls, tiers.godRiven.neg.tag), tiers.godRiven.neg.shown)}</b>
                      </span>
                    )}
                  </div>
                )}
                {expected ? (
                  <div className="build-god wish">
                    <span className="god-label">{t.expected.stats}</span>
                    {expected.stats.map((st) => (
                      <span key={st.tag} className="chip">
                        {statName(cls, st.tag, lang)} <b>{formatDisplay(statOf(cls, st.tag), st.shown)}</b>
                      </span>
                    ))}
                    {expected.neg && (
                      <span className="chip neg">
                        {statName(cls, expected.neg.tag, lang)} <b>{formatDisplay(statOf(cls, expected.neg.tag), expected.neg.shown)}</b>
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="muted small">{t.expected.missing}</p>
                )}
              </section>
            )}

            {traitRows.length > 0 && (
              <section className="panel">
                <div className="panel-h">
                  <h2>{t.statMarginal}</h2>
                </div>
                <p className="muted small">{t.statHint}</p>
                <ul className="build-marginal">
                  {(() => {
                    const maxPct = Math.max(...traitRows.map((x) => Math.abs(x.m.pct))) || 1;
                    return traitRows.map((x) => (
                      <li key={`${x.tag}:${x.neg}`}>
                        <span className="name">
                          {statName(cls, x.tag, lang)} <b>{formatDisplay(statOf(cls, x.tag), x.shown)}</b>
                        </span>
                        <span className={`bar${x.m.loss < 0 ? " hurt" : ""}`} style={{ width: `${Math.max(2, (Math.abs(x.m.pct) / maxPct) * 100)}%` }} />
                        <span className="val">
                          {x.m.loss >= 0 ? "−" : "+"}
                          {pct(Math.abs(x.m.pct))}
                        </span>
                      </li>
                    ));
                  })()}
                </ul>
              </section>
            )}

            {marginals && marginals.length > 0 && (
              <section className="panel">
                <div className="panel-h">
                  <h2>{t.marginal}</h2>
                </div>
                <ul className="build-marginal">
                  {(() => {
                    const maxPct = Math.max(...marginals.map((m) => m.pct));
                    return [...marginals]
                      .sort((a, b) => b.loss - a.loss)
                      .map((row) => (
                        <li key={row.mod.id}>
                          <span className="name">{lang === "en" ? row.mod.en : row.mod.zh}</span>
                          <span className="bar" style={{ width: `${Math.max(2, (row.pct / maxPct) * 100)}%` }} />
                          <span className="val">{pct(row.pct)}</span>
                        </li>
                      ));
                  })()}
                </ul>
              </section>
            )}
          </>
        ) : (
          <section className="panel">
            <p className="empty">{t.needWeapon}</p>
          </section>
        )}
      </div>
    </main>
  );
}
