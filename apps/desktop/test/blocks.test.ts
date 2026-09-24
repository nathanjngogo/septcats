/**
 * blocks.test.ts —— 主进程「块」服务的端到端断言（TASK-T21-01 §1）。
 *
 * 走真实 better-sqlite3（经 DbServerCore + 白名单转发），因此同时验证：
 * 迁移 → 白名单语句（block.listByPage / block.upsert / block.patch / block.setSort /
 * block.softDelete）→ commitOps（ledger + 物化同事务）→ blocksApi 语义。
 * 另用内存假 executor 断言 commit 的 sqlId 与参数（不依赖真库）。
 * better-sqlite3 不可用时 DB 用例整组跳过（见 test/helpers.ts）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorId, Op } from '@septcats/core';
import { defaultTableContent, defaultToggleContent } from '@septcats/editor';
import type { Block } from '@septcats/editor';
import type {
  AllData,
  BatchData,
  DbBatchStatement,
  GetData,
  MigrateData,
  RunData,
} from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import {
  blockContentOf,
  BlocksApiError,
  createBlocksService,
  registerBlocksIpc,
  type BlocksIpcRegistrar,
  type BlocksService,
} from '../src/main/blocks';
import { createPagesService, type PagesService, type StatementExecutor } from '../src/main/pages';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa0001';
const AT = 1_700_000_000_000;
const WORKSPACE_ID = 'ws-blocks-test';

function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `blocks-test-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
}

async function expectBlocksError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error, `期望 BlocksApiError(${code})`).toBeInstanceOf(BlocksApiError);
    expect((error as BlocksApiError).code).toBe(code);
    return;
  }
  throw new Error(`期望抛错 ${code}，但调用成功`);
}

let opSeq = 0;

/** 测试用 Op 构造（形状与 packages/editor diff.ts 产出一致）。 */
function makeOp(
  kind: Op['kind'],
  blockId: string,
  payload: Record<string, unknown>,
  c: number,
  base?: number,
): Op {
  opSeq += 1;
  const op: Op = {
    op_id: `op-blocks-test-${String(opSeq).padStart(6, '0')}`,
    lamport: { c, d: ACTOR },
    at: AT,
    actor: ACTOR,
    target: { table: 'block', id: blockId },
    kind,
    payload,
  };
  if (base !== undefined) {
    op.base = base;
  }
  return op;
}

