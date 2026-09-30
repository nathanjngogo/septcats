/**
 * calendar.ts —— 日历服务 + IPC 注册（TASK-T97-01，老板 09-30 令：「增加日历功能」）。
 *
 * 分层：类型契约在 src/shared/calendar.ts，SQL 白名单在 src/db/statements.ts
 * （calendar.* 五条），建表在 src/db/schema.v11.ts（迁移 #11）。本文件只做
 * 「校验 → 落库 → 回读」的薄服务，**不经 Op 账本**（日历是设备本地派生态，
 * 与 page_lock 同口径，不参与协作与同步）。
 *
 * 校验一律在**主进程边界**做（不信任 renderer）：标题必填、结束不早于开始、
 * 字段类型不对 → E_MALFORMED、id 不存在 → E_NOT_FOUND、DB 未就绪 → E_DB_UNAVAILABLE。
 */
import { randomUUID } from 'node:crypto';
import { CALENDAR_CHANNELS } from '../shared/ipc';
import type {
  CalendarCreateInput,
  CalendarErrorCode,
  CalendarEvent,
  CalendarListInput,
  CalendarListResult,
  CalendarOkResult,
  CalendarRemoveInput,
  CalendarUpdateInput,
} from '../shared/calendar';
import type { DbViewIpcRegistrar } from './dbview';
import type { StatementExecutor } from './pages';

export class CalendarApiError extends Error {
  readonly code: CalendarErrorCode;

  constructor(code: CalendarErrorCode, message: string) {
    super(message);
    this.name = 'CalendarApiError';
    this.code = code;
  }
}

interface CalendarRow {
  readonly id: string;
  readonly title: string;
  readonly start_at: number;
  readonly end_at: number;
  readonly all_day: number;
  readonly note: string;
  readonly created_at: number;
  readonly updated_at: number;
}

/** 行 → 契约对象（列名 snake_case → 载荷 camelCase；all_day 0/1 → boolean）。 */
function rowToEvent(row: Record<string, unknown>): CalendarEvent {
  const r = row as unknown as CalendarRow;
  return {
    id: r.id,
    title: r.title,
    startAt: r.start_at,
    endAt: r.end_at,
    allDay: r.all_day === 1,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CalendarServiceOptions {
  readonly executor: StatementExecutor;
  /** 时钟注入（测试用固定时间）。 */
  readonly now?: () => number;
}

export interface CalendarService {
  list(input: CalendarListInput): Promise<CalendarListResult>;
  create(input: CalendarCreateInput): Promise<CalendarEvent>;
  update(input: CalendarUpdateInput): Promise<CalendarEvent>;
  remove(input: CalendarRemoveInput): Promise<CalendarOkResult>;
}

function requireTitle(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new CalendarApiError('E_TITLE_REQUIRED', '标题不能为空');
  }
  return raw.trim();
}

function requireEpoch(raw: unknown, field: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new CalendarApiError('E_MALFORMED', `${field} 必须是 epoch 毫秒数字`);
  }
  return Math.trunc(raw);
}

function optionalEpoch(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  return requireEpoch(raw, field);
}

