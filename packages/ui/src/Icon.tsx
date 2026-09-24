import type { ElementType, SVGProps } from 'react';
import './Icon.css';

/**
 * Icon —— 全仓唯一图标出口（§16.6）。
 *
 * TASK-T58-01 起：族 = **仓内自绘像素 glyph**（`./pixelIcons`，16×16 硬边网格、
 * currentColor + opacity 分档），不再走 `@phosphor-icons/react` 渲染。phosphor 依赖
 * 保留在 package.json 仅作 fallback/文档引用，仓内零 import。
 * 纪律：全仓图标一律从 @septcats/ui 取，禁止混族、禁止 emoji 当图标。
 * 尺寸档固定 16 / 20 / 24；像素 glyph 无描边（硬边实心），.sc-icon 由像素组件自带。
 * 无障碍：有 label → role="img" + aria-label；无 label → 装饰性 aria-hidden。
 */
export type IconGlyph = ElementType;

/**
 * Legacy：phosphor 时代的线宽契约，保留出口仅为 API 兼容（下游可能有引用）。
 * 像素族不消费该值——硬边像素画没有描边，改这个常量不会改变任何图标外观。
 */
export const ICON_STROKE_WIDTH = 1.5;
export const ICON_SIZES = { sm: 16, md: 20, lg: 24 } as const;
export type IconSize = keyof typeof ICON_SIZES;

/** 尺寸档 → 像素（允许显式数字，但优先用档位，保证全仓一致）。 */
export function resolveIconSize(size: IconSize | number = 'md'): number {
  return typeof size === 'number' ? size : ICON_SIZES[size];
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'color'> {
  icon: IconGlyph;
  size?: IconSize | number;
  /** 语义色，默认继承 currentColor */
  color?: string;
  /** 有 label 表示有语义；缺省即装饰性图标 */
  label?: string;
}

export function Icon({ icon: Glyph, size = 'md', color, label, className, ...rest }: IconProps) {
  const px = resolveIconSize(size);
  return (
    <Glyph
      {...rest}
      size={px}
      color={color}
      focusable="false"
      className={className}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    />
  );
}

// 全仓图标单族出口：像素 glyph 自绘于 ./pixelIcons；业务代码不得 import 任何图标库。
export {
  AiRobot,
  ArrowClockwise,
  ArrowsClockwise,
  BookOpen,
  CaretDown,
  CaretRight,
  CaretUp,
  Check,
  CheckCircle,
  Circle,
  Clock,
  Close,
  Copy,
  DotsThree,
  FileText,
  FolderSimple,
  GearSix,
  Info,
  Layout,
  MagnifyingGlass,
  Note,
  PencilSimple,
  Plus,
  Search,
  SidebarSimple,
  Star,
  Trash,
  WarningCircle,
  WarningOctagon,
  X,
} from './pixelIcons';
export { PIXEL_GLYPHS, PIXEL_GLYPH_GRID, TONE_OPACITY, GLYPH_TONES } from './pixelIcons';
export type { PixelGlyphName, PixelGlyphProps } from './pixelIcons';

// T74-01：族外 glyph（房子/待办/店铺/调色板 —— 原应用层局部像素画收编进设计系统）。
// 与族内 glyph 同一出口、同一渲染管线；调用点仍旧 `icon={X}` / `<X size={n} />`。
export { PIXEL_GLYPHS_EXTRA, PixelHomeGlyph, PixelPaletteGlyph, PixelShopGlyph, PixelTodoGlyph } from './icons';
export type { ExtraPixelGlyphName } from './icons';
