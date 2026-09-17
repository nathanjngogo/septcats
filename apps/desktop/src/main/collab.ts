/**
 * main/collab.ts —— 协作（CRDT）主进程枢纽（TASK-T19-05 §0，落地 4/4）。
 *
 * 职责（任务书 §0.1/§0.2 逐条）：
 * - **pageId → YjsEditor 缓存（LRU 32 页）**：复用 T19-03 的 `YjsEditor`（含 destroy
 *   幂等）；PageView 打开经 `collab:attach` 接入、关闭经 `collab:detach` 释放，
 *   超限按最久未访问淘汰（flush + destroy 防泄漏）；
 * - **上行组 Op**：renderer Y.Doc 防抖 flush 的 `crdt_update` payload 经 `collab:apply`
 *   到主进程，此处按与普通 op 同一管线组 Op（op_id=ulid、lamport 取 op_ledger 全局
 *   水位 +1 —— 真相层时钟，含远端 op 见闻；`merge_policy='crdt'`），**只进 op_ledger、
 *   不物化**（commit.ts 对 crdt_update 显式拒绝物化是契约，不是缺口）；经 withSyncHook
 *   装饰的 executor 提交后由 SyncRuntime 攒段发布（M8b 既有路径）；
 * - **下行路由**：SyncRuntime.mergeRemote 报告的 crdtUpdates（opId 去重、仅远端新 op）
 *   按页应用到 hub Y.Doc 并广播 renderer（index.ts 接线）；
 * - **快照播种（§0.3 跨代聚合）**：attach 返回「全部快照文件的 crdtUpdates 区段聚合 +
 *   账本 crdt_update op」（opId 覆盖去重，Yjs 幂等应用天然安全），renderer 据此重建
 *   Y.Doc —— 新设备/清缓存首次开页文本不丢；
 * - **rotateKey（§0.4）**：crdt_update op 与实体 op 同走段/快照管线，重加密路径
 *   （runtime.reencryptAllSegments）按文件枚举天然覆盖，本模块零特殊处理。
 *
 * 纪律：本文件不 import electron（IPC 注册在 index.ts 经 registrar 注入，同 sync/ipc.ts
 * 范式）；绝不 import yjs —— Y.Doc 状态读取/合并全部经 `YjsEditor`（T19-03 封装面）。
 */

import { decodeOp, ulid } from '@septcats/core';
import type { ActorId, CrdtUpdateEntry, Op } from '@septcats/core';
import { YjsEditor } from '@septcats/editor';
import type { SnapshotCrdtPage } from '@septcats/sync';
import { ledgerStatement } from './commit';
import type { StatementExecutor } from './pages';
import type { CollabAttachResult, CollabUpdateEntry, CollabUplinkInput } from '../shared/collab';
import {
  CHANNEL_COLLAB_APPLY,
  CHANNEL_COLLAB_ATTACH,
  CHANNEL_COLLAB_DETACH,
} from '../shared/ipc';
import { PagesApiError } from './pages';

/** 页缓存默认上限（任务书 §0.1 建议 32 页）。 */
export const COLLAB_MAX_PAGES = 32;

export interface CollabHubOptions {
  /** 提交/查询执行面（main/index.ts 注入 withSyncHook 装饰后的 handle → 上行自动进攒段器）。 */
  readonly executor: StatementExecutor;
  readonly actor: ActorId;
  /** 墙上时间（测试注入）。 */
  readonly now?: () => number;
  /** 页缓存上限（默认 {@link COLLAB_MAX_PAGES}）。 */
  readonly maxPages?: number;
  /** 「全部快照 crdtUpdates 区段聚合」的读取口（index.ts 接 SyncRuntime.getSnapshotCrdtUpdates）。 */
  readonly snapshotCrdtUpdates?: () => Promise<SnapshotCrdtPage[]>;
  readonly log?: (line: string) => void;
}

export class CollabHub {
  private readonly executor: StatementExecutor;
  private readonly actor: ActorId;
  private readonly nowFn: () => number;
  private readonly maxPages: number;
  private readonly snapshotCrdtUpdates: () => Promise<SnapshotCrdtPage[]>;
  private readonly log: (line: string) => void;

