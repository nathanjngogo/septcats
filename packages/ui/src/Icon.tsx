import type { ElementType, SVGProps } from 'react';
import clsx from 'clsx';
import './Icon.css';

/**
 * Icon —— 全仓唯一图标出口（§16.6）。
 * 纪律：只有本文件 import @phosphor-icons/react，其余代码一律从 @septcats/ui 取图标；
 * 尺寸档固定 16 / 20 / 24，strokeWidth 固定 1.5（不改档、不混族、不用 emoji 当图标）。
 * 无障碍：有 label → role="img" + aria-label；无 label → 装饰性 aria-hidden。
 */
export type IconGlyph = ElementType;

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
      width={px}
      height={px}
      size={px}
      weight="regular"
      strokeWidth={ICON_STROKE_WIDTH}
      color={color}
      focusable="false"
      className={clsx('sc-icon', className)}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    />
  );
}

// 全仓图标单族出口：仅在此 re-export，业务代码不得直接 import @phosphor-icons/react。
export {
  ArrowClockwise,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  CaretUp,
  Check,
  CheckCircle,
  Circle,
  Clock,
  Copy,
  DotsThree,
  FileText,
  FolderSimple,
  GearSix,
  Info,
  MagnifyingGlass,
  Note,
  PencilSimple,
  Plus,
  SidebarSimple,
  Star,
  Trash,
  WarningCircle,
  WarningOctagon,
  X,
} from '@phosphor-icons/react';
