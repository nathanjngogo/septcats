/**
 * sync-runtime.test.ts —— SyncRuntime 双实例集成（TASK-T13-01 §4 / TASK-T17-01 §1 扩）。
 *
 * 场景（同一 temp sync 目录，两个独立内存账本 + 各自 actor）：
 *   A. 建 5 页 → B 追平投影逐 op 相等；发布文件名符合 naming；
 *   B. 并发改同块 → 收敛同值 + conflict 报告各 1；
 *   C. 副本注入（seg (1).jsonl）→ 去重不重复入账；
 *   D. 断链 → degraded + 本地写入照常；恢复 → 追平；
 *   E. 崩溃恢复：半截段隔离、重启自愈不再重试；
 *   F. S5：新设备只有 snapshot+段（含 patch 折叠）→ 追平投影相等；
 *   G. 桥装饰器语义；H. setEnabled 假时钟轮询；I. 加密 E2E 与 E_SYNC_KEY_MISMATCH 红条；
 *   K. S10（T17-01）：v1 老段 + 轮换重加密 → 旧钥丢失 → 导入恢复码 → 全段可读；幂等重跑。
 *
 * DB 用假 SyncDbAdapter（内存账本），纯 Node 可跑；实体物化正确性归 db 层测试。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSegment,
  decodeOp,
  encodeOp,
  encodeSegment,
  opsToSnapshot,
  replay,
  type ActorId,
  type Op,
  type Segment,
} from '@septcats/core';
import { parseSegmentFileName, segmentFileName } from '@septcats/sync';
import type { CredentialStore } from '@septcats/platform';
import type { AllData, BatchData, DbBatchStatement, GetData } from '../src/db/rpc';
import { withSyncHook } from '../src/main/sync/bridge';
import { encodeDek, generateDek, keyIdBytes } from '../src/main/sync/crypto';
import { SYNC_DEK_ACCOUNT, SYNC_DEK_SERVICE, SyncKeyring } from '../src/main/sync/keyring';
import { SyncRuntime } from '../src/main/sync/runtime';
import { createCipheriv, randomBytes } from 'node:crypto';

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

/** 内存假凭据存储（可变 Map）：初始 dek 预置；set 真写（支撑 T17 轮换后读回新钥）。 */
function fakeStore(dek: Uint8Array | null): CredentialStore {
  const plain = new Map<string, string>();
  if (dek !== null) {
    plain.set(`${SYNC_DEK_SERVICE}/${SYNC_DEK_ACCOUNT}`, encodeDek(dek));
  }
  return {
    async get(): Promise<string | null> {
      return plain.get(`${SYNC_DEK_SERVICE}/${SYNC_DEK_ACCOUNT}`) ?? null;
    },
    async set(_service: string, _account: string, secret: string): Promise<void> {
      plain.set(`${_service}/${_account}`, secret);
    },
    async delete(): Promise<boolean> {
      return true;
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

/** T13-01 时代 v1 布局（iv+tag+ct）制造器（S10 场景的「老包」）。 */
function encryptV1Text(dek: Uint8Array, logicalName: string, plaintext: string): string {
  let iv = randomBytes(12);
  while (iv[0] === 0x01) {
    iv = randomBytes(12); // 防命中 v2 判型（1/256）：v1 密文首字节不得为 0x01
  }
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(logicalName, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
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
  keyring: SyncKeyring;
}

function makeRuntime(options: MakeRuntimeOptions): RuntimeHandle {
  const ledger = new MemoryLedger();
  const keyring = new SyncKeyring(fakeStore(options.dek ?? null));
  const runtime = new SyncRuntime({
    rootDir: options.syncDir,
    db: ledger,
    actor: options.actor,
    workspaceId: `ws-${options.actor}`,
    clientVer: '0.1.0',
    keyring,
    encryptEnabled: () => options.encrypt === true,
    gcEnabled: () => false,
    idleFlushMs: 15_000,
    mergeIntervalMs: options.mergeIntervalMs ?? 60_000,
    watchDebounceMs: 2_000,
    ...(options.maxKeepSegs === undefined ? {} : { maxKeepSegs: options.maxKeepSegs }),
  });
  return { ledger, runtime, keyring };
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

  it('J：错钥读 v2 段 → key_mismatch 红条（不崩）', async () => {
    const syncDir = tempDir('septcats-sync-key-');
    const dek = generateDek();
    const a = makeRuntime({ syncDir, actor: 'aaaa0001', dek, encrypt: true });
    await a.runtime.start();
    await commit(a, [upsertOp('aaaa0001', 'pg-enc', '加密页')]);
    await a.runtime.flushAndPublish();
    a.runtime.stop();

    // B 加密开启但存的是另一把新钥 → 读段解密失败 → key_mismatch 态（不 panic）
    const b = makeRuntime({ syncDir, actor: 'bbbb0002', encrypt: true });
    await b.runtime.start();
    expect(b.runtime.getStatus().state).toBe('key_mismatch');
    expect(b.runtime.getStatus().errors.some((e) => e.code === 'E_KEY_ID_MISMATCH')).toBe(true);
    b.runtime.stop();
  });

  it('K：S10 全流程：v1 老段 + 轮换重加密 → 旧钥丢失 → 导入恢复码 → 全段可读；幂等重跑', async () => {
    const syncDir = tempDir('septcats-sync-s10-');
    const oldDek = generateDek();
    const a = makeRuntime({ syncDir, actor: 'aaaa0001', dek: oldDek, encrypt: true });
    await a.runtime.start();

    // ① v1 老段（T13-01 时代布局 iv+tag+ct，内容为真段：mergeRemote 可解码）
    const legacyOps = [upsertOp('aaaa0001', 'pg-legacy', '老段页', 1)];
    const legacySeg = buildSegment('aaaa0001', legacyOps, 1_700_000_000_000);
    const legacyText = encodeSegment(legacySeg);
    const legacyName = segmentFileName(legacySeg); // seg-xxx.jsonl（naming 契约：加密落盘名 = 逻辑名 + .enc）
    writeFileSync(join(syncDir, `${legacyName}.enc`), encryptV1Text(oldDek, legacyName, legacyText), 'utf8');

    // ② v2 当前时代段（经 runtime 正常发布）
    await commit(a, [upsertOp('aaaa0001', 'pg-s10', 'S10 页', 2)]);
    await a.runtime.flushAndPublish();
    expect(readdirSync(syncDir).filter((n) => n.endsWith('.jsonl.enc')).length).toBeGreaterThanOrEqual(2);

    // ③ 轮换：新钥即刻接管 + 后台重加密全部历史段
    const { startedAt } = a.runtime.rotateKey();
    expect(startedAt).toBeGreaterThan(0);
    const report = await a.runtime.whenReencryptSettled();
    expect(report).not.toBeNull();
    expect(report!.total).toBeGreaterThanOrEqual(2);
    expect(report!.reencrypted).toBeGreaterThanOrEqual(2);
    expect(report!.failed).toBe(0);

    // ④ 落盘段全部为 v2 且 key_id == 新钥；旧钥已解不开任何段
    const stored = await a.keyring.loadDek();
    expect(stored).not.toBeNull();
    const newKey = stored!;
    const encNames = readdirSync(syncDir).filter((n) => n.endsWith('.enc'));
    for (const name of encNames) {
      const raw = Buffer.from(readFileSync(join(syncDir, name), 'utf8'), 'base64');
      expect(raw[0]).toBe(0x01);
      expect(raw.subarray(1, 9).equals(keyIdBytes(newKey))).toBe(true);
    }
    // 幂等重跑：全部跳过，零重加
    const again = await a.runtime.reencryptAllSegments();
    expect(again.reencrypted).toBe(0);
    expect(again.skipped).toBe(again.total);
    expect(again.failed).toBe(0);
    // 轮换后 A 本轮读段照常（新钥全通）；重加密完成会自动补跑刷新轮，runCycle 并发合并
    await a.runtime.runCycle();
    await vi.waitFor(() => {
      expect(a.runtime.getStatus().state).toBe('ok');
    });
    expect(a.ledger.ops.size).toBe(2);
    a.runtime.stop();

    // ⑤ 旧钥丢失：B 全新凭据（ensureDek 生成随机钥）→ v2 key_id 不符 → key_mismatch 红条
    const b = makeRuntime({ syncDir, actor: 'bbbb0002', dek: null, encrypt: true });
    await b.runtime.start();
    expect(b.runtime.getStatus().state).toBe('key_mismatch');
    expect(b.runtime.getStatus().errors.some((e) => e.code === 'E_KEY_ID_MISMATCH')).toBe(true);

    // ⑥ 导入恢复码（新钥的）→ 写 keyring → 追平 → 全段可读
    const code = await a.keyring.exportRecoveryCode(); // A 侧 store 已持新钥
    const imported = await b.keyring.importRecoveryCode(code);
    await b.runtime.adoptRecoveredDek(imported);
    expect(b.runtime.getStatus().state).toBe('ok');
    expect(b.ledger.ops.size).toBe(2);
    expect(b.ledger.projection()).toBe(a.ledger.projection());
    b.runtime.stop();
  });
});
