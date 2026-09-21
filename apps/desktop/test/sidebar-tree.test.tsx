// @vitest-environment jsdom
/**
 * sidebar-tree.test.tsx —— 侧栏真树 UI 用例（TASK-T21-02 §1）。
 *
 * 覆盖：真树渲染与 active 高亮、行点击 selectPage（含祖先展开）、折叠三角
 * toggleExpand（不触发行选中）、「新建页面」createPage(null) 后选中新页、
 * 收藏/最近分组解析（缺失 id 跳过 / 空态）、回收站 showTrash/showPages 切换、
 * 行内重命名（双击 → Enter 提交 / Esc 取消）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；断言落在 pagesStore 状态与假桥调用。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import type { SeptcatsApi } from '../src/types/window';

const WS_ID = 'ws-sidebar-test';

/** PageNode 夹具：补齐派生字段的默认值（pages-store.test.ts 同款）。 */
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

function makeNodes(): PageNode[] {
  return [
    pageNode({ id: 'pg-root', title: '研究', childIds: ['pg-a', 'pg-b'] }),
    pageNode({ id: 'pg-a', title: '暗物质探测实验笔记', parentId: 'pg-root', depth: 1, sortKey: 'A00000001' }),
    pageNode({ id: 'pg-b', title: '论文速览', parentId: 'pg-root', depth: 1, sortKey: 'A00000002' }),
  ];
}

type Bridge = {
  tree: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  touch: ReturnType<typeof vi.fn>;
};

let nodesDb: PageNode[] = [];
let bridge: Bridge;

function installBridge(): void {
  const impl: Bridge = {
    tree: vi.fn(async () => nodesDb.map((node) => ({ ...node, childIds: [...node.childIds] }))),
    create: vi.fn(async () => {
      const node = pageNode({ id: 'pg-new', title: '未命名', sortKey: 'A00000003' });
      nodesDb.push(node);
      return { id: node.id, sortKey: node.sortKey };
    }),
    rename: vi.fn(async ({ id, title }: { id: string; title: string }) => {
      const node = nodesDb.find((item) => item.id === id);
      if (node !== undefined) {
        node.title = title;
      }
      return { id };
    }),
    touch: vi.fn(async () => ({ pageIds: [] })),
  };
  bridge = impl;
  vi.stubGlobal('septcats', {
    workspaces: { list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }) },
    pages: { tree: impl.tree, create: impl.create, rename: impl.rename },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: impl.touch },
  } as unknown as SeptcatsApi);
}

function seedStore(extra?: Partial<PagesState>): void {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: WS_ID,
    workspaces: [{ id: WS_ID, name: '个人工作区' }],
    nodes: nodesDb,
    expanded: new Set<string>(['pg-root']),
    selectedId: 'pg-a',
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    ...extra,
  }));
}

