/**
 * test/t67-lock.test.ts —— 页面密码锁后端核心（TASK-T67-01-B1-01）。
 *
 * 覆盖安全语义：v10 迁移升级 / KDF 参数钉值 / 设锁明文块消失密文在表 /
 * 错口令 5 次限速（时间注入）/ 正确口令字节级还原 / 恢复码一次性换口令 /
 * remove 密文全灭明文回归 / FTS 搜不到锁页 / SCHEMA_VERSION 双轴钉点 / IPC 级探针。
 *
 * 纪律：不启动 Electron，ABI 保持 node；better-sqlite3 经 helpers 惰性加载。
 */

import { describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  applyPragmaBaseline,
  migrate,
  readUserVersion,
  runMigrations,
  type SqliteDatabase,
} from '../src/db/migrations';
import { SCHEMA_V10_TABLES } from '../src/db/schema.v10';
import { SCHEMA_VERSION as CORE_WIRE_SCHEMA_VERSION } from '@septcats/core';
import { createLockService, generateRecoveryCode, normalizeRecoveryCode, type LockService } from '../src/main/lock';
import { registerLockIpc, type LockIpcRegistrar } from '../src/main/lockIpc';
import { createSearchService } from '../src/main/search';
import { describeDb, makeCore, makeTempDb, coreExecutor } from './helpers';
import type { StatementExecutor } from '../src/main/pages';

// --- 小工具 ----------------------------------------------------------------

function tableNames(db: SqliteDatabase): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

function columnNames(db: SqliteDatabase, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name?: unknown }>)
    .map((row) => row.name)
    .filter((name): name is string => typeof name === 'string');
}

const PAGE_ID = 'pg-lock-001';
const WORKSPACE = 'ws-test';
const PASS = 'correct horse battery staple';
const WRONG = 'wrong-pass';

interface Harness {
  readonly db: Database;
  readonly executor: StatementExecutor;
  readonly lock: LockService;
  readonly clock: { value: number };
  setClock(ms: number): void;
  cleanup(): void;
}

function buildHarness(ctor: new (path: string) => Database): Harness {
  const temp = makeTempDb('t67-lock-core');
  const core = makeCore(ctor, temp.path);
  const db = core.activeDatabase() as unknown as Database;
  // 同步跑全部迁移（建表；buildHarness 不依赖 user_version，故不走带备份的 migrate）
  db.transaction((): void => {
    for (const migration of MIGRATIONS) {
      migration.up(db);
    }
  })();
  const clock = { value: 1_700_000_000_000 };
  const session = new Map<string, Uint8Array>();
  const lock = createLockService({
    executor: coreExecutor(core),
    clock: () => clock.value,
    session,
  });
  return {
    db,
    executor: coreExecutor(core),
    lock,
    clock,
    setClock: (ms: number): void => {
      clock.value = ms;
    },
    cleanup: (): void => {
      core.activeDatabase().close();
      temp.cleanup();
    },
  };
}

/** 在裸库里插一页 + N 个 paragraph 块（content_json 含 keyword）。 */
function insertPageWithBlocks(
  db: Database,
  pageId: string,
  blocks: ReadonlyArray<{ id: string; content: string; sortKey: string }>,
): void {
  const insPage = db.prepare(
    `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, updated_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, 1, 1, ?)`,
  );
  insPage.run(pageId, WORKSPACE, `title-${pageId}`, 'A000000001', 1_700_000_000_000);
  const insBlock = db.prepare(
    `INSERT INTO block (id, page_id, workspace_id, type, props_json, content_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 'aaaa0001', ?)`,
  );
  db.transaction(() => {
    for (const block of blocks) {
      insBlock.run(
        block.id,
        pageId,
        WORKSPACE,
        'paragraph',
        '{}',
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: block.content }] }] }),
        block.sortKey,
        1_700_000_000_000,
      );
    }
  })();
}

// --- 迁移 -------------------------------------------------------------------

