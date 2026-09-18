/**
 * migration #7 的语句（TASK-T23-01 §0.A）：模板子系统数据面的 `template` 表。
 *
 * 纪律：
 * - **禁止改既有迁移**，v7 只做追加（建表 + 索引，全部 `IF NOT EXISTS`，幂等）；
 * - `template` 是**账本内实体**（PM 裁决 §0.A：模板走 op 账本，不用文件、不塞块表）——
 *   op 侧 kind='template'、target.table='template'（core schema v3），经
 *   `template.upsert` / `template.softDelete` 物化；模板天然不进 FTS / page 树 / 最近，
 *   满足 PRD「模板不进搜索、不进最近」的隔离要求；
 * - `payload` 为 JSON 安全的普通对象（零 React、零 IO，照 dbview/types.ts 的纪律）：
 *   kind='page' → `{title, icon, blocks}`；kind='database' → `{title, icon, collection:{name,schema,views}, blocks?}`，
 *   **不含 record 行**（模板=结构，不是数据副本）。
 */

/** v7 新表（STRICT，与既有表口径一致）。 */
export const SCHEMA_V7_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS template (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    icon TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    alive INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL,
    created_at INTEGER,
    updated_at INTEGER,
    deleted_at INTEGER
  ) STRICT`,
  // 模板列表按 updated_at 倒序（templates:list 的查询序）；表小，单索引足够
  `CREATE INDEX IF NOT EXISTS idx_template_alive ON template(alive, updated_at)`,
];

/** 测试/自检用：v7 追加的表名清单。 */
export const SCHEMA_V7_TABLES: readonly string[] = ['template'];
