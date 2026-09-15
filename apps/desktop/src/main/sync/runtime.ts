/**
 * main/sync/runtime.ts —— 同步运行时（TASK-T13-01 §1/§2，计划书 §8.3 的运行时实现）。
 *
 * 铁律：攒段/合并/manifest/快照/GC 全部复用 @septcats/sync 的函数
 * （SegmentBuilder / publishSegment / mergeRemote / encode+decodeManifest /
 * mergeManifest / planSnapshot / buildSnapshotText / publishSnapshot / planCleanup），
 * 本文件只做**接线**：定时器、watcher、op_ledger 读写、状态机，绝不重写同步算法。
 *
 * 时序（任务书 §2 逐条）：
 * - 启动：读 manifest → （空账本且有快照 → 播种）→ 全量 mergeRemote → 新 op 落
 *   op_ledger（对账本做 Lamport 幂等过滤，等值/落后的远端 op 跳过，修复 S5 播种后
 *   旧段等 lamport 的 op_id 决胜漂移）→ ledger 计数校验，不一致 → 以段重建
 *   （log E_PROJECTION_REBUILT，不崩）；
 * - 写入：onCommitted（bridge 注入）→ SegmentBuilder → 满策略立即发，否则 15s 空闲
 *   flush → publishSegment（ifAbsent 幂等）；
 * - 收：watch（fs.watch 去抖 2s）与 60s 定时双触发 → mergeRemote → commitOps 增量
 *   物化；坏段搬 quarantine/（自愈后不再重试）；
 * - 断链：probe 失败 → state=degraded，本地写入照常（红条由 UI 消费 state）；
 * - manifest 心跳：每轮 merge 后 读远端 → mergeManifest → 更新本机水位 → 回写；
 * - 快照折叠：段数 > maxKeepSegs → planSnapshot → publishSnapshot（seq+1）；
 * - gc：planCleanup 产清单；设置开启才真删（dry-run 默认），只删被全设备水位越过的
 *   过期段与 quarantine/ 内容。
 */

import { mkdirSync } from 'node:fs';
import {
  SCHEMA_VERSION,
  compareLamport,
  decodeOp,
  decodeSegment,
  snapshotToOps,
  type ActorId,
  type Lamport,
  type Op,
  type Segment,
} from '@septcats/core';
import {
  SyncErrorCodes,
  buildSnapshotText,
  decodeManifest,
  encodeManifest,
  mergeManifest,
  mergeRemote,
  parseSegmentFileName,
  planCleanup,
  planSnapshot,
  publishSegment,
  publishSnapshot,
  SegmentBuilder,
  type Manifest,
  type SyncReport,
  type WritePolicy,
} from '@septcats/sync';
import { NodeFs } from '@septcats/sync';
import { commitOps } from '../commit';
import type { AllData, BatchData, DbBatchStatement, GetData } from '../../db/rpc';
import type { SyncStatusSnapshot, SyncDeviceEntry, SyncErrorEntry, SyncRuntimeState } from '../../shared/sync';
import { E_SYNC_KEY_MISMATCH, SyncKeyError, EncryptingSyncFs } from './crypto';
import type { SyncKeyring } from './keyring';
import { FsWatchProvider } from './provider';

/** 运行时所需的数据库面（DbHandle 结构上满足；测试注入假实现）。 */
export interface SyncDbAdapter {
  all(sqlId: string, params?: unknown): Promise<AllData>;
  get(sqlId: string, params?: unknown): Promise<GetData>;
  batch(stmts: readonly DbBatchStatement[]): Promise<BatchData>;
  /** 以段重建本地库（一致性校验失败时的自愈路径；缺省则只记日志）。 */
  rebuildFromSegments?(segmentsJson: string): Promise<{ segments: number; ops: number; entities: number }>;
}

