/**
 * migration #5 的语句（TASK-T11-01 §0.5）：导入幂等表 `import_source`（M12 导入器）。
 *
 * 纪律：
 * - **禁止改 #1..#4**（均已发布的迁移描述），v5 只做追加；
 * - `import_source` 是**设备本地的幂等账本**（不进 Op 真相层，口径同 v2 的
 *   favorite/recent）：导入执行器在每次 page/collection 落库的**同一个 batch**
 *   里插一行，(source_path, content_hash) 命中即整条目跳过（计划器去重 +
 *   断点重跑天然幂等）；
 * - 表没有 workspace_id 列：导入是设备本地的「源 → 页」记账，跨工作区复制页面
 *   的场景不存在（一期单活动工作区），故语句白名单不带 workspace_id 守卫
 *   （TASK-T11-01 §C-2 报告项）。
 */

/** v5 建表语句（STRICT，与 v1/v2 口径一致；PK 即 (source_path, content_hash) 联合主键）。 */
export const SCHEMA_V5_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS import_source (
    source_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    page_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (source_path, content_hash)
  ) STRICT`,
];

/** 测试/自检用：v5 追加的表名清单。 */
export const SCHEMA_V5_TABLES: readonly string[] = ['import_source'];
