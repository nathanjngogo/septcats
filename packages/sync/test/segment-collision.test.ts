import { describe, expect, it } from 'vitest';
import { buildSegment, decodeSegment, encodeSegment, type Op } from '@septcats/core';
import { MemoryFs } from '../src/fs';
import { mergeRemote } from '../src/merger';
import { InProcessProvider } from '../src/provider';
import { contentFingerprint, parseSegmentFileName, segmentFileName } from '../src/naming';
import { SegmentBuilder, publishSegment } from '../src/writer';
import { DEV_A, makeOp } from './helpers';

/**
 * TASK-T29-01 · 段名碰撞导致静默丢 op（P0-2）。
 *
 * 背景（T28-01 报告 §4）：段名 (dev, c_from, n) 可碰撞——EditSession 按块 version+1
 * 定 lamport.c，跨块可重复；「迟到且 lamport.c 更低」的 op 之后的 flush 段与既有段
 * 同名时，publishSegment 以 ifAbsent 语义返回 'existed' 被当作成功 → 该批 op 未落盘
 * 且无任何错误上报（夹具账本 4 op / 盘上仅 2 op / watermark=3，状态栏仍「已同步」）。
 *
 * 核心不变量（PM 裁决，不可妥协）：**已 flush 的 op 永不丢失**；任何段写入冲突必须
 * 被检测并以新名字重写或合并，绝不允许「当作成功而丢弃」。
 */

const ROOT = 'sync';

/** 模拟 EditSession 口径：lamport.c 按块 version 生成，跨块可重复（迟到低 c op 的来源）。 */
function lateOp(id: string, c: number, entityId: string): Op {
  return makeOp({ id, c, d: DEV_A, entityId, payload: { title: entityId, alive: 1 } });
}

/** 攒一批 op 并 flush+publish（复刻 runtime 攒段循环的发布步）。 */
async function flushAndPublish(builder: SegmentBuilder, fs: MemoryFs): Promise<number> {
  const seg = builder.flush();
  if (seg === null) {
    return 0;
  }
  const n = seg.ops.length;
  await publishSegment(fs, ROOT, seg);
  return n;
}

/** 盘上全部段内 op（经 InProcessProvider 列段 → decodeSegment；坏段跳过，同 merger 隔离口径）。 */
async function diskOps(fs: MemoryFs): Promise<Op[]> {
  const provider = new InProcessProvider(fs, ROOT);
  const out: Op[] = [];
  for (const { file } of await provider.listSegments()) {
    const text = await provider.get(file);
    if (text === null) {
      continue;
    }
    try {
      out.push(...decodeSegment(text).ops);
    } catch {
      // 篡改/坏段：与 merger 一致地跳过（不进 op 统计）
    }
  }
  return out;
}

/** 不变量断言：任何已 flush 的 op 都能在盘上找到（盘上 op 集合 ⊇ flush 集合）。 */
async function expectNoOpLost(fs: MemoryFs, flushed: readonly Op[]): Promise<void> {
  const onDisk = await diskOps(fs);
  const diskIds = new Set(onDisk.map((o) => o.op_id));
  for (const op of flushed) {
    expect(diskIds.has(op.op_id), `op ${op.op_id}（c=${String(op.lamport.c)}）已 flush 但盘上找不到`).toBe(true);
  }
}

describe('T29-01 回归：迟到低 c op → 后续 flush 同名 → 不得静默丢 op', () => {
  it('「迟到低 c op → 同名 flush」序列：盘上 op 数 == 账本 op 数，无丢失', async () => {
    const fs = new MemoryFs();
    const builder = new SegmentBuilder(DEV_A);

    // 第一批（与 T28-01 §4 夹具同构）：c1 + c2 → 段 (c_from=1, n=2)
    const batch1 = [lateOp('t1-a', 1, 'pg-a'), lateOp('t1-b', 2, 'pg-b')];
    for (const op of batch1) {
      builder.add(op);
    }
    expect(await flushAndPublish(builder, fs)).toBe(2);

    // 迟到低 c op 批：c=1（早于已发布水位，与第一批同 c_from）+ c=3
    // → 新段 (c_from=1, n=2)，旧命名规则下与第一批同名 → 旧实现整批被 'existed' 吞掉
    const batch2 = [lateOp('t1-c', 1, 'pg-late'), lateOp('t1-d', 3, 'pg-c')];
    for (const op of batch2) {
      builder.add(op);
    }
    expect(await flushAndPublish(builder, fs)).toBe(2);

    // 核心不变量：账本（此处 = 全部 flush 的 op）4 条，盘上必须也是 4 条
    const ledger = [...batch1, ...batch2];
    const onDisk = await diskOps(fs);
    expect(onDisk).toHaveLength(ledger.length); // 修前红：盘上仅 2（丢 2）
    await expectNoOpLost(fs, ledger);
  });
});

