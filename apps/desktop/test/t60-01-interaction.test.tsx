// @vitest-environment jsdom
/**
 * t60-01-interaction.test.tsx —— TASK-T60-01 交互一致性批（PRD-R13 ②③④⑤⑥⑦ 的 app 侧面）。
 *
 * 覆盖（对应任务书 §1 测试清单）：
 * - ② 新建页面行图标 = FileText（树根普通页不再用 FolderSimple；wiki/database 行与
 *      Wiki 分区头 Note 现状保持）；
 * - ④⑤ 行菜单「重命名」条目（位置在删除之前、非 danger）→ 复用既有 beginRename
 *     行内编辑态 → 提交走既有 pages.rename（不新造协议）；
 * - ⑥ 右键行 = 同一份行菜单（items/onSelect 与 ⋯ 钮一致），落点 = 光标处
 *     （fixed 宿主 left/top = clientX/clientY，clamp 进视口）；Esc/点空白关；
 *     命中子控件（⋯ 钮/折叠钮/重命名输入框）不弹；
 * - ⑦ 所有 toast 3000ms 自动关闭（每条独立计时；2999ms 仍在 / 3001ms 消失；
 *     手动关闭与队列淘汰都清定时器）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；断言落在假桥调用与 DOM（wiki-ui 同款）。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileText, FolderSimple, Icon, Note } from '@septcats/ui';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import {
  TOAST_AUTO_DISMISS_MS,
  pagesActions,
  pagesStore,
  pushToast,
} from '../src/renderer/src/state/pages';
import type { PageNodeView, SeptcatsApi } from '../src/types/window';

const AT = 1_700_000_000_000;
const WS_ID = 'ws-t60';

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
    viewNode({ id: 'pg-a', title: '普通页 A', childIds: ['pg-child'] }),
    viewNode({
      id: 'pg-child',
      title: '子页',
      parentId: 'pg-a',
      depth: 1,
      sortKey: 'A00000001',
    }),
    viewNode({ id: 'pg-db', title: '多维数据', pageType: 'database', sortKey: 'A00000002' }),
    viewNode({ id: 'pg-wiki', title: '研究 Wiki', pageType: 'wiki', sortKey: 'A00000003' }),
  ];
}

function makeBridge() {
  return {
    pages: {
      tree: vi.fn(async () => makeNodes()),
      create: vi.fn(async () => ({ id: 'pg-created', sortKey: 'A00000009' })),
      rename: vi.fn(async () => ({ id: 'pg-a' })),
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
    editingId: null,
    toasts: [],
  }));
}

beforeEach(() => {
  bridge = makeBridge();
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  pagesStore.setState((state) => ({
    ...state,
    status: 'loading',
    nodes: [],
    tabs: [],
    selectedId: null,
    editingId: null,
    toasts: [],
  }));
});

// ---------------------------------------------------------------------------
// ② 行图标
// ---------------------------------------------------------------------------

/** 像素图标无名字属性 → 用「与参考渲染逐字相同」判定族（T58 资产表↔运行时表同族）。 */
function glyphSig(glyph: ComponentProps<typeof Icon>['icon']): string {
  const { container, unmount } = render(<Icon icon={glyph} size="sm" />);
  const sig = container.querySelector('svg')?.innerHTML ?? 'MISSING';
  unmount();
  return sig;
}

function rowIconSig(testId: string): string {
  // 只取图标槽（.app-nav-ic）：有子页的行首 svg 是折叠三角（CaretRight），不能用 first-svg 判族
  const row = screen.getByTestId(testId);
  return row.querySelector('svg.app-nav-ic')?.innerHTML ?? 'NO_SVG';
}

