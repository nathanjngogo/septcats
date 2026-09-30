/**
 * migration #11 的语句（TASK-T97-01 日历 · TASK-T98-01 待办）。
 *
 * 纪律（同 v9/v10）：
 * - **禁止改 #1..#10**（均已发布），v11 只做纯新增（建表，`IF NOT EXISTS`）；
 * - 两表均为**设备本地派生态**：日历事件与待办条目只落本机，不进 Op 真相层、不随同步发布
 *   （与 page_lock / block_cipher 同口径）；
 * - 无外键级联：条目独立于页面存在，删页不影响它们。
 *
 * 列集以 docs/PRD-日历与待办.md 为唯一真相：
 *   calendar_event(id PK, title, start_at, end_at, all_day, note, created_at, updated_at)
 *   todo_item(id PK, title, done, due_at, priority, note, created_at, updated_at)
 * 时间列一律 epoch 毫秒（INTEGER）；`due_at` 允许 NULL（无截止）。
 */

/** v11 建表语句（STRICT，范式同 v5/v7/v9/v10）。 */
export const SCHEMA_V11_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS calendar_event (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    start_at   INTEGER NOT NULL,
    end_at     INTEGER NOT NULL,
    all_day    INTEGER NOT NULL DEFAULT 0,
    note       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS idx_calendar_event_start ON calendar_event(start_at)`,
  `CREATE TABLE IF NOT EXISTS todo_item (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    due_at     INTEGER,
    priority   TEXT NOT NULL DEFAULT 'mid',
    note       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS idx_todo_item_done_due ON todo_item(done, due_at)`,
];
