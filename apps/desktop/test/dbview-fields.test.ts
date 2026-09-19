/**
 * dbview-fields.test.ts —— 数据库「字段」体系端到端断言（TASK-T40-01 §4）。
 *
 * 覆盖六类交付：
 * 1. 11 类型值往返（填值 → 重开服务 → 读回一致）；
 * 2. 改类型值迁移（能迁的迁、不能迁的原样保留不静默丢）；
 * 3. 删除字段（该列值一并清理、重开不复活）；
 * 4. 字段左右排序（持久化；标题恒首列）；
 * 5. select/multi_select 选项管理（增删改 + 被删选项引用值清理）；
 * 6. 标题字段保护（禁改类型 / 禁删 / 禁移动 → E_INVARIANT）。
 *
 * 走真实 better-sqlite3（与 dbview.test.ts 同夹具）；不可用时整组跳过。
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ActorId } from '@septcats/core';
import type { AllData, BatchData, GetData, MigrateData, RunData } from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import { DbViewApiError, createDbViewService, type DbViewService } from '../src/main/dbview';
import type { StatementExecutor } from '../src/main/pages';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa0001';
const AT = 1_700_000_000_000;
const WORKSPACE_ID = 'ws-test-t40';

function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `t40-test-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
}

/** 各字段类型的 pid 表（键 = 类型字面量、读回非可选；避开 noUncheckedIndexedAccess 的索引 undefined）。 */
interface FieldPids {
  number: string;
  select: string;
  multi_select: string;
  date: string;
  checkbox: string;
  url: string;
  email: string;
  relation: string;
  file: string;
  ai: string;
}

