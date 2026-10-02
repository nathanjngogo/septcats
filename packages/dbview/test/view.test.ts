/**
 * view.test.ts —— 视图引擎语义（TASK-T7-01 §3，重测区）。
 *
 * 覆盖：
 * - 1 万条属性化随机数据：六算子 × 各类型；
 *   ① applyFilter 结果全部真满足 ② 补集 = 取反 filter ③ and 嵌套深度 3 不崩；
 * - sort：select 按 options 顺序、date 空值最后、稳定（同值保 sort_key 序）；
 * - 聚合：sum/avg/earliest/latest/空集「—」；
 * - 筛选/排序序列化规范化（可进 Op.payload）；
 * - relation 双写计划（主记录 + 对方 backlink 同批）。
 *
 * 生成器：自写 mulberry32（仓库既有做法，不引 fast-check；理由见报告 DEVIATIONS）。
 */
import { describe, expect, it } from 'vitest';
import {
  type CollectionSchema,
  type DateValue,
  type FilterClause,
  type FilterGroup,
  type RecordEntity,
  coerceValue,
  defaultView,
  emptyFilter,
  propertyOptionSchema,
  propertySchema,
  recordEntitySchema,
} from '../src/types';
import { normalizeFilter, normalizeSort, reorderById, viewRemovalOutcome, visibleProperties } from '../src/view';
import {
  applyFilter,
  applySort,
  applyView,
  aggregate,
  availableAggregations,
  compareDate,
  compareSortKey,
  danglingReferences,
  groupBySelect,
  NONE_GROUP_KEY,
  matchesClause,
  normalizeView,
  relationWritePlan,
} from '../src/view';
import { isEmptyValue } from '../src/values';

// ---------------------------------------------------------------------------
// 夹具与生成器
// ---------------------------------------------------------------------------

const SELECT_OPTIONS = ['s-a', 's-b', 's-c'].map((id) =>
  propertyOptionSchema.parse({ id, name: `选项 ${id}` }),
);
const MULTI_OPTIONS = ['m-a', 'm-b', 'm-c'].map((id) =>
  propertyOptionSchema.parse({ id, name: `标签 ${id}` }),
);

/** 属性集：覆盖 8 种值类型。 */
const P_TEXT = propertySchema.parse({ id: 'p_text', name: '书名', type: 'text' });
const P_NUMBER = propertySchema.parse({ id: 'p_number', name: '评分', type: 'number' });
const P_DATE = propertySchema.parse({ id: 'p_date', name: '读完于', type: 'date' });
const P_CHECK = propertySchema.parse({ id: 'p_check', name: '已读', type: 'checkbox' });
const P_SELECT = propertySchema.parse({
  id: 'p_select',
  name: '状态',
  type: 'select',
  options: SELECT_OPTIONS,
});
const P_MULTI = propertySchema.parse({
  id: 'p_multi',
  name: '标签',
  type: 'multi_select',
  options: MULTI_OPTIONS,
});
const P_RELATION = propertySchema.parse({ id: 'p_rel', name: '关联', type: 'relation' });
const P_URL = propertySchema.parse({ id: 'p_url', name: '链接', type: 'url' });

const SCHEMA: CollectionSchema = {
  properties: {
    [P_TEXT.id]: P_TEXT,
    [P_NUMBER.id]: P_NUMBER,
    [P_DATE.id]: P_DATE,
    [P_CHECK.id]: P_CHECK,
    [P_SELECT.id]: P_SELECT,
    [P_MULTI.id]: P_MULTI,
    [P_RELATION.id]: P_RELATION,
    [P_URL.id]: P_URL,
  },
  title_pid: P_TEXT.id,
};

const ALL_PIDS = Object.keys(SCHEMA.properties);

/** mulberry32：32 位确定性 PRNG。 */
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

function pad(value: number, width = 6): string {
  return String(value).padStart(width, '0');
}

/** 1 万条属性化记录；约 15% 属性为空值以覆盖 is_empty/空值排序分支。 */
function makeRows(count: number): RecordEntity[] {
  const rows: RecordEntity[] = [];
  for (let i = 0; i < count; i += 1) {
    const values: Record<string, unknown> = {};
    const empty = random() < 0.15;

    if (!empty) {
      values[P_TEXT.id] = `书名 ${pad(i)}`;
      values[P_NUMBER.id] = randomInt(-500, 500) / 10;
      const date: DateValue = { y: randomInt(1990, 2035), m: randomInt(1, 12), d: randomInt(1, 28) };
      values[P_DATE.id] = date;
      values[P_CHECK.id] = random() > 0.5;
      const option = SELECT_OPTIONS[randomInt(0, SELECT_OPTIONS.length - 1)];
      if (option !== undefined) {
        values[P_SELECT.id] = option.id;
      }
      const tags = MULTI_OPTIONS.filter(() => random() > 0.5).map((option) => option.id);
      values[P_MULTI.id] = tags;
      values[P_RELATION.id] = [`rec-${pad(randomInt(0, 999))}`];
      values[P_URL.id] = `https://example.com/${pad(i)}`;
    }

    rows.push({
      id: `rec-${pad(i)}`,
      collection_id: 'col-main',
      workspace_id: 'ws-test',
      values,
      sort_key: pad(i),
      alive: 1,
      version: 1,
    });
  }
  return rows;
}

