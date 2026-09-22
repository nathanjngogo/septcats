import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import {
  AI_ROBOT_EYE,
  GLYPH_TONES,
  PIXEL_GLYPHS,
  TONE_OPACITY,
  type PixelGlyphProps,
} from './pixelIcons';
import * as pixel from './pixelIcons';
import * as iconExports from './Icon';
import { Icon } from './Icon';

/** T58-01 §1.6 要求「24 枚现状 glyph 全迁一个不漏」的**基线清单**：T58 之前 Icon.tsx 的
 * 全部 re-export（26 个名字，逐字抄自改造前的 Icon.tsx 尾块）。本表是回归锚——
 * 少任何一个都红。`Sparkle` 是唯一例外：设计稿无 Sparkle 像素 glyph，AI 语义整体迁到
 * AiRobot（见 D-2），故要求它**已退役**。 */
const LEGACY_ICON_EXPORTS = [
  'ArrowClockwise',
  'ArrowsClockwise',
  'CaretDown',
  'CaretRight',
  'CaretUp',
  'Check',
  'CheckCircle',
  'Circle',
  'Clock',
  'Copy',
  'DotsThree',
  'FileText',
  'FolderSimple',
  'GearSix',
  'Info',
  'MagnifyingGlass',
  'Note',
  'PencilSimple',
  'Plus',
  'SidebarSimple',
  'Star',
  'Trash',
  'WarningCircle',
  'WarningOctagon',
  'X',
] as const;

const GLYPH_NAMES = Object.keys(PIXEL_GLYPHS) as Array<keyof typeof PIXEL_GLYPHS>;

/** 把一个渲染结果的 rect 展开成 16×16 掩码（与资产表同构，便于逐格比对）。 */
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

/** 资产表里 'o'（半档）也占格，比对掩码时统一成 '#'。 */
const occupied = (matrix: readonly string[]): string[] => matrix.map((row) => row.replace(/[ox]/g, '#'));

const componentOf = (name: string): ComponentType<PixelGlyphProps> | undefined =>
  (pixel as unknown as Record<string, ComponentType<PixelGlyphProps> | undefined>)[name];

