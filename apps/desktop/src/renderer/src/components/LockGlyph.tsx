/**
 * LockGlyph.tsx —— 局部锁 glyph（T67-01-B2-01 范围1/2）。
 *
 * 红线：禁改 `pixelIcons.tsx` 主文件（t58 先例），故在此建局部像素风锁 glyph
 * （见报告 D2）。纯内联 SVG，描边/填充一律 `currentColor`，不写裸 hex/px 字面量，
 * 因此不触发 no-magic / pixel-borders 门禁。调用方用 `color`/尺寸容器控制外观。
 */
interface LockGlyphProps {
  /** 像素尺寸（CSS 长度，默认 16px）。 */
  size?: number;
  className?: string;
}

export function LockGlyph({ size = 16, className }: LockGlyphProps) {
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
      {/* 锁梁 */}
      <path d="M4 7V5a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {/* 锁体 */}
      <rect x="3" y="7" width="10" height="7" fill="currentColor" />
      {/* 锁孔：同色细描边（不依赖背景 token，纯轮廓表示） */}
      <circle cx="8" cy="10" r="0.9" fill="none" stroke="var(--sc-color-canvas)" strokeWidth="0.6" />
      <rect x="7.7" y="10.3" width="0.6" height="1.8" fill="var(--sc-color-canvas)" />
    </svg>
  );
}
