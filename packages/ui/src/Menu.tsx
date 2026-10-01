import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { Kbd } from './Kbd';
import './Menu.css';

export interface MenuEntryAction {
  /** 动作稳定 id（宿主 onAction(id) 用它分派，禁依赖数组下标）。 */
  id: string;
  /** 无障碍名（CJK 由宿主传入，如「前移视图」）。 */
  label: string;
  /** 动作钮图形（仓内 Icon 出口传入）。 */
  icon?: ReactNode;
  /** true = 动作不可用（如首项的「前移」）。 */
  disabled?: boolean;
}

export interface MenuEntry {
  id: string;
  label: ReactNode;
  hint?: string | undefined;
  danger?: boolean;
  disabled?: boolean;
  /**
   * 行内动作钮（IDEA-E 视图排序等：菜单项右侧「↑/↓ 移动」）。
   * 键盘等价红线：动作钮是**真 button**（role=menuitem 的父项内），Tab 直达、Enter/Space 触发；
   * 点击**不**走 onSelect（不关闭菜单、不误选视图）。
   */
  actions?: readonly MenuEntryAction[] | undefined;
}

export interface MenuProps {
  items: readonly MenuEntry[];
  label?: string | undefined;
  onSelect?: (id: string) => void;
  /** 行内动作钮触发（actionId = MenuEntryAction.id，entryId = 所在菜单项 id）。 */
  onAction?: (actionId: string, entryId: string) => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Menu —— role="menu" / role="menuitem"，方向键移动焦点、Enter 触发、Esc 关闭。
 * 方向键只落在可用项上（跳过 disabled），焦点真实移动（不靠视觉高亮假装可达）。
 */
export function Menu({ items, label, onSelect, onAction, onDismiss, className }: MenuProps) {
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
      {items.map((entry, index) => {
        const itemButton = (
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
              entry.actions !== undefined && 'sc-menu__item--with-actions',
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
        );
        const actions = entry.actions;
        if (actions === undefined || actions.length === 0) {
          // 无动作项 = 旧 DOM 原样（既有样式/测试零扰动）
          return itemButton;
        }
        // 行内动作钮：与主项**同级**（button 不套 button）；点击只发 onAction，不触发 onSelect
        // （IDEA-E：改序不关菜单、不误选视图）。真 button ⇒ Tab 直达 + Enter/Space 天然可用。
        return (
          <div key={entry.id} className="sc-menu__row">
            {itemButton}
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={action.disabled === true || entry.disabled === true}
                aria-label={action.label}
                className="sc-menu__action"
                onKeyDown={(event) => {
                  // 焦点在动作钮上时，Enter/Space 只激活本钮（阻止冒泡到根的
                  // menuitem 选择逻辑，否则回车改序会连带「选中该视图」）。
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation();
                  }
                }}
                onClick={() => {
                  if (action.disabled !== true && entry.disabled !== true) {
                    onAction?.(action.id, entry.id);
                  }
                }}
              >
                {action.icon ?? action.label}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
