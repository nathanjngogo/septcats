/**
 * TodoPage.tsx —— 待办一级页面（T98-01 · 子 Agent C 完整实现）。
 *
 * 数据来源：`window.septcats.todo`（preload 暴露；契约见 src/shared/todo.ts）。
 * 主进程不可用（`window.septcats` 缺失、方法缺失、或 promise reject）时**不得崩**：
 * 渲染空态（todo-empty）并把错误摆成一行提示（errorText 按 E_* 码出文案）。
 *
 * 结构契约（docs/PRD-日历与待办.md §3.2，探针按此取元素，不许改）：
 *   · 根 data-testid="todo-page"、列表 data-testid="todo-list"（恒在，可为空）
 *   · 条目 data-testid="todo-item-<id>"，带 data-done="0|1"（勾选立即翻转，不刷新页面）
 *   · 空态 data-testid="todo-empty"
 *   · 快速添加 data-testid="todo-input"（受控 input）+ data-testid="todo-add"（回车同效）
 *   · data-testid="todo-clear-done"（清除已完成）
 *   · 每行完成开关 data-testid="todo-toggle-done"（行内原生 input[type=checkbox]，走 ui Checkbox）
 *
 * 纪律：只用 var(--sc-*) token；文案一律 t('todo.*')（已存在的键，本文件不新增字典）；
 * 图标只从 @septcats/ui 出口取（不成 emoji）。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Checkbox, IconButton, Plus, Trash } from '@septcats/ui';
import { errorText, t } from '../i18n';
import type {
  TodoCreateInput,
  TodoItem,
  TodoItemResult,
  TodoListResult,
  TodoOkResult,
  TodoPriority,
  TodoUpdateInput,
} from '../../../shared/todo';
import { TODO_CHANGED_EVENT } from './TodoSidePanel';
import './TodoPage.css';

/** renderer 侧的最小访问面（主进程未接线时 undefined）。 */
interface TodoApi {
  list(input: { includeDone?: boolean }): Promise<TodoListResult>;
  create(input: TodoCreateInput): Promise<TodoItemResult>;
  update(input: TodoUpdateInput): Promise<TodoItemResult>;
  setDone(input: { id: string; done: boolean }): Promise<TodoItemResult>;
  remove(input: { id: string }): Promise<TodoOkResult>;
}

function todoApi(): TodoApi | undefined {
  const api = (window as unknown as { septcats?: { todo?: Partial<TodoApi> } }).septcats?.todo;
  return api !== undefined && typeof api.list === 'function' ? (api as TodoApi) : undefined;
}

/** 写操作后广播（二级栏 TodoSidePanel 监听后重拉未完成项；不新增通道/依赖）。 */
export function notifyTodoChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(TODO_CHANGED_EVENT));
  } catch {
    /* 非浏览器环境（极端兜底）：忽略 */
  }
}

/** 列表序（与主进程同口径）：未完成在前 → dueAt 升序（null 视为无穷）→ createdAt → id。 */
export function sortTodoItems(items: readonly TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) {
      return a.done ? 1 : -1;
    }
    const aDue = a.dueAt ?? Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) {
      return aDue < bDue ? -1 : 1;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -1 : 1;
    }
    return a.id < b.id ? -1 : 1;
  });
}

