// @vitest-environment jsdom
/**
 * layout-ui.test.tsx —— T39-01 布局设计器 UI（TASK-T39-01 §1 自动化面）。
 *
 * 覆盖：
 * - 设置页「布局」区块渲染（预设卡片 / 参数控件 / 导出导入）；
 * - 预设卡片切换即时生效（根节点 CSS 变量 + 密度属性 + localStorage 持久化）；
 * - 参数夹紧（宽度 100→200 / 999→320，measure 9999→1000，输入框回显实际值）；
 * - 导出（剪贴板）→ 修改 → 导入原 JSON → 布局逐字段深比较等价；
 * - 非法导入 `{bad json` → role=alert 可读错误 + 布局不变；
 * - App 集成（红线回归 ②⑤）：预设切换 → 侧栏完全收起（.sc-shell--collapsed）；
 *   AI 面板位置 右/底/隐藏（T38 行为）；标签条显隐（T37 行为）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；localStorage 用 jsdom 原生实现。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { App } from '../src/renderer/src/App';
import { SettingsPage } from '../src/renderer/src/pages/SettingsPage';
import { aiChatActions, PANEL_OPEN_KEY } from '../src/renderer/src/ai/chatState';
import {
  LAYOUT_STORAGE_KEY,
  layoutActions,
  layoutStore,
  makeDefaultLayout,
} from '../src/renderer/src/layout/layoutState';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import type { AppSettings } from '../src/shared/settings';
import type { SeptcatsApi } from '../src/types/window';

// jsdom 未实现的浏览器 API（page-delete-ui 同款）：Tiptap/PM 布局路径会探
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

beforeEach(() => {
  window.localStorage.clear();
  rootStyle.removeProperty('--sc-layout-sidebar');
  rootStyle.removeProperty('--sc-layout-measure');
  delete document.documentElement.dataset.scDensity;
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  // 设置页测试不经 App 挂载 → 显式注入根变量（App 挂载场景由 App 自身 init）
  layoutActions.init();
  aiChatActions.setOpen(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// A：设置页「布局」区块
// ---------------------------------------------------------------------------

function defaultSettings(): AppSettings {
  return {
    theme: 'system',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '~/.septcats' },
    sync: { enabled: true, encrypt: false, gc: false },
    ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] },
  };
}

function installSettingsBridge(): void {
  vi.stubGlobal('septcats', {
    appMeta: vi.fn(async () => ({ name: 'Septcats', version: '0.0.0', schemaVersion: 1, layoutRoot: '.septcats' })),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      patch: vi.fn(async (p: Partial<AppSettings>) => ({ ...defaultSettings(), ...p })),
    },
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
}

async function renderLayoutSection(): Promise<void> {
  installSettingsBridge();
  render(<SettingsPage />);
  await screen.findByTestId('layout-section');
}

describe('T39-01 设置页「布局」区块', () => {
  it('渲染三张预设卡片（notion 默认高亮）+ 参数控件 + 导出/导入', async () => {
    await renderLayoutSection();
    expect(screen.getByTestId('layout-preset-notion').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('layout-preset-focus').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('layout-preset-workbench').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('layout-sidebar-width')).toBeDefined();
    expect(screen.getByTestId('layout-measure')).toBeDefined();
    expect(screen.getByRole('button', { name: '导出布局' })).toBeDefined();
    expect(screen.getByRole('button', { name: '导入布局' })).toBeDefined();
  });

  it('§1.1 预设卡片切换即时生效：根变量/密度属性随动 + 持久化 + 卡片高亮', async () => {
    await renderLayoutSection();

    // notion 默认：注入 240/650/comfortable
    expect(rootVar('--sc-layout-sidebar')).toBe('240px');
    expect(rootVar('--sc-layout-measure')).toBe('650px');
    expect(document.documentElement.dataset.scDensity).toBe('comfortable');

    fireEvent.click(screen.getByTestId('layout-preset-focus'));
    expect(layoutStore.getState().layout.preset).toBe('focus');
    expect(document.querySelector('.sc-shell')).toBeNull(); // 设置页内无壳；断言走变量与存储
    expect(rootVar('--sc-layout-measure')).toBe('900px');
    expect(persistedLayout()).toMatchObject({ preset: 'focus', content: { measure: 900 }, sidebar: { position: 'collapsed' } });
    expect(screen.getByTestId('layout-preset-focus').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('layout-preset-notion').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByTestId('layout-preset-workbench'));
    expect(persistedLayout()).toMatchObject({ preset: 'workbench', ai: { position: 'right', expanded: true } });

    // 密度 → 紧凑：根属性切换（token 档位派生值由 CSS 计算，jsdom 断言属性面）
    fireEvent.click(screen.getByRole('radio', { name: '紧凑' }));
    expect(document.documentElement.dataset.scDensity).toBe('compact');
    expect(persistedLayout()).toMatchObject({ density: 'compact', preset: 'custom' });
  });

  it('§1.2 参数夹紧：宽度 100→200 / 999→320、measure 9999→1000，输入框回显实际值', async () => {
    await renderLayoutSection();
    const width = screen.getByTestId('layout-sidebar-width') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '100' } });
    fireEvent.blur(width);
    await waitFor(() => expect(width.value).toBe('200'));
    expect(layoutStore.getState().layout.sidebar.width).toBe(200);
    expect(rootVar('--sc-layout-sidebar')).toBe('200px');
    expect(persistedLayout()).toMatchObject({ sidebar: { width: 200 } });

    fireEvent.change(width, { target: { value: '999' } });
    fireEvent.blur(width);
    await waitFor(() => expect(width.value).toBe('320'));
    expect(rootVar('--sc-layout-sidebar')).toBe('320px');

    const measure = screen.getByTestId('layout-measure') as HTMLInputElement;
    fireEvent.change(measure, { target: { value: '9999' } });
    fireEvent.blur(measure);
    await waitFor(() => expect(measure.value).toBe('1000'));
    expect(rootVar('--sc-layout-measure')).toBe('1000px');
  });

  it('§1.3 导出→修改→导入往返：布局 JSON 逐字段深比较等价', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderLayoutSection();

    // 改出一份非默认布局
    fireEvent.change(screen.getByTestId('layout-sidebar-width'), { target: { value: '280' } });
    fireEvent.blur(screen.getByTestId('layout-sidebar-width'));
    fireEvent.click(screen.getByRole('radio', { name: '底部' }));
    fireEvent.click(screen.getByRole('switch', { name: '标签条' }));

    fireEvent.click(screen.getByRole('button', { name: '导出布局' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const exported = writeText.mock.calls[0]?.[0];
    if (typeof exported !== 'string') {
      throw new Error('export did not write clipboard text');
    }

    // 改成另一份布局（模拟用户后续改动）
    fireEvent.click(screen.getByTestId('layout-preset-focus'));
    expect(layoutStore.getState().layout.preset).toBe('focus');

    // 导入原 JSON → 逐字段等价
    fireEvent.click(screen.getByRole('button', { name: '导入布局' }));
    fireEvent.change(screen.getByTestId('layout-import-input'), { target: { value: exported } });
    fireEvent.click(screen.getByRole('button', { name: '导入并应用' }));
    expect(screen.getByTestId('layout-import-ok')).toBeDefined();
    expect(layoutStore.getState().layout).toEqual(JSON.parse(exported) as unknown);
    expect(screen.getByRole('switch', { name: '标签条' }).getAttribute('aria-checked')).toBe('false');
  });

  it('§1.4 非法导入 `{bad json` → role=alert 可读错误 + 布局不变', async () => {
    await renderLayoutSection();
    fireEvent.click(screen.getByTestId('layout-preset-workbench'));
    const snapshot = layoutStore.getState().layout;
    const persistedBefore = window.localStorage.getItem(LAYOUT_STORAGE_KEY);

    fireEvent.click(screen.getByRole('button', { name: '导入布局' }));
    fireEvent.change(screen.getByTestId('layout-import-input'), { target: { value: '{bad json' } });
    fireEvent.click(screen.getByRole('button', { name: '导入并应用' }));

    const alert = screen.getByTestId('layout-import-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('不是有效的 JSON');
    // 布局不变（store 与 localStorage 双断言）
    expect(layoutStore.getState().layout).toEqual(snapshot);
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(persistedBefore);
  });
});

// ---------------------------------------------------------------------------
// B：App 集成（红线回归 ②⑤：侧栏完全收起 / 多页签与 AI 面板行为）
// ---------------------------------------------------------------------------

const WS_ID = 'ws-t39-test';

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
    blocks: { list: vi.fn(async () => []), commit: vi.fn() },
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
    // T51-01：App 挂载订阅原生菜单动作（假桥给退订函数即可）
    menu: { onAction: vi.fn(() => () => {}) },
  } as unknown as SeptcatsApi);
}

describe('T39-01 App 集成（红线回归 ②⑤）', () => {
  it('挂载注入变量；预设切换 → 侧栏完全收起（width=0 窄轨不占位）；AI 面板 右/底/隐藏；标签条显隐', async () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
    installAppBridge();
    resetPagesStore({ tabs: ['pg-1'] });
    const { container } = render(<App />);
    await waitFor(() => expect(pagesStore.getState().status === 'ready' || document.querySelector('.sc-shell') !== null).toBe(true));

    // 默认（notion）：侧栏列宽 240、标签条可见、AI 面板收起
    expect(rootVar('--sc-layout-sidebar')).toBe('240px');
    expect(rootVar('--sc-layout-measure')).toBe('650px');
    expect(container.querySelector('.tabsbar')).not.toBeNull();
    expect(container.querySelector('.ai-chat')).toBeNull();

    // §1.1 切 focus：侧栏完全收起（.sc-shell--collapsed → 列 1fr / display:none，宽度 0）
    act(() => {
      layoutActions.applyPreset('focus');
    });
    await waitFor(() => expect(container.querySelector('.sc-shell--collapsed')).not.toBeNull());
    expect(rootVar('--sc-layout-measure')).toBe('900px');
    expect(persistedLayout()).toMatchObject({ preset: 'focus' });

    // 切回 workbench：侧栏恢复（收起类消失）
    act(() => {
      layoutActions.applyPreset('workbench');
    });
    await waitFor(() => expect(container.querySelector('.sc-shell--collapsed')).toBeNull());

    // §1.5 AI 面板（T38 行为）：开 → 右侧；位置=底 → 纵向行；位置=隐藏 → 不渲染且入口消失
    act(() => {
      aiChatActions.setOpen(true);
    });
    expect(container.querySelector('.ai-chat')).not.toBeNull();
    expect(container.querySelector('.app-main-row--ai-bottom')).toBeNull();

    act(() => {
      layoutActions.setAiPosition('bottom');
    });
    expect(container.querySelector('.app-main-row--ai-bottom')).not.toBeNull();
    expect(container.querySelector('.ai-chat')).not.toBeNull();

    act(() => {
      layoutActions.setAiPosition('hidden');
    });
    expect(container.querySelector('.ai-chat')).toBeNull();
    // 顶栏入口隐藏 + 开合无效（Ctrl+J 的 toggleAiPanel 同径）
    expect(screen.queryByRole('button', { name: 'AI 对话（Ctrl+J）' })).toBeNull();
    act(() => {
      aiChatActions.togglePanel();
    });
    expect(container.querySelector('.ai-chat')).toBeNull();

    // §1.5 标签条（T37 行为）：隐藏 → tabsbar 不渲染；恢复 → 回来
    act(() => {
      layoutActions.setTabsVisible(false);
    });
    expect(container.querySelector('.tabsbar')).toBeNull();
    act(() => {
      layoutActions.setTabsVisible(true);
    });
    expect(container.querySelector('.tabsbar')).not.toBeNull();
    expect(persistedLayout()).toMatchObject({ preset: 'custom', tabsVisible: true });
  });

  it('重开应用保持在最后选择（新挂载读 localStorage）', async () => {
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({ ...makeDefaultLayout(), preset: 'focus', sidebar: { position: 'collapsed', width: 240 }, content: { measure: 900 } }),
    );
    installAppBridge();
    resetPagesStore();
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.sc-shell') !== null).toBe(true));
    expect(container.querySelector('.sc-shell--collapsed')).not.toBeNull();
    expect(rootVar('--sc-layout-measure')).toBe('900px');
  });
});

// ---------------------------------------------------------------------------
// C：T39-01-1 预设切换 → AI 面板可见性即时生效（PM 复跑缺陷 B3/F5 回归面）
// ---------------------------------------------------------------------------

/** 模拟重启的面板接管（照 App.tsx 挂载 effect 同一表达式：无手动记录以布局默认接管）。 */
function restartPanel(): void {
  const layout = layoutStore.getState().layout;
  aiChatActions.initPanel(layout.ai.expanded && layout.ai.position !== 'hidden');
}

