/**
 * helpers.ts —— 日历渲染层的**纯工具与桥访问口**（T97-01，B 角色）。
 *
 * 为什么单独一层：CalendarPage 与 CalendarSidePanel 都要「本地日期键 / 月份 6×7 网格 /
 * HH:MM 归一 / 取 window.septcats.calendar」这几件事，且页面改动后二级栏要能刷新。
 * 把这层抽出来，两个组件各自只留渲染与交互，避免互相 import（页面 ↔ 二级栏不成环）。
 *
 * 契约来源：src/shared/calendar.ts（冻结面，不改）；时间一律 epoch ms（number）。
 * 本文件不产生外部请求、不碰主进程实现，只在渲染层做本地计算。
 */
import type {
  CalendarEvent,
  CalendarEventResult,
  CalendarListResult,
  CalendarOkResult,
} from '../../../shared/calendar';

/** 一天的毫秒数（本地日历按天分格，不做 UTC 归并）。 */
export const DAY = 86_400_000;

/** 网格固定 6 行 × 7 列（恒 42 格），切月时高度不跳动。 */
export const GRID_CELLS = 42;

/** 单个日格最多直接展示的日程条数（超出折叠为 “+N”）。 */
export const MAX_CHIPS = 3;

/** preload 暴露面（`window.septcats.calendar`）；主进程不可用时为 undefined。 */
export interface CalendarApi {
  list(input: { from: number; to: number }): Promise<CalendarListResult>;
  create(input: {
    title: string;
    startAt: number;
    endAt?: number;
    allDay?: boolean;
    note?: string;
  }): Promise<CalendarEventResult>;
  update(input: {
    id: string;
    patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>>;
  }): Promise<CalendarEventResult>;
  remove(input: { id: string }): Promise<CalendarOkResult>;
}

/** 取主进程桥；jsdom / DB 未就绪时返回 undefined（调用方一律据此走空态）。 */
export function calendarApi(): CalendarApi | undefined {
  return (window as unknown as { septcats?: { calendar?: CalendarApi } }).septcats?.calendar;
}

/** 本地日期键（YYYY-MM-DD）；日历按用户本地日历分格，不做 UTC 归并。 */
export function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${String(d.getFullYear())}-${m}-${day}`;
}

/** HH:MM（本地时区）。 */
export function hm(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** 月份网格：周一开头，含首尾补白（6 行 × 7 列恒等宽，避免切月时高度跳动）。 */
export function monthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // 周一 = 0
  const start = new Date(year, month, 1 - lead);
  return Array.from(
    { length: GRID_CELLS },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

/** 某天 00:00（本地）的 epoch ms。 */
export function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * 日期键 + HH:MM → epoch ms（本地时区解析，不做 UTC 偏移）。
 * time 非法（空串 / 残缺）时按 00:00 处理，保证不会得到 NaN。
 */
export function atTimeMs(dateKey: string, time: string): number {
  const safe = /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
  return new Date(`${dateKey}T${safe}:00`).getTime();
}

/**
 * 日历变更广播：页面侧任何写操作（新建 / 编辑 / 删除）落库成功后广播一次，
 * 二级栏「近 7 天」据此重新拉取（避免两栏各持一份过期快照）。
 */
export const CALENDAR_CHANGED_EVENT = 'septcats:calendar-changed';

export function broadcastCalendarChange(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED_EVENT));
  }
}