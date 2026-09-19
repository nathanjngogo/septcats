// @vitest-environment jsdom
/**
 * tabs.test.tsx —— 编辑区多页签（TASK-T37-01 §1 数值化验收的自动化面）。
 *
 * 覆盖：
 * - 纯函数：同页不重复开（openInTabs）、关标签相邻回落（closeTabFallback 右优先/左邻）、
 *   拖拽排序（moveTab）、存活裁剪（pruneTabs）、快捷键判定（tabsShortcutAction，
 *   含与 Ctrl+K 不冲突）、localStorage 读写（损坏/去重防御）；
 * - store 动作：三入口同页只落一个标签、关标签回落与全关、**关标签不触发
 *   pages.remove（不误删页面）**、持久化写入、load() 恢复（集合/顺序/选中项、
 *   裁剪已删页、全关记录不自动开页、无记录回落既有首屏选中）、deletePage 级联
 *   清标签、快捷键真实处理链（handleTabsKeydown + 合成事件）；
 * - TabsBar 组件：点击切换/× 关闭/中键关闭/拖拽排序落库持久化、改名实时刷新、
 *   空标题回退「未命名」、全关后 .pv-empty 空态出现、溢出滚动静态样式。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；localStorage 用 jsdom 原生实现
 * （浏览器同形 API，测试前清空）。
 */
import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { PageView } from '../src/renderer/src/pages/PageView';
import { TabsBar } from '../src/renderer/src/tabs/TabsBar';
import { handleTabsKeydown } from '../src/renderer/src/tabs/shortcuts';
import { pagesActions, pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import {
  closeTabFallback,
  moveTab,
  openInTabs,
  pruneTabs,
  readTabs,
  tabsShortcutAction,
  tabsStorageKey,
  writeTabs,
} from '../src/renderer/src/state/tabs';
import type { SeptcatsApi } from '../src/types/window';

const WS_ID = 'ws-tabs-test';

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

type Bridge = {
  remove: ReturnType<typeof vi.fn>;
  touch: ReturnType<typeof vi.fn>;
};

let nodesDb: PageNode[];
let bridge: Bridge;

function installBridge(): void {
  bridge = {
    remove: vi.fn(async ({ id }: { id: string }) => {
      // 真删（级联一层子树），保证 deletePage 后 refresh 对账拿到删后树
      nodesDb = nodesDb.filter((node) => node.id !== id && node.parentId !== id);
      return { deleted: 1 };
    }),
    touch: vi.fn(async () => ({ pageIds: [] })),
  };
  vi.stubGlobal('septcats', {
    workspaces: { list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }) },
    pages: {
      tree: async () => nodesDb.map((node) => ({ ...node, childIds: [...node.childIds] })),
      remove: bridge.remove,
      rename: vi.fn(async ({ id, title }: { id: string; title: string }) => {
        const node = nodesDb.find((item) => item.id === id);
        if (node !== undefined) {
          node.title = title;
        }
        return { id };
      }),
    },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: bridge.touch },
  } as unknown as SeptcatsApi);
}

function makeNodes(): PageNode[] {
  return [
    pageNode({ id: 'pg-a', title: '甲页', sortKey: 'A00000001' }),
    pageNode({ id: 'pg-b', title: '乙页', sortKey: 'A00000002' }),
    pageNode({ id: 'pg-c', title: '丙页', sortKey: 'A00000003' }),
  ];
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
    expanded: new Set<string>(),
    selectedId: null,
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    deleteConfirmId: null,
    tabs: [],
    ...extra,
  }));
}

