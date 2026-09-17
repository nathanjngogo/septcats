import { describe, expect, it } from 'vitest';
import {
  MIN_SUPPORTED_SCHEMA_VERSION,
  SCHEMA_VERSION,
  SegmentValidationError,
  decodeSegment,
  encodeSegment,
  opsToSnapshot,
  replay,
  snapshotToOps,
  validateSegment,
  type Op,
} from '../src/index';
import { DEV_A, DEV_B, makeOp, mulberry32, shuffle } from './helpers';

const REC1 = 'rec0000001';
const PAGE1 = 'page000001';

/**
 * T19-02 §2 用例：字段级（key 粒度）LWW（merge_policy='lww-field'）与
 * crdt_update（merge_policy='crdt'）的 replay 语义，及 v1 段兼容回归。
 */

/** 对照组（旧写入约定，SPIKE E15）：整对象 upsert 并发 → LWW 胜者通吃。 */
describe('对照：整对象 upsert 语义的并发丢失（SPIKE §2 表 2 的 46.6% 蒸发在单测层面的复现）', () => {
  it('同基线两端各改一个 key（整对象 upsert）→ 恰好一端的单元格写丢失', () => {
    const base = { alive: 1, k0: 'base' };
    const opA = makeOp({
      id: 'cmp-a',
      c: 5,
      d: DEV_A,
      table: 'record',
      entityId: REC1,
      kind: 'upsert',
      payload: { ...base, k1: 'A' },
    });
    const opB = makeOp({
      id: 'cmp-b',
      c: 5,
      d: DEV_B,
      table: 'record',
      entityId: REC1,
      kind: 'upsert',
      payload: { ...base, k2: 'B' },
    });

    for (const ops of [[opA, opB], [opB, opA]]) {
      const { projection } = replay(ops as Op[]);
      const data = projection.get('record', REC1)?.data ?? {};
      const keptA = data['k1'] === 'A';
      const keptB = data['k2'] === 'B';
      // 整对象语义下两处并发单元格写恰好蒸发一处（且与输入顺序无关地蒸发同一处）
      expect(keptA !== keptB).toBe(true);
    }
  });
});

