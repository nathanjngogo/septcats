/**
 * 黄金样例 · 编辑序列 → 期望 Op 流（schema-v1 §6 / 任务书 §3）。
 *
 * 三段真实编辑序列：
 *  1. 输入文字（content 变 → patch）；
 *  2. 换型（paragraph → heading → upsert 整块）；
 *  3. 拖序 + 删除（最小 reorder 1 条 + delete 1 条）。
 */
import { sortBetween } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';
import { inlineDoc, text, type Block, type BlockDoc } from '../../src/model';
import { FIXTURE_NOW, FIXTURE_PAGE_ID } from './blocks';

export type ExpectedOp = Omit<Op, 'op_id'>;

export interface EditSequence {
  name: string;
  before: BlockDoc;
  after: BlockDoc;
  expected: ExpectedOp[];
}

export const SEQ_ACTOR: ActorId = 'aaaa0001';

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

const A = 'blkseq000000000000000000a';
const B = 'blkseq000000000000000000b';
const C = 'blkseq000000000000000000c';

// 1 · 输入文字
const typedBefore: BlockDoc = {
  pageId: FIXTURE_PAGE_ID,
  blocks: [block({ id: A, content: inlineDoc([text('本页汇总')]), sort_key: 'A00000000', version: 3 })],
};
const typedAfter: BlockDoc = {
  pageId: FIXTURE_PAGE_ID,
  blocks: [
    block({
      id: A,
      content: inlineDoc([text('本页汇总 LZ 类稀有事件')]),
      sort_key: 'A00000000',
      version: 3,
    }),
  ],
};

// 2 · 换型（paragraph → heading）
const convertedBefore: BlockDoc = {
  pageId: FIXTURE_PAGE_ID,
  blocks: [block({ id: A, content: inlineDoc([text('探测器矩阵')]), sort_key: 'A00000000', version: 2 })],
};
const convertedAfter: BlockDoc = {
  pageId: FIXTURE_PAGE_ID,
  blocks: [
    block({
      id: A,
      type: 'heading',
      props: { level: 2 },
      content: inlineDoc([text('探测器矩阵')]),
      sort_key: 'A00000000',
      version: 2,
    }),
  ],
};

// 3 · 拖序（P1 移到 P3 之后）+ 删除 P2
const movedBefore: BlockDoc = {
  pageId: FIXTURE_PAGE_ID,
  blocks: [
    block({ id: A, content: inlineDoc([text('第一段')]), sort_key: 'A00000000', version: 5 }),
    block({ id: B, content: inlineDoc([text('第二段')]), sort_key: 'A00000001', version: 2 }),
    block({ id: C, content: inlineDoc([text('第三段')]), sort_key: 'A00000002', version: 1 }),
  ],
};
const movedAfter: BlockDoc = {
  pageId: FIXTURE_PAGE_ID,
  blocks: [
    block({ id: C, content: inlineDoc([text('第三段')]), sort_key: 'A00000002', version: 1 }),
    block({ id: A, content: inlineDoc([text('第一段')]), sort_key: 'A00000000', version: 5 }),
    block({ id: B, content: inlineDoc([text('第二段')]), sort_key: 'A00000001', version: 2, alive: 0 }),
  ],
};
const movedKey = sortBetween('A00000002', null);

export const EDIT_SEQUENCES: readonly EditSequence[] = [
  {
    name: '输入文字 → patch{content}',
    before: typedBefore,
    after: typedAfter,
    expected: [
      {
        lamport: { c: 4, d: SEQ_ACTOR },
        at: FIXTURE_NOW,
        actor: SEQ_ACTOR,
        target: { table: 'block', id: A },
        kind: 'patch',
        payload: { content: typedAfter.blocks[0]?.content },
        base: 3,
      },
    ],
  },
  {
    name: '换型 → upsert 整块',
    before: convertedBefore,
    after: convertedAfter,
    expected: [
      {
        lamport: { c: 3, d: SEQ_ACTOR },
        at: FIXTURE_NOW,
        actor: SEQ_ACTOR,
        target: { table: 'block', id: A },
        kind: 'upsert',
        payload: {
          page_id: FIXTURE_PAGE_ID,
          type: 'heading',
          props: { level: 2 },
          content: convertedAfter.blocks[0]?.content,
          parent_id: null,
          sort_key: 'A00000000',
          alive: 1,
          last_edited: FIXTURE_NOW,
        },
      },
    ],
  },
  {
    name: '拖序 + 删除 → 最小 reorder 1 条 + delete 1 条',
    before: movedBefore,
    after: movedAfter,
    expected: [
      {
        lamport: { c: 6, d: SEQ_ACTOR },
        at: FIXTURE_NOW,
        actor: SEQ_ACTOR,
        target: { table: 'block', id: A },
        kind: 'reorder',
        payload: { sort_key: movedKey },
        base: 5,
      },
      {
        lamport: { c: 3, d: SEQ_ACTOR },
        at: FIXTURE_NOW,
        actor: SEQ_ACTOR,
        target: { table: 'block', id: B },
        kind: 'delete',
        payload: {},
      },
    ],
  },
];
