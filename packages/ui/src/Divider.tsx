import clsx from 'clsx';
import './Divider.css';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/** Divider —— 1px 分隔线的组件出口（T62-01：分隔线走 `background` 填充而非 `border`，
 *  属「非框线」面/轨落点，故仍取 hairline；见 DESIGN.md「Pixel Borders」不动清单）。 */
export function Divider({ orientation = 'horizontal', className }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={clsx('sc-divider', `sc-divider--${orientation}`, className)}
    />
  );
}
