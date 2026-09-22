/**
 * state/pages.ts —— 页面树/工作区的 renderer 数据流（TASK-T6-01 §4）。
 *
 * - 单一 store（`store.ts` 的零依赖 Zustand 同形实现）：树、活动工作区、收藏/最近、
 *   展开集、选中项、Toast 队列都在这里；
 * - **乐观更新 + 失败回滚**：写操作先本地生效（含级联的整棵子树），IPC 失败则恢复快照
 *   并弹 danger Toast；成功后 `refresh` 与服务端对账（树/收藏/最近一次拉齐）；
 * - 错误码来自 main 侧（`E_PARENT_GONE` / `E_CYCLE` / `E_NOT_FOUND` / `E_INVARIANT`），
 *   这里翻译成给用户看的一句话。
 */
import { sortBetween } from '@septcats/core';
import {
  childrenIndex,
  collectDescendants,
  type PageNode,
} from '@septcats/editor';
import type { ToastTone } from '@septcats/ui';
import type { PageNodeView, SeptcatsApi, WorkspaceSummary } from '../../../types/window';
import { errorText, t } from '../i18n';
import { createStore, useStore } from './store';
import { closeTabFallback, moveTab, openInTabs, pruneTabs, readTabs, writeTabs } from './tabs';
import { pageWidthActions } from './pageWidth';

export type PagesStatus = 'loading' | 'ready' | 'error';
export type TreeScope = 'all' | 'favorites' | 'recent';
export type AppView = 'pages' | 'trash';

export interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
}

export interface PagesState {
  status: PagesStatus;
  error: string | null;
  view: AppView;
  scope: TreeScope;
  workspaceId: string | null;
  workspaces: WorkspaceSummary[];
  /**
   * alive + deleted 全量（purge 过的行 deletedAt=0，视图层自行过滤）。
   * T42-01：节点带承载注解（pageType/summary/updatedAt，main 侧 PageNodeView）。
   */
  nodes: PageNodeView[];
  expanded: Set<string>;
  selectedId: string | null;
  editingId: string | null;
  favoriteIds: string[];
  recentIds: string[];
  toasts: ToastMessage[];
  /** 「删除页面」二次确认弹层的目标页 id（null = 关闭；T24-01 §0.A）。 */
  deleteConfirmId: string | null;
  /**
   * 编辑区多页签（TASK-T37-01 §0.1）：有序打开页 id；**当前选中项 = selectedId**。
   * 不变式：pages 视图下 selectedId ∈ tabs（openInTab/closeTab 统一维护）；
   * 持久化按 workspace 隔离写 localStorage（state/tabs.ts），不进账本。
   */
  tabs: string[];
}

const initialState: PagesState = {
  status: 'loading',
  error: null,
  view: 'pages',
  scope: 'all',
  workspaceId: null,
  workspaces: [],
  nodes: [],
  expanded: new Set<string>(),
  selectedId: null,
  editingId: null,
  favoriteIds: [],
  recentIds: [],
  toasts: [],
  deleteConfirmId: null,
  tabs: [],
};

export const pagesStore = createStore<PagesState>(initialState);

/** 选择器订阅（选择器请返回引用稳定的切片）。 */
export function usePages<T>(selector: (state: PagesState) => T): T {
  return useStore(pagesStore, selector);
}

// ---------------------------------------------------------------------------
// 派生工具（组件复用；纯函数）
// ---------------------------------------------------------------------------

export function aliveNodes<T extends PageNode>(nodes: readonly T[]): T[] {
  return nodes.filter((node) => node.alive === 1);
}

/** 回收站项：软删除（deletedAt > 0）；彻底删除（deletedAt=0）不再露出。 */
export function trashNodes<T extends PageNode>(nodes: readonly T[]): T[] {
  return nodes.filter((node) => node.alive === 0 && node.deletedAt !== null && node.deletedAt > 0);
}

export function nodeMap<T extends PageNode>(nodes: readonly T[]): Map<string, T> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/**
 * 承载类型读取（T42-01）：注解缺失（夹具/未知来源的 PageNode）一律按普通页理解，
 * 与 main 侧 v8 列默认值同口径。
 */
export function pageTypeOf(node: PageNode): 'page' | 'wiki' | 'database' {
  const value = (node as Partial<PageNodeView>)['pageType'];
  return value === 'wiki' || value === 'database' ? value : 'page';
}

