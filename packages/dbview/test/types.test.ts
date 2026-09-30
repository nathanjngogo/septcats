/**
 * types.test.ts —— 实体/属性/视图 zod 契约（TASK-T7-01 §1）。
 *
 * 覆盖：属性类型白名单、值类型级校验（`VALUE_SCHEMA_BY_TYPE`）、
 * collection/record 实体解析、视图 schema、title_pid 回落、JSON 往返保序。
 */
import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  NEW_PROPERTY_TYPES,
  VALUE_SCHEMA_BY_TYPE,
  collectionEntitySchema,
  collectionSchemaSchema,
  coerceValue,
  dateValueSchema,
  dbViewSchema,
  defaultView,
  emptyFilter,
  isFieldType,
  isValidValue,
  parseCollectionSchema,
  parseRecordValues,
  parseViews,
  propertyList,
  propertyOptionSchema,
  propertySchema,
  recordEntitySchema,
  titleProperty,
  type FieldType,
} from '../src/types';

const OPTIONS = [
  propertyOptionSchema.parse({ id: 'o1', name: '在读', tone: 'amber' }),
  propertyOptionSchema.parse({ id: 'o2', name: '弃读', tone: 'red' }),
];

const SCHEMA = collectionSchemaSchema.parse({
  properties: {
    p1: { id: 'p1', name: '书名', type: 'text' },
    p2: { id: 'p2', name: '评分', type: 'number' },
    p3: { id: 'p3', name: '状态', type: 'select', options: OPTIONS },
  },
  title_pid: 'p1',
});

describe('属性类型白名单', () => {
  it('白名单含 schema-v1 §4 全部值形态 + ai（T18-04）；新属性菜单 9 种', () => {
    expect([...FIELD_TYPES]).toEqual([
      'text',
      'number',
      'select',
      'multi_select',
      'date',
      'checkbox',
      'url',
      'email',
      'relation',
      'file',
      'ai',
    ]);
    expect([...NEW_PROPERTY_TYPES]).toHaveLength(9);
    expect(NEW_PROPERTY_TYPES).not.toContain('file');
    expect(NEW_PROPERTY_TYPES).not.toContain('email');
    expect(NEW_PROPERTY_TYPES).toContain('ai'); // T18-04：属性菜单可见
    expect(isFieldType('relation')).toBe(true);
    expect(isFieldType('ai')).toBe(true);
    expect(isFieldType('callout')).toBe(false);
  });

  it('未知类型被 zod 拒；options.tone 只允许三语义色', () => {
    expect(propertySchema.safeParse({ id: 'x', name: 'x', type: 'bogus' }).success).toBe(false);
    expect(propertyOptionSchema.safeParse({ id: 'o', name: 'n', tone: 'blue' }).success).toBe(false);
    expect(propertyOptionSchema.parse({ id: 'o', name: 'n' }).tone).toBeUndefined();
  });
});

