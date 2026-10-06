// @vitest-environment jsdom
/**
 * lineIcons.test.tsx —— 线族（T104-01）层测。
 *
 * 老板 2026-10-06 令（附截图红框=一级导航轨）：「红框内，全部改为线条图标，设计要简约。」
 * ＋ 同日追加「取消像素风吧，不适合这个软件。」→ 线族成为应用图标语言。
 *
 * 钉四件事（族契约的全部）：
 *  ① 族面：八枚 + 几何落在 24 网格内（0..24），每枚至少一个基元；
 *  ② 外观契约：viewBox 24、fill=none、stroke=currentColor、描边 1.5、圆头圆角
 *     —— 且**每一个基元都不得自带 fill**（线族零填充，防止混入实心块）；
 *  ③ 尺寸/颜色透传：size 生效、color 覆写描边（缺省跟随 currentColor）；
 *  ④ 族标记：`data-line-glyph` 带族名（探针/断言据此认族，不靠类名猜）；
 *     并与像素族契约常量 ICON_STROKE_WIDTH 同值（跨族描边重量一致）。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ICON_STROKE_WIDTH, Icon } from './Icon';
import {
  LINE_GLYPHS,
  LINE_GLYPH_GRID,
  LINE_GLYPH_STROKE,
  LineBookOpen,
  LineCalendar,
  LineHome,
  LineLayers,
  LineNote,
  LineTable,
  LineTodo,
  LineTrash,
  type LineGlyphName,
} from './lineIcons';

const COMPONENTS: Record<LineGlyphName, typeof LineNote> = {
  Note: LineNote,
  BookOpen: LineBookOpen,
  Calendar: LineCalendar,
  Table: LineTable,
  Todo: LineTodo,
  Home: LineHome,
  Layers: LineLayers,
  Trash: LineTrash,
};

const NAMES = Object.keys(LINE_GLYPHS) as LineGlyphName[];

/** 从 path 的 d 里抽出所有坐标数字（含相对指令的数值——仅用于范围检查，语义按几何盒取绝对值）。 */
function coordsOf(d: string): number[] {
  return [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Math.abs(Number(m[0])));
}

describe('T104-01 线族 · 几何与族面', () => {
  it('八枚 glyph，每枚至少一个基元', () => {
    expect(NAMES).toEqual([
      'Note',
      'BookOpen',
      'Calendar',
      'Table',
      'Todo',
      'Home',
      'Layers',
      'Trash',
    ]);
    for (const name of NAMES) {
      expect(LINE_GLYPHS[name].length, `${name} 没有基元`).toBeGreaterThanOrEqual(1);
    }
  });

  it('几何全部落在 24 画格内（含 rect 边界与 path 坐标）', () => {
    for (const name of NAMES) {
      for (const shape of LINE_GLYPHS[name]) {
        if (shape.tag === 'rect') {
          expect(shape.x, `${name} rect.x`).toBeGreaterThanOrEqual(0);
          expect(shape.y, `${name} rect.y`).toBeGreaterThanOrEqual(0);
          expect(shape.x + shape.width, `${name} rect 右缘`).toBeLessThanOrEqual(LINE_GLYPH_GRID);
          expect(shape.y + shape.height, `${name} rect 下缘`).toBeLessThanOrEqual(LINE_GLYPH_GRID);
          continue;
        }
        // path：d 里出现的数值不得超画格（相对指令会混入增量，故只做上界粗筛，
        // 粗筛已足以拦截「抄别的图标忘了改坐标」这类越界）。
        for (const v of coordsOf(shape.d)) {
          expect(v, `${name} path 坐标 ${String(v)} 超出画格`).toBeLessThanOrEqual(LINE_GLYPH_GRID);
        }
      }
    }
  });
});

describe('T104-01 线族 · 外观契约', () => {
  it('每枚渲染出 svg[data-line-glyph]：viewBox 24 / stroke=currentColor / 1.5 / 圆头圆角 / fill=none', () => {
    for (const name of NAMES) {
      const Glyph = COMPONENTS[name];
      const { container } = render(<Glyph />);
      const svg = container.querySelector('svg');
      expect(svg, `${name} 未渲染 svg`).not.toBeNull();
      expect(svg!.getAttribute('data-line-glyph'), `${name} 缺族标记`).toBe(name);
      expect(svg!.getAttribute('viewBox')).toBe(`0 0 ${String(LINE_GLYPH_GRID)} ${String(LINE_GLYPH_GRID)}`);
      expect(svg!.getAttribute('fill')).toBe('none');
      expect(svg!.getAttribute('stroke')).toBe('currentColor');
      expect(svg!.getAttribute('stroke-width')).toBe(String(LINE_GLYPH_STROKE));
      expect(svg!.getAttribute('stroke-linecap')).toBe('round');
      expect(svg!.getAttribute('stroke-linejoin')).toBe('round');
      expect(svg!.getAttribute('focusable')).toBe('false');
    }
  });

  it('零填充：任何基元都不得自带 fill（线族不掺实心块）', () => {
    for (const name of NAMES) {
      const Glyph = COMPONENTS[name];
      const { container } = render(<Glyph />);
      const shapes = [...container.querySelectorAll('path, rect, circle, polygon')];
      expect(shapes.length, `${name} 无基元`).toBeGreaterThanOrEqual(1);
      for (const shape of shapes) {
        expect(shape.getAttribute('fill'), `${name} 的基元带 fill`).toBeNull();
      }
    }
  });

  it('描边重量与像素族契约常量同值（跨族一致）', () => {
    expect(LINE_GLYPH_STROKE).toBe(ICON_STROKE_WIDTH);
  });
});

describe('T104-01 线族 · 尺寸与颜色透传', () => {
  it('size 生效（含经 Icon 包装的 16/20/24 档）', () => {
    const { container: bare } = render(<LineNote size={20} />);
    expect(bare.querySelector('svg')!.getAttribute('width')).toBe('20');
    expect(bare.querySelector('svg')!.getAttribute('height')).toBe('20');

    const { container: wrapped } = render(<Icon icon={LineNote} size="lg" />);
    const svg = wrapped.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.getAttribute('data-line-glyph')).toBe('Note');
  });

  it('color 覆写描边；缺省跟随 currentColor', () => {
    const { container: colored } = render(<LineTrash color="var(--sc-color-danger)" />);
    expect(colored.querySelector('svg')!.getAttribute('stroke')).toBe('var(--sc-color-danger)');
    const { container: plain } = render(<LineTrash />);
    expect(plain.querySelector('svg')!.getAttribute('stroke')).toBe('currentColor');
  });

  it('有 label 时 role=img + aria-label；无 label 则装饰性 aria-hidden（与像素族同口径）', () => {
    const { container: labelled } = render(<Icon icon={LineTodo} label="待办" />);
    const svg = labelled.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('待办');
    const { container: decorative } = render(<Icon icon={LineTodo} />);
    expect(decorative.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});