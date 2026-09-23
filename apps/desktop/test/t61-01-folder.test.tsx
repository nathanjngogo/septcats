// @vitest-environment jsdom
/**
 * t61-01-folder.test.tsx —— TASK-T61-01 §1 侧栏「文件夹」（PRD-R13 ④）的 app 侧面。
 *
 * 覆盖（对应任务书 §1 逐条 + §2.5 精神）：
 * - §1.1 行菜单「新建子页面」→ 既有 `pages.create({ parentId: 该行 id })`（新页进重命名；
 *   **不造文件夹新实体**）；
 * - §1.2 派生外观：有活子页的普通页 → FolderSimple，无子页 → FileText（T60 ② 不回退）；
 *   wiki 行仍 Note、database 行仍 FolderSimple、Wiki 分区头仍 Note（现状不动）；
 *   「新建子页面后父行图标即时变 FolderSimple」的端到端一条；
 * - §1.3 「移入…」二级选择：列出非 database 活页 + 「工作区根」，**排除自身与后代**（防环）；
 *   选中 → 既有 `pages.move`（树形变化 + 目标父页自动展开）；
 * - §1.5 折叠态点行 = 选中 + 展开其子树（点 Caret 的折叠/展开语义不变）。
 *
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；假树的 childIds/depth 由 parentId 现算
 * （与 main 侧派生口径一致），断言落在假桥调用、pagesStore 与 DOM。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileText, FolderSimple, Icon, Note } from '@septcats/ui';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import type { PageNodeView, SeptcatsApi } from '../src/types/window';

const AT = 1_700_000_000_000;
const WS_ID = 'ws-t61';

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

/** 基础夹具：pg-a（有子页）/ pg-child（a 的子页）/ pg-b（无子页）/ 多维数据 / Wiki。 */
function makeSeed(): PageNodeView[] {
  return [
    viewNode({ id: 'pg-a', title: '研究', sortKey: 'A00000000' }),
    viewNode({ id: 'pg-child', title: '子页', parentId: 'pg-a', sortKey: 'A00000001' }),
    viewNode({ id: 'pg-b', title: '论文速览', sortKey: 'A00000004' }),
    viewNode({ id: 'pg-db', title: '多维数据', pageType: 'database', sortKey: 'A00000002' }),
    viewNode({ id: 'pg-wiki', title: '研究 Wiki', pageType: 'wiki', sortKey: 'A00000003' }),
  ];
}

/** parentId → 派生 childIds/depth（与 main 侧 tree 派生同口径；sortKey 升序）。 */
function deriveTree(rows: PageNodeView[]): PageNodeView[] {
  const bySort = (a: PageNodeView, b: PageNodeView): number =>
    a.sortKey === b.sortKey ? (a.id < b.id ? -1 : 1) : a.sortKey < b.sortKey ? -1 : 1;
  const alive = rows.filter((node) => node.alive === 1);
  const depthOf = (node: PageNodeView): number => {
    let depth = 0;
    let cursor = node.parentId;
    while (cursor !== null && depth < 50) {
      depth += 1;
      cursor = rows.find((item) => item.id === cursor)?.parentId ?? null;
    }
    return depth;
  };
  return rows.map((node) => ({
    ...node,
    childIds: alive
      .filter((child) => child.parentId === node.id)
      .sort(bySort)
      .map((child) => child.id),
    depth: depthOf(node),
  }));
}

type Bridge = ReturnType<typeof makeBridge>;

