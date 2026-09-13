import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';


describe('Skeleton', () => {
  it('单块：props 透传到 width/height，装饰性 aria-hidden', () => {
    const { container } = render(<Skeleton width={320} height={20} />);
    const root = container.querySelector('.sc-skeleton') as HTMLElement;
    const bar = container.querySelector('.sc-skeleton__bar') as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(bar.style.width).toBe('320px');
    expect(bar.style.height).toBe('20px');
    expect(container.querySelector('.sc-skeleton--stack')).toBeNull();
    expectTokenOnlyCssFile('src/Skeleton.css');
  });

  it('多行：最后一行收窄 60%（形似段落）', () => {
    const { container } = render(<Skeleton lines={3} />);
    const bars = [...container.querySelectorAll('.sc-skeleton__bar')] as HTMLElement[];
    expect(bars).toHaveLength(3);
    expect(container.querySelector('.sc-skeleton--stack')).not.toBeNull();
    expect(bars[2]?.style.width).toBe('60%');
  });

  it('lines 非法值退化为 1 行', () => {
    const { container } = render(<Skeleton lines={0} />);
    expect(container.querySelectorAll('.sc-skeleton__bar')).toHaveLength(1);
  });
});
