import { describe, expect, it } from 'vitest';
import {
  SnapshotValidationError,
  buildSegment,
  opsToSnapshot,
  replay,
  snapshotToOps,
  type ActorId,
  type Op,
  type Segment,
} from '@septcats/core';
import { buildSnapshotText, planSnapshot, publishSnapshot, seedFromSnapshot } from '../src/snapshot';
import { MemoryFs } from '../src/fs';
import { DEV_A, DEV_B, makeManifest, makeOp } from './helpers';

/** 单 op 段：c_from=c_to=c。 */
function segAt(dev: ActorId, c: number, createdAt: number, entityId?: string): Segment {
  return buildSegment(dev, [makeOp({ c, d: dev, entityId: entityId ?? `ent${c}` })], createdAt);
}

describe('planSnapshot 折叠计划', () => {
  it('空段集合 → null', () => {
    const plan = planSnapshot([], makeManifest(), 10);
    expect(plan).toBeNull();
  });

  it('段数少且 retention 未过 → 不折叠（null）', () => {
    const now = 1_700_000_000_000;
    const manifest = makeManifest({ updated_at: now, retention_days: 30 });
    const segs = [segAt(DEV_A, 1, now, 'ent1'), segAt(DEV_A, 2, now, 'ent2')];
    // 段 created_at 距今 0 天，retention(30 天) 未过；段数 2 <= maxKeepSegs 10
    expect(planSnapshot(segs, manifest, 10)).toBeNull();
  });

  it('段数超限 → 折叠最老的 count-maxKeepSegs 段，through=某段 c_to', () => {
    const now = 1_700_000_000_000;
    const manifest = makeManifest({ updated_at: now, retention_days: 30 });
    // 6 段，全部新建（retention 未过），maxKeepSegs=3 → 折叠最老 3 段
    const segs = [1, 2, 3, 4, 5, 6].map((c) => segAt(DEV_A, c, now, `ent${c}`));
    const plan = planSnapshot(segs, manifest, 3);
    expect(plan).not.toBeNull();
    expect(plan?.through).toBe(3); // 第 3 段 c_to=3，绝不切在中间
    expect(plan?.foldSegIds).toEqual(segs.slice(0, 3).map((s) => s.seg_id));
  });

  it('retention 已过 → 折叠满足保留窗口的最老连续前缀', () => {
    const now = 1_700_000_000_000;
    const DAY = 24 * 60 * 60 * 1000;
    const manifest = makeManifest({ updated_at: now, retention_days: 30 });
    // 前 3 段 40 天前（retention 已过），后 2 段 1 天前（未过）
    const old = [1, 2, 3].map((c) => segAt(DEV_A, c, now - 40 * DAY, `ent${c}`));
    const fresh = [4, 5].map((c) => segAt(DEV_A, c, now - 1 * DAY, `ent${c}`));
    const plan = planSnapshot([...old, ...fresh], manifest, 10);
    expect(plan?.through).toBe(3);
    expect(plan?.foldSegIds).toEqual(old.map((s) => s.seg_id));
  });

  it('retention 与段数同时触发 → 取较大者（段数超限时连新段也折）', () => {
    const now = 1_700_000_000_000;
    const manifest = makeManifest({ updated_at: now, retention_days: 30 });
    const segs = [1, 2, 3, 4, 5].map((c) => segAt(DEV_A, c, now, `ent${c}`)); // 全新建，retention 未过
    // maxKeepSegs=2 → count-cut=3 > retention-cut=0 → 折 3 段
    const plan = planSnapshot(segs, manifest, 2);
    expect(plan?.through).toBe(3);
    expect(plan?.foldSegIds).toEqual(segs.slice(0, 3).map((s) => s.seg_id));
  });

  it('已折叠段（c_to <= covers_through）不再重复折叠', () => {
    const now = 1_700_000_000_000;
    const manifest = makeManifest({ updated_at: now, retention_days: 30, snapshot: { seq: 1, lamport: 3, covers_through: 3 } });
    // c=1..3 已折叠，c=4..5 未折叠
    const segs = [1, 2, 3, 4, 5].map((c) => segAt(DEV_A, c, now, `ent${c}`));
    const plan = planSnapshot(segs, manifest, 10);
    // 未折叠段只有 2 段（c=4,5），retention 未过且段数 2 <= 10 → null
    expect(plan).toBeNull();
  });
});

