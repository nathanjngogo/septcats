// @vitest-environment jsdom
/**
 * t74-01-glyph-collection.test.tsx —— TASK-T74-01「像素 glyph 收编进 @septcats/ui」的
 * 桌面应用侧**外观零变化**护栏（App 顶栏真渲染 + 组件直渲）。
 *
 * 判定口径：本文件里的四段 rect 清单是 **T74-01 迁移前**（局部 `workbench/pixelGlyph.tsx`
 * + `theme/pixelGlyph.tsx`）实渲染捕获的基线，迁移后逐条不得变——坐标、合并宽度、opacity
 * 档任何一格变了都即红。这比「渲染出来大概像」强：像素画的差异全在这些属性里。
 *
 * 分工：ui 侧 `icons.test.tsx` 钉矩阵数据与出口面；这里钉**应用消费面**的 DOM 产物
 * （含 `<Icon>` 转发与顶栏 in-situ 结构）。
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import {
  Icon,
  PIXEL_GLYPHS_EXTRA,
  PixelHomeGlyph,
  PixelPaletteGlyph,
  PixelShopGlyph,
  PixelTodoGlyph,
} from '@septcats/ui';
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

const WS_ID = 'ws-t74-test';
const MARKET_LABEL = '工作台模板市场';
const PALETTE_LABEL = '配色画廊';

/** 迁移前基线：四枚 glyph 的直渲 rect 清单（x,y WxH@opacity，行内同档已合并）。 */
const BASELINE_HOME = [
  '7,1 2x1@1',
  '6,2 4x1@1',
  '6,3 4x1@1',
  '5,4 2x1@1',
  '9,4 2x1@1',
  '4,5 2x1@1',
  '10,5 2x1@1',
  '3,6 2x1@1',
  '7,6 2x1@0.8',
  '11,6 2x1@1',
  '2,7 2x1@1',
  '4,7 8x1@0.8',
  '12,7 2x1@1',
  '2,8 12x1@1',
  '2,9 12x1@1',
  '2,10 2x1@1',
  '12,10 2x1@1',
  '2,11 2x1@1',
  '6,11 3x1@1',
  '12,11 2x1@1',
  '2,12 2x1@1',
  '6,12 3x1@1',
  '12,12 2x1@1',
  '2,13 2x1@1',
  '6,13 3x1@1',
  '12,13 2x1@1',
  '2,14 2x1@1',
  '6,14 3x1@1',
  '12,14 2x1@1',
];

const BASELINE_TODO = [
  '3,1 2x1@1',
  '10,1 2x1@1',
  '2,2 4x1@1',
  '9,2 4x1@1',
  '3,3 2x1@1',
  '10,3 2x1@1',
  '2,5 10x1@1',
  '2,6 1x1@1',
  '11,6 1x1@1',
  '2,7 1x1@1',
  '4,7 4x1@1',
  '11,7 1x1@1',
  '2,8 1x1@1',
  '11,8 1x1@1',
  '2,9 1x1@1',
  '4,9 4x1@1',
  '11,9 1x1@1',
  '2,10 1x1@1',
  '11,10 1x1@1',
  '2,11 1x1@1',
  '4,11 4x1@1',
  '11,11 1x1@1',
  '2,12 1x1@1',
  '11,12 1x1@1',
  '2,13 10x1@1',
];

