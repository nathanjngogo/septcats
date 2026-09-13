/**
 * dbview.test.ts —— 主进程「行内数据库」服务的端到端断言（TASK-T7b-01 §6）。
 *
 * 走真实 better-sqlite3（经 DbServerCore + 白名单转发），同时验证：
 * 迁移 v3 → 白名单语句 → commitOps（ledger + 物化同事务）→ dbViewService 语义。
 * better-sqlite3 不可用时整组跳过（见 test/helpers.ts）。
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ActorId } from '@septcats/core';
import type { AllData, BatchData, GetData, MigrateData, RunData } from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import {
  DbViewApiError,
  createDbViewService,
  type DbViewService,
} from '../src/main/dbview';
import type { StatementExecutor } from '../src/main/pages';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa0001';
const AT = 1_700_000_000_000;
const WORKSPACE_ID = 'ws-test-0001';

function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `dbview-test-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
}

interface LedgerRow {
  op_json: string;
  target_table: string;
  target_id: string;
}

describeDb('dbViewService（行内数据库 · create/load/record/relation/delete）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let service: DbViewService;
  let clock: number;
  let requestSeq = 0;

  beforeEach(async () => {
    temp = makeTempDb('septcats-dbview');
    core = makeCore(ctor, temp.path);
    await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
    clock = AT;
    service = createDbViewService({
      executor: coreExecutor(core),
      actor: ACTOR,
      now: () => {
        clock += 1;
        return clock;
      },
    });
    requestSeq = 0;
    await requestOk<RunData>(core, {
      id: `seed-ws-${String(requestSeq++)}`,
      t: 'run',
      sqlId: 'workspace.upsert',
      params: {
        id: WORKSPACE_ID,
        name: '测试工作区',
        root_page_id: null,
        settings_json: '{}',
        created_at: AT,
      },
    });
  });

  afterEach(() => {
    core.dispose();
    temp.cleanup();
  });

  async function opCount(): Promise<number> {
    const data = await requestOk<GetData>(core, {
      id: `ledger-count-${String(requestSeq++)}`,
      t: 'get',
      sqlId: 'opLedger.count',
      params: {},
    });
    return (data.row as { n: number } | null)?.n ?? -1;
  }

  async function ledgerRows(): Promise<LedgerRow[]> {
    const data = await requestOk<AllData>(core, {
      id: `ledger-all-${String(requestSeq++)}`,
      t: 'all',
      sqlId: 'opLedger.listAll',
      params: {},
    });
    return data.rows as LedgerRow[];
  }

  async function expectApiError(promise: Promise<unknown>, code: string): Promise<void> {
    try {
      await promise;
    } catch (error) {
      expect(error, `期望 DbViewApiError(${code})`).toBeInstanceOf(DbViewApiError);
      expect((error as DbViewApiError).code).toBe(code);
      return;
    }
    throw new Error(`期望抛错 ${code}，但调用成功`);
  }

  it('create → load 全链路：建页同事务两 op，collection 带默认标题属性与默认视图', async () => {
    const before = await opCount();
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '研究库' });
    expect(created.pageId).toBeTruthy();
    expect(created.collectionId).toBeTruthy();
    expect(await opCount()).toBe(before + 2);

    const loaded = await service.load({ pageId: created.pageId });
    expect(loaded.records).toHaveLength(0);
    expect(loaded.collection.name).toBe('研究库');
    expect(loaded.collection.id).toBe(created.collectionId);
    expect(loaded.collection.page_id).toBe(created.pageId);
    expect(Object.keys(loaded.collection.schema.properties)).toHaveLength(1);
    expect(loaded.collection.schema.title_pid).toBeTruthy();
    expect(loaded.collection.views).toHaveLength(1);
  });

  it('createRecord：sort_key 层尾、op_ledger 恰好 1 条、payload 不含 backlinks_json', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '研究库' });
    const loaded = await service.load({ pageId: created.pageId });
    const titlePid = loaded.collection.schema.title_pid;

    const before = await opCount();
    const { record } = await service.createRecord({
      pageId: created.pageId,
      values: { [titlePid]: '第一条' },
    });
    expect(await opCount()).toBe(before + 1);
    expect(record.values[titlePid]).toBe('第一条');
    expect(record.sort_key).toBeTruthy();

    // 第二个记录 sort_key 严格在第一个之后
    const second = await service.createRecord({ pageId: created.pageId, values: { [titlePid]: '第二条' } });
    expect(record.sort_key < second.record.sort_key).toBe(true);

    // 全部 op 的 payload 都不含 backlinks_json（派生态）
    for (const row of await ledgerRows()) {
      expect(row.op_json).not.toContain('backlinks_json');
    }
  });

  it('rename：page.title + collection.name 同事务双写（一批两 op）', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '旧名' });
    const before = await opCount();
    const result = await service.rename({ pageId: created.pageId, title: '新名' });
    expect(result.ok).toBe(true);
    expect(await opCount()).toBe(before + 2);

    const loaded = await service.load({ pageId: created.pageId });
    expect(loaded.collection.name).toBe('新名');

    const page = await requestOk<GetData>(core, {
      id: `page-get-${String(requestSeq++)}`,
      t: 'get',
      sqlId: 'page.get',
      params: { id: created.pageId },
    });
    expect((page.row as { title: string }).title).toBe('新名');
  });

  it('addProperty / removeProperty / saveView：collection 整对象/局部 patch 各 1 op', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '研究库' });

    const beforeAdd = await opCount();
    const added = await service.addProperty({ pageId: created.pageId, type: 'number' });
    expect(await opCount()).toBe(beforeAdd + 1);
    expect(Object.keys(added.collection.schema.properties)).toHaveLength(2);
    const numberPid = Object.keys(added.collection.schema.properties).find(
      (pid) => added.collection.schema.properties[pid]?.type === 'number',
    );
    expect(numberPid).toBeTruthy();

    const beforeView = await opCount();
    const view = added.collection.views[0];
    expect(view).toBeTruthy();
    const saved = await service.saveView({
      pageId: created.pageId,
      view: { ...(view as NonNullable<typeof view>), name: '改了名' },
    });
    expect(await opCount()).toBe(beforeView + 1);
    expect(saved.collection.views[0]?.name).toBe('改了名');

    const beforeRemove = await opCount();
    const removed = await service.removeProperty({ pageId: created.pageId, pid: numberPid as string });
    expect(await opCount()).toBe(beforeRemove + 1);
    expect(Object.keys(removed.collection.schema.properties)).toHaveLength(1);
  });

  it('record:update（普通值）：1 op，值落库，version 前进', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '研究库' });
    const loaded = await service.load({ pageId: created.pageId });
    const titlePid = loaded.collection.schema.title_pid;
    const { record } = await service.createRecord({ pageId: created.pageId, values: { [titlePid]: '旧值' } });

    const before = await opCount();
    const updated = await service.updateRecord({
      pageId: created.pageId,
      recordId: record.id,
      patch: { [titlePid]: '新值' },
    });
    expect(await opCount()).toBe(before + 1);
    expect(updated.record.values[titlePid]).toBe('新值');
    expect(updated.record.version).toBe(record.version + 1);
  });

  it('relation 双写：一个 batch 两 op，对方 backlink 落库，payload 不含 backlinks_json', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '关联库' });
    const collectionId = created.collectionId;
    const { collection } = await service.addProperty({ pageId: created.pageId, type: 'relation' });
    const relationPid = Object.keys(collection.schema.properties).find(
      (pid) => collection.schema.properties[pid]?.type === 'relation',
    ) as string;
    const titlePid = collection.schema.title_pid;

    const source = await service.createRecord({ pageId: created.pageId, values: { [titlePid]: '来源记录' } });
    const target = await service.createRecord({ pageId: created.pageId, values: { [titlePid]: '目标记录' } });

    const before = await opCount();
    await service.updateRecord({
      pageId: created.pageId,
      recordId: source.record.id,
      patch: { [relationPid]: [target.record.id] },
    });
    // 主记录 upsert + 对方记录 upsert = 一个 batch 两 op
    expect(await opCount()).toBe(before + 2);

    // 对方记录的 backlinks_json 记录了「来源 collection → 来源 record」
    const targetRow = await requestOk<GetData>(core, {
      id: `record-target-${String(requestSeq++)}`,
      t: 'get',
      sqlId: 'record.get',
      params: { id: target.record.id },
    });
    const backlinks = JSON.parse(
      (targetRow.row as { backlinks_json: string }).backlinks_json,
    ) as Record<string, string[]>;
    expect(backlinks[collectionId]).toEqual([source.record.id]);

    // 主记录 values 里是 relation id 数组
    const sourceRow = await requestOk<GetData>(core, {
      id: `record-source-${String(requestSeq++)}`,
      t: 'get',
      sqlId: 'record.get',
      params: { id: source.record.id },
    });
    const values = JSON.parse((sourceRow.row as { values_json: string }).values_json) as Record<string, unknown>;
    expect(values[relationPid]).toEqual([target.record.id]);

    // 所有 op 的 payload 仍不含 backlinks_json（反链经 extraStatements 同 batch 写入）
    for (const row of await ledgerRows()) {
      expect(row.op_json).not.toContain('backlinks_json');
    }
  });

  it('删除前 relation.countTargets>0 → E_REFERRED 拒删', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '关联库' });
    const { collection } = await service.addProperty({ pageId: created.pageId, type: 'relation' });
    const relationPid = Object.keys(collection.schema.properties).find(
      (pid) => collection.schema.properties[pid]?.type === 'relation',
    ) as string;
    const titlePid = collection.schema.title_pid;

    const source = await service.createRecord({ pageId: created.pageId, values: { [titlePid]: '来源记录' } });
    const target = await service.createRecord({ pageId: created.pageId, values: { [titlePid]: '目标记录' } });

    await service.updateRecord({
      pageId: created.pageId,
      recordId: source.record.id,
      patch: { [relationPid]: [target.record.id] },
    });

    // 目标记录仍被引用 → 拒删
    await expectApiError(
      service.deleteRecords({ pageId: created.pageId, ids: [target.record.id] }),
      'E_REFERRED',
    );

    // 来源记录没被引用 → 可删
    const deleted = await service.deleteRecords({ pageId: created.pageId, ids: [source.record.id] });
    expect(deleted.ok).toBe(true);
  });

  it('deleteRecords：每条一个 delete op，一个 batch；load 不再返回已删记录', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '研究库' });
    const loaded = await service.load({ pageId: created.pageId });
    const titlePid = loaded.collection.schema.title_pid;
    const a = await service.createRecord({ pageId: created.pageId, values: { [titlePid]: 'A' } });
    const b = await service.createRecord({ pageId: created.pageId, values: { [titlePid]: 'B' } });

    const before = await opCount();
    const result = await service.deleteRecords({ pageId: created.pageId, ids: [a.record.id, b.record.id] });
    expect(result.ok).toBe(true);
    expect(await opCount()).toBe(before + 2);

    const after = await service.load({ pageId: created.pageId });
    expect(after.records).toHaveLength(0);
  });

  it('exportCsv：BOM 首字符 + CRLF + 表头/值转义（逗号字段加引号）', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '导出库' });
    const loaded = await service.load({ pageId: created.pageId });
    const titlePid = loaded.collection.schema.title_pid;
    await service.createRecord({ pageId: created.pageId, values: { [titlePid]: '含,逗号' } });
    await service.createRecord({ pageId: created.pageId, values: { [titlePid]: '普通' } });

    const { csv } = await service.exportCsv({ pageId: created.pageId });
    expect(csv.charCodeAt(0)).toBe(0xfeff); // Excel 中文不乱码的前提
    expect(csv.slice(1).split('\r\n')).toHaveLength(3); // 表头 + 2 行
    expect(csv).toContain('"含,逗号"');
    expect(csv).toContain('普通');
  });
});
