/**
 * 版本化迁移框架（TASK-T2-01 §4）。
 *
 * 规则：
 * - `user_version` 是唯一进度来源；`MIGRATIONS` 按 id 升序应用，只跑 > 当前版本的部分；
 * - 每个迁移在**自己的事务**里执行（SQLite 的 DDL 是事务性的），任一步失败自动回滚；
 * - 迁移前先 `PRAGMA wal_checkpoint(TRUNCATE)` 并备份到 `<db>.bak-v<from>`；
 * - 失败时做**文件级还原**：关闭连接 → 用备份覆盖主库（清掉 -wal/-shm）→ 重新打开新连接，
 *   并把新连接放进返回值 `db`（better-sqlite3 关闭后无法再 open，只能新建实例——见 §DECISIONS）。
 * - `schema.sql.ts` 即 migration #1；以后加列从 #2 起步，**禁止改 #1**。
 */

import { copyFileSync, existsSync, rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { ulid } from '@septcats/core';
import { PRAGMA_BASELINE, SCHEMA_V1_STATEMENTS } from './schema.sql';
import {
  SCHEMA_V2_ADDED_COLUMNS,
  SCHEMA_V2_INDEXES,
  SCHEMA_V2_STATEMENTS,
  SCHEMA_V3_ADDED_COLUMNS,
  SCHEMA_V3_INDEXES,
} from './schema.v2';
import { SCHEMA_V4_STATEMENTS } from './schema.v4';
import { SCHEMA_V5_STATEMENTS } from './schema.v5';
import { SCHEMA_V6_STATEMENTS } from './schema.v6';

/** better-sqlite3 的连接类型（只做类型引用，不在本模块顶层加载原生模块）。 */
export type SqliteDatabase = Database.Database;

/** 构造一个连接的最小构造签名（测试/自检注入 better-sqlite3 的真实构造器）。 */
export interface SqliteConstructor {
  new (filename: string): SqliteDatabase;
}

/** 单条迁移：`up` 必须幂等（内部全用 IF NOT EXISTS / ON CONFLICT）。 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  up(db: SqliteDatabase): void;
}

/** 迁移结果里描述的“失败后如何收场”。 */
export type MigrationRecovery = 'none' | 'restored' | 'rolled-back' | 'failed';

export interface MigrationFailure {
  readonly code: 'E_MIGRATION_FAILED';
  readonly message: string;
}

export interface MigrateResult {
  /** 应用前的 user_version。 */
  readonly from: number;
  /** 应用后（或失败回滚后）的 user_version。 */
  readonly to: number;
  /** 本次实际应用的迁移 id（失败时为空）。 */
  readonly applied: readonly number[];
  /** 迁移前备份文件路径；内存库或 `backup:false` 时为 null。 */
  readonly backupPath: string | null;
  /** 失败收场方式；成功为 'none'。 */
  readonly recovery: MigrationRecovery;
  /** 失败信息；成功时缺省。 */
  readonly error?: MigrationFailure;
  /**
   * 当前可用连接。正常情况就是入参 db；若发生文件级还原则为**新连接**，
   * 调用方必须改用它（旧连接已 close）。
   */
  readonly db: SqliteDatabase;
}

export interface MigrateOptions {
  /** 是否在迁移前备份（默认 true；仅对文件型数据库生效）。 */
  readonly backup?: boolean;
}

// ---------------------------------------------------------------------------
// PRAGMA 基线
// ---------------------------------------------------------------------------

/** 在连接打开后立即执行 PRAGMA 基线（journal_mode 不可在事务内切换，故不进迁移）。 */
export function applyPragmaBaseline(db: SqliteDatabase): void {
  for (const pragma of PRAGMA_BASELINE) {
    db.pragma(pragma);
  }
}

// ---------------------------------------------------------------------------
// 迁移表
// ---------------------------------------------------------------------------

/** migration #1：v1 建表 + FTS + 触发器，并写入 meta 基线。 */
function applySchemaV1(db: SqliteDatabase): void {
  for (const statement of SCHEMA_V1_STATEMENTS) {
    db.exec(statement);
  }
  insertMetaIfAbsent(db, 'schema_version', '1');
  insertMetaIfAbsent(db, 'installed_at', String(Date.now()));
  insertMetaIfAbsent(db, 'device_id', ulid());
}

function insertMetaIfAbsent(db: SqliteDatabase, key: string, value: string): void {
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

function setMeta(db: SqliteDatabase, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

/** 表上是否已有该列（`PRAGMA table_info`；表名来自内部常量，无注入面）。 */
function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name?: unknown }>;
  return rows.some((row) => row.name === column);
}

/**
 * migration #2：v2 追加表/列/索引。
 *
 * 幂等性来源：建表与建索引走 `IF NOT EXISTS`；加列走 `PRAGMA table_info` 存在性判断
 * （`ALTER TABLE ADD COLUMN` 在 SQLite 里不可重复执行，也没有 `IF NOT EXISTS`）。
 * STRICT 表原生支持 ADD COLUMN（better-sqlite3 12 捆绑的 SQLite ≥ 3.45），
 * 因此不必走「建新表→拷数据→改名」三步。
 */
function applySchemaV2(db: SqliteDatabase): void {
  for (const statement of SCHEMA_V2_STATEMENTS) {
    db.exec(statement);
  }
  for (const column of SCHEMA_V2_ADDED_COLUMNS) {
    if (!hasColumn(db, column.table, column.column)) {
      db.exec(column.sql);
    }
  }
  for (const statement of SCHEMA_V2_INDEXES) {
    db.exec(statement);
  }
  setMeta(db, 'schema_version', '2');
}

/**
 * migration #3：`record.backlinks_json`（relation 反链索引，TASK-T7-01 §2）。
 *
 * 幂等性与 #2 同：加列走 `PRAGMA table_info` 存在性判断，索引走 `IF NOT EXISTS`。
 * 不加新表——collection/record 表在 v1 已就位，本任务只需这一列。
 */
function applySchemaV3(db: SqliteDatabase): void {
  for (const column of SCHEMA_V3_ADDED_COLUMNS) {
    if (!hasColumn(db, column.table, column.column)) {
      db.exec(column.sql);
    }
  }
  for (const statement of SCHEMA_V3_INDEXES) {
    db.exec(statement);
  }
  setMeta(db, 'schema_version', '3');
}

/**
 * migration #4：v4 FTS 正文管道（TASK-T8-01 §2）。
 *
 * 幂等性：触发器先 DROP IF EXISTS 再 CREATE（整体替换 v1 定义），回填是
 * DELETE + INSERT（可重复执行）。语句序列见 `schema.v4.ts`：
 * 触发器重建 → FTS 全量回填 → meta.schema_version = '4'。
 */
function applySchemaV4(db: SqliteDatabase): void {
  for (const statement of SCHEMA_V4_STATEMENTS) {
    db.exec(statement);
  }
  setMeta(db, 'schema_version', '4');
}

/**
 * migration #5：导入幂等表 `import_source`（TASK-T11-01 §0.5，M12 导入器）。
 *
 * 幂等性：建表走 `IF NOT EXISTS`（无加列/索引，语句自含主键）。语句见 `schema.v5.ts`。
 */
function applySchemaV5(db: SqliteDatabase): void {
  for (const statement of SCHEMA_V5_STATEMENTS) {
    db.exec(statement);
  }
  setMeta(db, 'schema_version', '5');
}

/**
 * migration #6：FTS 触发器 defer 守卫（TASK-T15-01，性能红牌 #30 修复）。
 *
 * 幂等性：fts_defer 建表走 IF NOT EXISTS + 初始行 NOT EXISTS 守卫 + 复位 UPDATE
 * （可重复执行）；触发器先 DROP IF EXISTS 再 CREATE（整体替换 v4 定义，触发器体
 * 逐字保持、仅外层加 WHEN 守卫），口径同 #4。语句见 `schema.v6.ts`。
 */
function applySchemaV6(db: SqliteDatabase): void {
  for (const statement of SCHEMA_V6_STATEMENTS) {
    db.exec(statement);
  }
  setMeta(db, 'schema_version', '6');
}

/**
 * 全部迁移，按 id 升序。**只允许追加**，不允许修改已发布的条目
 * （改了会让已升级用户的库与代码描述不一致）。
 */
export const MIGRATIONS: readonly Migration[] = [
  { id: 1, name: 'v1-schema', up: applySchemaV1 },
  { id: 2, name: 'v2-page-tree', up: applySchemaV2 },
  { id: 3, name: 'v3-record-backlinks', up: applySchemaV3 },
  { id: 4, name: 'v4-block-body-fts', up: applySchemaV4 },
  { id: 5, name: 'v5-import-source', up: applySchemaV5 },
  { id: 6, name: 'v6-fts-defer', up: applySchemaV6 },
];

/** 最新 schema 版本 = 迁移表最后一项的 id。 */
export const LATEST_SCHEMA_VERSION: number =
  MIGRATIONS.length === 0 ? 0 : MIGRATIONS[MIGRATIONS.length - 1]!.id;

// ---------------------------------------------------------------------------
// user_version 读写
// ---------------------------------------------------------------------------

/** 读取 `PRAGMA user_version`（非整数一律按 0 处理）。 */
export function readUserVersion(db: SqliteDatabase): number {
  const value = db.pragma('user_version', { simple: true });
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return 0;
}

function writeUserVersion(db: SqliteDatabase, version: number): void {
  // version 来自内部迁移表（整数），不存在注入面
  db.pragma(`user_version = ${Math.trunc(version)}`);
}

// ---------------------------------------------------------------------------
// 迁移主流程
// ---------------------------------------------------------------------------

/** 用默认迁移表迁移。 */
export function migrate(db: SqliteDatabase, options: MigrateOptions = {}): Promise<MigrateResult> {
  return runMigrations(db, MIGRATIONS, options);
}

/**
 * 用给定迁移表迁移（暴露出来是为了能在测试里注入“必然失败的迁移”验证还原路径）。
 */
export async function runMigrations(
  db: SqliteDatabase,
  migrations: readonly Migration[],
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const from = readUserVersion(db);
  const pending = [...migrations].filter((migration) => migration.id > from).sort((a, b) => a.id - b.id);
  if (pending.length === 0) {
    return { from, to: from, applied: [], backupPath: null, recovery: 'none', db };
  }
  const target = pending[pending.length - 1]!.id;

  const backupPath = options.backup === false ? null : await createPreMigrationBackup(db, from);

  try {
    for (const migration of pending) {
      const apply = db.transaction(() => {
        migration.up(db);
        writeUserVersion(db, migration.id);
      });
      apply();
    }
  } catch (error) {
    const reason = describeError(error);
    const outcome = await tryFileLevelRestore(db, backupPath);
    const suffix =
      outcome.recovery === 'restored'
        ? '（已从备份文件还原）'
        : outcome.recovery === 'rolled-back'
          ? '（事务已回滚，库保持原版本）'
          : '（文件级还原失败，请人工检查备份）';
    return {
      from,
      to: readUserVersionSafe(outcome.db),
      applied: [],
      backupPath,
      recovery: outcome.recovery,
      error: { code: 'E_MIGRATION_FAILED', message: `迁移 v${from}→v${target} 失败：${reason}${suffix}` },
      db: outcome.db,
    };
  }

  return { from, to: target, applied: pending.map((migration) => migration.id), backupPath, recovery: 'none', db };
}

// ---------------------------------------------------------------------------
// 备份 / 还原
// ---------------------------------------------------------------------------

function isFileDatabase(name: string): boolean {
  return name.length > 0 && name !== ':memory:';
}

function removeFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // 删除失败不致命：后续 backup/rename 会给出真实错误
  }
}

