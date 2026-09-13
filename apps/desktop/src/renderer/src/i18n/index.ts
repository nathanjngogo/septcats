/**
 * i18n/index.ts —— 文案单一来源访问口（TASK-T10-01 §2）。
 *
 * - `t(key)`：按 `.` 拆分层级查字典；命中缺失回退 zh-CN，仍缺失则返回 key 本身
 *   并 console.warn（开发期可见，绝不白屏）。
 * - `useLocale()`：当前生效 locale。一期生效面固定 zh-CN；en-US 分支留空字典回退
 *   （不 import 不存在的 en-US 文件）。
 */
import { zhCN } from './zh-CN';

export type Locale = 'zh-CN' | 'en-US';

const dictionaries: Record<Locale, unknown> = {
  'zh-CN': zhCN,
  // en-US：一期不翻译，留空字典；t() 命中空字典时回退 zh-CN。
  'en-US': {},
};

/** 一期生效面固定 zh-CN（settings.json 里的 locale 字段已落库但暂不驱动 UI）。 */
let currentLocale: Locale = 'zh-CN';

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
  console.warn(`[i18n] 缺失文案 key：${key}`);
  return key;
}

export function useLocale(): Locale {
  return currentLocale;
}
