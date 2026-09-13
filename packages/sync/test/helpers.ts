import { ulid, type ActorId, type Op } from '@septcats/core';

/** 合法 ActorId（8-32 位 [a-z0-9]）。 */
export const DEV_A: ActorId = 'aaaa0001';
export const DEV_B: ActorId = 'bbbb0002';

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
