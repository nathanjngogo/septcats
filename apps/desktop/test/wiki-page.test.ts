/**
 * wiki-page.test.ts —— 页面承载类型（TASK-T42-01 口径 A + T40-01-2 闭环）主进程端到端。
 *
 * 走真实 better-sqlite3（DbServerCore + 白名单转发），覆盖任务书 §2 的数据面断言：
 * 1. 类型持久化：普通页 → 转 Wiki → listTree 注解 wiki；**重开（新连接）后仍是 wiki**；
 * 2. 落地页简介：setSummary 落库（v8 summary 列）→ 重开仍在；
 * 3. 子页索引：新建子页后 parentId 正确、索引数据源（真树）条目数一致；
 * 4. 双向转换内容零丢失：正文块（block 行）与子页在 wiki→page→wiki 往返后逐条不变；
 * 5. T40-01-2：db.create 产出的独立库页重开后**仍是数据库页**（pageType 注解 database）；
 * 6. 旧库兼容：v7 夹具库（未升级）打开 → 迁移补列 → 存量行按普通页理解、转换可用。
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ActorId, Op } from '@septcats/core';
import type { AllData, BatchData, GetData, MigrateData, RunData } from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import { MIGRATIONS, runMigrations } from '../src/db/migrations';
import {
  createDbViewService,
  DbViewApiError,
  type DbViewService,
} from '../src/main/dbview';
import { createPagesService, type PageNodeView, type PagesService, type StatementExecutor } from '../src/main/pages';
import { createBlocksService, type BlocksService } from '../src/main/blocks';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa0001';
const AT = 1_700_000_000_000;
const WORKSPACE_ID = 'ws-wiki-test';

function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `wiki-test-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
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

interface Harness {
  core: DbServerCore;
  pages: PagesService;
  db: DbViewService;
  blocks: BlocksService;
  nodeOf(id: string): Promise<PageNodeView | undefined>;
}

function buildHarness(core: DbServerCore): Harness {
  const executor = coreExecutor(core);
  const pages = createPagesService({ executor, actor: ACTOR, userKey: 'device-user-1' });
  const db = createDbViewService({ executor, actor: ACTOR, now: () => AT });
  const blocks = createBlocksService({
    executor,
    actor: ACTOR,
    activeWorkspaceId: async () => WORKSPACE_ID,
  });
  return {
    core,
    pages,
    db,
    blocks,
    nodeOf: async (id) => {
      const nodes = await pages.listTree({ workspaceId: WORKSPACE_ID });
      return nodes.find((node) => node.id === id);
    },
  };
}

/** 测试用块 Op（与 packages/editor diff 产出同形，blocks.test.ts 同款）。 */
function blockUpsertOp(blockId: string, pageId: string, text: string, c: number): Op {
  return {
    op_id: `op-wiki-${blockId}`,
    lamport: { c, d: ACTOR },
    at: AT,
    actor: ACTOR,
    target: { table: 'block', id: blockId },
    kind: 'upsert',
    payload: {
      page_id: pageId,
      type: 'paragraph',
      props: {},
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
      parent_id: null,
      sort_key: 'A00000000',
      alive: 1,
      last_edited: AT,
    },
  };
}

/** 块指纹：id + type + 正文文本拼接（往返不变的「文本校验和」）。 */
function blockFingerprint(blocks: Array<{ id: string; type: string; content: unknown }>): string {
  return JSON.stringify(
    blocks.map((block) => {
      const content = block.content as { content?: Array<{ content?: Array<{ text?: string }> }> } | null;
      const text =
        content?.content?.[0]?.content?.[0]?.text ?? (typeof block.content === 'string' ? block.content : '');
      return [block.id, block.type, text].join('|');
    }),
  );
}

