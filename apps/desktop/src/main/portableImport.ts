/**
 * main/portableImport.ts —— 主进程「便携包导入」服务（R28 · TASK-T80-02 §1/§2）。
 *
 * 形状照导出侧（`main/portable.ts`）：**plan 只读（清点 + checksums 全验 + 目标库
 * 覆盖度预检，零落盘）→ execute（confirm:true 才落库）→ 取消 = 零落盘**。
 *
 * execute = **换库三段式**（任务书 §1）：
 *   ① 备份现库：`checkpoint(TRUNCATE)` → 拷三件套为 `<db>.bak-portable-<ts>`；
 *      **备份不成即抛，绝不进入 ②（红线：禁静默覆盖现库，无备份不落库）**；
 *   ② 建新库重放：包内段解码 → 段数自检（== manifest.segments）→
 *      `rebuildFromSegments(json, 'replace')`（**显式 replace**，T82-01 H-04 硬要求；
 *      `REBUILD_CLEAR_SQL` 把 6 张表清空 = 「新库态」，不造第二套重建逻辑）；
 *   ③ 失败回滚：还原备份三件套（migrations 同款：先清 sidecar → 覆写主库字节），
 *      逐字节还原后抛**结构化**错误码；还原本身失败 → `E_PORTABLE_ROLLBACK_FAILED`。
 *
 * 停机边界：db 进程**不重启**（重放走既有 RPC，服务持有的 executor 全程有效）；
 * 同步运行时经注入的 `pauseSync` / `resumeSync` 停启（既有 `stop()` / `start()`）。
 *
 * 纪律：不 import electron（目录/文件对话框经 DI 注入）；zip 容器只在这里碰 fflate
 * （packages 侧保持纯逻辑）；不动 T80-01 已收口的导出面。
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeSegment, type Segment } from '@septcats/core';
import { unzipSync } from 'fflate';
import {
  PORTABLE_MANIFEST_NAME,
  assertPortableImportEntryNames,
  assertPortableSegmentCount,
  classifyPortableEntry,
  isPortableEncrypted,
  parsePortableManifest,
  portableAttachmentNames,
  portableBackupPlan,
  portableChecksumsOk,
  portableRestorePlan,
  portableSchemaCompatible,
  portableSegmentNames,
  verifyPortableChecksums,
  type PortableBackupFile,
  type PortableManifest,
} from '@septcats/sync';
import {
  CHANNEL_PORTABLE_IMPORT_EXECUTE,
  CHANNEL_PORTABLE_IMPORT_PLAN,
  CHANNEL_PORTABLE_IMPORT_REVERT,
} from '../shared/ipc';
import type {
  PortableImportExecuteResponse,
  PortableImportInput,
  PortableImportPlan,
  PortableImportPlanResponse,
  PortableImportResult,
  PortableImportRevertInput,
  PortableImportRevertResult,
} from '../shared/portable';

// 契约类型单一来源在 shared/portable.ts（renderer 侧直接 import 该文件，不引本实现）
export type {
  PortableImportBlock,
  PortableImportCanceled,
  PortableImportExecuteResponse,
  PortableImportInput,
  PortableImportManifestSummary,
  PortableImportPlan,
  PortableImportPlanResponse,
  PortableImportResult,
  PortableImportRevertInput,
  PortableImportRevertResult,
} from '../shared/portable';

// ---------------------------------------------------------------------------
// 错误（与 PortableExportApiError 同形）
// ---------------------------------------------------------------------------

export type PortableImportErrorCode =
  | 'E_MALFORMED'
  | 'E_INVARIANT'
  /** 半截 zip / 非 zip / 包不可读 —— 结构化拒绝，禁未捕获异常。 */
  | 'E_PORTABLE_BAD_ZIP'
  /** 缺清单 / 非本格式 / 格式版本过高。 */
  | 'E_PORTABLE_BAD_MANIFEST'
  /** checksums 任一不合（缺/多/字节或 sha256 不符）→ 整体拒绝，不建库。 */
  | 'E_PORTABLE_CHECKSUM'
  /** 段文本解码失败（非法段 / schema_ver 不符）。 */
  | 'E_PORTABLE_BAD_SEGMENT'
  /** 包内段数与 manifest.segments 不符（H-04 P0：缺段重放 = 静默抹数据）。 */
  | 'E_PORTABLE_SEGMENT_COUNT'
  /** 包来自更新版本的应用（包内 schema 版本 > 当前）。 */
  | 'E_PORTABLE_SCHEMA_NEWER'
  /** 目标库存在包未覆盖的 op（冲突预检：**不 merge**，拒）。 */
  | 'E_PORTABLE_NOT_EMPTY'
  /** 备份失败 —— 无备份即不落库。 */
  | 'E_PORTABLE_BACKUP_FAILED'
  /** 回滚失败（还原备份时出错）—— 数据面最高级告警。 */
  | 'E_PORTABLE_ROLLBACK_FAILED'
  /** v1 硬闸：加密包不支持导入（DEK 机器绑定，跨机不可解）。 */
  | 'E_PORTABLE_ENCRYPTED_UNSUPPORTED'
  /**
   * T80-04（H-09）：文件级还原成功后**重建数据库连接失败**（数据面已还原，但
   * 连接未恢复）。独立于 E_PORTABLE_ROLLBACK_FAILED（那是「还原本身失败」）。
   */
  | 'E_PORTABLE_REOPEN_FAILED'
  /**
   * T80-04（H-08）：execute 前的强制封段失败 → 无法确认缓冲已落账，拒绝导入。
   */
  | 'E_PORTABLE_FLUSH_FAILED'
  /** zip slip 同口径条目名（与导出侧 E_ENTRY_NAME 同源）。 */
  | 'E_ENTRY_NAME';

