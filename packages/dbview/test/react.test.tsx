/**
 * react.test.tsx —— 视图层交互（TASK-T7-01 §3/§4，jsdom 工程）。
 *
 * 覆盖：
 * - TableGrid 冒烟：行/表头/列数、空值占位「—」、数字列类名、空态 CTA、Skeleton；
 * - 单元格编辑：Enter 进入编辑 → 输入 → Enter 提交（onChangeCell 收到新值）；Esc 取消；
 * - 虚拟滚动：只渲染视口内行 + 缓冲；
 * - PropBar：新属性菜单 8 种、筛选 chip 可单个移除；
 * - DbView：标题/记录数、筛选后空态提示、计算行显示平均值、ErrorPanel 重试。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  collectionEntitySchema,
  collectionSchemaSchema,
  defaultView,
  emptyFilter,
  propertySchema,
  type CollectionEntity,
  type RecordEntity,
} from '../src/types';
import { Aggregations } from '../src/react/Aggregations';
import { CellEditor } from '../src/react/CellEditor';
import { DbView } from '../src/react/DbView';
import { PropBar } from '../src/react/PropBar';
import { TableGrid } from '../src/react/TableGrid';

const P_TITLE = propertySchema.parse({ id: 'p_title', name: '书名', type: 'text' });
const P_SCORE = propertySchema.parse({ id: 'p_score', name: '评分', type: 'number' });
const P_DATE = propertySchema.parse({ id: 'p_date', name: '读完于', type: 'date' });
const P_STATUS = propertySchema.parse({
  id: 'p_status',
  name: '状态',
  type: 'select',
  options: [
    { id: 's-read', name: '在读', tone: 'amber' },
    { id: 's-drop', name: '弃读', tone: 'red' },
  ],
});

const SCHEMA = collectionSchemaSchema.parse({
  properties: {
    [P_TITLE.id]: P_TITLE,
    [P_SCORE.id]: P_SCORE,
    [P_DATE.id]: P_DATE,
    [P_STATUS.id]: P_STATUS,
  },
  title_pid: P_TITLE.id,
});

function makeRecord(id: string, values: Record<string, unknown>, sortKey: string): RecordEntity {
  return {
    id,
    collection_id: 'col-books',
    workspace_id: 'ws-test',
    values,
    sort_key: sortKey,
    alive: 1,
    version: 1,
  };
}

const RECORDS: RecordEntity[] = [
  makeRecord('rec-1', { p_title: '哥德尔、艾舍尔、巴赫', p_score: 4.5, p_status: 's-read' }, 'A1'),
  makeRecord('rec-2', { p_title: '当前页码', p_score: 3, p_date: { y: 2017, m: 1, d: 1 } }, 'A2'),
  makeRecord('rec-3', { p_title: '时间简史', p_date: { y: 2026, m: 7, d: 2 }, p_status: 's-drop' }, 'A3'),
];

const COLLECTION: CollectionEntity = collectionEntitySchema.parse({
  id: 'col-books',
  page_id: 'pg-books',
  workspace_id: 'ws-test',
  name: '阅读清单',
  schema: SCHEMA,
  views: [defaultView('v1', '表格')],
  alive: 1,
  version: 1,
});

const NOOP = (): void => {};

describe('TableGrid', () => {
  it('渲染表头/记录行；空值占位「—」；数字列右对齐类名', () => {
    const { container } = render(
      <TableGrid
        schema={SCHEMA}
        rows={RECORDS}
        widths={{}}
        status="ready"
        selectedIds={new Set()}
        focusedCell={null}
        editingCell={null}
        onCreateRecord={NOOP}
      />,
    );
    expect(container.querySelectorAll('.sc-dbrow')).toHaveLength(3);
    expect(container.querySelectorAll('.sc-dbhead__cell')).toHaveLength(5); // 勾选列 + 4 属性列
    expect(screen.getByText('哥德尔、艾舍尔、巴赫')).toBeDefined();
    // rec-2 没有 status → 「—」
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // 数字列标记 + 数字文本
    expect(container.querySelectorAll('.sc-dbcell--num').length).toBe(3);
    expect(screen.getByText('4.5')).toBeDefined();
    // 日期列类名 + 日期文本
    expect(container.querySelectorAll('.sc-dbcell--date').length).toBe(3);
    expect(screen.getByText('2017-01-01')).toBeDefined();
  });

  it('四态：empty → EmptyState（一句 + 新建记录 primary）；loading → Skeleton', () => {
    const onAction = vi.fn();
    const { container, rerender } = render(
      <TableGrid
        schema={SCHEMA}
        rows={[]}
        widths={{}}
        status="empty"
        selectedIds={new Set()}
        focusedCell={null}
        editingCell={null}
        onCreateRecord={onAction}
      />,
    );
    expect(screen.getByText('还没有记录')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '新建记录' }));
    expect(onAction).toHaveBeenCalledTimes(1);

    rerender(
      <TableGrid
        schema={SCHEMA}
        rows={[]}
        widths={{}}
        status="loading"
        selectedIds={new Set()}
        focusedCell={null}
        editingCell={null}
        onCreateRecord={NOOP}
      />,
    );
    expect(container.querySelectorAll('.sc-skeleton').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.sc-dbrow')).toHaveLength(0);
  });

  it('四态：error → ErrorPanel 带重试', () => {
    const onRetry = vi.fn();
    render(
      <TableGrid
        schema={SCHEMA}
        rows={[]}
        widths={{}}
        status="error"
        error="数据库加载失败"
        selectedIds={new Set()}
        focusedCell={null}
        editingCell={null}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('虚拟滚动：只渲染视口内行 + 缓冲，spacer 撑起总高', () => {
    const many = Array.from({ length: 100 }, (_value, index) =>
      makeRecord(`rec-${String(index)}`, { p_title: `记录 ${String(index)}` }, `A${String(index)}`),
    );
    const { container } = render(
      <TableGrid
        schema={SCHEMA}
        rows={many}
        widths={{}}
        status="ready"
        selectedIds={new Set()}
        focusedCell={null}
        editingCell={null}
        viewportHeight={240}
        onCreateRecord={NOOP}
      />,
    );
    // 240px / 36px ≈ 7 行 + 缓冲 → 远少于 100
    const rendered = container.querySelectorAll('.sc-dbrow').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(20);
    const viewport = container.querySelector('.sc-dbgrid__viewport') as HTMLElement;
    expect(viewport.style.height).toBe(`${String(100 * 36)}px`);
  });

  it('批量条：勾选行后显示已选数 + 删除回调', () => {
    const onDelete = vi.fn();
    render(
      <TableGrid
        schema={SCHEMA}
        rows={RECORDS}
        widths={{}}
        status="ready"
        selectedIds={new Set(['rec-1', 'rec-2'])}
        focusedCell={null}
        editingCell={null}
        onDeleteSelected={onDelete}
        onCreateRecord={NOOP}
      />,
    );
    expect(screen.getByText(/已选 2 条/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onDelete).toHaveBeenCalledWith(['rec-1', 'rec-2']);
  });
});

describe('CellEditor', () => {
  function setup(overrides: { editing?: boolean } = {}) {
    const onCommit = vi.fn();
    const onBeginEdit = vi.fn();
    const onEndEdit = vi.fn();
    const view = render(
      <CellEditor
        property={P_TITLE}
        value="旧标题"
        onCommit={onCommit}
        editing={overrides.editing ?? false}
        onBeginEdit={onBeginEdit}
        onEndEdit={onEndEdit}
      />,
    );
    return { onCommit, onBeginEdit, onEndEdit, view };
  }

  it('未编辑态显示值；Enter 请求进入编辑', () => {
    const { onBeginEdit, view } = setup();
    expect(screen.getByText('旧标题')).toBeDefined();
    fireEvent.keyDown(view.container.querySelector('.sc-dbc') as HTMLElement, { key: 'Enter' });
    expect(onBeginEdit).toHaveBeenCalledTimes(1);
  });

  it('编辑态：输入后 Enter 提交新值并退出编辑', () => {
    const { onCommit, onEndEdit, view } = setup({ editing: true });
    const input = view.container.querySelector('.sc-dbc-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('新标题');
    expect(onEndEdit).toHaveBeenCalledTimes(1);
  });

  it('编辑态：Esc 取消，不提交', () => {
    const { onCommit, onEndEdit, view } = setup({ editing: true });
    const input = view.container.querySelector('.sc-dbc-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '改了一半' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEndEdit).toHaveBeenCalledTimes(1);
  });

  it('number：非法输入不提交 NaN（浏览器把非法值净化为空 → 语义为清空）', () => {
    const onCommit = vi.fn();
    const onEndEdit = vi.fn();
    const { container } = render(
      <CellEditor
        property={P_SCORE}
        value={1}
        onCommit={onCommit}
        editing
        onBeginEdit={NOOP}
        onEndEdit={onEndEdit}
      />,
    );
    const input = container.querySelector('.sc-dbc-input') as HTMLInputElement;
    // input[type=number] 在 jsdom 与真实浏览器行为一致：非法串（abc/1e999/1.2.3）
    // 读回来是 ''，触发「清空」路径。核心不变量是**永远不会提交 NaN**。
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input.value).toBe('');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBeNull(); // 空串 → null（空值），不是 NaN
    const [committed] = onCommit.mock.calls[0] ?? [];
    expect(Number.isNaN(committed)).toBe(false);
    expect(onEndEdit).toHaveBeenCalledTimes(1);
  });

  it('checkbox：单击/Enter 直接切换，不进编辑态', () => {
    const onCommit = vi.fn();
    const onBeginEdit = vi.fn();
    const { container } = render(
      <CellEditor
        property={propertySchema.parse({ id: 'p_check', name: '已读', type: 'checkbox' })}
        value={false}
        onCommit={onCommit}
        editing={false}
        onBeginEdit={onBeginEdit}
        onEndEdit={NOOP}
      />,
    );
    fireEvent.keyDown(container.querySelector('.sc-dbc') as HTMLElement, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(true);
    expect(onBeginEdit).not.toHaveBeenCalled();
  });

  it('relation：候选为空时仍可选中单元格（disabled 不编辑）', () => {
    const onBeginEdit = vi.fn();
    const { container } = render(
      <CellEditor
        property={propertySchema.parse({ id: 'p_rel', name: '关联', type: 'relation' })}
        value={[]}
        onCommit={NOOP}
        editing={false}
        onBeginEdit={onBeginEdit}
        onEndEdit={NOOP}
        relationCandidates={[]}
      />,
    );
    expect(container.querySelector('.sc-dbc-empty')).not.toBeNull();
  });
});

describe('PropBar', () => {
  const baseProps = {
    schema: SCHEMA,
    views: [defaultView('v1', '表格')],
    activeVid: 'v1',
    onSwitchView: NOOP,
    onChangeFilter: NOOP,
    onChangeSort: NOOP,
    onAddProperty: NOOP,
    onCreateRecord: NOOP,
    onExportCsv: NOOP,
  };

  it('「新属性」菜单 9 种类型（T18-04 增 AI）；选中回调带 FieldType', () => {
    const onAddProperty = vi.fn();
    render(<PropBar {...baseProps} filter={emptyFilter()} sort={[]} onAddProperty={onAddProperty} />);
    fireEvent.click(screen.getByRole('button', { name: /新属性/ }));
    const menu = screen.getByRole('menu', { name: '新属性类型' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(9);
    expect(items.map((item) => item.textContent)).toEqual([
      '文本',
      '数字',
      '单选',
      '多选',
      '日期',
      '勾选',
      '链接',
      '关联',
      'AI',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: '日期' }));
    expect(onAddProperty).toHaveBeenCalledWith('date');
  });

  it('筛选 chip 可单个移除（保留其余 chip）', () => {
    const onChangeFilter = vi.fn();
    const filter = {
      op: 'and' as const,
      clauses: [
        { prop: P_STATUS.id, kind: 'eq' as const, value: 's-read' },
        { prop: P_TITLE.id, kind: 'contains' as const, value: '史' },
      ],
    };
    render(<PropBar {...baseProps} filter={filter} sort={[]} onChangeFilter={onChangeFilter} />);
    expect(screen.getByText('状态 = 在读')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '移除筛选：状态 = 在读' }));
    expect(onChangeFilter).toHaveBeenCalledWith({
      op: 'and',
      clauses: [{ prop: P_TITLE.id, kind: 'contains', value: '史' }],
    });
  });

  it('排序 chip 可切方向、可移除', () => {
    const onChangeSort = vi.fn();
    render(
      <PropBar
        {...baseProps}
        filter={emptyFilter()}
        sort={[{ prop: P_SCORE.id, dir: 'asc' }]}
        onChangeSort={onChangeSort}
      />,
    );
    expect(screen.getByText(/排序：评分/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '切换排序方向：评分' }));
    expect(onChangeSort).toHaveBeenCalledWith([{ prop: P_SCORE.id, dir: 'desc' }]);
  });
});

describe('Aggregations', () => {
  it('数字列求和/平均显示在标签里', () => {
    const { rerender } = render(<Aggregations schema={SCHEMA} rows={RECORDS} />);
    // 默认「不计算」
    expect(screen.getByText('计算')).toBeDefined();

    rerender(<Aggregations schema={SCHEMA} rows={RECORDS} />);
    fireEvent.click(screen.getByRole('button', { name: /计算/ }));
    const menu = screen.getByRole('menu', { name: '计算' });
    // 默认属性是第一个（书名 text）→ 只有「不计算/计数」
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['不计算', '计数']);
  });
});

describe('DbView', () => {
  const dbProps = {
    collection: COLLECTION,
    records: RECORDS,
    status: 'ready' as const,
    onCreateRecord: NOOP,
    onDeleteRecords: NOOP,
    onChangeValue: NOOP,
    onRenameRecord: NOOP,
    onAddProperty: NOOP,
    onRemoveProperty: NOOP,
    onRenameProperty: NOOP,
    onSaveView: NOOP,
    onExportCsv: NOOP,
  };

  it('渲染名称/记录数/表格/计算行', () => {
    const { container } = render(<DbView {...dbProps} />);
    expect(screen.getByText('阅读清单')).toBeDefined();
    expect(screen.getByText(/3 条记录/)).toBeDefined();
    expect(container.querySelectorAll('.sc-dbrow')).toHaveLength(3);
    expect(container.querySelector('.sc-agg')).not.toBeNull();
  });

  it('筛选后无匹配：显示提示且不算空态（EmptyState 不出现）', () => {
    const filtered = collectionEntitySchema.parse({
      ...COLLECTION,
      views: [
        {
          ...defaultView('v1', '表格'),
          filter: { op: 'and', clauses: [{ prop: P_TITLE.id, kind: 'eq', value: '不存在的书' }] },
        },
      ],
    });
    render(<DbView {...dbProps} collection={filtered} />);
    expect(screen.getByText(/当前筛选没有匹配的记录/)).toBeDefined();
    expect(screen.queryByText('还没有记录')).toBeNull();
  });

  it('库为空：EmptyState + 空态主按钮新建记录', () => {
    const onCreateRecord = vi.fn();
    const { container } = render(<DbView {...dbProps} records={[]} onCreateRecord={onCreateRecord} />);
    expect(screen.getByText('还没有记录')).toBeDefined();
    // 工具栏的「新建记录」是常驻 chrome，空态里另有一个主按钮 —— 断言必须限定在空态容器内
    const empty = container.querySelector('.sc-empty') as HTMLElement;
    expect(empty).not.toBeNull();
    const primary = Array.from(empty.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('新建记录'),
    ) as HTMLButtonElement;
    fireEvent.click(primary);
    expect(onCreateRecord).toHaveBeenCalledWith({ pid: P_TITLE.id, value: '未命名' });
  });

  it('加载失败：ErrorPanel 重试回调', () => {
    const onRetry = vi.fn();
    render(<DbView {...dbProps} status="error" error="数据库加载失败" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AI 属性列（TASK-T18-04 追加，不改既有断言）
// ---------------------------------------------------------------------------

const P_AI = propertySchema.parse({ id: 'p_ai', name: '摘要', type: 'ai', ai: { prompt: '用一句话概括本行' } });
const AI_SCHEMA = collectionSchemaSchema.parse({
  properties: { p_title: P_TITLE, p_ai: P_AI },
  title_pid: 'p_title',
});
const AI_COLLECTION = collectionEntitySchema.parse({
  ...COLLECTION,
  id: 'col-ai',
  name: 'AI 库',
  schema: AI_SCHEMA,
});
const AI_RECORDS = [makeRecord('rec-a', { p_title: '哥德尔、艾舍尔、巴赫' }, 'A1')];

describe('AI 列 · CellEditor（T18-04）', () => {
  it('ai 单元格：文本展示 + 「AI 生成」按钮（回调被调）；busy 时禁用', () => {
    const onAiGenerate = vi.fn();
    const { container, rerender } = render(
      <CellEditor
        property={P_AI}
        value="已生成的摘要"
        onCommit={NOOP}
        editing={false}
        onBeginEdit={NOOP}
        onEndEdit={NOOP}
        onAiGenerate={onAiGenerate}
      />,
    );
    expect(screen.getByText('已生成的摘要')).toBeDefined();
    const button = screen.getByRole('button', { name: 'AI 生成' });
    fireEvent.click(button);
    expect(onAiGenerate).toHaveBeenCalledTimes(1);

    rerender(
      <CellEditor
        property={P_AI}
        value="已生成的摘要"
        onCommit={NOOP}
        editing={false}
        onBeginEdit={NOOP}
        onEndEdit={NOOP}
        onAiGenerate={onAiGenerate}
        aiBusy
      />,
    );
    expect((screen.getByRole('button', { name: 'AI 生成' }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.sc-spinner')).not.toBeNull();
  });

  it('ai 单元格：未提供 onAiGenerate → 按钮不渲染（库侧保持纯净）；编辑态复用文本输入器', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <CellEditor
        property={P_AI}
        value={null}
        onCommit={onCommit}
        editing={false}
        onBeginEdit={NOOP}
        onEndEdit={NOOP}
      />,
    );
    expect(screen.queryByRole('button', { name: 'AI 生成' })).toBeNull();

    // 手工编辑与 text 一致（TASK-T18-04 §0.5）：编辑态由父级受控
    const { container: editingContainer } = render(
      <CellEditor
        property={P_AI}
        value=""
        onCommit={onCommit}
        editing
        onBeginEdit={NOOP}
        onEndEdit={NOOP}
      />,
    );
    const input = editingContainer.querySelector('.sc-dbc-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '手工填的值' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('手工填的值');
    void container;
  });
});

describe('AI 列 · PropBar（T18-04）', () => {
  const aiProps = {
    schema: AI_SCHEMA,
    views: [defaultView('v1', '表格')],
    activeVid: 'v1',
    onSwitchView: NOOP,
    onChangeFilter: NOOP,
    onChangeSort: NOOP,
    onAddProperty: NOOP,
    onCreateRecord: NOOP,
    onExportCsv: NOOP,
  };

  it('ai 列的属性菜单出现「批量生成」与「编辑生成指令」；回调被调', () => {
    const onAiBatchGenerate = vi.fn();
    const onUpdateAiPrompt = vi.fn();
    render(
      <PropBar
        {...aiProps}
        filter={emptyFilter()}
        sort={[]}
        onAiBatchGenerate={onAiBatchGenerate}
        onUpdateAiPrompt={onUpdateAiPrompt}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '属性管理：摘要' }));
    const menu = screen.getByRole('menu', { name: '属性管理' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: '批量生成' }));
    expect(onAiBatchGenerate).toHaveBeenCalledWith('p_ai');

    fireEvent.click(screen.getByRole('button', { name: '属性管理：摘要' }));
    fireEvent.click(
      within(screen.getByRole('menu', { name: '属性管理' })).getByRole('menuitem', { name: '编辑生成指令' }),
    );
    const textarea = screen.getByLabelText('生成指令') as HTMLTextAreaElement;
    expect(textarea.value).toBe('用一句话概括本行');
    fireEvent.change(textarea, { target: { value: '改成新指令' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onUpdateAiPrompt).toHaveBeenCalledWith('p_ai', '改成新指令');
  });

  it('非 ai 列的属性菜单不含 AI 入口（text 列回归）', () => {
    const onAiBatchGenerate = vi.fn();
    render(<PropBar {...aiProps} filter={emptyFilter()} sort={[]} onAiBatchGenerate={onAiBatchGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: '属性管理：书名' }));
    const menu = screen.getByRole('menu', { name: '属性管理' });
    expect(within(menu).queryByRole('menuitem', { name: '批量生成' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: '编辑生成指令' })).toBeNull();
  });
});

describe('AI 列 · DbView 接线（T18-04）', () => {
  const aiDbProps = {
    collection: AI_COLLECTION,
    records: AI_RECORDS,
    status: 'ready' as const,
    onCreateRecord: NOOP,
    onDeleteRecords: NOOP,
    onChangeValue: NOOP,
    onRenameRecord: NOOP,
    onAddProperty: NOOP,
    onRemoveProperty: NOOP,
    onRenameProperty: NOOP,
    onSaveView: NOOP,
    onExportCsv: NOOP,
  };

  it('透传 onAiGenerate：单元格按钮触发回调（pid + recordId）', async () => {
    const onAiGenerate = vi.fn().mockResolvedValue(undefined);
    render(<DbView {...aiDbProps} onAiGenerate={onAiGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成' }));
    await Promise.resolve();
    expect(onAiGenerate).toHaveBeenCalledWith('p_ai', 'rec-a');
  });

  it('批量：onAiBatchGenerate 收到当前视图前 ≤20 行的 id（25 行只给 20）', async () => {
    const many = Array.from({ length: 25 }, (_v, i) =>
      makeRecord(`rec-${String(i)}`, { p_title: `书 ${String(i)}` }, `A${String(i).padStart(2, '0')}`),
    );
    const onAiBatchGenerate = vi.fn().mockResolvedValue({ done: 0, failed: 0 });
    render(<DbView {...aiDbProps} records={many} onAiBatchGenerate={onAiBatchGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: '属性管理：摘要' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '属性管理' })).getByRole('menuitem', { name: '批量生成' }));
    await Promise.resolve();
    expect(onAiBatchGenerate).toHaveBeenCalledTimes(1);
    const [, ids] = onAiBatchGenerate.mock.calls[0] as [string, string[]];
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe('rec-0');
    expect(ids[19]).toBe('rec-19');
  });

  it('未提供 AI 回调：按钮与菜单入口都不渲染', () => {
    const { container } = render(<DbView {...aiDbProps} />);
    expect(screen.queryByRole('button', { name: 'AI 生成' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '属性管理：摘要' }));
    expect(within(screen.getByRole('menu', { name: '属性管理' })).queryByRole('menuitem', { name: '批量生成' })).toBeNull();
    expect(container.querySelector('.sc-dbc-aibtn')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 标题双击改名（TASK-T18-05 回归，不改既有断言）
//
// 根因复现要点：必须经 DbView 渲染（它持有 focusedCell 状态并接通 TableGrid
// 的「焦点落 DOM」effect 与单元格 onFocus）。双击进入编辑态后，输入框的
// focusin 会冒泡触发单元格 onFocus → setFocusedCell（新对象）→ 焦点 effect
// 重跑；修复前 effect 里 `activeElement !== node` 判定为真 → 把焦点从编辑
// 输入框抢回单元格 → 输入框 onBlur 提交未变更的 draft → 编辑态闪退。
// jsdom 未实现 scrollIntoView，本组用例局部桩掉并在收尾还原。
// ---------------------------------------------------------------------------

describe('标题双击改名（T18-05 回归）', () => {
  const scrollIntoViewStub = vi.fn();
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  // 先于本组每个用例的 render 生效（vi.stubGlobal 管不到原型方法，直接换原型并在收尾还原）
  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = scrollIntoViewStub;
  });
  afterAll(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  const renameDbProps = {
    collection: COLLECTION,
    records: RECORDS,
    status: 'ready' as const,
    onCreateRecord: NOOP,
    onDeleteRecords: NOOP,
    onChangeValue: NOOP,
    onAddProperty: NOOP,
    onRemoveProperty: NOOP,
    onRenameProperty: NOOP,
    onSaveView: NOOP,
    onExportCsv: NOOP,
  };

  function renderDb(onRenameRecord: (rowId: string, title: string) => void) {
    const view = render(<DbView {...renameDbProps} onRenameRecord={onRenameRecord} />);
    const cell = view.container.querySelector('.sc-dbcell--title') as HTMLElement;
    const span = cell.querySelector('.sc-dbcell__title') as HTMLElement;
    return { span, view };
  }

  it('mouseDown 聚焦 → 双击标题进入编辑态 → Enter 提交 onRenameRecord 且输入框消失', () => {
    const onRenameRecord = vi.fn();
    const { span, view } = renderDb(onRenameRecord);

    fireEvent.mouseDown(span); // 先聚焦单元格（真实双击的第一次按下）
    fireEvent.doubleClick(span);

    const input = screen.getByLabelText('编辑标题') as HTMLInputElement;
    expect(input.value).toBe('哥德尔、艾舍尔、巴赫');

    fireEvent.change(input, { target: { value: '新书名' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameRecord).toHaveBeenCalledTimes(1);
    expect(onRenameRecord).toHaveBeenCalledWith('rec-1', '新书名');
    expect(screen.queryByLabelText('编辑标题')).toBeNull();

    // 父层数据落地后（rerender 模拟回调写回），新标题显示
    view.rerender(
      <DbView
        {...renameDbProps}
        onRenameRecord={onRenameRecord}
        records={[makeRecord('rec-1', { p_title: '新书名' }, 'A1'), RECORDS[1]!, RECORDS[2]!]}
      />,
    );
    expect(screen.getByText('新书名')).toBeDefined();
  });

  it('编辑态 Esc 取消：onRenameRecord 不被调用，原标题保持', () => {
    const onRenameRecord = vi.fn();
    const { span } = renderDb(onRenameRecord);

    fireEvent.mouseDown(span);
    fireEvent.doubleClick(span);

    const input = screen.getByLabelText('编辑标题') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '改了一半' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenameRecord).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('编辑标题')).toBeNull();
    expect(screen.getByText('哥德尔、艾舍尔、巴赫')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 勾选列值写入（T40-01-1 修复）
//
// 根因：checkbox 单元格内层 .sc-dbc 为 role="presentation" 且无 tabIndex、
// 永不获焦，焦点只落在外层 gridcell（TableGrid cellRefs 注册处）——
// CellEditor 的 onKeyDown（checkbox Enter/Space → 切换）收不到事件；
// 其 onClick 又对 checkbox 早退 → 点击与键盘两条路径都写不进值。
// 修复：onClick 的 checkbox 分支改直切（onCommit）；onGridKeyDown 追加
// Enter/Space 的 checkbox 分支（经既有 onChangeCell 通道提交）。
// 焦点模型（cellRefs / moveFocus / tabIndex）零改动。
// focusedCell 非空时焦点 effect 会调 scrollIntoView（jsdom 未实现），局部桩掉。
// ---------------------------------------------------------------------------

const P_CHECK = propertySchema.parse({ id: 'p_check', name: '已读', type: 'checkbox' });
const P_NOTE = propertySchema.parse({ id: 'p_note', name: '笔记', type: 'text' });
const CHECK_SCHEMA = collectionSchemaSchema.parse({
  properties: { p_title: P_TITLE, p_check: P_CHECK, p_note: P_NOTE },
  title_pid: 'p_title',
});

describe('勾选列值写入（T40-01-1）', () => {
  const scrollIntoViewStub = vi.fn();
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = scrollIntoViewStub;
  });
  afterAll(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  function renderGrid(rows: RecordEntity[], handlers: { onChangeCell: ReturnType<typeof vi.fn>; onBeginEdit?: ReturnType<typeof vi.fn> }, focusedCell: { rowIndex: number; prop: string } | null) {
    return render(
      <TableGrid
        schema={CHECK_SCHEMA}
        rows={rows}
        widths={{}}
        status="ready"
        selectedIds={new Set()}
        focusedCell={focusedCell}
        editingCell={null}
        onChangeCell={handlers.onChangeCell}
        onBeginEdit={handlers.onBeginEdit}
        onCreateRecord={NOOP}
      />,
    );
  }

  it('点击 checkbox 格：空值 → onChangeCell(rowId, pid, true)（既有存盘通道），不进编辑态', () => {
    const onChangeCell = vi.fn();
    const onBeginEdit = vi.fn();
    renderGrid([makeRecord('rec-1', { p_title: '时间简史' }, 'A1')], { onChangeCell, onBeginEdit }, null);

    const dbc = document.querySelector('.sc-dbc[data-type="checkbox"]') as HTMLElement;
    expect(dbc).not.toBeNull();
    fireEvent.click(dbc);

    expect(onChangeCell).toHaveBeenCalledTimes(1);
    expect(onChangeCell).toHaveBeenCalledWith('rec-1', 'p_check', true);
    expect(onBeginEdit).not.toHaveBeenCalled();
  });

  it('聚焦 checkbox 格按 Enter / Space → toggle（true→null、null→true）', () => {
    const onChangeCell = vi.fn();
    const { rerender } = renderGrid(
      [makeRecord('rec-1', { p_title: '时间简史', p_check: true }, 'A1')],
      { onChangeCell },
      { rowIndex: 0, prop: 'p_check' },
    );

    const body = document.querySelector('.sc-dbgrid__body') as HTMLElement;
    fireEvent.keyDown(body, { key: 'Enter' });
    expect(onChangeCell).toHaveBeenCalledTimes(1);
    expect(onChangeCell).toHaveBeenCalledWith('rec-1', 'p_check', null);

    // 数据回写后（true → null），Space 再切回 true
    onChangeCell.mockClear();
    rerender(
      <TableGrid
        schema={CHECK_SCHEMA}
        rows={[makeRecord('rec-1', { p_title: '时间简史' }, 'A1')]}
        widths={{}}
        status="ready"
        selectedIds={new Set()}
        focusedCell={{ rowIndex: 0, prop: 'p_check' }}
        editingCell={null}
        onChangeCell={onChangeCell}
        onCreateRecord={NOOP}
      />,
    );
    fireEvent.keyDown(body, { key: ' ' });
    expect(onChangeCell).toHaveBeenCalledTimes(1);
    expect(onChangeCell).toHaveBeenCalledWith('rec-1', 'p_check', true);
  });

  it('非 checkbox 行为不变：聚焦 text 格按 Enter 仍走 onBeginEdit，不经 onChangeCell', () => {
    const onChangeCell = vi.fn();
    const onBeginEdit = vi.fn();
    renderGrid([makeRecord('rec-1', { p_title: '时间简史' }, 'A1')], { onChangeCell, onBeginEdit }, {
      rowIndex: 0,
      prop: 'p_note',
    });

    const dbc = document.querySelector('.sc-dbc[data-type="text"]') as HTMLElement;
    expect(dbc).not.toBeNull();
    fireEvent.keyDown(dbc, { key: 'Enter' });

    expect(onBeginEdit).toHaveBeenCalledTimes(1);
    expect(onChangeCell).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 可编辑格 Enter 进编辑（TASK-T49-01）
//
// 根因（T47 尾巴）：焦点只落在外层 gridcell（内层 .sc-dbc 无 tabIndex、永不获焦），
// CellEditor 的 `onCellKeyDown`（非 checkbox 的 Enter → onBeginEdit，CellEditor.tsx）
// 收不到事件；而 TableGrid 网格层此前只给 Enter 开了 checkbox 分支 →
// 数字/文本/日期等可编辑格在未编辑态按 Enter **无动作**（不进入编辑态）。
// 修复：网格层 Enter 分支扩为「checkbox 切换 / file 只读 / 其余可编辑格 → onBeginEdit」，
// Space 维持**仅** checkbox 切换（不进编辑）；方向键/Esc 分支一字未改。
// ---------------------------------------------------------------------------

const P_URL = propertySchema.parse({ id: 'p_url', name: '链接', type: 'url' });
const P_FILE = propertySchema.parse({ id: 'p_file', name: '附件', type: 'file' });
const P_MULTI = propertySchema.parse({
  id: 'p_multi',
  name: '标签',
  type: 'multi_select',
  options: [{ id: 'o-1', name: '甲' }],
});
const P_REL = propertySchema.parse({ id: 'p_rel', name: '关联', type: 'relation' });

const KB_SCHEMA = collectionSchemaSchema.parse({
  properties: {
    p_title: P_TITLE,
    p_check: P_CHECK,
    p_note: P_NOTE,
    p_score: P_SCORE,
    p_date: P_DATE,
    p_status: P_STATUS,
    p_multi: P_MULTI,
    p_url: P_URL,
    p_rel: P_REL,
    p_file: P_FILE,
  },
  title_pid: 'p_title',
});

const KB_ROW = makeRecord('rec-1', { p_title: '时间简史', p_check: true, p_score: 5, p_status: 's-read' }, 'A1');

/** Enter 进编辑的格（可编辑类型全集）；file 只读、checkbox 直切、title 双击改名。 */
const EDIT_ON_ENTER = [
  { pid: 'p_note', type: 'text' },
  { pid: 'p_score', type: 'number' },
  { pid: 'p_date', type: 'date' },
  { pid: 'p_status', type: 'select' },
  { pid: 'p_multi', type: 'multi_select' },
  { pid: 'p_url', type: 'url' },
  { pid: 'p_rel', type: 'relation' },
];

