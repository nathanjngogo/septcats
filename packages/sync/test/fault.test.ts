import { describe, expect, it } from 'vitest';
import {
  buildSegment,
  encodeSegment,
  opsToSnapshot,
  replay,
  snapshotToOps,
  type ActorId,
  type Op,
  type Segment,
} from '@septcats/core';
import { SyncErrorCodes } from '../src/errors';
import { MemoryFs } from '../src/fs';
import { mergeRemote } from '../src/merger';
import { segmentFileName } from '../src/naming';
import { InProcessProvider } from '../src/provider';
import { buildSnapshotText, planSnapshot, publishSnapshot } from '../src/snapshot';
import { publishSegment } from '../src/writer';
import { planCleanup } from '../src/gc';
import { DEV_A, DEV_B, makeManifest, makeOp } from './helpers';

const ROOT = 'sync';
const DAY = 24 * 60 * 60 * 1000;

function providerOf(fs: MemoryFs): InProcessProvider {
  return new InProcessProvider(fs, ROOT);
}

/** 把一组 op 攒成段并写进假 fs，返回段文件名。 */
async function writeSegment(fs: MemoryFs, dev: ActorId, ops: Op[]): Promise<string> {
  const seg = buildSegment(dev, ops);
  const name = `${seg.seg_id}.jsonl`;
  await fs.write(`${ROOT}/${name}`, encodeSegment(seg));
  return name;
}

function segOf(dev: ActorId, c: number, entityId: string, createdAt = 1_700_000_000_000): Segment {
  return buildSegment(dev, [makeOp({ c, d: dev, entityId })], createdAt);
}

