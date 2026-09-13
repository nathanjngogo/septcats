/**
 * preload 通过 contextBridge 暴露到渲染器的类型化 API。
 * 渲染器只能通过 window.septcats 访问主进程能力（contextIsolation:true）。
 */
import type { Op } from '@septcats/core';
import type { PageNode } from '@septcats/editor';
import type { CollectionEntity, DbView, FieldType, RecordEntity } from '@septcats/dbview';
import type { SearchInput, SearchResponse } from '../shared/search';
import type {
  AppSettings,
  AppSettingsPatch,
  DiagConfirmResult,
  DiagExportResult,
} from '../shared/settings';

export interface SeptcatsAppMeta {
  name: string;
  version: string;
  schemaVersion: number;
  /**
   * 数据根目录名（basename），用于状态栏/关于页展示。
   * 隐私默认：只给目录名，不下发完整家目录路径。
   */
  layoutRoot: string;
}

/**
 * blocks IPC（T5 定名，main 侧实现归后续任务）。
 * 一次编辑轮次 = 一批 Op（op_ledger + 物化 + FTS 同事务，计划书 §8.1）。
 */
export interface SeptcatsBlocksApi {
  /** 提交一批 Op，返回写入条数（同事务语义由 main 侧保证）。 */
  commit(ops: Op[]): Promise<number>;
  /** 读一页的块实体（未过滤 tombstone 由查询层决定）。 */
  list(pageId: string): Promise<unknown[]>;
  /** 订阅块变更推送，返回退订函数。 */
  onChanged(listener: (payload: unknown) => void): () => void;
}

/**
 * 页面树 IPC（TASK-T6-01 §3）。一切写路径在 main 侧先造 Op 再落库；
 * 错误码经 Error.message 透传（E_NOT_FOUND / E_PARENT_GONE / E_CYCLE / E_INVARIANT）。
 */
export interface SeptcatsPagesApi {
  /** 返回 alive+deleted 全量节点（childIds/depth 已派生），渲染器再组树。 */
  tree(input: { workspaceId: string }): Promise<PageNode[]>;
  /** 新建页（title='未命名'，sort_key=该父下 max+1；父不存在 → E_PARENT_GONE）。 */
  create(input: { parentId: string | null }): Promise<{ id: string; sortKey: string }>;
  rename(input: { id: string; title: string }): Promise<{ id: string }>;
  /**
   * 移动/排序。`newSortKey` 与 `placeAfterId` 二选一（都不给 = 追加到目标层末尾）；
   * 邻居之间无空位时 main 侧自动整层重平衡（`rebalanced=true`）。
   * 新父 ∈ descendants(id) → E_CYCLE。
   */
  move(input: {
    id: string;
    newParentId: string | null;
    newSortKey?: string;
    placeAfterId?: string;
  }): Promise<{ sortKey: string; rebalanced: boolean; opCount: number }>;
  /** 级联删除（自身 + 后代，同事务一批 delete op）。 */
  remove(input: { id: string }): Promise<{ deleted: number }>;
  /** 恢复（父仍死 → E_PARENT_GONE）。 */
  restore(input: { id: string }): Promise<{ restored: number }>;
  /** 从回收站彻底删除（deleted_at=0 标记，物理清除归 GC）。 */
  purge(input: { id: string }): Promise<{ purged: number }>;
}

/** 工作区（Q4 单库多工作区分片）。 */
export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface SeptcatsWorkspacesApi {
  list(): Promise<{ items: WorkspaceSummary[]; activeId: string | null }>;
  create(input: { name: string }): Promise<{ id: string }>;
  rename(input: { id: string; name: string }): Promise<{ id: string }>;
  /** 只换活动 id + 通知各窗口重载树；DbHandle 指向不变。 */
  switch(input: { id: string }): Promise<{ activeId: string }>;
  /** 订阅活动工作区变更（含其它窗口触发的切换），返回退订函数。 */
  onChanged(listener: (payload: { activeId: string }) => void): () => void;
}

/** 收藏（设备本地派生态）。 */
export interface SeptcatsFavoritesApi {
  set(input: { pageId: string; on: boolean }): Promise<{ pageIds: string[] }>;
  list(): Promise<{ pageIds: string[] }>;
}

/** 最近打开（设备本地派生态，上限 20 条）。 */
export interface SeptcatsRecentApi {
  touch(input: { pageId: string }): Promise<{ pageIds: string[] }>;
  list(): Promise<{ pageIds: string[] }>;
}

