/**
 * SQL 语句白名单（TASK-T2-01 §3）。
 *
 * **安全红线**：DbServer 只接受这里的 `sqlId`，绝不接受任意 SQL 字符串，
 * 因此即使渲染器被注入也无法让数据库执行计划外语句。
 *
 * 每条语句声明：
 * - `sql`：带 `@name` 命名占位符的 SQL；
 * - `kind`：`run | get | all`，决定走 Statement.run/get/all；
 * - `params`：zod schema，DbServer 执行前用它校验；失败 → `E_BAD_PARAMS`，
 *   错误消息只含字段路径与类型描述，**不含参数值**（防泄露）。
 */

import { targetTableSchema } from '@septcats/core';
import { z } from 'zod';

export type StatementKind = 'run' | 'get' | 'all';

/**
 * 参数校验器的**结构类型**：任何 zod schema 都天然满足它，因此不必在本层
 * 绑定 zod 的泛型签名（也就不会因 zod 版本差异产生类型摩擦）。
 */
export interface ParamValidator {
  safeParse(
    value: unknown,
  ):
    | { readonly success: true; readonly data: unknown }
    | { readonly success: false; readonly error: unknown };
}

export interface StatementDefinition {
  readonly sql: string;
  readonly kind: StatementKind;
  readonly params: ParamValidator;
}

// ---------------------------------------------------------------------------
// 可复用的字段 schema
// ---------------------------------------------------------------------------

const idText = z.string().min(1).max(128);
const aliveFlag = z.number().int().min(0).max(1).default(1);
const versionInt = z.number().int().min(0);
const lamportCount = z.number().int().min(1);
const actorId = z.string().regex(/^[a-z0-9]{8,32}$/);
const nullableText = z.string().nullable().default(null);
const nullableTimestamp = z.number().int().nonnegative().nullable().default(null);
const emptyParams = z.object({});

// ---------------------------------------------------------------------------
// 白名单
// ---------------------------------------------------------------------------

