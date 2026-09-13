/**
 * SelectionToolbar.tsx —— 选区浮动工具条（对齐 01-editor.html 的 .floating：B I U code link）。
 *
 * 位置由纯函数 `selectionRect(锚点矩形, 工具条尺寸)` 计算（可单测，无 DOM 依赖）。
 * mark 切换走原生 PM 事务（我们的 mark 是自写的，没有 Tiptap 的 toggle* 命令）。
 * 说明：U（下划线）不在 schema-v1 §3 的内联 mark 词汇表里，**按契约置灰**（见报告 DEVIATIONS）。
 */
import type { CSSProperties } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { isAllowedHref } from '../marks';
import { CodeIcon, LinkIcon } from './icons';
import './editor.css';

export interface SelectionRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface FloatingPosition {
  top: number;
  left: number;
}

export const DEFAULT_TOOLBAR_SIZE = { width: 232, height: 36 } as const;

/** 选区上方居中；越界钳到 >= 0（面板贴边时不飞出屏幕）。 */
export function selectionRect(
  anchor: SelectionRect,
  toolbar: { width: number; height: number },
  gap = 8,
): FloatingPosition {
  const left = anchor.left + anchor.width / 2 - toolbar.width / 2;
  const top = anchor.top - toolbar.height - gap;
  return { left: Math.max(0, Math.round(left)), top: Math.max(0, Math.round(top)) };
}

/** 选区内是否已应用某 mark。 */
export function selectionHasMark(editor: TiptapEditor, markName: string): boolean {
  const { state } = editor;
  const markType = state.schema.marks[markName];
  if (markType === undefined) {
    return false;
  }
  const { from, to } = state.selection;
  if (from === to) {
    const stored = state.storedMarks ?? state.selection.$from.marks();
    return stored.some((mark) => mark.type === markType);
  }
  return state.doc.rangeHasMark(from, to, markType);
}

/** 切换 mark（选区为空时不动；不伪造 stored marks，避免语义漂移）。 */
export function toggleMarkInSelection(editor: TiptapEditor, markName: string): boolean {
  const { state, view } = editor;
  const markType = state.schema.marks[markName];
  const { from, to, empty } = state.selection;
  if (markType === undefined || empty) {
    return false;
  }
  const tr = state.tr;
  if (state.doc.rangeHasMark(from, to, markType)) {
    tr.removeMark(from, to, markType);
  } else {
    tr.addMark(from, to, markType.create());
  }
  view.dispatch(tr);
  return true;
}

/** 给选区加 link（href 走白名单校验；非法 href 返回 false，不改文档）。 */
export function applyLinkInSelection(editor: TiptapEditor, href: string): boolean {
  const { state, view } = editor;
  const markType = state.schema.marks['link'];
  const { from, to, empty } = state.selection;
  if (markType === undefined || empty || !isAllowedHref(href)) {
    return false;
  }
  const tr = state.tr;
  tr.removeMark(from, to, markType);
  tr.addMark(from, to, markType.create({ href }));
  view.dispatch(tr);
  return true;
}

export interface SelectionToolbarProps {
  editor: TiptapEditor | null;
  /** 选区锚点矩形（null = 不显示）。 */
  anchor: SelectionRect | null;
  /** 点「链接」时的宿主回调（宿主弹输入框；不传则按钮不出现副作用）。 */
  onRequestLink?: (editor: TiptapEditor) => void;
  toolbarSize?: { width: number; height: number };
}

interface ToolButton {
  id: string;
  label: string;
  glyph?: string;
  icon?: 'code' | 'link';
  disabled?: boolean;
  onClick?: (editor: TiptapEditor) => void;
}

export function SelectionToolbar({
  editor,
  anchor,
  onRequestLink,
  toolbarSize,
}: SelectionToolbarProps) {
  if (editor === null || anchor === null) {
    return null;
  }
  const size = toolbarSize ?? DEFAULT_TOOLBAR_SIZE;
  const position = selectionRect(anchor, size);
  const style: CSSProperties = { top: position.top, left: position.left };

  const buttons: ToolButton[] = [
    { id: 'bold', label: '加粗', glyph: 'B', onClick: (target) => void toggleMarkInSelection(target, 'bold') },
    { id: 'italic', label: '斜体', glyph: 'I', onClick: (target) => void toggleMarkInSelection(target, 'italic') },
    { id: 'underline', label: '下划线（v1 词汇表不支持）', glyph: 'U', disabled: true },
    { id: 'code', label: '行内代码', icon: 'code', onClick: (target) => void toggleMarkInSelection(target, 'code') },
    {
      id: 'link',
      label: '链接',
      icon: 'link',
      ...(onRequestLink === undefined ? {} : { onClick: (target: TiptapEditor) => onRequestLink(target) }),
    },
  ];

  return (
    <div className="sc-selectiontoolbar" role="toolbar" aria-label="选区格式" style={style}>
      {buttons.map((button) => (
        <button
          key={button.id}
          type="button"
          className={
            selectionHasMark(editor, button.id)
              ? 'sc-selectiontoolbar__btn sc-selectiontoolbar__btn--active'
              : 'sc-selectiontoolbar__btn'
          }
          aria-label={button.label}
          title={button.label}
          aria-pressed={button.disabled === true ? undefined : selectionHasMark(editor, button.id)}
          disabled={button.disabled === true}
          onClick={() => {
            button.onClick?.(editor);
          }}
        >
          {button.icon === 'code' ? <CodeIcon /> : null}
          {button.icon === 'link' ? <LinkIcon /> : null}
          {button.glyph === undefined ? null : (
            <span className="sc-selectiontoolbar__glyph">{button.glyph}</span>
          )}
        </button>
      ))}
    </div>
  );
}
