/**
 * portableZip.ts —— 便携包（R28 · TASK-T80-01）**写侧纯逻辑**。
 *
 * 边界（红线）：本文件不 import electron、不 import fflate、不做任何 fs 访问——
 * 只算「名字 / 校验和 / 清单 / 压缩策略 / 落盘名」，可由 node 直测。真 zip 容器
 * 组装（fflate `zipSync`）与 fs 落盘住 `apps/desktop/src/main/portable.ts`
 * （fflate 只在 desktop 依赖里，本包零新增依赖）。
 *
 * 与导入侧（T80b）的对齐口径（报告 §0-①）：包内段条目 = `sync/seg-*.jsonl`，
 * 即 `SyncProvider.listSegments()` 的同一批文件——导入侧 `decodeSegment` 后喂
 * `rebuildFromSegments(segmentsJson)`（db/server.ts REBUILD_CLEAR_SQL 路径）。
 */

import { createHash } from 'node:crypto';

/** 包格式标识（导入侧据此判别，非本格式直接拒导）。 */
export const PORTABLE_FORMAT = 'septcats-portable';

/** 包格式版本（v1：明文包；加密库不出门）。 */
export const PORTABLE_FORMAT_VERSION = 1;

/** 包内清单文件名（与同步目录的 manifest.json 区分）。 */
export const PORTABLE_MANIFEST_NAME = 'manifest-portable.json';

/** 主库条目名（wal_checkpoint(TRUNCATE) 后的裸库文件；-wal/-shm 不入包）。 */
export const PORTABLE_DB_ENTRY = 'septcats.db';

/** 段条目前缀（包内目录）。 */
export const PORTABLE_SYNC_PREFIX = 'sync';

/** 附件条目前缀（包内目录）。 */
export const PORTABLE_ATTACHMENT_PREFIX = 'attachments';

/**
 * ZIP32 字段上限：fflate 0.8.2 的 `zipSync` **只写 32 位**大小/偏移（zip64 仅读不写，
 * 见 esm/index.mjs 第 2278 行起：`wzh`/`wzf` 全走 `b4`），超界会静默截断成坏包
 * ——故 v1 前置硬闸：单条目或总字节 ≥ 此值 → 结构化拒绝（显性不做分卷）。
 */
export const ZIP32_MAX_BYTES = 0xffffffff;

/** DEFLATE 档（文本类：清单 / 主库 / 段）。 */
export const DEFLATE_LEVEL = 6;

/** STORED 档（level 0：已压缩的附件，二次 deflate 无收益且更慢）。 */
export const STORED_LEVEL = 0;

/** 已内嵌压缩的扩展名（内容寻址附件常见形态）→ STORED。 */
const PRECOMPRESSED_EXTS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'zip',
  'gz',
  'br',
  'xz',
  'mp3',
  'mp4',
  'mov',
  'pdf',
  'woff',
  'woff2',
];

/** 排除清单（**不入包**，原样写进 manifest.excluded 供用户核对）。 */
export const PORTABLE_EXCLUDED: readonly string[] = [
  'logs/',
  'tmp/',
  'crashDumps/',
  'sync/quarantine/',
  'sync/manifest.json',
  'sync/snapshot-*.json',
  '*.db.bak-*',
];

/** 条目种类。 */
export type PortableEntryKind = 'manifest' | 'db' | 'segment' | 'attachment';

/** 清单里的一条（checksums 表的一格）。 */
export interface PortableEntryMeta {
  /** 包内相对路径（POSIX `/`）。 */
  readonly name: string;
  readonly kind: PortableEntryKind;
  /** 原始字节数（未压缩）。 */
  readonly bytes: number;
  /** 原始字节的 sha256 hex（导入侧先验再重放）。 */
  readonly sha256: string;
  /** true = STORED（不压缩）；false = DEFLATE。 */
  readonly stored: boolean;
}

/** 包内清单（manifest-portable.json 的完整形状）。 */
export interface PortableManifest {
  readonly format: typeof PORTABLE_FORMAT;
  readonly formatVersion: number;
  /** 导出时刻（epoch ms）。 */
  readonly createdAt: number;
  /** 库名（活动工作区名；UI 侧口径「库」，非「数据库」）。 */
  readonly library: string;
  readonly appVersion: string;
  /** SQLite schema 版本（PRAGMA user_version）。 */
  readonly schemaVersion: number;
  /** 段重放口径：包内段文件数（导入侧 rebuildFromSegments 的输入条数）。 */
  readonly segments: number;
  readonly attachments: number;
  /** 未封段的本地 op 数（0 = 全部改动已入段）。 */
  readonly pendingOps: number;
  readonly totalBytes: number;
  readonly entries: readonly PortableEntryMeta[];
  readonly excluded: readonly string[];
  /** 非阻断提示（如「同步未启用，段清单为空」）。 */
  readonly warnings: readonly string[];
}

export type PortableZipErrorCode = 'E_ENTRY_NAME' | 'E_TOO_LARGE' | 'E_MALFORMED';

export class PortableZipError extends Error {
  readonly code: PortableZipErrorCode;

  constructor(code: PortableZipErrorCode, message: string) {
    super(message);
    this.name = 'PortableZipError';
    this.code = code;
    Object.setPrototypeOf(this, PortableZipError.prototype);
  }
}

