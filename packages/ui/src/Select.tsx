import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import clsx from 'clsx';
import { CaretDown, Check, Icon } from './Icon';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value: string;
  onChange?: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Select —— 原生 select 无法承载 token 化弹层，故用 button + role="listbox" 自绘。
 * 键盘：Enter/Space/↑/↓ 展开，↑/↓ 移动，Enter 选中，Esc 关闭（aria-activedescendant 指向高亮项）。
 */
export function Select({
  options,
  value,
  onChange,
  label,
  placeholder = '请选择',
  disabled = false,
  className,
  id,
}: SelectProps) {
  const autoId = useId();
  const baseId = id ?? `sc-select-${autoId}`;
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-listbox`;

  const selectedIndex = options.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex < 0 ? 0 : selectedIndex);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = selectedIndex < 0 ? undefined : options[selectedIndex];

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex);
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, selectedIndex]);

  const commit = (index: number): void => {
    const option = options[index];
    if (option === undefined || option.disabled === true) {
      return;
    }
    onChange?.(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open) {
      // 闭合时 Enter/Space 交给原生 button 的 click 开合，避免与这里重复切换
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' || event.key === ' ') {
      // preventDefault：阻断原生 button 的激活，否则会先选中又立刻重开
      event.preventDefault();
      commit(activeIndex);
    }
  };

  return (
    <div
      ref={rootRef}
      className={clsx('sc-select', disabled && 'sc-select--disabled', className)}
      onKeyDown={onKeyDown}
    >
      {label === undefined ? null : (
        <span className="sc-select__label" id={labelId}>
          {label}
        </span>
      )}
      <button
        type="button"
        className="sc-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={label === undefined ? undefined : labelId}
        aria-label={label === undefined ? placeholder : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${String(activeIndex)}` : undefined}
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span className={clsx('sc-select__value', selected === undefined && 'sc-select__value--placeholder')}>
          {selected === undefined ? placeholder : selected.label}
        </span>
        <Icon icon={CaretDown} size="sm" className="sc-select__caret" />
      </button>
      {open ? (
        <ul className="sc-select__listbox" role="listbox" id={listId} aria-labelledby={label === undefined ? undefined : labelId}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${String(index)}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled === true ? true : undefined}
              className={clsx('sc-select__option', index === activeIndex && 'sc-select__option--active')}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
              onClick={() => {
                commit(index);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Icon icon={Check} size="sm" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
