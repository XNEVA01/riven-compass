/**
 * 账号对话框（可选登录）：登录 / 注册 / 账号管理三个模式。
 * 游客功能完全不受影响——这个框只在不点开它的时候不存在。
 * 注册须知明确告知：登录后服务器会保存会话（云同步）与使用计数（为将来计费做准备）。
 */
import { type FormEvent, useEffect, useState } from "react";
import type { AccountErrorCode } from "../account/client";
import type { PulledState, useAccount } from "../account/useAccount";
import type { Lang } from "../engine/data";
import { strings } from "../i18n";
import { MailIcon, PersonIcon } from "./icons";

type Account = ReturnType<typeof useAccount>;
type AccountStrings = ReturnType<typeof strings>["account"];

const mapError = (a: AccountStrings, code: AccountErrorCode): string =>
  ({
    invalid_credentials: a.error.invalid,
    email_taken: a.error.taken,
    weak_password: a.error.weak,
    bad_email: a.error.email,
    banned: a.error.banned,
    rate_limited: a.error.rate,
    wrong_password: a.error.wrong,
    state_too_large: a.error.network,
    unauthorized: a.error.network,
    bad_request: a.error.weak,
    network: a.error.network,
  })[code];

export { mapError };

export function AuthDialog({ acc, onPulled, lang }: { acc: Account; onPulled: (p: PulledState) => void; lang: Lang }) {
  const a = strings(lang).account;
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const close = acc.setMode;
  useEffect(() => {
    if (!acc.mode) return;
    setErr(null);
    setNote(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [acc.mode, close]);

  if (!acc.mode) return null;

  const submitAuth = async (kind: "login" | "register") => {
    setErr(null);
    setNote(null);
    try {
      const pulled = kind === "login" ? await acc.login(email, pw) : await acc.register(email, pw);
      onPulled(pulled);
    } catch (e) {
      setErr(acc.isAuthError(e) ? mapError(a, e.code) : a.error.network);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setNote(null);
    try {
      await acc.changePassword(pwCur, pwNew);
      setPwCur("");
      setPwNew("");
      setNote(a.passwordChanged);
    } catch (e) {
      setErr(acc.isAuthError(e) ? mapError(a, e.code) : a.error.network);
    }
  };

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={acc.mode === "account" ? a.titleAccount : acc.mode === "login" ? a.titleLogin : a.titleRegister}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") close(null); // overlay 本身获得焦点时也能关（全局 Esc 在 effect 里）
      }}
    >
      <section className="auth-panel">
        {acc.mode === "account" && acc.user ? (
          <>
            <h2>
              <PersonIcon /> {acc.user.email}
            </h2>
            <p className="auth-line">
              {acc.user.plan === "pro" ? <span className="auth-plan pro">PRO</span> : <span className="auth-plan">{a.planFree}</span>}
              <span className="auth-sync">{acc.syncedAt ? a.synced.replace("|T|", acc.syncedAt.slice(11, 16)) : a.syncNone}</span>
            </p>
            <form className="auth-form" onSubmit={submitPassword}>
              <label className="auth-field">
                <span>{a.currentPassword}</span>
                <input type="password" value={pwCur} onChange={(e) => setPwCur(e.target.value)} autoComplete="current-password" required />
              </label>
              <label className="auth-field">
                <span>{a.newPassword}</span>
                <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} autoComplete="new-password" minLength={8} required />
              </label>
              <button type="submit" className="auth-submit" disabled={acc.busy}>
                {a.changePassword}
              </button>
            </form>
            <button type="button" className="text-btn auth-logout" onClick={() => void acc.logout()}>
              {a.logout}
            </button>
          </>
        ) : acc.mode === "register" ? (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAuth("register");
            }}
          >
            <h2>
              <MailIcon /> {a.titleRegister}
            </h2>
            <label className="auth-field">
              <span>{a.email}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </label>
            <label className="auth-field">
              <span>{a.password}</span>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={8} required />
            </label>
            <p className="auth-hint">{a.hint}</p>
            {err && <p className="auth-err">{err}</p>}
            {note && <p className="auth-note">{note}</p>}
            <button type="submit" className="auth-submit" disabled={acc.busy}>
              {a.registerSubmit}
            </button>
            <button type="button" className="text-btn auth-switch" onClick={() => acc.setMode("login")}>
              {a.toLogin}
            </button>
            <p className="auth-privacy">{a.privacy}</p>
          </form>
        ) : (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAuth("login");
            }}
          >
            <h2>
              <MailIcon /> {a.titleLogin}
            </h2>
            <label className="auth-field">
              <span>{a.email}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </label>
            <label className="auth-field">
              <span>{a.password}</span>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
            </label>
            {err && <p className="auth-err">{err}</p>}
            {note && <p className="auth-note">{note}</p>}
            <button type="submit" className="auth-submit" disabled={acc.busy}>
              {a.loginSubmit}
            </button>
            <button type="button" className="text-btn auth-switch" onClick={() => acc.setMode("register")}>
              {a.toRegister}
            </button>
            <p className="auth-privacy">{a.syncHint}</p>
          </form>
        )}
      </section>
    </div>
  );
}