/** 原始字节 sha256 hex。 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * zip slip 同口径防护（与 `apps/desktop/src/main/importer.ts` 的 `entryNameSafe`
 * 同规则，另收紧两处：反斜杠与 Windows 盘符——写侧只收自造名，宁严勿松）：
 * 拒绝绝对路径 / 上跳 `..` / 目录项 / 反斜杠 / NUL / 空名。
 */
export function portableEntryNameSafe(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  if (name.startsWith('/') || name.endsWith('/')) {
    return false;
  }
  if (name.includes('..') || name.includes('\\') || name.includes('\u0000')) {
    return false;
  }
  if (/^[A-Za-z]:/.test(name)) {
    return false;
  }
  return true;
}

/** 条目名收口：不安全即抛 `E_ENTRY_NAME`（写侧不静默改写名字）。 */
export function assertPortableEntryName(name: string): string {
  if (!portableEntryNameSafe(name)) {
    throw new PortableZipError('E_ENTRY_NAME', `条目名不安全（zip slip 口径）：${JSON.stringify(name)}`);
  }
  return name;
}

/** 包内段条目名（`sync/<file>`）。 */
export function portableSegmentEntry(file: string): string {
  return assertPortableEntryName(`${PORTABLE_SYNC_PREFIX}/${file}`);
}

/** 包内附件条目名（`attachments/<file>`）。 */
export function portableAttachmentEntry(file: string): string {
  return assertPortableEntryName(`${PORTABLE_ATTACHMENT_PREFIX}/${file}`);
}

/** 扩展名（小写，无点）；无扩展名返回 ''。 */
export function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * 是否走 STORED：附件且扩展名属「已内嵌压缩」族 → 不二次压缩
 * （PNG/JPEG/MP4/zip 等 deflate 收益≈0 且白耗 CPU；文本类一律 DEFLATE）。
 */
export function storedOf(kind: PortableEntryKind, name: string): boolean {
  if (kind !== 'attachment') {
    return false;
  }
  return PRECOMPRESSED_EXTS.includes(extOf(name));
}

/** 单条目 / 总归档的 ZIP32 硬闸（超界即抛，不产生截断坏包）。 */
export function assertZip32Size(bytes: number, label: string): void {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new PortableZipError('E_MALFORMED', `字节数非法：${label}=${String(bytes)}`);
  }
  if (bytes >= ZIP32_MAX_BYTES) {
    throw new PortableZipError(
      'E_TOO_LARGE',
      `${label} ${String(bytes)} 字节 ≥ ZIP32 上限（${String(ZIP32_MAX_BYTES)}），v1 不做分卷`,
    );
  }
}

/** 条目元信息（名/字节/种类 → 校验和 + 压缩策略）。 */
export function portableEntryMeta(name: string, bytes: Uint8Array, kind: PortableEntryKind): PortableEntryMeta {
  assertPortableEntryName(name);
  assertZip32Size(bytes.byteLength, `条目 ${name}`);
  return {
    name,
    kind,
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    stored: storedOf(kind, name),
  };
}

export interface PortableManifestInput {
  readonly library: string;
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly createdAt: number;
  readonly entries: readonly PortableEntryMeta[];
  readonly pendingOps?: number;
  readonly warnings?: readonly string[];
}

/** 由条目元信息生成清单（自身不入 checksums 表——自指无意义）。 */
export function buildPortableManifest(input: PortableManifestInput): PortableManifest {
  const entries = [...input.entries];
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  assertZip32Size(totalBytes, '包内总字节');
  return {
    format: PORTABLE_FORMAT,
    formatVersion: PORTABLE_FORMAT_VERSION,
    createdAt: input.createdAt,
    library: input.library,
    appVersion: input.appVersion,
    schemaVersion: input.schemaVersion,
    segments: entries.filter((entry) => entry.kind === 'segment').length,
    attachments: entries.filter((entry) => entry.kind === 'attachment').length,
    pendingOps: input.pendingOps ?? 0,
    totalBytes,
    entries,
    excluded: [...PORTABLE_EXCLUDED],
    warnings: [...(input.warnings ?? [])],
  };
}

/** 清单 → 包内字节（稳定 2 空格缩进 + 换行；导入侧按 UTF-8 读）。 */
export function encodePortableManifest(manifest: PortableManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 文本 → 文件名安全 slug（空/纯非法字符回 fallback）。 */
export function portableSlug(text: string, fallback: string): string {
  const cleaned = text.replace(ILLEGAL_NAME_CHARS, '_').replace(/\s+/g, '-').replace(/^[\s.]+|[\s.]+$/g, '');
  const trimmed = cleaned.slice(0, 60);
  return trimmed.length > 0 ? trimmed : fallback;
}

/** 时间戳段（`<YYYYMMDD>-<HHMMSS>`，本地时钟，文件名安全）。 */
export function portableStamp(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const ymd = `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${ymd}-${hms}`;
}

/** 归档基名：`septcats-portable-<slug>-<stamp>.zip`。 */
export function portableArchiveBase(library: string, at: number): string {
  return `septcats-portable-${portableSlug(library, 'library')}-${portableStamp(at)}.zip`;
}

/**
 * 同名不覆盖（PRD §1 红线）：重名则加序号 `-2` `-3`…，永不静默覆盖。
 * `exists` 由调用方注入（IO 面在 desktop main）。
 */
export function uniquePortableArchiveName(base: string, exists: (name: string) => boolean): string {
  if (!exists(base)) {
    return base;
  }
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${String(index)}${ext}`;
    if (!exists(candidate)) {
      return candidate;
    }
  }
  throw new PortableZipError('E_MALFORMED', `同名包序号耗尽：${base}`);
}
