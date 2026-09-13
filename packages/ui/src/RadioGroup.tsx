import clsx from 'clsx';
import './RadioGroup.css';

export interface RadioGroupOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string = string> {
  options: readonly RadioGroupOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  /** 分组可访问名（radiogroup 的 aria-label）。 */
  label?: string;
  /** 原生 name，保证同一组互斥。 */
  name?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * RadioGroup —— 三态以内的单选（外观主题三选）。原生 input[type=radio] 承载语义与
 * 键盘（↑↓ 在组内移动）；视觉上渲染为分段控件（mockup 06 的 `.seg` 三件套）。
 */
export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  name,
  disabled = false,
  className,
}: RadioGroupProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('sc-radio-group', className)}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={clsx('sc-radio', checked && 'sc-radio--on')}
          >
            <input
              type="radio"
              className="sc-radio__input"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled || option.disabled === true}
              onChange={() => onChange?.(option.value)}
            />
            <span className="sc-radio__label">{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
