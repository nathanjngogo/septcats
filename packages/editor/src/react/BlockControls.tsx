/**
 * BlockControls.tsx —— 块手柄（⋮⋮）+ 菜单：删除 / 复制 / 转为… 9 块型 / 颜色。
 * hover 显形（`--visible`），键盘可达（↑↓ 移动、Enter 执行、Esc 关闭，aria-menu 语义）。
 * 组件只发**意图**（onAction），真正的 Op 生成与提交由宿主（PageView → EditSession）负责。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HTMLAttributes, KeyboardEvent } from 'react';
import type { BlockType } from '../model';
import { SLASH_ITEMS } from '../rules/slashMenu';
import { overflowsBottom } from './viewport';
import { CopyIcon, DotsHandleIcon, PlusIcon, TrashIcon } from './icons';
import './editor.css';

/** 浮层与视口边缘的最小余量（结构值，非设计 token 语义）。 */
const MENU_VIEWPORT_MARGIN = 8;

export type BlockColorToken = 'default' | 'accent' | 'danger' | 'success' | 'faint';

export const BLOCK_COLORS: ReadonlyArray<{ token: BlockColorToken; label: string }> = [
  { token: 'default', label: '默认' },
  { token: 'accent', label: '强调' },
  { token: 'danger', label: '警示' },
  { token: 'success', label: '完成' },
  { token: 'faint', label: '弱化' },
];

export type BlockAction =
  | { kind: 'delete' }
  | { kind: 'duplicate' }
  | { kind: 'convert'; blockType: BlockType; level?: 1 | 2 | 3 }
  | { kind: 'color'; token: BlockColorToken };

export interface BlockControlsProps {
  /** 当前块 id；null = 无选区（手柄禁用）。 */
  blockId: string | null;
  onAction: (action: BlockAction) => void;
  /** 点击 ＋ 在当前块后插入新块（宿主实现；未传则不渲染 ＋）。 */
  onInsert?: () => void;
  /** 菜单开裔回调（宿主用于「菜单开着时钉住手柄」）。 */
  onOpenChange?: (open: boolean) => void;
  /** hover 显形；缺省 false（测试可直接展开）。 */
  visible?: boolean;
  /**
   * T60-01 ①：**拖拽透传口**（宿主注入 `draggable` + `onDragStart`/`onDragEnd`）。
   * 为什么不挂在簇壳上：HTML5 drag 不因「壳 draggable、指针落在壳内 button 上」而发起
   * （交互元素命中吞掉 dragstart），所以抓手必须落在 ⋮⋮ 键本体上。
   * 缺省 undefined = 不注入任何属性，组件行为与历史零差异（其它宿主/测试不受影响）。
   */
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
}

interface MenuEntry {
  id: string;
  group: '块' | '转为' | '颜色';
  label: string;
  hint: string;
  action: BlockAction;
}

function buildMenuEntries(): MenuEntry[] {
  const entries: MenuEntry[] = [
    { id: 'delete', group: '块', label: '删除', hint: '软删除 · 可撤销', action: { kind: 'delete' } },
    { id: 'duplicate', group: '块', label: '复制', hint: '在下方插入副本', action: { kind: 'duplicate' } },
  ];
  for (const item of SLASH_ITEMS) {
    entries.push({
      id: `convert-${item.id}`,
      group: '转为',
      label: item.label,
      hint: item.hint,
      action:
        item.level === undefined
          ? { kind: 'convert', blockType: item.blockType }
          : { kind: 'convert', blockType: item.blockType, level: item.level },
    });
  }
  for (const color of BLOCK_COLORS) {
    entries.push({
      id: `color-${color.token}`,
      group: '颜色',
      label: color.label,
      hint: '',
      action: { kind: 'color', token: color.token },
    });
  }
  return entries;
}

const MENU_ENTRIES: readonly MenuEntry[] = buildMenuEntries();

