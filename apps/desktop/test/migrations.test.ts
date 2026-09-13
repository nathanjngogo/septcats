import { describe, expect, it } from 'vitest';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  applyPragmaBaseline,
  migrate,
  readUserVersion,
  runMigrations,
  type Migration,
  type SqliteDatabase,
} from '../src/db/migrations';
import { PRAGMA_BASELINE, SCHEMA_V1_STATEMENTS, SCHEMA_V1_TABLES } from '../src/db/schema.sql';
import { describeDb, makeTempDb } from './helpers';

describe('MIGRATIONS 表', () => {
  it('id 从 1 起连续递增', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    const ids = MIGRATIONS.map((migration) => migration.id);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_value, index) => index + 1));
  });

  it('每条的 name 非空、up 是函数', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.name.length).toBeGreaterThan(0);
      expect(typeof migration.up).toBe('function');
    }
  });

  it('LATEST_SCHEMA_VERSION 等于最后一条迁移 id', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.id);
    expect(LATEST_SCHEMA_VERSION).toBe(1);
  });
});

describe('schema.sql.ts', () => {
  it('覆盖计划书 §6.2 的全部实体表', () => {
    const sql = SCHEMA_V1_STATEMENTS.join('\n');
    for (const table of SCHEMA_V1_TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} `);
    }
  });

  it('实体表全部 STRICT，且 FTS 用 fts5 + trigram', () => {
    const entityDdl = SCHEMA_V1_STATEMENTS.filter((statement) => statement.includes('CREATE TABLE'));
    for (const statement of entityDdl) {
      expect(statement).toContain('STRICT');
    }
    const sql = SCHEMA_V1_STATEMENTS.join('\n');
    expect(sql).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS page_block_fts USING fts5');
    expect(sql).toContain("tokenize = 'trigram'");
  });

  it('包含 FTS 维护触发器与部分索引', () => {
    const sql = SCHEMA_V1_STATEMENTS.join('\n');
    expect(sql).toContain('trg_page_fts_ai');
    expect(sql).toContain('trg_page_fts_au');
    expect(sql).toContain('trg_page_fts_ad');
    expect(sql).toContain('trg_block_fts_ai');
    expect(sql).toContain('trg_block_fts_au');
    expect(sql).toContain('trg_block_fts_ad');
    expect(sql).toContain('idx_page_parent');
    expect(sql).toContain('idx_block_page');
    expect(sql).toContain('idx_block_lru');
    expect(sql).toContain('idx_record_coll');
    expect(sql).toContain('idx_ledger_lamport');
    expect(sql).toContain('WHERE alive = 1');
  });

  it('PRAGMA 基线含 WAL / NORMAL / 外键 / busy_timeout', () => {
    const pragmas = PRAGMA_BASELINE.join('\n').toLowerCase();
    expect(pragmas).toContain('journal_mode = wal');
    expect(pragmas).toContain('synchronous = normal');
    expect(pragmas).toContain('foreign_keys = on');
    expect(pragmas).toContain('busy_timeout = 5000');
  });
});

describeDb('migrate（better-sqlite3 直连）', (ctor) => {
  it('全新库迁移到 v1：建表 + user_version + meta 基线', async () => {
    const temp = makeTempDb('septcats-migrate');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      expect(readUserVersion(db)).toBe(0);

      const result = await migrate(db);
      expect(result.from).toBe(0);
      expect(result.to).toBe(1);
      expect(result.applied).toEqual([1]);
      expect(result.recovery).toBe('none');
      expect(result.error).toBeUndefined();
      expect(readUserVersion(db)).toBe(1);

      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>;
      const names = tables.map((row) => row.name);
      for (const table of SCHEMA_V1_TABLES) {
        expect(names).toContain(table);
      }
      expect(names).toContain('page_block_fts');

      const meta = db.prepare(`SELECT key FROM meta ORDER BY key`).all() as Array<{ key: string }>;
      expect(meta.map((row) => row.key).sort()).toEqual(['device_id', 'installed_at', 'schema_version']);
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('幂等：第二次迁移不再应用任何东西', async () => {
    const temp = makeTempDb('septcats-migrate2');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      await migrate(db);
      const again = await migrate(db);
      expect(again.from).toBe(1);
      expect(again.to).toBe(1);
      expect(again.applied).toEqual([]);
      expect(again.backupPath).toBeNull();
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('迁移前备份到 <db>.bak-v<from>', async () => {
    const temp = makeTempDb('septcats-backup');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      const result = await migrate(db);
      expect(result.backupPath).toBe(`${temp.path}.bak-v0`);
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('迁移失败：文件级还原，库保持原版本且新连接可用', async () => {
    const temp = makeTempDb('septcats-restore');
    const db = new ctor(temp.path);
    let working: SqliteDatabase = db;
    try {
      applyPragmaBaseline(db);
      await migrate(db);

      const boom: Migration = {
        id: 999,
        name: 'boom',
        up: (target) => {
          target.exec('CREATE TABLE boom (x TEXT)');
          throw new Error('boom');
        },
      };
      const result = await runMigrations(db, [...MIGRATIONS, boom]);
      working = result.db;

      expect(result.error?.code).toBe('E_MIGRATION_FAILED');
      expect(result.error?.message).toContain('boom');
      expect(result.recovery).toBe('restored');
      expect(result.backupPath).toBe(`${temp.path}.bak-v1`);
      expect(readUserVersion(result.db)).toBe(1);

      const leftovers = result.db
        .prepare(`SELECT name FROM sqlite_master WHERE name = 'boom'`)
        .all() as Array<{ name: string }>;
      expect(leftovers).toHaveLength(0);

      // 还原后的连接必须是可用的
      const meta = result.db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
        | { value: string }
        | undefined;
      expect(meta?.value).toBe('1');
    } finally {
      working.close();
      temp.cleanup();
    }
  });

  it('backup:false 时失败仅靠事务回滚（recovery=rolled-back）', async () => {
    const temp = makeTempDb('septcats-nobackup');
    const db = new ctor(temp.path);
    let working: SqliteDatabase = db;
    try {
      applyPragmaBaseline(db);
      await migrate(db);
      const boom: Migration = {
        id: 999,
        name: 'boom',
        up: () => {
          throw new Error('boom');
        },
      };
      const result = await runMigrations(db, [...MIGRATIONS, boom], { backup: false });
      working = result.db;
      expect(result.backupPath).toBeNull();
      expect(result.recovery).toBe('rolled-back');
      expect(readUserVersion(result.db)).toBe(1);
    } finally {
      working.close();
      temp.cleanup();
    }
  });
});
