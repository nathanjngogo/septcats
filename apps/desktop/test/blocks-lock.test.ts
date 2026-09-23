/**
 * blocks-lock.test.ts —— 范围0 读路径接线（TASK-T67-01-B2-01）。
 *
 * 端到端（真实 better-sqlite3）：blocks 服务注入同一个 lock 服务实例后，
 * - 未锁页：`list` 返回 `{ blocks, locked: false }`（零额外形态开销，内容=基线）；
 * - 锁页未解锁：`list` 返回 `{ blocks: [], locked: true }`；
 * - 锁页 verify 后：`list` 返回 `{ blocks, locked: false }`，内容与基线逐块字节一致
 *   （把 B1 真机探针 SKIP 的 L4-b/L4-c 语义升级到测试层）。
 * better-sqlite3 不可用时整组跳过（见 test/helpers.ts）。
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ActorId, Op } from '@septcats/core';
import type { Block } from '@septcats/editor';
import type {
  AllData,
  BatchData,
  GetData,
  MigrateData,
  RunData,
} from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import {
  type BlocksService,
  createBlocksService,
} from '../src/main/blocks';
import { createLockService, LockApiError, type LockService } from '../src/main/lock';
import { createPagesService, type PagesService, type StatementExecutor } from '../src/main/pages';
import { describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const ACTOR: ActorId = 'aaaa0001';
const AT = 1_700_000_000_000;
const WORKSPACE_ID = 'ws-blocks-lock';

function coreExecutor(core: DbServerCore): StatementExecutor {
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `blocks-lock-${String(seq)}`;
  };
  return {
    run: (sqlId, params) => requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params }),
    get: (sqlId, params) => requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params }),
    all: (sqlId, params) => requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params }),
    batch: (stmts) => requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts }),
  };
}

let opSeq = 0;
function makeOp(kind: Op['kind'], blockId: string, payload: Record<string, unknown>, c: number): Op {
  opSeq += 1;
  return {
    op_id: `op-blocks-lock-${String(opSeq).padStart(6, '0')}`,
    lamport: { c, d: ACTOR },
    at: AT,
    actor: ACTOR,
    target: { table: 'block', id: blockId },
    kind,
    payload,
  };
}

function paragraphDoc(text: string): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function blockUpsertOp(blockId: string, pageId: string, text: string, sortKey: string): Op {
  return makeOp('upsert', blockId, {
    page_id: pageId,
    type: 'paragraph',
    props: { tag: `t-${blockId}` },
    content: paragraphDoc(text),
    parent_id: null,
    sort_key: sortKey,
    alive: 1,
    last_edited: AT,
  }, 1);
}

describeDb('blocks:list 读路径接线（锁页）', (ctor) => {
  let temp: TempDb;
  let core: DbServerCore;
  let pages: PagesService;
  let lock: LockService;
  let service: BlocksService;

  beforeEach(async () => {
    temp = makeTempDb('septcats-blocks-lock');
    core = makeCore(ctor, temp.path);
    await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
    pages = createPagesService({ executor: coreExecutor(core), actor: ACTOR, userKey: 'device-user-lock' });
    const listed = await pages.listWorkspaces();
    expect(listed.activeId).not.toBeNull();
    const executor = coreExecutor(core);
    // 同一个 lock 实例注入 blocks（会话共享：verify 解锁后 list 才能出明文）
    lock = createLockService({ executor });
    service = createBlocksService({
      executor,
      actor: ACTOR,
      activeWorkspaceId: async () => {
        const workspaces = await pages.listWorkspaces();
        if (workspaces.activeId === null) {
          throw new Error('无活动工作区');
        }
        return workspaces.activeId;
      },
      lock,
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
      params: { id, workspace_id: WORKSPACE_ID, title: id, parent_id: null, sort_key: sortKey, version: 1 },
    });
  }

  it('未锁页：list 返回 { blocks, locked:false } 且内容=基线', async () => {
    await seedPage('pg-lk-1');
    await service.commit({
      ops: [
        blockUpsertOp('bk-lk-1-b', 'pg-lk-1', '第二块正文', 'B00000001'),
        blockUpsertOp('bk-lk-1-a', 'pg-lk-1', '第一块正文', 'A00000000'),
      ],
    });
    const result = await service.list({ pageId: 'pg-lk-1' });
    expect(result.locked).toBe(false);
    expect(result.blocks.map((b) => b.id)).toEqual(['bk-lk-1-a', 'bk-lk-1-b']);
    expect(result.blocks.map((b) => b.content)).toEqual([
      paragraphDoc('第一块正文'),
      paragraphDoc('第二块正文'),
    ]);
    // getStatus 未锁页口径
    expect(await lock.getStatus('pg-lk-1')).toEqual({ locked: false, failures: 0, lockedUntil: null });
  });

  it('锁页未解锁：list 返回 { blocks:[], locked:true }（正文不透出）', async () => {
    await seedPage('pg-lk-2');
    await service.commit({ ops: [blockUpsertOp('bk-lk-2-a', 'pg-lk-2', '机密正文', 'A00000000')] });
    const pass = 's3cret-pass';
    await lock.setPass('pg-lk-2', pass);

    const locked = await service.list({ pageId: 'pg-lk-2' });
    expect(locked.locked).toBe(true);
    expect(locked.blocks).toEqual([]);

    // 明文块行已被硬删：未接 lock 服务的直读也应拿不到（基线事实，验证逻辑闭环）
    const raw = await lock.readBlocks('pg-lk-2');
    expect(raw.locked).toBe(true);
    expect(raw.blocks).toEqual([]);
  });

  it('verify 后 list 出明文且逐块字节=基线（L4-b/L4-c 升级到测试层）', async () => {
    await seedPage('pg-lk-3');
    await service.commit({
      ops: [
        blockUpsertOp('bk-lk-3-a', 'pg-lk-3', 'α 基线正文', 'A00000000'),
        blockUpsertOp('bk-lk-3-b', 'pg-lk-3', 'β 基线正文', 'B00000001'),
      ],
    });
    const baseline = (await service.list({ pageId: 'pg-lk-3' })).blocks;
    const baselineSig = baseline.map((b: Block) => ({ id: b.id, type: b.type, content: b.content, props: b.props, sort_key: b.sort_key, parent_id: b.parent_id }));

    const pass = 'another-pass';
    const { recoveryCode } = await lock.setPass('pg-lk-3', pass);
    expect(typeof recoveryCode).toBe('string');
    expect(recoveryCode.length).toBeGreaterThan(0);

    // 未解锁：locked
    expect((await service.list({ pageId: 'pg-lk-3' })).locked).toBe(true);

    // 错口令不解锁
    try {
      await lock.verify('pg-lk-3', 'wrong');
      throw new Error('期望 verify 抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(LockApiError);
      expect((error as LockApiError).code).toBe('E_LOCK_BADPASS');
    }
    expect((await service.list({ pageId: 'pg-lk-3' })).locked).toBe(true);

    // 正确口令解锁
    await lock.verify('pg-lk-3', pass);
    const unlocked = await service.list({ pageId: 'pg-lk-3' });
    expect(unlocked.locked).toBe(false);
    expect(unlocked.blocks).toHaveLength(baseline.length);
    const afterSig = unlocked.blocks.map((b: Block) => ({ id: b.id, type: b.type, content: b.content, props: b.props, sort_key: b.sort_key, parent_id: b.parent_id }));
    expect(afterSig).toEqual(baselineSig);
    // 逐块字节级一致
    for (let i = 0; i < baseline.length; i += 1) {
      expect(JSON.stringify(unlocked.blocks[i]?.content)).toBe(JSON.stringify(baseline[i]?.content));
    }
  });

  it('未注入 lock 服务的 blocks:list 仍直读明文（零额外开销路径）', async () => {
    await seedPage('pg-lk-4');
    await service.commit({ ops: [blockUpsertOp('bk-lk-4-a', 'pg-lk-4', 'plain', 'A00000000')] });
    const plain = createBlocksService({
      executor: coreExecutor(core),
      actor: ACTOR,
      activeWorkspaceId: async () => WORKSPACE_ID,
    });
    const result = await plain.list({ pageId: 'pg-lk-4' });
    expect(result.locked).toBe(false);
    expect(result.blocks.map((b) => b.id)).toEqual(['bk-lk-4-a']);
  });
});
