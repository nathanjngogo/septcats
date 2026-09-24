import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  BlockControls,
  DEFAULT_BLOCK_MENU_LABELS,
  formatBulkCount,
} from '../src/react/BlockControls';

/**
 * T78-01：BlockControls 多选态菜单变体（批量删除 / 批量复制 / 批量转为 / 颜色 / 计数区）
 * 与 Shift+click 扩选意图透传；单块菜单行为逐位不变（零回归）。
 */

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: '块操作' }));
}

describe('formatBulkCount（{n} 占位替换）', () => {
  it('替换占位符；无占位符原样返回', () => {
    expect(formatBulkCount('已选 {n} 块', 3)).toBe('已选 3 块');
    expect(formatBulkCount('{n} blocks selected', 12)).toBe('12 blocks selected');
    expect(formatBulkCount('已选多块', 3)).toBe('已选多块');
  });

  it('默认文案模板自带 {n}（i18n 缺省回落的可断言性）', () => {
    expect(DEFAULT_BLOCK_MENU_LABELS.bulkCount).toContain('{n}');
  });
});

describe('BlockControls 单块菜单（零回归守门）', () => {
  it('selectionCount 缺省 → 单块菜单：无批量项、删除/复制走原意图', () => {
    const onAction = vi.fn();
    render(<BlockControls blockId="blk-1" onAction={onAction} />);
    openMenu();
    expect(screen.queryByTestId('block-menu-bulk-count')).toBeNull();
    expect(screen.queryByTestId('block-menu-bulk-delete')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /^删除/ }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'delete' });
  });

  it('selectionCount=1 仍走单块菜单（单块=选区大小 1）', () => {
    render(<BlockControls blockId="blk-1" onAction={() => {}} selectionCount={1} />);
    openMenu();
    expect(screen.queryByTestId('block-menu-bulk-delete')).toBeNull();
  });

  it('普通点击（本块不在选区）：调 onCollapseSelection（回单块态），不调 onExtendSelection', () => {
    const onCollapseSelection = vi.fn();
    const onExtendSelection = vi.fn();
    render(
      <BlockControls
        blockId="blk-1"
        onAction={() => {}}
        onCollapseSelection={onCollapseSelection}
        onExtendSelection={onExtendSelection}
      />,
    );
    openMenu();
    expect(onCollapseSelection).toHaveBeenCalledTimes(1);
    expect(onExtendSelection).not.toHaveBeenCalled();
  });

  it('普通点击（本块在选区内）：保留选区 + 开批量菜单，不调 onCollapseSelection', () => {
    const onCollapseSelection = vi.fn();
    render(
      <BlockControls
        blockId="blk-1"
        onAction={() => {}}
        selectionCount={4}
        handleInSelection
        onCollapseSelection={onCollapseSelection}
      />,
    );
    openMenu();
    expect(onCollapseSelection).not.toHaveBeenCalled();
    expect(screen.getByTestId('block-menu-bulk-count').textContent).toBe('已选 4 块');
  });
});

