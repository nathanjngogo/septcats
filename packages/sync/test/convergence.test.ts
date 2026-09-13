import { describe, expect, it } from 'vitest';
import { buildSegment, encodeSegment, opsToSnapshot, replay, type Op } from '@septcats/core';
import { MemoryFs } from '../src/fs';
import { mergeRemote } from '../src/merger';
import { InProcessProvider } from '../src/provider';
import { DEV_A, DEV_B, DEV_C, DEV_D } from './helpers';

/**
 * 收敛性总测（任务书 §5）：4 设备各 30 随机 op，4 种段切分方式分别合并，
 * 最终投影逐字节相等。这是同步正确性的数学保证——合并结果只依赖 (lamport, op_id) 全序，
 * 与段边界无关。
 */

const ROOT = 'sync';
const DEVICES = [DEV_A, DEV_B, DEV_C, DEV_D] as const;
const OPS_PER_DEVICE = 30;
const TARGETS = ['entA', 'entB', 'entC', 'entD', 'entE', 'entF'] as const;

/** 自实现 mulberry32：确定性 PRNG，不依赖外部库。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 确定性生成 4 设备 × 30 op。lamport c 按设备分段（di*1000 + i + 1），全局唯一。 */
function generateOps(): Op[][] {
  const rng = mulberry32(0x9e3779b9);
  let opSeq = 0;
  return DEVICES.map((dev, di) => {
    const ops: Op[] = [];
    for (let i = 0; i < OPS_PER_DEVICE; i += 1) {
      opSeq += 1;
      const roll = rng();
      let kind: Op['kind'];
      let payload: Record<string, unknown>;
      if (roll < 0.4) {
        kind = 'upsert';
        payload = { title: `t${opSeq}`, alive: 1, v: Math.floor(rng() * 1000) };
      } else if (roll < 0.6) {
        kind = 'patch';
        payload = { v: Math.floor(rng() * 1000) };
      } else if (roll < 0.75) {
        kind = 'delete';
        payload = { alive: 0 };
      } else if (roll < 0.88) {
        kind = 'move';
        payload = { parent_id: `p${Math.floor(rng() * 6)}` };
      } else {
        kind = 'reorder';
        payload = { sort_key: `s${Math.floor(rng() * 100)}` };
      }
      const target = TARGETS[Math.floor(rng() * TARGETS.length)] ?? 'entA';
      ops.push({
        op_id: `op-${String(opSeq).padStart(4, '0')}`,
        lamport: { c: di * 1000 + i + 1, d: dev },
        at: 1_700_000_000_000 + opSeq,
        actor: dev,
        target: { table: 'block', id: target },
        kind,
        payload,
      });
    }
    return ops;
  });
}

type SplitStrategy = 'per-op' | 'whole' | 'random-cut' | 'by-target';

/** 把单台设备的 op 序列切成若干段（每段一组 op），组内 op 保持 lamport 升序。 */
function splitOps(devOps: Op[], strategy: SplitStrategy, rng: () => number): Op[][] {
  switch (strategy) {
    case 'per-op':
      return devOps.map((op) => [op]);
    case 'whole':
      return [devOps];
    case 'by-target': {
      const groups = new Map<string, Op[]>();
      for (const op of devOps) {
        const group = groups.get(op.target.id);
        if (group === undefined) {
          groups.set(op.target.id, [op]);
        } else {
          group.push(op);
        }
      }
      return [...groups.values()];
    }
    case 'random-cut': {
      const out: Op[][] = [];
      let i = 0;
      while (i < devOps.length) {
        const chunk = 1 + Math.floor(rng() * 5); // 1..5
        out.push(devOps.slice(i, i + chunk));
        i += chunk;
      }
      return out;
    }
  }
}

/** 按给定切分策略落盘并合并，返回最终投影的稳定快照字符串。 */
async function projectFor(strategy: SplitStrategy): Promise<string> {
  const fs = new MemoryFs();
  const segRng = mulberry32(0x12345678);
  for (const devOps of generateOps()) {
    for (const group of splitOps(devOps, strategy, segRng)) {
      const dev = group[0]?.actor;
      if (dev === undefined || group.length === 0) {
        continue;
      }
      const seg = buildSegment(dev, group);
      await fs.write(`${ROOT}/${seg.seg_id}.jsonl`, encodeSegment(seg));
    }
  }

  const report = await mergeRemote({
    provider: new InProcessProvider(fs, ROOT),
    localLedger: [],
    seenContentHashes: new Set(),
    now: 0,
  });
  return opsToSnapshot(replay(report.applied).projection);
}

describe('收敛性总测（4 设备 × 30 op × 4 种段切分）', () => {
  it('合并后最终投影逐字节相等（与段边界无关）', async () => {
    const strategies: SplitStrategy[] = ['per-op', 'whole', 'random-cut', 'by-target'];
    const results: string[] = [];
    for (const strategy of strategies) {
      results.push(await projectFor(strategy));
    }

    const baseline = results[0];
    expect(baseline).toBeDefined();
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i]).toBe(baseline);
    }
  });
});
