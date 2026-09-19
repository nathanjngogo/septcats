import { describe, expect, it } from 'vitest';
import { encodeOp, encodeSegment, validateSegment, type Op, type Segment } from '@septcats/core';
import { SegmentBuilder, publishSegment, type WritePolicy } from '../src/writer';
import { MemoryFs } from '../src/fs';
import { segmentFileName } from '../src/naming';
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

  // T31-01（P0-3）：等值 lamport（不同实体同 (c,d)，如两个新建页各自的 c=1）不能同段
  // （core 段不变量 5「严格升序」）。旧 flush() 遇此批抛校验异常且缓冲不清空 →
  // 调用方每轮重抛的永久错误循环；flushAll 按等值边界切分多段并整缓冲清空。
  it('flushAll：等值 lamport 切成多个合法段、op 零丢失、缓冲清空', () => {
    const b = new SegmentBuilder(DEV_A);
    b.add(makeOp({ c: 1, d: DEV_A, entityId: 'ent-a' }));
    b.add(makeOp({ c: 1, d: DEV_A, entityId: 'ent-b' })); // 与上一条等值 (c,d)
    b.add(makeOp({ c: 2, d: DEV_A, entityId: 'ent-c' }));
    b.add(makeOp({ c: 9, d: DEV_A, entityId: 'ent-d' }));

    // 旧路径此时已不可恢复：flush() 会抛 SegmentValidationError
    expect(() => b.flush()).toThrow();

    const segs = b.flushAll();
    expect(segs.length).toBe(2);
    for (const seg of segs) {
      expect(validateSegment(seg)).toEqual([]);
    }
    expect(segs.map((seg) => seg.ops.length)).toEqual([1, 3]); // [c1a] | [c1b,c2,c9]：等值边界切分
    expect(segs.flatMap((seg) => seg.ops).map((op) => op.lamport.c)).toEqual([1, 1, 2, 9]);
    expect(b.pendingCount).toBe(0);

    // 空缓冲 flushAll 返回 []；正常批（无等值）等价旧 flush
    expect(b.flushAll()).toEqual([]);
    const b2 = new SegmentBuilder(DEV_A);
    b2.add(makeOp({ c: 5, d: DEV_A, entityId: 'ent-e' }));
    b2.add(makeOp({ c: 6, d: DEV_A, entityId: 'ent-f' }));
    const one = b2.flushAll();
    expect(one.length).toBe(1);
    expect(one[0]?.ops).toHaveLength(2);
  });
});

describe('publishSegment', () => {
  it('首写 written，重复写 existed（幂等，S3/S6）', async () => {
    const fs = new MemoryFs();
    const seg = buildSegmentWith(2);
    const path = `sync/yan/${segmentFileName(seg)}`;

    expect(await publishSegment(fs, 'sync/yan', seg)).toBe('written');
    expect(await fs.exists(path)).toBe(true);
    expect(await publishSegment(fs, 'sync/yan', seg)).toBe('existed');
  });

  it('写入内容可被 encodeSegment 逐字节还原', async () => {
    const fs = new MemoryFs();
    const seg = buildSegmentWith(2);
    await publishSegment(fs, 'yan', seg);
    const onDisk = await fs.read(`yan/${segmentFileName(seg)}`);
    expect(onDisk).toBe(encodeSegment(seg));
  });

  it('prefix 为空时直接写文件名', async () => {
    const fs = new MemoryFs();
    const seg = buildSegmentWith(1);
    await publishSegment(fs, '', seg);
    expect(await fs.exists(segmentFileName(seg))).toBe(true);
  });
});

