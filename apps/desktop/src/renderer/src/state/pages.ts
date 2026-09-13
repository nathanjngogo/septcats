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
import type { SeptcatsApi, WorkspaceSummary } from '../../../types/window';
import { createStore, useStore } from './store';

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
  /** alive + deleted 全量（purge 过的行 deletedAt=0，视图层自行过滤）。 */
  nodes: PageNode[];
  expanded: Set<string>;
  selectedId: string | null;
  editingId: string | null;
  favoriteIds: string[];
  recentIds: string[];
  toasts: ToastMessage[];
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
};

export const pagesStore = createStore<PagesState>(initialState);

/** 选择器订阅（选择器请返回引用稳定的切片）。 */
export function usePages<T>(selector: (state: PagesState) => T): T {
  return useStore(pagesStore, selector);
}

// ---------------------------------------------------------------------------
// 派生工具（组件复用；纯函数）
// ---------------------------------------------------------------------------

export function aliveNodes(nodes: readonly PageNode[]): PageNode[] {
  return nodes.filter((node) => node.alive === 1);
}

/** 回收站项：软删除（deletedAt > 0）；彻底删除（deletedAt=0）不再露出。 */
export function trashNodes(nodes: readonly PageNode[]): PageNode[] {
  return nodes.filter((node) => node.alive === 0 && node.deletedAt !== null && node.deletedAt > 0);
}

export function nodeMap(nodes: readonly PageNode[]): Map<string, PageNode> {
  return new Map(nodes.map((node) => [node.id, node]));
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

// ---------------------------------------------------------------------------
// 桥 / 错误
// ---------------------------------------------------------------------------

function bridge(): SeptcatsApi {
  const value = (globalThis as { septcats?: SeptcatsApi }).septcats;
  if (value === undefined) {
    throw new Error('preload 未注入 window.septcats（渲染器无法访问数据层）');
  }
  return value;
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  E_CYCLE: '不能把页面移动到它自己的子页面下',
  E_PARENT_GONE: '目标父页面不存在，或仍在回收站',
  E_NOT_FOUND: '页面不存在或已被删除',
  E_NO_WORKSPACE: '没有可用的工作区',
  E_MALFORMED: '请求参数不合法',
};

function errorCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /\bE_[A-Z_]+\b/.exec(message);
  return match === null ? null : match[0];
}

function describeError(error: unknown): string {
  const code = errorCode(error);
  if (code !== null) {
    const mapped = ERROR_MESSAGES[code];
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

let toastSeq = 0;

function pushToast(message: string, tone: ToastTone): void {
  toastSeq += 1;
  const item: ToastMessage = { id: `toast-${String(toastSeq)}`, message, tone };
  pagesStore.setState((state) => ({ ...state, toasts: [...state.toasts, item].slice(-3) }));
}

// ---------------------------------------------------------------------------
// 读 / 对账
// ---------------------------------------------------------------------------

async function fetchAll(workspaceId: string): Promise<{
  nodes: PageNode[];
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
  pagesStore.setState((state) => ({ ...state, ...data }));
}

interface Snapshot {
  nodes: PageNode[];
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
        throw new Error('E_NO_WORKSPACE: 没有可用的工作区');
      }
      const data = await fetchAll(activeId);
      pagesStore.setState((state) => ({
        ...state,
        status: 'ready',
        error: null,
        workspaces: listed.items,
        workspaceId: activeId,
        ...data,
      }));
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
      pagesStore.setState((current) => ({ ...current, selectedId: root.id }));
    }
  },

  selectPage(id: string): void {
    pagesStore.setState((state) => {
      const expanded = new Set(state.expanded);
      for (const ancestor of ancestorsOf(id, nodeMap(state.nodes))) {
        expanded.add(ancestor.id);
      }
      return { ...state, selectedId: id, editingId: null, view: 'pages', expanded };
    });
    void pagesActions.touchRecent(id);
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

  dismissToast(id: string): void {
    pagesStore.setState((state) => ({ ...state, toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  async createPage(parentId: string | null): Promise<void> {
    try {
      const created = await bridge().pages.create({ parentId });
      await refresh();
      pagesStore.setState((state) => {
        const expanded = parentId === null ? state.expanded : new Set([...state.expanded, parentId]);
        return { ...state, expanded, selectedId: created.id, editingId: created.id, view: 'pages' };
      });
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
      success: '已移入回收站',
    });
    if (ok) {
      pagesStore.setState((state) =>
        state.selectedId !== null && targets.has(state.selectedId)
          ? { ...state, selectedId: null, editingId: null }
          : state,
      );
    }
  },

  async restorePage(id: string): Promise<void> {
    const targets = subtreeIds(pagesStore.getState().nodes, id);
    await optimistic({
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
      success: '已恢复',
    });
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
      success: '已彻底删除',
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
      success: '回收站已清空',
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
      success: on ? '已移入收藏' : '已移出收藏',
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
      pushToast('已创建工作区', 'success');
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
      pushToast('已切换工作区', 'success');
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
