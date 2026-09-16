/**
 * csv.test.ts —— RFC4180 子集解析/序列化（TASK-T7-01 §3）。
 *
 * 覆盖：引号内逗号/换行/双引号转义、仅首行带 BOM、CRLF 混合、空文件 → []、
 * 引号未闭合 fail loud、序列化往返恒等。
 */
import { describe, expect, it } from 'vitest';
import { BOM, CsvError, escapeCsvField, looksLikeHeader, parseCsv, toCsv } from '../src/csv';
import { formatValue } from '../src/values';

describe('parseCsv', () => {
  it('引号内逗号不切列', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });

  it('引号内换行不切行（CRLF 与 LF 都保留为字段内容）', () => {
    expect(parseCsv('"line1\nline2",x')).toEqual([['line1\nline2', 'x']]);
    expect(parseCsv('"line1\r\nline2",x')).toEqual([['line1\r\nline2', 'x']]);
  });

  it('双引号转义："" → "', () => {
    expect(parseCsv('"say ""hi""",z')).toEqual([['say "hi"', 'z']]);
    expect(parseCsv('""""')).toEqual([['"']]);
  });

  it('CRLF 与 LF 混合；末行无行尾符也收', () => {
    expect(parseCsv('a,b\r\nc,d\ne,f')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('仅首行带 BOM（BOM 只剔一次，第二处 BOM 视为内容）', () => {
    expect(parseCsv(`${BOM}a,b`)).toEqual([['a', 'b']]);
    expect(parseCsv(`${BOM}${BOM}a`)).toEqual([['\uFEFFa']]);
    // 非首字符位置的 BOM 不是 BOM
    expect(parseCsv('a,\uFEFFb')).toEqual([['a', '\uFEFFb']]);
  });

  it('空文件 / 纯空白 → []', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv(BOM)).toEqual([]);
    expect(parseCsv('\r\n')).toEqual([]);
    expect(parseCsv('  \n \r\n')).toEqual([]);
  });

  it('空字段与尾随逗号', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
    // 末行只有一个空字段（裸换行）不算数据行
    expect(parseCsv('a\n')).toEqual([['a']]);
  });

  it('引号未闭合 → CsvError（fail loud）', () => {
    expect(() => parseCsv('"abc')).toThrow(CsvError);
    expect(() => parseCsv('a,"b\nc')).toThrow(/引号未闭合/);
  });

  it('引号后跟普通字符宽容接受（不抛）', () => {
    expect(parseCsv('"ab"cd,e')).toEqual([['abcd', 'e']]);
  });
});

describe('escapeCsvField / toCsv', () => {
  it('含逗号/引号/换行的字段加引号并翻倍内部引号', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('l1\nl2')).toBe('"l1\nl2"');
  });

  it('CRLF 行尾、无尾随换行', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d');
    expect(toCsv([])).toBe('');
  });

  it('序列化 → 解析 往返恒等（含特殊字符）', () => {
    const rows = [
      ['书名', '标签', '备注'],
      ['哥德尔、艾舍尔、巴赫', '认知科学, 数学', '含 "引号" 与\n换行'],
      ['', '物理', ''],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('looksLikeHeader', () => {
  it('全非空且无重复 → true', () => {
    expect(looksLikeHeader(['书名', '评分'])).toBe(true);
    expect(looksLikeHeader(['a', 'a'])).toBe(false);
    expect(looksLikeHeader(['a', ''])).toBe(false);
    expect(looksLikeHeader([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AI 属性列（TASK-T18-04 追加，不改既有断言）：CSV 导出不因新类型报错
// ---------------------------------------------------------------------------

describe('ai 列 CSV 导出（TASK-T18-04）', () => {
  it('ai 值按 text 同路序列化：普通值原样、含逗号/换行加引号', () => {
    const aiProperty = { id: 'p_ai', name: '摘要', type: 'ai' as const, ai: { prompt: '概括' } };
    const rows = [
      ['书名', '摘要'],
      ['哥德尔', '一句话概括：奇书'],            // ai 列普通字符串
      ['时间简史', escapeCsvField(formatValue(aiProperty, '要点一, 要点二'))], // formatValue → toCsv 组合
    ];
    const csv = toCsv(rows);
    expect(csv).toContain('一句话概括：奇书');
    expect(csv).toContain('"要点一, 要点二"');
    // 序列化 → 解析往返不丢内容（新类型不炸）
    expect(parseCsv(csv)).toEqual(rows);
  });
});