describe('特大 update 攒段（T19-04 §0.5/§2.5：maxBytes 自然切段，不变量不破）', () => {
  /** 确定性生成 len 字节伪随机 base64（模拟 Yjs update 的 ×4/3 膨胀载体）。 */
  function bigBase64(len: number, salt: number): string {
    let a = (salt * 0x9e3779b9) >>> 0;
    const bytes: number[] = [];
    for (let i = 0; i < len; i += 1) {
      a = (Math.imul(a ^ (a >>> 15), 1 | a) + 0x6d2b79f5) | 0;
      bytes.push((a >>> 24) & 0xff);
    }
    return Buffer.from(bytes).toString('base64');
  }

  function crdtOp(c: number, pageId: string, updateB64: string): Op {
    return makeOp({
      c,
      d: DEV_A,
      entityId: pageId,
      kind: 'crdt_update',
      payload: { pageId, updateB64 },
    });
  }

  it('接近 maxBytes 的大条目：段切分正确、无超限（单条超限者独占段）、lamport 序不变量保持、字节保真', () => {
    const maxBytes = 700;
    const policy: WritePolicy = { maxOps: Infinity, maxBytes, maxLamportSpan: Infinity };
    // 4 条大 base64 的 crdt_update + 3 条小 upsert，lamport 交错上升。
    const big1 = crdtOp(1, 'page1', bigBase64(330, 1));
    const up1 = makeOp({ c: 2, d: DEV_A, entityId: 'ent1', payload: { v: 1 } });
    const big2 = crdtOp(3, 'page2', bigBase64(330, 2));
    const up2 = makeOp({ c: 4, d: DEV_A, entityId: 'ent2', payload: { v: 2 } });
    const big3 = crdtOp(5, 'page1', bigBase64(400, 3)); // 单条已超 maxBytes → 独占段
    const big4 = crdtOp(6, 'page3', bigBase64(330, 4));
    const up3 = makeOp({ c: 7, d: DEV_A, entityId: 'ent3', payload: { v: 3 } });
    const input = [big1, up1, big2, up2, big3, big4, up3];

    // 逐条喂入，按既有四触发器之一刷段（字节触发为主），复刻 runtime 攒段循环。
    const b = new SegmentBuilder(DEV_A, policy);
    const segs: Segment[] = [];
    for (const op of input) {
      b.add(op);
      if (b.shouldFlush(0, Infinity)) {
        const seg = b.flush();
        if (seg !== null) {
          segs.push(seg);
        }
      }
    }
    const tail = b.flush();
    if (tail !== null) {
      segs.push(tail);
    }

    // 全部 op 无丢失，且段内 lamport 严格升序（validateSegment 的核心不变量）。
    const flushedOps = segs.flatMap((seg) => seg.ops);
    expect(flushedOps.map((op) => op.op_id)).toEqual(input.map((op) => op.op_id));
    for (const seg of segs) {
      expect(validateSegment(seg)).toEqual([]);
    }

    // 段切分正确（既有 add→check→flush 模式的不变量）：多 op 段去掉末位 op 后
    // 字节总和 < maxBytes——即边界恒切在「第一个越限 op」处；单条本身超限的
    // 特大 update 不会让它前面的段被切破，也不会被截破。
    for (const seg of segs) {
      const opBytes = seg.ops.reduce((sum, op) => sum + Buffer.byteLength(encodeOp(op), 'utf8') + 1, 0);
      if (seg.ops.length > 1) {
        const withoutLast = seg.ops
          .slice(0, -1)
          .reduce((sum, op) => sum + Buffer.byteLength(encodeOp(op), 'utf8') + 1, 0);
        expect(withoutLast).toBeLessThan(maxBytes);
      } else if (opBytes > maxBytes) {
        expect(seg.ops).toHaveLength(1); // 单条超限者独占段（此前缓冲已清空）
      }
    }

    // 字节保真：base64 payload 与原值逐字节相等（×4/3 膨胀不得引发任何改写）。
    const flushedBig = flushedOps.filter((op) => op.kind === 'crdt_update');
    const inputBig = input.filter((op) => op.kind === 'crdt_update');
    expect(flushedBig.map((op) => op.payload['updateB64'])).toEqual(
      inputBig.map((op) => op.payload['updateB64']),
    );
  });

  it('多条大 update 相邻：字节触发把段边界切在 op 之间，绝不切破单条 op', () => {
    const maxBytes = 512;
    const policy: WritePolicy = { maxOps: Infinity, maxBytes, maxLamportSpan: Infinity };
    const b = new SegmentBuilder(DEV_A, policy);
    const bigOps = [1, 2, 3, 4, 5, 6].map((c) => crdtOp(c, `page${c}`, bigBase64(300, c)));
    const segs: Segment[] = [];
    for (const op of bigOps) {
      b.add(op);
      if (b.shouldFlush(0, Infinity)) {
        const seg = b.flush();
        if (seg !== null) {
          segs.push(seg);
        }
      }
    }
    const tail = b.flush();
    if (tail !== null) {
      segs.push(tail);
    }

    // 每个产出段仍是合法段（lamport 严格升序），且所有 op 编码行都是完整单行。
    expect(segs.length).toBeGreaterThanOrEqual(2);
    for (const seg of segs) {
      expect(validateSegment(seg)).toEqual([]);
      for (const line of encodeSegment(seg).trimEnd().split('\n')) {
        expect(() => JSON.parse(line)).not.toThrow(); // 行完整性：op 未被截破
      }
    }
    expect(segs.flatMap((seg) => seg.ops).map((op) => op.payload['updateB64'])).toEqual(
      bigOps.map((op) => op.payload['updateB64']),
    );
  });
});
