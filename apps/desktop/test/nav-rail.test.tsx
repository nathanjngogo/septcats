// @vitest-environment jsdom
/**
 * nav-rail.test.tsx —— T93-01 一级导航轨（NavRail）App 集成。
 *
 * 老板 09-29 令：「在左侧边栏再加一级侧边栏，用来区分笔记、知识库等一级菜单。」
 * 老板 09-30 令：「在知识库功能下方增加日历功能，增加待办功能」→ 一级轨变七项
 * （笔记/知识库/日历/待办/工作台/模板/回收站），日历与待办紧随知识库。
 *
 * 钉七件事：
 *  ① 一级轨在位：七项（含日历/待办，顺序紧随知识库），默认「笔记」当前；
 *  ② 二级栏分流：点「知识库」→ 二级栏换成库列表（kb-panel），点回「笔记」→ 页面树；
 *  ③ 点库条目 → 走既有 workspaces.switch 通道切库（不新造协议）；
 *  ④ 高亮单真源：工作台/模板/回收站三项由既有视图状态派生高亮；
 *  ⑤ 结构契约：一级轨不在 .sc-shell__sidebar 内（折叠二级栏不会把一级导航折掉）；
 *     分流选择持久化到 localStorage `septcats.nav.panel`；
 *  ⑦ 日历/待办两条新一级项：二级栏换各自的 side 面板、主区渲染各自页面、选择持久化、
 *     且与工作台/回收站互斥（切过去会退出那些视图）。
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { App } from '../src/renderer/src/App';
import { aiChatActions } from '../src/renderer/src/ai/chatState';
import { LAYOUT_STORAGE_KEY, layoutActions, layoutStore, makeDefaultLayout } from '../src/renderer/src/layout/layoutState';
import { navStore } from '../src/renderer/src/nav/navState';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import { workbenchActions } from '../src/renderer/src/workbench/state';
import type { AppSettings } from '../src/shared/settings';
import type { SeptcatsApi } from '../src/types/window';

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

const WS_ID = 'ws-nav-1';
const WS_ID_2 = 'ws-nav-2';
const NAV_PANEL_KEY = 'septcats.nav.panel';

function defaultSettings(): AppSettings {
  return {
    theme: 'system',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    trayClose: 'ask',
    data: { note: '~/.septcats' },
    sync: { enabled: false, encrypt: false, gc: false, folder: '' },
    ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] },
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

function resetPagesStore(extra?: Partial<PagesState>): void {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: WS_ID,
    workspaces: [
      { id: WS_ID, name: '笔记本库' },
      { id: WS_ID_2, name: '资料库' },
    ],
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

const bridge = {
  workspaces: {
    list: vi.fn(async () => ({
      items: [
        { id: WS_ID, name: '笔记本库' },
        { id: WS_ID_2, name: '资料库' },
      ],
      activeId: WS_ID,
    })),
    switch: vi.fn(async () => ({ ok: true })),
    create: vi.fn(async () => ({ id: 'ws-new' })),
    rename: vi.fn(async () => ({ ok: true })),
  },
};

function installAppBridge(): void {
  vi.stubGlobal('septcats', {
    ...bridge,
    pages: { tree: async () => [pageNode({ id: 'pg-1', title: '研究' })] },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: vi.fn(async () => ({ pageIds: [] })) },
    blocks: { list: vi.fn(async () => ({ locked: false, blocks: [] })), commit: vi.fn() },
    db: { create: vi.fn(), load: vi.fn() },
    settings: {
      get: vi.fn(async () => defaultSettings()),
      patch: vi.fn(async (p: Partial<AppSettings>) => ({ ...defaultSettings(), ...p })),
    },
    sync: { status: vi.fn(async () => null), onState: vi.fn(() => () => {}), now: vi.fn(async () => null), setEnabled: vi.fn() },
    collab: {
      attach: vi.fn(async () => ({ entries: [], ledgerHasCrdt: false })),
      detach: vi.fn(async () => ({})),
      apply: vi.fn(async () => ({})),
      onUpdate: vi.fn(() => () => {}),
    },
    ai: {
      state: vi.fn(async () => ({ enabled: false, cloudConsent: false, activeProviderId: null, providers: [] })),
      listModels: vi.fn(async () => ({ models: [], cached: false, fetchedAt: 1 })),
      chat: vi.fn(),
      setKey: vi.fn(),
      clearKey: vi.fn(),
    },
    templates: { list: vi.fn(async () => ({ templates: [] })) },
    appMeta: vi.fn(async () => ({ name: 'Septcats', version: '0.0.0', schemaVersion: 1, layoutRoot: '.septcats' })),
    update: { onState: vi.fn(() => () => {}) },
    menu: { onAction: vi.fn(() => () => {}) },
    close: { onFlushRequest: vi.fn(() => () => {}), flushAck: vi.fn(), onAsk: vi.fn(() => () => {}), decide: vi.fn() },
  } as unknown as SeptcatsApi);
}

beforeEach(() => {
  window.localStorage.clear();
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  pagesStore.setState((state) => ({ ...state, toasts: [] }));
  navStore.setState((state) => ({ ...state, panel: 'notes' }));
  workbenchActions.closeHome();
  layoutActions.init();
  aiChatActions.setOpen(false);
  bridge.workspaces.switch.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderApp(): Promise<HTMLElement> {
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
  installAppBridge();
  resetPagesStore({ tabs: ['pg-1'] });
  const { container } = render(<App />);
  await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());
  await waitFor(() => expect(container.querySelector('.pv-root')).not.toBeNull());
  return container;
}

function railItem(container: HTMLElement, key: string): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(`[data-testid="nav-rail-${key}"]`);
  expect(btn, `缺一级轨条目 ${key}`).not.toBeNull();
  return btn!;
}

describe('T93-01 一级导航轨（App 集成）', () => {
  it('① 一级轨在位：七项中文标签（含日历/待办），默认「笔记」为当前项（aria-current=page）', async () => {
    const container = await renderApp();
    const rail = container.querySelector('.sc-shell__rail');
    expect(rail, 'rail 未挂进 AppShell').not.toBeNull();

    const items = [...rail!.querySelectorAll('button')];
    expect(items.map((b) => (b.textContent ?? '').trim())).toEqual([
      '笔记',
      '知识库',
      '日历',
      '待办',
      '工作台',
      '模板',
      '回收站',
    ]);
    expect(railItem(container, 'notes').getAttribute('aria-current')).toBe('page');
    expect(railItem(container, 'kb').getAttribute('aria-current')).toBeNull();
  });

  it('② 二级栏分流：点「知识库」→ 库列表（kb-panel）；点回「笔记」→ 页面树', async () => {
    const container = await renderApp();
    expect(container.querySelector('[data-testid="kb-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="side-new-page"]')).not.toBeNull();

    fireEvent.click(railItem(container, 'kb'));
    await waitFor(() => expect(container.querySelector('[data-testid="kb-panel"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="kb-panel"]')?.textContent).toContain('笔记本库');
    expect(railItem(container, 'kb').getAttribute('aria-current')).toBe('page');
    // 持久化（重启后仍停在知识库这一级）
    expect(window.localStorage.getItem(NAV_PANEL_KEY)).toBe('kb');

    fireEvent.click(railItem(container, 'notes'));
    await waitFor(() => expect(container.querySelector('[data-testid="kb-panel"]')).toBeNull());
    expect(container.querySelector('[data-testid="side-new-page"]')).not.toBeNull();
    expect(window.localStorage.getItem(NAV_PANEL_KEY)).toBe('notes');
  });

  it('③ 点库条目 → 走既有 workspaces.switch（当前库不重复切）', async () => {
    const container = await renderApp();
    fireEvent.click(railItem(container, 'kb'));
    await waitFor(() => expect(container.querySelector('[data-testid="kb-row-1"]')).not.toBeNull());

    // 当前库（第 0 行）点它不触发切换
    fireEvent.click(container.querySelector('[data-testid="kb-row-0"]')!);
    expect(bridge.workspaces.switch).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('[data-testid="kb-row-1"]')!);
    await waitFor(() => expect(bridge.workspaces.switch).toHaveBeenCalledWith({ id: WS_ID_2 }));
  });

  it('④ 高亮单真源：回收站 / 工作台 / 模板 三项由既有视图状态派生', async () => {
    const container = await renderApp();

    fireEvent.click(railItem(container, 'trash'));
    expect(pagesStore.getState().view, '回收站项应落 pages.view=trash').toBe('trash');
    await waitFor(() => expect(railItem(container, 'trash').getAttribute('aria-current')).toBe('page'));

    fireEvent.click(railItem(container, 'home'));
    await waitFor(() => expect(railItem(container, 'home').getAttribute('aria-current')).toBe('page'));

    fireEvent.click(railItem(container, 'templates'));
    await waitFor(() => expect(railItem(container, 'templates').getAttribute('aria-current')).toBe('page'));

    // 回笔记：退出 market/home，落 pages 视图
    fireEvent.click(railItem(container, 'notes'));
    await waitFor(() => expect(railItem(container, 'notes').getAttribute('aria-current')).toBe('page'));
    expect(pagesStore.getState().view).toBe('pages');
  });

  it('⑤ 结构契约：一级轨在 .sc-shell__sidebar 之外（折叠二级栏不折掉一级导航）', async () => {
    const container = await renderApp();
    const rail = container.querySelector('.sc-shell__rail');
    const sidebar = container.querySelector('.sc-shell__sidebar');
    expect(rail).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(sidebar!.contains(rail!)).toBe(false);
    expect(rail!.parentElement?.className).toContain('sc-shell__body');
  });

  it('⑦ 日历 / 待办：二级栏换各自面板、主区渲染各自页面、选择持久化、与工作台互斥', async () => {
    const container = await renderApp();

    fireEvent.click(railItem(container, 'calendar'));
    await waitFor(() => expect(container.querySelector('[data-testid="calendar-page"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="calendar-side"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kb-panel"]')).toBeNull();
    expect(railItem(container, 'calendar').getAttribute('aria-current')).toBe('page');
    expect(window.localStorage.getItem(NAV_PANEL_KEY)).toBe('calendar');
    // 日历在主区取代编辑器正文（不是叠在上面）
    expect(container.querySelector('.pv-root')).toBeNull();

    fireEvent.click(railItem(container, 'todo'));
    await waitFor(() => expect(container.querySelector('[data-testid="todo-page"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="todo-side"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="calendar-page"]')).toBeNull();
    expect(window.localStorage.getItem(NAV_PANEL_KEY)).toBe('todo');
    // 与工作台互斥：从工作台切过来必须落回编辑器视图
    fireEvent.click(railItem(container, 'home'));
    await waitFor(() => expect(railItem(container, 'home').getAttribute('aria-current')).toBe('page'));
    fireEvent.click(railItem(container, 'todo'));
    await waitFor(() => expect(container.querySelector('[data-testid="todo-page"]')).not.toBeNull());
    expect(railItem(container, 'home').getAttribute('aria-current')).toBeNull();

    // 回笔记：日历/待办页面让位给编辑器，二级栏回页面树
    fireEvent.click(railItem(container, 'notes'));
    await waitFor(() => expect(container.querySelector('[data-testid="side-new-page"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="todo-page"]')).toBeNull();
    expect(window.localStorage.getItem(NAV_PANEL_KEY)).toBe('notes');
  });

  it('⑥ 「新建库…」复用既有弹框（不新造通道）', async () => {
    const container = await renderApp();
    fireEvent.click(railItem(container, 'kb'));
    await waitFor(() => expect(container.querySelector('[data-testid="kb-new"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-testid="kb-new"]')!);
    // 复用既有 NewWorkspaceDialog（名字输入 + 类型卡 + 确认钮）
    await waitFor(() => expect(container.querySelector('[data-testid="new-ws-name"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="new-ws-confirm"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="new-ws-types"]')?.textContent).toContain('工作台库');
  });
});