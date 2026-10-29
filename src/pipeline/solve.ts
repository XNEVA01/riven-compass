/**
 * 聚合管线成本求解 CLI（跨武器利润榜，spec §9.4 V3d）：把行情组合的「从零洗」期望赤毒
 * 在服务器上预算进 market.json（每组合行 cost_kuva），行情页利润列直读即达，V3b worker 变兜底。
 *
 * 与前端同一条数学：costCore 的 comboRequest + Planner + bestRouteKuva，打包时内联同一份
 * game.json → 预计算与 worker 兜底给出同一个数。请求里 runs 只喂分位数（均值是解析解），
 * 管线取 1 即可。E[赤毒] 只取决于 (抽卡池, 正词条集, 负词条集)：池由武器的
 * cls/also/tags/sentinel/grimoire/ips 决定（见 engine/pool.ts），池签名相同的武器对同一组合
 * 必然给出同一个解 → 按 (签名, 组合) 去重，一次求解全组复用；幂等缓存跨日增量，
 * game 数据版本或引擎常数变化即整体失效重算。
 *
 * 输入 stdin：{"units": [{ "weaponId", "cls", "pos": [WM url_name...], "neg": [...] }]}
 * 输出 stdout：{"costs": [number|null, ...]} 与输入同序（null = 映射不进类 / 不可达 / 求解失败）
 * 缓存 argv[2]：{"v": <版本键>, "entries": { "<签名|组合>": cost }}，写回 tmp+rename 原子替换。
 * --meta：打印 {"v", "game"}（内联 game 数据的指纹）——wm_pipeline.py 握手与 build-solve.sh 自检用。
 *
 * 打包（rolldown 与 vite 8 同内核，输出零依赖单文件，服务器只需 Node）：
 *   scripts/build-solve.sh —— 重写版本戳（game.json sha256）→ rolldown → 自检（--meta 指纹须与
 *   game.json 一致 + 空跑）→ 上传提示；build-data.py 写完 game.json 自动调它，数据更新不会漏打包。
 */
import { readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { type RivenClass, weaponById } from "../engine/data";
import { Planner } from "../engine/planner";
import { bestRouteKuva, comboRequest } from "../market/costCore";
import type { MarketCombo } from "../market/wm";
import { GAME_SHA256 } from "./game.stamp";

/** 引擎/构造层行为变化时手动 +1，让既有缓存整体失效 */
const CACHE_VERSION = 1;
/** 内联 game.json 的 sha256（game_stamp.py 生成）：整文件指纹，任何数据变化都让旧缓存失效；
 *  管线握手（wm_pipeline.py）比对 --meta.game 与它自己 game.json 的同一指纹，防 bundle 落后时静默算错 */
const cacheVersion = () => JSON.stringify([CACHE_VERSION, GAME_SHA256]);

/** 一个求解单元：武器（定抽卡池）+ 词条组合（WM url_name） */
interface Unit {
  weaponId: string;
  cls: RivenClass;
  pos: string[];
  neg: string[];
}

/** 池签名：poolFor 只读武器这些字段，同签名武器对同一组合给出同一个解 */
function weaponSig(id: string): string | null {
  const w = weaponById(id);
  return w ? JSON.stringify([w.cls, w.also, w.tags, w.sentinel, w.grimoire, w.ips]) : null;
}

/** CLI 只吃词条，行情数字与求解无关；组合顺序归一，缓存键与请求严格对应 */
const toCombo = (u: Unit): MarketCombo => ({
  count: 0,
  median_price: 0,
  min_price: 0,
  max_price: 0,
  re_rolls_mean: null,
  age_days_median: 0,
  pos: [...u.pos].sort(),
  neg: [...u.neg].sort(),
});

/** stdout/stderr 直写 fd：管道缓冲退出安全，Python 端读到的一定是完整 JSON */
function out(fd: 1 | 2, text: string) {
  let rest = text;
  while (rest) rest = rest.slice(writeSync(fd, rest));
}

function main() {
  if (process.argv.includes("--meta")) {
    out(1, JSON.stringify({ v: cacheVersion(), game: GAME_SHA256 }));
    return;
  }
  const started = performance.now();
  const units = (JSON.parse(readFileSync(0, "utf8")) as { units: Unit[] }).units ?? [];
  const cachePath = process.argv[2] ?? "";
  let entries: Record<string, number | null> = {};
  if (cachePath) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8")) as { v: string; entries: Record<string, number | null> };
      if (cached.v === cacheVersion()) entries = cached.entries ?? {};
    } catch {
      // 首跑或缓存损坏：从头求解，结束时整体重建
    }
  }

  // 每行落到去重键上；同键只解首个出现的单元，其余直接取数
  const rowKeys: Array<string | null> = [];
  const todo = new Map<string, Unit>();
  for (const u of units) {
    const sig = weaponSig(u.weaponId);
    if (!sig) {
      rowKeys.push(null);
      continue;
    }
    const key = JSON.stringify([sig, [...u.pos].sort(), [...u.neg].sort()]);
    rowKeys.push(key);
    if (!(key in entries)) todo.set(key, u);
  }

  const planner = new Planner();
  let id = 0;
  let failed = 0;
  for (const [key, u] of todo) {
    const req = comboRequest(++id, u.weaponId, u.cls, toCombo(u), 1);
    const res = req ? planner.plan(req) : null;
    if (res?.ok) {
      entries[key] = res.done ? 0 : res.reachable ? bestRouteKuva(res.routes) : null;
    } else {
      // 映射不进类、不可达或求解失败：null 也要缓存，次日不再撞同一堵墙
      if (res) failed++;
      entries[key] = null;
    }
    if (id % 200 === 0) out(2, `[solve] ${id}/${todo.size}\n`);
  }

  const unique = new Set(rowKeys.filter(Boolean)).size;
  out(1, JSON.stringify({ costs: rowKeys.map((k) => (k != null && k in entries ? entries[k] : null)) }));
  out(2, `[solve] rows=${units.length} unique=${unique} solved=${todo.size} cached=${unique - todo.size} failed=${failed} ms=${Math.round(performance.now() - started)}\n`);

  if (cachePath) {
    try {
      writeFileSync(`${cachePath}.tmp`, JSON.stringify({ v: cacheVersion(), entries }));
      renameSync(`${cachePath}.tmp`, cachePath);
    } catch (error) {
      out(2, `[solve] cache write failed: ${error}\n`);
    }
  }
}

main();
