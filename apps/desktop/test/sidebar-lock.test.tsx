// @vitest-environment jsdom
/**
 * sidebar-lock.test.tsx —— 侧栏锁 glyph（范围1）用例（TASK-T67-01-B2-01）。
 *
 * 覆盖：已上锁页（lockedIds 含 id）→ 普通树行 / 收藏 / 最近 分组行均出像素锁 glyph
 * （app-nav-lock-glyph）；未锁页不出 glyph。口令/恢复码值不经由侧栏（grep 自查）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥（仅渲染所需最小桥）；断言落在 DOM class。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import type { SeptcatsApi } from '../src/types/window';

const WS_ID = 'ws-t67-side';

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
    nodes: [],
    expanded: new Set<string>(),
    selectedId: null,
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    deleteConfirmId: null,
    lockedIds: new Set<string>(),
    lockDialog: null,
    lockRev: 0,
    ...extra,
  }));
}

describe('SidebarTree 锁 glyph（范围1）', () => {
  beforeEach(() => {
    resetPagesStore({
      nodes: [
        pageNode({ id: 'pg-lk', title: '机密页', sortKey: 'A00000000' }),
        pageNode({ id: 'pg-plain', title: '普通页', sortKey: 'A00000001' }),
      ],
      lockedIds: new Set(['pg-lk']),
    });
    vi.stubGlobal('septcats', {} as unknown as SeptcatsApi);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('普通树行：已锁页出 glyph、未锁页不出', () => {
    render(<SidebarTree />);
    const lockedRow = screen.getByTestId('side-node-pg-lk');
    const plainRow = screen.getByTestId('side-node-pg-plain');
    expect(lockedRow.querySelector('.app-nav-lock-glyph')).not.toBeNull();
    expect(plainRow.querySelector('.app-nav-lock-glyph')).toBeNull();
  });

  it('收藏分组行：已锁页出 glyph', () => {
    resetPagesStore({
      nodes: [
        pageNode({ id: 'pg-lk', title: '机密页', sortKey: 'A00000000' }),
        pageNode({ id: 'pg-plain', title: '普通页', sortKey: 'A00000001' }),
      ],
      favoriteIds: ['pg-lk', 'pg-plain'],
      lockedIds: new Set(['pg-lk']),
    });
    render(<SidebarTree />);
    // 收藏分组默认折叠 → 先展开
    fireEvent.click(screen.getByTestId('side-favorites'));
    const favRow = screen.getByTestId('side-favorites-item-0');
    expect(favRow.querySelector('.app-nav-lock-glyph')).not.toBeNull();

    const plainFav = screen.getByTestId('side-favorites-item-1');
    expect(plainFav.querySelector('.app-nav-lock-glyph')).toBeNull();
  });

  it('最近分组行：已锁页出 glyph', () => {
    resetPagesStore({
      nodes: [
        pageNode({ id: 'pg-lk', title: '机密页', sortKey: 'A00000000' }),
        pageNode({ id: 'pg-plain', title: '普通页', sortKey: 'A00000001' }),
      ],
      recentIds: ['pg-lk', 'pg-plain'],
      lockedIds: new Set(['pg-lk']),
    });
    render(<SidebarTree />);
    // 最近分组默认折叠 → 先展开
    fireEvent.click(screen.getByTestId('side-recent'));
    const recentRow = screen.getByTestId('side-recent-item-0');
    expect(recentRow.querySelector('.app-nav-lock-glyph')).not.toBeNull();

    const plainRecent = screen.getByTestId('side-recent-item-1');
    expect(plainRecent.querySelector('.app-nav-lock-glyph')).toBeNull();
  });
});
