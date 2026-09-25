import {
  SegmentValidationError,
  buildSegment,
  compareLamport,
  encodeOp,
  encodeSegment,
  validateSegment,
  type ActorId,
  type Op,
  type Segment,
} from '@septcats/core';
import { SkipError } from './errors';
import { contentFingerprint, segmentFileName } from './naming';
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

  /**
   * T31-01：产出当前缓冲的**全部**规范段并清空缓冲；空则 []。
   *
   * 为什么不止一段：core 段不变量 5 要求段内 ops 按 compareLamport **严格**升序
   * （不得等值）。不同实体的 op 可能携带等值 lamport（如两个新建页各自的 c=1，
   * lamport.d 同设备）——它们不能同段。旧 flush() 遇此批直接抛校验异常且**缓冲
   * 不清空**，调用方每轮重抛 → 永久错误循环（老板真机「同步错误常驻」的根因
   * 之一）。flushAll 按等值 lamport 边界把缓冲切分为严格递增的连续 run，逐 run
   * buildSegment + 自校验，缓冲整体清空，绝不留滞留 op。
   */
  flushAll(): Segment[] {
    if (this.ops.length === 0) {
      return [];
    }
    const clear = (): void => {
      this.ops = [];
      this.byteSize = 0;
      this.minC = Number.POSITIVE_INFINITY;
      this.maxC = Number.NEGATIVE_INFINITY;
      this.lastOpAtMs = Number.NEGATIVE_INFINITY;
    };
    const whole = buildSegment(this.dev, this.ops);
    const wholeIssues = validateSegment(whole);
    if (wholeIssues.length === 0) {
      clear();
      return [whole];
    }
    const sorted = [...this.ops].sort((a, b) => {
      const byLamport = compareLamport(a.lamport, b.lamport);
      if (byLamport !== 0) {
        return byLamport;
      }
      if (a.op_id === b.op_id) {
        return 0;
      }
      return a.op_id < b.op_id ? -1 : 1;
    });
    const runs: Op[][] = [];
    let current: Op[] = [];
    for (const op of sorted) {
      const previous = current[current.length - 1];
      if (previous !== undefined && compareLamport(previous.lamport, op.lamport) >= 0) {
        runs.push(current);
        current = [];
      }
      current.push(op);
    }
    if (current.length > 0) {
      runs.push(current);
    }
    const segments: Segment[] = [];
    for (const run of runs) {
      const seg = buildSegment(this.dev, run);
      const issues = validateSegment(seg);
      if (issues.length > 0) {
        throw new SegmentValidationError(issues); // 单 op run 仍非法（设备不符等）：按旧语义上抛
      }
      segments.push(seg);
    }
    clear();
    return segments;
  }

  get pendingCount(): number {
    return this.ops.length;
  }

  /**
   * T80-04（H-08）：缓冲内 op_id 的只读视图（不 flush、不改缓冲）。
   * 便携包导入的覆盖度预检把「账本 op_id ∪ 本视图」当并集判覆盖，消除
   * 「预检只读 op_ledger、看不见未 flush 缓冲」的时序盲区（run-A/run-B 同序列
   * 两次可见性不一致的根因面）。
   */
  pendingOpIds(): readonly string[] {
    return this.ops.map((op) => op.op_id);
  }
}

/** 段路径：`<prefix>/<segmentFileName>`（prefix 可为空）。 */
function segmentPath(prefix: string, name: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  return trimmed === '' ? name : `${trimmed}/${name}`;
}

/**
 * 原子发布一个段（TASK-T29-01 语义收紧）：
 *
 * - 首选名 = `seg-<seg_id>-<内容摘要 8hex>.jsonl`（全局唯一）：同 (dev,c_from,n) 不同
 *   内容得到不同文件名，「迟到低 c op → 同名 flush 整批被吞」（T28-01 §4）不再可能；
 * - ifAbsent 写入成功 → 'written'；
 * - 同名命中：读回比对——同内容 = 幂等重复发布 → 'existed'（成功）；不同内容 = 冲突，
 *   **绝不当作成功丢弃** → 加长内容摘要（16/32/64 hex）改新名重写 → 'rewritten'；
 * - 全部摘要宽度的同名位均被不同内容占用（sha256 全宽碰撞，实际不可能）→ 抛
 *   SegmentNameConflictError，由调用方留痕重试（op 仍在 pendingPublish，不丢）。
 *
 * 兼容：旧命名段（无摘要）只作为读取目标存在，本函数不写旧名、不覆盖旧名文件。
 * 写前先 encodeSegment 自校验（非法段会在此抛 SegmentValidationError）。
 */
export type PublishResult = 'written' | 'existed' | 'rewritten';

/** 段名冲突无法消解（全部摘要宽度的同名位均被不同内容占用）时抛出；数据未丢，可重试。 */
export class SegmentNameConflictError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`段名冲突无法消解：'${path}' ${detail}`);
    this.name = 'SegmentNameConflictError';
    this.path = path;
    Object.setPrototypeOf(this, SegmentNameConflictError.prototype);
  }
}

/** 内容摘要递进宽度（hex 位数）；sha256 全宽 64 为终局。 */
const DIGEST_WIDTHS = [8, 16, 32, 64] as const;

export async function publishSegment(
  fs: SyncFs,
  providerPrefix: string,
  seg: Segment,
): Promise<PublishResult> {
  const text = encodeSegment(seg);
  const fingerprint = contentFingerprint(text);
  let lastPath = segmentPath(providerPrefix, segmentFileName(seg, text));
  let conflicted = false; // 曾命中「同名不同内容」→ 最终落位为改新名重写
  for (const width of DIGEST_WIDTHS) {
    const name = `${seg.seg_id}-${fingerprint.slice(0, width)}.jsonl`;
    const path = segmentPath(providerPrefix, name);
    lastPath = path;
    try {
      await fs.write(path, text, { ifAbsent: true });
      return conflicted ? 'rewritten' : 'written';
    } catch (error) {
      if (!(error instanceof SkipError)) {
        throw error;
      }
    }
    // 同名命中：读回比对（加密场景经 SyncFs 已解密回明文，比对内容即比对身份）。
    let existing: string | null = null;
    try {
      existing = await fs.read(path);
    } catch {
      existing = null; // 命中后又消失（网盘抖动）：换下一宽度新名重试
    }
    if (existing === text) {
      return 'existed'; // 同名同内容：幂等重复发布（成功）
    }
    // 同名不同内容：冲突 → 加长摘要改新名重写（循环下一宽度）
    conflicted = true;
  }
  throw new SegmentNameConflictError(lastPath, '8..64 hex 全部摘要宽度的同名位均被不同内容占用');
}
