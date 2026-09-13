/**
 * DbServer 的 v1 建表 SQL（TASK-T2-01 §2，列定义照抄计划书 §6.2）。
 *
 * 设计要点：
 * - 除 FTS5 虚拟表外，**全部为 STRICT 表**（列类型必须显式、值类型强约束）；
 *   除计划书列出的字段外，不额外加列（“照抄”而非“发挥”）。
 * - 软删除用 `alive`（1 存活 / 0 已删），索引带 `WHERE alive = 1` 的部分索引。
 * - FTS 管道：`page_block_fts(title, body, page_id UNINDEXED, workspace_id UNINDEXED)`
 *   以 trigram 分词（支持中文子串），一行对应一个存活页面，由 page/block 写入
 *   触发器维护。**简化实现**：`title` 取 `page.title`，`body` 聚合该页存活块
 *   `json_extract(props_json,'$.title')`；完整正文（content_json -> text）索引留 M7。
 * - 本文件的语句只由 migration #1 执行；之后演进用 #2 起步，**禁止改 #1**。
 */

/**
 * 连接级 PRAGMA 基线。由 DbServer 在打开连接后立即执行（journal_mode 不可在事务内切换，
 * 因此不放进迁移）。
 */
export const PRAGMA_BASELINE: readonly string[] = [
  'journal_mode = WAL',
  'synchronous = NORMAL',
  'foreign_keys = ON',
  'busy_timeout = 5000',
];

// ---------------------------------------------------------------------------
// 建表
// ---------------------------------------------------------------------------

const TABLES: readonly string[] = [
  // 工作区
  `CREATE TABLE IF NOT EXISTS workspace (
    id TEXT PRIMARY KEY,
    name TEXT,
    root_page_id TEXT,
    settings_json TEXT,
    created_at INTEGER
  ) STRICT`,

  // 页面（块的宿主）
  `CREATE TABLE IF NOT EXISTS page (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    icon TEXT,
    cover TEXT,
    parent_id TEXT,
    sort_key TEXT NOT NULL,
    alive INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL,
    updated_at INTEGER
  ) STRICT`,

  // 内容块
  `CREATE TABLE IF NOT EXISTS block (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    type TEXT NOT NULL,
    props_json TEXT NOT NULL DEFAULT '{}',
    content_json TEXT,
    sort_key TEXT NOT NULL,
    alive INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL,
    lamport_c INTEGER NOT NULL,
    lamport_d TEXT NOT NULL,
    updated_at INTEGER
  ) STRICT`,

  // 数据库（行内数据库）定义
  `CREATE TABLE IF NOT EXISTS collection (
    id TEXT PRIMARY KEY,
    page_id TEXT,
    workspace_id TEXT NOT NULL,
    name TEXT,
    schema_json TEXT NOT NULL DEFAULT '{}',
    views_json TEXT NOT NULL DEFAULT '[]',
    alive INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL,
    lamport_c INTEGER NOT NULL,
    lamport_d TEXT NOT NULL,
    updated_at INTEGER
  ) STRICT`,

  // 数据库行
  `CREATE TABLE IF NOT EXISTS record (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    values_json TEXT NOT NULL DEFAULT '{}',
    sort_key TEXT NOT NULL,
    alive INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL,
    lamport_c INTEGER NOT NULL,
    lamport_d TEXT NOT NULL,
    updated_at INTEGER
  ) STRICT`,

  // 已重放事件账（真相层落库：op_json 为 core.encodeOp 的单行稳定 JSON）
  `CREATE TABLE IF NOT EXISTS op_ledger (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT NOT NULL UNIQUE,
    seg_id TEXT,
    lamport_c INTEGER NOT NULL,
    lamport_d TEXT NOT NULL,
    target_table TEXT NOT NULL,
    target_id TEXT NOT NULL,
    op_json TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT`,

  // 同步水位
  `CREATE TABLE IF NOT EXISTS sync_state (
    device_id TEXT PRIMARY KEY,
    last_lamport_c INTEGER NOT NULL DEFAULT 0,
    last_sync_ok INTEGER,
    pending_count INTEGER DEFAULT 0,
    conflict_count INTEGER DEFAULT 0,
    updated_at INTEGER
  ) STRICT`,

  // schema_version / installed_at / device_id
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT`,
];

// ---------------------------------------------------------------------------
// 索引
// ---------------------------------------------------------------------------

const INDEXES: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_page_parent ON page(workspace_id, parent_id) WHERE alive = 1`,
  `CREATE INDEX IF NOT EXISTS idx_block_page ON block(page_id) WHERE alive = 1`,
  `CREATE INDEX IF NOT EXISTS idx_block_lru ON block(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_record_coll ON record(collection_id) WHERE alive = 1`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_lamport ON op_ledger(lamport_c, lamport_d)`,
];

// ---------------------------------------------------------------------------
// FTS5 虚拟表
// ---------------------------------------------------------------------------

const FTS_TABLE: readonly string[] = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS page_block_fts USING fts5(
    title,
    body,
    page_id UNINDEXED,
    workspace_id UNINDEXED,
    tokenize = 'trigram'
  )`,
];

