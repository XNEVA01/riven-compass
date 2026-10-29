/**
 * 账号层的两个纯排队器（不碰 React，可在 node 测试环境直接测）：
 * - createPusher：会话推送——防抖合并 + 内容没变不再发 + 失败静默（下次变化再试）
 * - createEventSink：使用计量——攒批发送 + 容量封顶 + 卸载时 drain 交 sendBeacon
 * 登录门禁不在这里：hook 层（user 存在且非 demo）才往里投。
 */
export interface Pusher {
  schedule: (data: Record<string, unknown>) => void;
  reset: () => void;
}

export function createPusher(put: (data: Record<string, unknown>) => Promise<{ updated_at: string }>, onSynced: (at: string) => void, delay = 2000): Pusher {
  let last = "";
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let pending: Record<string, unknown> | null = null;
  return {
    schedule(data) {
      pending = data;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = 0;
        const d = pending;
        pending = null;
        if (!d) return;
        const payload = JSON.stringify(d);
        if (payload === last) return; // 没变化：不发（登录拉回的会话重推一遍是纯浪费）
        try {
          const r = await put(d);
          last = payload;
          onSynced(r.updated_at);
        } catch {
          // 同步失败静默：本地照常，下次变化或下个会话再试
        }
      }, delay);
    },
    reset() {
      last = ""; // 登出/换账号：重新允许全量推送
    },
  };
}

export type UsageEvent = { type: string; route?: string };

export interface EventSink {
  push: (e: UsageEvent) => void;
  /** 页面卸载兜底：取走没发完的批量交 sendBeacon（顺带停掉定时器） */
  drain: () => UsageEvent[];
}

export function createEventSink(send: (batch: UsageEvent[]) => Promise<unknown>, flushEvery = 15_000, cap = 200): EventSink {
  const queue: UsageEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  const flush = async () => {
    if (!queue.length) return;
    try {
      await send(queue.splice(0, 100));
    } catch {
      // 计量尽力而为：网络差就丢这一批
    }
  };
  return {
    push(e) {
      if (queue.length >= cap) return; // 异常流量（脚本循环）也不给它堆内存
      queue.push(e);
      if (timer) return;
      timer = setTimeout(() => {
        timer = 0;
        void flush();
      }, flushEvery);
    },
    drain() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      return queue.splice(0, 100);
    },
  };
}
