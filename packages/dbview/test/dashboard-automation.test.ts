/**
 * dashboard-automation.test.ts —— 仪表盘磁贴 / 自动化规则 的引擎纯函数（TASK-T102，飞书对标）。
 *
 * 口径住引擎（与看板/画廊/表单同套路子）：
 *  - evalRules：一轮规则评估（跳过条件全静默；后写覆盖先写）；
 *  - resolveWidgets：只留引用有效的磁贴（引用失效=字段删了/被隐藏 ⇒ 宁缺毋烂）；
 *  - normalizeView：widgets/rules 清洗往返（去重 id、剔未知类型、enabled 归真）——
 *    **未设置时结果里不得凭空出现这两个键**（老数据零迁移的硬契约）。
 */
import { describe, expect, it } from 'vitest';
import {
  defaultView,
  evalRules,
  normalizeView,
  resolveWidgets,
  type AutomationRule,
  type CollectionSchema,
  type DbView,
} from '../src';

const SCHEMA = {
  title_pid: 'p_title',
  properties: {
    p_title: { id: 'p_title', name: '任务', type: 'text' },
    p_status: {
      id: 'p_status',
      name: '状态',
      type: 'select',
      options: [{ id: 's-todo', name: '待办' }, { id: 's-done', name: '读完' }],
    },
    p_score: { id: 'p_score', name: '评分', type: 'number' },
    p_tags: { id: 'p_tags', name: '标签', type: 'multi_select', options: [{ id: 't1', name: 'A' }] },
    p_due: { id: 'p_due', name: '截止', type: 'date' },
  },
} as unknown as CollectionSchema;

function rule(patch: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'r1',
    name: '状态→读完时评分记10',
    enabled: true,
    on: { kind: 'update', pid: 'p_status' },
    if: { pid: 'p_status', eq: 's-done' },
    set: { pid: 'p_score', to: 10 },
    ...patch,
  };
}

describe('evalRules（一轮评估）', () => {
  it('条件命中 → 返回写入表；不命中/禁用/事件类型不符 → 空', () => {
    const hit = evalRules(SCHEMA, [rule()], { kind: 'update', pids: ['p_status'], values: { p_status: 's-done' } });
    expect(hit).toEqual({ p_score: 10 });
    expect(evalRules(SCHEMA, [rule({ enabled: false })], { kind: 'update', pids: ['p_status'], values: { p_status: 's-done' } })).toEqual({});
    expect(evalRules(SCHEMA, [rule()], { kind: 'create', pids: [], values: { p_status: 's-done' } })).toEqual({});
    expect(evalRules(SCHEMA, [rule()], { kind: 'update', pids: ['p_title'], values: { p_status: 's-done' } })).toEqual({});
    expect(evalRules(SCHEMA, [rule()], { kind: 'update', pids: ['p_status'], values: { p_status: 's-todo' } })).toEqual({});
  });

  it('on 不带 pid = 任意 create/update 都进条件判定（记录级触发）', () => {
    const r = rule({ on: { kind: 'create' } });
    expect(evalRules(SCHEMA, [r], { kind: 'create', pids: [], values: { p_status: 's-done' } })).toEqual({ p_score: 10 });
  });

  it('目标选项不存在 / set 指向不存在字段 → 静默跳过（坏规则不卡写入）', () => {
    expect(evalRules(SCHEMA, [rule({ set: { pid: 'p_status', to: 's-gone' } })], { kind: 'update', pids: ['p_status'], values: { p_status: 's-done' } })).toEqual({});
    expect(evalRules(SCHEMA, [rule({ set: { pid: 'p_gone', to: 1 } })], { kind: 'update', pids: ['p_status'], values: { p_status: 's-done' } })).toEqual({});
  });

  it('multi_select 目标：整组选项 id 必须都存在；空数组跳过', () => {
    const base = rule({ set: { pid: 'p_tags', to: ['t1'] } });
    expect(evalRules(SCHEMA, [base], { kind: 'update', pids: ['p_status'], values: { p_status: 's-done' } })).toEqual({ p_tags: ['t1'] });
    expect(evalRules(SCHEMA, [rule({ set: { pid: 'p_tags', to: ['t1', 't-gone'] } })], { kind: 'update', pids: ['p_status'], values: { p_status: 's-done' } })).toEqual({});
    expect(evalRules(SCHEMA, [rule({ set: { pid: 'p_tags', to: [] } })], { kind: 'update', pids: ['p_status'], values: { p_status: 's-done' } })).toEqual({});
  });

  it('规则顺序 = 覆盖顺序（同字段两条命中，后者胜）', () => {
    const out = evalRules(SCHEMA, [
      rule({ id: 'a', set: { pid: 'p_score', to: 7 } }),
      rule({ id: 'b', set: { pid: 'p_score', to: 10 } }),
    ], { kind: 'update', pids: ['p_status'], values: { p_status: 's-done' } });
    expect(out).toEqual({ p_score: 10 });
  });

  it('if 条件走引擎统一值口径：checkbox false 可匹配、空值可匹配', () => {
    const r = rule({ on: { kind: 'create' }, if: { pid: 'p_due', eq: null }, set: { pid: 'p_score', to: 0 } });
    expect(evalRules(SCHEMA, [r], { kind: 'create', pids: [], values: {} })).toEqual({ p_score: 0 });
  });
});