describe('fault 矩阵内存复现（S1–S6 / S8 / S9）', () => {
  it('S1 双端并发改同块：高版胜出、conflicts 恰 1 条含 kept/lost', async () => {
    const fs = new MemoryFs();
    const target = 'entX';
    // 并发 = 同 lamport c、异设备（与已合入 merger.test.ts 的并发口径一致）
    const opA = makeOp({ id: 'f1a', c: 38, d: DEV_A, entityId: target, payload: { title: 'a', alive: 1 } });
    const opB = makeOp({ id: 'f1b', c: 38, d: DEV_B, entityId: target, payload: { title: 'b', alive: 1 } });
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
      kept: { c: 38, d: DEV_B },
      lost: { c: 38, d: DEV_A },
    });
    // 高版胜出：重放后数据为 DEV_B 的 payload
    const { projection } = replay(report.applied);
    expect(projection.get('block', target)?.data['title']).toBe('b');
  });

  it('S2 半截段：injectFailure halfwrite 写截断 → 隔离 1 条，其余正常，不抛', async () => {
    const fs = new MemoryFs();
    const opA = makeOp({ id: 'f2a', c: 1, d: DEV_A, entityId: 'entA', payload: { alive: 1 } });
    const opB = makeOp({ id: 'f2b', c: 2, d: DEV_A, entityId: 'entB', payload: { alive: 1 } });
    const badOp = makeOp({ id: 'f2c', c: 3, d: DEV_A, entityId: 'entC', payload: { alive: 1 } });

    await writeSegment(fs, DEV_A, [opA]);
    await writeSegment(fs, DEV_A, [opB]);
    // 注入半截写故障：坏段写一半（截断）
    fs.injectFailure = 'halfwrite';
    const badSeg = buildSegment(DEV_A, [badOp]);
    const badName = segmentFileName(badSeg);
    await publishSegment(fs, ROOT, badSeg);
    fs.injectFailure = null;

    const report = await mergeRemote({
      provider: providerOf(fs),
      localLedger: [],
      seenContentHashes: new Set(),
      now: 0,
    });

    expect(report.quarantined).toHaveLength(1);
    expect(report.quarantined[0]).toEqual({ file: badName, reason: SyncErrorCodes.SEGMENT_TRUNCATED });
    const appliedIds = report.applied.map((op) => op.op_id).sort();
    expect(appliedIds).toEqual(['f2a', 'f2b'].sort());
    expect(appliedIds).not.toContain('f2c');
  });

  it('S3 网盘副本：injectFailure duplicate 产生副本 → 第一轮去重，第二轮全部 skipped.duplicate', async () => {
    const fs = new MemoryFs();
    const op = makeOp({ id: 'f3a', c: 1, d: DEV_A, entityId: 'entA', payload: { alive: 1 } });
    const seg = buildSegment(DEV_A, [op]);

    fs.injectFailure = 'duplicate';
    await publishSegment(fs, ROOT, seg); // 额外落一份 xxx (1).jsonl
    fs.injectFailure = null;

    const seen = new Set<string>();
    const r1 = await mergeRemote({ provider: providerOf(fs), localLedger: [], seenContentHashes: seen, now: 0 });
    expect(r1.applied.map((o) => o.op_id)).toEqual(['f3a']);
    expect(r1.skipped).toHaveLength(1);
    expect(r1.skipped[0]?.reason).toBe('duplicate');

    const r2 = await mergeRemote({ provider: providerOf(fs), localLedger: [], seenContentHashes: seen, now: 0 });
    expect(r2.applied).toEqual([]);
    expect(r2.skipped.every((s) => s.reason === 'duplicate')).toBe(true);
    expect(r2.skipped).toHaveLength(2);
  });

  it('S4 时钟回拨：B 设备 at 早 1 年 → 判定只看 lamport，合并投影相等', async () => {
    const target = 'entX';
    const YEAR_MS = 365 * DAY;
    const atNormal = 1_700_000_000_000;

    async function runMerge(bAt: number) {
      const fs = new MemoryFs();
      const opA = makeOp({ id: 'f4a', c: 38, d: DEV_A, entityId: target, payload: { title: 'a', alive: 1 }, at: atNormal });
      const opB = makeOp({ id: 'f4b', c: 38, d: DEV_B, entityId: target, payload: { title: 'b', alive: 1 }, at: bAt });
      await writeSegment(fs, DEV_A, [opA]);
      await writeSegment(fs, DEV_B, [opB]);
      return mergeRemote({ provider: providerOf(fs), localLedger: [], seenContentHashes: new Set(), now: 0 });
    }

    const normal = await runMerge(atNormal);
    const skewed = await runMerge(atNormal - YEAR_MS);

    expect(normal.conflicts).toEqual(skewed.conflicts);
    expect(normal.highWatermark).toBe(skewed.highWatermark);
    expect(opsToSnapshot(replay(normal.applied).projection)).toBe(
      opsToSnapshot(replay(skewed.applied).projection),
    );
  });

  it('S5 新设备：空目录只有 snapshot-1 + 增量段 → 追平后与老设备投影全等', async () => {
    // 老设备全量：DEV_A c=1..6，DEV_B c=1
    const fullOps: Op[] = [
      ...Array.from({ length: 6 }, (_, i) => makeOp({ id: `f5a${i + 1}`, c: i + 1, d: DEV_A, entityId: `entA${i + 1}` })),
      makeOp({ id: 'f5b1', c: 1, d: DEV_B, entityId: 'entB1' }),
    ];
    const fs = new MemoryFs();
    for (const op of fullOps) {
      await writeSegment(fs, op.actor, [op]);
    }
    const full = await mergeRemote({ provider: providerOf(fs), localLedger: [], seenContentHashes: new Set(), now: 0 });
    const fullProjection = replay(full.applied).projection;

    // 折叠 c<=3 进 snapshot-1（老段 40 天前，retention 已过 → 触发折叠；含跨设备的 entB1）
    const oldCreatedAt = 1_700_000_000_000 - 40 * DAY;
    const oldSegs = [
      segOf(DEV_A, 1, 'entA1', oldCreatedAt),
      segOf(DEV_A, 2, 'entA2', oldCreatedAt),
      segOf(DEV_A, 3, 'entA3', oldCreatedAt),
      segOf(DEV_B, 1, 'entB1', oldCreatedAt),
    ];
    const manifest = makeManifest({ updated_at: 1_700_000_000_000, retention_days: 30 });
    const plan = planSnapshot(oldSegs, manifest, 10);
    expect(plan).not.toBeNull();
    const snapshotText = buildSnapshotText(oldSegs, plan?.through ?? 3, DEV_A);
    await publishSnapshot(fs, ROOT, 1, snapshotText);

    // 新设备目录：只有 snapshot-1 + 增量段（c>3）
    const newFs = new MemoryFs();
    await newFs.write(`${ROOT}/snapshot-000001.json`, snapshotText);
    for (const op of fullOps) {
      if (op.lamport.c > 3) {
        await writeSegment(newFs, op.actor, [op]);
      }
    }

    // 新设备播种 + 合并增量
    const seedOps = snapshotToOps(snapshotText, DEV_A);
    const inc = await mergeRemote({
      provider: providerOf(newFs),
      localLedger: seedOps,
      seenContentHashes: new Set(),
      now: 0,
    });
    const newProjection = replay([...seedOps, ...inc.applied]).projection;

    expect(opsToSnapshot(newProjection)).toBe(opsToSnapshot(fullProjection));
  });

  it('S6 快照崩溃：publishSnapshot 半写后重跑 → existed，水位不乱', async () => {
    const fs = new MemoryFs();
    const oldCreatedAt = 1_700_000_000_000 - 40 * DAY;
    const oldSegs = [
      segOf(DEV_A, 1, 'entA1', oldCreatedAt),
      segOf(DEV_A, 2, 'entA2', oldCreatedAt),
      segOf(DEV_A, 3, 'entA3', oldCreatedAt),
    ];
    const manifest = makeManifest({ updated_at: 1_700_000_000_000, retention_days: 30 });
    const plan = planSnapshot(oldSegs, manifest, 10);
    expect(plan).not.toBeNull();
    const through = plan?.through ?? 3;
    const text = buildSnapshotText(oldSegs, through, DEV_A);

    // 首次写崩溃（半写）
    fs.injectFailure = 'halfwrite';
    await publishSnapshot(fs, ROOT, 1, text);
    fs.injectFailure = null;

    // 重跑（幂等）
    expect(await publishSnapshot(fs, ROOT, 1, text)).toBe('existed');

    // 水位不乱：只据成功发布推进一次，重跑不翻倍
    const snapshotFiles = (await fs.list(ROOT)).filter((n) => n.startsWith('snapshot-'));
    expect(snapshotFiles).toEqual(['snapshot-000001.json']);
    expect(through).toBe(3);
  });

  it('S8 双端同删同页：收敛 alive=0，无冲突告警', async () => {
    const fs = new MemoryFs();
    const target = 'entX';
    // 先有 upsert 建立实体，再两设备各发 delete（不同 lamport）
    const up = makeOp({ id: 'f8u', c: 5, d: DEV_A, entityId: target, payload: { alive: 1 } });
    const delA = makeOp({ id: 'f8a', c: 10, d: DEV_A, entityId: target, kind: 'delete', payload: { alive: 0 } });
    const delB = makeOp({ id: 'f8b', c: 20, d: DEV_B, entityId: target, kind: 'delete', payload: { alive: 0 } });
    await writeSegment(fs, DEV_A, [up, delA]);
    await writeSegment(fs, DEV_B, [delB]);

    const report = await mergeRemote({
      provider: providerOf(fs),
      localLedger: [],
      seenContentHashes: new Set(),
      now: 0,
    });

    expect(report.conflicts).toEqual([]);
    const { projection } = replay(report.applied);
    expect(projection.get('block', target)?.alive).toBe(0);
  });

  it('S9 提前删段：retention 未过不放行，全过才放行', async () => {
    const now = 1_700_000_000_000;
    const segs = [
      { file: 'seg-00000001-aaaa0001-000001.jsonl', cTo: 5, dev: DEV_A },
      { file: 'seg-00000006-aaaa0001-000001.jsonl', cTo: 10, dev: DEV_A },
    ];
    const watermarks = new Map<ActorId, number>([[DEV_A, 100]]);

    // retention 未过（updated_at 距 now 仅 1 天）
    const young = makeManifest({ updated_at: now - 1 * DAY, retention_days: 30 });
    expect(planCleanup(young, segs, watermarks, now)).toEqual([]);

    // retention 已过（静默 31 天）→ 全放行
    const mature = makeManifest({ updated_at: now - 31 * DAY, retention_days: 30 });
    expect(planCleanup(mature, segs, watermarks, now)).toEqual(segs.map((s) => s.file));
  });
});
