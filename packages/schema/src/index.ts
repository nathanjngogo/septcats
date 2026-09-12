import { z } from 'zod';
import {
  SCHEMA_VERSION,
  blockSchema,
  collectionSchema,
  opSchema,
  pageSchema,
  recordSchema,
} from '@septcats/core';

/**
 * @septcats/schema —— 把 @septcats/core 的 zod schema 翻成 JSON Schema，
 * 并集中导出跨模块需要共享的常量（schema 版本、块类型白名单、目标表）。
 * 版本号本身来自 core（唯一来源），此处只做再导出。
 */

export { SCHEMA_VERSION };

/** 一期块类型白名单（对应 M4.2；与实际块规范一起演进）。 */
export const blockTypes = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulleted_list',
  'numbered_list',
  'todo',
  'quote',
  'callout',
  'code',
  'divider',
  'image',
  'page_link',
  'bookmark',
] as const;
export type BlockType = (typeof blockTypes)[number];

/** Op 可作用的目标表（与 core 的 targetTableSchema 保持一致）。 */
export const targetTables = ['page', 'block', 'collection', 'record', 'schema'] as const;
export type TargetTableName = (typeof targetTables)[number];

/** generateJsonSchema() 的返回结构。 */
export interface JsonSchemaDocument {
  $schema: string;
  $id: string;
  title: string;
  version: number;
  blockTypes: readonly string[];
  definitions: Record<string, unknown>;
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

/**
 * 生成一份包含 op / page / block / collection / record 完整字段的 JSON Schema 文档。
 * 供（a）M3 的 schema-v1.md 对照、（b）外部导入器与契约测试做结构校验。
 */
export function generateJsonSchema(): JsonSchemaDocument {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://septcats.local/schema/v${SCHEMA_VERSION}.json`,
    title: `Septcats event & entity schema v${SCHEMA_VERSION}`,
    version: SCHEMA_VERSION,
    blockTypes,
    definitions: {
      op: toJsonSchema(opSchema),
      page: toJsonSchema(pageSchema),
      block: toJsonSchema(blockSchema),
      collection: toJsonSchema(collectionSchema),
      record: toJsonSchema(recordSchema),
    },
  };
}
