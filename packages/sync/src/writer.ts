import {
  SegmentValidationError,
  buildSegment,
  encodeOp,
  encodeSegment,
  validateSegment,
  type ActorId,
  type Op,
  type Segment,
} from '@septcats/core';
import { SkipError } from './errors';
import { segmentFileName } from './naming';
import type { SyncFs } from './fs';

/**
 * 攒段（任务书 §4）：EditSession 产出的 op 攒成不可变段，原子写盘。
 * 段边界由四触发器决定（条数/字节/时钟跨度/空闲）；复用 core.buildSegment/validateSegment，不重写。
 */

/** 攒段策略。 */
export interface WritePolicy {
  /** 最大 op 条数。 */
  maxOps: number;
  /** 最大字节数（op 编码后的字节，不含段头）。 */
  maxBytes: number;
  /** 最大 Lamport 时钟跨度（maxC - minC）。 */
  maxLamportSpan: number;
}

/** 默认策略：500 条 / 256 KB / 1000 时钟跨度。 */
export const DEFAULT_WRITE_POLICY: WritePolicy = {
  maxOps: 500,
  maxBytes: 256 * 1024,
  maxLamportSpan: 1000,
};

/** 一个 op 编码成单行后的 UTF-8 字节数（含行分隔符 1 字节）。 */
function opByteSize(op: Op): number {
  return Buffer.byteLength(encodeOp(op), 'utf8') + 1;
}

export class SegmentBuilder {
  private readonly dev: ActorId;
  private readonly policy: WritePolicy;
  private ops: Op[] = [];
  private byteSize = 0;
  private minC = Number.POSITIVE_INFINITY;
  private maxC = Number.NEGATIVE_INFINITY;
  private lastOpAtMs = Number.NEGATIVE_INFINITY;

  constructor(dev: ActorId, policy?: WritePolicy) {
    this.dev = dev;
    this.policy = policy ?? DEFAULT_WRITE_POLICY;
  }

  /** 追加一条 op（不在此刻排序，flush 时由 buildSegment 统一按 lamport 升序）。 */
  add(op: Op): void {
    this.ops.push(op);
    this.byteSize += opByteSize(op);
    this.minC = Math.min(this.minC, op.lamport.c);
    this.maxC = Math.max(this.maxC, op.lamport.c);
    this.lastOpAtMs = Math.max(this.lastOpAtMs, op.at);
  }

  /** 是否该刷段：条数 / 字节 / 时钟跨度 / 空闲 四触发之一。 */
  shouldFlush(atMs: number, idleMs: number): boolean {
    if (this.ops.length === 0) {
      return false;
    }
    if (this.ops.length >= this.policy.maxOps) {
      return true;
    }
    if (this.byteSize >= this.policy.maxBytes) {
      return true;
    }
    if (this.maxC - this.minC >= this.policy.maxLamportSpan) {
      return true;
    }
    if (atMs - this.lastOpAtMs >= idleMs) {
      return true;
    }
    return false;
  }

  /** 产出当前段并清空缓冲；空则 null；产出即自校验（core.validateSegment）。 */
  flush(): Segment | null {
    if (this.ops.length === 0) {
      return null;
    }
    const seg = buildSegment(this.dev, this.ops);
    const issues = validateSegment(seg);
    if (issues.length > 0) {
      throw new SegmentValidationError(issues);
    }
    this.ops = [];
    this.byteSize = 0;
    this.minC = Number.POSITIVE_INFINITY;
    this.maxC = Number.NEGATIVE_INFINITY;
    this.lastOpAtMs = Number.NEGATIVE_INFINITY;
    return seg;
  }

  get pendingCount(): number {
    return this.ops.length;
  }
}

/** 段路径：`<prefix>/<segmentFileName>`（prefix 可为空）。 */
function segmentPath(prefix: string, name: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  return trimmed === '' ? name : `${trimmed}/${name}`;
}

/**
 * 原子发布一个段：ifAbsent 写入；已存在（同名=同内容）→ 'existed'（幂等，S3/S6）。
 * 写前先 encodeSegment 自校验（非法段会在此抛 SegmentValidationError）。
 */
export async function publishSegment(
  fs: SyncFs,
  providerPrefix: string,
  seg: Segment,
): Promise<'written' | 'existed'> {
  const text = encodeSegment(seg);
  const path = segmentPath(providerPrefix, segmentFileName(seg));
  try {
    await fs.write(path, text, { ifAbsent: true });
    return 'written';
  } catch (error) {
    if (error instanceof SkipError) {
      return 'existed';
    }
    throw error;
  }
}
