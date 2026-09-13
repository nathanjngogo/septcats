/**
 * dnd.ts —— 块拖拽 → reorder/sort_key 计算（纯函数，无 DOM/React）。
 *
 * 正常路径：`core.sortBetween(前邻, 后邻)` → **只发 1 条 reorder**（M4.4 的手感来源）。
 * 降级路径：邻居之间已无空位（sortBetween 抛 InvalidSortRange）→ 整层重平衡一批
 * reorder（core 的 sortSequence 提供定宽递增键），与 schema-v1 §5.1 一致。
 */
import { sortBetween, sortSequence, ulid } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';
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
 * 把 draggedId 放到 beforeId 之前（beforeId=null 表示拖到末尾）。
 */
export function planBlockDrop(
  doc: BlockDoc,
  ctx: DropContext,
  draggedId: string,
  beforeId: string | null,
): DropPlan {
  const live = liveBlocks(doc);
  const dragged = live.find((block) => block.id === draggedId);
  if (dragged === undefined) {
    return noop();
  }
  const remaining = live.filter((block) => block.id !== draggedId);
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
    const sortKey = sortBetween(prevKey, nextKey);
    if (sortKey === dragged.sort_key) {
      return noop();
    }
    return {
      kind: 'reorder',
      ops: [reorderOp(dragged, sortKey, ctx)],
      assignments: [{ id: dragged.id, sort_key: sortKey }],
    };
  } catch {
    // 邻居之间已无空位：整层重平衡（顺序 = 插入后的视觉顺序）
    const ordered = [...remaining.slice(0, insertIndex), dragged, ...remaining.slice(insertIndex)];
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
