/**
 * BlockControls.tsx —— 块手柄（⋮⋮）+ 菜单：删除 / 复制 / 转为… 9 块型 / 颜色。
 * hover 显形（`--visible`），键盘可达（↑↓ 移动、Enter 执行、Esc 关闭，aria-menu 语义）。
 * 组件只发**意图**（onAction），真正的 Op 生成与提交由宿主（PageView → EditSession）负责。
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { BlockType } from '../model';
import { SLASH_ITEMS } from '../rules/slashMenu';
import { CopyIcon, DotsHandleIcon, TrashIcon } from './icons';
import './editor.css';

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
  /** hover 显形；缺省 false（测试可直接展开）。 */
  visible?: boolean;
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

export function BlockControls({ blockId, onAction, visible = false }: BlockControlsProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const disabled = blockId === null;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const run = (entry: MenuEntry) => {
    setOpen(false);
    onAction(entry.action);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const size = MENU_ENTRIES.length;
    if (event.key === 'Escape') {
      setOpen(false);
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

  return (
    <div ref={rootRef} className={rootClass} data-block-id={blockId ?? ''}>
      <button
        type="button"
        className="sc-blockcontrol__handle"
        aria-label="块操作"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        <DotsHandleIcon />
      </button>
      {open && !disabled ? (
        <div
          className="sc-blockcontrol__menu"
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
