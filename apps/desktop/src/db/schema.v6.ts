/**
 * migration #6 的语句（TASK-T15-01）：FTS 触发器 defer 守卫（性能红牌 #30 修复）。
 *
 * 根因（docs/PERF-BASELINE.md §3，PM 探针定案）：v4 块 FTS 触发器每行 INSERT/UPDATE
 * 都整页重算（O(n²)）——rebuild 34k 次块插入逐行触发整页 DELETE+重算，而事务末尾
 * FTS_RESYNC 本就全量重算一次（触发器全白做）；commitOps 200 块同页写 = 200 次
 * 整页重算 + 尾部显式 fts.clearPage/syncBlock 再 2 次。
 *
 * PM 探针已定的事实（TASK-T15-01 §1，照此实施）：
 * - **TEMP 表在触发器内不可见**（触发器是持久 schema，解析只看 main）→ defer
 *   标志必须是**常规表** `fts_defer`；
 * - 常规表 + `WHEN (SELECT flag FROM fts_defer LIMIT 1)=0` 守卫语义成立：
 *   flag=1 触发器跳过、flag=0 恢复，单行读成本微秒级。
 *
 * v6 做三件事（同一迁移事务里，幂等）：
 *  1. 建 `fts_defer` 常规表（CHECK 收口值域 0/1）+ 初始行 flag=0（NOT EXISTS 守卫，
 *     重复执行不插重复行；再无条件 UPDATE flag=0——迁移时点不可能有合法的在途
 *     批量写，兜底防历史残留 flag=1 永久禁用触发器）；
 *  2. DROP + 重建 v4 的 6 个 FTS 触发器——**触发器体逐字保持 v4 逻辑**
 *     （共用 schema.v4.ts 的 refreshPageFtsV4 / ftsPageBodyExpr，单源），仅外层
 *     加 WHEN defer 守卫（page 标题触发器同加，语义统一）；
 *  3. meta.schema_version = '6'（migrations.ts 的 applySchemaV6 负责）。
 *
 * 语义说明（也被 test/fts-defer.test.ts 锁定）：flag 是**库级共享**状态（单行单值，
 * 跨连接可见）——批量 defer 期间其他连接写入同样跳过触发器重算。运行期只有
 * rebuild（独占子进程）与 commitOps 的单事务 batch 置 1，且与数据写入同事务：
 * 中途 throw 一并回滚回 0，不产生跨事务残留。
 */

import { ftsPageBodyExpr, refreshPageFtsV4 } from './schema.v4';

/** defer 守卫表达式（六触发器 WHEN 共用；单行单值表，`LIMIT 1` 即全局 flag）。 */
export const FTS_DEFER_GUARD_EXPR = '(SELECT flag FROM fts_defer LIMIT 1) = 0';

/** v6 重建的 6 个触发器名（与 v1/v4 相同：先 DROP 再 CREATE，整体替换旧定义）。 */
export const SCHEMA_V6_TRIGGER_NAMES: readonly string[] = [
  'trg_page_fts_ai',
  'trg_page_fts_au',
  'trg_page_fts_ad',
  'trg_block_fts_ai',
  'trg_block_fts_au',
  'trg_block_fts_ad',
];

/**
 * v6 触发器语句（DROP + 带 WHEN 守卫的 CREATE；触发器体与 v4 逐字一致）。
 * 抽成独立常量供测试做结构断言（不含建表语句）。
 */
export const SCHEMA_V6_TRIGGERS: readonly string[] = [
  ...SCHEMA_V6_TRIGGER_NAMES.map((name) => `DROP TRIGGER IF EXISTS ${name}`),

  `CREATE TRIGGER trg_page_fts_ai
AFTER INSERT ON page
WHEN new.alive = 1 AND ${FTS_DEFER_GUARD_EXPR}
BEGIN
  INSERT INTO page_block_fts (title, body, page_id, workspace_id)
  SELECT new.title, ${ftsPageBodyExpr('new.id')}, new.id, new.workspace_id;
END`,

  `CREATE TRIGGER trg_page_fts_au
AFTER UPDATE ON page
WHEN ${FTS_DEFER_GUARD_EXPR}
BEGIN
  DELETE FROM page_block_fts WHERE page_id = new.id;
  INSERT INTO page_block_fts (title, body, page_id, workspace_id)
  SELECT new.title, ${ftsPageBodyExpr('new.id')}, new.id, new.workspace_id
  WHERE new.alive = 1;
END`,

  `CREATE TRIGGER trg_page_fts_ad
AFTER DELETE ON page
WHEN ${FTS_DEFER_GUARD_EXPR}
BEGIN
  DELETE FROM page_block_fts WHERE page_id = old.id;
END`,

  `CREATE TRIGGER trg_block_fts_ai
AFTER INSERT ON block
WHEN ${FTS_DEFER_GUARD_EXPR}
BEGIN
  ${refreshPageFtsV4('new.page_id')}
END`,

  `CREATE TRIGGER trg_block_fts_au
AFTER UPDATE ON block
WHEN ${FTS_DEFER_GUARD_EXPR}
BEGIN
  ${refreshPageFtsV4('old.page_id')}
  ${refreshPageFtsV4('new.page_id')}
END`,

  `CREATE TRIGGER trg_block_fts_ad
AFTER DELETE ON block
WHEN ${FTS_DEFER_GUARD_EXPR}
BEGIN
  ${refreshPageFtsV4('old.page_id')}
END`,
];

/** migration #6 的完整语句序列（逐条 `db.exec`；触发器语句自带 BEGIN..END）。 */
export const SCHEMA_V6_STATEMENTS: readonly string[] = [
  // 1. defer 标志表（常规表——TEMP 表在触发器内不可见，PM 探针 1 实锤）
  `CREATE TABLE IF NOT EXISTS fts_defer (
    flag INTEGER NOT NULL CHECK (flag IN (0, 1))
  ) STRICT`,
  // 2. 初始行 flag=0：NOT EXISTS 守卫保证重复执行不插重复行（单行单值语义）
  `INSERT INTO fts_defer (flag) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM fts_defer)`,
  // 3. 兜底复位：迁移时点不存在合法的在途 defer 批量，防历史残留 flag=1 永久禁用触发器
  `UPDATE fts_defer SET flag = 0`,
  // 4. 六触发器重建（带 WHEN 守卫）
  ...SCHEMA_V6_TRIGGERS,
];

/** 测试/自检用：v6 追加的表名清单。 */
export const SCHEMA_V6_TABLES: readonly string[] = ['fts_defer'];
