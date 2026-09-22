// @vitest-environment jsdom
/**
 * t58-ai-button.test.tsx —— TASK-T58-01 §1.2 AI 按钮像素化 + 两态（App 集成）。
 *
 * 真渲染 <App />（假桥同 T57 集成测试），钉四件事：
 *  ① 顶栏 AI 入口 = 像素机器人头（16×16 viewBox + crispEdges + 无描边），不是旧 Sparkle；
 *  ② 两态钩子真能命中：关态下眼/天线分组能被 `[aria-pressed='false'] …` 选择器选中，
 *     开态下不再命中（= 切到「眼亮」分支）；
 *  ③ 面板标题栏的 AI 图标同族（同一 AiRobot glyph）；
 *  ④ 顶栏所有图标钮一个不漏地都是像素族（全局像素化的 DOM 证据）。
 *
 * 纪律：不写死像素坐标之外的实现细节；色值/明暗由 CSS 决定，本文件只证「钩子可达」。
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { App } from '../src/renderer/src/App';
import { aiChatActions } from '../src/renderer/src/ai/chatState';
import { LAYOUT_STORAGE_KEY, layoutActions, layoutStore, makeDefaultLayout } from '../src/renderer/src/layout/layoutState';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
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

const WS_ID = 'ws-t58-test';
const AI_LABEL = 'AI 对话（Ctrl+J）';

function defaultSettings(): AppSettings {
  return {
    theme: 'system',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    trayClose: 'ask',
    data: { note: '~/.septcats' },
    sync: { enabled: false, encrypt: false, gc: false },
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
  layoutActions.init();
  aiChatActions.setOpen(false);
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

/** 顶栏 AI 入口钮（按可访问名取，label 来自 app.aiChatLabel 双语键）。 */
function aiButton(container: HTMLElement): HTMLButtonElement {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('.sc-shell__actions .sc-iconbtn')].find(
    (node) => node.getAttribute('aria-label') === AI_LABEL,
  );
  expect(btn, `顶栏未找到 label=${AI_LABEL} 的图标钮`).toBeDefined();
  return btn!;
}

describe('T58-01 AI 钮像素化（App 集成）', () => {
  it('AI 钮 = 像素机器人头：svg 是 16×16 viewBox + crispEdges 的 rect 网格，无描边属性', async () => {
    const container = await renderApp();
    const svg = aiButton(container).querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg?.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg?.getAttribute('stroke-width')).toBeNull();
    expect(svg?.querySelectorAll('rect').length).toBeGreaterThan(10);
    // 像素族特征 class（旧 Sparkle 的 phosphor svg 不具备这两条）
    expect(svg?.getAttribute('class')).toContain('sc-icon');
  });

  it('关态（面板收起）：眼/天线分组能被 [aria-pressed="false"] 两态选择器命中', async () => {
    const container = await renderApp();
    const btn = aiButton(container);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    const eyes = btn.querySelectorAll('.sc-icon__eye rect');
    const antenna = btn.querySelectorAll('.sc-icon__antenna rect');
    expect(eyes.length).toBe(4);
    expect(antenna.length).toBe(2);
    // CSS 选择器 [aria-pressed='false'] .sc-icon__eye 的前提：分组确实挂在带该属性的祖先下
    expect(eyes[0]!.closest("[aria-pressed='false']")).toBe(btn);
    expect(antenna[0]!.closest("[aria-pressed='false']")).toBe(btn);
  });

  it('点击开：aria-pressed 翻 true → 不再命中关态选择器（切「眼亮」分支），面板与同族标题图标一起出现', async () => {
    const container = await renderApp();
    const btn = aiButton(container);

    fireEvent.click(btn);

    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
    const eye = btn.querySelector('.sc-icon__eye rect');
    expect(eye).not.toBeNull();
    expect(eye!.closest("[aria-pressed='false']")).toBeNull();
    expect(eye!.closest("[aria-pressed='true']")).toBe(btn);

    const panel = await waitFor(() => {
      const node = container.querySelector('.ai-chat');
      expect(node).not.toBeNull();
      return node!;
    });
    expect(panel).not.toBeNull();
    // 面板标题栏图标同族（AiRobot 的两态分组在，几何不变）
    const headEyes = panel.querySelectorAll('.ai-chat__head-icon .sc-icon__eye rect');
    expect(headEyes.length).toBe(4);
  });

  it('再点关：回到关态（aria-pressed=false、面板消失、两态选择器重新命中，glyph 几何不变）', async () => {
    const container = await renderApp();
    const btn = aiButton(container);
    const geometryOf = (): string =>
      [...btn.querySelectorAll('rect')].map((r) => `${r.getAttribute('x')},${r.getAttribute('y')},${r.getAttribute('width')}`).join('|');
    const before = geometryOf();

    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(btn);

    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'));
    await waitFor(() => expect(container.querySelector('.ai-chat')).toBeNull());
    expect(btn.querySelector('.sc-icon__eye rect')!.closest("[aria-pressed='false']")).toBe(btn);
    // 两态只切 opacity（CSS），几何必须完全一致
    expect(geometryOf()).toBe(before);
  });

  it('顶栏图标钮一个不漏都是像素族：每个 svg 都是 16×16 viewBox + crispEdges + rect 网格', async () => {
    const container = await renderApp();
    const buttons = [...container.querySelectorAll('.sc-shell__actions .sc-iconbtn')];
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      const svg = button.querySelector('svg');
      const label = button.getAttribute('aria-label') ?? '(无 label)';
      expect(svg, `${label} 无 svg`).not.toBeNull();
      expect(svg!.getAttribute('viewBox'), `${label} 不是像素族 viewBox`).toBe('0 0 16 16');
      expect(svg!.getAttribute('shape-rendering'), `${label} 缺 crispEdges`).toBe('crispEdges');
      expect(svg!.querySelectorAll('rect').length, `${label} 无像素格`).toBeGreaterThan(0);
    }
  });

  it('AI 钮位置与可访问名不变：仍在搜索钮右侧第 2 位（顺序回归护栏）', async () => {
    const container = await renderApp();
    const labels = [...container.querySelectorAll('.sc-shell__actions .sc-iconbtn')].map(
      (node) => node.getAttribute('aria-label') ?? '',
    );
    // T66-01 新语义（PM 改）：房子（工作台入口）插在钮组最前，绝对下标失效；
    // 护栏本意=**相对顺序**：AI 钮仍在搜索钮右侧第 2 位（中间不插新钮）。
    const idxSearch = labels.findIndex((l) => l.includes('搜索'));
    expect(idxSearch).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf(AI_LABEL)).toBe(idxSearch + 1);
  });
});
