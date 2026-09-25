/**
 * portableImport.ts —— 便携包（R28 · TASK-T80-02）**读侧纯逻辑**。
 *
 * 与写侧 `portableZip.ts` 对称：本文件不 import electron / fflate / node:fs——
 * 只算「备份名 / 条目分类 / 清单解析 / checksums 全验 / 段清单自检 / 加密判定」，
 * 可由 node 直测。zip 容器解包（fflate `unzipSync`）与 fs 落盘/还原只住
 * `apps/desktop/src/main/portableImport.ts`（fflate 只在 desktop 依赖里）。
 *
 * 边界（红线）：**不动 T80-01 已收口的写侧**——本文件只**新增**，portableZip.ts 一字未改。
 * 重放语义零新增：解码后的 `Segment[]` 直接喂 `rebuildFromSegments(json, 'replace')`
 * （T82-01 契约：显式 replace，禁依赖缺省 merge）。
 */

import { decodeSegment, type Segment } from '@septcats/core';
import { parseSegmentFileName } from './naming';
import {
  PORTABLE_ATTACHMENT_PREFIX,
  PORTABLE_DB_ENTRY,
  PORTABLE_FORMAT,
  PORTABLE_FORMAT_VERSION,
  PORTABLE_MANIFEST_NAME,
  PORTABLE_SYNC_PREFIX,
  portableEntryNameSafe,
  portableStamp,
  sha256Hex,
  type PortableEntryKind,
  type PortableManifest,
} from './portableZip';

/** 备份名标记（与迁移备份 `bak-v<N>` 区分；见报告 §0-④）。 */
export const PORTABLE_BACKUP_MARK = 'bak-portable';

/** 主库 sidecar 后缀（WAL 三件套；checkpoint(TRUNCATE) 后 -wal 为 0 字节，仍逐字节备份）。 */
export const PORTABLE_DB_SIDECAR_SUFFIXES: readonly string[] = ['-wal', '-shm'];

/** 密文段后缀（导入侧不收：跨机 DEK 不可解，见 PRD §0.5）。 */
export const PORTABLE_ENCRYPTED_SUFFIX = '.enc';

/** 导入侧结构化错误码。 */
export type PortableImportLogicErrorCode =
  /** 包结构/清单非法（含非本格式、不支持的格式版本）。 */
  | 'E_PORTABLE_BAD_MANIFEST'
  /** zip slip 同口径条目名（与写侧 E_ENTRY_NAME 同源）。 */
  | 'E_ENTRY_NAME'
  /** 包内段数与 manifest.segments 不符（H-04 P0：缺段重放 = 静默抹数据）。 */
  | 'E_PORTABLE_SEGMENT_COUNT'
  | 'E_MALFORMED';

export class PortableImportLogicError extends Error {
  readonly code: PortableImportLogicErrorCode;

  constructor(code: PortableImportLogicErrorCode, message: string) {
    super(message);
    this.name = 'PortableImportLogicError';
    this.code = code;
    Object.setPrototypeOf(this, PortableImportLogicError.prototype);
  }
}

/** 备份一对（原路径 → 备份路径）。 */
export interface PortableBackupFile {
  readonly from: string;
  readonly to: string;
}

/**
 * 备份文件名：`<dbPath>.bak-portable-<stamp>`。
 * 与迁移备份 `bak-v<N>` 不同名 → 不被 `migrations.createPreMigrationBackup` 的
 * `removeFile(backupPath)` 误删；且含 `.bak-` → 被下一次导出的排除规则挡在包外。
 */
export function portableBackupName(dbPath: string, at: number): string {
  return `${dbPath}.${PORTABLE_BACKUP_MARK}-${portableStamp(at)}`;
}

/** 备份三件套：主库 + `-wal` + `-shm`（顺序固定，主库在首）。 */
export function portableBackupPlan(dbPath: string, at: number): readonly PortableBackupFile[] {
  const backup = portableBackupName(dbPath, at);
  const files: PortableBackupFile[] = [{ from: dbPath, to: backup }];
  for (const suffix of PORTABLE_DB_SIDECAR_SUFFIXES) {
    files.push({ from: `${dbPath}${suffix}`, to: `${backup}${suffix}` });
  }
  return files;
}