beforeEach(() => {
  nodesDb = makeNodes();
  installBridge();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('纯函数（TASK-T37-01 §0.1/§0.2/§0.5）', () => {
  it('openInTabs：同页不重复（原引用），新页追加末尾', () => {
    const tabs = ['a', 'b'];
    const dup = openInTabs(tabs, 'a');
    expect(dup).toEqual({ tabs: ['a', 'b'], opened: false });
    expect(dup.tabs).toBe(tabs);
    expect(openInTabs(tabs, 'c')).toEqual({ tabs: ['a', 'b', 'c'], opened: true });
  });

  it('closeTabFallback：右邻优先 → 无右邻取左邻 → 全关 null；关非当前不动选中', () => {
    expect(closeTabFallback(['a', 'b', 'c'], 'b', 'b')).toEqual({ tabs: ['a', 'c'], activeId: 'c' });
    expect(closeTabFallback(['a', 'b'], 'b', 'b')).toEqual({ tabs: ['a'], activeId: 'a' });
    expect(closeTabFallback(['a', 'b', 'c'], 'a', 'c')).toEqual({ tabs: ['b', 'c'], activeId: 'c' });
    expect(closeTabFallback(['a'], 'a', 'a')).toEqual({ tabs: [], activeId: null });
    expect(closeTabFallback(['a', 'b'], 'gone', 'b')).toEqual({ tabs: ['a', 'b'], activeId: 'b' });
  });

  it('moveTab：拖拽重排、未命中原样、越界夹紧', () => {
    expect(moveTab(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveTab(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a']);
    expect(moveTab(['a', 'b'], 'gone', 0)).toEqual(['a', 'b']);
  });

  it('pruneTabs：裁掉失效页签；选中被裁 → 锚位相邻回落', () => {
    expect(pruneTabs(['a', 'b', 'c'], new Set(['b']), 'a')).toEqual({ tabs: ['b'], activeId: 'b' });
    expect(pruneTabs(['a', 'b'], new Set(['a', 'b']), 'b')).toEqual({ tabs: ['a', 'b'], activeId: 'b' });
    expect(pruneTabs(['a', 'b'], new Set<string>(), 'b')).toEqual({ tabs: [], activeId: null });
  });

  it('tabsShortcutAction：Ctrl+W/Tab/1..9 命中；修饰键组合与 Ctrl+K 不冲突', () => {
    const base = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(tabsShortcutAction({ ...base, key: 'w' })).toBe('close');
    expect(tabsShortcutAction({ ...base, key: 'W' })).toBe('close');
    expect(tabsShortcutAction({ ...base, key: 'Tab' })).toBe('next');
    expect(tabsShortcutAction({ ...base, key: '5' })).toEqual({ index: 4 });
    expect(tabsShortcutAction({ ...base, key: '9' })).toEqual({ index: 8 });
    expect(tabsShortcutAction({ ...base, key: 'k' })).toBeNull();
    expect(tabsShortcutAction({ ...base, key: '0' })).toBeNull();
    expect(tabsShortcutAction({ ...base, key: 'w', shiftKey: true })).toBeNull();
    expect(tabsShortcutAction({ ...base, key: 'w', altKey: true })).toBeNull();
    expect(tabsShortcutAction({ key: 'w', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBeNull();
    expect(tabsShortcutAction({ key: 'Tab', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe('next');
  });

  it('writeTabs/readTabs：往返一致；损坏 JSON/版本不符 → null；保存侧去重', () => {
    writeTabs(WS_ID, ['b', 'a'], 'a');
    expect(readTabs(WS_ID)).toEqual({ v: 1, tabs: ['b', 'a'], activeId: 'a' });
    window.localStorage.setItem(tabsStorageKey(WS_ID), '{broken');
    expect(readTabs(WS_ID)).toBeNull();
    window.localStorage.setItem(tabsStorageKey(WS_ID), JSON.stringify({ v: 2, tabs: [], activeId: null }));
    expect(readTabs(WS_ID)).toBeNull();
    window.localStorage.setItem(
      tabsStorageKey(WS_ID),
      JSON.stringify({ v: 1, tabs: ['a', 'a', 'b'], activeId: 'a' }),
    );
    expect(readTabs(WS_ID)?.tabs).toEqual(['a', 'b']);
    expect(readTabs('ws-none')).toBeNull();
  });
});

describe('store 动作（TASK-T37-01 §1.1/§1.3/§1.5/§1.6）', () => {
  it('同一页从 3 个入口打开 → 只产生 1 个标签且被选中', () => {
    seedStore();
    // 模拟侧栏点击 / 搜索命中 / 模板新建选中三个入口（都汇聚到 openInTab）
    pagesActions.openInTab('pg-a');
    pagesActions.openInTab('pg-a');
    pagesActions.selectPage('pg-a');
    expect(pagesStore.getState().tabs).toEqual(['pg-a']);
    expect(pagesStore.getState().selectedId).toBe('pg-a');
    pagesActions.openInTab('pg-b');
    pagesActions.openInTab('pg-c');
    expect(pagesStore.getState().tabs).toEqual(['pg-a', 'pg-b', 'pg-c']);
  });

  it('关当前标签回落右邻，无右邻取左邻；全关 selectedId=null 仍留在 pages 视图', () => {
    seedStore({ tabs: ['pg-a', 'pg-b', 'pg-c'], selectedId: 'pg-c' });
    pagesActions.closeTab('pg-c');
    expect(pagesStore.getState().selectedId).toBe('pg-b');
    seedStore({ tabs: ['pg-a', 'pg-b'], selectedId: 'pg-b' });
    pagesActions.closeTab('pg-b');
    expect(pagesStore.getState().selectedId).toBe('pg-a');
    pagesActions.closeTab('pg-a');
    const state = pagesStore.getState();
    expect(state.tabs).toEqual([]);
    expect(state.selectedId).toBeNull();
    expect(state.view).toBe('pages');
  });

  it('关标签不误删页面：pages.remove 不被调用、节点存活不变', () => {
    seedStore({ tabs: ['pg-a', 'pg-b'], selectedId: 'pg-b' });
    pagesActions.closeTab('pg-b');
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(nodesDb.filter((node) => node.alive === 1).map((node) => node.id)).toEqual(['pg-a', 'pg-b', 'pg-c']);
  });

  it('页签快照随动作持久化：打开/排序/关闭都写 localStorage（按 workspace 隔离键）', () => {
    seedStore();
    pagesActions.openInTab('pg-a');
    pagesActions.openInTab('pg-b');
    expect(readTabs(WS_ID)).toEqual({ v: 1, tabs: ['pg-a', 'pg-b'], activeId: 'pg-b' });
    pagesActions.moveTabTo('pg-b', 0);
    expect(readTabs(WS_ID)).toEqual({ v: 1, tabs: ['pg-b', 'pg-a'], activeId: 'pg-b' });
    pagesActions.closeTab('pg-b');
    expect(readTabs(WS_ID)).toEqual({ v: 1, tabs: ['pg-a'], activeId: 'pg-a' });
    // 其他 workspace 键不受影响
    expect(window.localStorage.getItem(tabsStorageKey('ws-other'))).toBeNull();
  });

  it('load() 恢复：集合+顺序+当前选中项全还原', async () => {
    writeTabs(WS_ID, ['pg-c', 'pg-a'], 'pg-a');
    seedStore({ status: 'loading', nodes: [], workspaceId: null, workspaces: [] });
    await pagesActions.load();
    const state = pagesStore.getState();
    expect(state.tabs).toEqual(['pg-c', 'pg-a']);
    expect(state.selectedId).toBe('pg-a');
  });

  it('load() 裁剪已删除页签，选中项锚位回落到存活页', async () => {
    writeTabs(WS_ID, ['pg-a', 'pg-gone'], 'pg-gone');
    seedStore({ status: 'loading', nodes: [], workspaceId: null, workspaces: [] });
    await pagesActions.load();
    expect(pagesStore.getState().tabs).toEqual(['pg-a']);
    expect(pagesStore.getState().selectedId).toBe('pg-a');
  });

  it('load() 遇「全关」记录保持空集合，不自动开页；无记录才走既有首屏选中', async () => {
    writeTabs(WS_ID, [], null);
    seedStore({ status: 'loading', nodes: [], workspaceId: null, workspaces: [] });
    await pagesActions.load();
    expect(pagesStore.getState().tabs).toEqual([]);
    expect(pagesStore.getState().selectedId).toBeNull();

    window.localStorage.clear();
    seedStore({ status: 'loading', nodes: [], workspaceId: null, workspaces: [] });
    await pagesActions.load();
    expect(pagesStore.getState().tabs).toEqual(['pg-a']);
    expect(pagesStore.getState().selectedId).toBe('pg-a');
  });

  it('deletePage 级联清标签（含子树），选中项相邻回落；remove 只因删除发起', async () => {
    nodesDb = [
      pageNode({ id: 'pg-a', title: '甲', childIds: ['pg-kid'] }),
      pageNode({ id: 'pg-kid', title: '子', parentId: 'pg-a', sortKey: 'A00000002' }),
      pageNode({ id: 'pg-b', title: '乙', sortKey: 'A00000003' }),
    ];
    seedStore({ tabs: ['pg-b', 'pg-a', 'pg-kid'], selectedId: 'pg-a' });
    await pagesActions.deletePage('pg-a');
    expect(bridge.remove).toHaveBeenCalledWith({ id: 'pg-a' });
    expect(pagesStore.getState().tabs).toEqual(['pg-b']);
    expect(pagesStore.getState().selectedId).toBe('pg-b');
  });

  it('handleTabsKeydown：Ctrl+W 关当前（回落右邻）、Ctrl+Tab 下一个循环、Ctrl+2 跳第 2 个、门禁拦截', () => {
    seedStore({ tabs: ['pg-a', 'pg-b', 'pg-c'], selectedId: 'pg-a' });
    const make = (key: string, overrides?: Partial<KeyboardEvent>): KeyboardEvent =>
      ({
        key,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        ...overrides,
      }) as unknown as KeyboardEvent;

    // Ctrl+W：关当前 pg-a → 右邻 pg-b
    expect(handleTabsKeydown(make('w'), { editorVisible: true })).toBe(true);
    expect(pagesStore.getState().selectedId).toBe('pg-b');
    expect(pagesStore.getState().tabs).toEqual(['pg-b', 'pg-c']);
    // Ctrl+Tab：pg-b → pg-c
    expect(handleTabsKeydown(make('Tab'), { editorVisible: true })).toBe(true);
    expect(pagesStore.getState().selectedId).toBe('pg-c');
    // Ctrl+Tab 循环回首个
    expect(handleTabsKeydown(make('Tab'), { editorVisible: true })).toBe(true);
    expect(pagesStore.getState().selectedId).toBe('pg-b');
    // Ctrl+2：第 2 个 = pg-c；Ctrl+9 超出夹到最后
    expect(handleTabsKeydown(make('2'), { editorVisible: true })).toBe(true);
    expect(pagesStore.getState().selectedId).toBe('pg-c');
    expect(handleTabsKeydown(make('9'), { editorVisible: true })).toBe(true);
    expect(pagesStore.getState().selectedId).toBe('pg-c');
    // 门禁：编辑器不可见不消费；无页签不消费
    expect(handleTabsKeydown(make('w'), { editorVisible: false })).toBe(false);
    seedStore({ tabs: [], selectedId: null });
    expect(handleTabsKeydown(make('w'), { editorVisible: true })).toBe(false);
  });
});

describe('TabsBar 组件（TASK-T37-01 §0.2/§0.6/§1.2）', () => {
  it('渲染页签：当前标签高亮、点击切换（走 openInTab）', () => {
    seedStore({ tabs: ['pg-a', 'pg-b'], selectedId: 'pg-b' });
    render(<TabsBar />);
    const tabA = screen.getByTestId('tab-pg-a');
    expect(tabA.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('tab-pg-b').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.tabsbar-tab--active')).not.toBeNull();
    fireEvent.click(tabA);
    expect(pagesStore.getState().selectedId).toBe('pg-a');
    expect(pagesStore.getState().tabs).toEqual(['pg-a', 'pg-b']);
  });

  it('× 关闭与中键关闭都只关标签不删页', () => {
    seedStore({ tabs: ['pg-a', 'pg-b'], selectedId: 'pg-a' });
    render(<TabsBar />);
    fireEvent.click(screen.getByTestId('tab-close-pg-b'));
    expect(pagesStore.getState().tabs).toEqual(['pg-a']);
    expect(bridge.remove).not.toHaveBeenCalled();

    // 中键关闭（重新挂载恢复 pg-b 标签）；RTL 10 无 fireEvent.auxClick，走原生 auxclick
    cleanup();
    seedStore({ tabs: ['pg-a', 'pg-b'], selectedId: 'pg-a' });
    render(<TabsBar />);
    fireEvent(
      screen.getByTestId('tab-pg-b'),
      new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }),
    );
    expect(pagesStore.getState().tabs).toEqual(['pg-a']);
    expect(pagesStore.getState().selectedId).toBe('pg-a');
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it('拖拽排序生效且顺序被持久化', () => {
    seedStore({ tabs: ['pg-a', 'pg-b', 'pg-c'], selectedId: 'pg-a' });
    render(<TabsBar />);
    fireEvent.dragStart(screen.getByTestId('tab-pg-a'));
    const target = screen.getByTestId('tab-pg-c');
    fireEvent.dragOver(target);
    // jsdom/RTL 的 drop 事件不带坐标：手动构造带 clientX 的 drop（落在「丙页」右半 → 插到其后）
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dropEvent, 'clientX', { value: 50 });
    fireEvent(target, dropEvent);
    expect(pagesStore.getState().tabs).toEqual(['pg-b', 'pg-c', 'pg-a']);
    expect(readTabs(WS_ID)?.tabs).toEqual(['pg-b', 'pg-c', 'pg-a']);
    expect(pagesStore.getState().selectedId).toBe('pg-a');
  });

  it('标题实时跟随改名；空标题回退「未命名」', async () => {
    seedStore({ tabs: ['pg-a', 'pg-b'], selectedId: 'pg-a' });
    render(<TabsBar />);
    expect(screen.getByTestId('tab-pg-a').textContent).toContain('甲页');
    await pagesActions.renamePage('pg-a', '改名后的页');
    await waitFor(() => expect(screen.getByTestId('tab-pg-a').textContent).toContain('改名后的页'));
    nodesDb = [pageNode({ id: 'pg-a', title: '' })];
    act(() => {
      seedStore({ tabs: ['pg-a'], selectedId: 'pg-a', nodes: nodesDb });
    });
    expect(screen.getByTestId('tab-pg-a').textContent).toContain('未命名');
  });

  it('全关后标签条不渲染，编辑区走既有 .pv-empty 空态', () => {
    seedStore({ tabs: [], selectedId: null });
    render(
      <div className="app-editor-col">
        <TabsBar />
        <PageView />
      </div>,
    );
    expect(screen.queryByTestId('tabsbar')).toBeNull();
    expect(document.querySelector('.pv-empty')).not.toBeNull();
  });

  it('溢出横向滚动不换行（静态样式契约）', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // vitest jsdom 环境下 import.meta.url 非 file scheme，用进程 cwd（apps/desktop）定位
    const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'tabs', 'TabsBar.css'), 'utf8');
    expect(css).toMatch(/\.tabsbar\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.tabsbar\s*\{[^}]*white-space:\s*nowrap/);
    // token 纪律：无字面 hex、过渡走 motion-fast
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toContain('var(--sc-motion-fast)');
  });
});
