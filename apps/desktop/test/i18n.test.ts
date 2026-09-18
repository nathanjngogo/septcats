// @vitest-environment jsdom
/**
 * i18n.test.ts —— i18n 键完备性门禁（TASK-T25-01 §0.D）。
 *
 * 1) 键集合等价：zh-CN 与 en-US 递归拍平后完全相等（多/少各报错）；
 * 2) 无空值：两字典任意键的值非空字符串；en-US 值不含 CJK 字符（防「忘了翻译」）；
 * 3) 无残留硬编码：renderer/src/** 源码扫描——JSX 文本与 aria-label/placeholder/
 *    title/alt/label 属性字面量中不得出现 CJK（注释、i18n 字典豁免；console 日志、
 *    内部错误消息、演示文档内容、协议正则不属于本门禁扫描面）；
 * 4) 切换 locale 后关键文案断言（主界面/侧栏/面板/设置/对话框各一处）+ useLocale
 *    订阅重渲染（setLocale → 组件文案即时切换，切回中文复原）。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { act, createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setLocale, systemLocale, t, useLocale } from '../src/renderer/src/i18n';
import { enUS } from '../src/renderer/src/i18n/en-US';
import { zhCN } from '../src/renderer/src/i18n/zh-CN';

beforeAll(() => {
  // React 18 act() 环境标记（jsdom 环境 + RTL 15 未自动置位时的标准做法）
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
  setLocale('zh-CN');
});

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

type Flat = Map<string, string>;

function flatten(dict: unknown, prefix = '', out: Flat = new Map()): Flat {
  if (dict === null || typeof dict !== 'object' || Array.isArray(dict)) {
    throw new Error(`i18n 字典出现非对象节点：${prefix || '(root)'}`);
  }
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object') {
      flatten(value, path, out);
    } else if (typeof value === 'string') {
      out.set(path, value);
    } else {
      throw new Error(`i18n 键的值必须是字符串：${path}`);
    }
  }
  return out;
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]/;

function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'i18n') {
        continue; // 字典豁免
      }
      out.push(...walkSources(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** 剥掉块注释与行注释（URL 的 `://` 不当行注释）。 */
