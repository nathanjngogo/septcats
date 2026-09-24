/**
 * pages-store.test.ts —— renderer pages store 的单测（TASK-T20-02 §1.B）。
 *
 * 口径：renderer 无 React 测试环境（vitest 纯 Node 为主），这里按任务书裁决在
 * apps/desktop/test 直测 state/pages.ts 的 store 动作——用假 window.septcats 桥
 * 钉「load() 后 workspaceId 非 null」（命令面板/搜索页检索的门槛：
 * palette.runSearch 在 workspaceId=null 时静默早退、不发请求），以及
 * 「重复 load()（StrictMode 双挂载）不产生状态抖动」。
 *
 * jsdom 仅为 @septcats/editor 导入图兜底（collab.test.ts 同款）。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PageNode } from '@septcats/editor';
import type { SeptcatsApi } from '../src/types/window';
import { pageTypeOf, pagesActions, pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import { writeTabs } from '../src/renderer/src/state/tabs';

const WS_ID = 'ws-store-test-1';

/** PageNode 夹具：补齐派生字段的默认值。 */
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

function installBridge(): void {
  const api = {
    workspaces: {
      list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }),
      create: async () => ({ id: WS_ID }),
      rename: async () => ({ id: WS_ID }),
      switch: async () => ({ activeId: WS_ID }),
      onChanged: () => () => undefined,
    },
    pages: {
      tree: async () => [],
      create: async () => ({ id: 'pg-1', sortKey: 'A00000001' }),
      rename: async () => ({ id: 'pg-1' }),
      move: async () => ({ sortKey: 'A00000001', rebalanced: false, opCount: 1 }),
      remove: async () => ({ deleted: 1 }),
      restore: async () => ({ restored: 1 }),
      purge: async () => ({ purged: 1 }),
    },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }) },
  } as unknown as SeptcatsApi;
  (globalThis as { septcats?: SeptcatsApi }).septcats = api;
}

function resetStore(): void {
  const base: PagesState = {
    status: 'loading',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: null,
    workspaces: [],
    nodes: [],
    expanded: new Set<string>(),
    selectedId: null,
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    deleteConfirmId: null,
    lockedIds: new Set<string>(),
    lockDialog: null,
    exportDialog: null,
    lockRev: 0,
    tabs: [],
  };
  pagesStore.setState(() => base);
}

/** T64-01 PM 收口：提为顶层 helper——CB 会话中断前只在局部 describe 定义，新 describe 够不到。 */
function installBridgeWithNodes(nodes: PageNode[]): void {
  (globalThis as { septcats?: SeptcatsApi }).septcats = {
    workspaces: {
      list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }),
    },
    pages: { tree: async () => nodes },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }) },
  } as unknown as SeptcatsApi;
}

describe('pages store / load 初始化（TASK-T20-02 §0.B）', () => {
  beforeEach(() => {
    resetStore();
    installBridge();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'septcats');
  });

  it('load() 后 workspaceId 非 null 且 status ready（命令面板检索门槛就位）', async () => {
    expect(pagesStore.getState().workspaceId).toBeNull();

    await pagesActions.load();

    const state = pagesStore.getState();
    expect(state.workspaceId).toBe(WS_ID);
    expect(state.status).toBe('ready');
    expect(state.error).toBeNull();
    expect(state.workspaces.map((item) => item.id)).toEqual([WS_ID]);
  });

  it('重复 load()（StrictMode 双挂载）幂等：workspaceId 稳定、无 error、不产生抖动', async () => {
    await Promise.all([pagesActions.load(), pagesActions.load()]);
    await pagesActions.load();

    const state = pagesStore.getState();
    expect(state.workspaceId).toBe(WS_ID);
    expect(state.status).toBe('ready');
    expect(state.error).toBeNull();
    expect(state.workspaces).toHaveLength(1);
    expect(state.toasts).toHaveLength(0);
  });

  it('桥异常时 load() 落 error 态而非抛出（workspaceId 保持 null，检索仍静默早退）', async () => {
    (globalThis as { septcats?: SeptcatsApi }).septcats = {
      workspaces: {
        list: async () => {
          throw new Error('E_DB_UNAVAILABLE: 桥不可用');
        },
      },
    } as unknown as SeptcatsApi;

    await pagesActions.load();

    const state = pagesStore.getState();
    expect(state.status).toBe('error');
    expect(state.workspaceId).toBeNull();
    expect(state.error).toContain('E_DB_UNAVAILABLE');
  });
});

