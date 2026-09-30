/**
 * CalendarPage.tsx —— 日历一级页面（T97-01，B 角色完整实现）。
 *
 * 老板 09-30 令：「在知识库功能下方增加日历功能」。本页 = 月视图 + 日程 CRUD：
 *   · 月视图：周一开头、6×7 恒 42 格、跨月补白淡化、今天描边高亮；
 *   · 点日格 → 新建日程（标题必填、开始/结束时间、全天开关、备注）；
 *   · 点日程条 → 编辑 / 删除；
 *   · 上 / 下月与「今天」回到本月。
 *
 * 结构契约（冻结面，探针按此取元素，不得改名）：
 *   · 根 data-testid="calendar-page"
 *   · 月份标题 data-testid="calendar-month-label"
 *   · 网格 data-testid="calendar-grid"；每个日格 data-testid="calendar-day-<YYYY-MM-DD>"
 *   · 空态 data-testid="calendar-empty"
 *   · 上/下月/今天 data-testid="calendar-prev" / "calendar-next" / "calendar-today"
 *   · 表单：标题输入 data-testid="calendar-event-title"（受控 input）、
 *     保存 "calendar-event-save"、删除 "calendar-event-delete"、取消 "calendar-event-cancel"
 *   · 日程条元素带 class "calendar-chip"（其文本 = 标题）
 *
 * 主进程不可用（window.septcats 缺失 / promise reject）时一律渲染空态，不崩。
 * 数据一律经 window.septcats.calendar.{list,create,update,remove}（契约见 src/shared/calendar.ts）。
 */
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Button, Dialog, Input } from '@septcats/ui';
import { errorText, t } from '../i18n';
import type { CalendarEvent } from '../../../shared/calendar';
import {
  CALENDAR_CHANGED_EVENT,
  DAY,
  MAX_CHIPS,
  atTimeMs,
  broadcastCalendarChange,
  calendarApi,
  hm,
  localDateKey,
  monthCells,
  startOfDayMs,
} from './helpers';
import './CalendarPage.css';

/** 骨架期已导出的纯函数，向后兼容再导出（外部若按旧路径取用不受影响）。 */
export { localDateKey, monthCells } from './helpers';

const DEFAULT_START = '09:00';
const DEFAULT_END = '10:00';

/** 表单态：一次只开一个（editing = null 表示新建）。 */
interface FormState {
  open: boolean;
  editing: CalendarEvent | null;
  title: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  note: string;
  error: string | null;
  busy: boolean;
}

function initialForm(dateKey: string): FormState {
  return {
    open: false,
    editing: null,
    title: '',
    dateKey,
    startTime: DEFAULT_START,
    endTime: DEFAULT_END,
    allDay: false,
    note: '',
    error: null,
    busy: false,
  };
}

