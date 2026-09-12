import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, blockTypes, generateJsonSchema, targetTables } from '../src/index';

interface JsonObjectSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

const BLOCK_FIELDS = [
  'id',
  'page_id',
  'type',
  'props',
  'content',
  'parent_id',
  'sort_key',
  'alive',
  'version',
  'last_edited',
] as const;

const PAGE_FIELDS = [
  'id',
  'workspace_id',
  'title',
  'icon',
  'cover',
  'parent_id',
  'alive',
  'version',
  'sort_key',
] as const;

const OP_FIELDS = [
  'op_id',
  'lamport',
  'at',
  'actor',
  'target',
  'kind',
  'payload',
  'base',
  'merge_policy',
] as const;

describe('schema', () => {
  it('SCHEMA_VERSION 导出', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(blockTypes.length).toBeGreaterThan(0);
    expect(blockTypes).toContain('paragraph');
    expect(blockTypes).toContain('code');
    expect(targetTables).toContain('block');
    expect(targetTables).toContain('page');
  });

  it('zod→JSON Schema 生成非空且含 block/page 全字段', () => {
    const doc = generateJsonSchema();

    expect(doc.version).toBe(SCHEMA_VERSION);
    expect(doc.$schema).toContain('json-schema.org');
    expect(doc.$id).toContain(`v${SCHEMA_VERSION}`);
    expect(Object.keys(doc.definitions).sort()).toEqual([
      'block',
      'collection',
      'op',
      'page',
      'record',
    ]);

    const block = doc.definitions['block'] as JsonObjectSchema;
    const page = doc.definitions['page'] as JsonObjectSchema;
    const op = doc.definitions['op'] as JsonObjectSchema;

    expect(block.type).toBe('object');
    expect(page.type).toBe('object');
    expect(op.type).toBe('object');

    expect(Object.keys(block.properties ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(page.properties ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(op.properties ?? {}).length).toBeGreaterThan(0);

    for (const field of BLOCK_FIELDS) {
      expect(block.properties ?? {}).toHaveProperty(field);
    }
    for (const field of PAGE_FIELDS) {
      expect(page.properties ?? {}).toHaveProperty(field);
    }
    for (const field of OP_FIELDS) {
      expect(op.properties ?? {}).toHaveProperty(field);
    }
  });

  it('JSON Schema 可 JSON 往返且稳定', () => {
    const doc = generateJsonSchema();
    const roundTrip = JSON.parse(JSON.stringify(doc)) as typeof doc;
    expect(roundTrip.definitions['block']).toEqual(doc.definitions['block']);
    expect(roundTrip.definitions['page']).toEqual(doc.definitions['page']);
    expect(roundTrip.definitions['op']).toEqual(doc.definitions['op']);
  });
});
