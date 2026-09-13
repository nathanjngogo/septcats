import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import './Input.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  helper?: string;
  error?: string;
}

/**
 * Input —— 固定结构：label（上）/ 控件 / helper（中）/ error（下，role=alert）。
 * 错误态 border→danger；focus 由全局 :focus-visible 环 + border→accent 共同表达。
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helper, error, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `sc-input-${autoId}`;
  const helperId = helper === undefined ? undefined : `${inputId}-helper`;
  const errorId = error === undefined ? undefined : `${inputId}-error`;
  const describedBy = [helperId, errorId].filter((value): value is string => value !== undefined).join(' ');

  return (
    <div className={clsx('sc-field', error !== undefined && 'sc-field--error', className)}>
      {label === undefined ? null : (
        <label className="sc-field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className="sc-field__control"
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        {...rest}
      />
      {helper === undefined ? null : (
        <p className="sc-field__helper" id={helperId}>
          {helper}
        </p>
      )}
      {error === undefined ? null : (
        <p className="sc-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