/** paragraph 的 PM doc content（与编辑器投影同形）。 */
function paragraphDoc(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function blockUpsertOp(blockId: string, pageId: string, overrides: Record<string, unknown> = {}): Op {
  return makeOp(
    'upsert',
    blockId,
    {
      page_id: pageId,
      type: 'paragraph',
      props: {},
      content: paragraphDoc(`内容-${blockId}`),
      parent_id: null,
      sort_key: 'A00000000',
      alive: 1,
      last_edited: AT,
      ...overrides,
    },
    1,
  );
}

describeDb('blocksApi（blocks:list / blocks:commit）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let pages: PagesService;
  let service: BlocksService;

  beforeEach(async () => {
    temp = makeTempDb('septcats-blocks');
    core = makeCore(ctor, temp.path);
    await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
    pages = createPagesService({ executor: coreExecutor(core), actor: ACTOR, userKey: 'device-user-1' });
    // 首次运行自动建默认工作区（与 index.ts 的 activeWorkspaceId 注入口径一致）
    const listed = await pages.listWorkspaces();
    expect(listed.activeId).not.toBeNull();
    service = createBlocksService({
      executor: coreExecutor(core),
      actor: ACTOR,
      activeWorkspaceId: async () => {
        const workspaces = await pages.listWorkspaces();
        if (workspaces.activeId === null) {
          throw new BlocksApiError('E_NO_WORKSPACE', '无活动工作区');
        }
        return workspaces.activeId;
      },
    });
  });

  afterEach(() => {
    core.dispose();
    temp.cleanup();
  });

  async function seedPage(id: string, sortKey = 'A00000000'): Promise<void> {
    await requestOk<RunData>(core, {
      id: `seed-${id}`,
      t: 'run',
      sqlId: 'page.insert',
      params: {
        id,
        workspace_id: WORKSPACE_ID,
        title: id,
        parent_id: null,
        sort_key: sortKey,
        version: 1,
      },
    });
  }

  async function ledgerCount(): Promise<number> {
    const data = await requestOk<GetData>(core, {
      id: `ledger-${String(Math.random()).slice(2)}`,
      t: 'get',
      sqlId: 'opLedger.count',
      params: {},
    });
    return (data.row as { n: number } | null)?.n ?? -1;
  }

  it('blocks:list：返回编辑器 Block 形状并按 sort_key 排序', async () => {
    await seedPage('pg-list-1');
    // 故意先提交 sort_key 靠后的块，验证读路径排序不依赖写入顺序
    await service.commit({
      ops: [
        blockUpsertOp('bk-list-1-b', 'pg-list-1', { sort_key: 'B00000001' }),
        blockUpsertOp('bk-list-1-a', 'pg-list-1', { sort_key: 'A00000000' }),
      ],
    });
    const { blocks } = await service.list({ pageId: 'pg-list-1' });
    expect(blocks.map((block) => block.id)).toEqual(['bk-list-1-a', 'bk-list-1-b']);
    const first: Block = blocks[0] as Block;
    expect(first.page_id).toBe('pg-list-1');
    expect(first.type).toBe('paragraph');
    expect(first.props).toEqual({});
    expect(first.content).toEqual(paragraphDoc('内容-bk-list-1-a'));
    expect(first.parent_id).toBeNull();
    expect(first.sort_key).toBe('A00000000');
    expect(first.alive).toBe(1);
    expect(first.version).toBe(1);
    expect(typeof first.last_edited).toBe('number');
  });

  it('blocks:list：code 块 content 为纯文本、divider/image 为 null；空页返回 []', async () => {
    await seedPage('pg-list-2');
    await service.commit({
      ops: [
        makeOp(
          'upsert',
          'bk-list-2-code',
          {
            page_id: 'pg-list-2',
            type: 'code',
            props: { lang: 'python' },
            content: 'er = np.interp(x, xp, fp)',
            parent_id: null,
            sort_key: 'A00000000',
            alive: 1,
            last_edited: AT,
          },
          1,
        ),
        makeOp(
          'upsert',
          'bk-list-2-div',
          {
            page_id: 'pg-list-2',
            type: 'divider',
            props: {},
            content: null,
            parent_id: null,
            sort_key: 'A00000001',
            alive: 1,
            last_edited: AT,
          },
          1,
        ),
      ],
    });
    const { blocks } = await service.list({ pageId: 'pg-list-2' });
    expect(blocks.map((block) => block.content)).toEqual([
      'er = np.interp(x, xp, fp)',
      null,
    ]);

    const empty = await service.list({ pageId: 'pg-empty-no-blocks' });
    expect(empty.blocks).toEqual([]);
  });

  it('blocks:commit：upsert/patch/reorder/delete 真库 roundtrip（ledger + 物化同事务）', async () => {
    await seedPage('pg-commit-1');
    const before = await ledgerCount();

    // ① upsert
    await service.commit({
      ops: [blockUpsertOp('bk-commit-1', 'pg-commit-1', { sort_key: 'A00000000' })],
    });
    // ② patch（content 局部更新 → block.patch）
    await service.commit({
      ops: [
        makeOp(
          'patch',
          'bk-commit-1',
          { content: paragraphDoc('改后的正文') },
          2,
          1,
        ),
      ],
    });
    let { blocks } = await service.list({ pageId: 'pg-commit-1' });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.content).toEqual(paragraphDoc('改后的正文'));
    expect(blocks[0]?.version).toBe(2);

    // ③ reorder（只改 sort_key → block.setSort）
    await service.commit({
      ops: [makeOp('reorder', 'bk-commit-1', { sort_key: 'Z00000009' }, 3, 2)],
    });
    ({ blocks } = await service.list({ pageId: 'pg-commit-1' }));
    expect(blocks[0]?.sort_key).toBe('Z00000009');

    // ④ delete（payload {} → block.softDelete，alive=0；delete 不允许携带 base）
    await service.commit({ ops: [makeOp('delete', 'bk-commit-1', {}, 4)] });
    ({ blocks } = await service.list({ pageId: 'pg-commit-1' }));
    expect(blocks).toEqual([]);

    // 真相层：4 次提交 4 条 op 全部入账
    expect(await ledgerCount()).toBe(before + 4);
  });

  it('blocks:commit：非法入参 → E_MALFORMED；无工作区 → E_NO_WORKSPACE', async () => {
    await expectBlocksError(
      service.commit({ ops: 'not-an-array' as unknown as Op[] }),
      'E_MALFORMED',
    );
    await expectBlocksError(service.commit({ ops: [null as unknown as Op] }), 'E_MALFORMED');
    await expectBlocksError(service.list({ pageId: '' }), 'E_MALFORMED');

    const failing = createBlocksService({
      executor: coreExecutor(core),
      actor: ACTOR,
      activeWorkspaceId: async () => {
        throw new BlocksApiError('E_NO_WORKSPACE', '无活动工作区，块 Op 无法物化');
      },
    });
    await expectBlocksError(
      failing.commit({ ops: [blockUpsertOp('bk-x', 'pg-x')] }),
      'E_NO_WORKSPACE',
    );
  });

  it('blocks:commit：假 executor 断言 sqlId 与参数（workspace_id 注入 / version=lamport.c）', async () => {
    const batches: DbBatchStatement[][] = [];
    const fakeExecutor: StatementExecutor = {
      run: async () => ({ changes: 0, lastInsertRowid: 0 }) as RunData,
      get: async () => ({ row: null }) as GetData,
      all: async () => ({ rows: [] }) as AllData,
      batch: async (stmts) => {
        batches.push([...stmts]);
        return { results: [] } as BatchData;
      },
    };
    const fake = createBlocksService({
      executor: fakeExecutor,
      actor: ACTOR,
      activeWorkspaceId: async () => WORKSPACE_ID,
    });

    await fake.commit({ ops: [blockUpsertOp('bk-fake-1', 'pg-fake-1')] });
    expect(batches).toHaveLength(1);
    const upsertBatch = batches[0] as DbBatchStatement[];
    // ledger × 1 + 物化 × 1 + FTS 显式同步 × 2（commitOps 对 block upsert 的尾部追加）
    expect(upsertBatch.map((stmt) => stmt.sqlId)).toEqual([
      'opLedger.insert',
      'block.upsert',
      'fts.clearPage',
      'fts.syncBlock',
    ]);
    const upsert = upsertBatch[1]?.params as Record<string, unknown>;
    expect(upsert['id']).toBe('bk-fake-1');
    expect(upsert['page_id']).toBe('pg-fake-1');
    expect(upsert['workspace_id']).toBe(WORKSPACE_ID);
    expect(upsert['type']).toBe('paragraph');
    expect(upsert['sort_key']).toBe('A00000000');
    expect(upsert['alive']).toBe(1);
    expect(upsert['version']).toBe(1);
    expect(upsert['lamport_c']).toBe(1);
    expect(upsert['lamport_d']).toBe(ACTOR);

    await fake.commit({
      ops: [makeOp('patch', 'bk-fake-1', { content: paragraphDoc('v2') }, 2, 1)],
    });
    const patchBatch = batches[1] as DbBatchStatement[];
    // patch 不触发 FTS 显式同步（v4/v6 触发器即时生效），batch 只有 ledger + 物化
    expect(patchBatch.map((stmt) => stmt.sqlId)).toEqual(['opLedger.insert', 'block.patch']);
    const patch = patchBatch[1]?.params as Record<string, unknown>;
    expect(patch['id']).toBe('bk-fake-1');
    expect(patch['content_json']).toBe(JSON.stringify(paragraphDoc('v2')));
    // 缺席字段不触碰（COALESCE 语义）
    expect(patch['props_json']).toBeNull();
    expect(patch['sort_key']).toBeNull();
    expect(patch['version']).toBe(2);

    await fake.commit({ ops: [makeOp('reorder', 'bk-fake-1', { sort_key: 'C00000002' }, 3, 2)] });
    const sortBatch = batches[2] as DbBatchStatement[];
    expect(sortBatch[1]?.sqlId).toBe('block.setSort');
    expect((sortBatch[1]?.params as Record<string, unknown>)['sort_key']).toBe('C00000002');

    await fake.commit({ ops: [makeOp('delete', 'bk-fake-1', {}, 4)] });
    const deleteBatch = batches[3] as DbBatchStatement[];
    expect(deleteBatch[1]?.sqlId).toBe('block.softDelete');
    expect((deleteBatch[1]?.params as Record<string, unknown>)['id']).toBe('bk-fake-1');
  });
});

