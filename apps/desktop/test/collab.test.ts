/**
 * collab.test.ts —— 协作主进程接线（TASK-T19-05 §1 测试面）。
 *
 * 场景：
 *   A. 上行组 Op：payload → crdt_update op（lamport=账本水位+1、merge_policy='crdt'）、
 *      只进真相层（独占单语句 opLedger.insert batch，零物化——§0.5 单端路径回归钉）；
 *   B. 下行路由：applyRemote 按 pageId 路由、未开页忽略、跨页不串；
 *   C. attach 播种：快照区段聚合 + 账本 op（opId 覆盖去重）+ 关闭重开不丢文本；
 *   D. LRU：超限淘汰最久未访问、detach 幂等；
 *   E. 双实例集成：A 端上行 → 段发布 → B 端 mergeRemote 报告路由 + 真相层入账
 *      （不物化）+ 实体 op 同段共存互不影响（§0.6 普通页面操作不受影响的单测代理）；
 *   F. S5 跨代播种：快照折叠 → 段被 gc 场景模拟 → 新设备（空账本）attach 纯快照还原；
 *   G. rotateKey 链路（T19-04 DEVIATION-4 消化）：加密段轮换重加密后，新会话（空账本）
 *      追平仍收到 crdt_update 且文本无损。
 *
 * 纯 Node 逻辑（jsdom 仅为 @septcats/editor 导入图兜底）；DB 用内存假账本
 * （sync-runtime.test.ts 同款）；真实增量由 yjs 生成（与 T19-04 收敛用例同思路）。
 */
// @vitest-environment jsdom
import { mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  decodeOp,
  encodeOp,
  opsToSnapshot,
  replay,
  type ActorId,
  type CrdtUpdateEntry,
  type Op,
} from '@septcats/core';
import { YjsEditor } from '@septcats/editor';
import { withSyncHook } from '../src/main/sync/bridge';
import { encodeDek, generateDek } from '../src/main/sync/crypto';
import { SYNC_DEK_ACCOUNT, SYNC_DEK_SERVICE, SyncKeyring } from '../src/main/sync/keyring';
import { SyncRuntime } from '../src/main/sync/runtime';
import { CollabHub, registerCollabIpc, type CollabIpcRegistrar } from '../src/main/collab';
import type { CredentialStore } from '@septcats/platform';
import type { AllData, BatchData, DbBatchStatement, GetData } from '../src/db/rpc';

// ---------------------------------------------------------------------------
// 内存假账本（sync-runtime.test.ts 同款；按 batch 记录语句面供断言）
// ---------------------------------------------------------------------------

class MemoryLedger {
  readonly ops = new Map<string, Op>();
  rebuildCount = 0;
  /** batch 收到的 sqlId，按 batch 分组、按到达序。 */
  readonly batches: string[][] = [];