describe('值类型级校验', () => {
  it('每类型接受自身形态、拒绝异形态', () => {
    expect(isValidValue('text', 'x')).toBe(true);
    expect(isValidValue('text', 5)).toBe(false);
    expect(isValidValue('number', 1.5)).toBe(true);
    expect(isValidValue('number', Number.NaN)).toBe(false);
    expect(isValidValue('number', '1.5')).toBe(false);
    expect(isValidValue('checkbox', true)).toBe(true);
    expect(isValidValue('checkbox', 'true')).toBe(false);
    expect(isValidValue('select', 'o1')).toBe(true);
    expect(isValidValue('select', '')).toBe(false);
    expect(isValidValue('multi_select', ['o1', 'o2'])).toBe(true);
    expect(isValidValue('multi_select', 'o1')).toBe(false);
    expect(isValidValue('date', { y: 2026, m: 7, d: 2 })).toBe(true);
    expect(isValidValue('date', { y: 2026, m: 13, d: 2 })).toBe(false);
    expect(isValidValue('date', { y: 2026, m: 7, d: 2, tz: 'Asia/Shanghai' })).toBe(true);
    expect(isValidValue('url', 'https://x.test')).toBe(true);
    expect(isValidValue('file', ['a.pdf'])).toBe(true);
    expect(isValidValue('file', 'a.pdf')).toBe(false);
    expect(isValidValue('relation', ['r1'])).toBe(true);
  });

  it('空值（undefined/null）恒合法；coerceValue 非法 → null', () => {
    for (const type of FIELD_TYPES) {
      expect(isValidValue(type, null), type).toBe(true);
      expect(isValidValue(type, undefined), type).toBe(true);
    }
    expect(coerceValue('number', 'abc')).toBeNull();
    expect(coerceValue('number', '1.5')).toBeNull(); // 字符串不自动转数
    expect(coerceValue('number', 1.5)).toBe(1.5);
    expect(coerceValue('date', { y: 2026, m: 2, d: 30 })).toBeNull();
    expect(coerceValue('text', 5)).toBeNull();
    expect(coerceValue('text', undefined)).toBeNull();
    expect(coerceValue('select', 'o1')).toBe('o1');
  });

  it('VALUE_SCHEMA_BY_TYPE 覆盖全部白名单类型', () => {
    for (const type of FIELD_TYPES) {
      expect(VALUE_SCHEMA_BY_TYPE[type], type).toBeDefined();
    }
  });

  it('dateValueSchema 单独可用（走 dz 校验）', () => {
    expect(dateValueSchema.safeParse({ y: 2026, m: 12, d: 31 }).success).toBe(true);
    expect(dateValueSchema.safeParse({ y: 2026, m: 0, d: 1 }).success).toBe(false);
  });
});

describe('collection / record 实体', () => {
  it('collection 实体解析：page_id 可 null（独立 DB 页）', () => {
    const parsed = collectionEntitySchema.parse({
      id: 'col-1',
      page_id: null,
      workspace_id: 'ws-1',
      name: '阅读清单',
      schema: SCHEMA,
      views: [defaultView('v1')],
      alive: 1,
      version: 3,
    });
    expect(parsed.page_id).toBeNull();
    expect(parsed.schema.title_pid).toBe('p1');
  });

  it('record 实体解析：values 任意形态、backlinks 可选', () => {
    const parsed = recordEntitySchema.parse({
      id: 'rec-1',
      collection_id: 'col-1',
      workspace_id: 'ws-1',
      values: { p1: '哥德尔', p2: 4.5, p3: 'o1' },
      sort_key: 'A00000001',
      alive: 1,
      version: 2,
      backlinks: { 'col-1': ['rec-9'] },
    });
    expect(parsed.backlinks).toEqual({ 'col-1': ['rec-9'] });
    expect(recordEntitySchema.parse({ ...parsed, backlinks: undefined }).backlinks).toBeUndefined();
  });
});

describe('视图 schema / 助手', () => {
  it('defaultView 形状；widths/ sort 全 JSON 安全', () => {
    const view = defaultView('v1', '表格');
    expect(view).toEqual({ vid: 'v1', name: '表格', type: 'table', filter: emptyFilter(), sort: [], widths: {} });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(dbViewSchema.safeParse(view).success).toBe(true);
    // T99-01：kanban 已落地（VIEW_TYPES 第二档）→ 合法；未登记的类型仍须被拒。
    expect(dbViewSchema.safeParse({ ...view, type: 'kanban' }).success).toBe(true);
    expect(dbViewSchema.safeParse({ ...view, type: 'gantt' }).success).toBe(false);
    expect(dbViewSchema.safeParse({ ...view, sort: [{ prop: 'p', dir: 'sideways' }] }).success).toBe(false);
  });

  it('parseCollectionSchema / parseViews / parseRecordValues 失败返回 null', () => {
    expect(parseCollectionSchema(SCHEMA)).toEqual(SCHEMA);
    expect(parseCollectionSchema({ properties: 'nope' })).toBeNull();
    expect(parseViews([defaultView('v1')])).toHaveLength(1);
    expect(parseViews('nope')).toBeNull();
    expect(parseRecordValues({ p1: 'x' })).toEqual({ p1: 'x' });
    expect(parseRecordValues([1, 2])).toBeNull();
  });

  it('propertyList 保插入序（JSON 往返不变）；titleProperty 回落', () => {
    expect(propertyList(SCHEMA).map((property) => property.id)).toEqual(['p1', 'p2', 'p3']);
    const round = collectionSchemaSchema.parse(JSON.parse(JSON.stringify(SCHEMA)));
    expect(propertyList(round).map((property) => property.id)).toEqual(['p1', 'p2', 'p3']);

    expect(titleProperty(SCHEMA)?.id).toBe('p1');
    const fallback = collectionSchemaSchema.parse({ ...SCHEMA, title_pid: 'ghost' });
    expect(titleProperty(fallback)?.id).toBe('p1');
  });
});

