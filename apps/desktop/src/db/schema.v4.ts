/**
 * migration #4 的语句（TASK-T8-01 §2）：块正文进 FTS（「标题管道」→「标题+正文管道」）。
 *
 * 背景：v1 的 FTS 触发器只用 `json_extract(props_json,'$.title')` 聚合标题，
 * 而 text 类块的正文在 `content_json`（PM doc）的深层 `text` 键上——`json_extract`
 * 的路径表达式到不了不定深的数组/节点，因此 v4 统一改用 **json_tree** 抽取：
 * 遍历 content_json 的整棵 JSON 树，收集 `key = 'text'` 且值为字符串的节点。
 *
 * v4 做三件事（都在同一个迁移事务里，幂等）：
 *  1. DROP + 重建 6 个 FTS 触发器（page ai/au/ad、block ai/au/ad）——新触发器的
 *     重算子查询带上正文聚合（与 §1 的 `fts.syncBlock`、rebuild 的 FTS_RESYNC
 *     三条写入路径共用同一个 body 表达式，见 `ftsPageBodyExpr`）；
 *  2. FTS 全量回填（DELETE + INSERT），让既有存量库立刻获得正文索引；
 *  3. `meta.schema_version = '4'`（migrations.ts 的 applySchemaV4 负责）。
 *
 * 口径：
 * - **code 块正文不进 FTS**（纯文本单列过大）：body 聚合排除 `type = 'code'`，
 *   code 的检索由 `search:query` 的 LIKE 兜底覆盖（TASK-T8-01 §1/§2.3）；
 * - `content_json` 非 JSON（如 code 的纯文本串）或 NULL 时按 `{}` 处理（json_tree
 *   对非法 JSON 会直接抛错，必须 CASE 收口，口径同 statements.ts 的 relation.countTargets）。
 */

/**
 * 「某页」的 FTS body 聚合表达式（TASK-T8-01 §2.2）：
 * 该页全部存活、非 code 块的 [props.title + content 深层 text 串] 以空格拼接。
 * `pageIdExpr` 是页面 id 表达式（触发器上下文里如 `new.id`，语句里用 `p.id`）。
 * 供 v4 触发器、`fts.syncBlock` 白名单语句与 FTS_RESYNC 三处共用（单源）。
 */
export function ftsPageBodyExpr(pageIdExpr = 'p.id'): string {
  return `COALESCE((
    SELECT group_concat(parts.part, ' ')
    FROM (
      SELECT trim(
        COALESCE(json_extract(b.props_json, '$.title'), '') || ' ' ||
        COALESCE((
          SELECT group_concat(jt.value, ' ')
          FROM json_tree(CASE WHEN b.content_json IS NOT NULL AND json_valid(b.content_json) THEN b.content_json ELSE '{}' END) jt
          WHERE jt.key = 'text' AND jt.type = 'text'
        ), '')
      ) AS part
      FROM block b
      WHERE b.page_id = ${pageIdExpr} AND b.alive = 1 AND b.type != 'code'
    ) AS parts
  ), '')`;
}

/**
 * 重算「某页」的 FTS 行（v4 版，带正文）。`pageIdExpr` 是触发器上下文里的页面 id
 * 表达式（如 `new.page_id`）。page 行不在 / alive=0 时不插入（页不再被索引）。
 * 导出供 v6 迁移复用（TASK-T15-01：v6 重建六触发器时触发器体逐字保持 v4 逻辑，
 * 仅外层加 WHEN defer 守卫——表达式单源，避免两份手抄漂移）。
 */
export function refreshPageFtsV4(pageIdExpr: string): string {
  return [
    `DELETE FROM page_block_fts WHERE page_id = ${pageIdExpr};`,
    `INSERT INTO page_block_fts (title, body, page_id, workspace_id)`,
    `SELECT p.title, ${ftsPageBodyExpr('p.id')}, p.id, p.workspace_id`,
    `FROM page p`,
    `WHERE p.id = ${pageIdExpr} AND p.alive = 1;`,
  ].join('\n');
}

/** v4 重建的 6 个触发器（名字与 v1 相同：先 DROP 再 CREATE，保证旧定义被整体替换）。 */
export const SCHEMA_V4_TRIGGERS: readonly string[] = [
  `DROP TRIGGER IF EXISTS trg_page_fts_ai`,
  `DROP TRIGGER IF EXISTS trg_page_fts_au`,
  `DROP TRIGGER IF EXISTS trg_page_fts_ad`,
  `DROP TRIGGER IF EXISTS trg_block_fts_ai`,
  `DROP TRIGGER IF EXISTS trg_block_fts_au`,
  `DROP TRIGGER IF EXISTS trg_block_fts_ad`,

  `CREATE TRIGGER trg_page_fts_ai
AFTER INSERT ON page
WHEN new.alive = 1
BEGIN
  INSERT INTO page_block_fts (title, body, page_id, workspace_id)
  SELECT new.title, ${ftsPageBodyExpr('new.id')}, new.id, new.workspace_id;
END`,

  `CREATE TRIGGER trg_page_fts_au
AFTER UPDATE ON page
BEGIN
  DELETE FROM page_block_fts WHERE page_id = new.id;
  INSERT INTO page_block_fts (title, body, page_id, workspace_id)
  SELECT new.title, ${ftsPageBodyExpr('new.id')}, new.id, new.workspace_id
  WHERE new.alive = 1;
END`,

  `CREATE TRIGGER trg_page_fts_ad
AFTER DELETE ON page
BEGIN
  DELETE FROM page_block_fts WHERE page_id = old.id;
END`,

  `CREATE TRIGGER trg_block_fts_ai
AFTER INSERT ON block
BEGIN
  ${refreshPageFtsV4('new.page_id')}
END`,

  `CREATE TRIGGER trg_block_fts_au
AFTER UPDATE ON block
BEGIN
  ${refreshPageFtsV4('old.page_id')}
  ${refreshPageFtsV4('new.page_id')}
END`,

  `CREATE TRIGGER trg_block_fts_ad
AFTER DELETE ON block
BEGIN
  ${refreshPageFtsV4('old.page_id')}
END`,
];

/**
 * v4 的一次性回填（与 server.ts 的 FTS_RESYNC 同一 SQL 形状；server 侧那份是
 * 运行期 rebuild 复用的导出常量，这里只能内联——迁移语句必须自包含）。
 */
export const SCHEMA_V4_RESYNC_STATEMENTS: readonly string[] = [
  `DELETE FROM page_block_fts`,
  `INSERT INTO page_block_fts (title, body, page_id, workspace_id)
SELECT p.title, ${ftsPageBodyExpr('p.id')}, p.id, p.workspace_id
FROM page p
WHERE p.alive = 1`,
];

/** migration #4 的完整语句序列（逐条 `db.exec`；触发器语句自带 BEGIN..END）。 */
export const SCHEMA_V4_STATEMENTS: readonly string[] = [
  ...SCHEMA_V4_TRIGGERS,
  ...SCHEMA_V4_RESYNC_STATEMENTS,
];