function makeBridge(): {
  pages: {
    tree: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    move: ReturnType<typeof vi.fn>;
    convert: ReturnType<typeof vi.fn>;
    setSummary: ReturnType<typeof vi.fn>;
  };
  favorites: { list: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  recent: { list: ReturnType<typeof vi.fn>; touch: ReturnType<typeof vi.fn> };
  workspaces: { list: ReturnType<typeof vi.fn>; onChanged: ReturnType<typeof vi.fn> };
} {
  return {
    pages: {
      tree: vi.fn(async () => deriveTree(rowsDb)),
      create: vi.fn(async ({ parentId }: { parentId: string | null }) => {
        const id = 'pg-new';
        rowsDb.push(
          viewNode({
            id,
            title: '未命名',
            parentId,
            sortKey: 'A00000009',
            depth: parentId === null ? 0 : 1,
          }),
        );
        return { id, sortKey: 'A00000009' };
      }),
      rename: vi.fn(async () => ({ id: 'pg-a' })),
      move: vi.fn(async ({ id, newParentId }: { id: string; newParentId: string | null }) => {
        const node = rowsDb.find((item) => item.id === id);
        if (node !== undefined) {
          node.parentId = newParentId;
        }
        return { sortKey: node?.sortKey ?? 'A00000000', rebalanced: false, opCount: 1 };
      }),
      convert: vi.fn(async () => ({ ok: true as const })),
      setSummary: vi.fn(async () => ({ ok: true as const })),
    },
    favorites: { list: vi.fn(async () => ({ pageIds: [] })), set: vi.fn(async () => ({ pageIds: [] })) },
    recent: { list: vi.fn(async () => ({ pageIds: [] })), touch: vi.fn(async () => ({ pageIds: [] })) },
    workspaces: {
      list: vi.fn(async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID })),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
  };
}

let bridge: Bridge;
let rowsDb: PageNodeView[] = [];

function seedStore(extra?: Partial<PagesState>): void {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    workspaceId: WS_ID,
    workspaces: [{ id: WS_ID, name: '个人工作区' }],
    nodes: deriveTree(rowsDb),
    expanded: new Set<string>(['pg-a']),
    tabs: [],
    selectedId: null,
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    ...extra,
  }));
}

/** 像素图标族判定（T58 契约；T60-01 同款）。 */
function glyphSig(glyph: ComponentProps<typeof Icon>['icon']): string {
  const { container, unmount } = render(<Icon icon={glyph} size="sm" />);
  const sig = container.querySelector('svg')?.innerHTML ?? 'MISSING';
  unmount();
  return sig;
}

function rowIconSig(testId: string): string {
  const row = screen.getByTestId(testId);
  return row.querySelector('svg.app-nav-ic')?.innerHTML ?? 'NO_SVG';
}

function openRowMenu(id: string): HTMLElement {
  fireEvent.click(screen.getByTestId(`side-more-${id}`));
  return screen.getByRole('menu', { name: '页面操作' });
}