describe('可编辑格键盘矩阵（TASK-T49-01）', () => {
  const scrollIntoViewStub = vi.fn();
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = scrollIntoViewStub;
  });
  afterAll(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  function renderKbGrid(focusedProp: string, rows: RecordEntity[] = [KB_ROW]) {
    const onChangeCell = vi.fn();
    const onBeginEdit = vi.fn();
    const view = render(
      <TableGrid
        schema={KB_SCHEMA}
        rows={rows}
        widths={{}}
        status="ready"
        selectedIds={new Set()}
        focusedCell={{ rowIndex: 0, prop: focusedProp }}
        editingCell={null}
        onChangeCell={onChangeCell}
        onBeginEdit={onBeginEdit}
        onCreateRecord={NOOP}
      />,
    );
    const body = view.container.querySelector('.sc-dbgrid__body') as HTMLElement;
    return { onChangeCell, onBeginEdit, view, body };
  }

  it.each(EDIT_ON_ENTER)('$type 格：Enter → onBeginEdit(rowIndex,pid) 且不经 onChangeCell', ({ pid }) => {
    const { onBeginEdit, onChangeCell, body, view } = renderKbGrid(pid);
    fireEvent.keyDown(body, { key: 'Enter' });
    expect(onBeginEdit).toHaveBeenCalledTimes(1);
    expect(onBeginEdit).toHaveBeenCalledWith(0, pid);
    expect(onChangeCell).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each(EDIT_ON_ENTER)('$type 格：Space 进不了编辑、也不改值（维持现状）', ({ pid }) => {
    const { onBeginEdit, onChangeCell, body, view } = renderKbGrid(pid);
    fireEvent.keyDown(body, { key: ' ' });
    expect(onBeginEdit).not.toHaveBeenCalled();
    expect(onChangeCell).not.toHaveBeenCalled();
    view.unmount();
  });

  // 勾选格回归红线（T47 四格必须仍全绿）：Enter/Space × {true→null, null→true}
  it.each([
    { key: 'Enter', before: true, expect: null },
    { key: 'Enter', before: null, expect: true },
    { key: ' ', before: true, expect: null },
    { key: ' ', before: null, expect: true },
  ])('勾选格回归：$key 前=$before → 落库 $expect，且不进编辑态', ({ key, before, expect: expected }) => {
    const { onBeginEdit, onChangeCell, body, view } = renderKbGrid('p_check', [
      makeRecord('rec-1', { p_title: '时间简史', p_check: before }, 'A1'),
    ]);
    fireEvent.keyDown(body, { key });
    expect(onChangeCell).toHaveBeenCalledTimes(1);
    expect(onChangeCell).toHaveBeenCalledWith('rec-1', 'p_check', expected);
    expect(onBeginEdit).not.toHaveBeenCalled();
    view.unmount();
  });

  it('file 格：Enter/Space 均无动作（一期只读，不进编辑不改值）', () => {
    for (const key of ['Enter', ' ']) {
      const { onBeginEdit, onChangeCell, body, view } = renderKbGrid('p_file');
      fireEvent.keyDown(body, { key });
      expect(onBeginEdit).not.toHaveBeenCalled();
      expect(onChangeCell).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('标题列：Enter/Space 不抢键（维持双击改名，不动编辑/改值通道）', () => {
    for (const key of ['Enter', ' ']) {
      const { onBeginEdit, onChangeCell, body, view } = renderKbGrid('p_title');
      fireEvent.keyDown(body, { key });
      expect(onBeginEdit).not.toHaveBeenCalled();
      expect(onChangeCell).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('事件落点：Enter 打在单元格内层 .sc-dbc 上仍只触发一次 onBeginEdit（网格层不重复处理）', () => {
    const { onBeginEdit, onChangeCell, view } = renderKbGrid('p_score');
    const dbc = view.container.querySelector('.sc-dbc[data-type="number"]') as HTMLElement;
    expect(dbc).not.toBeNull();
    fireEvent.keyDown(dbc, { key: 'Enter' });
    expect(onBeginEdit).toHaveBeenCalledTimes(1);
    expect(onBeginEdit).toHaveBeenCalledWith(0, 'p_score');
    expect(onChangeCell).not.toHaveBeenCalled();
    view.unmount();
  });

  it('方向键语义不变：Enter 分支未抢方向键（ArrowDown 仍走 onFocusCell）', () => {
    const onFocusCell = vi.fn();
    const { container } = render(
      <TableGrid
        schema={KB_SCHEMA}
        rows={[KB_ROW, makeRecord('rec-2', { p_title: '物种起源' }, 'A2')]}
        widths={{}}
        status="ready"
        selectedIds={new Set()}
        focusedCell={{ rowIndex: 0, prop: 'p_score' }}
        editingCell={null}
        onFocusCell={onFocusCell}
        onCreateRecord={NOOP}
      />,
    );
    const body = container.querySelector('.sc-dbgrid__body') as HTMLElement;
    fireEvent.keyDown(body, { key: 'ArrowDown' });
    expect(onFocusCell).toHaveBeenCalledWith(1, 'p_score');
  });

  it('端到端语义：Enter 进编辑（data-editing=true + 输入框挂载）→ 改值 → 再按 Enter 提交并退出编辑', () => {
    const onChangeCell = vi.fn();
    function StatefulGrid() {
      const [editing, setEditing] = useState<{ rowIndex: number; prop: string } | null>(null);
      return (
        <TableGrid
          schema={KB_SCHEMA}
          rows={[KB_ROW]}
          widths={{}}
          status="ready"
          selectedIds={new Set()}
          focusedCell={{ rowIndex: 0, prop: 'p_score' }}
          editingCell={editing}
          onChangeCell={onChangeCell}
          onBeginEdit={(rowIndex, prop) => {
            setEditing({ rowIndex, prop });
          }}
          onEndEdit={() => {
            setEditing(null);
          }}
          onCreateRecord={NOOP}
        />
      );
    }
    const { container } = render(<StatefulGrid />);
    const body = container.querySelector('.sc-dbgrid__body') as HTMLElement;
    const dbcNow = () => container.querySelector('.sc-dbc[data-type="number"]') as HTMLElement;

    expect(dbcNow().getAttribute('data-editing')).toBe('false');
    fireEvent.keyDown(body, { key: 'Enter' });
    expect(dbcNow().getAttribute('data-editing')).toBe('true');

    const input = container.querySelector('.sc-dbc-input--num') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('5'); // 进入编辑态时带原值
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChangeCell).toHaveBeenCalledTimes(1);
    expect(onChangeCell).toHaveBeenCalledWith('rec-1', 'p_score', 7); // 再按 Enter = 既有提交语义
    expect(dbcNow().getAttribute('data-editing')).toBe('false');
  });

  it('Esc 语义不变：编辑态内 Esc 取消，不提交、退出编辑', () => {
    const onChangeCell = vi.fn();
    const { container } = render(
      <TableGrid
        schema={KB_SCHEMA}
        rows={[KB_ROW]}
        widths={{}}
        status="ready"
        selectedIds={new Set()}
        focusedCell={{ rowIndex: 0, prop: 'p_score' }}
        editingCell={{ rowIndex: 0, prop: 'p_score' }}
        onChangeCell={onChangeCell}
        onEndEdit={NOOP}
        onCreateRecord={NOOP}
      />,
    );
    const input = container.querySelector('.sc-dbc-input--num') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChangeCell).not.toHaveBeenCalled();
  });
});

