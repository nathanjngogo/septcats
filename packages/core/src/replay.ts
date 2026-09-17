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

/**
 * crdt_update 的收集条目：core 不解码 updateB64（base64 文本对 core 不透明），
 * 仅按全序去重收集，交由上层（T19-04 的 merger → Y.Doc）幂等应用。
 * 字段命名说明见 docs/tasks/TASK-T19-02-report.md §crdtUpdates：
 * - opId：来源 op 的 op_id（去重键，审计可回溯到 op_ledger）；
 * - target：op 的目标引用（crdt_update 固定 target=page）；
 * - pageId：payload 声明的页级 Y.Doc 键（正常与 target.id 相等，分派时以后者兜底）；
 * - updateB64 / svFromB64：原样透传的 base64 增量与可选状态向量水位。
 */
export interface CrdtUpdateEntry {
  opId: string;
  target: { table: TargetTable; id: EntityId };
  pageId: string;
  updateB64: string;
  svFromB64?: string;
}

export interface ReplayReport {
  conflicts: ReplayConflict[];
  /** merge_policy='crdt' 的 op 收集结果（不参与 LWW、不作用于实体投影）。 */
  crdtUpdates: CrdtUpdateEntry[];
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
    case 'crdt_update': {
      // replay 主循环在分派层已把 crdt_update 收集走（不进实体投影），此处不可达；
      // 保留分支仅为 op.kind 穷尽性。
      throw new Error(`replay：crdt_update 不参与实体投影（op_id=${op.op_id} 应由分派层收集）`);
    }
    default: {
      // opKindSchema 已穷尽；此处仅作类型收敛
      const exhaustive: never = op.kind;
      throw new Error(`replay：不支持的 op.kind ${String(exhaustive)}`);
    }
  }
}

/**
 * merge_policy='lww-field'（字段级 key 粒度 LWW）的按键合并：
 * - payload 是只携带变更 key 的 patch 对象；出现的 key 覆盖，未出现的 key 保留原值；
 * - `null` = 删除该 key（不是置 JSON null）；
 * - 同 key 并发按既有全序（lamport, deviceId）决胜：按键时钟（Projection 内部状态）
 *   记录每个 key 最后生效的 lamport，仅当 op.lamport 大于该 key 的时钟才生效——
 *   因此跨批次增量 replay 与单批全量 replay 结果一致（收敛性不依赖分批方式）；
 * - lww-field 不做实体级 LWW 门槛判定：k1/k2 并发互不蒸发，胜负只发生在同 key 上；
 * - 实体 lamport 取 max(旧值, op.lamport)（保持单调），无 key 生效时不产生任何变化（幂等）。
 */
function applyLwwField(op: Op, projection: Projection): void {
  const { table, id } = op.target;
  const existing = projection.get(table, id);

  const winning: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(op.payload)) {
    const clock = projection.getFieldClock(table, id, key);
    if (clock !== null && compareLamport(op.lamport, clock) <= 0) {
      continue; // 该 key 已有全序更大的写入，本 op 在此 key 上落败
    }
    winning.push([key, value]);
  }
  if (winning.length === 0) {
    return; // 无任何 key 生效：不建实体、不动 lamport（重复重放幂等）
  }

  const data: Record<string, unknown> = existing === null ? {} : deepCloneData(existing.data);
  for (const [key, value] of winning) {
    if (value === null) {
      delete data[key];
    } else {
      data[key] = deepCloneData(value);
    }
    projection.setFieldClock(table, id, key, { c: op.lamport.c, d: op.lamport.d });
  }
  const alive = aliveOf(data, existing === null ? 1 : existing.alive);
  const lamport =
    existing !== null && compareLamport(existing.lamport, op.lamport) > 0
      ? { c: existing.lamport.c, d: existing.lamport.d }
      : { c: op.lamport.c, d: op.lamport.d };
  projection.set({ table, id, version: lamport.c, alive, data, lamport });
}