describe('pages store / load 后初始化选中（TASK-T21-02 §0.2）', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'septcats');
  });


  it('load() 后 selectedId===null → 自动选中首个可达根页', async () => {
    installBridgeWithNodes([
      pageNode({ id: 'pg-root', title: '研究', childIds: ['pg-child'] }),
      pageNode({ id: 'pg-child', title: '暗物质探测实验笔记', parentId: 'pg-root', depth: 1 }),
    ]);

    await pagesActions.load();

    expect(pagesStore.getState().status).toBe('ready');
    expect(pagesStore.getState().selectedId).toBe('pg-root');
  });

  it('已有选中页时 load() 不改写选中（T37-01 起以持久化页签为准：选中=当前页签随快照还原）', async () => {
    // T37-01 §0.4：选中项随页签快照持久化——load() 的选中真源从「内存不清场」改为
    // 「localStorage 快照还原」（不同 workspace 各自还原、不串）；无记录才回落首屏自动选中。
    writeTabs(WS_ID, ['pg-keep'], 'pg-keep');
    installBridgeWithNodes([
      pageNode({ id: 'pg-keep', title: '保留页', sortKey: 'A00000000' }),
      pageNode({ id: 'pg-root', title: '研究', sortKey: 'A00000001' }),
    ]);

    await pagesActions.load();

    expect(pagesStore.getState().selectedId).toBe('pg-keep');
    expect(pagesStore.getState().tabs).toEqual(['pg-keep']);
  });

  it('空树 load() 后 selectedId 保持 null（无页可选，不误选）', async () => {
    installBridgeWithNodes([]);

    await pagesActions.load();

    expect(pagesStore.getState().status).toBe('ready');
    expect(pagesStore.getState().selectedId).toBeNull();
  });
});

describe('T64-01 文件夹（page_type=folder）', () => {
  beforeEach(() => {
    resetStore();
    installBridge();
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'septcats');
  });

  it('pageTypeOf 兜底：folder 原样认、缺省/野值回落 page、wiki/database 不变', () => {
    const folder = { ...pageNode({ id: 'fld', title: '资料', childIds: ['c1'] }), pageType: 'folder' as const };
    const page = pageNode({ id: 'pg', title: '普通页' });
    const wiki = { ...pageNode({ id: 'wk', title: 'Wiki' }), pageType: 'wiki' as const };
    const db = { ...pageNode({ id: 'db', title: '库' }), pageType: 'database' as const };
    expect(pageTypeOf(folder)).toBe('folder');
    expect(pageTypeOf(page)).toBe('page');
    expect(pageTypeOf(wiki)).toBe('wiki');
    expect(pageTypeOf(db)).toBe('database');
  });

  it('selectPage 对 folder：只展开定位、不 openInTab（tabs/selectedId 不变）', () => {
    const folder = { ...pageNode({ id: 'fld', title: '资料', childIds: ['c1'] }), pageType: 'folder' as const };
    const child = pageNode({ id: 'c1', title: '子页', parentId: 'fld' });
    installBridgeWithNodes([folder, child]);
    pagesStore.setState((state) => ({
      ...state,
      workspaceId: WS_ID,
      status: 'ready',
      nodes: [folder, child],
      expanded: new Set<string>(),
      selectedId: null,
      tabs: [],
    }));
    const before = pagesStore.getState();
    pagesActions.selectPage('fld');
    const after = pagesStore.getState();
    expect(after.expanded.has('fld')).toBe(true);
    expect(after.selectedId).toBe(before.selectedId);
    expect(after.tabs).toEqual(before.tabs);
    expect(after.view).toBe('pages');
  });

  it('selectPage 对普通页：照常 openInTab（建页签、置选中）', () => {
    const pg = pageNode({ id: 'pg', title: '普通页' });
    installBridgeWithNodes([pg]);
    const api = (globalThis as unknown as { septcats: SeptcatsApi }).septcats;
    api.recent = {
      list: async () => ({ pageIds: [] }),
      touch: async () => ({ pageIds: [] }),
    };
    pagesStore.setState((state) => ({
      ...state,
      workspaceId: WS_ID,
      status: 'ready',
      expanded: new Set<string>(),
      selectedId: null,
      tabs: [],
    }));
    pagesActions.selectPage('pg');
    const after = pagesStore.getState();
    expect(after.selectedId).toBe('pg');
    expect(after.tabs).toEqual(['pg']);
  });
});
