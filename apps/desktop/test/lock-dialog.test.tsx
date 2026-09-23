// @vitest-environment jsdom
/**
 * lock-dialog.test.tsx —— 加锁/改密/移除 弹层（范围1）用例（TASK-T67-01-B2-01）。
 *
 * 覆盖：set → 两栏口令 + 「恢复码由我保管」必勾 → setPass → 一次性恢复码展示框；
 * change → 当前口令 + 新口令两栏 → changePass；remove → 口令验证 → remove +
 * 解锁当前页（setPageLocked(false)）。口令/恢复码值只在组件 state（内存），
 * 不落 localStorage/日志（grep 自查）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；断言落在 store 状态与假桥调用。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { PageLockDialog } from '../src/renderer/src/pages/PageLockDialog';
import {
  pagesActions,
  pagesStore,
  type PagesState,
} from '../src/renderer/src/state/pages';
import type { SeptcatsApi } from '../src/types/window';

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

const WS_ID = 'ws-t67-lk';

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

interface LockDialogBridge {
  setPass: ReturnType<typeof vi.fn>;
  changePass: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

let lockBridge: LockDialogBridge;

function installLockBridge(): void {
  lockBridge = {
    setPass: vi.fn(async ({ pass }: { pageId: string; pass: string }) => ({ recoveryCode: `RC-${pass}` })),
    changePass: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  vi.stubGlobal('septcats', {
    lock: lockBridge,
  } as unknown as SeptcatsApi);
}

describe('PageLockDialog（范围1 加锁/改密/移除）', () => {
  beforeEach(() => {
    resetPagesStore({
      nodes: [pageNode({ id: 'pg1', title: '机密页' })],
    });
    installLockBridge();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('set：两栏口令 + 必勾 → setPass → 一次性恢复码展示框', async () => {
    pagesActions.openLockDialog('pg1', 'set');
    render(<PageLockDialog />);

    // 未勾「由我保管」→ 提交被拦（不调 setPass）
    fireEvent.change(screen.getByTestId('lock-pass'), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByTestId('lock-new-pass'), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByTestId('lock-confirm-pass'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByTestId('lock-set-button'));
    expect(lockBridge.setPass).not.toHaveBeenCalled();

    // 勾选后提交 → 出现恢复码展示框
    fireEvent.click(screen.getByTestId('lock-keep'));
    fireEvent.click(screen.getByTestId('lock-set-button'));

    const box = await screen.findByTestId('lock-recovery-code');
    expect(box.textContent).toContain('RC-secret123');
    expect(lockBridge.setPass).toHaveBeenCalledWith({ pageId: 'pg1', pass: 'secret123' });
  });

  it('set：确认口令不一致 → 拦截（不调 setPass）', () => {
    pagesActions.openLockDialog('pg1', 'set');
    render(<PageLockDialog />);
    fireEvent.change(screen.getByTestId('lock-pass'), { target: { value: 'aaa111' } });
    fireEvent.change(screen.getByTestId('lock-new-pass'), { target: { value: 'aaa111' } });
    fireEvent.change(screen.getByTestId('lock-confirm-pass'), { target: { value: 'bbb222' } });
    fireEvent.click(screen.getByTestId('lock-keep'));
    fireEvent.click(screen.getByTestId('lock-set-button'));
    expect(lockBridge.setPass).not.toHaveBeenCalled();
    expect(screen.getByTestId('lock-dialog-error')).not.toBeNull();
  });

  it('set 成功 → 我已抄写：setPageLocked(true) + 关弹层', async () => {
    pagesActions.openLockDialog('pg1', 'set');
    render(<PageLockDialog />);
    fireEvent.change(screen.getByTestId('lock-pass'), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByTestId('lock-new-pass'), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByTestId('lock-confirm-pass'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByTestId('lock-keep'));
    fireEvent.click(screen.getByTestId('lock-set-button'));
    await screen.findByTestId('lock-recovery-code');
    fireEvent.click(screen.getByTestId('lock-recovery-ok'));
    await waitFor(() => expect(pagesStore.getState().lockDialog).toBeNull());
    expect(pagesStore.getState().lockedIds.has('pg1')).toBe(true);
  });

  it('change：当前口令 + 新口令两栏 → changePass + 关弹层', async () => {
    pagesActions.openLockDialog('pg1', 'change');
    render(<PageLockDialog />);
    fireEvent.change(screen.getByTestId('lock-current-pass'), { target: { value: 'oldpass1' } });
    fireEvent.change(screen.getByTestId('lock-new-pass'), { target: { value: 'newpass1' } });
    fireEvent.change(screen.getByTestId('lock-confirm-pass'), { target: { value: 'newpass1' } });
    fireEvent.click(screen.getByTestId('lock-change-button'));
    await waitFor(() => expect(lockBridge.changePass).toHaveBeenCalledWith({
      pageId: 'pg1',
      oldPass: 'oldpass1',
      newPass: 'newpass1',
    }));
    expect(pagesStore.getState().lockDialog).toBeNull();
  });

  it('remove：口令验证 → remove + 解锁当前页（setPageLocked(false)）', async () => {
    pagesStore.setState((state) => ({ ...state, lockedIds: new Set(['pg1']) }));
    pagesActions.openLockDialog('pg1', 'remove');
    render(<PageLockDialog />);
    fireEvent.change(screen.getByTestId('lock-pass'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByTestId('lock-remove-button'));
    await waitFor(() => expect(lockBridge.remove).toHaveBeenCalledWith({
      pageId: 'pg1',
      pass: 'secret123',
    }));
    expect(pagesStore.getState().lockedIds.has('pg1')).toBe(false);
    expect(pagesStore.getState().lockDialog).toBeNull();
  });
});