  async batch(stmts: readonly DbBatchStatement[]): Promise<BatchData> {
    const sqlIds: string[] = [];
    for (const stmt of stmts) {
      sqlIds.push(stmt.sqlId);
      if (stmt.sqlId === 'opLedger.insert') {
        const p = stmt.params as { op_json: string };
        const op = decodeOp(p.op_json);
        if (!this.ops.has(op.op_id)) {
          this.ops.set(op.op_id, op);
        }
      }
    }
    this.batches.push(sqlIds);
    return { results: stmts.map(() => ({ sqlId: 'opLedger.insert', data: { changes: 1, lastInsertRowid: 1 } })) };
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

  /** 装饰面（与 main/index.ts 同构：batch 成功 → onCommitted → 攒段器）。 */
  hooked(onCommitted: (ops: readonly Op[]) => void) {
    const ledger = this;
    return withSyncHook(
      {
        run: async () => ({ changes: 1, lastInsertRowid: 1 }),
        get: async (sqlId, params) => ledger.get(sqlId, params),
        all: async (sqlId, params) => ledger.all(sqlId, params),
        batch: async (stmts) => ledger.batch(stmts),
      },
      onCommitted,
    );
  }

  projection(): string {
    return opsToSnapshot(replay([...this.ops.values()]).projection);
  }
}

// ---------------------------------------------------------------------------
// Yjs 造增量 / 读文本
// ---------------------------------------------------------------------------

const ACTOR: ActorId = 'devicecollab';

/** 独立 YjsEditor 上做本地事务 → 防抖 flush 的上行 payload（与 renderer 上行同形）。 */
function makeUplink(pageId: string, text: string): { pageId: string; updateB64: string } {
  const source = new YjsEditor(pageId);
  const xmlText = new Y.XmlText();
  xmlText.insert(0, text);
  source.fragment.insert(0, [xmlText]);
  const payload = source.sync();
  if (payload === null) {
    throw new Error('makeUplink：sync() 未产出 payload');
  }
  source.destroy();
  return { pageId: payload.pageId, updateB64: payload.updateB64 };
}

function crdtEntry(opId: string, pageId: string, updateB64: string): CrdtUpdateEntry {
  return {
    opId,
    target: { table: 'page', id: pageId },
    pageId,
    updateB64,
  };
}

/** 播种条目 → YjsEditor 构造注入（测试侧与 renderer 同映射）。 */
function crdtEntryOf(entry: { opId: string; pageId: string; updateB64: string }): CrdtUpdateEntry {
  return crdtEntry(entry.opId, entry.pageId, entry.updateB64);
}

function textOf(editor: YjsEditor): string {
  return editor.fragment.toString();
}

// ---------------------------------------------------------------------------
// fixture（真实管线：上行经装饰 executor 进 SyncRuntime 攒段）
// ---------------------------------------------------------------------------

let clockC = 0;

function upsertOp(dev: ActorId, pageId: string, title: string): Op {
  clockC += 1;
  return {
    op_id: `op-${dev}-${pageId}-${String(clockC).padStart(6, '0')}`,
    lamport: { c: clockC, d: dev },
    at: 1_700_000_000_000 + clockC,
    actor: dev,
    target: { table: 'page', id: pageId },
    kind: 'upsert',
    payload: { title, sort_key: `A${String(clockC).padStart(9, '0')}`, alive: 1 },
  };
}

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

function makeRuntime(options: {
  syncDir: string;
  actor: ActorId;
  dek?: Uint8Array | null;
  store?: CredentialStore;
  encrypt?: boolean;
  maxKeepSegs?: number;
}): { ledger: MemoryLedger; runtime: SyncRuntime; crdtReports: CrdtUpdateEntry[][] } {
  const ledger = new MemoryLedger();
  const crdtReports: CrdtUpdateEntry[][] = [];
  const runtime = new SyncRuntime({
    rootDir: options.syncDir,
    db: ledger,
    actor: options.actor,
    workspaceId: 'ws-collab',
    clientVer: '0.1.0',
    keyring: new SyncKeyring(options.store ?? fakeStore(options.dek ?? null)),
    encryptEnabled: (): boolean => options.encrypt === true,
    gcEnabled: (): boolean => false,
    idleFlushMs: 15_000,
    mergeIntervalMs: 60_000,
    watchDebounceMs: 2_000,
    ...(options.maxKeepSegs === undefined ? {} : { maxKeepSegs: options.maxKeepSegs }),
  });
  runtime.onCrdtUpdates((entries) => {
    crdtReports.push([...entries]);
  });
  return { ledger, runtime, crdtReports };
}

function makeHub(ledger: MemoryLedger, runtime: SyncRuntime, actor: ActorId): CollabHub {
  return new CollabHub({
    executor: ledger.hooked((ops) => {
      runtime.onLocalCommit(ops);
    }),
    actor,
    now: (): number => 1_700_000_000_000,
  });
}

let syncDirs: string[] = [];

beforeEach(() => {
  clockC = 0;
});

afterEach(() => {
  for (const dir of syncDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  syncDirs = [];
});

function tempSyncDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'septcats-collab-'));
  syncDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// A. 上行组 Op
