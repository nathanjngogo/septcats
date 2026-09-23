/**
 * work.ts —— 工作台卡片的数据动作（TASK-T66-01 §1.3/§1.4），全部纯函数 + 假桥可测。
 *
 * - 待办（路线决议 = localStorage 最小列表，理由见报告 §1a）：形状 `{ v:1, items: [{id,text,done}] }`，
 *   键 `septcats.workbenchTodos`；野 JSON/非数组 → 默认空（读写守卫同 state/tabs.ts 范式）。
 * - 数据库卡行数：走现成 `db.load` IPC 取 `records.length`（**不自开新 main IPC 面**，
 *   任务书 §0 口径——现成通道够用：load 返回 alive=1 的 records）。
 * - 每日笔记：`pages.create` 无 title 入参（红线：pages 状态/main 面零改动）→
 *   新建后紧跟 `pages.rename` 落日期标题（两步都在既有 action 语义内，重命名不弹编辑框）。
 */

// ---------------------------------------------------------------------------
// 待办（localStorage 最小列表）
// ---------------------------------------------------------------------------

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export const TODOS_STORAGE_KEY = 'septcats.workbench.todos';
export const TODOS_PERSIST_VERSION = 1;

function safeGetItem(key: string): string | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage === undefined) {
      return null;
    }
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    storage?.setItem(key, value);
  } catch {
    // 写失败（配额/隐私模式）：仅本会话生效
  }
}

function isTodoItem(value: unknown): value is TodoItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as { id?: unknown; text?: unknown; done?: unknown };
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.text === 'string' &&
    typeof item.done === 'boolean'
  );
}

/** 纯函数：野 JSON → 合法待办数组（任何一步不合形状一律回退空集）。 */
export function sanitizeTodos(parsed: unknown): TodoItem[] {
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }
  const record = parsed as { v?: unknown; items?: unknown };
  if (record.v !== TODOS_PERSIST_VERSION || !Array.isArray(record.items)) {
    return [];
  }
  const seen = new Set<string>();
  const items: TodoItem[] = [];
  for (const item of record.items) {
    if (isTodoItem(item) && !seen.has(item.id)) {
      seen.add(item.id);
      items.push({ id: item.id, text: item.text, done: item.done });
    }
  }
  return items;
}

export function readTodos(): TodoItem[] {
  const raw = safeGetItem(TODOS_STORAGE_KEY);
  if (raw === null) {
    return [];
  }
  try {
    return sanitizeTodos(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeTodos(items: readonly TodoItem[]): void {
  safeSetItem(TODOS_STORAGE_KEY, JSON.stringify({ v: TODOS_PERSIST_VERSION, items }));
}

/** 纯函数：新增一条（文本 trim 后为空 → 拒绝，返回同引用由调用方判等）。 */
export function addTodo(items: readonly TodoItem[], text: string, nowMs: number): TodoItem[] | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return [...items, { id: `todo-${String(nowMs)}-${String(items.length)}`, text: trimmed, done: false }];
}

export function toggleTodo(items: readonly TodoItem[], id: string): TodoItem[] {
  return items.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
}

export function removeTodo(items: readonly TodoItem[], id: string): TodoItem[] {
  return items.filter((item) => item.id !== id);
}

// ---------------------------------------------------------------------------
// 数据库行数（现成 db.load 通道）
// ---------------------------------------------------------------------------

export interface DbCountBridge {
  load(input: { pageId: string }): Promise<{ records: readonly { alive: number }[] }>;
}

/**
 * 纯异步：数一组库页的行数。单页失败（回收站竞态/损坏）→ 该页**不显示行数**（undefined），
 * 绝不让整卡崩（任务书 §0 的退化口径在页粒度生效）。
 */
export async function countDbRows(
  api: DbCountBridge,
  pageIds: readonly string[],
): Promise<Record<string, number | undefined>> {
  const out: Record<string, number | undefined> = {};
  await Promise.all(
    pageIds.map(async (id) => {
      try {
        const { records } = await api.load({ pageId: id });
        out[id] = records.filter((record) => record.alive === 1).length;
      } catch {
        out[id] = undefined;
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// 每日笔记（新建页 + rename 落日期标题；两动作都走注入的既有 API 面）
// ---------------------------------------------------------------------------

export interface DailyNoteBridge {
  create(input: { parentId: string | null }): Promise<{ id: string }>;
  rename(input: { id: string; title: string }): Promise<{ id: string }>;
}

/** 本地日期 `YYYY-MM-DD`（零外呼、非 UTC——与 §1.3「模板或新建页标题=YYYY-MM-DD」同口径）。 */
export function localDateKey(now: Date): string {
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 纯异步：建一页并立即改名为 `YYYY-MM-DD 日志`（t 注入 → 组件侧传 i18n 文案）。 */
export async function createDailyNote(
  api: DailyNoteBridge,
  formatTitle: (dateKey: string) => string,
  now: Date,
): Promise<string> {
  const { id } = await api.create({ parentId: null });
  const title = formatTitle(localDateKey(now));
  await api.rename({ id, title });
  return id;
}

// ---------------------------------------------------------------------------
// 相对时间（§1.3 最近卡「标题+相对时间」；本地化文案由调用方 t() 注入）
// ---------------------------------------------------------------------------

export interface RelativeTimeFormats {
  now: string;
  minutes: string;
  hours: string;
  days: string;
}

/** 纯函数：atMs → 「x 分钟前/小时前/天前」（无外呼；≥30 天回绝对日期本地化格式）。 */
export function formatRelativeTime(
  atMs: number,
  nowMs: number,
  formats: RelativeTimeFormats,
): string {
  const deltaMs = Math.max(0, nowMs - atMs);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) {
    return formats.now;
  }
  if (minutes < 60) {
    return formats.minutes.replace('{n}', String(minutes));
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return formats.hours.replace('{n}', String(hours));
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return formats.days.replace('{n}', String(days));
  }
  return new Date(atMs).toLocaleDateString();
}

/** 时段问候相位（§1.3 欢迎条）。 */
export function greetingPhase(hours: number): 'morning' | 'afternoon' | 'evening' {
  if (hours < 12) {
    return 'morning';
  }
  if (hours < 18) {
    return 'afternoon';
  }
  return 'evening';
}
