/**
 * kanban.test.ts —— 看板视图引擎（TASK-T99-01，飞书多维表格对标）。
 *
 * 覆盖 PRD-多维表格 第 4.1 节的引擎契约：
 *  - groupBySelect：选项顺序分组、未分组桶置末、多选可入多组、野值/空值归未分组、
 *    非 select 属性返回 undefined；
 *  - kanbanGroups：groupPid 解析（显式 → 回退第一个 select/multi_select → 不可用返回 []）；
 *  - moveCardToGroup：select / multi_select / 未分组桶 / 未知 key / 非 select 属性的取值语义；
 *  - dbViewSchema：新可选字段（groupPid / hiddenPids）解析 + 旧视图（无新字段）零迁移兼容。
 */
import { describe, expect, it } from 'vitest';
import {
  NONE_GROUP_KEY,
  groupBySelect,
  kanbanGroups,
  moveCardToGroup,
  normalizeView,
} from '../src/view';
import {
  dbViewSchema,
  defaultView,
  emptyFilter,
  parseViews,
  propertySchema,
  type CollectionSchema,
  type DbView,
  type RecordEntity,
} from '../src/types';

const P_STATUS = propertySchema.parse({
  id: 'p_status',
  name: '状态',
  type: 'select',
  options: [
    { id: 's-todo', name: '待办' },
    { id: 's-doing', name: '进行中' },
    { id: 's-done', name: '已完成' },
  ],
});
const P_TAGS = propertySchema.parse({
  id: 'p_tags',
  name: '标签',
  type: 'multi_select',
  options: [
    { id: 'm-a', name: 'A' },
    { id: 'm-b', name: 'B' },
  ],
});
const P_TITLE = propertySchema.parse({ id: 'p_title', name: '标题', type: 'text' });

const SCHEMA: CollectionSchema = {
  properties: { [P_TITLE.id]: P_TITLE, [P_STATUS.id]: P_STATUS, [P_TAGS.id]: P_TAGS },
  title_pid: P_TITLE.id,
};

function rec(id: string, values: Record<string, unknown>): RecordEntity {
  return {
    id,
    collection_id: 'col-1',
    values: values as RecordEntity['values'],
    sort_key: id,
  } as RecordEntity;
}

const ROWS: RecordEntity[] = [
  rec('r1', { p_title: '一', p_status: 's-doing', p_tags: ['m-a'] }),
  rec('r2', { p_title: '二', p_status: 's-todo', p_tags: ['m-a', 'm-b'] }),
  rec('r3', { p_title: '三', p_status: 's-done' }),
  rec('r4', { p_title: '四' }), // 无状态 → 未分组
  rec('r5', { p_title: '五', p_status: 's-ghost' }), // 野值 → 未分组
  rec('r6', { p_title: '六', p_status: 's-todo', p_tags: [] }), // 空数组 → 未分组（多选视角）
];

function view(overrides: Partial<DbView> = {}): DbView {
  return { ...defaultView('v1'), ...overrides };
}