describeDb('T67 迁移 · v10 升级 v9 夹具', (ctor) => {
  it('v9 库升级到最新：page_lock + block_cipher 表与列到位，user_version=LATEST', async () => {
    const temp = makeTempDb('t67-mig-v9');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      const v9 = await runMigrations(db, MIGRATIONS.slice(0, 9));
      expect(v9.to).toBe(9);
      expect(readUserVersion(db)).toBe(9);

      const result = await migrate(db);
      expect(result.from).toBe(9);
      expect(result.to).toBe(LATEST_SCHEMA_VERSION);
      expect(LATEST_SCHEMA_VERSION).toBe(10);
      expect(result.applied).toEqual([10]);

      const names = tableNames(db);
      for (const table of SCHEMA_V10_TABLES) {
        expect(names).toContain(table);
      }
      expect(columnNames(db, 'page_lock')).toEqual([
        'page_id',
        'kdf_salt',
        'verifier',
        'recovery_verifier',
        'wrapped_key',
        'failures',
        'locked_until',
        'updated_at',
      ]);
      expect(columnNames(db, 'block_cipher')).toEqual(['page_id', 'blob', 'format', 'updated_at']);
    } finally {
      db.close();
      temp.cleanup();
    }
  });

  it('v10 up 可重复执行（幂等）：不抛且表仍在', async () => {
    const temp = makeTempDb('t67-mig-idem');
    const db = new ctor(temp.path);
    try {
      applyPragmaBaseline(db);
      for (const migration of MIGRATIONS) {
        db.transaction(() => {
          migration.up(db);
        })();
      }
      const v10 = MIGRATIONS[MIGRATIONS.length - 1]!;
      expect(() => {
        db.transaction(() => {
          v10.up(db);
        })();
      }).not.toThrow();
      expect(tableNames(db)).toContain('page_lock');
      expect(tableNames(db)).toContain('block_cipher');
    } finally {
      db.close();
      temp.cleanup();
    }
  });
});

// --- KDF 参数钉值 -----------------------------------------------------------

describe('T67 KDF 参数钉值（跨版本可解）', () => {
  it('scrypt 代价参数钉死 N=2^15, r=8, p=1, keylen=32', async () => {
    const { LOCK_SCRYPT_N, LOCK_SCRYPT_R, LOCK_SCRYPT_P, LOCK_KEYLEN } = await import('../src/main/lock');
    expect(LOCK_SCRYPT_N).toBe(32768);
    expect(LOCK_SCRYPT_R).toBe(8);
    expect(LOCK_SCRYPT_P).toBe(1);
    expect(LOCK_KEYLEN).toBe(32);
  });

  it('恢复码 base32 归一化容错（去连字符/空白/大写）', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/);
    expect(normalizeRecoveryCode(code)).toBe(code.replace(/-/g, ''));
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(normalizeRecoveryCode(code));
  });
});

// --- 加密核心 ---------------------------------------------------------------

