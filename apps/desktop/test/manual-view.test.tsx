// @vitest-environment jsdom
/**
 * manual-view.test.tsx —— 使用说明书视图单测（TASK-T56-01 §1②③⑤）。
 *
 * 两条线：
 * 1) **ManualView 组件**（真实语料：manualContent 经构建期 `?raw` 内联的
 *    docs/manual/*.md）——渲染章节锚点 + 正文（含表格/行内码）、锚点跳转调
 *    scrollIntoView、折叠钮收起章表、Esc / 关闭钮回调、切 English 文案随动。
 * 2) **App 视图状态机**——main 推 `menu:action {helpManual}` → 说明书视图出现
 *    （editor/settings/import 同族的第四态）；Esc → 回 editor 视图。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥（不 import electron）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { App } from '../src/renderer/src/App';
import { ManualView } from '../src/renderer/src/manual/ManualView';
import { setLocale } from '../src/renderer/src/i18n';
import { layoutActions, layoutStore, makeDefaultLayout } from '../src/renderer/src/layout/layoutState';
import { aiChatActions } from '../src/renderer/src/ai/chatState';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import type { AppSettings } from '../src/shared/settings';
import type { MenuActionId } from '../src/shared/ipc';
import type { SeptcatsApi } from '../src/types/window';

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}
const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

const here = dirname(fileURLToPath(import.meta.url));
/** docs/manual 的真实章节数（锚点数量断言基线，不写死数字）。 */
function sectionTitles(name: string): string[] {
  const md = readFileSync(join(here, '..', '..', '..', 'docs', 'manual', name), 'utf8');
  return md
    .split(/\r?\n/)
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLocale('zh-CN');
  scrollIntoView.mockClear();
});

// ---------------------------------------------------------------------------
// ① ManualView 组件（真实语料）
// ---------------------------------------------------------------------------

describe('ManualView 组件（T56-01 §1②）', () => {
  it('渲染：顶栏标题 + 章节锚点表（数量=真实章节数）+ 正文命中章节标题', () => {
    render(<ManualView onClose={() => undefined} />);
    expect(screen.getByTestId('manual-view')).toBeTruthy();
    expect(screen.getByText('使用说明书')).toBeTruthy();
    const anchors = sectionTitles('manual.zh.md');
    expect(screen.getByTestId('manual-anchors').querySelectorAll('button')).toHaveLength(anchors.length);
    // 章节标题在锚点表与正文各出现一次（同名文本 → 按容器分区断言）
    const nav = within(screen.getByTestId('manual-anchors'));
    const content = within(screen.getByTestId('manual-content'));
    expect(nav.getByText('数据库视图')).toBeTruthy();
    expect(content.getByText('数据库视图')).toBeTruthy();
    expect(content.getByText('快速上手')).toBeTruthy();
  });

  it('正文渲染表格与行内码（快捷键总表：th 成对出现、代码片断成 <code>）', () => {
    const { container } = render(<ManualView onClose={() => undefined} />);
    const headers = [...container.querySelectorAll('.manual-view__table th')].map((th) => th.textContent);
    expect(headers).toContain('快捷键');
    expect(headers).toContain('功能');
    const inlineCodes = [...container.querySelectorAll('.manual-view__code-inline')].map((code) => code.textContent);
    expect(inlineCodes).toContain('Ctrl+K');
    expect(inlineCodes).toContain('Ctrl+W');
  });

  it('锚点点击 → 目标章节命中 DOM 且 scrollIntoView 被调用（active 标记随动）', () => {
    render(<ManualView onClose={() => undefined} />);
    // 目标章节位置由真实语料推导（不写死序号）
    const index = sectionTitles('manual.zh.md').indexOf('数据库视图');
    const sectionId = `section-${String(index + 1)}`;
    const anchor = screen.getByTestId(`manual-anchor-${sectionId}`);
    expect(anchor.textContent).toBe('数据库视图');
    fireEvent.click(anchor);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(`manual-section-${sectionId}`)).toBeTruthy();
    expect(anchor.getAttribute('aria-current')).toBe('true');
  });

  it('折叠钮收起章表（根类名切换 + aria-expanded=false），再点展开', () => {
    render(<ManualView onClose={() => undefined} />);
    const toggle = screen.getByTestId('manual-anchors-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('manual-view').className).not.toContain('manual-view--collapsed');
    fireEvent.click(toggle);
    expect(screen.getByTestId('manual-view').className).toContain('manual-view--collapsed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('manual-view').className).not.toContain('manual-view--collapsed');
  });

  it('Esc 与关闭钮 → onClose（各触发一次）', () => {
    const onClose = vi.fn();
    render(<ManualView onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('manual-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('切 English：标题/正文/章节随动（en 语料 + i18n 键）', () => {
    render(<ManualView onClose={() => undefined} />);
    act(() => {
      setLocale('en-US');
    });
    expect(screen.getByText('User Manual')).toBeTruthy();
    const content = within(screen.getByTestId('manual-content'));
    expect(content.getByText('Getting Started')).toBeTruthy();
    expect(content.getByText('Database View')).toBeTruthy();
    // 章节数不随语言变化（锚点同构）
    expect(screen.getByTestId('manual-anchors').querySelectorAll('button')).toHaveLength(
      sectionTitles('manual.en.md').length,
    );
  });
});

// ---------------------------------------------------------------------------
// ② App 视图状态机（menu:action helpManual / Esc 回 editor）
// ---------------------------------------------------------------------------

const WS_ID = 'ws-t56-test';

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
    sync: { enabled: true, encrypt: false, gc: false },
    ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] },
  };
}

/** 假桥 + 捕获 menu:action 监听（App 挂载时订阅）。 */
function installAppBridge(): { emitMenu: (action: MenuActionId) => void } {
  let menuListener: ((payload: { action: MenuActionId }) => void) | null = null;
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
    menu: {
      onAction: vi.fn((listener: (payload: { action: MenuActionId }) => void) => {
        menuListener = listener;
        return () => {
          menuListener = null;
        };
      }),
    },
    close: { onFlushRequest: vi.fn(() => () => {}), flushAck: vi.fn(), onAsk: vi.fn(() => () => {}), decide: vi.fn() },
  } as unknown as SeptcatsApi);
  return {
    emitMenu: (action) => {
      act(() => {
        menuListener?.({ action });
      });
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  layoutActions.init();
  aiChatActions.setOpen(false);
});

describe('T56-01 App 视图状态机：说明书视图（menu:action / Esc）', () => {
  it('menu:action helpManual → 说明书视图出现（编辑区分支让位）+ 面包屑为说明书', async () => {
    const { emitMenu } = installAppBridge();
    resetPagesStore();
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());
    expect(screen.queryByTestId('manual-view')).toBeNull();

    emitMenu('helpManual');
    await waitFor(() => expect(screen.queryByTestId('manual-view')).not.toBeNull());
    // 编辑列（标签条 + 编辑器）让位；面包屑切「使用说明书」
    expect(container.querySelector('.app-editor-col')).toBeNull();
    expect(container.querySelector('.sc-shell__crumb')?.textContent).toContain('使用说明书');
  });

  it('说明书视图内 Esc → 回 editor 视图（编辑列回归、说明书卸载）', async () => {
    const { emitMenu } = installAppBridge();
    resetPagesStore({ tabs: ['pg-1'] });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.sc-shell')).not.toBeNull());

    emitMenu('helpManual');
    await waitFor(() => expect(screen.queryByTestId('manual-view')).not.toBeNull());

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('manual-view')).toBeNull());
    expect(container.querySelector('.app-editor-col')).not.toBeNull();
  });
});
