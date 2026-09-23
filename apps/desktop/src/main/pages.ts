/**
 * pages.ts —— 主进程页面树/工作区服务（TASK-T6-01 §3）。
 *
 * 纪律：
 * - **本文件不 import electron**（IPC 注册在 `main/index.ts`），因此在 vitest 的纯 Node
 *   环境里可以直连 better-sqlite3 跑端到端断言（`test/pages.test.ts`）；
 * - **一切写路径先造 Op，再 `commitOps` 批量落库**（op_ledger + 物化同事务），
 *   本文件不出现任何裸 SQL/物化直写 —— 旁路 = 审计打回；
 * - 活动工作区（Q4 单库多工作区分片）记在 `meta.active_workspace_id`：
 *   `workspace:switch` 只改它 + 通知 renderer 重载树，**DbHandle 指向不变**；
 * - favorite/recent 是设备本地派生态（user_key = meta.device_id），不进 Op 真相层。
 */
import { sortBetween, sortSequence, ulid } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';
import {
  TreeCycleError,
  buildTree,
  cascadeDeleteOps,
  childrenIndex,
  collectDescendants,
  comparePageOrder,
  planRestore,
  rebalanceLayer,
  type PageNode,
  type TreeContext,
} from '@septcats/editor';
import { commitOps } from './commit';
// T67-01-B1 PM 修正：不 import './lock'——purge 是两行纯 SQL，但 lock.ts 顶部
// node:crypto/Buffer 会顺 import 链拖进 tsconfig.web（types:[] renderer 边界）炸 26 错。
// 调用点内联同名语句（lock.ts 的 purgeLockForPage 保留供 lock service 内部复用）。
import type { AllData, BatchData, DbBatchStatement, GetData, RunData } from '../db/rpc';

/** 服务工作所需的语句执行能力（`DbHandle` 结构上满足；测试注入 DbServerCore 适配器）。 */
export interface StatementExecutor {
  run(sqlId: string, params?: unknown): Promise<RunData>;
  get(sqlId: string, params?: unknown): Promise<GetData>;
  all(sqlId: string, params?: unknown): Promise<AllData>;
  batch(stmts: readonly DbBatchStatement[]): Promise<BatchData>;
}

export type PagesErrorCode =
  | 'E_NOT_FOUND'
  | 'E_PARENT_GONE'
  | 'E_CYCLE'
  | 'E_MALFORMED'
  | 'E_NO_WORKSPACE'
  | 'E_INVARIANT';

export class PagesApiError extends Error {
  readonly code: PagesErrorCode;

  constructor(code: PagesErrorCode, message: string) {
    super(message);
    this.name = 'PagesApiError';
    this.code = code;
    Object.setPrototypeOf(this, PagesApiError.prototype);
  }
}

export interface WorkspaceSummary {
  id: string;
  name: string;
}

/**
 * 页面承载类型（TASK-T42-01 口径 A：Wiki = 一类页面）。
 * - `page`：普通文档页（默认，含旧版本写入的全部存量行）；
 * - `wiki`：Wiki 页（落地页 = 标题 + 简介 + 子页索引）；
 * - `database`：行内数据库页（既有范式：存活 collection 行存在，T7b）。
 */
// T64-01：扩 'folder'（页面树容器节点）
export type PageType = 'page' | 'wiki' | 'database' | 'folder';

/**
 * 树节点 + 承载注解（T42-01）：`PageNode` 之上追加 renderer 直接可用的三类字段。
 * 三个注解**均可缺省**（`PageNode` 结构上仍是合法 `PageNodeView`）：
 * 读取一律经 `pageTypeOf` 等兜底口径（缺省 = 普通页/无简介/无时间），
 * 与「旧库/旧夹具/旧版本桥接数据没有注解」的现状兼容。main 侧 `toNode` 恒填充。
 * - `pageType`：**读路径权威判定** = 存活 collection 行存在 → 'database'（复用既有
 *   「collection 行与 page 关联」范式，旧版本建的库页照常识别）；否则取 v8 列
 *   `page.page_type`（缺省 'page'）；
 * - `summary`：Wiki 落地页简介（独立于正文块；v8 列，随 page upsert op 走账本）；
 * - `updatedAt`：page.updated_at（子页索引「末次更新时间」展示用）。
 */
