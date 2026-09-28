/**
 * links.test.ts —— 双链派生索引端到端断言（TASK-T44-01）。
 *
 * 走真实 better-sqlite3（DbServerCore + 白名单转发）：迁移 v9 → blocks:commit
 * （commit 内增量同步双链索引）→ links:backlinks 查询 → 全量重建。
 * 覆盖：派生行形状 / 未解析不入索引 / 回链（改名可读）/ 增量==全量重建（随机
 * 插删 10 轮）/ 删除源页 / 脏行可复现并被重建修复（一致性证据线）。
 * better-sqlite3 不可用时整组跳过（见 test/helpers.ts）。
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildSegment, type ActorId, type Op } from '@septcats/core';
import type { AllData, BatchData, GetData, MigrateData, RebuildData, RunData } from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import { createBlocksService, type BlocksService } from '../src/main/blocks';
import {
  createLinksService,
  pageIdsTouchedByOps,
  rebuildLinksIndex,
  type LinksService,
} from '../src/main/links';
import { createPagesService, type PagesService, type StatementExecutor } from '../src/main/pages';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa0001';
const AT = 1_700_000_000_000;
const WS = 'ws-links-test';

function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `links-test-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
}

/** PM doc content：文本 + wikilink 内联节点序列（与编辑器投影同形）。 */
function docWithLinks(
  parts: Array<{ text?: string; link?: { target: string | null; title: string; alias?: string | null } }>,
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  for (const part of parts) {
    if (part.text !== undefined && part.text.length > 0) {
      content.push({ type: 'text', text: part.text });
    }
    if (part.link !== undefined) {
      content.push({
        type: 'wikilink',
        attrs: {
          target: part.link.target,
          title: part.link.title,
          alias: part.link.alias ?? null,
        },
      });
    }
  }
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

let opSeq = 0;

function blockUpsertOp(
  blockId: string,
  pageId: string,
  content: Record<string, unknown>,
  sortKey = 'A00000000',
): Op {
  opSeq += 1;
  return {
    op_id: `op-links-test-${String(opSeq).padStart(6, '0')}`,
    lamport: { c: 1, d: ACTOR },
    at: AT,
    actor: ACTOR,
    target: { table: 'block', id: blockId },
    kind: 'upsert',
    payload: {
      page_id: pageId,
      type: 'paragraph',
      props: {},
      content,
      parent_id: null,
      sort_key: sortKey,
      alive: 1,
      last_edited: AT,
    },
  };
}

describeDb('linksService（双链派生索引 · TASK-T44-01）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let executor: StatementExecutor;
  let pages: PagesService;
  let blocks: BlocksService;
  let links: LinksService;
  let requestSeq = 0;

  beforeEach(async () => {
    temp = makeTempDb('septcats-links');
    core = makeCore(ctor, temp.path);
    executor = coreExecutor(core);
    await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
    requestSeq = 0;
    await requestOk<RunData>(core, {
      id: `seed-ws-${String(requestSeq++)}`,
      t: 'run',
      sqlId: 'workspace.upsert',
      params: { id: WS, name: '链接测试区', root_page_id: null, settings_json: '{}', created_at: AT },
    });
    pages = createPagesService({ executor, actor: ACTOR, now: () => AT });
    blocks = createBlocksService({
      executor,
      actor: ACTOR,
      activeWorkspaceId: async () => WS,
    });
    links = createLinksService({ executor });
  });

  afterEach(() => {
    core.dispose();
    temp.cleanup();
  });

  async function createPageTitled(title: string): Promise<string> {
    const created = await pages.createPage({ parentId: null });
    await pages.renamePage({ id: created.id, title });
    return created.id;
  }

  /** 直接读派生表全量（排序稳定，供增量==全量断言）。 */
  function indexRows(): Array<Record<string, unknown>> {
    return core
      .activeDatabase()
      .prepare(
        'SELECT source_page_id, source_block_id, target_page_id, workspace_id, title, context FROM page_link_index ORDER BY source_page_id, source_block_id, target_page_id',
      )
      .all() as Array<Record<string, unknown>>;
  }

  it('v9 迁移：page_link_index 表与双索引就位', () => {
    const db = core.activeDatabase();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='page_link_index'`)
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='page_link_index'`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((row) => row.name);
    expect(names).toContain('idx_page_link_target');
    expect(names).toContain('idx_page_link_source');
  });

  it('commit 即派生：2 有效 + 1 未解析 → 索引 2 行，回链含上下文片段与别名', async () => {
    const pageA = await createPageTitled('甲页');
    const pageB = await createPageTitled('乙页');
    const pageC = await createPageTitled('丙页');
    await blocks.commit({ ops: [
      blockUpsertOp('bk-a-1', pageA, docWithLinks([
        { text: '前置说明，' },
        { link: { target: pageB, title: '乙页' } },
        { text: '，以及' },
        { link: { target: pageC, title: '丙页', alias: '丙的别名' } },
        { link: { target: null, title: '幽灵页' } },
      ])),
    ] });
    const rows = indexRows();
    // 未解析（target=null）不入索引
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row['target_page_id']).sort()).toEqual([pageB, pageC].sort());
    // 回链：谁引用了乙页
    const backlinksB = await links.backlinks({ pageId: pageB });
    expect(backlinksB.entries).toHaveLength(1);
    expect(backlinksB.entries[0]?.sourcePageId).toBe(pageA);
    expect(backlinksB.entries[0]?.sourceTitle).toBe('甲页');
    expect(backlinksB.entries[0]?.sourceBlockId).toBe('bk-a-1');
    expect(backlinksB.entries[0]?.context).toBe('前置说明，，以及');
  });

  it('增量==全量重建：随机插删 10 轮后两张快照完全相等', async () => {
    const pageA = await createPageTitled('甲页');
    const pageB = await createPageTitled('乙页');
    const pageC = await createPageTitled('丙页');
    const targets = [pageB, pageC];
    // 确定性"随机"10 轮：轮 i 在 A/B 两页写不同链接组合（含删除语义=重写整块）
    const incrementalSnapshots: Array<number> = [];
    for (let round = 0; round < 10; round += 1) {
      const onA = docWithLinks(
        round % 2 === 0
          ? [{ text: `轮${round}`, link: { target: targets[round % 2] as string, title: `目标${round}` } }]
          : [{ text: `轮${round} 无链接` }],
      );
      const onB = docWithLinks(
        round % 3 !== 0
          ? [{ link: { target: pageA, title: '甲页' } }, { text: `r${round}` }]
          : [{ text: `r${round} 空` }],
      );
      await blocks.commit({ ops: [
        blockUpsertOp('bk-rnd-a', pageA, onA),
        blockUpsertOp('bk-rnd-b', pageB, onB, 'A00000001'),
      ] });
      incrementalSnapshots.push(indexRows().length);
    }
    const beforeRebuild = indexRows();
    const written = await rebuildLinksIndex(executor);
    expect(written).toBe(beforeRebuild.length);
    const afterRebuild = indexRows();
    expect(afterRebuild).toEqual(beforeRebuild);
    // 期间索引非空（链接确实被派生出来过）
    expect(Math.max(...incrementalSnapshots)).toBeGreaterThan(0);
  });

  it('改名不破链：源页改名后索引行不变，回链面板回当前标题', async () => {
    const pageA = await createPageTitled('甲页');
    const pageB = await createPageTitled('乙页');
    await blocks.commit({ ops: [blockUpsertOp('bk-a-1', pageA, docWithLinks([{ link: { target: pageB, title: '乙页' } }]))] });
    const before = indexRows();
    await pages.renamePage({ id: pageA, title: '甲页新名' });
    // id 为键：rename 不触发也不需要重算，行原样
    expect(indexRows()).toEqual(before);
    const backlinks = await links.backlinks({ pageId: pageB });
    expect(backlinks.entries).toHaveLength(1);
    expect(backlinks.entries[0]?.sourceTitle).toBe('甲页新名');
  });

  it('block patch（无 page_id）改内容：索引经块反查正确增删', async () => {
    const pageA = await createPageTitled('甲页');
    const pageB = await createPageTitled('乙页');
    await blocks.commit({ ops: [blockUpsertOp('bk-a-1', pageA, docWithLinks([{ link: { target: pageB, title: '乙页' } }]))] });
    expect(indexRows()).toHaveLength(1);
    opSeq += 1;
    await blocks.commit({ ops: [
      {
        ...blockUpsertOp('bk-a-1', pageA, {}),
        kind: 'patch',
        payload: { content: docWithLinks([{ text: '链接已移除' }]) },
      },
    ] });
    expect(indexRows()).toHaveLength(0);
    expect(await links.backlinks({ pageId: pageB })).toMatchObject({ entries: [] });
  });

  it('一致性证据线：删除源页 / 手工脏行 → 全量重建收敛到与新事实一致', async () => {
    const pageA = await createPageTitled('甲页');
    const pageB = await createPageTitled('乙页');
    await blocks.commit({ ops: [
      blockUpsertOp('bk-a-1', pageA, docWithLinks([{ link: { target: pageB, title: '乙页' } }])),
      blockUpsertOp('bk-b-1', pageB, docWithLinks([{ text: '无链接' }]), 'A00000001'),
    ] });
    expect(indexRows()).toHaveLength(1);
    // ① 可复现的不一致：外力污染索引（模拟派生态分叉——崩溃/旧版本半写）
    core
      .activeDatabase()
      .prepare(
        `INSERT INTO page_link_index (source_page_id, source_block_id, target_page_id, workspace_id, title, context)
         VALUES ('pg-ghost', 'bk-ghost', ?, ?, '乙页', '脏行')`,
      )
      .run(pageB, WS);
    expect(indexRows()).toHaveLength(2);
    // ② 重建修复：脏行被清、增量维护结果 == 全量重建结果
    const written = await rebuildLinksIndex(executor);
    expect(written).toBe(1);
    expect(indexRows()).toHaveLength(1);
    // ③ 删除源页：块行仍存活（page 软删不触块），重建结果与增量语义一致（行保留），
    //    但回链查询按源页 alive=1 过滤 → 面板不再出现已删源页（与"新事实"一致）
    await pages.deletePage({ id: pageA });
    const afterDelete = indexRows();
    await rebuildLinksIndex(executor);
    expect(indexRows()).toEqual(afterDelete);
    const backlinks = await links.backlinks({ pageId: pageB });
    expect(backlinks.entries).toHaveLength(0);
  });

  it('pageIdsTouchedByOps：upsert 直取 page_id，patch/delete 反查', async () => {
    const pageA = await createPageTitled('甲页');
    await blocks.commit({ ops: [blockUpsertOp('bk-a-1', pageA, docWithLinks([{ text: 'x' }]))] });
    const upsertTouched = await pageIdsTouchedByOps(executor, [
      { target: { table: 'block', id: 'bk-a-1' }, kind: 'upsert', payload: { page_id: pageA } },
    ]);
    expect([...upsertTouched]).toEqual([pageA]);
    const patchTouched = await pageIdsTouchedByOps(executor, [
      { target: { table: 'block', id: 'bk-a-1' }, kind: 'patch', payload: {} },
      { target: { table: 'page', id: pageA }, kind: 'patch', payload: { title: 'x' } },
    ]);
    expect([...patchTouched]).toEqual([pageA]);
  });

  it('H-06 回归：rebuildFromSegments 事务内同步重建 page_link_index（清脏行+补漏行）', async () => {
    const pageA = await createPageTitled('H06甲页');
    const pageB = await createPageTitled('H06乙页');
    const blockOp0 = blockUpsertOp('bk-h06-1', pageA, docWithLinks([
      { text: '见 ' },
      { link: { target: pageB, title: 'H06乙页' } },
    ]));
    await blocks.commit({ ops: [blockOp0] });
    // 重建段的 op 需 lamport 严格升序：块 op 抬到 c=3（语义等价——重建只按内容重放）
    const blockOp: Op = {
      ...blockOp0,
      lamport: { c: 3, d: ACTOR },
      payload: { ...blockOp0.payload, workspace_id: WS },
    };
    expect(indexRows()).toHaveLength(1);

    // 人为把派生索引弄脏（模拟旧缺陷态：重建后索引与投影不一致）
    core.activeDatabase().prepare('DELETE FROM page_link_index').run();
    expect(indexRows()).toHaveLength(0);

    // replace 重建：段里含页+块 op → 事务内同步重建应把索引恢复为与投影一致
    const pageOpA: Op = {
      op_id: 'op-h06-page-a',
      lamport: { c: 1, d: ACTOR },
      at: AT,
      actor: ACTOR,
      target: { table: 'page', id: pageA },
      kind: 'upsert',
      payload: { workspace_id: WS, title: 'H06甲页', sort_key: 'A00000000', alive: 1 },
    };
    const pageOpB: Op = {
      op_id: 'op-h06-page-b',
      lamport: { c: 2, d: ACTOR },
      at: AT,
      actor: ACTOR,
      target: { table: 'page', id: pageB },
      kind: 'upsert',
      payload: { workspace_id: WS, title: 'H06乙页', sort_key: 'A00000001', alive: 1 },
    };
    const segmentsJson = JSON.stringify([buildSegment(ACTOR, [pageOpA, pageOpB, blockOp], AT)]);
    let seq = 0;
    await requestOk<RebuildData>(core, {
      id: `h06-rebuild-${String(seq++)}`,
      t: 'rebuildFromSegments',
      segmentsJson,
      mode: 'replace',
    });
    // 索引与投影一致：恰好 1 行、指向 pageB
    const rows = indexRows();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.['target_page_id'])).toBe(pageB);
    expect(String(rows[0]?.['source_page_id'])).toBe(pageA);

    // 增量==全量判据仍成立（异步版结果与事务内同步版逐行一致）
    await rebuildLinksIndex(executor);
    expect(indexRows()).toEqual(rows);
  });
});
