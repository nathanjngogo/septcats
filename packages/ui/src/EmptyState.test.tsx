import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';


describe('EmptyState', () => {
  it('插画位 + 一句 + 主按钮（同屏唯一 primary）', () => {
    const onAction = vi.fn();
    const { container } = render(
      <EmptyState
        title="还没有页面"
        description="新建一个页面开始记录。"
        actionLabel="新建页面"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('还没有页面').tagName).toBe('H3');
    expect(container.querySelector('.sc-empty__art')).not.toBeNull();
    const action = screen.getByRole('button', { name: '新建页面' });
    expect(action.getAttribute('class')).toContain('sc-btn--primary');
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expectTokenOnlyCssFile('src/EmptyState.css');
  });

  it('未给 actionLabel 时不渲染按钮；illustration 可替换默认占位', () => {
    const { container } = render(
      <EmptyState title="回收站为空" illustration={<span data-testid="art">自定义</span>} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('art')).not.toBeNull();
    expect(container.querySelector('.sc-empty__desc')).toBeNull();
  });
});