/** 迁移前基线：顶栏「工作台模板市场」钮（<Icon size="md"> 转发 PixelShopGlyph）。 */
const BASELINE_MARKET_BUTTON = [
  '2,1 12x1@1',
  '2,2 12x1@1',
  '2,3 1x1@1',
  '5,3 2x1@1',
  '11,3 2x1@1',
  '2,4 1x1@1',
  '5,4 2x1@1',
  '11,4 2x1@1',
  '2,5 12x1@1',
  '2,6 1x1@1',
  '5,6 1x1@1',
  '6,6 1x1@0.8',
  '7,6 1x1@1',
  '10,6 1x1@1',
  '11,6 1x1@0.8',
  '12,6 1x1@1',
  '2,7 1x1@1',
  '5,7 1x1@1',
  '6,7 1x1@0.8',
  '7,7 1x1@1',
  '10,7 1x1@1',
  '11,7 1x1@0.8',
  '12,7 1x1@1',
  '2,8 1x1@1',
  '5,8 1x1@1',
  '6,8 1x1@0.8',
  '7,8 1x1@1',
  '10,8 1x1@1',
  '11,8 1x1@0.8',
  '12,8 1x1@1',
  '2,9 1x1@1',
  '5,9 1x1@1',
  '6,9 1x1@0.8',
  '7,9 1x1@1',
  '10,9 1x1@1',
  '11,9 1x1@0.8',
  '12,9 1x1@1',
  '2,10 1x1@1',
  '11,10 1x1@1',
  '2,11 1x1@1',
  '11,11 1x1@1',
  '2,12 12x1@1',
  '2,13 1x1@1',
  '4,13 1x1@1',
  '11,13 1x1@1',
  '13,13 1x1@1',
  '2,14 1x1@1',
  '4,14 1x1@1',
  '11,14 1x1@1',
  '13,14 1x1@1',
  '2,15 3x1@1',
  '11,15 3x1@1',
];

/** 迁移前基线：顶栏「配色画廊」钮（<Icon size="md"> 转发 PixelPaletteGlyph）。 */
const BASELINE_PALETTE_BUTTON = [
  '5,2 4x1@0.8',
  '3,3 2x1@0.8',
  '5,3 4x1@1',
  '9,3 2x1@0.8',
  '2,4 1x1@0.8',
  '3,4 8x1@1',
  '11,4 1x1@0.8',
  '2,5 10x1@1',
  '1,6 1x1@0.8',
  '2,6 10x1@1',
  '12,6 1x1@0.8',
  '1,7 1x1@0.8',
  '2,7 7x1@1',
  '9,7 2x1@0.8',
  '12,7 1x1@0.8',
  '1,8 1x1@0.8',
  '2,8 6x1@1',
  '8,8 1x1@0.8',
  '9,8 2x1@1',
  '11,8 1x1@0.8',
  '1,9 1x1@0.8',
  '2,9 4x1@1',
  '6,9 1x1@0.8',
  '7,9 4x1@1',
  '11,9 1x1@0.8',
  '1,10 1x1@0.8',
  '2,10 10x1@1',
  '12,10 1x1@0.8',
  '2,11 10x1@1',
  '12,11 1x1@0.8',
  '2,12 1x1@0.8',
  '3,12 8x1@1',
  '11,12 1x1@0.8',
  '3,13 2x1@0.8',
  '5,13 4x1@1',
  '9,13 2x1@0.8',
  '5,14 4x1@0.8',
];

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
  layoutActions.init();
  aiChatActions.setOpen(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function rectSig(root: Element): string[] {
  return [...root.querySelectorAll('rect')].map(
    (r) =>
      `${r.getAttribute('x')},${r.getAttribute('y')} ${r.getAttribute('width')}x${r.getAttribute('height')}@${r.getAttribute('opacity')}`,
  );
}

/** 把一个渲染结果的 rect 展开成 16×16 掩码（与 ui 侧矩阵同构）。 */
function maskOf(root: Element): string[] {
  const rows: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => '.'));
  for (const rect of root.querySelectorAll('rect')) {
    const x = Number(rect.getAttribute('x'));
    const y = Number(rect.getAttribute('y'));
    const w = Number(rect.getAttribute('width'));
    const h = Number(rect.getAttribute('height'));
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        rows[y + dy]![x + dx] = '#';
      }
    }
  }
  return rows.map((r) => r.join(''));
}

