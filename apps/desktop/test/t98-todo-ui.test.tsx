// @vitest-environment jsdom
/**
 * t98-todo-ui.test.tsx —— 待办渲染层（T98-01 · 子 Agent C）。
 *
 * 覆盖（PRD《PRD-日历与待办.md》§3.2 结构契约 + §5 渲染层要求）：
 * - 空态与主进程不可用（window.septcats 缺失 / list reject）不崩；
 * - 加载列表：未完成在前、data-done 正确、行内文本含标题原文；
 * - 快速添加：受控 input 回车 / 「添加」按钮两条路径都落 create({title})；
 * - 勾选完成 / 取消完成：setDone 且行 data-done 立即翻转（乐观，不刷新页面）+ 完成态类名；
 * - 编辑标题（点标题 → 行内 input → Enter → update{patch:{title}}）；
 * - 优先级（high/mid/low）与截止日期（可空）→ update{patch:{priority|dueAt}}；
 * - 删除单条 → remove({id})；「清除已完成」逐条 remove；
 * - 「显示/隐藏已完成」开关（默认显示）；
 * - 二级栏 TodoSidePanel：只列未完成项（含优先级色点）、空态、变更广播后刷新。
 *
 * 纪律：window.septcats 用 vi.stubGlobal 假桥（templates-ui.test.tsx 同范式）；
 * 断言落在假桥调用与 DOM 结构，不依赖主进程。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/renderer/src/i18n';
import { TodoPage } from '../src/renderer/src/todo/TodoPage';
import { TodoSidePanel } from '../src/renderer/src/todo/TodoSidePanel';
import type { TodoCreateInput, TodoItem, TodoUpdateInput } from '../src/shared/todo';

interface TodoBridge {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  setDone: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

let db: TodoItem[];
let seq: number;
let bridge: TodoBridge;

function todoItem(overrides: Partial<TodoItem> & Pick<TodoItem, 'id'>): TodoItem {
  return {
    title: overrides.id,
    done: false,
    dueAt: null,
    priority: 'mid',
    note: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** 假桥：内存 db 驱动（list 的 includeDone 语义与主进程一致）。 */
function installTodo(): TodoBridge {
  seq = 0;
  const list = vi.fn(async (input: { includeDone?: boolean } = {}) => ({
    items: (input.includeDone === true ? db : db.filter((it) => !it.done)).map((it) => ({ ...it })),
  }));
  const create = vi.fn(async (input: TodoCreateInput) => {
    seq += 1;
    const item = todoItem({
      id: `td-${String(seq)}`,
      title: input.title,
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? 'mid',
      createdAt: 100 + seq,
    });
    db.push(item);
    return { item: { ...item } };
  });
  const update = vi.fn(async (input: TodoUpdateInput) => {
    const current = db.find((it) => it.id === input.id);
    if (current === undefined) {
      throw new Error('E_NOT_FOUND: 待办不存在');
    }
    const merged: TodoItem = { ...current, ...input.patch };
    db = db.map((it) => (it.id === merged.id ? merged : it));
    return { item: { ...merged } };
  });
  const setDone = vi.fn(async (input: { id: string; done: boolean }) => {
    const current = db.find((it) => it.id === input.id);
    if (current === undefined) {
      throw new Error('E_NOT_FOUND: 待办不存在');
    }
    const merged: TodoItem = { ...current, done: input.done };
    db = db.map((it) => (it.id === merged.id ? merged : it));
    return { item: { ...merged } };
  });
  const remove = vi.fn(async (input: { id: string }) => {
    db = db.filter((it) => it.id !== input.id);
    return { ok: true as const };
  });
  bridge = { list, create, update, setDone, remove };
  vi.stubGlobal('septcats', { todo: { list, create, update, setDone, remove } });
  return bridge;
}

/** 主进程不可用：window.septcats 整块缺失。 */
function installNoBridge(): void {
  vi.stubGlobal('septcats', undefined);
}