/** 祖先链（根 → 父），带 visited 防环。 */
export function ancestorsOf(id: string, byId: ReadonlyMap<string, PageNode>): PageNode[] {
  const chain: PageNode[] = [];
  const visited = new Set<string>([id]);
  let cursor = byId.get(id)?.parentId ?? null;
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const node = byId.get(cursor);
    if (node === undefined) {
      break;
    }
    chain.unshift(node);
    cursor = node.parentId;
  }
  return chain;
}

/** 面包屑文案：祖先标题 + 自身标题。 */
export function breadcrumbOf(id: string | null, byId: ReadonlyMap<string, PageNode>): string[] {
  if (id === null) {
    return [];
  }
  const self = byId.get(id);
  if (self === undefined) {
    return [];
  }
  return [...ancestorsOf(id, byId).map((node) => node.title), self.title];
}

/** 面包屑空标题的回退文案（与 main 侧 createPage 默认标题一致；T25-01 起走 i18n）。 */
function untitledLabel(): string {
  return t('common.untitled');
}

/**
 * 面包屑 item 链（T22-01 §0.A）：祖先链（根 → 当前页）逐段成 {label}；
 * 空标题回退「未命名」；id 为空/查不到 → 空数组（调用方自行回落工作区名）。
 */
export function breadcrumbItemsOf(
  id: string | null,
  byId: ReadonlyMap<string, PageNode>,
): Array<{ label: string }> {
  return breadcrumbOf(id, byId).map((title) => ({
    label: title.length > 0 ? title : untitledLabel(),
  }));
}

/**
 * pages 视图顶栏面包屑（T22-01 §0.A，纯函数便于测试）：
 * view='trash' → 「回收站」；有 selectedId → 祖先链（根→当前页，空标题回退）；
 * 无选中 → 工作区名（查不到活动工作区时回落「当前工作区」，与 SearchPage 同口径）。
 * settings/importWizard 视图不经过这里（App 侧保持既有文案）。
 */
export function pagesBreadcrumbItems(state: PagesState): Array<{ label: string }> {
  if (state.view === 'trash') {
    return [{ label: t('sidebar.trash') }];
  }
  if (state.selectedId !== null) {
    return breadcrumbItemsOf(state.selectedId, nodeMap(state.nodes));
  }
  const name = state.workspaces.find((item) => item.id === state.workspaceId)?.name;
  return [{ label: name ?? t('common.currentWorkspace') }];
}

// ---------------------------------------------------------------------------
// 桥 / 错误
// ---------------------------------------------------------------------------

function bridge(): SeptcatsApi {
  const value = (globalThis as { septcats?: SeptcatsApi }).septcats;
  if (value === undefined) {
    throw new Error('preload did not inject window.septcats');
  }
  return value;
}

/**
 * 用户可见错误统一走 errorText（T25-01 §0.B：错误码 → t() 键映射表，见 i18n/index.ts；
 * 未知码回落原始消息）。
 */
function describeError(error: unknown): string {
  return errorText(error);
}

let toastSeq = 0;

/**
 * T60-01 ⑤（PRD-R13 ⑦）：所有通知统一 3000ms 自动关闭。
 * 口径：hover 不暂停（老板「所有通知维持 3 秒」）；每条各自独立计时；
 * 手动关（关闭钮）/被队列上限 -3 挤掉时清掉对应定时器（无泄漏、无「关了又弹」）。
 */
export const TOAST_AUTO_DISMISS_MS = 3000;

/** id → 自动关闭定时器（唯一出口 pushToast 注册；dismiss/淘汰时清除）。 */
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearToastTimer(id: string): void {
  const timer = toastTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    toastTimers.delete(id);
  }
}

/** 出队单一入口（自动/手动/队列淘汰共用）。 */
function removeToast(id: string): void {
  clearToastTimer(id);
  pagesStore.setState((state) => ({ ...state, toasts: state.toasts.filter((toast) => toast.id !== id) }));
}

/** 应用级 Toast 入口（pagesActions 与命令面板共用；队列上限 3 条；3s 自动关闭）。 */
export function pushToast(message: string, tone: ToastTone): void {
  toastSeq += 1;
  const item: ToastMessage = { id: `toast-${String(toastSeq)}`, message, tone };
  pagesStore.setState((state) => {
    const next = [...state.toasts, item];
    // 超上限被挤掉的老条目：它的定时器一并清掉（不留下一次「静默 dismiss」）
    for (const dropped of next.slice(0, Math.max(0, next.length - 3))) {
      clearToastTimer(dropped.id);
    }
    return { ...state, toasts: next.slice(-3) };
  });
  toastTimers.set(
    item.id,
    setTimeout(() => {
      removeToast(item.id);
    }, TOAST_AUTO_DISMISS_MS),
  );
}

