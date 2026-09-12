import { z } from 'zod';
import { compareLamport } from './clock';
import {
  OpValidationError,
  SCHEMA_VERSION,
  actorIdSchema,
  decodeOp,
  encodeOp,
  formatZodError,
  stableStringify,
  type ActorId,
  type Op,
} from './op';

/**
 * 不可变事件日志分段（JSONL）。
 *
 * 段是同步的最小传输单元：命名自校验、内容自校验、可被任意网盘搬运后原样重放。
 * 文件名形如 `seg-<c_from:8hex>-<deviceId>-<n:6hex>.jsonl`，其中 c_from 为首个 op 的
 * Lamport 计数，n 为 op 数量；跨设备不可能重名。
 */

/** 段结构校验失败时抛出；issues 为逐条人类可读描述。 */
export class SegmentValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.length > 0 ? `非法段：${issues.join('；')}` : '非法段');
    this.name = 'SegmentValidationError';
    this.issues = issues;
    Object.setPrototypeOf(this, SegmentValidationError.prototype);
  }
}

/** 段头（写入首行 `{"h": ...}` 的对象）。 */
export const segmentHeaderSchema = z.object({
  seg_id: z.string().min(1),
  schema_ver: z.number().int().min(1),
  dev: actorIdSchema,
  c_from: z.number().int().min(1),
  c_to: z.number().int().min(1),
  n: z.number().int().min(1),
  created_at: z.number().int().nonnegative(),
});
export type SegmentHeader = z.infer<typeof segmentHeaderSchema>;

/** 内存中的段。 */
export interface Segment {
  seg_id: string;
  schema_ver: number;
  header: { dev: ActorId; c_from: number; c_to: number; n: number; created_at: number };
  ops: Op[];
}

const C_FROM_HEX_WIDTH = 8;
const N_HEX_WIDTH = 6;
const SEGMENT_SUFFIXES = ['.jsonl.enc', '.jsonl', '.enc'] as const;

function hex(value: number, width: number, label: string): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new SegmentValidationError([`${label} 必须是非负整数，实际为 ${value}`]);
  }
  const encoded = value.toString(16);
  if (encoded.length > width) {
    throw new SegmentValidationError([`${label}=${value} 超出 ${width} 位十六进制表示范围`]);
  }
  return encoded.padStart(width, '0');
}

/** 由 (设备, c_from, n) 计算规范段 ID。 */
export function computeSegId(dev: ActorId, cFrom: number, n: number): string {
  return `seg-${hex(cFrom, C_FROM_HEX_WIDTH, 'c_from')}-${dev}-${hex(n, N_HEX_WIDTH, 'n')}`;
}

function stripKnownSuffix(name: string): string {
  for (const suffix of SEGMENT_SUFFIXES) {
    if (name.endsWith(suffix)) {
      return name.slice(0, name.length - suffix.length);
    }
  }
  return name;
}

/**
 * 校验段的结构不变量。返回问题列表（空数组表示通过）。
 * 不变量：
 * 1. schema_ver == SCHEMA_VERSION
 * 2. ops 非空，header.n == ops.length
 * 3. 所有 op 的 lamport.d == header.dev，且 c ∈ [c_from, c_to]
 * 4. c_from == min(c)，c_to == max(c)
 * 5. ops 按 compareLamport 严格升序（不得等值）
 * 6. op_id 段内唯一
 * 7. seg_id 与 (dev, c_from, n) 自洽
 */
