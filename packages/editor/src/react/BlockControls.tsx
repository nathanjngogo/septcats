/**
 * BlockControls.tsx —— 块手柄（⋮⋮）+ 菜单：删除 / 复制 / 转为… 13 块型 / 颜色。
 * hover 显形（`--visible`），键盘可达（↑↓ 移动、Enter 执行、Esc 关闭，aria-menu 语义）。
 * 组件只发**意图**（onAction），真正的 Op 生成与提交由宿主（PageView → EditSession）负责。
 *
 * T78-01：**多选态菜单变体**——`selectionCount >= 2` 时菜单切换为「批量删除 / 批量复制 /
 * 批量转为 / 颜色」，并在顶部显示「已选 N 块」计数区。交互分工：**Shift+click = 纯扩选**
 * （只发 onExtendSelection，不开关菜单——菜单开着会钉住手柄，见 props 注释）；**普通点击**
 * = 本块在选区内则保留选区并开菜单（批量变体），否则先回单块态（onCollapseSelection）再开合。
 * 两个回调缺省 undefined = 组件行为与历史逐位一致（零回归）。
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

/**
 * 手柄菜单意图。T78-01 扩 4 个 `bulk-*` 型（多选态菜单变体）：
 * 意图里**不带 ids**——选区块是宿主的真相，动作落在宿主当前的选区间上（同「动作落在
 * hover 块上」的既有分工：组件只报意图，宿主决定作用对象）。
 */
export type BlockAction =
  | { kind: 'delete' }
  | { kind: 'duplicate' }
  | { kind: 'convert'; blockType: BlockType; level?: 1 | 2 | 3 }
  | { kind: 'color'; token: BlockColorToken }
  | { kind: 'bulk-delete' }
  | { kind: 'bulk-duplicate' }
  | { kind: 'bulk-convert'; blockType: BlockType; level?: 1 | 2 | 3 }
  | { kind: 'bulk-color'; token: BlockColorToken };

/**
 * 多选态菜单的文案注入契约（T78-01）。editor 包不在 apps 的 i18n 扫描面内，
 * 宿主（PageView）用 `t(...)` 注入 zh/en 文案；缺省回落本包中文默认值
 * （与包内既有控件字面量同口径，editor 包单测零 i18n 依赖）。
 */
export interface BlockMenuLabels {
  /** 计数区模板，`{n}` 替换为选中块数。 */
  bulkCount: string;
  /** 批量删除。 */
  bulkDelete: string;
  /** 批量复制。 */
  bulkDuplicate: string;
}

export const DEFAULT_BLOCK_MENU_LABELS: BlockMenuLabels = {
  bulkCount: '已选 {n} 块',
  bulkDelete: '批量删除',
  bulkDuplicate: '批量复制',
};

/** `{n}` 占位替换（纯函数，宿主与单测共用）。模板无占位符时原样返回。 */
export function formatBulkCount(template: string, count: number): string {
  return template.replace('{n}', String(count));
}

function resolveMenuLabels(partial: Partial<BlockMenuLabels> | undefined): BlockMenuLabels {
  return {
    bulkCount: partial?.bulkCount ?? DEFAULT_BLOCK_MENU_LABELS.bulkCount,
    bulkDelete: partial?.bulkDelete ?? DEFAULT_BLOCK_MENU_LABELS.bulkDelete,
    bulkDuplicate: partial?.bulkDuplicate ?? DEFAULT_BLOCK_MENU_LABELS.bulkDuplicate,
  };
}

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
  /** T78-01：当前跨块选区大小；`>= 2` → 菜单切批量变体（缺省/1 = 单块菜单）。 */
  selectionCount?: number;
  /** T78-01：本手柄所属块是否**在**当前跨块选区内（普通点击是否保留选区由它决定）。 */
  handleInSelection?: boolean;
  /**
   * T78-01：Shift+click 手柄 → 请宿主把选区扩到本块（区间重算）。
   * **只扩选、不开关菜单**——菜单开着会钉住手柄归属块（T32-01 §1.1），
   * 钉住后手柄无法移到另一块 ⇒「二次 Shift+click 重算区间」将不可达。
   */
  onExtendSelection?: (blockId: string) => void;
  /** T78-01：普通点击手柄且本块**不在**选区 → 请宿主回单块态（清跨块选区）。 */
  onCollapseSelection?: () => void;
  /** T78-01：批量菜单文案注入（缺省包内中文）。 */
  labels?: Partial<BlockMenuLabels>;
}