export const STATEMENTS = {
  // ---- workspace ----------------------------------------------------------
  'workspace.upsert': {
    kind: 'run',
    sql: `INSERT INTO workspace (id, name, root_page_id, settings_json, created_at)
VALUES (@id, @name, @root_page_id, @settings_json, @created_at)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  root_page_id = excluded.root_page_id,
  settings_json = excluded.settings_json,
  created_at = excluded.created_at`,
    params: z.object({
      id: idText,
      name: nullableText,
      root_page_id: nullableText,
      settings_json: nullableText,
      created_at: nullableTimestamp,
    }),
  },
  'workspace.get': {
    kind: 'get',
    sql: `SELECT id, name, root_page_id, settings_json, created_at FROM workspace WHERE id = @id`,
    params: z.object({ id: idText }),
  },
  'workspace.list': {
    kind: 'all',
    sql: `SELECT id, name, root_page_id, settings_json, created_at FROM workspace ORDER BY created_at, id`,
    params: emptyParams,
  },

  // ---- page ---------------------------------------------------------------
  'page.upsert': {
    kind: 'run',
    sql: `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, updated_at)
VALUES (@id, @workspace_id, @title, @icon, @cover, @parent_id, @sort_key, @alive, @version, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  workspace_id = excluded.workspace_id,
  title = excluded.title,
  icon = excluded.icon,
  cover = excluded.cover,
  parent_id = excluded.parent_id,
  sort_key = excluded.sort_key,
  alive = excluded.alive,
  version = excluded.version,
  updated_at = excluded.updated_at`,
    params: z.object({
      id: idText,
      workspace_id: z.string().min(1),
      title: z.string().default(''),
      icon: nullableText,
      cover: nullableText,
      parent_id: nullableText,
      sort_key: z.string().min(1),
      alive: aliveFlag,
      version: versionInt,
      updated_at: nullableTimestamp,
    }),
  },
  'page.get': {
    kind: 'get',
    sql: `SELECT * FROM page WHERE id = @id`,
    params: z.object({ id: idText }),
  },
  'page.listByWorkspace': {
    kind: 'all',
    sql: `SELECT * FROM page WHERE workspace_id = @workspace_id AND alive = 1 ORDER BY sort_key, id`,
    params: z.object({ workspace_id: z.string().min(1) }),
  },
  'page.listByParent': {
    kind: 'all',
    sql: `SELECT * FROM page
WHERE workspace_id = @workspace_id AND parent_id IS @parent_id AND alive = 1
ORDER BY sort_key, id`,
    params: z.object({ workspace_id: z.string().min(1), parent_id: nullableText }),
  },
  'page.softDelete': {
    kind: 'run',
    sql: `UPDATE page SET alive = 0, version = @version, updated_at = @updated_at WHERE id = @id`,
    params: z.object({ id: idText, version: versionInt, updated_at: nullableTimestamp }),
  },

  // ---- block --------------------------------------------------------------
  'block.upsert': {
    kind: 'run',
    sql: `INSERT INTO block (id, page_id, workspace_id, type, props_json, content_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
VALUES (@id, @page_id, @workspace_id, @type, @props_json, @content_json, @sort_key, @alive, @version, @lamport_c, @lamport_d, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  page_id = excluded.page_id,
  workspace_id = excluded.workspace_id,
  type = excluded.type,
  props_json = excluded.props_json,
  content_json = excluded.content_json,
  sort_key = excluded.sort_key,
  alive = excluded.alive,
  version = excluded.version,
  lamport_c = excluded.lamport_c,
  lamport_d = excluded.lamport_d,
  updated_at = excluded.updated_at`,
    params: z.object({
      id: idText,
      page_id: idText,
      workspace_id: z.string().min(1),
      type: z.string().min(1),
      props_json: z.string().default('{}'),
      content_json: z.string().nullable().default(null),
      sort_key: z.string().min(1),
      alive: aliveFlag,
      version: versionInt,
      lamport_c: lamportCount,
      lamport_d: actorId,
      updated_at: nullableTimestamp,
    }),
  },
  'block.get': {
    kind: 'get',
    sql: `SELECT * FROM block WHERE id = @id`,
    params: z.object({ id: idText }),
  },
  'block.listByPage': {
    kind: 'all',
    sql: `SELECT * FROM block WHERE page_id = @page_id AND alive = 1 ORDER BY sort_key, id`,
    params: z.object({ page_id: idText }),
  },
  'block.softDelete': {
    kind: 'run',
    sql: `UPDATE block SET alive = 0, version = @version, updated_at = @updated_at WHERE id = @id`,
    params: z.object({ id: idText, version: versionInt, updated_at: nullableTimestamp }),
  },

  // ---- collection ---------------------------------------------------------
  'collection.upsert': {
    kind: 'run',
    sql: `INSERT INTO collection (id, page_id, workspace_id, name, schema_json, views_json, alive, version, lamport_c, lamport_d, updated_at)
VALUES (@id, @page_id, @workspace_id, @name, @schema_json, @views_json, @alive, @version, @lamport_c, @lamport_d, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  page_id = excluded.page_id,
  workspace_id = excluded.workspace_id,
  name = excluded.name,
  schema_json = excluded.schema_json,
  views_json = excluded.views_json,
  alive = excluded.alive,
  version = excluded.version,
  lamport_c = excluded.lamport_c,
  lamport_d = excluded.lamport_d,
  updated_at = excluded.updated_at`,
    params: z.object({
      id: idText,
      page_id: nullableText,
      workspace_id: z.string().min(1),
      name: nullableText,
      schema_json: z.string().default('{}'),
      views_json: z.string().default('[]'),
      alive: aliveFlag,
      version: versionInt,
      lamport_c: lamportCount,
      lamport_d: actorId,
      updated_at: nullableTimestamp,
    }),
  },
  'collection.get': {
    kind: 'get',
    sql: `SELECT * FROM collection WHERE id = @id`,
    params: z.object({ id: idText }),
  },
  'collection.listByWorkspace': {
    kind: 'all',
    sql: `SELECT * FROM collection WHERE workspace_id = @workspace_id AND alive = 1 ORDER BY id`,
    params: z.object({ workspace_id: z.string().min(1) }),
  },

  // ---- record -------------------------------------------------------------
  'record.upsert': {
    kind: 'run',
    sql: `INSERT INTO record (id, collection_id, workspace_id, values_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
VALUES (@id, @collection_id, @workspace_id, @values_json, @sort_key, @alive, @version, @lamport_c, @lamport_d, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  collection_id = excluded.collection_id,
  workspace_id = excluded.workspace_id,
  values_json = excluded.values_json,
  sort_key = excluded.sort_key,
  alive = excluded.alive,
  version = excluded.version,
  lamport_c = excluded.lamport_c,
  lamport_d = excluded.lamport_d,
  updated_at = excluded.updated_at`,
    params: z.object({
      id: idText,
      collection_id: idText,
      workspace_id: z.string().min(1),
      values_json: z.string().default('{}'),
      sort_key: z.string().min(1),
      alive: aliveFlag,
      version: versionInt,
      lamport_c: lamportCount,
      lamport_d: actorId,
      updated_at: nullableTimestamp,
    }),
  },
  'record.get': {
    kind: 'get',
    sql: `SELECT * FROM record WHERE id = @id`,
    params: z.object({ id: idText }),
  },
  'record.listByCollection': {
    kind: 'all',
    sql: `SELECT * FROM record WHERE collection_id = @collection_id AND alive = 1 ORDER BY sort_key, id`,
    params: z.object({ collection_id: idText }),
  },
  'record.softDelete': {
    kind: 'run',
    sql: `UPDATE record SET alive = 0, version = @version, updated_at = @updated_at WHERE id = @id`,
    params: z.object({ id: idText, version: versionInt, updated_at: nullableTimestamp }),
  },

  // ---- op_ledger（真相层） -------------------------------------------------
  'opLedger.insert': {
    kind: 'run',
    // OR IGNORE：op_id 唯一，重放/重建时同一条 op 落库天然幂等
    sql: `INSERT OR IGNORE INTO op_ledger (op_id, seg_id, lamport_c, lamport_d, target_table, target_id, op_json, applied_at)
VALUES (@op_id, @seg_id, @lamport_c, @lamport_d, @target_table, @target_id, @op_json, @applied_at)`,
    params: z.object({
      op_id: z.string().min(1).max(128),
      seg_id: nullableText,
      lamport_c: lamportCount,
      lamport_d: actorId,
      target_table: targetTableSchema,
      target_id: idText,
      op_json: z.string().min(1),
      applied_at: z.number().int().nonnegative(),
    }),
  },
  'opLedger.listAll': {
    kind: 'all',
    sql: `SELECT seq, op_id, seg_id, lamport_c, lamport_d, target_table, target_id, op_json, applied_at
FROM op_ledger ORDER BY seq ASC`,
    params: emptyParams,
  },
  'opLedger.count': {
    kind: 'get',
    sql: `SELECT COUNT(*) AS n FROM op_ledger`,
    params: emptyParams,
  },
  'opLedger.maxLamport': {
    kind: 'get',
    sql: `SELECT COALESCE(MAX(lamport_c), 0) AS c FROM op_ledger`,
    params: emptyParams,
  },

  // ---- meta ---------------------------------------------------------------
  'meta.get': {
    kind: 'get',
    sql: `SELECT value FROM meta WHERE key = @key`,
    params: z.object({ key: z.string().min(1) }),
  },
  'meta.set': {
    kind: 'run',
    sql: `INSERT INTO meta (key, value) VALUES (@key, @value)
ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    params: z.object({ key: z.string().min(1), value: z.string() }),
  },

  // ---- sync_state ---------------------------------------------------------
  'syncState.get': {
    kind: 'get',
    sql: `SELECT * FROM sync_state WHERE device_id = @device_id`,
    params: z.object({ device_id: actorId }),
  },
  'syncState.upsert': {
    kind: 'run',
    sql: `INSERT INTO sync_state (device_id, last_lamport_c, last_sync_ok, pending_count, conflict_count, updated_at)
VALUES (@device_id, @last_lamport_c, @last_sync_ok, @pending_count, @conflict_count, @updated_at)
ON CONFLICT(device_id) DO UPDATE SET
  last_lamport_c = excluded.last_lamport_c,
  last_sync_ok = excluded.last_sync_ok,
  pending_count = excluded.pending_count,
  conflict_count = excluded.conflict_count,
  updated_at = excluded.updated_at`,
    params: z.object({
      device_id: actorId,
      last_lamport_c: z.number().int().min(0).default(0),
      last_sync_ok: z.number().int().min(0).max(1).nullable().default(null),
      pending_count: z.number().int().min(0).default(0),
      conflict_count: z.number().int().min(0).default(0),
      updated_at: nullableTimestamp,
    }),
  },
} satisfies Record<string, StatementDefinition>;

export type SqlId = keyof typeof STATEMENTS;

/** 白名单 id 列表（按声明顺序）。 */
export const SQL_IDS: readonly SqlId[] = Object.keys(STATEMENTS) as SqlId[];

const STATEMENT_TABLE: ReadonlyMap<string, StatementDefinition> = new Map(
  Object.entries(STATEMENTS) as Array<[string, StatementDefinition]>,
);

/**
 * 查白名单。未知 id（含 `__proto__` / `constructor` 这类原型污染尝试）一律返回 null。
 * 用 Map 而非对象属性访问，天然免疫原型链穿透。
 */
export function getStatement(sqlId: string): StatementDefinition | null {
  return STATEMENT_TABLE.get(sqlId) ?? null;
}
