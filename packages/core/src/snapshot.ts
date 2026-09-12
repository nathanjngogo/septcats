import { z } from 'zod';
import {
  SCHEMA_VERSION,
  entitySchema,
  formatZodError,
  stableStringify,
  type ActorId,
  type Op,
} from './op';
import { deepCloneData, type Projection } from './projection';
import { ulid } from './util/ulid';

/**
 * 快照层：把物化投影压成一个可长期保存的 JSON（`{v, entities:[...]}`），
 * 用于（a）压缩历史段、（b）给新设备播种。
 * 采用键序稳定序列化，保证“同内容同字节”。
 */

/** 快照结构校验失败时抛出。 */
export class SnapshotValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.length > 0 ? `非法快照：${issues.join('；')}` : '非法快照');
    this.name = 'SnapshotValidationError';
    this.issues = issues;
    Object.setPrototypeOf(this, SnapshotValidationError.prototype);
  }
}

export const snapshotSchema = z.object({
  v: z.number().int().min(1),
  entities: z.array(entitySchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

/** 把投影序列化为稳定键序的快照 JSON。 */
export function opsToSnapshot(projection: Projection): string {
  const entities = projection.entities().map((entity) => ({
    table: entity.table,
    id: entity.id,
    version: entity.version,
    alive: entity.alive,
    data: entity.data,
    lamport: { c: entity.lamport.c, d: entity.lamport.d },
  }));
  return stableStringify({ v: SCHEMA_VERSION, entities });
}

/**
 * 把快照回转为一组 upsert Op，供新设备播种后重放。
 *
 * 语义：
 * - 保留每个实体的原始 lamport（c 与 d），因此 `snapshot -> ops -> replay`
 *   在默认参数下与原投影**逐字段相等**（含 version 与 lamport）；
 * - `actor` 记为接收方 deviceId（播种动作的执行者）；
 * - 若显式给出 startC 且其高于快照内最大 c，则所有 lamport.c 整体抬升
 *   `startC - maxC`，让播种设备的时钟起点不低于 startC（状态不变，胜负关系不变）。
 */
export function snapshotToOps(snap: string, deviceId: ActorId, startC?: number): Op[] {
  let raw: unknown;
  try {
    raw = JSON.parse(snap);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SnapshotValidationError([`不是合法 JSON：${reason}`]);
  }

  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SnapshotValidationError(formatZodError(parsed.error));
  }
  const { v, entities } = parsed.data;
  if (v !== SCHEMA_VERSION) {
    throw new SnapshotValidationError([`快照 v=${v} 与当前 SCHEMA_VERSION=${SCHEMA_VERSION} 不符`]);
  }

  let maxC = 0;
  for (const entity of entities) {
    maxC = Math.max(maxC, entity.lamport.c);
  }
  const shift = startC === undefined ? 0 : Math.max(0, Math.trunc(startC) - maxC);
  const at = Date.now();

  return entities.map((entity) => {
    const payload = deepCloneData(entity.data);
    if (entity.alive === 0) {
      // 保证软删除状态能穿过重放（重放对 upsert 默认 alive=1）
      payload['alive'] = 0;
    }
    return {
      op_id: ulid(),
      lamport: { c: entity.lamport.c + shift, d: entity.lamport.d },
      at,
      actor: deviceId,
      target: { table: entity.table, id: entity.id },
      kind: 'upsert' as const,
      payload,
    };
  });
}
