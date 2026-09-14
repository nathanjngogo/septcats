/**
 * importer-exec.test.ts —— 导入执行器端到端断言（TASK-T11-01C §1/§2，真 SQLite）。
 *
 * 走真实 better-sqlite3（DbServerCore + 白名单转发 + commitOps 同事务）：
 * - 全量导入：page/blocks/collection/record/asset 全链路 + op 对账；
 * - 幂等重跑：重新 plan（import_source 命中 → skippedDuplicate）与同 plan 重复 execute
 *   都是 0 新增；
 * - 失败续传：注入「页三」batch throw → report.failedAt 定位 → 重跑成功且 1-2 页不重复；
 * - blocks op 数断言：op_ledger 里 target_table='block' 行数 == plan items blocks 总数；
 * - LATEST_SCHEMA_VERSION 参数化（迁移版本断言不写死数字）。
 *
 * better-sqlite3 不可用时整组跳过（test/helpers.ts 的 ABI 守卫）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ActorId } from '@septcats/core';
import { LATEST_SCHEMA_VERSION } from '../src/db/migrations';
import type { AllData, BatchData, GetData, MigrateData, RunData } from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import { createImporterService, type ImporterService, type LoadedSource } from '../src/main/importer';
import type { StatementExecutor } from '../src/main/pages';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa0001';
const WORKSPACE_ID = 'ws-import-0001';

/** DbServerCore → StatementExecutor（同 dbview.test 口径）。 */
function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `importer-test-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
}

/** md-dir 源夹具：p1..p4 四页（front-matter 定题），p2 可带一张本地图片附件。 */
function mdDirSource(withImage: boolean): LoadedSource {
  const page = (title: string, body: string): string =>
    `---\ntitle: ${title}\n---\n\n${body}`;
  const files = new Map<string, string | Uint8Array>();
  files.set('p1.md', page('页一', '# 页一标题\n\n第一段。'));
  files.set('p2.md', page('页二', withImage ? '![示意图](pic.png)\n\n第二段。' : '第二段。'));
  files.set('p3.md', page('页三', '```\nconst x = 1;\n```\n\n第三段。'));
  files.set('p4.md', page('页四', '---\n\n第四段。'));
  if (withImage) {
    files.set('pic.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  }
  return { kind: 'md-dir', files };
}

/** csv 源夹具：单表两行（Name 强制 title、Age 推断 number）。 */
function csvSource(): LoadedSource {
  return { kind: 'csv', files: new Map([['台账.csv', 'Name,Age\n甲,3\n乙,4\n']]), path: '台账.csv' };
}

describeDb('importer 执行器（真 SQLite · commitOps 同事务）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let service: ImporterService;
  let attachmentsDir: string;
  let clock: number;
  let currentSource: LoadedSource;

  beforeEach(async () => {
    temp = makeTempDb('septcats-importer');
    core = makeCore(ctor, temp.path);
    const migrated = await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
    // LATEST_SCHEMA_VERSION 参数化：迁移必须推进到迁移表最后一条
    expect(migrated.to).toBe(LATEST_SCHEMA_VERSION);
    await requestOk<RunData>(core, {
      id: 'seed-ws',
      t: 'run',
      sqlId: 'workspace.upsert',
      params: {
        id: WORKSPACE_ID,
        name: '导入测试工作区',
        root_page_id: null,
        settings_json: '{}',
        created_at: 1_700_000_000_000,
      },
    });
    clock = 1_700_000_000_000;
    attachmentsDir = mkdtempSync(join(tmpdir(), 'septcats-importer-att-'));
    currentSource = mdDirSource(false);
    service = createImporterService({
      executor: coreExecutor(core),
      actor: ACTOR,
      attachmentsDir,
      activeWorkspaceId: async () => WORKSPACE_ID,
      now: () => {
        clock += 1;
        return clock;
      },
      loadSource: () => currentSource,
    });
  });

  afterEach(() => {
    core.dispose();
    temp.cleanup();
    rmSync(attachmentsDir, { recursive: true, force: true });
  });

  /** 白名单外只读断言走底层连接（SELECT 无注入面）。 */
  function rawCount(sql: string): number {
    const row = core.activeDatabase().prepare(sql).get() as { n: number } | undefined;
    return row?.n ?? -1;
  }

  async function ledgerCounts(): Promise<Map<string, number>> {
    const data = await requestOk<AllData>(core, { id: 'ledger-all', t: 'all', sqlId: 'opLedger.listAll', params: {} });
    const counts = new Map<string, number>();
    for (const row of data.rows as Array<{ target_table: string }>) {
      counts.set(row.target_table, (counts.get(row.target_table) ?? 0) + 1);
    }
    return counts;
  }

  it('全量导入：页/块/附件落库落盘，blocks op 数 == items blocks 总数', async () => {
    currentSource = mdDirSource(true);
    const preview = await service.plan({ dirPath: 'src' });
    expect(preview.counts.pages).toBe(4);
    expect(preview.counts.assets).toBe(1);

    const report = await service.execute({ planId: preview.planId, confirm: true });
    expect(report.status).toBe('done');
    expect(report.total).toBe(5); // 4 页 + 1 附件
    expect(report.done).toBe(5);
    expect(report.batchCount).toBe(4); // 每页一个 batch，附件不是 batch

    // blocks op 数断言：op_ledger 的 block 行数 == plan items 的 blocks 总数（2+2+2+2）
    const counts = await ledgerCounts();
    expect(counts.get('page')).toBe(4);
    expect(counts.get('block')).toBe(8);
    expect(report.opCount).toBe(12); // 4 page op + 8 block op

    // import_source：4 页各一行（附件是内容寻址，不记账）
    expect(rawCount('SELECT COUNT(*) AS n FROM import_source')).toBe(4);

    // 附件落盘：sha256 内容寻址 + 原扩展名
    const png = currentSource.files.get('pic.png') as Uint8Array;
    const hash = createHash('sha256').update(png).digest('hex');
    expect(existsSync(join(attachmentsDir, `${hash}.png`))).toBe(true);
  });

  it('幂等重跑：重新 plan 全部命中 skippedDuplicate，execute 0 新增；同 plan 重复 execute 0 新增', async () => {
    const first = await service.plan({ dirPath: 'src' });
    const firstReport = await service.execute({ planId: first.planId, confirm: true });
    expect(firstReport.status).toBe('done');
    const blocksAfterFirst = (await ledgerCounts()).get('block') ?? 0;
    expect(blocksAfterFirst).toBe(7); // 2+1+2+2（无图片夹具）

    // 重跑 ①：同源重新 plan → 计划期去重 4 条
    const second = await service.plan({ dirPath: 'src' });
    expect(second.counts.skippedDuplicate).toBe(4);
    const secondReport = await service.execute({ planId: second.planId, confirm: true });
    expect(secondReport.status).toBe('done');
    expect(rawCount('SELECT COUNT(*) AS n FROM import_source')).toBe(4);
    const counts = await ledgerCounts();
    expect(counts.get('page')).toBe(4);
    expect(counts.get('block')).toBe(blocksAfterFirst);

    // 重跑 ②：同 planId 重复 execute（断点语义兜底）→ 同样 0 新增
    const again = await service.execute({ planId: first.planId, confirm: true });
    expect(again.status).toBe('done');
    expect(again.opCount).toBe(firstReport.opCount);
    expect(rawCount('SELECT COUNT(*) AS n FROM import_source')).toBe(4);
    expect((await ledgerCounts()).get('block')).toBe(blocksAfterFirst);
  });

  it('失败续传：注入「页三」batch throw → failedAt 定位 → 重跑成功且 1-2 页不重复', async () => {
    // 武装：含「页三」page.upsert 的 batch 抛一次（此后放行，模拟故障恢复）
    const inner = coreExecutor(core);
    let armed = true;
    let batchCalls = 0;
    const failingExecutor: StatementExecutor = {
      run: inner.run,
      get: inner.get,
      all: inner.all,
      batch: async (stmts) => {
        batchCalls += 1;
        if (armed) {
          const hitsPage3 = stmts.some(
            (stmt) =>
              stmt.sqlId === 'page.upsert' &&
              (stmt.params as { title?: unknown })['title'] === '页三',
          );
          if (hitsPage3) {
            armed = false; // 只炸一次
            throw new Error('注入失败：第 3 页');
          }
        }
        return inner.batch(stmts);
      },
    };
    const failingService = createImporterService({
      executor: failingExecutor,
      actor: ACTOR,
      attachmentsDir,
      activeWorkspaceId: async () => WORKSPACE_ID,
      now: () => {
        clock += 1;
        return clock;
      },
      loadSource: () => currentSource,
    });

    const preview = await failingService.plan({ dirPath: 'src' });
    const failed = await failingService.execute({ planId: preview.planId, confirm: true });
    expect(failed.status).toBe('failed');
    expect(failed.failedAt).toBe(2); // p1/p2/p3/p4 先序 → 页三 = 下标 2
    expect(failed.error).toContain('注入失败');
    expect(rawCount('SELECT COUNT(*) AS n FROM import_source')).toBe(2); // 页一/页二已记账

    // 重跑（同 planId，从断点继续；armed 已解除）
    const resumed = await failingService.execute({ planId: preview.planId, confirm: true });
    expect(resumed.status).toBe('done');

    // 1-2 页不重复：4 页各一行，块总数完整
    const pages = await requestOk<AllData>(core, {
      id: 'pages-all',
      t: 'all',
      sqlId: 'page.listAll',
      params: { workspace_id: WORKSPACE_ID },
    });
    const titles = pages.rows.map((row) => (row as { title: string }).title).sort();
    expect(titles).toEqual(['页一', '页三', '页二', '页四']);
    expect(rawCount('SELECT COUNT(*) AS n FROM import_source')).toBe(4);
    const counts = await ledgerCounts();
    expect(counts.get('page')).toBe(4);
    expect(counts.get('block')).toBe(7);
  });

  it('csv 源：页 + collection + records 同 batch 落库，值类型保持 number', async () => {
    currentSource = csvSource();
    const preview = await service.plan({ csvPath: 'src' });
    expect(preview.counts.pages).toBe(1);
    expect(preview.counts.collections).toBe(1);
    expect(preview.counts.records).toBe(2);

    const report = await service.execute({ planId: preview.planId, confirm: true });
    expect(report.status).toBe('done');
    expect(report.batchCount).toBe(2); // 页 item 一个 batch + collection item 一个 batch
    expect(rawCount('SELECT COUNT(*) AS n FROM import_source')).toBe(2);

    // collection 物化：挂在该页下（page_id 非空）、records 2 行
    const collections = await requestOk<AllData>(core, {
      id: 'coll-list',
      t: 'all',
      sqlId: 'collection.listByWorkspace',
      params: { workspace_id: WORKSPACE_ID },
    });
    expect(collections.rows).toHaveLength(1);
    const collectionId = (collections.rows[0] as { id: string }).id;
    expect((collections.rows[0] as { page_id: string | null }).page_id).not.toBeNull();

    const records = await requestOk<AllData>(core, {
      id: 'rec-list',
      t: 'all',
      sqlId: 'record.listByCollection',
      params: { collection_id: collectionId },
    });
    expect(records.rows).toHaveLength(2);
    const allValues = records.rows
      .map((row) => JSON.stringify((row as { values_json: string }).values_json))
      .join('');
    expect(allValues).toContain('甲');
    expect(allValues).toContain(':3'); // Age 推断 number（值形 3，非 '3'）
  });

  // ---- E 修复（TASK-T11-01E / 缺陷账 #24）：层尾排序键饱和 → 整层重建 ----------------

  /** 直接种一个根层页（绕过导入器，模拟"库里已有密集 z 链"的历史态）。 */
  async function seedRootPage(id: string, title: string, sortKey: string, alive: number): Promise<void> {
    await requestOk<RunData>(core, {
      id: `seed-${id}`,
      t: 'run',
      sqlId: 'page.insert',
      params: {
        id,
        workspace_id: WORKSPACE_ID,
        title,
        icon: null,
        cover: null,
        parent_id: null,
        sort_key: sortKey,
        alive,
        version: 1,
        deleted_at: alive === 1 ? null : 0,
        updated_at: 1_700_000_000_000,
      },
    });
  }

  function rootLayerKeys(): Array<{ id: string; title: string; sortKey: string }> {
    return core
      .activeDatabase()
      .prepare(
        `SELECT id, title, sort_key FROM page WHERE workspace_id = ? AND parent_id IS NULL AND alive = 1 ORDER BY sort_key, id`,
      )
      .all(WORKSPACE_ID)
      .map((r) => r as { id: string; title: string; sort_key: string })
      .map((r) => ({ id: r.id, title: r.title, sortKey: r.sort_key }));
  }

  it('饱和回归：根层预置 z 链（15/16 字符）→ 导入全部 done、层键 ≤16、序不乱', async () => {
    // 密集历史态：尾键 'z'×16，下一次尾追加必撞 SORTKEY_MAX_LENGTH（真包 253/536 中断形态）
    await seedRootPage('seed-a', '种子A', 'z'.repeat(15), 1);
    await seedRootPage('seed-b', '种子B', 'z'.repeat(16), 1);

    const preview = await service.plan({ dirPath: 'src' }); // md-dir 4 页
    const report = await service.execute({ planId: preview.planId, confirm: true });
    expect(report.status).toBe('done');
    expect(report.failedAt).toBeNull();

    const rows = rootLayerKeys();
    expect(rows).toHaveLength(6); // 2 种子 + 4 导入页
    for (const row of rows) {
      expect(row.sortKey.length).toBeLessThanOrEqual(16);
    }
    // 整层重建后 keys 等间隔升序；种子在前（原 sort_key 序），导入页按先序挂尾
    const keys = rows.map((r) => r.sortKey);
    expect([...keys].sort()).toEqual(keys); // 返回序 == 键升序（listByParent ORDER BY 保证）
    expect(rows[0]?.title).toBe('种子A');
    expect(rows[1]?.title).toBe('种子B');
    expect(rows.slice(2).map((r) => r.title)).toEqual(['页一', '页二', '页三', '页四']);
    // 饱和点确实发生了 reorder（种子层重建 = 对存量兄弟重发；op_ledger 的 op_json 里有痕迹）
    const reordered = rawCount(
      `SELECT COUNT(*) AS n FROM op_ledger WHERE target_table='page' AND op_json LIKE '%"kind":"reorder"%'`,
    );
    expect(reordered).toBeGreaterThanOrEqual(2);
  });

  it('幂等不破：饱和重建后重跑 0 新增，且 alive=0 墓碑不被重建复活', async () => {
    await seedRootPage('seed-a', '种子A', 'z'.repeat(16), 1);
    await seedRootPage('seed-ghost', '墓碑页', 'z'.repeat(16) + '0', 0); // alive=0 排键尾后

    const preview = await service.plan({ dirPath: 'src' });
    const first = await service.execute({ planId: preview.planId, confirm: true });
    expect(first.status).toBe('done');
    const importSourceAfter = rawCount('SELECT COUNT(*) AS n FROM import_source');
    expect(importSourceAfter).toBe(4);

    // 墓碑不在任何重建集合里（listByParent 只回 alive=1），且仍是 alive=0
    const ghost = core
      .activeDatabase()
      .prepare(`SELECT alive FROM page WHERE id = 'seed-ghost'`)
      .get() as { alive: number } | undefined;
    expect(ghost?.alive).toBe(0);

    // 同 plan 重跑：0 新增（键已不密集，走常规尾追 + pageIds 幂等跳过）
    const again = await service.execute({ planId: preview.planId, confirm: true });
    expect(again.status).toBe('done');
    expect(again.opCount).toBe(first.opCount);
    expect(rawCount('SELECT COUNT(*) AS n FROM import_source')).toBe(importSourceAfter);
    expect(rootLayerKeys()).toHaveLength(5); // 种子A + 4 页（墓碑不计）
    expect(
      core.activeDatabase().prepare(`SELECT alive FROM page WHERE id='seed-ghost'`).get(),
    ).toMatchObject({ alive: 0 });
  });
});