export interface SyncRuntimeOptions {
  /** 同步文件夹绝对路径（layout.root/sync）。 */
  rootDir: string;
  db: SyncDbAdapter;
  actor: ActorId;
  /** 远端 op 物化的目标工作区；活动工作区可随切换变化，故允许动态解析。 */
  workspaceId: string | (() => string | Promise<string>);
  clientVer: string;
  keyring: SyncKeyring;
  /** 加密开关（每轮从设置读取）。 */
  encryptEnabled: () => boolean;
  /** gc 真删开关（每轮从设置读取；false = dry-run 只计数）。 */
  gcEnabled: () => boolean;
  /** 初始启停（settings.sync.enabled；之后经 setEnabled 动态切换）。 */
  enabled?: boolean;
  /** 墙上时间（测试注入）。 */
  now?: () => number;
  /** 攒段空闲 flush（默认 15000，任务书 §1）。 */
  idleFlushMs?: number;
  /** 全量 merge 周期（默认 60000，任务书 §1）。 */
  mergeIntervalMs?: number;
  /** watch 去抖（默认 2000，透传 FsWatchProvider）。 */
  watchDebounceMs?: number;
  /** 快照折叠的段数上限（默认 20）。 */
  maxKeepSegs?: number;
  /** 攒段策略（默认 DEFAULT_WRITE_POLICY）。 */
  policy?: WritePolicy;
  log?: (line: string) => void;
}

export interface SyncRuntimeEvents {
  onState(listener: (status: SyncStatusSnapshot) => void): () => void;
}

const MAX_ERRORS = 10;
const DEFAULT_MAX_KEEP_SEGS = 20;
const DEFAULT_RETENTION_DAYS = 30;

/** 稳定错误码（运行时面新增；E_SYNC_KEY_MISMATCH 定义在 crypto.ts）。 */
export const SYNC_RUNTIME_ERRORS = {
  DIR_UNAVAILABLE: 'E_SYNC_DIR_UNAVAILABLE',
  CYCLE_FAILED: 'E_SYNC_CYCLE_FAILED',
  PUBLISH_FAILED: 'E_SYNC_PUBLISH_FAILED',
  MANIFEST_INVALID: SyncErrorCodes.MANIFEST_INVALID,
  PROJECTION_REBUILT: 'E_PROJECTION_REBUILT',
  KEY_MISMATCH: E_SYNC_KEY_MISMATCH,
} as const;

export class SyncRuntime {
  private readonly rootDir: string;
  private readonly db: SyncDbAdapter;
  private readonly actor: ActorId;
  private readonly clientVer: string;
  private readonly keyring: SyncKeyring;
  private readonly encryptEnabled: () => boolean;
  private readonly gcEnabled: () => boolean;
  private readonly nowFn: () => number;
  private readonly idleFlushMs: number;
  private readonly mergeIntervalMs: number;
  private readonly watchDebounceMs: number;
  private readonly maxKeepSegs: number;
  private readonly log: (line: string) => void;

  private readonly rawFs: NodeFs;
  private readonly encFs: EncryptingSyncFs;
  private provider: FsWatchProvider | null = null;
  private readonly workspaceIdFn: string | (() => string | Promise<string>);

  private readonly builder: SegmentBuilder;
  private readonly seenContentHashes = new Set<string>();
  private dek: Uint8Array | null = null;

  private manifest: Manifest;
  private pendingPublish: Segment | null = null;
  private lastReport: SyncReport | null = null;

  private enabled: boolean;

  private state: SyncRuntimeState = 'idle';
  private lastSyncAt: number | null = null;
  private readonly errors: SyncErrorEntry[] = [];
  private conflictCount = 0;
  private readonly stateListeners = new Set<(status: SyncStatusSnapshot) => void>();

  private mergeTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private unwatch: (() => void) | null = null;
  private cycleRunning = false;
  private cycleQueued = false;
  private firstCycleDone = false;

