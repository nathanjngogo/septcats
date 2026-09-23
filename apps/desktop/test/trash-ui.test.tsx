// @vitest-environment jsdom
/**
 * trash-ui.test.tsx —— T22-01 UI 用例（面包屑真路径 + 回收站列表 + 空态）。
 *
 * 覆盖：
 * - pagesBreadcrumbItems 纯函数：多层父链顺序（根→当前页）、空标题回退「未命名」、
 *   trash scope → 「回收站」、无 selectedId → 工作区名（缺省「当前工作区」）；
 * - TrashList 组件：待删树行渲染（父/子按 store 裁好的关系）、空态、
 *   「恢复」→ bridge.pages.restore 回调、「彻底删除」→ 复用 Dialog 二次确认
 *   （取消不 purge、确认才 purge）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；断言落在 store 状态与假桥调用。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { TrashList, trashRows } from '../src/renderer/src/pages/TrashList';
import { pagesStore, pagesBreadcrumbItems, type PagesState } from '../src/renderer/src/state/pages';
import type { SeptcatsApi } from '../src/types/window';

const WS_ID = 'ws-trash-test';

/** PageNode 夹具：补齐派生字段的默认值（sidebar-tree.test.tsx 同款）。 */
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

function baseState(extra?: Partial<PagesState>): PagesState {
  return {
    ...pagesStore.getState(),
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
    ...extra,
  };
}

describe('面包屑真路径（T22-01 §0.A 纯函数）', () => {
  it('多层父链顺序：根 → 中间层 → 当前页，逐段 label=节点 title', () => {
    const nodes = [
      pageNode({ id: 'pg-root', title: '研究', childIds: ['pg-mid'] }),
      pageNode({ id: 'pg-mid', title: '专题', parentId: 'pg-root', depth: 1, childIds: ['pg-leaf'], sortKey: 'A00000001' }),
      pageNode({ id: 'pg-leaf', title: '实验记录', parentId: 'pg-mid', depth: 2, sortKey: 'A00000002' }),
    ];
    const items = pagesBreadcrumbItems(baseState({ nodes, selectedId: 'pg-leaf' }));
    expect(items.map((item) => item.label)).toEqual(['研究', '专题', '实验记录']);
  });

  it('空标题回退「未命名」：祖先段与自身段都生效', () => {
    const nodes = [
      pageNode({ id: 'pg-root', title: '', childIds: ['pg-leaf'] }),
      pageNode({ id: 'pg-leaf', title: '', parentId: 'pg-root', depth: 1, sortKey: 'A00000001' }),
    ];
    const items = pagesBreadcrumbItems(baseState({ nodes, selectedId: 'pg-leaf' }));
    expect(items.map((item) => item.label)).toEqual(['未命名', '未命名']);
  });

  it('trash scope：view=trash 时只显示「回收站」（与 selectedId 无关）', () => {
    const nodes = [
      pageNode({ id: 'pg-root', title: '研究', childIds: ['pg-a'] }),
      pageNode({ id: 'pg-a', title: '暗物质探测实验笔记', parentId: 'pg-root', depth: 1, sortKey: 'A00000001' }),
    ];
    const items = pagesBreadcrumbItems(baseState({ nodes, selectedId: 'pg-a', view: 'trash' }));
    expect(items).toEqual([{ label: '回收站' }]);
  });

  it('无 selectedId：显示工作区名；查不到活动工作区回落「当前库」', () => {
    const nodes = [pageNode({ id: 'pg-root', title: '研究' })];
    expect(pagesBreadcrumbItems(baseState({ nodes, selectedId: null })).map((i) => i.label)).toEqual([
      '个人工作区',
    ]);
    expect(
      pagesBreadcrumbItems(baseState({ nodes, selectedId: null, workspaceId: 'ws-other' })).map((i) => i.label),
    ).toEqual(['当前库']);
  });
});

describe('trashRows（T22-01 §0.B 纯函数）', () => {
  it('待删树行：根在前子在后、深度递增；已 purge（deletedAt=0）与存活页不露出', () => {
    const nodes = [
      pageNode({ id: 'pg-alive', title: '存活页' }),
      pageNode({ id: 'pg-dead', title: '已删父', alive: 0, deletedAt: 123, childIds: ['pg-dead-child', 'pg-gone'] }),
      pageNode({ id: 'pg-dead-child', title: '已删子', parentId: 'pg-dead', depth: 1, alive: 0, deletedAt: 123, sortKey: 'A00000001' }),
      pageNode({ id: 'pg-gone', title: '已彻底删', parentId: 'pg-dead', depth: 1, alive: 0, deletedAt: 0, sortKey: 'A00000002' }),
    ];
    const rows = trashRows(nodes);
    expect(rows.map((row) => row.node.id)).toEqual(['pg-dead', 'pg-dead-child']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1]);
  });
});

