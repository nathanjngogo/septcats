import { describe, expect, it } from 'vitest';
import { Projection, isUlid, replay } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';
import {
  blockPayload,
  inlineDoc,
  text,
  type Block,
  type BlockDoc,
} from '../src/model';
import { diffBlocks } from '../src/diff';
import { EDIT_SEQUENCES, SEQ_ACTOR, type ExpectedOp } from './fixtures/sequences';
import { FIXTURE_NOW, FIXTURE_PAGE_ID } from './fixtures/blocks';

const CTX = { actor: SEQ_ACTOR, now: FIXTURE_NOW };

/** 去掉每次唯一的 op_id（ULID）后逐字段比较（op_id 的唯一性单独断言）。 */
function stripOpId(op: Op): ExpectedOp {
  const copy: ExpectedOp = {
    lamport: op.lamport,
    at: op.at,
    actor: op.actor,
    target: op.target,
    kind: op.kind,
    payload: op.payload,
  };
  if (op.base !== undefined) {
    copy.base = op.base;
  }
  return copy;
}

function block(partial: {
  id: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: Block['content'];
  sort_key: string;
  version: number;
  alive?: 0 | 1;
}): Block {
  return {
    id: partial.id,
    page_id: FIXTURE_PAGE_ID,
    type: partial.type ?? 'paragraph',
    props: partial.props ?? {},
    content: partial.content ?? inlineDoc([]),
    parent_id: null,
    sort_key: partial.sort_key,
    alive: partial.alive ?? 1,
    version: partial.version,
    last_edited: FIXTURE_NOW,
  };
}

function doc(blocks: Block[]): BlockDoc {
  return { pageId: FIXTURE_PAGE_ID, blocks };
}

function seedProjection(source: BlockDoc): Projection {
  const ops: Op[] = source.blocks.map((entry, index) => ({
    op_id: `seed-${String(index)}`,
    lamport: { c: Math.max(1, entry.version), d: SEQ_ACTOR },
    at: FIXTURE_NOW,
    actor: SEQ_ACTOR,
    target: { table: 'block', id: entry.id },
    kind: 'upsert',
    payload: blockPayload(entry),
  }));
  return replay(ops).projection;
}

/**
 * 收敛性断言（任务书 §3）：diff 产出的 Op 经 core.replay → 与 after 一致。
 * 「一致」= ① 每个存活块的数据字段相等；② 按 sort_key 排序 == after 的视觉顺序；
 * ③ 被删块 alive=0。
 */
function assertConverges(before: BlockDoc, after: BlockDoc, ops: Op[]): void {
  const { projection } = replay(ops, seedProjection(before));
  const live = after.blocks.filter((entry) => entry.alive === 1);

  for (const expected of live) {
    const entity = projection.get('block', expected.id);
    expect(entity).not.toBeNull();
    expect(entity?.alive).toBe(1);
    expect(entity?.data['type']).toEqual(expected.type);
    expect(entity?.data['props']).toEqual(expected.props);
    expect(entity?.data['content']).toEqual(expected.content);
    expect(entity?.data['parent_id']).toEqual(expected.parent_id);
  }

  const actualOrder = live
    .map((expected) => projection.get('block', expected.id))
    .filter((entity): entity is NonNullable<typeof entity> => entity !== null)
    .slice()
    .sort((left, right) =>
      String(left.data['sort_key']) < String(right.data['sort_key']) ? -1 : 1,
    )
    .map((entity) => entity.id);
  expect(actualOrder).toEqual(live.map((expected) => expected.id));

  for (const expected of before.blocks.filter((entry) => entry.alive === 1)) {
    const next = after.blocks.find((entry) => entry.id === expected.id);
    if (next === undefined || next.alive === 0) {
      expect(projection.get('block', expected.id)?.alive ?? 0).toBe(0);
    }
  }
}

describe('diff：黄金编辑序列 → 期望 Op 流（逐条相等）', () => {
  for (const sequence of EDIT_SEQUENCES) {
    it(sequence.name, () => {
      const ops = diffBlocks(sequence.before, sequence.after, CTX);
      expect(ops.map(stripOpId)).toEqual(sequence.expected);
      expect(new Set(ops.map((op) => op.op_id)).size).toBe(ops.length);
      for (const op of ops) {
        expect(isUlid(op.op_id)).toBe(true);
      }
      assertConverges(sequence.before, sequence.after, ops);
    });
  }
});

