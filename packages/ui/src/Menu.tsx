import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { Kbd } from './Kbd';
import './Menu.css';

export interface MenuEntry {
  id: string;
  label: ReactNode;
  hint?: string | undefined;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuProps {
  items: readonly MenuEntry[];
  label?: string | undefined;
  onSelect?: (id: string) => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Menu —— role="menu" / role="menuitem"，方向键移动焦点、Enter 触发、Esc 关闭。
 * 方向键只落在可用项上（跳过 disabled），焦点真实移动（不靠视觉高亮假装可达）。
 */
export function Menu({ items, label, onSelect, onDismiss, className }: MenuProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  const move = (from: number, step: number): number => {
    if (items.length === 0) {
      return from;
    }
    let next = from;
    for (let guard = 0; guard < items.length; guard += 1) {
      next = (next + step + items.length) % items.length;
      if (items[next]?.disabled !== true) {
        return next;
      }
    }
    return from;
  };

  const focusAt = (index: number): void => {
    setActiveIndex(index);
    itemRefs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss?.();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(move(activeIndex, 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(move(activeIndex, -1));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const entry = items[activeIndex];
      if (entry !== undefined && entry.disabled !== true) {
        onSelect?.(entry.id);
      }
    }
  };

  return (
    <div role="menu" aria-label={label} className={clsx('sc-menu', className)} onKeyDown={onKeyDown}>
      {items.map((entry, index) => (
        <button
          key={entry.id}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          type="button"
          role="menuitem"
          tabIndex={index === activeIndex ? 0 : -1}
          disabled={entry.disabled}
          aria-disabled={entry.disabled === true ? true : undefined}
          className={clsx(
            'sc-menu__item',
            index === activeIndex && 'sc-menu__item--active',
            entry.danger === true && 'sc-menu__item--danger',
          )}
          onMouseEnter={() => {
            setActiveIndex(index);
          }}
          onClick={() => {
            if (entry.disabled !== true) {
              onSelect?.(entry.id);
            }
          }}
        >
          <span className="sc-menu__label">{entry.label}</span>
          {entry.hint === undefined ? null : <Kbd>{entry.hint}</Kbd>}
        </button>
      ))}
    </div>
  );
}
