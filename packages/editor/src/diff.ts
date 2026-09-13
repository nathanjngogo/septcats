/**
 * diff.ts —— 两轮 BlockDoc → Op[]（字段级差分）。
 *
 * 语义（任务书 §2 diff.ts）：
 * - 未变块 0 op；
 * - content 变 → patch{content}；props 变 → patch{props}；type 变 → upsert 整块；
 * - 删除 → delete（payload {}，物化 alive=0）；
 * - 顺序变 → reorder{sort_key}，**最小集合**：只有相对次序变化的块才发 reorder，
 *   能 sortBetween 放得下就只发 1 条；密集无解 → 整层重平衡（本文件用「顺序重放
 *   sortBetween」实现，仍然只发键真的变了的块，是 §5.1 的最小化版本）。
 * - 字段级 vs 整块：变化字段数 > 50% → upsert。
 *
 * lamport 取自物化版本的下一格（`base = 旧 version`，`c = version + 1`）：
 * 这保证「同实体后写必胜」（core.replay 的 LWW 判据），且对同一输入完全确定；
 * 想让时钟接管时由 EditSession 注入 clock() 覆写 c（见 seq.ts）。
 *
 * Op 顺序（确定性，fixtures 逐条断言）：upserts（after 顺序）→ patches（after 顺序）
 * → reorders（after 顺序）→ deletes（before 顺序）。
 */
import { sortBetween, sortSequence, stableStringify, ulid } from '@septcats/core';
import type { ActorId, Op, OpKind } from '@septcats/core';
import {
  BLOCK_TARGET_TABLE,
  blockPayload,
  cloneJson,
  liveBlocks,
  type Block,
  type BlockDoc,
} from './model';

export interface DiffContext {
  actor: ActorId;
  now: number;
}

/** 参与「字段占比」判定的字段全集（与 schema-v1 §4 block 字段表一致）。 */
export const DIFFABLE_FIELDS = [
  'type',
  'props',
  'content',
  'parent_id',
  'alive',
  'sort_key',
] as const;

function tableOf(): typeof BLOCK_TARGET_TABLE {
  return BLOCK_TARGET_TABLE;
}

// ---------------------------------------------------------------------------
// 比较
// ---------------------------------------------------------------------------

function indexById(doc: BlockDoc): Map<string, Block> {
  const map = new Map<string, Block>();
  for (const block of doc.blocks) {
    map.set(block.id, block);
  }
  return map;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

function changedFields(old: Block, next: Block): Set<string> {
  const out = new Set<string>();
  if (old.type !== next.type) out.add('type');
  if (!jsonEqual(old.props, next.props)) out.add('props');
  if (!jsonEqual(old.content, next.content)) out.add('content');
  if (old.parent_id !== next.parent_id) out.add('parent_id');
  if (old.alive !== next.alive) out.add('alive');
  if (old.sort_key !== next.sort_key) out.add('sort_key');
  return out;
}

// ---------------------------------------------------------------------------
// 顺序（最小 reorder 集合）
// ---------------------------------------------------------------------------

function isIncreasing(values: number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    if ((values[i] as number) <= (values[i - 1] as number)) {
      return false;
    }
  }
  return true;
}

/** 最长严格递增子序列（O(n²)，单页块数级别足够）；返回下标。 */
function lisIndices(seq: number[]): number[] {
  const n = seq.length;
  if (n === 0) {
    return [];
  }
  const dp = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let best = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if ((seq[j] as number) < (seq[i] as number) && (dp[j] as number) + 1 > (dp[i] as number)) {
        dp[i] = (dp[j] as number) + 1;
        prev[i] = j;
      }
    }
    if ((dp[i] as number) > (dp[best] as number)) {
      best = i;
    }
  }
  const out: number[] = [];
  let cursor = best;
  while (cursor !== -1) {
    out.push(cursor);
    cursor = prev[cursor] as number;
  }
  out.reverse();
  return out;
}

function trySortBetween(a: string | null, b: string | null): string | null {
  try {
    return sortBetween(a, b);
  } catch {
    return null;
  }
}

/** 右侧第一个「不参与本次重排」的块的 sort_key（作为上界锚点）。 */
function nextAnchorKey(liveAfter: Block[], from: number, moving: ReadonlySet<string>): string | null {
  for (let i = from; i < liveAfter.length; i += 1) {
    const block = liveAfter[i];
    if (block !== undefined && !moving.has(block.id)) {
      return block.sort_key;
    }
  }
  return null;
}

/** 密集无解时的整层重平衡：按文档顺序顺序重放 sortBetween（锚点=不动的新块）。 */
function fullRebalance(liveAfter: Block[], fixed: ReadonlySet<string>): Map<string, string> {
  const keys = new Map<string, string>();
  let prevKey: string | null = null;
  for (let i = 0; i < liveAfter.length; i += 1) {
    const block = liveAfter[i];
    if (block === undefined) {
      continue;
    }
    if (fixed.has(block.id)) {
      prevKey = block.sort_key;
      continue;
    }
    const anchor = nextAnchorKey(liveAfter, i + 1, fixed);
    const candidate: string | undefined =
      trySortBetween(prevKey, anchor) ??
      trySortBetween(prevKey, null) ??
      sortSequence(liveAfter.length)[i];
    if (candidate === undefined) {
      throw new Error('diff：整层重平衡失败，无法生成 sort_key');
    }
    // 第二/三级回退可能无视 anchor 生成 >= anchor 的键，破坏兄弟序；
    // 此时唯一安全做法是整层等间隔重建（键空间已确认无解）。
    if (anchor !== null && candidate >= anchor) {
      const rebuilt = sortSequence(liveAfter.length);
      const all = new Map<string, string>();
      liveAfter.forEach((b, idx) => {
        const key = rebuilt[idx];
        if (key !== undefined && key !== b.sort_key) {
          all.set(b.id, key);
        }
      });
      return all;
    }
    if (candidate !== block.sort_key) {
      keys.set(block.id, candidate);
    }
    prevKey = candidate;
  }
  return keys;
}

