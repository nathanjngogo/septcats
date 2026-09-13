import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';


describe('Switch', () => {
  it('role=switch + aria-checked 反映状态', () => {
    const { rerender } = render(<Switch checked={false} label="自动保存" />);
    const control = screen.getByRole('switch', { name: '自动保存' });
    expect(control.getAttribute('aria-checked')).toBe('false');

    rerender(<Switch checked label="自动保存" />);
    expect(screen.getByRole('switch', { name: '自动保存' }).getAttribute('aria-checked')).toBe('true');
    expectTokenOnlyCssFile('src/Switch.css');
  });

  it('点击回调携带取反后的值；原生 button 保证键盘可操作', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="自动保存" />);
    const control = screen.getByRole('switch') as HTMLButtonElement;
    expect(control.tagName).toBe('BUTTON');
    expect(control.getAttribute('type')).toBe('button');
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('disabled：不可触发', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="自动保存" disabled />);
    const control = screen.getByRole('switch') as HTMLButtonElement;
    expect(control.disabled).toBe(true);
    fireEvent.click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