  constructor(options: SyncRuntimeOptions) {
    this.rootDir = options.rootDir.replace(/\\/g, '/').replace(/\/+$/, '');
    this.db = options.db;
    this.actor = options.actor;
    this.clientVer = options.clientVer;
    this.keyring = options.keyring;
    this.encryptEnabled = options.encryptEnabled;
    this.gcEnabled = options.gcEnabled;
    this.nowFn = options.now ?? Date.now;
    this.idleFlushMs = options.idleFlushMs ?? 15_000;
    this.mergeIntervalMs = options.mergeIntervalMs ?? 60_000;
    this.watchDebounceMs = options.watchDebounceMs ?? 2_000;
    this.maxKeepSegs = options.maxKeepSegs ?? DEFAULT_MAX_KEEP_SEGS;
    this.log = options.log ?? (() => undefined);
    this.enabled = options.enabled ?? true;
    this.workspaceIdFn = options.workspaceId;
    this.rawFs = new NodeFs();
    this.encFs = new EncryptingSyncFs({
      inner: this.rawFs,
      rootDir: this.rootDir,
      enabled: (): boolean => this.encryptEnabled() && this.dek !== null,
      dek: (): Uint8Array | null => this.dek,
    });
    this.builder = new SegmentBuilder(options.actor, options.policy);
    this.manifest = {
      schema_ver: SCHEMA_VERSION,
      created_at: this.nowFn(),
      updated_at: this.nowFn(),
      devices: {},
      snapshot: { seq: 0, lamport: 0, covers_through: 0 },
      retention_days: DEFAULT_RETENTION_DAYS,
      segment_watermark: 0,
    };
  }

  // --- 状态面 ---------------------------------------------------------------

  getStatus(): SyncStatusSnapshot {
    const devices: SyncDeviceEntry[] = Object.entries(this.manifest.devices).map(([actorId, info]) => ({
      actorId,
      lastLamport: info.last_lamport,
      lastSeenAt: info.last_seen_at,
      clientVer: info.client_ver,
    }));
    devices.sort((a, b) => a.actorId.localeCompare(b.actorId));
    return {
      state: this.state,
      enabled: this.enabled,
      lastSyncAt: this.lastSyncAt,
      devices,
      pendingOps: this.builder.pendingCount,
      pendingSegs: this.pendingPublish === null ? 0 : 1,
      conflicts: this.conflictCount,
      errors: [...this.errors],
    };
  }

  onState(listener: (status: SyncStatusSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private setState(next: SyncRuntimeState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.emit();
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.stateListeners) {
      listener(status);
    }
  }

  private recordError(code: string, message: string): void {
    this.errors.push({ code, message, at: this.nowFn() });
    if (this.errors.length > MAX_ERRORS) {
      this.errors.splice(0, this.errors.length - MAX_ERRORS);
    }
    this.log(`[${code}] ${message}`);
  }

  // --- 生命周期 -------------------------------------------------------------

  /** 启动：建目录 → 读 DEK → 起 watcher 与定时器 → 首轮 merge。 */
  async start(): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
    if (this.encryptEnabled()) {
      try {
        this.dek = await this.keyring.ensureDek();
      } catch (error) {
        this.dek = null;
        this.recordError(
          SYNC_RUNTIME_ERRORS.KEY_MISMATCH,
          `同步密钥不可用，加密段将无法读写：${describe(error)}`,
        );
      }
    }
    this.provider = new FsWatchProvider({
      fs: this.encFs,
      watchDir: this.rootDir,
      debounceMs: this.watchDebounceMs,
    });
    await this.provider.init(this.rootDir);
    this.unwatch = this.provider.watch(() => {
      void this.runCycle();
    });
    if (this.enabled) {
      this.mergeTimer = setInterval(() => {
        void this.runCycle();
      }, this.mergeIntervalMs);
    }
    this.setState('syncing');
    await this.runCycle();
  }

  /** 停止：清定时器、摘 watcher（进程退出或 setEnabled(false) 时调用）。 */
  stop(): void {
    if (this.mergeTimer !== null) {
      clearInterval(this.mergeTimer);
      this.mergeTimer = null;
    }
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.unwatch?.();
    this.unwatch = null;
  }

