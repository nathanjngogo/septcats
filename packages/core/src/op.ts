import { z } from 'zod';

/**
 * 事件账（真相层）的 schema 版本。段文件 header.schema_ver 与快照的 v 字段都引用它。
 * 任何破坏向后兼容的 Op/实体结构变更都必须递增此值。
 *
 * v2（T19-02）：新增 op kind `crdt_update` 与 merge_policy `lww-field`/`crdt`。
 * 本次变更对既有格式只增不改——v1 段的每一行都是合法的 v2 op，读 v1 段语义
 * 与 v1 时代逐字节等价（段校验按 [MIN_SUPPORTED_SCHEMA_VERSION, SCHEMA_VERSION] 放行）。
 *
 * v3（T23-01）：新增 op kind `template` 与目标表 `template`（模板子系统数据面）。
 * 仍只增不改——v1/v2 段的每一行都是合法的 v3 op，读旧段语义逐字节等价；
 * template op 走默认 LWW 整对象（MERGE_POLICIES 不变），replay 按整对象生效。
 */
export const SCHEMA_VERSION = 3;

/** 仍可读取的最低 schema 版本（v1 段照常可读；高于 SCHEMA_VERSION 的段仍被拒绝）。 */
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;

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

/** Op 语义类别全集（schema v2 起新增 'crdt_update'：承载 CRDT 增量，如 Yjs update；
 * schema v3 起新增 'template'：模板整对象写（upsert 语义，走默认 LWW），T23-01）。 */
export const OP_KINDS = ['upsert', 'delete', 'move', 'reorder', 'patch', 'crdt_update', 'template'] as const;
export const opKindSchema = z.enum(OP_KINDS);
export type OpKind = z.infer<typeof opKindSchema>;

/** Op 作用的目标表（schema v3 起新增 'template'：模板表，T23-01）。 */
export const targetTableSchema = z.enum(['page', 'block', 'collection', 'record', 'schema', 'template']);
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

/**
 * 合并策略全集（schema v2 起 = ['lww', 'lww-field', 'crdt']；v1 段只会出现 'lww'，照常可读）。
 * op.merge_policy 缺省时按 'lww' 处理。各策略在 replay 中的语义：
 * - 'lww'：实体级 LWW——op 整体按 (lamport, deviceId) 全序与现有实体决胜，胜者整体生效；
 * - 'lww-field'：字段级（key 粒度）LWW——payload 是只携带变更 key 的 patch 对象
 *   （不再整对象 upsert），replay 按键合并进现有投影：出现的 key 覆盖、未出现的 key
 *   保留原值、`null` = 删除该 key；同 key 并发按既有全序（lamport, deviceId）决胜。
 *   record 值写入固定使用本策略；
 * - 'crdt'：CRDT 增量（crdt_update 的 base64 update）——不参与 LWW、不作用于实体投影，
 *   replay 按全序去重收集到 ReplayReport.crdtUpdates，由上层（Y.Doc）幂等应用。
 */
export const MERGE_POLICIES = ['lww', 'lww-field', 'crdt'] as const;
export const mergePolicySchema = z.enum(MERGE_POLICIES);
export type MergePolicy = z.infer<typeof mergePolicySchema>;

/**
 * `crdt_update` 专用 payload：base64 文本对 core 完全不透明（不解码、不校验内容）。
 * `pageId` 声明该 update 所属的页级 Y.Doc；`svFromB64` 是发送方的状态向量水位（可选）。
 */
export const crdtUpdatePayloadSchema = z.object({
  pageId: entityIdSchema,
  updateB64: z.string().min(1),
  svFromB64: z.string().min(1).optional(),
});
export type CrdtUpdatePayload = z.infer<typeof crdtUpdatePayloadSchema>;

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
 * - base 仅用于 patch/move/reorder 的并发基版本检测；upsert/delete 必须为空；
 * - crdt_update 的 payload 必须满足 crdtUpdatePayloadSchema，且 merge_policy 固定为
 *   'crdt'（显式给出其他值或把 'crdt' 用在别的 kind 上都拒绝）。
 */
export function validateOpSemantics(op: Op): string[] {
  const issues: string[] = [];
  if ((op.kind === 'upsert' || op.kind === 'delete') && op.base !== undefined) {
    issues.push(`kind=${op.kind} 不允许携带 base（并发基版本仅适用于 patch/move/reorder）`);
  }
  if (op.kind === 'crdt_update') {
    const parsed = crdtUpdatePayloadSchema.safeParse(op.payload);
    if (!parsed.success) {
      for (const message of formatZodError(parsed.error)) {
        issues.push(`crdt_update payload ${message}`);
      }
    }
    if (op.merge_policy !== undefined && op.merge_policy !== 'crdt') {
      issues.push(`kind=crdt_update 的 merge_policy 固定为 'crdt'，实际为 '${op.merge_policy}'`);
    }
  } else if (op.merge_policy === 'crdt') {
    issues.push(`merge_policy='crdt' 仅允许 kind=crdt_update，实际 kind=${op.kind}`);
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
