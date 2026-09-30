import { describe, expect, it } from 'vitest';

const MIGRATION_IDS = MIGRATIONS.map((migration) => migration.id);
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
import {
  SCHEMA_V2_ADDED_COLUMNS,
  SCHEMA_V2_INDEXES,
  SCHEMA_V2_STATEMENTS,
  SCHEMA_V2_TABLES,
  SCHEMA_V3_ADDED_COLUMNS,
  SCHEMA_V3_INDEXES,
} from '../src/db/schema.v2';
import { SCHEMA_V4_TRIGGERS, ftsPageBodyExpr } from '../src/db/schema.v4';
import { SCHEMA_V5_STATEMENTS, SCHEMA_V5_TABLES } from '../src/db/schema.v5';
import {
  FTS_DEFER_GUARD_EXPR,
  SCHEMA_V6_STATEMENTS,
  SCHEMA_V6_TABLES,
  SCHEMA_V6_TRIGGER_NAMES,
  SCHEMA_V6_TRIGGERS,
} from '../src/db/schema.v6';
import { describeDb, makeTempDb } from './helpers';

/** 列表化表/列，做结构断言。 */
function tableNames(db: SqliteDatabase): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function columnNames(db: SqliteDatabase, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name?: unknown }>)
    .map((row) => row.name)
    .filter((name): name is string => typeof name === 'string');
}

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
    // TASK-T15-01：版本断言一律 LATEST_SCHEMA_VERSION 参数化，不硬编码 id；
    // 最新迁移语义由名称锁死（前值 v10-page-lock 逐次顺延）
        // DEVIATION D2：追加 #10 后末条名随动为 v10-page-lock（原写死 v9-page-link-index 已更新）。
        // DEVIATION D3：追加 #11（T97-01 日历 / T98-01 待办）后末条名随动为 v11-calendar-todo。
        expect(MIGRATIONS[MIGRATIONS.length - 1]!.name).toBe('v11-calendar-todo');
  });

  it('#1..#5 未被改动：v1 仍是建表语句，v2/v3 只做追加，v4 只重建触发器+回填，v5 只建导入表', () => {
    expect(MIGRATIONS[0]!.name).toBe('v1-schema');
    expect(MIGRATIONS[1]!.name).toBe('v2-page-tree');
    expect(MIGRATIONS[2]!.name).toBe('v3-record-backlinks');
    expect(MIGRATIONS[3]!.name).toBe('v4-block-body-fts');
    expect(MIGRATIONS[4]!.name).toBe('v5-import-source');
    expect(MIGRATIONS[5]!.name).toBe('v6-fts-defer');
    // v2 不碰 v1 的语句集：两批语句无交集
    const v1 = new Set(SCHEMA_V1_STATEMENTS);
    for (const statement of SCHEMA_V2_STATEMENTS) {
      expect(v1.has(statement)).toBe(false);
    }
    // v3 只有加列/索引，不重复 v2 的加列目标
    const v2Columns = new Set(SCHEMA_V2_ADDED_COLUMNS.map((column) => `${column.table}.${column.column}`));
    for (const column of SCHEMA_V3_ADDED_COLUMNS) {
      expect(v2Columns.has(`${column.table}.${column.column}`)).toBe(false);
    }
  });
});