describe('T29-01 不变量：任何已 flush 的 op 都能在盘上找到（≥3 组序列）', () => {
  it('序列一：迟到 op 多轮穿插（每轮都含早于已发布水位的低 c op）', async () => {
    const fs = new MemoryFs();
    const builder = new SegmentBuilder(DEV_A);
    const flushed: Op[] = [];
    // 五轮：奇数轮混入「迟到低 c op」（c=1 复用首轮 c_from）
    const rounds: Op[][] = [
      [lateOp('s1-r1a', 1, 'pg-1'), lateOp('s1-r1b', 2, 'pg-2')],
      [lateOp('s1-r2a', 1, 'pg-late-1'), lateOp('s1-r2b', 3, 'pg-3')],
      [lateOp('s1-r3a', 2, 'pg-4'), lateOp('s1-r3b', 4, 'pg-5')],
      [lateOp('s1-r4a', 1, 'pg-late-2'), lateOp('s1-r4b', 2, 'pg-late-3'), lateOp('s1-r4c', 5, 'pg-6')],
      [lateOp('s1-r5a', 3, 'pg-7'), lateOp('s1-r5b', 6, 'pg-8')],
    ];
    for (const round of rounds) {
      for (const op of round) {
        builder.add(op);
      }
      const seg = builder.flush();
      if (seg !== null) {
        flushed.push(...seg.ops);
        await publishSegment(fs, ROOT, seg);
      }
    }
    expect(flushed.length).toBe(11);
    await expectNoOpLost(fs, flushed);
    // 单设备发布：盘上 op 数 == flush op 数（无重复无丢失）
    expect((await diskOps(fs))).toHaveLength(flushed.length);
  });

  it('序列二：同设备并发批（同 (c_from,n) 不同内容）与异设备并发推送交错', async () => {
    const fs = new MemoryFs();
    // 模拟同设备两路并发 flush：两批的 (c_from=1, n=2) 相同但内容不同（旧规则同名）
    const devA1 = [lateOp('s2-a1', 1, 'pg-x'), lateOp('s2-a2', 3, 'pg-y')];
    const devA2 = [lateOp('s2-a3', 1, 'pg-z'), lateOp('s2-a4', 2, 'pg-w')];
    // DEV_B 并发推送（异设备，lamport 并发）
    const devB = [makeOp({ id: 's2-b1', c: 1, d: 'bbbb0002', entityId: 'pg-b1' })];
    const segA1 = buildSegment(DEV_A, devA1);
    const segA2 = buildSegment(DEV_A, devA2);
    const segB = buildSegment('bbbb0002', devB);
    // 交错发布：A1 → B → A2
    await publishSegment(fs, ROOT, segA1);
    await publishSegment(fs, ROOT, segB);
    await publishSegment(fs, ROOT, segA2);
    await expectNoOpLost(fs, [...segA1.ops, ...segA2.ops, ...segB.ops]);
    const onDisk = await diskOps(fs);
    expect(onDisk).toHaveLength(5); // 三段全落盘，一条不少
  });

  it('序列三：幂等重发布与迟到 op 交错（重发布不产生重复数据也不吞新段）', async () => {
    const fs = new MemoryFs();
    const builder = new SegmentBuilder(DEV_A);
    const flushed: Op[] = [];
    const first = [lateOp('s3-a', 1, 'pg-1'), lateOp('s3-b', 2, 'pg-2')];
    for (const op of first) {
      builder.add(op);
    }
    const seg1 = builder.flush();
    if (seg1 === null) throw new Error('flush 不应返回 null');
    flushed.push(...seg1.ops);
    expect(await publishSegment(fs, ROOT, seg1)).toBe('written');
    // 幂等重发布：同内容 → 'existed'，不产生重复数据
    expect(await publishSegment(fs, ROOT, seg1)).toBe('existed');
    expect((await diskOps(fs))).toHaveLength(2);
    // 迟到 op 段 + 再重发布旧段，交错进行
    const late = [lateOp('s3-c', 1, 'pg-late'), lateOp('s3-d', 3, 'pg-3')];
    for (const op of late) {
      builder.add(op);
    }
    const seg2 = builder.flush();
    if (seg2 === null) throw new Error('flush 不应返回 null');
    flushed.push(...seg2.ops);
    await publishSegment(fs, ROOT, seg2);
    expect(await publishSegment(fs, ROOT, seg1)).toBe('existed'); // 旧段重发布仍幂等
    await expectNoOpLost(fs, flushed);
    expect((await diskOps(fs))).toHaveLength(4);
  });
});

describe('T29-01 幂等不回归', () => {
  it('同段重复发布（内容相同）仍成功且不重复数据', async () => {
    const fs = new MemoryFs();
    const seg = buildSegment(DEV_A, [lateOp('t3-a', 1, 'pg-1'), lateOp('t3-b', 2, 'pg-2')], 1_700_000_000_000);
    expect(await publishSegment(fs, ROOT, seg)).toBe('written');
    expect(await publishSegment(fs, ROOT, seg)).toBe('existed');
    // 同 op 集重建（同 createdAt → 逐字节同内容）→ 同名 → 幂等
    const rebuilt = buildSegment(DEV_A, [lateOp('t3-b', 2, 'pg-2'), lateOp('t3-a', 1, 'pg-1')], 1_700_000_000_000);
    expect(encodeSegment(rebuilt)).toBe(encodeSegment(seg));
    expect(await publishSegment(fs, ROOT, rebuilt)).toBe('existed');
    expect((await diskOps(fs))).toHaveLength(2); // 无重复数据
  });
});

