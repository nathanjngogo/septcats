import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildSegment, type ActorId, type Op, type TargetTable } from '@septcats/core';
import type { DbServerCore } from '../src/db/server';
import type {
  AllData,
  BackupData,
  BatchData,
  ExportSnapshotData,
  FtsSearchData,
  GetData,
  IntegrityCheckData,
  MigrateData,
  RebuildData,
} from '../src/db/rpc';
import { describeDb, makeCore, makeTempDb, requestFail, requestOk, type TempDb } from './helpers';

const AT = 1_700_000_000_000;
const DEV: ActorId = 'aaaa0001';
const WS = 'ws-1';
const PAGE = 'pg-1';
const BLOCK = 'bk-1';
const BLOCK2 = 'bk-2';

let requestSeq = 0;
function nextId(label: string): string {
  requestSeq += 1;
  return `${label}-${requestSeq}`;
}

function makeOp(
  id: string,
  c: number,
  table: TargetTable,
  entityId: string,
  payload: Record<string, unknown>,
): Op {
  return {
    op_id: id,
    lamport: { c, d: DEV },
    at: AT,
    actor: DEV,
    target: { table, id: entityId },
    kind: 'upsert',
    payload,
  };
}

describeDb('DbServer core 派发（better-sqlite3 直连）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;

  beforeEach(async () => {
    temp = makeTempDb('septcats-server');
    core = makeCore(ctor, temp.path);
    await requestOk<MigrateData>(core, { id: nextId('migrate'), t: 'migrate' });
  });

  afterEach(() => {
    core.dispose();
    temp.cleanup();
  });

  async function seed(): Promise<void> {
    await requestOk(core, {
      id: nextId('seed-page'),
      t: 'run',
      sqlId: 'page.upsert',
      params: { id: PAGE, workspace_id: WS, title: '中文测试页', sort_key: 'A00000000', version: 1 },
    });
    await requestOk(core, {
      id: nextId('seed-block'),
      t: 'run',
      sqlId: 'block.upsert',
      params: {
        id: BLOCK,
        page_id: PAGE,
        workspace_id: WS,
        type: 'paragraph',
        props_json: JSON.stringify({ title: '中文测试块标题' }),
        sort_key: 'A00000000',
        version: 1,
        lamport_c: 1,
        lamport_d: DEV,
      },
    });
  }

  it('sqlId 不在白名单 → E_UNKNOWN_STATEMENT，且绝不执行（安全红线）', async () => {
    const runError = await requestFail(core, {
      id: nextId('evil-run'),
      t: 'run',
      sqlId: 'page; DROP TABLE page',
      params: {},
    });
    expect(runError.code).toBe('E_UNKNOWN_STATEMENT');

    const allError = await requestFail(core, {
      id: nextId('evil-all'),
      t: 'all',
      sqlId: '__proto__',
      params: {},
    });
    expect(allError.code).toBe('E_UNKNOWN_STATEMENT');

    // page 表仍在
    const page = await requestOk<GetData>(core, {
      id: nextId('page-alive'),
      t: 'get',
      sqlId: 'page.get',
      params: { id: PAGE },
    });
    expect(page.row).toBeNull();
  });

  it('参数非法 → E_BAD_PARAMS，且错误消息不回显参数值', async () => {
    const error = await requestFail(core, {
      id: nextId('bad-params'),
      t: 'run',
      sqlId: 'page.upsert',
      params: { id: PAGE, workspace_id: WS, sort_key: 'A00000000', version: 'SECRET-VALUE-42' },
    });
    expect(error.code).toBe('E_BAD_PARAMS');
    expect(error.message).toContain('version');
    expect(error.message).not.toContain('SECRET-VALUE-42');
  });

  it('kind 不符 → E_WRONG_KIND', async () => {
    const error = await requestFail(core, {
      id: nextId('wrong-kind'),
      t: 'get',
      sqlId: 'page.upsert',
      params: {},
    });
    expect(error.code).toBe('E_WRONG_KIND');
  });

  it('run / get / all 正常往返', async () => {
    await seed();

    const page = await requestOk<GetData>(core, {
      id: nextId('page-get'),
      t: 'get',
      sqlId: 'page.get',
      params: { id: PAGE },
    });
    expect((page.row as { title?: string }).title).toBe('中文测试页');

    const pages = await requestOk<AllData>(core, {
      id: nextId('page-list'),
      t: 'all',
      sqlId: 'page.listByWorkspace',
      params: { workspace_id: WS },
    });
    expect(pages.rows).toHaveLength(1);

    const missing = await requestOk<GetData>(core, {
      id: nextId('missing'),
      t: 'get',
      sqlId: 'page.get',
      params: { id: 'does-not-exist' },
    });
    expect(missing.row).toBeNull();
  });

  it('batch 成功：单事务写入多条并落 op_ledger', async () => {
    const blockOp = makeOp('op-batch-block', 1, 'block', BLOCK, {
      page_id: PAGE,
      workspace_id: WS,
      type: 'paragraph',
      props: { title: '批量块' },
      sort_key: 'A00000000',
      alive: 1,
    });

    const batch = await requestOk<BatchData>(core, {
      id: nextId('batch'),
      t: 'batch',
      stmts: [
        {
          sqlId: 'page.upsert',
          params: { id: PAGE, workspace_id: WS, title: '批量页', sort_key: 'A00000000', version: 1 },
        },
        {
          sqlId: 'opLedger.insert',
          params: {
            op_id: blockOp.op_id,
            lamport_c: 1,
            lamport_d: DEV,
            target_table: 'block',
            target_id: BLOCK,
            op_json: JSON.stringify({ op_id: blockOp.op_id }),
            applied_at: AT,
          },
        },
      ],
    });
    expect(batch.results).toHaveLength(2);
    expect(batch.results[0]!.sqlId).toBe('page.upsert');
    expect((batch.results[0]!.data as { changes: number }).changes).toBe(1);

    const count = await requestOk<GetData>(core, {
      id: nextId('ledger-count'),
      t: 'get',
      sqlId: 'opLedger.count',
      params: {},
    });
    expect((count.row as { n: number }).n).toBe(1);
  });

  it('batch 原子性：任一语句失败 → 整个事务回滚', async () => {
    const error = await requestFail(core, {
      id: nextId('batch-fail'),
      t: 'batch',
      stmts: [
        {
          sqlId: 'page.upsert',
          params: { id: PAGE, workspace_id: WS, title: '会被回滚', sort_key: 'A00000000', version: 1 },
        },
        { sqlId: 'not-a-real-statement', params: {} },
      ],
    });
    expect(error.code).toBe('E_UNKNOWN_STATEMENT');

    const page = await requestOk<GetData>(core, {
      id: nextId('rolled-back'),
      t: 'get',
      sqlId: 'page.get',
      params: { id: PAGE },
    });
    expect(page.row).toBeNull();
  });

  it('ftsSearch：trigram 命中中文子串', async () => {
    await seed();

    const found = await requestOk<FtsSearchData>(core, {
      id: nextId('fts'),
      t: 'ftsSearch',
      workspaceId: WS,
      query: '中文测',
      limit: 10,
    });
    expect(found.rows.length).toBeGreaterThan(0);
    expect(found.rows[0]!.page_id).toBe(PAGE);
    expect(typeof found.rows[0]!.title).toBe('string');

    const none = await requestOk<FtsSearchData>(core, {
      id: nextId('fts-miss'),
      t: 'ftsSearch',
      workspaceId: WS,
      query: '不存在的词组',
      limit: 10,
    });
    expect(none.rows).toHaveLength(0);

    const empty = await requestOk<FtsSearchData>(core, {
      id: nextId('fts-empty'),
      t: 'ftsSearch',
      workspaceId: WS,
      query: '   ',
      limit: 10,
    });
    expect(empty.rows).toHaveLength(0);
  });

  it('integrityCheck 报 ok', async () => {
    await seed();
    const result = await requestOk<IntegrityCheckData>(core, { id: nextId('integrity'), t: 'integrityCheck' });
    expect(result.ok).toBe(true);
    expect(result.messages).toEqual([]);
  });

  it('backupTo 产出可打开的备份文件', async () => {
    await seed();
    const dest = `${temp.dir}/backup.db`;
    const result = await requestOk<BackupData>(core, { id: nextId('backup'), t: 'backupTo', destPath: dest });
    expect(result.path).toBe(dest);

    const backup = new ctor(dest);
    try {
      const row = backup.prepare('SELECT COUNT(*) AS n FROM page').get() as { n: number };
      expect(row.n).toBe(1);
    } finally {
      backup.close();
    }
  });

  it('exportSnapshot：从 op_ledger 全量重放并产出稳定快照', async () => {
    const pageOp = makeOp('op-snap-page', 1, 'page', PAGE, { workspace_id: WS, title: '快照页', sort_key: 'A', alive: 1 });
    await requestOk(core, {
      id: nextId('snap-op'),
      t: 'run',
      sqlId: 'opLedger.insert',
      params: {
        op_id: pageOp.op_id,
        lamport_c: 1,
        lamport_d: DEV,
        target_table: 'page',
        target_id: PAGE,
        op_json: JSON.stringify(pageOp),
        applied_at: AT,
      },
    });

    const snapshot = await requestOk<ExportSnapshotData>(core, { id: nextId('snapshot'), t: 'exportSnapshot' });
    const parsed = JSON.parse(snapshot.json) as { v: number; entities: Array<{ id: string; table: string }> };
    expect(parsed.v).toBe(2); // schema v2（T19-02）
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0]!.id).toBe(PAGE);
    expect(parsed.entities[0]!.table).toBe('page');
  });

  it('rebuildFromSegments：清表 → 重放 → 写 op_ledger + 物化表 + FTS', async () => {
    const pageOp = makeOp('op-rb-page', 1, 'page', PAGE, {
      workspace_id: WS,
      title: '重建页',
      sort_key: 'A00000000',
      alive: 1,
    });
    const blockOp = makeOp('op-rb-block-1', 2, 'block', BLOCK, {
      page_id: PAGE,
      workspace_id: WS,
      type: 'paragraph',
      props: { title: '第一段中文标题' },
      sort_key: 'A00000000',
      alive: 1,
    });
    const block2Op = makeOp('op-rb-block-2', 3, 'block', BLOCK2, {
      page_id: PAGE,
      workspace_id: WS,
      type: 'paragraph',
      props: { title: '第二段中文标题' },
      sort_key: 'A00000001',
      alive: 1,
    });
    const segmentsJson = JSON.stringify([
      buildSegment(DEV, [pageOp, blockOp], AT),
      buildSegment(DEV, [block2Op], AT),
    ]);

    const rebuilt = await requestOk<RebuildData>(core, {
      id: nextId('rebuild'),
      t: 'rebuildFromSegments',
      segmentsJson,
    });
    expect(rebuilt.segments).toBe(2);
    expect(rebuilt.ops).toBe(3);
    expect(rebuilt.entities).toBe(3);

    const blocks = await requestOk<AllData>(core, {
      id: nextId('rb-blocks'),
      t: 'all',
      sqlId: 'block.listByPage',
      params: { page_id: PAGE },
    });
    expect(blocks.rows).toHaveLength(2);

    const count = await requestOk<GetData>(core, {
      id: nextId('rb-count'),
      t: 'get',
      sqlId: 'opLedger.count',
      params: {},
    });
    expect((count.row as { n: number }).n).toBe(3);

    const fts = await requestOk<FtsSearchData>(core, {
      id: nextId('rb-fts'),
      t: 'ftsSearch',
      workspaceId: WS,
      query: '第二段',
      limit: 10,
    });
    expect(fts.rows.some((row) => row.page_id === PAGE)).toBe(true);

    // 再次重建应幂等（清表后重建，不产生重复 op）
    await requestOk<RebuildData>(core, { id: nextId('rebuild-again'), t: 'rebuildFromSegments', segmentsJson });
    const count2 = await requestOk<GetData>(core, {
      id: nextId('rb-count-2'),
      t: 'get',
      sqlId: 'opLedger.count',
      params: {},
    });
    expect((count2.row as { n: number }).n).toBe(3);
  });

  it('rebuildFromSegments：非法输入 → E_BAD_PARAMS', async () => {
    const notJson = await requestFail(core, {
      id: nextId('rb-bad-json'),
      t: 'rebuildFromSegments',
      segmentsJson: '{not json',
    });
    expect(notJson.code).toBe('E_BAD_PARAMS');

    const notArray = await requestFail(core, {
      id: nextId('rb-not-array'),
      t: 'rebuildFromSegments',
      segmentsJson: '{"seg_id":"x"}',
    });
    expect(notArray.code).toBe('E_BAD_PARAMS');

    const badSegment = await requestFail(core, {
      id: nextId('rb-bad-segment'),
      t: 'rebuildFromSegments',
      segmentsJson: JSON.stringify([{ seg_id: 'seg-x', schema_ver: 1, header: {}, ops: [] }]),
    });
    expect(badSegment.code).toBe('E_BAD_PARAMS');
  });
});