interface MenuEntry {
  id: string;
  group: '块' | '转为' | '颜色' | '批量';
  label: string;
  hint: string;
  action: BlockAction;
  /** 契约 testid（T78-01 批量项挂；单块项缺省不挂）。 */
  testid?: string;
  glyph?: 'delete' | 'duplicate';
}

function buildMenuEntries(): MenuEntry[] {
  const entries: MenuEntry[] = [
    {
      id: 'delete',
      group: '块',
      label: '删除',
      hint: '软删除 · 可撤销',
      action: { kind: 'delete' },
      glyph: 'delete',
    },
    {
      id: 'duplicate',
      group: '块',
      label: '复制',
      hint: '在下方插入副本',
      action: { kind: 'duplicate' },
      glyph: 'duplicate',
    },
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

/** T78-01：多选态菜单（批量删除 / 批量复制 / 批量转为 13 型 / 颜色）。 */
function buildBulkMenuEntries(labels: BlockMenuLabels): MenuEntry[] {
  const entries: MenuEntry[] = [
    {
      id: 'bulk-delete',
      group: '批量',
      label: labels.bulkDelete,
      hint: '',
      action: { kind: 'bulk-delete' },
      testid: 'block-menu-bulk-delete',
      glyph: 'delete',
    },
    {
      id: 'bulk-duplicate',
      group: '批量',
      label: labels.bulkDuplicate,
      hint: '',
      action: { kind: 'bulk-duplicate' },
      testid: 'block-menu-bulk-duplicate',
      glyph: 'duplicate',
    },
  ];
  for (const item of SLASH_ITEMS) {
    entries.push({
      id: `bulk-convert-${item.id}`,
      group: '转为',
      label: item.label,
      hint: item.hint,
      action:
        item.level === undefined
          ? { kind: 'bulk-convert', blockType: item.blockType }
          : { kind: 'bulk-convert', blockType: item.blockType, level: item.level },
      // 契约名=块型；标题 1/2/3 共用 `...-heading`（等级由 data-level 区分，见报告 §3）
      testid: `block-menu-bulk-convert-${item.blockType}`,
    });
  }
  for (const color of BLOCK_COLORS) {
    entries.push({
      id: `bulk-color-${color.token}`,
      group: '颜色',
      label: color.label,
      hint: '',
      action: { kind: 'bulk-color', token: color.token },
      testid: `block-menu-bulk-color-${color.token}`,
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
  selectionCount = 0,
  handleInSelection = false,
  onExtendSelection,
  onCollapseSelection,
  labels,
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
  /** T78-01：多选态（>=2 块）→ 菜单切批量变体。 */
  const bulk = selectionCount >= 2;
  const entries: readonly MenuEntry[] = bulk
    ? buildBulkMenuEntries(resolveMenuLabels(labels))
    : MENU_ENTRIES;
  const menuSize = entries.length;

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
    const size = menuSize;
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
      const entry = entries[activeIndex];
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
        data-testid={`block-handle-${blockId ?? ''}`}
        className="sc-blockcontrol__handle"
        aria-label="块操作"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          // T78-01：Shift=只扩选（不开关菜单——菜单会钉住手柄，见 onExtendSelection 注释）
          if (event.shiftKey && onExtendSelection !== undefined && blockId !== null) {
            onExtendSelection(blockId);
            return;
          }
          // 普通点击：本块在跨块选区内 → 保留选区（菜单切批量变体）；否则回单块态
          if (!(bulk && handleInSelection)) {
            onCollapseSelection?.();
          }
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
          {bulk ? (
            <div className="sc-blockcontrol__bulk" data-testid="block-menu-bulk-count">
              {formatBulkCount(resolveMenuLabels(labels).bulkCount, selectionCount)}
            </div>
          ) : null}
          {entries.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              data-group={entry.group}
              {...(entry.testid === undefined ? {} : { 'data-testid': entry.testid })}
              {...(entry.action.kind === 'bulk-convert' && entry.action.level !== undefined
                ? { 'data-level': entry.action.level }
                : {})}
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
                {entry.glyph === 'delete' ? <TrashIcon /> : null}
                {entry.glyph === 'duplicate' ? <CopyIcon /> : null}
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
