// @vitest-environment jsdom
/**
 * t97-calendar-ui.test.tsx —— 日历渲染层（T97-01，B 角色交付）。
 *
 * 钉死 PRD §3.2 结构契约（探针按此取元素）与 §5 行为要求：
 *  ① 结构契约：根 / 月份标题 / 网格 / 42 个日格（testid = calendar-day-<YYYY-MM-DD>）/
 *     上·下月·今天三个导航钮 / 空态；
 *  ② 月视图几何：周一开头、恒 6×7、跨月补白淡化、今天高亮；
 *  ③ 导航：上/下月与「今天」驱动月份标题与重新拉取；
 *  ④ 新建：点日格开表单（受控标题 input）→ 标题必填 → 保存 → 网格出现 .calendar-chip；
 *  ⑤ 编辑/删除：点日程条开编辑（预填）→ 保存走 update、删除走 remove；
 *  ⑥ 全天开关：勾选后时间输入禁用，落库 allDay=true + 当天 00:00 起；
 *  ⑦ 二级栏「近 7 天」：列表项 testid = calendar-side-item-<id>、空态、越窗不计；
 *  ⑧ 容错：window.septcats 缺失 / promise reject → 两栏都渲染空态且不崩；
 *  ⑨ 键盘可达：日格回车开表单、Esc 取消；
 * ⑩ 跨栏联动：页面建日程后二级栏经广播自动刷新。
 *
 * 纪律：主进程桥用 vi.stubGlobal 假桥（断言落假桥调用与 DOM）；不写真实档案目录。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarPage, localDateKey } from '../src/renderer/src/calendar/CalendarPage';
import { CalendarSidePanel } from '../src/renderer/src/calendar/CalendarSidePanel';
import type {
  CalendarCreateInput,
  CalendarEvent,
  CalendarEventResult,
  CalendarListInput,
  CalendarListResult,
  CalendarOkResult,
  CalendarRemoveInput,
  CalendarUpdateInput,
} from '../src/shared/calendar';

const DAY = 86_400_000;
const TITLE_REQUIRED = '标题不能为空';
const END_BEFORE_START = '结束时间早于开始时间';

/** 假库：一条内存事件表（主进程生成的 id 用 ev-<n> 代替 uuid）。 */
let db: CalendarEvent[] = [];
let seq = 0;

function installBridge() {
  const list = vi.fn(async (input: CalendarListInput): Promise<CalendarListResult> => {
    const events = db
      .filter((ev) => ev.startAt >= input.from && ev.startAt < input.to)
      .sort((a, b) => a.startAt - b.startAt)
      .map((ev) => ({ ...ev }));
    return { events };
  });
  const create = vi.fn(async (input: CalendarCreateInput): Promise<CalendarEventResult> => {
    seq += 1;
    const event: CalendarEvent = {
      id: `ev-${String(seq)}`,
      title: input.title,
      startAt: input.startAt,
      endAt: input.endAt ?? input.startAt,
      allDay: input.allDay ?? false,
      note: input.note ?? '',
      createdAt: 1,
      updatedAt: 1,
    };
    db.push(event);
    return { event };
  });
  const update = vi.fn(async (input: CalendarUpdateInput): Promise<CalendarEventResult> => {
    const index = db.findIndex((ev) => ev.id === input.id);
    const current = db[index];
    if (current === undefined) {
      throw new Error('E_NOT_FOUND: missing');
    }
    const event: CalendarEvent = {
      id: current.id,
      title: input.patch.title ?? current.title,
      startAt: input.patch.startAt ?? current.startAt,
      endAt: input.patch.endAt ?? current.endAt,
      allDay: input.patch.allDay ?? current.allDay,
      note: input.patch.note ?? current.note,
      createdAt: current.createdAt,
      updatedAt: 2,
    };
    db[index] = event;
    return { event };
  });
  const remove = vi.fn(async (input: CalendarRemoveInput): Promise<CalendarOkResult> => {
    db = db.filter((ev) => ev.id !== input.id);
    return { ok: true };
  });
  vi.stubGlobal('septcats', { calendar: { list, create, update, remove } });
  return { list, create, update, remove };
}

let bridge: ReturnType<typeof installBridge>;

function eventOn(dateKey: string, startTime: string, endTime: string, patch?: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: patch?.id ?? `ev-seed-${dateKey}-${startTime}`,
    title: patch?.title ?? '种子日程',
    startAt: new Date(`${dateKey}T${startTime}:00`).getTime(),
    endAt: new Date(`${dateKey}T${endTime}:00`).getTime(),
    allDay: patch?.allDay ?? false,
    note: patch?.note ?? '',
    createdAt: 1,
    updatedAt: 1,
  };
}

