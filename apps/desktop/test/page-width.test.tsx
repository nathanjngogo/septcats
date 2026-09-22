// @vitest-environment jsdom
/**
 * page-width.test.tsx —— 页面级「全宽 / 固定宽度」开关（TASK-T41-01 §1/§2 自动化面）。
 *
 * 覆盖：
 * - 持久化纯函数：键格式（septcats.pagewidth.<ws>）、读写往返、损坏 JSON/版本不符 → null、
 *   去重防御、workspaceId=null 不写盘；
 * - store 动作：syncWorkspace 读盘还原（无记录 → 空集 = 全部固定宽度）、toggle 翻转 +
 *   立即写盘、**每页独立**（A 全宽 B 固定互不影响）、工作区隔离（各还原各的、
 *   切走再切回不丢）、localStorage 缺失时仅会话内生效；
 * - PageView 接线：默认固定（.pv-root 无 data-measure）、toggle 后 data-measure='full'、
 *   换页（pg-2 固定）互不串、**静态 CSS 契约**（只放开 .pv-body，标题行/其它规则
 *   不进 [data-measure='full'] 作用域；零量测零内联宽高）；
 * - 侧栏 ⋯ 菜单：菜单项显示当前页状态（固定宽度 / ✓ 全宽）、点击切换并落盘、
 *   每页各自显示各自状态；T41-01-1：DB 页菜单**不含**全宽项（无效控件隐藏），
 *   wiki 页/普通页仍含；
 * - 命令面板：toggleFullWidth 注入 → 命令出现且 run 调用；无选中页 configure 摘除。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥（pageview-blocks-ui.test.tsx 同款）；
 * clientWidth 数值验收（固定=measure 值、全宽=容器宽）属真机量化项，由 PM 复跑。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block, PageNode } from '@septcats/editor';
import { PageView } from '../src/renderer/src/pages/PageView';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import {
  PAGE_WIDTH_PERSIST_VERSION,
  PAGE_WIDTH_STORAGE_PREFIX,
  pageWidthActions,
  pageWidthStorageKey,
  pageWidthStore,
  readPageWidths,
  writePageWidths,
} from '../src/renderer/src/state/pageWidth';
import { bindPaletteCommands, configurePaletteCommands } from '../src/renderer/src/palette/commands';
import type { SeptcatsApi } from '../src/types/window';

const WS_ID = 'ws-pagewidth-test';

// ---------------------------------------------------------------------------
// 桥接桩（pageview-blocks-ui.test.tsx / sidebar-tree.test.tsx 同款）
// ---------------------------------------------------------------------------

function makeBlock(id: string, sortKey: string, text: string): Block {
  return {
    id,
    page_id: 'pg-1',
    type: 'paragraph',
    props: {},
    content:
      text.length > 0
        ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
        : null,
    parent_id: null,
    sort_key: sortKey,
    alive: 1,
    version: 1,
    last_edited: 0,
  };
}

function makeEditorBridge() {
  return {
    blocks: {
      commit: vi.fn().mockResolvedValue(0),
      list: vi.fn().mockResolvedValue([makeBlock('blk-1', 'A00000000', '第一段')]),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    recent: {
      touch: vi.fn().mockResolvedValue({ pageIds: [] }),
      list: vi.fn().mockResolvedValue({ pageIds: [] }),
    },
    workspaces: {
      list: vi.fn().mockResolvedValue({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    collab: {
      attach: vi.fn().mockResolvedValue({ entries: [], ledgerHasCrdt: false }),
      apply: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
      onUpdate: vi.fn().mockReturnValue(() => {}),
    },
  };
}

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
    pageNode({ id: 'pg-a', title: '甲页', sortKey: 'A00000001' }),
    pageNode({ id: 'pg-b', title: '乙页', sortKey: 'A00000002' }),
  ];
}

function seedPagesStore(extra?: Partial<PagesState>): void {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: WS_ID,
    workspaces: [{ id: WS_ID, name: '个人工作区' }],
    nodes: makeNodes(),
    expanded: new Set<string>(),
    selectedId: 'pg-a',
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
  vi.stubGlobal('septcats', makeEditorBridge() as unknown as SeptcatsApi);
  window.localStorage.clear();
  pageWidthStore.setState(() => ({ workspaceId: null, full: new Set<string>() }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 持久化纯函数
// ---------------------------------------------------------------------------

describe('持久化（TASK-T41-01 §1.4，septcats.tabs.<ws> 同范式）', () => {
  it('键格式 = septcats.pagewidth.<workspaceId>；读写往返一致', () => {
    expect(pageWidthStorageKey(WS_ID)).toBe(PAGE_WIDTH_STORAGE_PREFIX + WS_ID);
    writePageWidths(WS_ID, new Set(['pg-a', 'pg-b']));
    const raw = JSON.parse(window.localStorage.getItem(pageWidthStorageKey(WS_ID))!) as {
      v: number;
      full: string[];
    };
    expect(raw.v).toBe(PAGE_WIDTH_PERSIST_VERSION);
    expect(raw.full).toEqual(['pg-a', 'pg-b']);
    expect(readPageWidths(WS_ID)).toEqual(new Set(['pg-a', 'pg-b']));
  });

  it('损坏 JSON / 版本不符 / 形状不符 → null（调用方走「空集」分支）', () => {
    window.localStorage.setItem(pageWidthStorageKey(WS_ID), '{broken');
    expect(readPageWidths(WS_ID)).toBeNull();
    window.localStorage.setItem(pageWidthStorageKey(WS_ID), JSON.stringify({ v: 2, full: [] }));
    expect(readPageWidths(WS_ID)).toBeNull();
    window.localStorage.setItem(pageWidthStorageKey(WS_ID), JSON.stringify({ v: 1, full: 'pg-a' }));
    expect(readPageWidths(WS_ID)).toBeNull();
    expect(readPageWidths('ws-none')).toBeNull();
  });

  it('读侧去重防御；workspaceId=null 不写盘', () => {
    window.localStorage.setItem(
      pageWidthStorageKey(WS_ID),
      JSON.stringify({ v: 1, full: ['pg-a', 'pg-a', 'pg-b'] }),
    );
    expect(readPageWidths(WS_ID)).toEqual(new Set(['pg-a', 'pg-b']));
    writePageWidths(null, new Set(['pg-a']));
    expect(window.localStorage.getItem(PAGE_WIDTH_STORAGE_PREFIX)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// store 动作
// ---------------------------------------------------------------------------

describe('store 动作（每页独立 + 持久化 + 工作区隔离）', () => {
  it('syncWorkspace：无记录 → 空集（新页面默认固定宽度）；有记录 → 还原', () => {
    pageWidthActions.syncWorkspace(WS_ID);
    expect(pageWidthStore.getState().full.size).toBe(0);
    writePageWidths(WS_ID, new Set(['pg-a']));
    pageWidthActions.syncWorkspace(WS_ID);
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-a']));
    pageWidthActions.syncWorkspace(null);
    expect(pageWidthStore.getState().full.size).toBe(0);
  });

  it('toggle：翻转 + 立即写盘；A 全宽 B 固定互不影响（每页独立）', () => {
    pageWidthActions.syncWorkspace(WS_ID);
    pageWidthActions.toggle('pg-a');
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-a']));
    pageWidthActions.toggle('pg-b');
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-a', 'pg-b']));
    pageWidthActions.toggle('pg-a');
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-b']));
    expect(readPageWidths(WS_ID)).toEqual(new Set(['pg-b']));
  });

  it('重开还原（重启模拟）：toggle 后重新 syncWorkspace 各自保持', () => {
    pageWidthActions.syncWorkspace(WS_ID);
    pageWidthActions.toggle('pg-a'); // A 全宽
    // 模拟重启：store 清空 → 重新读盘
    pageWidthStore.setState(() => ({ workspaceId: null, full: new Set<string>() }));
    pageWidthActions.syncWorkspace(WS_ID);
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-a']));
  });

  it('工作区隔离：切走读别家记录、切回不丢；写入只落当前 workspace 键', () => {
    pageWidthActions.syncWorkspace(WS_ID);
    pageWidthActions.toggle('pg-a');
    writePageWidths('ws-other', new Set(['pg-x']));
    pageWidthActions.syncWorkspace('ws-other');
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-x']));
    pageWidthActions.syncWorkspace(WS_ID);
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-a']));
    expect(window.localStorage.getItem(pageWidthStorageKey('ws-other'))).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem(pageWidthStorageKey('ws-other'))!)).toEqual({
      v: 1,
      full: ['pg-x'],
    });
  });

  it('localStorage 不可用 → 静默降级：状态翻转仅会话内生效，不抛错', () => {
    pageWidthActions.syncWorkspace(null);
    expect(() => pageWidthActions.toggle('pg-a')).not.toThrow();
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-a']));
  });
});

// ---------------------------------------------------------------------------
// PageView 接线（§1.2 CSS 口径 + §1.1 每页独立）
// ---------------------------------------------------------------------------

describe('PageView 接线（data-measure 属性 + 静态 CSS 契约）', () => {
  it('默认固定宽度：.pv-root 无 data-measure；toggle 后 = full；换页互不串', async () => {
    pageWidthActions.syncWorkspace(WS_ID);
    const view = render(<PageView page={{ id: 'pg-a', title: '甲页' }} />);
    await screen.findByTestId('septcats-editor');
    const root = document.querySelector('.pv-root')!;
    expect(root.hasAttribute('data-measure')).toBe(false);

    act(() => {
      pageWidthActions.toggle('pg-a');
    });
    expect(root.getAttribute('data-measure')).toBe('full');

    // 换到 pg-b（未开全宽）→ 无属性；pg-a 的记录仍在（每页独立）
    view.rerender(<PageView page={{ id: 'pg-b', title: '乙页' }} />);
    await screen.findByTestId('septcats-editor');
    expect(document.querySelector('.pv-root')!.hasAttribute('data-measure')).toBe(false);
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-a']));

    view.rerender(<PageView page={{ id: 'pg-a', title: '甲页' }} />);
    await screen.findByTestId('septcats-editor');
    expect(document.querySelector('.pv-root')!.getAttribute('data-measure')).toBe('full');
  });

  it('静态 CSS 契约：[data-measure="full"] 穿透解除 .sc-editor/.pv-title-row + 本作用域 overflow-x:auto；固定态零横滚、零内联宽高', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(
      join(process.cwd(), 'src', 'renderer', 'src', 'pages', 'PageView.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    // T63-01 新口径：全宽作用域内同时解除正文列、内层编辑器外壳、标题行的 max-width
    expect(css).toMatch(/\.pv-root\[data-measure='full'\]\s+\.pv-body\s*\{[^}]*max-width:\s*none/);
    expect(css).toMatch(/\.pv-root\[data-measure='full'\]\s+\.sc-editor\s*\{[^}]*max-width:\s*none/);
    expect(css).toMatch(/\.pv-root\[data-measure='full'\]\s+\.pv-title-row\s*\{[^}]*max-width:\s*none/);
    // 全宽作用域根节点开启横向滚轴（窄窗兜底）
    expect(css).toMatch(/\.pv-root\[data-measure='full'\]\s*\{[^}]*overflow-x:\s*auto/);
    // 固定态（.pv-root 基础规则，无 data-measure）不得含任何横向滚动声明（红线：固定态零横滚）
    const baseRoot = /\.pv-root\s*\{([^}]*)\}/.exec(css);
    expect(baseRoot).not.toBeNull();
    expect(baseRoot![1]).not.toMatch(/overflow-x/);
    // 标题行基础规则仍走 measure（全宽作用域覆盖其上，二者不冲突）
    expect(css).toMatch(/\.pv-title-row\s*\{[^}]*max-width:\s*var\(--sc-layout-measure/);
    // token 纪律（限本次新增规则块）：无字面 hex、无裸 px
    const newRules = css.match(/\.pv-root\[data-measure='full'\][^{]*\{[^}]*\}/g) ?? [];
    expect(newRules.length).toBeGreaterThanOrEqual(4);
    for (const rule of newRules) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rule).not.toMatch(/\d+(?:\.\d+)?px/);
    }
  });
});

// ---------------------------------------------------------------------------
// 侧栏 ⋯ 菜单（§1.1 可切换 / 显示当前状态 / 有勾选态）
// ---------------------------------------------------------------------------

describe('侧栏行菜单（全宽 / 固定宽度）', () => {
  it('菜单项显示当前页状态；点击切换并落盘；勾选态随之变化；每页各自显示', () => {
    seedPagesStore();
    pageWidthActions.syncWorkspace(WS_ID);
    render(<SidebarTree />);

    fireEvent.click(screen.getByTestId('side-more-pg-a'));
    // 默认固定宽度（无勾选）
    expect(screen.getByRole('menuitem', { name: '固定宽度' })).not.toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: '固定宽度' }));
    expect(pageWidthStore.getState().full).toEqual(new Set(['pg-a']));
    expect(readPageWidths(WS_ID)).toEqual(new Set(['pg-a']));

    // 重开菜单 → 勾选态「✓ 全宽」
    fireEvent.click(screen.getByTestId('side-more-pg-a'));
    expect(screen.getByRole('menuitem', { name: '✓ 全宽' })).not.toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: '✓ 全宽' }));
    expect(pageWidthStore.getState().full.size).toBe(0);

    // 每页独立：A 全宽后 B 菜单仍显示「固定宽度」
    pageWidthActions.toggle('pg-a');
    fireEvent.click(screen.getByTestId('side-more-pg-b'));
    expect(screen.getByRole('menuitem', { name: '固定宽度' })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: '✓ 全宽' })).toBeNull();
  });

  // T41-01-1：全宽开关对 DB 页无视觉效果 → 菜单按 convertItem 同款条件构造隐藏
  it('DB 页的 ⋯ 菜单不含全宽项（删除项仍在）；wiki 页/普通页仍含该项', () => {
    seedPagesStore({
      nodes: [
        ...makeNodes(),
        { ...pageNode({ id: 'pg-db', title: '多维数据', sortKey: 'A00000003' }), pageType: 'database' },
        { ...pageNode({ id: 'pg-wiki', title: '研究 Wiki', sortKey: 'A00000004' }), pageType: 'wiki' },
      ],
    });
    pageWidthActions.syncWorkspace(WS_ID);
    render(<SidebarTree />);

    // DB 页：无「固定宽度 / ✓ 全宽」，菜单本身未被破坏（删除项仍在）
    fireEvent.click(screen.getByTestId('side-more-pg-db'));
    expect(screen.queryByRole('menuitem', { name: '固定宽度' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '✓ 全宽' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '删除' })).not.toBeNull();

    // wiki 页：仍含全宽项（菜单就地切换，DB 菜单已卸载）
    fireEvent.click(screen.getByTestId('side-more-pg-wiki'));
    expect(screen.getByRole('menuitem', { name: '固定宽度' })).not.toBeNull();

    // 普通页：仍含全宽项
    fireEvent.click(screen.getByTestId('side-more-pg-a'));
    expect(screen.getByRole('menuitem', { name: '固定宽度' })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 命令面板（§1.1 同名命令 + 条件命令门控）
// ---------------------------------------------------------------------------

describe('命令面板（page.toggleFullWidth）', () => {
  const baseDeps = {
    createPage: () => undefined,
    switchToNextWorkspace: () => undefined,
    openTrash: () => undefined,
    openSettings: () => undefined,
    notify: () => undefined,
    setThemeMode: () => undefined,
  };

  it('注入 toggleFullWidth → 命令出现且 run 调用', () => {
    const run = vi.fn();
    const commands = bindPaletteCommands({ ...baseDeps, toggleFullWidth: run });
    const command = commands.find((item) => item.id === 'page.toggleFullWidth');
    expect(command).toBeDefined();
    command!.run();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('无选中页 → configure 摘除（不出现、不抛错）；有选中页 → 保留', () => {
    const run = vi.fn();
    expect(
      configurePaletteCommands({ ...baseDeps, toggleFullWidth: run }, false).some(
        (item) => item.id === 'page.toggleFullWidth',
      ),
    ).toBe(false);
    expect(
      configurePaletteCommands({ ...baseDeps, toggleFullWidth: run }, true).some(
        (item) => item.id === 'page.toggleFullWidth',
      ),
    ).toBe(true);
  });

  it('英文别名 full / 拼音别名 quankuan 均可命中（rankCommands 打分面）', async () => {
    const { rankCommands } = await import('../src/renderer/src/palette/rank');
    const run = vi.fn();
    const commands = bindPaletteCommands({ ...baseDeps, toggleFullWidth: run });
    expect(rankCommands('full', commands)[0]?.id).toBe('page.toggleFullWidth');
    expect(rankCommands('quankuan', commands)[0]?.id).toBe('page.toggleFullWidth');
  });
});
