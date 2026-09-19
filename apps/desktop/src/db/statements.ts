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
import { ftsPageBodyExpr } from './schema.v4';

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
/** 工作区 id：v2 起的**每一条**页面/收藏/最近语句都必须携带它（单库多工作区分片，Q4）。 */
const workspaceIdText = z.string().min(1).max(128);
/** 设备本地用户键（favorite/recent 的 user_key；取 meta.device_id）。 */
const userKeyText = z.string().min(1).max(128);
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
    sql: `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, deleted_at, updated_at)
VALUES (@id, @workspace_id, @title, @icon, @cover, @parent_id, @sort_key, @alive, @version, @deleted_at, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  workspace_id = excluded.workspace_id,
  title = excluded.title,
  icon = excluded.icon,
  cover = excluded.cover,
  parent_id = excluded.parent_id,
  sort_key = excluded.sort_key,
  alive = excluded.alive,
  version = excluded.version,
  deleted_at = excluded.deleted_at,
  updated_at = excluded.updated_at`,
    params: z.object({
      id: idText,
      workspace_id: workspaceIdText,
      title: z.string().default(''),
      icon: nullableText,
      cover: nullableText,
      parent_id: nullableText,
      sort_key: z.string().min(1),
      alive: aliveFlag,
      version: versionInt,
      deleted_at: nullableTimestamp,
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

  // ---- page（v2：页面树 / 回收站 / 工作区）--------------------------------
  // 写语句的 WHERE 一律带 workspace_id：越界工作区 = 0 行受影响（不跨工作区写）。
  'page.insert': {
    kind: 'run',
    sql: `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, deleted_at, updated_at)
VALUES (@id, @workspace_id, @title, @icon, @cover, @parent_id, @sort_key, @alive, @version, @deleted_at, @updated_at)
ON CONFLICT(id) DO NOTHING`,
    params: z.object({
      id: idText,
      workspace_id: workspaceIdText,
      title: z.string().default(''),
      icon: nullableText,
      cover: nullableText,
      parent_id: nullableText,
      sort_key: z.string().min(1),
      alive: aliveFlag,
      version: versionInt,
      deleted_at: nullableTimestamp,
      updated_at: nullableTimestamp,
    }),
  },
  'page.rename': {
    kind: 'run',
    sql: `UPDATE page SET title = @title, version = @version, updated_at = @updated_at
WHERE id = @id AND workspace_id = @workspace_id`,
    params: z.object({
      id: idText,
      workspace_id: workspaceIdText,
      title: z.string(),
      version: versionInt,
      updated_at: nullableTimestamp,
    }),
  },
  'page.setSort': {
    kind: 'run',
    sql: `UPDATE page SET sort_key = @sort_key, version = @version, updated_at = @updated_at
WHERE id = @id AND workspace_id = @workspace_id`,
    params: z.object({
      id: idText,
      workspace_id: workspaceIdText,
      sort_key: z.string().min(1),
      version: versionInt,
      updated_at: nullableTimestamp,
    }),
  },
  'page.setChildrenOrder': {
    kind: 'run',
    sql: `UPDATE page SET parent_id = @parent_id, sort_key = @sort_key, version = @version, updated_at = @updated_at
WHERE id = @id AND workspace_id = @workspace_id`,
    params: z.object({
      id: idText,
      workspace_id: workspaceIdText,
      parent_id: nullableText,
      sort_key: z.string().min(1),
      version: versionInt,
      updated_at: nullableTimestamp,
    }),
  },
  'page.setDeleted': {
    kind: 'run',
    // deleted_at: >0 = 软删除（进回收站）；0 = 「彻底删除」标记（M5 即时移除，物理清除归 GC）
    sql: `UPDATE page SET alive = 0, deleted_at = @deleted_at, version = @version, updated_at = @updated_at
WHERE id = @id AND workspace_id = @workspace_id`,
    params: z.object({
      id: idText,
      workspace_id: workspaceIdText,
      deleted_at: nullableTimestamp,
      version: versionInt,
      updated_at: nullableTimestamp,
    }),
  },
  'page.listAll': {
    kind: 'all',
    // page:tree 的唯一查询：alive+deleted 全量（2000 页 < 80ms，单查询）
    sql: `SELECT * FROM page WHERE workspace_id = @workspace_id ORDER BY sort_key, id`,
    params: z.object({ workspace_id: workspaceIdText }),
  },
  'page.listTrash': {
    kind: 'all',
    // 只列「软删除」行（deleted_at > 0）；deleted_at = 0 的彻底删除标记不再露出
    sql: `SELECT * FROM page
WHERE workspace_id = @workspace_id AND alive = 0 AND deleted_at > 0
ORDER BY deleted_at DESC, id`,
    params: z.object({ workspace_id: workspaceIdText }),
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
  // T21-01（TASK-T21-01）：编辑器 diff 的 block patch / reorder 物化语句（只增不改）。
  // patch 用 COALESCE(@x, col) 表示「缺席字段不触碰」——diff 产出的 patch payload
  // 只含变化字段（packages/editor/src/diff.ts）；content 的显式 null 与「缺席」无法
  // 在此区分，但 diff 语义下 patch 不会携带它（type 变更走 upsert 整块写）。
  // 注意：block 表无 parent_id 列（block.upsert 同样不落它），patch 亦不触碰。
  'block.patch': {
    kind: 'run',
    sql: `UPDATE block SET
  type = COALESCE(@type, type),
  props_json = COALESCE(@props_json, props_json),
  content_json = COALESCE(@content_json, content_json),
  sort_key = COALESCE(@sort_key, sort_key),
  alive = COALESCE(@alive, alive),
  version = @version,
  lamport_c = @lamport_c,
  lamport_d = @lamport_d,
  updated_at = @updated_at
WHERE id = @id`,
    params: z.object({
      id: idText,
      type: z.string().min(1).nullable(),
      props_json: z.string().nullable(),
      content_json: z.string().nullable(),
      sort_key: z.string().min(1).nullable(),
      alive: z.number().int().min(0).max(1).nullable(),
      version: versionInt,
      lamport_c: lamportCount,
      lamport_d: actorId,
      updated_at: nullableTimestamp,
    }),
  },
  'block.setSort': {
    kind: 'run',
    sql: `UPDATE block SET sort_key = @sort_key, version = @version, lamport_c = @lamport_c, lamport_d = @lamport_d, updated_at = @updated_at WHERE id = @id`,
    params: z.object({
      id: idText,
      sort_key: z.string().min(1),
      version: versionInt,
      lamport_c: lamportCount,
      lamport_d: actorId,
      updated_at: nullableTimestamp,
    }),
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
  // T7：独立 DB 页（page_id 指向 page 行）→ collection 反查
  'collection.getByPage': {
    kind: 'get',
    sql: `SELECT * FROM collection WHERE page_id = @page_id AND alive = 1 ORDER BY id LIMIT 1`,
    params: z.object({ page_id: idText }),
  },
  // T7：视图落盘是 collection 的局部 patch（只动 views_json；不整体覆盖 schema）
  'collection.setViews': {
    kind: 'run',
    sql: `UPDATE collection SET views_json = @views_json, version = @version, lamport_c = @lamport_c, lamport_d = @lamport_d, updated_at = @updated_at
WHERE id = @id AND workspace_id = @workspace_id AND alive = 1`,
    params: z.object({
      id: idText,
      workspace_id: workspaceIdText,
      views_json: z.string().default('[]'),
      version: versionInt,
      lamport_c: lamportCount,
      lamport_d: actorId,
      updated_at: nullableTimestamp,
    }),
  },

  // ---- record（读路径）----------------------------------------------------
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

  // ---- record（T7：行内数据库的写路径）------------------------------------
  // 写语句带 workspace_id 守卫（越界工作区 = 0 行受影响，不跨工作区写）。
  // backlinks_json 是**设备本地派生态**（relation 反链索引），不进 Op payload；
  // 从分段重建后为空，由后续 relation 编辑重新积累（口径同 page.deleted_at）。
  // **冲突分支不覆盖 backlinks_json**：值 upsert（改标题/改值）不得清空反链索引，
  // 反链只由 `record.setBacklinks` 维护（见 main/commit.ts 的 record 物化说明）。
  'record.upsert': {
    kind: 'run',
    sql: `INSERT INTO record (id, collection_id, workspace_id, values_json, backlinks_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
VALUES (@id, @collection_id, @workspace_id, @values_json, @backlinks_json, @sort_key, @alive, @version, @lamport_c, @lamport_d, @updated_at)
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
      backlinks_json: z.string().default('{}'),
      sort_key: z.string().min(1),
      alive: aliveFlag,
      version: versionInt,
      lamport_c: lamportCount,
      lamport_d: actorId,
      updated_at: nullableTimestamp,
    }),
  },
  // relation 双写：只改对方记录的 backlinks 索引（values/sort_key 不动）
  'record.setBacklinks': {
    kind: 'run',
    sql: `UPDATE record SET backlinks_json = @backlinks_json, version = @version, lamport_c = @lamport_c, lamport_d = @lamport_d, updated_at = @updated_at
WHERE id = @id AND workspace_id = @workspace_id AND alive = 1`,
    params: z.object({
      id: idText,
      workspace_id: workspaceIdText,
      backlinks_json: z.string().default('{}'),
      version: versionInt,
      lamport_c: lamportCount,
      lamport_d: actorId,
      updated_at: nullableTimestamp,
    }),
  },
  // 记录删除前检查：还有多少条存活记录的 values_json 引用了 @id。
  // 内层 json_each 的入参必须用 CASE + json_valid 收口：SQLite 的 json_each/json_type
  // 对非 JSON 文本会直接抛「malformed JSON」（而非返回空集），裸列值「来源」之类会炸。
  'relation.countTargets': {
    kind: 'get',
    sql: `SELECT COUNT(*) AS n
FROM record r
WHERE r.workspace_id = @workspace_id AND r.alive = 1
  AND EXISTS (
    SELECT 1
    FROM json_each(r.values_json) AS jt,
         json_each(CASE WHEN json_valid(jt.value) AND json_type(jt.value) = 'array' THEN jt.value ELSE '[]' END) AS it
    WHERE it.value = @id
  )`,
    params: z.object({ id: idText, workspace_id: workspaceIdText }),
  },
  // 层尾排序键（建记录 = sort_key 追加到尾）：单查询取最大键
  'record.maxSortKey': {
    kind: 'get',
    sql: `SELECT COALESCE(MAX(sort_key), '') AS max_key FROM record WHERE collection_id = @collection_id AND alive = 1`,
    params: z.object({ collection_id: idText }),
  },
  'record.byIds': {
    kind: 'all',
    sql: `SELECT * FROM record WHERE id IN (SELECT value FROM json_each(@ids_json)) AND workspace_id = @workspace_id`,
    params: z.object({ ids_json: z.string(), workspace_id: workspaceIdText }),
  },

  // ---- favorite / recent（v2：设备本地派生态，不进 Op 真相层）-------------
  // 两表无 workspace_id 列，故用 `EXISTS (SELECT 1 FROM page …)` 做工作区校验：
  // 越界 workspace_id ⇒ 0 行受影响（既守住红线，也满足「全部带 workspace_id」）。
  'favorite.add': {
    kind: 'run',
    sql: `INSERT OR IGNORE INTO favorite (user_key, page_id, added_at)
SELECT @user_key, @page_id, @added_at
WHERE EXISTS (SELECT 1 FROM page WHERE id = @page_id AND workspace_id = @workspace_id)`,
    params: z.object({
      user_key: userKeyText,
      page_id: idText,
      added_at: z.number().int().nonnegative(),
      workspace_id: workspaceIdText,
    }),
  },
  'favorite.remove': {
    kind: 'run',
    sql: `DELETE FROM favorite
WHERE user_key = @user_key AND page_id = @page_id
  AND EXISTS (SELECT 1 FROM page WHERE id = @page_id AND workspace_id = @workspace_id)`,
    params: z.object({
      user_key: userKeyText,
      page_id: idText,
      workspace_id: workspaceIdText,
    }),
  },
  'favorite.list': {
    kind: 'all',
    sql: `SELECT f.page_id AS page_id, f.added_at AS added_at
FROM favorite f JOIN page p ON p.id = f.page_id
WHERE f.user_key = @user_key AND p.workspace_id = @workspace_id AND p.alive = 1
ORDER BY f.added_at DESC, f.page_id`,
    params: z.object({ user_key: userKeyText, workspace_id: workspaceIdText }),
  },
  'recent.touch': {
    kind: 'run',
    // UPSERT：只刷新 last_opened，历史位置由 last_opened DESC 体现
    sql: `INSERT INTO recent (user_key, page_id, last_opened)
SELECT @user_key, @page_id, @last_opened
WHERE EXISTS (SELECT 1 FROM page WHERE id = @page_id AND workspace_id = @workspace_id)
ON CONFLICT(user_key, page_id) DO UPDATE SET last_opened = excluded.last_opened`,
    params: z.object({
      user_key: userKeyText,
      page_id: idText,
      last_opened: z.number().int().nonnegative(),
      workspace_id: workspaceIdText,
    }),
  },
  'recent.list': {
    kind: 'all',
    // 上限 20 条；排除已删（回收站里的页面不该出现在「最近」）
    sql: `SELECT r.page_id AS page_id, r.last_opened AS last_opened
FROM recent r JOIN page p ON p.id = r.page_id
WHERE r.user_key = @user_key AND p.workspace_id = @workspace_id AND p.alive = 1
ORDER BY r.last_opened DESC, r.page_id
LIMIT 20`,
    params: z.object({ user_key: userKeyText, workspace_id: workspaceIdText }),
  },

  // ---- import_source（v5 · M12 导入幂等账本）------------------------------
  // 表没有 workspace_id 列（设备本地「源 → 页」记账，口径同 favorite/recent 的
  // 本地派生态；但导入记账不与活动工作区绑定，故无 v2 式 EXISTS 守卫——见报告 §C-2）。
  // OR IGNORE：同 (source_path, content_hash) 重跑/重放天然幂等。
  'importSource.insert': {
    kind: 'run',
    sql: `INSERT OR IGNORE INTO import_source (source_path, content_hash, page_id, created_at)
VALUES (@source_path, @content_hash, @page_id, @created_at)`,
    params: z.object({
      source_path: z.string().min(1).max(1024),
      content_hash: z.string().regex(/^[0-9a-f]{64}$/),
      page_id: idText,
      created_at: z.number().int().nonnegative(),
    }),
  },
  // 计划器去重查询：(path, contentHash) → 已存在 page_id（未命中 → row null）。
  'importSource.get': {
    kind: 'get',
    sql: `SELECT page_id FROM import_source WHERE source_path = @source_path AND content_hash = @content_hash`,
    params: z.object({
      source_path: z.string().min(1).max(1024),
      content_hash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  },
  // 全量预载（计划期把账本装进内存 Map，供同步 ExistingLookup 查询）。
  'importSource.list': {
    kind: 'all',
    sql: `SELECT source_path, content_hash, page_id FROM import_source`,
    params: emptyParams,
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
  // T31-01（P0-3）：发布对账——取「未标记已发布」的 op（取批以 seg_id IS NULL 为准，
  // 而非水位推断；下行 op 由对账按盘上段回写标记，本机未发布 op 由对账补发）。
  'opLedger.listUnpublished': {
    kind: 'all',
    sql: `SELECT seq, op_id, seg_id, lamport_c, lamport_d, target_table, target_id, op_json, applied_at
FROM op_ledger WHERE seg_id IS NULL ORDER BY seq ASC`,
    params: emptyParams,
  },
  // T31-01（P0-3）：单条 op 的 seg_id 回写（仅未标记行生效，幂等）；
  // 发布路径在段落盘后调用，与既有 opLedger.insert 同走 batch 单事务。
  'opLedger.markSeg': {
    kind: 'run',
    sql: `UPDATE op_ledger SET seg_id = @seg_id WHERE op_id = @op_id AND seg_id IS NULL`,
    params: z.object({ op_id: z.string().min(1), seg_id: z.string().min(1) }),
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
  // ---- FTS 维护 / 检索（M7 · TASK-T8-01 §1/§2）----------------------------
  // fts.clearPage + fts.syncBlock 成对使用（prepare 只接受单条语句，无法合并）：
  // commitOps 路径对每个涉及 page 追加这一对，先删该页 FTS 行再按「标题+正文」重插。
  // body 表达式与 v4 触发器、FTS_RESYNC 同源（schema.v4.ts 的 ftsPageBodyExpr）。
  'fts.clearPage': {
    kind: 'run',
    sql: `DELETE FROM page_block_fts WHERE page_id = @page_id`,
    params: z.object({ page_id: idText }),
  },
  'fts.syncBlock': {
    kind: 'run',
    sql: `INSERT INTO page_block_fts (title, body, page_id, workspace_id)
SELECT p.title, ${ftsPageBodyExpr('p.id')}, p.id, p.workspace_id
FROM page p
WHERE p.id = @page_id AND p.alive = 1`,
    params: z.object({ page_id: idText }),
  },
  // FTS 触发器 defer 开关（TASK-T15-01，migration #6 的 fts_defer 常规表）：
  // 批量写块的场景（commitOps 同 batch ≥2 条 block.upsert / rebuild）在事务头
  // deferOn、尾 deferOff——v6 触发器的 WHEN 守卫读到 flag=1 即跳过逐行整页重算
  // （O(n²) 根因），批量结束后由尾部 fts.syncBlock / FTS_RESYNC 单次重算。
  // 无参（空对象）语句；flag 与数据写入同事务，中途 throw 随事务一并回滚回 0。
  'fts.deferOn': {
    kind: 'run',
    sql: `UPDATE fts_defer SET flag = 1`,
    params: emptyParams,
  },
  'fts.deferOff': {
    kind: 'run',
    sql: `UPDATE fts_defer SET flag = 0`,
    params: emptyParams,
  },

  // search:query 的三条真库查询（bm25 主检索 + LIKE 兜底）。FTS 行是页粒度，
  // join page 取存活行与 updated_at（排序键之一）。
  'search.ftsPage': {
    kind: 'all',
    sql: `SELECT
  page_block_fts.page_id AS page_id,
  p.title AS title,
  bm25(page_block_fts) AS score,
  snippet(page_block_fts, -1, '[', ']', '…', 12) AS snippet,
  p.updated_at AS updated_at
FROM page_block_fts
JOIN page p ON p.id = page_block_fts.page_id
WHERE page_block_fts MATCH @query
  AND page_block_fts.workspace_id = @workspaceId
  AND p.alive = 1
ORDER BY score ASC
LIMIT @limit`,
    params: z.object({
      query: z.string().min(1),
      workspaceId: z.string().min(1),
      limit: z.number().int().min(1).max(200),
    }),
  },
  // <3 字兜底（TASK-T20-01）：trigram tokenizer 最小 MATCH 单元是 3 字，1–2 字
  //（典型中文短词）在 search.ftsPage 下恒 0 条。改扫 page_block_fts 底表 LIKE：
  // join page alive=1；@like 由调用方做 \ % _ ESCAPE 转义；标题命中（title_rank=0）
  // 优先，同级按 updated_at desc 稳定序。score 给正的基准分 1（与 shared/search.ts
  // 的 SEARCH_LIKE_BASE_SCORE 同口径：FTS bm25 ≤ 0 在前，LIKE 在后）。
  'search.likeFtsPage': {
    kind: 'all',
    sql: `SELECT
  f.page_id AS page_id,
  p.title AS title,
  CASE WHEN p.title LIKE @like ESCAPE '\\' THEN 0 ELSE 1 END AS title_rank,
  1.0 AS score,
  CASE
    WHEN instr(lower(f.body), @needle) > 0
      THEN substr(f.body, max(1, instr(lower(f.body), @needle) - 24), 88)
    ELSE f.title
  END AS snippet,
  p.updated_at AS updated_at
FROM page_block_fts f
JOIN page p ON p.id = f.page_id
WHERE f.workspace_id = @workspaceId
  AND p.alive = 1
  AND (f.title LIKE @like ESCAPE '\\' OR f.body LIKE @like ESCAPE '\\')
ORDER BY title_rank ASC, p.updated_at DESC, f.page_id
LIMIT @limit`,
    params: z.object({
      like: z.string().min(1),
      needle: z.string().min(1),
      workspaceId: z.string().min(1),
      limit: z.number().int().min(1).max(200),
    }),
  },
  // LIKE 兜底（§1 步骤 4 / §2.3）：code 块正文不进 FTS，靠 props_json/content_json
  // 的 %q% 扫描补查；上限 50（RELATION 同款预算），ESCAPE 收口用户输入的通配符。
  'search.likeBlock': {
    kind: 'all',
    sql: `SELECT b.id AS id, b.page_id AS page_id, b.type AS type,
       b.props_json AS props_json, b.content_json AS content_json,
       p.title AS page_title, p.updated_at AS updated_at
FROM block b
JOIN page p ON p.id = b.page_id
WHERE b.workspace_id = @workspace_id AND b.alive = 1 AND p.alive = 1
  AND b.type = 'code'
  AND (b.props_json LIKE @like ESCAPE '\\' OR b.content_json LIKE @like ESCAPE '\\')
ORDER BY b.updated_at DESC, b.id
LIMIT @limit`,
    params: z.object({
      workspace_id: workspaceIdText,
      like: z.string().min(1),
      limit: z.number().int().min(1).max(50),
    }),
  },
  'search.likeCollection': {
    kind: 'all',
    sql: `SELECT id, page_id AS page_id, name AS name, updated_at AS updated_at
FROM collection
WHERE workspace_id = @workspace_id AND alive = 1
  AND name LIKE @like ESCAPE '\\'
ORDER BY updated_at DESC, id
LIMIT @limit`,
    params: z.object({
      workspace_id: workspaceIdText,
      like: z.string().min(1),
      limit: z.number().int().min(1).max(50),
    }),
  },
  'search.likeRecord': {
    kind: 'all',
    sql: `SELECT r.id AS id, r.collection_id AS collection_id, r.values_json AS values_json,
       c.page_id AS page_id, c.name AS collection_name, r.updated_at AS updated_at
FROM record r
JOIN collection c ON c.id = r.collection_id
WHERE r.workspace_id = @workspace_id AND r.alive = 1 AND c.alive = 1
  AND r.values_json LIKE @like ESCAPE '\\'
ORDER BY r.updated_at DESC, r.id
LIMIT @limit`,
    params: z.object({
      workspace_id: workspaceIdText,
      like: z.string().min(1),
      limit: z.number().int().min(1).max(50),
    }),
  },
  // ---- template（v7 · TASK-T23-01：模板子系统数据面）-----------------------
  // 账本内实体（op kind='template'，target.table='template'，core schema v3）；
  // upsert 整对象写（LWW 全量），patch 只动 title/icon（templates:rename 的局部路径，
  // 服务层 rename 实际走 upsert 整对象以保持 op 与投影一致——见 main/templates.ts）。
  // 表无 workspace_id 列（模板设备级共享，口径同 import_source，见其 §C-2 说明）。
  'template.upsert': {
    kind: 'run',
    sql: `INSERT INTO template (id, kind, title, icon, payload, alive, version, created_at, updated_at, deleted_at)
VALUES (@id, @kind, @title, @icon, @payload, @alive, @version, @created_at, @updated_at, @deleted_at)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind,
  title = excluded.title,
  icon = excluded.icon,
  payload = excluded.payload,
  alive = excluded.alive,
  version = excluded.version,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at`,
    params: z.object({
      id: idText,
      kind: z.enum(['page', 'database']),
      title: z.string().default(''),
      icon: nullableText,
      payload: z.string().min(1).default('{}'),
      alive: aliveFlag,
      version: versionInt,
      created_at: nullableTimestamp,
      updated_at: nullableTimestamp,
      deleted_at: nullableTimestamp,
    }),
  },
  'template.patch': {
    kind: 'run',
    sql: `UPDATE template SET
  title = COALESCE(@title, title),
  icon = COALESCE(@icon, icon),
  version = @version,
  updated_at = @updated_at
WHERE id = @id`,
    params: z.object({
      id: idText,
      title: z.string().nullable(),
      icon: z.string().nullable(),
      version: versionInt,
      updated_at: nullableTimestamp,
    }),
  },
  'template.get': {
    kind: 'get',
    sql: `SELECT * FROM template WHERE id = @id`,
    params: z.object({ id: idText }),
  },
  'template.list': {
    kind: 'all',
    sql: `SELECT id, kind, title, icon, updated_at FROM template
WHERE alive = 1 AND (@kind IS NULL OR kind = @kind)
ORDER BY updated_at DESC, id`,
    params: z.object({ kind: z.enum(['page', 'database']).nullable().default(null) }),
  },
  'template.softDelete': {
    kind: 'run',
    sql: `UPDATE template SET alive = 0, deleted_at = @deleted_at, version = @version, updated_at = @updated_at
WHERE id = @id`,
    params: z.object({
      id: idText,
      deleted_at: nullableTimestamp,
      version: versionInt,
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
