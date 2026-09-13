import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';


describe('Spinner', () => {
  it('只做图标级等待：role=status + 可访问名；尺寸走档位类', () => {
    const { container } = render(<Spinner size="sm" label="保存中" />);
    const node = screen.getByRole('status', { name: '保存中' });
    expect(node.getAttribute('class')).toContain('sc-spinner--sm');
    expect(container.querySelector('.sc-spinner')).not.toBeNull();
    expectTokenOnlyCssFile('src/Spinner.css');
  });

  it('缺省 sm 档，可切 md；缺省可访问名为「加载中」', () => {
    const { container, rerender } = render(<Spinner />);
    expect(container.querySelector('.sc-spinner--sm')).not.toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('加载中');

    rerender(<Spinner size="md" />);
    expect(container.querySelector('.sc-spinner--md')).not.toBeNull();
  });
});