describe('schema.v2.ts', () => {
  it('三张本地表（favorite/recent/mention）全部 STRICT 且带复合主键', () => {
    const sql = SCHEMA_V2_STATEMENTS.join('\n');
    for (const table of SCHEMA_V2_TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} `);
    }
    expect(SCHEMA_V2_STATEMENTS.every((statement) => statement.includes('STRICT'))).toBe(true);
    expect(sql.match(/PRIMARY KEY \(user_key, page_id\)/g)?.length).toBe(2);
    expect(sql).toContain('PRIMARY KEY (source_page_id, target_page_id)');
  });

  it('两条 v2 索引（最近打开倒序 / 存活页按工作区）', () => {
    const sql = SCHEMA_V2_INDEXES.join('\n');
    expect(sql).toContain('idx_recent_user ON recent(user_key, last_opened DESC)');
    expect(sql).toContain('idx_page_ws_live ON page(workspace_id) WHERE deleted_at IS NULL');
  });
});

describe('schema.v2.ts（v3 追加）', () => {
  it('v3 只追加 record.backlinks_json（relation 反链索引，设备本地）', () => {
    expect(SCHEMA_V3_ADDED_COLUMNS).toHaveLength(1);
    expect(SCHEMA_V3_ADDED_COLUMNS[0]?.table).toBe('record');
    expect(SCHEMA_V3_ADDED_COLUMNS[0]?.column).toBe('backlinks_json');
    expect(SCHEMA_V3_ADDED_COLUMNS[0]?.sql).toContain('ALTER TABLE record ADD COLUMN backlinks_json');
    expect(SCHEMA_V3_INDEXES.join('\n')).toContain('idx_record_backlinks');
  });
});

describe('schema.v4.ts（M7 块正文 FTS）', () => {
  it('重建全部 6 个 v1 FTS 触发器（先 DROP 再 CREATE）', () => {
    const sql = SCHEMA_V4_TRIGGERS.join('\n');
    for (const name of ['trg_page_fts_ai', 'trg_page_fts_au', 'trg_page_fts_ad', 'trg_block_fts_ai', 'trg_block_fts_au', 'trg_block_fts_ad']) {
      expect(sql).toContain(`DROP TRIGGER IF EXISTS ${name}`);
      expect(sql).toContain(`CREATE TRIGGER ${name}`);
    }
  });

  it('body 聚合用 json_tree 抽深层 text 键，且排除 code 块', () => {
    const body = ftsPageBodyExpr('p.id');
    expect(body).toContain('json_tree');
    expect(body).toContain("jt.key = 'text'");
    expect(body).toContain("b.type != 'code'");
    expect(body).toContain('b.page_id = p.id');
    // pageIdExpr 参数化：触发器上下文可传 new.id
    expect(ftsPageBodyExpr('new.id')).toContain('b.page_id = new.id');
  });

  it('迁移语句不含 PRAGMA/DROP TABLE 等越权片段（DROP 仅限触发器重建）', () => {
    const sql = SCHEMA_V4_TRIGGERS.join('\n');
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('DROP INDEX');
    for (const forbidden of ['PRAGMA', 'ATTACH', 'ALTER']) {
      expect(sql.toUpperCase()).not.toContain(forbidden);
    }
  });
});

describe('schema.v5.ts（M12 导入幂等表）', () => {
  it('import_source：单表 STRICT，(source_path, content_hash) 联合主键，无多余索引', () => {
    expect(SCHEMA_V5_TABLES).toEqual(['import_source']);
    const sql = SCHEMA_V5_STATEMENTS.join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS import_source');
    expect(sql).toContain('STRICT');
    expect(sql).toContain('PRIMARY KEY (source_path, content_hash)');
    for (const column of ['source_path TEXT NOT NULL', 'content_hash TEXT NOT NULL', 'page_id TEXT NOT NULL', 'created_at INTEGER NOT NULL']) {
      expect(sql).toContain(column);
    }
    // 不越权：迁移里没有索引/DROP/PRAGMA 片段
    expect(sql).not.toContain('CREATE INDEX');
    expect(sql).not.toContain('DROP');
    expect(sql.toUpperCase()).not.toContain('PRAGMA');
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

describeDb('migrate v5（import_source · better-sqlite3 直连）', (ctor) => {
  it('全新库迁移到最新：import_source 到位，列序与主键正确（版本参数化）', async () => {
    const temp = makeTempDb('septcats-migrate-v5');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      const result = await migrate(db);
      expect(result.from).toBe(0);
      expect(result.to).toBe(LATEST_SCHEMA_VERSION);
      expect(result.applied).toEqual(MIGRATION_IDS);
      expect(tableNames(db)).toContain('import_source');
      const info = db.pragma('table_info(import_source)') as Array<{ name: string; pk: number }>;
      expect(info.map((column) => column.name)).toEqual([
        'source_path',
        'content_hash',
        'page_id',
        'created_at',
      ]);
      const pkColumns = info.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
      expect(pkColumns.map((column) => column.name)).toEqual(['source_path', 'content_hash']);
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('v4 → 最新增量迁移：只应用 v5', async () => {
    const temp = makeTempDb('septcats-migrate-v4v5');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      const v4Only = await runMigrations(db, MIGRATIONS.slice(0, 4));
      expect(v4Only.to).toBe(MIGRATIONS[3]!.id);
      expect(tableNames(db)).not.toContain('import_source');

      const v5 = await runMigrations(db, MIGRATIONS);
      expect(v5.from).toBe(MIGRATIONS[3]!.id);
      expect(v5.to).toBe(LATEST_SCHEMA_VERSION);
      expect(v5.applied).toEqual(MIGRATION_IDS.slice(4));
      expect(tableNames(db)).toContain('import_source');
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('v5 up 可重复执行且 (source_path, content_hash) 冲突被 OR IGNORE 收口', async () => {
    const temp = makeTempDb('septcats-migrate-v5idem');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      const upToV5 = MIGRATIONS[MIGRATIONS.length - 1]!;
      for (const migration of MIGRATIONS) {
        db.transaction(() => {
          migration.up(db);
        })();
      }
      expect(() => {
        db.transaction(() => {
          upToV5.up(db);
        })();
      }).not.toThrow();

      const insert = db.prepare(
        `INSERT OR IGNORE INTO import_source (source_path, content_hash, page_id, created_at) VALUES (?, ?, ?, ?)`,
      );
      expect(insert.run('a/b', 'c'.repeat(64), 'pg-1', 1).changes).toBe(1);
      expect(insert.run('a/b', 'c'.repeat(64), 'pg-2', 2).changes).toBe(0);
      const row = db.prepare(`SELECT page_id FROM import_source WHERE source_path = 'a/b'`).get() as {
        page_id: string;
      };
      expect(row.page_id).toBe('pg-1');
    } finally {
      db.close();
      temp.cleanup();
    }
  });
});

describe('schema.v6.ts（FTS 触发器 defer 守卫 · TASK-T15-01）', () => {
  it('fts_defer 常规表 + CHECK 值域 + 单行初始行语句', () => {
    const sql = SCHEMA_V6_STATEMENTS.join('\n');
    for (const table of SCHEMA_V6_TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} `);
    }
    expect(sql).toContain('CHECK (flag IN (0, 1))');
    expect(sql).toContain('STRICT');
    // 初始行走 NOT EXISTS 守卫（幂等），且有兜底复位 flag=0
    expect(sql).toContain('INSERT INTO fts_defer (flag) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM fts_defer)');
    expect(sql).toContain('UPDATE fts_defer SET flag = 0');
    expect(sql).not.toContain('CREATE INDEX');
    expect(sql.toUpperCase()).not.toContain('PRAGMA');
  });

  it('重建全部 6 个触发器且带 WHEN defer 守卫（触发器体与 v4 同源）', () => {
    const sql = SCHEMA_V6_TRIGGERS.join('\n');
    for (const name of SCHEMA_V6_TRIGGER_NAMES) {
      expect(sql).toContain(`DROP TRIGGER IF EXISTS ${name}`);
      expect(sql).toContain(`CREATE TRIGGER ${name}`);
    }
    // 六个 CREATE 全部带 WHEN 守卫（page.ai 的 alive 条件与之并列；body 里的
    // json_tree CASE WHEN 不算——直接按守卫表达式计数）
    expect(sql.split(FTS_DEFER_GUARD_EXPR).length - 1).toBe(6);
    expect(sql).toContain(`WHEN new.alive = 1 AND ${FTS_DEFER_GUARD_EXPR}`);
    // 触发器体与 v4 同源：json_tree 抽 text + 排除 code（ftsPageBodyExpr 单源注入）
    expect(sql).toContain('json_tree');
    expect(sql).toContain("b.type != 'code'");
    // 不越权：DROP 仅限触发器重建
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('DROP INDEX');
  });
});

