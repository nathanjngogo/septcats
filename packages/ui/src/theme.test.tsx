import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, hasStoredTheme, setGlobalThemeMode, ThemeProvider, useTheme } from './theme';

function Probe() {
  const { mode, resolved, setMode } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolved}</span>
      <button
        type="button"
        onClick={() => {
          setMode('dark');
        }}
      >
        深色
      </button>
      <button
        type="button"
        onClick={() => {
          setMode('light');
        }}
      >
        浅色
      </button>
    </div>
  );
}

function installMatchMedia(darkMatches: boolean): Array<(event: MediaQueryListEvent) => void> {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  window.matchMedia = ((query: string): MediaQueryList => {
    const mql = {
      matches: query.includes('dark') ? darkMatches : false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (query.includes('prefers-color-scheme')) {
          listeners.push(listener);
        }
      },
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
    return mql as unknown as MediaQueryList;
  }) as unknown as typeof window.matchMedia;
  return listeners;
}

describe('ThemeProvider', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-fading');
  });

  it('setMode 写入 data-theme 并持久化到 localStorage', () => {
    render(
      <ThemeProvider defaultMode="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('resolved').textContent).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: '浅色' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('system 模式跟随 matchMedia，并在系统切换时更新', () => {
    const listeners = installMatchMedia(true);
    render(
      <ThemeProvider defaultMode="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => {
      for (const listener of listeners) {
        listener({ matches: false } as MediaQueryListEvent);
      }
    });
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('未包裹 Provider 时 useTheme 抛错（避免静默用错主题）', () => {
    expect(() => render(<Probe />)).toThrowError(/ThemeProvider/);
  });
});

describe('hasStoredTheme（TASK-T20-02 §0.C 主题双源：localStorage 为真相源）', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('localStorage 无 theme / 值非法 → false（应作 settings 种子）', () => {
    expect(hasStoredTheme()).toBe(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(hasStoredTheme()).toBe(false);
  });

  it('localStorage 已有合法 theme → true（settings 不再播种，以 localStorage 为准）', () => {
    for (const mode of ['light', 'dark', 'system'] as const) {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
      expect(hasStoredTheme()).toBe(true);
    }
  });

  it('ThemeProvider 挂载写入后即视为已有主题（启动方须在挂载前判定）', () => {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    expect(hasStoredTheme()).toBe(false);

    installMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(hasStoredTheme()).toBe(true);
  });
});

describe('启动播种时序（TASK-T20-02 §0.C：settings 结算常早于 Provider 挂载）', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('挂载前 setGlobalThemeMode → Provider 挂载即采用该模式（事件丢失兜底）', () => {
    installMatchMedia(false);
    expect(hasStoredTheme()).toBe(false);
    setGlobalThemeMode('dark'); // Provider 尚未挂载：事件无人接收
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByTestId('mode').textContent).toBe('dark');
  });

  it('Provider 已挂载时 setGlobalThemeMode 仍走事件管道（默认行为不回归）', () => {
    installMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      setGlobalThemeMode('dark');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