const ROWS = makeRows(10_000);

// ---------------------------------------------------------------------------
// 谓词（测试独立实现，避免与被测代码同源）
// ---------------------------------------------------------------------------

function valueOfRow(row: RecordEntity, pid: string): unknown {
  return row.values[pid];
}

function asDate(value: unknown): DateValue | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as { y?: unknown; m?: unknown; d?: unknown };
  if (typeof candidate.y !== 'number' || typeof candidate.m !== 'number' || typeof candidate.d !== 'number') {
    return null;
  }
  return { y: candidate.y, m: candidate.m, d: candidate.d };
}

/** 测试自实现的算子谓词（与 clip 说明一一对应）。 */
function predicate(clause: FilterClause): (row: RecordEntity) => boolean {
  const raw = (row: RecordEntity): unknown => valueOfRow(row, clause.prop);
  switch (clause.kind) {
    case 'is_empty':
      return (row) => isEmptyValue(raw(row));
    case 'eq':
      return (row) => {
        const value = raw(row);
        if (Array.isArray(value)) {
          return value.map(String).includes(String(clause.value));
        }
        if (isEmptyValue(value)) {
          return clause.value === undefined || clause.value === null || clause.value === '';
        }
        if (typeof value === 'number') {
          return typeof clause.value === 'number' && value === clause.value;
        }
        if (typeof value === 'boolean') {
          return value === clause.value;
        }
        const date = asDate(value);
        if (date !== null) {
          const other = asDate(clause.value);
          return other !== null && compareDate(date, other) === 0;
        }
        return String(value) === String(clause.value);
      };
    case 'neq': {
      const equal = predicate({ ...clause, kind: 'eq' });
      return (row) => !equal(row);
    }
    case 'contains':
      return (row) => {
        if (typeof clause.value !== 'string' || clause.value.length === 0) {
          return false;
        }
        const value = raw(row);
        if (Array.isArray(value)) {
          return value.map(String).some((item) => item.includes(clause.value as string));
        }
        return String(value ?? '').includes(clause.value);
      };
    case 'gt':
    case 'lt': {
      return (row) => {
        const value = raw(row);
        const leftDate = asDate(value);
        const rightDate = asDate(clause.value);
        if (leftDate !== null && rightDate !== null) {
          const order = compareDate(leftDate, rightDate);
          return clause.kind === 'gt' ? order > 0 : order < 0;
        }
        if (typeof value !== 'number' || typeof clause.value !== 'number') {
          return false;
        }
        return clause.kind === 'gt' ? value > clause.value : value < clause.value;
      };
    }
    case 'before':
    case 'after':
      return (row) => {
        const leftDate = asDate(raw(row));
        const rightDate = asDate(clause.value);
        if (leftDate === null || rightDate === null) {
          return false;
        }
        const order = compareDate(leftDate, rightDate);
        return clause.kind === 'before' ? order < 0 : order > 0;
      };
    default:
      return () => false;
  }
}

function andPredicate(clauses: readonly FilterClause[]): (row: RecordEntity) => boolean {
  const predicates = clauses.map(predicate);
  return (row) => predicates.every((entry) => entry(row));
}

// ---------------------------------------------------------------------------
// 1 万条：六算子 × 各类型 ①②③
// ---------------------------------------------------------------------------