  /** 同步启停（sync:setEnabled）：停掉触发源，状态回 idle；开启则立即跑一轮。 */
  async setEnabled(on: boolean): Promise<void> {
    if (this.enabled === on) {
      return;
    }
    this.enabled = on;
    if (!on) {
      this.stop();
      this.setState('idle');
      return;
    }
    this.setState('syncing');
    this.mergeTimer = setInterval(() => {
      void this.runCycle();
    }, this.mergeIntervalMs);
    this.unwatch = this.provider?.watch(() => {
      void this.runCycle();
    }) ?? null;
    await this.runCycle();
  }

  // --- 写入路径（bridge 注入） ----------------------------------------------

  /** 本地 commitOps 成功后的钩子（bridge.ts 调用）：op 进攒段器，按策略发布。 */
  onLocalCommit(ops: readonly Op[]): void {
    if (!this.enabled) {
      return;
    }
    for (const op of ops) {
      this.builder.add(op);
    }
    // 硬条件（条数/字节/时钟跨度）立即发；否则排 15s 空闲 flush。
    // shouldFlush 的空闲分支用「atMs = -∞」固定为假，只剩硬条件。
    if (this.pendingHardLimit()) {
      void this.flushAndPublish();
      return;
    }
    this.scheduleIdleFlush();
  }

