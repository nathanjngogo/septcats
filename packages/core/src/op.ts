import { z } from 'zod';

/**
 * 事件账（真相层）的 schema 版本。段文件 header.schema_ver 与快照的 v 字段都引用它。
 * 任何破坏向后兼容的 Op/实体结构变更都必须递增此值。
 */
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// 基础标量
// ---------------------------------------------------------------------------

/** 写入者（设备）标识：8-32 位小写字母或数字。 */
export const actorIdSchema = z
  .string()
  .regex(/^[a-z0-9]{8,32}$/, 'actorId 必须是 8-32 位 [a-z0-9]');
export type ActorId = z.infer<typeof actorIdSchema>;

/**
 * 实体标识。约定为 ULID（见 util/ulid.ts），但此处只做宽松的长度校验：
 * 同步层可能出现外部导入的稳定 ID，过度收紧会在导入路径上误伤。
 */
export const entityIdSchema = z.string().min(1).max(128);
export type EntityId = z.infer<typeof entityIdSchema>;

/** Lamport 逻辑时钟：c>=1，d 为设备标识。 */
export const lamportSchema = z.object({
  c: z.number().int().min(1),
  d: actorIdSchema,
});
export type Lamport = z.infer<typeof lamportSchema>;

/** Op 语义类别。 */
export const opKindSchema = z.enum(['upsert', 'delete', 'move', 'reorder', 'patch']);
export type OpKind = z.infer<typeof opKindSchema>;

/** Op 作用的目标表。 */
export const targetTableSchema = z.enum(['page', 'block', 'collection', 'record', 'schema']);
export type TargetTable = z.infer<typeof targetTableSchema>;

/** Op 目标引用：表 + 实体 ID。 */
export const targetRefSchema = z.object({
  table: targetTableSchema,
  id: entityIdSchema,
});
export type TargetRef = z.infer<typeof targetRefSchema>;

/** Op 载荷：整对象（upsert）或字段级差量（patch/move/reorder）。 */
export const payloadSchema = z.record(z.string(), z.unknown());
export type OpPayload = z.infer<typeof payloadSchema>;

/** 合并策略。一期只允许 'lww'（Q5 预留 CRDT 扩展位）。 */
export const mergePolicySchema = z.literal('lww');
export type MergePolicy = z.infer<typeof mergePolicySchema>;

// ---------------------------------------------------------------------------
// Op
// ---------------------------------------------------------------------------

/** 单条事件。encodeOp/decodeOp 的校验依据。 */
export const opSchema = z.object({
  op_id: z.string().min(1).max(128),
  lamport: lamportSchema,
  at: z.number().int().nonnegative(),
  actor: actorIdSchema,
  target: targetRefSchema,
  kind: opKindSchema,
  payload: payloadSchema,
  base: z.number().int().min(0).optional(),
  merge_policy: mergePolicySchema.optional(),
});
export type Op = z.infer<typeof opSchema>;

/** 实体在物化视图里的通用外形（projection.Entity 同形）。 */
export const entitySchema = z.object({
  table: targetTableSchema,
  id: entityIdSchema,
  version: z.number().int().min(0),
  alive: z.number().int().min(0).max(1),
  data: payloadSchema,
  lamport: lamportSchema,
});
export type EntityShape = z.infer<typeof entitySchema>;

// ---------------------------------------------------------------------------
// 领域实体 schema（M3 定稿前的最小集；schema 包据此生成 JSON Schema）
// ---------------------------------------------------------------------------

const aliveSchema = z.number().int().min(0).max(1);
const versionSchema = z.number().int().min(0);

export const pageSchema = z.object({
  id: entityIdSchema,
  workspace_id: z.string().min(1),
  title: z.string(),
  icon: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  alive: aliveSchema,
  version: versionSchema,
  sort_key: z.string().min(1),
});
export type Page = z.infer<typeof pageSchema>;

export const blockSchema = z.object({
  id: entityIdSchema,
  page_id: entityIdSchema,
  type: z.string().min(1),
  props: payloadSchema,
  content: payloadSchema,
  parent_id: z.string().nullable().optional(),
  sort_key: z.string().min(1),
  alive: aliveSchema,
  version: versionSchema,
  last_edited: z.number().int().nonnegative(),
});
export type Block = z.infer<typeof blockSchema>;

