import { describe, expect, it } from 'vitest';
import { buildSegment, encodeSegment, opsToSnapshot, replay, type Op } from '@septcats/core';
import * as Y from 'yjs';
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

// ---------------------------------------------------------------------------
// T19-04 §2.4：4 设备并发文本场景（yjs 仅作 devDependency 生成/校验真实增量；
// 被测对象仍是 sync 的段合并/分流/去重——运行时零 yjs 依赖，payload 对 sync 不透明）。
// ---------------------------------------------------------------------------

const TEXT_DEVICES = [DEV_A, DEV_B, DEV_C, DEV_D] as const;
const TEXT_ROUNDS = 3;
const PAGE_ID = 'page-shared';

/** b64 <-> bytes（模拟 payload 载体）。 */
function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function fromB64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

describe('4 设备并发文本收敛（T19-04 §2.4：crdt_update + 常规 op × 多次切分/乱序）', () => {
  it('全部设备实体投影逐字节相等 + crdtUpdates 集合相等 + Yjs 文本逐字符一致', async () => {
    const rng = mulberry32(0x51ec475);
    const fs = new MemoryFs();

    // 每设备：本地 Y.Doc + 状态向量水位 + 本地账 + 已应用的 update opId 集。
    const docs = TEXT_DEVICES.map(() => new Y.Doc());
    const prevSv = TEXT_DEVICES.map((_) => null as Uint8Array | null);
    const ledgers: Op[][] = TEXT_DEVICES.map(() => []);
    const seenHashes = TEXT_DEVICES.map(() => new Set<string>());
    const appliedOpIds = TEXT_DEVICES.map(() => new Set<string>());
    const allCrdtOpIds = new Set<string>();
    const allUpdates: string[] = []; // 全部真实增量的 base64（收敛真值素材）

    let opSeq = 0;
    for (let round = 0; round < TEXT_ROUNDS; round += 1) {
      const roundOps: Op[][] = TEXT_DEVICES.map(() => []);

      // 1) 每设备本地编辑 Y.Text → 捕获增量 update → 1 条 crdt_update op + 2 条常规 op。
      for (let di = 0; di < TEXT_DEVICES.length; di += 1) {
        const dev = TEXT_DEVICES[di] as (typeof TEXT_DEVICES)[number];
        const doc = docs[di];
        if (doc === undefined) {
          throw new Error('Y.Doc 缺失');
        }
        const text = doc.getText('body');
        const sv = prevSv[di] ?? undefined;

        // 保证每轮至少一次插入 → 增量必非空（updateB64 非空是 encodeOp 的硬约束）。
        for (let k = 0; k < 3; k += 1) {
          text.insert(text.length, `d${di}r${round}#${k} `);
        }
        if (text.length > 40) {
          const pos = Math.floor(rng() * (text.length - 20));
          text.delete(pos, 1 + Math.floor(rng() * 5));
        }
        const update = Y.encodeStateAsUpdate(doc, sv);
        prevSv[di] = Y.encodeStateVector(doc);
        allUpdates.push(toB64(update));

        opSeq += 1;
        const crdtOpId = `crdt-${String(opSeq).padStart(4, '0')}`;
        allCrdtOpIds.add(crdtOpId);
        appliedOpIds[di]?.add(crdtOpId); // 本设备自己的 update 当场已在其 Y.Doc 中
        roundOps[di]?.push({
          op_id: crdtOpId,
          lamport: { c: di * 10000 + round * 100 + 1, d: dev },
          at: 1_700_000_000_000 + opSeq,
          actor: dev,
          target: { table: 'page', id: PAGE_ID },
          kind: 'crdt_update',
          merge_policy: 'crdt',
          payload: { pageId: PAGE_ID, updateB64: toB64(update) },
        });
        // 常规实体 op：交错写同块（LWW/冲突路径照旧运转）。
        roundOps[di]?.push(
          makeRegularOp(`reg-${String(opSeq).padStart(4, '0')}a`, di * 10000 + round * 100 + 2, dev, di),
          makeRegularOp(`reg-${String(opSeq).padStart(4, '0')}b`, di * 10000 + round * 100 + 3, dev, di),
        );
      }

      // 2) 每设备本轮 op 随机切成 1..3 段落盘；写入顺序打乱（乱序到达）。
      const pending: Array<{ name: string; text: string }> = [];
      for (let di = 0; di < TEXT_DEVICES.length; di += 1) {
        const dev = TEXT_DEVICES[di] as (typeof TEXT_DEVICES)[number];
        const ops = roundOps[di] ?? [];
        let i = 0;
        while (i < ops.length) {
          const chunk = ops.slice(i, i + 1 + Math.floor(rng() * 3));
          i += chunk.length;
          const seg = buildSegment(dev, chunk);
          pending.push({ name: `${seg.seg_id}.jsonl`, text: encodeSegment(seg) });
        }
      }
      // 确定性洗牌
      for (let w = pending.length - 1; w > 0; w -= 1) {
        const swap = Math.floor(rng() * (w + 1));
        const tmp = pending[w] as { name: string; text: string };
        pending[w] = pending[swap] as { name: string; text: string };
        pending[swap] = tmp;
      }
      for (const item of pending) {
        await fs.write(`${ROOT}/${item.name}`, item.text);
      }

      // 3) 每设备各自 mergeRemote：applied 入账，crdtUpdates 逐条 applyUpdate（幂等）。
      for (let di = 0; di < TEXT_DEVICES.length; di += 1) {
        const report = await mergeRemote({
          provider: new InProcessProvider(fs, ROOT),
          localLedger: ledgers[di] ?? [],
          seenContentHashes: seenHashes[di] ?? new Set<string>(),
          now: round,
        });
        ledgers[di]?.push(...report.applied);
        for (const entry of report.crdtUpdates) {
          if (!appliedOpIds[di]?.has(entry.opId)) {
            Y.applyUpdate(docs[di] as Y.Doc, fromB64(entry.updateB64));
            appliedOpIds[di]?.add(entry.opId);
          }
        }
      }
    }

    // 断言 1：Yjs 文本层——4 设备逐字符一致，且等于「全部增量灌入新 Doc」的真值。
    const truth = new Y.Doc();
    for (const updateB64 of allUpdates) {
      Y.applyUpdate(truth, fromB64(updateB64));
    }
    const texts = docs.map((doc) => doc.getText('body').toString());
    const truthText = truth.getText('body').toString();
    expect(texts[0]?.length ?? 0).toBeGreaterThan(0);
    for (let di = 1; di < texts.length; di += 1) {
      expect(texts[di]).toBe(texts[0]);
    }
    expect(truthText).toBe(texts[0]);

    // 断言 2：实体投影逐字节相等（crdt_update 不碰投影，常规 op 走既有 LWW 全序）。
    const projections = ledgers.map((ledger) => opsToSnapshot(replay(ledger).projection));
    for (let di = 1; di < projections.length; di += 1) {
      expect(projections[di]).toBe(projections[0]);
    }

    // 断言 3：crdtUpdates 集合相等 = 全部生成的 update opId（一台不漏）。
    for (let di = 0; di < TEXT_DEVICES.length; di += 1) {
      expect(appliedOpIds[di]).toEqual(allCrdtOpIds);
    }
  });

  /** 常规实体 op（upsert/patch 交错）。 */
  function makeRegularOp(id: string, c: number, dev: (typeof TEXT_DEVICES)[number], di: number): Op {
    const target = `ent${(di + c) % 4}`;
    if (c % 2 === 0) {
      return {
        op_id: id,
        lamport: { c, d: dev },
        at: 1_700_000_000_000 + c,
        actor: dev,
        target: { table: 'block', id: target },
        kind: 'upsert',
        payload: { title: `t${c}`, alive: 1 },
      };
    }
    return {
      op_id: id,
      lamport: { c, d: dev },
      at: 1_700_000_000_000 + c,
      actor: dev,
      target: { table: 'block', id: target },
      kind: 'patch',
      payload: { v: c },
    };
  }
});
