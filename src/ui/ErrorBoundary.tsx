/**
 * 根部错误边界（代码审查 P1）：渲染期异常不再把整站摔成白屏——session 在 localStorage，
 * 掉的只是这一帧视图。异常与组件栈进 console；重试只是清掉错误态重新渲染。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import type { Lang } from "../engine/data";
import { strings } from "../i18n";

interface Props {
  lang: Lang;
  children: ReactNode;
}

/** error 非 null 时渲染兜底页；重试把它清回 null（StrictMode 下 state 保留，边界只挂一次） */
interface State {
  error: unknown | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[ui] render crashed", error, info.componentStack);
  }

  render() {
    if (this.state.error == null) return this.props.children;
    const t = strings(this.props.lang).crash;
    return (
      <div className="app">
        <main className="coach">
          <section className="panel">
            <p className="empty">{t.message}</p>
            <p>
              <button type="button" className="text-btn" onClick={() => this.setState({ error: null })}>
                {t.retry}
              </button>
            </p>
          </section>
        </main>
      </div>
    );
  }
}
