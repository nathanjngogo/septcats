// @vitest-environment jsdom
/**
 * page-appearance.test.tsx —— N1-② 页面图标/封面契约（Notion 对齐）。
 *
 * 覆盖三层：
 *  ① 选择器交互：图标画廊（数量/搜索过滤/点选/移除可用性）+ 封面画廊（token 点选）+ Escape 关闭；
 *  ② 静态一致性：COVER_TOKENS 每个 token 必须在 PageAppearance.css 里有 `[data-cover='x']` 视觉定义
 *     （页面头部与缩略图共用同一 data-cover → 视觉恒一致）；反之 CSS 不得有多余的封面 token；
 *  ③ i18n 成对：zh-CN / en-US 两处键集完全一致（缺一个键在另一语言下会露出中文/英文兜底）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COVER_TOKENS,
  PageAppearancePicker,
  appearanceActionLabel,
} from '../src/renderer/src/pages/PageAppearance';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(here, '..', 'src', 'renderer', 'src');
const css = readFileSync(join(RENDERER, 'pages', 'PageAppearance.css'), 'utf8');
const zh = readFileSync(join(RENDERER, 'i18n', 'zh-CN.ts'), 'utf8');
const en = readFileSync(join(RENDERER, 'i18n', 'en-US.ts'), 'utf8');

/** 外观键（两侧必须齐备）。 */
const APPEARANCE_KEYS = [
  'addIcon',
  'changeIcon',
  'removeIcon',
  'addCover',
  'changeCover',
  'removeCover',
  'iconSearch',
  'iconEmpty',
] as const;

afterEach(() => {
  cleanup();
});

describe('N1-② 外观选择器：图标', () => {
  it('渲染精选 emoji 画廊（≥40 枚）并可按关键词过滤', () => {
    render(
      <PageAppearancePicker kind="icon" current={null} onPick={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('data-testid')?.startsWith('page-icon-option-'));
    expect(buttons.length, '精选集规模').toBeGreaterThanOrEqual(40);

    // 关键词命中：'电商' 只在 🛒 的 keyword 串里
    fireEvent.change(screen.getByPlaceholderText('搜索图标'), { target: { value: '电商' } });
    const after = screen.getAllByRole('button').filter((b) => b.getAttribute('data-testid')?.startsWith('page-icon-option-'));
    expect(after).toHaveLength(1);
    expect(after[0]?.getAttribute('data-testid')).toBe('page-icon-option-🛒');
  });

  it('无命中时显示空态；点选回调带回 emoji', () => {
    const onPick = vi.fn();
    render(
      <PageAppearancePicker kind="icon" current={null} onPick={onPick} onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText('搜索图标'), { target: { value: 'zzz-no-such' } });
    expect(screen.getByText('没有匹配的图标')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('搜索图标'), { target: { value: '品牌' } });
    fireEvent.click(screen.getByTestId('page-icon-option-🐴'));
    expect(onPick).toHaveBeenCalledWith('🐴');
  });

  it('移除按钮仅在已有值时可点；Escape 关闭浮层', () => {
    const onRemove = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <PageAppearancePicker kind="icon" current={null} onPick={vi.fn()} onRemove={onRemove} onClose={onClose} />,
    );
    const btn = screen.getByRole('button', { name: '移除图标' });
    expect(btn.hasAttribute('disabled'), '无值 → 禁用').toBe(true);

    rerender(
      <PageAppearancePicker kind="icon" current="📄" onPick={vi.fn()} onRemove={onRemove} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '移除图标' }));
    expect(onRemove).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('N1-② 外观选择器：封面', () => {
  it('渲染 COVER_TOKENS 全量缩略图并回传 token', () => {
    const onPick = vi.fn();
    render(
      <PageAppearancePicker kind="cover" current={null} onPick={onPick} onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    for (const token of COVER_TOKENS) {
      expect(screen.getByTestId(`page-cover-option-${token}`), `缺缩略图 ${token}`).toBeTruthy();
    }
    const third = COVER_TOKENS[2];
    fireEvent.click(screen.getByTestId(`page-cover-option-${third}`));
    expect(onPick).toHaveBeenCalledWith(third);
  });

  it('触发器文案两态：无值「添加…」/ 有值「更换…」', () => {
    expect(appearanceActionLabel('icon', false)).toBe('添加图标');
    expect(appearanceActionLabel('icon', true)).toBe('更换图标');
    expect(appearanceActionLabel('cover', false)).toBe('添加封面');
    expect(appearanceActionLabel('cover', true)).toBe('更换封面');
  });
});

describe('N1-② 静态一致性门禁', () => {
  it('每个封面 token 在 CSS 里都有视觉定义，且 CSS 无多余 token', () => {
    const declared = [...css.matchAll(/\[data-cover='([a-z]+)'\]/g)].map((m) => m[1]);
    for (const token of COVER_TOKENS) {
      expect(declared, `CSS 缺 [data-cover='${token}']`).toContain(token);
    }
    expect(declared.sort()).toEqual([...COVER_TOKENS].sort());
  });

  it('外观文案 zh-CN / en-US 键集一致', () => {
    for (const key of APPEARANCE_KEYS) {
      expect(zh.includes(`${key}:`), `zh-CN 缺 ${key}`).toBe(true);
      expect(en.includes(`${key}:`), `en-US 缺 ${key}`).toBe(true);
    }
  });
});