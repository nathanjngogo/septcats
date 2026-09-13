import { describe, expect, it } from 'vitest';
import { Projection, replay, ulid } from '@septcats/core';
import type { Op } from '@septcats/core';
import { mulberry32, pick } from '../../core/test/helpers';
import { OpUndoStack } from '../src/history';
import { BLOCK_TARGET_TABLE, inlineDoc, text } from '../src/model';

const ACTOR = 'aaaa0001';
const ENTITY_IDS = ['enthist0000000000000001', 'enthist0000000000000002', 'enthist0000000000000003'];

interface Snap {
  id: string;
  data: Record<string, unknown>;
}

/**
 * 只比较「可见状态」（alive=1）。理由：Op 级撤销的逆 op 是**新事件**
 * （schema-v1 §5.3），撤销一次「创建」会留下 alive=0 的墓碑行，而「从未存在」
 * 的前缀账本里没有这一行——两者可见性一致，这正是我们要焊死的不变量。
 */
function visible(projection: Projection): Snap[] {
  return projection
    .entities()
    .filter((entity) => entity.alive === 1)
    .map((entity) => ({ id: entity.id, data: entity.data }))
    .sort((left, right) => (left.id < right.id ? -1 : 1));
}

function visibleOfStack(stack: OpUndoStack): Snap[] {
  return stack
    .entities()
    .filter((entity) => entity.alive === 1)
    .map((entity) => ({ id: entity.id, data: entity.data }))
    .sort((left, right) => (left.id < right.id ? -1 : 1));
}

/** 50 步确定性随机操作（mulberry32），每步一条 Op、lamport 单调递增。 */
function makeRandomOps(seed: number, count: number): Op[] {
  const rng = mulberry32(seed);
  const ops: Op[] = [];
  const initialized = new Set<string>();
  let counter = 0;
  for (let index = 0; index < count; index += 1) {
    counter += 1;
    const entityId = pick(ENTITY_IDS, rng);
    // 真实数据链路里 patch/reorder/delete 只作用于已存在实体（diff 只对 before 里的块发增量），
    // 所以随机序列也保证每个实体的第一条是 upsert。
    const mustCreate = !initialized.has(entityId);
    initialized.add(entityId);
    const roll = mustCreate ? 0 : rng();
    const base = { op_id: ulid(1_700_000_000_000 + index), at: 1_700_000_000_000 + index, actor: ACTOR };
    const target = { table: BLOCK_TARGET_TABLE, id: entityId };
    if (roll < 0.4) {
      ops.push({
        ...base,
        lamport: { c: counter, d: ACTOR },
        target,
        kind: 'upsert',
        payload: {
          page_id: 'pghist',
          type: 'paragraph',
          props: { n: index },
          content: inlineDoc([text(`v${String(index)}`)]),
          parent_id: null,
          sort_key: `A${String(index).padStart(8, '0')}`,
          alive: 1,
          last_edited: 1_700_000_000_000,
        },
      });
      continue;
    }
    if (roll < 0.7) {
      ops.push({
        ...base,
        lamport: { c: counter, d: ACTOR },
        target,
        kind: 'patch',
        payload: { props: { n: index } },
        base: counter - 1,
      });
      continue;
    }
    if (roll < 0.85) {
      ops.push({
        ...base,
        lamport: { c: counter, d: ACTOR },
        target,
        kind: 'reorder',
        payload: { sort_key: `B${String(index).padStart(8, '0')}` },
        base: counter - 1,
      });
      continue;
    }
    ops.push({ ...base, lamport: { c: counter, d: ACTOR }, target, kind: 'delete', payload: {} });
  }
  return ops;
}

