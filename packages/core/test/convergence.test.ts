import { describe, expect, it } from 'vitest';
import {
  LamportClock,
  opsToSnapshot,
  replay,
  ulid,
  type Op,
  type OpKind,
} from '../src/index';
import { mulberry32, pick, shuffle } from './helpers';

/**
 * 收敛性红线（M3 验收的数学前提）：
 * 任意输入顺序重放同一事件集合，结果必须逐字节一致。
 * 这里用 200 个设备 × 50 条交织事件做 fuzz；若时长超预算可降到 50×50，但不许删测试。
 */
const DEVICE_COUNT = 200;
const OPS_PER_DEVICE = 50;
const ENTITY_COUNT = 40;

const KINDS: readonly OpKind[] = ['upsert', 'patch', 'delete', 'move', 'reorder'];

function deviceIdOf(index: number): string {
  return `device${String(index).padStart(3, '0')}`; // 9 位 [a-z0-9]
}

function entityIdOf(index: number): string {
  return `ent${String(index).padStart(4, '0')}`;
}

function buildPayload(rng: () => number, kind: OpKind): Record<string, unknown> {
  const n = Math.floor(rng() * 1000);
  switch (kind) {
    case 'upsert':
      return { title: `t-${n}`, alive: 1 };
    case 'patch':
      return { title: `p-${n}` };
    case 'move':
      return { parent: entityIdOf(Math.floor(rng() * ENTITY_COUNT)) };
    case 'reorder':
      return { sort_key: `A${String(n).padStart(8, '0')}` };
    case 'delete':
      return {};
    default: {
      const exhaustive: never = kind;
      throw new Error(`未覆盖的 kind：${String(exhaustive)}`);
    }
  }
}

/** 生成多设备交织的事件流（每设备独立时钟，故 lamport.c 会跨设备重叠）。 */
function generateInterleavedOps(seed: number): Op[] {
  const rng = mulberry32(seed);
  const ops: Op[] = [];

  for (let d = 0; d < DEVICE_COUNT; d += 1) {
    const device = deviceIdOf(d);
    const clock = new LamportClock(device, Math.floor(rng() * 20) + (d % 7));
    for (let k = 0; k < OPS_PER_DEVICE; k += 1) {
      const lamport = clock.tick();
      const kind = pick(KINDS, rng);
      const entityIndex = Math.floor(rng() * ENTITY_COUNT);
      ops.push({
        op_id: ulid(),
        lamport,
        at: 1_700_000_000_000 + d * 1000 + k,
        actor: device,
        target: { table: 'block', id: entityIdOf(entityIndex) },
        kind,
        payload: buildPayload(rng, kind),
      });
    }
  }

  return ops;
}

describe('convergence (fuzz)', () => {
  it('同集 ops 任意输入顺序重放结果全等（200×50 交织）', () => {
    const ops = generateInterleavedOps(0xc0ffee);
    expect(ops).toHaveLength(DEVICE_COUNT * OPS_PER_DEVICE);

    const baseline = opsToSnapshot(replay(ops).projection);

    // 三种乱序（含一个逆序）必须与基线逐字节相等
    for (const seed of [1, 7, 42]) {
      const shuffled = shuffle(ops, mulberry32(seed));
      const { projection } = replay(shuffled);
      expect(opsToSnapshot(projection)).toBe(baseline);
    }
    expect(opsToSnapshot(replay([...ops].reverse()).projection)).toBe(baseline);

    // 实体数量不超过理论上限
    const entities = replay(ops).projection.entities();
    expect(entities.length).toBeLessThanOrEqual(ENTITY_COUNT);
    expect(entities.length).toBeGreaterThan(0);
  }, 30_000);

  it('重复重放幂等（不会二次生效）', () => {
    const ops = generateInterleavedOps(0xbeef).slice(0, 500);
    const first = replay(ops);
    const snapshot = opsToSnapshot(first.projection);

    const second = replay(ops, first.projection);
    expect(opsToSnapshot(second.projection)).toBe(snapshot);
    // 已到达终态后，每条旧事件都不再满足 op.lamport > entity.lamport
    expect(second.report.conflicts).toHaveLength(ops.length);
  }, 30_000);
});
