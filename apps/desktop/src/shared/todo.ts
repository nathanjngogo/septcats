/**
 * todo.ts —— 待办功能的**冻结契约**（TASK-T98-01，老板 09-30 令「增加待办功能」）。
 *
 * 同 calendar.ts 口径：类型在此、SQL 与校验在 src/main/todo.ts、渲染层只消费
 * window.septcats.todo。时间一律 epoch 毫秒；`dueAt` 允许 null（无截止）。
 */
export type TodoPriority = 'high' | 'mid' | 'low';

export interface TodoItem {
  id: string;
  title: string;
  done: boolean;
  /** 截止时间（epoch ms）或 null（无截止） */
  dueAt: number | null;
  priority: TodoPriority;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface TodoListInput {
  /** 默认 false：只列未完成（列表页「显示已完成」开关自行传 true） */
  includeDone?: boolean;
}

export interface TodoListResult {
  items: TodoItem[];
}

export interface TodoCreateInput {
  title: string;
  dueAt?: number | null;
  priority?: TodoPriority;
  note?: string;
}

export interface TodoUpdateInput {
  id: string;
  patch: Partial<Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>>;
}

export interface TodoSetDoneInput {
  id: string;
  done: boolean;
}

export interface TodoRemoveInput {
  id: string;
}

export interface TodoItemResult {
  item: TodoItem;
}

export interface TodoOkResult {
  ok: true;
}

export type TodoErrorCode =
  | 'E_TITLE_REQUIRED'
  | 'E_NOT_FOUND'
  | 'E_MALFORMED'
  | 'E_DB_UNAVAILABLE';
