// @vitest-environment jsdom
/**
 * t58-ai-button.test.tsx —— 顶栏 AI 入口钮（App 集成）。
 *
 * 契约沿革（必读，防后来者误当回归）：
 *  - T58-01 原契约：顶栏 AI 入口 = 像素机器人头（16×16 + crispEdges + 两态眼睛）。
 *  - 09-29 老板令「同步状态那一行的按键，全部换成中文按键」→「图标去掉」：
 *    **顶栏整排改为纯中文文字钮**（TopBarButton，无 glyph）。故本文件例子
 *    由「钮内 svg 像素族几何」改为「纯文字钮 + 可访问面 + 两态 aria-pressed」；
 *    像素族资产本体仍在（AiRobot 用于 AI 面板标题、PixelShopGlyph 用于模板市场页），
 *    其「同族几何不变」的基线断言继续钉在**面板标题图标**上（见第 ③ 例）。
 *
 * 钉五件事：
 *  ① 顶栏 AI 钮 = 纯文字钮（无 svg、可见「AI 对话」、aria-label 含快捷键）；
 *  ② 两态：点击 aria-pressed 在 false/true 间翻转（面板开合语义不变）；
 *  ③ 面板标题栏图标 = AiRobot 线族 glyph（T105-01 换装；两态组类名契约不破）；
 *  ④ 顶栏全组 = 纯文字钮（无 svg、无 .sc-iconbtn、每个钮可见文字非空）；
 *  ⑤ 相对顺序护栏（AI 钮紧邻搜索钮右侧）。
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
const AI_TEXT = 'AI 对话';

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

async function renderApp(): Promise<HTMLElement> {
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...makeDefaultLayout() }));
  installAppBridge();
  resetPagesStore({ tabs: ['pg-1'] });
  const { container } = render(<App />);
  await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());
  await waitFor(() => expect(container.querySelector('.pv-root')).not.toBeNull());
  return container;
}

/** 顶栏 AI 入口钮（纯文字钮，按可访问名取；label 来自 app.aiChatLabel 双语键）。 */
function aiButton(container: HTMLElement): HTMLButtonElement {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('.sc-shell__actions .sc-topbtn')].find(
    (node) => node.getAttribute('aria-label') === AI_LABEL,
  );
  expect(btn, `顶栏未找到 label=${AI_LABEL} 的文字钮`).toBeDefined();
  return btn!;
}

describe('T58-01 顶栏 AI 钮（09-29 老板令后 = 纯文字钮）', () => {
  it('① AI 钮 = 纯文字钮：无 svg、可见「AI 对话」、aria-label 保留完整键位提示', async () => {
    const container = await renderApp();
    const btn = aiButton(container);
    expect(btn.querySelector('svg')).toBeNull();
    expect((btn.textContent ?? '').trim()).toBe(AI_TEXT);
    expect(btn.getAttribute('aria-label')).toBe(AI_LABEL);
    expect(btn.getAttribute('title')).toBe(AI_LABEL);
    expect(btn.className.split(' ')).toContain('sc-topbtn');
    expect(btn.className.split(' ')).not.toContain('sc-iconbtn');
  });

  it('② 关态：面板收起时 aria-pressed=false（开合语义与旧图标钮一致）', async () => {
    const container = await renderApp();
    const btn = aiButton(container);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.ai-chat')).toBeNull();
  });

  it('③ 点击开：aria-pressed 翻 true → 面板出现；面板标题图标仍是同族像素 glyph（眼 4 格）', async () => {
    const container = await renderApp();
    const btn = aiButton(container);

    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));

    const panel = await waitFor(() => {
      const node = container.querySelector('.ai-chat');
      expect(node).not.toBeNull();
      return node!;
    });
    expect(panel).not.toBeNull();
    // 老板 10-06「取消像素风」后（T105-01）：面板标题栏 AiRobot = **线族**同族 glyph，
    // 两态分组（眼/天线）类名契约不破 —— 明暗切换仍由 pixelIcons.css 的 aria-pressed 规则驱动。
    const headSvg = panel.querySelector('.ai-chat__head-icon svg');
    expect(headSvg?.getAttribute('data-line-glyph')).toBe('AiRobot');
    expect(headSvg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(headSvg?.getAttribute('stroke')).toBe('currentColor');
    expect(headSvg?.getAttribute('fill')).toBe('none');
    expect(panel.querySelectorAll('.ai-chat__head-icon .sc-icon__eye').length).toBeGreaterThanOrEqual(1);
    expect(panel.querySelectorAll('.ai-chat__head-icon .sc-icon__antenna').length).toBeGreaterThanOrEqual(1);
  });

  it('④ 再点关：回到关态（aria-pressed=false、面板消失、钮文字不变、钮内始终无 svg）', async () => {
    const container = await renderApp();
    const btn = aiButton(container);

    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(btn);

    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'));
    await waitFor(() => expect(container.querySelector('.ai-chat')).toBeNull());
    expect((btn.textContent ?? '').trim()).toBe(AI_TEXT);
    expect(btn.querySelector('svg')).toBeNull();
  });

  it('⑤ 顶栏全组 = 纯文字钮：无 svg、每个钮可见文字非空、旧 .sc-iconbtn 类不再出现在 actions', async () => {
    const container = await renderApp();
    const actions = container.querySelector('.sc-shell__actions');
    expect(actions).not.toBeNull();
    const buttons = [...actions!.querySelectorAll<HTMLButtonElement>('.sc-topbtn')];
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const button of buttons) {
      const label = button.getAttribute('aria-label') ?? '(无 label)';
      expect(button.querySelector('svg'), `${label} 仍带 svg（老板令：图标去掉）`).toBeNull();
      expect((button.textContent ?? '').trim().length, `${label} 可见文字为空`).toBeGreaterThan(0);
    }
    // 图标钮类已撤出 actions（顶栏左侧折叠钮仍是 .sc-iconbtn，但它在 topbar 直系、不在 actions 内）
    expect(actions!.querySelectorAll('.sc-iconbtn').length).toBe(0);
  });

  it('⑥ AI 钮位置与可访问名不变：仍在搜索钮右侧第 1 位（顺序回归护栏）', async () => {
    const container = await renderApp();
    const labels = [...container.querySelectorAll('.sc-shell__actions .sc-topbtn')].map(
      (node) => node.getAttribute('aria-label') ?? '',
    );
    // T66-01 新语义（PM 改）：房子（工作台入口）插在钮组最前，绝对下标失效；
    // 护栏本意=**相对顺序**：AI 钮紧跟搜索钮右侧（中间不插新钮）。
    const idxSearch = labels.findIndex((l) => l.includes('搜索'));
    expect(idxSearch).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf(AI_LABEL)).toBe(idxSearch + 1);
  });
});