import { useCallback, useEffect, useState } from 'react';

type PingState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ok'; value: string }
  | { status: 'error'; message: string };

/**
 * M0+M2a 的最小版式（不承担 UI 设计；正式视觉由 PM 在 G2 冻结 DESIGN.md 后接入）。
 * - 标题占位「Septcats · 工程骨架」
 * - 「IPC 自检」按钮调用 window.septcats.ping() 并展示主进程返回的时间戳
 * - 挂载时从 CSS 变量 --sc-token-placeholder 读一次颜色并应用（tokens 占位）
 */
export function App() {
  const [accentColor, setAccentColor] = useState('');
  const [ping, setPing] = useState<PingState>({ status: 'idle' });

  useEffect(() => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--sc-token-placeholder')
      .trim();
    setAccentColor(value);
  }, []);

  const handlePing = useCallback(async (): Promise<void> => {
    setPing({ status: 'pending' });
    try {
      const value = await window.septcats.ping();
      setPing({ status: 'ok', value });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPing({ status: 'error', message });
    }
  }, []);

  return (
    <main className="skeleton">
      <section className="skeleton-card">
        <span
          className="skeleton-accent"
          style={{ backgroundColor: accentColor === '' ? 'transparent' : accentColor }}
          aria-hidden="true"
        />
        <h1 className="skeleton-title">Septcats · 工程骨架</h1>
        <p className="skeleton-hint">
          M0 工程基建 + M2a 纯逻辑核心。视觉 token 待 G2 的 DESIGN.md 定稿后替换。
        </p>

        <button
          type="button"
          className="skeleton-button"
          onClick={() => {
            void handlePing();
          }}
          disabled={ping.status === 'pending'}
        >
          {ping.status === 'pending' ? 'IPC 自检中…' : 'IPC 自检'}
        </button>

        <p className="skeleton-result" role="status" aria-live="polite">
          {ping.status === 'idle' && '尚未调用'}
          {ping.status === 'pending' && '等待主进程返回…'}
          {ping.status === 'ok' && `主进程时间戳：${ping.value}`}
          {ping.status === 'error' && `IPC 失败：${ping.message}`}
        </p>
      </section>
    </main>
  );
}