/** epoch ms → `<input type="date">` 的本地 YYYY-MM-DD（无截止 → 空串）。 */
export function dueDateValue(dueAt: number | null): string {
  if (dueAt === null) {
    return '';
  }
  const date = new Date(dueAt);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

/** `<input type="date">` 的 YYYY-MM-DD → 本地零点 epoch ms（空串/非法 → null = 无截止）。 */
export function dueAtFromValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

export function TodoPage(): ReactNode {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [showDone, setShowDone] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 编辑态去重：Enter 提交后紧随的 blur 不再二次提交。 */
  const editedRef = useRef(false);

  const upsert = useCallback((item: TodoItem): void => {
    setItems((prev) => sortTodoItems([...prev.filter((it) => it.id !== item.id), item]));
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const api = todoApi();
    if (api === undefined) {
      setItems([]);
      return;
    }
    try {
      const res = await api.list({ includeDone: true });
      setItems(sortTodoItems(res.items));
      setError(null);
    } catch (err) {
      setItems([]);
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ------------------------------------------------------------------ 写操作

  const addTodo = useCallback(async (): Promise<void> => {
    const title = draft.trim();
    if (title.length === 0) {
      return;
    }
    const api = todoApi();
    if (api === undefined) {
      return;
    }
    try {
      const res = await api.create({ title });
      upsert(res.item);
      setDraft('');
      setError(null);
      notifyTodoChanged();
    } catch (err) {
      // 失败保留草稿（用户不必重打）；主进程的 E_TITLE_REQUIRED 等码经 errorText 出文案
      setError(errorText(err));
    }
  }, [draft, upsert]);

  /** 勾选/取消完成：先乐观翻转（行 data-done 立即变），再以主进程返回行对账。 */
  const toggleDone = useCallback(
    async (item: TodoItem): Promise<void> => {
      const next = !item.done;
      upsert({ ...item, done: next });
      notifyTodoChanged();
      const api = todoApi();
      if (api === undefined) {
        return;
      }
      try {
        const res = await api.setDone({ id: item.id, done: next });
        upsert(res.item);
        notifyTodoChanged();
      } catch (err) {
        upsert(item); // 回滚
        setError(errorText(err));
        notifyTodoChanged();
      }
    },
    [upsert],
  );

  const patchItem = useCallback(
    async (item: TodoItem, patch: TodoUpdateInput['patch']): Promise<void> => {
      const api = todoApi();
      if (api === undefined) {
        return;
      }
      try {
        const res = await api.update({ id: item.id, patch });
        upsert(res.item);
        notifyTodoChanged();
      } catch (err) {
        setError(errorText(err));
      }
    },
    [upsert],
  );

  const beginEdit = useCallback((item: TodoItem): void => {
    editedRef.current = false;
    setEditingId(item.id);
    setEditingTitle(item.title);
  }, []);

  const commitTitle = useCallback(
    async (item: TodoItem): Promise<void> => {
      if (editedRef.current) {
        return;
      }
      editedRef.current = true;
      const title = editingTitle.trim();
      setEditingId(null);
      if (title.length === 0 || title === item.title) {
        return;
      }
      await patchItem(item, { title });
    },
    [editingTitle, patchItem],
  );

  const removeTodo = useCallback(
    async (item: TodoItem): Promise<void> => {
      const api = todoApi();
      if (api === undefined) {
        return;
      }
      try {
        await api.remove({ id: item.id });
        setItems((prev) => prev.filter((it) => it.id !== item.id));
        notifyTodoChanged();
      } catch (err) {
        setError(errorText(err));
      }
    },
    [],
  );

  /** 清除已完成：通道层无批量删，逐条 remove（并发即可，主进程各自事务）。 */
  const clearDone = useCallback(async (): Promise<void> => {
    const api = todoApi();
    if (api === undefined) {
      return;
    }
    const targets = items.filter((it) => it.done);
    if (targets.length === 0) {
      return;
    }
    try {
      await Promise.all(targets.map((it) => api.remove({ id: it.id })));
      const gone = new Set(targets.map((it) => it.id));
      setItems((prev) => prev.filter((it) => !gone.has(it.id)));
      notifyTodoChanged();
    } catch (err) {
      setError(errorText(err));
      void reload(); // 部分成功：以库为准重拉
    }
  }, [items, reload]);

  // ------------------------------------------------------------------ 渲染

  const visible = items.filter((it) => showDone || !it.done);
  const openCount = items.filter((it) => !it.done).length;
  const doneCount = items.length - openCount;

  return (
    <div className="todo-page" data-testid="todo-page">
      <header className="todo-head">
        <h1 className="todo-head__title">{t('todo.title')}</h1>
        <span className="todo-head__count" data-testid="todo-count">
          {String(openCount)}
          {t('todo.itemSuffix')}
        </span>
      </header>

      <div className="todo-addbar">
        <input
          className="todo-addbar__input"
          data-testid="todo-input"
          type="text"
          value={draft}
          placeholder={t('todo.inputPlaceholder')}
          aria-label={t('todo.inputPlaceholder')}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void addTodo();
            }
          }}
        />
        <Button
          className="todo-addbar__btn"
          data-testid="todo-add"
          variant="secondary"
          icon={Plus}
          disabled={draft.trim().length === 0}
          onClick={() => {
            void addTodo();
          }}
        >
          {t('todo.add')}
        </Button>
      </div>

      <div className="todo-tools">
        <button
          type="button"
          className="todo-tools__btn"
          data-testid="todo-show-done"
          aria-pressed={showDone}
          onClick={() => {
            setShowDone((prev) => !prev);
          }}
        >
          {showDone ? t('todo.hideDone') : t('todo.showDone')}
        </button>
        <button
          type="button"
          className="todo-tools__btn"
          data-testid="todo-clear-done"
          disabled={doneCount === 0}
          onClick={() => {
            void clearDone();
          }}
        >
          {t('todo.clearDone')}
        </button>
      </div>

      {error === null ? null : (
        <p className="todo-error" data-testid="todo-error" role="alert">
          {error}
        </p>
      )}

      <ul className="todo-list" data-testid="todo-list">
        {visible.map((it) => (
          <li
            key={it.id}
            className={it.done ? 'todo-item todo-item--done' : 'todo-item'}
            data-testid={`todo-item-${it.id}`}
            data-done={it.done ? '1' : '0'}
          >
            <Checkbox
              className="todo-item__check"
              data-testid="todo-toggle-done"
              checked={it.done}
              aria-label={it.done ? t('todo.markUndone') : t('todo.markDone')}
              onChange={() => {
                void toggleDone(it);
              }}
            />
            {editingId === it.id ? (
              <input
                className="todo-item__edit"
                data-testid={`todo-edit-${it.id}`}
                type="text"
                value={editingTitle}
                aria-label={t('todo.title')}
                autoFocus
                onChange={(event) => {
                  setEditingTitle(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void commitTitle(it);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    editedRef.current = true;
                    setEditingId(null);
                  }
                }}
                onBlur={() => {
                  void commitTitle(it);
                }}
              />
            ) : (
              <button
                type="button"
                className="todo-item__title"
                data-testid={`todo-title-${it.id}`}
                onClick={() => {
                  beginEdit(it);
                }}
              >
                {it.title}
              </button>
            )}
            <span className={`todo-item__dot todo-item__dot--${it.priority}`} aria-hidden="true" />
            <span className="todo-item__duetag">{t('todo.due')}</span>
            <input
              className="todo-item__due"
              data-testid={`todo-due-${it.id}`}
              type="date"
              value={dueDateValue(it.dueAt)}
              aria-label={t('todo.due')}
              onChange={(event) => {
                void patchItem(it, { dueAt: dueAtFromValue(event.target.value) });
              }}
            />
            <select
              className={`todo-item__pri todo-item__pri--${it.priority}`}
              data-testid={`todo-pri-${it.id}`}
              value={it.priority}
              aria-label={t('todo.priority')}
              onChange={(event) => {
                void patchItem(it, { priority: event.target.value as TodoPriority });
              }}
            >
              <option value="high">{t('todo.high')}</option>
              <option value="mid">{t('todo.mid')}</option>
              <option value="low">{t('todo.low')}</option>
            </select>
            <IconButton
              className="todo-item__del"
              data-testid={`todo-remove-${it.id}`}
              icon={Trash}
              label={t('todo.remove')}
              onClick={() => {
                void removeTodo(it);
              }}
            />
          </li>
        ))}
      </ul>

      {visible.length === 0 ? (
        <p className="todo-empty" data-testid="todo-empty">
          {t('todo.empty')} · {t('todo.emptyHint')}
        </p>
      ) : null}
    </div>
  );
}

export default TodoPage;