// ---------------------------------------------------------------------------
// content_json → 块 content（TASK-T79-02 缺陷 A：blocks:list 与导出共用的唯一实现）
// ---------------------------------------------------------------------------

const EMPTY_PARAGRAPH_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as const;

describe('blockContentOf：六种行形态分流（唯一实现）', () => {
  it('文本类（paragraph/heading/quote…）：PM doc 原样透传', () => {
    const json = JSON.stringify(paragraphDoc('正文文本'));
    expect(blockContentOf('paragraph', json)).toEqual(paragraphDoc('正文文本'));
    expect(blockContentOf('heading', json)).toEqual(paragraphDoc('正文文本'));
    expect(blockContentOf('quote', json)).toEqual(paragraphDoc('正文文本'));
  });

  it('code：纯文本 string（null / 空串 → 空串，不 JSON 化）', () => {
    expect(blockContentOf('code', 'const a = 1;')).toBe('const a = 1;');
    expect(blockContentOf('code', '{ "not": "json" }')).toBe('{ "not": "json" }');
    expect(blockContentOf('code', null)).toBe('');
    expect(blockContentOf('code', '')).toBe('');
  });

  it('table：结构化 {rows,header}（PM 真机夹具形态，不是 PM doc）', () => {
    const json = JSON.stringify({ rows: [['格A', '', ''], ['', '', ''], ['', '', '']], header: true });
    expect(blockContentOf('table', json)).toEqual({
      rows: [['格A', '', ''], ['', '', ''], ['', '', '']],
      header: true,
    });
  });

  it('table：colWidths 齐列时保留，不齐时丢弃（normalize 归一）', () => {
    const kept = JSON.stringify({ rows: [['a', 'b']], header: false, colWidths: [120, 80] });
    expect(blockContentOf('table', kept)).toEqual({ rows: [['a', 'b']], header: false, colWidths: [120, 80] });
    const dropped = JSON.stringify({ rows: [['a', 'b']], header: true, colWidths: [120] });
    expect(blockContentOf('table', dropped)).toEqual({ rows: [['a', 'b']], header: true });
  });

  it('toggle：结构化 {title,body}', () => {
    const json = JSON.stringify({ title: '折叠标题Q', body: ['正文行R'] });
    expect(blockContentOf('toggle', json)).toEqual({ title: '折叠标题Q', body: ['正文行R'] });
    expect(blockContentOf('toggle', JSON.stringify({ title: '折叠标题Q', body: [''] }))).toEqual({
      title: '折叠标题Q',
      body: [''],
    });
  });

  it('divider / image：恒 null（不看 content_json）', () => {
    expect(blockContentOf('divider', null)).toBeNull();
    expect(blockContentOf('divider', JSON.stringify(paragraphDoc('x')))).toBeNull();
    expect(blockContentOf('image', null)).toBeNull();
    expect(blockContentOf('image', '{"rows":[["a"]]}')).toBeNull();
  });

  it('降级：损坏 JSON / 非 doc 形态 / 空串 → 空段落（不丢块，只丢内容）', () => {
    expect(blockContentOf('paragraph', '{坏了')).toEqual(EMPTY_PARAGRAPH_DOC);
    expect(blockContentOf('paragraph', '')).toEqual(EMPTY_PARAGRAPH_DOC);
    expect(blockContentOf('paragraph', null)).toEqual(EMPTY_PARAGRAPH_DOC);
    expect(blockContentOf('paragraph', JSON.stringify({ type: 'table', rows: [['a']] }))).toEqual(EMPTY_PARAGRAPH_DOC);
    expect(blockContentOf('paragraph', '[1,2,3]')).toEqual(EMPTY_PARAGRAPH_DOC);
  });

  it('结构化类型的损坏 JSON：归一为同型空结构（不是空段落，见报告 DEVIATION-1）', () => {
    expect(blockContentOf('table', '{坏了')).toEqual(defaultTableContent());
    expect(blockContentOf('table', null)).toEqual(defaultTableContent());
    expect(blockContentOf('toggle', '{坏了')).toEqual(defaultToggleContent());
    expect(blockContentOf('toggle', '"串"')).toEqual(defaultToggleContent());
  });
});

