/**
 * pixelGlyph.tsx —— workbench 目录内的**局部像素 glyph**（TASK-T66-01 §3 红线）。
 *
 * T65 同时在改 packages/ui/pixelIcons.tsx，本单不许碰该族文件——房子/待办两枚 16×16
 * glyph 先在此自绘（画法逐格等价拷贝 makeGlyph：16 网格 + crispEdges + 行内同档合并
 * rect + currentColor/opacity 分档，tone→opacity 映射同 pixelIcons 的 D-3 对比度安全档）。
 * DEVIATION：合并后请 PM 把 HOME_HOUSE / TODO_CHECK 收编进 PIXEL_GLYPHS 族并删本文件。
 */
import type { ReactNode, SVGProps } from 'react';

/** 网格边长（与族契约一致：16×16）。 */
const GRID = 16;

/** tone 字符 → 运行时 opacity（拷贝 pixelIcons 的 GLYPH_TONES+TONE_OPACITY 合成表，D-3 安全档）。 */
const TONE_OPACITY: Record<string, number> = { '#': 1, o: 0.8, x: 0.72 };

/** 房子（顶栏入口钮 + 欢迎条装饰）。 */
export const HOME_HOUSE_GLYPH: readonly string[] = [
  '................',
  '.......##.......',
  '......####......',
  '......####......',
  '.....##..##.....',
  '....##....##....',
  '...##..oo..##...',
  '..##oooooooo##..',
  '..############..',
  '..############..',
  '..##........##..',
  '..##..###...##..',
  '..##..###...##..',
  '..##..###...##..',
  '..##..###...##..',
  '................',
];

/** 待办（清单+勾）。 */
export const TODO_CHECK_GLYPH: readonly string[] = [
  '................',
  '...##.....##....',
  '..####...####...',
  '...##.....##....',
  '................',
  '..##########....',
  '..#........#....',
  '..#.####...#....',
  '..#........#....',
  '..#.####...#....',
  '..#........#....',
  '..#.####...#....',
  '..#........#....',
  '..##########....',
  '................',
  '................',
];

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly tone: number;
}

/** 行内同档相邻格合并成一条 rect（拷贝族画法，DOM 等价）。 */
function scanRuns(grid: readonly string[]): Cell[] {
  const runs: Cell[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y] ?? '';
    let x = 0;
    while (x < row.length) {
      const ch = row[x] ?? '.';
      const tone = TONE_OPACITY[ch];
      if (tone === undefined) {
        x += 1;
        continue;
      }
      let end = x;
      while (end + 1 < row.length && row[end + 1] === ch) {
        end += 1;
      }
      runs.push({ x, y, width: end - x + 1, tone });
      x = end + 1;
    }
  }
  return runs;
}

export interface LocalGlyphProps extends Omit<SVGProps<SVGSVGElement>, 'color'> {
  size?: number;
  color?: string;
}

function makeLocalGlyph(grid: readonly string[], displayName: string) {
  const runs = scanRuns(grid);
  function LocalGlyph({ size, color, className, ...rest }: LocalGlyphProps): ReactNode {
    const px = size ?? GRID;
    return (
      <svg
        {...rest}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${String(GRID)} ${String(GRID)}`}
        width={px}
        height={px}
        color={color}
        shapeRendering="crispEdges"
        focusable="false"
        className={className === undefined ? 'sc-icon' : `sc-icon ${className}`}
      >
        {runs.map((cell) => (
          <rect
            key={`${String(cell.y)}-${String(cell.x)}`}
            x={cell.x}
            y={cell.y}
            width={cell.width}
            height={1}
            fill="currentColor"
            opacity={cell.tone}
          />
        ))}
      </svg>
    );
  }
  LocalGlyph.displayName = displayName;
  return LocalGlyph;
}

/** 16×16 像素房子（T66 入口钮；待 PM 收编进 pixelIcons 族）。 */
export const PixelHomeGlyph = makeLocalGlyph(HOME_HOUSE_GLYPH, 'PixelHomeGlyphLocal');
/** 16×16 像素待办（todo 卡头装饰）。 */
export const PixelTodoGlyph = makeLocalGlyph(TODO_CHECK_GLYPH, 'PixelTodoGlyphLocal');
