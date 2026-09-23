/**
 * pixelGlyph.tsx —— theme 目录内的**局部像素 glyph**（TASK-T65-01-B 红线）。
 *
 * 像素族（packages/ui/pixelIcons.tsx）无「调色板」对应 glyph，本单禁止改动该族文件
 * （避免与 T67 并行冲突）——调色板入口钮的 16×16 glyph 在此自绘。画法逐格等价拷贝
 * makeGlyph（packages/ui/src/pixelIcons.tsx）：16 网格 + crispEdges + 行内同档合并 rect
 * + currentColor / opacity 分档，tone→opacity 映射同族内 D-3 对比度安全档。
 * DEVIATION：合并后请 PM 把 PALETTE_GLYPH 收编进 PIXEL_GLYPHS 族并删本文件。
 */
import type { ReactNode, SVGProps } from 'react';

/** 网格边长（与族契约一致：16×16）。 */
const GRID = 16;

/** tone 字符 → 运行时 opacity（拷贝 pixelIcons 的 GLYPH_TONES+TONE_OPACITY 合成表，D-3 安全档）。 */
const TONE_OPACITY: Record<string, number> = { '#': 1, o: 0.8, x: 0.72 };

/** 调色板（顶栏入口钮）。 */
export const PALETTE_GLYPH: readonly string[] = [
  '................',
  '................',
  '.....oooo.......',
  '...oo####oo.....',
  '..o########o....',
  '..##########....',
  '.o##########o...',
  '.o#######oo.o...',
  '.o######o##o....',
  '.o####o####o....',
  '.o##########o...',
  '..##########o...',
  '..o########o....',
  '...oo####oo.....',
  '.....oooo.......',
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

/** 16×16 像素调色板（T65 顶栏入口钮；待 PM 收编进 pixelIcons 族）。 */
export const PixelPaletteGlyph = makeLocalGlyph(PALETTE_GLYPH, 'PixelPaletteGlyphLocal');