describeDb('T67 加密核心 · 设锁/解锁/恢复/限速', (ctor) => {
  it('设锁 → 明文块消失、密文在表、DB 不含明文关键词', async () => {
    const h = buildHarness(ctor);
    try {
      insertPageWithBlocks(h.db, PAGE_ID, [
        { id: 'bk-1', content: '核反冲SEPTCATSTEST 账号密码', sortKey: 'A00000001' },
        { id: 'bk-2', content: '第二段敏感内容', sortKey: 'A00000002' },
      ]);
      const { recoveryCode } = await h.lock.setPass(PAGE_ID, PASS);
      expect(typeof recoveryCode).toBe('string');
      expect(recoveryCode.length).toBeGreaterThan(0);

      // 明文块已删
      const remaining = h.db
        .prepare(`SELECT count(*) AS c FROM block WHERE page_id = ? AND alive = 1`)
        .get(PAGE_ID) as { c: number };
      expect(remaining.c).toBe(0);

      // 密文行在表
      const cipher = h.db.prepare(`SELECT blob FROM block_cipher WHERE page_id = ?`).get(PAGE_ID) as
        | { blob: Uint8Array }
        | undefined;
      expect(cipher).toBeDefined();
      // 密文形态不含明文关键词
      expect(Buffer.from(cipher!.blob).toString('utf8')).not.toContain('核反冲SEPTCATSTEST');

      // 未解锁读路径：返回空 + locked:true
      const read = await h.lock.readBlocks(PAGE_ID);
      expect(read.locked).toBe(true);
      expect(read.blocks).toHaveLength(0);
    } finally {
      h.cleanup();
    }
  });

  it('错口令 5 次 → lockedUntil 生效；窗口内任何口令被拒；窗口后正确口令解锁并清零', async () => {
    const h = buildHarness(ctor);
    try {
      insertPageWithBlocks(h.db, PAGE_ID, [{ id: 'bk-1', content: '敏感', sortKey: 'A00000001' }]);
      await h.lock.setPass(PAGE_ID, PASS);
      const T = 1_700_000_000_000;
      h.setClock(T);

      // 前 4 次错口令：BADPASS，未锁定
      for (let i = 1; i <= 4; i += 1) {
        await expect(h.lock.verify(PAGE_ID, WRONG)).rejects.toMatchObject({ code: 'E_LOCK_BADPASS' });
        const status = await h.lock.getStatus(PAGE_ID);
        expect(status.failures).toBe(i);
        expect(status.lockedUntil).toBeNull();
      }

      // 第 5 次：触发锁定（LOCKED）
      await expect(h.lock.verify(PAGE_ID, WRONG)).rejects.toMatchObject({ code: 'E_LOCK_LOCKED' });
      const locked = await h.lock.getStatus(PAGE_ID);
      expect(locked.failures).toBe(5);
      expect(locked.lockedUntil).toBe(T + 60_000);

      // 窗口内即便正确口令也被拒
      h.setClock(T + 10_000);
      await expect(h.lock.verify(PAGE_ID, PASS)).rejects.toMatchObject({ code: 'E_LOCK_LOCKED' });

      // 窗口过后正确口令解锁并清零
      h.setClock(T + 60_001);
      await expect(h.lock.verify(PAGE_ID, PASS)).resolves.toEqual({ ok: true });
      const cleared = await h.lock.getStatus(PAGE_ID);
      expect(cleared.failures).toBe(0);
      expect(cleared.lockedUntil).toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it('正确口令解锁 → 块逐字节还原（content_json 相等）', async () => {
    const h = buildHarness(ctor);
    try {
      const original = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '逐字节还原探针内容' }] }] });
      insertPageWithBlocks(h.db, PAGE_ID, [{ id: 'bk-1', content: '逐字节还原探针内容', sortKey: 'A00000001' }]);
      await h.lock.setPass(PAGE_ID, PASS);
      await h.lock.verify(PAGE_ID, PASS);

      const read = await h.lock.readBlocks(PAGE_ID);
      expect(read.locked).toBe(false);
      expect(read.blocks).toHaveLength(1);
      expect(read.blocks[0]!.content_json).toBe(original);
      expect(read.blocks[0]!.props_json).toBe('{}');
    } finally {
      h.cleanup();
    }
  });

  it('恢复码一次性成功换口令，二次被拒；旧口令失效', async () => {
    const h = buildHarness(ctor);
    try {
      insertPageWithBlocks(h.db, PAGE_ID, [{ id: 'bk-1', content: '敏感', sortKey: 'A00000001' }]);
      const { recoveryCode } = await h.lock.setPass(PAGE_ID, PASS);

      // 第一次用恢复码换口令 → 成功
      const rec = await h.lock.recover(PAGE_ID, recoveryCode, 'new-pass-1');
      expect(rec.ok).toBe(true);
      expect(rec.recoveryCode).not.toBe(recoveryCode);

      // 新口令可解锁，旧口令失效
      await expect(h.lock.verify(PAGE_ID, 'new-pass-1')).resolves.toEqual({ ok: true });
      await expect(h.lock.verify(PAGE_ID, PASS)).rejects.toMatchObject({ code: 'E_LOCK_BADPASS' });

      // 同一旧恢复码二次使用 → 已被作废（E_LOCK_RECOVERY_USED）
      await expect(h.lock.recover(PAGE_ID, recoveryCode, 'another-pass')).rejects.toMatchObject({
        code: 'E_LOCK_RECOVERY_USED',
      });

      // 新恢复码仍可用一次
      await expect(h.lock.recover(PAGE_ID, rec.recoveryCode, 'new-pass-2')).resolves.toMatchObject({ ok: true });
    } finally {
      h.cleanup();
    }
  });

  it('remove → 密文全灭、明文块回归、锁行删除', async () => {
    const h = buildHarness(ctor);
    try {
      insertPageWithBlocks(h.db, PAGE_ID, [
        { id: 'bk-1', content: '移除后回归', sortKey: 'A00000001' },
        { id: 'bk-2', content: '第二段', sortKey: 'A00000002' },
      ]);
      await h.lock.setPass(PAGE_ID, PASS);
      await h.lock.remove(PAGE_ID, PASS);

      // 锁行与密文行已删
      expect(h.db.prepare(`SELECT count(*) AS c FROM page_lock WHERE page_id = ?`).get(PAGE_ID)).toEqual({ c: 0 });
      expect(h.db.prepare(`SELECT count(*) AS c FROM block_cipher WHERE page_id = ?`).get(PAGE_ID)).toEqual({ c: 0 });

      // 明文块回归
      const restored = h.db
        .prepare(`SELECT id, content_json FROM block WHERE page_id = ? AND alive = 1 ORDER BY id`)
        .all(PAGE_ID) as Array<{ id: string; content_json: string | null }>;
      expect(restored).toHaveLength(2);
      expect(restored[0]!.content_json).toContain('移除后回归');

      // 状态回到未锁
      expect(await h.lock.getStatus(PAGE_ID)).toEqual({ locked: false, unlockedInSession: false, failures: 0, lockedUntil: null });
    } finally {
      h.cleanup();
    }
  });

  it('未设锁的页：verify/remove/recover 抛 E_LOCK_NOT_SET', async () => {
    const h = buildHarness(ctor);
    try {
      await expect(h.lock.verify(PAGE_ID, PASS)).rejects.toMatchObject({ code: 'E_LOCK_NOT_SET' });
      await expect(h.lock.remove(PAGE_ID, PASS)).rejects.toMatchObject({ code: 'E_LOCK_NOT_SET' });
      await expect(h.lock.recover(PAGE_ID, 'CODE', 'x')).rejects.toMatchObject({ code: 'E_LOCK_NOT_SET' });
    } finally {
      h.cleanup();
    }
  });
});

