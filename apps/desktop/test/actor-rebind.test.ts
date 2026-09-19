/**
 * actor-rebind.test.ts —— TASK-T28-01（P0）：blocks:commit 写入前的 op 设备身份权威改写。
 *
 * 背景（QA 巡检 Q-1）：渲染层 EditSession 产出的 op 携带占位 actor（修前是硬编码
 * `desktop0001`），与本机真实 actor 不一致 → 攒段器 flush 自校验抛 SegmentValidationError
 * （「非法段：第 N 个 op 的设备 X 与段头 dev=Y 不符」）→ 同步轮失败并保持错误态、
 * pendingOps 稳定不降。修法：设备身份唯一真源在 main——blocks service 写入前把每个
 * op 的 actor/lamport.d 权威改写为本机真实 actor（rebindOpActor，只动这两个字段）。
 *
 * 覆盖：
 * 1. 主修单测：错误 actor 的 op 提交后，ledger op_json 的 actor/lamport.d = 本机真实
 *    actor，其余字段逐字段不变；输入 op 不被原地改写；幂等（已是真实 actor 的 op
 *    重复提交，op_json 字节等价）。
 * 2. 回归测试（修前红）：渲染层 op 不经改写直进攒段器 → runCycle 后 state='error'、
 *    errors 含 E_SYNC_CYCLE_FAILED/非法段、pendingOps 稳定不降（复跑仍 error）。
 * 3. 回归测试（修后绿）：同一批错误 actor 的 op 经 blocks service（rebindOpActor）→
 *    段发布成功、段头 dev=本机真实 actor；runCycle 后 state='ok'、pendingOps=0、
 *    errors 空；op_id 去重不回归（重复提交不重复入账）。
 *
 * DB 用内存假账本（与 sync-runtime.test.ts 同款 MemoryLedger），纯 Node 可跑。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeOp, encodeOp, decodeSegment, type ActorId, type Op } from '@septcats/core';
import type { CredentialStore } from '@septcats/platform';
import type { AllData, BatchData, DbBatchStatement, GetData, RunData } from '../src/db/rpc';
import { createBlocksService } from '../src/main/blocks';
import { withSyncHook } from '../src/main/sync/bridge';
import { SyncKeyring } from '../src/main/sync/keyring';
import { SyncRuntime } from '../src/main/sync/runtime';

// ---------------------------------------------------------------------------
// 本机真实 actor 与渲染层占位 actor（修前 PageView 硬编码同款）
// ---------------------------------------------------------------------------

const REAL: ActorId = 'aaaa0001';
const RENDERER: ActorId = 'desktop0001';

// ---------------------------------------------------------------------------
// 内存假账本（batch 只吃 opLedger.insert；all/get 支撑 runtime 读路径）
// ---------------------------------------------------------------------------

class MemoryLedger {
  readonly ops = new Map<string, Op>();
  /** T31-01：op_id → seg_id 标记（null = 未标记已发布）。 */
  readonly segIds = new Map<string, string | null>();

  async batch(stmts: readonly DbBatchStatement[]): Promise<BatchData> {
    const results = stmts.map((stmt) => {
      if (stmt.sqlId === 'opLedger.insert') {
        const p = stmt.params as { op_json: string };
        const op = decodeOp(p.op_json);
        if (!this.ops.has(op.op_id)) {
          this.ops.set(op.op_id, op);
          this.segIds.set(op.op_id, null);
        }
      }
      if (stmt.sqlId === 'opLedger.markSeg') {
        const p = stmt.params as { op_id: string; seg_id: string };
        if (this.segIds.get(p.op_id) === null) {
          this.segIds.set(p.op_id, p.seg_id);
        }
      }
      return { sqlId: stmt.sqlId, data: { changes: 1, lastInsertRowid: 1 } };
    });
    return { results };
  }

  async all(sqlId: string, _params?: unknown): Promise<AllData> {
    if (sqlId === 'opLedger.listAll') {
      return { rows: [...this.ops.values()].map((op) => ({ op_json: encodeOp(op) })) };
    }
    if (sqlId === 'opLedger.listUnpublished') {
      const rows = [...this.ops.values()]
        .filter((op) => this.segIds.get(op.op_id) === null)
        .map((op) => ({ op_json: encodeOp(op) }));
      return { rows };
    }
    throw new Error(`unexpected all(${sqlId})`);
  }

  async get(sqlId: string, _params?: unknown): Promise<GetData> {
    if (sqlId === 'opLedger.count') {
      return { row: { n: this.ops.size } };
    }
    if (sqlId === 'opLedger.maxLamport') {
      let max = 0;
      for (const op of this.ops.values()) {
        max = Math.max(max, op.lamport.c);
      }
      return { row: { c: max } };
    }
    throw new Error(`unexpected get(${sqlId})`);
  }
}