describe('buildSnapshotText 快照文本', () => {
  it('折叠段 → 稳定键序快照文本，且可被 dev 播种回读', () => {
    const now = 1_700_000_000_000;
    const segs = [1, 2, 3].map((c) => segAt(DEV_A, c, now, `ent${c}`));
    const text = buildSnapshotText(segs, 3, DEV_A);
    // 能被 snapshotToOps 回转（不抛）
    const ops = snapshotToOps(text, DEV_A);
    expect(ops.length).toBeGreaterThan(0);
    // 回转后重放与原投影等价
    const original = replay(segs.flatMap((s) => s.ops)).projection;
    const roundtrip = replay(ops).projection;
    expect(opsToSnapshot(roundtrip)).toBe(opsToSnapshot(original));
  });

  it('through 只折整段：c_to > through 的段被排除，不切段中间', () => {
    const now = 1_700_000_000_000;
    const segs = [1, 2, 3, 4, 5].map((c) => segAt(DEV_A, c, now, `ent${c}`));
    const text = buildSnapshotText(segs, 3, DEV_A);
    // 只含 c=1..3 的实体（ent1..ent3），ent4/ent5 不在
    const projection = replay(snapshotToOps(text, DEV_A)).projection;
    expect(projection.has('block', 'ent1')).toBe(true);
    expect(projection.has('block', 'ent3')).toBe(true);
    expect(projection.has('block', 'ent4')).toBe(false);
    expect(projection.has('block', 'ent5')).toBe(false);
  });

  it('S5 纯逻辑面：snapshot-N + 增量段重建投影 == 全量重放投影（逐字节）', () => {
    const now = 1_700_000_000_000;
    // 全量 op：c=1..6（DEV_A）+ c=1..4（DEV_B 另起目标）
    const allOps = [
      ...Array.from({ length: 6 }, (_, i) => makeOp({ c: i + 1, d: DEV_A, entityId: `entA${i + 1}` })),
      ...Array.from({ length: 4 }, (_, i) => makeOp({ c: i + 1, d: DEV_B, entityId: `entB${i + 1}` })),
    ];
    // 老段：c<=3 折叠；新段：其余全部增量
    const oldSegs = [segAt(DEV_A, 1, now, 'entA1'), segAt(DEV_A, 2, now, 'entA2'), segAt(DEV_A, 3, now, 'entA3')];
    const newSegs = [
      segAt(DEV_A, 4, now, 'entA4'),
      segAt(DEV_A, 5, now, 'entA5'),
      segAt(DEV_A, 6, now, 'entA6'),
      segAt(DEV_B, 1, now, 'entB1'),
      segAt(DEV_B, 2, now, 'entB2'),
      segAt(DEV_B, 3, now, 'entB3'),
      segAt(DEV_B, 4, now, 'entB4'),
    ];

    const snapshotText = buildSnapshotText(oldSegs, 3, DEV_A);
    const seedOps = snapshotToOps(snapshotText, DEV_A);
    const incrementalOps = newSegs.flatMap((s) => s.ops);

    const rebuilt = replay([...seedOps, ...incrementalOps]).projection;
    const full = replay(allOps).projection;
    expect(opsToSnapshot(rebuilt)).toBe(opsToSnapshot(full));
  });
});