describe('resolveWidgets（失效引用剔除）', () => {
  const dashboard = (widgets: DbView['widgets']): DbView =>
    ({ ...defaultView('vd', '仪表盘'), type: 'dashboard', widgets });

  it('非 dashboard 视图 → 空数组', () => {
    expect(resolveWidgets(SCHEMA, { ...defaultView('v1'), type: 'table', widgets: [{ id: 'w1', type: 'divider' }] })).toEqual([]);
  });

  it('各型有效磁贴全保留；未知/隐藏引用剔除', () => {
    const widgets = [
      { id: 'w1', type: 'metric', config: { groupPid: 'p_status' } },
      { id: 'w2', type: 'number', config: { pid: 'p_score', agg: 'sum' } },
      { id: 'w3', type: 'text', config: { text: '周报' } },
      { id: 'w4', type: 'divider' },
      { id: 'w5', type: 'metric', config: { groupPid: 'p_score' } },     // 非 select ⇒ 剔
      { id: 'w6', type: 'metric', config: { groupPid: 'p_gone' } },      // 不存在 ⇒ 剔
      { id: 'w7', type: 'distribution', config: { groupPid: 'p_status' } }, // 隐藏 ⇒ 剔
    ] as unknown as DbView['widgets'];
    const kept = resolveWidgets(SCHEMA, dashboard([...(widgets ?? []), ])).map((w) => w.id);
    expect(kept).toEqual(['w1', 'w2', 'w3', 'w4', 'w7']);
    const hidden = resolveWidgets(SCHEMA, { ...dashboard(widgets), hiddenPids: ['p_status'] }).map((w) => w.id);
    expect(hidden).toEqual(['w1', 'w2', 'w3', 'w4', 'w7'].filter((id) => id !== 'w1' && id !== 'w7'));
  });

  it('text 磁贴空文字剔除；divider 恒保留；空 config 的 number 剔除', () => {
    const ids = resolveWidgets(SCHEMA, dashboard([
      { id: 't1', type: 'text', config: { text: '   ' } },
      { id: 't2', type: 'text' },
      { id: 'd1', type: 'divider' },
      { id: 'n1', type: 'number' },
      { id: 'n2', type: 'number', config: { pid: 'p_due' } },
    ] as unknown as DbView['widgets'])).map((w) => w.id);
    expect(ids).toEqual(['d1', 'n2']);
  });
});

describe('normalizeView：widgets/rules 清洗往返', () => {
  it('未设置 → 结果不得凭空出现 widgets/rules 键（老数据零迁移）', () => {
    const out = normalizeView(defaultView('v1', '表格'));
    expect(Object.keys(out)).not.toContain('widgets');
    expect(Object.keys(out)).not.toContain('rules');
  });

  it('磁贴：未知类型剔、id 去重、config 白名单键保留', () => {
    const out = normalizeView({
      ...defaultView('vd'), type: 'dashboard',
      widgets: [
        { id: 'w1', type: 'metric', config: { groupPid: 'p_status', junk: 1 } },
        { id: 'w1', type: 'text', config: { text: 'dup' } },
        { id: 'w2', type: 'spaceship' },
        { id: '', type: 'divider' },
        { id: 'w3', type: 'divider' },
      ],
    } as unknown as DbView);
    expect(out.widgets?.map((w) => w.id)).toEqual(['w1', 'w3']);
    expect(out.widgets?.[0]?.config).toEqual({ groupPid: 'p_status' });
  });

  it('规则：缺 if/set 或 kind 非法 → 剔；enabled 非 false 一律归 true', () => {
    const out = normalizeView({
      ...defaultView('va'), type: 'automation',
      rules: [
        { id: 'ok', name: 'n', enabled: 'yes', on: { kind: 'update', pid: 'p_status' }, if: { pid: 'p_status', eq: 's-done' }, set: { pid: 'p_score', to: 10 } },
        { id: 'bad1', name: '', enabled: true, on: { kind: 'delete' }, if: { pid: 'p_status', eq: 1 }, set: { pid: 'p_score', to: 1 } },
        { id: 'bad2', name: '', enabled: true, on: { kind: 'create' }, if: { pid: '' }, set: { pid: 'p_score', to: 1 } },
        { id: 'off', name: '', enabled: false, on: { kind: 'create' }, if: { pid: 'p_status', eq: 2 }, set: { pid: 'p_score', to: 1 } },
      ],
    } as unknown as DbView);
    expect(out.rules?.map((r) => r.id)).toEqual(['ok', 'off']);
    expect(out.rules?.[0]?.enabled, "'yes' 不是 false ⇒ 归 true").toBe(true);
    expect(out.rules?.[1]?.enabled).toBe(false);
  });
});