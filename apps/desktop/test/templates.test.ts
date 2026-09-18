/**
 * templates.test.ts —— 主进程「模板」服务的端到端断言（TASK-T23-01 §0.C）。
 *
 * 走真实 better-sqlite3（经 DbServerCore + 白名单转发），因此同时验证：
 * 迁移（#7 建 template 表）→ 白名单语句（template.upsert/patch/get/list/softDelete）→
 * ledger + 物化同事务 → templatesApi 语义（saveFromPage / createPage / 隔离 / 错误）。
 * 另用内存假 registrar 断言 IPC 边界。better-sqlite3 不可用时 DB 用例整组跳过。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorId } from '@septcats/core';
import type {
  AllData,
  BatchData,
  GetData,
  MigrateData,
  RunData,
} from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import {
  createTemplatesService,
  registerTemplatesIpc,
  toTemplatesError,
  TemplatesApiError,
  type TemplatesIpcRegistrar,
  type TemplatesService,
} from '../src/main/templates';
import { CommitError, ledgerStatement } from '../src/main/commit';
import { createPagesService, type PagesService, type StatementExecutor } from '../src/main/pages';
import { createDbViewService, type DbViewService } from '../src/main/dbview';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'bbbb0001';
const AT = 1_700_000_000_000;

function toExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `templates-test-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
}

async function expectTemplatesError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error, `期望 TemplatesApiError(${code})`).toBeInstanceOf(TemplatesApiError);
    expect((error as TemplatesApiError).code).toBe(code);
    return;
  }
  throw new Error(`期望抛错 ${code}，但调用成功`);
}

describeDb('templatesApi（templates:* 六通道）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let executor: StatementExecutor;
  let pages: PagesService;
  let dbview: DbViewService;
  let workspaceId: string;
  let service: TemplatesService;
  /** 受控时钟：updated_at 严格递增，保证 list 倒序可断言 */
  let tick: number;

  beforeEach(async () => {
    temp = makeTempDb('septcats-templates');
    core = makeCore(ctor, temp.path);
    await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
    executor = toExecutor(core);
    pages = createPagesService({ executor, actor: ACTOR, userKey: 'device-user-1' });
    const listed = await pages.listWorkspaces();
    expect(listed.activeId).not.toBeNull();
    workspaceId = listed.activeId as string;
    dbview = createDbViewService({ executor, actor: ACTOR });
    tick = AT;
    service = createTemplatesService({
      executor,
      actor: ACTOR,
      now: () => (tick += 1000),
      activeWorkspaceId: async () => workspaceId,
    });
  });

  afterEach(() => {
    core.dispose();
    temp.cleanup();
  });

  /** 直插一页（物化层种子；与 blocks.test.ts 的 seedPage 同口径）。 */
  async function seedPage(id: string, title: string, parentId: string | null = null): Promise<void> {
    await requestOk<RunData>(core, {
      id: `seed-${id}`,
      t: 'run',
      sqlId: 'page.insert',
      params: {
        id,
        workspace_id: workspaceId,
        title,
        parent_id: parentId,
        sort_key: 'A00000000',
        version: 1,
      },
    });
  }

  /** 直插一个块。 */
  async function seedBlock(
    id: string,
    pageId: string,
    sortKey: string,
    text: string,
  ): Promise<void> {
    await requestOk<RunData>(core, {
      id: `seed-${id}`,
      t: 'run',
      sqlId: 'block.upsert',
      params: {
        id,
        page_id: pageId,
        workspace_id: workspaceId,
        type: 'paragraph',
        props_json: '{}',
        content_json: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        }),
        sort_key: sortKey,
        alive: 1,
        version: 1,
        lamport_c: 1,
        lamport_d: ACTOR,
        updated_at: AT,
      },
    });
  }

  /** 源页/新页的原始快照（块行 + 页行），用于「前后 diff 为空」断言。 */
  async function snapshotPage(pageId: string): Promise<string> {
    const blocks = await executor.all('block.listByPage', { page_id: pageId });
    const page = await executor.get('page.get', { id: pageId });
    return JSON.stringify({ blocks: blocks.rows, page: page.row });
  }

  it('saveFromPage：页面 → kind=page，payload.blocks 与该页块数一致（id 保留作结构参照）', async () => {
    await seedPage('pg-tpl-src-1', '会议纪要源页');
    await seedBlock('bk-tpl-1-a', 'pg-tpl-src-1', 'A00000000', '第一段');
    await seedBlock('bk-tpl-1-b', 'pg-tpl-src-1', 'A00000001', '第二段');

    const saved = await service.saveFromPage({ pageId: 'pg-tpl-src-1', title: '页面模板甲', icon: '📄' });
    expect(saved.id.length).toBeGreaterThan(0);

    const got = await service.get({ id: saved.id });
    expect(got.template.kind).toBe('page');
    expect(got.template.title).toBe('页面模板甲');
    expect(got.template.icon).toBe('📄');
    const payload = got.template.payload as { title: string; icon: string; blocks: Array<{ id: string; sort_key: string; content: unknown }> };
    expect(payload.title).toBe('页面模板甲');
    expect(payload.blocks).toHaveLength(2);
    // id 保留但仅作结构参照（与源块一致）；结构（sort_key/content）一致
    expect(payload.blocks.map((b) => b.id)).toEqual(['bk-tpl-1-a', 'bk-tpl-1-b']);
    expect(payload.blocks.map((b) => b.sort_key)).toEqual(['A00000000', 'A00000001']);

    // list 不含 payload
    const list = await service.list({});
    expect(list.templates).toHaveLength(1);
    const meta = list.templates[0] as { id: string; kind: string; title: string; payload?: unknown };
    expect(meta.id).toBe(saved.id);
    expect(meta.kind).toBe('page');
    expect(meta.title).toBe('页面模板甲');
    expect('payload' in meta).toBe(false);
  });

  it('saveFromPage：数据库页 → kind=database，payload 含 collection.schema/views、不含 record', async () => {
    const created = await dbview.create({ workspaceId, title: '台账源库页' });
    await dbview.createRecord({ pageId: created.pageId, values: { [Object.keys((await dbview.load({ pageId: created.pageId })).collection.schema.properties)[0] ?? 'x']: '行一' } });
    await dbview.createRecord({ pageId: created.pageId, values: {} });

    const saved = await service.saveFromPage({ pageId: created.pageId, title: '数据库模板乙' });
    const got = await service.get({ id: saved.id });
    expect(got.template.kind).toBe('database');

    const payload = got.template.payload as {
      title: string;
      collection: { name: string; schema: Record<string, unknown>; views: unknown[] };
      blocks?: unknown;
      records?: unknown;
    };
    expect(payload.title).toBe('数据库模板乙');
    // schema/views 复制自源库
    const source = await dbview.load({ pageId: created.pageId });
    expect(payload.collection.schema).toEqual(source.collection.schema);
    expect(payload.collection.views).toEqual(source.collection.views);
    expect(payload.collection.name).toBe(source.collection.name);
    // PM 裁决：模板=结构非数据副本 —— 不含 record 行，也不含 blocks 键（源页无块）
    expect('records' in payload).toBe(false);
    expect('blocks' in payload).toBe(false);
    expect(payload.collection.schema).toHaveProperty('properties');
  });

  it('createPage：副本语义 —— 新页 id、每个 block id 均≠源、结构一致、源页与模板前后 diff 为空', async () => {
    await seedPage('pg-tpl-src-2', '三级结构源页');
    await seedBlock('bk-tpl-2-a', 'pg-tpl-src-2', 'A00000000', '标题文本');
    await seedBlock('bk-tpl-2-b', 'pg-tpl-src-2', 'A00000001', '正文甲');
    await seedBlock('bk-tpl-2-c', 'pg-tpl-src-2', 'A00000002', '正文乙');

    const saved = await service.saveFromPage({ pageId: 'pg-tpl-src-2', title: '结构模板丙' });

    const sourceBefore = await snapshotPage('pg-tpl-src-2');
    const templateBefore = JSON.stringify((await service.get({ id: saved.id })).template);

    const made = await service.createPage({ templateId: saved.id, parentId: null });
    expect(made.pageId).not.toBe('pg-tpl-src-2');

    // 新页块：全集不得与源重合（逐 id 断言）
    const newBlocks = await executor.all('block.listByPage', { page_id: made.pageId });
    const newIds = newBlocks.rows.map((row) => (row as { id: string }).id);
    expect(newIds).toHaveLength(3);
    for (const sourceId of ['bk-tpl-2-a', 'bk-tpl-2-b', 'bk-tpl-2-c']) {
      expect(newIds).not.toContain(sourceId);
    }
    expect(new Set(newIds).size).toBe(3);

    // 结构一致：sort_key / type / content 逐一对应
    const sourceBlocks = await executor.all('block.listByPage', { page_id: 'pg-tpl-src-2' });
    const pair = (row: unknown, key: string): string => (row as Record<string, unknown>)[key] as string;
    expect(newBlocks.rows.map((row) => pair(row, 'sort_key'))).toEqual(
      sourceBlocks.rows.map((row) => pair(row, 'sort_key')),
    );
    expect(newBlocks.rows.map((row) => pair(row, 'type'))).toEqual(
      sourceBlocks.rows.map((row) => pair(row, 'type')),
    );
    expect(newBlocks.rows.map((row) => pair(row, 'content_json'))).toEqual(
      sourceBlocks.rows.map((row) => pair(row, 'content_json')),
    );

    // 源页与模板均未被修改（前后 diff 为空）
    expect(await snapshotPage('pg-tpl-src-2')).toBe(sourceBefore);
    expect(JSON.stringify((await service.get({ id: saved.id })).template)).toBe(templateBefore);
  });

  it('createPage：数据库模板 → 新 collection id、schema/views 等价、新库 0 条 record', async () => {
    const created = await dbview.create({ workspaceId, title: '台账源库页二' });
    await dbview.createRecord({ pageId: created.pageId, values: {} });
    await dbview.createRecord({ pageId: created.pageId, values: {} });

    const saved = await service.saveFromPage({ pageId: created.pageId, title: '数据库模板丁' });
    const made = await service.createPage({ templateId: saved.id, parentId: null });

    const sourceCollection = await executor.get('collection.getByPage', { page_id: created.pageId });
    const newCollection = await executor.get('collection.getByPage', { page_id: made.pageId });
    expect(newCollection.row).not.toBeNull();
    const sourceId = (sourceCollection.row as { id: string }).id;
    const newId = (newCollection.row as { id: string }).id;
    expect(newId).not.toBe(sourceId);

    // schema/views 等价
    const pair = (row: unknown, key: string): string => (row as Record<string, unknown>)[key] as string;
    expect(JSON.parse(pair(newCollection.row, 'schema_json'))).toEqual(JSON.parse(pair(sourceCollection.row, 'schema_json')));
    expect(JSON.parse(pair(newCollection.row, 'views_json'))).toEqual(JSON.parse(pair(sourceCollection.row, 'views_json')));

    // 新库 0 条 record；源库 2 条不动
    const newRecords = await executor.all('record.listByCollection', { collection_id: newId });
    expect(newRecords.rows).toHaveLength(0);
    const sourceRecords = await executor.all('record.listByCollection', { collection_id: sourceId });
    expect(sourceRecords.rows).toHaveLength(2);
  });

  it('隔离：模板标题在 search FTS 零命中；pages 全量/最近列表不含模板', async () => {
    await seedPage('pg-tpl-src-3', '普通源页');
    const saved = await service.saveFromPage({ pageId: 'pg-tpl-src-3', title: '模板探针铭文甲乙丙' });

    // FTS 主检索 + LIKE 兜底：模板标题零命中（模板不在 page/block 表，天然不入索引）
    const fts = await executor.all('search.ftsPage', {
      query: '模板探针',
      workspaceId,
      limit: 50,
    });
    expect(fts.rows).toHaveLength(0);
    const like = await executor.all('search.likeFtsPage', {
      like: '%模板探针铭文%',
      needle: '模板探针铭文',
      workspaceId,
      limit: 50,
    });
    expect(like.rows).toHaveLength(0);

    // pages 全量树不含模板；最近列表不含模板
    const allPages = await executor.all('page.listAll', { workspace_id: workspaceId });
    expect(allPages.rows.some((row) => (row as { id: string }).id === saved.id)).toBe(false);
    await pages.touchRecent({ pageId: 'pg-tpl-src-3' });
    const recent = await pages.listRecent();
    expect(recent.pageIds).not.toContain(saved.id);
  });

  it('错误：E_TEMPLATE_NOT_FOUND / E_MALFORMED / E_NO_WORKSPACE', async () => {
    await expectTemplatesError(service.get({ id: 'no-such-template' }), 'E_TEMPLATE_NOT_FOUND');
    await expectTemplatesError(service.rename({ id: 'no-such-template', title: 'x' }), 'E_TEMPLATE_NOT_FOUND');
    await expectTemplatesError(service.delete({ id: 'no-such-template' }), 'E_TEMPLATE_NOT_FOUND');
    await expectTemplatesError(
      service.createPage({ templateId: 'no-such-template', parentId: null }),
      'E_TEMPLATE_NOT_FOUND',
    );
    // 软删后的模板同样不可见
    await seedPage('pg-tpl-src-4', '源页四');
    const saved = await service.saveFromPage({ pageId: 'pg-tpl-src-4', title: '模板戊' });
    await service.delete({ id: saved.id });
    await expectTemplatesError(service.get({ id: saved.id }), 'E_TEMPLATE_NOT_FOUND');
    await expectTemplatesError(
      service.createPage({ templateId: saved.id, parentId: null }),
      'E_TEMPLATE_NOT_FOUND',
    );

    // 非法入参
    await expectTemplatesError(service.list({ kind: 'nope' as 'page' }), 'E_MALFORMED');
    await expectTemplatesError(service.saveFromPage({ pageId: 'pg-x', title: '  ' }), 'E_MALFORMED');
    await expectTemplatesError(service.delete({ id: '' }), 'E_MALFORMED');
    await expectTemplatesError(
      service.saveFromPage({ pageId: 'no-such-page', title: '合法标题' }),
      'E_NOT_FOUND',
    );

    // 无工作区（注入口直接抛域错误 E_NO_WORKSPACE；index.ts 注 PagesApiError 时经
    // toTemplatesError 映射为同码，IPC 边界测试已覆盖映射路径）
    const failing = createTemplatesService({
      executor,
      actor: ACTOR,
      activeWorkspaceId: async () => {
        throw new TemplatesApiError('E_NO_WORKSPACE', '无活动工作区，模板 Op 无法物化');
      },
    });
    await expectTemplatesError(
      failing.saveFromPage({ pageId: 'pg-tpl-src-4', title: '模板己' }),
      'E_NO_WORKSPACE',
    );
    // createPage：用存活模板（否则先撞 E_TEMPLATE_NOT_FOUND，轮不到工作区守卫；
    // 上面的 saved 已被软删，这里另存一个）
    const alive = await service.saveFromPage({ pageId: 'pg-tpl-src-4', title: '模板辛' });
    await expectTemplatesError(
      failing.createPage({ templateId: alive.id, parentId: null }),
      'E_NO_WORKSPACE',
    );
  });

  it('rename：标题/图标更新且 payload 同步；list 倒序', async () => {
    await seedPage('pg-tpl-src-5', '源页五');
    const first = await service.saveFromPage({ pageId: 'pg-tpl-src-5', title: '模板庚一' });
    const second = await service.saveFromPage({ pageId: 'pg-tpl-src-5', title: '模板庚二' });

    // updated_at 倒序（second 后创建 → 在前；受控时钟每次 now() 步进 1000）
    const listBeforeRename = await service.list({});
    expect(listBeforeRename.templates.map((t) => t.id)).toEqual([second.id, first.id]);

    await service.rename({ id: first.id, title: '改名后的模板', icon: '🗂' });
    const renamed = await service.get({ id: first.id });
    expect(renamed.template.title).toBe('改名后的模板');
    expect(renamed.template.icon).toBe('🗂');
    const payload = renamed.template.payload as { title: string; icon: string };
    expect(payload.title).toBe('改名后的模板');
    expect(payload.icon).toBe('🗂');

    // icon 缺省 = 保持不变
    await service.rename({ id: first.id, title: '再改一次' });
    const again = await service.get({ id: first.id });
    expect(again.template.icon).toBe('🗂');
    // rename 推进 updated_at → 被改名的模板回到列表首位
    const listAfterRename = await service.list({});
    expect(listAfterRename.templates.map((t) => t.id)).toEqual([first.id, second.id]);
  });

  it('SQL 层：template.* 五语句真库 roundtrip', async () => {
    // upsert → get
    await executor.run('template.upsert', {
      id: 'tpl-sql-1',
      kind: 'page',
      title: 'SQL 模板一',
      icon: null,
      payload: JSON.stringify({ title: 'SQL 模板一', icon: null, blocks: [] }),
      alive: 1,
      version: 1,
      created_at: 111,
      updated_at: 111,
      deleted_at: null,
    });
    const got = await executor.get('template.get', { id: 'tpl-sql-1' });
    expect(got.row).not.toBeNull();
    const row = got.row as Record<string, unknown>;
    expect(row['kind']).toBe('page');
    expect(row['title']).toBe('SQL 模板一');
    expect(row['created_at']).toBe(111);

    // patch：title 更新、icon 缺席（null）不触碰
    await executor.run('template.upsert', {
      id: 'tpl-sql-2',
      kind: 'database',
      title: 'SQL 模板二',
      icon: 'db',
      payload: '{}',
      alive: 1,
      version: 1,
      created_at: 222,
      updated_at: 222,
      deleted_at: null,
    });
    await executor.run('template.patch', {
      id: 'tpl-sql-2',
      title: '改名的 SQL 模板二',
      icon: null,
      version: 2,
      updated_at: 333,
    });
    const patched = await executor.get('template.get', { id: 'tpl-sql-2' });
    const patchedRow = patched.row as Record<string, unknown>;
    expect(patchedRow['title']).toBe('改名的 SQL 模板二');
    expect(patchedRow['icon']).toBe('db');
    expect(patchedRow['version']).toBe(2);

    // list：kind 过滤 + updated_at 倒序 + 排除软删
    await executor.run('template.softDelete', {
      id: 'tpl-sql-2',
      deleted_at: 444,
      version: 3,
      updated_at: 444,
    });
    const all = await executor.all('template.list', { kind: null });
    expect(all.rows.map((r) => (r as { id: string }).id)).toEqual(['tpl-sql-1']);
    const databases = await executor.all('template.list', { kind: 'database' });
    expect(databases.rows).toHaveLength(0); // 唯一的 database 已软删
    const dead = await executor.get('template.get', { id: 'tpl-sql-2' });
    expect((dead.row as Record<string, unknown>)['alive']).toBe(0);
    expect((dead.row as Record<string, unknown>)['deleted_at']).toBe(444);
  });
});

