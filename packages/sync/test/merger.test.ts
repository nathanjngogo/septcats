import { describe, expect, it } from 'vitest';
import {
  buildSegment,
  encodeSegment,
  opsToSnapshot,
  replay,
  type ActorId,
  type Op,
} from '@septcats/core';
import { SyncErrorCodes } from '../src/errors';
import { MemoryFs } from '../src/fs';
import { mergeRemote } from '../src/merger';
import { InProcessProvider } from '../src/provider';
import { DEV_A, DEV_B, makeOp } from './helpers';

const ROOT = 'sync';

/** 把一组 op 攒成段并写进假 fs，返回段文件名。 */
async function writeSegment(fs: MemoryFs, dev: ActorId, ops: Op[], suffix = ''): Promise<string> {
  const seg = buildSegment(dev, ops);
  const name = `${seg.seg_id}${suffix}.jsonl`;
  await fs.write(`${ROOT}/${name}`, encodeSegment(seg));
  return name;
}

function providerOf(fs: MemoryFs): InProcessProvider {
  return new InProcessProvider(fs, ROOT);
}

/** 故意反转 listSegments 顺序，验证 mergeRemote 顺序无关。 */
class ReversedProvider extends InProcessProvider {
  override async listSegments(): Promise<Array<{ file: string; bytes: number }>> {
    const segs = await super.listSegments();
    return [...segs].reverse();
  }
}

describe('mergeRemote S1 双端并发改同块', () => {
  it('高版胜出，conflicts 恰 1 条含 kept/lost（同 lamport c、异设备 = 并发）', async () => {
    const fs = new MemoryFs();
    const target = 'entX';

    const opA = makeOp({ id: 's1a', c: 5, d: DEV_A, entityId: target, payload: { title: 'a', alive: 1 } });
    const opB = makeOp({ id: 's1b', c: 5, d: DEV_B, entityId: target, payload: { title: 'b', alive: 1 } });
    await writeSegment(fs, DEV_A, [opA]);
    await writeSegment(fs, DEV_B, [opB]);

    const report = await mergeRemote({
      provider: providerOf(fs),
      localLedger: [],
      seenContentHashes: new Set(),
      now: 0,
    });

    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]).toEqual({
      table: 'block',
      id: target,
      kept: { c: 5, d: DEV_B },
      lost: { c: 5, d: DEV_A },
    });
    expect(report.applied.map((op) => op.op_id).sort()).toEqual(['s1a', 's1b'].sort());
    expect(report.highWatermark).toBe(5);
    expect(report.pulled).toBe(2);

    // 高版胜出：重放 applied 后投影数据为 DEV_B 的 payload
    const { projection } = replay(report.applied);
    expect(projection.get('block', target)?.data['title']).toBe('b');
  });

  it('乱序容忍：反转 list 顺序仍得到相同 applied 与 conflicts', async () => {
    const fs = new MemoryFs();
    const target = 'entX';
    const opA = makeOp({ id: 'ord-a', c: 5, d: DEV_A, entityId: target, payload: { title: 'a', alive: 1 } });
    const opB = makeOp({ id: 'ord-b', c: 5, d: DEV_B, entityId: target, payload: { title: 'b', alive: 1 } });
    await writeSegment(fs, DEV_A, [opA]);
    await writeSegment(fs, DEV_B, [opB]);

    const normal = await mergeRemote({
      provider: providerOf(fs),
      localLedger: [],
      seenContentHashes: new Set(),
      now: 0,
    });
    const reversed = await mergeRemote({
      provider: new ReversedProvider(fs, ROOT),
      localLedger: [],
      seenContentHashes: new Set(),
      now: 0,
    });

    expect(reversed.applied.map((op) => op.op_id).sort()).toEqual(
      normal.applied.map((op) => op.op_id).sort(),
    );
    expect(reversed.conflicts).toEqual(normal.conflicts);
    expect(reversed.highWatermark).toBe(normal.highWatermark);
  });
});

describe('mergeRemote S2 半截段隔离', () => {
  it('截断段 → quarantined 1 条，applied 不含该段 op，其余正常，不抛', async () => {
    const fs = new MemoryFs();
    const opA = makeOp({ id: 's2a', c: 1, d: DEV_A, entityId: 'entA', payload: { alive: 1 } });
    const opB = makeOp({ id: 's2b', c: 2, d: DEV_A, entityId: 'entB', payload: { alive: 1 } });
    const badOp = makeOp({ id: 's2c', c: 3, d: DEV_A, entityId: 'entC', payload: { alive: 1 } });

    await writeSegment(fs, DEV_A, [opA]);
    await writeSegment(fs, DEV_A, [opB]);

    // 半截写：砍半 + 确保末尾非 '\n'（decode 必失败 → SEGMENT_TRUNCATED）
    const badSeg = buildSegment(DEV_A, [badOp]);
    const nameBad = `${badSeg.seg_id}.jsonl`;
    const full = encodeSegment(badSeg);
    const half = full.slice(0, Math.floor(full.length / 2));
    const truncated = half.endsWith('\n') ? half.slice(0, -1) : half;
    await fs.write(`${ROOT}/${nameBad}`, truncated);

    const report = await mergeRemote({
      provider: providerOf(fs),
      localLedger: [],
      seenContentHashes: new Set(),
      now: 0,
    });

    expect(report.quarantined).toHaveLength(1);
    expect(report.quarantined[0]).toEqual({ file: nameBad, reason: SyncErrorCodes.SEGMENT_TRUNCATED });

    const appliedIds = report.applied.map((op) => op.op_id).sort();
    expect(appliedIds).toEqual(['s2a', 's2b'].sort());
    expect(appliedIds).not.toContain('s2c');
    expect(report.pulled).toBe(3);
    expect(report.applied).toHaveLength(2);
  });
});

