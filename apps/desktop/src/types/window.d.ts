/**
 * preload 通过 contextBridge 暴露到渲染器的类型化 API。
 * 渲染器只能通过 window.septcats 访问主进程能力（contextIsolation:true）。
 */
import type { Op } from '@septcats/core';
import type { Block, PageNode } from '@septcats/editor';
import type { CollectionEntity, DbView, FieldType, RecordEntity } from '@septcats/dbview';
import type { SearchInput, SearchResponse } from '../shared/search';
import type {
  AppSettings,
  AppSettingsPatch,
  DiagConfirmResult,
  DiagExportResult,
} from '../shared/settings';
import type {
  ImportPlanInput,
  ImportPlanPreview,
  ImportProgress,
  ImportReport,
} from '../shared/importer';
import type { UpdateInstallInput, UpdateRollbackHint, UpdateState } from '../shared/updater';
import type { SyncStatusSnapshot } from '../shared/sync';
import type {
  CollabAttachResult,
  CollabUpdateEntry,
  CollabUplinkInput,
} from '../shared/collab';
import type {
  AiChatResult,
  AiListModelsResult,
  AiMessage,
  AiStateSnapshot,
} from '../shared/ai';

/**
 * AI IPC（M11 · TASK-T18-01 §2.10）。通道与 `src/shared/ipc.ts` 的 AI_CHANNELS
 * 一对一；非流式 MVP（chat 一次往返回全文，流式归后续任务）。
 * 错误经 Error.message 透传（E_AI_* / E_CRED_UNAVAILABLE / E_INVARIANT / E_MALFORMED）。
 */
