/**
 * TelescopeGlyph.tsx —— 局部像素风望远镜 glyph（老板 09-23：编辑区标题上方的
 * 「🔭」emoji 换像素风）。
 *
 * 红线：禁改 `pixelIcons.tsx` 主文件（t58/t67 LockGlyph 先例），故在此建局部
 * 像素族 glyph。纯内联 SVG：16×16 网格逐格 rect（shapeRendering=crispEdges），
 * 填充 currentColor、零裸 hex/px → 不触 no-magic / pixel-borders 门禁。
 * 构图：斜置镜筒（右上物镜渐宽）+ 左下目镜 + 中置云台三脚架。
 */
const CELLS: readonly (readonly [number, number])[] = [
  // 物镜端（渐宽镜筒顶部）
  [8, 1], [9, 1], [10, 1],
  [7, 2], [8, 2], [9, 2], [10, 2],
  // 镜筒（斜向下左）
  [6, 3], [7, 3], [8, 3], [9, 3],
  [5, 4], [6, 4], [7, 4], [8, 4],
  [4, 5], [5, 5], [6, 5], [7, 5],
  [3, 6], [4, 6], [5, 6], [6, 6],
  [2, 7], [3, 7], [4, 7], [5, 7],
  // 目镜（左下）
  [1, 8], [2, 8], [3, 8],
  // 云台支柱
  [6, 8], [7, 8], [6, 9], [7, 9],
  // 三脚架（分腿）
  [5, 10], [8, 10],
  [4, 11], [9, 11],
  [3, 12], [10, 12],
  [2, 13], [11, 13],
  [1, 14], [12, 14],
];

interface TelescopeGlyphProps {
  /** 像素尺寸（CSS 长度，默认 32 = 标题上方大图标口径）。 */
  size?: number;
  className?: string;
}

export function TelescopeGlyph({ size = 32, className }: TelescopeGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      {CELLS.map(([x, y]) => (
        <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width={1} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}
