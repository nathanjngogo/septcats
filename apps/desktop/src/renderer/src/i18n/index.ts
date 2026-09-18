/**
 * i18n/index.ts —— 文案单一来源访问口（TASK-T10-01 §2；T25-01 locale 驱动）。
 *
 * - `t(key)`：按 `.` 拆分层级查字典；命中缺失回退 zh-CN，仍缺失则返回 key 本身
 *   并 console.warn（开发期可见，绝不白屏）。
 * - `setLocale(locale)`：切换生效 locale 并通知订阅者（与 theme 的 setGlobalThemeMode
 *   同范式：订阅者集合 + `septcats:locale-changed` 事件广播）。
 * - `useLocale()`：React 订阅（useSyncExternalStore），locale 切换触发重渲染。
 * - 回落顺序（T25-01 §0.A）：settings.locale → 系统语言（navigator.language，
 *   zh*→zh-CN，其余→en-US）→ zh-CN。「跟随系统」以 renderer localStorage 标记表达
 *   （platform schema 的 locale enum 只收 zh-CN/en-US，'system' 无法落库）。
 * - `errorText(error)`：错误码（E_*）→ t() 键映射表（T25-01 §0.B：main 侧文案不动，
 *   renderer 按 错误码→键 呈现用户可见错误；未知码回落原文）。
 */
import { useSyncExternalStore } from 'react';
import { enUS } from './en-US';
import { zhCN } from './zh-CN';

export type Locale = 'zh-CN' | 'en-US';

const dictionaries: Record<Locale, unknown> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

let currentLocale: Locale = 'zh-CN';

const localeListeners = new Set<() => void>();

function lookup(dict: unknown, key: string): unknown {
  let node: unknown = dict;
  for (const segment of key.split('.')) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return undefined;
    }
    const record = node as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) {
      return undefined;
    }
    node = record[segment];
  }
  return node;
}

export function t(key: string): string {
  const direct = lookup(dictionaries[currentLocale], key);
  if (typeof direct === 'string') {
    return direct;
  }
  const fallback = lookup(zhCN, key);
  if (typeof fallback === 'string') {
    return fallback;
  }
  console.warn(`[i18n] missing key: ${key}`);
  return key;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) {
    return;
  }
  currentLocale = locale;
  for (const listener of localeListeners) {
    listener();
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('septcats:locale-changed', { detail: { locale } }));
  }
}

export function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

/** 「跟随系统」的 renderer 标记（settings.locale 无法表达 'system'，见文件头注释）。 */
const LOCALE_PREF_KEY = 'septcats.localePref';

/** 系统语言 → Locale（zh* → zh-CN，其余 → en-US；navigator 不可用回 zh-CN）。 */
export function systemLocale(): Locale {
  try {
    const lang = window.navigator.language;
    if (typeof lang === 'string' && lang.toLowerCase().startsWith('zh')) {
      return 'zh-CN';
    }
    if (typeof lang === 'string' && lang.length > 0) {
      return 'en-US';
    }
  } catch {
    /* navigator 不可用（非浏览器环境） */
  }
  return 'zh-CN';
}

/** 读取语言偏好标记（无标记 = 跟随 settings.locale）。 */
export function getLocalePref(): 'system' | Locale {
  try {
    const raw = window.localStorage.getItem(LOCALE_PREF_KEY);
    if (raw === 'system' || raw === 'zh-CN' || raw === 'en-US') {
      return raw;
    }
  } catch {
    /* localStorage 不可用 */
  }
  return 'system';
}

/**
 * 「跟随系统」标记：写标记 + 立即按系统语言生效（调用方自行 settings.patch 最近解析值）。
 * 显式选择 zh-CN/en-US：清标记 + setLocale（调用方自行 patch settings.locale）。
 */
export function setLocalePref(pref: 'system' | Locale): void {
  try {
    if (pref === 'system') {
      window.localStorage.setItem(LOCALE_PREF_KEY, 'system');
    } else {
      window.localStorage.removeItem(LOCALE_PREF_KEY);
    }
  } catch {
    /* localStorage 不可用：仅本会话生效 */
  }
  setLocale(pref === 'system' ? systemLocale() : pref);
}

/**
 * 启动种子（renderer main.tsx 在挂载前调一次）：标记为 system → 按系统语言；
 * 否则用 settings.locale；settings 未就绪（catch 分支）→ 系统语言。
 */
export function initLocale(storedLocale: Locale | undefined): void {
  if (getLocalePref() === 'system') {
    setLocale(systemLocale());
    return;
  }
  if (storedLocale === 'zh-CN' || storedLocale === 'en-US') {
    setLocale(storedLocale);
    return;
  }
  setLocale(systemLocale());
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

// ---------------------------------------------------------------------------
// 错误码 → 文案映射（T25-01 §0.B）
// ---------------------------------------------------------------------------

/**
 * 错误 → 用户可见文案（T25-01 §0.B）：命中映射表按 t() 键呈现；消息里码后的细节段
 * 保留（如恢复码校验「期望 52 字符」这类 main 侧诊断细节，去掉会丢排障信息）；
 * 未知码回落原始消息。
 */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /\bE_[A-Z_]+\b/.exec(message);
  if (match !== null) {
    const code = match[0];
    if (lookup(zhCN, `errors.${code}`) !== undefined) {
      const rest = message.slice(match.index + code.length);
      const detail = rest.replace(/^[\s:：]+/, '');
      if (detail.length === 0) {
        return t(`errors.${code}`);
      }
      return `${t(`errors.${code}`)}${currentLocale === 'zh-CN' ? '：' : ': '}${detail}`;
    }
  }
  return message;
}
