import { describe, expect, it } from 'vitest';
import { encodeSegment, validateSegment, type Op, type Segment } from '@septcats/core';
import { SegmentBuilder, publishSegment, type WritePolicy } from '../src/writer';
import { MemoryFs } from '../src/fs';
import { DEV_A, makeOp } from './helpers';

function ops(count: number, startC = 1): Op[] {
  return Array.from({ length: count }, (_, i) =>
    makeOp({ c: startC + i, d: DEV_A, entityId: `ent${startC + i}`, payload: { v: i } }),
  );
}

function buildSegmentWith(count: number): Segment {
  const b = new SegmentBuilder(DEV_A);
  for (const op of ops(count)) {
    b.add(op);
  }
  const seg = b.flush();
  if (seg === null) {
    throw new Error('flush 不应返回 null');
  }
  return seg;
}

describe('SegmentBuilder', () => {
  it('空缓冲 flush 返回 null', () => {
    const b = new SegmentBuilder(DEV_A);
    expect(b.flush()).toBeNull();
    expect(b.pendingCount).toBe(0);
  });

  it('攒 op 后 flush 产出合法段并清空', () => {
    const b = new SegmentBuilder(DEV_A);
    for (const op of ops(3)) {
      b.add(op);
    }
    expect(b.pendingCount).toBe(3);

    const seg = b.flush();
    expect(seg).not.toBeNull();
    expect(seg?.ops).toHaveLength(3);
    expect(validateSegment(seg as Segment)).toEqual([]);
    expect(seg?.header.c_from).toBe(1);
    expect(seg?.header.c_to).toBe(3);
    expect(seg?.header.dev).toBe(DEV_A);
    expect(b.pendingCount).toBe(0);
  });

  it('flush 产出即自校验：乱序入队也被排序成合法段', () => {
    const b = new SegmentBuilder(DEV_A);
    b.add(makeOp({ c: 3, d: DEV_A, entityId: 'ent3' }));
    b.add(makeOp({ c: 1, d: DEV_A, entityId: 'ent1' }));
    b.add(makeOp({ c: 2, d: DEV_A, entityId: 'ent2' }));
    const seg = b.flush();
    expect(seg?.ops.map((o) => o.lamport.c)).toEqual([1, 2, 3]);
    expect(validateSegment(seg as Segment)).toEqual([]);
  });

  it('shouldFlush 条数触发', () => {
    const policy: WritePolicy = { maxOps: 3, maxBytes: Infinity, maxLamportSpan: Infinity };
    const b = new SegmentBuilder(DEV_A, policy);
    for (const op of ops(2)) {
      b.add(op);
    }
    expect(b.shouldFlush(0, 0)).toBe(false);
    b.add(makeOp({ c: 3, d: DEV_A, entityId: 'ent3' }));
    expect(b.shouldFlush(0, 0)).toBe(true);
  });

  it('shouldFlush 字节触发', () => {
    const policy: WritePolicy = { maxOps: Infinity, maxBytes: 1, maxLamportSpan: Infinity };
    const b = new SegmentBuilder(DEV_A, policy);
    b.add(makeOp({ c: 1, d: DEV_A }));
    expect(b.shouldFlush(0, 0)).toBe(true);
  });

  it('shouldFlush 时钟跨度触发', () => {
    const policy: WritePolicy = { maxOps: Infinity, maxBytes: Infinity, maxLamportSpan: 10 };
    const b = new SegmentBuilder(DEV_A, policy);
    b.add(makeOp({ c: 1, d: DEV_A }));
    b.add(makeOp({ c: 12, d: DEV_A }));
    expect(b.shouldFlush(0, 0)).toBe(true);
  });

  it('shouldFlush 空闲触发', () => {
    const b = new SegmentBuilder(DEV_A);
    b.add(makeOp({ c: 1, d: DEV_A, at: 1000 }));
    expect(b.shouldFlush(9000, 8000)).toBe(true);
    expect(b.shouldFlush(1100, 8000)).toBe(false);
  });

  it('空缓冲 shouldFlush 恒 false', () => {
    const b = new SegmentBuilder(DEV_A);
    expect(b.shouldFlush(0, 0)).toBe(false);
  });
});

describe('publishSegment', () => {
  it('首写 written，重复写 existed（幂等，S3/S6）', async () => {
    const fs = new MemoryFs();
    const seg = buildSegmentWith(2);
    const path = 'sync/yan/seg-00000001-aaaa0001-000002.jsonl';

    expect(await publishSegment(fs, 'sync/yan', seg)).toBe('written');
    expect(await fs.exists(path)).toBe(true);
    expect(await publishSegment(fs, 'sync/yan', seg)).toBe('existed');
  });

  it('写入内容可被 encodeSegment 逐字节还原', async () => {
    const fs = new MemoryFs();
    const seg = buildSegmentWith(2);
    await publishSegment(fs, 'yan', seg);
    const onDisk = await fs.read('yan/seg-00000001-aaaa0001-000002.jsonl');
    expect(onDisk).toBe(encodeSegment(seg));
  });

  it('prefix 为空时直接写文件名', async () => {
    const fs = new MemoryFs();
    const seg = buildSegmentWith(1);
    await publishSegment(fs, '', seg);
    expect(await fs.exists('seg-00000001-aaaa0001-000001.jsonl')).toBe(true);
  });
});