/**
 * 行内数据库（M6 · TASK-T7b-01 §3）。通道与 `src/shared/ipc.ts` 的 `DB_CHANNELS`
 * 一对一；`pageId` 为锚，只有 `create` 用 `workspaceId + parentPageId`。
 * 错误经 Error.message 透传（E_NOT_FOUND / E_REFERRED / E_UNSUPPORTED / E_DB_UNAVAILABLE）。
 */
export interface SeptcatsDbApi {
  /** 建独立 DB 页（同事务 page.upsert + collection.upsert）。 */
  create(input: {
    workspaceId: string;
    parentPageId?: string | null | undefined;
    title: string;
  }): Promise<{ pageId: string; collectionId: string }>;
  load(input: { pageId: string }): Promise<{ collection: CollectionEntity; records: RecordEntity[] }>;
  rename(input: { pageId: string; title: string }): Promise<{ ok: true }>;
  recordCreate(input: {
    pageId: string;
    values?: Record<string, unknown> | undefined;
  }): Promise<{ record: RecordEntity }>;
  recordUpdate(input: {
    pageId: string;
    recordId: string;
    patch: Record<string, unknown>;
  }): Promise<{ record: RecordEntity }>;
  recordDelete(input: { pageId: string; ids: string[] }): Promise<{ ok: true }>;
  propAdd(input: { pageId: string; type: FieldType }): Promise<{ collection: CollectionEntity }>;
  /** 一期只允许 rename；type 变更 → E_UNSUPPORTED（值迁移后续任务）。 */
  propUpdate(input: {
    pageId: string;
    pid: string;
    patch: { name?: string | undefined; type?: FieldType | undefined };
  }): Promise<{ collection: CollectionEntity }>;
  propRemove(input: { pageId: string; pid: string }): Promise<{ collection: CollectionEntity }>;
  viewSave(input: { pageId: string; view: DbView }): Promise<{ collection: CollectionEntity }>;
  relationSearch(input: {
    pageId: string;
    targetCollectionId: string;
    query: string;
  }): Promise<{ candidates: Array<{ id: string; title: string }> }>;
  exportCsv(input: { pageId: string }): Promise<{ csv: string }>;
}

/**
 * 搜索与命令面板（M7 · TASK-T8-01 §1/§3）。
 * query 通道与 `src/shared/ipc.ts` 的 CHANNEL_SEARCH_QUERY 一对一；
 * onTogglePalette 订阅主进程 Ctrl/Cmd+K 的全局键广播（CHANNEL_PALETTE_TOGGLE）。
 * 错误经 Error.message 透传（E_MALFORMED / E_DB_UNAVAILABLE / E_INVARIANT）。
 */
export interface SeptcatsSearchApi {
  query(input: SearchInput): Promise<SearchResponse>;
  /** 订阅命令面板切换广播（主进程全局键），返回退订函数。 */
  onTogglePalette(listener: () => void): () => void;
}

/**
 * 设置与诊断（M9 · TASK-T10-01 §1/§4）。
 * `get`/`patch` 回整份 AppSettings（`data.note` 为同步目录绝对路径，仅展示不可改）；
 * patch 非法值（如 theme:'neon'）经 main 侧 zod 拒绝，Error.message 携带 `E_SETTINGS_INVALID`。
 */
export interface SeptcatsSettingsApi {
  get(): Promise<AppSettings>;
  patch(patch: AppSettingsPatch): Promise<AppSettings>;
}

/**
 * 诊断包导出（M9 · §4，默认脱敏 + 人工预览）。
 * `export()` 只生成预览（不落盘）；`confirm()` 才写 userData/diagnostics/diag-<ts>.json。
 */
export interface SeptcatsDiagApi {
  export(): Promise<DiagExportResult>;
  confirm(): Promise<DiagConfirmResult>;
}

export interface SeptcatsApi {
  /** IPC 自检：主进程返回当前时间戳字符串。 */
  ping(): Promise<string>;
  /** 应用元信息（名称/版本/schema 版本）。 */
  appMeta(): Promise<SeptcatsAppMeta>;
  /** 块数据通道（main 侧尚未注册 handler；调用会 reject）。 */
  blocks: SeptcatsBlocksApi;
  pages: SeptcatsPagesApi;
  favorites: SeptcatsFavoritesApi;
  recent: SeptcatsRecentApi;
  workspaces: SeptcatsWorkspacesApi;
  /** 行内数据库（M6）。 */
  db: SeptcatsDbApi;
  /** 搜索 + 命令面板（M7）。 */
  search: SeptcatsSearchApi;
  /** 设置（M9）。 */
  settings: SeptcatsSettingsApi;
  /** 诊断包导出（M9）。 */
  diag: SeptcatsDiagApi;
}

declare global {
  interface Window {
    septcats: SeptcatsApi;
  }
}