const CLAUSE_CASES: Array<{ label: string; clause: FilterClause }> = [
  { label: 'text eq', clause: { prop: P_TEXT.id, kind: 'eq', value: '书名 000123' } },
  { label: 'text neq', clause: { prop: P_TEXT.id, kind: 'neq', value: '书名 000123' } },
  { label: 'text contains', clause: { prop: P_TEXT.id, kind: 'contains', value: '书名 00001' } },
  { label: 'text is_empty', clause: { prop: P_TEXT.id, kind: 'is_empty' } },
  { label: 'number eq', clause: { prop: P_NUMBER.id, kind: 'eq', value: 12.3 } },
  { label: 'number neq', clause: { prop: P_NUMBER.id, kind: 'neq', value: 12.3 } },
  { label: 'number gt', clause: { prop: P_NUMBER.id, kind: 'gt', value: 10 } },
  { label: 'number lt', clause: { prop: P_NUMBER.id, kind: 'lt', value: -10 } },
  { label: 'date eq', clause: { prop: P_DATE.id, kind: 'eq', value: { y: 2000, m: 1, d: 1 } } },
  { label: 'date neq', clause: { prop: P_DATE.id, kind: 'neq', value: { y: 2000, m: 1, d: 1 } } },
  { label: 'date before', clause: { prop: P_DATE.id, kind: 'before', value: { y: 2000, m: 1, d: 1 } } },
  { label: 'date after', clause: { prop: P_DATE.id, kind: 'after', value: { y: 2000, m: 1, d: 1 } } },
  { label: 'checkbox eq', clause: { prop: P_CHECK.id, kind: 'eq', value: true } },
  { label: 'checkbox neq', clause: { prop: P_CHECK.id, kind: 'neq', value: true } },
  { label: 'select eq', clause: { prop: P_SELECT.id, kind: 'eq', value: 's-b' } },
  { label: 'select neq', clause: { prop: P_SELECT.id, kind: 'neq', value: 's-b' } },
  { label: 'select is_empty', clause: { prop: P_SELECT.id, kind: 'is_empty' } },
  { label: 'multi contains', clause: { prop: P_MULTI.id, kind: 'contains', value: 'm-a' } },
  { label: 'multi is_empty', clause: { prop: P_MULTI.id, kind: 'is_empty' } },
  { label: 'relation contains', clause: { prop: P_RELATION.id, kind: 'contains', value: 'rec-000042' } },
  { label: 'url contains', clause: { prop: P_URL.id, kind: 'contains', value: '00099' } },
  { label: 'url is_empty', clause: { prop: P_URL.id, kind: 'is_empty' } },
];

describe('applyFilter（1 万条 × 六算子）', () => {
  it('夹具完整：1 万条、8 属性、值类型合法', () => {
    expect(ROWS).toHaveLength(10_000);
    let nonEmpty = 0;
    for (const row of ROWS) {
      expect(recordEntitySchema.safeParse(row).success).toBe(true);
      for (const [pid, value] of Object.entries(row.values)) {
        const property = SCHEMA.properties[pid];
        expect(property, `未知属性 ${pid}`).toBeDefined();
        if (property !== undefined) {
          expect(coerceValue(property.type, value), `非法值 ${pid}=${JSON.stringify(value)}`).toEqual(value);
        }
      }
      if (Object.keys(row.values).length > 0) {
        nonEmpty += 1;
      }
    }
    expect(nonEmpty).toBeGreaterThan(7000);
  });

  it('① 结果全部真满足（22 个用例）', () => {
    for (const entry of CLAUSE_CASES) {
      const filter: FilterGroup = { op: 'and', clauses: [entry.clause] };
      const result = applyFilter(ROWS, filter);
      const check = predicate(entry.clause);
      for (const row of result) {
        expect(check(row), `用例 ${entry.label}：${row.id} 不满足谓词`).toBe(true);
      }
      // 反向：满足谓词的一定被保留
      const kept = new Set(result.map((row) => row.id));
      for (const row of ROWS) {
        if (check(row)) {
          expect(kept.has(row.id), `用例 ${entry.label}：${row.id} 漏筛`).toBe(true);
        }
      }
    }
  });

  it('② 补集 = 取反 filter（eq↔neq / is_empty↔neq 空值）', () => {
    const pairs: Array<{ a: FilterClause; b: FilterClause }> = [
      {
        a: { prop: P_NUMBER.id, kind: 'eq', value: 12.3 },
        b: { prop: P_NUMBER.id, kind: 'neq', value: 12.3 },
      },
      {
        a: { prop: P_SELECT.id, kind: 'eq', value: 's-b' },
        b: { prop: P_SELECT.id, kind: 'neq', value: 's-b' },
      },
      {
        a: { prop: P_DATE.id, kind: 'eq', value: { y: 2000, m: 1, d: 1 } },
        b: { prop: P_DATE.id, kind: 'neq', value: { y: 2000, m: 1, d: 1 } },
      },
      {
        a: { prop: P_CHECK.id, kind: 'eq', value: true },
        b: { prop: P_CHECK.id, kind: 'neq', value: true },
      },
      { a: { prop: P_TEXT.id, kind: 'is_empty' }, b: { prop: P_TEXT.id, kind: 'contains', value: '书名' } },
      { a: { prop: P_URL.id, kind: 'is_empty' }, b: { prop: P_URL.id, kind: 'contains', value: 'http' } },
    ];
    for (const pair of pairs) {
      const left = applyFilter(ROWS, { op: 'and', clauses: [pair.a] });
      const right = applyFilter(ROWS, { op: 'and', clauses: [pair.b] });
      expect(left.length + right.length, `补集大小：${JSON.stringify(pair.a)}`).toBe(ROWS.length);
      const ids = new Set([...left, ...right].map((row) => row.id));
      expect(ids.size).toBe(ROWS.length);
    }
  });

  it('③ and 嵌套深度 3 不崩且语义正确', () => {
    const deep: FilterGroup = {
      op: 'and',
      clauses: [
        {
          op: 'and',
          clauses: [
            {
              op: 'and',
              clauses: [{ prop: P_TEXT.id, kind: 'contains', value: '书名' }],
            },
            { prop: P_NUMBER.id, kind: 'gt', value: -100 },
          ],
        },
        { prop: P_CHECK.id, kind: 'eq', value: true },
      ],
    };
    const result = applyFilter(ROWS, deep);
    const check = andPredicate([
      { prop: P_TEXT.id, kind: 'contains', value: '书名' },
      { prop: P_NUMBER.id, kind: 'gt', value: -100 },
      { prop: P_CHECK.id, kind: 'eq', value: true },
    ]);
    for (const row of result) {
      expect(check(row)).toBe(true);
    }
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(ROWS.length);

    // 空 filter 恒真（且是拷贝，不改入参）
    const all = applyFilter(ROWS, emptyFilter());
    expect(all).toHaveLength(ROWS.length);
    expect(all).not.toBe(ROWS);
  });
});