  /** pageId → hub YjsEditor。Map 插入序即 LRU 访问序（命中/新建都重插到末尾）。 */
  private readonly pages = new Map<string, YjsEditor>();
  /** attach 并发防重：同页在途的 attach Promise（快照/账本读取含 await）。 */
  private readonly attaching = new Map<string, Promise<CollabAttachResult>>();

  constructor(options: CollabHubOptions) {
    this.executor = options.executor;
    this.actor = options.actor;
    this.nowFn = options.now ?? ((): number => Date.now());
    this.maxPages = options.maxPages ?? COLLAB_MAX_PAGES;
    this.snapshotCrdtUpdates = options.snapshotCrdtUpdates ?? (async (): Promise<SnapshotCrdtPage[]> => []);
    this.log = options.log ?? ((): void => undefined);
  }

  // --- 生命周期（attach / detach / LRU） -------------------------------------

  /**
   * PageView 打开：取回/创建 hub Y.Doc，返回播种条目集（快照区段聚合 + 账本 op，
   * opId 去重）。同页在途 attach 合并为同一 Promise；命中缓存的活实例同样回全量
   * 播种集（与 hub 文档状态语义等价 —— hub 只收「已入账」的增量，见 applyUplink）。
   */
  attach(pageId: string): Promise<CollabAttachResult> {
    const inFlight = this.attaching.get(pageId);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const promise = this.attachBody(pageId).finally(() => {
      this.attaching.delete(pageId);
    });
    this.attaching.set(pageId, promise);
    return promise;
  }

  private async attachBody(pageId: string): Promise<CollabAttachResult> {
    const entries = await this.collectSeedEntries(pageId);
    const existing = this.pages.get(pageId);
    if (existing !== undefined) {
      this.touch(pageId);
      return { entries };
    }
    this.evictOldest(pageId);
    const editor = new YjsEditor(pageId, {
      crdtUpdates: entries.map(toCrdtEntry),
      onOp: (payload) => {
        void this.applyUplink(payload).catch((error: unknown) => {
          this.log(`hub 上行组 Op 失败（pageId=${pageId}）：${describe(error)}`);
        });
      },
    });
    this.pages.set(pageId, editor);
    return { entries };
  }

  /**
   * PageView 关闭：flush 待发（hub 侧通常为空 —— hub 只收已入账增量，防御性兜底）、
   * 摘缓存、destroy（YjsEditor destroy 幂等，二次 detach 无害）。页不存在 → no-op。
   */
  detach(pageId: string): void {
    const editor = this.pages.get(pageId);
    if (editor === undefined) {
      return;
    }
    this.pages.delete(pageId);
    editor.sync();
    editor.destroy();
  }

  /** LRU：命中/新建都重插到 Map 末尾（最久未访问者居首）。 */
  private touch(pageId: string): void {
    const editor = this.pages.get(pageId);
    if (editor === undefined) {
      return;
    }
    this.pages.delete(pageId);
    this.pages.set(pageId, editor);
  }

  /** 容量守卫：插入新页前淘汰最久未访问者（排除即将插入的页本身）。 */
  private evictOldest(incomingPageId: string): void {
    while (this.pages.size >= this.maxPages) {
      const oldestKey = [...this.pages.keys()].find((key) => key !== incomingPageId);
      if (oldestKey === undefined) {
        return;
      }
      const evicted = this.pages.get(oldestKey);
      this.pages.delete(oldestKey);
      evicted?.sync();
      evicted?.destroy();
      this.log(`协作页缓存淘汰（LRU 上限 ${String(this.maxPages)}）：${oldestKey}`);
    }
  }

  // --- 上行（collab:apply）：payload → 组 Op → 账本 → hub Y.Doc ---------------

  /**
   * renderer 上行 payload：
   * ① 组 `crdt_update` Op（op_id/lamport 与普通 op 同管线；lamport = 账本全局水位 +1，
   *    d=本机 actor —— 同机严格递增、跨机 (c,d) 全序由设备维保证）；
   * ② **真相层先行**：只写 op_ledger（不物化；经装饰 executor 自动进 SyncRuntime 攒段）；
   * ③ hub Y.Doc 幂等应用（applyCrdtUpdate 的 REMOTE origin 不回灌，防回环）。
   * 页未 attach（关闭/淘汰竞态）时照常入账 —— 内容以账本为准，再 attach 时播种还原。
   */
  async applyUplink(payload: CollabUplinkInput): Promise<void> {
    const op = await this.buildCrdtOp(payload);
    await this.executor.batch([ledgerStatement(op, null)]);
    const applied = this.pages.get(payload.pageId)?.applyCrdtUpdate(payload) ?? false;
    if (!applied) {
      // 坏 base64 / 页未开：记录即可 —— op 已入账，不丢数据
      this.log(`hub Y.Doc 未应用上行增量（pageId=${payload.pageId}，op 已入账）`);
    }
  }

