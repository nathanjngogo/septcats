import { describe, expect, it } from 'vitest';
import {
  Projection,
  SCHEMA_VERSION,
  SnapshotValidationError,
  opsToSnapshot,
  replay,
  snapshotToOps,
  type Op,
} from '../src/index';
import { DEV_A, DEV_B, DEV_C, makeOp, mulberry32, shuffle } from './helpers';

const ENT1 = 'ent0000001';
const ENT2 = 'ent0000002';
const ENT3 = 'ent0000003';

/** 一小组覆盖全部 kind、含同 c 不同 d 的确定性事件。 */
function demoOps(): Op[] {
  return [
    makeOp({ id: 'd1', c: 1, d: DEV_A, entityId: ENT1, kind: 'upsert', payload: { title: 'a', alive: 1 } }),
    makeOp({ id: 'd2', c: 2, d: DEV_B, entityId: ENT1, kind: 'patch', payload: { title: 'b' } }),
    makeOp({ id: 'd3', c: 3, d: DEV_A, entityId: ENT2, kind: 'upsert', payload: { title: 'c', alive: 1 } }),
    makeOp({ id: 'd4', c: 4, d: DEV_C, entityId: ENT1, kind: 'delete', payload: {} }),
    makeOp({ id: 'd5', c: 5, d: DEV_B, entityId: ENT2, kind: 'move', payload: { parent: 'page-1' } }),
    makeOp({ id: 'd6', c: 6, d: DEV_A, entityId: ENT3, kind: 'reorder', payload: { sort_key: 'A00000001' } }),
    makeOp({ id: 'd7', c: 2, d: DEV_C, entityId: ENT2, kind: 'patch', payload: { title: 'c2' } }),
  ];
}

