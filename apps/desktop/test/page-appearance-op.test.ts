/**
 * page-appearance-op.test.ts —— 页面外观（图标/封面）**落库层**契约（N1-②）。
 *
 * 为什么必须有这支：N1-② 首发版只测了 renderer 的 store 动作与选择器 UI，**漏了 commit/
 * 物化层**——真机首次运行即报 `E_INVARIANT: 非法 patch op：patch 目前只支持 title`，
 * 图标/封面写不进去（tsc 与 jsdom 全绿也照样不可用）。故本文件用真实 better-sqlite3 把
 * 「op → 白名单语句 → page 行」这条路钉死：
 *   ① 外观 op 落库（icon/cover 真写进 page 行，listTree 读回一致）；
 *   ② null = 清除（两列全量提交口径）；
 *   ③ 改名路径零回归（title 走的仍是 page.rename）；
 *   ④ 两个字段都不给的 patch 一律拒（E_INVARIANT，防白名单被悄悄放宽）。
 * better-sqlite3 不可用时整组跳过（见 test/helpers.ts）。
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ActorId } from '@septcats/core';
import type { AllData, BatchData, GetData, MigrateData, RunData } from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import { createPagesService, type PagesService, type StatementExecutor } from '../src/main/pages';
import { commitOps } from '../src/main/commit';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa0001';
const AT = 1_700_000_000_000;

function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `appearance-op-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
}

describeDb('页面外观 op（图标/封面落库）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let service: PagesService;
  let clock: number;

  beforeEach(async () => {
    temp = makeTempDb('septcats-page-appearance');
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
  });

  afterEach(() => {
    core.dispose();
    temp.cleanup();
  });

  it('外观 op 真写进 page 行（listTree 读回一致）', async () => {
    const workspaces = await service.listWorkspaces();
    const workspaceId = workspaces.activeId as string;
    const created = await service.createPage({ parentId: null });

    await service.setPageAppearance({ id: created.id, icon: '📄', cover: 'aurora' });

    const tree = await service.listTree({ workspaceId });
    const node = tree.find((n) => n.id === created.id);
    expect(node?.icon, 'icon 落库').toBe('📄');
    expect(node?.cover, 'cover 落库').toBe('aurora');
  });

  it('null = 清除（两列全量提交口径）', async () => {
    const workspaces = await service.listWorkspaces();
    const workspaceId = workspaces.activeId as string;
    const created = await service.createPage({ parentId: null });

    await service.setPageAppearance({ id: created.id, icon: '🐴', cover: 'forest' });
    await service.setPageAppearance({ id: created.id, icon: null, cover: null });

    const tree = await service.listTree({ workspaceId });
    const node = tree.find((n) => n.id === created.id);
    expect(node?.icon).toBeNull();
    expect(node?.cover).toBeNull();
  });

  it('改名路径零回归（title 仍走 page.rename，且不吃掉外观）', async () => {
    const workspaces = await service.listWorkspaces();
    const workspaceId = workspaces.activeId as string;
    const created = await service.createPage({ parentId: null });

    await service.setPageAppearance({ id: created.id, icon: '📌', cover: 'mint' });
    await service.renamePage({ id: created.id, title: '改过名的页' });

    const tree = await service.listTree({ workspaceId });
    const node = tree.find((n) => n.id === created.id);
    expect(node?.title).toBe('改过名的页');
    expect(node?.icon, '改名不动 icon').toBe('📌');
    expect(node?.cover, '改名不动 cover').toBe('mint');
  });

  it('patch 既无 title 也无 icon/cover → E_INVARIANT（防白名单被悄悄放宽）', async () => {
    const workspaces = await service.listWorkspaces();
    const workspaceId = workspaces.activeId as string;
    const created = await service.createPage({ parentId: null });
    const executor = coreExecutor(core);
    await expect(
      commitOps(
        executor,
        [
          {
            op_id: 'bad-patch-1',
            lamport: { c: 99, d: ACTOR },
            at: AT,
            actor: ACTOR,
            target: { table: 'page', id: created.id },
            kind: 'patch',
            payload: { sort_key: 'zzz' },
            base: 1,
          },
        ],
        { workspaceId },
      ),
    ).rejects.toThrow(/patch/);
  });
});