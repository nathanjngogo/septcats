import type { Op, ReplayConflict } from '@septcats/core';

/**
 * @septcats/sync 的稳定错误码与合并报告结构。
 *
 * E_* 错误码对外（runtime/UI/日志）保持稳定：调用方按 code 分支，不依赖 message 文案。
 * 纪律：只增不改；已发布的码值不得变更语义。
 */

export const SyncErrorCodes = {
  /** 幂等写入时目标已存在（ifAbsent 语义，S3/S6 据此判 'existed'）。 */
  ALREADY_EXISTS: 'E_ALREADY_EXISTS',
  /** 读取/统计的文件不存在。 */
  NOT_FOUND: 'E_NOT_FOUND',
  /** 段内容结构或自校验失败（隔离，S2）。 */
  SEGMENT_INVALID: 'E_SEGMENT_INVALID',
  /** 段文件被截断（半截文件）。 */
  SEGMENT_TRUNCATED: 'E_SEGMENT_TRUNCATED',
  /** 段 schema_ver 高于本端可理解版本（拒收并提示升级）。 */
  SCHEMA_TOO_NEW: 'E_SCHEMA_TOO_NEW',
  /** manifest.json 非法（降级为「只用现有段」，不崩）。 */
  MANIFEST_INVALID: 'E_MANIFEST_INVALID',
  /** 底层写入失败。 */
  WRITE_FAILED: 'E_WRITE_FAILED',
} as const;

export type SyncErrorCode = (typeof SyncErrorCodes)[keyof typeof SyncErrorCodes];

/** 同步引擎统一错误：带稳定码（+ 可选路径），供上层分支与日志留痕。 */
export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly path?: string;

  constructor(code: SyncErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    if (path !== undefined) {
      this.path = path;
    }
    Object.setPrototypeOf(this, SyncError.prototype);
  }
}

/** ifAbsent 写入命中已存在文件时抛出（幂等关键）。 */
export class SkipError extends SyncError {
  constructor(path: string) {
    super(SyncErrorCodes.ALREADY_EXISTS, `写入跳过：'${path}' 已存在`, path);
    this.name = 'SkipError';
    Object.setPrototypeOf(this, SkipError.prototype);
  }
}

/** 读取/统计目标不存在时抛出。 */
export class NotFoundError extends SyncError {
  constructor(path: string) {
    super(SyncErrorCodes.NOT_FOUND, `文件不存在：'${path}'`, path);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/** 合并报告里被跳过的一条（内容重复 / 已应用 / 空段）。 */
export interface SyncSkippedEntry {
  file: string;
  reason: 'duplicate' | 'already-applied' | 'empty';
}

/** 合并报告里被隔离的一条（半截/超版本/校验失败 → 绝不污染库）。 */
export interface SyncQuarantineEntry {
  file: string;
  reason: string;
}

/**
 * 一轮 mergeRemote 的产出（骨架，merger.ts 于 B 阶段填充）。
 * - applied 只含「本地账没有的 op_id」，幂等；
 * - conflicts 直接复用 core.replay 的 ReplayConflict（S1 素材）；
 * - 顺序无关：实现内部统一 sort by (c_from, dev, n)。
 */
export interface SyncReport {
  pulled: number;
  applied: Op[];
  skipped: SyncSkippedEntry[];
  quarantined: SyncQuarantineEntry[];
  conflicts: ReplayConflict[];
  highWatermark: number;
  needsSnapshot: boolean;
}