// ---------------------------------------------------------------------------

describe('CollabHub 上行组 Op（§0.2 同管线）', () => {
  it('crdt_update op 入真相层：lamport=账本水位+1、merge_policy=crdt、零物化语句', async () => {
    const syncDir = tempSyncDir();
    const { ledger, runtime, crdtReports } = makeRuntime({ syncDir, actor: ACTOR });
    const runtime2 = runtime;
    const hub = makeHub(ledger, runtime2, ACTOR);
    await hub.attach('p1');

    // 预置一条实体 op（拉高账本水位）→ 上行 lamport 应为 max+1
    const before = ledger.batches.length;
    await ledger
      .hooked((ops) => runtime2.onLocalCommit(ops))
      .batch([{ sqlId: 'opLedger.insert', params: { op_json: encodeOp(upsertOp(ACTOR, 'p0', '实体水位')) } }]);

    await hub.applyUplink(makeUplink('p1', 'hello'));

    const ops = [...ledger.ops.values()].filter((op) => op.kind === 'crdt_update');
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.target).toEqual({ table: 'page', id: 'p1' });
    expect(op.merge_policy).toBe('crdt');
    expect(op.actor).toBe(ACTOR);
    expect(op.lamport.c).toBe(2); // 实体 op c=1 → 全局水位+1
    expect(op.payload['pageId']).toBe('p1');

    // §0.5 单端路径：crdt_update 只进真相层（独占单语句 batch），绝不物化
    const crdtBatches = ledger.batches.slice(before + 1);
    expect(crdtBatches.length).toBeGreaterThanOrEqual(1);
    for (const batch of crdtBatches) {
      expect(batch).toEqual(['opLedger.insert']);
    }
    expect(crdtReports).toHaveLength(0); // 上行不走下行路由
    hub.dispose();
  });

  it('连续上行 lamport 严格递增；hub Y.Doc 收到增量（REMOTE origin 不回灌）', async () => {
    const syncDir = tempSyncDir();
    const { ledger, runtime } = makeRuntime({ syncDir, actor: ACTOR });
    const hub = makeHub(ledger, runtime, ACTOR);
    await hub.attach('p1');

    await hub.applyUplink(makeUplink('p1', '一'));
    await hub.applyUplink(makeUplink('p1', '二'));

    const cs = [...ledger.ops.values()]
      .filter((op) => op.kind === 'crdt_update')
      .map((op) => op.lamport.c)
      .sort((a, b) => a - b);
    expect(cs).toEqual([1, 2]);

    const hubEditor = hub.get('p1');
    expect(hubEditor).toBeDefined();
    expect(textOf(hubEditor!)).toContain('一');
    expect(textOf(hubEditor!)).toContain('二');
    expect(hubEditor!.pendingOpCount).toBe(0); // 防回环：hub 只收已入账增量
    hub.dispose();
  });

  it('页未 attach 时上行照常入账（不丢数据）', async () => {
    const syncDir = tempSyncDir();
    const { ledger, runtime } = makeRuntime({ syncDir, actor: ACTOR });
    const hub = makeHub(ledger, runtime, ACTOR);
    await hub.applyUplink(makeUplink('p9', '离线文本'));
    expect([...ledger.ops.values()].filter((op) => op.kind === 'crdt_update')).toHaveLength(1);
    expect(hub.has('p9')).toBe(false);
    hub.dispose();
  });
});

// ---------------------------------------------------------------------------
// B. 下行路由
// ---------------------------------------------------------------------------

