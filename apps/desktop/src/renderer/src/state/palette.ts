/**
 * state/palette.ts —— 命令面板/搜索页的 renderer 状态（TASK-T8-01 §3）。
 *
 * - 单一 store（`store.ts` 的零依赖 Zustand 同形实现，与 state/pages.ts 同口径）；
 * - 输入态即时搜索：debounce 150ms → `search:query` IPC（序号防过期响应）；
 * - 最近 10 条查询去重（recents），搜索页空 query 时作为「最近查询」chips 露出；
 * - 双路 Ctrl/Cmd+K（主进程全局广播 + renderer keydown）经 toggle 时间护栏去抖，
 *   「后者优先」：两路触发在护栏窗口内只生效一次。
 */
import type { SearchHit } from '../../../shared/search';
import type { SeptcatsApi } from '../../../types/window';
import { SEARCH_LIMIT_MAX } from '../../../shared/search';
import type { PaletteCommand } from '../palette/commands';
import { rankPalette, selectableRowCount } from '../palette/rank';
import { pagesActions, pagesStore } from './pages';
import { createStore, useStore } from './store';

export interface PaletteState {
  /** 命令面板可见。 */
  open: boolean;
  /** 独立搜索结果页可见（顶栏搜索钮 / 面板内跳转）。 */
  searchOpen: boolean;
  query: string;
  activeIndex: number;
  hits: SearchHit[];
  tookMs: number;
  searching: boolean;
  /** 最近 10 条查询（去重，最新在前）。 */
  recents: string[];
  commands: readonly PaletteCommand[];
  lastToggleAt: number;
}

export const PALETTE_DEBOUNCE_MS = 150;
/** 面板/搜索页取结果的 limit（≤200 由 shared 钳制）。 */
export const PALETTE_SEARCH_LIMIT = SEARCH_LIMIT_MAX > 40 ? 40 : SEARCH_LIMIT_MAX;
export const RECENT_QUERY_LIMIT = 10;
/** 双路 toggle 护栏：窗口内的第二次 toggle 视为重复触发。 */
export const TOGGLE_GUARD_MS = 220;

export const PALETTE_INITIAL_STATE: PaletteState = {
  open: false,
  searchOpen: false,
  query: '',
  activeIndex: 0,
  hits: [],
  tookMs: 0,
  searching: false,
  recents: [],
  commands: [],
  lastToggleAt: 0,
};

export const paletteStore = createStore<PaletteState>(PALETTE_INITIAL_STATE);

/** 选择器订阅（选择器请返回引用稳定的切片）。 */
export function usePalette<T>(selector: (state: PaletteState) => T): T {
  return useStore(paletteStore, selector);
}

function apiBridge(): SeptcatsApi {
  const value = (globalThis as { septcats?: SeptcatsApi }).septcats;
  if (value === undefined) {
    throw new Error('preload 未注入 window.septcats（渲染器无法访问搜索通道）');
  }
  return value;
}

// ---------------------------------------------------------------------------
// 搜索（debounce → IPC → 序号防过期）
// ---------------------------------------------------------------------------

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchSeq = 0;

function clearSearchTimer(): void {
  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
}

async function runSearch(query: string): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    paletteStore.setState((state) => ({ ...state, hits: [], tookMs: 0, searching: false }));
    return;
  }
  const workspaceId = pagesStore.getState().workspaceId;
  if (workspaceId === null) {
    paletteStore.setState((state) => ({ ...state, hits: [], tookMs: 0, searching: false }));
    return;
  }
  const seq = searchSeq + 1;
  searchSeq = seq;
  paletteStore.setState((state) => ({ ...state, searching: true }));
  try {
    const response = await apiBridge().search.query({
      workspaceId,
      query: trimmed,
      limit: PALETTE_SEARCH_LIMIT,
    });
    if (seq !== searchSeq) {
      return; // 过期响应（已有更新的查询）
    }
    paletteStore.setState((state) => ({
      ...state,
      hits: [...response.hits],
      tookMs: response.tookMs,
      searching: false,
    }));
  } catch {
    if (seq === searchSeq) {
      paletteStore.setState((state) => ({ ...state, hits: [], tookMs: 0, searching: false }));
    }
  }
}

