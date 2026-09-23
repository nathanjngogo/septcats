/**
 * migration #10 的语句（TASK-T67-01-B1-01 · 页面密码锁后端核心）。
 *
 * 纪律（同 v9）：
 * - **禁止改 #1..#9**（均已发布），v10 只做纯新增（建表，IF NOT EXISTS）；
 * - 两表均为**设备本地派生态**：page_lock 存 KDF 盐 / 校验密文 / 双包络的 DK 密文 /
 *   限速计数；block_cipher 存锁页正文块的整页密文（粒度=页，format=1）。
 *   二者不进 Op 真相层、不随同步发布（密码锁是本地隐私，非协作实体）。
 * - 无外键级联：页面删除/回收站流由应用层 `pages.deletePage` 连带清锁（见 main/lock.ts purgeLockForPage）。
 *
 * 列集以 B1-01 v2 为唯一真相：
 *   page_lock(page_id PK, kdf_salt BLOB, verifier BLOB, recovery_verifier BLOB,
 *             wrapped_key BLOB, failures INTEGER DEFAULT 0, locked_until INTEGER NULL, updated_at INTEGER)
 *   block_cipher(page_id PK, blob BLOB, format INTEGER DEFAULT 1, updated_at INTEGER)
 */

/** v10 建表语句（STRICT，范式同 v5/v7/v9）。 */
export const SCHEMA_V10_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS page_lock (
    page_id       TEXT PRIMARY KEY,
    kdf_salt      BLOB NOT NULL,
    verifier      BLOB NOT NULL,
    recovery_verifier BLOB NOT NULL,
    wrapped_key   BLOB NOT NULL,
    failures      INTEGER NOT NULL DEFAULT 0,
    locked_until  INTEGER NULL,
    updated_at    INTEGER NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS block_cipher (
    page_id    TEXT PRIMARY KEY,
    blob       BLOB NOT NULL,
    format     INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  ) STRICT`,
];

/** 测试/自检用：v10 追加的表名清单。 */
export const SCHEMA_V10_TABLES: readonly string[] = ['page_lock', 'block_cipher'];
