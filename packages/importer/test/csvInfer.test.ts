import { describe, expect, it } from 'vitest';
import { inferCsv, parseCsvFile, parseCsvRows } from '../src/csvInfer';
import { importPlanSchema } from '../src/types';
import type { ImportSourceFs } from '../src/types';

/** 内存 Map 版 ImportSourceFs（任务书 §0.1：测试用注入实现）。 */
function memoryFs(entries: Record<string, string>): ImportSourceFs {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    list: () => [...map.keys()],
    read: (path: string) => {
      const value = map.get(path);
      if (value === undefined) {
        throw new Error(`missing: ${path}`);
      }
      return value;
    },
  };
}

describe('parseCsvRows：RFC4180 行级解析', () => {
  it('引号字段：含逗号、含换行、"" 转义、CRLF、BOM、尾部无换行', () => {
    const text = '﻿a,b\n"含,逗号","he said ""hi"""\r\n"x\ny",z\n尾,列';
    expect(parseCsvRows(text)).toEqual([
      ['a', 'b'],
      ['含,逗号', 'he said "hi"'],
      ['x\ny', 'z'],
      ['尾', '列'],
    ]);
  });

  it('全空行丢弃；空字段保留', () => {
    expect(parseCsvRows('a,b\n\n,\n\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('inferCsv：列类型推断（任务书 §2 顺序裁决）', () => {
  it('number：全整数/小数/负数；空值不参与推断且落 null', () => {
    const { schema, records } = inferCsv('Name,数量,比率\ncat,3,1.5\ndog,-2,.5\nfish,,\nopossum,10,-4.25\n');
    const props = Object.values(schema.properties);
    expect(props.map((p) => p.type)).toEqual(['text', 'number', 'number']);
    expect(records[0]).toEqual({ p1: 'cat', p2: 3, p3: 1.5 });
    expect(records[1]).toEqual({ p1: 'dog', p2: -2, p3: 0.5 });
    expect(records[2]).toEqual({ p1: 'fish', p2: null, p3: null });
    expect(records[3]).toEqual({ p1: 'opossum', p2: 10, p3: -4.25 });
  });

  it('date：2024-01-01 与 ISO datetime 都落 date（值形 {y,m,d}）；非法日历列落 text', () => {
    const { schema, records } = inferCsv('Name,日,坏日\ncat,2024-01-02,2024-01-02\ndog,2025-12-31T08:30:00Z,2024-02-30\n');
    const props = Object.values(schema.properties);
    expect(props.map((p) => p.type)).toEqual(['text', 'date', 'text']);
    expect(records[0]).toEqual({ p1: 'cat', p2: { y: 2024, m: 1, d: 2 }, p3: '2024-01-02' });
    expect(records[1]).toEqual({ p1: 'dog', p2: { y: 2025, m: 12, d: 31 }, p3: '2024-02-30' });
  });

  it('checkbox：true/false → boolean 值；混入其它词 → 整列 text', () => {
    const ok = inferCsv('Name,完成\ncat,true\ndog,false\n');
    expect(Object.values(ok.schema.properties)[1]?.type).toBe('checkbox');
    expect(ok.records).toEqual([
      { p1: 'cat', p2: true },
      { p1: 'dog', p2: false },
    ]);

    const mixed = inferCsv('Name,完成\ncat,true\ndog,是\n');
    expect(Object.values(mixed.schema.properties)[1]?.type).toBe('text');
    expect(mixed.records).toEqual([
      { p1: 'cat', p2: 'true' },
      { p1: 'dog', p2: '是' },
    ]);
  });

  it('multi_select：含逗号 token 集 ≤20 → 选项 + id 值数组；首现序定选项', () => {
    const { schema, records } = inferCsv('Name,标签\ncat,"工作,紧急"\ndog,"工作,生活"\nfish,紧急\n');
    const prop = schema.properties['p2'];
    expect(prop?.type).toBe('multi_select');
    expect(prop?.options).toEqual([
      { id: 'p2-o1', name: '工作' },
      { id: 'p2-o2', name: '紧急' },
      { id: 'p2-o3', name: '生活' },
    ]);
    expect(records[0]).toEqual({ p1: 'cat', p2: ['p2-o1', 'p2-o2'] });
    expect(records[1]).toEqual({ p1: 'dog', p2: ['p2-o1', 'p2-o3'] });
    expect(records[2]).toEqual({ p1: 'fish', p2: ['p2-o2'] });
  });

  it('token 集 >20 → 整列 text（保留原文逗号串）', () => {
    const tokens = Array.from({ length: 21 }, (_, i) => `t${i + 1}`);
    const text = `Name,标签\ncat,"${tokens.slice(0, 10).join(',')}"\ndog,"${tokens.slice(10).join(',')}"\n`;
    const { schema, records } = inferCsv(text);
    expect(schema.properties['p2']?.type).toBe('text');
    expect(schema.properties['p2']?.options).toBeUndefined();
    expect(records[0]).toEqual({ p1: 'cat', p2: tokens.slice(0, 10).join(',') });
  });

  it('混合列 → text；全空列 → text', () => {
    const { schema } = inferCsv('Name,混合,空列\ncat,12,\ndog,abc,\n');
    const props = Object.values(schema.properties);
    expect(props.map((p) => p.type)).toEqual(['text', 'text', 'text']);
  });

  it('行短于表头：缺失的行尾列按空值 null', () => {
    const { records } = inferCsv('Name,数量,备注\ncat,1\n');
    expect(records[0]).toEqual({ p1: 'cat', p2: 1, p3: null });
  });
});

describe('inferCsv：title 属性（schema-v1 title_pid）', () => {
  it('名称 列 → title_pid 且强制 text（值原样字符串）', () => {
    const { schema, records } = inferCsv('名称,数量\n猫粮,3\n');
    expect(schema.title_pid).toBe('p1');
    expect(schema.properties['p1']?.type).toBe('text');
    expect(records[0]).toEqual({ p1: '猫粮', p2: 3 });
  });

  it('Name 列（英文）同样识别', () => {
    const { schema } = inferCsv('数量,Name\n3,cat\n');
    expect(schema.title_pid).toBe('p2');
    expect(schema.properties['p2']?.type).toBe('text');
  });

  it('缺 名称/Name → 第一列当 title（即便该列值像数字，也强制 text）', () => {
    const { schema, records } = inferCsv('编号,备注\n007,abc\n');
    expect(schema.title_pid).toBe('p1');
    expect(schema.properties['p1']?.type).toBe('text');
    expect(records[0]).toEqual({ p1: '007', p2: 'abc' });
  });
});

describe('inferCsv：边界', () => {
  it('空文件/纯空行 → 空 schema 与空 records', () => {
    expect(inferCsv('')).toEqual({ schema: { properties: {}, title_pid: '' }, records: [] });
    expect(inferCsv('\n\n')).toEqual({ schema: { properties: {}, title_pid: '' }, records: [] });
  });

  it('同名表头不冲突（pid 按位置派生）', () => {
    const { schema, records } = inferCsv('名,名\n1,2\n');
    expect(Object.keys(schema.properties)).toEqual(['p1', 'p2']);
    // 第一列强制 text（title），第二列 number
    expect(schema.properties['p1']?.type).toBe('text');
    expect(schema.properties['p2']?.type).toBe('number');
    expect(records[0]).toEqual({ p1: '1', p2: 2 });
  });
});

describe('parseCsvFile：csv 源（单表 → 一个 collection 页）', () => {
  it('页 + collection（挂页下），counts 汇总，plan 过 zod 契约', () => {
    const fs = memoryFs({ '猫咪台账.csv': '名称,预算,完成\n猫粮,100,true\n逗猫棒,50,false\n' });
    const plan = parseCsvFile(fs, '猫咪台账.csv');
    expect(() => importPlanSchema.parse(plan)).not.toThrow();
    expect(plan.source).toEqual({ kind: 'csv', rootName: '猫咪台账' });

    const pages = plan.items.filter((item) => item.op === 'page');
    const collections = plan.items.filter((item) => item.op === 'collection');
    expect(pages).toHaveLength(1);
    expect(collections).toHaveLength(1);
    const page = pages[0];
    const collection = collections[0];
    if (page?.op !== 'page' || collection?.op !== 'collection') {
      throw new Error('unreachable');
    }
    expect(page).toMatchObject({ path: '猫咪台账', title: '猫咪台账', parentPath: null, blocks: [] });
    expect(collection.parentPath).toBe('猫咪台账');
    expect(collection.path).toBe('猫咪台账/猫咪台账');
    expect(collection.records).toHaveLength(2);
    expect(collection.schema.title_pid).toBe('p1');
    expect(plan.counts).toMatchObject({ pages: 1, collections: 1, records: 2 });
    expect(plan.warnings).toEqual([]);
  });
});
