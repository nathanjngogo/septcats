import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  PIXEL_GLYPHS_EXTRA,
  PixelHomeGlyph,
  PixelPaletteGlyph,
  PixelShopGlyph,
  PixelTodoGlyph,
  type ExtraPixelGlyphName,
} from './icons';
import * as iconExports from './Icon';
import { Icon, PIXEL_GLYPHS } from './Icon';

/**
 * T74-01：原应用层局部像素 glyph（房子/待办/店铺/调色板）收编进 ui 包后的层测。
 *
 * 分工：本文件钉「出口面 + 矩阵冻结 + 渲染等价（迁移前后外观零变化）」；
 * 桌面侧 t74-01-glyph-collection.test.tsx 钉「App 顶栏 / 组件在应用里的 DOM 签名」。
 *
 * 外观零变化的判定方式：矩阵逐字符搬运（含 Shop 的参差行宽）+ 复用 pixelIcons 的
 * createPixelGlyph 同一条渲染管线 → 产出的 rect 序列（坐标/宽度/opacity）**完全冻结**。
 * 下面 `PixelShopGlyph 完整 rect 清单` 就是 T74-01 迁移前实机/实渲染捕获的基线，
 * 改动任何一格即红。
 */

const EXTRA_NAMES = Object.keys(PIXEL_GLYPHS_EXTRA) as ExtraPixelGlyphName[];

const COMPONENTS: Record<ExtraPixelGlyphName, typeof PixelHomeGlyph> = {
  Home: PixelHomeGlyph,
  Todo: PixelTodoGlyph,
  Shop: PixelShopGlyph,
  Palette: PixelPaletteGlyph,
};

/** 把一个渲染结果的 rect 展开成 16×16 掩码（与资产矩阵同构，便于逐格比对）。 */
function maskOf(container: HTMLElement): string[] {
  const rows: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => '.'));
  for (const rect of container.querySelectorAll('rect')) {
    const x = Number(rect.getAttribute('x'));
    const y = Number(rect.getAttribute('y'));
    const w = Number(rect.getAttribute('width'));
    const h = Number(rect.getAttribute('height'));
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        rows[y + dy]![x + dx] = '#';
      }
    }
  }
  return rows.map((r) => r.join(''));
}

/**
 * 矩阵 → 16×16 掩码：'o'（半档）也占格统一成 '#'；行宽不足 16 的参差行（Shop）右侧补空
 * ——渲染按实际行宽取格，行尾之外的格子就是空的，这正是原稿外观。
 */
const occupied = (matrix: readonly string[]): string[] =>
  matrix.map((row) => row.padEnd(16, '.').replace(/[ox]/g, '#'));

/** rect 序列签名（坐标 + 合并后的宽度 + opacity 档），用于冻结渲染产物。 */
const rectSig = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('rect')].map(
    (r) =>
      `${r.getAttribute('x')},${r.getAttribute('y')} ${r.getAttribute('width')}x${r.getAttribute('height')}@${r.getAttribute('opacity')}`,
  );