/** 矩阵 → 16×16 掩码；行宽不足 16 的参差行（Shop）右侧补空（渲染按实际行宽取格）。 */
const occupied = (matrix: readonly string[]): string[] =>
  matrix.map((row) => row.padEnd(16, '.').replace(/[ox]/g, '#'));

async function renderApp(): Promise<HTMLElement> {
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
  installAppBridge();
  resetPagesStore({ tabs: ['pg-1'] });
  const { container } = render(<App />);
  await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());
  await waitFor(() => expect(container.querySelector('.pv-root')).not.toBeNull());
  return container;
}

function actionButton(container: HTMLElement, label: string): Element {
  const btn = [...container.querySelectorAll('.sc-shell__actions .sc-iconbtn')].find(
    (node) => node.getAttribute('aria-label') === label,
  );
  expect(btn, `顶栏未找到 label=${label} 的图标钮`).toBeDefined();
  return btn!;
}

describe('T74-01 收编后消费面零回归（基线 = 迁移前实渲染捕获）', () => {
  it('Home/Todo：直渲 rect 清单逐条等于迁移前基线（应用层 WorkbenchPage / 待办卡用的两枚）', () => {
    const home = render(<PixelHomeGlyph size={16} />);
    expect(rectSig(home.container.querySelector('svg')!)).toEqual(BASELINE_HOME);
    cleanup();
    const todo = render(<PixelTodoGlyph size={16} />);
    expect(rectSig(todo.container.querySelector('svg')!)).toEqual(BASELINE_TODO);
  });

  it('顶栏「工作台模板市场」钮：in-situ rect 清单逐条等于迁移前基线（52 条，含 opacity 档）', async () => {
    const container = await renderApp();
    const svg = actionButton(container, MARKET_LABEL).querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('class')).toBe('sc-icon');
    expect(rectSig(svg)).toEqual(BASELINE_MARKET_BUTTON);
  });

  it('顶栏「配色画廊」钮：in-situ rect 清单逐条等于迁移前基线（37 条，含 opacity 档）', async () => {
    const container = await renderApp();
    const svg = actionButton(container, PALETTE_LABEL).querySelector('svg')!;
    expect(svg.getAttribute('class')).toBe('sc-icon');
    expect(rectSig(svg)).toEqual(BASELINE_PALETTE_BUTTON);
  });

  it('四枚经 <Icon> 转发后仍是同一份矩阵（逐格掩码 = PIXEL_GLYPHS_EXTRA）', () => {
    for (const [name, Comp] of [
      ['Home', PixelHomeGlyph],
      ['Todo', PixelTodoGlyph],
      ['Shop', PixelShopGlyph],
      ['Palette', PixelPaletteGlyph],
    ] as const) {
      const { container } = render(<Icon icon={Comp} size="md" />);
      expect(container.querySelector('svg')!.getAttribute('class'), `${name} class`).toBe('sc-icon');
      expect(maskOf(container.querySelector('svg')!), `${name} 逐格`).toEqual(occupied(PIXEL_GLYPHS_EXTRA[name]));
      cleanup();
    }
  });

  it('顶栏图标钮全组仍是像素族几何（收编未引入混族残留）', async () => {
    const container = await renderApp();
    const buttons = [...container.querySelectorAll('.sc-shell__actions .sc-iconbtn')];
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      const svg = button.querySelector('svg');
      const label = button.getAttribute('aria-label') ?? '(无 label)';
      expect(svg, `${label} 无 svg`).not.toBeNull();
      expect(svg!.getAttribute('viewBox'), `${label} viewBox`).toBe('0 0 16 16');
      expect(svg!.getAttribute('shape-rendering'), `${label} crispEdges`).toBe('crispEdges');
      expect(svg!.getAttribute('stroke-width'), `${label} 有描边残留`).toBeNull();
      expect(svg!.querySelectorAll('rect').length, `${label} 无像素格`).toBeGreaterThan(0);
    }
  });
});
