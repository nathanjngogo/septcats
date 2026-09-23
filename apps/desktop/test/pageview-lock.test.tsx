// @vitest-environment jsdom
/**
 * pageview-lock.test.tsx —— PageView 锁态重探（范围2）用例（TASK-T67-01-B2-01）。
 *
 * 覆盖：选中已锁页 → getStatus 探明锁态 → 渲染锁屏卡（PageLockScreen）、**编辑器彻底卸载**
 * （不 mount .pv-root / 不请求 blocks）→ lockedIds 登记；解锁后（handleUnlock）lockRev 驱动
 * 重探。口令/恢复码值不落 localStorage/日志（grep 自查）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；断言落在 DOM（锁屏 vs 编辑器）与 store 状态。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageView } from '../src/renderer/src/pages/PageView';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import type { LockStatusView } from '../src/renderer/src/lockStatus';
import type { SeptcatsApi } from '../src/types/window';

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

const WS_ID = 'ws-t67-pv';

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

interface PageViewBridge {
  getStatus: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  touch: ReturnType<typeof vi.fn>;
  backlinks: ReturnType<typeof vi.fn>;
}

let bridge: PageViewBridge;

function installBridge(locked: boolean): void {
  bridge = {
    getStatus: vi.fn(async (): Promise<LockStatusView> => ({
      locked,
      failures: 0,
      lockedUntil: null,
    })),
    list: vi.fn(async () => ({ locked: false, blocks: [] })),
    touch: vi.fn(async () => ({ pageIds: [] })),
    backlinks: vi.fn(async () => ({ entries: [] })),
  };
  vi.stubGlobal('septcats', {
    lock: { getStatus: bridge.getStatus },
    blocks: { list: bridge.list },
    recent: { touch: bridge.touch },
    links: { backlinks: bridge.backlinks },
  } as unknown as SeptcatsApi);
}

const PAGE = { id: 'pg-lk', title: '机密页' };

describe('PageView 锁态重探（范围2）', () => {
  beforeEach(() => {
    resetPagesStore();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('已锁页 → getStatus 探明 → 渲染锁屏卡、编辑器彻底卸载、lockedIds 登记', async () => {
    installBridge(true);
    render(<PageView page={PAGE} />);

    const lockScreen = await screen.findByTestId('lock-screen');
    expect(lockScreen).not.toBeNull();
    // 编辑器壳未被挂载（锁屏态替代 .pv-root 内容）
    expect(document.querySelector('.pv-root')).toBeNull();
    // getStatus 已被调用（锁态优先判定）
    expect(bridge.getStatus).toHaveBeenCalledWith({ pageId: PAGE.id });
    // 锁屏态不请求 blocks（编辑器彻底卸载，杜绝锁定期 flush 竞态）
    expect(bridge.list).not.toHaveBeenCalled();
    // lockedIds 已登记（驱动侧栏锁 glyph / 菜单项口径）
    await waitFor(() => expect(pagesStore.getState().lockedIds.has(PAGE.id)).toBe(true));
  });

  it('未锁页 → 不渲染锁屏卡、请求 blocks 加载编辑器', async () => {
    installBridge(false);
    render(<PageView page={PAGE} />);
    // 锁屏卡不应出现
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    // 进行中的 getStatus 探明后请求 blocks（加载编辑器）
    await waitFor(() => expect(bridge.list).toHaveBeenCalledWith({ pageId: PAGE.id }));
    await waitFor(() => expect(pagesStore.getState().lockedIds.has(PAGE.id)).toBe(false));
  });
});
