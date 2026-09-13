import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GearSix, MagnifyingGlass } from './Icon';
import { IconButton } from './IconButton';


describe('IconButton', () => {
  it('以 label 作为可访问名与 title；图标走 Icon 出口', () => {
    const { container } = render(<IconButton icon={MagnifyingGlass} label="搜索（Ctrl+K）" />);
    const button = screen.getByRole('button', { name: '搜索（Ctrl+K）' });
    expect(button.getAttribute('title')).toBe('搜索（Ctrl+K）');
    expect(button.getAttribute('type')).toBe('button');
    expect(container.querySelector('.sc-icon')).not.toBeNull();
    expectTokenOnlyCssFile('src/IconButton.css');
  });

  it('点击可用；disabled 时不可触发', () => {
    const onClick = vi.fn();
    const { rerender } = render(<IconButton icon={GearSix} label="设置" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<IconButton icon={GearSix} label="设置" onClick={onClick} disabled />);
    const disabled = screen.getByRole('button', { name: '设置' }) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    fireEvent.click(disabled);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