describe('publishSnapshot 幂等（S6）', () => {
  it('首写 written，重复写 existed（ifAbsent 幂等）', async () => {
    const fs = new MemoryFs();
    const text = '{"v":1,"entities":[]}';
    expect(await publishSnapshot(fs, 'sync/yan', 18, text)).toBe('written');
    expect(await fs.read('sync/yan/snapshot-000018.json')).toBe(text);
    expect(await publishSnapshot(fs, 'sync/yan', 18, text)).toBe('existed');
  });

  it('prefix 为空时直接写文件名', async () => {
    const fs = new MemoryFs();
    await publishSnapshot(fs, '', 1, '{}');
    expect(await fs.exists('snapshot-000001.json')).toBe(true);
  });

  it('S6 半写崩溃后重跑 → existed，不产生第二个快照，水位不乱', async () => {
    const fs = new MemoryFs();
    const text = '{"v":1,"entities":[{"table":"block","id":"ent1"}]}';
    const seq = 18;

    // 首次写崩溃：halfwrite 让内容只落一半（文件存在但残缺）
    fs.injectFailure = 'halfwrite';
    await publishSnapshot(fs, 'sync/yan', seq, text); // 写已发生，不抛
    fs.injectFailure = null;

    // 重跑（幂等）：同名已存在 → 'existed'
    const result = await publishSnapshot(fs, 'sync/yan', seq, text);
    expect(result).toBe('existed');

    // 水位不乱：同名快照仅一份，重跑不产生第二个快照文件
    const names = (await fs.list('sync/yan')).filter((n) => n.startsWith('snapshot-'));
    expect(names).toEqual(['snapshot-000018.json']);
  });

  it('S6 写失败抛异常后重试 → written（文件未被残留半截占用）', async () => {
    const fs = new MemoryFs();
    const text = '{"v":1,"entities":[]}';
    // 自定义故障：写即抛错（模拟 IO 失败，未落盘）
    fs.injectFailure = () => {
      throw new Error('EIO');
    };
    await expect(publishSnapshot(fs, 'sync/yan', 18, text)).rejects.toThrow('EIO');

    fs.injectFailure = null;
    expect(await publishSnapshot(fs, 'sync/yan', 18, text)).toBe('written');
    expect(await fs.read('sync/yan/snapshot-000018.json')).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// T19-04：快照 crdtUpdates 区段（§0.2 不丢不折叠 / §0.3 播种带出 / §2.3 往返+v1 兼容）
// ---------------------------------------------------------------------------

/** 构造一条合法 crdt_update op。 */
function makeCrdtOp(id: string, c: number, dev: ActorId, pageId: string, updateB64: string, svFromB64?: string): Op {
  const payload: Record<string, unknown> = { pageId, updateB64 };
  if (svFromB64 !== undefined) {
    payload['svFromB64'] = svFromB64;
  }
  return {
    ...makeOp({ id, c, d: dev, entityId: pageId, kind: 'crdt_update', payload }),
    target: { table: 'page', id: pageId },
  };
}

describe('快照 crdtUpdates 区段（T19-04）', () => {
  it('折叠含 crdt_update 的段 → 区段按 pageId 分组原样保留；播种返回 seedOps+crdtUpdates（§2.3）', () => {
    const updA = 'AQIDBAUGB+wB+/==';
    const updB = 'aGVsbG8gY3JkdA==';
    const updC = 'cGFnZTItZGlmZg==';
    const seg = buildSegment(DEV_A, [
      makeOp({ c: 1, d: DEV_A, entityId: 'ent1', payload: { title: 'x', alive: 1 } }),
      makeCrdtOp('u1', 2, DEV_A, 'page1', updA, 'AAAA'),
      makeCrdtOp('u2', 3, DEV_A, 'page1', updB),
      makeCrdtOp('u3', 4, DEV_A, 'page2', updC),
    ]);

    const text = buildSnapshotText([seg], 4, DEV_A);

    // 区段内容：按 pageId 分组（首次出现序），页内保持全序，字节原样。
    const parsed = JSON.parse(text) as { v: number; entities: unknown[]; crdtUpdates: unknown };
    expect(parsed.crdtUpdates).toEqual([
      {
        pageId: 'page1',
        updates: [
          { opId: 'u1', updateB64: updA, svFromB64: 'AAAA' },
          { opId: 'u2', updateB64: updB },
        ],
      },
      { pageId: 'page2', updates: [{ opId: 'u3', updateB64: updC }] },
    ]);

    // 播种：实体投影与 crdtUpdates 双双无损。
    const seeded = seedFromSnapshot(text, DEV_A);
    expect(seeded.crdtUpdates).toEqual(parsed.crdtUpdates);
    const original = replay(seg.ops).projection;
    expect(opsToSnapshot(replay(seeded.seedOps).projection)).toBe(opsToSnapshot(original));
    expect(seeded.seedOps.length).toBe(1);
  });

  it('确定性：同输入两次 buildSnapshotText 输出逐字节一致', () => {
    const now = 1_700_000_000_000;
    const segs = [
      buildSegment(DEV_A, [makeOp({ c: 1, d: DEV_A, entityId: 'ent1', payload: { alive: 1 } })], now),
      buildSegment(DEV_B, [makeCrdtOp('u1', 2, DEV_B, 'page1', 'AAA=')], now),
    ];
    expect(buildSnapshotText(segs, 2, DEV_A)).toBe(buildSnapshotText(segs, 2, DEV_A));
  });

  it('无 crdt_update 的段 → 区段为空数组（新写快照恒含该键）', () => {
    const now = 1_700_000_000_000;
    const seg = buildSegment(DEV_A, [makeOp({ c: 1, d: DEV_A, entityId: 'ent1', payload: { alive: 1 } })], now);
    const text = buildSnapshotText([seg], 1, DEV_A);
    const parsed = JSON.parse(text) as { crdtUpdates: unknown };
    expect(parsed.crdtUpdates).toEqual([]);
  });

  it('v1 旧快照（无该区段）→ 读成空数组不报错，seedOps 正常（§2.3）', () => {
    const v1 = JSON.stringify({
      v: 1,
      entities: [{ table: 'block', id: 'ent1', version: 1, alive: 1, data: { title: 'x' }, lamport: { c: 1, d: DEV_A } }],
    });
    const seeded = seedFromSnapshot(v1, DEV_A);
    expect(seeded.crdtUpdates).toEqual([]);
    expect(seeded.seedOps).toHaveLength(1);
    expect(seeded.seedOps[0]?.target).toEqual({ table: 'block', id: 'ent1' });
  });

  it('畸形 crdtUpdates 区段 → SnapshotValidationError（不静默吞坏行）', () => {
    const base = { v: 2, entities: [] };
    const cases: unknown[] = [
      { ...base, crdtUpdates: 'nope' }, // 非数组
      { ...base, crdtUpdates: [42] }, // 页非对象
      { ...base, crdtUpdates: [{ updates: [] }] }, // 缺 pageId
      { ...base, crdtUpdates: [{ pageId: 'p1', updates: 'nope' }] }, // updates 非数组
      { ...base, crdtUpdates: [{ pageId: 'p1', updates: [{ opId: 'x' }] }] }, // 缺 updateB64
      { ...base, crdtUpdates: [{ pageId: 'p1', updates: [{ opId: 'x', updateB64: '' }] }] }, // 空 updateB64
    ];
    for (const crdtUpdates of cases) {
      expect(() => seedFromSnapshot(JSON.stringify(crdtUpdates), DEV_A)).toThrow(SnapshotValidationError);
    }
  });

  it('S5 纯逻辑面：含 crdt 的快照播种 + 增量段重建 → 实体投影与 crdtUpdates 集合都追平', () => {
    const now = 1_700_000_000_000;
    // 老段：entA1 + page1 的 u1（折叠）；新段：entA2 + page1 的 u2（增量）。
    const oldSeg = buildSegment(DEV_A, [
      makeOp({ c: 1, d: DEV_A, entityId: 'entA1', payload: { alive: 1 } }),
      makeCrdtOp('u1', 2, DEV_A, 'page1', 'AAA=', 'AAAA'),
    ], now);
    const newSeg = buildSegment(DEV_A, [
      makeOp({ c: 3, d: DEV_A, entityId: 'entA2', payload: { alive: 1 } }),
      makeCrdtOp('u2', 4, DEV_A, 'page1', 'AAB='),
    ], now);

    const snapText = buildSnapshotText([oldSeg], 2, DEV_A);
    const seeded = seedFromSnapshot(snapText, DEV_A);

    // 全量重放的 crdtUpdates 集合 = 播种带出 ∪ 增量段。
    const full = replay([...oldSeg.ops, ...newSeg.ops]).report.crdtUpdates;
    const rebuilt = replay([
      ...seeded.seedOps,
      ...newSeg.ops,
    ]);
    // 实体投影逐字节追平
    expect(opsToSnapshot(rebuilt.projection)).toBe(
      opsToSnapshot(replay([...oldSeg.ops, ...newSeg.ops]).projection),
    );
    // crdtUpdates：播种 u1 + 增量 u2 = 全量 {u1,u2}（opId 集合相等）
    const seededIds = seeded.crdtUpdates.flatMap((page) => page.updates.map((update) => update.opId));
    const rebuiltIds = rebuilt.report.crdtUpdates.map((entry) => entry.opId);
    expect([...seededIds, ...rebuiltIds].sort()).toEqual(full.map((entry) => entry.opId).sort());
  });
});
