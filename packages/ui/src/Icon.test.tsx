import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Check, Icon, ICON_SIZES, ICON_STROKE_WIDTH, resolveIconSize } from './Icon';


describe('Icon', () => {
  it('单一出口：默认装饰性（aria-hidden）且 strokeWidth 固定 1.5', () => {
    const { container } = render(<Icon icon={Check} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('class')).toContain('sc-icon');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('stroke-width')).toBe(String(ICON_STROKE_WIDTH));
    expect(ICON_SIZES).toEqual({ sm: 16, md: 20, lg: 24 });
    expectTokenOnlyCssFile('src/Icon.css');
  });

  it('有 label → role=img + aria-label；尺寸档解析（含显式数字与缺省档）', () => {
    const { container } = render(<Icon icon={Check} size="lg" label="已完成" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('已完成');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(resolveIconSize('sm')).toBe(16);
    expect(resolveIconSize(32)).toBe(32);
    expect(resolveIconSize()).toBe(20);
  });
});
