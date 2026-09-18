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
import type { SeptcatsApi } from '../src/types/window';
import { pagesActions, pagesStore, type PagesState } from '../src/renderer/src/state/pages';

const WS_ID = 'ws-store-test-1';

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
  };
  pagesStore.setState(() => base);
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
