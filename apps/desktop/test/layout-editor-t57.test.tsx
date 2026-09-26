// @vitest-environment jsdom
/**
 * layout-editor-t57.test.tsx —— TASK-T57-01 §1.3 独立布局编辑器页 + §1.4 视图状态机。
 *
 * A 编辑器页（渲染 <LayoutEditorPage onDone>）：
 *  - 结构：标题/恢复默认/完成 + 三张预设卡（当前高亮）+ 大预览图 + 细项控件（两根滑杆 /
 *    三组 RadioGroup / 两个 Switch）；
 *  - 滑杆回写：拖（change）→ layoutState + 根节点 CSS 变量 + localStorage + 预览图内联
 *    变量四处同源跟随，且 preset 落 custom；
 *  - 预设卡点击即时生效（大预览图 data-sidebar 随之变）+ toast；
 *  - 恢复默认：notion 参数 + 主题保留 + 滑杆值回显 + toast；
 *  - AI 位置 / 标签条 / 密度 / 主题四项回写（主题走 setGlobalThemeMode + settings.patch）；
 *  - 布局 JSON 导出→改→导入往返逐字段等价；非法 JSON 给 role=alert 且布局不变；
 *  - 「完成」走 onDone 出口。
 * B 视图状态机（App 集成）：顶栏「布局」钮 ↔ 弹框 ↔ 编辑器页 ↔ editor 的往返。
 *
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；localStorage 用 jsdom 原生实现。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { App } from '../src/renderer/src/App';
import { LayoutEditorPage } from '../src/renderer/src/layout/LayoutEditorPage';
import { OPEN_LAYOUT_EDITOR_EVENT } from '../src/renderer/src/layout/LayoutSection';
import { SettingsPage } from '../src/renderer/src/pages/SettingsPage';
import { aiChatActions } from '../src/renderer/src/ai/chatState';
import {
  LAYOUT_STORAGE_KEY,
  layoutActions,
  layoutStore,
  makeDefaultLayout,
  maxPanelWidth,
} from '../src/renderer/src/layout/layoutState';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import type { AppSettings } from '../src/shared/settings';
import type { SeptcatsApi } from '../src/types/window';

// jsdom 未实现的浏览器 API（layout-ui / page-delete-ui 同款）：Tiptap/PM 布局路径会探
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

const rootStyle = document.documentElement.style;

function rootVar(name: string): string {
  return rootStyle.getPropertyValue(name);
}

function persistedLayout(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '') as Record<string, unknown>;
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

/** 编辑器页/设置页共用的最小假桥（settings.patch 供主题行使用）。 */
function installSettingsBridge(): { patch: ReturnType<typeof vi.fn> } {
  const patch = vi.fn(async (p: Partial<AppSettings>) => ({ ...defaultSettings(), ...p }));
  vi.stubGlobal('septcats', {
    appMeta: vi.fn(async () => ({ name: 'Septcats', version: '0.0.0', schemaVersion: 1, layoutRoot: '.septcats' })),
    settings: { get: vi.fn(async () => defaultSettings()), patch },
    update: { onState: vi.fn(() => () => {}) },
    sync: { onState: vi.fn(() => () => {}) },
    ai: {
      state: vi.fn(async () => ({ enabled: false, cloudConsent: false, activeProviderId: null, providers: [] })),
      listModels: vi.fn(async () => ({ models: [], cached: false, fetchedAt: 1 })),
      chat: vi.fn(),
      setKey: vi.fn(),
      clearKey: vi.fn(),
    },
    templates: { list: vi.fn(async () => ({ templates: [] })) },
  } as unknown as SeptcatsApi);
  return { patch };
}

function renderEditor(): { onDone: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const onDone = vi.fn();
  const { container } = render(<LayoutEditorPage onDone={onDone} />);
  return { onDone, container };
}