describe('CollabHub 下行路由（§0.2 mergeRemote 报告 → 按页）', () => {
  it('按 pageId 路由到对应 hub Y.Doc；未开页忽略；跨页条目绝不串页', async () => {
    const syncDir = tempSyncDir();
    const { ledger, runtime } = makeRuntime({ syncDir, actor: ACTOR });
    const hub = makeHub(ledger, runtime, ACTOR);
    await hub.attach('p1');

    hub.applyRemote([
      crdtEntry('opA', 'p1', makeUplink('p1', '本页文本').updateB64),
      crdtEntry('opB', 'p2', makeUplink('p2', '别页文本').updateB64),
    ]);

    expect(textOf(hub.get('p1')!)).toContain('本页文本');
    expect(textOf(hub.get('p1')!)).not.toContain('别页文本');
    expect(hub.has('p2')).toBe(false);
    hub.dispose();
  });
});

// ---------------------------------------------------------------------------
// C. attach 播种（§0.3 跨代聚合）
// ---------------------------------------------------------------------------

describe('CollabHub attach 播种（§0.3 快照区段 + 账本 op）', () => {
  it('快照区段与账本 op 聚合（opId 覆盖去重），按页过滤，种子重建文本', async () => {
    const ledger = new MemoryLedger();
    const snapA = makeUplink('p1', '快照文本A');
    const snapB = makeUplink('p1', '快照文本B');
    const after = makeUplink('p1', '其后到账');
    // 账本含：快照已有的 opB（同 opId → 去重）+ 快照之后的 opC
    const ledgerOp = (opId: string, c: number, updateB64: string): DbBatchStatement => ({
      sqlId: 'opLedger.insert',
      params: {
        op_json: encodeOp({
          op_id: opId,
          lamport: { c, d: ACTOR },
          at: c,
          actor: ACTOR,
          target: { table: 'page', id: 'p1' },
          kind: 'crdt_update',
          merge_policy: 'crdt',
          payload: { pageId: 'p1', updateB64 },
        }),
      },
    });
    await ledger.hooked(() => undefined).batch([ledgerOp('opB', 1, snapB.updateB64), ledgerOp('opC', 2, after.updateB64)]);

    const probe = new CollabHub({
      executor: ledger.hooked(() => undefined),
      actor: ACTOR,
      snapshotCrdtUpdates: async () => [
        {
          pageId: 'p1',
          updates: [
            { opId: 'opA', updateB64: snapA.updateB64 },
            { opId: 'opB', updateB64: snapB.updateB64 },
          ],
        },
        { pageId: 'p2', updates: [{ opId: 'opX', updateB64: makeUplink('p2', '别页').updateB64 }] },
      ],
    });
    const result = await probe.attach('p1');
    expect(result.entries.map((entry) => entry.opId)).toEqual(['opA', 'opB', 'opC']); // opB 只留一份
    expect(result.entries.every((entry) => entry.pageId === 'p1')).toBe(true);

    // 种子重建 Y.Doc → 三段文本齐全
    const rebuilt = new YjsEditor('p1', { crdtUpdates: result.entries.map(crdtEntryOf) });
    expect(textOf(rebuilt)).toContain('快照文本A');
    expect(textOf(rebuilt)).toContain('快照文本B');
    expect(textOf(rebuilt)).toContain('其后到账');
    rebuilt.destroy();
    probe.dispose();
  });

  it('关闭重开：detach 后再 attach，文本从账本还原（PageView 生命周期）', async () => {
    const syncDir = tempSyncDir();
    const { ledger, runtime } = makeRuntime({ syncDir, actor: ACTOR });
    const hub = makeHub(ledger, runtime, ACTOR);
    await hub.attach('p1');
    await hub.applyUplink(makeUplink('p1', '关闭前文本'));
    hub.detach('p1');
    expect(hub.has('p1')).toBe(false);

    const again = await hub.attach('p1');
    expect(again.entries).toHaveLength(1);
    expect(again.entries[0]!.pageId).toBe('p1');
    const rebuilt = new YjsEditor('p1', { crdtUpdates: again.entries.map(crdtEntryOf) });
    expect(textOf(rebuilt)).toContain('关闭前文本');
    rebuilt.destroy();
    hub.dispose();
  });

  it('同页在途 attach 合并为同一 Promise（不重复建实例）', async () => {
    const syncDir = tempSyncDir();
    const { ledger, runtime } = makeRuntime({ syncDir, actor: ACTOR });
    const hub = makeHub(ledger, runtime, ACTOR);
    const [r1, r2] = await Promise.all([hub.attach('p1'), hub.attach('p1')]);
    expect(r1.entries).toEqual(r2.entries);
    expect(hub.size).toBe(1);
    hub.dispose();
  });
});

