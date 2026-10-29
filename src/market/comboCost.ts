/**
 * 行情页组合行的期望成本（V3b，spec §9.4）：逐组合问一次求解器「从零洗到这个组合要多少赤毒」。
 *
 * 与主页的 engine/client 是两条通道：那边是单 worker + supersede 队列（新输入挤掉旧的），
 * 行情页一次展开要算多个组合，不能去挤主页的求解；这里自建一个 worker 串行排队，互不干扰。
 * 请求构造与最优路线取值在 costCore（与服务器管线 CLI 同源）；预计算 cost_kuva 上线后
 * 本通道是兜底：market.json 里已有的组合直接读数，缺的才在这里现算。
 */
import type { RivenClass } from "../engine/data";
import type { PlanRequest, PlanResponse } from "../engine/engine.worker";
import { bestRouteKuva, comboRequest, costKey } from "./costCore";
import type { MarketCombo } from "./wm";

type Job = { key: string; req: PlanRequest; resolve: (kuva: number | null) => void };

const cache = new Map<string, number | null>();
const inflight = new Map<string, Promise<number | null>>();
const queue: Job[] = [];
let worker: Worker | null = null;
let active: Job | null = null;
let nextId = 1;

const settle = (job: Job, kuva: number | null) => {
  cache.set(job.key, kuva);
  job.resolve(kuva);
};

/** worker 崩了就扔掉重来：每个请求最多再见到一次失败，之后 null 收场，不会无限重建 */
function dropWorker(why: unknown) {
  console.warn("[combo-cost] worker dropped", why);
  worker?.terminate();
  worker = null;
  const job = active;
  active = null;
  if (job) settle(job, null);
}

function pump() {
  if (active || !queue.length) return;
  const job = queue.shift();
  if (!job) return;
  active = job;
  try {
    if (!worker) {
      worker = new Worker(new URL("../engine/engine.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<PlanResponse | { ready: true }>) => {
        const data = e.data;
        if ("ready" in data) return;
        const job2 = active;
        active = null;
        if (job2 && data.id === job2.req.id) {
          settle(job2, data.ok ? (data.done ? 0 : data.reachable ? bestRouteKuva(data.routes) : null) : null);
        }
        pump();
      };
      worker.onerror = (e: ErrorEvent) => {
        e.preventDefault();
        dropWorker(e.message);
        pump();
      };
    }
    worker.postMessage(job.req);
  } catch (error) {
    dropWorker(error);
    pump();
  }
}

/**
 * 该组合「从零洗」的期望赤毒（最优路线精确均值）；映射不进该类、不可达或求解失败为 null。
 * 结果按 (武器, 组合) 缓存：同一会话里再次展开直接命中，时薪变化只影响展示层换算，不必重算。
 */
export function comboCost(weaponId: string, cls: RivenClass, combo: MarketCombo): Promise<number | null> {
  const key = costKey(weaponId, combo);
  const hit = inflight.get(key);
  if (hit) return hit;
  const req = comboRequest(nextId++, weaponId, cls, combo);
  const p: Promise<number | null> = req
    ? new Promise((resolve) => {
        queue.push({ key, req, resolve });
        pump();
      })
    : Promise.resolve(null);
  inflight.set(key, p);
  const done = (v: number | null) => {
    inflight.delete(key);
    return v;
  };
  return p.then(done, () => done(null));
}