beforeEach(() => {
  nodesDb = makeNodes();
  installBridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SidebarTree（TASK-T21-02 §0.1）', () => {
  it('真树渲染：根 + 展开的子行按 depth 缩进，active 高亮 = selectedId', () => {
    seedStore();
    render(<SidebarTree />);

    expect(screen.getByTestId('side-node-pg-root').textContent).toContain('研究');
    expect(screen.getByTestId('side-node-pg-a').textContent).toContain('暗物质探测实验笔记');
    expect(screen.getByTestId('side-node-pg-b').textContent).toContain('论文速览');
    const active = document.querySelector('.app-nav-row--active');
    expect(active?.getAttribute('data-testid')).toBe('side-node-pg-a');
  });

  it('点击行 → selectPage：selectedId 更新、编辑态复位、touchRecent 触达', async () => {
    seedStore({ selectedId: null });
    render(<SidebarTree />);

    fireEvent.click(screen.getByTestId('side-node-pg-b'));

    const state = pagesStore.getState();
    expect(state.selectedId).toBe('pg-b');
    expect(state.editingId).toBeNull();
    expect(state.expanded.has('pg-root')).toBe(true); // 祖先链保持展开
    await waitFor(() => expect(bridge.touch).toHaveBeenCalledWith({ pageId: 'pg-b' }));
  });

  it('折叠三角 → toggleExpand 且不冒泡到行选中；再点恢复展开', () => {
    seedStore();
    render(<SidebarTree />);

    const rootRow = screen.getByTestId('side-node-pg-root');
    const caret = rootRow.querySelector('.app-nav-tw');
    expect(caret).not.toBeNull();

    fireEvent.click(caret!);
    expect(pagesStore.getState().expanded.has('pg-root')).toBe(false);
    expect(pagesStore.getState().selectedId).toBe('pg-a'); // 未被行点击改写
    expect(screen.queryByTestId('side-node-pg-a')).toBeNull(); // 子行收起

    fireEvent.click(screen.getByTestId('side-node-pg-root').querySelector('.app-nav-tw')!);
    expect(pagesStore.getState().expanded.has('pg-root')).toBe(true);
    expect(screen.getByTestId('side-node-pg-a')).toBeDefined();
  });

  it('「新建页面」→ createPage(null) 落库并对账，选中新页并进入重命名', async () => {
    seedStore();
    render(<SidebarTree />);

    fireEvent.click(screen.getByTestId('side-new-page'));

    await waitFor(() => expect(bridge.create).toHaveBeenCalledWith({ parentId: null }));
    await waitFor(() => expect(pagesStore.getState().selectedId).toBe('pg-new'));
    expect(pagesStore.getState().editingId).toBe('pg-new');
    expect(pagesStore.getState().view).toBe('pages');
    await waitFor(() => expect(screen.getByTestId('side-node-pg-new')).toBeDefined());
  });

  it('收藏分组：favoriteIds 经 nodes 解析（缺失 id 跳过），展开后可点选', () => {
    seedStore({ favoriteIds: ['pg-b', 'pg-missing'] });
    render(<SidebarTree />);

    // 收起态只露计数（缺失 id 不计入）
    const group = screen.getByTestId('side-favorites');
    expect(group.textContent).toContain('收藏');
    expect(group.textContent).toContain('1');
    expect(screen.queryByTestId('side-favorites-item-0')).toBeNull();

    fireEvent.click(group);
    const item = screen.getByTestId('side-favorites-item-0');
    expect(item.textContent).toContain('论文速览');

    fireEvent.click(item);
    expect(pagesStore.getState().selectedId).toBe('pg-b');
  });

  it('最近分组为空：展开显示既有空态样式的空态行', () => {
    seedStore({ recentIds: [] });
    render(<SidebarTree />);

    fireEvent.click(screen.getByTestId('side-recent'));
    expect(screen.getByText('暂无最近')).toBeDefined();
  });

  it('回收站：点击 showTrash（带真实待删计数），再点 showPages 回页面视图', () => {
    nodesDb.push(pageNode({ id: 'pg-dead', title: '旧页', alive: 0, deletedAt: 123 }));
    seedStore({ selectedId: 'pg-a' });
    render(<SidebarTree />);

    const foot = screen.getByTestId('side-trash');
    expect(foot.textContent).toContain('1'); // 真实待删数角标

    fireEvent.click(foot);
    expect(pagesStore.getState().view).toBe('trash');

    fireEvent.click(foot);
    expect(pagesStore.getState().view).toBe('pages');
  });

  it('行内重命名：双击 → 既有 editingId 输入框，Enter 提交 rename，Esc 取消', async () => {
    seedStore();
    render(<SidebarTree />);

    fireEvent.doubleClick(screen.getByTestId('side-node-pg-a'));
    expect(pagesStore.getState().editingId).toBe('pg-a');
    const input = document.querySelector('.app-nav-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('暗物质探测实验笔记');

    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(bridge.rename).toHaveBeenCalledWith({ id: 'pg-a', title: '新标题' }));
    await waitFor(() => expect(pagesStore.getState().editingId).toBeNull());

    // Esc 取消：不触发 rename
    fireEvent.doubleClick(screen.getByTestId('side-node-pg-a'));
    const again = document.querySelector('.app-nav-input') as HTMLInputElement;
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(pagesStore.getState().editingId).toBeNull();
    expect(bridge.rename).toHaveBeenCalledTimes(1);
  });
});

/**
 * TASK-T51-01 §1①：行内重命名三键语义 + 空值回退（老板 09-21 报「一定要回车才能
 * 确认，不合理」）。失焦提交走既有 renamePage，空值/仅空白/未变化不落库。
 */
describe('SidebarTree 行内重命名失焦提交（TASK-T51-01）', () => {
  function openRename(): HTMLInputElement {
    fireEvent.doubleClick(screen.getByTestId('side-node-pg-a'));
    const input = document.querySelector('.app-nav-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    return input;
  }

  it('blur 提交：改名后点别处（失焦）即落库，不停留在编辑态', async () => {
    seedStore();
    render(<SidebarTree />);

    const input = openRename();
    fireEvent.change(input, { target: { value: '失焦改名' } });
    fireEvent.blur(input);

    await waitFor(() => expect(bridge.rename).toHaveBeenCalledWith({ id: 'pg-a', title: '失焦改名' }));
    await waitFor(() => expect(pagesStore.getState().editingId).toBeNull());
  });

  it('Enter 提交：既有行为保持（落库 + 退出编辑）', async () => {
    seedStore();
    render(<SidebarTree />);

    const input = openRename();
    fireEvent.change(input, { target: { value: '回车改名' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(bridge.rename).toHaveBeenCalledWith({ id: 'pg-a', title: '回车改名' }));
    await waitFor(() => expect(pagesStore.getState().editingId).toBeNull());
  });

  it('Esc 取消：不落库、标题回退原标题', () => {
    seedStore();
    render(<SidebarTree />);

    const input = openRename();
    fireEvent.change(input, { target: { value: '不该保存' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(pagesStore.getState().editingId).toBeNull();
    expect(bridge.rename).not.toHaveBeenCalled();
    expect(pagesStore.getState().nodes.find((node) => node.id === 'pg-a')?.title).toBe('暗物质探测实验笔记');
  });

  it('空值/仅空白/未变化 blur：回退原标题，不发空 op', async () => {
    seedStore();
    render(<SidebarTree />);

    // 仅空白 → blur：不落库
    const blank = openRename();
    fireEvent.change(blank, { target: { value: '   ' } });
    fireEvent.blur(blank);
    expect(pagesStore.getState().editingId).toBeNull();
    expect(bridge.rename).not.toHaveBeenCalled();

    // 值未变化 → blur：同样跳过提交（不新造协议，靠调用侧跳过）
    const unchanged = openRename();
    fireEvent.blur(unchanged);
    await waitFor(() => expect(pagesStore.getState().editingId).toBeNull());
    expect(bridge.rename).not.toHaveBeenCalled();
    expect(pagesStore.getState().nodes.find((node) => node.id === 'pg-a')?.title).toBe('暗物质探测实验笔记');
  });
});