/**
 * lww 族 op（upsert/delete/patch/move/reorder）胜出生效后，同步推进字段级时钟：
 * - patch/move/reorder/delete：payload 里出现的 key 盖章为 op.lamport（未触碰的 key
 *   保留原时钟，per-key 语义不被整体写抹掉）；
 * - upsert：整体替换语义 = 所有 key（payload 键 ∪ 旧 data 键 ∪ 已有时钟键）都
 *   盖章为 op.lamport——此后更旧全序的 lww-field 写不得复活任何被移除/覆盖的 key，
 *   与实体级 LWW 的判定保持一致。
 */
function stampFieldClocks(op: Op, previous: Entity | null, projection: Projection): void {
  const { table, id } = op.target;
  let keys: Iterable<string> = Object.keys(op.payload);
  if (op.kind === 'upsert') {
    const union = new Set<string>(Object.keys(op.payload));
    if (previous !== null) {
      for (const key of Object.keys(previous.data)) {
        union.add(key);
      }
    }
    for (const key of projection.fieldClockKeys(table, id)) {
      union.add(key);
    }
    keys = union;
  }
  for (const key of keys) {
    projection.setFieldClock(table, id, key, { c: op.lamport.c, d: op.lamport.d });
  }
}

/**
 * 收集 merge_policy='crdt' 的 op（crdt_update）：不进 LWW、不碰实体投影。
 * - 去重键为 op_id：同一条 update 重复出现只收集一次；
 * - 收集顺序 = replay 的全序（lamport, deviceId, op_id 升序），与输入顺序无关；
 * - updateB64 缺失或非字符串的畸形 payload 不收集（无可路由内容；encodeOp/decodeOp
 *   已在编解码边界用 crdtUpdatePayloadSchema 拒绝此类行，此处仅为防御）。
 */
function collectCrdtUpdate(op: Op, report: ReplayReport, seen: Set<string>): void {
  if (seen.has(op.op_id)) {
    return;
  }
  const updateB64 = op.payload['updateB64'];
  if (typeof updateB64 !== 'string') {
    return;
  }
  seen.add(op.op_id);
  const pageId = op.payload['pageId'];
  const svFromB64 = op.payload['svFromB64'];
  const entry: CrdtUpdateEntry = {
    opId: op.op_id,
    target: { table: op.target.table, id: op.target.id },
    pageId: typeof pageId === 'string' ? pageId : op.target.id,
    updateB64,
  };
  if (typeof svFromB64 === 'string') {
    entry.svFromB64 = svFromB64;
  }
  report.crdtUpdates.push(entry);
}

/**
 * 重放事件到投影。
 *
 * 语义（任务书 §3 + T19-02 §0）：
 * - 按 lamport 升序应用（compareLamport 全序，同 lamport 时按 op_id 稳定决胜）；
 * - merge_policy 分派（缺省 'lww'）：
 *   - `lww`：upsert / patch / move / reorder / delete 仅当 op.lamport > entity.lamport
 *     才生效，否则记 conflict；delete 等价于 upsert({alive:0})，同样服从 LWW（现状不变）；
 *   - `lww-field`：按键合并（见 applyLwwField），不做实体级门槛；
 *   - `crdt`：收集不投影（见 collectCrdtUpdate），绝不参与 LWW 判定、不推进实体 lamport；
 * - 结果与输入顺序无关（收敛性），因此可随机打乱输入。
 *
 * @param ops 待重放事件（不要求有序，内部会排序）
 * @param into 可选：在既有投影上增量重放
 */
export function replay(ops: readonly Op[], into?: Projection): { projection: Projection; report: ReplayReport } {
  const projection = into ?? new Projection();
  const report: ReplayReport = { conflicts: [], crdtUpdates: [] };
  const sorted = [...ops].sort(compareOpLamport);
  const seenCrdt = new Set<string>();

  for (const op of sorted) {
    if (op.kind === 'crdt_update' || op.merge_policy === 'crdt') {
      collectCrdtUpdate(op, report, seenCrdt);
      continue;
    }
    if (op.merge_policy === 'lww-field') {
      applyLwwField(op, projection);
      continue;
    }

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
    stampFieldClocks(op, existing, projection);
  }

  return { projection, report };
}
