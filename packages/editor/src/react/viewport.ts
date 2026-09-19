/**
 * viewport.ts —— 浮层视口定位的**纯函数**（无 DOM/React；T32-01 §1）。
 *
 * 块操作菜单（BlockControls）与斜杠菜单（SlashMenu）共用：
 * - `overflowsBottom`：底边越出视口 → 菜单向上翻转（Notion 手感）；
 * - `clampOffsetInViewport`：把浮层平移回视口内所需的最小偏移（斜杠菜单贴光标后夹紧）。
 * rect 一律用 getBoundingClientRect 的视口坐标；viewport 用 window.innerWidth/innerHeight。
 */

export interface FloaterRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface ClampOffset {
  dx: number;
  dy: number;
}

/** rect 底边越出视口（留 margin 余量）→ true。 */
export function overflowsBottom(rect: FloaterRect, viewport: Viewport, margin: number): boolean {
  return rect.bottom > viewport.height - margin;
}

/**
 * 把 rect 平移回视口内（留 margin）所需的偏移：底/右越界先压回；
 * 因下压导致顶/左越界时再保底。rect 已在视口内时返回 {0,0}。
 */
export function clampOffsetInViewport(
  rect: FloaterRect,
  viewport: Viewport,
  margin: number,
): ClampOffset {
  let dx = 0;
  let dy = 0;
  if (rect.bottom > viewport.height - margin) {
    dy = viewport.height - margin - rect.bottom;
    if (rect.top + dy < margin) {
      dy = margin - rect.top;
    }
  }
  if (rect.right > viewport.width - margin) {
    dx = viewport.width - margin - rect.right;
    if (rect.left + dx < margin) {
      dx = margin - rect.left;
    }
  }
  return { dx, dy };
}
