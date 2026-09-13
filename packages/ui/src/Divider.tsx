import clsx from 'clsx';
import './Divider.css';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/** Divider —— hairline 是 1px 分隔线唯一来源；表格只用横向。 */
export function Divider({ orientation = 'horizontal', className }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={clsx('sc-divider', `sc-divider--${orientation}`, className)}
    />
  );
}
