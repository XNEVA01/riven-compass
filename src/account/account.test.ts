/**
 * 账号层测试：client 错误归一（mock fetch）、排队器语义（防抖/去重/攒批）、
 * 错误码→文案映射穷尽性。后端行为由 api/selftest.py 覆盖（39 项）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { mapError } from "../ui/AuthDialog";
import { AccountError, type AccountErrorCode, api } from "./client";
import { createEventSink, createPusher } from "./queues";

const respond = (body: unknown, ok = true, status = ok ? 200 : 500) =>
  Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);

const user = { id: 1, email: "a@example.com", plan: "free", is_admin: false };

describe("api client (mock fetch)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("login resolves the user on 2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => respond({ user }));
    const r = await api.login("a@example.com", "pw123456");
    expect(r.user.email).toBe("a@example.com");
    const [path, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(path).toBe("/api/auth/login");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("normalizes server error codes into AccountError", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => respond({ error: "email_taken" }, false, 409));
    await expect(api.register("a@example.com", "pw123456")).rejects.toMatchObject({ code: "email_taken" });
    await expect(api.register("a@example.com", "pw123456")).rejects.toBeInstanceOf(AccountError);
  });

  it("a network failure becomes AccountError('network'), never a raw TypeError", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(api.me()).rejects.toMatchObject({ code: "network" });
  });

  it("putState sends the session object and returns updated_at", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => respond({ updated_at: "2026-10-28T12:00:00+08:00" }));
    const r = await api.putState({ lang: "zh", version: 2 });
    expect(r.updated_at).toContain("2026-10-28");
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect((init as RequestInit).method).toBe("PUT");
  });
});

describe("createPusher (会话云同步的排队语义)", () => {
  it("防抖合并：连续变化只推一次，内容没变不再发", async () => {
    vi.useFakeTimers();
    const put = vi.fn().mockResolvedValue({ updated_at: "t1" });
    const onSynced = vi.fn();
    const p = createPusher(put, onSynced, 100);
    p.schedule({ a: 1 });
    p.schedule({ a: 2 });
    p.schedule({ a: 2 }); // 第三次与第二次内容相同
    await vi.advanceTimersByTimeAsync(150);
    expect(put).toHaveBeenCalledTimes(1); // 合并成一次
    expect(put.mock.calls[0][0]).toEqual({ a: 2 }); // 推的是最新值
    expect(onSynced).toHaveBeenCalledWith("t1");
    p.schedule({ a: 2 }); // 内容与上次成功推送一致：不再发
    await vi.advanceTimersByTimeAsync(150);
    expect(put).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("推送失败静默且不记住内容（下次变化重试）", async () => {
    vi.useFakeTimers();
    const put = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ updated_at: "t2" });
    const p = createPusher(put, () => {}, 100);
    p.schedule({ a: 1 });
    await vi.advanceTimersByTimeAsync(150);
    p.schedule({ a: 1 }); // 失败没记住，同内容也要重试
    await vi.advanceTimersByTimeAsync(150);
    expect(put).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("reset 后允许同内容重推（换账号语义）", async () => {
    vi.useFakeTimers();
    const put = vi.fn().mockResolvedValue({ updated_at: "t" });
    const p = createPusher(put, () => {}, 100);
    p.schedule({ a: 1 });
    await vi.advanceTimersByTimeAsync(150);
    p.reset();
    p.schedule({ a: 1 });
    await vi.advanceTimersByTimeAsync(150);
    expect(put).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("createEventSink (使用计量的攒批语义)", () => {
  it("攒批：窗口内多次 push 合成一次发送", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({});
    const sink = createEventSink(send, 100);
    sink.push({ type: "page", route: "market" });
    sink.push({ type: "ocr" });
    sink.push({ type: "plan" });
    await vi.advanceTimersByTimeAsync(150);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual([{ type: "page", route: "market" }, { type: "ocr" }, { type: "plan" }]);
    vi.useRealTimers();
  });

  it("容量封顶：超上限的 push 直接丢弃", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({});
    const sink = createEventSink(send, 100, 3);
    for (let i = 0; i < 5; i++) sink.push({ type: "page" });
    await vi.advanceTimersByTimeAsync(150);
    expect(send.mock.calls[0][0]).toHaveLength(3);
    vi.useRealTimers();
  });

  it("drain：卸载时取走批量并停掉定时器（sendBeacon 用）", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({});
    const sink = createEventSink(send, 100);
    sink.push({ type: "ocr" });
    const rest = sink.drain();
    expect(rest).toEqual([{ type: "ocr" }]);
    await vi.advanceTimersByTimeAsync(150); // 定时器已停：不再发送
    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("错误码 → 文案映射（四个分支一致，穷尽所有 code）", () => {
  const codes: AccountErrorCode[] = [
    "invalid_credentials",
    "email_taken",
    "weak_password",
    "bad_email",
    "banned",
    "rate_limited",
    "wrong_password",
    "state_too_large",
    "unauthorized",
    "bad_request",
    "network",
  ];

  it("every code maps to a non-empty string in every language branch", () => {
    for (const lang of ["zh", "cn", "tc", "en"] as const) {
      const a = strings(lang).account;
      for (const code of codes) {
        const text = mapError(a, code);
        expect(text, `${lang} / ${code}`).toBeTruthy();
      }
      // 常见错误有专属文案，而不是全落进网络错误
      expect(mapError(a, "email_taken")).not.toBe(a.error.network);
      expect(mapError(a, "banned")).not.toBe(a.error.network);
    }
  });

  it("i18n 三分支的 account 块字段完整", () => {
    for (const lang of ["zh", "cn", "tc", "en"] as const) {
      const a = strings(lang).account;
      expect(typeof a.titleLogin).toBe("string");
      expect(typeof a.privacy).toBe("string");
      expect(a.synced).toContain("|T|"); // AuthDialog 用 slice(11,16) 替换
    }
  });
});
