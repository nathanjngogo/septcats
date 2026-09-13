import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MAX_VISIBLE_TOASTS, ToastViewport } from './Toast';


const four = [
  { id: 't1', message: '已保存', tone: 'success' as const },
  { id: 't2', message: '正在同步', tone: 'info' as const },
  { id: 't3', message: '同步失败，可重试', tone: 'danger' as const },
  { id: 't4', message: '冲突副本已生成', tone: 'danger' as const },
];

describe('Toast', () => {
  it('队列上限 3：只渲染最近三条，role=status 播报', () => {
    const { container } = render(<ToastViewport toasts={four} />);
    expect(MAX_VISIBLE_TOASTS).toBe(3);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    const items = [...container.querySelectorAll('.sc-toast__item')];
    expect(items).toHaveLength(3);
    expect(items.map((node) => node.textContent)).toEqual([
      '正在同步',
      '同步失败，可重试',
      '冲突副本已生成',
    ]);
    expectTokenOnlyCssFile('src/Toast.css');
  });

  it('每条带语义色与可关闭按钮；tone 缺省为 info', () => {
    const onDismiss = vi.fn();
    const { container } = render(<ToastViewport toasts={[{ id: 'a', message: '尚未调用' }]} onDismiss={onDismiss} />);
    expect(container.querySelector('.sc-toast__item--info')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：尚未调用' }));
    expect(onDismiss).toHaveBeenCalledWith('a');
  });
});
