/**
 * selection.ts —— 跨块多选的**纯函数面**（TASK-T78-01）。
 *
 * 纪律：纯函数区，不 import DOM / React / PM / Op；只做「文档序 → 区间 / 落位序」的
 * 确定性计算，供 React 视图（PageView 的选区块）与落位计划（react/dnd.ts）共用。
 * 视图只做接线与量测，选择语义（区间重算 / 组保相对序）全部住在本文件，单测优先覆盖。
 *
 * 选择模型（PRD-R26 §2）：
 * - 锚块 = 触发扩选时的**当前焦点块**；Shift+click 另一块 → 取**文档序**连续区间（含两端）；
 * - 二次 Shift+click 另一块 = 从锚块**重算**区间（禁集合并：中途块退出选区不残留）；
 * - 区间恒为文档序切片，与点击先后无关。
 */

/** 多选状态（锚块 + 扩选焦点块；两者相同=单块）。 */
export interface BulkSelection {
  /** 锚块 id（扩选期间不变）。 */
  anchorId: string;
  /** 扩选焦点块 id（随 Shift+click 更新）。 */
  focusId: string;
}

/**
 * 文档序 `order` 中 anchor→focus 的**连续区间**（含两端，输出按文档序）。
 * 锚点/焦点任一不在 `order` 中（文档已变）→ `[]`（保守回退到无选区）。
 */
export function intervalIds(order: readonly string[], anchorId: string, focusId: string): string[] {
  const anchorIndex = order.indexOf(anchorId);
  const focusIndex = order.indexOf(focusId);
  if (anchorIndex < 0 || focusIndex < 0) {
    return [];
  }
  const start = Math.min(anchorIndex, focusIndex);
  const end = Math.max(anchorIndex, focusIndex);
  return order.slice(start, end + 1);
}

/**
 * 扩选状态机（Shift+click 语义）：
 * - 已有选区 → 锚块**不变**（重算区间，绝不并集）；
 * - 无选区 → 锚块 = `fallbackAnchorId`（当前焦点块）?? `clickedId`（点哪算哪）；
 * - 焦点恒 = `clickedId`。
 */
export function extendBulkSelection(
  current: BulkSelection | null,
  fallbackAnchorId: string | null,
  clickedId: string,
): BulkSelection {
  const anchorId = current?.anchorId ?? fallbackAnchorId ?? clickedId;
  return { anchorId, focusId: clickedId };
}

/**
 * 组落位：把 `movingIds`（**保相对序** = 文档序）整体搬到 `beforeId` 之前。
 *
 * 返回重排后的**完整文档序**；`null` = 无操作（调用方据此短路）：
 * - `movingIds` 为空，或有 id 不在 `order` 中；
 * - `beforeId` 落在被移动集合内（拖到自己身上）；
 * - `beforeId` 非 null 且不在 `order` 中；
 * - 重排结果与原序逐位相同（位置没变）。
 *
 * `beforeId === null` 表示搬到末尾。
 */
export function groupDropOrder(
  order: readonly string[],
  movingIds: readonly string[],
  beforeId: string | null,
): string[] | null {
  const moving = new Set(movingIds);
  if (moving.size === 0) {
    return null;
  }
  const group = order.filter((id) => moving.has(id));
  if (group.length !== moving.size) {
    return null; // 有 id 不在当前文档序里（文档已变）
  }
  const remaining = order.filter((id) => !moving.has(id));
  let insertIndex: number;
  if (beforeId === null) {
    insertIndex = remaining.length;
  } else {
    if (moving.has(beforeId)) {
      return null;
    }
    insertIndex = remaining.indexOf(beforeId);
    if (insertIndex < 0) {
      return null;
    }
  }
  const next = [...remaining.slice(0, insertIndex), ...group, ...remaining.slice(insertIndex)];
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== order[index]) {
      return next;
    }
  }
  return null;
}
