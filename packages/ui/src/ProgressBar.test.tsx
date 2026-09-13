import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar';


describe('ProgressBar', () => {
  it('progressbar 语义 + 越界夹取', () => {
    const { rerender, container } = render(<ProgressBar value={42} label="同步进度" />);
    const bar = screen.getByRole('progressbar', { name: '同步进度' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect((container.querySelector('.sc-progress__fill') as HTMLElement).style.transform).toBe(
      'scaleX(0.42)',
    );

    rerender(<ProgressBar value={180} label="同步进度" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');

    rerender(<ProgressBar value={-5} label="同步进度" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expectTokenOnlyCssFile('src/ProgressBar.css');
  });
});