describe('T99-01 groupBySelect', () => {
  it('组顺序 = options 顺序，未分组桶恒置末；单选记录恰好落一组', () => {
    const groups = groupBySelect(ROWS, P_STATUS) ?? [];
    expect(groups.map((g) => g.key)).toEqual(['s-todo', 's-doing', 's-done', NONE_GROUP_KEY]);
    expect(groups.map((g) => g.label)).toEqual(['待办', '进行中', '已完成', '']);
    expect(groups[0]!.records.map((r) => r.id)).toEqual(['r2', 'r6']);
    expect(groups[1]!.records.map((r) => r.id)).toEqual(['r1']);
    expect(groups[2]!.records.map((r) => r.id)).toEqual(['r3']);
    // 野值（s-ghost）与缺值（r4）都进未分组桶
    expect(groups[3]!.records.map((r) => r.id)).toEqual(['r4', 'r5']);
  });

  it('多选：一条记录可同时出现在多个组；空数组只进未分组桶', () => {
    const groups = groupBySelect(ROWS, P_TAGS) ?? [];
    expect(groups.map((g) => g.key)).toEqual(['m-a', 'm-b', NONE_GROUP_KEY]);
    expect(groups[0]!.records.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(groups[1]!.records.map((r) => r.id)).toEqual(['r2']);
    expect(groups[2]!.records.map((r) => r.id)).toEqual(['r3', 'r4', 'r5', 'r6']);
  });

  it('非 select 属性 / 缺属性 → undefined（调用方据此回退表格视图）', () => {
    expect(groupBySelect(ROWS, P_TITLE)).toBeUndefined();
    expect(groupBySelect(ROWS, undefined)).toBeUndefined();
  });

  it('零选项的 select：只剩未分组桶', () => {
    const empty = propertySchema.parse({ id: 'p_e', name: '空', type: 'select', options: [] });
    const groups = groupBySelect(ROWS, empty) ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe(NONE_GROUP_KEY);
    expect(groups[0]!.records).toHaveLength(ROWS.length);
  });
});

describe('T99-01 kanbanGroups', () => {
  it('显式 groupPid 生效，且带 pid', () => {
    const groups = kanbanGroups(SCHEMA, ROWS, view({ type: 'kanban', groupPid: 'p_status' }));
    expect(groups.map((g) => g.pid)).toEqual(['p_status', 'p_status', 'p_status', 'p_status']);
    expect(groups.map((g) => g.key)).toEqual(['s-todo', 's-doing', 's-done', NONE_GROUP_KEY]);
  });

  it('groupPid 缺省或指向非 select 时回退到第一个 select/multi_select', () => {
    const a = kanbanGroups(SCHEMA, ROWS, view({ type: 'kanban' }));
    expect(a[0]!.pid).toBe('p_status');
    const b = kanbanGroups(SCHEMA, ROWS, view({ type: 'kanban', groupPid: 'p_title' }));
    expect(b[0]!.pid).toBe('p_status');
  });

  it('schema 里没有任何 select/multi_select → 空数组（渲染层回退表格）', () => {
    const only: CollectionSchema = { properties: { [P_TITLE.id]: P_TITLE }, title_pid: P_TITLE.id };
    expect(kanbanGroups(only, ROWS, view({ type: 'kanban' }))).toEqual([]);
  });
});

describe('T99-01 moveCardToGroup', () => {
  it('select：落到某组 = 该选项 id；落到未分组桶 = null（清空）', () => {
    expect(moveCardToGroup(P_STATUS, 's-done')).toBe('s-done');
    expect(moveCardToGroup(P_STATUS, NONE_GROUP_KEY)).toBeNull();
  });

  it('multi_select：落到某组 = [id]；落到未分组桶 = []', () => {
    expect(moveCardToGroup(P_TAGS, 'm-b')).toEqual(['m-b']);
    expect(moveCardToGroup(P_TAGS, NONE_GROUP_KEY)).toEqual([]);
  });

  it('未知 key / 非 select 属性 / 缺属性 → undefined（调用方跳过写入，不写脏值）', () => {
    expect(moveCardToGroup(P_STATUS, 's-ghost')).toBeUndefined();
    expect(moveCardToGroup(P_TITLE, 's-todo')).toBeUndefined();
    expect(moveCardToGroup(undefined, 's-todo')).toBeUndefined();
  });
});

describe('T99-01 dbViewSchema 新字段与零迁移', () => {
  it('groupPid / hiddenPids 可选：带上即解析，缺省不变', () => {
    const withKanban = dbViewSchema.parse({
      vid: 'v2', name: '看板', type: 'kanban', filter: emptyFilter(), sort: [], widths: {},
      groupPid: 'p_status', hiddenPids: ['p_tags'],
    });
    expect(withKanban.groupPid).toBe('p_status');
    expect(withKanban.hiddenPids).toEqual(['p_tags']);
    const legacy = dbViewSchema.parse({
      vid: 'v1', name: '表格', type: 'table', filter: emptyFilter(), sort: [], widths: {},
    });
    expect(legacy.groupPid).toBeUndefined();
    expect(legacy.hiddenPids).toBeUndefined();
    expect(legacy.type).toBe('table');
  });

  it('VIEW_TYPES 含 kanban；defaultView 仍是 table（旧行为不变）', () => {
    expect(defaultView('v9').type).toBe('table');
    expect(dbViewSchema.safeParse({ ...defaultView('v3'), type: 'kanban' }).success).toBe(true);
    expect(dbViewSchema.safeParse({ ...defaultView('v3'), type: 'gantt' }).success).toBe(false);
  });

  it('parseViews 兼容混合视图（旧表格视图 + 新看板视图共存）', () => {
    const parsed = parseViews([
      { vid: 'v1', name: '表格', type: 'table', filter: emptyFilter(), sort: [], widths: {} },
      { vid: 'v2', name: '看板', type: 'kanban', filter: emptyFilter(), sort: [], widths: {}, groupPid: 'p_status' },
    ]);
    expect(parsed?.map((v) => v.type)).toEqual(['table', 'kanban']);
    expect(parsed?.[1]?.groupPid).toBe('p_status');
  });
});

describe('T99-01 normalizeView 不得丢弃看板配置（真缺陷回归）', () => {
  it('groupPid / hiddenPids 往返保留；脏值被清洗（空串/非字符串/重复）', () => {
    const kept = normalizeView({
      ...view({ type: 'kanban' }),
      groupPid: 'p_status',
      hiddenPids: ['p_tags', 'p_tags', '', 'p_x', 42 as never],
    });
    expect(kept.type).toBe('kanban');
    expect(kept.groupPid, 'groupPid 必须原样带过（早期只挑 6 字段重建 → 静默丢失）').toBe('p_status');
    expect(kept.hiddenPids).toEqual(['p_tags', 'p_x']);
  });

  it('空 groupPid / 空 hiddenPids → 不写字段（旧视图形状零变化）', () => {
    const clean = normalizeView({ ...view(), groupPid: '', hiddenPids: [] });
    expect(clean.groupPid).toBeUndefined();
    expect(clean.hiddenPids).toBeUndefined();
    expect(Object.keys(clean).sort()).toEqual(['filter', 'name', 'sort', 'type', 'vid', 'widths']);
  });
});
