// @vitest-environment jsdom
/**
 * t66-workbench-work.test.ts —— TASK-T66-01 §2.2：工作台数据动作纯函数单测（work.ts）。
 *
 * 覆盖：
 * - 待办 localStorage 最小列表：野 JSON → 空；合法读写往返；addTodo 空文拒绝；
 *   toggle/remove 纯性；
 * - countDbRows：走现成 db.load 通道数 records（alive 过滤）；单页失败 → 该页
 *   undefined（退化不显示行数，绝不让整卡崩）；
 * - createDailyNote：create 后紧跟 rename 落日期标题（注入假桥可测，零新 IPC）；
 * - formatRelativeTime 分档 + greetingPhase 时段；localDateKey 本地格式。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TODOS_STORAGE_KEY,
  addTodo,
  countDbRows,
  createDailyNote,
  formatRelativeTime,
  greetingPhase,
  localDateKey,
  readTodos,
  removeTodo,
  sanitizeTodos,
  toggleTodo,
  writeTodos,
} from '../src/renderer/src/workbench/work';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T66-01 待办（localStorage 最小列表路线）', () => {
  it('野 JSON → 空集；合法读写往返', () => {
    expect(readTodos()).toEqual([]);
    for (const raw of ['not json', '[]', '{"v":2,"items":[]}', '{"v":1,"items":"x"}', '"str"']) {
      window.localStorage.setItem(TODOS_STORAGE_KEY, raw);
      expect(readTodos(), raw).toEqual([]);
    }
    const items = [
      { id: 'a', text: '写周报', done: false },
      { id: 'b', text: '评审', done: true },
    ];
    writeTodos(items);
    expect(readTodos()).toEqual(items);
  });

  it('sanitizeTodos 逐条校验形状 + 去重', () => {
    expect(
      sanitizeTodos({
        v: 1,
        items: [
          { id: 'a', text: 'ok', done: false },
          { id: 'a', text: 'dup', done: true },
          { id: '', text: 'bad-id', done: false },
          { id: 'c', text: 42, done: false },
          { id: 'd', text: 'bad-done' },
          'x',
          null,
        ],
      }),
    ).toEqual([{ id: 'a', text: 'ok', done: false }]);
  });

  it('addTodo：trim 后为空拒绝（null）；toggle/remove 不改入参', () => {
    const base = [{ id: 'a', text: 'x', done: false }];
    expect(addTodo(base, '   ', 1)).toBeNull();
    const added = addTodo(base, ' 新条目 ', 2);
    expect(added).toHaveLength(2);
    expect(added?.[1]?.text).toBe('新条目');
    expect(toggleTodo(base, 'a')).toEqual([{ id: 'a', text: 'x', done: true }]);
    expect(base[0]?.done).toBe(false);
    expect(removeTodo(base, 'a')).toEqual([]);
    expect(base).toHaveLength(1);
  });
});

describe('T66-01 数据库卡行数（现成 db.load 通道）', () => {
  it('数 alive=1 的 records；单页失败 → 该页 undefined（退化不显示行数）', async () => {
    const api = {
      load: vi.fn(async ({ pageId }: { pageId: string }) => {
        if (pageId === 'bad') {
          throw new Error('E_DB_UNAVAILABLE');
        }
        return {
          records: [
            { alive: 1 },
            { alive: 1 },
            { alive: 0 },
          ],
        };
      }),
    };
    const rows = await countDbRows(api, ['db-1', 'bad']);
    expect(rows['db-1']).toBe(2);
    expect(rows['bad']).toBeUndefined();
  });
});

describe('T66-01 每日笔记（create+rename，零新 IPC）', () => {
  it('建页后立刻 rename 成日期标题；返回新页 id', async () => {
    const api = {
      create: vi.fn(async () => ({ id: 'pg-new' })),
      rename: vi.fn(async () => ({ id: 'pg-new' })),
    };
    const now = new Date(2026, 8, 22, 9, 30);
    const id = await createDailyNote(api, (dateKey) => `${dateKey} 日志`, now);
    expect(id).toBe('pg-new');
    expect(api.rename).toHaveBeenCalledWith({ id: 'pg-new', title: '2026-09-22 日志' });
  });

  it('localDateKey = 本地 YYYY-MM-DD（补零）', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('T66-01 相对时间与问候相位', () => {
  const formats = { now: '刚刚', minutes: '{n} 分钟前', hours: '{n} 小时前', days: '{n} 天前' };
  const at = 1_700_000_000_000;
  it('分档：刚刚/分钟/小时/天', () => {
    expect(formatRelativeTime(at, at + 30_000, formats)).toBe('刚刚');
    expect(formatRelativeTime(at, at + 5 * 60_000, formats)).toBe('5 分钟前');
    expect(formatRelativeTime(at, at + 3 * 3_600_000, formats)).toBe('3 小时前');
    expect(formatRelativeTime(at, at + 2 * 86_400_000, formats)).toBe('2 天前');
    expect(formatRelativeTime(at, at - 1000, formats)).toBe('刚刚'); // 未来时间不倒挂
  });
  it('greetingPhase 三档', () => {
    expect(greetingPhase(7)).toBe('morning');
    expect(greetingPhase(13)).toBe('afternoon');
    expect(greetingPhase(21)).toBe('evening');
  });
});
