// @vitest-environment jsdom
/**
 * backlinks-panel.test.tsx —— 双链「反向链接」面板组件断言（TASK-T44-01 §1.4）。
 *
 * 覆盖：条目渲染（源页标题 + 上下文片段）、点击跳转到源页（requestBlockJump →
 * openInTab 选中源页）、空态文案、revision 变化防抖重拉（链接增删实时更新）。
 * window.septcats 用 vi.stubGlobal 假桥（纪律同 tabs.test.tsx）。
 * 防抖用 vi.useFakeTimers + advanceTimersByTimeAsync 驱动（断言全用同步查询，
 * 不用 findBy/waitFor——其轮询依赖真定时器，会与假定时器互相卡死）。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BacklinksPanel } from '../src/renderer/src/pages/BacklinksPanel';
import { pagesStore } from '../src/renderer/src/state/pages';

const PAGE_ID = 'pg-target';

const ENTRIES = [
  {
    sourcePageId: 'pg-a',
    sourceTitle: '甲页',
    sourceBlockId: 'bk-a-1',
    context: '前置说明，链接上下文',
  },
  {
    sourcePageId: 'pg-b',
    sourceTitle: '乙页',
    sourceBlockId: 'bk-b-2',
    context: '',
  },
];

describe('BacklinksPanel（反向链接面板）', () => {
  let backlinks: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    backlinks = vi.fn(async () => ({ entries: ENTRIES }));
    vi.stubGlobal('septcats', { links: { backlinks } });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it('列出引用了本页的页面（标题 + 上下文片段），点击跳到源页', async () => {
    render(<BacklinksPanel pageId={PAGE_ID} revision={0} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const items = screen.getAllByTestId('backlinks-item');
    expect(items).toHaveLength(2);
    expect(screen.getByText('甲页')).not.toBeNull();
    expect(screen.getByText('前置说明，链接上下文')).not.toBeNull();
    expect(backlinks).toHaveBeenCalledWith({ pageId: PAGE_ID });
    // 点击 → openInTab 选中源页（无 provider 注册 → pendingJump + 页签路径）
    fireEvent.click(items[0] as Element);
    expect(pagesStore.getState().selectedId).toBe('pg-a');
  });

  it('无引用 → 空态文案（backlinksEmpty）', async () => {
    backlinks = vi.fn(async () => ({ entries: [] }));
    vi.stubGlobal('septcats', { links: { backlinks } });
    render(<BacklinksPanel pageId={PAGE_ID} revision={0} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryAllByTestId('backlinks-item')).toHaveLength(0);
    // 空态走 i18n key（zh 字典文案非空、非原始 key）
    const empty = document.querySelector('.pv-backlinks__empty')?.textContent ?? '';
    expect(empty.length).toBeGreaterThan(0);
    expect(empty).not.toContain('backlinksEmpty');
  });

  it('revision 变化触发防抖重拉（链接增删实时更新）', async () => {
    const { rerender } = render(<BacklinksPanel pageId={PAGE_ID} revision={0} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(backlinks).toHaveBeenCalledTimes(1);
    rerender(<BacklinksPanel pageId={PAGE_ID} revision={1} />);
    // 防抖窗口内不拉
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(backlinks).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(backlinks).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('backlinks-item')).toHaveLength(2);
  });
});