describe('值类型白名单与 schema-v1 §4 的对应', () => {
  const EXPECTED: Readonly<Record<FieldType, string>> = {
    text: 'string',
    number: 'number',
    select: '选项 id',
    multi_select: '选项 id[]',
    date: '{y,m,d,tz?}',
    checkbox: 'bool',
    url: 'string',
    email: 'string',
    relation: '目标 record id[]',
    file: '文件名[]',
    ai: 'string（T18-04：模型生成列）',
  };

  it('每个类型的取值范本都通过自身 schema', () => {
    const samples: Readonly<Record<FieldType, unknown>> = {
      text: '文本',
      number: 1,
      select: 'o1',
      multi_select: ['o1'],
      date: { y: 2026, m: 1, d: 1 },
      checkbox: true,
      url: 'https://x.test',
      email: 'a@b.co',
      relation: ['rec-1'],
      file: ['a.pdf'],
      ai: '用一句话概括：这是一本讲认知科学的书。',
    };
    for (const type of FIELD_TYPES) {
      expect(EXPECTED[type], type).toBeDefined();
      expect(coerceValue(type, samples[type]), type).toEqual(samples[type]);
    }
  });
});

describe('AI 属性列（TASK-T18-04 追加，不改既有断言）', () => {
  it('propertySchema 接受 ai 列与可选 ai.prompt 配置；旧形状（无 ai 键）零迁移', () => {
    const withPrompt = propertySchema.parse({ id: 'p_ai', name: '摘要', type: 'ai', ai: { prompt: '用一句话概括本行' } });
    expect(withPrompt.type).toBe('ai');
    expect(withPrompt.ai).toEqual({ prompt: '用一句话概括本行' });
    // 无 ai 配置 = 合法（可选键），生成回落默认指令
    const bare = propertySchema.parse({ id: 'p_ai2', name: '摘要', type: 'ai' });
    expect(bare.ai).toBeUndefined();
    // 旧数据里的 text 列带 ai 键也能保序往返（extra 键剥除由 zod 完成）
    expect(propertySchema.safeParse({ id: 'x', name: 'x', type: 'text', ai: { prompt: 'p' } }).success).toBe(true);
  });

  it('未知类型仍被 zod 拒（ai 之外不放行，如 claude）', () => {
    expect(propertySchema.safeParse({ id: 'x', name: 'x', type: 'claude' }).success).toBe(false);
    expect(propertySchema.safeParse({ id: 'x', name: 'x', type: 'ai', ai: { prompt: 123 } }).success).toBe(false);
  });

  it('ai 值 = 纯字符串（与 text 同路）：isValidValue / coerceValue', () => {
    expect(isValidValue('ai', '生成的文本')).toBe(true);
    expect(isValidValue('ai', 42)).toBe(false);
    expect(isValidValue('ai', { text: '对象形态拒绝' })).toBe(false);
    expect(isValidValue('ai', null)).toBe(true);
    expect(coerceValue('ai', '摘要')).toBe('摘要');
    expect(coerceValue('ai', undefined)).toBeNull();
  });
});
