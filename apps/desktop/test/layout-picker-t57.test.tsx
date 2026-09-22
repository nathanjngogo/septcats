// @vitest-environment jsdom
/**
 * layout-picker-t57.test.tsx —— TASK-T57-01 §1.2 布局快选弹框（像素模态）自动化面。
 *
 * 覆盖：
 * - 关闭态不渲染；打开态 = role=dialog + aria-modal + 3 张预设卡 + 「自定义编辑…」；
 * - 每张卡是 **CSS/div 画的抽象微缩图**（含 .layout-preview 且无 <img>，禁位图）；
 * - 当前预设卡高亮（aria-pressed），点卡 = 即时应用（store + 根节点变量 + localStorage
 *   + toast），且**弹框不关闭**（可连续试卡）；
 * - Esc / 点遮罩 = 关闭且**布局不变**（store 与 localStorage 双断言）；点面板内部不关；
 * - 「自定义编辑…」= 走 onEdit 出口（本组件不动布局）；
 * - 打开时聚焦当前预设卡；Tab 在框内圈闭。
 *
 * 纪律：jsdom 原生 localStorage；不需要 window.septcats（本组件不碰 IPC）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutPicker } from '../src/renderer/src/layout/LayoutPicker';
import {
  LAYOUT_STORAGE_KEY,
  layoutActions,
  layoutStore,
  makeDefaultLayout,
} from '../src/renderer/src/layout/layoutState';
import { pagesStore } from '../src/renderer/src/state/pages';

function persistedLayout(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '') as Record<string, unknown>;
}

function toasts(): string[] {
  return pagesStore.getState().toasts.map((toast) => toast.message);
}

beforeEach(() => {
  window.localStorage.clear();
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  pagesStore.setState((state) => ({ ...state, toasts: [] }));
  document.documentElement.style.removeProperty('--sc-layout-sidebar');
  document.documentElement.style.removeProperty('--sc-layout-measure');
  layoutActions.init();
});

afterEach(() => {
  cleanup();
});

describe('T57-01 §1.2 布局快选弹框', () => {
  it('关闭态不渲染；打开态 = role=dialog + aria-modal + 三张预设卡 + 自定义编辑入口', () => {
    const { container, rerender } = render(
      <LayoutPicker open={false} onClose={() => {}} onEdit={() => {}} />,
    );
    expect(container.querySelector('[data-testid="layout-picker"]')).toBeNull();

    rerender(<LayoutPicker open onClose={() => {}} onEdit={() => {}} />);
    const dialog = screen.getByTestId('layout-picker');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByTestId('layout-picker-card-notion')).toBeDefined();
    expect(screen.getByTestId('layout-picker-card-focus')).toBeDefined();
    expect(screen.getByTestId('layout-picker-card-workbench')).toBeDefined();
    expect(screen.getByTestId('layout-picker-edit')).toBeDefined();
  });

  it('每张卡画的是 CSS 抽象微缩图（有 .layout-preview、无位图 <img>），且几何随预设不同', () => {
    render(<LayoutPicker open onClose={() => {}} onEdit={() => {}} />);
    const previews = screen.getAllByTestId('layout-preview');
    expect(previews).toHaveLength(3);
    expect(document.querySelectorAll('.layout-picker img')).toHaveLength(0);

    // notion/workbench 有侧栏列；focus 无（收起）
    const notion = screen.getByTestId('layout-picker-card-notion').querySelector('[data-testid="layout-preview"]');
    const focus = screen.getByTestId('layout-picker-card-focus').querySelector('[data-testid="layout-preview"]');
    expect(notion?.getAttribute('data-sidebar')).toBe('left');
    expect(focus?.getAttribute('data-sidebar')).toBe('collapsed');
    // 卡上不画 AI 面板（三预设 ai.position 均为 right，图上右侧留列）
    expect(notion?.getAttribute('data-ai')).toBe('right');
    // notion/focus = AI 收起（窄轨），workbench = AI 展开（图上可辨）
    expect(notion?.getAttribute('data-ai-expanded')).toBe('off');
    expect(
      screen
        .getByTestId('layout-picker-card-workbench')
        .querySelector('[data-testid="layout-preview"]')
        ?.getAttribute('data-ai-expanded'),
    ).toBe('on');
    // 侧栏占比内联变量按预设宽度派生（notion/workbench 240 → 19.3%）
    expect(notion?.getAttribute('style')).toContain('--sc-layout-preview-sidebar: 19.3%');
  });

  it('当前预设卡高亮（aria-pressed），其余为 false', () => {
    render(<LayoutPicker open onClose={() => {}} onEdit={() => {}} />);
    expect(screen.getByTestId('layout-picker-card-notion').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('layout-picker-card-focus').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('layout-picker-card-workbench').getAttribute('aria-pressed')).toBe('false');
  });

  it('点卡 = 即时应用（store/根变量/存储/toast 四处跟随）+ 弹框不关闭 + 高亮转移', () => {
    const onClose = vi.fn();
    render(<LayoutPicker open onClose={onClose} onEdit={() => {}} />);

    fireEvent.click(screen.getByTestId('layout-picker-card-focus'));

    expect(layoutStore.getState().layout.preset).toBe('focus');
    expect(document.documentElement.style.getPropertyValue('--sc-layout-measure')).toBe('900px');
    expect(document.documentElement.style.getPropertyValue('--sc-layout-sidebar')).toBe('240px');
    expect(persistedLayout()).toMatchObject({
      preset: 'focus',
      sidebar: { position: 'collapsed', width: 240 },
      content: { measure: 900 },
    });
    expect(toasts().some((message) => message.includes('专注'))).toBe(true);
    // 弹框保持打开（可连续试卡）+ 高亮已转移
    expect(screen.getByTestId('layout-picker')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('layout-picker-card-focus').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('layout-picker-card-notion').getAttribute('aria-pressed')).toBe('false');
  });

  it('连续试三张卡：每次即时套用（workbench 带 AI 默认展开），存储逐次跟随', () => {
    render(<LayoutPicker open onClose={() => {}} onEdit={() => {}} />);
    fireEvent.click(screen.getByTestId('layout-picker-card-focus'));
    expect(persistedLayout()).toMatchObject({ preset: 'focus' });
    fireEvent.click(screen.getByTestId('layout-picker-card-workbench'));
    expect(persistedLayout()).toMatchObject({ preset: 'workbench', ai: { position: 'right', expanded: true } });
    fireEvent.click(screen.getByTestId('layout-picker-card-notion'));
    expect(persistedLayout()).toMatchObject({ preset: 'notion', content: { measure: 650 } });
    expect(toasts()).toHaveLength(3);
  });

  it('Esc = 关闭且布局零改动（store 与 localStorage 双断言）', () => {
    const onClose = vi.fn();
    render(<LayoutPicker open onClose={onClose} onEdit={() => {}} />);
    const before = layoutStore.getState().layout;
    const persistedBefore = window.localStorage.getItem(LAYOUT_STORAGE_KEY);

    fireEvent.click(screen.getByTestId('layout-picker-card-focus'));
    const applied = layoutStore.getState().layout;
    const persistedApplied = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    expect(applied).not.toEqual(before);

    fireEvent.keyDown(screen.getByTestId('layout-picker'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Esc 只关框：点卡后的状态保持（Esc 既不「回滚」到点卡前，也不额外改动）
    expect(layoutStore.getState().layout).toEqual(applied);
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(persistedApplied);
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).not.toBe(persistedBefore);
  });

  it('点遮罩 = 关闭（布局不变）；点面板内部不关闭', () => {
    const onClose = vi.fn();
    render(<LayoutPicker open onClose={onClose} onEdit={() => {}} />);
    const snapshot = layoutStore.getState().layout;
    const persistedBefore = window.localStorage.getItem(LAYOUT_STORAGE_KEY);

    fireEvent.mouseDown(screen.getByTestId('layout-picker-card-notion'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId('layout-picker-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(layoutStore.getState().layout).toEqual(snapshot);
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(persistedBefore);
  });

  it('「自定义编辑…」走 onEdit 出口（本组件不动布局、不自关）', () => {
    const onClose = vi.fn();
    const onEdit = vi.fn();
    render(<LayoutPicker open onClose={onClose} onEdit={onEdit} />);
    const snapshot = layoutStore.getState().layout;

    fireEvent.click(screen.getByTestId('layout-picker-edit'));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(layoutStore.getState().layout).toEqual(snapshot);
  });

  it('打开时聚焦当前预设卡；Tab 在框内圈闭（末元素 → 首元素）', () => {
    render(<LayoutPicker open onClose={() => {}} onEdit={() => {}} />);
    const current = screen.getByTestId('layout-picker-card-notion');
    expect(document.activeElement).toBe(current);

    // 焦点移到末元素（自定义编辑钮）→ Tab → 回到首元素（notion 卡）
    const edit = screen.getByTestId('layout-picker-edit');
    edit.focus();
    expect(document.activeElement).toBe(edit);
    fireEvent.keyDown(screen.getByTestId('layout-picker'), { key: 'Tab' });
    expect(document.activeElement).toBe(current);

    // Shift+Tab 在首元素 → 末元素
    fireEvent.keyDown(screen.getByTestId('layout-picker'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(edit);
  });
});
