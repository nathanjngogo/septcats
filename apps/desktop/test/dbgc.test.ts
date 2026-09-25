/**
 * dbgc.test.ts —— DB 面墓碑物理清除执行路径（T81-01）。
 *
 * 走真实 better-sqlite3（DbServerCore + 白名单转发），夹具 = 老板真实库形态的脱敏复刻：
 * 「34 个 purge 墓碑 + 14 个存活页」，另加四种扣留形态（未满期/已收藏/有锁/有子页）。
 *
 * 核心断言：
 * - preview 零写；run 只删计划内 id（存活页逐 id 完好、其派生行不动）；
 * - **op_ledger 逐字节不变**（账本是真相层）；
 * - 被清页不可恢复（restorePage 抛 E_NOT_FOUND）；
 * - 引用面级联（block/collection/record/favorite/recent/双链两侧/import_source/FTS）全清；
 * - 分批上限：> DB_GC_BATCH_PAGES 时切多个事务批。
 */
import { expect, it } from 'vitest';
import type { DbServerCore } from '../src/db/server';
import type { SqliteConstructor, SqliteDatabase } from '../src/db/migrations';
import type { AllData, MigrateData } from '../src/db/rpc';
import { createDbGcService, DB_GC_BATCH_PAGES, type DbGcService } from '../src/main/dbgc';
import { PagesApiError, createPagesService } from '../src/main/pages';
import { coreExecutor, describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const AT = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const WS = 'ws-fixture';
const ACTOR = 'aaaa0001';

/** 老板库形态：34 个彻底删除墓碑 + 14 个存活页。 */
const PURGE_TOMBSTONES = 34;
const ALIVE_PAGES = 14;
const BLOCKS_PER_TOMBSTONE = 2;

interface Fixture {
  core: DbServerCore;
  temp: TempDb;
}

function insert(db: SqliteDatabase, sql: string, ...params: unknown[]): void {
  db.prepare(sql).run(...params);
}

function seedPage(
  db: SqliteDatabase,
  id: string,
  alive: 0 | 1,
  parentId: string | null,
  deletedAt: number | null,
): void {
  insert(
    db,
    `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, updated_at, deleted_at)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 1, ?, ?)`,
    id,
    WS,
    id,
    parentId,
    `A${id}`,
    alive,
    AT,
    deletedAt,
  );
}

function seedBlock(db: SqliteDatabase, id: string, pageId: string, alive: 0 | 1): void {
  insert(
    db,
    `INSERT INTO block (id, page_id, workspace_id, type, props_json, content_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
     VALUES (?, ?, ?, 'paragraph', '{"k":1}', ?, ?, ?, 1, 1, ?, ?)`,
    id,
    pageId,
    WS,
    `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${id}"}]}]}`,
    `B${id}`,
    alive,
    ACTOR,
    AT,
  );
}

async function buildFixture(ctor: SqliteConstructor): Promise<Fixture> {
  const temp = makeTempDb('septcats-dbgc');
  const core = makeCore(ctor, temp.path);
  await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
  const db = core.activeDatabase();

  db.transaction(() => {
    // 工作区（供 pages 服务解析活动工作区）
    insert(db, `INSERT INTO workspace (id, name, root_page_id, settings_json, created_at) VALUES (?, ?, NULL, '{}', ?)`, WS, '夹具库', AT);
    insert(db, `INSERT OR REPLACE INTO meta (key, value) VALUES ('active_workspace_id', ?)`, WS);
    insert(db, `INSERT OR REPLACE INTO meta (key, value) VALUES ('device_id', 'aaaa0001')`);

    // 14 个存活页（alive-00..12 + live-child）；每页 2 块 + 2 行 op_ledger
    for (let i = 0; i < ALIVE_PAGES - 1; i += 1) {
      const id = `alive-${String(i).padStart(2, '0')}`;
      seedPage(db, id, 1, null, null);
      seedBlock(db, `${id}-b0`, id, 1);
      seedBlock(db, `${id}-b1`, id, 1);
    }
    // live-child 挂在 parent-tomb 之下（引用面：活子页使父墓碑不得放行）
    seedPage(db, 'live-child', 1, 'parent-tomb', null);

    // 存活页的派生行（不应被 GC 触碰）：collection + record + favorite + recent + 双链
    insert(db, `INSERT INTO collection (id, page_id, workspace_id, name, schema_json, views_json, alive, version, lamport_c, lamport_d, updated_at)
                VALUES ('coll-alive', 'alive-00', ?, '表', '{}', '[]', 1, 1, 1, ?, ?)`, WS, ACTOR, AT);
    insert(db, `INSERT INTO record (id, collection_id, workspace_id, values_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
                VALUES ('rec-alive', 'coll-alive', ?, '{}', 'A', 1, 1, 1, ?, ?)`, WS, ACTOR, AT);
    insert(db, `INSERT INTO favorite (user_key, page_id, added_at) VALUES ('u', 'alive-00', ?)`, AT);
    insert(db, `INSERT INTO recent (user_key, page_id, last_opened) VALUES ('u', 'alive-00', ?)`, AT);
    insert(db, `INSERT INTO page_link_index (source_page_id, source_block_id, target_page_id, workspace_id, title, context)
                VALUES ('alive-00', 'alive-00-b0', 'alive-01', ?, 'x', 'y')`, WS);

    // 34 个 purge 墓碑（deleted_at=0）+ 每个 2 块墓碑块
    for (let i = 0; i < PURGE_TOMBSTONES; i += 1) {
      const id = `tomb-${String(i).padStart(2, '0')}`;
      seedPage(db, id, 0, null, 0);
      for (let b = 0; b < BLOCKS_PER_TOMBSTONE; b += 1) {
        seedBlock(db, `${id}-b${String(b)}`, id, 0);
      }
      // 真相层：该页的 delete op 早已进账本（物理删物化行不删账）
      insert(db, `INSERT INTO op_ledger (op_id, seg_id, lamport_c, lamport_d, target_table, target_id, op_json, applied_at)
                  VALUES (?, NULL, ?, ?, 'page', ?, ?, ?)`,
        `op-tomb-${String(i).padStart(2, '0')}`, i + 1, ACTOR, id, `{"op_id":"op-tomb-${String(i).padStart(2, '0')}","kind":"delete"}`, AT);
    }
    // FTS 残留（模拟「触发器被 defer 放过」的脏行）——GC 的 fts.clearPage 必须清掉它
    insert(db, `INSERT INTO page_block_fts (title, body, page_id, workspace_id) VALUES ('tomb-00', 'body', 'tomb-00', ?)`, WS);

    // tomb-00 的全引用面（清理后应全部消失）
    insert(db, `INSERT INTO favorite (user_key, page_id, added_at) VALUES ('u', 'tomb-00', ?)`, AT);
    insert(db, `INSERT INTO recent (user_key, page_id, last_opened) VALUES ('u', 'tomb-00', ?)`, AT);
    insert(db, `INSERT INTO page_link_index (source_page_id, source_block_id, target_page_id, workspace_id, title, context)
                VALUES ('tomb-00', 'tomb-00-b0', 'alive-01', ?, 's', 'c')`, WS);
    insert(db, `INSERT INTO page_link_index (source_page_id, source_block_id, target_page_id, workspace_id, title, context)
                VALUES ('alive-01', 'alive-01-b0', 'tomb-00', ?, 't', 'c')`, WS);
    insert(db, `INSERT INTO import_source (source_path, content_hash, page_id, created_at)
                VALUES ('研究/x.md', ?, 'tomb-00', ?)`, 'a'.repeat(64), AT);
    insert(db, `INSERT INTO collection (id, page_id, workspace_id, name, schema_json, views_json, alive, version, lamport_c, lamport_d, updated_at)
                VALUES ('coll-tomb', 'tomb-00', ?, '表', '{}', '[]', 1, 1, 1, ?, ?)`, WS, ACTOR, AT);
    insert(db, `INSERT INTO record (id, collection_id, workspace_id, values_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
                VALUES ('rec-tomb', 'coll-tomb', ?, '{}', 'A', 1, 1, 1, ?, ?)`, WS, ACTOR, AT);

    // 四种扣留形态
    seedPage(db, 'soft-young', 0, null, NOW - 1 * DAY); // 未满期（retention）
    seedPage(db, 'soft-mature', 0, null, NOW - 31 * DAY); // 满期 → 放行
    seedBlock(db, 'soft-mature-b0', 'soft-mature', 0);
    seedPage(db, 'lock-tomb', 0, null, 0);
    insert(db, `INSERT INTO page_lock (page_id, kdf_salt, verifier, recovery_verifier, wrapped_key, failures, locked_until, updated_at)
                VALUES ('lock-tomb', x'00', x'00', x'00', x'00', 0, NULL, ?)`, AT);
    seedPage(db, 'parent-tomb', 0, null, 0);
  })();

  return { core, temp };
}

function ledgerDump(db: SqliteDatabase): string {
  return JSON.stringify(
    db
      .prepare(
        `SELECT seq, op_id, seg_id, lamport_c, lamport_d, target_table, target_id, op_json, applied_at
         FROM op_ledger ORDER BY seq`,
      )
      .all(),
  );
}

function count(db: SqliteDatabase, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

describeDb('DB 面墓碑 GC（T81-01）', (ctor) => {
  it('preview 零写 + 计划判据；run 只删计划内 id，存活页与派生行完好，op_ledger 逐字节不变', async () => {
    const { core, temp } = await buildFixture(ctor);
    try {
      const db = core.activeDatabase();
      const service: DbGcService = createDbGcService({ executor: coreExecutor(core), now: () => NOW });

      const pageCountBefore = count(db, `SELECT COUNT(*) AS n FROM page`);
      const ledgerBefore = ledgerDump(db);

      // ---- preview：零写 ----
      const preview = await service.preview();
      expect(preview.candidates).toBe(PURGE_TOMBSTONES + 4); // 34 purge + soft-young/soft-mature/lock/parent
      expect(preview.deletable).toBe(PURGE_TOMBSTONES + 1); // 34 purge + soft-mature
      expect(preview.held).toBe(3);
      expect(preview.heldByReason).toEqual({
        unreachable: 0,
        retention: 1,
        locked: 1,
        'has-children': 1,
      });
      expect(preview.estimatedBlocks).toBe(PURGE_TOMBSTONES * BLOCKS_PER_TOMBSTONE + 1);
      expect(preview.retentionDays).toBe(30);
      expect(count(db, `SELECT COUNT(*) AS n FROM page`)).toBe(pageCountBefore); // 零写
      expect(ledgerDump(db)).toBe(ledgerBefore); // 零写

      // ---- run：真删 ----
      const result = await service.run();
      expect(result.deletedPages).toBe(PURGE_TOMBSTONES + 1);
      expect(result.deletedBlocks).toBe(PURGE_TOMBSTONES * BLOCKS_PER_TOMBSTONE + 1);
      expect(result.batches).toBe(1);
      expect(result.held).toBe(3);

      // 存活页逐 id 完好 + 每页块数不变（listByWorkspace 只看 alive=1）
      const aliveIds = (
        await requestOk<AllData>(core, {
          id: 'alive',
          t: 'all',
          sqlId: 'page.listByWorkspace',
          params: { workspace_id: WS },
        })
      ).rows.map((row) => (row as { id: string }).id);
      expect(aliveIds.sort()).toEqual(
        [...Array(ALIVE_PAGES - 1).keys()].map((i) => `alive-${String(i).padStart(2, '0')}`).concat('live-child').sort(),
      );
      expect(count(db, `SELECT COUNT(*) AS n FROM block WHERE page_id LIKE 'alive-%'`)).toBe((ALIVE_PAGES - 1) * 2);

      // 存活页的派生行一条不动
      expect(count(db, `SELECT COUNT(*) AS n FROM collection WHERE page_id = 'alive-00'`)).toBe(1);
      expect(count(db, `SELECT COUNT(*) AS n FROM record WHERE id = 'rec-alive'`)).toBe(1);
      expect(count(db, `SELECT COUNT(*) AS n FROM favorite WHERE page_id = 'alive-00'`)).toBe(1);
      expect(count(db, `SELECT COUNT(*) AS n FROM recent WHERE page_id = 'alive-00'`)).toBe(1);
      expect(count(db, `SELECT COUNT(*) AS n FROM page_link_index WHERE source_page_id = 'alive-00'`)).toBe(1);

      // 扣留页与其余引用面保留
      expect(count(db, `SELECT COUNT(*) AS n FROM page WHERE id IN ('soft-young','lock-tomb','parent-tomb')`)).toBe(3);
      expect(count(db, `SELECT COUNT(*) AS n FROM page_lock WHERE page_id = 'lock-tomb'`)).toBe(1);
      expect(count(db, `SELECT COUNT(*) AS n FROM page WHERE id = 'live-child'`)).toBe(1);

      // 被清页的引用面全清（block/collection/record/favorite/recent/双链两侧/import_source/FTS）
      expect(count(db, `SELECT COUNT(*) AS n FROM block WHERE page_id LIKE 'tomb-%'`)).toBe(0);
      expect(count(db, `SELECT COUNT(*) AS n FROM collection WHERE id = 'coll-tomb'`)).toBe(0);
      expect(count(db, `SELECT COUNT(*) AS n FROM record WHERE id = 'rec-tomb'`)).toBe(0);
      expect(count(db, `SELECT COUNT(*) AS n FROM favorite WHERE page_id = 'tomb-00'`)).toBe(0);
      expect(count(db, `SELECT COUNT(*) AS n FROM recent WHERE page_id = 'tomb-00'`)).toBe(0);
      expect(
        count(db, `SELECT COUNT(*) AS n FROM page_link_index WHERE source_page_id = 'tomb-00' OR target_page_id = 'tomb-00'`),
      ).toBe(0);
      expect(count(db, `SELECT COUNT(*) AS n FROM import_source WHERE page_id = 'tomb-00'`)).toBe(0);
      expect(count(db, `SELECT COUNT(*) AS n FROM page_block_fts WHERE page_id LIKE 'tomb-%'`)).toBe(0);
      expect(count(db, `SELECT COUNT(*) AS n FROM page WHERE id LIKE 'tomb-%'`)).toBe(0);
      expect(count(db, `SELECT COUNT(*) AS n FROM page WHERE id = 'soft-mature'`)).toBe(0);

      // **op_ledger 逐字节不变**（含被清页的 delete op 行）
      expect(ledgerDump(db)).toBe(ledgerBefore);

      // 被清页不可恢复：restorePage 抛明确错误码
      const pages = createPagesService({ executor: coreExecutor(core), actor: ACTOR, userKey: 'u' });
      const restored = await pages.restorePage({ id: 'tomb-00' }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(restored).toBeInstanceOf(PagesApiError);
      expect((restored as PagesApiError).code).toBe('E_NOT_FOUND');
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('分批上限：> DB_GC_BATCH_PAGES 的放行数切多个事务批', async () => {
    const temp = makeTempDb('septcats-dbgc-batch');
    const core = makeCore(ctor, temp.path);
    try {
      await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
      const db = core.activeDatabase();
      const total = DB_GC_BATCH_PAGES + 1;
      db.transaction(() => {
        for (let i = 0; i < total; i += 1) {
          seedPage(db, `bulk-${String(i).padStart(3, '0')}`, 0, null, 0);
        }
      })();

      const service = createDbGcService({ executor: coreExecutor(core), now: () => NOW });
      expect((await service.preview()).deletable).toBe(total);
      const result = await service.run();
      expect(result.deletedPages).toBe(total);
      expect(result.batches).toBe(2);
      expect(count(db, `SELECT COUNT(*) AS n FROM page WHERE id LIKE 'bulk-%'`)).toBe(0);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('deleted_at 无标记（旧 softDelete 残留）→ 扣留 unreachable，绝不物理删', async () => {
    const temp = makeTempDb('septcats-dbgc-legacy');
    const core = makeCore(ctor, temp.path);
    try {
      await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
      const db = core.activeDatabase();
      insert(db, `INSERT INTO page (id, workspace_id, title, sort_key, alive, version, updated_at, deleted_at)
                  VALUES ('legacy', ?, 'x', 'A1', 0, 1, ?, NULL)`, WS, AT - 90 * DAY);

      const service = createDbGcService({ executor: coreExecutor(core), now: () => NOW });
      const preview = await service.preview();
      expect(preview.deletable).toBe(0);
      expect(preview.heldByReason.unreachable).toBe(1);
      const result = await service.run();
      expect(result.deletedPages).toBe(0);
      expect(count(db, `SELECT COUNT(*) AS n FROM page WHERE id = 'legacy'`)).toBe(1);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });
});
