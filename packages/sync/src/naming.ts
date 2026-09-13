import { createHash } from 'node:crypto';
import type { Segment } from '@septcats/core';

/**
 * 段文件名 <-> Segment 双向（任务书 §4）。
 *
 * 规范名：`seg-<c_from:8hex>-<dev>-<n:6hex>.jsonl`（加密时 `.jsonl.enc`）。
 * 网盘客户端搬运时可能产生冲突副本 `xxx (1).jsonl` / `xxx.jsonl (1)`，解析时一并识别，
 * 供合并器按内容 hash 去重（S3）。
 */

/** 解析出的段文件名信息。 */
export interface SegmentFileNameInfo {
  cFrom: number;
  dev: string;
  n: number;
  /** 网盘副本序号（无副本为 0）。 */
  copySuffix: number;
  /** 是否加密段（`.jsonl.enc`）。 */
  encrypted: boolean;
}

const SEGMENT_BASE_RE = /^seg-([0-9a-f]{8})-([a-z0-9]{8,32})-([0-9a-f]{6})/;
const TRAILING_COPY_RE = / \((\d+)\)$/;
const MID_COPY_RE = /^ \((\d+)\)(?=\.)/;

/** 段的规范文件名（含 `.jsonl` 扩展名）。 */
export function segmentFileName(seg: Segment): string {
  return `${seg.seg_id}.jsonl`;
}

/** 从文件名解析段信息；不是合法段文件名返回 null。 */
export function parseSegmentFileName(name: string): SegmentFileNameInfo | null {
  const base = SEGMENT_BASE_RE.exec(name);
  if (base === null) {
    return null;
  }
  const cFromHex = base[1] ?? '';
  const dev = base[2] ?? '';
  const nHex = base[3] ?? '';
  let rest = name.slice(base[0].length);

  let copySuffix = 0;
  let encrypted = false;

  // 网盘副本后缀（扩展名之后）：`x.jsonl (1)`
  const trailingCopy = TRAILING_COPY_RE.exec(rest);
  if (trailingCopy !== null) {
    copySuffix = parseInt(trailingCopy[1] ?? '0', 10);
    rest = rest.slice(0, trailingCopy.index);
  }

  // 加密后缀：`.jsonl.enc`
  if (rest.endsWith('.enc')) {
    encrypted = true;
    rest = rest.slice(0, rest.length - '.enc'.length);
  }

  // 网盘副本后缀（扩展名之前）：`x (2).jsonl`
  const midCopy = MID_COPY_RE.exec(rest);
  if (midCopy !== null) {
    if (copySuffix !== 0) {
      return null; // 同时出现两处副本号，非法
    }
    copySuffix = parseInt(midCopy[1] ?? '0', 10);
    rest = rest.slice(midCopy[0].length);
  }

  if (rest !== '.jsonl') {
    return null;
  }

  return {
    cFrom: parseInt(cFromHex, 16),
    dev,
    n: parseInt(nHex, 16),
    copySuffix,
    encrypted,
  };
}

/** 是否为网盘冲突副本（`base (N).ext` 或 `base.ext (N)`）。 */
export function isSidecarCopy(name: string): boolean {
  return / \(\d+\)(?=\.|$)/.test(name);
}

/** 内容指纹：sha256 hex（node:crypto，MemoryFs 测试同源）。 */
export function contentFingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
