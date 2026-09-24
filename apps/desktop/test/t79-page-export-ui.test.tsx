// @vitest-environment jsdom
/**
 * t79-page-export-ui.test.tsx —— TASK-T79-01 §C 装配层用例（页面导出入口 + scope 对话框）。
 *
 * 覆盖：行菜单「导出为 Markdown…」（`page-export-menu`）→ 无子页直接单页导出；
 * 有子页弹 scope（`page-export-scope` / `page-export-single` / `page-export-subtree`）
 * → 确认（`page-export-confirm`）按所选 scope 调 confirm；取消（canceled）→ info toast
 * 无落盘；成功 → success toast 挂 `page-export-toast` 并 reveal；i18n 成对（en）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastViewport } from '@septcats/ui';
import type { PageNode } from '@septcats/editor';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import { PageExportDialog } from '../src/renderer/src/pages/PageExportDialog';
import { pagesStore, usePages, type PagesState } from '../src/renderer/src/state/pages';
import { setLocale } from '../src/renderer/src/i18n';
import type { SeptcatsApi } from '../src/types/window';

const WS_ID = 'ws-t79-ui';

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
    pageNode({ id: 'pg-root', title: '研究', childIds: ['pg-a'] }),
    pageNode({ id: 'pg-a', title: '子页', parentId: 'pg-root', depth: 1, sortKey: 'A00000001' }),
  ];
}

const SUCCESS = {
  canceled: false as const,
  rootName: '研究',
  dir: '/tmp/export/研究',
  pages: [],
  files: [],
  counts: { pages: 2, markdown: 2, assets: 1, orphans: 0 },
  totalBytes: 10,
};

let nodesDb: PageNode[] = [];
let confirmMock: ReturnType<typeof vi.fn>;
let revealMock: ReturnType<typeof vi.fn>;

function installBridge(): void {
  confirmMock = vi.fn(async () => SUCCESS);
  revealMock = vi.fn(async () => ({ ok: true as const }));
  vi.stubGlobal('septcats', {
    workspaces: { list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }) },
    pages: { tree: async () => nodesDb.map((node) => ({ ...node, childIds: [...node.childIds] })) },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: async () => ({ pageIds: [] }) },
    pageExport: {
      preview: vi.fn(async () => ({
        rootName: '研究',
        pages: [],
        files: [{ relPath: '研究.md', kind: 'markdown' as const, bytes: 0 }],
        counts: { pages: 1, markdown: 1, assets: 0, orphans: 0 },
        totalBytes: 0,
      })),
      confirm: confirmMock,
      reveal: revealMock,
    },
  } as unknown as SeptcatsApi);
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
    expanded: new Set<string>(['pg-root']),
    selectedId: 'pg-root',
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    exportDialog: null,
    ...extra,
  }));
}

function ToastHarness(): JSX.Element {
  const toasts = usePages((state) => state.toasts);
  return <ToastViewport toasts={toasts} />;
}

function renderApp(): void {
  render(
    <>
      <SidebarTree />
      <PageExportDialog />
      <ToastHarness />
    </>,
  );
}

function openRowMenu(id: string): HTMLElement {
  fireEvent.click(screen.getByTestId(`side-more-${id}`));
  // 不按 label 过滤（locale 下 label 会变）：同一时刻仅行菜单一个
  return screen.getByRole('menu');
}

function clickExport(id: string): void {
  fireEvent.click(within(openRowMenu(id)).getByTestId('page-export-menu'));
}

beforeEach(() => {
  nodesDb = makeNodes();
  installBridge();
  setLocale('zh-CN');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('T79-01 §C 页面导出行菜单入口', () => {
  it('行菜单含「导出为 Markdown…」项（page-export-menu）', () => {
    seedStore();
    renderApp();
    const menu = openRowMenu('pg-a');
    expect(within(menu).getByTestId('page-export-menu').textContent).toContain('导出为 Markdown');
  });

  it('无子页 → 开预览对话框（无 scope 选项）；确认 → confirm(single)', async () => {
    seedStore();
    renderApp();
    clickExport('pg-a');

    expect(screen.getByTestId('page-export-scope')).toBeTruthy();
    // 无子页 → 不给 scope 选项
    expect(screen.queryByTestId('page-export-single')).toBeNull();
    expect(screen.queryByTestId('page-export-subtree')).toBeNull();
    // 预览列文件名（只读）
    await waitFor(() => {
      expect(screen.getByTestId('page-export-preview').textContent).toContain('研究.md');
    });

    fireEvent.click(screen.getByTestId('page-export-confirm'));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith({ pageId: 'pg-a', scope: 'single' });
    });
  });

  it('有子页 → 弹 scope 对话框；选「含子页」→ confirm(scope=subtree)', async () => {
    seedStore();
    renderApp();
    clickExport('pg-root');

    expect(screen.getByTestId('page-export-scope')).toBeTruthy();
    expect(screen.getByTestId('page-export-single')).toBeTruthy();
    expect(screen.getByTestId('page-export-subtree')).toBeTruthy();

    fireEvent.click(screen.getByTestId('page-export-subtree'));
    fireEvent.click(screen.getByTestId('page-export-confirm'));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith({ pageId: 'pg-root', scope: 'subtree' });
    });
  });

  it('成功 → success toast 挂 page-export-toast 并 reveal', async () => {
    seedStore();
    renderApp();
    clickExport('pg-root');
    fireEvent.click(screen.getByTestId('page-export-single'));
    fireEvent.click(screen.getByTestId('page-export-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('page-export-toast')).toBeTruthy();
    });
    await waitFor(() => {
      expect(revealMock).toHaveBeenCalledWith({ dir: SUCCESS.dir });
    });
  });

  it('用户取消目录选择（canceled）→ info toast，无 page-export-toast', async () => {
    confirmMock.mockResolvedValueOnce({ canceled: true });
    seedStore();
    renderApp();
    clickExport('pg-a');
    fireEvent.click(screen.getByTestId('page-export-confirm'));

    await waitFor(() => {
      expect(screen.getByText('已取消导出')).toBeTruthy();
    });
    expect(screen.queryByTestId('page-export-toast')).toBeNull();
    expect(revealMock).not.toHaveBeenCalled();
  });

  it('失败 → danger toast（导出失败：…）', async () => {
    confirmMock.mockRejectedValueOnce(new Error('E_INVARIANT: 服务不可用'));
    seedStore();
    renderApp();
    clickExport('pg-a');
    fireEvent.click(screen.getByTestId('page-export-confirm'));

    await waitFor(() => {
      expect(screen.getByText(/导出失败/)).toBeTruthy();
    });
  });

  it('i18n：en-US 入口/对话框文案成对', () => {
    setLocale('en-US');
    seedStore();
    renderApp();
    const menu = openRowMenu('pg-root');
    expect(within(menu).getByTestId('page-export-menu').textContent).toContain('Export as Markdown');

    fireEvent.click(within(menu).getByTestId('page-export-menu'));
    expect(screen.getByTestId('page-export-scope')).toBeTruthy();
    expect(screen.getByTestId('page-export-single').textContent).toContain('This page only');
    expect(screen.getByTestId('page-export-subtree').textContent).toContain('Include subpages');
  });
});
