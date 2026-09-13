import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ThemeName } from './tokens';
import './theme.css';

export type ThemeMode = ThemeName | 'system';

export const THEME_STORAGE_KEY = 'septcats.theme';
/** 与 --sc-motion-fast 对齐：切换主题的交叉淡化时长 */
export const THEME_FADE_MS = 120;

export interface ThemeContextValue {
  /** 用户选择（含 system） */
  mode: ThemeMode;
  /** 实际生效的主题 */
  resolved: ThemeName;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function safeMatchMedia(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(query);
}

function prefersDark(): boolean {
  return safeMatchMedia('(prefers-color-scheme: dark)')?.matches ?? false;
}

function prefersReducedMotion(): boolean {
  return safeMatchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

function readStoredMode(storageKey: string): ThemeMode {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      return raw;
    }
  } catch {
    // 隐私模式 / 存储被禁用：按 system 处理
  }
  return 'system';
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** 缺省读 localStorage；测试可注入 */
  defaultMode?: ThemeMode;
  storageKey?: string;
}

/**
 * ThemeProvider —— 双主题一等公民（§16.3）。
 * 写 document.documentElement[data-theme]（tokens.css 的深色块据此生效）；
 * localStorage 记忆选择；system 模式订阅 matchMedia；
 * 切换 120ms 交叉淡化（theme.css），reduced-motion 下直接切换。
 */
export function ThemeProvider({ children, defaultMode, storageKey = THEME_STORAGE_KEY }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => defaultMode ?? readStoredMode(storageKey));
  const [systemDark, setSystemDark] = useState<boolean>(() => prefersDark());
  const resolved: ThemeName = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    if (mode !== 'system') {
      return undefined;
    }
    const media = safeMatchMedia('(prefers-color-scheme: dark)');
    if (media === null) {
      return undefined;
    }
    const onChange = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    if (prefersReducedMotion()) {
      root.setAttribute('data-theme', resolved);
      return undefined;
    }
    root.setAttribute('data-theme-fading', 'true');
    root.setAttribute('data-theme', resolved);
    const timer = setTimeout(() => {
      root.removeAttribute('data-theme-fading');
    }, THEME_FADE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [resolved]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch {
      // 存储不可用：不阻断渲染
    }
  }, [mode, storageKey]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme 必须在 ThemeProvider 内使用');
  }
  return context;
}