// ---------------------------------------------------------------------------
// IPC 边界（不依赖真库：注册器级断言）
// ---------------------------------------------------------------------------

function makeRegistrar(): { handlers: Map<string, (input: unknown) => Promise<unknown>> } & TemplatesIpcRegistrar {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    handlers,
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  };
}

describe('registerTemplatesIpc（IPC 边界）', () => {
  it('六通道全部注册；service=null 统一回 E_INVARIANT', async () => {
    const registrar = makeRegistrar();
    registerTemplatesIpc(null, registrar);
    for (const channel of [
      'templates:list',
      'templates:get',
      'templates:saveFromPage',
      'templates:rename',
      'templates:delete',
      'templates:createPage',
    ]) {
      expect(registrar.handlers.has(channel)).toBe(true);
    }
    // 合法形状的入参（参数校验通过）才会触达 requireService 的降级分支
    const cases: Array<[string, unknown]> = [
      ['templates:list', {}],
      ['templates:get', { id: 'tpl-x' }],
      ['templates:saveFromPage', { pageId: 'pg-x', title: 't' }],
      ['templates:rename', { id: 'tpl-x', title: 't' }],
      ['templates:delete', { id: 'tpl-x' }],
      ['templates:createPage', { templateId: 'tpl-x', parentId: null }],
    ];
    for (const [channel, input] of cases) {
      const handler = registrar.handlers.get(channel) as (input: unknown) => Promise<unknown>;
      await expect(handler(input)).rejects.toThrow(/E_INVARIANT/);
    }
  });

  it('非法入参：E_MALFORMED（非对象 / id 空 / title 空 / kind 非法）', async () => {
    const registrar = makeRegistrar();
    const fakeService: TemplatesService = {
      list: async () => ({ templates: [] }),
      get: async () => {
        throw new TemplatesApiError('E_MALFORMED', 'get 不应被调用');
      },
      saveFromPage: async () => {
        throw new TemplatesApiError('E_MALFORMED', 'saveFromPage 不应被调用');
      },
      rename: async () => {
        throw new TemplatesApiError('E_MALFORMED', 'rename 不应被调用');
      },
      delete: async () => {
        throw new TemplatesApiError('E_MALFORMED', 'delete 不应被调用');
      },
      createPage: async () => {
        throw new TemplatesApiError('E_MALFORMED', 'createPage 不应被调用');
      },
    };
    registerTemplatesIpc(fakeService, registrar);
    const get = registrar.handlers.get('templates:get') as (input: unknown) => Promise<unknown>;
    const save = registrar.handlers.get('templates:saveFromPage') as (input: unknown) => Promise<unknown>;
    const list = registrar.handlers.get('templates:list') as (input: unknown) => Promise<unknown>;
    const del = registrar.handlers.get('templates:delete') as (input: unknown) => Promise<unknown>;

    await expect(get(null)).rejects.toThrow(/E_MALFORMED/);
    await expect(get({ id: '' })).rejects.toThrow(/E_MALFORMED/);
    await expect(save({ pageId: 'pg', title: '' })).rejects.toThrow(/E_MALFORMED/);
    await expect(save({ pageId: '', title: 'x' })).rejects.toThrow(/E_MALFORMED/);
    await expect(list({ kind: 'evil' })).rejects.toThrow(/E_MALFORMED/);
    await expect(del({})).rejects.toThrow(/E_MALFORMED/);
  });
});

describe('toTemplatesError（错误映射）', () => {
  it('CommitError → E_MALFORMED；未知错误 → E_INVARIANT', () => {
    const commit = new CommitError('E_MALFORMED_OP', 'bad op');
    expect(toTemplatesError(commit).code).toBe('E_MALFORMED');
    expect(toTemplatesError(new Error('boom')).code).toBe('E_INVARIANT');
    const direct = new TemplatesApiError('E_TEMPLATE_NOT_FOUND', 'x');
    expect(toTemplatesError(direct).code).toBe('E_TEMPLATE_NOT_FOUND');
  });

  it('ledgerStatement 拒绝非法 template op（encodeOp 校验面）', () => {
    expect(() =>
      // kind 非法（'nope' 不在 OP_KINDS）→ CommitError(E_MALFORMED_OP)
      ledgerStatement(
        {
          op_id: 'op-x',
          lamport: { c: 1, d: ACTOR },
          at: AT,
          actor: ACTOR,
          target: { table: 'template', id: 'tpl-1' },
          kind: 'nope' as 'template',
          payload: {},
        },
        null,
      ),
    ).toThrow(CommitError);
  });
});
