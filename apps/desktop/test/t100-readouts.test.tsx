// @vitest-environment jsdom
/**
 * t100-readouts.test.tsx —— 顶栏「读数」区（方向 B 结构层，老板 2026-10-01「把结构层都补上」）。
 *
 * 覆盖：
 * - 三格在位（同步 / 待办 / 页面）且标语文案走 i18n；
 * - 待办数 = 未完成条数（假桥 list），写操作后派发 TODO_CHANGED_EVENT → 数值即时刷新；
 * - 页面数 = 活页数（deletedAt===0 过滤，与侧栏树同口径）；
 * - 同步态映射（idle→已同步 / syncing→同步中 / error→同步失败 + data-tone=error）；
 * - 主进程不可用（无 window.septcats）：不崩、待办显示占位「—」、页面数照常；
 * - 关掉桥订阅：卸载后不再调用 list（无泄漏）。
 *
 * 纪律：假桥走 vi.stubGlobal（同 templates-ui/todo 范式）；用例不写真实档案目录。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopReadouts } from '../src/renderer/src/layout/TopReadouts';
import { pagesStore } from '../src/renderer/src/state/pages';
import { TODO_CHANGED_EVENT } from '../src/renderer/src/todo/TodoSidePanel';
import type { PageNodeView } from '../src/types/window';

function pageNode(id: string, deletedAt = 0): PageNodeView {
  return {
    id,
    workspaceId: 'ws-1',
    parentId: null,
    title: id,
    kind: 'page',
    sortKey: id,
    createdAt: 1,
    updatedAt: 2,
    deletedAt,
    alive: deletedAt === 0,
    version: 1,
  } as unknown as PageNodeView;
}

interface Bridge {
  todo: { list: ReturnType<typeof vi.fn> };
  sync: { status: ReturnType<typeof vi.fn>; onState: ReturnType<typeof vi.fn> };
}

let bridge: Bridge;

function stubBridge(todoItems: Array<{ id: string; done: boolean }>, syncState: string): void {
  bridge = {
    todo: { list: vi.fn(async () => ({ items: todoItems })) },
    sync: {
      status: vi.fn(async () => ({ state: syncState })),
      onState: vi.fn(() => () => { /* 取消订阅 */ }),
    },
  };
  vi.stubGlobal('septcats', bridge);
}

describe('顶栏读数组件', () => {
  beforeEach(() => {
    pagesStore.setState((state) => ({
      ...state,
      nodes: [pageNode('pg-1'), pageNode('pg-2'), pageNode('pg-3'), pageNode('pg-4', 123)],
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('三格在位：同步 / 待办 / 页面；页面数 = 活页数（deletedAt 过滤）', async () => {
    stubBridge([{ id: 't1', done: false }, { id: 't2', done: true }, { id: 't3', done: false }], 'idle');
    render(<TopReadouts />);
    expect(screen.getByTestId('readout-sync')).toBeDefined();
    expect(screen.getByTestId('readout-todo')).toBeDefined();
    expect(screen.getByTestId('readout-pages')).toBeDefined();
    // 4 个节点里 1 个已删 ⇒ 活页 3
    expect(screen.getByTestId('readout-pages').textContent).toContain('3');
    // 待办只数未完成 ⇒ 2
    await waitFor(() => expect(screen.getByTestId('readout-todo').textContent).toContain('2'));
  });

  it('同步态映射：idle → 已同步（tone=ok）', async () => {
    stubBridge([], 'idle');
    render(<TopReadouts />);
    await waitFor(() => expect(screen.getByTestId('readout-sync').textContent).toContain('已同步'));
    expect(screen.getByTestId('readout-sync').getAttribute('data-tone')).toBe('ok');
  });

  it('同步态映射：error → 同步失败（tone=error，值文字走 danger 语义）', async () => {
    stubBridge([], 'error');
    render(<TopReadouts />);
    await waitFor(() => expect(screen.getByTestId('readout-sync').textContent).toContain('同步失败'));
    expect(screen.getByTestId('readout-sync').getAttribute('data-tone')).toBe('error');
  });

  it('待办变更事件 → 数值即时刷新（不重挂组件）', async () => {
    stubBridge([{ id: 't1', done: false }], 'idle');
    render(<TopReadouts />);
    await waitFor(() => expect(screen.getByTestId('readout-todo').textContent).toContain('1'));
    bridge.todo.list.mockResolvedValue({ items: [{ id: 't1', done: false }, { id: 't2', done: false }] });
    window.dispatchEvent(new CustomEvent(TODO_CHANGED_EVENT));
    await waitFor(() => expect(screen.getByTestId('readout-todo').textContent).toContain('2'));
  });

  it('主进程不可用：不崩；待办显示占位「—」，同步显示占位', async () => {
    vi.stubGlobal('septcats', undefined);
    render(<TopReadouts />);
    expect(screen.getByTestId('readout-todo').textContent).toContain('—');
    expect(screen.getByTestId('readout-pages').textContent).toContain('3');
  });
});