describe('OpUndoStack：apply → undo → redo 幂等链（×50 随机操作）', () => {
  it('每步 apply 后投影 == 直接 replay 全量账本', () => {
    const stack = new OpUndoStack();
    const ops = makeRandomOps(20260913, 50);
    const ledger: Op[] = [];
    for (const op of ops) {
      ledger.push(op);
      stack.apply([op]);
      const reference = replay(ledger).projection;
      expect(visibleOfStack(stack)).toEqual(visible(reference));
    }
  });

  it('undo 全回退 → redo 全前进，数据/存活态逐步等于前缀账本', () => {
    const stack = new OpUndoStack();
    const ops = makeRandomOps(424242, 50);
    for (const op of ops) {
      stack.apply([op]);
    }
    expect(stack.undoDepth).toBe(50);

    for (let index = ops.length - 1; index >= 0; index -= 1) {
      const restored = stack.undo();
      expect(restored).not.toBeNull();
      const reference = replay(ops.slice(0, index)).projection;
      expect(visibleOfStack(stack)).toEqual(visible(reference));
    }
    expect(stack.undo()).toBeNull();
    expect(stack.redoDepth).toBe(50);

    for (let index = 0; index < ops.length; index += 1) {
      const forward = stack.redo();
      expect(forward).not.toBeNull();
      const reference = replay(ops.slice(0, index + 1)).projection;
      expect(visibleOfStack(stack)).toEqual(visible(reference));
    }
    expect(stack.redo()).toBeNull();
    expect(stack.undoDepth).toBe(50);
  });

  it('逆 op 语义：upsert→patch、delete→upsert 复活、reorder→反向 sort_key', () => {
    const stack = new OpUndoStack();
    const id = ENTITY_IDS[0] as string;
    const upsert: Op = {
      op_id: 'op-upsert',
      lamport: { c: 1, d: ACTOR },
      at: 10,
      actor: ACTOR,
      target: { table: BLOCK_TARGET_TABLE, id },
      kind: 'upsert',
      payload: {
        page_id: 'pghist',
        type: 'paragraph',
        props: {},
        content: inlineDoc([text('第一版')]),
        parent_id: null,
        sort_key: 'A00000000',
        alive: 1,
        last_edited: 10,
      },
    };
    stack.apply([upsert]);
    // 首次 upsert（实体此前不存在）→ 逆 op = delete（移除这次创建）
    const undo = stack.undo();
    expect(undo).toHaveLength(1);
    expect(undo?.[0]?.kind).toBe('delete');
    expect(stack.entities()[0]?.alive).toBe(0);
    stack.redo();
    expect(stack.entities()[0]?.data['content']).toEqual(inlineDoc([text('第一版')]));

    // 已存在实体上的 upsert → 逆 op = patch 旧字段快照
    const secondUpsert: Op = {
      op_id: 'op-upsert-2',
      lamport: { c: 5, d: ACTOR },
      at: 15,
      actor: ACTOR,
      target: { table: BLOCK_TARGET_TABLE, id },
      kind: 'upsert',
      payload: {
        page_id: 'pghist',
        type: 'paragraph',
        props: { n: 1 },
        content: inlineDoc([text('第二版')]),
        parent_id: null,
        sort_key: 'A00000000',
        alive: 1,
        last_edited: 15,
      },
    };
    stack.apply([secondUpsert]);
    expect(stack.entities()[0]?.data['content']).toEqual(inlineDoc([text('第二版')]));
    const revert = stack.undo();
    expect(revert?.[0]?.kind).toBe('patch');
    expect(stack.entities()[0]?.data['content']).toEqual(inlineDoc([text('第一版')]));

    const del: Op = {
      op_id: 'op-delete',
      lamport: { c: 9, d: ACTOR },
      at: 20,
      actor: ACTOR,
      target: { table: BLOCK_TARGET_TABLE, id },
      kind: 'delete',
      payload: {},
    };
    stack.apply([del]);
    expect(stack.entities()[0]?.alive).toBe(0);
    const revive = stack.undo();
    expect(revive?.[0]?.kind).toBe('upsert');
    expect(stack.entities()[0]?.alive).toBe(1);

    const reorder: Op = {
      op_id: 'op-reorder',
      lamport: { c: 20, d: ACTOR },
      at: 30,
      actor: ACTOR,
      target: { table: BLOCK_TARGET_TABLE, id },
      kind: 'reorder',
      payload: { sort_key: 'B00000000' },
      base: 19,
    };
    stack.apply([reorder]);
    expect(stack.entities()[0]?.data['sort_key']).toBe('B00000000');
    stack.undo();
    expect(stack.entities()[0]?.data['sort_key']).toBe('A00000000');
  });

  it('深度上限：只保留最近 100 批', () => {
    const stack = new OpUndoStack();
    const ops = makeRandomOps(777, 120);
    for (const op of ops) {
      stack.apply([op]);
    }
    expect(stack.undoDepth).toBe(100);
  });
});