export interface PageNodeView extends PageNode {
  pageType?: PageType;
  summary?: string | null;
  updatedAt?: number | null;
}

export interface MovePageInput {
  id: string;
  newParentId: string | null;
  /** 显式排序键（renderer 已算好）。缺省时用 placeAfterId / 追加到末尾推导。 */
  newSortKey?: string;
  /** 放到该兄弟之后；缺省 = 追加到目标层末尾（密集无空位时自动整层重平衡）。 */
  placeAfterId?: string;
}

export interface MovePageResult {
  sortKey: string;
  /** 密集无空位 → 触发整层重平衡（一批 reorder）时为 true。 */
  rebalanced: boolean;
  opCount: number;
}

export interface PagesService {
  listWorkspaces(): Promise<{ items: WorkspaceSummary[]; activeId: string | null }>;
  createWorkspace(input: { name: string }): Promise<{ id: string }>;
  renameWorkspace(input: { id: string; name: string }): Promise<{ id: string }>;
  switchWorkspace(input: { id: string }): Promise<{ activeId: string }>;

  listTree(input: { workspaceId: string }): Promise<PageNodeView[]>;
  createPage(input: { parentId: string | null }): Promise<{ id: string; sortKey: string }>;
  /** T64-01：新建文件夹（page_type='folder'，标题由调用方按 locale 传入）。 */
  createFolder(input: { parentId: string | null; title: string }): Promise<{ id: string; sortKey: string }>;
  renamePage(input: { id: string; title: string }): Promise<{ id: string }>;
  movePage(input: MovePageInput): Promise<MovePageResult>;
  deletePage(input: { id: string }): Promise<{ deleted: number }>;
  restorePage(input: { id: string }): Promise<{ restored: number }>;
  /** 「彻底删除」：从回收站即时移除（deleted_at=0），物理清除归 GC 任务。 */
  purgePage(input: { id: string }): Promise<{ purged: number }>;

  setFavorite(input: { pageId: string; on: boolean }): Promise<{ pageIds: string[] }>;
  listFavorites(): Promise<{ pageIds: string[] }>;
  touchRecent(input: { pageId: string }): Promise<{ pageIds: string[] }>;
  listRecent(): Promise<{ pageIds: string[] }>;
}

export interface PagesServiceOptions {
  readonly executor: StatementExecutor;
  readonly actor: ActorId;
  readonly now?: () => number;
  /** 覆盖 user_key（缺省取 meta.device_id，设备本地）。 */
  readonly userKey?: string;
  /**
   * 首次自动建工作区的种子名（T27-01 §0.A：按「创建时 locale」传入；
   * 缺省回落 DEFAULT_WORKSPACE_NAME，既有调用方行为不变）。
   */
  readonly defaultWorkspaceName?: string;
}

const DEFAULT_WORKSPACE_NAME = '个人工作区';
const ACTIVE_WORKSPACE_META_KEY = 'active_workspace_id';
const DEVICE_ID_META_KEY = 'device_id';

/**
 * 创建时 locale → 默认工作区种子名（T27-01 §0.A）。与 renderer i18n 的
 * `workspace.defaultName`（zh-CN=个人工作区 / en-US=Personal Workspace）同口径；
 * zh* 一律中文，其余（含空串）回落英文。供 main/index.ts 接线 `app.getLocale()` 用。
 */
export function defaultWorkspaceNameForLocale(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? '个人工作区' : 'Personal Workspace';
}

/** page 行（`SELECT *` 的列：schema-v1 §6.2 + v2 的 deleted_at + v8 的 page_type/summary）。 */
interface PageRow {
  id: string;
  workspace_id: string;
  title: string | null;
  icon: string | null;
  cover: string | null;
  parent_id: string | null;
  sort_key: string;
  alive: number;
  version: number;
  deleted_at: number | null;
  page_type: string | null;
  summary: string | null;
  updated_at: number | null;
}

function rowToString(row: unknown, key: string): string | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
}