// ---------------------------------------------------------------------------
// D. LRU
// ---------------------------------------------------------------------------

describe('CollabHub LRU（§0.1 缓存上限）', () => {
  it('超限淘汰最久未访问者（命中刷新新近度）；detach 幂等', async () => {
    const ledger = new MemoryLedger();
    const hub = new CollabHub({
      executor: ledger.hooked(() => undefined),
      actor: ACTOR,
      maxPages: 2,
    });
    await hub.attach('p1');
    await hub.attach('p2');
    await hub.attach('p1'); // 命中刷新 → 最久未访问变成 p2
    expect(hub.size).toBe(2);
    await hub.attach('p3'); // 淘汰 p2
    expect(hub.has('p1')).toBe(true);
    expect(hub.has('p2')).toBe(false);
    expect(hub.has('p3')).toBe(true);

    hub.detach('p3');
    expect(hub.has('p3')).toBe(false);
    hub.detach('p3'); // destroy 幂等路径：二次 detach 无害
    expect(hub.size).toBe(1);
    hub.dispose();
  });
});

// ---------------------------------------------------------------------------
// E. 双实例集成（下行全链：段 → mergeRemote → 报告路由 → 入账）
// ---------------------------------------------------------------------------

describe('双实例下行全链（§0.6 文本协作不破普通管线）', () => {
  it('A 上行 → 段发布 → B 收段：报告路由 + 真相层入账 + 零物化；实体 op 同段共存', async () => {
    const syncDir = tempSyncDir();
    const devA: ActorId = 'deviceaaaa1';
    const devB: ActorId = 'devicebbbb1';
    const a = makeRuntime({ syncDir, actor: devA });
    const hubA = makeHub(a.ledger, a.runtime, devA);
    await a.runtime.start();

    await hubA.attach('p1');
    // A：一条实体 op（建页）+ 一条协作增量，同走攒段管线
    await a.ledger
      .hooked((ops) => a.runtime.onLocalCommit(ops))
      .batch([{ sqlId: 'opLedger.insert', params: { op_json: encodeOp(upsertOp(devA, 'p1', '实体页')) } }]);
    await hubA.applyUplink(makeUplink('p1', '跨端文本'));
    await a.runtime.flushAndPublish();

    // B：追平 → 收到实体 op + crdt_update，报告按口径路由
    const b = makeRuntime({ syncDir, actor: devB });
    const hubB = makeHub(b.ledger, b.runtime, devB);
    await b.runtime.start();

    // ① crdt 下行报告恰好一次、含 A 的 opId
    const flat = b.crdtReports.flat();
    expect(flat).toHaveLength(1);
    expect(flat[0]!.pageId).toBe('p1');
    const aCrdtOp = [...a.ledger.ops.values()].find((op) => op.kind === 'crdt_update')!;
    expect(flat[0]!.opId).toBe(aCrdtOp.op_id);
    expect(flat[0]!.updateB64).toBe(aCrdtOp.payload['updateB64']);

    // ② 真相层：两类 op 都在；实体投影追平；B hub 应用后文本可见
    const bCrdt = [...b.ledger.ops.values()].filter((op) => op.kind === 'crdt_update');
    expect(bCrdt).toHaveLength(1);
    expect(b.ledger.projection()).toBe(a.ledger.projection());
    await hubB.attach('p1');
    hubB.applyRemote(flat);
    expect(textOf(hubB.get('p1')!)).toContain('跨端文本');

    // ③ crdt op 只进真相层：存在「独占 opLedger.insert 的单语句 batch」，且物化语句
    //    只出现在实体 op 的 commitOps batch 里
    expect(b.ledger.batches).toContainEqual(['opLedger.insert']);
    const materializingBatches = b.ledger.batches.filter((batch) => batch.some((sqlId) => sqlId.startsWith('page.')));
    for (const batch of materializingBatches) {
      expect(batch).toContain('opLedger.insert'); // 实体 batch 恒为 ledger+物化成对
      expect(batch.length).toBeGreaterThan(1);
    }

    // ④ 已见段不重复路由/入账（幂等口径）
    await b.runtime.runCycle();
    expect(b.crdtReports).toHaveLength(1);
    expect([...b.ledger.ops.values()].filter((op) => op.kind === 'crdt_update')).toHaveLength(1);

    a.runtime.stop();
    b.runtime.stop();
    hubA.dispose();
    hubB.dispose();
  });
});

