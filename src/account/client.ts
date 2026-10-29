/**
 * 账号系统客户端（可选登录）：邮箱+密码，游客完全不经这里。
 * 所有错误归一为 AccountError(code)，UI 只需按 code 映射 i18n 文案。
 * 同源 fetch 自动带 cookie；非 2xx 一律 {error: code}。
 */
export interface User {
  id: number;
  email: string;
  plan: string;
  is_admin: boolean;
}

export type AccountErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "weak_password"
  | "bad_email"
  | "banned"
  | "rate_limited"
  | "wrong_password"
  | "state_too_large"
  | "unauthorized"
  | "bad_request"
  | "network";

export class AccountError extends Error {
  constructor(public code: AccountErrorCode) {
    super(code);
  }
}

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: body !== undefined,
    });
  } catch {
    throw new AccountError("network");
  }
  if (res.ok) return (await res.json()) as T;
  const err = (await res.json().catch(() => null)) as { error?: AccountErrorCode } | null;
  throw new AccountError(err?.error ?? "network");
}

export const api = {
  register: (email: string, password: string) => call<{ user: User }>("/api/auth/register", "POST", { email, password }),
  login: (email: string, password: string) => call<{ user: User }>("/api/auth/login", "POST", { email, password }),
  logout: () => call<{ ok: boolean }>("/api/auth/logout", "POST"),
  me: () => call<{ user: User | null }>("/api/auth/me", "GET"),
  getState: () => call<{ data: unknown; updated_at: string | null }>("/api/me/state", "GET"),
  putState: (data: unknown) => call<{ updated_at: string }>("/api/me/state", "PUT", { data }),
  changePassword: (current: string, next: string) => call<{ ok: boolean }>("/api/me/password", "POST", { current, next }),
  /** 计量尽力而为：丢了不心疼，也绝不打扰主流程 */
  sendEvents: (events: { type: string; route?: string }[]) => call<{ ok: boolean }>("/api/me/events", "POST", { events }),
};

/** 退出前把没发完的计量一次性带出去（sendBeacon 不阻塞页面卸载） */
export function beaconEvents(events: { type: string; route?: string }[]): boolean {
  try {
    return navigator.sendBeacon("/api/me/events", new Blob([JSON.stringify({ events })], { type: "application/json" }));
  } catch {
    return false;
  }
}