export function createCalendarService(options: CalendarServiceOptions): CalendarService {
  const { executor } = options;
  const now = options.now ?? ((): number => Date.now());

  async function loadEvent(id: string): Promise<CalendarEvent> {
    const data = await executor.get('calendar.get', { id });
    if (data.row === null || data.row === undefined) {
      throw new CalendarApiError('E_NOT_FOUND', `日程不存在：${id}`);
    }
    return rowToEvent(data.row as Record<string, unknown>);
  }

  return {
    async list(input: CalendarListInput): Promise<CalendarListResult> {
      const from = requireEpoch(input.from, 'from');
      const to = requireEpoch(input.to, 'to');
      if (to <= from) {
        throw new CalendarApiError('E_MALFORMED', '时间区间 to 必须大于 from');
      }
      const data = await executor.all('calendar.list', { from, to });
      return { events: data.rows.map((row) => rowToEvent(row as Record<string, unknown>)) };
    },

    async create(input: CalendarCreateInput): Promise<CalendarEvent> {
      const title = requireTitle(input.title);
      const startAt = requireEpoch(input.startAt, 'startAt');
      const endAt = optionalEpoch(input.endAt, 'endAt') ?? startAt;
      if (endAt < startAt) {
        throw new CalendarApiError('E_END_BEFORE_START', '结束时间不能早于开始时间');
      }
      const ts = now();
      const id = randomUUID();
      await executor.run('calendar.insert', {
        id,
        title,
        start_at: startAt,
        end_at: endAt,
        all_day: input.allDay === true ? 1 : 0,
        note: typeof input.note === 'string' ? input.note : '',
        created_at: ts,
        updated_at: ts,
      });
      return loadEvent(id);
    },

    async update(input: CalendarUpdateInput): Promise<CalendarEvent> {
      const current = await loadEvent(input.id);
      const patch = input.patch;
      const title = patch.title === undefined ? current.title : requireTitle(patch.title);
      const startAt = patch.startAt === undefined ? current.startAt : requireEpoch(patch.startAt, 'startAt');
      const endAt = patch.endAt === undefined ? current.endAt : requireEpoch(patch.endAt, 'endAt');
      if (endAt < startAt) {
        throw new CalendarApiError('E_END_BEFORE_START', '结束时间不能早于开始时间');
      }
      const allDay = patch.allDay === undefined ? current.allDay : patch.allDay === true;
      const note = patch.note === undefined ? current.note : typeof patch.note === 'string' ? patch.note : (() => {
        throw new CalendarApiError('E_MALFORMED', 'note 必须是字符串');
      })();
      await executor.run('calendar.update', {
        id: current.id,
        title,
        start_at: startAt,
        end_at: endAt,
        all_day: allDay ? 1 : 0,
        note,
        updated_at: now(),
      });
      return loadEvent(current.id);
    },

    async remove(input: CalendarRemoveInput): Promise<CalendarOkResult> {
      await loadEvent(input.id);
      await executor.run('calendar.delete', { id: input.id });
      return { ok: true };
    },
  };
}

/** 把服务层错误压成「code: message」字符串（IPC 侧只暴露码与安全文案）。 */
export function toCalendarError(error: unknown): { code: string; message: string } {
  if (error instanceof CalendarApiError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'E_MALFORMED', message: error.message };
  }
  return { code: 'E_MALFORMED', message: '未知错误' };
}

export function registerCalendarIpc(service: CalendarService | null, registrar: DbViewIpcRegistrar): void {
  const requireService = (): CalendarService => {
    if (service === null) {
      throw new CalendarApiError('E_DB_UNAVAILABLE', '数据库服务不可用（启动失败，见日志）');
    }
    return service;
  };

  const fail = (error: unknown): never => {
    const mapped = toCalendarError(error);
    throw new Error(`${mapped.code}: ${mapped.message}`);
  };

  const asObject = (raw: unknown): Record<string, unknown> => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new CalendarApiError('E_MALFORMED', 'IPC 参数必须是对象');
    }
    return raw as Record<string, unknown>;
  };

  registrar.handle(CALENDAR_CHANNELS.list, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      return await requireService().list({
        from: input.from as number,
        to: input.to as number,
      });
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CALENDAR_CHANNELS.create, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const event = await requireService().create({
        title: input.title as string,
        startAt: input.startAt as number,
        ...(input.endAt === undefined ? {} : { endAt: input.endAt as number }),
        ...(input.allDay === undefined ? {} : { allDay: input.allDay as boolean }),
        ...(input.note === undefined ? {} : { note: input.note as string }),
      });
      return { event };
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CALENDAR_CHANNELS.update, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const id = input.id;
      if (typeof id !== 'string' || id.length === 0) {
        throw new CalendarApiError('E_MALFORMED', 'id 必填');
      }
      const patchRaw = input.patch;
      if (typeof patchRaw !== 'object' || patchRaw === null || Array.isArray(patchRaw)) {
        throw new CalendarApiError('E_MALFORMED', 'patch 必须是对象');
      }
      const event = await requireService().update({ id, patch: patchRaw as CalendarUpdateInput['patch'] });
      return { event };
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CALENDAR_CHANNELS.remove, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const id = input.id;
      if (typeof id !== 'string' || id.length === 0) {
        throw new CalendarApiError('E_MALFORMED', 'id 必填');
      }
      return await requireService().remove({ id });
    } catch (error) {
      return fail(error);
    }
  });
}
