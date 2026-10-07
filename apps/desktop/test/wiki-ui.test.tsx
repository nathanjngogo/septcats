// @vitest-environment jsdom
/**
 * wiki-ui.test.tsx —— 页面承载类型 UI 用例（TASK-T42-01 + T40-01-2 闭环）。
 *
 * 覆盖：
 * - SidebarTree：「Wiki」独立分区（count、wiki 页在列、嵌套子页随行）；普通分区
 *   整枝剪除 wiki 子树；行 ⋯ 菜单「转为 Wiki / 转为普通页」调 convert 通道；
 * - PageView 承载判定（统一处理）：pageType=database → DbPage（**重开还原的关键
 *   路径**，T40-01-2：不再依赖当次会话 dbPageId）；pageType=wiki → WikiLanding；
 * - WikiLanding：子页索引条目数 = 实际子页数、末次更新时间、点击进入；「新建子页」
 *   以 parentId=wikiId 调 pages.create；简介失焦保存调 setSummary；「转为普通页」。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；断言落在假桥调用与 DOM（trash-ui 同款）。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import { WikiLanding } from '../src/renderer/src/pages/WikiLanding';
import { PageView } from '../src/renderer/src/pages/PageView';
import { pagesStore } from '../src/renderer/src/state/pages';
import type { PageNodeView, SeptcatsApi } from '../src/types/window';

vi.mock('../src/renderer/src/db/DbPage', () => ({
  DbPage: ({ pageId }: { pageId: string }) => <div data-testid="db-page-stub">db:{pageId}</div>,
}));

const AT = 1_700_000_000_000;
const WS_ID = 'ws-wiki-ui';

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

function makeNodes(): PageNodeView[] {
  return [
    viewNode({ id: 'pg-normal', title: '普通页', childIds: [] }),
    viewNode({
      id: 'pg-wiki',
      title: '研究 Wiki',
      pageType: 'wiki',
      summary: '简介草稿',
      sortKey: 'A00000001',
      childIds: ['pg-sub-1', 'pg-sub-2'],
    }),
    viewNode({ id: 'pg-sub-1', title: '子页一', parentId: 'pg-wiki', depth: 1, sortKey: 'A00000002', updatedAt: AT + 1000 }),
    viewNode({ id: 'pg-sub-2', title: '子页二', parentId: 'pg-wiki', depth: 1, sortKey: 'A00000003' }),
  ];
}

function makeBridge() {
  return {
    pages: {
      tree: vi.fn(async () => makeNodes()),
      create: vi.fn(async () => ({ id: 'pg-created', sortKey: 'A00000009' })),
      rename: vi.fn(async () => ({ id: 'pg-wiki' })),
      convert: vi.fn(async () => ({ ok: true as const })),
      setSummary: vi.fn(async () => ({ ok: true as const })),
    },
    favorites: { list: vi.fn(async () => ({ pageIds: [] })), set: vi.fn(async () => ({ pageIds: [] })) },
    recent: { list: vi.fn(async () => ({ pageIds: [] })), touch: vi.fn(async () => ({ pageIds: [] })) },
    workspaces: {
      list: vi.fn(async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID })),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    blocks: {
      commit: vi.fn(async () => 0),
      list: vi.fn(async () => ({ locked: false, blocks: [] })),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    collab: {
      attach: vi.fn(async () => ({ entries: [], ledgerHasCrdt: false })),
      apply: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      onUpdate: vi.fn().mockReturnValue(() => {}),
    },
  };
}

type Bridge = ReturnType<typeof makeBridge>;
let bridge: Bridge;

function seedStore(nodes: PageNodeView[], selectedId: string | null): void {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    workspaceId: WS_ID,
    workspaces: [{ id: WS_ID, name: '个人工作区' }],
    nodes,
    expanded: new Set(nodes.map((node) => node.id)),
    tabs: selectedId !== null ? [selectedId] : [],
    selectedId,
  }));
}

beforeEach(() => {
  bridge = makeBridge();
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  pagesStore.setState((state) => ({ ...state, status: 'loading', nodes: [], tabs: [], selectedId: null }));
});

describe('SidebarTree Wiki 分区（T42-01 §1.2）', () => {
  it('Wiki 分区在列：count 与条目一致，子页随行；普通分区剪除 wiki 子树', () => {
    seedStore(makeNodes(), 'pg-normal');
    render(<SidebarTree />);

    const head = screen.getByTestId('side-wiki');
    expect(head.textContent).toContain('Wiki');
    expect(head.textContent).toContain('1'); // 分区计数 = wiki 页数（子页不算根）
    // wiki 页与其子页在 Wiki 分区渲染
    expect(screen.getByTestId('side-wiki-node-pg-wiki')).toBeTruthy();
    expect(screen.getByTestId('side-wiki-node-pg-sub-1')).toBeTruthy();
    // 普通分区不出现 wiki 页及其子树
    expect(screen.queryByTestId('side-node-pg-wiki')).toBeNull();
    expect(screen.queryByTestId('side-node-pg-sub-1')).toBeNull();
    // 普通页仍在普通分区
    expect(screen.getByTestId('side-node-pg-normal')).toBeTruthy();
  });

  it('普通页 ⋯ 菜单「转为 Wiki」→ convert({to:"wiki"})；wiki 页菜单为「转为普通页」', async () => {
    seedStore(makeNodes(), 'pg-normal');
    render(<SidebarTree />);

    fireEvent.click(screen.getByTestId('side-more-pg-normal'));
    const menuNormal = await screen.findByRole('menu');
    fireEvent.click(within(menuNormal).getByText(/Wiki/));
    await waitFor(() => {
      expect(bridge.pages.convert).toHaveBeenCalledWith({ pageId: 'pg-normal', to: 'wiki' });
    });

    fireEvent.click(screen.getByTestId('side-more-pg-wiki'));
    // wiki 页的菜单里不再有「转为 Wiki」，而是「转为普通页」
    const menuWiki = await screen.findByRole('menu');
    fireEvent.click(within(menuWiki).getByText(/普通页|regular page/));
    await waitFor(() => {
      expect(bridge.pages.convert).toHaveBeenCalledWith({ pageId: 'pg-wiki', to: 'page' });
    });
  });
});

describe('PageView 承载判定（T42-01 §0 + T40-01-2 闭环）', () => {
  it('pageType=database → 渲染 DbPage（重开/重载后树注解驱动，不依赖本地 dbPageId）', async () => {
    seedStore(
      [viewNode({ id: 'pg-db', title: '任务追踪', pageType: 'database' })],
      'pg-db',
    );
    render(<PageView />);
    const stub = await screen.findByTestId('db-page-stub');
    expect(stub.textContent).toBe('db:pg-db');
  });

  it('pageType=wiki → 渲染 WikiLanding（标题 + 简介 + 子页索引）', async () => {
    seedStore(makeNodes(), 'pg-wiki');
    render(<PageView />);
    expect(await screen.findByTestId('wiki-index')).toBeTruthy();
    expect(screen.getByTestId('wiki-title').textContent).toBe('研究 Wiki');

    // T106-02（老板 10-07「需要」= 一起摘掉）：标题行左侧的装饰图标槽已下线，
    // 不得再出现 .pv-page-icon，也不得用 emoji 当图标（§ 图标纪律）。
    const row = screen.getByTestId('wiki-title').closest('.pv-title-row');
    expect(row).not.toBeNull();
    expect(row!.querySelector('.pv-page-icon')).toBeNull();
    expect(/\p{Extended_Pictographic}/u.test(row!.textContent ?? '')).toBe(false);
    expect((screen.getByTestId('wiki-summary') as HTMLTextAreaElement).value).toBe('简介草稿');
    expect(screen.getAllByTestId('wiki-index-row').length).toBe(2);
  });

  it('pageType=page → 仍走编辑器路径（不被误判为 wiki/database）', async () => {
    seedStore([viewNode({ id: 'pg-normal', title: '普通页' })], 'pg-normal');
    render(<PageView />);
    expect(await screen.findByTestId('septcats-editor')).toBeTruthy();
    expect(screen.queryByTestId('db-page-stub')).toBeNull();
    expect(screen.queryByTestId('wiki-index')).toBeNull();
  });
});

describe('协作层接入承载门控（T42-01-1）', () => {
  it('普通页 → wiki 页：释放原页协作后，不得用残留编辑器给 wiki 页接协作层', async () => {
    // 复现原缺陷路径：在 wiki 落地页「新建子页」进入普通页（编辑器 + 协作接入），
    // 再返回 wiki 落地页 —— 原缺陷在返回时用残留编辑器实例 + wiki 页 id 调
    // attachCollab（Y→PM 投影失败 + y-sync$ 插件重复注册两条 console 错误）。
    seedStore(makeNodes(), 'pg-normal');
    render(<PageView />);
    await screen.findByTestId('septcats-editor');
    await waitFor(() => {
      expect(bridge.collab.attach).toHaveBeenCalledWith({ pageId: 'pg-normal' });
    });

    // 返回 wiki 落地页（store 驱动重渲染，与真实「点击索引行返回」同构）
    seedStore(makeNodes(), 'pg-wiki');
    await screen.findByTestId('wiki-index');
    // 原页协作先释放
    await waitFor(() => {
      expect(bridge.collab.detach).toHaveBeenCalledWith({ pageId: 'pg-normal' });
    });
    // 关键断言：wiki 页自身（无编辑器承载）不接协作层
    expect(bridge.collab.attach).not.toHaveBeenCalledWith({ pageId: 'pg-wiki' });
    expect(bridge.collab.attach).toHaveBeenCalledTimes(1);
  });

  it('pageType=database 页同样不接协作层（承载判定同构）', async () => {
    seedStore([viewNode({ id: 'pg-db', title: '任务追踪', pageType: 'database' })], 'pg-db');
    render(<PageView />);
    await screen.findByTestId('db-page-stub');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.collab.attach).not.toHaveBeenCalled();
  });
});

describe('WikiLanding 落地页（T42-01 §1.3/§1.4）', () => {
  it('简介失焦保存 → setSummary；「转为普通页」→ convert({to:"page"})', async () => {
    seedStore(makeNodes(), 'pg-wiki');
    render(<WikiLanding node={makeNodes()[1]!} />);

    const summary = screen.getByTestId('wiki-summary') as HTMLTextAreaElement;
    fireEvent.change(summary, { target: { value: '新的简介' } });
    fireEvent.blur(summary);
    await waitFor(() => {
      expect(bridge.pages.setSummary).toHaveBeenCalledWith({ pageId: 'pg-wiki', summary: '新的简介' });
    });

    fireEvent.click(screen.getByText(/普通页|regular page/));
    await waitFor(() => {
      expect(bridge.pages.convert).toHaveBeenCalledWith({ pageId: 'pg-wiki', to: 'page' });
    });
  });

  it('「新建子页」以 parentId=wiki 调 pages.create；索引行点击进入（touchRecent）', async () => {
    seedStore(makeNodes(), 'pg-wiki');
    render(<WikiLanding node={makeNodes()[1]!} />);

    fireEvent.click(screen.getByText(/新建子页|New subpage/));
    await waitFor(() => {
      expect(bridge.pages.create).toHaveBeenCalledWith({ parentId: 'pg-wiki' });
    });

    // 索引条目数 = 实际子页数（2），末次更新时间在行内展示
    const rows = screen.getAllByTestId('wiki-index-row');
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain('子页一');
    fireEvent.click(rows[0]!);
    await waitFor(() => {
      expect(bridge.recent.touch).toHaveBeenCalledWith({ pageId: 'pg-sub-1' });
    });
  });
});