describe('replay', () => {
  it('projection 基本读写', () => {
    const projection = new Projection();
    expect(projection.size).toBe(0);
    expect(projection.get('page', 'nope')).toBeNull();

    const { projection: filled } = replay([
      makeOp({ id: 'p1', c: 1, d: DEV_A, table: 'page', entityId: 'page-1', payload: { title: 'p' } }),
      makeOp({ id: 'b1', c: 1, d: DEV_A, table: 'block', entityId: 'block-1', payload: { title: 'b' } }),
    ]);

    expect(filled.size).toBe(2);
    expect(filled.all('page')).toHaveLength(1);
    expect(filled.all('block')).toHaveLength(1);
    expect(filled.entities().map((entity) => entity.table)).toEqual(['block', 'page']);
    expect(filled.has('page', 'page-1')).toBe(true);

    // 返回的是拷贝，外部改动不影响内部
    const fetched = filled.get('page', 'page-1');
    if (fetched !== null) {
      fetched.data['title'] = 'mutated';
    }
    expect(filled.get('page', 'page-1')?.data['title']).toBe('p');

    const cloned = filled.clone();
    expect(cloned.size).toBe(filled.size);
    expect(opsToSnapshot(cloned)).toBe(opsToSnapshot(filled));
  });

  it('同集 ops 任意输入顺序重放结果全等', () => {
    const ops = demoOps();
    const baseline = opsToSnapshot(replay(ops).projection);

    for (let round = 0; round < 100; round += 1) {
      const rng = mulberry32(0x1000 + round);
      const shuffled = shuffle(ops, rng);
      const { projection } = replay(shuffled);
      expect(opsToSnapshot(projection)).toBe(baseline);
    }
  });

  it('双写同实体 → 高 lamport 胜出且 report 记录 lost', () => {
    // “双写”= 两台设备在同一逻辑时间（c 相同、d 不同）并发写同一实体，
    // 胜负由 compareLamport 决定：c 相同则 d 大者胜（DEV_B > DEV_A）。
    const lower = makeOp({ id: 'low', c: 5, d: DEV_A, entityId: ENT1, payload: { title: 'low', alive: 1 } });
    const higher = makeOp({ id: 'high', c: 5, d: DEV_B, entityId: ENT1, payload: { title: 'high', alive: 1 } });

    const forward = replay([lower, higher]);
    const backward = replay([higher, lower]);

    expect(forward.projection.get('block', ENT1)?.data['title']).toBe('high');
    expect(forward.projection.get('block', ENT1)?.lamport).toEqual({ c: 5, d: DEV_B });
    expect(forward.projection.get('block', ENT1)?.version).toBe(5);

    expect(forward.report.conflicts).toHaveLength(1);
    expect(forward.report.conflicts[0]).toEqual({
      table: 'block',
      id: ENT1,
      kept: { c: 5, d: DEV_B },
      lost: { c: 5, d: DEV_A },
    });

    // 输入顺序不影响结果，冲突集一致
    expect(opsToSnapshot(backward.projection)).toBe(opsToSnapshot(forward.projection));
    expect(backward.report.conflicts).toEqual(forward.report.conflicts);
  });

  it('delete 后 upsert 更低版本被忽略', () => {
    const del = makeOp({ id: 'del', c: 5, d: DEV_A, entityId: ENT1, kind: 'delete', payload: {} });
    const seeded = replay([del]).projection;
    expect(seeded.get('block', ENT1)?.alive).toBe(0);

    // 迟到的低版本 upsert 不得复活实体
    const lower = makeOp({ id: 'lower', c: 3, d: DEV_B, entityId: ENT1, payload: { title: 'zombie', alive: 1 } });
    const { projection, report } = replay([lower], seeded);

    expect(projection.get('block', ENT1)?.alive).toBe(0);
    expect(projection.get('block', ENT1)?.data['title']).toBeUndefined();
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.kept).toEqual({ c: 5, d: DEV_A });
    expect(report.conflicts[0]?.lost).toEqual({ c: 3, d: DEV_B });

    // 但更高版本可以复活（delete 不是永久墓碑）
    const revive = makeOp({ id: 'revive', c: 9, d: DEV_B, entityId: ENT1, payload: { title: 'revived', alive: 1 } });
    const revived = replay([revive], projection);
    expect(revived.projection.get('block', ENT1)?.alive).toBe(1);
    expect(revived.projection.get('block', ENT1)?.data['title']).toBe('revived');
    expect(revived.report.conflicts).toHaveLength(0);
  });

  it('snapshot→ops→replay == 原投影', () => {
    const { projection } = replay(demoOps());
    const snap = opsToSnapshot(projection);

    const seedOps = snapshotToOps(snap, DEV_C);
    expect(seedOps.length).toBe(projection.size);
    expect(seedOps.every((op) => op.kind === 'upsert')).toBe(true);

    const restored = replay(seedOps).projection;
    expect(opsToSnapshot(restored)).toBe(snap);

    // 显式抬高时钟起点：状态不变（结果快照除 lamport 外一致）
    const shifted = snapshotToOps(snap, DEV_C, 1_000_000);
    const maxShifted = Math.max(...shifted.map((op) => op.lamport.c));
    expect(maxShifted).toBe(1_000_000);
    const restoredShifted = replay(shifted).projection;
    const originalEntities = projection.entities();
    const shiftedEntities = restoredShifted.entities();
    expect(shiftedEntities).toHaveLength(originalEntities.length);
    for (let i = 0; i < originalEntities.length; i += 1) {
      expect(shiftedEntities[i]?.id).toBe(originalEntities[i]?.id);
      expect(shiftedEntities[i]?.alive).toBe(originalEntities[i]?.alive);
      expect(shiftedEntities[i]?.data).toEqual(originalEntities[i]?.data);
    }
  });

  it('空 ops 重放得到空投影', () => {
    const { projection, report } = replay([]);
    expect(projection.size).toBe(0);
    expect(report.conflicts).toEqual([]);
    // T23-01：快照 v 随 SCHEMA_VERSION 2→3（字节钉随版本前进）
    expect(opsToSnapshot(projection)).toBe('{"entities":[],"v":3}');
  });

  it('快照非法输入被拒绝', () => {
    expect(() => snapshotToOps('not-json', DEV_C)).toThrow(SnapshotValidationError);
    expect(() =>
      snapshotToOps(JSON.stringify({ v: SCHEMA_VERSION + 1, entities: [] }), DEV_C),
    ).toThrow(SnapshotValidationError);
    expect(() =>
      snapshotToOps(JSON.stringify({ v: SCHEMA_VERSION, entities: [{ table: 'nope' }] }), DEV_C),
    ).toThrow(SnapshotValidationError);
    expect(() =>
      snapshotToOps(
        JSON.stringify({ v: SCHEMA_VERSION, entities: [{ table: 'block', id: 'x' }] }),
        DEV_C,
      ),
    ).toThrow(SnapshotValidationError);
  });
});