// ---------------------------------------------------------------------------
// FTS 维护触发器（AFTER INSERT/UPDATE/DELETE，只在存活行上生效）
// ---------------------------------------------------------------------------

/**
 * 重算「某页」的 FTS 行：先删旧行，再从 page + 该页存活块标题重插。
 * `pageIdExpr` 是触发器上下文里的页面 id 表达式（如 `new.page_id`）。
 * page 行不在 / alive=0 时不插入（页不再被索引）。
 */
function refreshPageFts(pageIdExpr: string): string {
  return [
    `DELETE FROM page_block_fts WHERE page_id = ${pageIdExpr};`,
    `INSERT INTO page_block_fts (title, body, page_id, workspace_id)`,
    `SELECT p.title, COALESCE((`,
    `    SELECT group_concat(json_extract(b.props_json, '$.title'), ' ')`,
    `    FROM block b`,
    `    WHERE b.page_id = p.id AND b.alive = 1 AND json_valid(b.props_json)`,
    `      AND json_extract(b.props_json, '$.title') IS NOT NULL`,
    `  ), ''), p.id, p.workspace_id`,
    `FROM page p`,
    `WHERE p.id = ${pageIdExpr} AND p.alive = 1;`,
  ].join('\n');
}

const TRIGGERS: readonly string[] = [
  // 新建存活页面：登记一行（body 暂时为空，随后由 block 触发器补齐）
  `CREATE TRIGGER IF NOT EXISTS trg_page_fts_ai
AFTER INSERT ON page
WHEN new.alive = 1
BEGIN
  INSERT INTO page_block_fts (title, body, page_id, workspace_id)
  VALUES (new.title, '', new.id, new.workspace_id);
END`,

  // 页面更新：删除重建（标题可能变；alive 变 0 时不再插入）
  `CREATE TRIGGER IF NOT EXISTS trg_page_fts_au
AFTER UPDATE ON page
BEGIN
  DELETE FROM page_block_fts WHERE page_id = new.id;
  INSERT INTO page_block_fts (title, body, page_id, workspace_id)
  SELECT new.title, COALESCE((
      SELECT group_concat(json_extract(b.props_json, '$.title'), ' ')
      FROM block b
      WHERE b.page_id = new.id AND b.alive = 1 AND json_valid(b.props_json)
        AND json_extract(b.props_json, '$.title') IS NOT NULL
    ), ''), new.id, new.workspace_id
  WHERE new.alive = 1;
END`,

  // 页面删除：移除索引行
  `CREATE TRIGGER IF NOT EXISTS trg_page_fts_ad
AFTER DELETE ON page
BEGIN
  DELETE FROM page_block_fts WHERE page_id = old.id;
END`,

  // 块新增 / 删除：重算所属页
  `CREATE TRIGGER IF NOT EXISTS trg_block_fts_ai
AFTER INSERT ON block
BEGIN
  ${refreshPageFts('new.page_id')}
END`,

  `CREATE TRIGGER IF NOT EXISTS trg_block_fts_ad
AFTER DELETE ON block
BEGIN
  ${refreshPageFts('old.page_id')}
END`,

  // 块更新：同时刷新旧页与新页（page_id 可能变化）
  `CREATE TRIGGER IF NOT EXISTS trg_block_fts_au
AFTER UPDATE ON block
BEGIN
  ${refreshPageFts('old.page_id')}
  ${refreshPageFts('new.page_id')}
END`,
];

/**
 * migration #1 的完整语句序列（每条为一条可独立 `db.exec` 的 SQL）。
 * 全部带 `IF NOT EXISTS`，使 `up` 天然幂等。
 */
export const SCHEMA_V1_STATEMENTS: readonly string[] = [
  ...TABLES,
  ...INDEXES,
  ...FTS_TABLE,
  ...TRIGGERS,
];

/** 测试/自检用的表名清单（与计划书 §6.2 对齐）。 */
export const SCHEMA_V1_TABLES: readonly string[] = [
  'workspace',
  'page',
  'block',
  'collection',
  'record',
  'op_ledger',
  'sync_state',
  'meta',
];
