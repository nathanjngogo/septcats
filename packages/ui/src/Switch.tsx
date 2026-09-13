import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import './Switch.css';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** 可访问名（开关本身无文字） */
  label: string;
}

/** Switch —— role=switch + aria-checked；Space/Enter 由原生 button 承载。 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, className, disabled, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={clsx('sc-switch', checked && 'sc-switch--on', className)}
      onClick={(event) => {
        onClick?.(event);
        onCheckedChange?.(!checked);
      }}
      {...rest}
    >
      <span className="sc-switch__knob" aria-hidden="true" />
    </button>
  );
});
