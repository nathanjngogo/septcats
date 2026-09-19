/**
 * SlashMenu.tsx —— 斜杠菜单浮层 UI（对齐 01-editor.html 的 .menu）。
 *
 * 受控于 `rules/slashMenu.ts` 的状态机：本组件只做「查询 → 列表 → 键盘导航 → 回调」，
 * 不拥有 query（由宿主喂入），也不生成 Op。键盘：↑↓ 移动（循环）、Enter 选中、Esc 关闭。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { filterSlashCommands, type SlashItem } from '../rules/slashMenu';
import { clampOffsetInViewport } from './viewport';
import './editor.css';

/** 浮层与视口边缘的最小余量（结构值，非设计 token 语义）。 */
const SLASH_VIEWPORT_MARGIN = 8;

export interface SlashMenuProps {
  open: boolean;
  query: string;
  onSelect: (item: SlashItem) => void;
  onClose: () => void;
  /** 覆盖候选（宿主持有状态机时喂入；缺省按 query 现场过滤）。 */
  items?: SlashItem[];
  position?: { top: number; left: number } | undefined;
  title?: ReactNode;
}

export function SlashMenu({ open, query, onSelect, onClose, items, position, title }: SlashMenuProps) {
  const list = items ?? filterSlashCommands(query);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** 视口夹紧偏移（T32-01 §1.2：贴光标后越界则平移回视口内）。 */
  const [clamp, setClamp] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // 渲染后实测：底/右越界先压回，顶/左不足再保底（纯函数 clampOffsetInViewport）
  useLayoutEffect(() => {
    if (!open || position === undefined) {
      setClamp({ dx: 0, dy: 0 });
      return;
    }
    const el = menuRef.current;
    if (el === null) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setClamp(clampOffsetInViewport(rect, viewport, SLASH_VIEWPORT_MARGIN));
  }, [open, position, list.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const size = list.length;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (size > 0) {
          setActiveIndex((index) => (index + 1) % size);
        }
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (size > 0) {
          setActiveIndex((index) => (index - 1 + size) % size);
        }
        return;
      }
      if (event.key === 'Enter') {
        const item = list[activeIndex];
        if (item !== undefined) {
          event.preventDefault();
          onSelect(item);
        }
      }
    };
    // 菜单外 mousedown 关闭（对齐 BlockControls 外点关闭手感；菜单内点击不关）
    const onPointerDown = (event: MouseEvent) => {
      const root = menuRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, list, activeIndex, onSelect, onClose]);

  if (!open) {
    return null;
  }

  const style: CSSProperties | undefined =
    position === undefined
      ? undefined
      : { top: position.top + clamp.dy, left: position.left + clamp.dx };

  return (
    <div
      ref={menuRef}
      className="sc-slashmenu"
      role="listbox"
      aria-label="块类型"
      style={style}
      data-testid="septcats-slashmenu"
    >
      <div className="sc-slashmenu__title">
        {title ?? (
          <>
            转为块类型 · 输入 <b>/</b> 后继续过滤
          </>
        )}
      </div>
      {list.length === 0 ? (
        <div className="sc-slashmenu__empty">无匹配块型</div>
      ) : (
        list.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            data-command-id={item.id}
            className={
              index === activeIndex
                ? 'sc-slashmenu__item sc-slashmenu__item--active'
                : 'sc-slashmenu__item'
            }
            onMouseEnter={() => {
              setActiveIndex(index);
            }}
            onClick={() => {
              onSelect(item);
            }}
          >
            <span className="sc-slashmenu__label">{item.label}</span>
            <span className="sc-slashmenu__hint">{item.hint}</span>
          </button>
        ))
      )}
    </div>
  );
}
