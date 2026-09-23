/**
 * activity.ts —— 工作台「近 7 日活跃」热力卡数据层（TASK-T71-01 §2 heatmap）。
 *
 * 数据主权在 settings（localStorage `septcats.wbcard.activity.days`，仿 work.ts 守卫范式）：
 * 形状 `{ "YYYY-MM-DD": n }`（编辑次数计数）。**写点唯一** = 编辑提交防抖处
 * （pages/PageView.tsx 的 EditSession commit 包装）调用 `bumpActivityToday()` +1；
 * 渲染层只读数，不写。无新表、无新 IPC。
 *
 * 归一化：渲染层纯函数 `normalizeHeatmap` 把近 7 天计数压到 4 档（0=最浅），
 * 全部走 --sc-* token（由卡组件按 level 取色，no-magic 钉）。
 */
import { localDateKey } from './work';

const ACTIVITY_STORAGE_KEY = 'septcats.wbcard.activity.days';

export type ActivityDays = Record<string, number>;

// ---------------------------------------------------------------------------
// localStorage 守卫读写（与 state/tabs.ts、work.ts 同范式）
// ---------------------------------------------------------------------------

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

function isActivityDays(value: unknown): value is ActivityDays {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).every(
    ([key, count]) => typeof key === 'string' && typeof count === 'number' && Number.isFinite(count),
  );
}

/** 读活跃计数映射；野 JSON / 损坏 → 空对象。 */
export function readActivityDays(): ActivityDays {
  const raw = safeGetItem(ACTIVITY_STORAGE_KEY);
  if (raw === null) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isActivityDays(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function writeActivityDays(days: ActivityDays): void {
  safeSetItem(ACTIVITY_STORAGE_KEY, JSON.stringify(days));
}

/**
 * 写点唯一：今日编辑计数 +1（localDateKey = 本地 YYYY-MM-DD，与 work.ts 同口径）。
 * 任何环境（无 localStorage / 抛错）静默降级，绝不让编辑提交链路崩。
 */
export function bumpActivityToday(now: Date = new Date()): void {
  const key = localDateKey(now);
  const days = readActivityDays();
  days[key] = (days[key] ?? 0) + 1;
  writeActivityDays(days);
}

// ---------------------------------------------------------------------------
// 归一化（渲染层纯函数，可单测）
// ---------------------------------------------------------------------------

export interface HeatCell {
  /** YYYY-MM-DD */
  date: string;
  count: number;
  /** 0=最浅（无活跃）…3=最活跃（按 max 归一 4 档）。 */
  level: 0 | 1 | 2 | 3;
}

/**
 * 纯函数：取以 `now` 为基准的近 7 天（含今日）活跃格，按 max 归一到 4 档。
 * - 缺失日期 = count 0 / level 0；
 * - max>0 时 level = floor(count / max * 3)（封顶 3）；max=0 全 0 档。
 * 返回顺序：从最早一天到今日（渲染时自左向右或自下而上皆可）。
 */
export function normalizeHeatmap(days: ActivityDays, now: Date = new Date()): HeatCell[] {
  const cells: HeatCell[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = localDateKey(date);
    cells.push({ date: key, count: days[key] ?? 0, level: 0 });
  }
  const max = cells.reduce((acc, cell) => Math.max(acc, cell.count), 0);
  if (max > 0) {
    for (const cell of cells) {
      const level = Math.min(3, Math.floor((cell.count / max) * 3)) as 0 | 1 | 2 | 3;
      cell.level = level;
    }
  }
  return cells;
}
