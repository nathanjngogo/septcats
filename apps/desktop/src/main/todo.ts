/**
 * todo.ts —— 待办服务 + IPC 注册（TASK-T98-01，老板 09-30 令：「增加待办功能」）。
 *
 * 分层与纪律同 calendar.ts：类型契约在 src/shared/todo.ts、SQL 白名单在
 * src/db/statements.ts（todo.* 五条）、建表在 src/db/schema.v11.ts（迁移 #11）。
 * 待办同样是**设备本地派生态**：不经 Op 账本、不参与协作与同步。
 *
 * 排序口径（唯一真相在 SQL 里）：未完成在前 → 有截止的在前 → 截止早的在前 → 建得早的在前。
 */
import { randomUUID } from 'node:crypto';
import { TODO_CHANNELS } from '../shared/ipc';
import type {
  TodoCreateInput,
  TodoErrorCode,
  TodoItem,
  TodoListInput,
  TodoListResult,
  TodoOkResult,
  TodoPriority,
  TodoRemoveInput,
  TodoSetDoneInput,
  TodoUpdateInput,
} from '../shared/todo';
import type { DbViewIpcRegistrar } from './dbview';
import type { StatementExecutor } from './pages';

export class TodoApiError extends Error {
  readonly code: TodoErrorCode;

  constructor(code: TodoErrorCode, message: string) {
    super(message);
    this.name = 'TodoApiError';
    this.code = code;
  }
}

const PRIORITIES: readonly TodoPriority[] = ['high', 'mid', 'low'];

interface TodoRow {
  readonly id: string;
  readonly title: string;
  readonly done: number;
  readonly due_at: number | null;
  readonly priority: string;
  readonly note: string;
  readonly created_at: number;
  readonly updated_at: number;
}

/** 行 → 契约对象；未知优先级回落 'mid'（老库/脏数据不炸列表）。 */
function rowToItem(row: Record<string, unknown>): TodoItem {
  const r = row as unknown as TodoRow;
  const priority = PRIORITIES.includes(r.priority as TodoPriority) ? (r.priority as TodoPriority) : 'mid';
  return {
    id: r.id,
    title: r.title,
    done: r.done === 1,
    dueAt: r.due_at === null || r.due_at === undefined ? null : r.due_at,
    priority,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface TodoServiceOptions {
  readonly executor: StatementExecutor;
  readonly now?: () => number;
}

export interface TodoService {
  list(input: TodoListInput): Promise<TodoListResult>;
  create(input: TodoCreateInput): Promise<TodoItem>;
  update(input: TodoUpdateInput): Promise<TodoItem>;
  setDone(input: TodoSetDoneInput): Promise<TodoItem>;
  remove(input: TodoRemoveInput): Promise<TodoOkResult>;
}

function requireTitle(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new TodoApiError('E_TITLE_REQUIRED', '内容不能为空');
  }
  return raw.trim();
}

function optionalDue(raw: unknown): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new TodoApiError('E_MALFORMED', 'dueAt 必须是 epoch 毫秒数字或 null');
  }
  return Math.trunc(raw);
}

function optionalPriority(raw: unknown): TodoPriority | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || !PRIORITIES.includes(raw as TodoPriority)) {
    throw new TodoApiError('E_MALFORMED', 'priority 只能是 high / mid / low');
  }
  return raw as TodoPriority;
}