/**
 * 备份名 → 主库路径（撤销入口用）。非本标记（`bak-v<N>` 等）→ null。
 * 只按 `.bak-portable-` 末次出现切分，不解析时间戳——名字里允许出现别的 `-`。
 */
export function portableBackupOrigin(backupPath: string): string | null {
  const mark = `.${PORTABLE_BACKUP_MARK}-`;
  const index = backupPath.lastIndexOf(mark);
  if (index <= 0) {
    return null;
  }
  return backupPath.slice(0, index);
}

/**
 * 还原计划（撤销入口）：`from` = 备份文件，`to` = 现库文件，三件套同序。
 * 非法备份名 → null。
 */
export function portableRestorePlan(backupPath: string): readonly PortableBackupFile[] | null {
  const origin = portableBackupOrigin(backupPath);
  if (origin === null) {
    return null;
  }
  const files: PortableBackupFile[] = [{ from: backupPath, to: origin }];
  for (const suffix of PORTABLE_DB_SIDECAR_SUFFIXES) {
    files.push({ from: `${backupPath}${suffix}`, to: `${origin}${suffix}` });
  }
  return files;
}

// ---------------------------------------------------------------------------
// T80-06（H-10）：本地段目录（`<数据根>/sync`）的快照 / 还原 / 覆盖度判据
//
// 布局真源 = `SyncRuntime`（`rootDir = <数据根>/sync`）：
//   - `manifest.json`（明文；设备表/水位/快照号）——导出侧排除它，但**本地还原必须含**；
//   - 段 `seg-<c_from:8hex>-<dev>-<n:6hex>[-<digest>].jsonl[.enc]`（含网盘副本 ` (N)`）；
//   - 快照 `snapshot-<seq>.json[.enc]`（段的折叠形态）；
//   - 子目录 `quarantine/`（坏段隔离）——**不备份、不还原**（任务书红线）。
// `listFiles` 非递归 → `quarantine/` 只会以目录名出现，下面的判据天然落选。
// ---------------------------------------------------------------------------

/** 段目录里的同步清单名（与包内 `manifest-portable.json` 区分）。 */
export const PORTABLE_SYNC_MANIFEST_NAME = 'manifest.json';

/** 快照文件名（`snapshot-<seq>.json` 明文 / `.enc` 密文）。 */
const SYNC_SNAPSHOT_RE = /^snapshot-\d+\.json(\.enc)?$/;

/**
 * 段目录快照的目录名：`<备份名>-sync`（与三件套备份同前缀）。
 * `revert` 据它把「三件套 + 段目录」一次性定位（备份名来自 `backupPath`，无需新增元数据）。
 */
export function portableSyncBackupDir(backupPath: string): string {
  return `${backupPath}-sync`;
}

/**
 * 是否段目录里的**段**文件：`seg-*.jsonl`（明文）。
 * 密文段（`.jsonl.enc`）不算——本侧无 DEK 不可解码，不纳入「段 op_id 比对」。
 */
export function isSyncSegmentFileName(name: string): boolean {
  return !name.endsWith(PORTABLE_ENCRYPTED_SUFFIX) && parseSegmentFileName(name) !== null;
}

/** 是否段目录里的**快照**文件（`snapshot-<seq>.json[.enc]`）。 */
export function isSyncSnapshotFileName(name: string): boolean {
  return SYNC_SNAPSHOT_RE.test(name);
}

/**
 * 是否属「段目录备份受管文件」：`manifest.json` + 全部段（含 `.jsonl.enc` 与网盘副本）
 * + 全部快照。非受管文件（日志/临时件/子目录名）既不备份，也不在还原时被删。
 */
export function isManagedSyncFileName(name: string): boolean {
  return (
    name === PORTABLE_SYNC_MANIFEST_NAME ||
    isSyncSnapshotFileName(name) ||
    parseSegmentFileName(name) !== null
  );
}

/** 段文本集合的解码结果：op_id 全集 + 解不开的段数（解不开不算「已覆盖」）。 */
export interface LocalSegmentOpIds {
  readonly opIds: ReadonlySet<string>;
  /** 无法解码的段文本数（坏段/半截/未来 schema_ver）——留痕用，不静默。 */
  readonly undecodable: number;
}