export class PortableImportApiError extends Error {
  readonly code: PortableImportErrorCode;

  constructor(code: PortableImportErrorCode, message: string) {
    super(message);
    this.name = 'PortableImportApiError';
    this.code = code;
    Object.setPrototypeOf(this, PortableImportApiError.prototype);
  }
}

export const PORTABLE_IMPORT_ENCRYPTED_MESSAGE =
  '加密包暂不支持导入（数据密钥绑定原机器，跨机无法解密）';
export const PORTABLE_IMPORT_EMPTY_MESSAGE =
  '当前库里有便携包未覆盖的内容，导入会覆盖它（导入不合并）。请先备份或改用空库导入';
export const PORTABLE_IMPORT_SCHEMA_MESSAGE = '便携包来自更新版本的 Septcats，请升级应用后再导入';
export const PORTABLE_IMPORT_CONFIRM_MESSAGE = 'confirm 必须显式为 true';

/** 回滚是否成功（写进错误对象，供日志/UI 判别数据面状态）。 */
export interface PortableImportRollbackState {
  readonly rolledBack: boolean;
}

export function toPortableImportError(error: unknown): PortableImportApiError {
  if (error instanceof PortableImportApiError) {
    return error;
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (
    code === 'E_ENTRY_NAME' ||
    code === 'E_MALFORMED' ||
    code === 'E_PORTABLE_BAD_MANIFEST' ||
    code === 'E_PORTABLE_BAD_SEGMENT' ||
    code === 'E_PORTABLE_BAD_ZIP' ||
    code === 'E_PORTABLE_CHECKSUM' ||
    code === 'E_PORTABLE_SEGMENT_COUNT'
  ) {
    return new PortableImportApiError(code, error instanceof Error ? error.message : String(error));
  }
  return new PortableImportApiError('E_INVARIANT', error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// IO 注入面（测试用假实现；生产用 node fs）
// ---------------------------------------------------------------------------

export interface PortableImportIo {
  readFile(path: string): Uint8Array;
  exists(path: string): boolean;
  listFiles(dir: string): string[];
  writeFile(path: string, bytes: Uint8Array): void;
  remove(path: string): void;
}

// ---------------------------------------------------------------------------
// Db 端口（生产由 index.ts 用 DbHandle 适配；测试用内存假实现）
// ---------------------------------------------------------------------------

export interface PortableImportReplayData {
  readonly segments: number;
  readonly ops: number;
  readonly entities: number;
  readonly mode: 'replace' | 'merge';
  readonly keptOps: number;
}

export interface PortableImportDb {
  /** 备份前 `PRAGMA wal_checkpoint(TRUNCATE)`（先例 db/migrations.ts:391）。 */
  checkpoint(): Promise<void>;
  /** 本机账本 op_id 全量（覆盖度预检用）。 */
  listLedgerOpIds(): Promise<string[]>;
  /** T82-01：导入侧**必须**显式传 'replace'。 */
  rebuildFromSegments(segmentsJson: string, mode: 'replace'): Promise<PortableImportReplayData>;
  /**
   * T80-04（H-09）：释放主库文件句柄（DbServer 侧 `closeConnection`，进程不杀）。
   * 文件级还原前必须调它，否则 Windows 下删除/覆写主库撞 EBUSY。
   */
  closeConnection(): Promise<void>;
  /** T80-04（H-09）：还原后按原库路径重建连接（`reopenConnection`）。 */
  reopenConnection(): Promise<void>;
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface PortableImportServiceOptions {
  /** 主库文件绝对路径（备份三件套的源；重放目标）。 */
  readonly dbPath: string;
  /** 数据库端口（DbServer 未就绪时整个服务为 null，IPC 统一回 E_INVARIANT）。 */
  readonly db: PortableImportDb;
  /** 当前 SQLite schema 版本（`PRAGMA user_version`）。 */
  readonly schemaVersion: () => Promise<number>;
  /** zipPath / dir 都缺时的文件选择（main 注入系统对话框；取消回 null）。 */
  readonly pickArchive?: () => Promise<string | null>;
  /** 导入期间停机同步（既有 SyncRuntime.stop / start，不造第二套）。 */
  readonly pauseSync?: () => Promise<void>;
  readonly resumeSync?: () => Promise<void>;
  /**
   * T80-04（H-08）：execute 覆盖度预检**前**强制封段（既有
   * `SyncRuntime.flushAndPublish`，照 T80-01 导出侧 `sealSegments` 注入面）。
   * 把同步运行时缓冲里的 op 落进 `op_ledger`，消除「预检看不见未 flush op」的窗口。
   * 未注入（同步未启用/测试）视为无缓冲。
   */
  readonly flushSegments?: () => Promise<void>;
  /**
   * T80-04（H-08）：同步运行时攒段缓冲里「未 flush 的 op_id」只读视图
   * （`SyncRuntime.pendingOpIds`）。覆盖度预检据此把账本与缓冲取并集，
   * 消除预检盲区。未注入视为无缓冲。
   */
  readonly pendingOpIds?: () => readonly string[];
  readonly now?: () => number;
  readonly io?: PortableImportIo;
  readonly log?: (line: string) => void;
}

export interface PortableImportService {
  plan(input: PortableImportInput): Promise<PortableImportPlanResponse>;
  execute(input: PortableImportInput & { readonly confirm?: boolean }): Promise<PortableImportExecuteResponse>;
  revert(input: PortableImportRevertInput): Promise<PortableImportRevertResult>;
}

/** 解包后的包视图（安全闸全过之后才拿到）。 */
interface OpenedPackage {
  readonly zipPath: string;
  readonly entries: Readonly<Record<string, Uint8Array>>;
  readonly manifest: PortableManifest;
  readonly segmentNames: readonly string[];
  readonly segments: readonly Segment[];
  readonly packageOpIds: ReadonlySet<string>;
}

const PORTABLE_ARCHIVE_PREFIX = 'septcats-portable-';
const PORTABLE_ARCHIVE_SUFFIX = '.zip';

/** 目录内「最新」便携包（名字含时间戳，字典序即时间序，确定性）。 */
export function newestPortableArchive(names: readonly string[]): string | null {
  const matched = names
    .filter((name) => name.startsWith(PORTABLE_ARCHIVE_PREFIX) && name.endsWith(PORTABLE_ARCHIVE_SUFFIX))
    .sort();
  return matched.length === 0 ? null : matched[matched.length - 1]!;
}

export function createPortableImportService(
  options: PortableImportServiceOptions,
): PortableImportService {
  const io = options.io ?? nodePortableImportIo;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((): void => undefined);

  // --- 安全闸（plan 与 execute 共用同一份实现，execute 不信任 plan 的结论） ----

  function openPackage(zipPath: string): OpenedPackage {
    let zipBytes: Uint8Array;
    try {
      zipBytes = io.readFile(zipPath);
    } catch (error) {
      throw new PortableImportApiError('E_PORTABLE_BAD_ZIP', `便携包不可读：${describeError(error)}`);
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(zipBytes) as Record<string, Uint8Array>;
    } catch (error) {
      // 半截 zip / 非 zip：结构化拒绝，绝不冒泡成未捕获异常
      throw new PortableImportApiError('E_PORTABLE_BAD_ZIP', `便携包无法解包（半截 zip 或非 zip）：${describeError(error)}`);
    }
    const names = Object.keys(entries);
    // 闸 1：zip slip 同口径（读侧不静默改写条目名）
    gate(() => assertPortableImportEntryNames(names));
    // 闸 2：清单在场且是本格式
    const manifestBytes = entries[PORTABLE_MANIFEST_NAME];
    if (manifestBytes === undefined) {
      throw new PortableImportApiError('E_PORTABLE_BAD_MANIFEST', `包内缺少 ${PORTABLE_MANIFEST_NAME}`);
    }
    const manifest = gate(() => parsePortableManifest(manifestBytes));
    // 闸 3：加密包（DEK 机器绑定，跨机不可解）
    if (isPortableEncrypted(manifest, names)) {
      throw new PortableImportApiError('E_PORTABLE_ENCRYPTED_UNSUPPORTED', PORTABLE_IMPORT_ENCRYPTED_MESSAGE);
    }
    // 闸 4：checksums 全验（任一不合 → 整体拒绝，不建库）
    const checksums = verifyPortableChecksums(entries, manifest);
    if (!portableChecksumsOk(checksums)) {
      throw new PortableImportApiError(
        'E_PORTABLE_CHECKSUM',
        `校验和不符，整包拒绝（不符 ${String(checksums.mismatched.length)} 条 / 缺 ${String(checksums.missing.length)} 条 / 多 ${String(checksums.extra.length)} 条）`,
      );
    }
    // 闸 5：段数自检（H-04 P0：缺段 = replace 重放静默抹数据）
    const segmentNames = portableSegmentNames(names);
    gate(() => assertPortableSegmentCount(segmentNames.length, manifest));
    const segments = decodeSegments(entries, segmentNames);
    const packageOpIds = new Set<string>();
    for (const segment of segments) {
      for (const op of segment.ops) {
        packageOpIds.add(op.op_id);
      }
    }
    return { zipPath, entries, manifest, segmentNames, segments, packageOpIds };
  }

  function decodeSegments(
    entries: Readonly<Record<string, Uint8Array>>,
    names: readonly string[],
  ): Segment[] {
    const segments: Segment[] = [];
    for (const name of names) {
      const bytes = entries[name];
      if (bytes === undefined) {
        throw new PortableImportApiError('E_PORTABLE_BAD_SEGMENT', `段条目缺失：${name}`);
      }
      try {
        segments.push(decodeSegment(new TextDecoder().decode(bytes)));
      } catch (error) {
        throw new PortableImportApiError('E_PORTABLE_BAD_SEGMENT', `段解码失败 ${name}：${describeError(error)}`);
      }
    }
    return segments;
  }

  /**
   * 覆盖度预检：本机 op_id 是否全被包内段覆盖（报告 §0-③）。
   *
   * T80-04（H-08）：本机集合 = **账本 op_id ∪ 攒段缓冲未 flush op_id**
   * （`options.pendingOpIds` 只读 getter；未注入视为空集）。缓冲里的 op 尚未落
   * `op_ledger`，旧实现只读账本会漏判 → run-A/run-B 同序列两次可见性不一致。
   * 并集后「缓冲有 op」在 plan 与 execute 两条路径都必被记为未覆盖（或 execute
   * 的前置封段先把它落账，等效覆盖）。
   */
  async function coverage(zipPath: string, packageOpIds: ReadonlySet<string>): Promise<{
    readonly ledgerOps: number;
    readonly pendingOps: number;
    readonly uncovered: number;
  }> {
    const localOpIds = new Set(await options.db.listLedgerOpIds());
    const ledgerOps = localOpIds.size;
    const buffered = options.pendingOpIds?.() ?? [];
    for (const opId of buffered) {
      localOpIds.add(opId);
    }
    let uncovered = 0;
    for (const opId of localOpIds) {
      if (!packageOpIds.has(opId)) {
        uncovered += 1;
      }
    }
    log(
      `portable:import 覆盖度预检 ${zipPath}：账本 ${String(ledgerOps)} 条 + 缓冲 ${String(
        buffered.length,
      )} 条，未覆盖 ${String(uncovered)} 条`,
    );
    return { ledgerOps, pendingOps: buffered.length, uncovered };
  }

  function blockFor(pkg: OpenedPackage, current: number, uncovered: number): PortableImportPlan['blocked'] {
    if (!portableSchemaCompatible(pkg.manifest.schemaVersion, current)) {
      return { code: 'E_PORTABLE_SCHEMA_NEWER', message: PORTABLE_IMPORT_SCHEMA_MESSAGE };
    }
    if (uncovered > 0) {
      return { code: 'E_PORTABLE_NOT_EMPTY', message: PORTABLE_IMPORT_EMPTY_MESSAGE };
    }
    return null;
  }

  // --- 三段式 ---------------------------------------------------------------

  /** ① 备份：三件套；任一件写失败 → 清掉半成品并抛（无备份不落库）。 */
  function writeBackup(at: number): PortableBackupFile[] {
    const plan = portableBackupPlan(options.dbPath, at);
    const written: PortableBackupFile[] = [];
    try {
      for (const file of plan) {
        if (!io.exists(file.from)) {
          continue; // sidecar 不存在就不备份（还原时按「缺失即删除」回写）
        }
        io.writeFile(file.to, io.readFile(file.from));
        written.push(file);
      }
    } catch (error) {
      for (const file of written) {
        try {
          io.remove(file.to);
        } catch {
          // 清理失败不致命：错误主体是备份失败
        }
      }
      throw new PortableImportApiError('E_PORTABLE_BACKUP_FAILED', `备份现库失败（未做任何改动）：${describeError(error)}`);
    }
    if (written.length === 0 || written[0]?.from !== options.dbPath) {
      throw new PortableImportApiError('E_PORTABLE_BACKUP_FAILED', `主库不存在，无法备份：${options.dbPath}`);
    }
    return written;
  }

  /**
   * ③ 还原：先清目标三件套（避免「新主库 + 旧 wal」的混写窗口），再逐字节回写备份
   * （migrations.ts:375/419-423 同款顺序）。`from` 缺失的一件保持已清理状态
   * （= 原库本来就没有它）。
   *
   * T80-04（H-09）**原子性收口**：调用方必须**先经 `withConnectionClosed()` 释放主库
   * 句柄**再进本函数（Windows EBUSY 根因）。本函数自身保证「失败不留半成品」——
   * 进入前把每件 `to` 的**调用前字节快照**下来（不存在记 `null`），任一步失败时按快照
   * 回滚：该在的逐字节写回、不该在的删掉，使三件套回到「调用前状态」，再抛
   * `E_PORTABLE_ROLLBACK_FAILED`。快照只读现有文件（不新建文件、不改语义）。
   */
  function restorePairs(pairs: readonly PortableBackupFile[]): void {
    // 调用前快照（逐字节）：exists=false 记 null，用于失败回滚时恢复原状。
    const before = new Map<string, Uint8Array | null>();
    for (const pair of pairs) {
      try {
        before.set(pair.to, io.exists(pair.to) ? io.readFile(pair.to) : null);
      } catch (error) {
        throw new PortableImportApiError(
          'E_PORTABLE_ROLLBACK_FAILED',
          `还原前无法读取现状（未动任何文件）${pair.to}：${describeError(error)}`,
        );
      }
    }
    /** 失败回滚：把三件套按快照恢复（尽力而为；失败项不掩盖首个错误）。 */
    const rollbackToBefore = (): void => {
      for (const pair of pairs) {
        const snapshot = before.get(pair.to) ?? null;
        try {
          if (snapshot === null) {
            if (io.exists(pair.to)) {
              io.remove(pair.to);
            }
          } else {
            io.writeFile(pair.to, snapshot);
          }
        } catch {
          // 恢复动作本身失败：保留首个错误语义，不在此覆盖
        }
      }
    };

    for (const pair of pairs) {
      try {
        if (io.exists(pair.to)) {
          io.remove(pair.to);
        }
      } catch (error) {
        rollbackToBefore();
        throw new PortableImportApiError('E_PORTABLE_ROLLBACK_FAILED', `还原前清理失败 ${pair.to}：${describeError(error)}`);
      }
    }
    for (const pair of pairs) {
      if (!io.exists(pair.from)) {
        continue; // 备份里没有这一件 → 保持已清理状态（等于「原库没有它」）
      }
      try {
        io.writeFile(pair.to, io.readFile(pair.from));
      } catch (error) {
        rollbackToBefore();
        throw new PortableImportApiError('E_PORTABLE_ROLLBACK_FAILED', `还原失败 ${pair.to}：${describeError(error)}`);
      }
    }
  }

  /**
   * T80-04（H-09）：文件级还原的**唯一入口**——先经 db 端口释放主库句柄（Windows
   * 下 better-sqlite3 打开的 .db 不可删除/覆写），执行 `restore`，最后**无论成败**
   * 都重建连接（`reopenConnection`，失败只留痕并结构化上报；绝不让「库已还原但
   * 连接已关」的半态静默存在）。
   */
  async function withConnectionClosed(restore: () => void): Promise<void> {
    await options.db.closeConnection();
    let restoreError: unknown = null;
    try {
      restore();
    } catch (error) {
      restoreError = error;
    }
    try {
      await options.db.reopenConnection();
    } catch (error) {
      const detail = describeError(error);
      if (restoreError !== null) {
        throw new PortableImportApiError(
          'E_PORTABLE_ROLLBACK_FAILED',
          `还原失败且连接重建失败（${describeError(restoreError)}）：${detail}`,
        );
      }
      throw new PortableImportApiError('E_PORTABLE_REOPEN_FAILED', `还原后重建数据库连接失败：${detail}`);
    }
    if (restoreError !== null) {
      throw restoreError;
    }
  }

  async function resolveZipPath(input: PortableImportInput): Promise<string | null> {
    if (typeof input.zipPath === 'string' && input.zipPath.length > 0) {
      return input.zipPath;
    }
    if (typeof input.dir === 'string' && input.dir.length > 0) {
      const found = newestPortableArchive(io.listFiles(input.dir));
      if (found === null) {
        throw new PortableImportApiError('E_MALFORMED', `目录内没有便携包（${PORTABLE_ARCHIVE_PREFIX}*.zip）：${input.dir}`);
      }
      return join(input.dir, found);
    }
    const pick = options.pickArchive;
    if (pick === undefined) {
      throw new PortableImportApiError('E_MALFORMED', 'zipPath 或 dir 必填其一');
    }
    return await pick();
  }

  return {
    async plan(input) {
      assertInput(input);
      const zipPath = await resolveZipPath(input);
      if (zipPath === null) {
        return { canceled: true };
      }
      const pkg = openPackage(zipPath);
      const current = await options.schemaVersion();
      const covered = await coverage(zipPath, pkg.packageOpIds);
      const counts = {
        segments: pkg.segmentNames.length,
        attachments: portableAttachmentNames(Object.keys(pkg.entries)).length,
        db: Object.keys(pkg.entries).filter((name) => classifyPortableEntry(name) === 'db').length,
        entries: Object.keys(pkg.entries).length,
      };
      const blocked = blockFor(pkg, current, covered.uncovered);
      return {
        zipPath,
        manifest: {
          library: pkg.manifest.library,
          appVersion: pkg.manifest.appVersion,
          createdAt: pkg.manifest.createdAt,
          segments: pkg.manifest.segments,
          attachments: pkg.manifest.attachments,
          warnings: [...pkg.manifest.warnings],
        },
        counts,
        bytes: pkg.manifest.totalBytes,
        schema: {
          package: pkg.manifest.schemaVersion,
          current,
          compatible: portableSchemaCompatible(pkg.manifest.schemaVersion, current),
        },
        target: {
          ledgerOps: covered.ledgerOps,
          uncovered: covered.uncovered,
          willReplace: blocked === null,
        },
        warnings: warningsOf(pkg),
        blocked,
      };
    },

    async execute(input) {
      assertInput(input);
      if (input.confirm !== true) {
        throw new PortableImportApiError('E_MALFORMED', PORTABLE_IMPORT_CONFIRM_MESSAGE);
      }
      const zipPath = await resolveZipPath(input);
      if (zipPath === null) {
        return { canceled: true };
      }
      // 安全闸（与 plan 同一份实现）：任一不合 → 抛，零落盘
      const pkg = openPackage(zipPath);
      const current = await options.schemaVersion();
      if (!portableSchemaCompatible(pkg.manifest.schemaVersion, current)) {
        throw new PortableImportApiError('E_PORTABLE_SCHEMA_NEWER', PORTABLE_IMPORT_SCHEMA_MESSAGE);
      }
      const at = now();

      await options.pauseSync?.();
      try {
        // T80-04（H-08）：预检**前**强制封段（既有 flushAndPublish），把同步运行时
        // 缓冲里的 op 落进 op_ledger——否则覆盖度只读账本，会放过「缓冲有 op」的库，
        // replace 重放会抹掉这些用户编辑（H-04 同类形态）。flush 失败不静默：宁可拒导。
        if (options.flushSegments !== undefined) {
          try {
            await options.flushSegments();
          } catch (error) {
            throw new PortableImportApiError(
              'E_PORTABLE_FLUSH_FAILED',
              `导入前封段失败（无法确认缓冲已落账，拒绝导入以免抹数据）：${describeError(error)}`,
            );
          }
        }
        // 覆盖度复检（不信任 plan：两次调用之间本机可能又写了 op）
        const covered = await coverage(zipPath, pkg.packageOpIds);
        if (covered.uncovered > 0) {
          throw new PortableImportApiError('E_PORTABLE_NOT_EMPTY', PORTABLE_IMPORT_EMPTY_MESSAGE);
        }
        // ① checkpoint → 备份三件套（无备份即不落库）
        await options.db.checkpoint();
        const backupFiles = writeBackup(at);
        const backupPath = backupFiles[0]?.to ?? '';
        log(`portable:import 已备份 ${backupPath}（${String(backupFiles.length)} 件）`);
        try {
          // ② 建新库重放：显式 replace（禁依赖 T82-01 的缺省 merge）
          const replay = await options.db.rebuildFromSegments(JSON.stringify(pkg.segments), 'replace');
          log(
            `portable:import 重放完成 ${zipPath}：segments=${String(replay.segments)} ops=${String(replay.ops)} entities=${String(replay.entities)} mode=${replay.mode}`,
          );
          const result: PortableImportResult = {
            ok: true,
            zipPath,
            backupPath,
            backupFiles: backupFiles.map((file) => file.to),
            replay: {
              segments: replay.segments,
              ops: replay.ops,
              entities: replay.entities,
              mode: 'replace',
              keptOps: replay.keptOps,
            },
          };
          return result;
        } catch (error) {
          // ③ 失败回滚：逐字节还原，再抛原错误（结构化）。
          // T80-04（H-09）：同一隐患——回滚时连接也活着，必须先释放句柄再还原。
          const mapped = toPortableImportError(error);
          try {
            await withConnectionClosed(() => {
              restorePairs(backupFiles.map((file) => ({ from: file.to, to: file.from })));
            });
            log(`portable:import 重放失败已回滚 ${zipPath}：${mapped.code}`);
            throw Object.assign(mapped, { rolledBack: true } satisfies PortableImportRollbackState);
          } catch (restoreError) {
            if (restoreError === mapped) {
              throw restoreError;
            }
            throw new PortableImportApiError(
              'E_PORTABLE_ROLLBACK_FAILED',
              `导入失败且回滚失败（${mapped.code}）：${describeError(restoreError)}`,
            );
          }
        }
      } finally {
        await options.resumeSync?.();
      }
    },

    async revert(input) {
      if (input === null || typeof input !== 'object') {
        throw new PortableImportApiError('E_MALFORMED', 'IPC 参数必须是对象');
      }
      if (input.confirm !== true) {
        throw new PortableImportApiError('E_MALFORMED', PORTABLE_IMPORT_CONFIRM_MESSAGE);
      }
      if (typeof input.backupPath !== 'string' || input.backupPath.length === 0) {
        throw new PortableImportApiError('E_MALFORMED', 'backupPath 必须是非空字符串');
      }
      const plan = portableRestorePlan(input.backupPath);
      if (plan === null) {
        throw new PortableImportApiError('E_MALFORMED', `不是便携包备份名（.bak-portable-<时间戳>）：${input.backupPath}`);
      }
      if (!io.exists(plan[0]!.from)) {
        throw new PortableImportApiError('E_MALFORMED', `备份不存在：${input.backupPath}`);
      }
      await options.pauseSync?.();
      try {
        // T80-04（H-09）：先释放主库句柄再还原（Windows EBUSY 根因），完成后重建连接。
        await withConnectionClosed(() => {
          restorePairs(plan);
        });
        log(`portable:import 撤销导入：已还原 ${input.backupPath}`);
        return { ok: true, backupPath: input.backupPath, restoredFiles: plan.map((file) => file.to) };
      } finally {
        await options.resumeSync?.();
      }
    },
  };
}

function warningsOf(pkg: OpenedPackage): string[] {
  const warnings: string[] = [];
  if (pkg.segmentNames.length === 0) {
    warnings.push('包内段清单为空：导入后库里不会有页面（只有主库与附件）');
  }
  return warnings;
}

function assertInput(input: PortableImportInput): void {
  if (input === null || typeof input !== 'object') {
    throw new PortableImportApiError('E_MALFORMED', 'IPC 参数必须是对象');
  }
  if (input.zipPath !== undefined && typeof input.zipPath !== 'string') {
    throw new PortableImportApiError('E_MALFORMED', 'zipPath 必须是字符串');
  }
  if (input.dir !== undefined && typeof input.dir !== 'string') {
    throw new PortableImportApiError('E_MALFORMED', 'dir 必须是字符串');
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 纯逻辑闸（packages 侧的 `PortableImportLogicError`）统一转成服务侧错误类，
 * 保证调用方（IPC / CLI / UI）只见到一种形态 + 稳定 code。
 */
function gate<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw toPortableImportError(error);
  }
}

// ---------------------------------------------------------------------------
// node fs 实现
// ---------------------------------------------------------------------------

export const nodePortableImportIo: PortableImportIo = {
  readFile: (path) => new Uint8Array(readFileSync(path)),
  exists: (path) => existsSync(path),
  listFiles: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  writeFile: (path, bytes) => {
    writeFileSync(path, bytes);
  },
  remove: (path) => {
    rmSync(path, { force: true });
  },
};

// ---------------------------------------------------------------------------
// IPC 注册（DI：不 import electron，index.ts 用 ipcMain 适配）
// ---------------------------------------------------------------------------

export interface PortableImportIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

/**
 * 注册 `portable:import:plan` / `execute` / `revert` 三通道。`service === null`
 * （DbServer 未就绪）时统一回 `E_INVARIANT`。参数在边界再校验（不信任 renderer）。
 */
export function registerPortableImportIpc(
  service: PortableImportService | null,
  registrar: PortableImportIpcRegistrar,
): void {
  const requireService = (): PortableImportService => {
    if (service === null) {
      throw new PortableImportApiError('E_INVARIANT', '数据库服务不可用（启动失败，见日志）');
    }
    return service;
  };
  const on = (channel: string, run: (input: Record<string, unknown>) => Promise<unknown>): void => {
    registrar.handle(channel, async (raw: unknown): Promise<unknown> => {
      try {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          throw new PortableImportApiError('E_MALFORMED', 'IPC 参数必须是对象');
        }
        return await run(raw as Record<string, unknown>);
      } catch (error) {
        const mapped = toPortableImportError(error);
        throw new Error(`${mapped.code}: ${mapped.message}`);
      }
    });
  };

  on(CHANNEL_PORTABLE_IMPORT_PLAN, (input) =>
    requireService().plan({
      ...(typeof input['zipPath'] === 'string' ? { zipPath: input['zipPath'] } : {}),
      ...(typeof input['dir'] === 'string' ? { dir: input['dir'] } : {}),
    }),
  );
  on(CHANNEL_PORTABLE_IMPORT_EXECUTE, (input) =>
    requireService().execute({
      ...(typeof input['zipPath'] === 'string' ? { zipPath: input['zipPath'] } : {}),
      ...(typeof input['dir'] === 'string' ? { dir: input['dir'] } : {}),
      confirm: input['confirm'] === true,
    }),
  );
  on(CHANNEL_PORTABLE_IMPORT_REVERT, (input) => {
    if (input['confirm'] !== true) {
      throw new PortableImportApiError('E_MALFORMED', PORTABLE_IMPORT_CONFIRM_MESSAGE);
    }
    return requireService().revert({
      backupPath: typeof input['backupPath'] === 'string' ? input['backupPath'] : '',
      confirm: true,
    });
  });
}