describe('T39-01-1 预设切换 → AI 面板可见性即时生效', () => {
  it('切 workbench → .ai-chat 即时渲染；从开态切 focus → 即时收起；预设不写面板手动记录', async () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
    installAppBridge();
    resetPagesStore({ tabs: ['pg-1'] });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());
    // notion 默认：面板收起；清掉 beforeEach 造的手动记录，回到「无手动记录」基线
    expect(container.querySelector('.ai-chat')).toBeNull();
    window.localStorage.removeItem(PANEL_OPEN_KEY);

    // 切 workbench（expanded=true）：编辑区 .ai-chat 即时出现（B3/F5 缺陷面）
    act(() => {
      layoutActions.applyPreset('workbench');
    });
    await waitFor(() => expect(container.querySelector('.ai-chat')).not.toBeNull());
    expect(persistedLayout()).toMatchObject({ preset: 'workbench', ai: { position: 'right', expanded: true } });
    // 预设切换不产生手动记录（记录只由显式开合写，T38 口径）；重启后布局默认接管 → 仍展开
    expect(window.localStorage.getItem(PANEL_OPEN_KEY)).toBeNull();
    act(() => {
      restartPanel();
    });
    expect(container.querySelector('.ai-chat')).not.toBeNull();

    // 从「开」态切 focus（expanded=false）：面板即时收起
    act(() => {
      layoutActions.applyPreset('focus');
    });
    expect(container.querySelector('.ai-chat')).toBeNull();
    expect(persistedLayout()).toMatchObject({ preset: 'focus', ai: { expanded: false } });
    expect(window.localStorage.getItem(PANEL_OPEN_KEY)).toBeNull();
  });

  it('ai.position=hidden 的布局导入后仍不渲染；再切 workbench 即时渲染', async () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
    installAppBridge();
    resetPagesStore({ tabs: ['pg-1'] });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());

    // 导入 hidden 布局（expanded=true 但 hidden）：hidden 恒不渲染（既有口径保持）
    act(() => {
      layoutActions.importFromText(JSON.stringify({ ...makeDefaultLayout(), ai: { position: 'hidden', expanded: true } }));
    });
    expect(container.querySelector('.ai-chat')).toBeNull();

    // 再切 workbench（position 回到 right + expanded=true）：即时渲染
    act(() => {
      layoutActions.applyPreset('workbench');
    });
    await waitFor(() => expect(container.querySelector('.ai-chat')).not.toBeNull());
  });

  it('T38 回归：手动收起（记录=0）后预设切换不改写记录，重启仍收起', async () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
    installAppBridge();
    resetPagesStore({ tabs: ['pg-1'] });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());

    // 手动开合路径写记录 '0'
    act(() => {
      aiChatActions.setOpen(false);
    });
    expect(window.localStorage.getItem(PANEL_OPEN_KEY)).toBe('0');

    // 切 workbench：会话内面板即时展开，但手动记录不被预设改写
    act(() => {
      layoutActions.applyPreset('workbench');
    });
    expect(container.querySelector('.ai-chat')).not.toBeNull();
    expect(window.localStorage.getItem(PANEL_OPEN_KEY)).toBe('0');

    // 重启（initPanel 口径不变）：有手动记录以记录为准 → 仍收起
    act(() => {
      restartPanel();
    });
    expect(container.querySelector('.ai-chat')).toBeNull();
  });
});