/**
 * T80-06（H-10）：本地盘上段文本 → op_id 全集（覆盖度预检的「本地段」面）。
 *
 * 用途：包内段是 replace 的唯一真相，若**本地盘上段**里有包未覆盖的 op（典型：导入后
 * 建的「包外页」段），而该 op 既不在账本也不在缓冲（或账本已被 replace 改写），单看
 * 「账本 ∪ 缓冲」会漏判 → 重放后包外内容仍在盘上、重启即复活。
 *
 * 解不开的段**不计入** op_id 集（解不开 ≠ 已覆盖），只回报 `undecodable` 供调用方留痕。
 */
export function localSegmentOpIds(texts: readonly string[]): LocalSegmentOpIds {
  const opIds = new Set<string>();
  let undecodable = 0;
  for (const text of texts) {
    let segment: Segment;
    try {
      segment = decodeSegment(text);
    } catch {
      undecodable += 1;
      continue;
    }
    for (const op of segment.ops) {
      opIds.add(op.op_id);
    }
  }
  return { opIds, undecodable };
}

/** 条目名 → 种类；不属于本格式（如 `logs/`、`sync/manifest.json`）→ null（导入侧忽略）。 */
export function classifyPortableEntry(name: string): PortableEntryKind | null {
  if (name === PORTABLE_MANIFEST_NAME) {
    return 'manifest';
  }
  if (name === PORTABLE_DB_ENTRY) {
    return 'db';
  }
  if (name.startsWith(`${PORTABLE_SYNC_PREFIX}/`)) {
    return parseSegmentFileName(name.slice(PORTABLE_SYNC_PREFIX.length + 1)) === null ? null : 'segment';
  }
  if (name.startsWith(`${PORTABLE_ATTACHMENT_PREFIX}/`)) {
    return 'attachment';
  }
  return null;
}

/** 包内段条目名（已排除密文段 `.enc`）。 */
export function portableSegmentNames(names: readonly string[]): string[] {
  return names
    .filter((name) => classifyPortableEntry(name) === 'segment')
    .filter((name) => !name.endsWith(PORTABLE_ENCRYPTED_SUFFIX))
    .sort();
}

/** 包内附件条目名。 */
export function portableAttachmentNames(names: readonly string[]): string[] {
  return names.filter((name) => classifyPortableEntry(name) === 'attachment').sort();
}

/**
 * 加密包判定（导入侧硬闸：`E_PORTABLE_ENCRYPTED_UNSUPPORTED`）。
 *
 * 双判据：① 清单显式标记 `encrypted === true`（T80-01 的清单里**没有**这个字段——
 * 它直接拒导加密库，故该分支只服务将来显式写标记的导出侧；本单不做写侧改动）；
 * ② 包内含 `.enc` 密文条目（密文段 / 密文附件）。任一命中即加密包。
 */
export function isPortableEncrypted(manifest: PortableManifest, names: readonly string[]): boolean {
  const flagged = (manifest as { encrypted?: unknown }).encrypted;
  if (flagged === true) {
    return true;
  }
  return names.some((name) => name.endsWith(PORTABLE_ENCRYPTED_SUFFIX));
}

/** 清单条目名是否安全（zip slip 同口径；读侧不静默改写名字）。 */
export function assertPortableImportEntryName(name: string): string {
  if (!portableEntryNameSafe(name)) {
    throw new PortableImportLogicError('E_ENTRY_NAME', `包内条目名不安全（zip slip 口径）：${JSON.stringify(name)}`);
  }
  return name;
}

/** 逐条条目名安全校验：任一不安全即抛（读侧先于任何落库）。 */
export function assertPortableImportEntryNames(names: readonly string[]): void {
  for (const name of names) {
    assertPortableImportEntryName(name);
  }
}

/**
 * 解析包内清单。三重闸：UTF-8 JSON 合法 → `format === 'septcats-portable'` →
 * `formatVersion` 不高于本侧可解析版本（`PORTABLE_FORMAT_VERSION`）。
 */