  /** 组一条 crdt_update op：lamport 取 op_ledger 全局水位 +1（含远端见闻，真相层时钟）。 */
  private async buildCrdtOp(payload: CollabUplinkInput): Promise<Op> {
    const maxData = await this.executor.get('opLedger.maxLamport', {});
    const maxC = (maxData.row as { c?: unknown } | null)?.c;
    const base = typeof maxC === 'number' && Number.isFinite(maxC) ? Math.trunc(maxC) : 0;
    const at = this.nowFn();
    const opPayload: { pageId: string; updateB64: string; svFromB64?: string } = {
      pageId: payload.pageId,
      updateB64: payload.updateB64,
    };
    if (payload.svFromB64 !== undefined) {
      opPayload.svFromB64 = payload.svFromB64;
    }
    return {
      op_id: ulid(at),
      lamport: { c: base + 1, d: this.actor },
      at,
      actor: this.actor,
      target: { table: 'page', id: payload.pageId },
      kind: 'crdt_update',
      merge_policy: 'crdt',
      payload: opPayload,
    };
  }

  // --- 下行（SyncRuntime 报告 → hub Y.Doc） -----------------------------------

  /**
   * mergeRemote 报告到账：按 pageId 路由到对应 hub Y.Doc（未开页忽略 —— 内容已在
   * 账本，attach 时播种）。renderer 广播由 index.ts 的监听器负责。
   */
  applyRemote(entries: readonly CrdtUpdateEntry[]): void {
    for (const entry of entries) {
      this.pages.get(entry.pageId)?.applyCrdtUpdate(entry);
    }
  }

  // --- 播种（§0.3 跨代快照聚合） ----------------------------------------------

  /**
   * 播种条目集 = 「全部快照文件的 crdtUpdates 区段聚合（跨代，opId 去重）」+
   * 「op_ledger 的 crdt_update op（含快照之后到账的实时 op）」。
   * opId 覆盖判断：快照与账本可能含同一条（折叠前进账过），Yjs 幂等应用天然安全，
   * 这里仍按 opId 去重（先到者留）以保证同输入确定性。空账本（新设备/清缓存）时
   * 账本侧为空，纯快照重建 —— 不允许只取一边（会丢文本）。
   */
  private async collectSeedEntries(pageId: string): Promise<CollabUpdateEntry[]> {
    const seen = new Set<string>();
    const entries: CollabUpdateEntry[] = [];
    const push = (opId: string, pageIdOf: string, updateB64: string): void => {
      if (seen.has(opId) || opId.length === 0 || updateB64.length === 0) {
        return;
      }
      seen.add(opId);
      entries.push({ opId, pageId: pageIdOf, updateB64 });
    };

    // ① 快照区段（跨代聚合，seq 升序；单文件畸形跳过不阻断其余快照）
    let sections: SnapshotCrdtPage[] = [];
    try {
      sections = await this.snapshotCrdtUpdates();
    } catch (error) {
      this.log(`快照 crdtUpdates 聚合失败（按空处理）：${describe(error)}`);
    }
    for (const section of sections) {
      if (section.pageId !== pageId) {
        continue;
      }
      for (const update of section.updates) {
        push(update.opId, section.pageId, update.updateB64);
      }
    }

    // ② 账本 crdt_update op（真相层；listAll 即 seq 升序 ≈ 到账序）
    const data = await this.executor.all('opLedger.listAll', {});
    for (const row of data.rows) {
      const json = (row as { op_json?: unknown }).op_json;
      if (typeof json !== 'string') {
        continue;
      }
      let op: Op;
      try {
        op = decodeLedgerOp(json);
      } catch {
        continue; // 非法行跳过（账本校验另有兜底）
      }
      if (op.kind !== 'crdt_update' || op.target.table !== 'page' || op.target.id !== pageId) {
        continue;
      }
      const payloadPageId = op.payload['pageId'];
      const updateB64 = op.payload['updateB64'];
      if (typeof payloadPageId !== 'string' || typeof updateB64 !== 'string') {
        continue;
      }
      const entryPageId = payloadPageId.length > 0 ? payloadPageId : op.target.id;
      if (entryPageId !== pageId) {
        continue; // payload.pageId 与目标页不符（跨页条目绝不进本页）
      }
      push(op.op_id, entryPageId, updateB64);
    }
    return entries;
  }

