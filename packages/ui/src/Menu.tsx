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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  /**
   * 点空白关闭（T60-01 ③）：文档级唯一一处治理全仓 Menu 实例（侧栏行菜单 / 面板行菜单 /
   * 视图菜单 / 筛选·属性菜单…）。判定 = 事件目标不在本菜单根内 → onDismiss（与 Escape 同出口）。
   *
   * 为什么用 `click` 而不是 `pointerdown`：Menu 的触发器（⋮ / ▾ 钮）几乎都是**toggle**
   * （`setOpen(v => !v)`），且触发器与菜单**不住在同一个 DOM 根内**（触发器在宿主行上、
   * 菜单是本组件）。pointerdown 早于触发器自身的 onClick 派发 → 会「先被 outside 关掉、
   * 再被 toggle 打开」，用户按键关不掉菜单（老账里有 dbview 等宿主，本单不许逐个改宿主）。
   * `click` 冒泡发生在 React 根容器（触发器的 onClick）之后：toggle 已经算完，
   * 此时目标若在菜单外再补一次 onDismiss，两者同向（幂等）→ 无竞态。
   * 菜单项被点时宿主通常已卸载本组件（rootRef=null）→ 直接空操作，也不会双发。
   */
  useEffect(() => {
    const onDocumentClick = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (root === null) {
        return;
      }
      // 「移入…」二级换实例修复（T64 后暴露）：宿主在按钮 onClick 里同步换菜单实例时，
      // 旧按钮已被摘出 DOM；本 click 继续冒泡到 document，新实例的 root 不含这个游离
      // 节点 → 会被误判为「点空白」而自灭。游离节点不是用户的真实点击目标，直接跳过。
      if (event.target instanceof Node && !document.contains(event.target)) {
        return;
      }
      if (event.target instanceof Node && root.contains(event.target)) {
        return;
      }
      onDismissRef.current?.();
    };
    document.addEventListener('click', onDocumentClick);
    return () => {
      document.removeEventListener('click', onDocumentClick);
    };
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
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      className={clsx('sc-menu', className)}
      onKeyDown={onKeyDown}
    >
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