describe('BlockControls 多选态菜单变体（selectionCount >= 2）', () => {
  it('计数区 + 批量删/复制挂契约 testid；菜单无单块删除项', () => {
    render(<BlockControls blockId="blk-1" onAction={() => {}} selectionCount={5} />);
    openMenu();
    expect(screen.getByTestId('block-menu-bulk-count').textContent).toBe('已选 5 块');
    expect(screen.getByTestId('block-menu-bulk-delete')).not.toBeNull();
    expect(screen.getByTestId('block-menu-bulk-duplicate')).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^删除/ })).toBeNull();
  });

  it('批量转为：13 型全挂 block-menu-bulk-convert-<type>（标题 1/2/3 共用 heading，data-level 区分）', () => {
    render(<BlockControls blockId="blk-1" onAction={() => {}} selectionCount={3} />);
    openMenu();
    const headings = screen.getAllByTestId('block-menu-bulk-convert-heading');
    expect(headings.map((el) => el.getAttribute('data-level'))).toEqual(['1', '2', '3']);
    // 13 型 = 11 文本/标题×3/列表×3/引用/代码/分割线/图片 + 表格 + 折叠列表
    const convertCount = screen
      .getAllByRole('menuitem')
      .filter((el) => (el.getAttribute('data-testid') ?? '').startsWith('block-menu-bulk-convert-')).length;
    expect(convertCount).toBe(13);
    expect(screen.getByTestId('block-menu-bulk-convert-table')).not.toBeNull();
    expect(screen.getByTestId('block-menu-bulk-convert-toggle')).not.toBeNull();
  });

  it('颜色组：5 档全挂 block-menu-bulk-color-<token>', () => {
    render(<BlockControls blockId="blk-1" onAction={() => {}} selectionCount={2} />);
    openMenu();
    for (const token of ['default', 'accent', 'danger', 'success', 'faint']) {
      expect(screen.getByTestId(`block-menu-bulk-color-${token}`)).not.toBeNull();
    }
  });

  it('点批量项 → 发批量意图（删/复制/转/色 各一）', () => {
    const onAction = vi.fn();
    const { rerender } = render(<BlockControls blockId="blk-1" onAction={onAction} selectionCount={4} />);
    openMenu();
    fireEvent.click(screen.getByTestId('block-menu-bulk-delete'));
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'bulk-delete' });

    rerender(<BlockControls blockId="blk-1" onAction={onAction} selectionCount={4} />);
    openMenu();
    fireEvent.click(screen.getByTestId('block-menu-bulk-duplicate'));
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'bulk-duplicate' });

    rerender(<BlockControls blockId="blk-1" onAction={onAction} selectionCount={4} />);
    openMenu();
    fireEvent.click(screen.getAllByTestId('block-menu-bulk-convert-heading')[1]!);
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'bulk-convert', blockType: 'heading', level: 2 });

    rerender(<BlockControls blockId="blk-1" onAction={onAction} selectionCount={4} />);
    openMenu();
    fireEvent.click(screen.getByTestId('block-menu-bulk-color-accent'));
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'bulk-color', token: 'accent' });
  });

  it('Shift+click 手柄 → onExtendSelection(blockId)，**不**开菜单（保手柄可续移，二次扩选可达）', () => {
    const onExtendSelection = vi.fn();
    const onCollapseSelection = vi.fn();
    render(
      <BlockControls
        blockId="blk-7"
        onAction={() => {}}
        selectionCount={2}
        onExtendSelection={onExtendSelection}
        onCollapseSelection={onCollapseSelection}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '块操作' }), { shiftKey: true });
    expect(onExtendSelection).toHaveBeenCalledWith('blk-7');
    expect(onCollapseSelection).not.toHaveBeenCalled();
    expect(screen.queryByTestId('block-menu-bulk-count')).toBeNull();
    // 再普通点击（本块已在选区）→ 批量菜单开出
    fireEvent.click(screen.getByRole('button', { name: '块操作' }));
    expect(screen.getByTestId('block-menu-bulk-count')).not.toBeNull();
  });

  it('文案注入（i18n 成对通道）：labels 覆盖计数/删/复制；缺键回落包内中文', () => {
    render(
      <BlockControls
        blockId="blk-1"
        onAction={() => {}}
        selectionCount={6}
        labels={{ bulkCount: '{n} blocks selected', bulkDelete: 'Delete selected' }}
      />,
    );
    openMenu();
    expect(screen.getByTestId('block-menu-bulk-count').textContent).toBe('6 blocks selected');
    expect(screen.getByTestId('block-menu-bulk-delete').textContent).toContain('Delete selected');
    // 缺键回落默认中文
    expect(screen.getByTestId('block-menu-bulk-duplicate').textContent).toContain(
      DEFAULT_BLOCK_MENU_LABELS.bulkDuplicate,
    );
  });

  it('手柄挂可寻址 testid（真机探针锚点）', () => {
    const { container } = render(<BlockControls blockId="blk-9" onAction={() => {}} />);
    expect(container.querySelector('[data-testid="block-handle-blk-9"]')).not.toBeNull();
  });
});