describeDb('dbViewService 字段体系（TASK-T40-01）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let service: DbViewService;
  let clock: number;
  let requestSeq = 0;

  beforeEach(async () => {
    temp = makeTempDb('septcats-dbview-fields');
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

  /** 模拟「重开应用」：同一物理库上新开一个 service 实例。 */
  function reopen(): DbViewService {
    return createDbViewService({
      executor: coreExecutor(core),
      actor: ACTOR,
      now: () => {
        clock += 1;
        return clock;
      },
    });
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

  /** 建一个带全类型字段 + 两条记录的库，返回 pid 表与记录 id。 */
  async function makeFullDb(): Promise<{
    pageId: string;
    titlePid: string;
    pids: FieldPids;
    recordA: string;
    recordB: string;
  }> {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '字段库' });
    const pageId = created.pageId;
    const loaded = await service.load({ pageId });
    const titlePid = loaded.collection.schema.title_pid;

    const types = [
      'number',
      'select',
      'multi_select',
      'date',
      'checkbox',
      'url',
      'email',
      'relation',
      'file',
      'ai',
    ] as const;
    const pidEntries: Array<[keyof FieldPids, string]> = [];
    const takenPids = new Set<string>();
    for (const type of types) {
      const { collection } = await service.addProperty({ pageId, type });
      const pid = Object.keys(collection.schema.properties).find(
        (key) => collection.schema.properties[key]?.type === type && !takenPids.has(key),
      );
      expect(pid, `应找到新增的 ${type} 属性`).toBeTruthy();
      pidEntries.push([type, pid as string]);
      takenPids.add(pid as string);
    }
    const pids = Object.fromEntries(pidEntries) as unknown as FieldPids;
    // select / multi_select 先给选项（值 = 选项 id）
    await service.updateProperty({
      pageId,
      pid: pids['select'],
      patch: { options: [{ id: 'opt-todo', name: '待办' }, { id: 'opt-done', name: '完成' }] },
    });
    await service.updateProperty({
      pageId,
      pid: pids['multi_select'],
      patch: { options: [{ id: 'opt-red', name: '红' }, { id: 'opt-blue', name: '蓝' }] },
    });

    // 先建两条记录拿 id（relation 值指向 recordB）
    const a = await service.createRecord({ pageId, values: { [titlePid]: '记录A' } });
    const b = await service.createRecord({ pageId, values: { [titlePid]: '记录B' } });

    await service.updateRecord({
      pageId,
      recordId: a.record.id,
      patch: {
        [pids['number']]: 42.5,
        [pids['select']]: 'opt-todo',
        [pids['multi_select']]: ['opt-red', 'opt-blue'],
        [pids['date']]: { y: 2026, m: 9, d: 20 },
        [pids['checkbox']]: true,
        [pids['url']]: 'https://example.com/a',
        [pids['email']]: 'a@example.com',
        [pids['relation']]: [b.record.id],
        [pids['file']]: ['设计稿.pdf', '数据.csv'],
        [pids['ai']]: 'AI 摘要',
      },
    });
    return { pageId, titlePid, pids, recordA: a.record.id, recordB: b.record.id };
  }

  it('11 类型值往返：填值 → 重开服务 → 读回逐项一致', async () => {
    const { pageId, titlePid, pids } = await makeFullDb();

    const reopened = reopen();
    const loaded = await reopened.load({ pageId });
    expect(loaded.records).toHaveLength(2);
    const row = loaded.records.find((record) => record.values[titlePid] === '记录A');
    expect(row).toBeTruthy();
    const values = row?.values ?? {};

    expect(typeof values[titlePid]).toBe('string');
    expect(values[titlePid]).toBe('记录A'); // text（标题）
    expect(values[pids['number']]).toBe(42.5);
    expect(values[pids['select']]).toBe('opt-todo');
    expect(values[pids['multi_select']]).toEqual(['opt-red', 'opt-blue']);
    expect(values[pids['date']]).toEqual({ y: 2026, m: 9, d: 20 });
    expect(values[pids['checkbox']]).toBe(true);
    expect(values[pids['url']]).toBe('https://example.com/a');
    expect(values[pids['email']]).toBe('a@example.com');
    expect(Array.isArray(values[pids['relation']])).toBe(true);
    expect(values[pids['relation']]).toHaveLength(1);
    expect(values[pids['file']]).toEqual(['设计稿.pdf', '数据.csv']);
    expect(values[pids['ai']]).toBe('AI 摘要');

    // 空值行：记录B 除标题外全空 → 读回不串型（undefined/null 均视为空）
    const rowB = loaded.records.find((record) => record.values[titlePid] === '记录B');
    expect(rowB).toBeTruthy();
    for (const [type, pid] of Object.entries(pids)) {
      const value = (rowB?.values ?? {})[pid];
      expect(value ?? null, `${type} 空值应为空`).toBeNull();
    }
  });

  it('改类型迁移：text→number 可迁值转换、不可迁值原样保留（不静默丢）', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '迁移库' });
    const pageId = created.pageId;
    const loaded = await service.load({ pageId });
    const titlePid = loaded.collection.schema.title_pid;
    const { collection } = await service.addProperty({ pageId, type: 'text' });
    const textPid = Object.keys(collection.schema.properties).find(
      (key) => collection.schema.properties[key]?.type === 'text' && key !== titlePid,
    ) as string;

    const good = await service.createRecord({ pageId, values: { [titlePid]: '可迁', [textPid]: '42' } });
    const bad = await service.createRecord({ pageId, values: { [titlePid]: '不可迁', [textPid]: '不是数字' } });

    await service.updateProperty({ pageId, pid: textPid, patch: { type: 'number' } });

    const after = await service.load({ pageId });
    expect(after.collection.schema.properties[textPid]?.type).toBe('number');
    const valuesA = after.records.find((record) => record.id === good.record.id)?.values ?? {};
    const valuesB = after.records.find((record) => record.id === bad.record.id)?.values ?? {};
    expect(valuesA[textPid]).toBe(42); // 无损映射：字符串 → 数字
    expect(valuesB[textPid]).toBe('不是数字'); // 无法迁移：原值保留（不显示但不丢）

    // 重开读回一致
    const reopened = await reopen().load({ pageId });
    expect(reopened.collection.schema.properties[textPid]?.type).toBe('number');
    expect((reopened.records.find((record) => record.id === bad.record.id)?.values ?? {})[textPid]).toBe(
      '不是数字',
    );
  });

  it('改类型迁移：text→select 自动建选项；multi_select→select 多值保留；select→multi_select 包数组', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '迁移库2' });
    const pageId = created.pageId;
    const loaded = await service.load({ pageId });
    const titlePid = loaded.collection.schema.title_pid;
    const { collection } = await service.addProperty({ pageId, type: 'text' });
    const textPid = Object.keys(collection.schema.properties).find(
      (key) => collection.schema.properties[key]?.type === 'text' && key !== titlePid,
    ) as string;

    const r1 = await service.createRecord({ pageId, values: { [titlePid]: 'R1', [textPid]: '进行中' } });
    await service.updateProperty({ pageId, pid: textPid, patch: { type: 'select' } });

    let after = await service.load({ pageId });
    const prop = after.collection.schema.properties[textPid];
    expect(prop?.type).toBe('select');
    // 文本逐个成选项，值换成选项 id
    const option = prop?.options?.find((candidate) => candidate.name === '进行中');
    expect(option).toBeTruthy();
    expect((after.records.find((record) => record.id === r1.record.id)?.values ?? {})[textPid]).toBe(
      option?.id,
    );

    // select → multi_select：单 id 包数组
    await service.updateProperty({ pageId, pid: textPid, patch: { type: 'multi_select' } });
    after = await service.load({ pageId });
    expect(after.collection.schema.properties[textPid]?.type).toBe('multi_select');
    expect((after.records.find((record) => record.id === r1.record.id)?.values ?? {})[textPid]).toEqual([
      option?.id,
    ]);

    // multi_select → select：多值无法无损 → 原样保留
    const r2 = await service.createRecord({
      pageId,
      values: { [titlePid]: 'R2', [textPid]: [option?.id ?? '', '另一个'] },
    });
    await service.updateProperty({ pageId, pid: textPid, patch: { type: 'select' } });
    after = await service.load({ pageId });
    expect((after.records.find((record) => record.id === r2.record.id)?.values ?? {})[textPid]).toEqual([
      option?.id ?? '',
      '另一个',
    ]);
  });

  it('删除字段：该列值一并清理、重开不复活；标题列拒删（E_INVARIANT）', async () => {
    const { pageId, titlePid, pids, recordA } = await makeFullDb();

    await service.removeProperty({ pageId, pid: pids['number'] });

    let after = await service.load({ pageId });
    expect(after.collection.schema.properties[pids['number']]).toBeUndefined();
    expect((after.records.find((record) => record.id === recordA)?.values ?? {})[pids['number']]).toBeUndefined();

    // 重开不复活
    const reopened = await reopen().load({ pageId });
    expect(reopened.collection.schema.properties[pids['number']]).toBeUndefined();
    expect((reopened.records.find((record) => record.id === recordA)?.values ?? {})[pids['number']]).toBeUndefined();

    // 标题列拒删
    await expectApiError(service.removeProperty({ pageId, pid: titlePid }), 'E_INVARIANT');
    // 其它列不受影响（抽查 select 仍在）
    expect(after.collection.schema.properties[pids['select']]).toBeTruthy();
  });

  it('字段左右排序：移动持久化（重开读回）、末尾、标题恒首列不可动', async () => {
    const { pageId, titlePid, pids } = await makeFullDb();

    let loaded = await service.load({ pageId });
    const order0 = Object.keys(loaded.collection.schema.properties);
    expect(order0[0]).toBe(titlePid); // 标题默认首列

    // number 移到 select 之前
    await service.moveProperty({ pageId, pid: pids['number'], beforePid: pids['select'] });
    loaded = await service.load({ pageId });
    let order = Object.keys(loaded.collection.schema.properties);
    expect(order.indexOf(pids['number'])).toBe(order.indexOf(pids['select']) - 1);
    expect(order[0]).toBe(titlePid);

    // 移到末尾
    await service.moveProperty({ pageId, pid: pids['number'], beforePid: null });
    loaded = await service.load({ pageId });
    order = Object.keys(loaded.collection.schema.properties);
    expect(order[order.length - 1]).toBe(pids['number']);

    // 不许插到标题前：beforePid=标题 → 落到标题之后第一格
    await service.moveProperty({ pageId, pid: pids['file'], beforePid: titlePid });
    loaded = await service.load({ pageId });
    order = Object.keys(loaded.collection.schema.properties);
    expect(order[0]).toBe(titlePid);
    expect(order[1]).toBe(pids['file']);

    // 标题列本身不可移动
    await expectApiError(service.moveProperty({ pageId, pid: titlePid, beforePid: null }), 'E_INVARIANT');

    // 排序持久化：重开读回列序一致
    const reopened = await reopen().load({ pageId });
    expect(Object.keys(reopened.collection.schema.properties)).toEqual(
      Object.keys(loaded.collection.schema.properties),
    );
  });

  it('选项管理：改名 / 新增（缺 id 由 main 生成）/ 删除；被删选项的引用值清理并持久化', async () => {
    const { pageId, titlePid, pids, recordA } = await makeFullDb();

    // 记录A 当前 select='opt-todo'、multi_select=['opt-red','opt-blue']
    // 全量替换 select 选项：改名 opt-todo、删除 opt-done、新增（无 id）
    await service.updateProperty({
      pageId,
      pid: pids['select'],
      patch: {
        options: [{ id: 'opt-todo', name: '待办改' }, { name: '新选项' }],
      },
    });
    let loaded = await service.load({ pageId });
    const selectProp = loaded.collection.schema.properties[pids['select']];
    expect(selectProp?.options).toHaveLength(2);
    expect(selectProp?.options?.find((option) => option.id === 'opt-todo')?.name).toBe('待办改');
    const generated = selectProp?.options?.find((option) => option.id !== 'opt-todo');
    expect(generated?.id, '缺 id 的新选项由 main 生成 id').toBeTruthy();
    expect((loaded.records.find((record) => record.id === recordA)?.values ?? {})[pids['select']]).toBe(
      'opt-todo',
    );

    // 删除被引用的选项 opt-todo → select 单值清空
    await service.updateProperty({
      pageId,
      pid: pids['select'],
      patch: { options: [{ id: generated?.id ?? '', name: '新选项' }] },
    });
    loaded = await service.load({ pageId });
    expect((loaded.records.find((record) => record.id === recordA)?.values ?? {})[pids['select']]).toBeNull();

    // multi_select 删除部分被引用选项 → 数组过滤剩余
    await service.updateProperty({
      pageId,
      pid: pids['multi_select'],
      patch: { options: [{ id: 'opt-blue', name: '蓝' }] },
    });
    loaded = await service.load({ pageId });
    expect((loaded.records.find((record) => record.id === recordA)?.values ?? {})[pids['multi_select']]).toEqual([
      'opt-blue',
    ]);

    // 持久化：重开读回选项集与值一致
    const reopened = await reopen().load({ pageId });
    expect(reopened.collection.schema.properties[pids['select']]?.options).toHaveLength(1);
    expect((reopened.records.find((record) => record.id === recordA)?.values ?? {})[pids['multi_select']]).toEqual([
      'opt-blue',
    ]);
    void titlePid;
  });

  it('标题字段保护：改类型 / 删除 / 移动一律 E_INVARIANT（标题默认 text 且首列）', async () => {
    const created = await service.create({ workspaceId: WORKSPACE_ID, title: '保护库' });
    const pageId = created.pageId;
    const loaded = await service.load({ pageId });
    const titlePid = loaded.collection.schema.title_pid;
    expect(loaded.collection.schema.properties[titlePid]?.type).toBe('text');
    expect(Object.keys(loaded.collection.schema.properties)[0]).toBe(titlePid);

    await expectApiError(
      service.updateProperty({ pageId, pid: titlePid, patch: { type: 'number' } }),
      'E_INVARIANT',
    );
    await expectApiError(service.removeProperty({ pageId, pid: titlePid }), 'E_INVARIANT');
    await expectApiError(service.moveProperty({ pageId, pid: titlePid, beforePid: null }), 'E_INVARIANT');

    // 重命名与 AI 指令不受保护限制（既有语义）
    const renamed = await service.updateProperty({ pageId, pid: titlePid, patch: { name: '名称列' } });
    expect(renamed.collection.schema.properties[titlePid]?.name).toBe('名称列');
  });
});