  private pendingHardLimit(): boolean {
    return this.builder.shouldFlush(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
  }

  /** 活动工作区解析（字符串直通 / 函数逐轮求值）。 */
  private async resolveWorkspaceId(): Promise<string> {
    return typeof this.workspaceIdFn === 'function' ? await this.workspaceIdFn() : this.workspaceIdFn;
  }

  private scheduleIdleFlush(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.flushAndPublish();
    }, this.idleFlushMs);
  }

  /** 攒段 flush → publishSegment（ifAbsent 幂等；失败暂存下一轮重试，不丢数据）。 */
  async flushAndPublish(): Promise<void> {
    const fresh = this.builder.flush();
    const queue: Segment[] = this.pendingPublish === null ? [] : [this.pendingPublish];
    this.pendingPublish = null;
    if (fresh !== null) {
      queue.push(fresh);
    }
    for (const seg of queue) {
      try {
        await publishSegment(this.encFs, '', seg);
      } catch (error) {
        this.pendingPublish = seg;
        this.recordError(SYNC_RUNTIME_ERRORS.PUBLISH_FAILED, `段发布失败（下轮重试）：${describe(error)}`);
        return; // 后续段下轮一并补发（顺序由 (c_from,dev,n) 保证，不受影响）
      }
    }
    this.emit();
  }

  // --- 收段主循环 -----------------------------------------------------------

  /** 立即跑一轮（sync:now；watcher/定时器内部也走这里）。并发触发合并为一轮。 */
  async runCycle(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    if (this.cycleRunning) {
      this.cycleQueued = true;
      return;
    }
    this.cycleRunning = true;
    if (this.state === 'ok' || this.state === 'idle') {
      this.setState('syncing');
    }
    try {
      const outcome = await this.cycleBody();
      if (outcome === 'ok') {
        this.lastSyncAt = this.nowFn();
        this.setState('ok');
      } else {
        this.setState(outcome); // 'degraded' | 'error'（错误细节已在 errors[]）
      }
    } catch (error) {
      this.recordError(SYNC_RUNTIME_ERRORS.CYCLE_FAILED, `同步轮失败：${describe(error)}`);
      this.setState('error');
    } finally {
      this.cycleRunning = false;
      this.emit();
      if (this.cycleQueued) {
        this.cycleQueued = false;
        void this.runCycle();
      }
    }
  }

  /** 一轮主体；返回终态（'ok' | 'degraded' | 'error'）。 */
  private async cycleBody(): Promise<SyncRuntimeState> {
    const now = this.nowFn();

    // 加密开关动态生效：开启且无 DEK → 现取（用户中途打开开关）
    if (this.encryptEnabled() && this.dek === null) {
      try {
        this.dek = await this.keyring.ensureDek();
      } catch (error) {
        this.recordError(
          SYNC_RUNTIME_ERRORS.KEY_MISMATCH,
          `同步密钥不可用：${describe(error)}`,
        );
      }
    }

    // S7 断链：probe 失败 → degraded + 本地写入照常（flush 照发，失败进重试暂存）
    const probe = await this.provider?.probe();
    if (probe !== undefined && !probe.ok) {
      this.recordError(
        SYNC_RUNTIME_ERRORS.DIR_UNAVAILABLE,
        `同步文件夹不可访问（${probe.reason ?? 'unknown'}），本地写入不受影响`,
      );
      await this.flushAndPublish();
      return 'degraded';
    }

    // manifest：坏/缺失 → 降级为本地默认（不崩）
    await this.loadManifest(now);

    // S5 播种：空账本 + 有快照 → 从最新快照回转 upsert op 落库
    const ledgerBefore = await this.loadLedgerOps();
    if (ledgerBefore.length === 0) {
      await this.seedFromSnapshot();
    }

    // 全量 mergeRemote（复用引擎；.enc 解密在 EncryptingSyncFs 内）
    const ledger = await this.loadLedgerOps();
    let report: SyncReport;
    try {
      report = await mergeRemote({
        provider: this.provider!,
        localLedger: ledger,
        seenContentHashes: this.seenContentHashes,
        now,
      });
    } catch (error) {
      if (error instanceof SyncKeyError) {
        this.recordError(SYNC_RUNTIME_ERRORS.KEY_MISMATCH, error.message);
        return 'error';
      }
      throw error;
    }
    this.lastReport = report;
    this.conflictCount += report.conflicts.length;

    // 新 op 落账本：对账本做 Lamport 幂等过滤（等值/落后跳过——修复 S5 播种后
    // 旧段与本机等 lamport op 的 op_id 决胜漂移；超过本地水位的 op 才值得重放）
    const applied = filterAgainstLedger(report.applied, ledger);
    if (applied.length > 0) {
      await commitOps(this.db, applied, { workspaceId: await this.resolveWorkspaceId() });
    }

    // S2 自愈：坏段搬 quarantine/，下轮不再重试
    await this.quarantine(report);

    // 攒段 flush（定时轮也兜底发布）
    await this.flushAndPublish();

    // 首轮：ledger 计数一致性校验（不一致 → 以段重建，log E_PROJECTION_REBUILT）
    if (!this.firstCycleDone) {
      this.firstCycleDone = true;
      await this.verifyLedgerIntegrity(ledger.length + applied.length);
    }

    // 快照折叠 + gc 计划（复用引擎；gc 真删需设置开启）
    await this.foldSnapshotAndGc(now);

    // manifest 心跳：读远端 → mergeManifest → 更新本机水位 → 回写
    await this.heartbeat(now);
    return 'ok';
  }

  private async loadManifest(now: number): Promise<void> {
    try {
      const text = await this.encFs.read('manifest.json');
      const decoded = decodeManifest(text);
      if (decoded === null) {
        this.recordError(SYNC_RUNTIME_ERRORS.MANIFEST_INVALID, 'manifest.json 非法，降级为本地默认');
        return;
      }
      this.manifest = decoded;
    } catch {
      // 无 manifest（新目录）→ 保持本地默认；created_at 已在构造时定
      this.manifest.updated_at = Math.max(this.manifest.updated_at, now);
    }
  }

  private async loadLedgerOps(): Promise<Op[]> {
    const data = await this.db.all('opLedger.listAll', {});
    const ops: Op[] = [];
    for (const row of data.rows) {
      const json = (row as { op_json?: unknown }).op_json;
      if (typeof json === 'string') {
        try {
          ops.push(decodeOp(json));
        } catch (error) {
          this.recordError(SYNC_RUNTIME_ERRORS.CYCLE_FAILED, `op_ledger 存在非法 op：${describe(error)}`);
        }
      }
    }
    return ops;
  }

  /** 空账本且有快照 → 用最新快照播种（S5）。 */
  private async seedFromSnapshot(): Promise<void> {
    const provider = this.provider;
    if (provider === null) {
      return;
    }
    const snapshots = await provider.listSnapshots();
    if (snapshots.length === 0) {
      return;
    }
    const newest = [...snapshots].sort((a, b) => seqOf(b.file) - seqOf(a.file))[0];
    if (newest === undefined) {
      return;
    }
    const text = await provider.get(newest.file);
    if (text === null) {
      return;
    }
    try {
      const seedOps = snapshotToOps(text, this.actor);
      if (seedOps.length > 0) {
        await commitOps(this.db, seedOps, { workspaceId: await this.resolveWorkspaceId() });
        this.log(`S5 播种：从 ${newest.file} 回转 ${String(seedOps.length)} 条 op`);
      }
    } catch (error) {
      this.recordError(SYNC_RUNTIME_ERRORS.CYCLE_FAILED, `快照播种失败：${describe(error)}`);
    }
  }

  private async quarantine(report: SyncReport): Promise<void> {
    for (const entry of report.quarantined) {
      try {
        mkdirSync(`${this.rootDir}/quarantine`, { recursive: true });
        const raw = await this.rawFs.read(`${this.rootDir}/${entry.file}`);
        await this.rawFs.write(`${this.rootDir}/quarantine/${entry.file}`, raw, { ifAbsent: true });
        await this.rawFs.remove(`${this.rootDir}/${entry.file}`);
        this.log(`坏段已隔离：${entry.file}（${entry.reason}）`);
      } catch (error) {
        this.recordError(SYNC_RUNTIME_ERRORS.CYCLE_FAILED, `隔离坏段失败：${entry.file} ${describe(error)}`);
      }
    }
  }

  /** 首轮 ledger 计数校验；不一致 → rebuildFromSegments 以段重建（不崩）。 */
  private async verifyLedgerIntegrity(expectedTotal: number): Promise<void> {
    if (this.db.rebuildFromSegments === undefined) {
      return;
    }
    const counted = await this.db.get('opLedger.count', {});
    const n = (counted.row as { n?: unknown } | null)?.n;
    if (typeof n === 'number' && n === expectedTotal) {
      return;
    }
    this.log(
      `E_PROJECTION_REBUILT op_ledger 计数偏移（${String(n)} ≠ ${String(expectedTotal)}），以合并后段重建`,
    );
    try {
      const segs = await this.collectSegments();
      await this.db.rebuildFromSegments(JSON.stringify(segs));
    } catch (error) {
      this.recordError(SYNC_RUNTIME_ERRORS.CYCLE_FAILED, `段重建失败：${describe(error)}`);
    }
  }

  /** 收集同步目录里全部可解码段（重建用；坏段已隔离，解不开的跳过）。 */
  private async collectSegments(): Promise<Segment[]> {
    const provider = this.provider;
    if (provider === null) {
      return [];
    }
    const segs: Segment[] = [];
    for (const { file } of await provider.listSegments()) {
      const text = await provider.get(file);
      if (text === null) {
        continue;
      }
      try {
        segs.push(decodeSegment(text));
      } catch {
        // 解不开的段不进重建集
      }
    }
    return segs;
  }

  /** 快照折叠（段数 > maxKeepSegs）+ gc 计划执行（dry-run 默认）。 */
  private async foldSnapshotAndGc(now: number): Promise<void> {
    const provider = this.provider;
    if (provider === null) {
      return;
    }
    const listed = await provider.listSegments();
    const segs: Segment[] = [];
    const candidates: Array<{ file: string; cTo: number; dev: ActorId }> = [];
    for (const { file } of listed) {
      const text = await provider.get(file);
      if (text === null) {
        continue;
      }
      let seg: Segment;
      try {
        seg = decodeSegment(text);
      } catch {
        continue; // 本轮隔离路径已处理
      }
      segs.push(seg);
      const info = parseSegmentFileName(file);
      if (info !== null) {
        candidates.push({ file, cTo: seg.header.c_to, dev: info.dev });
      }
    }

    // 快照折叠：段数超限 → plan → publish(seq+1) → 水位推进
    const plan = planSnapshot(segs, this.manifest, this.maxKeepSegs);
    if (plan !== null) {
      const seq = this.manifest.snapshot.seq + 1;
      const text = buildSnapshotText(segs, plan.through, this.actor);
      await publishSnapshot(this.encFs, '', seq, text);
      this.manifest.snapshot = { seq, lamport: plan.through, covers_through: plan.through };
      this.log(`快照折叠：snapshot-${String(seq).padStart(6, '0')} covers_through=${String(plan.through)}`);
    }

    // gc：引擎产清单（双门：retention + 全设备水位）；设置开启才真删
    const watermarks = new Map<ActorId, number>();
    for (const [dev, info] of Object.entries(this.manifest.devices)) {
      watermarks.set(dev as ActorId, info.last_lamport);
    }
    const removable = planCleanup(this.manifest, candidates, watermarks, now);
    if (removable.length === 0) {
      return;
    }
    if (!this.gcEnabled()) {
      this.log(`gc dry-run：${String(removable.length)} 个过期段可删（设置未开启）`);
      return;
    }
    for (const file of removable) {
      await this.encFs.remove(file);
    }
    // quarantine/ 清理（一并归 gc 管；目录缺失按空处理）
    let quarantined: string[] = [];
    try {
      quarantined = await this.rawFs.list(`${this.rootDir}/quarantine`);
    } catch {
      quarantined = [];
    }
    for (const name of quarantined) {
      await this.rawFs.remove(`${this.rootDir}/quarantine/${name}`);
    }
    this.log(`gc：已清理 ${String(removable.length)} 个过期段与 quarantine/`);
  }

  /** manifest 心跳：远端读 → 合并 → 本机水位 → 回写（最后一次写者胜，读侧 merge 兜底）。 */
  private async heartbeat(now: number): Promise<void> {
    let merged = this.manifest;
    try {
      const remoteText = await this.encFs.read('manifest.json');
      const remote = decodeManifest(remoteText);
      if (remote !== null) {
        merged = mergeManifest(merged, remote);
      }
    } catch {
      // 无远端 manifest：用本地
    }
    const ledgerMax = await this.db.get('opLedger.maxLamport', {});
    const maxC = (ledgerMax.row as { c?: unknown } | null)?.c;
    const localWatermark = typeof maxC === 'number' ? maxC : 0;
    merged.devices[this.actor] = {
      last_lamport: Math.max(merged.devices[this.actor]?.last_lamport ?? 0, localWatermark),
      last_seen_at: now,
      client_ver: this.clientVer,
    };
    merged.updated_at = Math.max(merged.updated_at, now);
    merged.segment_watermark = Math.max(
      merged.segment_watermark,
      localWatermark,
      merged.devices[this.actor]?.last_lamport ?? 0,
    );
    this.manifest = merged;
    await this.encFs.write('manifest.json', encodeManifest(merged));
  }

  /** 测试/诊断：最近一轮 merge 报告。 */
  getLastReport(): SyncReport | null {
    return this.lastReport;
  }
}