describe('T60-01 ② 行图标 = 文件图标', () => {
  it('无子页的普通页行图标 = FileText（≠ FolderSimple）', () => {
    seedStore(makeNodes(), 'pg-a');
    render(<SidebarTree />);
    const file = glyphSig(FileText);
    const folder = glyphSig(FolderSimple);
    expect(file).not.toBe(folder);

    // T61-01 §1.2 承接：有活子页的行改「文件夹长相」（派生），叶子行仍文件图标
    expect(rowIconSig('side-node-pg-child')).toBe(file);
    expect(rowIconSig('side-node-pg-child')).not.toBe(folder);
    expect(rowIconSig('side-node-pg-a')).toBe(folder); // pg-a 有活子页 pg-child
  });

  it('现状不回归：database 行仍 FolderSimple、wiki 行仍 Note、Wiki 分区头仍 Note', () => {
    seedStore(makeNodes(), 'pg-a');
    render(<SidebarTree />);
    expect(rowIconSig('side-node-pg-db')).toBe(glyphSig(FolderSimple));
    expect(rowIconSig('side-wiki-node-pg-wiki')).toBe(glyphSig(Note));
    expect(rowIconSig('side-wiki')).toBe(glyphSig(Note));
  });
});

// ---------------------------------------------------------------------------
// ④⑤ 行菜单「重命名」
// ---------------------------------------------------------------------------

function openRowMenu(id: string): HTMLElement {
  fireEvent.click(screen.getByTestId(`side-more-${id}`));
  return screen.getByRole('menu', { name: '页面操作' });
}

describe('T60-01 ④⑤ 行菜单「重命名」条目', () => {
  it('菜单含「重命名」，位置在「删除」之前且非 danger', () => {
    seedStore(makeNodes(), 'pg-a');
    render(<SidebarTree />);
    const menu = openRowMenu('pg-a');
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent ?? '');
    expect(labels[0]).toContain('重命名');
    expect(labels[labels.length - 1]).toContain('删除');
    const renameItem = within(menu).getByRole('menuitem', { name: '重命名' });
    expect(renameItem.className).not.toContain('danger');
    expect(within(menu).getByRole('menuitem', { name: '删除' }).className).toContain('danger');
  });

  it('点「重命名」→ 复用既有 beginRename（editingId 落该页 + 行内输入框出现）', () => {
    seedStore(makeNodes(), 'pg-a');
    render(<SidebarTree />);
    const menu = openRowMenu('pg-a');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '重命名' }));

    expect(pagesStore.getState().editingId).toBe('pg-a');
    expect((screen.getByTestId('side-rename-input') as HTMLInputElement).value).toBe('普通页 A');
    // 菜单随选中关闭（同一出口）
    expect(screen.queryByRole('menu', { name: '页面操作' })).toBeNull();
  });

  it('行内改名提交仍走既有 pages.rename（菜单入口不新造落库路径）', async () => {
    seedStore(makeNodes(), 'pg-a');
    render(<SidebarTree />);
    fireEvent.click(within(openRowMenu('pg-a')).getByRole('menuitem', { name: '重命名' }));

    const input = screen.getByTestId('side-rename-input');
    fireEvent.change(input, { target: { value: '改名后' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(bridge.pages.rename).toHaveBeenCalledWith({ id: 'pg-a', title: '改名后' });
    });
  });
});

// ---------------------------------------------------------------------------
// ⑥ 右键行菜单
// ---------------------------------------------------------------------------