function scheduleSearch(query: string): void {
  clearSearchTimer();
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void runSearch(query);
  }, PALETTE_DEBOUNCE_MS);
}

function recordRecent(query: string): void {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return;
  }
  paletteStore.setState((state) => ({
    ...state,
    recents: [trimmed, ...state.recents.filter((item) => item !== trimmed)].slice(0, RECENT_QUERY_LIMIT),
  }));
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

export const paletteActions = {
  /** App 装配命令行为（bindPaletteCommands 的产物）。 */
  configureCommands(commands: readonly PaletteCommand[]): void {
    paletteStore.setState((state) => ({ ...state, commands }));
  },

  /** 双路 toggle 入口（含护栏）。now 可注入（测试用）。 */
  toggle(now: number = Date.now()): void {
    paletteStore.setState((state) => {
      if (now - state.lastToggleAt < TOGGLE_GUARD_MS) {
        return state;
      }
      return { ...state, open: !state.open, lastToggleAt: now };
    });
  },

  open(): void {
    paletteStore.setState((state) => ({
      ...state,
      open: true,
      query: '',
      activeIndex: 0,
      hits: [],
      tookMs: 0,
      lastToggleAt: Date.now(),
    }));
  },

  close(): void {
    paletteStore.setState((state) => ({ ...state, open: false }));
  },

  setQuery(query: string): void {
    paletteStore.setState((state) => ({ ...state, query, activeIndex: 0 }));
    // `>` 仅命令：不需要真库检索；auto/@ 才调度搜索（副作用放在 updater 外）
    if (!query.startsWith('>')) {
      scheduleSearch(query);
    }
  },

  moveActive(delta: number): void {
    paletteStore.setState((state) => {
      const view = rankPalette(state.query, state.commands, state.hits);
      const size = selectableRowCount(view);
      if (size === 0) {
        return { ...state, activeIndex: 0 };
      }
      const next = (((state.activeIndex + delta) % size) + size) % size;
      return { ...state, activeIndex: next };
    });
  },

  setActive(index: number): void {
    paletteStore.setState((state) => ({ ...state, activeIndex: Math.max(0, index) }));
  },

  /** Enter：命令执行 / 页面打开；成功后关面板并记录最近查询。 */
  executeActive(): void {
    const state = paletteStore.getState();
    const view = rankPalette(state.query, state.commands, state.hits);
    const commandCount = view.commands.length;
    const pageCount = view.pageHits.length;
    const index = state.activeIndex;
    recordRecent(state.query);
    if (index < commandCount) {
      const command = view.commands[index];
      command?.run();
      paletteStore.setState((current) => ({ ...current, open: false }));
      return;
    }
    const hit = index - commandCount < pageCount ? view.pageHits[index - commandCount] : view.dbHits[index - commandCount - pageCount];
    if (hit !== undefined && hit.pageId !== null) {
      pagesActions.selectPage(hit.pageId);
      paletteStore.setState((current) => ({ ...current, open: false, searchOpen: false }));
    }
  },

  /** 搜索页点击结果：开页并关搜索页。 */
  openHit(hit: SearchHit): void {
    recordRecent(paletteStore.getState().query);
    if (hit.pageId !== null) {
      pagesActions.selectPage(hit.pageId);
    }
    paletteStore.setState((state) => ({ ...state, open: false, searchOpen: false }));
  },

  openSearchPage(): void {
    paletteStore.setState((state) => ({ ...state, searchOpen: true, open: false }));
    void runSearch(paletteStore.getState().query);
  },

  closeSearchPage(): void {
    paletteStore.setState((state) => ({ ...state, searchOpen: false }));
  },

  /** 搜索页主动触发一次检索（不走 debounce 的场景：chips 点击/挂载恢复）。 */
  searchNow(): void {
    clearSearchTimer();
    void runSearch(paletteStore.getState().query);
  },
};