type Bridge = {
  tree: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  purge: ReturnType<typeof vi.fn>;
};

let nodesDb: PageNode[] = [];
let bridge: Bridge;

function installBridge(): void {
  const impl: Bridge = {
    tree: vi.fn(async () => nodesDb.map((node) => ({ ...node, childIds: [...node.childIds] }))),
    restore: vi.fn(async ({ id }: { id: string }) => {
      for (const node of nodesDb) {
        if (node.id === id || node.parentId === id) {
          node.alive = 1;
          node.deletedAt = null;
        }
      }
      return { restored: 1 };
    }),
    purge: vi.fn(async ({ id }: { id: string }) => {
      nodesDb = nodesDb.filter((node) => node.id !== id && node.parentId !== id);
      return { purged: 1 };
    }),
  };
  bridge = impl;
  vi.stubGlobal('septcats', {
    workspaces: { list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }) },
    pages: { tree: impl.tree, restore: impl.restore, purge: impl.purge },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: vi.fn(async () => ({ pageIds: [] })) },
  } as unknown as SeptcatsApi);
}

function seedStore(extra?: Partial<PagesState>): void {
  pagesStore.setState(() => baseState({ nodes: nodesDb, ...extra }));
}

beforeEach(() => {
  nodesDb = [];
  installBridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TrashList（T22-01 §0.B 组件）', () => {
  it('空态：无待删页时显示统一空态文案', () => {
    seedStore();
    render(<TrashList />);
    expect(screen.getByText('回收站是空的，删除的页面会先存放在这里')).toBeDefined();
    expect(document.querySelector('.trash-empty')).not.toBeNull();
  });

  it('待删树行渲染：父/子行按 store 裁好的关系列出，标题空回退「未命名」', () => {
    nodesDb = [
      pageNode({ id: 'pg-dead', title: '旧笔记', alive: 0, deletedAt: 123, childIds: ['pg-dead-child'] }),
      pageNode({ id: 'pg-dead-child', title: '', parentId: 'pg-dead', depth: 1, alive: 0, deletedAt: 123, sortKey: 'A00000001' }),
    ];
    seedStore({ view: 'trash' });
    render(<TrashList />);

    expect(screen.getByTestId('trash-row-pg-dead').textContent).toContain('旧笔记');
    expect(screen.getByTestId('trash-row-pg-dead-child').textContent).toContain('未命名');
    // 空态不出现
    expect(screen.queryByText('回收站是空的，删除的页面会先存放在这里')).toBeNull();
  });

  it('「恢复」→ restorePage：bridge.pages.restore 收到该 id，乐观置活后对账', async () => {
    nodesDb = [pageNode({ id: 'pg-dead', title: '旧笔记', alive: 0, deletedAt: 123 })];
    seedStore({ view: 'trash' });
    render(<TrashList />);

    fireEvent.click(screen.getByTestId('trash-restore-pg-dead'));

    await waitFor(() => expect(bridge.restore).toHaveBeenCalledWith({ id: 'pg-dead' }));
    await waitFor(() => expect(pagesStore.getState().nodes[0]?.alive).toBe(1));
  });

  it('「彻底删除」→ Dialog 二次确认：取消不 purge，确认才 purgePage', async () => {
    nodesDb = [pageNode({ id: 'pg-dead', title: '旧笔记', alive: 0, deletedAt: 123 })];
    seedStore({ view: 'trash' });
    render(<TrashList />);

    // 第一步：只开确认弹层，不触发 purge
    fireEvent.click(screen.getByTestId('trash-purge-pg-dead'));
    expect(bridge.purge).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    // 取消：弹层关闭，仍不 purge
    fireEvent.click(screen.getByTestId('trash-purge-cancel'));
    expect(bridge.purge).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // 再开并确认：purge 收到该 id
    fireEvent.click(screen.getByTestId('trash-purge-pg-dead'));
    fireEvent.click(screen.getByTestId('trash-purge-confirm'));
    await waitFor(() => expect(bridge.purge).toHaveBeenCalledWith({ id: 'pg-dead' }));
  });

  it('「返回页面」→ showPages：view 回 pages', () => {
    seedStore({ view: 'trash' });
    render(<TrashList />);

    fireEvent.click(screen.getByTestId('trash-back'));
    expect(pagesStore.getState().view).toBe('pages');
  });
});