describeDb('migrate v6（fts_defer · better-sqlite3 直连）', (ctor) => {
  it('全新库迁移到最新：fts_defer 在位、初始行 flag=0、六触发器带守卫（版本参数化）', async () => {
    const temp = makeTempDb('septcats-migrate-v6');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      const result = await migrate(db);
      expect(result.from).toBe(0);
      expect(result.to).toBe(LATEST_SCHEMA_VERSION);
      expect(result.applied).toEqual(MIGRATION_IDS);
      expect(tableNames(db)).toContain('fts_defer');

      const flagRows = db.prepare('SELECT flag FROM fts_defer').all() as Array<{ flag: number }>;
      expect(flagRows).toEqual([{ flag: 0 }]);

      const triggers = db
        .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_%_fts_%'`)
        .all() as Array<{ name: string; sql: string }>;
      expect(triggers.map((row) => row.name).sort()).toEqual([...SCHEMA_V6_TRIGGER_NAMES].sort());
      for (const trigger of triggers) {
        expect(trigger.sql).toContain('WHEN');
        expect(trigger.sql).toContain('(SELECT flag FROM fts_defer LIMIT 1) = 0');
      }
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('v5 → 最新增量迁移：只应用 #6，defer 表与守卫触发器到位', async () => {
    const temp = makeTempDb('septcats-migrate-v5v6');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      const v5Only = await runMigrations(db, MIGRATIONS.slice(0, 5));
      expect(v5Only.to).toBe(MIGRATIONS[4]!.id);
      expect(tableNames(db)).not.toContain('fts_defer');

      const v6 = await runMigrations(db, MIGRATIONS);
      expect(v6.from).toBe(MIGRATIONS[4]!.id);
      expect(v6.to).toBe(LATEST_SCHEMA_VERSION);
      expect(v6.applied).toEqual(MIGRATION_IDS.slice(5));
      expect(tableNames(db)).toContain('fts_defer');
      expect((db.prepare('SELECT flag FROM fts_defer').get() as { flag: number }).flag).toBe(0);
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('v6 up 可重复执行（幂等）：不抛、fts_defer 仍单行 flag=0', () => {
    const temp = makeTempDb('septcats-migrate-v6idem');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      for (const migration of MIGRATIONS) {
        db.transaction(() => {
          migration.up(db);
        })();
      }
      const v6 = MIGRATIONS[MIGRATIONS.length - 1]!;
      expect(() => {
        db.transaction(() => {
          v6.up(db);
        })();
      }).not.toThrow();
      expect(db.prepare('SELECT flag FROM fts_defer').all()).toEqual([{ flag: 0 }]);
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('CHECK 值域：flag 只接受 0/1，越值写被拒', () => {
    const temp = makeTempDb('septcats-migrate-v6check');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      for (const migration of MIGRATIONS) {
        db.transaction(() => {
          migration.up(db);
        })();
      }
      expect(() => db.exec('UPDATE fts_defer SET flag = 2')).toThrow();
      expect(() => db.exec('UPDATE fts_defer SET flag = 1')).not.toThrow();
      db.exec('UPDATE fts_defer SET flag = 0');
    } finally {
      db.close();
      temp.cleanup();
    }
  });
});

describeDb('migrate（better-sqlite3 直连）', (ctor) => {
  it('全新库迁移到最新：逐版建表/加列/索引 + user_version + meta 基线', async () => {
    const temp = makeTempDb('septcats-migrate');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      expect(readUserVersion(db)).toBe(0);

      const result = await migrate(db);
      expect(result.from).toBe(0);
      expect(result.to).toBe(LATEST_SCHEMA_VERSION);
      expect(result.applied).toEqual(MIGRATION_IDS);
      expect(result.recovery).toBe('none');
      expect(result.error).toBeUndefined();
      expect(readUserVersion(db)).toBe(LATEST_SCHEMA_VERSION);

      const names = tableNames(db);
      for (const table of SCHEMA_V1_TABLES) {
        expect(names).toContain(table);
      }
      for (const table of SCHEMA_V2_TABLES) {
        expect(names).toContain(table);
      }
      expect(names).toContain('page_block_fts');

      // v2 加列：STRICT 表上的 ALTER TABLE ADD COLUMN 原生可用
      expect(columnNames(db, 'page')).toContain('deleted_at');

      const meta = db.prepare(`SELECT key FROM meta ORDER BY key`).all() as Array<{ key: string }>;
      expect(meta.map((row) => row.key).sort()).toEqual(['device_id', 'installed_at', 'schema_version']);
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('v1 → 最新增量迁移：只应用剩余版本，deleted_at 与三表到位', async () => {
    const temp = makeTempDb('septcats-migrate-v1v2');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      const v1Only = await runMigrations(db, MIGRATIONS.slice(0, 1));
      expect(v1Only.to).toBe(1);
      expect(columnNames(db, 'page')).not.toContain('deleted_at');

      const v2 = await runMigrations(db, MIGRATIONS);
      expect(v2.from).toBe(1);
      expect(v2.to).toBe(LATEST_SCHEMA_VERSION);
      expect(v2.applied).toEqual(MIGRATION_IDS.slice(1));
      expect(columnNames(db, 'page')).toContain('deleted_at');
      for (const table of SCHEMA_V2_TABLES) {
        expect(tableNames(db)).toContain(table);
      }
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('v2 up 可重复执行（加列走 PRAGMA 存在性判断，不抛）', () => {
    const temp = makeTempDb('septcats-migrate-v2idem');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      const v1 = MIGRATIONS[0]!;
      const v2 = MIGRATIONS[1]!;
      db.transaction(() => {
        v1.up(db);
      })();
      db.transaction(() => {
        v2.up(db);
      })();
      expect(() => {
        db.transaction(() => {
          v2.up(db);
        })();
      }).not.toThrow();
      expect(columnNames(db, 'page')).toContain('deleted_at');
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
      expect(again.from).toBe(LATEST_SCHEMA_VERSION);
      expect(again.to).toBe(LATEST_SCHEMA_VERSION);
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
      expect(result.backupPath).toBe(`${temp.path}.bak-v${String(LATEST_SCHEMA_VERSION)}`);
      expect(readUserVersion(result.db)).toBe(LATEST_SCHEMA_VERSION);

      const leftovers = result.db
        .prepare(`SELECT name FROM sqlite_master WHERE name = 'boom'`)
        .all() as Array<{ name: string }>;
      expect(leftovers).toHaveLength(0);

      // 还原后的连接必须是可用的
      const meta = result.db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
        | { value: string }
        | undefined;
      expect(meta?.value).toBe(String(LATEST_SCHEMA_VERSION));
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
      expect(readUserVersion(result.db)).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      working.close();
      temp.cleanup();
    }
  });
});