beforeEach(() => {
  rowsDb = makeSeed();
  bridge = makeBridge();
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// §1.2 派生外观
// ---------------------------------------------------------------------------

describe('T61-01 §1.2 文件夹派生外观（有活子页的普通页 = FolderSimple）', () => {
  it('有活子页的普通页 → FolderSimple；无子页 → FileText（T60 ② 不回退）', () => {
    seedStore();
    render(<SidebarTree />);
    const folder = glyphSig(FolderSimple);
    const file = glyphSig(FileText);
    expect(folder).not.toBe(file);

    expect(rowIconSig('side-node-pg-a')).toBe(folder); // 有子页 → 文件夹长相
    expect(rowIconSig('side-node-pg-b')).toBe(file); // 无子页 → 文件图标
    expect(rowIconSig('side-node-pg-child')).toBe(file); // 叶子子页 → 文件图标
  });

  it('现状不回归：database 行仍 FolderSimple、wiki 行仍 Note、Wiki 分区头仍 Note', () => {
    seedStore();
    render(<SidebarTree />);
    expect(rowIconSig('side-node-pg-db')).toBe(glyphSig(FolderSimple));
    expect(rowIconSig('side-wiki-node-pg-wiki')).toBe(glyphSig(Note));
    expect(rowIconSig('side-wiki')).toBe(glyphSig(Note));
  });

  it('子页全部删除（软删）后父行回落 FileText —— 派生判定只看活子页', () => {
    rowsDb.find((node) => node.id === 'pg-child')!.alive = 0;
    rowsDb.find((node) => node.id === 'pg-child')!.deletedAt = AT;
    seedStore();
    render(<SidebarTree />);
    expect(rowIconSig('side-node-pg-a')).toBe(glyphSig(FileText));
  });
});

// ---------------------------------------------------------------------------
// §1.1 新建子页面
// ---------------------------------------------------------------------------

describe('T61-01 §1.1「新建子页面」= 既有 createPage(该行 id)', () => {
  it('菜单含「新建子页面」「移入…」，位置在「删除」之前且非 danger', () => {
    seedStore();
    render(<SidebarTree />);
    const menu = openRowMenu('pg-b');
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent ?? '');
    expect(labels[0]).toContain('重命名');
    // T64-01 新语义（PM 改）：菜单新增「新建子文件夹」，不再钉死下标，改钉相对顺序。
    const idxSub = labels.findIndex((l) => l.includes('新建子页面'));
    const idxFolder = labels.findIndex((l) => l.includes('新建子文件夹'));
    const idxMove = labels.findIndex((l) => l.includes('移入…'));
    expect(idxSub).toBeGreaterThan(-1);
    expect(idxFolder).toBeGreaterThan(idxSub);
    expect(idxMove).toBeGreaterThan(idxFolder);
    expect(labels[labels.length - 1]).toContain('删除');
    expect(within(menu).getByRole('menuitem', { name: '新建子页面' }).className).not.toContain('danger');
  });

  it('点「新建子页面」→ 假桥收到 { parentId: 该行 id }，新页选中并进入重命名，菜单关闭', async () => {
    seedStore();
    render(<SidebarTree />);
    fireEvent.click(within(openRowMenu('pg-b')).getByRole('menuitem', { name: '新建子页面' }));

    await vi.waitFor(() => {
      expect(bridge.pages.create).toHaveBeenCalledWith({ parentId: 'pg-b' });
    });
    await vi.waitFor(() => {
      expect(pagesStore.getState().selectedId).toBe('pg-new');
    });
    expect(pagesStore.getState().editingId).toBe('pg-new');
    expect(screen.queryByRole('menu', { name: '页面操作' })).toBeNull();
  });

  it('端到端：无子页的 pg-b 新建子页后 → 父行图标变 FolderSimple（派生，父指针反查）', async () => {
    seedStore();
    render(<SidebarTree />);
    expect(rowIconSig('side-node-pg-b')).toBe(glyphSig(FileText));

    fireEvent.click(within(openRowMenu('pg-b')).getByRole('menuitem', { name: '新建子页面' }));
    await vi.waitFor(() => {
      expect(rowIconSig('side-node-pg-b')).toBe(glyphSig(FolderSimple));
    });
    // 新子页行出现（父行已展开）且同为文件图标
    expect(rowIconSig('side-node-pg-new')).toBe(glyphSig(FileText));
  });
});

// ---------------------------------------------------------------------------
// §1.3 移入…
// ---------------------------------------------------------------------------

describe('T61-01 §1.3「移入…」二级选择（排除自身与后代防环）', () => {
  it('一级菜单点「移入…」→ 换成二级列表（含「库根」+ 候选活页）', () => {
    seedStore();
    render(<SidebarTree />);
    const first = openRowMenu('pg-a');
    fireEvent.click(within(first).getByRole('menuitem', { name: '移入…' }));

    const second = screen.getByRole('menu', { name: '移入页面' });
    const labels = within(second)
      .getAllByRole('menuitem')
      .map((item) => item.textContent ?? '');
    expect(labels[0]).toContain('库根');
    expect(labels.some((label) => label.includes('论文速览'))).toBe(true);
    // 防环：自身与后代都不在候选里
    expect(labels.some((label) => label.includes('研究') && !label.includes('研究 Wiki'))).toBe(false);
    expect(labels.some((label) => label.includes('子页'))).toBe(false);
    // 多维数据行不是页面容器 → 不作候选
    expect(labels.some((label) => label.includes('多维数据'))).toBe(false);
  });

  it('选目标页 → 既有 pages.move({ id, newParentId }) + 树形变化（父指针 + 目标父页自动展开）', async () => {
    seedStore({ expanded: new Set<string>([]) });
    render(<SidebarTree />);
    fireEvent.click(within(openRowMenu('pg-a')).getByRole('menuitem', { name: '移入…' }));
    const second = screen.getByRole('menu', { name: '移入页面' });
    fireEvent.click(within(second).getByRole('menuitem', { name: '论文速览' }));

    await vi.waitFor(() => {
      expect(bridge.pages.move).toHaveBeenCalledWith({ id: 'pg-a', newParentId: 'pg-b' });
    });
    await vi.waitFor(() => {
      expect(pagesStore.getState().nodes.find((node) => node.id === 'pg-a')?.parentId).toBe('pg-b');
    });
    // 目标父页自动展开（落点可见）→ 行重渲染且深度 = 1
    await vi.waitFor(() => {
      expect(pagesStore.getState().expanded.has('pg-b')).toBe(true);
    });
    const row = await screen.findByTestId('side-node-pg-a');
    expect(row.style.paddingLeft).toContain('* 1');
    expect(screen.queryByRole('menu', { name: '移入页面' })).toBeNull();
  });

  it('选「库根」→ newParentId = null（回到顶层）', async () => {
    seedStore();
    render(<SidebarTree />);
    fireEvent.click(within(openRowMenu('pg-child')).getByRole('menuitem', { name: '移入…' }));
    const second = screen.getByRole('menu', { name: '移入页面' });
    fireEvent.click(within(second).getByRole('menuitem', { name: '库根' }));

    await vi.waitFor(() => {
      expect(bridge.pages.move).toHaveBeenCalledWith({ id: 'pg-child', newParentId: null });
    });
    await vi.waitFor(() => {
      expect(pagesStore.getState().nodes.find((node) => node.id === 'pg-child')?.parentId).toBeNull();
    });
  });

  it('当前父页在候选里被禁用（点了也是无操作）；Esc/点空白关掉二级列表', () => {
    seedStore();
    render(<SidebarTree />);
    fireEvent.click(within(openRowMenu('pg-child')).getByRole('menuitem', { name: '移入…' }));
    const second = screen.getByRole('menu', { name: '移入页面' });
    // pg-child 的父 = pg-a（"研究"）→ 该候选禁用
    const parentItem = within(second).getByRole('menuitem', { name: '研究' });
    expect(parentItem.getAttribute('aria-disabled')).toBe('true');

    fireEvent.keyDown(second, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '移入页面' })).toBeNull();
  });

  it('右键入口同样能进二级列表（复用同一份构造）', () => {
    seedStore();
    render(<SidebarTree />);
    fireEvent.contextMenu(screen.getByTestId('side-node-pg-b'), { clientX: 200, clientY: 120 });
    fireEvent.click(within(screen.getByRole('menu', { name: '页面操作' })).getByRole('menuitem', { name: '移入…' }));
    expect(screen.getByRole('menu', { name: '移入页面' })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §1.5 折叠态点行 = 选中 + 展开
// ---------------------------------------------------------------------------

describe('T61-01 §1.5 折叠态文件夹点选时同时展开其子树', () => {
  it('折叠态点父行 → selectedId 落该行且子树展开（子行出现）', () => {
    seedStore({ expanded: new Set<string>([]), selectedId: null });
    render(<SidebarTree />);
    expect(screen.queryByTestId('side-node-pg-child')).toBeNull();

    fireEvent.click(screen.getByTestId('side-node-pg-a'));

    expect(pagesStore.getState().selectedId).toBe('pg-a');
    expect(pagesStore.getState().expanded.has('pg-a')).toBe(true);
    expect(screen.getByTestId('side-node-pg-child')).toBeDefined();
  });

  it('叶子页点行不改展开集；点 Caret 仍是纯折叠/展开（不选中）', () => {
    seedStore({ expanded: new Set<string>(['pg-a']), selectedId: null });
    render(<SidebarTree />);

    fireEvent.click(screen.getByTestId('side-node-pg-child'));
    expect(pagesStore.getState().selectedId).toBe('pg-child');
    expect(pagesStore.getState().expanded.has('pg-child')).toBe(false);

    fireEvent.click(screen.getByTestId('side-node-pg-a').querySelector('.app-nav-tw')!);
    expect(pagesStore.getState().expanded.has('pg-a')).toBe(false);
    expect(pagesStore.getState().selectedId).toBe('pg-child'); // 未被 Caret 改写
  });
});
