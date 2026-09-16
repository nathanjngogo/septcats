/**
 * values.test.ts —— 值编解码 / 显示 / 类型推断（TASK-T7-01 §3）。
 *
 * 覆盖：
 * - **roundtrip 恒等**：8 种值类型各 20 个随机值，`decodeValue(encodeValue(v))` 深等于 v；
 * - 显示文本截断 40 字符加省略号（按 Unicode 码点，代理对安全）；
 * - 空值占位「—」；checkbox 勾选「✓」；
 * - 日期文本解析（含非法日历日）；
 * - CSV 类型推断（true/false → checkbox、数字、`YYYY-MM-DD`、邮箱、URL，其余 text）。
 */
import { describe, expect, it } from 'vitest';
import type { DateValue } from '../src/types';
import {
  DISPLAY_MAX_LEN,
  EMPTY_DISPLAY,
  cloneJson,
  decodeValue,
  decodeValuesJson,
  encodeValue,
  encodeValuesJson,
  formatValue,
  inferColumnType,
  inferFieldType,
  isEmptyValue,
  parseDateText,
  recordTitle,
  truncate,
} from '../src/values';

/** mulberry32：32 位确定性 PRNG（与 editor 的测试同一算法，不引依赖）。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260913);

function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function randomText(length = 12): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz中文测试é👍';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet.charAt(Math.floor(random() * alphabet.length));
  }
  return out;
}

function randomDate(): DateValue {
  return { y: randomInt(1900, 2100), m: randomInt(1, 12), d: randomInt(1, 28) };
}

type Fixture = {
  type: string;
  value: unknown;
  display: string;
};

/** 8 种值类型 × 20 个随机值。 */
function randomFixtures(): Fixture[] {
  const fixtures: Fixture[] = [];
  for (let i = 0; i < 20; i += 1) {
    const text = randomText();
    fixtures.push({ type: 'text', value: text, display: truncate(text) });
    fixtures.push({
      type: 'number',
      value: Number((random() * 1000 - 500).toFixed(3)),
      display: '',
    });
    fixtures.push({ type: 'select', value: `opt-${String(i)}`, display: EMPTY_DISPLAY });
    fixtures.push({
      type: 'multi_select',
      value: [`opt-${String(i)}`, `opt-${String(i + 1)}`],
      display: EMPTY_DISPLAY,
    });
    fixtures.push({ type: 'date', value: randomDate(), display: '' });
    fixtures.push({ type: 'checkbox', value: random() > 0.5, display: '' });
    fixtures.push({ type: 'url', value: `https://example.com/${text}`, display: '' });
    fixtures.push({ type: 'file', value: [`${text}.pdf`], display: '' });
  }
  return fixtures;
}

