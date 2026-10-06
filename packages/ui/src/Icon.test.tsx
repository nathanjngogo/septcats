import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Check, Icon, ICON_SIZES, ICON_STROKE_WIDTH, resolveIconSize, type IconProps } from './Icon';
import { Plus as PixelPlus } from './pixelIcons';

describe('Icon', () => {
  it('单一出口：默认装饰性（aria-hidden）；像素族 glyph（16×16 viewBox + crispEdges + rect 网格）', () => {
    // 10-06 换装后应用面已无像素族，故显式从族内取一枚做像素契约（族本体仍在，作基线）
    const { container } = render(<Icon icon={PixelPlus} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('class')).toContain('sc-icon');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg?.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg?.querySelectorAll('rect').length).toBeGreaterThan(0);
    expect(ICON_SIZES).toEqual({ sm: 16, md: 20, lg: 24 });
    // T58-01：线宽契约保留为 legacy 出口（像素族无描边，改它不影响外观）
    expect(ICON_STROKE_WIDTH).toBe(1.5);
    expectTokenOnlyCssFile('src/Icon.css');
  });

  it('T105-01：应用面名字（Check）现在走线族 —— viewBox 24 / stroke=currentColor / 无 crispEdges', () => {
    const { container } = render(<Icon icon={Check} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.getAttribute('stroke-width')).toBe('1.5');
    expect(svg?.getAttribute('shape-rendering')).toBeNull();
    expect(svg?.getAttribute('data-line-glyph')).toBe('Check');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
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

  it('尺寸档穿透到像素几何：width/height 随档位解析（sm/md/lg/显式数字/缺省）', () => {
    const cases: ReadonlyArray<readonly [IconProps['size'], string]> = [
      [undefined, '20'],
      ['sm', '16'],
      ['md', '20'],
      ['lg', '24'],
      [32, '32'],
    ];
    for (const [size, expected] of cases) {
      const { container } = render(<Icon icon={Check} {...(size === undefined ? {} : { size })} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width'), `size=${String(size)}`).toBe(expected);
      expect(svg?.getAttribute('height'), `size=${String(size)}`).toBe(expected);
    }
  });

  it('color 透传到 svg（currentColor 的解析源）：rect 全是 currentColor，颜色不写死', () => {
    const { container } = render(<Icon icon={Check} color="#123456" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('color')).toBe('#123456');
    for (const rect of container.querySelectorAll('rect')) {
      expect(rect.getAttribute('fill')).toBe('currentColor');
    }
  });
});