/** 网格内全部日格（按 DOM 顺序）。 */
function dayCells(): HTMLElement[] {
  return [...screen.getByTestId('calendar-grid').querySelectorAll<HTMLElement>('[data-testid^="calendar-day-"]')];
}

/** 今天（本地）的日期键。 */
function todayKey(): string {
  return localDateKey(new Date());
}

beforeEach(() => {
  db = [];
  seq = 0;
  bridge = installBridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('T97-01 日历页 · 结构契约与月视图几何', () => {
  it('① 结构契约：根 / 月份标题 / 网格 / 42 个日格 / 三个导航钮 / 空态', async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId('calendar-page')).toBeDefined();
    expect(screen.getByTestId('calendar-month-label')).toBeDefined();
    expect(screen.getByTestId('calendar-prev')).toBeDefined();
    expect(screen.getByTestId('calendar-next')).toBeDefined();
    expect(screen.getByTestId('calendar-today')).toBeDefined();
    expect(screen.getByTestId('calendar-empty')).toBeDefined();

    const cells = dayCells();
    expect(cells.length).toBe(42); // 6 行 × 7 列恒等
    for (const cell of cells) {
      expect(cell.getAttribute('data-testid')).toMatch(/^calendar-day-\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('② 周一开头 + 跨月补白淡化 + 今天高亮', async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalled());

    const cells = dayCells();
    const firstKey = cells[0]!.getAttribute('data-testid')!.slice('calendar-day-'.length);
    // 首格必为周一（周一 = 1）
    expect(new Date(`${firstKey}T00:00:00`).getDay()).toBe(1);
    // 6×7 且末格 = 首格 + 41 天
    const lastKey = cells[41]!.getAttribute('data-testid')!.slice('calendar-day-'.length);
    expect(new Date(`${lastKey}T00:00:00`).getTime() - new Date(`${firstKey}T00:00:00`).getTime()).toBe(41 * DAY);
    // 跨月补白存在且淡化
    const outCells = cells.filter((cell) => cell.className.includes('calendar-cell--out'));
    expect(outCells.length).toBeGreaterThan(0);
    // 今天高亮
    const todayCell = screen.getByTestId(`calendar-day-${todayKey()}`);
    expect(todayCell.className).toContain('calendar-cell--today');
    // 非今天的格不高亮
    expect(cells.filter((cell) => cell.className.includes('calendar-cell--today')).length).toBe(1);
  });

  it('③ 上/下月与「今天」：月份标题随之变化并重新拉取', async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalledTimes(1));
    const label = screen.getByTestId('calendar-month-label');
    const now = new Date();
    const currentLabel = `${String(now.getFullYear())} / ${String(now.getMonth() + 1)}`;
    expect(label.textContent).toBe(currentLabel);

    fireEvent.click(screen.getByTestId('calendar-next'));
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await waitFor(() =>
      expect(label.textContent).toBe(`${String(next.getFullYear())} / ${String(next.getMonth() + 1)}`),
    );

    fireEvent.click(screen.getByTestId('calendar-prev'));
    fireEvent.click(screen.getByTestId('calendar-prev'));
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    await waitFor(() =>
      expect(label.textContent).toBe(`${String(prev.getFullYear())} / ${String(prev.getMonth() + 1)}`),
    );

    fireEvent.click(screen.getByTestId('calendar-today'));
    await waitFor(() => expect(label.textContent).toBe(currentLabel));
    // 每次切月都会重拉（list 至少 4 次）
    expect(bridge.list.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('T97-01 日历页 · 新建 / 编辑 / 删除', () => {
  it('④ 点日格开表单：标题必填（空标题不落库并提示），填好保存 → 网格出现 .calendar-chip', async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalled());

    const key = todayKey();
    fireEvent.click(screen.getByTestId(`calendar-day-${key}`));

    const input = (await screen.findByTestId('calendar-event-title')) as HTMLInputElement;
    expect(input.value).toBe(''); // 受控 input，初值为空

    // 空标题：不落库，给出标题必填提示
    fireEvent.click(screen.getByTestId('calendar-event-save'));
    expect(bridge.create).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('calendar-event-error').textContent).toBe(TITLE_REQUIRED));

    fireEvent.change(input, { target: { value: '与老张对齐方案' } });
    fireEvent.click(screen.getByTestId('calendar-event-save'));

    await waitFor(() => expect(bridge.create).toHaveBeenCalledTimes(1));
    const startAt = new Date(`${key}T09:00:00`).getTime();
    const endAt = new Date(`${key}T10:00:00`).getTime();
    expect(bridge.create).toHaveBeenCalledWith({
      title: '与老张对齐方案',
      startAt,
      endAt,
      allDay: false,
      note: '',
    });

    // 保存成功后：表单收起、空态消失、日格里出现 calendar-chip（文本 = 标题）
    await waitFor(() => expect(screen.queryByTestId('calendar-event-title')).toBeNull());
    await waitFor(() => {
      const chip = screen.getByTestId(`calendar-day-${key}`).querySelector('.calendar-chip');
      expect(chip?.textContent).toBe('与老张对齐方案');
    });
    expect(screen.queryByTestId('calendar-empty')).toBeNull();
  });

  it('④b 结束早于开始：提示且不落库', async () => {
    render(<CalendarPage />);
    fireEvent.click(screen.getByTestId(`calendar-day-${todayKey()}`));
    const input = (await screen.findByTestId('calendar-event-title')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '时间反了' } });
    fireEvent.change(screen.getByTestId('calendar-event-start'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByTestId('calendar-event-end'), { target: { value: '09:00' } });
    fireEvent.click(screen.getByTestId('calendar-event-save'));

    await waitFor(() => expect(screen.getByTestId('calendar-event-error').textContent).toBe(END_BEFORE_START));
    expect(bridge.create).not.toHaveBeenCalled();
  });

  it('⑤ 点已有日程开编辑（预填）→ 保存走 update；删除走 remove', async () => {
    const key = todayKey();
    db.push(eventOn(key, '09:00', '10:00', { id: 'ev-seed', title: '旧标题', note: '备注原文' }));
    render(<CalendarPage />);

    const chip = await screen.findByTestId('calendar-chip-ev-seed');
    expect(chip.textContent).toBe('旧标题');
    fireEvent.click(chip);

    const input = (await screen.findByTestId('calendar-event-title')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('旧标题'));
    expect((screen.getByTestId('calendar-event-note') as HTMLTextAreaElement).value).toBe('备注原文');

    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.click(screen.getByTestId('calendar-event-save'));
    await waitFor(() => expect(bridge.update).toHaveBeenCalledTimes(1));
    expect(bridge.update).toHaveBeenCalledWith({
      id: 'ev-seed',
      patch: {
        title: '新标题',
        startAt: new Date(`${key}T09:00:00`).getTime(),
        endAt: new Date(`${key}T10:00:00`).getTime(),
        allDay: false,
        note: '备注原文',
      },
    });
    await waitFor(() => expect(screen.getByTestId('calendar-chip-ev-seed').textContent).toBe('新标题'));

    // 再开 → 删除
    fireEvent.click(screen.getByTestId('calendar-chip-ev-seed'));
    await screen.findByTestId('calendar-event-title');
    fireEvent.click(screen.getByTestId('calendar-event-delete'));
    await waitFor(() => expect(bridge.remove).toHaveBeenCalledWith({ id: 'ev-seed' }));
    await waitFor(() => expect(screen.queryByTestId('calendar-chip-ev-seed')).toBeNull());
  });

  it('⑥ 全天开关：勾选后时间输入禁用，落库 allDay=true 且从当天 00:00 起', async () => {
    render(<CalendarPage />);
    const key = todayKey();
    fireEvent.click(screen.getByTestId(`calendar-day-${key}`));
    const input = (await screen.findByTestId('calendar-event-title')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '团队日' } });

    fireEvent.click(screen.getByTestId('calendar-event-allday'));
    await waitFor(() => expect((screen.getByTestId('calendar-event-start') as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByTestId('calendar-event-end') as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('calendar-event-save'));
    await waitFor(() => expect(bridge.create).toHaveBeenCalledTimes(1));
    const startAt = new Date(`${key}T00:00:00`).getTime();
    expect(bridge.create).toHaveBeenCalledWith({
      title: '团队日',
      startAt,
      endAt: startAt + DAY,
      allDay: true,
      note: '',
    });
  });

  it('⑦ 日格超过 3 条日程：只列 3 条 + “+N” 折叠', async () => {
    const key = todayKey();
    for (let i = 0; i < 5; i += 1) {
      db.push(eventOn(key, `0${String(i + 1)}:00`, `0${String(i + 1)}:30`, { id: `ev-${String(i)}`, title: `日程${String(i)}` }));
    }
    render(<CalendarPage />);
    await waitFor(() => {
      const cell = screen.getByTestId(`calendar-day-${key}`);
      expect(cell.querySelectorAll('.calendar-chip').length).toBe(3);
      expect(cell.querySelector('.calendar-more')?.textContent).toBe('+2');
    });
  });

  it('⑨ 键盘可达：日格回车开表单、Esc 关闭', async () => {
    render(<CalendarPage />);
    fireEvent.keyDown(screen.getByTestId(`calendar-day-${todayKey()}`), { key: 'Enter' });
    await screen.findByTestId('calendar-event-title');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('calendar-event-title')).toBeNull());
  });
});

