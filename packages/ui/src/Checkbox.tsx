import { forwardRef, useEffect, useRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { Check, Icon } from './Icon';
import './Checkbox.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  /** 半选：原生 indeterminate 只能走 DOM 属性，故用 effect 写入。 */
  indeterminate?: boolean;
}

/** Checkbox —— 原生 input 承载语义与键盘，视觉盒只做绘制。 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, indeterminate = false, className, disabled, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (innerRef.current !== null) {
      innerRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label className={clsx('sc-cbx', disabled === true && 'sc-cbx--disabled', className)}>
      <input
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref !== null) {
            ref.current = node;
          }
        }}
        type="checkbox"
        className="sc-cbx__input"
        disabled={disabled}
        {...rest}
      />
      <span className="sc-cbx__box" aria-hidden="true">
        <Icon icon={Check} size="sm" className="sc-cbx__tick" />
      </span>
      {label === undefined ? null : <span className="sc-cbx__label">{label}</span>}
    </label>
  );
});
