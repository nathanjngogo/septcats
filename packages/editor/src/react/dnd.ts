/**
 * dnd.ts —— 块拖拽 → reorder/sort_key 计算（纯函数，无 DOM/React）。
 *
 * 正常路径：`core.sortBetween(前邻, 后邻)` → **只发 1 条 reorder**（M4.4 的手感来源）。
 * 降级路径：邻居之间已无空位（sortBetween 抛 InvalidSortRange）→ 整层重平衡一批
 * reorder（core 的 sortSequence 提供定宽递增键），与 schema-v1 §5.1 一致。
 *
 * T78-01：入口泛化为**组**（`planBlockGroupDrop`）——被拖块是一个 id 数组（保文档序），
 * 区间视作整体算落位：一次在（前邻, 后邻）之间**连续分配 N 个键**；放不下 → 整层重平衡。
 * `planBlockDrop`（单块）原样保留为 `[id]` 的委托，行为逐位不变（零回归）。
 */
import { sortBetween, sortSequence, ulid } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';
import { groupDropOrder } from '../selection';
import { BLOCK_TARGET_TABLE, liveBlocks, type Block, type BlockDoc } from '../model';

export interface DropContext {
  actor: ActorId;
  now: number;
}

export type DropPlanKind = 'noop' | 'reorder' | 'rebalance';

export interface SortKeyAssignment {
  id: string;
  sort_key: string;
}

export interface DropPlan {
  kind: DropPlanKind;
  ops: Op[];
  /** 本地乐观更新用（也便于测试直读）。 */
  assignments: SortKeyAssignment[];
}

function reorderOp(
  block: Block,
  sortKey: string,
  ctx: DropContext,
): Op {
  return {
    op_id: ulid(ctx.now),
    lamport: { c: block.version + 1, d: ctx.actor },
    at: ctx.now,
    actor: ctx.actor,
    target: { table: BLOCK_TARGET_TABLE, id: block.id },
    kind: 'reorder',
    payload: { sort_key: sortKey },
    base: block.version,
  };
}

function noop(): DropPlan {
  return { kind: 'noop', ops: [], assignments: [] };
}

/**
 * 在 (lo, hi) 之间**连续分配 count 个严格递增**的排序键（保序）。空间不足 →
 * `sortBetween` 抛 InvalidSortRange → 返回 null（调用方转整层重平衡）。
 *
 * 二分递归：先取中点，再分别在中点两侧继续分配——每次只用 core 的 `sortBetween`
 * 保证「严格介于两锚点之间」，不引入任何新的键生成口径。
 */
function spreadSortKeys(lo: string | null, hi: string | null, count: number): string[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [sortBetween(lo, hi)];
  }
  const middle = sortBetween(lo, hi);
  const leftCount = Math.floor(count / 2);
  return [
    ...spreadSortKeys(lo, middle, leftCount),
    middle,
    ...spreadSortKeys(middle, hi, count - 1 - leftCount),
  ];
}

/**
 * 把**一组块**（`draggedIds`，保文档序）整体放到 beforeId 之前（beforeId=null → 末尾）。
 * 组内相对序不变；一次分配组内全部 sort_key（放不下 → 整层重平衡）。
 *
 * 单块（数组长度 1）与 T78 之前 `planBlockDrop` 的行为逐位一致。
 */
export function planBlockGroupDrop(
  doc: BlockDoc,
  ctx: DropContext,
  draggedIds: readonly string[],
  beforeId: string | null,
): DropPlan {
  const live = liveBlocks(doc);
  const moving = new Set(draggedIds);
  const group = live.filter((block) => moving.has(block.id));
  if (group.length === 0 || group.length !== moving.size) {
    return noop();
  }

  // 落位序（selection.ts 纯函数）：null = 没动（含「拖到自己身上」）→ 无操作
  const order = live.map((block) => block.id);
  const nextOrder = groupDropOrder(order, draggedIds, beforeId);
  if (nextOrder === null) {
    return noop();
  }

  const remaining = live.filter((block) => !moving.has(block.id));
  const insertIndex = beforeId === null
    ? remaining.length
    : remaining.findIndex((block) => block.id === beforeId);
  if (insertIndex < 0) {
    return noop();
  }

  const prev = insertIndex > 0 ? remaining[insertIndex - 1] : undefined;
  const next = insertIndex < remaining.length ? remaining[insertIndex] : undefined;
  const prevKey = prev === undefined ? null : prev.sort_key;
  const nextKey = next === undefined ? null : next.sort_key;

  try {
    const keys = spreadSortKeys(prevKey, nextKey, group.length);
    // 单块时等价于历史的「键未变 → 无操作」；组落位下逐位全等必与 nextOrder 变化互斥
    if (keys.every((key, index) => key === (group[index] as Block).sort_key)) {
      return noop();
    }
    return {
      kind: 'reorder',
      ops: group.map((block, index) => reorderOp(block, keys[index] as string, ctx)),
      assignments: group.map((block, index) => ({ id: block.id, sort_key: keys[index] as string })),
    };
  } catch {
    // 邻居之间已无空位：整层重平衡（顺序 = 落位后的视觉顺序）
    const byId = new Map(live.map((block) => [block.id, block] as const));
    const ordered = nextOrder
      .map((id) => byId.get(id))
      .filter((block): block is Block => block !== undefined);
    const keys = sortSequence(ordered.length);
    const assignments: SortKeyAssignment[] = [];
    const ops: Op[] = [];
    ordered.forEach((block, index) => {
      const sortKey = keys[index];
      if (sortKey === undefined || sortKey === block.sort_key) {
        return;
      }
      assignments.push({ id: block.id, sort_key: sortKey });
      ops.push(reorderOp(block, sortKey, ctx));
    });
    return { kind: 'rebalance', ops, assignments };
  }
}

/**
 * 把 draggedId 放到 beforeId 之前（beforeId=null 表示拖到末尾）。
 * 单块 = 组大小为 1 的委托，历史调用方与用例行为逐位不变。
 */
export function planBlockDrop(
  doc: BlockDoc,
  ctx: DropContext,
  draggedId: string,
  beforeId: string | null,
): DropPlan {
  return planBlockGroupDrop(doc, ctx, [draggedId], beforeId);
}

/** 把 assignments 落回 BlockDoc（本地乐观更新；提交仍走 EditSession）。 */
export function applySortKeyAssignments(
  doc: BlockDoc,
  assignments: readonly SortKeyAssignment[],
): BlockDoc {
  if (assignments.length === 0) {
    return doc;
  }
  const map = new Map(assignments.map((entry) => [entry.id, entry.sort_key]));
  return {
    pageId: doc.pageId,
    blocks: doc.blocks.map((block) => {
      const sortKey = map.get(block.id);
      return sortKey === undefined ? block : { ...block, sort_key: sortKey };
    }),
  };
}