describe('T29-01 兼容：旧命名段仍可读重放', () => {
  it('旧命名（无内容摘要）解析 digest=undefined；mergeRemote 正常重放旧命名段', async () => {
    const fs = new MemoryFs();
    const legacy = buildSegment(DEV_A, [lateOp('t4-a', 1, 'pg-a'), lateOp('t4-b', 2, 'pg-b')], 1_700_000_000_000);
    await fs.write(`${ROOT}/${legacy.seg_id}.jsonl`, encodeSegment(legacy)); // 旧版产品落盘形态
    const info = parseSegmentFileName(`${legacy.seg_id}.jsonl`);
    expect(info).not.toBeNull();
    expect(info?.cFrom).toBe(1);
    expect(info?.dev).toBe(DEV_A);
    expect(info?.n).toBe(2);
    expect(info?.digest).toBeUndefined();
    // 旧命名段的网盘副本 / 加密形态同样可解析
    expect(parseSegmentFileName(`${legacy.seg_id} (1).jsonl`)?.copySuffix).toBe(1);
    expect(parseSegmentFileName(`${legacy.seg_id}.jsonl.enc`)?.encrypted).toBe(true);

    const report = await mergeRemote({
      provider: new InProcessProvider(fs, ROOT),
      localLedger: [],
      seenContentHashes: new Set(),
      now: 0,
    });
    expect(report.applied.map((o) => o.op_id).sort()).toEqual(['t4-a', 't4-b']);
  });

  it('新命名只增不破：摘要名可解析往返（含副本/加密后缀）；旧命名文件不被新段覆盖', async () => {
    const fs = new MemoryFs();
    // 旧版落了一个旧命名段
    const legacy = buildSegment(DEV_A, [lateOp('t5-a', 1, 'pg-a')], 1_700_000_000_000);
    await fs.write(`${ROOT}/${legacy.seg_id}.jsonl`, encodeSegment(legacy));
    // 新版发布同 (dev, c_from, n) 但内容不同的段（旧规则下会同名互吞）
    const fresh = buildSegment(DEV_A, [lateOp('t5-b', 1, 'pg-b')], 1_700_000_000_000);
    expect(fresh.seg_id).toBe(legacy.seg_id); // 旧命名规则下必然同名
    expect(await publishSegment(fs, ROOT, fresh)).toBe('written'); // 新命名 → 不再吞
    expect(await fs.exists(`${ROOT}/${legacy.seg_id}.jsonl`)).toBe(true); // 旧文件原样保留

    const d8 = contentFingerprint(encodeSegment(fresh)).slice(0, 8);
    const base = `${fresh.seg_id}-${d8}`; // 无扩展名基底（副本/加密后缀拼在基底上）
    expect(parseSegmentFileName(`${base}.jsonl`)?.digest).toBe(d8);
    expect(parseSegmentFileName(`${base} (2).jsonl`)?.copySuffix).toBe(2);
    expect(parseSegmentFileName(`${base}.jsonl.enc`)?.encrypted).toBe(true);
    expect(parseSegmentFileName(`${base}.jsonl.enc`)?.digest).toBe(d8);

    // 两段都被 mergeRemote 读取重放：op 并集完整
    const report = await mergeRemote({
      provider: new InProcessProvider(fs, ROOT),
      localLedger: [],
      seenContentHashes: new Set(),
      now: 0,
    });
    expect(report.applied.map((o) => o.op_id).sort()).toEqual(['t5-a', 't5-b']);
  });
});

describe('T29-01 publishSegment 语义收紧', () => {
  it('同名命中且内容不同 → 改新名重写（rewritten），op 不丢', async () => {
    const fs = new MemoryFs();
    const seg = buildSegment(DEV_A, [lateOp('t6-a', 1, 'pg-a')], 1_700_000_000_000);
    const name = segmentFileName(seg, encodeSegment(seg));
    // 外部干扰：首选摘要名位置已被不同内容占用（极端碰撞/篡改）
    await fs.write(`${ROOT}/${name}`, 'not-a-segment\n');
    const result = await publishSegment(fs, ROOT, seg);
    expect(result).toBe('rewritten');
    const onDisk = await diskOps(fs);
    expect(onDisk.map((o) => o.op_id)).toContain('t6-a'); // 数据不丢
  });

  it('同名命中且内容等价 → 幂等成功（existed）', async () => {
    const fs = new MemoryFs();
    const seg = buildSegment(DEV_A, [lateOp('t7-a', 1, 'pg-a')], 1_700_000_000_000);
    expect(await publishSegment(fs, ROOT, seg)).toBe('written');
    expect(await publishSegment(fs, ROOT, seg)).toBe('existed');
    expect((await diskOps(fs))).toHaveLength(1);
  });
});