describe('T58-01 像素图标族 · 矩阵与出口完整性', () => {
  it('28 枚网格齐备：16 行 ×16 列、字符集合法（#/o/x/.）、坐标全整数（无半格）', () => {
    expect(GLYPH_NAMES.length).toBe(28);
    for (const name of GLYPH_NAMES) {
      const grid = PIXEL_GLYPHS[name];
      expect(grid.length, `${name} 行数`).toBe(16);
      for (const row of grid) {
        expect(row.length, `${name} 行宽`).toBe(16);
        expect(/^[#ox.]{16}$/.test(row), `${name} 非法字符：${row}`).toBe(true);
      }
    }
  });

  it('tone → opacity 映射覆盖资产用到的全部 tone（缺档即红）', () => {
    const used = new Set<number>();
    for (const name of GLYPH_NAMES) {
      for (const row of PIXEL_GLYPHS[name]) {
        for (const ch of row) {
          const tone = GLYPH_TONES[ch as keyof typeof GLYPH_TONES];
          if (tone !== undefined) used.add(tone);
        }
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const tone of used) {
      expect(TONE_OPACITY[tone as keyof typeof TONE_OPACITY], `tone ${String(tone)} 无渲染档`).toBeTypeOf('number');
    }
  });

  it('T58 之前的 25 个图标名全部仍可用（一个不漏）+ Sparkle 已退役（AI 语义迁 AiRobot）', () => {
    const table = iconExports as unknown as Record<string, unknown>;
    for (const name of LEGACY_ICON_EXPORTS) {
      expect(table[name], `旧出口 ${name} 丢失`).toBeTypeOf('function');
    }
    expect(table['Sparkle'], 'Sparkle 应已退役（无像素 glyph，勿留半迁移残留）').toBeUndefined();
    expect(table['AiRobot'], 'AI 钮新出口 AiRobot 必须在位').toBeTypeOf('function');
  });

  it('旧权利名别名同源：MagnifyingGlass ≡ Search、X ≡ Close（调用点零改动的实现）', () => {
    expect(pixel.MagnifyingGlass).toBe(pixel.Search);
    expect(pixel.X).toBe(pixel.Close);
  });

  it('Icon.tsx 出口块里的每个名字都能在像素表里落地（re-export 清单 ⊆ pixel glyph 表）', () => {
    // 逐名渲染一遍：拿不到组件 / 渲染不出 rect 即红
    const table = iconExports as unknown as Record<string, unknown>;
    for (const name of [...LEGACY_ICON_EXPORTS, 'AiRobot', 'Layout', 'BookOpen', 'Search', 'Close']) {
      const Comp = table[name] as ComponentType<PixelGlyphProps> | undefined;
      expect(Comp, `${name} 未从 Icon.tsx 出口`).toBeTypeOf('function');
      const { container } = render(<Icon icon={Comp!} />);
      expect(container.querySelectorAll('rect').length, `${name} 未渲染像素格`).toBeGreaterThan(0);
    }
  });

  it('仓内零 phosphor 渲染路径：Icon.tsx / pixelIcons.tsx 不 import 图标库（依赖仅作 fallback）', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolvePkgFile } = await import('../test/pkg-root');
    for (const rel of ['src/Icon.tsx', 'src/pixelIcons.tsx']) {
      const src = readFileSync(resolvePkgFile(rel), 'utf8');
      const imported = /(?:from|import|require)\s*\(?\s*['"]@phosphor-icons/.test(src);
      expect(imported, `${rel} 仍 import phosphor`).toBe(false);
    }
  });
});

describe('T58-01 像素图标族 · 渲染矩阵（快照口径：逐格等于资产表）', () => {
  for (const name of GLYPH_NAMES) {
    it(`${name}：渲染 rect 网格 = 资产 glyph 矩阵（16×16 逐格）`, () => {
      const Comp = componentOf(name);
      expect(Comp, `${name} 未导出组件`).toBeTypeOf('function');
      const { container } = render(<Icon icon={Comp!} />);
      expect(maskOf(container)).toEqual(occupied(PIXEL_GLYPHS[name]));
    });
  }

  it('快照锚：Plus 的 3 组 rect 几何（横条合并，硬边 1 格高）', () => {
    const { container } = render(<Icon icon={pixel.Plus} />);
    const rects = [...container.querySelectorAll('rect')].map(
      (r) => `${r.getAttribute('x')},${r.getAttribute('y')} ${r.getAttribute('width')}x${r.getAttribute('height')}`,
    );
    expect(rects).toMatchInlineSnapshot(`
      [
        "7,3 2x1",
        "7,4 2x1",
        "7,5 2x1",
        "7,6 2x1",
        "3,7 10x1",
        "3,8 10x1",
        "7,9 2x1",
        "7,10 2x1",
        "7,11 2x1",
        "7,12 2x1",
      ]
    `);
  });

  it('快照锚：AiRobot 的完整 rect 清单（含眼/天线分组 class）', () => {
    const { container } = render(<Icon icon={pixel.AiRobot} />);
    const describeRect = (r: Element): string => {
      const group = r.parentElement?.tagName === 'g' ? (r.parentElement.getAttribute('class') ?? '') : '';
      return `${r.getAttribute('x')},${r.getAttribute('y')} ${r.getAttribute('width')}x${r.getAttribute('height')}@${r.getAttribute('opacity')}${group === '' ? '' : `[${group}]`}`;
    };
    expect([...container.querySelectorAll('rect')].map(describeRect)).toMatchInlineSnapshot(`
      [
        "2,3 12x1@1",
        "2,4 1x1@1",
        "13,4 1x1@1",
        "2,5 1x1@1",
        "14,5 1x1@1",
        "2,6 1x1@1",
        "14,6 1x1@1",
        "2,7 1x1@1",
        "13,7 1x1@1",
        "2,8 1x1@1",
        "6,8 4x1@1",
        "14,8 1x1@1",
        "2,9 1x1@1",
        "13,9 1x1@1",
        "2,10 12x1@1",
        "3,11 1x1@1",
        "12,11 1x1@1",
        "3,12 1x1@1",
        "12,12 1x1@1",
        "7,1 2x1@1[sc-icon__antenna]",
        "7,2 2x1@1[sc-icon__antenna]",
        "4,5 4x1@1[sc-icon__eye]",
        "9,5 4x1@1[sc-icon__eye]",
        "4,6 4x1@1[sc-icon__eye]",
        "9,6 4x1@1[sc-icon__eye]",
      ]
    `);
  });

  it('像素色值只走 currentColor（fill 属性无字面色，透明度交给 opacity 档）', () => {
    for (const name of GLYPH_NAMES) {
      const Comp = componentOf(name)!;
      const { container } = render(<Icon icon={Comp} />);
      for (const rect of container.querySelectorAll('rect')) {
        expect(rect.getAttribute('fill'), `${name} 出现字面色`).toBe('currentColor');
        expect(rect.getAttribute('opacity')).toBeTypeOf('string');
      }
    }
  });
});

describe('T58-01 AI 钮（AiRobot）两态接线', () => {
  it('眼/天线分组存在：眼 = 4 条横条（两块方眼）、天线 = 2 条横条（每日一行），组 class 是两态钩子', () => {
    const { container } = render(<Icon icon={pixel.AiRobot} />);
    const eyes = container.querySelectorAll('.sc-icon__eye rect');
    const antenna = container.querySelectorAll('.sc-icon__antenna rect');
    expect(eyes.length).toBe(4);
    expect(antenna.length).toBe(2);
    // 分区坐标与资产表一致（5–6 行 / 4–7 + 9–12 列；天线 1–2 行 7–8 列）
    const coords = [...eyes].map((r) => `${r.getAttribute('x')},${r.getAttribute('y')},${r.getAttribute('width')}`);
    expect(coords).toEqual(['4,5,4', '9,5,4', '4,6,4', '9,6,4']);
    expect(AI_ROBOT_EYE.rows).toEqual([5, 6]);
    expect([...antenna].map((r) => `${r.getAttribute('x')},${r.getAttribute('y')},${r.getAttribute('width')}`)).toEqual([
      '7,1,2',
      '7,2,2',
    ]);
  });

  it('两态 CSS 在盘：眼亮 1 / 眼暗 0.35；天线亮 1 / 暗一档 0.55；选择器挂在祖先 aria-pressed=false 上', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolvePkgFile } = await import('../test/pkg-root');
    const css = readFileSync(resolvePkgFile('src/pixelIcons.css'), 'utf8');
    const rule = (selector: string): string => {
      const m = new RegExp(`${selector.replace(/[[\]=']/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`).exec(css);
      expect(m, `缺少规则 ${selector}`).not.toBeNull();
      return m![1]!.replace(/\s+/g, ' ').trim();
    };
    expect(rule(".sc-icon__eye,\n.sc-icon__antenna")).toContain('opacity: 1');
    expect(rule("[aria-pressed='false'] .sc-icon__eye")).toContain('opacity: 0.35');
    expect(rule("[aria-pressed='false'] .sc-icon__antenna")).toContain('opacity: 0.55');
  });

  it('AI 钮开合两态的 DOM 载体齐备：IconButton 的 aria-pressed 翻转，glyph 分组不随态增删', () => {
    const closed = render(<button type="button" aria-pressed={false}><Icon icon={pixel.AiRobot} size="sm" /></button>);
    const open = render(<button type="button" aria-pressed={true}><Icon icon={pixel.AiRobot} size="sm" /></button>);
    const shape = (c: HTMLElement): string =>
      [...c.querySelectorAll('rect')].map((r) => `${r.getAttribute('x')},${r.getAttribute('y')}`).join('|');
    // 同一 glyph：两态只切 opacity（由 CSS 按 aria-pressed 决定），几何必须完全一致
    expect(shape(closed.container)).toBe(shape(open.container));
    expect(closed.container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
    expect(open.container.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(closed.container.querySelectorAll('.sc-icon__eye rect').length).toBe(4);
    expect(open.container.querySelectorAll('.sc-icon__eye rect').length).toBe(4);
  });

  it('CSS 纪律：pixelIcons.css 零字面 hex、无重复裸 px', () => {
    expectTokenOnlyCssFile('src/pixelIcons.css');
  });
});