describe('T74-01 族外像素 glyph · 出口与矩阵冻结', () => {
  it('四枚齐备且与族内同契约：16 行、字符集合法（#/o/x/.）、行宽 ≤16（参差行宽是冻结资产，勿对齐）', () => {
    expect(EXTRA_NAMES).toEqual(['Home', 'Todo', 'Shop', 'Palette']);
    for (const name of EXTRA_NAMES) {
      const grid = PIXEL_GLYPHS_EXTRA[name];
      expect(grid.length, `${name} 行数`).toBe(16);
      for (const [i, row] of grid.entries()) {
        expect(row.length, `${name} 第 ${String(i)} 行宽`).toBeLessThanOrEqual(16);
        expect(/^[#ox.]*$/.test(row), `${name} 第 ${String(i)} 行非法字符：${row}`).toBe(true);
      }
    }
    // Shop 的行宽剖面逐行长钉：T74-01 原样搬运（原稿第 3/4/6..9 行 15 格、第 10/11 行 14 格）。
    // 谁「顺手对齐成 16 格」即红 —— 那会改外观。
    expect(PIXEL_GLYPHS_EXTRA.Shop.map((row) => row.length)).toEqual([
      16, 16, 16, 15, 15, 16, 15, 15, 15, 15, 14, 14, 16, 16, 16, 16,
    ]);
    for (const name of ['Home', 'Todo', 'Palette'] as const) {
      expect(PIXEL_GLYPHS_EXTRA[name].map((row) => row.length)).toEqual(Array.from({ length: 16 }, () => 16));
    }
    // 收编不污染 T58 资产表口径：PIXEL_GLYPHS 仍 28 枚（族外 glyph 单独成表）
    expect(Object.keys(PIXEL_GLYPHS).length).toBe(28);
  });

  it('全仓唯一图标出口纪律：四枚经 ./Icon 转出口（从 @septcats/ui 根可取）', () => {
    const table = iconExports as unknown as Record<string, unknown>;
    for (const name of ['PixelHomeGlyph', 'PixelTodoGlyph', 'PixelShopGlyph', 'PixelPaletteGlyph']) {
      expect(table[name], `${name} 未从 Icon.tsx 出口`).toBeTypeOf('function');
    }
    expect(table['PIXEL_GLYPHS_EXTRA']).toBe(PIXEL_GLYPHS_EXTRA);
  });

  it('同族渲染管线：族内 glyph 与族外 glyph 的 svg 契约逐项一致（viewBox/crispEdges/focusable/class/currentColor）', () => {
    for (const name of EXTRA_NAMES) {
      const { container } = render(<Icon icon={COMPONENTS[name]} />);
      const svg = container.querySelector('svg');
      expect(svg, `${name} 未渲染 svg`).not.toBeNull();
      expect(svg!.getAttribute('viewBox'), `${name} viewBox`).toBe('0 0 16 16');
      expect(svg!.getAttribute('shape-rendering'), `${name} shape-rendering`).toBe('crispEdges');
      expect(svg!.getAttribute('focusable'), `${name} focusable`).toBe('false');
      expect(svg!.getAttribute('class'), `${name} class`).toBe('sc-icon');
      for (const rect of container.querySelectorAll('rect')) {
        expect(rect.getAttribute('fill'), `${name} 出现字面色`).toBe('currentColor');
        expect(rect.getAttribute('height')).toBe('1');
        expect(rect.getAttribute('opacity')).toBeTypeOf('string');
      }
    }
  });
});

describe('T74-01 族外像素 glyph · 渲染矩阵（快照口径：逐格等于矩阵）', () => {
  for (const name of EXTRA_NAMES) {
    it(`${name}：渲染 rect 网格 = 矩阵（16×16 逐格）`, () => {
      const Comp = COMPONENTS[name];
      const { container } = render(<Comp size={16} />);
      expect(maskOf(container)).toEqual(occupied(PIXEL_GLYPHS_EXTRA[name]));
    });
  }

  it('尺寸档：默认 16、显式 size 生效、经 Icon 转发档位（sm/md/lg → 16/20/24）', () => {
    const def = render(<PixelHomeGlyph />);
    expect(def.container.querySelector('svg')!.getAttribute('width')).toBe('16');
    expect(def.container.querySelector('svg')!.getAttribute('height')).toBe('16');
    const big = render(<PixelHomeGlyph size={20} />);
    expect(big.container.querySelector('svg')!.getAttribute('width')).toBe('20');
    for (const [size, px] of [['sm', '16'], ['md', '20'], ['lg', '24']] as const) {
      const { container } = render(<Icon icon={PixelShopGlyph} size={size} />);
      expect(container.querySelector('svg')!.getAttribute('width'), `${size} 档`).toBe(px);
    }
  });

  it('className 追加不覆盖 sc-icon（应用层的 wb-title__glyph 等钩子照常生效）', () => {
    const { container } = render(<PixelHomeGlyph className="wb-title__glyph" aria-hidden="true" />);
    expect(container.querySelector('svg')!.getAttribute('class')).toBe('sc-icon wb-title__glyph');
  });

  it('快照锚（T74-01 迁移前基线，逐条冻结）：PixelShopGlyph 的完整 rect 清单 + opacity 档', () => {
    const { container } = render(<PixelShopGlyph size={16} />);
    expect(rectSig(container)).toEqual([
      '2,1 12x1@1',
      '2,2 12x1@1',
      '2,3 1x1@1',
      '5,3 2x1@1',
      '11,3 2x1@1',
      '2,4 1x1@1',
      '5,4 2x1@1',
      '11,4 2x1@1',
      '2,5 12x1@1',
      '2,6 1x1@1',
      '5,6 1x1@1',
      '6,6 1x1@0.8',
      '7,6 1x1@1',
      '10,6 1x1@1',
      '11,6 1x1@0.8',
      '12,6 1x1@1',
      '2,7 1x1@1',
      '5,7 1x1@1',
      '6,7 1x1@0.8',
      '7,7 1x1@1',
      '10,7 1x1@1',
      '11,7 1x1@0.8',
      '12,7 1x1@1',
      '2,8 1x1@1',
      '5,8 1x1@1',
      '6,8 1x1@0.8',
      '7,8 1x1@1',
      '10,8 1x1@1',
      '11,8 1x1@0.8',
      '12,8 1x1@1',
      '2,9 1x1@1',
      '5,9 1x1@1',
      '6,9 1x1@0.8',
      '7,9 1x1@1',
      '10,9 1x1@1',
      '11,9 1x1@0.8',
      '12,9 1x1@1',
      '2,10 1x1@1',
      '11,10 1x1@1',
      '2,11 1x1@1',
      '11,11 1x1@1',
      '2,12 12x1@1',
      '2,13 1x1@1',
      '4,13 1x1@1',
      '11,13 1x1@1',
      '13,13 1x1@1',
      '2,14 1x1@1',
      '4,14 1x1@1',
      '11,14 1x1@1',
      '13,14 1x1@1',
      '2,15 3x1@1',
      '11,15 3x1@1',
    ]);
    expect(container.querySelectorAll('rect').length).toBe(52);
  });

  it('快照锚：PixelPaletteGlyph 的 rect 条数（37 = 13 实档 + 24 半档）', () => {
    const { container } = render(<PixelPaletteGlyph size={16} />);
    const sig = rectSig(container);
    expect(sig.length).toBe(37);
    expect(sig.filter((s) => s.endsWith('@0.8')).length).toBe(24);
    expect(sig.filter((s) => s.endsWith('@1')).length).toBe(13);
    // 四枚族外 glyph 的矩阵都只用主墨/半档两档（无 x 淡档）——与迁移前局部实现同档
    expect(sig.some((s) => s.endsWith('@0.72'))).toBe(false);
  });
});
