/**
 * ResizeHandle.tsx —— 左右栏拖拽宽度把手（TASK-T61-01 §2；PRD-R13 ⑧）。
 *
 * 两个实例：
 *  - `side='sidebar'`：挂侧栏右缘（'.sc-shell__sidebar' 与主区交界）；
 *  - `side='ai'`：挂 AI 面板左缘（右侧栏布局）。`position:'bottom'` 时面板走纵向
 *    全宽 + 定高，宽度无意义 → 本组件**不挂**（避免无效控件）。
 *  侧栏折叠态（position='collapsed'）侧栏整列 display:none、宽度同样无意义 → 不挂。
 *
 * 口径（任务书 §2.2）：
 *  - `pointerdown` → `setPointerCapture` → `pointermove` 写宽（**rAF 节流**）；
 *  - `pointerup` 收尾落盘——全程走 `layoutActions.setSidebarWidth / setAiWidth`
 *    （= 既有 `patchLayout`：注入根变量 + 写 localStorage + preset 自动转 custom），
 *    与 T57 滑杆**同一真源**，不另造预览态；
 *  - 双击 = 该侧回默认宽；键盘 ←/→ 步进 16px、Home 回默认；aria 语义照 T57 滑杆口径
 *    （role/aria-valuenow/min/max + aria-label，可聚焦）。
 *  - 上限由 layoutState 的 `maxPanelWidth(视口)` 统一夹紧（min(480, 视口 30%)）。
 */
import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../i18n';
import {
  AI_WIDTH_DEFAULT,
  LAYOUT_PRESETS,
  PANEL_RESIZE_STEP,
  SIDEBAR_WIDTH_MIN,
  AI_WIDTH_MIN,
  clampAiWidth,
  clampSidebarWidth,
  layoutActions,
  maxPanelWidth,
  useLayout,
  type LayoutState,
} from './layoutState';
import './ResizeHandle.css';

export type ResizeSide = 'sidebar' | 'ai';

export interface ResizeHandleProps {
  side: ResizeSide;
}

/** 该侧当前宽度（单一取值口，避免两处 switch 漂移）。 */
function widthOf(side: ResizeSide, layout: LayoutState): number {
  return side === 'sidebar' ? layout.sidebar.width : layout.ai.width;
}

/** 拖拽方向：侧栏把手在其**右缘**（右移加宽）；AI 把手在其**左缘**（左移加宽）。 */
function directionOf(side: ResizeSide): 1 | -1 {
  return side === 'sidebar' ? 1 : -1;
}

/** 该侧默认宽（双击 / Home；侧栏取 notion 预设宽，AI 取 AI_WIDTH_DEFAULT）。 */
function defaultWidthOf(side: ResizeSide): number {
  return side === 'sidebar' ? LAYOUT_PRESETS.notion.sidebar.width : AI_WIDTH_DEFAULT;
}

function minWidthOf(side: ResizeSide): number {
  return side === 'sidebar' ? SIDEBAR_WIDTH_MIN : AI_WIDTH_MIN;
}

function clampOf(side: ResizeSide, width: number): number {
  return side === 'sidebar' ? clampSidebarWidth(width) : clampAiWidth(width);
}

/** 写入布局（patchLayout 单一出口：即时生效 + 持久化 + preset→custom）。 */
function applyWidth(side: ResizeSide, width: number): void {
  if (side === 'sidebar') {
    layoutActions.setSidebarWidth(width);
    return;
  }
  layoutActions.setAiWidth(width);
}

/** rAF 是否可用（jsdom/无 rAF 环境退化：直接落值，不吞拖拽）。 */
function hasRaf(): boolean {
  return typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame === 'function';
}

function requestFrame(callback: () => void): number {
  const raf = (globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number })
    .requestAnimationFrame;
  return typeof raf === 'function' ? raf(() => {
    callback();
  }) : 0;
}

function cancelFrame(handle: number): void {
  const caf = (globalThis as { cancelAnimationFrame?: (handle: number) => void }).cancelAnimationFrame;
  if (typeof caf === 'function' && handle !== 0) {
    caf(handle);
  }
}

export function ResizeHandle({ side }: ResizeHandleProps) {
  const layout = useLayout((state) => state.layout);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const frameRef = useRef<number>(0);
  const pendingRef = useRef<number | null>(null);

  const width = widthOf(side, layout);
  const min = minWidthOf(side);
  const max = Math.max(min, maxPanelWidth());

  const flushPending = (): void => {
    frameRef.current = 0;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) {
      applyWidth(side, pending);
    }
  };

  /** 节流写宽：同一帧内多次 pointermove 只落最后一值（pointerup 前必 flush）。 */
  const scheduleWidth = (next: number): void => {
    if (!hasRaf()) {
      applyWidth(side, next);
      return;
    }
    pendingRef.current = next;
    if (frameRef.current === 0) {
      frameRef.current = requestFrame(flushPending);
    }
  };

  const endDrag = (): void => {
    if (dragRef.current === null) {
      return;
    }
    dragRef.current = null;
    // 收尾：把最后一帧的宽度落实（幂等——与滑杆/拖拽同一真源）
    cancelFrame(frameRef.current);
    frameRef.current = 0;
    const pending = pendingRef.current;
    pendingRef.current = null;
    setDragging(false);
    if (pending !== null) {
      applyWidth(side, pending);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
    setDragging(true);
    const target = event.currentTarget;
    // jsdom 未实现指针捕获 → 容错（真机走 capture，指针移出窗口仍收 move/up）
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        /* 捕获失败不影响拖拽（后续 move 仍落在元素上） */
      }
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const delta = (event.clientX - drag.startX) * directionOf(side);
    scheduleWidth(drag.startWidth + delta);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    const target = event.currentTarget;
    if (typeof target.releasePointerCapture === 'function') {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        /* 未捕获过 → 忽略 */
      }
    }
    endDrag();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = PANEL_RESIZE_STEP * directionOf(side);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      applyWidth(side, clampOf(side, width + step));
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applyWidth(side, clampOf(side, width - step));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      applyWidth(side, clampOf(side, defaultWidthOf(side)));
    }
  };

  // 无意义态不挂把手：AI 非右侧栏（bottom/hidden）、侧栏折叠态
  if (side === 'ai' && layout.ai.position !== 'right') {
    return null;
  }
  if (side === 'sidebar' && layout.sidebar.position === 'collapsed') {
    return null;
  }

  const label = side === 'sidebar' ? t('app.resizeSidebar') : t('app.resizeAi');
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-testid={`resize-${side}`}
      data-width={width}
      className={dragging ? `sc-resize sc-resize--${side} sc-resize--active` : `sc-resize sc-resize--${side}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        applyWidth(side, clampOf(side, defaultWidthOf(side)));
      }}
      onKeyDown={onKeyDown}
    />
  );
}
