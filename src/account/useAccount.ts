/**
 * 账号层 hook：登录态、云同步推送、使用计量。排队与防抖语义在 queues.ts（纯逻辑，可测）。
 * demo 预览链接（?demo=...）下整个账号层静默——不推真数据、不上报、不显示入口。
 * 同步语义：登录时云端状态优先（登录即是要那份数据）；此后本地变化防抖推送，
 * 多设备为 last-write-wins——会话是几 KB 的小对象，冲突面足够小。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "../state";
import { SESSION_VERSION } from "../state";
import { AccountError, api, beaconEvents, type User } from "./client";
import { createEventSink, createPusher, type EventSink, type Pusher } from "./queues";

export type AuthMode = "login" | "register" | "account" | null;

export interface PulledState {
  user: User;
  /** 云端存过的会话（null = 该用户从未同步过，沿用本地） */
  state: unknown | null;
  updatedAt: string | null;
}

export function useAccount(disabled: boolean) {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [mode, setMode] = useState<AuthMode>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 排队器与登录态无关地常驻（闭包只碰 api），门禁在这里做：guest/demo 不投递
  const pusher = useRef<Pusher>(createPusher(api.putState, setSyncedAt));
  const sink = useRef<EventSink>(createEventSink(api.sendEvents));

  // 开机只问一次「我是谁」；失败按未登录处理（游客一切照旧）
  useEffect(() => {
    if (disabled) {
      setChecked(true);
      return;
    }
    api
      .me()
      .then((r) => {
        setUser(r.user);
        if (r.user)
          void api
            .getState()
            .then((s) => setSyncedAt(s.updated_at))
            .catch(() => {});
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [disabled]);

  // 卸载/切走时把没发完的计量交 sendBeacon（不阻塞页面卸载）
  useEffect(() => {
    const onHide = () => {
      const rest = sink.current.drain();
      if (rest.length) beaconEvents(rest);
    };
    addEventListener("pagehide", onHide);
    return () => {
      removeEventListener("pagehide", onHide);
      const rest = sink.current.drain();
      if (rest.length) beaconEvents(rest);
    };
  }, []);

  const queueEvent = useCallback(
    (type: string, route?: string) => {
      if (disabled || !user) return;
      sink.current.push({ type, route });
    },
    [disabled, user],
  );

  /** 会话推送：App 每次 session 变化调一次（内部防抖 2s，内容没变不发） */
  const schedulePush = useCallback(
    (session: Session) => {
      if (disabled || !user) return;
      pusher.current.schedule({ ...session, version: SESSION_VERSION });
    },
    [disabled, user],
  );

  /** 登录/注册后：拉云端会话交 App 应用；没有则 App 的本地状态就是起点 */
  const afterLogin = useCallback(async (u: User): Promise<PulledState> => {
    setUser(u);
    setMode(null);
    pusher.current.reset(); // 换了账号：允许立即全量推送
    let state: unknown = null;
    let updatedAt: string | null = null;
    const s = await api.getState().catch(() => null);
    if (s) {
      state = s.data;
      updatedAt = s.updated_at;
      if (s.updated_at) setSyncedAt(s.updated_at);
    }
    return { user: u, state, updatedAt };
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<PulledState> => {
      setBusy(true);
      try {
        return await afterLogin((await api.login(email, password)).user);
      } finally {
        setBusy(false);
      }
    },
    [afterLogin],
  );

  const register = useCallback(
    async (email: string, password: string): Promise<PulledState> => {
      setBusy(true);
      try {
        return await afterLogin((await api.register(email, password)).user);
      } finally {
        setBusy(false);
      }
    },
    [afterLogin],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setMode(null);
    setSyncedAt(null);
    pusher.current.reset();
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    await api.changePassword(current, next); // 错误原样抛给对话框显示
  }, []);

  const isAuthError = (e: unknown): e is AccountError => e instanceof AccountError;

  return {
    user,
    checked,
    mode,
    setMode,
    syncedAt,
    busy,
    login,
    register,
    logout,
    changePassword,
    queueEvent,
    schedulePush,
    isAuthError,
  };
}
