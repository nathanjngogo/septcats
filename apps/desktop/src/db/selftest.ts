/**
 * DbServer 纯 Node 冒烟自测（TASK-T2-01 §5）——**不依赖 Electron**。
 *
 * 覆盖：临时库 → migrate → batch 写 workspace/page/block/collection/record →
 * get 回读 → ftsSearch 命中中文子串（trigram）→ integrityCheck → backupTo →
 * 删主库文件 → rebuildFromSegments（core.segment 造 2 段合法段）→ 回读一致。
 *
 * 运行：`node apps/desktop/scripts/run-selftest.mjs`（内部用 tsx 加载本文件）。
 * 退出码：0 = 全部 PASS，1 = 有 FAIL。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSegment,
  encodeOp,
  type ActorId,
  type Op,
  type Segment,
  type TargetTable,
} from '@septcats/core';
import { applyPragmaBaseline, loadSqliteConstructor } from './migrations';
import { createDbServerCore, type DbServerCore } from './server';
import type {
  AllData,
  BackupData,
  BatchData,
  DbRequest,
  DbResponseData,
  ExportSnapshotData,
  FtsSearchData,
  GetData,
  IntegrityCheckData,
  MigrateData,
  RebuildData,
} from './rpc';

const AT = 1_700_000_000_000;
const DEV: ActorId = 'aaaa0001';
const WORKSPACE_ID = 'ws-selftest-1';
const PAGE_ID = 'pg-selftest-1';
const BLOCK_ID = 'bk-selftest-1';
const BLOCK2_ID = 'bk-selftest-2';
const COLLECTION_ID = 'cl-selftest-1';
const RECORD_ID = 'rc-selftest-1';
const PAGE_TITLE = '中文测试页';
const BLOCK_TITLE = '中文测试块标题';
const BLOCK2_TITLE = '第二段中文标题';

let failures = 0;
let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `selftest-${idCounter}`;
}

function check(name: string, pass: boolean, detail = ''): void {
  if (pass) {
    console.log(`PASS ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${name}${detail.length > 0 ? ` — ${detail}` : ''}`);
}

async function requestOk<T extends DbResponseData>(core: DbServerCore, request: DbRequest): Promise<T> {
  const response = await core.handleRequest(request);
  if (!response.ok) {
    throw new Error(`${request.t} 失败：${response.error.code} ${response.error.message}`);
  }
  return response.data as T;
}

function makeUpsertOp(id: string, c: number, table: TargetTable, entityId: string, payload: Record<string, unknown>): Op {
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

function removeFileQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // ignore
  }
}

function blockTitles(rows: readonly unknown[]): string[] {
  const titles: string[] = [];
  for (const row of rows) {
    const propsJson = (row as { props_json?: unknown }).props_json;
    if (typeof propsJson !== 'string') {
      continue;
    }
    try {
      const parsed = JSON.parse(propsJson) as { title?: unknown };
      if (typeof parsed.title === 'string') {
        titles.push(parsed.title);
      }
    } catch {
      // 非法 JSON 视为缺失
    }
  }
  return titles;
}

async function main(): Promise<void> {
  const ctor = await loadSqliteConstructor();

  const workDir = mkdtempSync(join(tmpdir(), 'septcats-selftest-'));
  const dbPath = join(workDir, 'septcats.db');
  const backupPath = join(workDir, 'snapshot-backup.db');
  let core: DbServerCore | null = null;

  try {
    // ---- 1. 迁移 ---------------------------------------------------------
    core = createDbServerCore(new ctor(dbPath));
    applyPragmaBaseline(core.activeDatabase());
    const migrated = await requestOk<MigrateData>(core, { id: nextId(), t: 'migrate' });
    check('migrate v0→v1', migrated.from === 0 && migrated.to === 1, `from=${migrated.from} to=${migrated.to}`);

    const second = await requestOk<MigrateData>(core, { id: nextId(), t: 'migrate' });
    check('migrate 幂等（第二次无变化）', second.from === 1 && second.to === 1);

    // ---- 2. batch 单事务写入 + op_ledger ---------------------------------
    const pageOp = makeUpsertOp('op-selftest-page-1', 1, 'page', PAGE_ID, {
      workspace_id: WORKSPACE_ID,
      title: PAGE_TITLE,
      sort_key: 'A00000000',
      alive: 1,
    });
    const blockOp = makeUpsertOp('op-selftest-block-1', 2, 'block', BLOCK_ID, {
      page_id: PAGE_ID,
      workspace_id: WORKSPACE_ID,
      type: 'paragraph',
      props: { title: BLOCK_TITLE },
      content: { text: '正文段落内容' },
      sort_key: 'A00000000',
      alive: 1,
    });

    const batch = await requestOk<BatchData>(core, {
      id: nextId(),
      t: 'batch',
      stmts: [
        {
          sqlId: 'workspace.upsert',
          params: { id: WORKSPACE_ID, name: '自测工作区', root_page_id: PAGE_ID, settings_json: '{}', created_at: AT },
        },
        {
          sqlId: 'page.upsert',
          params: {
            id: PAGE_ID,
            workspace_id: WORKSPACE_ID,
            title: PAGE_TITLE,
            sort_key: 'A00000000',
            alive: 1,
            version: 1,
            updated_at: AT,
          },
        },
        {
          sqlId: 'collection.upsert',
          params: {
            id: COLLECTION_ID,
            page_id: PAGE_ID,
            workspace_id: WORKSPACE_ID,
            name: '自测数据库',
            schema_json: '{}',
            views_json: '[]',
            alive: 1,
            version: 1,
            lamport_c: 1,
            lamport_d: DEV,
            updated_at: AT,
          },
        },
        {
          sqlId: 'block.upsert',
          params: {
            id: BLOCK_ID,
            page_id: PAGE_ID,
            workspace_id: WORKSPACE_ID,
            type: 'paragraph',
            props_json: JSON.stringify({ title: BLOCK_TITLE }),
            content_json: JSON.stringify({ text: '正文段落内容' }),
            sort_key: 'A00000000',
            alive: 1,
            version: 1,
            lamport_c: 2,
            lamport_d: DEV,
            updated_at: AT,
          },
        },
        {
          sqlId: 'record.upsert',
          params: {
            id: RECORD_ID,
            collection_id: COLLECTION_ID,
            workspace_id: WORKSPACE_ID,
            values_json: JSON.stringify({ 名称: '第一行' }),
            sort_key: 'A00000000',
            alive: 1,
            version: 1,
            lamport_c: 1,
            lamport_d: DEV,
            updated_at: AT,
          },
        },
        {
          sqlId: 'opLedger.insert',
          params: {
            op_id: blockOp.op_id,
            seg_id: null,
            lamport_c: 2,
            lamport_d: DEV,
            target_table: 'block',
            target_id: BLOCK_ID,
            op_json: encodeOp(blockOp),
            applied_at: AT,
          },
        },
      ],
    });
    check('batch 一次性写入 6 条语句', batch.results.length === 6, `实际=${batch.results.length}`);

    // ---- 3. 回读 ---------------------------------------------------------
    const pageRow = await requestOk<GetData>(core, {
      id: nextId(),
      t: 'get',
      sqlId: 'page.get',
      params: { id: PAGE_ID },
    });
    const title = (pageRow.row as { title?: unknown } | null)?.title;
    check('get 回读 page.title', title === PAGE_TITLE, `实际=${String(title)}`);

    const blocks = await requestOk<AllData>(core, {
      id: nextId(),
      t: 'all',
      sqlId: 'block.listByPage',
      params: { page_id: PAGE_ID },
    });
    check('all 回读 block.listByPage', blocks.rows.length === 1 && blockTitles(blocks.rows)[0] === BLOCK_TITLE);

    // ---- 4. FTS 中文子串 -------------------------------------------------
    const fts = await requestOk<FtsSearchData>(core, {
      id: nextId(),
      t: 'ftsSearch',
      workspaceId: WORKSPACE_ID,
      query: '中文测',
      limit: 10,
    });
    check(
      'ftsSearch 命中中文子串（trigram）',
      fts.rows.some((row) => row.page_id === PAGE_ID),
      `rows=${fts.rows.length}`,
    );

    // ---- 5. 安全红线 -----------------------------------------------------
    const evil = await core.handleRequest({ id: nextId(), t: 'run', sqlId: 'page; DROP TABLE page', params: {} });
    check(
      'sqlId 越界被拒不执行（E_UNKNOWN_STATEMENT）',
      !evil.ok && evil.error.code === 'E_UNKNOWN_STATEMENT',
    );

    // ---- 6. 完整性检查 ---------------------------------------------------
    const integrity = await requestOk<IntegrityCheckData>(core, {
      id: nextId(),
      t: 'integrityCheck',
    });
    check('integrityCheck ok', integrity.ok, integrity.messages.join(' / '));

    // ---- 7. 备份 ---------------------------------------------------------
    const backup = await requestOk<BackupData>(core, { id: nextId(), t: 'backupTo', destPath: backupPath });
    check('backupTo 产出文件', existsSync(backup.path), backup.path);

    const snapshot = await requestOk<ExportSnapshotData>(core, { id: nextId(), t: 'exportSnapshot' });
    let snapshotEntities = -1;
    try {
      const parsed = JSON.parse(snapshot.json) as { entities?: unknown[] };
      snapshotEntities = Array.isArray(parsed.entities) ? parsed.entities.length : -1;
    } catch {
      snapshotEntities = -1;
    }
    check('exportSnapshot 是合法快照 JSON', snapshotEntities === 1, `entities=${snapshotEntities}`);

    // ---- 8. 从分段重建 ---------------------------------------------------
    const block2Op = makeUpsertOp('op-selftest-block-2', 3, 'block', BLOCK2_ID, {
      page_id: PAGE_ID,
      workspace_id: WORKSPACE_ID,
      type: 'paragraph',
      props: { title: BLOCK2_TITLE },
      sort_key: 'A00000001',
      alive: 1,
    });
    const seg1: Segment = buildSegment(DEV, [pageOp, blockOp], AT);
    const seg2: Segment = buildSegment(DEV, [block2Op], AT);
    const segmentsJson = JSON.stringify([seg1, seg2]);

    core.dispose();
    core = null;
    removeFileQuietly(dbPath);
    removeFileQuietly(`${dbPath}-wal`);
    removeFileQuietly(`${dbPath}-shm`);
    check('删主库文件后库文件不存在', !existsSync(dbPath));

    core = createDbServerCore(new ctor(dbPath));
    applyPragmaBaseline(core.activeDatabase());
    await requestOk<MigrateData>(core, { id: nextId(), t: 'migrate' });

    const rebuilt = await requestOk<RebuildData>(core, {
      id: nextId(),
      t: 'rebuildFromSegments',
      segmentsJson,
    });
    check('rebuildFromSegments 应用 2 段', rebuilt.segments === 2 && rebuilt.ops === 3, JSON.stringify(rebuilt));

    const pageRow2 = await requestOk<GetData>(core, {
      id: nextId(),
      t: 'get',
      sqlId: 'page.get',
      params: { id: PAGE_ID },
    });
    const title2 = (pageRow2.row as { title?: unknown } | null)?.title;
    check('rebuild 后 page.title 一致', title2 === PAGE_TITLE, `实际=${String(title2)}`);

    const blocks2 = await requestOk<AllData>(core, {
      id: nextId(),
      t: 'all',
      sqlId: 'block.listByPage',
      params: { page_id: PAGE_ID },
    });
    const titles2 = blockTitles(blocks2.rows);
    check(
      'rebuild 后两个块都在且标题一致',
      titles2.length === 2 && titles2.includes(BLOCK_TITLE) && titles2.includes(BLOCK2_TITLE),
      titles2.join(' / '),
    );

    const ledgerCount = await requestOk<GetData>(core, {
      id: nextId(),
      t: 'get',
      sqlId: 'opLedger.count',
      params: {},
    });
    const ledgerRows = (ledgerCount.row as { n?: unknown } | null)?.n;
    check('rebuild 后 op_ledger 事件数=3', ledgerRows === 3, `实际=${String(ledgerRows)}`);

    const fts2 = await requestOk<FtsSearchData>(core, {
      id: nextId(),
      t: 'ftsSearch',
      workspaceId: WORKSPACE_ID,
      query: '第二段',
      limit: 10,
    });
    check(
      'rebuild 后 ftsSearch 命中第二段块标题',
      fts2.rows.some((row) => row.page_id === PAGE_ID),
      `rows=${fts2.rows.length}`,
    );

    const integrity2 = await requestOk<IntegrityCheckData>(core, {
      id: nextId(),
      t: 'integrityCheck',
    });
    check('rebuild 后 integrityCheck ok', integrity2.ok, integrity2.messages.join(' / '));
  } finally {
    core?.dispose();
    rmSync(workDir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? 'SELFTEST OK' : `SELFTEST FAILED（${failures} 项）`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error: unknown) => {
    const reason = error instanceof Error ? error.stack ?? error.message : String(error);
    console.log(`FAIL 自测执行异常 — ${reason}`);
    console.log('SELFTEST FAILED（1 项）');
    process.exit(1);
  });
