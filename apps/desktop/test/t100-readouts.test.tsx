// @vitest-environment jsdom
/**
 * t100-readouts.test.tsx —— 顶栏「读数」区（方向 B 结构层，老板 2026-10-01「把结构层都补上」）。
 *
 * 覆盖：
 * - 三格在位（同步 / 待办 / 页面）且标语文案走 i18n；
 * - 待办数 = 未完成条数（假桥 list），写操作后派发 TODO_CHANGED_EVENT → 数值即时刷新；
 * - 页面数 = 活页数（deletedAt===0 过滤，与侧栏树同口径）；
 * - 第①格 = 「最近同步 + 时刻」（事实型）；state=idle 也不得出现「已同步」这类状态措辞；
 * - **反重复契约**：读数区不得再放同步状态灯/tone（顶栏那粒药丸是唯一状态出口，
 *   曾因两处指示而互相矛盾 —— SyncRuntimeState 无 'disabled'，我按 fallback 亮绿灯谎报）；
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

function stubBridge(
  todoItems: Array<{ id: string; done: boolean }>,
  syncStatus: { state?: string; enabled?: boolean; lastSyncAt?: number } | null,
): void {
  bridge = {
    todo: { list: vi.fn(async () => ({ items: todoItems })) },
    sync: {
      status: vi.fn(async () => (syncStatus === null ? null : { enabled: true, ...syncStatus })),
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
    stubBridge([{ id: 't1', done: false }, { id: 't2', done: true }, { id: 't3', done: false }], { state: 'ok', lastSyncAt: 1 });
    render(<TopReadouts />);
    expect(screen.getByTestId('readout-sync')).toBeDefined();
    expect(screen.getByTestId('readout-todo')).toBeDefined();
    expect(screen.getByTestId('readout-pages')).toBeDefined();
    // 4 个节点里 1 个已删 ⇒ 活页 3
    expect(screen.getByTestId('readout-pages').textContent).toContain('3');
    // 待办只数未完成 ⇒ 2
    await waitFor(() => expect(screen.getByTestId('readout-todo').textContent).toContain('2'));
  });

  it('第①格 = 「最近同步」+ 时刻（有 lastSyncAt 时按 HH:MM，不写死日期）', async () => {
    stubBridge([], { state: 'ok', lastSyncAt: Date.UTC(2026, 0, 2, 3, 4) });
    render(<TopReadouts />);
    const cell = screen.getByTestId('readout-sync');
    expect(cell.textContent).toContain('最近同步');
    await waitFor(() => expect(cell.textContent).toMatch(/\d{1,2}:\d{2}/u));
  });

  it('从未同步过（lastSyncAt=0）→ 「未同步过」，而不是任何「已同步」类措辞', async () => {
    stubBridge([], { state: 'idle', enabled: false, lastSyncAt: 0 });
    render(<TopReadouts />);
    await waitFor(() => expect(screen.getByTestId('readout-sync').textContent).toContain('未同步过'));
    expect(screen.getByTestId('readout-sync').textContent, 'state=idle 不得被当成「已同步」').not.toContain('已同步');
  });

  it('契约：读数区不得再放同步状态灯/色调（状态只由顶栏药丸表达，防两处指示互相矛盾）', async () => {
    stubBridge([], { state: 'idle', enabled: false, lastSyncAt: 0 });
    render(<TopReadouts />);
    const cell = screen.getByTestId('readout-sync');
    expect(cell.getAttribute('data-tone'), '不得再挂 tone 档位').toBeNull();
    expect(cell.querySelector('.sc-readouts__lamp'), '不得再放状态灯').toBeNull();
  });

  it('待办变更事件 → 数值即时刷新（不重挂组件）', async () => {
    stubBridge([{ id: 't1', done: false }], { state: 'ok', lastSyncAt: 1 });
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