describe('lww-field：字段级（key 粒度）LWW', () => {
  const fieldOp = (id: string, c: number, d: typeof DEV_A | typeof DEV_B, payload: Record<string, unknown>) =>
    makeOp({ id, c, d, table: 'record', entityId: REC1, kind: 'patch', mergePolicy: 'lww-field', payload });

  it('per-key 并发（核心收益）：A 改 k1、B 改 k2，任意顺序 replay 两处改动都保留', () => {
    const seed = makeOp({
      id: 'seed',
      c: 1,
      d: DEV_A,
      table: 'record',
      entityId: REC1,
      kind: 'upsert',
      payload: { alive: 1, k0: 'base' },
    });
    const opA = fieldOp('fa', 5, DEV_A, { k1: 'A' });
    const opB = fieldOp('fb', 5, DEV_B, { k2: 'B' });

    for (const [first, second] of [[opA, opB], [opB, opA]] as const) {
      const { projection, report } = replay([seed, first, second]);
      const data = projection.get('record', REC1)?.data ?? {};
      expect(data).toEqual({ alive: 1, k0: 'base', k1: 'A', k2: 'B' });
      expect(report.crdtUpdates).toEqual([]);
    }
  });

  it('跨批次增量 replay 同样保留两处改动（分批顺序无关，收敛性）', () => {
    const opA = fieldOp('fa', 5, DEV_A, { k1: 'A' });
    const opB = fieldOp('fb', 5, DEV_B, { k2: 'B' });

    // 先到 B 的段、后到 A 的段（B 的全序更大）：per-key LWW 下 A 的 k1 不得被整单丢弃
    const step1 = replay([opB]);
    const step2 = replay([opA], step1.projection);
    expect(step2.projection.get('record', REC1)?.data).toEqual({ k1: 'A', k2: 'B' });

    // 反过来分批，最终投影逐字节一致
    const rev1 = replay([opA]);
    const rev2 = replay([opB], rev1.projection);
    expect(opsToSnapshot(rev2.projection)).toBe(opsToSnapshot(step2.projection));
  });

  it('同 key 并发：全序（lamport, deviceId）决胜，两端结果一致', () => {
    const opA = fieldOp('sa', 5, DEV_A, { k: 'vA' });
    const opB = fieldOp('sb', 5, DEV_B, { k: 'vB' });

    const forward = replay([opA, opB]);
    const backward = replay([opB, opA]);
    // (5,B) > (5,A)，vB 胜出
    expect(forward.projection.get('record', REC1)?.data['k']).toBe('vB');
    expect(opsToSnapshot(backward.projection)).toBe(opsToSnapshot(forward.projection));

    // 跨批次：晚到的低全序写不得覆盖高全序值
    const step1 = replay([opB]);
    const step2 = replay([opA], step1.projection);
    expect(step2.projection.get('record', REC1)?.data['k']).toBe('vB');

    // 更高 lamport 的写入照常获胜（因果有序的覆盖不受影响）
    const opC = fieldOp('sc', 9, DEV_A, { k: 'vC' });
    const later = replay([opC], step2.projection);
    expect(later.projection.get('record', REC1)?.data['k']).toBe('vC');
  });

  it('null = 删除该 key；未出现的 key 保留原值', () => {
    const seed = makeOp({
      id: 'seed',
      c: 1,
      d: DEV_A,
      table: 'record',
      entityId: REC1,
      kind: 'upsert',
      payload: { alive: 1, k1: 'x', k2: 'y' },
    });
    const del = fieldOp('del', 2, DEV_A, { k1: null });
    const add = fieldOp('add', 3, DEV_A, { k3: 'z' });

    const { projection } = replay([seed, del, add]);
    const data = projection.get('record', REC1)?.data ?? {};
    expect(Object.prototype.hasOwnProperty.call(data, 'k1')).toBe(false); // null 删键（不是置 null）
    expect(data['k2']).toBe('y'); // 未出现的 key 保留
    expect(data['k3']).toBe('z');
    expect(data['alive']).toBe(1);
  });

  it('重复重放幂等：同批 lww-field op 重放两次投影不变', () => {
    const opA = fieldOp('fa', 5, DEV_A, { k1: 'A' });
    const first = replay([opA]);
    const second = replay([opA], first.projection);
    expect(opsToSnapshot(second.projection)).toBe(opsToSnapshot(first.projection));
  });

  it('含 lww-field 的混合事件集任意输入顺序重放结果全等', () => {
    const ops: Op[] = [
      makeOp({
        id: 's1',
        c: 1,
        d: DEV_A,
        table: 'record',
        entityId: REC1,
        kind: 'upsert',
        payload: { alive: 1, k1: 'x' },
      }),
      fieldOp('s2', 2, DEV_B, { k2: 'y' }),
      fieldOp('s3', 3, DEV_A, { k1: null }),
      fieldOp('s4', 3, DEV_B, { k1: 'x2' }),
      fieldOp('s5', 4, DEV_A, { k3: 'z' }),
    ];
    const baseline = opsToSnapshot(replay(ops).projection);
    for (let round = 0; round < 50; round += 1) {
      const shuffled = shuffle(ops, mulberry32(0x2000 + round));
      expect(opsToSnapshot(replay(shuffled).projection)).toBe(baseline);
    }
  });
});

describe('crdt_update：收集不投影', () => {
  const crdtOp = (id: string, c: number, d: typeof DEV_A | typeof DEV_B, updateB64: string, entityId = PAGE1) =>
    makeOp({
      id,
      c,
      d,
      table: 'page',
      entityId,
      kind: 'crdt_update',
      mergePolicy: 'crdt',
      payload: { pageId: entityId, updateB64 },
    });

  it('不进实体投影，按全序收集到 report.crdtUpdates', () => {
    const u1 = crdtOp('u1', 5, DEV_A, 'RVZFTjE=');
    const u2 = crdtOp('u2', 6, DEV_B, 'RVZFTjI=');
    const { projection, report } = replay([u2, u1]);

    expect(projection.size).toBe(0);
    expect(report.conflicts).toEqual([]);
    expect(report.crdtUpdates).toEqual([
      { opId: 'u1', target: { table: 'page', id: PAGE1 }, pageId: PAGE1, updateB64: 'RVZFTjE=' },
      { opId: 'u2', target: { table: 'page', id: PAGE1 }, pageId: PAGE1, updateB64: 'RVZFTjI=' },
    ]);
  });

  it('同一条重复出现只收集一次；乱序输入收集结果一致', () => {
    const u1 = crdtOp('u1', 5, DEV_A, 'RVZFTjE=');
    const u2 = crdtOp('u2', 6, DEV_B, 'RVZFTjI=');
    const u3 = crdtOp('u3', 7, DEV_A, 'RVZFTjM=');

    const baseline = replay([u1, u2, u3]).report.crdtUpdates;
    expect(replay([u1, u1, u2, u3, u2]).report.crdtUpdates).toEqual(baseline);
    for (let round = 0; round < 20; round += 1) {
      const shuffled = shuffle([u1, u2, u3], mulberry32(0x3000 + round));
      expect(replay(shuffled).report.crdtUpdates).toEqual(baseline);
    }
    expect(baseline.map((entry) => entry.opId)).toEqual(['u1', 'u2', 'u3']);
  });

  it('不与 lww op 抢占同一实体的 lamport 判定', () => {
    const seed = makeOp({
      id: 'seed',
      c: 5,
      d: DEV_A,
      table: 'page',
      entityId: PAGE1,
      kind: 'upsert',
      payload: { title: 'p', alive: 1 },
    });
    const crdt = crdtOp('u9', 9, DEV_B, 'RVZFTjk=');
    const patch = makeOp({
      id: 'p1',
      c: 5,
      d: DEV_B,
      table: 'page',
      entityId: PAGE1,
      kind: 'patch',
      payload: { title: 'p2' },
    });

    // crdt_update 虽然全序更大（c=9），但不推进实体 lamport：
    // 同 c 的 patch (5,B) 仍按全序胜过 (5,A) 生效，投影与「没有 crdt_update 时」逐字节一致。
    const withCrdt = replay([seed, crdt, patch]);
    const withoutCrdt = replay([seed, patch]);
    expect(opsToSnapshot(withCrdt.projection)).toBe(opsToSnapshot(withoutCrdt.projection));
    expect(withCrdt.projection.get('page', PAGE1)?.data['title']).toBe('p2');
    expect(withCrdt.report.crdtUpdates).toHaveLength(1);
  });
});