function rowToNumber(row: unknown, key: string, fallback: number): number {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rowToNullableNumber(row: unknown, key: string): number | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toPageRow(row: unknown): PageRow {
  const id = rowToString(row, 'id');
  const workspaceId = rowToString(row, 'workspace_id');
  const sortKey = rowToString(row, 'sort_key');
  if (id === null || workspaceId === null || sortKey === null) {
    throw new PagesApiError('E_INVARIANT', 'page 行缺少 id/workspace_id/sort_key');
  }
  return {
    id,
    workspace_id: workspaceId,
    title: rowToString(row, 'title'),
    icon: rowToString(row, 'icon'),
    cover: rowToString(row, 'cover'),
    parent_id: rowToString(row, 'parent_id'),
    sort_key: sortKey,
    alive: rowToNumber(row, 'alive', 1) === 0 ? 0 : 1,
    version: rowToNumber(row, 'version', 1),
    deleted_at: rowToNullableNumber(row, 'deleted_at'),
    page_type: rowToString(row, 'page_type'),
    summary: rowToString(row, 'summary'),
    updated_at: rowToNullableNumber(row, 'updated_at'),
  };
}

function toNode(row: PageRow, dbPageIds: ReadonlySet<string>): PageNodeView {
  const pageType: PageType = dbPageIds.has(row.id)
    ? 'database'
    : row.page_type === 'wiki' || row.page_type === 'database' || row.page_type === 'folder'
      ? row.page_type
      : 'page';
  return {
    id: row.id,
    title: row.title ?? '',
    icon: row.icon,
    cover: row.cover,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    sortKey: row.sort_key,
    version: row.version,
    alive: row.alive === 0 ? 0 : 1,
    deletedAt: row.deleted_at,
    childIds: [],
    depth: 0,
    pageType,
    summary: row.summary,
    updatedAt: row.updated_at,
  };
}

/**
 * 派生 childIds/depth（renderer 直接可用）。`buildTree` 的产物是副本，
 * 这里把根与全部子节点合并成一份「已派生」的节点表；parent 链成环 → TreeCycleError 上抛。
 * 泛型 T（T42-01 的 PageNodeView）：buildTree 内部按 `{ ...page, childIds, depth }`
 * 浅拷贝，承载注解（pageType/summary/updatedAt）在运行时原样保留，类型层用断言收口。
 */
function withDerivedNodes<T extends PageNode>(nodes: readonly T[]): T[] {
  const index = buildTree(nodes);
  const out: T[] = [...(index.roots as T[])];
  const seen = new Set(out.map((node) => node.id));
  for (const list of index.childrenOf.values()) {
    for (const node of list) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        out.push(node as T);
      }
    }
  }
  return out;
}