// ---------------------------------------------------------------------------
// IPC 边界（不依赖真库：注册器级断言）
// ---------------------------------------------------------------------------

function makeRegistrar(): { handlers: Map<string, (input: unknown) => Promise<unknown>> } & BlocksIpcRegistrar {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    handlers,
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  };
}

describe('registerBlocksIpc（IPC 边界）', () => {
  it('blocks:changed 只保留通道名，不注册 handler（本期不推送）', () => {
    const registrar = makeRegistrar();
    registerBlocksIpc(null, registrar);
    expect(registrar.handlers.has('blocks:list')).toBe(true);
    expect(registrar.handlers.has('blocks:commit')).toBe(true);
    expect(registrar.handlers.has('blocks:changed')).toBe(false);
  });

  it('service=null：list/commit 统一回 E_INVARIANT（DB 未就绪降级）', async () => {
    const registrar = makeRegistrar();
    registerBlocksIpc(null, registrar);
    const list = registrar.handlers.get('blocks:list');
    const commit = registrar.handlers.get('blocks:commit');
    await expect(list?.({ pageId: 'pg-1' })).rejects.toThrow(/E_INVARIANT/);
    await expect(commit?.({ ops: [] })).rejects.toThrow(/E_INVARIANT/);
  });

  it('非法入参：E_MALFORMED（非对象 / pageId 空 / ops 非数组 / op 非对象）', async () => {
    const registrar = makeRegistrar();
    const service = createBlocksService({
      executor: {
        run: async () => ({ changes: 0, lastInsertRowid: 0 }) as RunData,
        get: async () => ({ row: null }) as GetData,
        all: async () => ({ rows: [] }) as AllData,
        batch: async () => ({ results: [] }) as BatchData,
      },
      actor: ACTOR,
      activeWorkspaceId: async () => WORKSPACE_ID,
    });
    registerBlocksIpc(service, registrar);
    const list = registrar.handlers.get('blocks:list');
    const commit = registrar.handlers.get('blocks:commit');

    await expect(list?.(null)).rejects.toThrow(/E_MALFORMED/);
    await expect(list?.({ pageId: '' })).rejects.toThrow(/E_MALFORMED/);
    await expect(list?.({ pageId: 42 })).rejects.toThrow(/E_MALFORMED/);
    await expect(commit?.({ ops: 'x' })).rejects.toThrow(/E_MALFORMED/);
    await expect(commit?.({ ops: [1] })).rejects.toThrow(/E_MALFORMED/);
  });
});