// ---------------------------------------------------------------------------
// F. S5 跨代播种 + 快照折叠
// ---------------------------------------------------------------------------

describe('S5 跨代快照播种（§0.3 新设备/清缓存）', () => {
  it('折叠快照 → 段移除后，新设备（空账本）attach 纯快照还原文本', async () => {
    const syncDir = tempSyncDir();
    const devA: ActorId = 'deviceaaaa1';
    const a = makeRuntime({ syncDir, actor: devA });
    const hubA = makeHub(a.ledger, a.runtime, devA);
    await a.runtime.start();
    await hubA.attach('p1');
    await hubA.applyUplink(makeUplink('p1', '折叠前文本'));
    await a.runtime.flushAndPublish();
    a.runtime.stop();
    hubA.dispose();

    // 独立运行时（maxKeepSegs=0）收段并折叠出快照
    const snapper = makeRuntime({ syncDir, actor: 'devicesnap01', maxKeepSegs: 0 });
    await snapper.runtime.start();
    snapper.runtime.stop();
    expect(snapper.ledger.ops.size).toBeGreaterThanOrEqual(1);

    // 模拟跨代场景：段文件全部移除，只剩快照（新设备唯一来源）
    for (const name of readdirSync(syncDir)) {
      if (name.startsWith('segment-')) {
        unlinkSync(join(syncDir, name));
      }
    }

    // 新设备：空账本 → S5 播种实体 + getSnapshotCrdtUpdates 聚合区段 → attach 还原文本
    const fresh = makeRuntime({ syncDir, actor: 'deviceeeee1' });
    await fresh.runtime.start();
    fresh.runtime.stop();
    const sections = await fresh.runtime.getSnapshotCrdtUpdates();
    const p1 = sections.find((section) => section.pageId === 'p1');
    expect(p1).toBeDefined();
    expect(p1!.updates.length).toBeGreaterThanOrEqual(1);

    const hubFresh = makeHub(fresh.ledger, fresh.runtime, 'deviceeeee1');
    const attached = await hubFresh.attach('p1');
    expect(attached.entries.length).toBeGreaterThanOrEqual(1);
    const rebuilt = new YjsEditor('p1', { crdtUpdates: attached.entries.map(crdtEntryOf) });
    expect(textOf(rebuilt)).toContain('折叠前文本');
    rebuilt.destroy();
    hubFresh.dispose();
  });
});

// ---------------------------------------------------------------------------
// G. rotateKey 链路（T19-04 DEVIATION-4 消化：轮换后旧/新会话文本正常）
// ---------------------------------------------------------------------------