export function createPagesService(options: PagesServiceOptions): PagesService {
  const { executor, actor } = options;
  const now = options.now ?? ((): number => Date.now());
  let cachedUserKey: string | null = options.userKey ?? null;

  const ctx = (): TreeContext => ({ actor, now: now() });

  async function metaValue(key: string): Promise<string | null> {
    const data = await executor.get('meta.get', { key });
    return rowToString(data.row, 'value');
  }

  async function setMetaValue(key: string, value: string): Promise<void> {
    await executor.run('meta.set', { key, value });
  }

  async function userKey(): Promise<string> {
    if (cachedUserKey !== null) {
      return cachedUserKey;
    }
    const deviceId = await metaValue(DEVICE_ID_META_KEY);
    if (deviceId === null || deviceId.length === 0) {
      throw new PagesApiError('E_INVARIANT', 'meta.device_id 缺失，无法定位设备本地用户键');
    }
    cachedUserKey = deviceId;
    return deviceId;
  }

  async function workspaceRows(): Promise<WorkspaceSummary[]> {
    const data = await executor.all('workspace.list');
    return data.rows.map((row) => ({
      id: rowToString(row, 'id') ?? '',
      name: rowToString(row, 'name') ?? '',
    }));
  }

  async function createWorkspaceRow(name: string): Promise<string> {
    const id = ulid(now());
    await executor.run('workspace.upsert', {
      id,
      name,
      root_page_id: null,
      settings_json: '{}',
      created_at: now(),
    });
    return id;
  }

  /**
   * 解析活动工作区：没有工作区就建默认工作区（首次运行即开箱可用；种子名按
   * T27-01 §0.A 取 options.defaultWorkspaceName，未注入时回落中文缺省）；
   * meta 里的活动 id 失效时回落到第一个。**这是唯一的读路径写入**，幂等。
   */
  async function requireActiveWorkspace(): Promise<string> {
    let items = await workspaceRows();
    if (items.length === 0) {
      await createWorkspaceRow(options.defaultWorkspaceName ?? DEFAULT_WORKSPACE_NAME);
      items = await workspaceRows();
    }
    const first = items[0];
    if (first === undefined) {
      throw new PagesApiError('E_NO_WORKSPACE', '无法创建工作区');
    }
    const active = await metaValue(ACTIVE_WORKSPACE_META_KEY);
    if (active !== null && items.some((item) => item.id === active)) {
      return active;
    }
    await setMetaValue(ACTIVE_WORKSPACE_META_KEY, first.id);
    return first.id;
  }

  async function loadNodes(workspaceId: string): Promise<PageNodeView[]> {
    const [data, collections] = await Promise.all([
      executor.all('page.listAll', { workspace_id: workspaceId }),
      executor.all('collection.listByWorkspace', { workspace_id: workspaceId }),
    ]);
    // T42-01：数据库页判定沿用既有范式（§0.2）——存活 collection 行存在 → 'database'。
    // 旧版本建的库页（page_type 列缺省 'page'）由此照常识别，不依赖新列。
    const dbPageIds = new Set(
      collections.rows
        .map((row) => rowToString(row, 'page_id'))
        .filter((id): id is string => id !== null),
    );
    return data.rows.map((row) => toNode(toPageRow(row), dbPageIds));
  }

  async function requirePage(
    workspaceId: string,
    id: string,
    requireAlive = true,
  ): Promise<{ node: PageNodeView; all: PageNodeView[] }> {
    const all = await loadNodes(workspaceId);
    const node = all.find((candidate) => candidate.id === id);
    if (node === undefined || (requireAlive && node.alive === 0)) {
      throw new PagesApiError('E_NOT_FOUND', `页面不存在或已删除：${id}`);
    }
    return { node, all };
  }

  /** 目标层（同 parent、存活、不含自身）按视觉序。 */
  function siblingsOf(
    nodes: readonly PageNode[],
    parentId: string | null,
    excludeId: string | null,
  ): PageNode[] {
    return nodes
      .filter((node) => node.alive === 1 && node.parentId === parentId && node.id !== excludeId)
      .sort(comparePageOrder);
  }

  function upsertOp(
    node: Omit<PageNode, 'childIds' | 'depth'>,
    c: TreeContext,
    pageType: PageType = 'page',
  ): Op {
    return {
      op_id: ulid(c.now),
      lamport: { c: Math.max(1, node.version + 1), d: c.actor },
      at: c.now,
      actor: c.actor,
      target: { table: 'page', id: node.id },
      kind: 'upsert',
      payload: {
        workspace_id: node.workspaceId,
        title: node.title,
        icon: node.icon,
        cover: node.cover,
        parent_id: node.parentId,
        sort_key: node.sortKey,
        alive: node.alive,
        deleted_at: node.deletedAt,
        updated_at: c.now,
        // T64-01：page_type 随整对象 upsert 落库（folder = 树容器节点）
        page_type: pageType,
      },
    };
  }

  function moveOp(
    node: PageNode,
    parentId: string | null,
    sortKey: string,
    c: TreeContext,
  ): Op {
    return {
      op_id: ulid(c.now),
      lamport: { c: Math.max(1, node.version + 1), d: c.actor },
      at: c.now,
      actor: c.actor,
      target: { table: 'page', id: node.id },
      kind: 'move',
      payload: { parent_id: parentId, sort_key: sortKey, updated_at: c.now },
      base: node.version,
    };
  }

  async function favoriteIds(workspaceId: string, key: string): Promise<string[]> {
    const data = await executor.all('favorite.list', { user_key: key, workspace_id: workspaceId });
    return data.rows.map((row) => rowToString(row, 'page_id')).filter((id): id is string => id !== null);
  }

  async function recentIds(workspaceId: string, key: string): Promise<string[]> {
    const data = await executor.all('recent.list', { user_key: key, workspace_id: workspaceId });
    return data.rows.map((row) => rowToString(row, 'page_id')).filter((id): id is string => id !== null);
  }

  return {
    // ---- 工作区 -----------------------------------------------------------
    async listWorkspaces() {
      const activeId = await requireActiveWorkspace();
      return { items: await workspaceRows(), activeId };
    },

    async createWorkspace(input) {
      const name = input.name.trim();
      if (name.length === 0) {
        throw new PagesApiError('E_MALFORMED', '工作区名不能为空');
      }
      return { id: await createWorkspaceRow(name) };
    },

    async renameWorkspace(input) {
      const name = input.name.trim();
      if (name.length === 0) {
        throw new PagesApiError('E_MALFORMED', '工作区名不能为空');
      }
      const found = await executor.get('workspace.get', { id: input.id });
      if (found.row === null) {
        throw new PagesApiError('E_NOT_FOUND', `工作区不存在：${input.id}`);
      }
      await executor.run('workspace.upsert', {
        id: input.id,
        name,
        root_page_id: rowToString(found.row, 'root_page_id'),
        settings_json: rowToString(found.row, 'settings_json') ?? '{}',
        created_at: rowToNumber(found.row, 'created_at', now()),
      });
      return { id: input.id };
    },

    async switchWorkspace(input) {
      const found = await executor.get('workspace.get', { id: input.id });
      if (found.row === null) {
        throw new PagesApiError('E_NOT_FOUND', `工作区不存在：${input.id}`);
      }
      // Q4 单库分片：只换活动 id，DbHandle 指向不变（不重建、不迁移文件）
      await setMetaValue(ACTIVE_WORKSPACE_META_KEY, input.id);
      return { activeId: input.id };
    },

    // ---- 页面树 -----------------------------------------------------------
    async listTree(input) {
      if (input.workspaceId.length === 0) {
        throw new PagesApiError('E_MALFORMED', 'workspaceId 必填');
      }
      return withDerivedNodes(await loadNodes(input.workspaceId));
    },

    async createPage(input) {
      const workspaceId = await requireActiveWorkspace();
      const nodes = await loadNodes(workspaceId);
      const c = ctx();

      if (input.parentId !== null) {
        const parent = nodes.find((node) => node.id === input.parentId);
        if (parent === undefined || parent.alive === 0) {
          throw new PagesApiError('E_PARENT_GONE', `父页面不存在或已删除：${input.parentId}`);
        }
      }

      const siblings = siblingsOf(nodes, input.parentId, null);
      let sortKey: string;
      try {
        sortKey = sortBetween(siblings[siblings.length - 1]?.sortKey ?? null, null);
      } catch (error) {
        throw new PagesApiError(
          'E_INVARIANT',
          `无法在父层生成排序键：${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const id = ulid(c.now);
      const op = upsertOp(
        {
          id,
          title: '未命名',
          icon: null,
          cover: null,
          workspaceId,
          parentId: input.parentId,
          sortKey,
          // upsertOp 的 version 参数是「实体当前已有版本」，新建时为 0（第 0 版之上首次创建），
          // 使首版 lamport.c = max(1, 0+1) = 1、物化 version = 1；后续 rename → 2，与语义一致。
          version: 0,
          alive: 1,
          deletedAt: null,
        },
        c,
      );
      await commitOps(executor, [op], { workspaceId });
      return { id, sortKey };
    },

    async createFolder(input) {
      const workspaceId = await requireActiveWorkspace();
      const nodes = await loadNodes(workspaceId);
      const c = ctx();

      if (input.parentId !== null) {
        const parent = nodes.find((node) => node.id === input.parentId);
        if (parent === undefined || parent.alive === 0) {
          throw new PagesApiError('E_PARENT_GONE', `父页面不存在或已删除：${input.parentId}`);
        }
      }

      const siblings = siblingsOf(nodes, input.parentId, null);
      let sortKey: string;
      try {
        sortKey = sortBetween(siblings[siblings.length - 1]?.sortKey ?? null, null);
      } catch (error) {
        throw new PagesApiError(
          'E_INVARIANT',
          `无法在父层生成排序键：${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const id = ulid(c.now);
      const op = upsertOp(
        {
          id,
          title: input.title,
          icon: null,
          cover: null,
          workspaceId,
          parentId: input.parentId,
          sortKey,
          version: 0,
          alive: 1,
          deletedAt: null,
        },
        c,
        'folder',
      );
      await commitOps(executor, [op], { workspaceId });
      return { id, sortKey };
    },

    async renamePage(input) {
      const workspaceId = await requireActiveWorkspace();
      const { node } = await requirePage(workspaceId, input.id);
      const c = ctx();
      const op: Op = {
        op_id: ulid(c.now),
        lamport: { c: node.version + 1, d: actor },
        at: c.now,
        actor,
        target: { table: 'page', id: node.id },
        kind: 'patch',
        payload: { title: input.title, updated_at: c.now },
        base: node.version,
      };
      await commitOps(executor, [op], { workspaceId });
      return { id: node.id };
    },

    async movePage(input) {
      const workspaceId = await requireActiveWorkspace();
      const { node, all } = await requirePage(workspaceId, input.id);
      const c = ctx();

      if (input.newParentId !== null) {
        if (input.newParentId === node.id) {
          throw new PagesApiError('E_CYCLE', '不能把页面移动到自身之下');
        }
        const parent = all.find((candidate) => candidate.id === input.newParentId);
        if (parent === undefined || parent.alive === 0) {
          throw new PagesApiError('E_PARENT_GONE', `目标父页面不存在或已删除：${input.newParentId}`);
        }
        // 防环：新父 ∈ descendants(id) → E_CYCLE
        const descendants = collectDescendants(node.id, childrenIndex(all));
        if (descendants.includes(input.newParentId)) {
          throw new PagesApiError('E_CYCLE', `不能把页面移动到自己的后代之下：${input.newParentId}`);
        }
      }

      const siblings = siblingsOf(all, input.newParentId, node.id);
      const reorders: Op[] = [];
      let sortKey = input.newSortKey;
      let rebalanced = false;

      if (sortKey !== undefined && sortKey.length === 0) {
        throw new PagesApiError('E_MALFORMED', 'newSortKey 不能为空串');
      }

      if (sortKey === undefined) {
        let prevKey: string | null = null;
        let nextKey: string | null = null;
        let insertAt = siblings.length;
        if (input.placeAfterId !== undefined) {
          const index = siblings.findIndex((candidate) => candidate.id === input.placeAfterId);
          if (index === -1) {
            throw new PagesApiError('E_MALFORMED', `placeAfterId 不在目标层：${input.placeAfterId}`);
          }
          prevKey = siblings[index]?.sortKey ?? null;
          nextKey = siblings[index + 1]?.sortKey ?? null;
          insertAt = index + 1;
        } else {
          prevKey = siblings[siblings.length - 1]?.sortKey ?? null;
        }

        try {
          sortKey = sortBetween(prevKey, nextKey);
        } catch {
          // 邻居之间已无空位 → 整层重平衡（§5.1 的失败降级）：新序 = 插入位置展开后的完整兄弟序列
          rebalanced = true;
          const ordered = [...siblings];
          ordered.splice(Math.min(insertAt, ordered.length), 0, node);
          const keys = sortSequence(ordered.length);
          const versions = new Map(ordered.map((entry) => [entry.id, entry.version]));
          const layer = rebalanceLayer(
            ordered.map((entry) => entry.id),
            (i) => keys[i] ?? '',
            { ...c, versions },
          );
          for (const reorder of layer) {
            const target = ordered.find((entry) => entry.id === reorder.target.id);
            if (target === undefined || target.id === node.id) {
              continue; // 自身走 move op（parent 也一起改）
            }
            if (target.sortKey === reorder.payload['sort_key']) {
              continue; // 键没变的不发（保持最小集合）
            }
            reorders.push(reorder);
          }
          sortKey = keys[Math.min(insertAt, keys.length - 1)] ?? sortBetween(prevKey, null);
        }
      }

      const ops: Op[] = [moveOp(node, input.newParentId, sortKey, c), ...reorders];
      const opCount = await commitOps(executor, ops, { workspaceId });
      return { sortKey, rebalanced, opCount };
    },

    async deletePage(input) {
      const workspaceId = await requireActiveWorkspace();
      const { all } = await requirePage(workspaceId, input.id);
      const ops = cascadeDeleteOps(all, input.id, ctx());
      if (ops.length === 0) {
        return { deleted: 0 };
      }
      await commitOps(executor, ops, { workspaceId });
      // T67-01-B1-01 §4：锁页进回收站 → 连带清锁行与密文（防孤儿密文；内联同 lock.purgeLockForPage）
      await executor.run('lock.delete', { page_id: input.id });
      await executor.run('lock_cipher.delete', { page_id: input.id });
      return { deleted: ops.length };
    },

    async restorePage(input) {
      const workspaceId = await requireActiveWorkspace();
      const plan = planRestore(await loadNodes(workspaceId), input.id, ctx());
      if (plan.reason === 'parent-gone') {
        throw new PagesApiError('E_PARENT_GONE', '父页面仍在回收站，先恢复父页面再恢复它');
      }
      if (plan.ops.length === 0) {
        return { restored: 0 };
      }
      await commitOps(executor, plan.ops, { workspaceId });
      return { restored: plan.ops.length };
    },

    async purgePage(input) {
      const workspaceId = await requireActiveWorkspace();
      const { node, all } = await requirePage(workspaceId, input.id, false);
      if (node.alive === 1) {
        throw new PagesApiError('E_MALFORMED', '只能彻底删除回收站中的页面');
      }
      // 级联：连整棵 tombstone 子树一起移除（否则父被移除后，子页会卡在回收站无法恢复）
      const c = ctx();
      const targets = [node.id, ...collectDescendants(node.id, childrenIndex(all))];
      const ops: Op[] = [];
      for (const targetId of targets) {
        const target = all.find((candidate) => candidate.id === targetId);
        if (target === undefined || target.alive === 1) {
          continue;
        }
        ops.push({
          op_id: ulid(c.now),
          lamport: { c: target.version + 1, d: actor },
          at: c.now,
          actor,
          target: { table: 'page', id: target.id },
          kind: 'delete',
          payload: {},
        });
      }
      if (ops.length === 0) {
        return { purged: 0 };
      }
      await commitOps(executor, ops, { workspaceId, deletionMode: 'purge' });
      // T67-01-B1-01 §4：彻底删除 → 一并清锁行与密文（内联同 lock.purgeLockForPage）
      for (const targetId of targets) {
        await executor.run('lock.delete', { page_id: targetId });
        await executor.run('lock_cipher.delete', { page_id: targetId });
      }
      return { purged: ops.length };
    },

    // ---- 收藏 / 最近（设备本地派生态） -----------------------------------
    async setFavorite(input) {
      const workspaceId = await requireActiveWorkspace();
      const key = await userKey();
      if (input.on) {
        await executor.run('favorite.add', {
          user_key: key,
          page_id: input.pageId,
          added_at: now(),
          workspace_id: workspaceId,
        });
      } else {
        await executor.run('favorite.remove', {
          user_key: key,
          page_id: input.pageId,
          workspace_id: workspaceId,
        });
      }
      return { pageIds: await favoriteIds(workspaceId, key) };
    },

    async listFavorites() {
      const workspaceId = await requireActiveWorkspace();
      return { pageIds: await favoriteIds(workspaceId, await userKey()) };
    },

    async touchRecent(input) {
      const workspaceId = await requireActiveWorkspace();
      const key = await userKey();
      await executor.run('recent.touch', {
        user_key: key,
        page_id: input.pageId,
        last_opened: now(),
        workspace_id: workspaceId,
      });
      return { pageIds: await recentIds(workspaceId, key) };
    },

    async listRecent() {
      const workspaceId = await requireActiveWorkspace();
      return { pageIds: await recentIds(workspaceId, await userKey()) };
    },
  };
}

/** 由底层异常映射成 IPC 错误（`TreeCycleError` = 数据损坏信号）。 */
export function toPagesError(error: unknown): PagesApiError {
  if (error instanceof PagesApiError) {
    return error;
  }
  if (error instanceof TreeCycleError) {
    return new PagesApiError('E_INVARIANT', `页面树数据损坏：${error.message}`);
  }
  return new PagesApiError('E_INVARIANT', error instanceof Error ? error.message : String(error));
}
