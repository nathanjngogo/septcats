import { createHash } from 'node:crypto';
import { encodeSegment, type Segment } from '@septcats/core';

/**
 * 段文件名 <-> Segment 双向（任务书 §4 / TASK-T29-01 修订）。
 *
 * 规范名（T29-01 起首选）：`seg-<c_from:8hex>-<dev>-<n:6hex>-<digest:8hex>.jsonl`
 * （加密时 `.jsonl.enc`）。digest 为段全文（encodeSegment 产物）sha256 前 8 位 hex——
 * 旧规则 (dev, c_from, n) 可碰撞（迟到低 c op 的 flush 与既有段同名 → 整批 op 被
 * ifAbsent 当成功吞掉，T28-01 报告 §4）；内容摘要使「同 (dev,c_from,n) 不同内容」
 * 得到不同文件名，冲突天然消解。
 *
 * 兼容（只增不破）：旧命名 `seg-<c_from:8hex>-<dev>-<n:6hex>.jsonl`（无摘要）仍被
 * 同一解析路径识别（digest 缺省为 undefined），既有段文件照常读取重放。
 *
 * 网盘客户端搬运时可能产生冲突副本 `xxx (1).jsonl` / `xxx.jsonl (1)`，解析时一并识别，
 * 供合并器按内容 hash 去重（S3）。
 */

/** 解析出的段文件名信息。 */
export interface SegmentFileNameInfo {
  cFrom: number;
  dev: string;
  n: number;
  /** 内容摘要 hex（T29-01 新命名）；旧命名段无此字段（undefined）。 */
  digest?: string;
  /** 网盘副本序号（无副本为 0）。 */
  copySuffix: number;
  /** 是否加密段（`.jsonl.enc`）。 */
  encrypted: boolean;
}

const SEGMENT_BASE_RE = /^seg-([0-9a-f]{8})-([a-z0-9]{8,32})-([0-9a-f]{6})(?:-([0-9a-f]{8,64}))?/;
const TRAILING_COPY_RE = / \((\d+)\)$/;
const MID_COPY_RE = /^ \((\d+)\)(?=\.)/;

/** 段的规范文件名（含 `.jsonl` 扩展名）。content 缺省时由 encodeSegment(seg) 现算。 */
export function segmentFileName(seg: Segment, content?: string): string {
  const text = content ?? encodeSegment(seg);
  return `${seg.seg_id}-${contentFingerprint(text).slice(0, 8)}.jsonl`;
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
  const digest = base[4];
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

  const info: SegmentFileNameInfo = {
    cFrom: parseInt(cFromHex, 16),
    dev,
    n: parseInt(nHex, 16),
    copySuffix,
    encrypted,
  };
  if (digest !== undefined) {
    info.digest = digest;
  }
  return info;
}

/** 是否为网盘冲突副本（`base (N).ext` 或 `base.ext (N)`）。 */
export function isSidecarCopy(name: string): boolean {
  return / \(\d+\)(?=\.|$)/.test(name);
}

/** 内容指纹：sha256 hex（node:crypto，MemoryFs 测试同源）。 */
export function contentFingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
