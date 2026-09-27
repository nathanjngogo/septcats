/**
 * pages.test.ts —— 主进程页面树/工作区服务的端到端断言（TASK-T6-01 §3）。
 *
 * 走真实 better-sqlite3（经 DbServerCore + 白名单转发），因此同时验证：
 * 迁移 v2 → 白名单语句 → commitOps（ledger + 物化同事务）→ pagesApi 语义。
 * better-sqlite3 不可用时整组跳过（见 test/helpers.ts）。
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ActorId } from '@septcats/core';
import type { AllData, BatchData, GetData, MigrateData, RunData } from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import {
  PagesApiError,
  createPagesService,
  type PagesService,
  type StatementExecutor,
} from '../src/main/pages';
// T64-01 PM 收口：STATEMENTS 真源在 db/statements（main/pages 不转发；CB 测试 import 笔误）
import { STATEMENTS } from '../src/db/statements';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa0001';
const AT = 1_700_000_000_000;

function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `pages-test-${String(seq)}`;
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
    expect(error, `期望 PagesApiError(${code})`).toBeInstanceOf(PagesApiError);
    expect((error as PagesApiError).code).toBe(code);
    return;
  }
  throw new Error(`期望抛错 ${code}，但调用成功`);
}

describeDb('pagesApi（页面树 / 回收站 / 工作区）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let service: PagesService;
  let clock: number;
  let ledgerCount = 0;

  beforeEach(async () => {
    temp = makeTempDb('septcats-pages');
    core = makeCore(ctor, temp.path);
    await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
    clock = AT;
    service = createPagesService({
      executor: coreExecutor(core),
      actor: ACTOR,
      now: () => {
        clock += 1;
        return clock;
      },
      userKey: 'device-user-1',
    });
    ledgerCount = 0;
  });

  afterEach(() => {
    core.dispose();
    temp.cleanup();
  });

  async function opCount(): Promise<number> {
    const data = await requestOk<GetData>(core, {
      id: `ledger-${String(ledgerCount++)}`,
      t: 'get',
      sqlId: 'opLedger.count',
      params: {},
    });
    return (data.row as { n: number } | null)?.n ?? -1;
  }

  async function seedPage(
    id: string,
    sortKey: string,
    workspaceId: string,
    parentId: string | null = null,
  ): Promise<void> {
    await requestOk<RunData>(core, {
      id: `seed-${id}`,
      t: 'run',
      sqlId: 'page.insert',
      params: {
        id,
        workspace_id: workspaceId,
        title: id,
        parent_id: parentId,
        sort_key: sortKey,
        version: 1,
      },
    });
  }

  it('首次运行自动建默认工作区并落活动 id', async () => {
    const result = await service.listWorkspaces();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('个人工作区');
    expect(result.activeId).toBe(result.items[0]?.id);

    // 幂等：再读一次不新建
    const again = await service.listWorkspaces();
    expect(again.items).toHaveLength(1);
    expect(again.activeId).toBe(result.activeId);
  });

  it('createPage：根页与子页的 sort_key 在同层递增；父不存在/已删 → E_PARENT_GONE', async () => {
    const a = await service.createPage({ parentId: null });
    const b = await service.createPage({ parentId: null });
    expect(a.sortKey < b.sortKey).toBe(true);

    const child = await service.createPage({ parentId: a.id });
    const child2 = await service.createPage({ parentId: a.id });
    expect(child.sortKey < child2.sortKey).toBe(true);

    await expectApiError(service.createPage({ parentId: 'ghost' }), 'E_PARENT_GONE');

    await service.deletePage({ id: a.id });
    await expectApiError(service.createPage({ parentId: a.id }), 'E_PARENT_GONE');
  });

  it('listTree：派生 childIds/depth，返回 alive+deleted 全量', async () => {
    const root = await service.createPage({ parentId: null });
    const child = await service.createPage({ parentId: root.id });
    const grand = await service.createPage({ parentId: child.id });

    const workspaces = await service.listWorkspaces();
    const workspaceId = workspaces.activeId;
    expect(workspaceId).not.toBeNull();

    const nodes = await service.listTree({ workspaceId: workspaceId as string });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    expect(byId.get(root.id)?.childIds).toEqual([child.id]);
    expect(byId.get(child.id)?.childIds).toEqual([grand.id]);
    expect(byId.get(root.id)?.depth).toBe(0);
    expect(byId.get(grand.id)?.depth).toBe(2);

    await service.deletePage({ id: grand.id });
    const afterDelete = await service.listTree({ workspaceId: workspaceId as string });
    expect(afterDelete).toHaveLength(3);
    expect(afterDelete.find((node) => node.id === grand.id)?.alive).toBe(0);
  });

  it('renamePage：只改 title，version+1，并落 op_ledger', async () => {
    const page = await service.createPage({ parentId: null });
    const before = await opCount();
    await service.renamePage({ id: page.id, title: '改了标题' });
    expect(await opCount()).toBe(before + 1);

    const workspaces = await service.listWorkspaces();
    const nodes = await service.listTree({ workspaceId: workspaces.activeId as string });
    const node = nodes.find((candidate) => candidate.id === page.id);
    expect(node?.title).toBe('改了标题');
    expect(node?.version).toBe(2);

    await expectApiError(service.renamePage({ id: 'ghost', title: 'x' }), 'E_NOT_FOUND');
  });

  it('movePage：改父 + 定位；防环两条路径都给 E_CYCLE', async () => {
    const root = await service.createPage({ parentId: null });
    const child = await service.createPage({ parentId: root.id });
    const grand = await service.createPage({ parentId: child.id });
    const other = await service.createPage({ parentId: null });

    // 防环（此时链完整：grand ⊂ child ⊂ root）
    await expectApiError(service.movePage({ id: root.id, newParentId: root.id }), 'E_CYCLE');
    await expectApiError(service.movePage({ id: root.id, newParentId: grand.id }), 'E_CYCLE');
    await expectApiError(service.movePage({ id: other.id, newParentId: 'ghost' }), 'E_PARENT_GONE');

    const moved = await service.movePage({ id: child.id, newParentId: other.id });
    expect(moved.rebalanced).toBe(false);
    expect(moved.opCount).toBe(1);

    const workspaces = await service.listWorkspaces();
    const nodes = await service.listTree({ workspaceId: workspaces.activeId as string });
    expect(nodes.find((node) => node.id === child.id)?.parentId).toBe(other.id);
    expect(nodes.find((node) => node.id === grand.id)?.parentId).toBe(child.id);
  });

  it('movePage：placeAfterId 插到中间，sort_key 严格介于邻居之间', async () => {
    const workspaceId = (await service.listWorkspaces()).activeId as string;
    await seedPage('pg-a', 'A00000001', workspaceId);
    await seedPage('pg-b', 'A00000009', workspaceId);
    const moving = await service.createPage({ parentId: null });

    const result = await service.movePage({
      id: moving.id,
      newParentId: null,
      placeAfterId: 'pg-a',
    });
    expect(result.sortKey > 'A00000001').toBe(true);
    expect(result.sortKey < 'A00000009').toBe(true);

    const nodes = await service.listTree({ workspaceId });
    const roots = nodes
      .filter((node) => node.parentId === null)
      .sort((left, right) => (left.sortKey < right.sortKey ? -1 : 1));
    expect(roots.map((node) => node.id)).toEqual(['pg-a', moving.id, 'pg-b']);
  });

  it('movePage：相邻键无空位 → 整层重平衡（rebalanced=true，一批 reorder）', async () => {
    const workspaceId = (await service.listWorkspaces()).activeId as string;
    // 'A' 与 'A0' 之间在 base62 序下不存在任何键 → sortBetween 必失败
    await seedPage('pg-a', 'A', workspaceId);
    await seedPage('pg-b', 'A0', workspaceId);
    const moving = await service.createPage({ parentId: null });

    const result = await service.movePage({
      id: moving.id,
      newParentId: null,
      placeAfterId: 'pg-a',
    });
    expect(result.rebalanced).toBe(true);
    expect(result.opCount).toBeGreaterThan(1);

    const nodes = await service.listTree({ workspaceId });
    const roots = nodes
      .filter((node) => node.parentId === null)
      .sort((left, right) => (left.sortKey < right.sortKey ? -1 : 1));
    expect(roots.map((node) => node.id)).toEqual(['pg-a', moving.id, 'pg-b']);
    const keys = roots.map((node) => node.sortKey);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(3);
  });

  it('deletePage：级联子树（同事务一批 Op）→ listTrash；restore 半链语义', async () => {
    const root = await service.createPage({ parentId: null });
    const child = await service.createPage({ parentId: root.id });
    const grand = await service.createPage({ parentId: child.id });

    const before = await opCount();
    const deleted = await service.deletePage({ id: root.id });
    expect(deleted.deleted).toBe(3);
    expect(await opCount()).toBe(before + 3);

    const trash = await requestOk<AllData>(core, {
      id: 'trash-1',
      t: 'all',
      sqlId: 'page.listTrash',
      params: { workspace_id: (await service.listWorkspaces()).activeId as string },
    });
    expect(trash.rows.map((row) => (row as { id: string }).id).sort()).toEqual([child.id, grand.id, root.id].sort());

    // 父仍死 → 不能单恢复后代
    await expectApiError(service.restorePage({ id: grand.id }), 'E_PARENT_GONE');
    await expectApiError(service.restorePage({ id: child.id }), 'E_PARENT_GONE');

    // 从顶层恢复 = 自身 + 其后代
    const restored = await service.restorePage({ id: root.id });
    expect(restored.restored).toBe(3);
    const trashAfter = await requestOk<AllData>(core, {
      id: 'trash-2',
      t: 'all',
      sqlId: 'page.listTrash',
      params: { workspace_id: (await service.listWorkspaces()).activeId as string },
    });
    expect(trashAfter.rows).toHaveLength(0);
  });

  it('deletePage：连点幂等（已进回收站再删 → { deleted: 0 }）；真不存在 id 仍 E_NOT_FOUND', async () => {
    const page = await service.createPage({ parentId: null });
    const first = await service.deletePage({ id: page.id });
    expect(first.deleted).toBeGreaterThan(0);

    // R29 并发压测（快速连点删除）：第二次删除不得抛 E_NOT_FOUND——幂等收敛为 0 条，
    // 否则 UI 会对一次成功删除弹「页面不存在或已删除」的误报。
    const second = await service.deletePage({ id: page.id });
    expect(second.deleted).toBe(0);

    // 边界不变：真不存在的 id（越界 / 已被 GC 物理清除）保持显式 E_NOT_FOUND
    await expectApiError(service.deletePage({ id: 'ghost' }), 'E_NOT_FOUND');
  });

  it('purgePage：彻底删除后不再出现在回收站，tombstone 仍在 page 表', async () => {
    const page = await service.createPage({ parentId: null });
    await service.deletePage({ id: page.id });
    const workspaceId = (await service.listWorkspaces()).activeId as string;

    const purged = await service.purgePage({ id: page.id });
    expect(purged.purged).toBe(1);

    const trash = await requestOk<AllData>(core, {
      id: 'trash-3',
      t: 'all',
      sqlId: 'page.listTrash',
      params: { workspace_id: workspaceId },
    });
    expect(trash.rows).toHaveLength(0);

    const all = await requestOk<AllData>(core, {
      id: 'all-3',
      t: 'all',
      sqlId: 'page.listAll',
      params: { workspace_id: workspaceId },
    });
    expect(all.rows).toHaveLength(1);
    expect((all.rows[0] as { deleted_at: number }).deleted_at).toBe(0);

    // 存活页不能「彻底删除」
    const alive = await service.createPage({ parentId: null });
    await expectApiError(service.purgePage({ id: alive.id }), 'E_MALFORMED');
  });

  it('收藏 / 最近：本地派生态，最近排除已删页', async () => {
    const first = await service.createPage({ parentId: null });
    const second = await service.createPage({ parentId: null });

    const on = await service.setFavorite({ pageId: first.id, on: true });
    expect(on.pageIds).toEqual([first.id]);
    expect((await service.listFavorites()).pageIds).toEqual([first.id]);
    const off = await service.setFavorite({ pageId: first.id, on: false });
    expect(off.pageIds).toEqual([]);

    await service.touchRecent({ pageId: first.id });
    await service.touchRecent({ pageId: second.id });
    expect((await service.listRecent()).pageIds).toEqual([second.id, first.id]);

    await service.deletePage({ id: second.id });
    expect((await service.listRecent()).pageIds).toEqual([first.id]);
  });

  it('工作区：create / rename / switch；切走后再切回，页面按分片隔离', async () => {
    const alpha = (await service.listWorkspaces()).activeId as string;
    const pageInAlpha = await service.createPage({ parentId: null });

    const created = await service.createWorkspace({ name: '工作 B' });
    await service.renameWorkspace({ id: created.id, name: '工作 B（改名）' });
    const items = (await service.listWorkspaces()).items;
    expect(items.map((item) => item.name)).toContain('工作 B（改名）');

    const switched = await service.switchWorkspace({ id: created.id });
    expect(switched.activeId).toBe(created.id);
    const treeInBeta = await service.listTree({ workspaceId: created.id });
    expect(treeInBeta).toHaveLength(0);

    // 切回 A：页面还在（DbHandle 不变，只是活动 id 变了）
    await service.switchWorkspace({ id: alpha });
    const treeInAlpha = await service.listTree({ workspaceId: alpha });
    expect(treeInAlpha.map((node) => node.id)).toEqual([pageInAlpha.id]);

    await expectApiError(service.switchWorkspace({ id: 'ghost' }), 'E_NOT_FOUND');
    await expectApiError(service.createWorkspace({ name: '   ' }), 'E_MALFORMED');
  });

  it('T64-01 statements enum：page.upsert 接受 page_type=folder、缺省回落 page、野值抛错', () => {
    const validator = STATEMENTS['page.upsert'].params;
    const ok = validator.parse({
      id: 'pg-x',
      workspace_id: 'ws-x',
      sort_key: 'A00000001',
      alive: 1,
      version: 1,
      page_type: 'folder',
    });
    expect(ok.page_type).toBe('folder');

    const def = validator.parse({
      id: 'pg-y',
      workspace_id: 'ws-y',
      sort_key: 'A00000002',
      alive: 1,
      version: 1,
    });
    expect(def.page_type).toBe('page');

    expect(() =>
      validator.parse({
        id: 'pg-z',
        workspace_id: 'ws-z',
        sort_key: 'A00000003',
        alive: 1,
        version: 1,
        page_type: 'spreadsheet',
      }),
    ).toThrow();
  });

  it('T64-01 createFolder：建出 folder 节点（page_type=folder，标题来自调用方）；删文件夹级联子页、恢复级联还原', async () => {
    const folder = await service.createFolder({ parentId: null, title: '资料' });
    const child = await service.createPage({ parentId: folder.id });
    await service.createPage({ parentId: child.id });

    const workspaceId = (await service.listWorkspaces()).activeId as string;
    const nodes = await service.listTree({ workspaceId });
    const folderNode = nodes.find((node) => node.id === folder.id);
    expect(folderNode?.pageType).toBe('folder');
    expect(folderNode?.title).toBe('资料');
    expect(folderNode?.childIds).toEqual([child.id]);

    const before = await opCount();
    const deleted = await service.deletePage({ id: folder.id });
    expect(deleted.deleted).toBe(3);
    expect(await opCount()).toBe(before + 3);

    // 父仍死 → 后代不能单恢复
    await expectApiError(service.restorePage({ id: child.id }), 'E_PARENT_GONE');

    // 从顶层恢复 = 自身 + 全部后代
    const restored = await service.restorePage({ id: folder.id });
    expect(restored.restored).toBe(3);
    const trash = await requestOk<AllData>(core, {
      id: 'trash-folder',
      t: 'all',
      sqlId: 'page.listTrash',
      params: { workspace_id: workspaceId },
    });
    expect(trash.rows).toHaveLength(0);
  });
});
