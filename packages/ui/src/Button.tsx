import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon, type IconGlyph } from './Icon';
import { Spinner } from './Spinner';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconGlyph;
  /** 默认 button，避免误触发表单提交 */
  type?: 'button' | 'submit' | 'reset';
  children?: ReactNode;
}

/**
 * Button —— 全应用同屏最多一个 primary（§Overview：唯一强调色是琥珀铃铛）。
 * 三态强制：hover / active(1px 按压) / focus-visible（全局环）；loading 时禁用并报 aria-busy。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    type = 'button',
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading;
  return (
    <button
      ref={ref}
      type={type}
      className={clsx('sc-btn', `sc-btn--${variant}`, `sc-btn--${size}`, className)}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 'sm' : 'md'} /> : null}
      {!loading && icon !== undefined ? <Icon icon={icon} size="sm" /> : null}
      {children === undefined || children === null ? null : <span className="sc-btn__label">{children}</span>}
    </button>
  );
});
