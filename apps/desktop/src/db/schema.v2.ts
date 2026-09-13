/**
 * migration #2 的语句（TASK-T6-01 §2）：页面树/工作区所需的三张本地表 + page.deleted_at。
 *
 * 纪律：
 * - **禁止改 #1**（`schema.sql.ts` 是已发布的 v1 描述），v2 只做追加；
 * - 三张新表都是本地派生态，**不进 Op 真相层**：
 *   `favorite`/`recent` 是设备本地视图（用户键 user_key 取自 meta.device_id），
 *   `mention` 是反链索引（schema-v1 §7 承诺 M5 建表，本次只建表 + 索引，回填归后续任务）；
 * - `page.deleted_at` 是回收站保留期（30 天 GC 用），同样是**物化层本地列**，
 *   不进 Op payload（delete op 的 payload 恒为 `{}`，见 schema-v1 §1）。
 *
 * `deleted_at` 的取值约定：
 * - `NULL`  = 存活（从未删过，或已从回收站恢复）；
 * - `> 0`   = 软删除时间（ms），出现在回收站，30 天后可 GC；
 * - `0`     = 「彻底删除」标记（M5 的即时移除语义，物理清除由 GC 任务完成）。
 */

/** v2 追加的列（STRICT 表加列：better-sqlite3 12 的 SQLite ≥ 3.45 原生支持）。 */
export interface AddedColumn {
  readonly table: string;
  readonly column: string;
  readonly sql: string;
}

/** v2 新表（全部 STRICT，与 v1 口径一致）。 */
export const SCHEMA_V2_STATEMENTS: readonly string[] = [
  // 收藏（设备本地；PK 保证 add 幂等）
  `CREATE TABLE IF NOT EXISTS favorite (
    user_key TEXT NOT NULL,
    page_id TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (user_key, page_id)
  ) STRICT`,

  // 最近打开（设备本地；UPSERT 只刷新 last_opened）
  `CREATE TABLE IF NOT EXISTS recent (
    user_key TEXT NOT NULL,
    page_id TEXT NOT NULL,
    last_opened INTEGER NOT NULL,
    PRIMARY KEY (user_key, page_id)
  ) STRICT`,

  // 反链索引（schema-v1 §7 的 mention(page_id,target_id) 落地位；回填任务见未决项）
  `CREATE TABLE IF NOT EXISTS mention (
    source_page_id TEXT NOT NULL,
    target_page_id TEXT NOT NULL,
    PRIMARY KEY (source_page_id, target_page_id)
  ) STRICT`,
];

/**
 * v2 加列（幂等：`up` 先查 `PRAGMA table_info` 再决定是否 ALTER）。
 * SQLite 的 `ALTER TABLE ... ADD COLUMN` 在 STRICT 表上受支持，但**不可重复执行**，
 * 故这一项不能靠 `IF NOT EXISTS`，必须由迁移逻辑做存在性判断。
 */
export const SCHEMA_V2_ADDED_COLUMNS: readonly AddedColumn[] = [
  { table: 'page', column: 'deleted_at', sql: 'ALTER TABLE page ADD COLUMN deleted_at INTEGER' },
];

/**
 * v3（TASK-T7-01 §2）追加列：`record.backlinks_json` —— relation 反链索引。
 *
 * 与 `page.deleted_at` 同口径：**设备本地派生态**，不进 Op payload（relation 双写
 * 只发 record 的 upsert/delete op，backlink 是物化投影的副产物），
 * 从分段重建后为空，由后续 relation 编辑重新积累。
 */
export const SCHEMA_V3_ADDED_COLUMNS: readonly AddedColumn[] = [
  {
    table: 'record',
    column: 'backlinks_json',
    sql: `ALTER TABLE record ADD COLUMN backlinks_json TEXT NOT NULL DEFAULT '{}'`,
  },
];

/** v3 索引：反链查询按 collection 收窄（relation 双写与删除前检查都要用）。 */
export const SCHEMA_V3_INDEXES: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_record_backlinks ON record(workspace_id) WHERE alive = 1 AND backlinks_json != '{}'`,
];

/** v2 索引（计划书 §6.2 的两条：最近打开倒序、存活页按工作区）。 */
export const SCHEMA_V2_INDEXES: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_recent_user ON recent(user_key, last_opened DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_page_ws_live ON page(workspace_id) WHERE deleted_at IS NULL`,
];

/** 测试/自检用：v2 追加的表名清单。 */
export const SCHEMA_V2_TABLES: readonly string[] = ['favorite', 'recent', 'mention'];
