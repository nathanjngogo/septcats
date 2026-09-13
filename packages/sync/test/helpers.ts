import { SCHEMA_VERSION, ulid, type ActorId, type Op } from '@septcats/core';
import type { Manifest } from '../src/manifest';

/** 合法 ActorId（8-32 位 [a-z0-9]）。 */
export const DEV_A: ActorId = 'aaaa0001';
export const DEV_B: ActorId = 'bbbb0002';
export const DEV_C: ActorId = 'cccc0003';
export const DEV_D: ActorId = 'dddd0004';

export interface MakeOpOptions {
  c: number;
  d: ActorId;
  id?: string;
  entityId?: string;
  kind?: Op['kind'];
  payload?: Record<string, unknown>;
  at?: number;
}

let opCounter = 0;

/** 构造一条合法 Op。op_id 默认含 ULID（全局唯一）；需要确定性时传 id。 */
export function makeOp(options: MakeOpOptions): Op {
  opCounter += 1;
  return {
    op_id: options.id ?? `op-${String(opCounter).padStart(6, '0')}-${ulid()}`,
    lamport: { c: options.c, d: options.d },
    at: options.at ?? 1_700_000_000_000,
    actor: options.d,
    target: { table: 'block', id: options.entityId ?? 'ent0001' },
    kind: options.kind ?? 'upsert',
    payload: options.payload ?? {},
  };
}

/** 构造一份可用的 Manifest（测试用，默认单设备 DEV_A，水位 41）。 */
export function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  const base: Manifest = {
    schema_ver: SCHEMA_VERSION,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_100_000,
    devices: {
      [DEV_A]: { last_lamport: 41, last_seen_at: 1_700_000_100_000, client_ver: '0.1.0' },
    },
    snapshot: { seq: 0, lamport: 0, covers_through: 0 },
    retention_days: 30,
    segment_watermark: 41,
  };
  return { ...base, ...overrides };
}
