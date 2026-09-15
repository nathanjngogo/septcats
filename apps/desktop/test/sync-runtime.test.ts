/**
 * sync-runtime.test.ts —— SyncRuntime 双实例集成（TASK-T13-01 §4）。
 *
 * 场景（同一 temp sync 目录，两个独立内存账本 + 各自 actor）：
 *   A. 建 5 页 → B 追平投影逐 op 相等；发布文件名符合 naming；
 *   B. 并发改同块 → 收敛同值 + conflict 报告各 1；
 *   C. 副本注入（seg (1).jsonl）→ 去重不重复入账；
 *   D. 断链 → degraded + 本地写入照常；恢复 → 追平；
 *   E. 崩溃恢复：半截段隔离、重启自愈不再重试；
 *   F. S5：新设备只有 snapshot+段（含 patch 折叠）→ 追平投影相等；
 *   G. 桥装饰器语义；H. setEnabled 假时钟轮询；I. 加密 E2E 与 E_SYNC_KEY_MISMATCH 红条。
 *
 * DB 用假 SyncDbAdapter（内存账本），纯 Node 可跑；实体物化正确性归 db 层测试。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeOp,
  encodeOp,
  opsToSnapshot,
  replay,
  type ActorId,
  type Op,
  type Segment,
} from '@septcats/core';
import { parseSegmentFileName } from '@septcats/sync';
import type { CredentialStore } from '@septcats/platform';
import type { AllData, BatchData, DbBatchStatement, GetData } from '../src/db/rpc';
import { withSyncHook } from '../src/main/sync/bridge';
import { encodeDek, generateDek } from '../src/main/sync/crypto';
import { SyncKeyring } from '../src/main/sync/keyring';
import { SyncRuntime } from '../src/main/sync/runtime';

// ---------------------------------------------------------------------------
// 假 DB：内存账本（batch 只吃 opLedger.insert；all/get 支撑 runtime 读路径）
// ---------------------------------------------------------------------------

class MemoryLedger {
  readonly ops = new Map<string, Op>();
  rebuildCount = 0;

  async batch(stmts: readonly DbBatchStatement[]): Promise<BatchData> {
    const results = stmts.map((stmt) => {
      if (stmt.sqlId === 'opLedger.insert') {
        const p = stmt.params as { op_json: string };
        const op = decodeOp(p.op_json);
        if (!this.ops.has(op.op_id)) {
          this.ops.set(op.op_id, op);
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

  async rebuildFromSegments(segmentsJson: string): Promise<{ segments: number; ops: number; entities: number }> {
    this.rebuildCount += 1;
    const segs = JSON.parse(segmentsJson) as Segment[];
    this.ops.clear();
    for (const seg of segs) {
      for (const op of seg.ops) {
        this.ops.set(op.op_id, op);
      }
    }
    return { segments: segs.length, ops: this.ops.size, entities: this.ops.size };
  }

  /** 投影稳定快照（收敛断言用，与 server.exportSnapshot 同口径）。 */
  projection(): string {
    return opsToSnapshot(replay([...this.ops.values()]).projection);
  }
}