function fakeStore(): CredentialStore {
  return {
    async get(): Promise<string | null> {
      return null;
    },
    async set(): Promise<void> {
      return undefined;
    },
    async delete(): Promise<boolean> {
      return true;
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

let clockC = 0;

/** 模拟 EditSession 产出的 block upsert op（携带指定 actor = 渲染层占位值）。 */
function blockUpsertOp(dev: ActorId, blockId: string): Op {
  clockC += 1;
  return {
    op_id: `op-${blockId}-${String(clockC).padStart(6, '0')}`,
    lamport: { c: clockC, d: dev },
    at: 1_700_000_000_000 + clockC,
    actor: dev,
    target: { table: 'block', id: blockId },
    kind: 'upsert',
    payload: {
      page_id: 'pg-actor',
      type: 'paragraph',
      props: {},
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `内容-${blockId}` }] }] },
      parent_id: null,
      sort_key: `A${String(clockC).padStart(9, '0')}`,
      alive: 1,
      last_edited: 1_700_000_000_000 + clockC,
    },
  };
}

// ---------------------------------------------------------------------------
// 栈组装（与 main/index.ts 同构：blocks service → withSyncHook → SyncRuntime）
// ---------------------------------------------------------------------------

interface Stack {
  ledger: MemoryLedger;
  runtime: SyncRuntime;
  /** blocks service 的 executor（带 hook）；不经 service 的裸 batch = 修前路径。 */
  hooked: {
    run(sqlId: string, params?: unknown): Promise<RunData>;
    get(sqlId: string, params?: unknown): Promise<GetData>;
    all(sqlId: string, params?: unknown): Promise<AllData>;
    batch(stmts: readonly DbBatchStatement[]): Promise<BatchData>;
  };
}

function makeStack(syncDir: string): Stack {
  const ledger = new MemoryLedger();
  const runtime = new SyncRuntime({
    rootDir: syncDir,
    db: ledger,
    actor: REAL,
    workspaceId: 'ws-actor-test',
    clientVer: '0.0.0',
    keyring: new SyncKeyring(fakeStore()),
    encryptEnabled: () => false,
    gcEnabled: () => false,
  });
  const hooked = withSyncHook(
    {
      run: async () => ({ changes: 1, lastInsertRowid: 1 }) as RunData,
      get: async (sqlId, params) => ledger.get(sqlId, params),
      all: async (sqlId, params) => ledger.all(sqlId, params),
      batch: async (stmts) => ledger.batch(stmts),
    },
    (committed) => runtime.onLocalCommit(committed),
  );
  return { ledger, runtime, hooked };
}

let dirs: string[] = [];
const stacks: SyncRuntime[] = [];

beforeEach(() => {
  clockC = 0;
});

afterEach(() => {
  for (const runtime of stacks) {
    runtime.stop();
  }
  stacks.length = 0;
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs = [];
});

function tempSyncDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'septcats-actor-rebind-'));
  dirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// 1. 主修单测（rebindOpActor 经 blocks service 生效）
// ---------------------------------------------------------------------------

