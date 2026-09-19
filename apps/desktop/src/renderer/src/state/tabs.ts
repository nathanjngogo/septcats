/**
 * state/tabs.ts —— 编辑区多页签的状态纯函数与持久化（TASK-T37-01 §0）。
 *
 * - 页签集合 = pagesStore.tabs（有序 pageId 数组），**当前选中 = pagesStore.selectedId**
 *   （不变式：pages 视图下 selectedId ∈ tabs，二者由 openInTab/closeTab 统一维护）；
 * - 持久化口径（§0.4）：本机 UI 状态、不进账本——标签集合 + 顺序 + 当前选中项整体
 *   写 localStorage（与主题/语言偏好同范式），键按 workspace 隔离
 *   （`septcats.tabs.<workspaceId>`），切换工作区/重开应用各还原各的；
 * - localStorage 不可用（Node 测试环境 / 隐私模式）时静默降级为仅会话内生效；
 * - 纯函数一律可独立单测（apps/desktop/test/tabs.test.tsx）。
 */

/** localStorage 存储形状（版本化，向前兼容留余地）。 */
export interface TabsPersist {
  v: 1;
  /** 有序打开页 id。 */
  tabs: string[];
  /** 当前选中页 id；null = 全部关闭。 */
  activeId: string | null;
}

export const TABS_STORAGE_PREFIX = 'septcats.tabs.';
export const TABS_PERSIST_VERSION = 1;

export function tabsStorageKey(workspaceId: string): string {
  return TABS_STORAGE_PREFIX + workspaceId;
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

/** 读取某工作区的持久化页签；无记录/损坏/版本不符 → null（调用方走「无记录」分支）。 */
export function readTabs(workspaceId: string): TabsPersist | null {
  const raw = safeGetItem(tabsStorageKey(workspaceId));
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === TABS_PERSIST_VERSION &&
      isStringArray((parsed as { tabs?: unknown }).tabs) &&
      ((parsed as { activeId?: unknown }).activeId === null ||
        typeof (parsed as { activeId?: unknown }).activeId === 'string')
    ) {
      const persist = parsed as TabsPersist;
      // 去重防御：同页只保留一个（§0.1 不变式）
      return { v: 1, tabs: [...new Set(persist.tabs)], activeId: persist.activeId };
    }
    return null;
  } catch {
    return null;
  }
}

/** 写某工作区的页签快照（workspaceId=null 时不写——无工作区无归属键）。 */
export function writeTabs(
  workspaceId: string | null,
  tabs: readonly string[],
  activeId: string | null,
): void {
  if (workspaceId === null) {
    return;
  }
  const payload: TabsPersist = { v: TABS_PERSIST_VERSION, tabs: [...tabs], activeId };
  safeSetItem(tabsStorageKey(workspaceId), JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// 纯函数（tabs 数组变换；不改 store、无副作用）
// ---------------------------------------------------------------------------

/**
 * 打开页进页签集合：已存在 → 原集合原引用（同页不重复开，§0.1）；
 * 不存在 → 追加到末尾（新开标签在最右）。
 */
export function openInTabs(
  tabs: readonly string[],
  id: string,
): { tabs: string[]; opened: boolean } {
  if (tabs.includes(id)) {
    // 同页不重复开：集合不变（原引用，避免无谓重渲染）
    return { tabs: tabs as string[], opened: false };
  }
  return { tabs: [...tabs, id], opened: true };
}

/**
 * 关标签的选中回落（§0.5）：关的是当前选中 → 右邻优先，无右邻取左邻，全空 → null；
 * 关的不是当前选中 → 选中不变。绝不触碰删除/回收站（调用方不发起任何 pages.remove）。
 */
export function closeTabFallback(
  tabs: readonly string[],
  closedId: string,
  activeId: string | null,
): { tabs: string[]; activeId: string | null } {
  const index = tabs.indexOf(closedId);
  if (index < 0) {
    return { tabs: tabs as string[], activeId };
  }
  const next = [...tabs.slice(0, index), ...tabs.slice(index + 1)];
  if (activeId !== closedId) {
    return { tabs: next, activeId };
  }
  const fallback = next[index] ?? next[index - 1] ?? null;
  return { tabs: next, activeId: fallback };
}

/**
 * 拖拽排序：把 id 移动到 toIndex（按移除后数组口径夹紧；同位/越界 → 原样）。
 */
export function moveTab(tabs: readonly string[], id: string, toIndex: number): string[] {
  const from = tabs.indexOf(id);
  if (from < 0) {
    return [...tabs];
  }
  const next = [...tabs];
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, id);
  if (clamped === from) {
    return [...tabs];
  }
  return next;
}

/**
 * 按存活页集合裁剪页签（load 恢复 / 跨设备同步对账）：不在集合内的页签移除；
 * 当前选中被裁掉 → 同 §0.5 回落（右优先、无右取左、全空 null）。
 */
export function pruneTabs(
  tabs: readonly string[],
  validIds: ReadonlySet<string>,
  activeId: string | null,
): { tabs: string[]; activeId: string | null } {
  const kept = tabs.filter((id) => validIds.has(id));
  if (kept.length === tabs.length && (activeId === null || validIds.has(activeId))) {
    // 无裁剪：返回原引用（store 引用稳定约定，避免 refresh 通道无谓重渲染）
    return { tabs: tabs as string[], activeId };
  }
  if (activeId !== null && validIds.has(activeId)) {
    return { tabs: kept, activeId };
  }
  if (activeId === null) {
    return { tabs: kept, activeId: null };
  }
  // 选中页已不存在：以其原位置为锚做相邻回落
  const anchor = tabs.indexOf(activeId);
  const fallback = kept[anchor] ?? kept[anchor - 1] ?? null;
  return { tabs: kept, activeId: fallback };
}

/**
 * 键盘快捷键判定（§0.3；与既有 Ctrl/Cmd+K 命令面板不冲突——键位不相交）：
 * - Ctrl/Cmd+W → 'close'（关当前）
 * - Ctrl/Cmd+Tab → 'next'（下一个，循环）
 * - Ctrl/Cmd+1..9 → { index: n-1 }（跳第 N 个；超出页签数由调用方夹紧到最后一个）
 * 其余（含带 Shift/Alt 的组合、无修饰键）→ null。
 */
export function tabsShortcutAction(
  input: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
): 'close' | 'next' | { index: number } | null {
  const mod = input.ctrlKey || input.metaKey;
  if (!mod || input.altKey || input.shiftKey) {
    return null;
  }
  if (input.key === 'w' || input.key === 'W') {
    return 'close';
  }
  if (input.key === 'Tab') {
    return 'next';
  }
  if (input.key.length === 1 && input.key >= '1' && input.key <= '9') {
    return { index: Number(input.key) - 1 };
  }
  return null;
}
