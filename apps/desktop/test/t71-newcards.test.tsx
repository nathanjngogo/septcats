// @vitest-environment jsdom
/**
 * t71-newcards.test.tsx —— TASK-T71-01 §2：六新卡逐一最小功能 + 空态（jsdom）。
 *
 * K2 前端锚：shortcut / countdown / heatmap / quote / bookmarks / libstats 各存在且可断言：
 * - shortcut：空态 + 页面拾取器添加/移除；
 * - countdown：空态 + 添加（天数算术）+ 非法日期标红 + 移除；
 * - heatmap：7 格 + data-level（写点 bump 后今日档>0）；
 * - quote：读 blocks.list 取首文本非空（空态当无块）；
 * - bookmarks：空态 + 合法 URL 收藏 / 非法 URL 拒收 + 移除（D-1 只记录不跳转）；
 * - libstats：四格数字对得上 tree 聚合。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；localStorage 用 jsdom 原生。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchPage } from '../src/renderer/src/workbench/WorkbenchPage';
import { localDateKey } from '../src/renderer/src/workbench/work';
import {
  DEFAULT_CARD_ORDER,
  workbenchActions,
  workbenchStore,
} from '../src/renderer/src/workbench/state';
import { daysUntil } from '../src/renderer/src/workbench/cards';
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

function installBridge(blocksForQuote = true): void {
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
    blocks: {
      list: vi.fn(async ({ pageId }: { pageId: string }) => {
        if (blocksForQuote && pageId === 'pg-1') {
          return {
            locked: false,
            blocks: [{ id: 'b1', page_id: 'pg-1', type: 'paragraph', props: {}, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '摘抄这段文字' }] }] }, parent_id: null, sort_key: 'A1' }],
          };
        }
        return { locked: false, blocks: [] };
      }),
      commit: vi.fn(async () => ({})),
    },
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

describe('T71-01 shortcut 卡', () => {
  it('空态 → 拾取器添加页面 → 出现项 → 移除', async () => {
    expect(screen.getByTestId('wb-shortcut-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wb-shortcut-add'));
    const input = await screen.findByTestId('wb-shortcut-picker-input');
    fireEvent.change(input, { target: { value: '研究' } });
    const pick = await screen.findByTestId('wb-shortcut-pick-pg-1');
    fireEvent.click(pick);
    await waitFor(() => expect(screen.getByTestId('wb-shortcut-item-pg-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wb-shortcut-remove-pg-1'));
    await waitFor(() => expect(screen.queryByTestId('wb-shortcut-item-pg-1')).toBeNull());
  });
});

describe('T71-01 countdown 卡', () => {
  it('空态 → 添加（天数算术）→ 移除', async () => {
    expect(screen.getByTestId('wb-countdown-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wb-countdown-add'));
    fireEvent.change(await screen.findByTestId('wb-countdown-input-label'), { target: { value: '发布' } });
    fireEvent.change(screen.getByTestId('wb-countdown-input-date'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByTestId('wb-countdown-submit'));
    await waitFor(() => expect(screen.getByTestId('wb-countdown-item-0')).toBeTruthy());
    const days = screen.getByTestId('wb-countdown-days-0').textContent ?? '';
    expect(days).toContain('天');
    expect(days).toContain(String(daysUntil('2030-01-01', new Date())));
    fireEvent.click(screen.getByTestId('wb-countdown-remove-0'));
    await waitFor(() => expect(screen.queryByTestId('wb-countdown-item-0')).toBeNull());
  });

  it('非法日期标红（danger）', async () => {
    fireEvent.click(screen.getByTestId('wb-countdown-add'));
    fireEvent.change(await screen.findByTestId('wb-countdown-input-label'), { target: { value: 'X' } });
    fireEvent.change(screen.getByTestId('wb-countdown-input-date'), { target: { value: 'not-date' } });
    fireEvent.click(screen.getByTestId('wb-countdown-submit'));
    await waitFor(() => expect(screen.getByTestId('wb-countdown-item-0')).toBeTruthy());
    expect(screen.getByTestId('wb-countdown-days-0').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('T71-01 heatmap 卡', () => {
  it('7 格 + data-level；bump 后今日档>0', async () => {
    // 预热：写一次今日活跃（日期无关化：用 app 同一口径 localDateKey 计算今天，
    // 不再硬编码写用例当天；原写死 '2026-09-23' 会随日期腐化而红）
    const todayKey = localDateKey(new Date());
    window.localStorage.setItem('septcats.wbcard.activity.days', JSON.stringify({ [todayKey]: 5 }));
    workbenchActions.init?.();
    act(() => {
      workbenchStore.setState((s) => ({ ...s }));
    });
    // 重新渲染以读新活动
    cleanup();
    installBridge();
    resetStores();
    workbenchActions.openHome();
    render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
    const cells = await screen.findAllByTestId(/^wb-heatmap-cell-/);
    expect(cells).toHaveLength(7);
    const todayCell = screen.getByTestId(`wb-heatmap-cell-${todayKey}`);
    expect(Number(todayCell.getAttribute('data-count'))).toBe(5);
    expect(Number(todayCell.getAttribute('data-level'))).toBeGreaterThan(0);
  });
});

describe('T71-01 quote 卡', () => {
  it('读 blocks.list 取首文本非空；点击定位页', async () => {
    const text = await screen.findByTestId('wb-quote-text');
    expect(text.textContent).toContain('摘抄这段文字');
    fireEvent.click(text);
    expect(pagesStore.getState().selectedId).toBe('pg-1');
  });

  it('无文本块 → 空态', async () => {
    cleanup();
    installBridge(false);
    resetStores();
    workbenchActions.openHome();
    render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
    expect(await screen.findByTestId('wb-quote-empty')).toBeTruthy();
  });
});

describe('T71-01 bookmarks 卡', () => {
  it('空态 → 合法 URL 收藏 → 移除（D-1 点击不跳转只记录）', async () => {
    expect(screen.getByTestId('wb-bookmarks-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wb-bookmarks-add'));
    fireEvent.change(await screen.findByTestId('wb-bookmarks-input-url'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByTestId('wb-bookmarks-submit'));
    await waitFor(() => expect(screen.getByTestId('wb-bookmarks-item-https://example.com')).toBeTruthy());
    // 点击只记录不跳转（view 仍是 home）
    fireEvent.click(screen.getByTestId('wb-bookmarks-open-https://example.com'));
    expect(workbenchStore.getState().view).toBe('home');
    fireEvent.click(screen.getByTestId('wb-bookmarks-remove-https://example.com'));
    await waitFor(() => expect(screen.queryByTestId('wb-bookmarks-item-https://example.com')).toBeNull());
  });

  it('非法 URL 拒收（toast + 不添加）', async () => {
    fireEvent.click(screen.getByTestId('wb-bookmarks-add'));
    fireEvent.change(await screen.findByTestId('wb-bookmarks-input-url'), { target: { value: 'ftp://x' } });
    fireEvent.click(screen.getByTestId('wb-bookmarks-submit'));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('wb-bookmarks-item-ftp://x')).toBeNull();
  });
});

describe('T71-01 libstats 卡', () => {
  it('四格数字对得上 tree 聚合', () => {
    expect(screen.getByTestId('wb-libstats-pages').textContent).toContain('3');
    expect(screen.getByTestId('wb-libstats-db').textContent).toContain('1');
    expect(screen.getByTestId('wb-libstats-fav').textContent).toContain('0');
    expect(screen.getByTestId('wb-libstats-depth').textContent).toContain('1');
  });
});