describe('mergeRemote S3 网盘副本去重', () => {
  it('同内容副本：第一轮收 1 弃 1，第二轮（hash 记忆）双双 skipped.duplicate', async () => {
    const fs = new MemoryFs();
    const op = makeOp({ id: 's3a', c: 1, d: DEV_A, entityId: 'entA', payload: { alive: 1 } });
    const seg = buildSegment(DEV_A, [op]);
    const text = encodeSegment(seg);
    const name = `${seg.seg_id}.jsonl`;
    const copyName = `${seg.seg_id} (1).jsonl`;

    await fs.write(`${ROOT}/${name}`, text);
    await fs.write(`${ROOT}/${copyName}`, text);

    const seen = new Set<string>();

    const r1 = await mergeRemote({ provider: providerOf(fs), localLedger: [], seenContentHashes: seen, now: 0 });
    expect(r1.applied.map((op) => op.op_id)).toEqual(['s3a']);
    expect(r1.skipped).toEqual([{ file: copyName, reason: 'duplicate' }]);
    expect(r1.pulled).toBe(1);

    const r2 = await mergeRemote({ provider: providerOf(fs), localLedger: [], seenContentHashes: seen, now: 0 });
    expect(r2.applied).toEqual([]);
    expect(r2.skipped.map((s) => s.file).sort()).toEqual([name, copyName].sort());
    expect(r2.skipped.every((s) => s.reason === 'duplicate')).toBe(true);
  });

  it('不同内容同名前缀 → 两段都收（不按名去重）', async () => {
    const fs = new MemoryFs();
    const op1 = makeOp({ id: 's3c', c: 1, d: DEV_A, entityId: 'entX', payload: { v: 'one', alive: 1 } });
    const op2 = makeOp({ id: 's3d', c: 1, d: DEV_A, entityId: 'entY', payload: { v: 'two', alive: 1 } });

    const seg1 = buildSegment(DEV_A, [op1]);
    const seg2 = buildSegment(DEV_A, [op2]);
    expect(seg1.seg_id).toBe(seg2.seg_id); // 同名（同 dev/c/n）但内容不同

    const name = `${seg1.seg_id}.jsonl`;
    const copyName = `${seg1.seg_id} (1).jsonl`;
    await fs.write(`${ROOT}/${name}`, encodeSegment(seg1));
    await fs.write(`${ROOT}/${copyName}`, encodeSegment(seg2));

    const report = await mergeRemote({
      provider: providerOf(fs),
      localLedger: [],
      seenContentHashes: new Set(),
      now: 0,
    });

    expect(report.applied.map((op) => op.op_id).sort()).toEqual(['s3c', 's3d'].sort());
    expect(report.skipped).toEqual([]);
    expect(report.quarantined).toEqual([]);
    expect(report.pulled).toBe(2);
  });
});

describe('mergeRemote S4 时钟回拨', () => {
  it('B 设备 at 早 1 年：判定只看 lamport，两次 merge 投影快照相等', async () => {
    const target = 'entX';
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const atNormal = 1_700_000_000_000;

    function segmentTexts(bAt: number): { a: string; b: string } {
      const opA = makeOp({ id: 's4a', c: 5, d: DEV_A, entityId: target, payload: { title: 'a', alive: 1 }, at: atNormal });
      const opB = makeOp({ id: 's4b', c: 5, d: DEV_B, entityId: target, payload: { title: 'b', alive: 1 }, at: bAt });
      return {
        a: encodeSegment(buildSegment(DEV_A, [opA])),
        b: encodeSegment(buildSegment(DEV_B, [opB])),
      };
    }

    async function runMerge(aText: string, bText: string) {
      const fs = new MemoryFs();
      await fs.write(`${ROOT}/seg-00000005-aaaa0001-000001.jsonl`, aText);
      await fs.write(`${ROOT}/seg-00000005-bbbb0002-000001.jsonl`, bText);
      return mergeRemote({ provider: providerOf(fs), localLedger: [], seenContentHashes: new Set(), now: 0 });
    }

    const normal = segmentTexts(atNormal);
    const skewed = segmentTexts(atNormal - YEAR_MS);

    const r1 = await runMerge(normal.a, normal.b);
    const r2 = await runMerge(skewed.a, skewed.b);

    expect(r1.conflicts).toEqual(r2.conflicts);
    expect(r1.highWatermark).toBe(r2.highWatermark);
    expect(opsToSnapshot(replay(r1.applied).projection)).toBe(opsToSnapshot(replay(r2.applied).projection));
  });
});