// --- 模块级工具 ---------------------------------------------------------------

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function seqOf(name: string): number {
  const m = /^snapshot-(\d{6})\.json/.exec(name);
  return m === null ? 0 : parseInt(m[1] ?? '0', 10);
}

/**
 * 对账本的 Lamport 幂等过滤：目标已有 lamport >= 该 op 的本地 op → 跳过。
 * 这是「复用 core 幂等：已在账本的 op 跳过」的 lamport 维度扩展——op_id 过滤已由
 * mergeRemote 做（applied 只含本地没有的 op_id），这里补上「语义等值 op」过滤，
 * 消除 S5 播种后旧段与本机等 lamport op 的决胜漂移。
 */
function filterAgainstLedger(applied: readonly Op[], ledger: readonly Op[]): Op[] {
  if (applied.length === 0) {
    return [];
  }
  const watermark = new Map<string, Lamport>();
  for (const op of ledger) {
    const key = `${op.target.table}/${op.target.id}`;
    const current = watermark.get(key);
    if (current === undefined || compareLamport(op.lamport, current) > 0) {
      watermark.set(key, op.lamport);
    }
  }
  return applied.filter((op) => {
    const current = watermark.get(`${op.target.table}/${op.target.id}`);
    return current === undefined || compareLamport(current, op.lamport) < 0;
  });
}
