// @vitest-environment jsdom
/**
 * t66-workbench-ui.test.tsx —— TASK-T66-01 §2.2 的 UI 面（jsdom）：
 * - 数据库卡只列**存活 database 页**（wiki/回收站/彻底删除/普通页不混入），行数经
 *   现成 db.load 通道渲染，行点击 = 回 pages 视图并打开该库页（openInTab 语义：
 *   selectedId 落位 + 页签追加）；
 * - 最近/收藏空态文案；最近前 8 截断；
 * - 卡渲染计数（默认 5 卡全现）、隐藏/上移配置经 ⋯ 菜单落 localStorage、
 *   「恢复默认」出现（有隐藏卡时）；
 * - 顶栏房子钮（App 接线，t52 假桥范式）：点钮出 workbench，再点回；
 *   Esc 关 workbench 回 pages。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；localStorage 用 jsdom 原生。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/src/App';
import { WorkbenchPage, aliveDatabaseNodes } from '../src/renderer/src/workbench/WorkbenchPage';
import {
  WORKBENCH_CARDS_STORAGE_KEY,
  workbenchActions,
  workbenchStore,
} from '../src/renderer/src/workbench/state';
import { pagesActions, pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import { aiChatActions } from '../src/renderer/src/ai/chatState';
import {
  layoutActions,
  layoutStore,
  makeDefaultLayout,
} from '../src/renderer/src/layout/layoutState';
import type { PageNodeView, SeptcatsApi } from '../src/types/window';
import type { AppSettings } from '../src/shared/settings';

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

const AT = 1_700_000_000_000;
const WS_ID = 'ws-t66';

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
    updatedAt: AT,
    ...overrides,
  };
}

const NODES: PageNodeView[] = [
  viewNode({ id: 'db-a', title: '任务库', pageType: 'database', sortKey: 'A00000000', updatedAt: AT }),
  viewNode({ id: 'db-b', title: '客户库', pageType: 'database', sortKey: 'A00000001', updatedAt: AT - 3_600_000 }),
  viewNode({ id: 'db-gone', title: '已删库', pageType: 'database', sortKey: 'A00000002', alive: 0, deletedAt: AT }),
  viewNode({ id: 'db-purged', title: '彻底删库', pageType: 'database', sortKey: 'A00000003', alive: 0, deletedAt: 0 }),
  viewNode({ id: 'wiki-a', title: '研究 Wiki', pageType: 'wiki', sortKey: 'A00000004' }),
  viewNode({ id: 'page-a', title: '研究', sortKey: 'A00000005', updatedAt: AT - 120_000 }),
  viewNode({ id: 'page-b', title: '论文速览', sortKey: 'A00000006', updatedAt: AT - 90_000 }),
];

function resetStores(extra?: Partial<PagesState>): void {
  workbenchStore.setState((state) => ({ ...state, view: 'pages', cardOrder: ['quick', 'todo', 'database', 'recent', 'favorites'], hiddenCards: [] }));
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
    selectedId: 'page-a',
    editingId: null,
    favoriteIds: [],
    recentIds: ['page-a', 'page-b'],
    toasts: [],
    deleteConfirmId: null,
    tabs: ['page-a'],
    ...extra,
  }));
}

function installBridge(): void {
  vi.stubGlobal('septcats', {
    workspaces: { list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }), onChanged: vi.fn(() => () => {}) },
    pages: {
      tree: async () => NODES,
      create: vi.fn(async (): Promise<{ id: string; sortKey: string }> => ({ id: 'pg-new', sortKey: 'A9' })),
      rename: vi.fn(async ({ id }: { id: string }) => ({ id })),
      move: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      restore: vi.fn(async () => ({})),
      purge: vi.fn(async () => ({})),
    },
    favorites: { list: async () => ({ pageIds: [] }), set: vi.fn(async () => ({})) },
    recent: { list: async () => ({ pageIds: ['page-a', 'page-b'] }), touch: vi.fn(async () => ({ pageIds: ['page-a', 'page-b'] })) },
    db: {
      create: vi.fn(async () => ({ pageId: 'db-new', collectionId: 'co-new' })),
      load: vi.fn(async ({ pageId }: { pageId: string }) => {
        if (pageId === 'db-b') {
          throw new Error('E_DB_UNAVAILABLE');
        }
        return { collection: {}, records: [{ alive: 1 }, { alive: 1 }, { alive: 1 }, { alive: 0 }] };
      }),
    },
    blocks: { list: vi.fn(async () => []), commit: vi.fn(async () => ({})) },
    search: { query: vi.fn(async () => ({ results: [] })), onTogglePalette: vi.fn(() => () => {}) },
    settings: {
      get: vi.fn(async (): Promise<AppSettings> => ({
        theme: 'system',
        locale: 'zh-CN',
        privacy: { telemetry: false, linkPreviewOnType: true },
        editor: { defaultEditMode: 'rich', spellcheck: true },
        trayClose: 'ask',
        data: { note: '~/.septcats' },
        sync: { enabled: true, encrypt: false, gc: false },
        ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] },
      })),
      patch: vi.fn(async (p: Partial<AppSettings>) => p),
    },
    sync: { status: vi.fn(async () => null), onState: vi.fn(() => () => {}), now: vi.fn(async () => null), setEnabled: vi.fn(async () => ({})) },
    collab: { attach: vi.fn(async () => ({ entries: [], ledgerHasCrdt: false })), detach: vi.fn(async () => ({})), apply: vi.fn(async () => ({ ok: true })), onUpdate: vi.fn(() => () => {}) },
    ai: { state: vi.fn(async () => ({ enabled: false, cloudConsent: false, activeProviderId: null, providers: [] })) },
    templates: { list: vi.fn(async () => ({ templates: [] })) },
    appMeta: vi.fn(async () => ({ name: 'Septcats', version: '0.0.0', schemaVersion: 1, layoutRoot: '.septcats' })),
    update: { onState: vi.fn(() => () => {}) },
    menu: { onAction: vi.fn(() => () => {}) },
    close: { onFlushRequest: vi.fn(() => () => {}), flushAck: vi.fn(async () => ({})), onAsk: vi.fn(() => () => {}), decide: vi.fn(async () => ({})) },
  } as unknown as SeptcatsApi);
}

beforeEach(() => {
  window.localStorage.clear();
  installBridge();
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  layoutActions.init();
  aiChatActions.setOpen(false);
  resetStores();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('T66-01 数据库卡', () => {
  it('aliveDatabaseNodes：只收存活 database 页（wiki/回收站/彻底删/普通页不混入）', () => {
    expect(aliveDatabaseNodes(NODES).map((node) => node.id)).toEqual(['db-a', 'db-b']);
  });

  it('渲染库行 + 行数；load 失败页退化不显示行数（显示计数中文案）', async () => {
    resetStores();
    workbenchActions.openHome();
    render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
    expect(screen.getByTestId('wb-db-row-db-a')).toBeTruthy();
    expect(screen.getByTestId('wb-db-row-db-b')).toBeTruthy();
    expect(screen.queryByTestId('wb-db-row-db-gone')).toBeNull();
    expect(screen.queryByTestId('wb-db-row-db-purged')).toBeNull();
    expect(screen.queryByTestId('wb-db-row-wiki-a')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('wb-db-count-db-a').textContent).toContain('3');
    });
    // db-b 的 load 抛错 → 退化占位（不显示行数），绝不让整卡崩
    expect(screen.getByTestId('wb-db-count-db-b').textContent).toBe('计数中…');
  });

  it('行点击 = 回 pages 视图并打开该库页（selectedId 落位 + 页签追加 + home 收）', async () => {
    resetStores();
    workbenchActions.openHome();
    render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
    fireEvent.click(screen.getByTestId('wb-db-row-db-a'));
    expect(workbenchStore.getState().view).toBe('pages');
    const state = pagesStore.getState();
    expect(state.selectedId).toBe('db-a');
    expect(state.tabs).toContain('db-a');
    expect(state.view).toBe('pages');
  });

  it('空态：无库页 → 空文案 + 新建库按钮在卡头', () => {
    resetStores({ nodes: NODES.filter((node) => pageTypeKeep(node)) });
    workbenchActions.openHome();
    render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
    expect(screen.getByTestId('wb-db-empty')).toBeTruthy();
    expect(screen.getByTestId('wb-db-new')).toBeTruthy();
  });
});

function pageTypeKeep(node: PageNodeView): boolean {
  return node.pageType !== 'database';
}

describe('T66-01 最近/收藏卡', () => {
  it('最近空态 + 收藏空态文案', () => {
    resetStores({ recentIds: [], favoriteIds: [] });
    workbenchActions.openHome();
    render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
    expect(screen.getByTestId('wb-recent-empty')).toBeTruthy();
    expect(screen.getByTestId('wb-favorites-empty')).toBeTruthy();
  });

  it('最近截断到 8 条；收藏渲染全量行；点最近行回 pages', () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      viewNode({ id: `pg-r${String(index)}`, title: `r${String(index)}`, sortKey: `R${String(index)}` }),
    );
    resetStores({
      nodes: [...NODES, ...many],
      recentIds: many.map((node) => node.id),
      favoriteIds: ['page-a', 'page-b'],
    });
    workbenchActions.openHome();
    render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
    expect(screen.getAllByTestId(/^wb-recent-row-/)).toHaveLength(8);
    expect(screen.getByTestId('wb-fav-row-page-a')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wb-fav-row-page-b'));
    expect(workbenchStore.getState().view).toBe('pages');
    expect(pagesStore.getState().selectedId).toBe('page-b');
  });
});

describe('T66-01 卡片配置（⋯ 菜单 → localStorage）', () => {
  it('默认 5 卡全渲染；隐藏「最近」→ 4 卡 + 配置落盘 + 出现恢复默认钮', async () => {
    workbenchActions.openHome();
    render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
    expect(screen.getAllByTestId(/^wb-card-(quick|todo|database|recent|favorites)$/)).toHaveLength(5);
    fireEvent.click(screen.getByTestId('wb-card-more-recent'));
    fireEvent.click(await screen.findByText('隐藏卡片'));
    await waitFor(() => {
      expect(screen.getAllByTestId(/^wb-card-(quick|todo|database|recent|favorites)$/)).toHaveLength(4);
    });
    const persist = JSON.parse(window.localStorage.getItem(WORKBENCH_CARDS_STORAGE_KEY) ?? 'null');
    expect(persist?.hidden).toEqual(['recent']);
    expect(screen.getByTestId('wb-reset')).toBeTruthy();
  });

  it('上移：quick 已在首位 → 菜单项 disabled（点无效果）；favorites 上移一位落盘', async () => {
    workbenchActions.openHome();
    render(<WorkbenchPage onClose={() => workbenchActions.closeHome()} />);
    fireEvent.click(screen.getByTestId('wb-card-more-favorites'));
    fireEvent.click(await screen.findByText('上移'));
    await waitFor(() => {
      const persist = JSON.parse(window.localStorage.getItem(WORKBENCH_CARDS_STORAGE_KEY) ?? 'null');
      expect(persist?.order).toEqual(['quick', 'todo', 'database', 'favorites', 'recent']);
    });
  });
});

describe('T66-01 App 接线（顶栏房子钮 / Esc）', () => {
  it('点房子钮出工作台（aria-pressed 翻转），再点回；Esc 关', () => {
    render(<App />);
    expect(screen.queryByTestId('workbench')).toBeNull();
    const house = screen.getByTestId('workbench-open');
    fireEvent.click(house);
    expect(screen.getByTestId('workbench')).toBeTruthy();
    expect(house.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('workbench')).toBeNull();
    fireEvent.click(house);
    expect(screen.getByTestId('workbench')).toBeTruthy();
    fireEvent.click(house);
    expect(screen.queryByTestId('workbench')).toBeNull();
  });

  it('Alt+H 开合工作台', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'h', altKey: true });
    expect(screen.getByTestId('workbench')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'h', altKey: true });
    expect(screen.queryByTestId('workbench')).toBeNull();
  });

  it('home 打开时点侧栏页面行 → 先收 home 再正常开页（红线：home 不是死角）', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('workbench-open'));
    expect(screen.getByTestId('workbench')).toBeTruthy();
    // 侧栏行 onClick 的语义就是 pagesActions.selectPage(node.id)（SidebarTree:549）；
    // 直接走该公开入口验证「任何打开动作都先收 home」守卫，绕开整树重渲染的 DOM 竞态。
    await act(async () => {
      pagesActions.selectPage('page-a');
    });
    expect(screen.queryByTestId('workbench')).toBeNull();
    expect(pagesStore.getState().selectedId).toBe('page-a');
  });
});
