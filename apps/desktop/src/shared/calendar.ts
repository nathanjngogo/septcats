/**
 * calendar.ts —— 日历功能的**冻结契约**（TASK-T97-01，老板 09-30 令「增加日历功能」）。
 *
 * 分层：类型在这里（main 与 renderer 共同引用）；SQL 与校验在主进程服务里
 * （src/main/calendar.ts）；渲染层只消费 window.septcats.calendar（见 preload）。
 * 时间一律 **epoch 毫秒（number）**——跨进程不做 Date 对象序列化，避免时区歧义。
 *
 * 改动纪律：本文件是 A/B/C 三方并行开发时的接口冻结面，**不许各自改**；
 * 需要变更先在 PRD（docs/PRD-日历与待办.md）里改契约，再统一落。
 */
export interface CalendarEvent {
  /** 主键（uuid，由主进程生成） */
  id: string;
  title: string;
  /** 开始时间（epoch ms） */
  startAt: number;
  /** 结束时间（epoch ms；未给 = 与 startAt 同时长 0） */
  endAt: number;
  /** 全天事件（列表里不显示具体时刻） */
  allDay: boolean;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface CalendarListInput {
  /** 区间（含头不含尾），epoch ms */
  from: number;
  to: number;
}

export interface CalendarListResult {
  events: CalendarEvent[];
}

export interface CalendarCreateInput {
  title: string;
  startAt: number;
  endAt?: number;
  allDay?: boolean;
  note?: string;
}

export interface CalendarUpdateInput {
  id: string;
  patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>>;
}

export interface CalendarRemoveInput {
  id: string;
}

export interface CalendarEventResult {
  event: CalendarEvent;
}

export interface CalendarOkResult {
  ok: true;
}

/** 主进程注册 IPC 时的失败码（renderer 按 code 给双语提示）。 */
export type CalendarErrorCode =
  | 'E_TITLE_REQUIRED'
  | 'E_END_BEFORE_START'
  | 'E_NOT_FOUND'
  | 'E_MALFORMED'
  | 'E_DB_UNAVAILABLE';