describe('blocks:commit 写入前 actor 权威改写（TASK-T28-01 主修）', () => {
  it('错误 actor 的 op：actor/lamport.d 改写为本机真实 actor，其余字段逐字段不变，输入不被原地改写', async () => {
    const batches: DbBatchStatement[][] = [];
    const service = createBlocksService({
      executor: {
        run: async () => ({ changes: 0, lastInsertRowid: 0 }) as RunData,
        get: async () => ({ row: null }) as GetData,
        all: async () => ({ rows: [] }) as AllData,
        batch: async (stmts) => {
          batches.push([...stmts]);
          return { results: [] } as BatchData;
        },
      },
      actor: REAL,
      activeWorkspaceId: async () => 'ws-1',
    });

    const op = blockUpsertOp(RENDERER, 'bk-rebind-1');
    await service.commit({ ops: [op] });

    expect(batches).toHaveLength(1);
    const ledgerStmt = batches[0]?.[0];
    expect(ledgerStmt?.sqlId).toBe('opLedger.insert');
    const stored = decodeOp((ledgerStmt?.params as { op_json: string }).op_json);

    // 设备身份被权威改写
    expect(stored.actor).toBe(REAL);
    expect(stored.lamport.d).toBe(REAL);
    // 其余字段逐字段不变
    expect(stored.op_id).toBe(op.op_id);
    expect(stored.lamport.c).toBe(op.lamport.c);
    expect(stored.at).toBe(op.at);
    expect(stored.target).toEqual(op.target);
    expect(stored.kind).toBe(op.kind);
    expect(stored.payload).toEqual(op.payload);
    // 输入 op 未被原地改写（渲染层对象不受影响）
    expect(op.actor).toBe(RENDERER);
    expect(op.lamport.d).toBe(RENDERER);
  });

  it('幂等：已是本机 actor 的 op 重复提交，op_json 字节等价（op_id 去重前提不变）', async () => {
    const batches: DbBatchStatement[][] = [];
    const service = createBlocksService({
      executor: {
        run: async () => ({ changes: 0, lastInsertRowid: 0 }) as RunData,
        get: async () => ({ row: null }) as GetData,
        all: async () => ({ rows: [] }) as AllData,
        batch: async (stmts) => {
          batches.push([...stmts]);
          return { results: [] } as BatchData;
        },
      },
      actor: REAL,
      activeWorkspaceId: async () => 'ws-1',
    });

    const op = blockUpsertOp(RENDERER, 'bk-rebind-2');
    await service.commit({ ops: [op] }); // 第一次：占位 actor → 改写
    await service.commit({ ops: [op] }); // 第二次：已是真实 actor → 原样
    const first = (batches[0]?.[0]?.params as { op_json: string }).op_json;
    const second = (batches[1]?.[0]?.params as { op_json: string }).op_json;
    expect(second).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// 2/3. 回归测试：修前红 → 修后绿（真同步轮）
// ---------------------------------------------------------------------------

describe('同步轮回归（修前红 → 修后绿）', () => {
  it('修前红：渲染层错误 actor 的 op 直进攒段器 → 同步轮 error（非法段）、pendingOps 稳定不降', async () => {
    const syncDir = tempSyncDir();
    const stack = makeStack(syncDir);
    stacks.push(stack.runtime);
    await stack.runtime.start();
    expect(stack.runtime.getStatus().state).toBe('ok');

    // 修前路径：blocks service 原样透传（无 rebind）→ 错误 actor 的 op 进账本与攒段器
    const ops = [1, 2, 3].map((i) => blockUpsertOp(RENDERER, `bk-red-${String(i)}`));
    await stack.hooked.batch(ops.map((op) => ({ sqlId: 'opLedger.insert', params: { op_json: encodeOp(op) } })));

    await stack.runtime.runCycle();
    const status = stack.runtime.getStatus();
    expect(status.state).toBe('error');
    const cycleError = status.errors.find(
      (entry) => entry.code === 'E_SYNC_CYCLE_FAILED' && entry.message.includes('非法段'),
    );
    expect(cycleError).toBeDefined();
    expect(cycleError?.message).toContain(`设备 ${RENDERER} 与段头 dev=${REAL} 不符`);
    // 症状复现：pendingOps 稳定不降
    expect(status.pendingOps).toBe(ops.length);

    // 复跑一轮仍是 error（不再恢复）——与真机症状一致
    await stack.runtime.runCycle();
    expect(stack.runtime.getStatus().state).toBe('error');
  });

  it('修后绿：同一批错误 actor 的 op 经 blocks service → 段 dev=本机真实 actor，同步轮 ok、pendingOps 归 0', async () => {
    const syncDir = tempSyncDir();
    const stack = makeStack(syncDir);
    stacks.push(stack.runtime);
    await stack.runtime.start();
    expect(stack.runtime.getStatus().state).toBe('ok');

    const service = createBlocksService({
      executor: stack.hooked,
      actor: REAL,
      activeWorkspaceId: async () => 'ws-actor-test',
    });

    // 渲染层（EditSession 占位 actor）产出的 op，经 blocks:commit 提交
    const ops = [1, 2, 3].map((i) => blockUpsertOp(RENDERER, `bk-green-${String(i)}`));
    await service.commit({ ops });

    // 账本：actor/lamport.d 已全部改写为本机真实 actor
    const ledgerOps = [...stack.ledger.ops.values()];
    expect(ledgerOps).toHaveLength(ops.length);
    for (const op of ledgerOps) {
      expect(op.actor).toBe(REAL);
      expect(op.lamport.d).toBe(REAL);
    }

    // 攒段发布 + 同步轮：段可发布（自校验通过），状态回到 ok
    await stack.runtime.flushAndPublish();
    await stack.runtime.runCycle();
    const status = stack.runtime.getStatus();
    expect(status.state).toBe('ok');
    expect(status.errors).toEqual([]);
    expect(status.pendingOps).toBe(0);

    // 段文件：段头 dev = 本机真实 actor，段内 op 全部一致
    const segNames = readdirSync(syncDir).filter((n) => n.startsWith('seg-'));
    expect(segNames.length).toBeGreaterThan(0);
    for (const name of segNames) {
      const seg = decodeSegment(readFileSync(join(syncDir, name), 'utf8'));
      expect(seg.header.dev).toBe(REAL);
      for (const op of seg.ops) {
        expect(op.lamport.d).toBe(REAL);
        expect(op.actor).toBe(REAL);
      }
    }
  });

  it('op_id 去重不回归：同一 op 重复提交（actor 已被改写）不重复入账', async () => {
    const syncDir = tempSyncDir();
    const stack = makeStack(syncDir);
    stacks.push(stack.runtime);
    await stack.runtime.start();

    const service = createBlocksService({
      executor: stack.hooked,
      actor: REAL,
      activeWorkspaceId: async () => 'ws-actor-test',
    });
    const op = blockUpsertOp(RENDERER, 'bk-dedup-1');
    await service.commit({ ops: [op] });
    await service.commit({ ops: [op] });
    expect(stack.ledger.ops.size).toBe(1);
  });
});