export const collectionSchema = z.object({
  id: entityIdSchema,
  page_id: entityIdSchema,
  schema: payloadSchema,
  views: z.array(payloadSchema),
  alive: aliveSchema,
  version: versionSchema,
});
export type Collection = z.infer<typeof collectionSchema>;

export const recordSchema = z.object({
  id: entityIdSchema,
  collection_id: entityIdSchema,
  values: payloadSchema,
  sort_key: z.string().min(1),
  alive: aliveSchema,
  version: versionSchema,
});
export type RecordEntity = z.infer<typeof recordSchema>;

// ---------------------------------------------------------------------------
// 校验错误
// ---------------------------------------------------------------------------

/** Op 校验失败的统一错误类型；issues 为逐条人类可读描述。 */
export class OpValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.length > 0 ? `非法 Op：${issues.join('；')}` : '非法 Op');
    this.name = 'OpValidationError';
    this.issues = issues;
    // 兼容被降级编译时的原型链（instanceof 仍然成立）
    Object.setPrototypeOf(this, OpValidationError.prototype);
  }
}

export function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * 契约中无法用纯 zod 表达的语义约束（zod 会保留给 JSON Schema 生成，故不写 refine）：
 * - base 仅用于 patch/move/reorder 的并发基版本检测；upsert/delete 必须为空。
 */
export function validateOpSemantics(op: Op): string[] {
  const issues: string[] = [];
  if ((op.kind === 'upsert' || op.kind === 'delete') && op.base !== undefined) {
    issues.push(`kind=${op.kind} 不允许携带 base（并发基版本仅适用于 patch/move/reorder）`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 稳定序列化
// ---------------------------------------------------------------------------

function stringifyStable(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('stableStringify：不支持非有限数字（NaN/Infinity）');
      }
      return JSON.stringify(value);
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items = value.map((item: unknown) => (item === undefined ? 'null' : stringifyStable(item)));
        return `[${items.join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const child = record[key];
        if (child === undefined) {
          continue;
        }
        parts.push(`${JSON.stringify(key)}:${stringifyStable(child)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`stableStringify：不支持的类型 ${typeof value}`);
  }
}

/**
 * 键序稳定的 JSON 序列化：对象键按 UTF-16 升序，数组顺序保留，undefined 键被丢弃。
 * 单行输出，用于 op / header / snapshot，保证“同内容同字节”。
 */
export function stableStringify(value: unknown): string {
  return stringifyStable(value);
}

// ---------------------------------------------------------------------------
// 编解码
// ---------------------------------------------------------------------------

/** 把 Op 编码为单行、键序稳定的 JSON。校验失败 throw OpValidationError。 */
export function encodeOp(op: Op): string {
  const parsed = opSchema.safeParse(op);
  if (!parsed.success) {
    throw new OpValidationError(formatZodError(parsed.error));
  }
  const semanticIssues = validateOpSemantics(parsed.data);
  if (semanticIssues.length > 0) {
    throw new OpValidationError(semanticIssues);
  }
  return stableStringify(parsed.data);
}

/** 从单行 JSON 解码 Op。校验失败 throw OpValidationError。 */
export function decodeOp(line: string): Op {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new OpValidationError([`不是合法 JSON：${reason}`]);
  }
  const parsed = opSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OpValidationError(formatZodError(parsed.error));
  }
  const semanticIssues = validateOpSemantics(parsed.data);
  if (semanticIssues.length > 0) {
    throw new OpValidationError(semanticIssues);
  }
  return parsed.data;
}

/** 比较两条 Op 的 lamport（升序）。用于 replay 前的确定性排序。 */
export function compareOpLamport(a: Op, b: Op): number {
  if (a.lamport.c !== b.lamport.c) {
    return a.lamport.c < b.lamport.c ? -1 : 1;
  }
  if (a.lamport.d !== b.lamport.d) {
    return a.lamport.d < b.lamport.d ? -1 : 1;
  }
  if (a.op_id !== b.op_id) {
    return a.op_id < b.op_id ? -1 : 1;
  }
  return 0;
}
