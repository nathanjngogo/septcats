import clsx from 'clsx';
import './Spinner.css';

export type SpinnerSize = 'sm' | 'md';

export interface SpinnerProps {
  size?: SpinnerSize;
  /** 可访问名（默认「加载中」）；本组件只用于图标级等待，不替代骨架屏。 */
  label?: string;
  className?: string;
}

/**
 * Spinner —— 仅图标级（按钮内、行内等待）。
 * 数据视图的加载态必须用 Skeleton（形似最终布局），禁通用转圈。
 */
export function Spinner({ size = 'sm', label = '加载中', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={clsx('sc-spinner', `sc-spinner--${size}`, className)}
    />
  );
}