describe('rotateKey 全链（§0.4 加密段轮换 + 文本保真）', () => {
  it('加密段含 crdt_update → 轮换重加密 → 新会话（空账本）追平后文本可还原', async () => {
    const syncDir = tempSyncDir();
    const dek = generateDek();
    const sharedStore = fakeStore(dek); // A/B 共享凭据面：轮换后新钥对「新会话」可见
    const devA: ActorId = 'deviceaaaa1';
    const devB: ActorId = 'devicebbbb1';

    const a = makeRuntime({ syncDir, actor: devA, store: sharedStore, encrypt: true });
    const hubA = makeHub(a.ledger, a.runtime, devA);
    await a.runtime.start();
    await hubA.attach('p1');
    await hubA.applyUplink(makeUplink('p1', '轮换前文本'));
    await a.runtime.flushAndPublish();

    // 轮换：新 DEK 即刻接管 + 后台重加密全部段/快照（含 crdt_update 的段按文件覆盖）
    a.runtime.rotateKey();
    const report = await a.runtime.whenReencryptSettled();
    expect(report).not.toBeNull();
    expect(report!.failed).toBe(0);
    expect(report!.reencrypted).toBeGreaterThanOrEqual(1);
    a.runtime.stop();

    // 新会话：空账本 + 同一凭据面（已持新钥）→ 追平解密成功 → crdt_update 到账
    const b = makeRuntime({ syncDir, actor: devB, store: sharedStore, encrypt: true });
    const crdtB: CrdtUpdateEntry[][] = [];
    b.runtime.onCrdtUpdates((entries) => {
      crdtB.push([...entries]);
    });
    await b.runtime.start();
    b.runtime.stop();

    expect(crdtB.flat()).toHaveLength(1);
    const rebuilt = new YjsEditor('p1', { crdtUpdates: crdtB.flat().map(crdtEntryOf) });
    expect(textOf(rebuilt)).toContain('轮换前文本');
    rebuilt.destroy();
    hubA.dispose();
  });
});

// ---------------------------------------------------------------------------
// IPC 注册面
// ---------------------------------------------------------------------------

describe('registerCollabIpc（三通道 + E_INVARIANT/E_MALFORMED）', () => {
  it('attach/detach/apply 走 hub；hub 缺失回 E_INVARIANT；参数非法回 E_MALFORMED', async () => {
    const syncDir = tempSyncDir();
    const { ledger, runtime } = makeRuntime({ syncDir, actor: ACTOR });
    const hub = makeHub(ledger, runtime, ACTOR);
    const routes = new Map<string, (raw: unknown) => Promise<unknown>>();
    const registrar: CollabIpcRegistrar = {
      handle: (channel, listener) => {
        routes.set(channel, listener);
      },
    };
    let currentHub: CollabHub | null = hub;
    registerCollabIpc({ registrar, getHub: () => currentHub });

    const attachResult = (await routes.get('collab:attach')!({ pageId: 'p1' })) as { entries: unknown[] };
    expect(attachResult.entries).toEqual([]);
    await routes.get('collab:apply')!({ pageId: 'p1', updateB64: makeUplink('p1', 'ipc文本').updateB64 });
    expect(await routes.get('collab:detach')!({ pageId: 'p1' })).toEqual({ ok: true });

    currentHub = null;
    await expect(routes.get('collab:attach')!({ pageId: 'p1' })).rejects.toThrow('协作服务不可用');
    await expect(routes.get('collab:apply')!({ pageId: 'p1', updateB64: 'aGk=' })).rejects.toThrow('协作服务不可用');
    currentHub = hub;
    await expect(routes.get('collab:attach')!({})).rejects.toThrow('pageId 必须是非空字符串');
    await expect(routes.get('collab:apply')!({ pageId: 'p1' })).rejects.toThrow('updateB64 必须是非空字符串');
    await expect(routes.get('collab:detach')!({ pageId: '' })).rejects.toThrow('pageId 必须是非空字符串');
    hub.dispose();
  });
});