// ---------------------------------------------------------------------------
// sort
// ---------------------------------------------------------------------------

describe('applySort', () => {
  it('select 按 options 声明顺序（未在 options 的 id 排最后）', () => {
    const rows: RecordEntity[] = ['s-c', 's-a', 'ghost', 's-b', undefined].map((value, index) => ({
      id: `r${String(index)}`,
      collection_id: 'c',
      workspace_id: 'w',
      values: value === undefined ? {} : { [P_SELECT.id]: value },
      sort_key: pad(99 - index),
      alive: 1,
      version: 1,
    }));
    const sorted = applySort(rows, [{ prop: P_SELECT.id, dir: 'asc' }], SCHEMA);
    // 空值（Undefined）排最后（§3：空值最后）；两个非空未知值按 options 顺序
    expect(sorted[0]?.id).toBe('r1'); // s-a
    expect(sorted[1]?.id).toBe('r3'); // s-b
    expect(sorted[2]?.id).toBe('r0'); // s-c
    expect(sorted[sorted.length - 1]?.id).toBe('r4'); // 空值
  });

  it('date 空值最后（asc 与 desc 都不翻转空值位置）', () => {
    const make = (id: string, date: DateValue | null, sortKey: string): RecordEntity => ({
      id,
      collection_id: 'c',
      workspace_id: 'w',
      values: date === null ? {} : { [P_DATE.id]: date },
      sort_key: sortKey,
      alive: 1,
      version: 1,
    });
    const rows = [
      make('none1', null, 'a'),
      make('late', { y: 2030, m: 1, d: 1 }, 'b'),
      make('none2', null, 'c'),
      make('early', { y: 1990, m: 1, d: 1 }, 'd'),
    ];
    const asc = applySort(rows, [{ prop: P_DATE.id, dir: 'asc' }], SCHEMA);
    expect(asc.map((row) => row.id)).toEqual(['early', 'late', 'none1', 'none2']);
    const desc = applySort(rows, [{ prop: P_DATE.id, dir: 'desc' }], SCHEMA);
    expect(desc.map((row) => row.id)).toEqual(['late', 'early', 'none1', 'none2']);
  });

  it('稳定：同值保持 sort_key 序（不依赖输入顺序）', () => {
    const make = (id: string, value: unknown, sortKey: string): RecordEntity => ({
      id,
      collection_id: 'c',
      workspace_id: 'w',
      values: { [P_NUMBER.id]: value },
      sort_key: sortKey,
      alive: 1,
      version: 1,
    });
    const rows = [make('z', 5, 'c'), make('a', 5, 'a'), make('m', 5, 'b')];
    const sorted = applySort(rows, [{ prop: P_NUMBER.id, dir: 'asc' }], SCHEMA);
    expect(sorted.map((row) => row.id)).toEqual(['a', 'm', 'z']);

    // 多键：先按 select（s-a 组 = x/w，s-b 组 = y），组内再按 number asc（w=2 < x=3）
    const multi = [
      make('x', 3, 'a'),
      make('y', 1, 'b'),
      make('w', 2, 'c'),
    ].map((row, index) => ({ ...row, values: { ...row.values, [P_SELECT.id]: index === 1 ? 's-b' : 's-a' } }));
    const sortedMulti = applySort(
      multi,
      [
        { prop: P_SELECT.id, dir: 'asc' },
        { prop: P_NUMBER.id, dir: 'asc' },
      ],
      SCHEMA,
    );
    expect(sortedMulti.map((row) => row.id)).toEqual(['w', 'x', 'y']);
  });

  it('1 万条：空值恒在后、同值时 sort_key 单调（全属性单键排序）', () => {
    for (const pid of ALL_PIDS) {
      const sorted = applySort(ROWS, [{ prop: pid, dir: 'asc' }], SCHEMA);
      expect(sorted).toHaveLength(ROWS.length);
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        if (previous === undefined || current === undefined) {
          continue;
        }
        const previousEmpty = isEmptyValue(previous.values[pid]);
        const currentEmpty = isEmptyValue(current.values[pid]);
        if (previousEmpty !== currentEmpty) {
          // 一旦出现空值，其后必须全是空值
          expect(currentEmpty, `${pid} 第 ${String(i)} 行空值位置错误`).toBe(true);
        } else if (previousEmpty && currentEmpty) {
          expect(compareSortKey(previous, current)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('sort 为空数组时按 sort_key 稳定排序', () => {
    const rows = [
      { id: 'b', collection_id: 'c', workspace_id: 'w', values: {}, sort_key: '0002', alive: 1, version: 1 },
      { id: 'a', collection_id: 'c', workspace_id: 'w', values: {}, sort_key: '0001', alive: 1, version: 1 },
    ];
    expect(applySort(rows, [], SCHEMA).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('applyView 先筛选后排序；可分别关闭', () => {
    const view = {
      filter: { op: 'and' as const, clauses: [{ prop: P_SELECT.id, kind: 'eq' as const, value: 's-a' }] },
      sort: [{ prop: P_NUMBER.id, dir: 'asc' as const }],
    };
    const filteredSorted = applyView(ROWS, view, SCHEMA);
    expect(filteredSorted.every((row) => row.values[P_SELECT.id] === 's-a')).toBe(true);
    for (let i = 1; i < filteredSorted.length; i += 1) {
      const previous = filteredSorted[i - 1]?.values[P_NUMBER.id];
      const current = filteredSorted[i]?.values[P_NUMBER.id];
      if (typeof previous === 'number' && typeof current === 'number') {
        expect(previous).toBeLessThanOrEqual(current);
      }
    }
    const noSort = applyView(ROWS, view, SCHEMA, { sort: false });
    expect(noSort).toHaveLength(filteredSorted.length);
    const noFilter = applyView(ROWS, view, SCHEMA, { filter: false });
    expect(noFilter).toHaveLength(ROWS.length);
  });
});

// ---------------------------------------------------------------------------
// 聚合 / 分组预留 / 规范化
// ---------------------------------------------------------------------------

describe('aggregate', () => {
  const rows: RecordEntity[] = [
    { id: 'a', collection_id: 'c', workspace_id: 'w', values: { [P_NUMBER.id]: 4, [P_DATE.id]: { y: 2001, m: 1, d: 1 } }, sort_key: 'a', alive: 1, version: 1 },
    { id: 'b', collection_id: 'c', workspace_id: 'w', values: { [P_NUMBER.id]: 3, [P_DATE.id]: { y: 1999, m: 1, d: 1 } }, sort_key: 'b', alive: 1, version: 1 },
    { id: 'c', collection_id: 'c', workspace_id: 'w', values: {}, sort_key: 'c', alive: 1, version: 1 },
  ];

  it('number：count/sum/avg 与空集「—」', () => {
    expect(aggregate(rows, P_NUMBER, 'count')).toEqual({ kind: 'count', text: '3', value: 3 });
    expect(aggregate(rows, P_NUMBER, 'sum')).toEqual({ kind: 'sum', text: '7', value: 7 });
    expect(aggregate(rows, P_NUMBER, 'avg').value).toBeCloseTo(3.5);
    expect(aggregate(rows, P_NUMBER, 'avg').text).toBe('3.50');
    expect(aggregate([], P_NUMBER, 'sum')).toEqual({ kind: 'sum', text: '—', value: null });
  });

  it('date：earliest/latest；其余类型只有 count', () => {
    expect(aggregate(rows, P_DATE, 'earliest').text).toBe('1999-01-01');
    expect(aggregate(rows, P_DATE, 'latest').text).toBe('2001-01-01');
    expect(availableAggregations('number')).toEqual(['count', 'sum', 'avg']);
    expect(availableAggregations('date')).toEqual(['count', 'earliest', 'latest']);
    expect(availableAggregations('text')).toEqual(['count']);
    expect(aggregate(rows, P_TEXT, 'sum')).toEqual({ kind: 'sum', text: '—', value: null });
    expect(aggregate(rows, undefined, 'count').kind).toBe('none');
    expect(aggregate(rows, P_NUMBER, 'none').text).toBe('');
  });

  it('groupBySelect 二期已落地（T99-01）：按选项顺序分组 + 未分组桶置末', () => {
    const groups = groupBySelect(rows, P_SELECT);
    expect(groups).toBeDefined();
    const g = groups ?? [];
    expect(g.length).toBe(SELECT_OPTIONS.length + 1);
    expect(g[g.length - 1]!.key).toBe(NONE_GROUP_KEY);
    expect(g.slice(0, SELECT_OPTIONS.length).map((x) => x.key)).toEqual(SELECT_OPTIONS.map((o) => o.id));
    // 单选语义：每条记录恰好出现在一个组里（合计 = 行数）
    expect(g.reduce((sum, x) => sum + x.records.length, 0)).toBe(rows.length);
    // 非 select 属性 / 缺属性 → undefined（调用方据此回退表格视图）
    expect(groupBySelect(rows, P_TEXT)).toBeUndefined();
    expect(groupBySelect(rows, undefined)).toBeUndefined();
  });

  it('matchesClause 对未知属性/非法算子安全返回', () => {
    const row = rows[0]!;
    expect(matchesClause(row, { prop: 'ghost', kind: 'eq', value: 1 })).toBe(false);
    expect(matchesClause(row, { prop: 'ghost', kind: 'is_empty' })).toBe(true);
  });
});

describe('序列化规范化（可进 Op.payload）', () => {
  it('normalizeFilter 丢弃非法项、递归子分组、产物可 JSON 往返', () => {
    const raw = {
      op: 'and',
      clauses: [
        { prop: 'p1', kind: 'eq', value: 1 },
        { prop: '', kind: 'eq', value: 1 },
        { prop: 'p2', kind: 'bogus', value: 1 },
        { op: 'and', clauses: [{ prop: 'p3', kind: 'contains', value: 'x' }] },
        'not-an-object',
      ],
    };
    const normalized = normalizeFilter(raw);
    expect(normalized.clauses).toHaveLength(2);
    expect(normalized.clauses[0]).toEqual({ prop: 'p1', kind: 'eq', value: 1 });
    expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized);
    expect(normalizeFilter(null)).toEqual({ op: 'and', clauses: [] });
  });

  it('normalizeSort 去重、修 dir；normalizeView 只留正有限列宽', () => {
    expect(normalizeSort([{ prop: 'a', dir: 'desc' }, { prop: 'a', dir: 'asc' }, { prop: '', dir: 'asc' }, { prop: 'b', dir: 'weird' }])).toEqual([
      { prop: 'a', dir: 'desc' },
      { prop: 'b', dir: 'asc' },
    ]);
    const view = normalizeView({
      vid: 'v1',
      name: '表格',
      type: 'table',
      filter: emptyFilter(),
      sort: [{ prop: 'p1', dir: 'asc' }],
      widths: { p1: 220.6, p2: -3, p3: Number.NaN },
    });
    expect(view.widths).toEqual({ p1: 221 });
    expect(danglingReferences(
      { ...view, sort: [{ prop: 'ghost', dir: 'asc' }], filter: { op: 'and', clauses: [{ prop: 'ghost2', kind: 'eq', value: 1 }] } },
      SCHEMA,
    ).sort()).toEqual(['ghost', 'ghost2']);
  });
});

// ---------------------------------------------------------------------------
// relation 双写计划（主记录 + 对方 backlink 同批）
// ---------------------------------------------------------------------------

describe('relationWritePlan', () => {
  const relationSchema: CollectionSchema = {
    properties: { [P_RELATION.id]: P_RELATION, [P_TEXT.id]: P_TEXT },
    title_pid: P_TEXT.id,
  };

  it('新增目标 → 主记录写新值 + 对方 backlink 加本记录 id', () => {
    const record = {
      id: 'rec-a',
      collection_id: 'col-books',
      values: { [P_RELATION.id]: ['rec-x'] },
      backlinks: {},
    };
    const plan = relationWritePlan(relationSchema, record, P_RELATION.id, ['rec-x', 'rec-y']);
    expect(plan.main.values[P_RELATION.id]).toEqual(['rec-x', 'rec-y']);
    expect(plan.related).toEqual([
      { recordId: 'rec-y', values: {}, backlinks: { 'col-books': ['rec-a'] } },
    ]);
  });

  it('移除目标 → 对方 backlink 去掉本记录 id（空则删键）；幂等重发不产生 related', () => {
    const record = {
      id: 'rec-a',
      collection_id: 'col-books',
      values: { [P_RELATION.id]: ['rec-x'] },
      backlinks: {},
    };
    const plan = relationWritePlan(relationSchema, record, P_RELATION.id, []);
    expect(plan.main.values[P_RELATION.id]).toBeNull();
    expect(plan.related).toEqual([{ recordId: 'rec-x', values: {}, backlinks: {} }]);

    const same = relationWritePlan(relationSchema, record, P_RELATION.id, ['rec-x']);
    expect(same.related).toEqual([]);
    expect(same.main.values[P_RELATION.id]).toEqual(['rec-x']);
  });

  it('非 relation 属性：只有主记录补丁、无 related', () => {
    const record = { id: 'rec-a', collection_id: 'c', values: { [P_TEXT.id]: '旧' }, backlinks: {} };
    const plan = relationWritePlan(relationSchema, record, P_TEXT.id, '新');
    expect(plan.related).toEqual([]);
    expect(plan.main.values[P_TEXT.id]).toBe('新');
  });

  it('双写计划的全部补丁都是 JSON 安全（进 Op.payload 前的门禁）', () => {
    const record = { id: 'rec-a', collection_id: 'c', values: { [P_RELATION.id]: ['rec-x'] }, backlinks: { other: ['rec-z'] } };
    const plan = relationWritePlan(relationSchema, record, P_RELATION.id, ['rec-y']);
    for (const patch of [plan.main, ...plan.related]) {
      expect(JSON.parse(JSON.stringify(patch))).toEqual(patch);
    }
  });
});

// ---------------------------------------------------------------------------
// 性能底线（1 万条：筛选 + 排序 在宽松预算内，防 O(n²) 回归）
// ---------------------------------------------------------------------------

describe('性能底线', () => {
  it('1 万条：applyFilter + applySort（单键）在 400ms 内完成', () => {
    const started = performance.now();
    const filtered = applyFilter(ROWS, {
      op: 'and',
      clauses: [
        { prop: P_NUMBER.id, kind: 'gt', value: 0 },
        { prop: P_TEXT.id, kind: 'contains', value: '书名' },
      ],
    });
    const sorted = applySort(filtered, [{ prop: P_NUMBER.id, dir: 'desc' }], SCHEMA);
    const elapsed = performance.now() - started;
    expect(sorted.length).toBeGreaterThan(0);
    expect(elapsed, `filter+sort=${elapsed.toFixed(2)}ms`).toBeLessThan(400);
  });
});

// ---------------------------------------------------------------------------
// visibleProperties（老板 10-01 第②项：隐藏字段的消费入口）
// ---------------------------------------------------------------------------

describe('visibleProperties（视图隐藏字段）', () => {
  const schema = {
    title_pid: 'p_title',
    properties: {
      p_title: { id: 'p_title', name: '标题', type: 'text' },
      p_score: { id: 'p_score', name: '评分', type: 'number' },
      p_date: { id: 'p_date', name: '读完于', type: 'date' },
    },
  } as unknown as CollectionSchema;

  it('未设置 / 空数组 → 全字段（零行为变化）', () => {
    expect(visibleProperties(schema, undefined).map((p) => p.id)).toEqual(['p_title', 'p_score', 'p_date']);
    expect(visibleProperties(schema, []).map((p) => p.id)).toEqual(['p_title', 'p_score', 'p_date']);
  });

  it('隐藏集合生效，且保持属性声明顺序', () => {
    expect(visibleProperties(schema, ['p_date']).map((p) => p.id)).toEqual(['p_title', 'p_score']);
    expect(visibleProperties(schema, ['p_score', 'p_date']).map((p) => p.id)).toEqual(['p_title']);
  });

  it('主字段（title_pid）永不可隐藏：写进集合也照样可见（与飞书主字段口径一致）', () => {
    expect(visibleProperties(schema, ['p_title', 'p_score']).map((p) => p.id)).toEqual(['p_title', 'p_date']);
  });

  it('未知 pid 忽略（属性被删后的残留不报错、不影响其它列）', () => {
    expect(visibleProperties(schema, ['p_gone']).map((p) => p.id)).toEqual(['p_title', 'p_score', 'p_date']);
  });
});

// ---------------------------------------------------------------------------
// IDEA-E：拖拽改序（视图页签拖动 → collection.views 数组序）
// ---------------------------------------------------------------------------

// T103：删除视图的纯决策（护栏「至少留一个视图」单一出处，main 侧只消费）
describe('viewRemovalOutcome —— 删除视图决策（T103）', () => {
  const byVid = (view: { vid: string }): string => view.vid;
  const ids = (list: readonly { vid: string }[]): string[] => list.map((view) => view.vid);

  it('正常删除：摘掉目标 vid，其余顺序原样保持', () => {
    const views = [{ vid: 'v1' }, { vid: 'v2' }, { vid: 'v3' }];
    const out = viewRemovalOutcome(views, byVid, 'v2');
    expect(out.kind).toBe('remove');
    expect(out.kind === 'remove' && ids(out.views)).toEqual(['v1', 'v3']);
  });

  it('只剩最后一个视图：判 last（不许删空，表必须至少有一个视图）', () => {
    const out = viewRemovalOutcome([{ vid: 'v1' }], byVid, 'v1');
    expect(out.kind).toBe('last');
  });

  it('空视图集（脏数据）：判 missing（先查存在性），绝不出 remove 空列表', () => {
    // 顺序有讲究：missing 先于 last ⇒ 空集请求删任意 vid 走幂等零写，
    // 而不是抛 E_INVARIANT 假装「还剩一个不能删」。
    expect(viewRemovalOutcome([], byVid, 'v1').kind).toBe('missing');
  });

  it('未知 vid：判 missing（调用方幂等零写）', () => {
    const out = viewRemovalOutcome([{ vid: 'v1' }, { vid: 'v2' }], byVid, 'nope');
    expect(out.kind).toBe('missing');
  });

  it('返回新数组不改入参（纯函数纪律）', () => {
    const views = [{ vid: 'v1' }, { vid: 'v2' }];
    const out = viewRemovalOutcome(views, byVid, 'v1');
    expect(out.kind === 'remove' && out.views).not.toBe(views);
    expect(views).toHaveLength(2);
  });
});
describe('reorderById —— 拖拽改序（创意 IDEA-E / 0.6.10 清单「视图排序」）', () => {
  const views = ['v1', 'v2', 'v3', 'v4'].map((vid) => defaultView(vid, `视图 ${vid}`));
  const byVid = (view: (typeof views)[number]) => view.vid;
  const ids = (list: readonly { vid: string }[]) => list.map((v) => v.vid);

  it('向右拖：占目标原索引（结果里排在目标之后）', () => {
    expect(ids(reorderById(views, byVid, 'v1', 'v3'))).toEqual(['v2', 'v3', 'v1', 'v4']);
  });

  it('向左拖：排在目标之前', () => {
    expect(ids(reorderById(views, byVid, 'v4', 'v2'))).toEqual(['v1', 'v4', 'v2', 'v3']);
  });

  it('拖到末尾可达（最后一个页签也能被放到队尾）', () => {
    expect(ids(reorderById(views, byVid, 'v1', 'v4'))).toEqual(['v2', 'v3', 'v4', 'v1']);
  });

  it('相邻交换两个方向都是对调', () => {
    expect(ids(reorderById(views, byVid, 'v2', 'v3'))).toEqual(['v1', 'v3', 'v2', 'v4']);
    expect(ids(reorderById(views, byVid, 'v3', 'v2'))).toEqual(['v1', 'v3', 'v2', 'v4']);
  });

  it('原地拖（from === to）与原样拷贝：不改入参引用', () => {
    const before = [...views];
    const same = reorderById(views, byVid, 'v2', 'v2');
    expect(same).toEqual(before);
    expect(same).not.toBe(views);
    expect(views).toEqual(before);
  });

  it('未知 vid / 空串 → 原样拷贝（页面并发刷新时的防御）', () => {
    expect(ids(reorderById(views, byVid, 'v9', 'v1'))).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(ids(reorderById(views, byVid, 'v1', 'v9'))).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(ids(reorderById(views, byVid, '', 'v1'))).toEqual(['v1', 'v2', 'v3', 'v4']);
  });

  it('同口径可用于字符串数组（规则/磁贴列表顺序 = 展示序）', () => {
    expect(reorderById(['a', 'b', 'c'], (s) => s, 'c', 'a')).toEqual(['c', 'a', 'b']);
  });

  it('两个元素的列表互换', () => {
    const two = [defaultView('x', 'X'), defaultView('y', 'Y')];
    expect(ids(reorderById(two, byVid, 'x', 'y'))).toEqual(['y', 'x']);
    expect(ids(reorderById(two, byVid, 'y', 'x'))).toEqual(['y', 'x']);
  });
});
