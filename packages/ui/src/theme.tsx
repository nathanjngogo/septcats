import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ThemeName } from './tokens';
import './theme.css';

export type ThemeMode = ThemeName | 'system';

export const THEME_STORAGE_KEY = 'septcats.theme';
/** 与 --sc-motion-fast 对齐：切换主题的交叉淡化时长 */
export const THEME_FADE_MS = 120;

/** 命令面板等非 React 上下文切换主题的事件名（ThemeProvider 内部订阅）。 */
export const THEME_MODE_EVENT = 'septcats:theme-mode';

export interface ThemeModeEventData {
  mode: ThemeMode;
}

/**
 * 挂载前到达的全局模式（TASK-T20-02 §0.C）：settings 播种发生在 renderer 模块顶层，
 * 其 IPC 结算常早于 ThemeProvider 挂载——只派发事件会丢进空气里。故此处兜一个单槽
 * 缓冲，Provider 初始化时消费（消费即清空；StrictMode 二次挂载回落到 localStorage）。
 */
let pendingMode: ThemeMode | null = null;

/** 取走挂载前暂存的模式（仅 ThemeProvider 初始化调用一次）。 */
function takePendingMode(): ThemeMode | null {
  const mode = pendingMode;
  pendingMode = null;
  return mode;
}

/**
 * setGlobalThemeMode —— 组件树外切换主题（命令面板「切换主题」命令 + 启动播种用）。
 * Provider 已挂载 → 事件走同一 setMode 管道（localStorage/淡化一致）；
 * 尚未挂载 → 事件无人接收，故同时暂存 pendingMode 供其初始化消费。
 */
export function setGlobalThemeMode(mode: ThemeMode): void {
  pendingMode = mode;
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  window.dispatchEvent(new CustomEvent<ThemeModeEventData>(THEME_MODE_EVENT, { detail: { mode } }));
}

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

/**
 * 判定 localStorage 是否已存有合法主题（TASK-T20-02 §0.C：主题真相源 = localStorage）。
 * 启动方（renderer main.tsx）必须在 ThemeProvider 挂载**前**调用——Provider 挂载即把
 * 当前 mode（无存储时为 'system'）写回 localStorage，挂载后再判恒为 true。
 * 返回 false 时启动方可用 settings.theme 作一次性种子（setGlobalThemeMode），
 * 之后仍以 localStorage 为准，不做双向同步。
 */
export function hasStoredTheme(storageKey: string = THEME_STORAGE_KEY): boolean {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw === 'light' || raw === 'dark' || raw === 'system';
  } catch {
    return false;
  }
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
  const [mode, setModeState] = useState<ThemeMode>(() => defaultMode ?? takePendingMode() ?? readStoredMode(storageKey));
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

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<ThemeModeEventData>).detail;
      if (detail?.mode === 'light' || detail?.mode === 'dark' || detail?.mode === 'system') {
        setModeState(detail.mode);
      }
    };
    window.addEventListener(THEME_MODE_EVENT, handler);
    return () => {
      window.removeEventListener(THEME_MODE_EVENT, handler);
    };
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