// ---------------------------------------------------------------------------
// 读 / 对账
// ---------------------------------------------------------------------------

async function fetchAll(workspaceId: string): Promise<{
  nodes: PageNodeView[];
  favoriteIds: string[];
  recentIds: string[];
}> {
  const api = bridge();
  const [nodes, favorites, recent] = await Promise.all([
    api.pages.tree({ workspaceId }),
    api.favorites.list(),
    api.recent.list(),
  ]);
  return { nodes, favoriteIds: favorites.pageIds, recentIds: recent.pageIds };
}

async function refresh(): Promise<void> {
  const { workspaceId } = pagesStore.getState();
  if (workspaceId === null) {
    return;
  }
  const data = await fetchAll(workspaceId);
  // T37-01：跨设备同步对账时页签随存活页裁剪（如他端删了已开标签的页）；
  // 选中项被裁掉走相邻回落（§0.5 同口径）。
  pagesStore.setState((state) => {
    const validIds = new Set(data.nodes.filter((node) => node.alive === 1).map((node) => node.id));
    const pruned = pruneTabs(state.tabs, validIds, state.selectedId);
    return { ...state, ...data, tabs: pruned.tabs, selectedId: pruned.activeId };
  });
}

interface Snapshot {
  nodes: PageNodeView[];
  favoriteIds: string[];
  recentIds: string[];
}

function takeSnapshot(): Snapshot {
  const { nodes, favoriteIds, recentIds } = pagesStore.getState();
  return { nodes, favoriteIds, recentIds };
}

/** 乐观更新 → 执行 IPC → 对账；失败回滚快照 + danger Toast。 */
async function optimistic(options: {
  apply: (state: PagesState) => Partial<PagesState>;
  run: () => Promise<void>;
  success?: string;
}): Promise<boolean> {
  const before = takeSnapshot();
  pagesStore.setState((state) => ({ ...state, ...options.apply(state) }));
  try {
    await options.run();
    if (options.success !== undefined) {
      pushToast(options.success, 'success');
    }
    await refresh();
    return true;
  } catch (error) {
    pagesStore.setState((state) => ({ ...state, ...before }));
    pushToast(describeError(error), 'danger');
    return false;
  }
}

