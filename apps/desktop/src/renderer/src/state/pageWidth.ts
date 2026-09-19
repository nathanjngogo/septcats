/**
 * state/pageWidth.ts —— 页面「全宽 / 固定宽度」开关的状态与持久化（TASK-T41-01 §1.4）。
 *
 * - Notion 语义：**按页面**记，不是全局。真相源 = localStorage 键
 *   `septcats.pagewidth.<workspaceId>`（与 `septcats.tabs.<ws>` 同范式：版本化 +
 *   safe 读写 + 损坏回退默认），形状 `{ v: 1, full: string[] }`；
 *   **集合内 = 全宽，不在集合内 = 固定宽度（默认态，§1.5 新页面默认固定）**。
 * - 页面级开关优先于 T39-01 的全局 measure：消费侧（PageView.css）只在
 *   `.pv-root[data-measure='full']` 作用域内放开正文列 max-width，全局
 *   `--sc-layout-measure` 注入通道不做任何改动。
 * - 实现口径（§1.2）：本模块只持有状态与写 localStorage，**零量测、零内联宽高**；
 *   宽度表现完全由 CSS 变量/属性选择器承载。
 * - 工作区隔离：`pagesActions.load()` 就位活动工作区后调 `syncWorkspace`（首次加载与
 *   switchWorkspace 都汇入 load），切换/重开各还原各的。
 * - localStorage 不可用（Node 测试环境 / 隐私模式）时静默降级为仅会话内生效。
 * - 纯函数 + 极简 store（store.ts Zustand 同形实现），可独立单测。
 */
import { createStore, useStore } from './store';

/** localStorage 存储形状（版本化，向前兼容留余地）。 */
export interface PageWidthPersist {
  v: 1;
  /** 当前 workspace 内开启全宽的页 id（不在集合内 = 固定宽度）。 */
  full: string[];
}

export const PAGE_WIDTH_STORAGE_PREFIX = 'septcats.pagewidth.';
export const PAGE_WIDTH_PERSIST_VERSION = 1;

export function pageWidthStorageKey(workspaceId: string): string {
  return PAGE_WIDTH_STORAGE_PREFIX + workspaceId;
}

// ---------------------------------------------------------------------------
// localStorage 读写（全部守卫：不可用 → null / 静默）
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
    // 写失败（配额/隐私模式）：仅本会话生效，不阻断 UI
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 读某工作区的全宽页集合；无记录/损坏/版本不符 → null（调用方走「空集」分支）。 */
export function readPageWidths(workspaceId: string): Set<string> | null {
  const raw = safeGetItem(pageWidthStorageKey(workspaceId));
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === PAGE_WIDTH_PERSIST_VERSION &&
      isStringArray((parsed as { full?: unknown }).full)
    ) {
      // Set 天然去重（防御同 id 重复写入）
      return new Set((parsed as PageWidthPersist).full);
    }
    return null;
  } catch {
    return null;
  }
}

/** 写某工作区的全宽页快照（workspaceId=null 时不写——无工作区无归属键）。 */
export function writePageWidths(workspaceId: string | null, full: ReadonlySet<string>): void {
  if (workspaceId === null) {
    return;
  }
  const payload: PageWidthPersist = { v: PAGE_WIDTH_PERSIST_VERSION, full: [...full] };
  safeSetItem(pageWidthStorageKey(workspaceId), JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// store 与 actions
// ---------------------------------------------------------------------------

export interface PageWidthState {
  /** 当前生效 workspace（null = 未就绪；toggle 只会话内生效、不落盘）。 */
  workspaceId: string | null;
  /** 全宽页 id 集合（引用稳定：toggle 换新 Set）。 */
  full: ReadonlySet<string>;
}

export const pageWidthStore = createStore<PageWidthState>({ workspaceId: null, full: new Set() });

/** 选择器订阅（选择器请返回引用稳定的切片）。 */
export function usePageWidth<T>(selector: (state: PageWidthState) => T): T {
  return useStore(pageWidthStore, selector);
}

export const pageWidthActions = {
  /**
   * `pagesActions.load()` 就位活动工作区后调：读该 workspace 的持久化集合
   * （无记录/损坏 → 空集 = 全部固定宽度）。workspaceId=null（无工作区）→ 清空回默认。
   */
  syncWorkspace(workspaceId: string | null): void {
    const full =
      workspaceId === null ? new Set<string>() : (readPageWidths(workspaceId) ?? new Set<string>());
    pageWidthStore.setState(() => ({ workspaceId, full }));
  },

  /**
   * 切换某页「全宽 ↔ 固定宽度」（每页独立，§1.1）；立即写当前 workspace 的存储。
   * 无 workspace（workspaceId=null）时仅会话内生效（writePageWidths 内部跳过）。
   */
  toggle(pageId: string): void {
    const { workspaceId, full } = pageWidthStore.getState();
    const next = new Set(full);
    if (next.has(pageId)) {
      next.delete(pageId);
    } else {
      next.add(pageId);
    }
    pageWidthStore.setState(() => ({ workspaceId, full: next }));
    writePageWidths(workspaceId, next);
  },
};