/**
 * 计算需要 reorder 的块 → 新 sort_key。
 * - 相对次序未变（含「只在中间插入了新块」）→ 空 map；
 * - 只有 1 个块相对次序变化 → 1 条 sortBetween；
 * - 多个块 → 按文档顺序逐个 sortBetween（仍是最小集合）；放不下 → 整层重平衡。
 */
export function computeReorderKeys(liveBefore: Block[], liveAfter: Block[]): Map<string, string> {
  const beforeIndex = new Map<string, number>();
  liveBefore.forEach((block, index) => beforeIndex.set(block.id, index));

  const commonAfter = liveAfter.filter((block) => beforeIndex.has(block.id));
  if (commonAfter.length < 2) {
    return new Map();
  }
  const seq = commonAfter.map((block) => beforeIndex.get(block.id) as number);
  if (isIncreasing(seq)) {
    return new Map();
  }

  const keep = new Set(lisIndices(seq).map((index) => (commonAfter[index] as Block).id));
  const moving = new Set(
    commonAfter.filter((block) => !keep.has(block.id)).map((block) => block.id),
  );

  const keys = new Map<string, string>();
  let prevKey: string | null = null;
  for (let i = 0; i < liveAfter.length; i += 1) {
    const block = liveAfter[i];
    if (block === undefined) {
      continue;
    }
    const isMoving = moving.has(block.id);
    if (!isMoving) {
      prevKey = block.sort_key;
      continue;
    }
    const anchor = nextAnchorKey(liveAfter, i + 1, moving);
    const candidate = trySortBetween(prevKey, anchor);
    if (candidate === null) {
      // 与邻居之间已无空位：整层重平衡（新块=固定锚点，它们的键随 upsert 走）
      const fixed = new Set(liveAfter.filter((b) => !beforeIndex.has(b.id)).map((b) => b.id));
      return fullRebalance(liveAfter, fixed);
    }
    keys.set(block.id, candidate);
    prevKey = candidate;
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Op 构造
// ---------------------------------------------------------------------------

function makeOp(
  ctx: DiffContext,
  kind: OpKind,
  id: string,
  payload: Record<string, unknown>,
  c: number,
  base?: number,
): Op {
  const op: Op = {
    op_id: ulid(ctx.now),
    lamport: { c: Math.max(1, c), d: ctx.actor },
    at: ctx.now,
    actor: ctx.actor,
    target: { table: tableOf(), id },
    kind,
    payload,
  };
  if (base !== undefined) {
    op.base = base;
  }
  return op;
}

function upsertCounter(old: Block | undefined, next: Block): number {
  if (old === undefined) {
    return Math.max(1, next.version);
  }
  return old.version + 1;
}

function upsertPayload(block: Block, ctx: DiffContext, sortKey: string): Record<string, unknown> {
  return {
    ...blockPayload(block),
    sort_key: sortKey,
    last_edited: ctx.now,
  };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function diffBlocks(before: BlockDoc, after: BlockDoc, ctx: DiffContext): Op[] {
  const beforeById = indexById(before);
  const afterById = indexById(after);
  const liveBefore = liveBlocks(before);
  const liveAfter = liveBlocks(after);
  const reorderKeys = computeReorderKeys(liveBefore, liveAfter);

  const upserts: Op[] = [];
  const patches: Op[] = [];
  const reorders: Op[] = [];

  for (const block of liveAfter) {
    const old = beforeById.get(block.id);
    const newKey = reorderKeys.get(block.id);
    const effectiveKey = newKey ?? block.sort_key;

    if (old === undefined || old.alive === 0) {
      upserts.push(
        makeOp(ctx, 'upsert', block.id, upsertPayload(block, ctx, effectiveKey), upsertCounter(old, block)),
      );
      continue;
    }

    const changed = changedFields(old, block);
    if (changed.has('type') || changed.size / DIFFABLE_FIELDS.length > 0.5) {
      upserts.push(
        makeOp(ctx, 'upsert', block.id, upsertPayload(block, ctx, effectiveKey), old.version + 1),
      );
      continue;
    }

    const patchFields = new Set(changed);
    patchFields.delete('sort_key');
    if (patchFields.size > 0) {
      const full = blockPayload(block);
      const payload: Record<string, unknown> = {};
      for (const field of patchFields) {
        payload[field] = cloneJson(full[field]);
      }
      if (newKey !== undefined) {
        payload['sort_key'] = newKey;
      }
      patches.push(makeOp(ctx, 'patch', block.id, payload, old.version + 1, old.version));
      continue;
    }

    // 只动了位置：最小 reorder（新块不在此分支，其 sort_key 随 upsert 走）
    if (newKey !== undefined) {
      reorders.push(
        makeOp(ctx, 'reorder', block.id, { sort_key: newKey }, old.version + 1, old.version),
      );
    }
  }

  const deletes: Op[] = [];
  for (const old of liveBefore) {
    const next = afterById.get(old.id);
    if (next !== undefined && next.alive === 1) {
      continue;
    }
    deletes.push(makeOp(ctx, 'delete', old.id, {}, old.version + 1));
  }

  return [...upserts, ...patches, ...reorders, ...deletes];
}