describe('T97-01 二级栏 · 近 7 天', () => {
  it('⑦ 只列近 7 天（按开始时间升序）、越窗不计；无数据走空态', async () => {
    const now = new Date();
    const key = todayKey();
    db.push(eventOn(key, '15:00', '16:00', { id: 'ev-late', title: '今天下午' }));
    db.push(eventOn(key, '08:00', '09:00', { id: 'ev-early', title: '今天上午' }));
    const far = new Date(now.getTime() + 8 * DAY);
    db.push(eventOn(localDateKey(far), '09:00', '10:00', { id: 'ev-far', title: '八天后' }));

    render(<CalendarSidePanel />);
    await waitFor(() => expect(bridge.list).toHaveBeenCalledTimes(1));

    const early = await screen.findByTestId('calendar-side-item-ev-early');
    expect(early.textContent).toContain('今天上午');
    expect(screen.getByTestId('calendar-side-item-ev-late').textContent).toContain('今天下午');
    expect(screen.queryByTestId('calendar-side-item-ev-far')).toBeNull(); // 越窗
    expect(screen.queryByTestId('calendar-side-empty')).toBeNull();
    expect(screen.getByTestId('calendar-side').textContent).toContain('2 项');

    // 窗口参数：from = 今天 00:00，to = from + 7 天
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    expect(bridge.list).toHaveBeenCalledWith({ from, to: from + 7 * DAY });
  });

  it('⑦b 空库 → 空态', async () => {
    render(<CalendarSidePanel />);
    await waitFor(() => expect(screen.getByTestId('calendar-side-empty')).toBeDefined());
    expect(screen.getByTestId('calendar-side').textContent).toContain('0 项');
  });

  it('⑩ 跨栏联动：页面建日程后二级栏自动刷新（变更广播）', async () => {
    render(
      <>
        <CalendarPage />
        <CalendarSidePanel />
      </>,
    );
    await screen.findByTestId('calendar-side-empty');

    fireEvent.click(screen.getByTestId(`calendar-day-${todayKey()}`));
    const input = (await screen.findByTestId('calendar-event-title')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '联动日程' } });
    fireEvent.click(screen.getByTestId('calendar-event-save'));

    const item = await screen.findByTestId('calendar-side-item-ev-1');
    expect(item.textContent).toContain('联动日程');
  });
});