describe('v1 段兼容回归（SCHEMA_VERSION 1→2 后照常可读）', () => {
  // 手写的 v1 JSONL 夹具：键序按 stableStringify 规则（对象键升序），schema_ver=1
  const V1_SEGMENT = [
    '{"h":{"c_from":1,"c_to":2,"created_at":1700000000000,"dev":"aaaa0001","n":2,"schema_ver":1,"seg_id":"seg-00000001-aaaa0001-000002"}}',
    '{"actor":"aaaa0001","at":1700000000000,"kind":"upsert","lamport":{"c":1,"d":"aaaa0001"},"op_id":"v1-op-1","payload":{"alive":1,"cell-a":"A1","cell-b":"B1"},"target":{"id":"rec0000001","table":"record"}}',
    '{"actor":"aaaa0001","at":1700000000000,"kind":"patch","lamport":{"c":2,"d":"aaaa0001"},"merge_policy":"lww","op_id":"v1-op-2","payload":{"cell-b":"B2"},"target":{"id":"rec0000001","table":"record"}}',
    '',
  ].join('\n');

  it('v1 段 decode/encode/validate 与升级前逐字节等价，投影逐字段相等', () => {
    const seg = decodeSegment(V1_SEGMENT);
    expect(seg.schema_ver).toBe(1);
    expect(validateSegment(seg)).toEqual([]);
    expect(encodeSegment(seg)).toBe(V1_SEGMENT); // 字节级 roundtrip

    const { projection, report } = replay(seg.ops);
    expect(report.conflicts).toEqual([]);
    expect(projection.get('record', 'rec0000001')).toEqual({
      table: 'record',
      id: 'rec0000001',
      version: 2,
      alive: 1,
      data: { alive: 1, 'cell-a': 'A1', 'cell-b': 'B2' },
      lamport: { c: 2, d: 'aaaa0001' },
    });
  });

  it('schema_ver 高于当前版本仍被拒绝（未来段走 quarantine，不由 core 放行）', () => {
    const seg = decodeSegment(V1_SEGMENT);
    const tampered = { ...seg, schema_ver: SCHEMA_VERSION + 1 };
    expect(() => encodeSegment(tampered)).toThrow(SegmentValidationError);
    expect(validateSegment(tampered).join(' ')).toMatch(/schema_ver/);
  });

  it('v1 快照照旧可读（实体外形只增不改），MIN_SUPPORTED_SCHEMA_VERSION=1', () => {
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe(1);
    const v1Snapshot = JSON.stringify({
      v: 1,
      entities: [
        {
          table: 'record',
          id: 'rec0000001',
          version: 2,
          alive: 1,
          data: { alive: 1, 'cell-a': 'A1', 'cell-b': 'B2' },
          lamport: { c: 2, d: 'aaaa0001' },
        },
      ],
    });
    // v=1 的快照在 SCHEMA_VERSION=2 下照常播种回放，实体逐字段相等
    const { projection } = replay(snapshotToOps(v1Snapshot, DEV_A));
    expect(projection.get('record', 'rec0000001')).toEqual({
      table: 'record',
      id: 'rec0000001',
      version: 2,
      alive: 1,
      data: { alive: 1, 'cell-a': 'A1', 'cell-b': 'B2' },
      lamport: { c: 2, d: 'aaaa0001' },
    });
  });
});