describe('diff：9 种编辑动作', () => {
  const A = 'blkdiff00000000000000000a';
  const B = 'blkdiff00000000000000000b';
  const C = 'blkdiff00000000000000000c';
  const D = 'blkdiff00000000000000000d';

  it('① 输入（content 变）→ patch{content}', () => {
    const before = doc([block({ id: A, content: inlineDoc([text('a')]), sort_key: 'A00000000', version: 1 })]);
    const after = doc([block({ id: A, content: inlineDoc([text('ab')]), sort_key: 'A00000000', version: 1 })]);
    const ops = diffBlocks(before, after, CTX);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('patch');
    expect(ops[0]?.payload).toEqual({ content: after.blocks[0]?.content });
    expect(ops[0]?.base).toBe(1);
    expect(ops[0]?.lamport.c).toBe(2);
    assertConverges(before, after, ops);
  });

  it('② 换型（type 变）→ upsert 整块', () => {
    const before = doc([block({ id: A, content: inlineDoc([text('x')]), sort_key: 'A00000000', version: 7 })]);
    const after = doc([
      block({ id: A, type: 'quote', content: inlineDoc([text('x')]), sort_key: 'A00000000', version: 7 }),
    ]);
    const ops = diffBlocks(before, after, CTX);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('upsert');
    expect(ops[0]?.payload['type']).toBe('quote');
    expect(ops[0]?.lamport.c).toBe(8);
    assertConverges(before, after, ops);
  });

  it('③ 改 props（to_do 勾选）→ patch{props}', () => {
    const before = doc([
      block({ id: A, type: 'to_do', props: { checked: false }, sort_key: 'A00000000', version: 2 }),
    ]);
    const after = doc([
      block({ id: A, type: 'to_do', props: { checked: true }, sort_key: 'A00000000', version: 2 }),
    ]);
    const ops = diffBlocks(before, after, CTX);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('patch');
    expect(ops[0]?.payload).toEqual({ props: { checked: true } });
    assertConverges(before, after, ops);
  });

  it('④ 删除 → delete（payload {}）', () => {
    const before = doc([block({ id: A, sort_key: 'A00000000', version: 4 })]);
    const after = doc([block({ id: A, sort_key: 'A00000000', version: 4, alive: 0 })]);
    const ops = diffBlocks(before, after, CTX);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('delete');
    expect(ops[0]?.payload).toEqual({});
    expect(ops[0]?.lamport.c).toBe(5);
    assertConverges(before, after, ops);
  });

  it('⑤ 复活（alive 0 → 1）→ upsert', () => {
    const before = doc([block({ id: A, sort_key: 'A00000000', version: 9, alive: 0 })]);
    const after = doc([block({ id: A, sort_key: 'A00000000', version: 9 })]);
    const ops = diffBlocks(before, after, CTX);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('upsert');
    expect(ops[0]?.payload['alive']).toBe(1);
    expect(ops[0]?.lamport.c).toBe(10);
    assertConverges(before, after, ops);
  });

  it('⑥ 拖序（2 块互换）→ 单条 reorder', () => {
    const before = doc([
      block({ id: A, sort_key: 'A00000000', version: 3 }),
      block({ id: B, sort_key: 'A00000001', version: 1 }),
    ]);
    const after = doc([
      block({ id: B, sort_key: 'A00000001', version: 1 }),
      block({ id: A, sort_key: 'A00000000', version: 3 }),
    ]);
    const ops = diffBlocks(before, after, CTX);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('reorder');
    expect(ops[0]?.target.id).toBe(A);
    expect(String(ops[0]?.payload['sort_key']).length).toBeGreaterThan(0);
    expect(typeof ops[0]?.payload['sort_key']).toBe('string');
    assertConverges(before, after, ops);
  });

  it('⑦ 拖序（4 块 2 块移动）→ 最小集合 2 条 reorder', () => {
    const before = doc([
      block({ id: A, sort_key: 'A00000000', version: 1 }),
      block({ id: B, sort_key: 'A00000001', version: 1 }),
      block({ id: C, sort_key: 'A00000002', version: 1 }),
      block({ id: D, sort_key: 'A00000003', version: 1 }),
    ]);
    const after = doc([
      block({ id: C, sort_key: 'A00000002', version: 1 }),
      block({ id: D, sort_key: 'A00000003', version: 1 }),
      block({ id: A, sort_key: 'A00000000', version: 1 }),
      block({ id: B, sort_key: 'A00000001', version: 1 }),
    ]);
    const ops = diffBlocks(before, after, CTX);
    expect(ops.map((op) => op.kind)).toEqual(['reorder', 'reorder']);
    expect(ops.map((op) => op.target.id).sort()).toEqual([A, B]);
    assertConverges(before, after, ops);
  });

  it('⑧ 新块插入 → upsert（c = 新块 version）', () => {
    const before = doc([block({ id: A, sort_key: 'A00000000', version: 2 })]);
    const after = doc([
      block({ id: A, sort_key: 'A00000000', version: 2 }),
      block({ id: B, sort_key: 'A00000001', version: 4 }),
    ]);
    const ops = diffBlocks(before, after, CTX);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('upsert');
    expect(ops[0]?.target.id).toBe(B);
    expect(ops[0]?.lamport.c).toBe(4);
    expect(ops[0]?.payload['last_edited']).toBe(FIXTURE_NOW);
    assertConverges(before, after, ops);
  });

  it('⑨ 内容 + 顺序同时变 → 单条 patch 合并 sort_key（不产生同 target 双 op）', () => {
    const before = doc([
      block({ id: A, content: inlineDoc([text('a')]), sort_key: 'A00000000', version: 3 }),
      block({ id: B, content: inlineDoc([text('b')]), sort_key: 'A00000001', version: 1 }),
    ]);
    const after = doc([
      block({ id: B, content: inlineDoc([text('b')]), sort_key: 'A00000001', version: 1 }),
      block({ id: A, content: inlineDoc([text('a2')]), sort_key: 'A00000000', version: 3 }),
    ]);
    const ops = diffBlocks(before, after, CTX);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('patch');
    expect(ops[0]?.target.id).toBe(A);
    expect(Object.keys(ops[0]?.payload ?? {}).sort()).toEqual(['content', 'sort_key']);
    assertConverges(before, after, ops);
  });

  it('未变块 0 op', () => {
    const source = doc([block({ id: A, sort_key: 'A00000000', version: 1 })]);
    expect(diffBlocks(source, source, CTX)).toEqual([]);
  });

  it('派生的 actor/at 直接来自 ctx', () => {
    const before = doc([block({ id: A, sort_key: 'A00000000', version: 1 })]);
    const after = doc([block({ id: A, content: inlineDoc([text('z')]), sort_key: 'A00000000', version: 1 })]);
    const actor: ActorId = 'bbbb0002';
    const ops = diffBlocks(before, after, { actor, now: 123 });
    expect(ops[0]?.actor).toBe(actor);
    expect(ops[0]?.lamport.d).toBe(actor);
    expect(ops[0]?.at).toBe(123);
  });
});
