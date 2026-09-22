/**
 * menuClamp.ts —— 行菜单（⋯ / 右键）视口 clamp 纯函数（T64-01 Phase A）。
 *
 * 给定菜单盒尺寸 + 期望锚点（视口坐标，菜单 top-left 落点）+ 视口尺寸，
 * 把 top-left 压回视口内，四边留 `margin` 余量（默认 8px）。x/y 双向收敛：
 * 右/下缘溢出 → 压回；左/上缘不够 → 拉到 margin。返回收敛后的 top-left。
 *
 * 纯函数（不读 window / DOM），便于单测（给盒宽/视口宽出坐标）。
 */
export interface MenuClampInput {
  /** 菜单盒宽。 */
  width: number;
  /** 菜单盒高。 */
  height: number;
  /** 期望锚点 x（top-left 目标）。 */
  anchorX: number;
  /** 期望锚点 y（top-left 目标）。 */
  anchorY: number;
  /** 视口宽。 */
  viewportWidth: number;
  /** 视口高。 */
  viewportHeight: number;
  /** 四边余量（默认 8）。 */
  margin?: number;
}

export interface MenuClampResult {
  x: number;
  y: number;
}

export function clampMenuRect(input: MenuClampInput): MenuClampResult {
  const margin = input.margin ?? 8;
  const maxX = Math.max(margin, input.viewportWidth - input.width - margin);
  const maxY = Math.max(margin, input.viewportHeight - input.height - margin);
  const x = Math.min(Math.max(input.anchorX, margin), maxX);
  const y = Math.min(Math.max(input.anchorY, margin), maxY);
  return { x, y };
}
