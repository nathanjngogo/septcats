/**
 * migration #8 的语句（TASK-T42-01 §0）：页面承载类型列。
 *
 * 纪律：
 * - **禁止改既有迁移**，v8 只做**纯新增**加列（幂等：`up` 先查 `PRAGMA table_info`）；
 * - **向后兼容**：旧库（v7 及以下）打开时由迁移补列，存量行落默认值 `page`，
 *   `MIN_SUPPORTED_SCHEMA_VERSION` 不提高（core 零改动）；
 * - 承载判定**复用「数据库页」的既有范式**（schema-v1 §0.2）：
 *   - `page_type='database'` 只在 `db.create` 等新建路径随 upsert op 写入（审计可查）；
 *   - 读路径的权威判定 = **存活 collection 行存在**（`collection.page_id` 关联）→ database，
 *     否则取 `page_type` 列（'wiki' | 'page'）。旧版本建的库页（无 page_type 标记）因此照常识别；
 * - `summary` 是 Wiki 落地页「简介」（独立于正文块），随 page upsert op 走账本
 *   （op payload 键 `page_type` / `summary`，物化于本迁移的两列）。
 */

/** v8 加列（幂等：`up` 先查 `PRAGMA table_info` 再决定是否 ALTER，与 v2/v3 同口径）。 */
export const SCHEMA_V8_ADDED_COLUMNS: readonly {
  readonly table: string;
  readonly column: string;
  readonly sql: string;
}[] = [
  {
    table: 'page',
    column: 'page_type',
    // 默认 'page'：存量行与旧版本写入的行一律按普通文档页理解
    sql: `ALTER TABLE page ADD COLUMN page_type TEXT NOT NULL DEFAULT 'page'`,
  },
  {
    table: 'page',
    column: 'summary',
    sql: 'ALTER TABLE page ADD COLUMN summary TEXT',
  },
];