export function BlockControls({
  blockId,
  onAction,
  onInsert,
  onOpenChange,
  visible = false,
  dragHandleProps,
}: BlockControlsProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  /** 菜单放不下视口底边时向上翻转（T32-01 §1.1）。 */
  const [flipAbove, setFlipAbove] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const disabled = blockId === null;

  /** 开合统一入口：状态与宿主回调同步走（外部点击/Esc 关闭也要通知）。 */
  const applyOpen = (next: boolean) => {
    setOpen(next);
    onOpenChangeRef.current?.(next);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    /**
     * T60-01 ③：点空白关菜单。语义与 `packages/ui/Menu` 的 outside-close 对齐
     * （同一「点外部关闭」口径），但本组件是自实现菜单、**开关钮住在簇内**
     * （rootRef = .sc-blockcontrol 同时含 ⋮⋮ 与菜单），故用 `root.contains` 判定：
     * 命中钮本体即非 outside → 不产生「先关后开」的同事件竞态，用 pointerdown
     * 与 ui/Menu 同事件族（含触摸/触控笔，不只鼠标）。
     */
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        applyOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // 菜单渲染后实测一次：底边放不下且上方有正空间 → 翻转到手柄上方
  useLayoutEffect(() => {
    if (!open) {
      setFlipAbove(false);
      return;
    }
    const menu = menuRef.current;
    const root = rootRef.current;
    if (menu === null || root === null) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (!overflowsBottom(rect, viewport, MENU_VIEWPORT_MARGIN)) {
      setFlipAbove(false);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    setFlipAbove(rootRect.top - rect.height - MENU_VIEWPORT_MARGIN >= 0);
  }, [open, blockId]);

  const run = (entry: MenuEntry) => {
    applyOpen(false);
    onAction(entry.action);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const size = MENU_ENTRIES.length;
    if (event.key === 'Escape') {
      applyOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % size);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + size) % size);
      return;
    }
    if (event.key === 'Enter') {
      const entry = MENU_ENTRIES[activeIndex];
      if (entry !== undefined) {
        event.preventDefault();
        run(entry);
      }
    }
  };

  const rootClass = visible || open ? 'sc-blockcontrol sc-blockcontrol--visible' : 'sc-blockcontrol';
  const menuClass = flipAbove
    ? 'sc-blockcontrol__menu sc-blockcontrol__menu--above'
    : 'sc-blockcontrol__menu';

  return (
    <div ref={rootRef} className={rootClass} data-block-id={blockId ?? ''}>
      {/* T60-01 ①：视觉序 = 【⋮⋮】【+】（Notion 惯例：抓手在左、加号贴右）；
          行为不换——⋮⋮ 仍=块操作菜单、＋ 仍在下方插块。dragHandleProps 透传到
          ⋮⋮ 键（拖拽发起元素），＋ 键从不接收它 → 永远不可拖。 */}
      <button
        type="button"
        {...dragHandleProps}
        className="sc-blockcontrol__handle"
        aria-label="块操作"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          applyOpen(!open);
        }}
      >
        <DotsHandleIcon />
      </button>
      {onInsert !== undefined ? (
        <button
          type="button"
          className="sc-blockcontrol__add"
          aria-label="新增块"
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            onInsert();
          }}
        >
          <PlusIcon />
        </button>
      ) : null}
      {open && !disabled ? (
        <div
          ref={menuRef}
          className={menuClass}
          role="menu"
          tabIndex={-1}
          aria-label="块操作菜单"
          onKeyDown={onKeyDown}
        >
          {MENU_ENTRIES.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              data-group={entry.group}
              className={
                index === activeIndex
                  ? 'sc-blockcontrol__item sc-blockcontrol__item--active'
                  : 'sc-blockcontrol__item'
              }
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
              onClick={() => {
                setActiveIndex(index);
                run(entry);
              }}
            >
              <span className="sc-blockcontrol__glyph">
                {entry.id === 'delete' ? <TrashIcon /> : null}
                {entry.id === 'duplicate' ? <CopyIcon /> : null}
              </span>
              <span className="sc-blockcontrol__text">
                <span className="sc-blockcontrol__label">{entry.label}</span>
                {entry.hint.length > 0 ? (
                  <span className="sc-blockcontrol__hint">{entry.hint}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
