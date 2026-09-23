// @vitest-environment jsdom
/**
 * t71-customize.test.tsx —— TASK-T71-01 §3：自定义模式 UI（jsdom）。
 *
 * 覆盖（K3/K4 前端锚）：
 * - wb-customize 开关进入编辑态（卡壳出手柄/移除钮）；完成钮退出；
 * - 拖拽重排（T60 语法）：dragStart/Over/Drop → 序变更 + 即时写 v2 localStorage；
 * - ⊟ 移除 → 进 hidden（卡从可见流消失）+ 卡目录列出「已移除·点击恢复」；
 * - + 添加卡片目录 Menu（T70 宿主钮 stopPropagation 再开）列出隐藏卡；点击恢复可见。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；localStorage 用 jsdom 原生。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchPage } from '../src/renderer/src/workbench/WorkbenchPage';
import {
  DEFAULT_CARD_ORDER,
  WORKBENCH_CARDS_STORAGE_KEY,
  workbenchActions,
  workbenchStore,
} from '../src/renderer/src/workbench/state';
import { pagesStore } from '../src/renderer/src/state/pages';
import type { PageNodeView, SeptcatsApi } from '../src/types/window';

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WS_ID = 'ws-t71';

function viewNode(overrides: Partial<PageNodeView> & Pick<PageNodeView, 'id'>): PageNodeView {
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
    pageType: 'page',
    summary: null,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const NODES: PageNodeView[] = [
  viewNode({ id: 'db-a', title: '任务库', pageType: 'database' }),
  viewNode({ id: 'pg-1', title: '研究' }),
  viewNode({ id: 'pg-2', title: '论文' }),
];

function resetStores(): void {
  workbenchStore.setState((state) => ({
    ...state,
    view: 'pages',
    cardOrder: [...DEFAULT_CARD_ORDER],
    hiddenCards: [],
  }));
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: WS_ID,
    workspaces: [{ id: WS_ID, name: '个人工作区' }],
    nodes: NODES,
    expanded: new Set<string>(),
    selectedId: 'pg-1',
    editingId: null,
    favoriteIds: [],
    recentIds: ['pg-1', 'pg-2'],
    toasts: [],
    deleteConfirmId: null,
    tabs: ['pg-1'],
  }));
}

function installBridge(): void {
  vi.stubGlobal('septcats', {
    pages: {
      tree: async () => NODES,
      create: vi.fn(async () => ({ id: 'pg-new', sortKey: 'A9' })),
      rename: vi.fn(async ({ id }: { id: string }) => ({ id })),
      move: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      restore: vi.fn(async () => ({})),
      purge: vi.fn(async () => ({})),
    },
    favorites: { list: async () => ({ pageIds: [] }), set: vi.fn(async () => ({})) },
    recent: { list: async () => ({ pageIds: ['pg-1', 'pg-2'] }), touch: vi.fn(async () => ({})) },
    db: {
      create: vi.fn(async () => ({ pageId: 'db-new', collectionId: 'co-new' })),
      load: vi.fn(async () => ({ collection: {}, records: [{ alive: 1 }] })),
    },
    blocks: { list: vi.fn(async () => ({ locked: false, blocks: [] })), commit: vi.fn(async () => ({})) },
    settings: { get: vi.fn(async () => ({}) as never), patch: vi.fn(async (p: never) => p) },
  } as unknown as SeptcatsApi);
}

beforeEach(() => {
  window.localStorage.clear();
  installBridge();
  resetStores();
  workbenchActions.openHome();
  render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('T71-01 自定义模式开关', () => {
  it('wb-customize 进入编辑态：卡壳出手柄 + 移除钮；wb-customize-done 退出', () => {
    expect(screen.queryByTestId('wb-customize')).toBeTruthy();
    expect(screen.queryByTestId('wb-card-grip-quick')).toBeNull();
    fireEvent.click(screen.getByTestId('wb-customize'));
    expect(screen.getByTestId('wb-card-grip-quick')).toBeTruthy();
    expect(screen.getByTestId('wb-card-remove-quick')).toBeTruthy();
    expect(screen.queryByTestId('wb-customize-done')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wb-customize-done'));
    expect(screen.queryByTestId('wb-card-grip-quick')).toBeNull();
    expect(screen.queryByTestId('wb-customize-done')).toBeNull();
  });

  it('默认 11 卡全渲染（5 旧 + 6 新），testid 不变', () => {
    for (const id of DEFAULT_CARD_ORDER) {
      expect(screen.getByTestId(`wb-card-${id}`)).toBeTruthy();
    }
    // 旧 5 卡关键 testid 仍生效（T66 探针口径）
    expect(screen.getByTestId('wb-quick-page')).toBeTruthy();
    expect(screen.getByTestId('wb-db-new')).toBeTruthy();
    expect(screen.getByTestId('wb-recent-row-pg-1')).toBeTruthy();
  });
});

describe('T71-01 拖拽重排（即时持久化 v2）', () => {
  it('dragStart/Over/Drop 改序 + 写盘', () => {
    fireEvent.click(screen.getByTestId('wb-customize'));
    const before = workbenchStore.getState().cardOrder;
    expect(before[0]).toBe('quick');
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByTestId('wb-slot-favorites'), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('wb-slot-quick'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('wb-slot-quick'), { dataTransfer });
    expect(workbenchStore.getState().cardOrder[0]).toBe('favorites');
    const persist = JSON.parse(window.localStorage.getItem(WORKBENCH_CARDS_STORAGE_KEY) ?? 'null');
    expect(persist?.v).toBe(2);
    expect(persist?.order[0]).toBe('favorites');
  });
});

describe('T71-01 移除 + 卡目录恢复', () => {
  it('⊟ 移除 favorites → 消失 + 目录标「已移除·点击恢复」；点击恢复可见', async () => {
    fireEvent.click(screen.getByTestId('wb-customize'));
    fireEvent.click(screen.getByTestId('wb-card-remove-favorites'));
    await waitFor(() => {
      expect(screen.queryByTestId('wb-card-favorites')).toBeNull();
    });
    expect(workbenchStore.getState().hiddenCards).toContain('favorites');
    // 末尾 + 添加卡片目录
    fireEvent.click(screen.getByTestId('wb-add-card-btn'));
    const restore = await screen.findByText(/已移除·点击恢复/);
    expect(restore).toBeTruthy();
    fireEvent.click(restore);
    await waitFor(() => {
      expect(screen.getByTestId('wb-card-favorites')).toBeTruthy();
    });
    expect(workbenchStore.getState().hiddenCards).not.toContain('favorites');
  });
});

describe('T71-01 卡目录宿主钮 stopPropagation（T70 教训）', () => {
  it('点 wb-add-card-btn 不误关菜单（菜单展开后可点恢复项）', async () => {
    fireEvent.click(screen.getByTestId('wb-customize'));
    // 先隐藏一张以便目录有内容
    fireEvent.click(screen.getByTestId('wb-card-remove-libstats'));
    await waitFor(() => expect(screen.queryByTestId('wb-card-libstats')).toBeNull());
    fireEvent.click(screen.getByTestId('wb-add-card-btn'));
    const restore = await screen.findByText(/已移除·点击恢复/);
    // 菜单未因宿主 click 冒泡自关
    expect(restore).toBeTruthy();
    fireEvent.click(restore);
    await waitFor(() => expect(screen.getByTestId('wb-card-libstats')).toBeTruthy());
  });
});
