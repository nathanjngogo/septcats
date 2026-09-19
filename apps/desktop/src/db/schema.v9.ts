/**
 * migration #9 的语句（TASK-T44-01）：页面互链派生表 `page_link_index`。
 *
 * 纪律：
 * - **禁止改 #1..#8**（均已发布的迁移描述），v9 只做纯新增（建表 + 索引，IF NOT EXISTS）；
 * - **设备本地派生态**（口径同 v3 的 record.backlinks_json / v4 的 FTS）：
 *   由块 content（PM doc JSON）解析 `[[ ]]` 双链派生，不进 Op 真相层、不随同步发布；
 *   链接以**目标页稳定 id**（target_page_id）为键——页面改名不破链（TASK-T44-01 §1.5）；
 * - 派生维护 = 提交后按涉及页「清该页源行 + 重插」（增量），启动/手动可全量重建；
 *   一致性判据：增量维护结果 == 全量重建结果（test/links.test.ts 断言）；
 * - workspace_id 冗余自源块行（单库多工作区分片，查询按分片过滤）。
 */

/** v9 建表语句（STRICT，与 v5/v7 口径一致；PK 去重同一块内指向同页的多条链接）。 */
export const SCHEMA_V9_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS page_link_index (
    source_page_id TEXT NOT NULL,
    source_block_id TEXT NOT NULL,
    target_page_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    context TEXT NOT NULL,
    PRIMARY KEY (source_block_id, target_page_id)
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS idx_page_link_target ON page_link_index(target_page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_page_link_source ON page_link_index(source_page_id)`,
];

/** 测试/自检用：v9 追加的表名清单。 */
export const SCHEMA_V9_TABLES: readonly string[] = ['page_link_index'];