export function validateSegment(seg: Segment): string[] {
  const issues: string[] = [];

  if (seg.schema_ver !== SCHEMA_VERSION) {
    issues.push(`schema_ver=${seg.schema_ver} 与当前 SCHEMA_VERSION=${SCHEMA_VERSION} 不符`);
  }
  if (seg.ops.length === 0) {
    issues.push('段必须至少包含一个 op');
  }
  if (seg.header.n !== seg.ops.length) {
    issues.push(`header.n=${seg.header.n} 与 ops.length=${seg.ops.length} 不符`);
  }

  const seen = new Set<string>();
  let previous: Op | null = null;
  let minC = Number.POSITIVE_INFINITY;
  let maxC = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < seg.ops.length; i += 1) {
    const op = seg.ops[i];
    if (op === undefined) {
      continue;
    }
    if (op.lamport.d !== seg.header.dev) {
      issues.push(`第 ${i + 1} 个 op 的设备 ${op.lamport.d} 与段头 dev=${seg.header.dev} 不符`);
    }
    if (op.lamport.c < seg.header.c_from || op.lamport.c > seg.header.c_to) {
      issues.push(`第 ${i + 1} 个 op 的 lamport.c=${op.lamport.c} 不在 [${seg.header.c_from}, ${seg.header.c_to}] 内`);
    }
    if (seen.has(op.op_id)) {
      issues.push(`op_id 重复：${op.op_id}`);
    }
    seen.add(op.op_id);
    if (previous !== null && compareLamport(previous.lamport, op.lamport) >= 0) {
      issues.push(`ops 未按 lamport 严格升序：第 ${i} 与第 ${i + 1} 个 op 顺序错误`);
    }
    previous = op;
    minC = Math.min(minC, op.lamport.c);
    maxC = Math.max(maxC, op.lamport.c);
  }

  if (seg.ops.length > 0) {
    if (seg.header.c_from !== minC) {
      issues.push(`header.c_from=${seg.header.c_from} 与最小 lamport.c=${minC} 不符`);
    }
    if (seg.header.c_to !== maxC) {
      issues.push(`header.c_to=${seg.header.c_to} 与最大 lamport.c=${maxC} 不符`);
    }
  }

  try {
    const expectedSegId = computeSegId(seg.header.dev, seg.header.c_from, seg.header.n);
    if (seg.seg_id !== expectedSegId) {
      issues.push(`seg_id=${seg.seg_id} 与由 header 计算出的 ${expectedSegId} 不符`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    issues.push(`seg_id 无法由 header 计算：${reason}`);
  }

  return issues;
}

/**
 * 用给定设备与 op 集合构造一个规范段（按 lamport 升序排序、自动算出 c_from/c_to/n）。
 * 供写入器与测试复用。
 */
export function buildSegment(dev: ActorId, ops: readonly Op[], createdAt: number = Date.now()): Segment {
  if (ops.length === 0) {
    throw new SegmentValidationError(['段至少需要一个 op']);
  }
  const sorted = [...ops].sort((a, b) => {
    const byLamport = compareLamport(a.lamport, b.lamport);
    if (byLamport !== 0) {
      return byLamport;
    }
    if (a.op_id === b.op_id) {
      return 0;
    }
    return a.op_id < b.op_id ? -1 : 1;
  });
  let minC = Number.POSITIVE_INFINITY;
  let maxC = Number.NEGATIVE_INFINITY;
  for (const op of sorted) {
    minC = Math.min(minC, op.lamport.c);
    maxC = Math.max(maxC, op.lamport.c);
  }
  const header = {
    dev,
    c_from: minC,
    c_to: maxC,
    n: sorted.length,
    created_at: createdAt,
  };
  return {
    seg_id: computeSegId(dev, minC, sorted.length),
    schema_ver: SCHEMA_VERSION,
    header,
    ops: sorted,
  };
}

/** 段的规范文件名（不含扩展名）。 */
export function segmentName(seg: Segment): string {
  return seg.seg_id;
}

/**
 * 编码为文本：首行 `{"h":...}`，其后每行一个 encodeOp，末尾带 '\n'。
 * 校验失败 throw SegmentValidationError。
 */
export function encodeSegment(seg: Segment): string {
  const issues = validateSegment(seg);
  if (issues.length > 0) {
    throw new SegmentValidationError(issues);
  }
  const headerLine = stableStringify({
    h: {
      seg_id: seg.seg_id,
      schema_ver: seg.schema_ver,
      dev: seg.header.dev,
      c_from: seg.header.c_from,
      c_to: seg.header.c_to,
      n: seg.header.n,
      created_at: seg.header.created_at,
    },
  });
  const lines: string[] = [headerLine];
  for (const op of seg.ops) {
    lines.push(encodeOp(op));
  }
  return `${lines.join('\n')}\n`;
}

/** 解码段文本，做结构/顺序/schema_ver 全校验。失败 throw SegmentValidationError。 */
export function decodeSegment(text: string): Segment {
  const rawLines = text.split('\n');
  const lines: string[] = [];
  for (const raw of rawLines) {
    lines.push(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    throw new SegmentValidationError(['段内容为空']);
  }

  const headerLine = lines[0] ?? '';
  let headerRaw: unknown;
  try {
    headerRaw = JSON.parse(headerLine);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SegmentValidationError([`首行不是合法 JSON：${reason}`]);
  }
  if (typeof headerRaw !== 'object' || headerRaw === null || !('h' in headerRaw)) {
    throw new SegmentValidationError(['首行缺少 "h" 段头对象']);
  }
  const headerCandidate = (headerRaw as { h: unknown }).h;
  const headerParsed = segmentHeaderSchema.safeParse(headerCandidate);
  if (!headerParsed.success) {
    throw new SegmentValidationError(formatZodError(headerParsed.error).map((item) => `段头 ${item}`));
  }
  const h = headerParsed.data;

  const ops: Op[] = [];
  const opIssues: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    try {
      ops.push(decodeOp(line));
    } catch (error) {
      if (error instanceof OpValidationError) {
        opIssues.push(`第 ${i + 1} 行：${error.issues.join(' / ')}`);
      } else {
        const reason = error instanceof Error ? error.message : String(error);
        opIssues.push(`第 ${i + 1} 行：${reason}`);
      }
    }
  }
  if (opIssues.length > 0) {
    throw new SegmentValidationError(opIssues);
  }

  const segment: Segment = {
    seg_id: h.seg_id,
    schema_ver: h.schema_ver,
    header: {
      dev: h.dev,
      c_from: h.c_from,
      c_to: h.c_to,
      n: h.n,
      created_at: h.created_at,
    },
    ops,
  };

  const issues = validateSegment(segment);
  if (issues.length > 0) {
    throw new SegmentValidationError(issues);
  }
  return segment;
}

/** 断言文件名与段内容一致（忽略 .jsonl / .enc 扩展名），否则 throw SegmentValidationError。 */
export function assertSegmentName(name: string, seg: Segment): void {
  const normalized = stripKnownSuffix(name);
  if (normalized !== seg.seg_id) {
    throw new SegmentValidationError([`文件名 '${name}' 与内容 seg_id='${seg.seg_id}' 不符`]);
  }
}