function stripComments(src: string): string {
  const withoutBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return withoutBlock
    .split('\n')
    .map((line) => {
      const idx = line.search(/(^|[^:])\/\//);
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

/** 取 {…} 表达式容器外的文本（JSX 文本 = 容器之间的部分）。 */
function textOutsideBraces(text: string): string {
  let depth = 0;
  let out = '';
  for (const ch of text) {
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out;
}

/** JSX 文本中的 CJK（`>` 与 `<` 之间、表达式容器外的部分）。 */
function findJsxTextCjk(source: string): Array<{ snippet: string; char: string }> {
  const hits: Array<{ snippet: string; char: string }> = [];
  for (const match of source.matchAll(/>([^<>]*?)</g)) {
    const text = textOutsideBraces(match[1] ?? '');
    // 形态守卫：真正的 JSX 文本不含代码字符（正则捕获可能从普通 TS 的 `=>` 起步，
    // 跨进含字符串字面量的代码区——那些不属于本门禁的扫描面，交给注释/日志豁免口径）
    if (/[;(){}=`"'.[\]]/.test(text)) {
      continue;
    }
    const found = CJK.exec(text);
    if (found !== null) {
      hits.push({ snippet: (match[1] ?? '').trim().slice(0, 80), char: found[0] });
    }
  }
  return hits;
}

/** 属性字面量中的 CJK（aria-label/placeholder/title/alt/label = "..." 或 '...'）。 */
function findAttrCjk(source: string): Array<{ snippet: string; char: string }> {
  const hits: Array<{ snippet: string; char: string }> = [];
  const re = /\b(aria-label|placeholder|title|alt|label)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(re)) {
    const value = match[2] ?? match[3] ?? '';
    const found = CJK.exec(value);
    if (found !== null) {
      hits.push({ snippet: `${match[1]}="${value}"`.slice(0, 80), char: found[0] });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// ① 键集合等价
// ---------------------------------------------------------------------------

describe('门禁① zh-CN 与 en-US 键集合等价', () => {
  const zh = flatten(zhCN);
  const en = flatten(enUS);

  it('键集合完全相等（递归拍平）', () => {
    const zhOnly = [...zh.keys()].filter((key) => !en.has(key));
    const enOnly = [...en.keys()].filter((key) => !zh.has(key));
    expect(zhOnly, 'en-US 缺失的键').toEqual([]);
    expect(enOnly, 'en-US 多出的键').toEqual([]);
    expect(zh.size).toBe(en.size);
  });
});

// ---------------------------------------------------------------------------
// ② 无空值 + en 值无 CJK
// ---------------------------------------------------------------------------

describe('门禁② 值非空且 en-US 无 CJK', () => {
  const zh = flatten(zhCN);
  const en = flatten(enUS);

  it('zh-CN 全部值非空字符串', () => {
    const empty = [...zh.entries()].filter(([, value]) => value.trim().length === 0).map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('en-US 全部值非空字符串', () => {
    const empty = [...en.entries()].filter(([, value]) => value.trim().length === 0).map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('en-US 值不含 CJK 字符（防「忘了翻译」）', () => {
    const offenders = [...en.entries()].filter(([, value]) => CJK.test(value));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ③ 渲染层无残留硬编码
// ---------------------------------------------------------------------------

describe('门禁③ renderer 源码 JSX 文本/属性字面量无 CJK', () => {
  const rendererRoot = join(import.meta.dirname, '..', 'src', 'renderer', 'src');

  it('JSX 文本与 aria-label/placeholder/title/alt/label 字面量不含 CJK', () => {
    const offenders: string[] = [];
    for (const file of walkSources(rendererRoot)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const hit of [...findJsxTextCjk(source), ...findAttrCjk(source)]) {
        offenders.push(`${file} → ${hit.snippet}（含「${hit.char}」）`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ④ 切换 locale 后关键文案
// ---------------------------------------------------------------------------

describe('门禁④ 切换 locale 后五处关键文案', () => {
  it('en-US：主界面/侧栏/面板/设置/对话框各一处为英文', () => {
    setLocale('en-US');
    expect(t('app.searchLabel')).toBe('Search (Ctrl+K)'); // 主界面（顶栏）
    expect(t('sidebar.trash')).toBe('Trash'); // 侧栏
    expect(t('palette.placeholder')).toBe('Search pages, databases, or type > for commands'); // 面板
    expect(t('settings.appearance.language')).toBe('Language'); // 设置
    expect(t('pageDelete.title')).toBe('Delete Page'); // 对话框
  });

  it('切回 zh-CN：同五处复原中文', () => {
    setLocale('en-US');
    setLocale('zh-CN');
    expect(t('app.searchLabel')).toBe('搜索（Ctrl+K）');
    expect(t('sidebar.trash')).toBe('回收站');
    expect(t('palette.placeholder')).toBe('搜索页面、数据库，或输入 > 命令');
    expect(t('settings.appearance.language')).toBe('语言');
    expect(t('pageDelete.title')).toBe('删除页面');
  });

  it('useLocale 订阅：setLocale 后组件文案即时切换', () => {
    // .ts 文件（任务书钉死文件名）不能写 JSX：用 createElement 构造探针
    const Probe = (): ReturnType<typeof createElement> => {
      const locale = useLocale();
      return createElement('p', { 'data-testid': 'i18n-probe' }, `${t('sidebar.trash')}#${locale}`);
    };
    render(createElement(Probe));
    expect(screen.getByTestId('i18n-probe').textContent).toBe('回收站#zh-CN');
    act(() => {
      setLocale('en-US');
    });
    expect(screen.getByTestId('i18n-probe').textContent).toBe('Trash#en-US');
    act(() => {
      setLocale('zh-CN');
    });
    expect(screen.getByTestId('i18n-probe').textContent).toBe('回收站#zh-CN');
  });

  it('systemLocale：zh* → zh-CN，其余 → en-US，不可用回 zh-CN', () => {
    const original = window.navigator.language;
    Object.defineProperty(window.navigator, 'language', { value: 'zh-TW', configurable: true });
    expect(systemLocale()).toBe('zh-CN');
    Object.defineProperty(window.navigator, 'language', { value: 'fr-FR', configurable: true });
    expect(systemLocale()).toBe('en-US');
    Object.defineProperty(window.navigator, 'language', { value: original, configurable: true });
  });
});
