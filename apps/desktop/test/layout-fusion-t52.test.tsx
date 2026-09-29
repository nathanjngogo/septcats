// @vitest-environment jsdom
/**
 * layout-fusion-t52.test.tsx —— TASK-T52-01 布局融合三件的自动化面（jsdom 侧）。
 *
 * 覆盖（对应任务书 §1/§2 的层测可断言面；真机数值由 docs/mockups/cdp-e2e-t52-01.mjs 覆盖）：
 * - ① 侧栏通高：AppShell.css 结构契约 —— `.sc-shell__sidebar` 跨两行（grid-row: 1 / 3）、
 *     顶栏只占右列（grid-column: 2）、主区在右列第 2 行；折叠态三件套不回归（T30-01）。
 * - ② 折叠钮搬家：TabsBar 行宿主 `.app-tabrow` 总是渲染（给了插槽时），插槽是 `.tabsbar`
 *      的首个子元素（行最左）；布局隐藏标签条 / 无标签时行仍在 → 钮仍可达。
 * - ③ 标签条融合：`.tabsbar` 无整行硬分隔线（无 border-bottom）、活动标签 content 白底
 *      （与 .pv-root 同 token）、非活动标签沉 surface；插槽 sticky 不随横滚走。
 * - App 接线：编辑器视图挂 `.app-shell--fused`（顶栏同名钮由该类的 CSS 隐藏）+
 *   标签行内有且只有一个开合钮；切设置页后类摘除（顶栏钮回来）；无选中页时顶栏左端
 *   不再渲染「只剩工作区名」的兜底（§1.1 工作区名常驻侧栏头部）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；localStorage 用 jsdom 原生实现。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { App } from '../src/renderer/src/App';
import { TabsBar } from '../src/renderer/src/tabs/TabsBar';
import { aiChatActions } from '../src/renderer/src/ai/chatState';
import {
  LAYOUT_STORAGE_KEY,
  layoutActions,
  layoutStore,
  makeDefaultLayout,
} from '../src/renderer/src/layout/layoutState';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import type { AppSettings } from '../src/shared/settings';
import type { SeptcatsApi } from '../src/types/window';

// jsdom 未实现的浏览器 API（layout-ui / page-delete-ui 同款）
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

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER_SRC = join(here, '..', 'src', 'renderer', 'src');
const UI_SRC = join(here, '..', '..', '..', 'packages', 'ui', 'src');

const read = (path: string): string => readFileSync(path, 'utf8');

/** 取 `selector { ... }` 规则体（单选择器规则；与 layout-invariants 同范式）。 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

const appShellCss = read(join(UI_SRC, 'AppShell.css'));
const appCss = read(join(RENDERER_SRC, 'App.css'));
const tabsCss = read(join(RENDERER_SRC, 'tabs', 'TabsBar.css'));

const WS_ID = 'ws-t52-test';

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
    nodes: [pageNode({ id: 'pg-1', title: '研究' })],
    expanded: new Set<string>(),
    selectedId: 'pg-1',
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    deleteConfirmId: null,
    ...extra,
  }));
}

function defaultSettings(): AppSettings {
  return {
    theme: 'system',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    trayClose: 'ask',
    data: { note: '~/.septcats' },
    sync: { enabled: true, encrypt: false, gc: false, folder: '' },
    ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] },
  };
}

function installAppBridge(): void {
  vi.stubGlobal('septcats', {
    workspaces: { list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }) },
    pages: { tree: async () => [pageNode({ id: 'pg-1', title: '研究' })] },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: vi.fn(async () => ({ pageIds: [] })) },
    blocks: { list: vi.fn(async () => ({ locked: false, blocks: [] })), commit: vi.fn() },
    db: { create: vi.fn(), load: vi.fn() },
    settings: {
      get: vi.fn(async () => defaultSettings()),
      patch: vi.fn(async (p: Partial<AppSettings>) => ({ ...defaultSettings(), ...p })),
    },
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
    ai: {
      state: vi.fn(async () => ({ enabled: false, cloudConsent: false, activeProviderId: null, providers: [] })),
    },
    templates: { list: vi.fn(async () => ({ templates: [] })) },
    appMeta: vi.fn(async () => ({ name: 'Septcats', version: '0.0.0', schemaVersion: 1, layoutRoot: '.septcats' })),
    update: { onState: vi.fn(() => () => {}) },
    menu: { onAction: vi.fn(() => () => {}) },
    // T54-01：App 挂载订阅关窗询问（假桥给退订函数 + 决议桩）
    close: { onFlushRequest: vi.fn(() => () => {}), flushAck: vi.fn(), onAsk: vi.fn(() => () => {}), decide: vi.fn() },
  } as unknown as SeptcatsApi);
}

beforeEach(() => {
  window.localStorage.clear();
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  layoutActions.init();
  aiChatActions.setOpen(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// ① 侧栏通高 / 顶栏只覆盖右侧（结构契约）
// ---------------------------------------------------------------------------

describe('T52-01 ① 侧栏通高 + 顶栏不再通栏（AppShell.css 结构契约）', () => {
  it('侧栏跨满两行（grid-row: 1 / 3）；顶栏只占右列第 1 行；主区在右列第 2 行', () => {
    const sidebar = ruleBody(appShellCss, '.sc-shell__sidebar');
    expect(sidebar, '侧栏缺跨行约束（通高到原生菜单下沿）').toContain('grid-row: 1 / 3');
    expect(sidebar).toContain('grid-column: 1');

    const topbar = ruleBody(appShellCss, '.sc-shell__topbar');
    expect(topbar, '顶栏仍通栏（必须只覆盖右侧主区列）').toContain('grid-column: 2');
    expect(topbar).toContain('grid-row: 1');

    const main = ruleBody(appShellCss, '.sc-shell__main');
    expect(main).toContain('grid-column: 2');
    expect(main).toContain('grid-row: 2');
  });

  it('body 网格两行 = 顶栏行高 + 1fr（高度链闭合：窗口零滚动的前提）', () => {
    const body = ruleBody(appShellCss, '.sc-shell__body');
    expect(body).toContain('grid-template-rows: var(--sc-layout-topbar) 1fr');
    expect(body).toContain('min-height: 0');
  });

  it('折叠态不回归（T30-01 红线，T95-01 换实现）：侧栏宽度归零 + visibility:hidden', () => {
    // T95-01：折叠从「删列 + display:none」改为「列宽归零 + visibility:hidden」——
    // 列结构保留后，顶栏/主区**不必**再显式落回第 1 列（那是删列时代的补丁），
    // 因此也不会再有「只回一个子项 → 隐式列把主区挤窄」的旧事故形态。
    const collapsedSidebar = ruleBody(appShellCss, '.sc-shell--collapsed .sc-shell__sidebar');
    expect(collapsedSidebar, '折叠态侧栏必须退出 tab 序').toContain('visibility: hidden');
    expect(collapsedSidebar, '不再硬切（弹簧需要列结构在场）').not.toContain('display: none');
    expect(ruleBody(appShellCss, '.sc-shell--collapsed .sc-shell__body')).toMatch(/--sc-shell-sidebar-w:\s*0px/);
    expect(appShellCss, '折叠态不应再改写顶栏/主区列号').not.toMatch(
      /\.sc-shell--collapsed\s+\.sc-shell__(main|topbar)\s*\{[^}]*grid-column:\s*1/,
    );
  });

  it('侧栏头与顶栏同高（两列 chrome 面横向分界对齐）', () => {
    expect(ruleBody(appCss, '.app-side-head')).toContain('height: var(--sc-layout-topbar)');
  });
});

// ---------------------------------------------------------------------------
// ② 折叠钮搬家（标签条行最左插槽）
// ---------------------------------------------------------------------------

describe('T52-01 ② 折叠钮搬到标签条行最左（TabsBar 插槽契约）', () => {
  it('有标签时：插槽是 .tabsbar 的首个子元素（= 行最左，标签横滚不挤走）', () => {
    resetPagesStore({ tabs: ['pg-1'] });
    const { container } = render(
      <TabsBar leading={<button type="button" data-testid="probe-toggle" />} />,
    );
    const tabsbar = container.querySelector('.tabsbar');
    expect(tabsbar).not.toBeNull();
    expect(tabsbar?.firstElementChild?.querySelector('[data-testid="probe-toggle"]')).not.toBeNull();
    expect(ruleBody(tabsCss, '.tabsbar-leading')).toContain('position: sticky');
  });

  it('布局隐藏标签条时：行与插槽仍在（收起态钮可达），但 .tabsbar 不渲染（T37/T39 口径不变）', () => {
    resetPagesStore({ tabs: ['pg-1'] });
    const { container } = render(
      <TabsBar showTabs={false} leading={<button type="button" data-testid="probe-toggle" />} />,
    );
    expect(container.querySelector('.tabsbar')).toBeNull();
    expect(container.querySelector('.app-tabrow')).not.toBeNull();
    expect(container.querySelector('[data-testid="probe-toggle"]')).not.toBeNull();
  });

  it('全关且无插槽：不渲染任何行（既有「全关后标签条不渲染」口径保持）', () => {
    resetPagesStore({ tabs: [] });
    const { container } = render(<TabsBar />);
    expect(container.querySelector('.app-tabrow')).toBeNull();
    expect(container.querySelector('.tabsbar')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ③ 标签条与编辑区融合（背景/分隔线契约）
// ---------------------------------------------------------------------------

describe('T52-01 ③ 标签条并入编辑区（无整行分隔线 + 活动标签连通）', () => {
  it('标签行去掉了横贯整行的硬分隔线（.tabsbar 无 border-bottom）', () => {
    const tabsbar = ruleBody(tabsCss, '.tabsbar');
    expect(tabsbar, '标签行与编辑区之间不得有整行分隔线').not.toContain('border-bottom');
    // 横滚契约保持（T37）
    expect(tabsbar).toContain('overflow-x: auto');
    expect(tabsbar).toContain('white-space: nowrap');
  });

  it('活动标签 = content 白底（与 .pv-root 同 token → 连通无缝）；非活动沉 surface', () => {
    expect(tabsCss).toMatch(/\.tabsbar-tab--active[^{]*\{[^}]*background:\s*var\(--sc-color-content\)/);
    expect(ruleBody(tabsCss, '.tabsbar-tab')).toContain('background: var(--sc-color-surface)');
    // 编辑区根与活动标签同 token（层测拿不到 computed，真机数值由 cdp-e2e-t52-01.mjs 断言）
    const pvRoot = read(join(RENDERER_SRC, 'pages', 'PageView.css'));
    expect(ruleBody(pvRoot, '.pv-root')).toContain('background: var(--sc-color-content)');
  });

  it('行宿主 .app-tabrow 走 canvas + 定高（高度链 flex:none，不吃 1fr 余量）', () => {
    const row = ruleBody(tabsCss, '.app-tabrow');
    expect(row).toContain('flex: none');
    expect(row).toContain('background: var(--sc-color-canvas)');
    expect(row).toContain('height: calc(var(--sc-size-control-sm) + var(--sc-space-sm))');
  });
});

// ---------------------------------------------------------------------------
// ④ T59-01 追加：像素边框（2px ink-edge）下的骑缝融合
//    T52 §1.3「标签与正文连通、无隔离带」在本单不能破：正文顶边新增 2px 描边后，
//    活动标签必须下沉压住它（接缝只在此处断开），否则老板一眼看到破相。
// ---------------------------------------------------------------------------

describe('T59-01 追加：正文顶边描边 + 活动标签骑缝融合（T52 红线延续）', () => {
  it('正文顶边 = `.pv-root` 的 border-top 2px ink-edge；标签条与行宿主不得再画（只画一次）', () => {
    const pvRoot = ruleBody(appCss, '.app-editor-col .pv-root');
    expect(pvRoot, '正文顶边缺 2px ink-edge').toContain('border-top: var(--sc-border-edge)');
    expect(ruleBody(tabsCss, '.app-tabrow'), '行宿主补了下描边 → 与正文顶边叠成 4px').not.toContain('border-bottom');
    expect(ruleBody(tabsCss, '.tabsbar'), '标签条补了下描边 → 破「无整行分隔线」').not.toContain('border-bottom');
  });

  it('活动标签下沉 2px 压住该描边（探出带 = 裁剪安全带），下缘无边 → 接缝在活动标签处断开', () => {
    const tabsbar = ruleBody(tabsCss, '.tabsbar');
    expect(tabsbar, '标签条盒未探出行底 → 压缝的 2px 会被 overflow 剪掉').toContain(
      'height: calc(100% + var(--sc-space-xxs))',
    );
    expect(tabsbar, '探出的 2px 必须划进 padding 安全带').toContain('padding-bottom: var(--sc-space-xxs)');
    expect(tabsCss).toMatch(
      /\.tabsbar-tab--active[^{]*\{[^}]*margin-bottom:\s*calc\(var\(--sc-space-xxs\) \* -1\)/,
    );
    expect(tabsCss).toMatch(/\.tabsbar-tab--active[^{]*\{[^}]*border-top:\s*var\(--sc-border-edge\)/);
    expect(tabsCss).toMatch(/\.tabsbar-tab--active[^{]*\{[^}]*border-right:\s*var\(--sc-border-edge\)/);
    expect(tabsCss, '活动标签下缘必须留空（下缘无缝）').not.toMatch(
      /\.tabsbar-tab--active[^{]*\{[^}]*border-bottom:/,
    );
  });

  it('非活动标签只吃左描边（相邻两枚之间恰好 2px，不叠成 4px 粗缝）', () => {
    const tab = ruleBody(tabsCss, '.tabsbar-tab');
    expect(tab).toContain('border-left: var(--sc-border-edge)');
    expect(tab).not.toMatch(/border-right:\s*[1-9]/);
  });
});

// ---------------------------------------------------------------------------
// App 接线
// ---------------------------------------------------------------------------

describe('T52-01 App 接线（编辑器视图搬家 + 设置页顶栏钮保留）', () => {
  it('编辑器视图：挂 .app-shell--fused、开合钮落在标签条行内且全页只有一个；切设置页类摘除', async () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
    installAppBridge();
    resetPagesStore({ tabs: ['pg-1'] });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());

    expect(container.querySelector('.sc-shell')?.className).toContain('app-shell--fused');
    const toggle = container.querySelector('[data-testid="side-toggle"]');
    expect(toggle, '标签条行缺侧栏开合钮').not.toBeNull();
    expect(container.querySelector('.tabsbar')?.contains(toggle)).toBe(true);
    expect(container.querySelectorAll('[data-testid="side-toggle"]').length).toBe(1);
    // 顶栏仍在（右侧功能区），其自带开合钮由 .app-shell--fused 的 CSS 契约隐藏
    expect(container.querySelector('.sc-shell__topbar')).not.toBeNull();
    expect(container.querySelector('.sc-shell__topbar .sc-iconbtn')).not.toBeNull();

    // 设置页：编辑器分支不渲染 → 类摘除（顶栏钮即唯一入口）
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    await waitFor(() =>
      expect(container.querySelector('.sc-shell')?.className).not.toContain('app-shell--fused'),
    );
    expect(container.querySelector('[data-testid="side-toggle"]')).toBeNull();
  });

  it('§1.1：工作区名常驻侧栏头部；无选中页时顶栏左端不再重复渲染工作区名', async () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
    installAppBridge();
    resetPagesStore({ tabs: ['pg-1'] });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.app-side-head')).not.toBeNull());

    // 侧栏头部 = 侧栏内首个行（工作区名就位在通高侧栏最上一行）
    const head = container.querySelector('.app-side > .app-side-head');
    expect(head).not.toBeNull();
    expect(head?.parentElement?.firstElementChild).toBe(head);
    expect(container.querySelector('[data-testid="side-ws-head"]')?.textContent).toContain('个人工作区');
    // 选中页时顶栏是「页面路径」面包屑（不是工作区名）
    expect(container.querySelector('.sc-shell__crumb')?.textContent).toContain('研究');

    act(() => {
      pagesStore.setState((state) => ({ ...state, selectedId: null }));
    });
    await waitFor(() => expect(container.querySelector('.sc-shell__crumb')?.textContent).toBe(''));
  });
});