export function parsePortableManifest(bytes: Uint8Array): PortableManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PortableImportLogicError('E_PORTABLE_BAD_MANIFEST', `清单不是合法 JSON：${reason}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PortableImportLogicError('E_PORTABLE_BAD_MANIFEST', '清单必须是 JSON 对象');
  }
  const candidate = raw as Partial<PortableManifest>;
  if (candidate.format !== PORTABLE_FORMAT) {
    throw new PortableImportLogicError(
      'E_PORTABLE_BAD_MANIFEST',
      `不是 Septcats 便携包（format=${String(candidate.format)}）`,
    );
  }
  if (typeof candidate.formatVersion !== 'number' || !Number.isFinite(candidate.formatVersion)) {
    throw new PortableImportLogicError('E_PORTABLE_BAD_MANIFEST', '清单缺少 formatVersion');
  }
  if (candidate.formatVersion > PORTABLE_FORMAT_VERSION) {
    throw new PortableImportLogicError(
      'E_PORTABLE_BAD_MANIFEST',
      `包格式版本 ${String(candidate.formatVersion)} 高于本应用可解析的 ${String(PORTABLE_FORMAT_VERSION)}`,
    );
  }
  if (!Array.isArray(candidate.entries)) {
    throw new PortableImportLogicError('E_PORTABLE_BAD_MANIFEST', '清单缺少 entries 校验和表');
  }
  return raw as PortableManifest;
}

export interface PortableChecksumReport {
  /** 已逐条校验的条目数（清单自身不自指，不计入）。 */
  readonly checked: number;
  /** 校验和不符的条目名。 */
  readonly mismatched: readonly string[];
  /** 清单里有、包里没有的条目名。 */
  readonly missing: readonly string[];
  /** 包里有、清单里没有（非清单本身）的条目名。 */
  readonly extra: readonly string[];
  /** 包内总字节（清单声明值）。 */
  readonly declaredBytes: number;
}

/**
 * checksums **全验**（任务书红线：任一不合 → 整体拒绝，不建库）。
 * 只回报不合项，不抛——由调用方决定是否据此拒绝（plan 与 execute 都走同一函数）。
 */
export function verifyPortableChecksums(
  entries: Readonly<Record<string, Uint8Array>>,
  manifest: PortableManifest,
): PortableChecksumReport {
  const declared = new Map<string, { sha256: string; bytes: number }>();
  for (const meta of manifest.entries) {
    if (meta.name === PORTABLE_MANIFEST_NAME) {
      continue; // 清单不自指
    }
    declared.set(meta.name, { sha256: meta.sha256, bytes: meta.bytes });
  }
  const present = new Set(Object.keys(entries));

  const mismatched: string[] = [];
  for (const [name, expect] of declared) {
    const bytes = entries[name];
    if (bytes === undefined) {
      continue; // 缺条目另算
    }
    if (bytes.byteLength !== expect.bytes || sha256Hex(bytes) !== expect.sha256) {
      mismatched.push(name);
    }
  }
  const missing = [...declared.keys()].filter((name) => !present.has(name)).sort();
  const extra = [...present].filter((name) => name !== PORTABLE_MANIFEST_NAME && !declared.has(name)).sort();
  return {
    checked: declared.size - missing.length,
    mismatched: mismatched.sort(),
    missing,
    extra,
    declaredBytes: manifest.totalBytes,
  };
}

/** 校验和报告是否「全过」（三面皆空才算过）。 */
export function portableChecksumsOk(report: PortableChecksumReport): boolean {
  return report.mismatched.length === 0 && report.missing.length === 0 && report.extra.length === 0;
}

/**
 * 段清单自检（H-04 P0 硬要求的导入侧形态）：包内段条目数必须 == `manifest.segments`。
 * 缺段会让 replace 重放静默抹掉数据，故**不符即拒，绝不落到重放**。
 */
export function assertPortableSegmentCount(
  segmentCount: number,
  manifest: PortableManifest,
): number {
  if (segmentCount !== manifest.segments) {
    throw new PortableImportLogicError(
      'E_PORTABLE_SEGMENT_COUNT',
      `包内段数与清单不符（实收 ${String(segmentCount)} / 清单 ${String(manifest.segments)}）：拒绝重放以免数据丢失`,
    );
  }
  return segmentCount;
}

/** 包内 schema 版本是否可导入：包版本 > 当前 → false（来自更新的应用，拒）。 */
export function portableSchemaCompatible(packageVersion: number, currentVersion: number): boolean {
  return packageVersion <= currentVersion;
}
