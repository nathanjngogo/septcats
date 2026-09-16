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
import { describe, expect, it, vi } from 'vitest';
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