// --- FTS --------------------------------------------------------------------

describeDb('T67 FTS · 锁页不出现在搜索结果', (ctor) => {
  it('设锁后按块正文关键词搜索命中归零', async () => {
    const h = buildHarness(ctor);
    try {
      const keyword = '核反冲SEPTCATSTEST';
      insertPageWithBlocks(h.db, PAGE_ID, [{ id: 'bk-1', content: `${keyword} 专属敏感`, sortKey: 'A00000001' }]);
      const search = createSearchService({ executor: h.executor });

      // 锁前可搜到
      const before = await search.query({ workspaceId: WORKSPACE, query: keyword });
      expect(before.hits.some((hit) => hit.pageId === PAGE_ID)).toBe(true);

      // 设锁
      await h.lock.setPass(PAGE_ID, PASS);

      // 锁后搜不到（明文块已删，FTS 触发器清 page_block_fts）
      const after = await search.query({ workspaceId: WORKSPACE, query: keyword });
      expect(after.hits.some((hit) => hit.pageId === PAGE_ID)).toBe(false);
    } finally {
      h.cleanup();
    }
  });
});

// --- SCHEMA_VERSION 双轴钉点 -------------------------------------------------

describe('T67 SCHEMA_VERSION 双轴钉点', () => {
  it('内部迁移轴 LATEST_SCHEMA_VERSION = 10（仅追加 #10，无手改常量）', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(10);
    expect(MIGRATIONS[MIGRATIONS.length - 1]!.id).toBe(10);
    expect(MIGRATIONS[MIGRATIONS.length - 1]!.name).toBe('v10-page-lock');
  });

  it('wire 轴 packages/core SCHEMA_VERSION = 3 冻结未动（红线）', () => {
    expect(CORE_WIRE_SCHEMA_VERSION).toBe(3);
  });
});

// --- IPC 级探针 -------------------------------------------------------------

describeDb('T67 IPC 级探针（registerLockIpc + 假 registrar）', (ctor) => {
  it('六通道注册成功；handler 转发服务并收敛错误 code', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const registrar: LockIpcRegistrar = {
      handle: (channel, listener): void => {
        handlers.set(channel, listener);
      },
    };
    const ipcTemp = makeTempDb('t67-ipc');
    const core = makeCore(ctor, ipcTemp.path);
    await migrate(core.activeDatabase());
    const db = core.activeDatabase() as unknown as Database;
    insertPageWithBlocks(db, PAGE_ID, [{ id: 'bk-1', content: 'ipc', sortKey: 'A00000001' }]);
    const lock = createLockService({ executor: coreExecutor(core) });
    registerLockIpc(lock, registrar);

    expect(handlers.size).toBe(6);

    const status0 = (await handlers.get('lock:getStatus')!({ pageId: PAGE_ID })) as { locked: boolean };
    expect(status0.locked).toBe(false);

    const setRes = (await handlers.get('lock:setPass')!({ pageId: PAGE_ID, pass: PASS })) as { recoveryCode: string };
    expect(typeof setRes.recoveryCode).toBe('string');

    await expect(handlers.get('lock:verify')!({ pageId: PAGE_ID, pass: WRONG })).rejects.toThrow(/E_LOCK_BADPASS/);
    await expect(handlers.get('lock:verify')!({ pageId: PAGE_ID, pass: PASS })).resolves.toEqual({ ok: true });

    await expect(handlers.get('lock:remove')!({ pageId: PAGE_ID, pass: PASS })).resolves.toEqual({ ok: true });

    // service === null 时统一回 E_DB_UNAVAILABLE
    const handlers2 = new Map<string, (input: unknown) => Promise<unknown>>();
    const nullRegistrar: LockIpcRegistrar = {
      handle: (channel, listener): void => {
        handlers2.set(channel, listener);
      },
    };
    registerLockIpc(null, nullRegistrar);
    await expect(handlers2.get('lock:getStatus')!({ pageId: PAGE_ID })).rejects.toThrow(/E_DB_UNAVAILABLE/);

    core.activeDatabase().close();
    ipcTemp.cleanup();
  });
});
