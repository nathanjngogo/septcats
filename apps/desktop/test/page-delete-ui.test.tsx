// @vitest-environment jsdom
/**
 * page-delete-ui.test.tsx —— TASK-T24-01 UI 用例（删除入口 + 转换选中 + Toast 挂载）。
 *
 * 覆盖：
 * - 「删除页面」条件命令：有选中页出现且 run 开确认弹层、无选中页不出现（静态 14 条不受影响）、
 *   label/别名基线；
 * - PageDeleteDialog 确认回调：取消不调 pages:remove；确认 → remove + 回 pages 视图 +
 *   ensureSelection 选中回落；含子页文案提示；
 * - 侧栏行「⋯」菜单：菜单「删除」→ 同一确认弹层（确认前不 remove、确认后才 remove）；
 * - 「转为数据库」后选中同步（§0.B 判别①修法）：转换 → pages:tree 对账 + selectedId 指向
 *   新库页 → 面板「另存为模板」按 selectedId 存的是新库页（kind 判定 UI 链回归）+ 库 UI 出现；
 * - ToastViewport 挂载（§0.C）：pushToast 后 .sc-toast 落地、可关闭。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；断言落在 store 状态与假桥调用。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectionEntitySchema,
  collectionSchemaSchema,
  defaultView,
  propertySchema,
} from '@septcats/dbview';
import type { PageNode } from '@septcats/editor';
import { App } from '../src/renderer/src/App';
import { PageDeleteDialog } from '../src/renderer/src/pages/PageDeleteDialog';
import { PageView } from '../src/renderer/src/pages/PageView';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import {
  configurePaletteCommands,
  DELETE_PAGE_DEF,
} from '../src/renderer/src/palette/commands';
import {
  pagesActions,
  pagesStore,
  pushToast,
  type PagesState,
} from '../src/renderer/src/state/pages';
import { templatesActions } from '../src/renderer/src/state/templates';
import type { SeptcatsApi } from '../src/types/window';

// jsdom 未实现的浏览器 API（packages/editor/test/setup.ts 同款）：Tiptap/PM 布局路径会探
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

const WS_ID = 'ws-t24-test';

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
    ...extra,
  }));
}

const BASE_DEPS = {
  createPage: () => undefined,
  switchToNextWorkspace: () => undefined,
  openTrash: () => undefined,
  openSettings: () => undefined,
  notify: () => undefined,
  setThemeMode: () => undefined,
};

// ---------------------------------------------------------------------------
// A：删除页面入口
// ---------------------------------------------------------------------------

describe('「删除页面」条件命令（T24-01 §0.A.1）', () => {
  it('有选中页 → 命令出现且 run 触发依赖；无选中页 → 不出现（静态 14 条不受影响）', () => {
    const runSpy = vi.fn();
    const withCommand = configurePaletteCommands({ ...BASE_DEPS, deletePage: runSpy }, true);
    const command = withCommand.find((entry) => entry.id === 'page.delete');
    expect(command).toBeDefined();
    command?.run();
    expect(runSpy).toHaveBeenCalledTimes(1);

    const withoutCommand = configurePaletteCommands({ ...BASE_DEPS, deletePage: runSpy }, false);
    expect(withoutCommand.some((entry) => entry.id === 'page.delete')).toBe(false);
    expect(withoutCommand).toHaveLength(14);
  });

  it('DELETE_PAGE_DEF：label 与检索别名（拼音缩写 + 英文）', () => {
    expect(DELETE_PAGE_DEF.label).toBe('删除页面');
    expect(DELETE_PAGE_DEF.aliases).toContain('scym');
    expect(DELETE_PAGE_DEF.aliases).toContain('delete page');
  });
});

type DeleteBridge = {
  remove: ReturnType<typeof vi.fn>;
  tree: ReturnType<typeof vi.fn>;
  touch: ReturnType<typeof vi.fn>;
};

let nodesDb: PageNode[] = [];
let deleteBridge: DeleteBridge;

function installDeleteBridge(): void {
  const impl: DeleteBridge = {
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
    touch: vi.fn(async () => ({ pageIds: [] })),
  };
  deleteBridge = impl;
  vi.stubGlobal('septcats', {
    workspaces: { list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }) },
    pages: { tree: impl.tree, remove: impl.remove },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: impl.touch },
  } as unknown as SeptcatsApi);
}

describe('PageDeleteDialog（T24-01 §0.A：二次确认回调）', () => {
  beforeEach(() => {
    nodesDb = [
      pageNode({ id: 'pg-a', title: '暗物质探测实验笔记' }),
      pageNode({ id: 'pg-b', title: '论文速览', sortKey: 'A00000001' }),
    ];
    installDeleteBridge();
    resetPagesStore({ nodes: nodesDb, selectedId: 'pg-a' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('取消：不触发 pages:remove，弹层关闭', () => {
    pagesActions.requestDeletePage('pg-a');
    render(<PageDeleteDialog />);

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(screen.getByTestId('page-delete-cancel')).toBeDefined();

    fireEvent.click(screen.getByTestId('page-delete-cancel'));

    expect(deleteBridge.remove).not.toHaveBeenCalled();
    expect(pagesStore.getState().deleteConfirmId).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('确认：pages.remove 收到该 id → 回 pages 视图 → ensureSelection 选中回落', async () => {
    pagesActions.requestDeletePage('pg-a');
    render(<PageDeleteDialog />);

    fireEvent.click(screen.getByTestId('page-delete-confirm'));

    await waitFor(() => expect(deleteBridge.remove).toHaveBeenCalledWith({ id: 'pg-a' }));
    await waitFor(() => expect(pagesStore.getState().selectedId).toBe('pg-b'));
    expect(pagesStore.getState().view).toBe('pages');
    expect(pagesStore.getState().deleteConfirmId).toBeNull();
    // 对账后树同步：pg-a 进回收站（alive=0），侧栏树/回收站角标随既有动作刷新
    await waitFor(() => expect(pagesStore.getState().nodes.find((n) => n.id === 'pg-a')?.alive).toBe(0));
  });

  it('含子页：文案提示「及其 N 个子页面」', () => {
    nodesDb = [
      pageNode({ id: 'pg-parent', title: '研究', childIds: ['pg-child'] }),
      pageNode({ id: 'pg-child', title: '子页', parentId: 'pg-parent', depth: 1, sortKey: 'A00000001' }),
    ];
    resetPagesStore({ nodes: nodesDb, selectedId: 'pg-parent' });
    pagesActions.requestDeletePage('pg-parent');
    render(<PageDeleteDialog />);

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('及其 1 个子页面');
  });
});

describe('侧栏行「⋯」菜单（T24-01 §0.A.2）', () => {
  beforeEach(() => {
    nodesDb = [
      pageNode({ id: 'pg-a', title: '暗物质探测实验笔记' }),
      pageNode({ id: 'pg-b', title: '论文速览', sortKey: 'A00000001' }),
    ];
    installDeleteBridge();
    resetPagesStore({ nodes: nodesDb, expanded: new Set<string>(), selectedId: 'pg-a' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('行「⋯」→「删除」→ 同一确认弹层；确认前不 remove、确认后才 remove', async () => {
    // 行菜单开弹层、弹层确认回调分属两个组件，一起挂（App 内同为根级兄弟）
    render(
      <>
        <SidebarTree />
        <PageDeleteDialog />
      </>,
    );

    fireEvent.click(screen.getByTestId('side-more-pg-b'));
    const menuItem = screen.getByRole('menuitem', { name: '删除' });
    fireEvent.click(menuItem);

    expect(pagesStore.getState().deleteConfirmId).toBe('pg-b');
    expect(deleteBridge.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('page-delete-confirm'));
    await waitFor(() => expect(deleteBridge.remove).toHaveBeenCalledWith({ id: 'pg-b' }));
  });
});

// ---------------------------------------------------------------------------
// B：转为数据库后选中同步（判别①修法）
// ---------------------------------------------------------------------------

const DB_PAGE_ID = 'pg-db-new';
const TITLE_PID = 'p_title';

const DB_COLLECTION = collectionEntitySchema.parse({
  id: 'col-db-new',
  page_id: DB_PAGE_ID,
  workspace_id: WS_ID,
  name: '研究笔记',
  schema: collectionSchemaSchema.parse({
    properties: { [TITLE_PID]: propertySchema.parse({ id: TITLE_PID, name: '名称', type: 'text' }) },
    title_pid: TITLE_PID,
  }),
  views: [defaultView('v1', '表格')],
  alive: 1,
  version: 1,
});

type ConvertBridge = {
  dbCreate: ReturnType<typeof vi.fn>;
  dbLoad: ReturnType<typeof vi.fn>;
  blocksList: ReturnType<typeof vi.fn>;
  templatesSave: ReturnType<typeof vi.fn>;
  tree: ReturnType<typeof vi.fn>;
};

let convertBridge: ConvertBridge;

function installConvertBridge(): void {
  const impl: ConvertBridge = {
    dbCreate: vi.fn(async () => {
      nodesDb.push(pageNode({ id: DB_PAGE_ID, title: '研究笔记', sortKey: 'A00000001' }));
      return { pageId: DB_PAGE_ID, collectionId: 'col-db-new' };
    }),
    dbLoad: vi.fn(async () => ({ collection: DB_COLLECTION, records: [] })),
    blocksList: vi.fn(async () => []),
    templatesSave: vi.fn(async () => ({ id: 'tpl-new' })),
    tree: vi.fn(async () => nodesDb.map((node) => ({ ...node, childIds: [...node.childIds] }))),
  };
  convertBridge = impl;
  vi.stubGlobal('septcats', {
    workspaces: { list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }) },
    pages: { tree: impl.tree },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: vi.fn(async () => ({ pageIds: [] })) },
    db: { create: impl.dbCreate, load: impl.dbLoad },
    blocks: { list: impl.blocksList, commit: vi.fn() },
    // T26-01 §0.B：App 顶栏换 SyncStatusButton（真态真钮）——假桥补 sync 通道
    // （status 回 null = 加载态，不点开面板即无进一步交互）
    sync: {
      status: vi.fn(async () => null),
      onState: vi.fn(() => () => {}),
      now: vi.fn(async () => null),
      setEnabled: vi.fn(),
    },
    collab: {
      attach: vi.fn(async () => ({ entries: [], ledgerHasCrdt: false })),
      detach: vi.fn(async () => ({})),
      apply: vi.fn(async () => ({})),
      onUpdate: vi.fn(() => () => {}),
    },
    templates: {
      list: vi.fn(async () => ({ templates: [] })),
      saveFromPage: impl.templatesSave,
    },
  } as unknown as SeptcatsApi);
}

describe('「转为数据库」后选中同步（T24-01 §0.B 判别①修法）', () => {
  beforeEach(() => {
    nodesDb = [pageNode({ id: 'pg-orig', title: '研究笔记' })];
    installConvertBridge();
    resetPagesStore({ nodes: nodesDb, selectedId: 'pg-orig' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('转换 → 树对账 + selectedId 指向新库页 + 库 UI 出现', async () => {
    render(<PageView />);

    fireEvent.click(screen.getByText('转为数据库'));

    await waitFor(() => expect(convertBridge.dbCreate).toHaveBeenCalledTimes(1));
    // 判别①回归：转换后 pagesStore.selectedId 必须指向新建库页（修前停留在原页）
    await waitFor(() => expect(pagesStore.getState().selectedId).toBe(DB_PAGE_ID));
    // 对账触发（侧栏树同步出现新库页）
    expect(convertBridge.tree).toHaveBeenCalled();
    // 库 UI（DbPage 经本地状态承载渲染，空库 = 新建记录空态）
    await waitFor(() => expect(screen.getByText('新建记录')).toBeDefined());
  });

  it('kind 判定 UI 链回归：转换后「另存为模板」按 selectedId 存的是新库页', async () => {
    render(<PageView />);

    fireEvent.click(screen.getByText('转为数据库'));
    await waitFor(() => expect(pagesStore.getState().selectedId).toBe(DB_PAGE_ID));

    // 面板「另存为模板」按 selectedId 取页（TemplateSaveDialog → templatesActions.saveFromPage）
    const ok = await templatesActions.saveFromPage(pagesStore.getState().selectedId ?? '', '研究模板');
    expect(ok).toBe(true);
    expect(convertBridge.templatesSave).toHaveBeenCalledWith({ pageId: DB_PAGE_ID, title: '研究模板' });
  });
});

// ---------------------------------------------------------------------------
// C：ToastViewport 挂载
// ---------------------------------------------------------------------------

describe('ToastViewport 挂载（T24-01 §0.C）', () => {
  beforeEach(() => {
    nodesDb = [pageNode({ id: 'pg-root', title: '研究' })];
    installConvertBridge();
    resetPagesStore({ nodes: nodesDb, selectedId: 'pg-root' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('App 根层挂载：pushToast 后 .sc-toast 落地，可关闭', async () => {
    render(<App />);
    // App.load() 完成（树对账触达）后再断言，避免挂载竞态
    await waitFor(() => expect(convertBridge.tree).toHaveBeenCalled());

    pushToast('已另存为模板', 'success');
    // 外部 store 更新在 act 外触发 → 等提交完成再断言
    await waitFor(() => expect(document.querySelector('.sc-toast')?.textContent).toContain('已另存为模板'));

    // 关闭（IconButton 的可访问名）
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：已另存为模板' }));
    expect(document.querySelector('.sc-toast')?.textContent).not.toContain('已另存为模板');
  });
});
