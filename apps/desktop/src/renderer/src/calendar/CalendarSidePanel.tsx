/**
 * CalendarSidePanel.tsx —— 日历的二级栏（T97-01，B 角色完整实现）。
 *
 * 口径：列「近 7 天」日程 —— 从今天 00:00 起、未来 7×24 小时内开始的事件，按开始时间升序。
 * 数据经 window.septcats.calendar.list（契约见 src/shared/calendar.ts）；
 * 页面侧任何写操作会广播 CALENDAR_CHANGED_EVENT，本栏据此重新拉取（避免过期快照）。
 * 主进程不可用（window.septcats 缺失 / promise reject）时渲染空态，不崩。
 *
 * 结构契约（冻结面，探针按此取元素，不得改名）：
 *   · 根 data-testid="calendar-side"
 *   · 列表项 data-testid="calendar-side-item-<id>"（id = 主进程 uuid）
 *   · 空态 data-testid="calendar-side-empty"
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import type { CalendarEvent } from '../../../shared/calendar';
import { CALENDAR_CHANGED_EVENT, DAY, calendarApi, hm, localDateKey, startOfDayMs } from './helpers';
import './CalendarSidePanel.css';

/** 「近 7 天」窗口长度（天）。 */
const WINDOW_DAYS = 7;
/** 二级栏最多列出的条数（窄栏不做无限长列表）。 */
const MAX_ITEMS = 12;

/** 行内时间标签：全天只给日期 + 「全天」，否则给日期 + HH:MM。 */
function whenText(ev: CalendarEvent): string {
  const key = localDateKey(new Date(ev.startAt));
  return ev.allDay ? `${key} ${t('calendar.allDay')}` : `${key} ${hm(new Date(ev.startAt))}`;
}

export function CalendarSidePanel(): ReactNode {
  const [items, setItems] = useState<CalendarEvent[]>([]);

  const load = useCallback(async (): Promise<void> => {
    const api = calendarApi();
    if (api === undefined) {
      setItems([]);
      return;
    }
    const from = startOfDayMs(new Date());
    const to = from + WINDOW_DAYS * DAY;
    try {
      const res = await api.list({ from, to });
      const list = Array.isArray(res.events) ? [...res.events] : [];
      list.sort((a, b) => a.startAt - b.startAt);
      setItems(list.slice(0, MAX_ITEMS));
    } catch {
      // 主进程不可用：空态即可，不阻断二级栏
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChanged = (): void => {
      void load();
    };
    window.addEventListener(CALENDAR_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(CALENDAR_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  return (
    <div className="cal-side" data-testid="calendar-side">
      <div className="cal-side-head">
        <span className="cal-side-title">{t('calendar.sideTitle')}</span>
        <span className="cal-side-count">{`${String(items.length)}${t('calendar.itemSuffix')}`}</span>
      </div>
      {items.length === 0 ? (
        <p className="cal-side-empty" data-testid="calendar-side-empty">
          {t('calendar.sideEmpty')}
        </p>
      ) : (
        <ul className="cal-side-list">
          {items.map((ev) => (
            <li key={ev.id} className="cal-side-item" data-testid={`calendar-side-item-${ev.id}`}>
              <span className="cal-side-when">{whenText(ev)}</span>
              <span className="cal-side-text" title={ev.title}>
                {ev.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CalendarSidePanel;