export function CalendarPage(): ReactNode {
  const today = useMemo(() => new Date(), []);
  const todayKey = localDateKey(today);
  const [cursor, setCursor] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [form, setForm] = useState<FormState>(() => initialForm(todayKey));

  const cells = useMemo(() => monthCells(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  const reload = useCallback(async (): Promise<void> => {
    const api = calendarApi();
    if (api === undefined) {
      setEvents([]);
      return;
    }
    const first = cells[0] ?? cursor;
    const last = cells[cells.length - 1] ?? cursor;
    try {
      const res = await api.list({ from: startOfDayMs(first), to: startOfDayMs(last) + DAY });
      setEvents(Array.isArray(res.events) ? res.events : []);
    } catch {
      // 主进程不可用（如 DB 未就绪）：页面照常渲染空态，不阻断
      setEvents([]);
    }
  }, [cells, cursor]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 编辑页刷新：页面写操作落库后二级栏也要重新拉「近 7 天」。 */
  useEffect(() => {
    const onChanged = (): void => {
      void reload();
    };
    window.addEventListener(CALENDAR_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(CALENDAR_CHANGED_EVENT, onChanged);
    };
  }, [reload]);

  /** 每天的事件（按开始时间升序）。 */
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = localDateKey(new Date(ev.startAt));
      const list = map.get(key);
      if (list === undefined) {
        map.set(key, [ev]);
      } else {
        list.push(ev);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startAt - b.startAt);
    }
    return map;
  }, [events]);

  const closeForm = useCallback((): void => {
    setForm((prev) => ({ ...prev, open: false, error: null }));
  }, []);

  /** 点某天（或聚焦日格回车）→ 新建；跨月格顺带把视图切到那个月。 */
  const openCreate = useCallback((day: Date): void => {
    const key = localDateKey(day);
    setCursor((c) =>
      c.getFullYear() === day.getFullYear() && c.getMonth() === day.getMonth()
        ? c
        : new Date(day.getFullYear(), day.getMonth(), 1),
    );
    setForm({ ...initialForm(key), open: true });
  }, []);

  /** 点已有日程 → 编辑（预填全部字段）。 */
  const openEdit = useCallback((ev: CalendarEvent): void => {
    const startAt = new Date(ev.startAt);
    setForm({
      open: true,
      editing: ev,
      title: ev.title,
      dateKey: localDateKey(startAt),
      startTime: ev.allDay ? DEFAULT_START : hm(startAt),
      endTime: ev.allDay ? DEFAULT_END : hm(new Date(ev.endAt)),
      allDay: ev.allDay,
      note: ev.note,
      error: null,
      busy: false,
    });
  }, []);

  const patchForm = useCallback((patch: Partial<FormState>): void => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const save = useCallback(async (): Promise<void> => {
    const trimmed = form.title.trim();
    if (trimmed.length === 0) {
      patchForm({ error: t('calendar.errTitleRequired') });
      return;
    }
    const startAt = form.allDay ? atTimeMs(form.dateKey, '00:00') : atTimeMs(form.dateKey, form.startTime);
    const endAt = form.allDay ? startAt + DAY : atTimeMs(form.dateKey, form.endTime);
    if (endAt < startAt) {
      patchForm({ error: t('calendar.errEndBeforeStart') });
      return;
    }
    const api = calendarApi();
    patchForm({ busy: true, error: null });
    try {
      if (api !== undefined) {
        if (form.editing === null) {
          await api.create({ title: trimmed, startAt, endAt, allDay: form.allDay, note: form.note });
        } else {
          await api.update({
            id: form.editing.id,
            patch: { title: trimmed, startAt, endAt, allDay: form.allDay, note: form.note },
          });
        }
      }
      patchForm({ open: false, busy: false, error: null });
      broadcastCalendarChange();
      await reload();
    } catch (err) {
      patchForm({ busy: false, error: errorText(err) });
    }
  }, [form, patchForm, reload]);

  const removeEvent = useCallback(async (): Promise<void> => {
    const api = calendarApi();
    if (form.editing === null) {
      patchForm({ open: false, error: null });
      return;
    }
    if (api === undefined) {
      patchForm({ open: false, error: null });
      return;
    }
    const id = form.editing.id;
    patchForm({ busy: true, error: null });
    try {
      await api.remove({ id });
      patchForm({ open: false, busy: false, error: null });
      broadcastCalendarChange();
      await reload();
    } catch (err) {
      patchForm({ busy: false, error: errorText(err) });
    }
  }, [form.editing, patchForm, reload]);

  const monthLabel = `${String(cursor.getFullYear())} / ${String(cursor.getMonth() + 1)}`;
  const isEmpty = events.length === 0;

  return (
    <div className="calendar-page" data-testid="calendar-page">
      <header className="calendar-head">
        <h1 className="calendar-title">{t('calendar.title')}</h1>
        <div className="calendar-nav">
          <button
            type="button"
            className="calendar-navbtn"
            data-testid="calendar-prev"
            aria-label={t('calendar.prevMonth')}
            title={t('calendar.prevMonth')}
            onClick={() => {
              setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
            }}
          >
            ‹
          </button>
          <span className="calendar-month" data-testid="calendar-month-label">
            {monthLabel}
          </span>
          <button
            type="button"
            className="calendar-navbtn"
            data-testid="calendar-next"
            aria-label={t('calendar.nextMonth')}
            title={t('calendar.nextMonth')}
            onClick={() => {
              setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
            }}
          >
            ›
          </button>
          <button
            type="button"
            className="calendar-today"
            data-testid="calendar-today"
            onClick={() => {
              setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
            }}
          >
            {t('calendar.today')}
          </button>
        </div>
      </header>

      <div className="calendar-weekdays" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="calendar-wd">
            {t(`calendar.wd${String(i)}`)}
          </span>
        ))}
      </div>

      <div className="calendar-grid" data-testid="calendar-grid" role="grid">
        {cells.map((day) => {
          const key = localDateKey(day);
          const inMonth = day.getMonth() === cursor.getMonth() && day.getFullYear() === cursor.getFullYear();
          const dayEvents = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const classNames = ['calendar-cell'];
          if (!inMonth) classNames.push('calendar-cell--out');
          if (isToday) classNames.push('calendar-cell--today');
          const openThisDay = (): void => {
            openCreate(day);
          };
          return (
            /* 日格整体可点 = 新建；内部日程条各自拦截冒泡走「编辑」。键盘：格子聚焦后回车/空格同样新建。 */
            <div
              key={key}
              role="gridcell"
              tabIndex={0}
              className={classNames.join(' ')}
              data-testid={`calendar-day-${key}`}
              aria-label={key}
              onClick={openThisDay}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openThisDay();
                }
              }}
            >
              <span className="calendar-daynum">{String(day.getDate())}</span>
              {dayEvents.slice(0, MAX_CHIPS).map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className="calendar-chip"
                  data-testid={`calendar-chip-${ev.id}`}
                  title={ev.title}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    openEdit(ev);
                  }}
                >
                  {ev.title}
                </button>
              ))}
              {dayEvents.length > MAX_CHIPS ? (
                <span className="calendar-more">{`+${String(dayEvents.length - MAX_CHIPS)}`}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {isEmpty ? (
        <p className="calendar-empty" data-testid="calendar-empty">
          {`${t('calendar.empty')} · ${t('calendar.emptyHint')}`}
        </p>
      ) : null}

      <Dialog
        open={form.open}
        onClose={closeForm}
        title={t('calendar.newEvent')}
        footer={
          <div className="calendar-form__foot">
            <Button
              variant="destructive"
              size="sm"
              className="calendar-form__delete"
              disabled={form.busy || form.editing === null}
              data-testid="calendar-event-delete"
              onClick={() => {
                void removeEvent();
              }}
            >
              {t('calendar.remove')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={form.busy}
              data-testid="calendar-event-cancel"
              onClick={closeForm}
            >
              {t('calendar.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={form.busy}
              data-testid="calendar-event-save"
              onClick={() => {
                void save();
              }}
            >
              {t('calendar.save')}
            </Button>
          </div>
        }
      >
        <div className="calendar-form" data-testid="calendar-event-form">
          <Input
            label={t('calendar.eventTitle')}
            value={form.title}
            placeholder={t('calendar.eventTitlePlaceholder')}
            data-testid="calendar-event-title"
            onChange={(event) => {
              patchForm({ title: event.target.value });
            }}
          />
          <div className="calendar-row">
            <label className="calendar-field">
              <span className="calendar-field__label">{t('calendar.eventDate')}</span>
              <input
                type="date"
                className="calendar-field__control"
                data-testid="calendar-event-date"
                value={form.dateKey}
                onChange={(event) => {
                  patchForm({ dateKey: event.target.value });
                }}
              />
            </label>
            <label className="calendar-field">
              <span className="calendar-field__label">{t('calendar.eventStart')}</span>
              <input
                type="time"
                className="calendar-field__control"
                data-testid="calendar-event-start"
                value={form.startTime}
                disabled={form.allDay}
                onChange={(event) => {
                  patchForm({ startTime: event.target.value });
                }}
              />
            </label>
            <label className="calendar-field">
              <span className="calendar-field__label">{t('calendar.eventEnd')}</span>
              <input
                type="time"
                className="calendar-field__control"
                data-testid="calendar-event-end"
                value={form.endTime}
                disabled={form.allDay}
                onChange={(event) => {
                  patchForm({ endTime: event.target.value });
                }}
              />
            </label>
          </div>
          <label className="calendar-check">
            <input
              type="checkbox"
              data-testid="calendar-event-allday"
              checked={form.allDay}
              onChange={(event) => {
                patchForm({ allDay: event.target.checked });
              }}
            />
            <span>{t('calendar.allDay')}</span>
          </label>
          <label className="calendar-field">
            <span className="calendar-field__label">{t('calendar.eventNote')}</span>
            <textarea
              className="calendar-field__control calendar-field__control--area"
              data-testid="calendar-event-note"
              value={form.note}
              rows={3}
              onChange={(event) => {
                patchForm({ note: event.target.value });
              }}
            />
          </label>
          {form.error !== null ? (
            <p className="calendar-form__error" role="alert" data-testid="calendar-event-error">
              {form.error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}

export default CalendarPage;