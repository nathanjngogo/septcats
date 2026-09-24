import { describe, expect, it } from 'vitest';
import { LamportClock } from '@septcats/core';
import type { Lamport } from '@septcats/core';
import {
  blockToPMNode,
  blocksToPMDoc,
  inlineDoc,
  inlineNodes,
  pmDocToBlocks,
  text,
  type Block,
  type BlockDoc,
  type PMDocJSON,
} from '../src/model';
import { BLOCK_FIXTURES, FIXTURE_PAGE_ID } from './fixtures/blocks';

const ACTOR = 'aaaa0001';

/** 每次调用返回一个全新的（同 actor）时钟，保证用例之间互不污染。 */
function makeClock(): () => Lamport {
  const lamport = new LamportClock(ACTOR);
  return () => lamport.tick();
}

function docOf(block: Block): BlockDoc {
  return { pageId: FIXTURE_PAGE_ID, blocks: [block] };
}

describe('model：块型投影（确定性 + roundtrip 恒等，含 R25 的 table/toggle）', () => {
  for (const fixture of BLOCK_FIXTURES) {
    it(`${fixture.name}：blocksToPMDoc 确定性 & pmDocToBlocks 恒等`, () => {
      const doc = docOf(fixture.block);
      const projection = blocksToPMDoc(doc);

      expect(projection).toEqual({ type: 'doc', content: [fixture.node] });
      expect(blocksToPMDoc(doc)).toEqual(projection);

      const restored = pmDocToBlocks(projection, doc, makeClock());
      expect(restored).toEqual(doc);
    });
  }

  it('单块投影与整页投影一致（顺序 = 数组顺序）', () => {
    const blocks = BLOCK_FIXTURES.map((fixture) => fixture.block);
    const page = blocksToPMDoc({ pageId: FIXTURE_PAGE_ID, blocks });
    expect(page.content?.map((node) => node.type)).toEqual(
      BLOCK_FIXTURES.map((fixture) => fixture.node.type),
    );
    expect(page.content?.map((node) => node.attrs?.['id'])).toEqual(
      blocks.map((block) => block.id),
    );
  });

  it('alive=0 的块不进投影', () => {
    const block = BLOCK_FIXTURES[0]?.block;
    expect(block).toBeDefined();
    const page = blocksToPMDoc({
      pageId: FIXTURE_PAGE_ID,
      blocks: [{ ...(block as Block), alive: 0 }],
    });
    expect(page.content).toEqual([]);
  });
});

describe('model：反投影的边界行为', () => {
  it('投影里消失的块 → 原 id 转 tombstone（保留 sort_key/version）', () => {
    const block = BLOCK_FIXTURES[0]?.block as Block;
    const prev: BlockDoc = { pageId: FIXTURE_PAGE_ID, blocks: [block] };
    const next = pmDocToBlocks({ type: 'doc', content: [] }, prev, makeClock());
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]?.id).toBe(block.id);
    expect(next.blocks[0]?.alive).toBe(0);
    expect(next.blocks[0]?.sort_key).toBe(block.sort_key);
    expect(next.blocks[0]?.version).toBe(block.version);
  });

  it('新节点（无 data-id）→ 新 ulid，version 取注入 clock 的 c', () => {
    const prev: BlockDoc = { pageId: FIXTURE_PAGE_ID, blocks: [] };
    const json: PMDocJSON = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [text('新块')] }],
    };
    const lamport = new LamportClock(ACTOR);
    const next = pmDocToBlocks(json, prev, () => lamport.tick());
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(next.blocks[0]?.version).toBe(1);
    expect(inlineNodes(next.blocks[0]?.content ?? null)).toEqual([{ type: 'text', text: '新块' }]);
  });

  it('文档顶层的非块节点被忽略', () => {
    const prev: BlockDoc = { pageId: FIXTURE_PAGE_ID, blocks: [] };
    const next = pmDocToBlocks(
      { type: 'doc', content: [{ type: 'text', text: '游离文本' }] },
      prev,
      makeClock(),
    );
    expect(next.blocks).toEqual([]);
  });

  it('新块按前后邻的 sort_key 就位（sortBetween 上界/下界可推导）', () => {
    const first = BLOCK_FIXTURES[0]?.block as Block;
    const second = BLOCK_FIXTURES[1]?.block as Block;
    const prev: BlockDoc = {
      pageId: FIXTURE_PAGE_ID,
      blocks: [
        { ...first, sort_key: 'A00000000' },
        { ...second, sort_key: 'A00000001' },
      ],
    };
    const json: PMDocJSON = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: first.id } },
        { type: 'paragraph', content: [text('插入中间')] },
        { type: 'paragraph', attrs: { id: second.id } },
      ],
    };
    const next = pmDocToBlocks(json, prev, makeClock());
    const inserted = next.blocks[1];
    const insertedKey = inserted?.sort_key ?? '';
    expect(inserted?.id).not.toBe(first.id);
    expect(insertedKey > 'A00000000').toBe(true);
    expect(insertedKey < 'A00000001').toBe(true);
  });

  it('未知块的 _raw 原样恢复（不丢数据）', () => {
    const block = blockToPMNode({
      id: 'blk-unknown',
      page_id: FIXTURE_PAGE_ID,
      type: 'table_simple',
      props: { columns: 3, hidden: false },
      content: inlineDoc([]),
      parent_id: null,
      sort_key: 'A00000000',
      alive: 1,
      version: 1,
      last_edited: 0,
    });
    expect(block.attrs?.['_unsupported']).toBe('table_simple');
    expect(block.attrs?.['_raw']).toEqual({ columns: 3, hidden: false });
  });
});