describe('T60-01 ⑥ 右键 = 同一份行菜单（光标处）', () => {
  it('contextmenu 弹菜单（条目与 ⋯ 一致）且落点 = 光标坐标（fixed clamp 宿主）', () => {
    seedStore(makeNodes(), 'pg-a');
    render(<SidebarTree />);
    const row = screen.getByTestId('side-node-pg-a');
    fireEvent.contextMenu(row, { clientX: 300, clientY: 220 });

    const menu = screen.getByRole('menu', { name: '页面操作' });
    expect(within(menu).getByRole('menuitem', { name: '重命名' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '删除' })).toBeTruthy();
    const host = menu.parentElement as HTMLElement;
    expect(host.style.position).toBe('fixed');
    expect(host.style.left).toBe('300px');
    expect(host.style.top).toBe('220px');
  });

  it('Esc 关、点空白关（outside-close）', () => {
    seedStore(makeNodes(), 'pg-a');
    const { } = render(<SidebarTree />);
    fireEvent.contextMenu(screen.getByTestId('side-node-pg-a'), { clientX: 260, clientY: 180 });
    expect(screen.queryByRole('menu', { name: '页面操作' })).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('menu', { name: '页面操作' }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '页面操作' })).toBeNull();

    fireEvent.contextMenu(screen.getByTestId('side-node-pg-a'), { clientX: 260, clientY: 180 });
    expect(screen.queryByRole('menu', { name: '页面操作' })).not.toBeNull();
    fireEvent.click(document.body);
    expect(screen.queryByRole('menu', { name: '页面操作' })).toBeNull();
  });

  it('命中子控件（⋯ 钮 / 折叠钮）不弹菜单', () => {
    seedStore(makeNodes(), 'pg-a');
    render(<SidebarTree />);
    fireEvent.contextMenu(screen.getByTestId('side-more-pg-a'), { clientX: 100, clientY: 40 });
    expect(screen.queryByRole('menu', { name: '页面操作' })).toBeNull();

    const caret = screen.getByTestId('side-node-pg-a').querySelector('.app-nav-tw') as HTMLElement;
    fireEvent.contextMenu(caret, { clientX: 100, clientY: 40 });
    expect(screen.queryByRole('menu', { name: '页面操作' })).toBeNull();
  });

  it('右键菜单选「重命名」同样进入行内编辑态（同一 onSelect）', () => {
    seedStore(makeNodes(), 'pg-a');
    render(<SidebarTree />);
    fireEvent.contextMenu(screen.getByTestId('side-node-pg-a'), { clientX: 300, clientY: 220 });
    fireEvent.click(within(screen.getByRole('menu', { name: '页面操作' })).getByRole('menuitem', { name: '重命名' }));
    expect(pagesStore.getState().editingId).toBe('pg-a');
    expect(screen.getByTestId('side-rename-input')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ⑦ 通知 3 秒自动关闭
// ---------------------------------------------------------------------------

const toastMessages = (): string[] => pagesStore.getState().toasts.map((toast) => toast.message);

describe('T60-01 ⑦ 所有通知 3000ms 自动关闭', () => {
  it('口径常量 = 3000；2999ms 仍在、3001ms 消失（danger 不例外）', () => {
    vi.useFakeTimers();
    expect(TOAST_AUTO_DISMISS_MS).toBe(3000);
    seedStore(makeNodes(), 'pg-a');

    pushToast('转换完成', 'success');
    pushToast('出错了', 'danger');
    expect(toastMessages()).toEqual(['转换完成', '出错了']);

    vi.advanceTimersByTime(2999);
    expect(toastMessages()).toEqual(['转换完成', '出错了']);

    vi.advanceTimersByTime(2);
    expect(toastMessages()).toEqual([]);
  });

  it('多条各自独立计时（先入队的先到点）', () => {
    vi.useFakeTimers();
    seedStore(makeNodes(), 'pg-a');

    pushToast('第一条', 'info');
    vi.advanceTimersByTime(1000);
    pushToast('第二条', 'info');

    vi.advanceTimersByTime(2000); // 第一条到点（3000），第二条仅 2000
    expect(toastMessages()).toEqual(['第二条']);

    vi.advanceTimersByTime(1001);
    expect(toastMessages()).toEqual([]);
  });

  it('手动关闭清掉自己的定时器；队列上限淘汰的老条目到点不再出队（无重复/无泄漏）', () => {
    vi.useFakeTimers();
    seedStore(makeNodes(), 'pg-a');

    pushToast('手动关', 'info');
    const first = pagesStore.getState().toasts[0];
    expect(first).toBeDefined();
    pagesActions.dismissToast(first?.id ?? '');
    expect(toastMessages()).toEqual([]);
    vi.advanceTimersByTime(4000); // 已清的定时器不得再触发（无异常、无残留）
    expect(toastMessages()).toEqual([]);

    // 队列上限 3：第 4 条挤掉第 1 条 → 被挤掉的定时器清掉，留下的各自到点消失
    for (const message of ['a', 'b', 'c', 'd']) {
      pushToast(message, 'info');
    }
    expect(toastMessages()).toEqual(['b', 'c', 'd']);
    vi.advanceTimersByTime(3001);
    expect(toastMessages()).toEqual([]);
  });
});
