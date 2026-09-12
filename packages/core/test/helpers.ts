import {
  ulid,
  type ActorId,
  type Op,
  type OpKind,
  type TargetTable,
} from '../src/index';

/** 合法 ActorId（8-32 位 [a-z0-9]）。 */
export const DEV_A: ActorId = 'aaaa0001';
export const DEV_B: ActorId = 'bbbb0002';
export const DEV_C: ActorId = 'cccc0003';

export interface MakeOpOptions {
  c: number;
  d: ActorId;
  id?: string;
  table?: TargetTable;
  entityId?: string;
  kind?: OpKind;
  payload?: Record<string, unknown>;
  at?: number;
  base?: number;
  mergePolicy?: 'lww';
}

let opCounter = 0;

/** 构造一条合法 Op。op_id 默认含 ULID（全局唯一）；需要确定性时传 id。 */
export function makeOp(options: MakeOpOptions): Op {
  opCounter += 1;
  const op: Op = {
    op_id: options.id ?? `op-${String(opCounter).padStart(6, '0')}-${ulid()}`,
    lamport: { c: options.c, d: options.d },
    at: options.at ?? 1_700_000_000_000,
    actor: options.d,
    target: { table: options.table ?? 'block', id: options.entityId ?? 'ent0001' },
    kind: options.kind ?? 'upsert',
    payload: options.payload ?? {},
  };
  if (options.base !== undefined) {
    op.base = options.base;
  }
  if (options.mergePolicy !== undefined) {
    op.merge_policy = options.mergePolicy;
  }
  return op;
}

/** 确定性伪随机数发生器（mulberry32），避免测试随机抖动。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌（不改动入参）。 */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) {
      continue;
    }
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** 从非空数组里确定性取一个元素。 */
export function pick<T>(items: readonly T[], rng: () => number): T {
  const index = Math.min(Math.floor(rng() * items.length), items.length - 1);
  const value = items[index];
  if (value === undefined) {
    throw new Error('pick：空数组不可 pick');
  }
  return value;
}