/** 内存假凭据 store（DEK 预置；空 = 未设置）。 */
function fakeStore(dek: Uint8Array | null): CredentialStore {
  return {
    async get(): Promise<string | null> {
      return dek === null ? null : encodeDek(dek);
    },
    async set(): Promise<void> {},
    async delete(): Promise<boolean> {
      return true;
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

interface MakeRuntimeOptions {
  syncDir: string;
  actor: ActorId;
  dek?: Uint8Array | null;
  encrypt?: boolean;
  maxKeepSegs?: number;
  mergeIntervalMs?: number;
}

interface RuntimeHandle {
  ledger: MemoryLedger;
  runtime: SyncRuntime;
}

function makeRuntime(options: MakeRuntimeOptions): RuntimeHandle {
  const ledger = new MemoryLedger();
  const runtime = new SyncRuntime({
    rootDir: options.syncDir,
    db: ledger,
    actor: options.actor,
    workspaceId: `ws-${options.actor}`,
    clientVer: '0.1.0',
    keyring: new SyncKeyring(fakeStore(options.dek ?? null)),
    encryptEnabled: () => options.encrypt === true,
    gcEnabled: () => false,
    idleFlushMs: 15_000,
    mergeIntervalMs: options.mergeIntervalMs ?? 60_000,
    watchDebounceMs: 2_000,
    ...(options.maxKeepSegs === undefined ? {} : { maxKeepSegs: options.maxKeepSegs }),
  });
  return { ledger, runtime };
}

/** 桥接线（与 main/index.ts 同构）：batch 成功 → onCommitted → 攒段器。 */
function commit(handle: RuntimeHandle, ops: readonly Op[]): Promise<BatchData> {
  const ledger = handle.ledger;
  const hooked = withSyncHook(
    {
      run: async () => ({ changes: 1, lastInsertRowid: 1 }),
      get: async (sqlId, params) => ledger.get(sqlId, params),
      all: async (sqlId, params) => ledger.all(sqlId, params),
      batch: async (stmts) => ledger.batch(stmts),
    },
    (committed) => handle.runtime.onLocalCommit(committed),
  );
  return hooked.batch(ops.map((op) => ({ sqlId: 'opLedger.insert', params: { op_json: encodeOp(op) } })));
}

let clockC = 0;

function upsertOp(dev: ActorId, pageId: string, title: string, c?: number): Op {
  clockC += 1;
  return {
    op_id: `op-${dev}-${pageId}-${String(clockC).padStart(6, '0')}`,
    lamport: { c: c ?? clockC, d: dev },
    at: 1_700_000_000_000 + clockC,
    actor: dev,
    target: { table: 'page', id: pageId },
    kind: 'upsert',
    payload: { title, sort_key: `A${String(clockC).padStart(9, '0')}`, alive: 1 },
  };
}

function patchOp(dev: ActorId, pageId: string, title: string, c: number): Op {
  return {
    op_id: `op-${dev}-${pageId}-patch-${String(c).padStart(6, '0')}`,
    lamport: { c, d: dev },
    at: 1_700_000_000_000 + c,
    actor: dev,
    target: { table: 'page', id: pageId },
    kind: 'patch',
    payload: { title },
    base: c - 1,
  };
}

let dirs: string[] = [];
beforeEach(() => {
  clockC = 0;
});
afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs = [];
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// 场景测试
// ---------------------------------------------------------------------------

describe('sync/runtime 双实例集成', () => {
  it('A：A 建 5 页 → B 追平投影相等；发布文件名符合 naming', async () => {
    const syncDir = tempDir('septcats-sync-basic-');
    const a = makeRuntime({ syncDir, actor: 'aaaa0001' });
    const b = makeRuntime({ syncDir, actor: 'bbbb0002' });
    await a.runtime.start();
    await b.runtime.start();

    const pages = ['页一', '页二', '页三', '页四', '页五'].map((title, i) =>
      upsertOp('aaaa0001', `pg-${String(i)}`, title),
    );
    await commit(a, pages);
    await a.runtime.flushAndPublish();

    const segNames = readdirSync(syncDir).filter((n) => n.startsWith('seg-'));
    expect(segNames.length).toBeGreaterThan(0);
    for (const name of segNames) {
      expect(parseSegmentFileName(name)).not.toBeNull();
    }

    await b.runtime.runCycle();
    expect(b.ledger.ops.size).toBe(5);
    expect(b.ledger.projection()).toBe(a.ledger.projection());

    const status = b.runtime.getStatus();
    expect(status.state).toBe('ok');
    expect(status.lastSyncAt).not.toBeNull();
    expect(status.devices.map((d) => d.actorId).sort()).toEqual(['aaaa0001', 'bbbb0002']);
    expect(status.pendingOps).toBe(0);

    a.runtime.stop();
    b.runtime.stop();
  });

  it('B：并发改同块 → 收敛同值 + conflict 报告各 ≥1', async () => {
    const syncDir = tempDir('septcats-sync-conflict-');
    const a = makeRuntime({ syncDir, actor: 'aaaa0001' });
    const b = makeRuntime({ syncDir, actor: 'bbbb0002' });
    await a.runtime.start();
    await b.runtime.start();

    // 公共底稿
    await commit(a, [upsertOp('aaaa0001', 'pg-x', '底稿', 1)]);
    await a.runtime.flushAndPublish();
    await b.runtime.runCycle();
    expect(b.ledger.ops.size).toBe(1);

    // 并发改同块：同 c=2、不同设备（真 LWW 冲突）
    await commit(a, [{ ...upsertOp('aaaa0001', 'pg-x', 'A 的标题', 2), kind: 'patch', payload: { title: 'A 的标题' }, base: 1 }]);
    await commit(b, [{ ...upsertOp('bbbb0002', 'pg-x', 'B 的标题', 2), kind: 'patch', payload: { title: 'B 的标题' }, base: 1 }]);
    await a.runtime.flushAndPublish();
    await b.runtime.flushAndPublish();

    await b.runtime.runCycle();
    await a.runtime.runCycle();

    expect(a.ledger.projection()).toBe(b.ledger.projection());
    const entity = replay([...a.ledger.ops.values()]).projection.entities()[0];
    expect((entity?.data as { title?: string }).title).toBe('B 的标题'); // d 大者胜（同 c 比设备字典序）
    expect(a.runtime.getLastReport()?.conflicts.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(b.runtime.getLastReport()?.conflicts.length ?? 0).toBeGreaterThanOrEqual(1);

    a.runtime.stop();
    b.runtime.stop();
  });

  it('C：副本注入（seg (1).jsonl）→ 去重，不重复入账', async () => {
    const syncDir = tempDir('septcats-sync-dup-');
    const a = makeRuntime({ syncDir, actor: 'aaaa0001' });
    await a.runtime.start();
    await commit(a, [1, 2, 3].map((i) => upsertOp('aaaa0001', `pg-${String(i)}`, `页${String(i)}`)));
    await a.runtime.flushAndPublish();
    a.runtime.stop();

    // 手工注入网盘冲突副本
    const segName = readdirSync(syncDir).find((n) => n.startsWith('seg-'));
    expect(segName).toBeDefined();
    const dot = segName!.lastIndexOf('.jsonl');
    const copyName = `${segName!.slice(0, dot)} (1).jsonl`;
    writeFileSync(join(syncDir, copyName), readFileSync(join(syncDir, segName!), 'utf8'), 'utf8');

    const b = makeRuntime({ syncDir, actor: 'bbbb0002' });
    await b.runtime.start();
    expect(b.ledger.ops.size).toBe(3);
    const report = b.runtime.getLastReport();
    expect(report?.skipped.some((s) => s.file === copyName && s.reason === 'duplicate')).toBe(true);
    b.runtime.stop();
  });

  it('D：断链 → degraded + 本地写入照常；恢复 → 追平', async () => {
    const parent = tempDir('septcats-sync-link-');
    const syncDir = join(parent, 'sync');
    mkdirSync(syncDir, { recursive: true });
    const a = makeRuntime({ syncDir, actor: 'aaaa0001' });
    const b = makeRuntime({ syncDir, actor: 'bbbb0002' });
    await a.runtime.start();
    await b.runtime.start();

    // 断链：把整个 sync 目录移走
    renameSync(syncDir, `${syncDir}.away`);
    await b.runtime.runCycle();
    expect(b.runtime.getStatus().state).toBe('degraded');
    expect(b.runtime.getStatus().errors.some((e) => e.code === 'E_SYNC_DIR_UNAVAILABLE')).toBe(true);

    // 断链期间 A 本地写入照常（发布失败进重试暂存，不丢）
    await commit(a, [upsertOp('aaaa0001', 'pg-offline', '断链期间的页')]);
    await a.runtime.flushAndPublish();
    expect(a.runtime.getStatus().pendingSegs).toBe(1);

    // 恢复：目录移回 → 下轮追平
    renameSync(`${syncDir}.away`, syncDir);
    await a.runtime.runCycle();
    expect(a.runtime.getStatus().pendingSegs).toBe(0);
    await b.runtime.runCycle();
    expect(b.runtime.getStatus().state).toBe('ok');
    expect(b.ledger.ops.size).toBe(1);
    expect(b.ledger.projection()).toBe(a.ledger.projection());

    a.runtime.stop();
    b.runtime.stop();
  });

  it('E：崩溃恢复：半截段隔离，重启自愈且不再重试该文件', async () => {
    const syncDir = tempDir('septcats-sync-crash-');
    const a = makeRuntime({ syncDir, actor: 'aaaa0001' });
    await a.runtime.start();
    await commit(a, [upsertOp('aaaa0001', 'pg-1', '半截'), upsertOp('aaaa0001', 'pg-2', '完好')]);
    await a.runtime.flushAndPublish();
    a.runtime.stop();

    // 写段中途 kill：只留两个段之一……直接把好段截半（模拟半截）
    const segName = readdirSync(syncDir).find((n) => n.startsWith('seg-'))!;
    const raw = readFileSync(join(syncDir, segName), 'utf8');
    writeFileSync(join(syncDir, segName), raw.slice(0, Math.floor(raw.length / 2)), 'utf8');

    // 重启：坏段隔离；其余（本例中另一段已不存在——半截是唯一段，账本为空）
    const b = makeRuntime({ syncDir, actor: 'bbbb0002' });
    await b.runtime.start();
    expect(b.runtime.getLastReport()?.quarantined.some((q) => q.file === segName)).toBe(true);
    expect(existsSync(join(syncDir, segName))).toBe(false);
    expect(existsSync(join(syncDir, 'quarantine', segName))).toBe(true);
    expect(b.ledger.ops.size).toBe(0);

    // 不再重试：再跑一轮无新的 quarantined
    await b.runtime.runCycle();
    expect(b.runtime.getLastReport()?.quarantined.length ?? 0).toBe(0);
    b.runtime.stop();
  });

  it('F：S5 新设备只有 snapshot+段 → 追平后投影与源设备相等（patch 折叠无漂移）', async () => {
    const syncDir = tempDir('septcats-sync-seed-');
    const a = makeRuntime({ syncDir, actor: 'aaaa0001', maxKeepSegs: 1 });
    await a.runtime.start();
    // seg1：upsert(c1) + patch(c2)（实体 pg-1 终态 lamport=2）
    await commit(a, [upsertOp('aaaa0001', 'pg-1', '初始', 1), patchOp('aaaa0001', 'pg-1', '改名', 2)]);
    await a.runtime.flushAndPublish();
    // seg2：两张新页
    await commit(a, [upsertOp('aaaa0001', 'pg-2', '页二', 3), upsertOp('aaaa0001', 'pg-3', '页三', 4)]);
    await a.runtime.flushAndPublish();
    // 段数 2 > maxKeep 1 → 折叠 seg1 出快照
    await a.runtime.runCycle();
    expect(readdirSync(syncDir).filter((n) => n.startsWith('snapshot-')).length).toBe(1);
    a.runtime.stop();

    // 新设备 B：账本空 → 快照播种 + 增量段 → 投影 == A
    const b = makeRuntime({ syncDir, actor: 'bbbb0002' });
    await b.runtime.start();
    expect(b.ledger.projection()).toBe(a.ledger.projection());
    const titles = replay([...b.ledger.ops.values()]).projection
      .entities()
      .map((e) => (e.data as { title?: string }).title)
      .sort();
    // .sort() 为码点序：'三' (U+4E09) < '二' (U+4E8C)
    expect(titles).toEqual(['改名', '页三', '页二']);
    b.runtime.stop();
  });

  it('G：桥装饰器：成功才回调、非 ledger 语句不触发、失败不触发', async () => {
    const ledger = new MemoryLedger();
    const committed: Op[][] = [];
    const makeExecutor = (impl: {
      batch(stmts: readonly DbBatchStatement[]): Promise<BatchData>;
    }) => ({
      run: async (): Promise<{ changes: number; lastInsertRowid: number }> => ({ changes: 1, lastInsertRowid: 1 }),
      get: async (): Promise<GetData> => ({ row: null }),
      all: async (): Promise<AllData> => ({ rows: [] }),
      batch: impl.batch,
    });
    const op = upsertOp('aaaa0001', 'pg-1', 'x', 1);

    const hooked = withSyncHook(makeExecutor({ batch: (stmts) => ledger.batch(stmts) }), (ops) => {
      committed.push([...ops]);
    });
    await hooked.batch([{ sqlId: 'page.upsert', params: {} }]);
    expect(committed.length).toBe(0);

    const failing = withSyncHook(
      makeExecutor({
        batch: async () => {
          throw new Error('E_DB_DOWN');
        },
      }),
      (ops) => {
        committed.push([...ops]);
      },
    );
    await expect(failing.batch([{ sqlId: 'opLedger.insert', params: { op_json: encodeOp(op) } }])).rejects.toThrow(
      'E_DB_DOWN',
    );
    expect(committed.length).toBe(0);

    await hooked.batch([{ sqlId: 'opLedger.insert', params: { op_json: encodeOp(op) } }]);
    expect(committed.length).toBe(1);
    expect(committed[0]?.[0]?.op_id).toBe(op.op_id);
  });

  it('H：setEnabled(false) 后假时钟不再触发轮询；状态 idle；重开立即一轮', async () => {
    vi.useFakeTimers();
    try {
      const syncDir = tempDir('septcats-sync-toggle-');
      const a = makeRuntime({ syncDir, actor: 'aaaa0001' });
      await a.runtime.start();
      expect(a.runtime.getStatus().state).toBe('ok');

      await a.runtime.setEnabled(false);
      expect(a.runtime.getStatus().state).toBe('idle');
      const before = a.runtime.getStatus().lastSyncAt;

      vi.advanceTimersByTime(600_000);
      expect(a.runtime.getStatus().lastSyncAt).toBe(before);

      await a.runtime.setEnabled(true);
      expect(a.runtime.getStatus().state).toBe('ok');
      expect(a.runtime.getStatus().lastSyncAt).not.toBe(before);
      a.runtime.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('I：加密 E2E：双端同 DEK，A 发 .enc 段 B 能收', async () => {
    const syncDir = tempDir('septcats-sync-enc-');
    const dek = generateDek();
    const a = makeRuntime({ syncDir, actor: 'aaaa0001', dek, encrypt: true });
    const b = makeRuntime({ syncDir, actor: 'bbbb0002', dek, encrypt: true });
    await a.runtime.start();
    await b.runtime.start();

    await commit(a, [upsertOp('aaaa0001', 'pg-enc', '加密页')]);
    await a.runtime.flushAndPublish();
    expect(readdirSync(syncDir).some((n) => n.endsWith('.jsonl.enc'))).toBe(true);

    await b.runtime.runCycle();
    expect(b.ledger.ops.size).toBe(1);
    expect(b.ledger.projection()).toBe(a.ledger.projection());
    a.runtime.stop();
    b.runtime.stop();
  });

  it('J：DEK 缺失读 .enc → E_SYNC_KEY_MISMATCH 红条（state=error，不崩）', async () => {
    const syncDir = tempDir('septcats-sync-key-');
    const dek = generateDek();
    const a = makeRuntime({ syncDir, actor: 'aaaa0001', dek, encrypt: true });
    await a.runtime.start();
    await commit(a, [upsertOp('aaaa0001', 'pg-enc', '加密页')]);
    await a.runtime.flushAndPublish();
    a.runtime.stop();

    // B 加密开启但存的是另一把新钥 → 读段解密失败 → error 态（不 panic）
    const b = makeRuntime({ syncDir, actor: 'bbbb0002', encrypt: true });
    await b.runtime.start();
    expect(b.runtime.getStatus().state).toBe('error');
    expect(b.runtime.getStatus().errors.some((e) => e.code === 'E_SYNC_KEY_MISMATCH')).toBe(true);
    b.runtime.stop();
  });
});