  // --- 诊断 -------------------------------------------------------------------

  /** 页缓存持有数（测试/诊断）。 */
  get size(): number {
    return this.pages.size;
  }

  /** 页的 hub 实例（未持有 → undefined；测试/诊断面）。 */
  get(pageId: string): YjsEditor | undefined {
    return this.pages.get(pageId);
  }

  has(pageId: string): boolean {
    return this.pages.has(pageId);
  }

  /** 全量释放（app 退出）。逐页 flush + destroy（幂等）。 */
  dispose(): void {
    for (const [pageId, editor] of this.pages) {
      editor.sync();
      editor.destroy();
      this.pages.delete(pageId);
    }
  }
}

/** 播种条目 → YjsEditor 构造注入的 CrdtUpdateEntry（core 契约外形）。 */
function toCrdtEntry(entry: CollabUpdateEntry): CrdtUpdateEntry {
  return {
    opId: entry.opId,
    target: { table: 'page', id: entry.pageId },
    pageId: entry.pageId,
    updateB64: entry.updateB64,
  };
}

function decodeLedgerOp(json: string): Op {
  // 复用 core 的 decodeOp 校验（op.ts 经 @septcats/core 出口）；失败抛出由调用方跳过
  return decodeOp(json);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- IPC 注册（collab:attach / collab:detach / collab:apply；collab:update 为推流） --

/** ipcMain.handle 的最小注册面（sync/ipc.ts 同款）。 */
export interface CollabIpcRegistrar {
  handle(channel: string, listener: (raw: unknown) => Promise<unknown>): void;
}

export interface CollabIpcOptions {
  registrar: CollabIpcRegistrar;
  /** hub 访问口（DB 启动失败时回 null → 统一 E_INVARIANT）。 */
  getHub: () => CollabHub | null;
}

function readPageId(raw: unknown): string {
  const pageId = (raw as { pageId?: unknown } | null)?.pageId;
  if (typeof pageId !== 'string' || pageId.length === 0) {
    throw new PagesApiError('E_MALFORMED', 'pageId 必须是非空字符串');
  }
  return pageId;
}

function readUplink(raw: unknown): CollabUplinkInput {
  const input = (raw ?? {}) as Record<string, unknown>;
  const pageId = readPageId(input);
  const updateB64 = input['updateB64'];
  if (typeof updateB64 !== 'string' || updateB64.length === 0) {
    throw new PagesApiError('E_MALFORMED', 'updateB64 必须是非空字符串');
  }
  const svFromB64 = input['svFromB64'];
  if (svFromB64 !== undefined && (typeof svFromB64 !== 'string' || svFromB64.length === 0)) {
    throw new PagesApiError('E_MALFORMED', 'svFromB64 必须是非空字符串');
  }
  return svFromB64 === undefined
    ? { pageId, updateB64 }
    : { pageId, updateB64, svFromB64 };
}

/** 注册 collab 三通道（main/index.ts 调用；hub 缺失时统一回 E_INVARIANT）。 */
export function registerCollabIpc(options: CollabIpcOptions): void {
  const requireHub = (): CollabHub => {
    const hub = options.getHub();
    if (hub === null) {
      throw new PagesApiError('E_INVARIANT', '协作服务不可用（数据库服务启动失败，见日志）');
    }
    return hub;
  };

  options.registrar.handle(CHANNEL_COLLAB_ATTACH, async (raw: unknown): Promise<CollabAttachResult> => {
    return requireHub().attach(readPageId(raw));
  });

  options.registrar.handle(CHANNEL_COLLAB_DETACH, async (raw: unknown): Promise<{ ok: true }> => {
    requireHub().detach(readPageId(raw));
    return { ok: true };
  });

  options.registrar.handle(CHANNEL_COLLAB_APPLY, async (raw: unknown): Promise<{ ok: true }> => {
    await requireHub().applyUplink(readUplink(raw));
    return { ok: true };
  });
}
