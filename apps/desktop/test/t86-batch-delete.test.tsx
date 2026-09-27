// @vitest-environment jsdom
/**
 * t86-batch-delete.test.tsx —— 侧栏「批量删除」（TASK-T86-01，老板 09-27 令第 5 条）。
 *
 * 覆盖：
 * - 入口行「批量删除…」→ 多选操作条（计数 / 全选 / 清空 / 删除所选 / 取消 / Esc 退出）；
 * - 多选态点行 = 勾选（不导航、不进行内重命名、不出「⋯」菜单）；
 * - 删除所选 → 确认弹层（确认前不 remove）；确认 → 逐页 pages:remove + **一条**汇总 toast；
 * - 祖先/子孙同选只删祖先（子树删除已覆盖子孙，避免重复 IPC）；
 * - 删完自动摘除选中集（计数不残留僵尸 id）；
 * - 纪律：window.septcats 用 vi.stubGlobal 假桥；断言落在 store 状态与假桥调用。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { BatchDeleteDialog } from '../src/renderer/src/pages/BatchDeleteDialog';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import type { SeptcatsApi } from '../src/types/window';

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

const WS_ID = 'ws-t86-test';

function pageNode(overrides: Partial<PageNode> & Pick<PageNode, 'id'>): PageNode {
  return {
    title: overrides.id,
    icon: null,
    cover: null,
    workspaceId: WS_ID,
    parentId: null,
    sortKey: 'A00000000',
    version: 1,
    alive: 1,
    deletedAt: null,
    childIds: [],
    depth: 0,
    ...overrides,
  };
}

function resetPagesStore(extra?: Partial<PagesState>): void {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: WS_ID,
    workspaces: [{ id: WS_ID, name: '个人工作区' }],
    nodes: [],
    expanded: new Set<string>(),
    selectedId: null,
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    deleteConfirmId: null,
    deleteBatch: null,
    ...extra,
  }));
}

type Bridge = {
  remove: ReturnType<typeof vi.fn>;
  tree: ReturnType<typeof vi.fn>;
};

let nodesDb: PageNode[] = [];
let bridge: Bridge;

function installBridge(): void {
  const impl: Bridge = {
    remove: vi.fn(async ({ id }: { id: string }) => {
      for (const node of nodesDb) {
        if (node.id === id) {
          node.alive = 0;
          node.deletedAt = Date.now();
        }
      }
      return { deleted: 1 };
    }),
    tree: vi.fn(async () => nodesDb.map((node) => ({ ...node, childIds: [...node.childIds] }))),
  };
  bridge = impl;
  vi.stubGlobal('septcats', {
    workspaces: {
      list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }),
    },
    pages: { tree: impl.tree, remove: impl.remove },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: vi.fn(async () => ({ pageIds: [] })) },
  } as unknown as SeptcatsApi);
}

function renderSidebar(): void {
  render(
    <>
      <SidebarTree />
      <BatchDeleteDialog />
    </>,
  );
}

function enterBulk(): void {
  fireEvent.click(screen.getByTestId('side-bulk-toggle'));
}

function countText(): string | null {
  return screen.getByTestId('side-bulk-count').textContent;
}

describe('T86-01 · 侧栏批量删除', () => {
  beforeEach(() => {
    nodesDb = [
      pageNode({ id: 'pg-a', title: '暗物质探测实验笔记' }),
      pageNode({ id: 'pg-b', title: '论文速览', sortKey: 'A00000001' }),
      pageNode({ id: 'pg-c', title: '周报', sortKey: 'A00000002' }),
    ];
    installBridge();
    resetPagesStore({ nodes: nodesDb, selectedId: 'pg-a' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('入口行 → 多选操作条（计数 0）；再点行 = 勾选且不导航', () => {
    renderSidebar();
    expect(screen.getByTestId('side-bulk-toggle')).toBeTruthy();
    expect(screen.queryByTestId('side-bulk-bar')).toBeNull();

    enterBulk();
    expect(screen.getByTestId('side-bulk-bar')).toBeTruthy();
    expect(countText()).toContain('0');

    // 选中态基准：进多选前 selectedId = pg-a；点 pg-b 只勾选、不改选中页
    fireEvent.click(screen.getByTestId('side-node-pg-b'));
    expect(countText()).toContain('1');
    expect(pagesStore.getState().selectedId).toBe('pg-a');
    // 再点取消勾选
    fireEvent.click(screen.getByTestId('side-node-pg-b'));
    expect(countText()).toContain('0');
  });

  it('勾选框（原生 checkbox）与行点击等价：勾上 → 取消', () => {
    renderSidebar();
    enterBulk();
    const box = screen.getByTestId('side-bulk-check-pg-c') as HTMLInputElement;
    fireEvent.click(box);
    expect(countText()).toContain('1');
    expect((screen.getByTestId('side-bulk-check-pg-c') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('side-bulk-check-pg-c'));
    expect(countText()).toContain('0');
  });

  it('全选 / 清空 / Esc 退出', () => {
    renderSidebar();
    enterBulk();
    fireEvent.click(screen.getByTestId('side-bulk-all'));
    expect(countText()).toContain('3');
    fireEvent.click(screen.getByTestId('side-bulk-clear'));
    expect(countText()).toContain('0');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('side-bulk-bar')).toBeNull();
    // 退出后恢复常态：入口行回来、行点击 = 导航
    expect(screen.getByTestId('side-bulk-toggle')).toBeTruthy();
    fireEvent.click(screen.getByTestId('side-node-pg-c'));
    expect(pagesStore.getState().selectedId).toBe('pg-c');
  });

  it('多选态隐藏行「⋯」菜单（删除入口收敛到操作条）', () => {
    renderSidebar();
    expect(screen.getByTestId('side-more-pg-a')).toBeTruthy();
    enterBulk();
    expect(screen.queryByTestId('side-more-pg-a')).toBeNull();
  });

  it('删除所选 → 确认弹层（确认前不 remove）→ 逐页软删 + 一条汇总 toast', async () => {
    renderSidebar();
    enterBulk();
    fireEvent.click(screen.getByTestId('side-node-pg-a'));
    fireEvent.click(screen.getByTestId('side-node-pg-b'));
    fireEvent.click(screen.getByTestId('side-bulk-delete'));

    // 弹层开、store 记录待删集；确认前不得动 IPC
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(pagesStore.getState().deleteBatch).toEqual(['pg-a', 'pg-b']);
    expect(bridge.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('bulk-delete-confirm'));

    await waitFor(() => expect(bridge.remove).toHaveBeenCalledTimes(2));
    expect(bridge.remove).toHaveBeenCalledWith({ id: 'pg-a' });
    expect(bridge.remove).toHaveBeenCalledWith({ id: 'pg-b' });
    // 汇总 toast **只有一条**（逐页静默）
    const toasts = pagesStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe('已移入回收站 2 项');
    expect(toasts[0]?.testId).toBe('toast-bulk-delete');
    // 收尾：视图回 pages、待删集清空、树对账后两页 alive=0
    expect(pagesStore.getState().deleteBatch).toBeNull();
    expect(pagesStore.getState().view).toBe('pages');
    await waitFor(() => {
      expect(pagesStore.getState().nodes.find((n) => n.id === 'pg-a')?.alive).toBe(0);
      expect(pagesStore.getState().nodes.find((n) => n.id === 'pg-b')?.alive).toBe(0);
    });
    // 选中集同步摘除已删页（计数不残留僵尸 id）
    await waitFor(() => expect(countText()).toContain('0'));
  });

  it('取消 → 不触发 remove，待删集清空', () => {
    renderSidebar();
    enterBulk();
    fireEvent.click(screen.getByTestId('side-node-pg-a'));
    fireEvent.click(screen.getByTestId('side-bulk-delete'));
    fireEvent.click(screen.getByTestId('bulk-delete-cancel'));

    expect(bridge.remove).not.toHaveBeenCalled();
    expect(pagesStore.getState().deleteBatch).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('祖先/子孙同选 → 只删祖先一次（子树删除已覆盖子孙）', async () => {
    nodesDb = [
      pageNode({ id: 'pg-parent', title: '研究', childIds: ['pg-child'] }),
      pageNode({
        id: 'pg-child',
        title: '子页',
        parentId: 'pg-parent',
        depth: 1,
        sortKey: 'A00000001',
      }),
    ];
    resetPagesStore({ nodes: nodesDb, expanded: new Set<string>(['pg-parent']) });
    renderSidebar();
    enterBulk();
    fireEvent.click(screen.getByTestId('side-node-pg-parent'));
    fireEvent.click(screen.getByTestId('side-node-pg-child'));
    expect(countText()).toContain('2');

    fireEvent.click(screen.getByTestId('side-bulk-delete'));
    fireEvent.click(screen.getByTestId('bulk-delete-confirm'));

    await waitFor(() => expect(bridge.remove).toHaveBeenCalledTimes(1));
    expect(bridge.remove).toHaveBeenCalledWith({ id: 'pg-parent' });
    expect(pagesStore.getState().toasts[0]?.message).toBe('已移入回收站 1 项');
  });

  it('空选 → 「删除所选」置灰，点不动（不进弹层）', () => {
    renderSidebar();
    enterBulk();
    const del = screen.getByTestId('side-bulk-delete') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(pagesStore.getState().deleteBatch).toBeNull();
  });
});