describe('T97-01 渲染层容错 · 主进程不可用', () => {
  it('⑧ 无 window.septcats：两栏都渲染空态、仍可开表单且不崩', async () => {
    vi.unstubAllGlobals(); // 撤掉假桥 → 主进程缺失
    render(
      <>
        <CalendarPage />
        <CalendarSidePanel />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('calendar-empty')).toBeDefined());
    expect(screen.getByTestId('calendar-side-empty')).toBeDefined();

    // 仍可交互：开表单 → 取消（不抛错）
    fireEvent.click(screen.getByTestId(`calendar-day-${todayKey()}`));
    await screen.findByTestId('calendar-event-title');
    fireEvent.click(screen.getByTestId('calendar-event-cancel'));
    await waitFor(() => expect(screen.queryByTestId('calendar-event-title')).toBeNull());
  });

  it('⑧b list reject：空态不崩（页面与二级栏）', async () => {
    vi.stubGlobal('septcats', {
      calendar: {
        list: vi.fn(async () => {
          throw new Error('E_DB_UNAVAILABLE: db down');
        }),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
    });
    render(
      <>
        <CalendarPage />
        <CalendarSidePanel />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('calendar-empty')).toBeDefined());
    expect(screen.getByTestId('calendar-side-empty')).toBeDefined();
  });
});