describeDb('wiki-page（承载类型 / 转换 / 库页不退化）', (ctor) => {
  let temp: TempDb;
  let h: Harness;

  beforeEach(async () => {
    temp = makeTempDb('septcats-wiki');
    const core = makeCore(ctor, temp.path);
    await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
    // 固定活动工作区（meta.active_workspace_id）
    await requestOk<RunData>(core, {
      id: 'seed-ws',
      t: 'run',
      sqlId: 'workspace.upsert',
      params: { id: WORKSPACE_ID, name: 'Wiki 工作区', root_page_id: null, settings_json: '{}', created_at: AT },
    });
    await requestOk<RunData>(core, {
      id: 'seed-active',
      t: 'run',
      sqlId: 'meta.set',
      params: { key: 'active_workspace_id', value: WORKSPACE_ID },
    });
    h = buildHarness(core);
  });

  afterEach(() => {
    h.core.dispose();
    temp.cleanup();
  });

  /** 关闭当前连接并以新连接重开（「重开应用」的数据面等价物）。 */
  async function reopen(): Promise<void> {
    h.core.dispose();
    const core = makeCore(ctor, temp.path);
    const migrated = await requestOk<MigrateData>(core, { id: 'migrate-reopen', t: 'migrate' });
    expect(migrated.to).toBe(9); // T44-01：v9-page-link-index 起逐次顺延
    h = buildHarness(core);
  }

  it('普通页 → 转 Wiki：注解 wiki 且重开保持；wiki → 转普通页：注解回 page', async () => {
    const created = await h.pages.createPage({ parentId: null });
    expect((await h.nodeOf(created.id))?.pageType).toBe('page');

    await h.db.convertPage({ pageId: created.id, to: 'wiki' });
    expect((await h.nodeOf(created.id))?.pageType).toBe('wiki');

    // 重开（新连接读同一库文件）：类型持久化
    await reopen();
    expect((await h.nodeOf(created.id))?.pageType).toBe('wiki');

    // 转回普通页
    await h.db.convertPage({ pageId: created.id, to: 'page' });
    expect((await h.nodeOf(created.id))?.pageType).toBe('page');
    await reopen();
    expect((await h.nodeOf(created.id))?.pageType).toBe('page');
  });

  it('落地页简介：setSummary 持久化，重开仍在；非 Wiki 页拒绝', async () => {
    const created = await h.pages.createPage({ parentId: null });
    await h.db.convertPage({ pageId: created.id, to: 'wiki' });
    await h.db.setPageSummary({ pageId: created.id, summary: '本 Wiki 收录团队研究笔记' });

    let node = await h.nodeOf(created.id);
    expect(node?.summary).toBe('本 Wiki 收录团队研究笔记');
    expect(node?.pageType).toBe('wiki');

    await reopen();
    node = await h.nodeOf(created.id);
    expect(node?.summary).toBe('本 Wiki 收录团队研究笔记');

    // 普通页不可设简介（只允许 Wiki 页）
    const plain = await h.pages.createPage({ parentId: null });
    await expectApiError(h.db.setPageSummary({ pageId: plain.id, summary: 'x' }), 'E_MALFORMED');
  });

  it('子页索引：新建子页后 parentId 正确、索引条目数 = 实际子页数', async () => {
    const wiki = await h.pages.createPage({ parentId: null });
    await h.db.convertPage({ pageId: wiki.id, to: 'wiki' });

    const first = await h.pages.createPage({ parentId: wiki.id });
    const second = await h.pages.createPage({ parentId: wiki.id });

    const nodes = await h.pages.listTree({ workspaceId: WORKSPACE_ID });
    const subs = nodes.filter((node) => node.parentId === wiki.id && node.alive === 1);
    expect(subs.length).toBe(2);
    expect(subs.map((node) => node.id).sort()).toEqual([first.id, second.id].sort());
    expect(subs.every((node) => node.parentId === wiki.id)).toBe(true);
    // 子页类型仍是普通页（不随父级传染）
    expect(subs.every((node) => node.pageType === 'page')).toBe(true);
  });

  it('双向转换内容零丢失：正文块与子页在 wiki→page→wiki 往返后逐条不变', async () => {
    const page = await h.pages.createPage({ parentId: null });
    await h.pages.renamePage({ id: page.id, title: '研究主页' });

    // 正文块 ×3（经 blocks:commit 同一写路径）
    await h.blocks.commit({
      ops: [
        blockUpsertOp('bk-wiki-1', page.id, '第一段', 1),
        blockUpsertOp('bk-wiki-2', page.id, '第二段', 2),
        blockUpsertOp('bk-wiki-3', page.id, '第三段', 3),
      ],
    });
    // 子页 ×2
    const child1 = await h.pages.createPage({ parentId: page.id });
    await h.pages.createPage({ parentId: page.id });
    await h.pages.renamePage({ id: child1.id, title: '子页甲' });

    const beforeBlocks = blockFingerprint(await h.blocks.list({ pageId: page.id }));
    const beforeTree = await h.pages.listTree({ workspaceId: WORKSPACE_ID });
    const beforeChildTitles = beforeTree
      .filter((node) => node.parentId === page.id)
      .map((node) => `${node.id}:${node.title}`)
      .sort();

    // page → wiki → page → wiki 往返
    await h.db.convertPage({ pageId: page.id, to: 'wiki' });
    await h.db.convertPage({ pageId: page.id, to: 'page' });
    await h.db.convertPage({ pageId: page.id, to: 'wiki' });
    expect((await h.nodeOf(page.id))?.pageType).toBe('wiki');

    const afterBlocks = blockFingerprint(await h.blocks.list({ pageId: page.id }));
    expect(afterBlocks).toBe(beforeBlocks);
    const afterTree = await h.pages.listTree({ workspaceId: WORKSPACE_ID });
    expect(
      afterTree
        .filter((node) => node.parentId === page.id)
        .map((node) => `${node.id}:${node.title}`)
        .sort(),
    ).toEqual(beforeChildTitles);
    // 标题与子页数不变
    expect((await h.nodeOf(page.id))?.title).toBe('研究主页');
    expect(afterTree.filter((node) => node.parentId === page.id).length).toBe(2);
  });

  it('T40-01-2：db.create 产出的独立库页重开后仍是数据库页（不退化为文档页）', async () => {
    const created = await h.db.create({ workspaceId: WORKSPACE_ID, parentPageId: null, title: '任务追踪' });
    let node = await h.nodeOf(created.pageId);
    expect(node?.pageType).toBe('database');
    // load 通道照常（DbPage 的数据源）
    const loaded = await h.db.load({ pageId: created.pageId });
    expect(loaded.collection.id).toBe(created.collectionId);

    await reopen();
    node = await h.nodeOf(created.pageId);
    // 重开/重载后：承载判定仍为 database（存活 collection 行存在 → 既有范式）
    expect(node?.pageType).toBe('database');
    const reloaded = await h.db.load({ pageId: created.pageId });
    expect(reloaded.collection.id).toBe(created.collectionId);
  });

  it('数据库页拒绝转 Wiki（避免双重承载）；回收站页拒绝转换/设简介', async () => {
    const created = await h.db.create({ workspaceId: WORKSPACE_ID, parentPageId: null, title: '不可转' });
    await expectApiError(h.db.convertPage({ pageId: created.pageId, to: 'wiki' }), 'E_MALFORMED');

    const page = await h.pages.createPage({ parentId: null });
    await h.db.convertPage({ pageId: page.id, to: 'wiki' });
    await h.pages.deletePage({ id: page.id });
    await expectApiError(h.db.convertPage({ pageId: page.id, to: 'page' }), 'E_MALFORMED');
    await expectApiError(h.db.setPageSummary({ pageId: page.id, summary: 'x' }), 'E_MALFORMED');
  });

  it('旧库兼容：v7 夹具库打开 → 迁移补列（存量行按普通页），转换/库页照常可用', async () => {
    // 本用例自建独立「未升级旧库」（beforeEach 的库已随 makeCore 升到最新版，不复用）
    h.core.dispose();
    const legacyTemp = makeTempDb('septcats-wiki-legacy');
    try {
      // ① 用 v7 及以下的迁移表建一个「未升级」旧库，并插入一条旧版本风格的页面行
      {
        const raw = new ctor(legacyTemp.path);
        try {
          const legacy = MIGRATIONS.filter((migration) => migration.id <= 7);
          const result = await runMigrations(raw, legacy, { backup: false });
          expect(result.to).toBe(7);
          // 旧版本 app 的直写形态：page 行没有 page_type/summary 列可写
          raw.prepare(
            `INSERT INTO workspace (id, name, created_at) VALUES ('${WORKSPACE_ID}', 'old', ${String(AT)})`,
          ).run();
          raw.prepare(
            `INSERT INTO meta (key, value) VALUES ('active_workspace_id', '${WORKSPACE_ID}')`,
          ).run();
          raw.prepare(
            `INSERT INTO page (id, workspace_id, title, parent_id, sort_key, alive, version) VALUES ('pg-legacy', '${WORKSPACE_ID}', '旧页', NULL, 'A00000000', 1, 1)`,
          ).run();
        } finally {
          raw.close();
        }
      }
      // ② 新版本代码打开：迁移到最新版（v8 补 page_type/summary 两列；v9 补双链派生表）
      const core = makeCore(ctor, legacyTemp.path);
      try {
        const migrated = await requestOk<MigrateData>(core, { id: 'migrate-legacy', t: 'migrate' });
        expect(migrated.from).toBe(7);
        expect(migrated.to).toBe(9); // 迁移目标随 LATEST_SCHEMA_VERSION 顺延（v9）

        const executor = coreExecutor(core);
        // ③ 存量行（迁移前插入）默认 page_type='page'
        const row = await requestOk<GetData>(core, {
          id: 'read-legacy-row',
          t: 'get',
          sqlId: 'page.get',
          params: { id: 'pg-legacy' },
        });
        expect((row.row as { page_type?: string }).page_type).toBe('page');

        // ④ 列表、转换、库页全链路无异常
        const pages = createPagesService({ executor, actor: ACTOR, userKey: 'device-user-1' });
        const db = createDbViewService({ executor, actor: ACTOR, now: () => AT });
        const tree = await pages.listTree({ workspaceId: WORKSPACE_ID });
        expect(tree.find((node) => node.id === 'pg-legacy')?.pageType).toBe('page');

        await db.convertPage({ pageId: 'pg-legacy', to: 'wiki' });
        const after = await pages.listTree({ workspaceId: WORKSPACE_ID });
        expect(after.find((node) => node.id === 'pg-legacy')?.pageType).toBe('wiki');

        const dbPage = await db.create({ workspaceId: WORKSPACE_ID, parentPageId: null, title: '旧库新库页' });
        const treeAfter = await pages.listTree({ workspaceId: WORKSPACE_ID });
        expect(treeAfter.find((node) => node.id === dbPage.pageId)?.pageType).toBe('database');
      } finally {
        core.dispose();
      }
    } finally {
      legacyTemp.cleanup();
    }
  });
});
