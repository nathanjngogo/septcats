import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Icon, type IconGlyph } from './Icon';
import './IconButton.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: IconGlyph;
  /** 必填：图标钮无可见文字，必须携带可访问名（同时作为 title 提示）。 */
  label: string;
  type?: 'button' | 'submit' | 'reset';
}

/** IconButton —— 工具条/顶栏专用（ghost 语义），尺寸固定 28 档。 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, type = 'button', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={clsx('sc-iconbtn', className)}
      {...rest}
    >
      <Icon icon={icon} size="sm" />
    </button>
  );
});