export function createTodoService(options: TodoServiceOptions): TodoService {
  const { executor } = options;
  const now = options.now ?? ((): number => Date.now());

  async function loadItem(id: string): Promise<TodoItem> {
    const data = await executor.get('todo.get', { id });
    if (data.row === null || data.row === undefined) {
      throw new TodoApiError('E_NOT_FOUND', `待办不存在：${id}`);
    }
    return rowToItem(data.row as Record<string, unknown>);
  }

  async function persist(item: TodoItem, updatedAt: number): Promise<TodoItem> {
    await executor.run('todo.update', {
      id: item.id,
      title: item.title,
      done: item.done ? 1 : 0,
      due_at: item.dueAt,
      priority: item.priority,
      note: item.note,
      updated_at: updatedAt,
    });
    return loadItem(item.id);
  }

  return {
    async list(input: TodoListInput): Promise<TodoListResult> {
      const data = await executor.all('todo.list', { include_done: input.includeDone === true ? 1 : 0 });
      return { items: data.rows.map((row) => rowToItem(row as Record<string, unknown>)) };
    },

    async create(input: TodoCreateInput): Promise<TodoItem> {
      const title = requireTitle(input.title);
      const dueAt = optionalDue(input.dueAt);
      const priority = optionalPriority(input.priority) ?? 'mid';
      const ts = now();
      const id = randomUUID();
      await executor.run('todo.insert', {
        id,
        title,
        done: 0,
        due_at: dueAt,
        priority,
        note: typeof input.note === 'string' ? input.note : '',
        created_at: ts,
        updated_at: ts,
      });
      return loadItem(id);
    },

    async update(input: TodoUpdateInput): Promise<TodoItem> {
      const current = await loadItem(input.id);
      const patch = input.patch;
      const title = patch.title === undefined ? current.title : requireTitle(patch.title);
      const done = patch.done === undefined ? current.done : patch.done === true;
      const dueAt = patch.dueAt === undefined ? current.dueAt : optionalDue(patch.dueAt);
      const priority = patch.priority === undefined ? current.priority : (optionalPriority(patch.priority) ?? current.priority);
      const note = patch.note === undefined
        ? current.note
        : typeof patch.note === 'string'
          ? patch.note
          : (() => {
              throw new TodoApiError('E_MALFORMED', 'note 必须是字符串');
            })();
      return persist({ ...current, title, done, dueAt, priority, note }, now());
    },

    async setDone(input: TodoSetDoneInput): Promise<TodoItem> {
      const current = await loadItem(input.id);
      if (typeof input.done !== 'boolean') {
        throw new TodoApiError('E_MALFORMED', 'done 必须是布尔值');
      }
      return persist({ ...current, done: input.done }, now());
    },

    async remove(input: TodoRemoveInput): Promise<TodoOkResult> {
      await loadItem(input.id);
      await executor.run('todo.delete', { id: input.id });
      return { ok: true };
    },
  };
}

export function toTodoError(error: unknown): { code: string; message: string } {
  if (error instanceof TodoApiError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'E_MALFORMED', message: error.message };
  }
  return { code: 'E_MALFORMED', message: '未知错误' };
}

export function registerTodoIpc(service: TodoService | null, registrar: DbViewIpcRegistrar): void {
  const requireService = (): TodoService => {
    if (service === null) {
      throw new TodoApiError('E_DB_UNAVAILABLE', '数据库服务不可用（启动失败，见日志）');
    }
    return service;
  };

  const fail = (error: unknown): never => {
    const mapped = toTodoError(error);
    throw new Error(`${mapped.code}: ${mapped.message}`);
  };

  const asObject = (raw: unknown): Record<string, unknown> => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new TodoApiError('E_MALFORMED', 'IPC 参数必须是对象');
    }
    return raw as Record<string, unknown>;
  };

  const readId = (input: Record<string, unknown>): string => {
    const id = input.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new TodoApiError('E_MALFORMED', 'id 必填');
    }
    return id;
  };

  const readPatch = (input: Record<string, unknown>): TodoUpdateInput['patch'] => {
    const patch = input.patch;
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new TodoApiError('E_MALFORMED', 'patch 必须是对象');
    }
    return patch as TodoUpdateInput['patch'];
  };

  registrar.handle(TODO_CHANNELS.list, async (raw: unknown): Promise<unknown> => {
    try {
      const input = raw === undefined || raw === null ? {} : asObject(raw);
      return await requireService().list({ includeDone: input.includeDone === true });
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(TODO_CHANNELS.create, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const item = await requireService().create({
        title: input.title as string,
        ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt as number | null }),
        ...(input.priority === undefined ? {} : { priority: input.priority as TodoPriority }),
        ...(input.note === undefined ? {} : { note: input.note as string }),
      });
      return { item };
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(TODO_CHANNELS.update, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const item = await requireService().update({ id: readId(input), patch: readPatch(input) });
      return { item };
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(TODO_CHANNELS.setDone, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const item = await requireService().setDone({ id: readId(input), done: input.done === true });
      return { item };
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(TODO_CHANNELS.remove, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      return await requireService().remove({ id: readId(input) });
    } catch (error) {
      return fail(error);
    }
  });
}
