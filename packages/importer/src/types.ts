/**
 * types.ts —— M12 ImportPlan 全契约（任务书 §1）+ ImportSourceFs 注入面。
 *
 * 铁律（任务书 §0.1）：importer 是**纯逻辑包，零 IO**——输入 = 注入的
 * ImportSourceFs（测试用内存 Map 实现），输出 = ImportPlan（不直接写库）；
 * 所有落库动作由 desktop main 侧执行。warnings 全量记录降级/跳过，绝不静默。
 */
import { z } from 'zod';
import { pmDocSchema, tableContentSchema, toggleContentSchema } from '@septcats/editor';
import type { BlockSpec, PMDocJSON } from '@septcats/editor';

export type { BlockSpec, PMDocJSON };

// ---------------------------------------------------------------------------
// 块规格
// ---------------------------------------------------------------------------

/**
 * 与 @septcats/editor 的 BlockSpec 同构（zod 校验版）；type 用真相层名。
 * R25（T76-01）：content 联合随 editor 的 BlockContent 扩到 5 形态（新增 table/toggle
 * 两个结构化对象）——只放宽**接受面**，importer 自身不产出这两型（GFM 表格仍按
 * 一期口径降级为 code 块 + warning，见 markdown.ts），导入行为零改动。
 */
export const blockSpecSchema = z.object({
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  content: z.union([pmDocSchema, z.string(), tableContentSchema, toggleContentSchema, z.null()]),
});

// ---------------------------------------------------------------------------
// ImportWarning（任务书 §5：warning 结构）
// ---------------------------------------------------------------------------

export const importWarningActionSchema = z.enum(['degraded', 'skipped-duplicate', 'failed']);

export const importWarningSchema = z.object({
  /** 发生位置（源内相对路径，md-file 时为文件名） */
  path: z.string(),
  /** 什么东西触发了降级/跳过（如 'GFM 表格'、'front-matter tags'） */
  what: z.string(),
  action: importWarningActionSchema,
  /** 处置说明（人读） */
  note: z.string(),
});
export type ImportWarning = z.infer<typeof importWarningSchema>;

// ---------------------------------------------------------------------------
// ImportItem（判别联合，三形态）
// ---------------------------------------------------------------------------

/** collection 的 schema 定义（schema-v1 §4：properties + title_pid）。 */
export const collectionSchemaDefSchema = z.object({
  properties: z.record(
    z.string(),
    z.object({
      name: z.string(),
      type: z.string(),
      options: z.array(z.unknown()).optional(),
      format: z.unknown().optional(),
    }),
  ),
  title_pid: z.string(),
});
export type CollectionSchemaDef = z.infer<typeof collectionSchemaDefSchema>;

/** record 的 values（pid → 值；值形随属性类型，schema-v1 §4）。 */
export type RecordValues = Record<string, unknown>;

export const importItemSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('page'),
    /** 源内相对路径（无扩展名树节点语义时与文件路径一致） */
    path: z.string().min(1),
    title: z.string(),
    /** 父页路径；根页为 null */
    parentPath: z.string().nullable(),
    blocks: z.array(blockSpecSchema),
  }),
  z.object({
    op: z.literal('collection'),
    path: z.string().min(1),
    title: z.string(),
    parentPath: z.string().nullable(),
    schema: collectionSchemaDefSchema,
    records: z.array(z.record(z.string(), z.unknown())),
  }),
  z.object({
    op: z.literal('asset'),
    /** sha256 hex（64 位） */
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    /** 含点扩展名（如 '.png'）；无法识别时为 '' */
    ext: z.string(),
    /** bytes 仅 preview 前存在于内存，执行落盘后即弃 */
    bytes: z.instanceof(Uint8Array),
  }),
]);
export type ImportItem = z.infer<typeof importItemSchema>;

// ---------------------------------------------------------------------------
// ImportPlan
// ---------------------------------------------------------------------------

export const importSourceKindSchema = z.enum(['notion-zip', 'md-dir', 'md-file', 'csv']);

export const importPlanSchema = z.object({
  source: z.object({
    kind: importSourceKindSchema,
    rootName: z.string(),
  }),
  /** 有序 = 树先序，执行按此序 */
  items: z.array(importItemSchema),
  counts: z.object({
    pages: z.number().int().nonnegative(),
    collections: z.number().int().nonnegative(),
    records: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    skippedDuplicate: z.number().int().nonnegative(),
    degraded: z.number().int().nonnegative(),
  }),
  /** 降级/跳过项全量，绝不静默 */
  warnings: z.array(importWarningSchema),
});
export type ImportPlan = z.infer<typeof importPlanSchema>;

/** 按 items/warnings 统计 counts 并组装 plan（skippedDuplicate 由计划器 B 阶段填）。 */
export function buildPlan(
  source: { kind: (typeof importSourceKindSchema)['options'][number]; rootName: string },
  items: ImportItem[],
  warnings: ImportWarning[],
): ImportPlan {
  const counts = {
    pages: 0,
    collections: 0,
    records: 0,
    assets: 0,
    skippedDuplicate: 0,
    degraded: 0,
  };
  for (const item of items) {
    if (item.op === 'page') {
      counts.pages += 1;
    } else if (item.op === 'collection') {
      counts.collections += 1;
      counts.records += item.records.length;
    } else {
      counts.assets += 1;
    }
  }
  for (const warning of warnings) {
    if (warning.action === 'degraded') {
      counts.degraded += 1;
    }
  }
  return { source: { kind: source.kind, rootName: source.rootName }, items, counts, warnings };
}

// ---------------------------------------------------------------------------
// ImportSourceFs（注入的文件读抽象）
// ---------------------------------------------------------------------------

/**
 * 源文件系统抽象：list() 返回源内全部**文件**的相对路径（目录不单列，
 * 由路径前缀表达，POSIX '/' 分隔，不以 '/' 开头）；read() 按相对路径取内容
 * （文本或字节，缺失时 throw）。测试用内存 Map 实现，desktop 用真实 fs/zip。
 */
export interface ImportSourceFs {
  list(): string[];
  read(path: string): string | Uint8Array;
}

/** 统一转字节（附件 hash 与 asset bytes 都需要）；非字符串输入做一次拷贝，
 * 保证得到 ArrayBuffer 落位（TS5.9 泛型语义下与 z.instanceof(Uint8Array) 对齐）。 */
export function toBytes(value: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
}