/** 连同 -wal / -shm 一起清理，避免还原后残留半写日志污染新库。 */
function removeSidecarFiles(dbPath: string): void {
  removeFile(`${dbPath}-wal`);
  removeFile(`${dbPath}-shm`);
}

/**
 * 迁移前备份：checkpoint(TRUNCATE) 后调用 better-sqlite3 的 backup API。
 * 内存库返回 null（没有可备份的文件）。
 */
async function createPreMigrationBackup(db: SqliteDatabase, from: number): Promise<string | null> {
  const dbPath = db.name;
  if (!isFileDatabase(dbPath)) {
    return null;
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // 非 WAL 模式或空库时忽略
  }
  const backupPath = `${dbPath}.bak-v${from}`;
  removeFile(backupPath);
  removeSidecarFiles(backupPath);
  await db.backup(backupPath);
  return backupPath;
}

interface RestoreOutcome {
  readonly recovery: MigrationRecovery;
  readonly db: SqliteDatabase;
}

/**
 * 文件级还原：close → 备份覆盖主库 → 新建连接。
 * 备份不可用时返回 'rolled-back'（此时事务回滚已保证库完好）。
 */
async function tryFileLevelRestore(
  db: SqliteDatabase,
  backupPath: string | null,
): Promise<RestoreOutcome> {
  const dbPath = db.name;
  if (backupPath === null || !isFileDatabase(dbPath) || !existsSync(backupPath)) {
    return { recovery: 'rolled-back', db };
  }
  try {
    db.close();
    removeSidecarFiles(dbPath);
    copyFileSync(backupPath, dbPath);
    return { recovery: 'restored', db: await reopenDatabase(dbPath) };
  } catch {
    // 还原途中出错：尽量把原文件重新打开，保证调用方仍有可用连接
    try {
      return { recovery: 'failed', db: await reopenDatabase(dbPath) };
    } catch {
      return { recovery: 'failed', db };
    }
  }
}

function readUserVersionSafe(db: SqliteDatabase): number {
  try {
    return readUserVersion(db);
  } catch {
    return 0;
  }
}

/**
 * 动态加载 better-sqlite3 的构造器。用动态 import 是为了：
 * 1) 本模块顶层零原生依赖——纯逻辑测试 import 本文件时不会触发原生模块加载；
 * 2) 兼容两种互操作形态：Node ESM 下动态 import CJS 得到 `{ default: ctor }`，
 *    而个别打包产物可能直接给出构造器本身。
 */
export async function loadSqliteConstructor(): Promise<SqliteConstructor> {
  const imported: unknown = await import('better-sqlite3');
  if (
    typeof imported === 'object' &&
    imported !== null &&
    typeof (imported as { default?: unknown }).default === 'function'
  ) {
    return (imported as { default: SqliteConstructor }).default;
  }
  return imported as SqliteConstructor;
}

/** 重新打开连接（文件级还原后使用）。 */
async function reopenDatabase(dbPath: string): Promise<SqliteDatabase> {
  const SqliteCtor = await loadSqliteConstructor();
  const next = new SqliteCtor(dbPath);
  applyPragmaBaseline(next);
  return next;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
