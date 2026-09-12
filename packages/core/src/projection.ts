import type { EntityId, Lamport, TargetTable } from './op';

/**
 * 物化视图中的一行实体（与 SQLite 物化层同形）。
 * `alive` 为软删除标记（1 存活 / 0 已删），`version` 取最后生效 op 的 lamport.c。
 */
export interface Entity {
  table: TargetTable;
  id: EntityId;
  version: number;
  alive: number;
  data: Record<string, unknown>;
  lamport: Lamport;
}

/** JSON 语义的深拷贝：丢弃 undefined 键，与 stableStringify 行为一致。 */
export function deepCloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const KEY_SEPARATOR = '\u0000';

/** 实体在投影内的唯一键：表 + 实体 ID。 */
export function entityKey(table: TargetTable, id: EntityId): string {
  return `${table}${KEY_SEPARATOR}${id}`;
}

function cloneEntity(entity: Entity): Entity {
  return {
    table: entity.table,
    id: entity.id,
    version: entity.version,
    alive: entity.alive,
    data: deepCloneData(entity.data),
    lamport: { c: entity.lamport.c, d: entity.lamport.d },
  };
}

function compareEntity(a: Entity, b: Entity): number {
  if (a.table !== b.table) {
    return a.table < b.table ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * 纯内存投影：以 Map 存放实体，读写均做深拷贝，避免调用方意外共享引用。
 * 查询方法返回稳定排序（表名 + 实体 ID 升序），便于逐字节比较收敛性。
 */
export class Projection {
  private readonly entries: Map<string, Entity>;

  constructor(entities?: readonly Entity[]) {
    this.entries = new Map();
    if (entities !== undefined) {
      for (const entity of entities) {
        this.entries.set(entityKey(entity.table, entity.id), cloneEntity(entity));
      }
    }
  }

  get(table: TargetTable, id: EntityId): Entity | null {
    const found = this.entries.get(entityKey(table, id));
    return found === undefined ? null : cloneEntity(found);
  }

  all(table: TargetTable): Entity[] {
    const out: Entity[] = [];
    for (const entity of this.entries.values()) {
      if (entity.table === table) {
        out.push(cloneEntity(entity));
      }
    }
    out.sort(compareEntity);
    return out;
  }

  entities(): Entity[] {
    const out: Entity[] = [];
    for (const entity of this.entries.values()) {
      out.push(cloneEntity(entity));
    }
    out.sort(compareEntity);
    return out;
  }

  has(table: TargetTable, id: EntityId): boolean {
    return this.entries.has(entityKey(table, id));
  }

  /** 写入/覆盖一行（内部同样深拷贝）。 */
  set(entity: Entity): void {
    this.entries.set(entityKey(entity.table, entity.id), cloneEntity(entity));
  }

  delete(table: TargetTable, id: EntityId): boolean {
    return this.entries.delete(entityKey(table, id));
  }

  get size(): number {
    return this.entries.size;
  }

  /** 深拷贝整个投影（用于对比基线、分支重放等）。 */
  clone(): Projection {
    return new Projection(this.entities());
  }
}
