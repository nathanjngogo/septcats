/**
 * TodoSidePanel.tsx —— 待办的二级栏（T98-01 · 子 Agent C 完整实现）。
 *
 * 口径：只列**未完成**项（`todo:list {includeDone:false}`，主进程已按
 * 未完成在前 / dueAt 升序返回；此处再按 done 兜底过滤 + 截断 12 条），
 * 每行带优先级色点（high/mid/low）。
 *
 * 与主区联动：TodoPage 每次写操作后派发 `TODO_CHANGED_EVENT`（本文件导出），
 * 本面板监听即重拉——不新增 IPC 通道、不引新依赖。
 *
 * 结构契约（PRD §3.2）：根 data-testid="todo-side"、条目
 * data-testid="todo-side-item-<id>"、空态 data-testid="todo-side-empty"。
 * 主进程不可用（window.septcats 缺失 / reject）→ 空态，不崩。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import type { TodoItem, TodoListResult } from '../../../shared/todo';
import './TodoSidePanel.css';

/** 待办变更广播名（主区 TodoPage 派发，本面板监听）。 */
export const TODO_CHANGED_EVENT = 'septcats:todo-changed';

/** 二级栏一次最多列出的条数（面板窄，超出的进主区看）。 */
const SIDE_LIMIT = 12;

interface TodoApi {
  list(input: { includeDone?: boolean }): Promise<TodoListResult>;
}

function todoApi(): TodoApi | undefined {
  const api = (window as unknown as { septcats?: { todo?: Partial<TodoApi> } }).septcats?.todo;
  return api !== undefined && typeof api.list === 'function' ? (api as TodoApi) : undefined;
}

export function TodoSidePanel(): ReactNode {
  const [items, setItems] = useState<TodoItem[]>([]);

  const load = useCallback(async (): Promise<void> => {
    const api = todoApi();
    if (api === undefined) {
      setItems([]);
      return;
    }
    try {
      const res = await api.list({ includeDone: false });
      setItems(
        res.items
          .filter((it) => !it.done)
          .slice(0, SIDE_LIMIT),
      );
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const onChanged = (): void => {
      void load();
    };
    window.addEventListener(TODO_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(TODO_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  return (
    <div className="todo-side" data-testid="todo-side">
      <div className="todo-side-head">
        <span className="todo-side-head__title">{t('todo.sideTitle')}</span>
        <span className="todo-side-head__count">
          {String(items.length)}
          {t('todo.itemSuffix')}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="todo-side-empty" data-testid="todo-side-empty">
          {t('todo.sideEmpty')}
        </p>
      ) : (
        <ul className="todo-side-list">
          {items.map((it) => (
            <li key={it.id} className="todo-side-item" data-testid={`todo-side-item-${it.id}`}>
              <span
                className={`todo-side-item__dot todo-side-item__dot--${it.priority}`}
                aria-hidden="true"
              />
              <span className="todo-side-item__text">{it.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TodoSidePanel;