beforeEach(() => {
  window.localStorage.clear();
  rootStyle.removeProperty('--sc-layout-sidebar');
  rootStyle.removeProperty('--sc-layout-measure');
  delete document.documentElement.dataset.scDensity;
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  pagesStore.setState((state) => ({ ...state, toasts: [] }));
  layoutActions.init();
  aiChatActions.setOpen(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// A：独立布局编辑器页
// ---------------------------------------------------------------------------

describe('T57-01 §1.3 布局编辑器页：结构与预设', () => {
  it('渲染标题/恢复默认/完成 + 三张预设卡（notion 高亮）+ 大预览图 + 细项控件', () => {
    installSettingsBridge();
    const { container } = renderEditor();

    expect(container.querySelector('[data-testid="layout-editor"]')).not.toBeNull();
    expect(screen.getByTestId('layout-editor-reset')).toBeDefined();
    expect(screen.getByTestId('layout-editor-done')).toBeDefined();
    // 大预览图（lg 档）+ 三张卡的缩略图 = 4 张抽象图
    expect(container.querySelectorAll('[data-testid="layout-preview"]')).toHaveLength(4);
    expect(container.querySelector('.layout-editor__preview .layout-preview--lg')).not.toBeNull();

    expect(screen.getByTestId('layout-preset-notion').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('layout-preset-focus').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('layout-preset-workbench').getAttribute('aria-pressed')).toBe('false');

    // 两根滑杆：min/max = 夹紧区间（同源常量；T61-01 §2 起上限随视口 = min(480, 30%)）
    const width = screen.getByTestId('layout-sidebar-width') as HTMLInputElement;
    expect(width.type).toBe('range');
    expect(width.min).toBe('200');
    expect(width.max).toBe(String(maxPanelWidth()));
    expect(width.value).toBe('240');
    const measure = screen.getByTestId('layout-measure') as HTMLInputElement;
    expect(measure.min).toBe('560');
    expect(measure.max).toBe('1000');
    expect(measure.value).toBe('650');
    expect(screen.getByTestId('layout-sidebar-width-value').textContent).toContain('240');

    // 控件齐备：AI 面板位置 / 密度 / 主题三组 radio + AI 展开 / 标签条两个开关
    expect(screen.getByRole('radiogroup', { name: 'AI 面板位置' })).toBeDefined();
    expect(screen.getByRole('radiogroup', { name: '密度' })).toBeDefined();
    expect(screen.getByRole('radiogroup', { name: '主题' })).toBeDefined();
    expect(screen.getByRole('switch', { name: 'AI 面板默认展开' })).toBeDefined();
    expect(screen.getByRole('switch', { name: '标签条' })).toBeDefined();
  });

  it('点预设卡即时生效：大预览图随之切换 + 存储写入 + toast（preset 与卡片高亮同源）', () => {
    installSettingsBridge();
    const { container } = renderEditor();

    const bigBefore = container.querySelector('.layout-editor__preview .layout-preview');
    expect(bigBefore?.getAttribute('data-sidebar')).toBe('left');

    fireEvent.click(screen.getByTestId('layout-preset-focus'));

    expect(layoutStore.getState().layout.preset).toBe('focus');
    expect(persistedLayout()).toMatchObject({ preset: 'focus', content: { measure: 900 } });
    const bigAfter = container.querySelector('.layout-editor__preview .layout-preview');
    expect(bigAfter?.getAttribute('data-sidebar')).toBe('collapsed');
    expect(bigAfter?.getAttribute('style')).toContain('--sc-layout-preview-content: 76.9%');
    expect(screen.getByTestId('layout-preset-focus').getAttribute('aria-pressed')).toBe('true');
    expect(pagesStore.getState().toasts.some((toast) => toast.message.includes('专注'))).toBe(true);
  });

  it('宽度滑杆回写四处同源：layoutState / 根变量 / localStorage / 预览图内联变量（preset 落 custom）', () => {
    installSettingsBridge();
    const { container } = renderEditor();
    const width = screen.getByTestId('layout-sidebar-width') as HTMLInputElement;

    fireEvent.change(width, { target: { value: '300' } });

    expect(layoutStore.getState().layout.sidebar.width).toBe(300);
    expect(layoutStore.getState().layout.preset).toBe('custom');
    expect(rootVar('--sc-layout-sidebar')).toBe('300px');
    expect(persistedLayout()).toMatchObject({ preset: 'custom', sidebar: { width: 300 } });
    expect(screen.getByTestId('layout-sidebar-width-value').textContent).toContain('300');
    const big = container.querySelector('.layout-editor__preview .layout-preview');
    // T61-01 §2.3：预览百分比走新值域（200–视口 307），300 → 14 + 100/107×16 = 29%
    expect(big?.getAttribute('style')).toContain('--sc-layout-preview-sidebar: 29%');
  });

  it('正文宽度滑杆回写：端点值（560/1000）与根变量、预览占比一起跟随', () => {
    installSettingsBridge();
    const { container } = renderEditor();
    const measure = screen.getByTestId('layout-measure') as HTMLInputElement;

    fireEvent.change(measure, { target: { value: '1000' } });
    expect(rootVar('--sc-layout-measure')).toBe('1000px');
    expect(layoutStore.getState().layout.content.measure).toBe(1000);
    expect(
      container.querySelector('.layout-editor__preview .layout-preview')?.getAttribute('style'),
    ).toContain('--sc-layout-preview-content: 86%');

    fireEvent.change(measure, { target: { value: '560' } });
    expect(rootVar('--sc-layout-measure')).toBe('560px');
    expect(layoutStore.getState().layout.preset).toBe('custom');
  });

  it('AI 位置 / 标签条 / 密度 / 主题四项回写（主题走 setGlobalThemeMode + settings.patch）', () => {
    const { patch } = installSettingsBridge();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { container } = renderEditor();

    fireEvent.click(screen.getByRole('radio', { name: '底部' }));
    expect(layoutStore.getState().layout.ai.position).toBe('bottom');
    expect(
      container.querySelector('.layout-editor__preview .layout-preview')?.getAttribute('data-ai'),
    ).toBe('bottom');

    fireEvent.click(screen.getByRole('switch', { name: '标签条' }));
    expect(layoutStore.getState().layout.tabsVisible).toBe(false);
    expect(persistedLayout()).toMatchObject({ tabsVisible: false });

    fireEvent.click(screen.getByRole('radio', { name: '紧凑' }));
    expect(document.documentElement.dataset.scDensity).toBe('compact');

    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(layoutStore.getState().layout.theme).toBe('dark');
    expect(persistedLayout()).toMatchObject({ theme: 'dark' });
    expect(
      dispatchSpy.mock.calls.some(([event]) => (event as CustomEvent).type === 'septcats:theme-mode'),
    ).toBe(true);
    expect(patch).toHaveBeenCalledWith({ theme: 'dark' });
    dispatchSpy.mockRestore();
  });

  it('恢复默认：notion 参数回位 + 主题保留 + 滑杆/高亮回显 + toast', () => {
    installSettingsBridge();
    const { container } = renderEditor();

    // 造一份远离默认的 custom：收起侧栏 / 1000 宽正文 / 紧凑 / 深色
    fireEvent.click(screen.getByTestId('layout-preset-focus'));
    fireEvent.change(screen.getByTestId('layout-measure'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('radio', { name: '紧凑' }));
    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(layoutStore.getState().layout.theme).toBe('dark');

    fireEvent.click(screen.getByTestId('layout-editor-reset'));

    const after = layoutStore.getState().layout;
    expect(after.preset).toBe('notion');
    expect(after.sidebar).toEqual({ position: 'left', width: 240 });
    expect(after.content).toEqual({ measure: 650 });
    expect(after.density).toBe('comfortable');
    expect(after.theme).toBe('dark'); // 主题保留（与预设切换同口径）
    expect((screen.getByTestId('layout-sidebar-width') as HTMLInputElement).value).toBe('240');
    expect((screen.getByTestId('layout-measure') as HTMLInputElement).value).toBe('650');
    expect(screen.getByTestId('layout-preset-notion').getAttribute('aria-pressed')).toBe('true');
    expect(rootVar('--sc-layout-sidebar')).toBe('240px');
    expect(document.documentElement.dataset.scDensity).toBe('comfortable');
    expect(pagesStore.getState().toasts.some((toast) => toast.message.includes('恢复默认'))).toBe(true);
    expect(
      container.querySelector('.layout-editor__preview .layout-preview')?.getAttribute('data-sidebar'),
    ).toBe('left');
  });

  it('布局 JSON 导出→修改→导入往返：逐字段等价 + 开关回显', async () => {
    installSettingsBridge();
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderEditor();

    fireEvent.change(screen.getByTestId('layout-sidebar-width'), { target: { value: '280' } });
    fireEvent.click(screen.getByRole('radio', { name: '底部' }));
    fireEvent.click(screen.getByRole('switch', { name: '标签条' }));

    fireEvent.click(screen.getByRole('button', { name: '导出布局' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const exported = writeText.mock.calls[0]?.[0];
    if (typeof exported !== 'string') {
      throw new Error('export did not write clipboard text');
    }

    fireEvent.click(screen.getByTestId('layout-preset-focus'));
    expect(layoutStore.getState().layout.preset).toBe('focus');

    fireEvent.click(screen.getByRole('button', { name: '导入布局' }));
    fireEvent.change(screen.getByTestId('layout-import-input'), { target: { value: exported } });
    fireEvent.click(screen.getByRole('button', { name: '导入并应用' }));
    expect(screen.getByTestId('layout-import-ok')).toBeDefined();
    expect(layoutStore.getState().layout).toEqual(JSON.parse(exported) as unknown);
    expect(screen.getByRole('switch', { name: '标签条' }).getAttribute('aria-checked')).toBe('false');
  });

  it('非法导入 `{bad json` → role=alert 可读错误 + 当前布局不动', () => {
    installSettingsBridge();
    renderEditor();
    fireEvent.click(screen.getByTestId('layout-preset-workbench'));
    const snapshot = layoutStore.getState().layout;
    const persistedBefore = window.localStorage.getItem(LAYOUT_STORAGE_KEY);

    fireEvent.click(screen.getByRole('button', { name: '导入布局' }));
    fireEvent.change(screen.getByTestId('layout-import-input'), { target: { value: '{bad json' } });
    fireEvent.click(screen.getByRole('button', { name: '导入并应用' }));

    const alert = screen.getByTestId('layout-import-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('不是有效的 JSON');
    expect(layoutStore.getState().layout).toEqual(snapshot);
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(persistedBefore);
  });

  it('「完成」走 onDone 出口（本页不额外写布局状态）', () => {
    installSettingsBridge();
    const { onDone } = renderEditor();
    const snapshot = layoutStore.getState().layout;
    fireEvent.click(screen.getByTestId('layout-editor-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(layoutStore.getState().layout).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// B：视图状态机（App 集成）
// ---------------------------------------------------------------------------

const WS_ID = 'ws-t57-test';

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
    close: { onFlushRequest: vi.fn(() => () => {}), flushAck: vi.fn(), onAsk: vi.fn(() => () => {}), decide: vi.fn() },
  } as unknown as SeptcatsApi);
}

async function renderApp(): Promise<HTMLElement> {
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
  installAppBridge();
  resetPagesStore({ tabs: ['pg-1'] });
  const { container } = render(<App />);
  await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());
  await waitFor(() => expect(container.querySelector('.pv-root')).not.toBeNull());
  return container;
}

describe('T57-01 §1.1/§1.2/§1.3 视图状态机（App 集成）', () => {
  it('顶栏「布局」钮在设置钮左侧；点击开弹框（aria-pressed 同步）→ Esc 关闭（editor 不动）', async () => {
    const container = await renderApp();

    const order = [...container.querySelectorAll('.sc-shell__actions .sc-iconbtn')].map((node) =>
      node.getAttribute('aria-label') ?? '',
    );
    const layoutIndex = order.indexOf('布局');
    const settingsIndex = order.indexOf('设置');
    expect(layoutIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(-1);
    expect(layoutIndex).toBe(settingsIndex - 1); // 紧邻设置钮左侧（Sync→Plus→Layout→Gear）

    const button = screen.getByTestId('layout-open');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(screen.getByTestId('layout-picker')).toBeDefined();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    // 弹框是 overlay：主区结构仍在（不挡重排观测）
    expect(container.querySelector('.sc-shell')).not.toBeNull();

    fireEvent.keyDown(screen.getByTestId('layout-picker'), { key: 'Escape' });
    expect(screen.queryByTestId('layout-picker')).toBeNull();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.pv-root')).not.toBeNull();
  });

  it('editor → layout → editor：弹框选卡 → 自定义编辑… → 编辑器页 → 完成回编辑器', async () => {
    const container = await renderApp();

    fireEvent.click(screen.getByTestId('layout-open'));
    fireEvent.click(screen.getByTestId('layout-picker-card-focus'));
    expect(persistedLayout()).toMatchObject({ preset: 'focus' });

    fireEvent.click(screen.getByTestId('layout-picker-edit'));
    await waitFor(() => expect(container.querySelector('[data-testid="layout-editor"]')).not.toBeNull());
    // 弹框已关；编辑器页占主区；面包屑随视图
    expect(screen.queryByTestId('layout-picker')).toBeNull();
    expect(container.querySelector('.pv-root')).toBeNull();
    expect(container.querySelector('.sc-shell__crumb')?.textContent).toContain('布局编辑器');
    // 非编辑器视图 → .app-shell--fused 摘除（T52 契约：顶栏钮回来）
    expect(container.querySelector('.sc-shell')?.className).not.toContain('app-shell--fused');

    fireEvent.click(screen.getByTestId('layout-editor-done'));
    await waitFor(() => expect(container.querySelector('.pv-root')).not.toBeNull());
    expect(container.querySelector('[data-testid="layout-editor"]')).toBeNull();
    expect(container.querySelector('.sc-shell')?.className).toContain('app-shell--fused');
  });

  it('设置页入口按钮经事件通道进编辑器页（不渲染第二套编辑 UI）', async () => {
    installSettingsBridge();
    render(<SettingsPage />);
    await screen.findByTestId('layout-section');

    // 旧区块只剩入口按钮：不再有预设卡/滑杆（避免行为分叉）
    expect(screen.queryByTestId('layout-preset-notion')).toBeNull();
    expect(screen.queryByTestId('layout-sidebar-width')).toBeNull();

    const seen: Event[] = [];
    const listener = (event: Event): void => {
      seen.push(event);
    };
    window.addEventListener(OPEN_LAYOUT_EDITOR_EVENT, listener);
    fireEvent.click(screen.getByTestId('layout-editor-entry'));
    window.removeEventListener(OPEN_LAYOUT_EDITOR_EVENT, listener);
    expect(seen).toHaveLength(1);
  });

  it('命令面板「布局编辑器」命令已装配（openLayoutEditor 接线）', async () => {
    await renderApp();
    // App 装配命令后，命令清单里存在 app.layoutEditor（label 走 i18n 现取）
    const { paletteStore } = await import('../src/renderer/src/state/palette');
    const ids = paletteStore.getState().commands.map((command) => command.id);
    expect(ids).toContain('app.layoutEditor');
    const command = paletteStore.getState().commands.find((item) => item.id === 'app.layoutEditor');
    expect(command?.label).toBe('布局编辑器');
    act(() => {
      command?.run();
    });
    await waitFor(() => expect(document.querySelector('[data-testid="layout-editor"]')).not.toBeNull());
  });
});
