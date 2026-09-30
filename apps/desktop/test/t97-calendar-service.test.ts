/**
 * t97-calendar-service.test.ts —— 日历服务（src/main/calendar.ts）单测（TASK-T97-01）。
 *
 * 走真实 better-sqlite3（迁移跑到 v11 建 calendar_event），白名单转发经 DbServerCore。
 * 覆盖：区间过滤（含头不含尾的交叠语义）、排序、create 缺省与 trim、
 * 校验失败码（E_TITLE_REQUIRED / E_END_BEFORE_START / E_MALFORMED / E_NOT_FOUND）、
 * 部分 patch 只改指定字段、allDay 往返、remove 后不可见。
 */
import { expect, it } from 'vitest';
import { applyPragmaBaseline, migrate, type SqliteConstructor } from '../src/db/migrations';
import { createDbServerCore } from '../src/db/server';
import { CalendarApiError, createCalendarService, type CalendarService } from '../src/main/calendar';
import { coreExecutor, describeDb, makeTempDb } from './helpers';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const BASE = 1_700_000_000_000; // 2023-11-14T22:13:20Z

interface Harness {
  service: CalendarService;
  cleanup(): void;
}

async function harness(ctor: SqliteConstructor): Promise<Harness> {
  const temp = makeTempDb('cal-svc');
  const db = new ctor(temp.path);
  applyPragmaBaseline(db);
  await migrate(db);
  const service = createCalendarService({ executor: coreExecutor(createDbServerCore(db)), now: () => NOW });
  return { service, cleanup: () => { db.close(); temp.cleanup(); } };
}

/** 断言拒绝并返回错误码（服务层用 CalendarApiError 携带码）。 */
function codeOf(error: unknown): string {
  return error instanceof CalendarApiError ? error.code : `?${String(error)}`;
}

describeDb('T97-01 日历服务', (ctor) => {
  it('create 缺省：endAt = startAt、allDay=false、note 空、时间戳走注入时钟、标题 trim', async () => {
    const h = await harness(ctor);
    try {
      const ev = await h.service.create({ title: '  对齐方案  ', startAt: BASE });
      expect(ev.title).toBe('对齐方案');
      expect(typeof ev.id).toBe('string');
      expect(ev.id.length).toBeGreaterThan(8);
      expect(ev.startAt).toBe(BASE);
      expect(ev.endAt).toBe(BASE);
      expect(ev.allDay).toBe(false);
      expect(ev.note).toBe('');
      expect(ev.createdAt).toBe(NOW);
      expect(ev.updatedAt).toBe(NOW);
    } finally { h.cleanup(); }
  });

  it('list 区间（含头不含尾的交叠）：只回与 [from,to) 有交叠的事件，按 startAt 升序', async () => {
    const h = await harness(ctor);
    try {
      const early = await h.service.create({ title: '早', startAt: BASE - 10 * DAY, endAt: BASE - 10 * DAY + HOUR });
      const mid = await h.service.create({ title: '中', startAt: BASE, endAt: BASE + HOUR });
      const late = await h.service.create({ title: '晚', startAt: BASE + 10 * DAY, endAt: BASE + 10 * DAY + HOUR });
      const res = await h.service.list({ from: BASE - DAY, to: BASE + DAY });
      expect(res.events.map((e) => e.id)).toEqual([mid.id]);
      const wide = await h.service.list({ from: BASE - 30 * DAY, to: BASE + 30 * DAY });
      expect(wide.events.map((e) => e.title)).toEqual(['早', '中', '晚']);
      expect(wide.events.map((e) => e.id)).toContain(early.id);
      expect(wide.events.map((e) => e.id)).toContain(late.id);
    } finally { h.cleanup(); }
  });

  it('update 部分 patch：只动指定字段，其余原样（endAt 不随 startAt 联动）', async () => {
    const h = await harness(ctor);
    try {
      const ev = await h.service.create({ title: '原标题', startAt: BASE, endAt: BASE + 7200_000, note: '备注' });
      const renamed = await h.service.update({ id: ev.id, patch: { title: '新标题' } });
      expect(renamed.title).toBe('新标题');
      expect(renamed.startAt).toBe(ev.startAt);
      expect(renamed.endAt).toBe(ev.endAt);
      expect(renamed.note).toBe('备注');
      expect(renamed.createdAt).toBe(ev.createdAt);
      expect(renamed.updatedAt).toBe(NOW);
      const moved = await h.service.update({ id: ev.id, patch: { startAt: BASE + HOUR } });
      expect(moved.startAt).toBe(BASE + HOUR);
      expect(moved.endAt).toBe(ev.endAt);
      // 不变量：把 startAt 推到 endAt 之后必须被拒（不是静默写出 endAt < startAt）
      await expect(
        h.service.update({ id: ev.id, patch: { startAt: BASE + 3 * HOUR } }),
      ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'E_END_BEFORE_START');
    } finally { h.cleanup(); }
  });

  it('allDay 往返 + remove 后不可见（再 update 抛 E_NOT_FOUND）', async () => {
    const h = await harness(ctor);
    try {
      const ev = await h.service.create({ title: '生日', startAt: BASE, allDay: true });
      expect(ev.allDay).toBe(true);
      const listed = await h.service.list({ from: BASE - DAY, to: BASE + DAY });
      expect(listed.events[0]?.allDay).toBe(true);
      await h.service.remove({ id: ev.id });
      const after = await h.service.list({ from: BASE - DAY, to: BASE + DAY });
      expect(after.events).toEqual([]);
      await expect(h.service.update({ id: ev.id, patch: { title: 'x' } })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_NOT_FOUND',
      );
      await expect(h.service.remove({ id: ev.id })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_NOT_FOUND',
      );
    } finally { h.cleanup(); }
  });

  it('校验失败码：空标题 / 结束早于开始 / 区间与字段类型非法', async () => {
    const h = await harness(ctor);
    try {
      await expect(h.service.create({ title: '   ', startAt: BASE })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_TITLE_REQUIRED',
      );
      await expect(h.service.create({ title: 'x', startAt: BASE, endAt: BASE - 1 })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_END_BEFORE_START',
      );
      await expect(h.service.update({ id: 'nope', patch: { endAt: 1, startAt: 9 } })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_NOT_FOUND',
      );
      await expect(h.service.list({ from: BASE, to: BASE })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_MALFORMED',
      );
      await expect(h.service.list({ from: BASE, to: BASE - 1 })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_MALFORMED',
      );
      await expect(h.service.create({ title: 'x', startAt: Number.NaN })).rejects.toSatisfy(
        (e: unknown) => codeOf(e) === 'E_MALFORMED',
      );
    } finally { h.cleanup(); }
  });

  it('范围边界：恰好贴区间两端的事件（交叠语义 = startAt < to 且 endAt >= from）', async () => {
    const h = await harness(ctor);
    try {
      // 结束 = from：算交叠（>= from）
      const touching = await h.service.create({ title: '贴左', startAt: BASE - HOUR, endAt: BASE });
      const res = await h.service.list({ from: BASE, to: BASE + DAY });
      expect(res.events.map((e) => e.id)).toContain(touching.id);
      // 开始 = to：不算交叠（< to 为假）
      const atEnd = await h.service.create({ title: '贴右', startAt: BASE + DAY, endAt: BASE + DAY + HOUR });
      const res2 = await h.service.list({ from: BASE, to: BASE + DAY });
      expect(res2.events.map((e) => e.id)).not.toContain(atEnd.id);
    } finally { h.cleanup(); }
  });
});