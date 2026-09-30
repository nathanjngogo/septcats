/**
 * t98-todo-service.test.ts —— 待办服务（src/main/todo.ts）单测（TASK-T98-01）。
 *
 * 走真实 better-sqlite3（迁移跑到 v11 建 todo_item），白名单转发经 DbServerCore。
 * 覆盖：create 缺省（done=false / dueAt=null / priority='mid'）、排序口径
 * （未完成在前 → 有截止的前 → 截止早的前 → 建得早的前）、includeDone 过滤、
 * setDone 快捷路径、部分 patch（含把 dueAt 清成 null）、校验失败码、remove 后不可见、
 * 以及脏优先级回落 'mid'（老库/手改库不炸列表）。
 */
import { expect, it } from 'vitest';
import { applyPragmaBaseline, migrate, type SqliteConstructor } from '../src/db/migrations';
import { createDbServerCore } from '../src/db/server';
import { TodoApiError, createTodoService, type TodoService } from '../src/main/todo';
import { coreExecutor, describeDb, makeTempDb } from './helpers';

const DAY = 86_400_000;
const BASE = 1_700_000_000_000;

interface Harness {
  service: TodoService;
  db: { prepare(sql: string): { run(...params: unknown[]): unknown } };
  cleanup(): void;
}

async function harness(ctor: SqliteConstructor): Promise<Harness> {
  const temp = makeTempDb('todo-svc');
  const db = new ctor(temp.path);
  applyPragmaBaseline(db);
  await migrate(db);
  const service = createTodoService({ executor: coreExecutor(createDbServerCore(db)), now: () => BASE });
  return { service, db, cleanup: () => { db.close(); temp.cleanup(); } };
}

function codeOf(error: unknown): string {
  return error instanceof TodoApiError ? error.code : `?${String(error)}`;
}

describeDb('T98-01 待办服务', (ctor) => {
  it('create 缺省：done=false、dueAt=null、priority=mid、标题 trim、时间戳走注入时钟', async () => {
    const h = await harness(ctor);
    try {
      const item = await h.service.create({ title: '  交周报  ' });
      expect(item.title).toBe('交周报');
      expect(item.done).toBe(false);
      expect(item.dueAt).toBeNull();
      expect(item.priority).toBe('mid');
      expect(item.note).toBe('');
      expect(item.createdAt).toBe(BASE);
      expect(item.updatedAt).toBe(BASE);
      expect(typeof item.id).toBe('string');
    } finally { h.cleanup(); }
  });

  it('排序口径：未完成在前 → 有截止的前（截止早的前）→ 建得早的前；无截止排未完成组末尾', async () => {
    const h = await harness(ctor);
    try {
      const noDue = await h.service.create({ title: '无截止' });
      const dueLate = await h.service.create({ title: '截止晚', dueAt: BASE + 3 * DAY });
      const dueSoon = await h.service.create({ title: '截止早', dueAt: BASE + DAY });
      const doneOne = await h.service.create({ title: '已完成', dueAt: BASE + DAY });
      await h.service.setDone({ id: doneOne.id, done: true });
      const res = await h.service.list({ includeDone: true });
      expect(res.items.map((i) => i.title)).toEqual(['截止早', '截止晚', '无截止', '已完成']);
      const open = await h.service.list({});
      expect(open.items.map((i) => i.title)).toEqual(['截止早', '截止晚', '无截止']);
      expect(open.items.map((i) => i.id)).not.toContain(doneOne.id);
      expect(open.items.map((i) => i.id)).toContain(dueSoon.id);
      expect(open.items.map((i) => i.id)).toContain(dueLate.id);
      expect(open.items.map((i) => i.id)).toContain(noDue.id);
    } finally { h.cleanup(); }
  });

  it('setDone 往返 + update 部分 patch（含把 dueAt 清回 null、优先级校验）', async () => {
    const h = await harness(ctor);
    try {
      const item = await h.service.create({ title: '写方案', dueAt: BASE + DAY, priority: 'high' });
      const done = await h.service.setDone({ id: item.id, done: true });
      expect(done.done).toBe(true);
      const undone = await h.service.setDone({ id: item.id, done: false });
      expect(undone.done).toBe(false);
      expect(undone.createdAt).toBe(item.createdAt);

      const renamed = await h.service.update({ id: item.id, patch: { title: '写方案 v2' } });
      expect(renamed.title).toBe('写方案 v2');
      expect(renamed.dueAt).toBe(item.dueAt);
      expect(renamed.priority).toBe('high');

      const cleared = await h.service.update({ id: item.id, patch: { dueAt: null } });
      expect(cleared.dueAt).toBeNull();

      const lowered = await h.service.update({ id: item.id, patch: { priority: 'low' } });
      expect(lowered.priority).toBe('low');
    } finally { h.cleanup(); }
  });

  it('remove 后不可见（再 setDone 抛 E_NOT_FOUND）', async () => {
    const h = await harness(ctor);
    try {
      const item = await h.service.create({ title: '临时' });
      await h.service.remove({ id: item.id });
      const res = await h.service.list({ includeDone: true });
      expect(res.items).toEqual([]);
      await expect(h.service.setDone({ id: item.id, done: true })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_NOT_FOUND',
      );
    } finally { h.cleanup(); }
  });

  it('校验失败码：空标题 / 非法优先级 / 非法截止 / 不存在的 id', async () => {
    const h = await harness(ctor);
    try {
      await expect(h.service.create({ title: '  ' })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_TITLE_REQUIRED',
      );
      await expect(
        h.service.create({ title: 'x', priority: 'urgent' as never }),
      ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'E_MALFORMED');
      await expect(
        h.service.create({ title: 'x', dueAt: 'tomorrow' as never }),
      ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'E_MALFORMED');
      await expect(h.service.update({ id: 'nope', patch: { title: 'y' } })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_NOT_FOUND',
      );
    } finally { h.cleanup(); }
  });

  it('脏优先级回落 mid（老库/手改库不得炸列表）', async () => {
    const h = await harness(ctor);
    try {
      const item = await h.service.create({ title: '脏数据' });
      h.db.prepare("UPDATE todo_item SET priority = 'urgent' WHERE id = ?").run(item.id);
      const res = await h.service.list({ includeDone: true });
      expect(res.items[0]?.priority).toBe('mid');
    } finally { h.cleanup(); }
  });
});