function subtreeIds(nodes: readonly PageNode[], id: string): Set<string> {
  return new Set<string>([id, ...collectDescendants(id, childrenIndex(nodes))]);
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

export const pagesActions = {
  /** 首次加载：工作区列表 + 活动工作区 + 树 + 收藏/最近。 */
  async load(): Promise<void> {
    pagesStore.setState((state) => ({ ...state, status: 'loading', error: null }));
    try {
      const listed = await bridge().workspaces.list();
      const activeId = listed.activeId;
      if (activeId === null) {
        throw new Error('E_NO_WORKSPACE');
      }
      const data = await fetchAll(activeId);
      // T37-01 §0.4：按 workspace 恢复页签（集合+顺序+选中项）；损坏记录/已不存在的
      // 页签裁剪到存活页（pruneTabs 内含选中项的相邻回落）。无记录 → 空集合走既有
      // 首屏自动选中；有记录（含「全关」空集合）→ 以还原为准，不再自动开页。
      const saved = readTabs(activeId);
      const aliveIds = new Set(data.nodes.filter((node) => node.alive === 1).map((node) => node.id));
      const restored = saved !== null ? pruneTabs(saved.tabs, aliveIds, saved.activeId) : null;
      pagesStore.setState((state) => ({
        ...state,
        status: 'ready',
        error: null,
        workspaces: listed.items,
        workspaceId: activeId,
        ...data,
        tabs: restored !== null ? restored.tabs : [],
        // 损坏记录兜底：activeId 缺失但集合非空 → 归位到第一个页签
        selectedId: restored !== null ? (restored.activeId ?? restored.tabs[0] ?? null) : null,
      }));
      // T21-02 §0.2：无持久化页签记录时仍选中首个可达页（现经 openInTab 落一个标签）
      if (restored === null) {
        pagesActions.ensureSelection();
      }
      // T41-01 §1.4：活动工作区就位后同步「全宽/固定宽度」集合（首次加载与
      // switchWorkspace 都汇入 load，切工作区/重开各还原各的）
      pageWidthActions.syncWorkspace(activeId);
    } catch (error) {
      pagesStore.setState((state) => ({ ...state, status: 'error', error: describeError(error) }));
    }
  },

  /** 服务端对账（乐观更新落地后调用；失败只弹 Toast，不改变本地视图）。 */
  async refresh(): Promise<void> {
    try {
      await refresh();
    } catch (error) {
      pushToast(describeError(error), 'danger');
    }
  },

  ensureSelection(): void {
    const state = pagesStore.getState();
    if (state.selectedId !== null) {
      return;
    }
    const alive = aliveNodes(state.nodes);
    const root = alive.find((node) => node.parentId === null) ?? alive[0];
    if (root !== undefined) {
      // T37-01：首屏自动选中 = 打开页 → 统一走 openInTab（落一个标签并持久化）
      pagesActions.openInTab(root.id);
    }
  },

  /**
   * T37-01 §0.1：**打开页面的统一入口**。侧栏行点击、搜索/命令面板命中跳转、
   * 模板新建后选中、回收站恢复后打开、新建/转换落点——全部经此；页已打开 →
   * 只切换选中（同页不重复开），未打开 → 追加为新标签（最右）。
   * 附带既有副作用：祖先展开、touchRecent、回到 pages 视图；并持久化页签快照。
   */
  openInTab(id: string): void {
    const before = pagesStore.getState();
    const { tabs } = openInTabs(before.tabs, id);
    pagesStore.setState((state) => {
      const expanded = new Set(state.expanded);
      for (const ancestor of ancestorsOf(id, nodeMap(state.nodes))) {
        expanded.add(ancestor.id);
      }
      return { ...state, tabs, selectedId: id, editingId: null, view: 'pages', expanded };
    });
    writeTabs(before.workspaceId, tabs, id);
    void pagesActions.touchRecent(id);
  },

  /**
   * T37-01 §0.7：关闭标签 ≠ 删除页面——只改页签集合与选中项（§0.5 相邻回落），
   * 绝不发起 pages.remove / 回收站逻辑。
   */
  closeTab(id: string): void {
    const state = pagesStore.getState();
    const next = closeTabFallback(state.tabs, id, state.selectedId);
    pagesStore.setState((current) => ({
      ...current,
      tabs: next.tabs,
      selectedId: next.activeId,
      editingId: current.editingId === id ? null : current.editingId,
    }));
    writeTabs(state.workspaceId, next.tabs, next.activeId);
  },

  /** T37-01 §0.2：拖拽排序（选中项不变）；顺序持久化。 */
  moveTabTo(id: string, toIndex: number): void {
    const state = pagesStore.getState();
    const tabs = moveTab(state.tabs, id, toIndex);
    if (tabs.every((value, index) => value === state.tabs[index])) {
      return;
    }
    pagesStore.setState((current) => ({ ...current, tabs }));
    writeTabs(state.workspaceId, tabs, state.selectedId);
  },

  /** 页面选中（既有入口，T37-01 起委托 openInTab：选中即打开页签）。 */
  selectPage(id: string): void {
    pagesActions.openInTab(id);
  },

  setScope(scope: TreeScope): void {
    pagesStore.setState((state) => ({ ...state, scope }));
  },

  showTrash(): void {
    pagesStore.setState((state) => ({ ...state, view: 'trash' }));
  },

  showPages(): void {
    pagesStore.setState((state) => ({ ...state, view: 'pages' }));
  },

  toggleExpand(id: string): void {
    pagesStore.setState((state) => {
      const expanded = new Set(state.expanded);
      if (expanded.has(id)) {
        expanded.delete(id);
      } else {
        expanded.add(id);
      }
      return { ...state, expanded };
    });
  },

  beginRename(id: string): void {
    pagesStore.setState((state) => ({ ...state, editingId: id }));
  },

  cancelRename(): void {
    pagesStore.setState((state) => ({ ...state, editingId: null }));
  },

  /** T24-01 §0.A：请求删除页面（开二次确认弹层；命令面板与侧栏行菜单共用入口）。 */
  requestDeletePage(id: string): void {
    if (id.length === 0) {
      return;
    }
    pagesStore.setState((state) => ({ ...state, deleteConfirmId: id }));
  },

  cancelDeletePage(): void {
    pagesStore.setState((state) => ({ ...state, deleteConfirmId: null }));
  },

  /**
   * T24-01 §0.A：确认删除（PageDeleteDialog 的确认回调）→ 软删（store 既有 deletePage，
   * 乐观更新 + 失败回滚 + 对账，侧栏树/收藏/最近/回收站角标随 refresh 同步）→
   * 回到 pages 视图 → 选中回落（无选中时 ensureSelection 选首个可达页）。
   */
  async confirmDeletePage(): Promise<void> {
    const id = pagesStore.getState().deleteConfirmId;
    if (id === null) {
      return;
    }
    pagesStore.setState((state) => ({ ...state, deleteConfirmId: null }));
    await pagesActions.deletePage(id);
    pagesActions.showPages();
    pagesActions.ensureSelection();
  },

  dismissToast(id: string): void {
    removeToast(id);
  },

  async createPage(parentId: string | null): Promise<void> {
    try {
      const created = await bridge().pages.create({ parentId });
      await refresh();
      // T37-01 §0.1：新建页 = 打开页 → 统一走 openInTab（页签落地+持久化+祖先展开）
      pagesActions.openInTab(created.id);
      // 既有行为保留：新建页进入行内重命名（openInTab 不设置 editingId）
      pagesStore.setState((state) =>
        state.selectedId === created.id ? { ...state, editingId: created.id } : state,
      );
    } catch (error) {
      pushToast(describeError(error), 'danger');
    }
  },

  async renamePage(id: string, title: string): Promise<void> {
    await optimistic({
      apply: (state) => ({
        nodes: state.nodes.map((node) => (node.id === id ? { ...node, title } : node)),
      }),
      run: async () => {
        await bridge().pages.rename({ id, title });
      },
    });
    pagesStore.setState((state) => (state.editingId === id ? { ...state, editingId: null } : state));
  },

  /**
   * T42-01：页面承载类型双向转换（普通页 ↔ Wiki）。转换不动正文块/子页/收藏/
   * 最近/页签（内容零丢失）；成功后 refresh() 对账——侧栏分区、落地页、页签标题
   * 全部随 nodes 更新实时生效。
   */
  async convertPage(id: string, to: 'wiki' | 'page'): Promise<void> {
    try {
      await bridge().pages.convert({ pageId: id, to });
      await refresh();
      pushToast(to === 'wiki' ? t('pages.toastConvertedToWiki') : t('pages.toastConvertedToPage'), 'success');
    } catch (error) {
      pushToast(describeError(error), 'danger');
    }
  },

  async movePage(input: {
    id: string;
    newParentId: string | null;
    newSortKey?: string;
    placeAfterId?: string;
  }): Promise<boolean> {
    const sortKey = input.newSortKey;
    return optimistic({
      apply: (state) => ({
        nodes: state.nodes.map((node) =>
          node.id === input.id
            ? {
                ...node,
                parentId: input.newParentId,
                sortKey: sortKey ?? node.sortKey,
              }
            : node,
        ),
      }),
      run: async () => {
        await bridge().pages.move(input);
      },
    });
  },

  async deletePage(id: string): Promise<void> {
    const targets = subtreeIds(pagesStore.getState().nodes, id);
    const ok = await optimistic({
      apply: (state) => ({
        nodes: state.nodes.map((node) =>
          targets.has(node.id) ? { ...node, alive: 0 as const, deletedAt: Date.now() } : node,
        ),
      }),
      run: async () => {
        await bridge().pages.remove({ id });
      },
      success: t('pages.toastTrashed'),
    });
    if (ok) {
      // T37-01 §0.6/§0.7：被删页（含子树）的标签随之移除；删的是当前标签 →
      // 相邻回落（右优先/左邻），与关标签同口径。这不是「关标签删页」，
      // 而是删页后清理指向它的标签。
      pagesStore.setState((state) => {
        const validIds = new Set(aliveNodes(state.nodes).map((node) => node.id));
        const next = pruneTabs(state.tabs, validIds, state.selectedId);
        return {
          ...state,
          tabs: next.tabs,
          selectedId: next.activeId,
          editingId:
            state.editingId !== null && targets.has(state.editingId) ? null : state.editingId,
        };
      });
      const settled = pagesStore.getState();
      writeTabs(settled.workspaceId, settled.tabs, settled.selectedId);
    }
  },

  /** T37-01 §0.1：恢复后打开该页（返回是否恢复成功，供调用方决定 openInTab）。 */
  async restorePage(id: string): Promise<boolean> {
    const targets = subtreeIds(pagesStore.getState().nodes, id);
    const ok = await optimistic({
      apply: (state) => ({
        nodes: state.nodes.map((node) =>
          targets.has(node.id) && node.alive === 0
            ? { ...node, alive: 1 as const, deletedAt: null }
            : node,
        ),
      }),
      run: async () => {
        await bridge().pages.restore({ id });
      },
      success: t('pages.toastRestored'),
    });
    return ok;
  },

  /** 彻底删除（级联整棵 tombstone 子树；物理清除归 GC 任务）。 */
  async purgePage(id: string): Promise<void> {
    const targets = subtreeIds(pagesStore.getState().nodes, id);
    await optimistic({
      apply: (state) => ({
        nodes: state.nodes.map((node) => (targets.has(node.id) ? { ...node, deletedAt: 0 } : node)),
      }),
      run: async () => {
        await bridge().pages.purge({ id });
      },
      success: t('pages.toastPurged'),
    });
  },

  /** 清空回收站：对每个「回收站根」级联彻底删除（子项随父一起走）。 */
  async purgeAllTrash(): Promise<void> {
    const state = pagesStore.getState();
    const trash = trashNodes(state.nodes);
    if (trash.length === 0) {
      return;
    }
    const trashIds = new Set(trash.map((node) => node.id));
    const roots = trash.filter((node) => node.parentId === null || !trashIds.has(node.parentId));
    const allTargets = new Set(trash.map((node) => node.id));
    await optimistic({
      apply: (current) => ({
        nodes: current.nodes.map((node) => (allTargets.has(node.id) ? { ...node, deletedAt: 0 } : node)),
      }),
      run: async () => {
        const api = bridge();
        for (const root of roots) {
          await api.pages.purge({ id: root.id });
        }
      },
      success: t('pages.toastTrashEmptied'),
    });
  },

  async toggleFavorite(id: string): Promise<void> {
    const on = !pagesStore.getState().favoriteIds.includes(id);
    await optimistic({
      apply: (state) => ({
        favoriteIds: on ? [id, ...state.favoriteIds.filter((item) => item !== id)] : state.favoriteIds.filter((item) => item !== id),
      }),
      run: async () => {
        await bridge().favorites.set({ pageId: id, on });
      },
      success: on ? t('pages.toastFavorited') : t('pages.toastUnfavorited'),
    });
  },

  async touchRecent(id: string): Promise<void> {
    try {
      const result = await bridge().recent.touch({ pageId: id });
      pagesStore.setState((state) => ({ ...state, recentIds: result.pageIds }));
    } catch (error) {
      pushToast(describeError(error), 'danger');
    }
  },

  async createWorkspace(name: string): Promise<void> {
    try {
      await bridge().workspaces.create({ name });
      await pagesActions.load();
      pushToast(t('pages.toastWorkspaceCreated'), 'success');
    } catch (error) {
      pushToast(describeError(error), 'danger');
    }
  },

  async renameWorkspace(id: string, name: string): Promise<void> {
    await optimistic({
      apply: (state) => ({
        workspaces: state.workspaces.map((item) => (item.id === id ? { ...item, name } : item)),
      }),
      run: async () => {
        await bridge().workspaces.rename({ id, name });
      },
    });
  },

  async switchWorkspace(id: string): Promise<void> {
    try {
      await bridge().workspaces.switch({ id });
      await pagesActions.load();
      pushToast(t('pages.toastWorkspaceSwitched'), 'success');
    } catch (error) {
      pushToast(describeError(error), 'danger');
    }
  },
};

// ---------------------------------------------------------------------------
// 拖拽落点 → move 入参（renderer 侧能算键就算，算不出交给 main 重平衡）
// ---------------------------------------------------------------------------

export interface DropPlanInput {
  id: string;
  newParentId: string | null;
  /** 目标层里插入位置的“前一个兄弟”（视觉序）；null = 插到最前。 */
  previous: PageNode | null;
  /** 插入位置的“后一个兄弟”；null = 追加到末尾。 */
  next: PageNode | null;
}

export interface DropPlan {
  id: string;
  newParentId: string | null;
  newSortKey?: string;
  placeAfterId?: string;
}

/**
 * 计算 move 入参：`sortBetween(prev, next)` 成功就带上 newSortKey；
 * 相邻键之间已无空位（InvalidSortRange）→ 只给 `placeAfterId`，由 main 侧整层重平衡。
 */
export function planPageDrop(input: DropPlanInput): DropPlan {
  const plan: DropPlan = { id: input.id, newParentId: input.newParentId };
  try {
    plan.newSortKey = sortBetween(input.previous?.sortKey ?? null, input.next?.sortKey ?? null);
  } catch {
    if (input.previous !== null) {
      plan.placeAfterId = input.previous.id;
    }
  }
  return plan;
}