export interface SeptcatsAiApi {
  /** 渲染器视图（isLocal/hasKey 为派生布尔，不泄露密钥）。 */
  state(): Promise<AiStateSnapshot>;
  /** 拉模型列表（TTL 60s 缓存；refresh:true 强制绕过）。 */
  listModels(input: { providerId: string; refresh?: boolean }): Promise<AiListModelsResult>;
  /** 非流式对话（一次往返回全文）。messages 1..64 条、总长 ≤ 200_000 字符。 */
  chat(input: {
    providerId: string;
    messages: AiMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<AiChatResult>;
  /** 设置密钥（只进 CredentialStore，不落 settings/日志）。 */
  setKey(input: { providerId: string; key: string }): Promise<{ ok: true }>;
  /** 清除密钥。 */
  clearKey(input: { providerId: string }): Promise<{ ok: true }>;
}

/**
 * 同步运行时 IPC（M8b · TASK-T13-01 §1/§3）。通道与 `src/shared/ipc.ts` 的
 * SYNC_CHANNELS 一对一；状态跃迁经 sync:state 推送（onState 订阅）。
 * 六态：idle（未启用）/ syncing / ok / degraded（同步文件夹不可访问）/ error /
 * key_mismatch（E_KEY_ID_MISMATCH 红条，提示用恢复码导入或重设）。
 * 错误经 Error.message 透传（E_INVARIANT / E_MALFORMED）。
 */
export interface SeptcatsSyncApi {
  /** 当前状态快照（轮询面）。 */
  status(): Promise<SyncStatusSnapshot>;
  /** 同步启停（同时持久化到 settings 的 sync.enabled）。回最新快照。 */
  setEnabled(input: { on: boolean }): Promise<SyncStatusSnapshot>;
  /** 立即跑一轮（await 完成后回最新快照）。 */
  now(): Promise<SyncStatusSnapshot>;
  /** 导出恢复码（一次性明文；D1/D4）。加解密全在本地，不经网络。 */
  exportRecovery(): Promise<{ code: string }>;
  /** 导入恢复码：校验→写入 keyring→新钥接管→追平；非法码经 E_MALFORMED 透传。 */
  importRecovery(input: { code: string }): Promise<{ ok: true; keyId: string }>;
  /** 轮换钥匙：立即回 {startedAt}；后台重加密进度经 onState（sync:state）推送。 */
  rotateKey(): Promise<{ startedAt: number }>;
  /** 订阅状态机跃迁推送，返回退订函数。 */
  onState(listener: (status: SyncStatusSnapshot) => void): () => void;
}

/**
 * 自动更新 IPC（M10-B · TASK-T12-01B §0.4）。通道与 `src/shared/updater.ts` 的
 * UPDATE_CHANNELS 一对一；状态经 update:state 推送（onState 订阅）。
 * 错误经 Error.message 透传（E_FEED_SIGNATURE / E_FEED_SOURCE_DENIED / E_UPDATE_FAILED / E_MALFORMED）。
 */
export interface SeptcatsUpdateApi {
  /** 手动检查（main 侧先验 feed 签名再交 electron-updater）。回当前 UpdateState。 */
  check(): Promise<UpdateState>;
  /** 开始/继续下载（downloaded 态幂等）。回当前 UpdateState。 */
  download(): Promise<UpdateState>;
  /** 退出并安装；confirm 必须显式 true（renderer 侧确认弹窗后调用）。 */
  install(input: UpdateInstallInput): Promise<{ ok: true }>;
  /** 安装失败回滚提示（electron-updater 自身回 pending，本端只透出提示与状态）。 */
  rollbackHint(): Promise<UpdateRollbackHint>;
  /** 订阅状态机推送，返回退订函数。 */
  onState(listener: (state: UpdateState) => void): () => void;
}

/** 系统对话框选源结果：null = 用户取消。 */
export type ImportPickResult = ImportPlanInput | null;

/**
 * 导入器 IPC（M12 · TASK-T11-01 §4）。四通道 + pick（系统对话框）。
 * 错误经 Error.message 透传（E_MALFORMED / E_NOT_FOUND / E_TOO_LARGE / E_INVARIANT）；
 * E_TOO_LARGE 的 message 含条目数（「单计划 N 个条目」）供向导错误态提取。
 */
export interface SeptcatsImportApi {
  /** 三态入口 → 解析 + 计划（熔断/去重/孤儿/重名），回预览（不含 bytes）。 */
  plan(input: ImportPlanInput): Promise<ImportPlanPreview>;
  /** 系统对话框选源：按扩展名映射 zipPath/dirPath/csvPath；取消回 null。 */
  pick(): Promise<ImportPickResult>;
  /** 执行（confirm 必须显式 true）；失败不回滚，report.failedAt 定位断点。 */
  execute(input: { planId: string; confirm: true }): Promise<ImportReport>;
  /** 进度轮询（执行中每 ~400ms 一次）。 */
  progress(input: { planId: string }): Promise<ImportProgress | null>;
  /** 取消：下一个条目边界生效，当前 batch 原子完成。 */
  cancel(input: { planId: string }): Promise<{ ok: true }>;
}

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
 * blocks IPC（T21-01 起接真实实现；通道与 `src/shared/ipc.ts` 的 BLOCKS_CHANNELS 一对一）。
 * 一次编辑轮次 = 一批 Op（op_ledger + 物化 + FTS 同事务，计划书 §8.1）。
 * 错误经 Error.message 透传（E_MALFORMED / E_NO_WORKSPACE / E_INVARIANT）。
 */
export interface SeptcatsBlocksApi {
  /** 提交一批 Op（renderer EditSession 产出，原样透传），返回写入条数（同事务语义由 main 侧保证）。 */
  commit(input: { ops: Op[] }): Promise<number>;
  /** 读一页的存活块（编辑器 Block 形状，按 sort_key 升序）。 */
  list(input: { pageId: string }): Promise<Block[]>;
  /** 订阅块变更推送，返回退订函数（main 本期只保留通道名，不推送）。 */
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
    patch: {
      name?: string | undefined;
      type?: FieldType | undefined;
      /** `ai` 属性（type='ai'）的生成指令；空串 = 清除配置、回落默认指令（TASK-T18-04）。 */
      ai?: { prompt: string } | undefined;
    };
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

/**
 * 协作（CRDT）IPC（TASK-T19-05 §0.2）。通道与 `src/shared/ipc.ts` 的 COLLAB_CHANNELS
 * 一对一；载荷形状见 `src/shared/collab.ts`（base64 文本对上层不透明）。
 * 错误经 Error.message 透传（E_INVARIANT / E_MALFORMED）。
 */
export interface SeptcatsCollabApi {
  /** 打开页：main 播种 + LRU 缓存接入，回「快照区段聚合 + 账本 op」种子集。 */
  attach(input: { pageId: string }): Promise<CollabAttachResult>;
  /** 关闭页：main flush + 释放 hub 实例（页不存在幂等）。 */
  detach(input: { pageId: string }): Promise<{ ok: true }>;
  /** 上行：Y.Doc 防抖 flush 的 payload → main 组 crdt_update Op 入真相层。 */
  apply(input: CollabUplinkInput): Promise<{ ok: true }>;
  /** 订阅下行推流（mergeRemote 报告按 pageId 路由），返回退订函数。 */
  onUpdate(listener: (entries: CollabUpdateEntry[]) => void): () => void;
}

export interface SeptcatsApi {
  /** IPC 自检：主进程返回当前时间戳字符串。 */
  ping(): Promise<string>;
  /** 应用元信息（名称/版本/schema 版本）。 */
  appMeta(): Promise<SeptcatsAppMeta>;
  /** 块数据通道（T21-01：main 侧已实现 list/commit；changed 本期不推送）。 */
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
  /** 导入器（M12）。 */
  import: SeptcatsImportApi;
  /** 自动更新（M10-B）。 */
  update: SeptcatsUpdateApi;
  /** 同步运行时（M8b）。 */
  sync: SeptcatsSyncApi;
  /** AI 集成（M11）。 */
  ai: SeptcatsAiApi;
  /** 协作（CRDT，T19-05）。 */
  collab: SeptcatsCollabApi;
}

declare global {
  interface Window {
    septcats: SeptcatsApi;
  }
}
