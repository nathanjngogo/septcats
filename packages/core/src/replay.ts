import { compareLamport } from './clock';
import { compareOpLamport, type EntityId, type Lamport, type Op, type TargetTable } from './op';
import { Projection, deepCloneData, type Entity } from './projection';

/** 冲突记录：同一实体上被 LWW 淘汰的版本（作为“冲突副本”素材保留，绝不静默丢弃）。 */
export interface ReplayConflict {
  table: TargetTable;
  id: EntityId;
  kept: Lamport;
  lost: Lamport;
}

export interface ReplayReport {
  conflicts: ReplayConflict[];
}

function aliveOf(data: Record<string, unknown>, fallback: number): number {
  const value = data['alive'];
  if (value === 0 || value === 1) {
    return value;
  }
  if (value === false) {
    return 0;
  }
  if (value === true) {
    return 1;
  }
  return fallback;
}

function makeEntity(op: Op, data: Record<string, unknown>, alive: number): Entity {
  return {
    table: op.target.table,
    id: op.target.id,
    version: op.lamport.c,
    alive,
    data,
    lamport: { c: op.lamport.c, d: op.lamport.d },
  };
}

/** 按 op 语义把一条事件物化成实体（existing 为当前投影中的旧行，可为 null）。 */
function materialize(op: Op, existing: Entity | null): Entity {
  const baseData: Record<string, unknown> = existing === null ? {} : deepCloneData(existing.data);
  const payload = deepCloneData(op.payload);

  switch (op.kind) {
    case 'upsert': {
      return makeEntity(op, payload, aliveOf(payload, 1));
    }
    case 'delete': {
      const data: Record<string, unknown> = { ...baseData, ...payload, alive: 0 };
      return makeEntity(op, data, 0);
    }
    case 'patch':
    case 'move':
    case 'reorder': {
      const data: Record<string, unknown> = { ...baseData, ...payload };
      const fallback = existing === null ? 1 : existing.alive;
      return makeEntity(op, data, aliveOf(data, fallback));
    }
    default: {
      // opKindSchema 已穷尽；此处仅作类型收敛
      const exhaustive: never = op.kind;
      throw new Error(`replay：不支持的 op.kind ${String(exhaustive)}`);
    }
  }
}

/**
 * 重放事件到投影。
 *
 * 语义（任务书 §3）：
 * - 按 lamport 升序应用（compareLamport 全序，同 lamport 时按 op_id 稳定决胜）；
 * - upsert / patch / move / reorder：仅当 op.lamport > entity.lamport 才生效，否则记 conflict；
 * - delete 等价于 upsert({alive:0})，同样服从 LWW；
 * - 结果与输入顺序无关（收敛性），因此可随机打乱输入。
 *
 * @param ops 待重放事件（不要求有序，内部会排序）
 * @param into 可选：在既有投影上增量重放
 */
export function replay(ops: readonly Op[], into?: Projection): { projection: Projection; report: ReplayReport } {
  const projection = into ?? new Projection();
  const report: ReplayReport = { conflicts: [] };
  const sorted = [...ops].sort(compareOpLamport);

  for (const op of sorted) {
    const existing = projection.get(op.target.table, op.target.id);
    if (existing !== null && compareLamport(op.lamport, existing.lamport) <= 0) {
      report.conflicts.push({
        table: op.target.table,
        id: op.target.id,
        kept: { c: existing.lamport.c, d: existing.lamport.d },
        lost: { c: op.lamport.c, d: op.lamport.d },
      });
      continue;
    }
    // 覆盖冲突（计划书 §3.4 D3）：只有两条写入**并发**（同一逻辑时间 c、不同设备）时，
    // 被覆盖的版本才是真正的“冲突副本”，需要记入 report 作为素材；
    // 严格更晚的写入（c 更大）属于因果有序的正常覆盖，不是冲突。
    if (existing !== null && existing.lamport.c === op.lamport.c) {
      report.conflicts.push({
        table: op.target.table,
        id: op.target.id,
        kept: { c: op.lamport.c, d: op.lamport.d },
        lost: { c: existing.lamport.c, d: existing.lamport.d },
      });
    }
    projection.set(materialize(op, existing));
  }

  return { projection, report };
}