beforeEach(() => {
  db = [
    todoItem({ id: 'td-a', title: '写周报', priority: 'high', dueAt: new Date(2026, 9, 1).getTime(), createdAt: 2 }),
    todoItem({ id: 'td-b', title: '买牛奶', createdAt: 1 }),
    todoItem({ id: 'td-c', title: '旧待办', done: true, createdAt: 3 }),
  ];
  installTodo();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 契约与空态
// ---------------------------------------------------------------------------

describe('待办页 · 结构契约与空态（PRD §3.2）', () => {
  it('消费的 i18n 键全部存在（缺键 t() 会回落键名本身）', () => {
    const keys = [
      'todo.title',
      'todo.inputPlaceholder',
      'todo.add',
      'todo.empty',
      'todo.emptyHint',
      'todo.markDone',
      'todo.markUndone',
      'todo.due',
      'todo.priority',
      'todo.high',
      'todo.mid',
      'todo.low',
      'todo.remove',
      'todo.clearDone',
      'todo.showDone',
      'todo.hideDone',
      'todo.sideTitle',
      'todo.sideEmpty',
      'todo.itemSuffix',
    ];
    for (const key of keys) {
      expect(t(key), `缺键：${key}`).not.toBe(key);
    }
  });

  it('主进程不可用（window.septcats 缺失）：渲染根 + 列表 + 空态，不崩', async () => {
    installNoBridge();
    render(<TodoPage />);
    expect(screen.getByTestId('todo-page')).toBeDefined();
    expect(screen.getByTestId('todo-list').children).toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId('todo-empty')).toBeDefined());
    expect(screen.getByTestId('todo-empty').textContent).toContain(t('todo.empty'));
  });

  it('list reject（E_DB_UNAVAILABLE）：空态 + 不崩', async () => {
    bridge.list.mockRejectedValueOnce(new Error('E_DB_UNAVAILABLE: 库里没有待办表'));
    render(<TodoPage />);
    await waitFor(() => expect(screen.getByTestId('todo-empty')).toBeDefined());
    expect(screen.getByTestId('todo-empty')).toBeDefined();
  });

  it('空库：列表恒在但无条目，空态可见', async () => {
    db = [];
    render(<TodoPage />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalledWith({ includeDone: true }));
    expect(screen.getByTestId('todo-list').children).toHaveLength(0);
    expect(screen.getByTestId('todo-empty')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 列表渲染
// ---------------------------------------------------------------------------

describe('待办页 · 列表渲染', () => {
  it('未完成在前、完成在后；data-done 与标题原文正确', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-a');
    expect(screen.getByTestId('todo-item-td-a').getAttribute('data-done')).toBe('0');
    expect(screen.getByTestId('todo-item-td-b').getAttribute('data-done')).toBe('0');
    expect(screen.getByTestId('todo-item-td-c').getAttribute('data-done')).toBe('1');
    // 行内文本含标题原文（探针 ④）
    expect(screen.getByTestId('todo-item-td-a').textContent).toContain('写周报');
    expect(screen.getByTestId('todo-item-td-c').textContent).toContain('旧待办');
    // 未完成在前 + dueAt 升序：td-a（有截止）在 td-b（无截止）之前，td-c（已完成）最后
    const ids = [...screen.getByTestId('todo-list').children].map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['todo-item-td-a', 'todo-item-td-b', 'todo-item-td-c']);
  });

  it('完成态：行带 todo-item--done（划线 + 淡化走 CSS）', async () => {
    render(<TodoPage />);
    const done = await screen.findByTestId('todo-item-td-c');
    expect(done.className).toContain('todo-item--done');
    expect(screen.getByTestId('todo-item-td-a').className).not.toContain('todo-item--done');
  });

  it('优先级与截止日期：select / date input 初值来自条目', async () => {
    render(<TodoPage />);
    const pri = (await screen.findByTestId('todo-pri-td-a')) as HTMLSelectElement;
    expect(pri.value).toBe('high');
    const due = (await screen.findByTestId('todo-due-td-a')) as HTMLInputElement;
    expect(due.value).toBe('2026-10-01'); // 本地 YYYY-MM-DD
    expect((screen.getByTestId('todo-due-td-b') as HTMLInputElement).value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 快速添加
// ---------------------------------------------------------------------------

describe('待办页 · 快速添加（受控 input + 回车/按钮）', () => {
  it('回车提交：create({title}) → 新行出现且含标题原文、输入框清空', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-a');
    const input = screen.getByTestId('todo-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  新的一条  ' } });
    expect(input.value).toBe('  新的一条  ');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(bridge.create).toHaveBeenCalledWith({ title: '新的一条' }));
    const row = await screen.findByTestId('todo-item-td-1');
    expect(row.textContent).toContain('新的一条');
    expect(row.getAttribute('data-done')).toBe('0');
    expect((screen.getByTestId('todo-input') as HTMLInputElement).value).toBe('');
  });

  it('按钮提交：等价于回车（todo-add）', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-a');
    fireEvent.change(screen.getByTestId('todo-input'), { target: { value: '第二条' } });
    fireEvent.click(screen.getByTestId('todo-add'));
    await waitFor(() => expect(bridge.create).toHaveBeenCalledWith({ title: '第二条' }));
    expect((await screen.findByTestId('todo-item-td-1')).textContent).toContain('第二条');
  });

  it('探针口径：原生 value setter + input 事件驱动受控输入 → 添加成功', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-a');
    const input = screen.getByTestId('todo-input') as HTMLInputElement;
    // React 受控输入：先经原型 setter 直写，再派发 input 事件（真机探针同法）
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    expect(setter).toBeDefined();
    setter?.call(input, '探针输入');
    fireEvent.input(input, { target: { value: '探针输入' } });
    expect(input.value).toBe('探针输入');
    fireEvent.click(screen.getByTestId('todo-add'));
    await waitFor(() => expect(bridge.create).toHaveBeenCalledWith({ title: '探针输入' }));
  });

  it('空白输入：按钮禁用、不调 create', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-a');
    expect((screen.getByTestId('todo-add') as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByTestId('todo-input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('todo-add'));
    expect(bridge.create).not.toHaveBeenCalled();
    expect(screen.getByTestId('todo-list').children).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 勾选 / 编辑 / 优先级 / 截止 / 删除
// ---------------------------------------------------------------------------

describe('待办页 · 行内操作', () => {
  it('勾选完成：行内 checkbox → setDone({done:true}) 且 data-done 立即变 "1"', async () => {
    render(<TodoPage />);
    const row = await screen.findByTestId('todo-item-td-a');
    const box = within(row).getByTestId('todo-toggle-done') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    // 乐观更新：不等 IPC 回来，行即刻翻成完成态
    expect(screen.getByTestId('todo-item-td-a').getAttribute('data-done')).toBe('1');
    expect(screen.getByTestId('todo-item-td-a').className).toContain('todo-item--done');
    await waitFor(() => expect(bridge.setDone).toHaveBeenCalledWith({ id: 'td-a', done: true }));
  });

  it('取消完成：再点一次 → setDone({done:false}) 且 data-done 回 "0"', async () => {
    render(<TodoPage />);
    const doneRow = await screen.findByTestId('todo-item-td-c');
    fireEvent.click(within(doneRow).getByTestId('todo-toggle-done'));
    expect(screen.getByTestId('todo-item-td-c').getAttribute('data-done')).toBe('0');
    await waitFor(() => expect(bridge.setDone).toHaveBeenCalledWith({ id: 'td-c', done: false }));
  });

  it('setDone 失败：回滚 data-done 并出错误行', async () => {
    render(<TodoPage />);
    const row = await screen.findByTestId('todo-item-td-b');
    bridge.setDone.mockRejectedValueOnce(new Error('E_NOT_FOUND: 条目不存在'));
    fireEvent.click(within(row).getByTestId('todo-toggle-done'));
    await waitFor(() => expect(screen.getByTestId('todo-item-td-b').getAttribute('data-done')).toBe('0'));
    expect(screen.getByTestId('todo-error')).toBeDefined();
  });

  it('编辑标题：点标题 → 行内 input → Enter 提交 update{patch:{title}}', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-a');
    fireEvent.click(screen.getByTestId('todo-title-td-a'));
    const editor = (await screen.findByTestId('todo-edit-td-a')) as HTMLInputElement;
    expect(editor.value).toBe('写周报');
    fireEvent.change(editor, { target: { value: '写月报' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith({ id: 'td-a', patch: { title: '写月报' } }));
    await waitFor(() => expect(screen.getByTestId('todo-item-td-a').textContent).toContain('写月报'));
  });

  it('编辑标题：Escape 取消，不发 update', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-a');
    fireEvent.click(screen.getByTestId('todo-title-td-a'));
    const editor = await screen.findByTestId('todo-edit-td-a');
    fireEvent.change(editor, { target: { value: '不要保存' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('todo-edit-td-a')).toBeNull());
    expect(bridge.update).not.toHaveBeenCalled();
    expect(screen.getByTestId('todo-item-td-a').textContent).toContain('写周报');
  });

  it('优先级：改 select → update{patch:{priority}}', async () => {
    render(<TodoPage />);
    const select = await screen.findByTestId('todo-pri-td-b');
    fireEvent.change(select, { target: { value: 'low' } });
    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith({ id: 'td-b', patch: { priority: 'low' } }));
    expect((screen.getByTestId('todo-pri-td-b') as HTMLSelectElement).value).toBe('low');
  });

  it('截止日期：选日期 → update{patch:{dueAt}}（本地零点）；清空 → dueAt:null', async () => {
    render(<TodoPage />);
    const due = await screen.findByTestId('todo-due-td-b');
    fireEvent.change(due, { target: { value: '2026-10-01' } });
    await waitFor(() =>
      expect(bridge.update).toHaveBeenCalledWith({ id: 'td-b', patch: { dueAt: new Date(2026, 9, 1).getTime() } }),
    );
    fireEvent.change(screen.getByTestId('todo-due-td-b'), { target: { value: '' } });
    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith({ id: 'td-b', patch: { dueAt: null } }));
  });

  it('删除单条：remove({id}) → 行消失', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-b');
    fireEvent.click(screen.getByTestId('todo-remove-td-b'));
    await waitFor(() => expect(bridge.remove).toHaveBeenCalledWith({ id: 'td-b' }));
    await waitFor(() => expect(screen.queryByTestId('todo-item-td-b')).toBeNull());
    expect(screen.getByTestId('todo-item-td-a')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 工具行：显示/隐藏已完成 + 清除已完成
// ---------------------------------------------------------------------------

describe('待办页 · 工具行', () => {
  it('默认显示已完成；点「显示/隐藏已完成」后完成行从列表消失（再点回来）', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-c');
    const toggle = screen.getByTestId('todo-show-done');
    expect(toggle.textContent).toContain(t('todo.hideDone'));
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByTestId('todo-item-td-c')).toBeNull());
    expect(screen.getByTestId('todo-item-td-a')).toBeDefined();
    expect(screen.getByTestId('todo-show-done').textContent).toContain(t('todo.showDone'));
    fireEvent.click(screen.getByTestId('todo-show-done'));
    expect(await screen.findByTestId('todo-item-td-c')).toBeDefined();
  });

  it('清除已完成：二次确认（首次点击只上膛不删，再次点击才逐条 remove）', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-c');
    const btn = screen.getByTestId('todo-clear-done');
    fireEvent.click(btn);
    // 上膛：**不得删**（不可撤销的批量删除防误触），文案换成带条数的确认语
    expect(bridge.remove).not.toHaveBeenCalled();
    await waitFor(() => expect(btn.textContent).toContain(t('todo.confirmClear')));
    expect(btn.textContent).toContain(String(1));

    fireEvent.click(btn);
    await waitFor(() => expect(bridge.remove).toHaveBeenCalledWith({ id: 'td-c' }));
    expect(bridge.remove).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('todo-item-td-c')).toBeNull());
    expect(screen.getByTestId('todo-item-td-a')).toBeDefined();
    expect((screen.getByTestId('todo-clear-done') as HTMLButtonElement).disabled).toBe(true);
  });

  it('清除已完成的「上膛」可退出：失焦回到原文案，且不误删', async () => {
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-c');
    const btn = screen.getByTestId('todo-clear-done');
    fireEvent.click(btn);
    fireEvent.blur(btn);
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(btn.textContent).toContain(t('todo.clearDone'));
  });

  it('隐藏已完成后仅剩完成项 → 空态出现（列表仍在）', async () => {
    db = [todoItem({ id: 'td-only', title: '只剩完成', done: true })];
    render(<TodoPage />);
    await screen.findByTestId('todo-item-td-only');
    fireEvent.click(screen.getByTestId('todo-show-done'));
    await waitFor(() => expect(screen.getByTestId('todo-empty')).toBeDefined());
    expect(screen.getByTestId('todo-list').children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 二级栏
// ---------------------------------------------------------------------------

describe('待办二级栏 · TodoSidePanel', () => {
  it('只列未完成项（含优先级色点），完成项不出现', async () => {
    render(<TodoSidePanel />);
    expect(screen.getByTestId('todo-side')).toBeDefined();
    await screen.findByTestId('todo-side-item-td-a');
    expect(bridge.list).toHaveBeenCalledWith({ includeDone: false });
    expect(screen.getByTestId('todo-side-item-td-a').textContent).toContain('写周报');
    expect(screen.getByTestId('todo-side-item-td-b').textContent).toContain('买牛奶');
    expect(screen.queryByTestId('todo-side-item-td-c')).toBeNull();
    // 优先级色点：high 行走 danger 档类名（视觉见 TodoSidePanel.css）
    expect(
      screen.getByTestId('todo-side-item-td-a').querySelector('.todo-side-item__dot--high'),
    ).not.toBeNull();
    expect(
      screen.getByTestId('todo-side-item-td-b').querySelector('.todo-side-item__dot--mid'),
    ).not.toBeNull();
  });

  it('无可列项：空态 todo-side-empty', async () => {
    db = [todoItem({ id: 'td-c', title: '旧待办', done: true })];
    render(<TodoSidePanel />);
    await waitFor(() => expect(screen.getByTestId('todo-side-empty')).toBeDefined());
    expect(screen.getByTestId('todo-side-empty').textContent).toBe(t('todo.sideEmpty'));
  });

  it('主进程不可用 / list reject：空态不崩', async () => {
    installNoBridge();
    render(<TodoSidePanel />);
    await waitFor(() => expect(screen.getByTestId('todo-side-empty')).toBeDefined());
    cleanup();
    installTodo();
    bridge.list.mockRejectedValueOnce(new Error('E_DB_UNAVAILABLE: 库里没有待办表'));
    render(<TodoSidePanel />);
    await waitFor(() => expect(screen.getByTestId('todo-side-empty')).toBeDefined());
  });

  it('主区写操作广播后自动重拉（新增可见、勾选后移出）', async () => {
    render(
      <>
        <TodoPage />
        <TodoSidePanel />
      </>,
    );
    await screen.findByTestId('todo-side-item-td-a');
    fireEvent.change(screen.getByTestId('todo-input'), { target: { value: '面板要看见' } });
    fireEvent.keyDown(screen.getByTestId('todo-input'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('todo-side-item-td-1').textContent).toContain('面板要看见'));

    // 勾选完成 → 该行移出二级栏
    const row = screen.getByTestId('todo-item-td-1');
    fireEvent.click(within(row).getByTestId('todo-toggle-done'));
    await waitFor(() => expect(screen.queryByTestId('todo-side-item-td-1')).toBeNull());
  });
});