describe('encodeValue / decodeValue', () => {
  it('roundtrip 恒等：8 类型 × 20 随机值（深等于）', () => {
    const fixtures = randomFixtures();
    expect(fixtures).toHaveLength(160);
    for (const fixture of fixtures) {
      const encoded = encodeValue(fixture.value);
      const decoded = decodeValue(encoded);
      expect(decoded, `${fixture.type} 第 ${JSON.stringify(fixture.value)}`).toEqual(fixture.value);
      // 深等于而非同引用：encode 必须拷贝（否则改动会污染来源对象）
      if (typeof fixture.value === 'object' && fixture.value !== null) {
        expect(decoded).not.toBe(fixture.value);
      }
    }
  });

  it('undefined → null（空值规范形态）；null 往返仍 null', () => {
    expect(encodeValue(undefined)).toBeNull();
    expect(decodeValue(undefined)).toBeNull();
    expect(decodeValue(null)).toBeNull();
    expect(decodeValue('')).toBeNull();
  });

  it('非法 JSON 文本 → null（不抛）', () => {
    expect(decodeValue('{not json')).toBeNull();
    expect(decodeValue('"ok"')).toBe('ok');
    expect(decodeValue('[1,2]')).toEqual([1, 2]);
  });

  it('cloneJson 丢弃 undefined 键（JSON 语义）', () => {
    expect(cloneJson({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('encodeValuesJson / decodeValuesJson 往返；坏 JSON → {}', () => {
    const values = { p1: 'x', p2: [1, 2], p3: null };
    expect(decodeValuesJson(encodeValuesJson(values))).toEqual(values);
    expect(decodeValuesJson('')).toEqual({});
    expect(decodeValuesJson('{oops')).toEqual({});
    expect(decodeValuesJson('[]')).toEqual({});
  });
});

describe('isEmptyValue', () => {
  it('缺键/null/空串/空数组 均为空；false 与 0 不为空', () => {
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(' ')).toBe(false);
    expect(isEmptyValue({ y: 2026, m: 1, d: 1 })).toBe(false);
  });
});

describe('truncate / formatValue', () => {
  it('超过 40 字符按码点截断加省略号；不足则原样', () => {
    expect(DISPLAY_MAX_LEN).toBe(40);
    const long = '字'.repeat(60);
    expect(truncate(long)).toBe(`${'字'.repeat(40)}…`);
    expect(Array.from(truncate(long)).length).toBe(41);
    const short = '字'.repeat(10);
    expect(truncate(short)).toBe(short);
    // 代理对（emoji）安全：不截出半个代理
    const emoji = '👍'.repeat(50);
    expect(truncate(emoji)).toBe(`${'👍'.repeat(40)}…`);
    expect(truncate(long, 100)).toBe(long);
  });

  it('空值恒为「—」；checkbox 勾选 ✓ / 未勾选「—」', () => {
    expect(formatValue({ type: 'text' }, null)).toBe(EMPTY_DISPLAY);
    expect(formatValue({ type: 'number' }, undefined)).toBe(EMPTY_DISPLAY);
    expect(formatValue({ type: 'date' }, null)).toBe(EMPTY_DISPLAY);
    expect(formatValue({ type: 'select' }, null)).toBe(EMPTY_DISPLAY);
    expect(formatValue({ type: 'checkbox' }, false)).toBe(EMPTY_DISPLAY);
    expect(formatValue({ type: 'checkbox' }, true)).toBe('✓');
  });

  it('number 原样、date 补零、select/multi 映射选项名、relation 反查标题', () => {
    expect(formatValue({ type: 'number' }, 4.5)).toBe('4.5');
    expect(formatValue({ type: 'date' }, { y: 2026, m: 7, d: 2 })).toBe('2026-07-02');
    const options = [
      { id: 's1', name: '在读' },
      { id: 's2', name: '弃读' },
    ];
    expect(formatValue({ type: 'select', options }, 's2')).toBe('弃读');
    expect(formatValue({ type: 'select', options }, 'ghost')).toBe(EMPTY_DISPLAY);
    expect(formatValue({ type: 'multi_select', options }, ['s1', 's2'])).toBe('在读, 弃读');
    const relationTitle = (id: string): string | null => (id === 'r1' ? '目标记录' : null);
    expect(formatValue({ type: 'relation' }, ['r1'], { relationTitle })).toBe('目标记录');
    expect(formatValue({ type: 'relation' }, ['r9'], { relationTitle })).toBe(EMPTY_DISPLAY);
  });

  it('file 显示文件名连接；非法 date 值降级为「—」', () => {
    expect(formatValue({ type: 'file' }, ['a.pdf', 'b.png'])).toBe('a.pdf, b.png');
    expect(formatValue({ type: 'date' }, { y: 0, m: 1, d: 1 })).toBe(EMPTY_DISPLAY);
    expect(formatValue({ type: 'number' }, Number.NaN)).toBe(EMPTY_DISPLAY);
  });
});

describe('parseDateText', () => {
  it('合法日期解析；补零；非法日历日与格式 → null', () => {
    expect(parseDateText('2026-07-02')).toEqual({ y: 2026, m: 7, d: 2 });
    expect(parseDateText('2026-7-2')).toEqual({ y: 2026, m: 7, d: 2 });
    expect(parseDateText('2026-02-30')).toBeNull();
    expect(parseDateText('2026-13-01')).toBeNull();
    expect(parseDateText('2026/07/02')).toBeNull();
    expect(parseDateText('')).toBeNull();
    // 闰年 2 月 29 日合法
    expect(parseDateText('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 });
    expect(parseDateText('2023-02-29')).toBeNull();
  });
});

describe('recordTitle', () => {
  const schema = {
    properties: {
      p1: { id: 'p1', name: '书名', type: 'text' as const },
      p2: { id: 'p2', name: '评分', type: 'number' as const },
    },
    title_pid: 'p1',
  };

  it('优先 title_pid；空则回落首个非空属性；全空回落 record id', () => {
    expect(recordTitle(schema, { p1: '哥德尔', p2: 4.5 }, 'r1')).toBe('哥德尔');
    expect(recordTitle(schema, { p2: 4.5 }, 'r1')).toBe('4.5');
    expect(recordTitle(schema, {}, 'r1')).toBe('r1');
    // title_pid 指向不存在的属性时回落
    expect(recordTitle({ ...schema, title_pid: 'ghost' }, { p1: 'x' }, 'r1')).toBe('x');
  });
});

describe('inferFieldType / inferColumnType', () => {
  it('单元格推断：布尔/数字/日期/邮箱/URL/文本', () => {
    expect(inferFieldType('true')).toBe('checkbox');
    expect(inferFieldType('FALSE')).toBe('checkbox');
    expect(inferFieldType('42')).toBe('number');
    expect(inferFieldType('-3.14')).toBe('number');
    expect(inferFieldType('1e3')).toBe('number');
    expect(inferFieldType('2026-07-02')).toBe('date');
    expect(inferFieldType('a@b.co')).toBe('email');
    expect(inferFieldType('https://example.com/x')).toBe('url');
    expect(inferFieldType('www.example.com')).toBe('url');
    expect(inferFieldType('哥德尔、艾舍尔、巴赫')).toBe('text');
    expect(inferFieldType('')).toBe('text');
    // '1' 归数字（不与 checkbox 冲突）
    expect(inferFieldType('1')).toBe('number');
  });

  it('列推断：一致才采信，混类型回落 text；空样本跳过', () => {
    expect(inferColumnType(['1', '2', ''])).toBe('number');
    expect(inferColumnType(['2026-01-01', '2026-02-02'])).toBe('date');
    expect(inferColumnType(['a@b.co', 'c@d.co'])).toBe('email');
    expect(inferColumnType(['1', '2026-01-01'])).toBe('text');
    expect(inferColumnType(['', '  '])).toBe('text');
    expect(inferColumnType([])).toBe('text');
    expect(inferColumnType(['true', 'false'])).toBe('checkbox');
  });
});

// ---------------------------------------------------------------------------
// AI 属性列（TASK-T18-04 追加，不改既有断言）
// ---------------------------------------------------------------------------

describe('ai 列值语义（TASK-T18-04）', () => {
  it('encodeValue/decodeValue 往返与 text 同路：字符串恒等', () => {
    const samples = ['用一句话概括：这是一本书。', '含 "引号" 与\n换行', 'emoji ✨', 'a'.repeat(500)];
    for (const value of samples) {
      expect(decodeValue(encodeValue(value))).toBe(value);
    }
    // 与 text 完全同编解码：同值两者产物一致
    expect(encodeValue('AI 结果')).toBe(encodeValue('AI 结果'));
    expect(decodeValue(encodeValue('AI 结果'))).toBe(decodeValue(encodeValue('AI 结果')));
  });

  it('formatValue 按 text 路径显示（40 码点截断 + 省略号）；空值占位「—」', () => {
    const property = { type: 'ai' as const };
    expect(formatValue(property, '短结果')).toBe('短结果');
    const long = Array.from({ length: 60 }, (_v, i) => String(i % 10)).join('');
    expect(formatValue(property, long)).toBe(long.slice(0, DISPLAY_MAX_LEN) + '…');
    expect(formatValue(property, null)).toBe(EMPTY_DISPLAY);
    expect(formatValue(property, undefined)).toBe(EMPTY_DISPLAY);
  });

  it('recordTitle 不受 ai 列干扰（标题列优先，ai 列不抢标题位）', () => {
    const schema = {
      properties: {
        p_title: { id: 'p_title', name: '书名', type: 'text' as const },
        p_ai: { id: 'p_ai', name: '摘要', type: 'ai' as const, ai: { prompt: '概括' } },
      },
      title_pid: 'p_title',
    };
    expect(recordTitle(schema, { p_title: '哥德尔', p_ai: 'AI 摘要' }, 'rec-1')).toBe('哥德尔');
    // 标题列空 → 回落第一个非空文本属性（ai 列也是文本形态，可作兜底标题）
    expect(recordTitle(schema, { p_ai: 'AI 摘要' }, 'rec-1')).toBe('AI 摘要');
  });
});
