/**
 * shared/ipc.ts —— IPC 通道名的单一来源（main / preload / renderer 三侧共用）。
 *
 * 通道命名规则：`<域>:<动作>`，动作与 Op 语义对齐（commit 一次编辑轮次 = 一批 Op）。
 * T5 定名 blocks 通道（main 侧实现归后续任务）；T6 定名并实现 page/fav/recent/workspace
 * 四域——页面树与工作区是 M5 的验收面。
 */

export const CHANNEL_PING = 'app:ping';
export const CHANNEL_META = 'app:meta';

/** 一次编辑轮次：op_ledger.insert × N + 物化 upsert/patch × M，DbServer 同事务（计划书 §8.1）。 */
export const CHANNEL_BLOCKS_COMMIT = 'blocks:commit';
/** 读一页的块（含 tombstone 过滤由查询层决定）。 */
export const CHANNEL_BLOCKS_LIST = 'blocks:list';
/** 订阅远端/其它窗口的块变更推送。 */
export const CHANNEL_BLOCKS_CHANGED = 'blocks:changed';

export const BLOCKS_CHANNELS = {
  commit: CHANNEL_BLOCKS_COMMIT,
  list: CHANNEL_BLOCKS_LIST,
  changed: CHANNEL_BLOCKS_CHANGED,
} as const;

export type BlocksChannel = (typeof BLOCKS_CHANNELS)[keyof typeof BLOCKS_CHANNELS];

// ---------------------------------------------------------------------------
// 页面树（M5 · TASK-T6-01 §3）
// ---------------------------------------------------------------------------

export const CHANNEL_PAGE_TREE = 'page:tree';
export const CHANNEL_PAGE_CREATE = 'page:create';
export const CHANNEL_PAGE_RENAME = 'page:rename';
export const CHANNEL_PAGE_MOVE = 'page:move';
export const CHANNEL_PAGE_DELETE = 'page:delete';
export const CHANNEL_PAGE_RESTORE = 'page:restore';
/** 从回收站彻底删除（deleted_at=0 标记；物理清除归 GC）。 */
export const CHANNEL_PAGE_PURGE = 'page:purge';

export const PAGES_CHANNELS = {
  tree: CHANNEL_PAGE_TREE,
  create: CHANNEL_PAGE_CREATE,
  rename: CHANNEL_PAGE_RENAME,
  move: CHANNEL_PAGE_MOVE,
  delete: CHANNEL_PAGE_DELETE,
  restore: CHANNEL_PAGE_RESTORE,
  purge: CHANNEL_PAGE_PURGE,
} as const;

export type PagesChannel = (typeof PAGES_CHANNELS)[keyof typeof PAGES_CHANNELS];

// ---------------------------------------------------------------------------
// 收藏 / 最近（设备本地派生态）
// ---------------------------------------------------------------------------

export const CHANNEL_FAV_SET = 'fav:set';
export const CHANNEL_FAV_LIST = 'fav:list';
export const CHANNEL_RECENT_TOUCH = 'recent:touch';
export const CHANNEL_RECENT_LIST = 'recent:list';

export const FAVORITES_CHANNELS = { set: CHANNEL_FAV_SET, list: CHANNEL_FAV_LIST } as const;
export const RECENT_CHANNELS = { touch: CHANNEL_RECENT_TOUCH, list: CHANNEL_RECENT_LIST } as const;

// ---------------------------------------------------------------------------
// 工作区（Q4 单库多工作区分片：switch 只换活动 id，DbHandle 不变）
// ---------------------------------------------------------------------------

export const CHANNEL_WORKSPACE_LIST = 'workspace:list';
export const CHANNEL_WORKSPACE_CREATE = 'workspace:create';
export const CHANNEL_WORKSPACE_RENAME = 'workspace:rename';
export const CHANNEL_WORKSPACE_SWITCH = 'workspace:switch';
/** 主进程 → 渲染器：活动工作区变更（多窗口同步重载树）。 */
export const CHANNEL_WORKSPACE_CHANGED = 'workspace:changed';

export const WORKSPACES_CHANNELS = {
  list: CHANNEL_WORKSPACE_LIST,
  create: CHANNEL_WORKSPACE_CREATE,
  rename: CHANNEL_WORKSPACE_RENAME,
  switch: CHANNEL_WORKSPACE_SWITCH,
  changed: CHANNEL_WORKSPACE_CHANGED,
} as const;

export type WorkspacesChannel = (typeof WORKSPACES_CHANNELS)[keyof typeof WORKSPACES_CHANNELS];

// ---------------------------------------------------------------------------
// 行内数据库（M6 · TASK-T7b-01 §1）
// ---------------------------------------------------------------------------
// renderer → main 请求：**pageId 为锚**（collection 通过 collection.getByPage 反查），
// 只有 `db:create` 例外（此时还没有 pageId，用 workspaceId + parentPageId）。
// 写路径在 main 侧造 Op 后经 commitOps（Op + 物化同事务）落 DbServer。

export const CHANNEL_DB_CREATE = 'db:create';
export const CHANNEL_DB_LOAD = 'db:load';
export const CHANNEL_DB_RENAME = 'db:rename';
export const CHANNEL_DB_RECORD_CREATE = 'db:record:create';
export const CHANNEL_DB_RECORD_UPDATE = 'db:record:update';
export const CHANNEL_DB_RECORD_DELETE = 'db:record:delete';
export const CHANNEL_DB_PROP_ADD = 'db:prop:add';
export const CHANNEL_DB_PROP_UPDATE = 'db:prop:update';
export const CHANNEL_DB_PROP_REMOVE = 'db:prop:remove';
export const CHANNEL_DB_VIEW_SAVE = 'db:view:save';
export const CHANNEL_DB_RELATION_SEARCH = 'db:relation:search';
export const CHANNEL_DB_EXPORT_CSV = 'db:export:csv';

export const DB_CHANNELS = {
  create: CHANNEL_DB_CREATE,
  load: CHANNEL_DB_LOAD,
  rename: CHANNEL_DB_RENAME,
  recordCreate: CHANNEL_DB_RECORD_CREATE,
  recordUpdate: CHANNEL_DB_RECORD_UPDATE,
  recordDelete: CHANNEL_DB_RECORD_DELETE,
  propAdd: CHANNEL_DB_PROP_ADD,
  propUpdate: CHANNEL_DB_PROP_UPDATE,
  propRemove: CHANNEL_DB_PROP_REMOVE,
  viewSave: CHANNEL_DB_VIEW_SAVE,
  relationSearch: CHANNEL_DB_RELATION_SEARCH,
  exportCsv: CHANNEL_DB_EXPORT_CSV,
} as const;

export type DbChannel = (typeof DB_CHANNELS)[keyof typeof DB_CHANNELS];

// ---------------------------------------------------------------------------
// 搜索与命令面板（M7 · TASK-T8-01 §1/§3）
// ---------------------------------------------------------------------------

/** renderer → main：全文检索（FTS5 + LIKE 兜底），入参/出参见 shared/search.ts。 */
export const CHANNEL_SEARCH_QUERY = 'search:query';
/** 主进程 → 渲染器：Ctrl/Cmd+K 切换命令面板（主进程全局键；renderer 内监听为另一路，后者优先）。 */
export const CHANNEL_PALETTE_TOGGLE = 'palette:toggle';

export const SEARCH_CHANNELS = {
  query: CHANNEL_SEARCH_QUERY,
  togglePalette: CHANNEL_PALETTE_TOGGLE,
} as const;

export type SearchChannel = (typeof SEARCH_CHANNELS)[keyof typeof SEARCH_CHANNELS];

// ---------------------------------------------------------------------------
// 设置与诊断（M9 · TASK-T10-01 §1/§4）
// ---------------------------------------------------------------------------

export const CHANNEL_SETTINGS_GET = 'settings:get';
export const CHANNEL_SETTINGS_PATCH = 'settings:patch';
/** 生成脱敏诊断包预览（不落盘）。 */
export const CHANNEL_DIAG_EXPORT = 'diag:export';
/** 用户确认后落最终诊断文件。 */
export const CHANNEL_DIAG_CONFIRM = 'diag:confirm';

export const SETTINGS_CHANNELS = {
  get: CHANNEL_SETTINGS_GET,
  patch: CHANNEL_SETTINGS_PATCH,
} as const;

export const DIAG_CHANNELS = {
  export: CHANNEL_DIAG_EXPORT,
  confirm: CHANNEL_DIAG_CONFIRM,
} as const;

export type SettingsChannel = (typeof SETTINGS_CHANNELS)[keyof typeof SETTINGS_CHANNELS];
export type DiagChannel = (typeof DIAG_CHANNELS)[keyof typeof DIAG_CHANNELS];

// ---------------------------------------------------------------------------
// 导入器（M12 · TASK-T11-01 §4）
// ---------------------------------------------------------------------------

/** 计划：{zipPath?|dirPath?|csvPath?} → {planId, preview(不含 bytes)}。 */
export const CHANNEL_IMPORT_PLAN = 'import:plan';
/** 选择源文件（main 侧系统对话框）：→ {zipPath?|dirPath?|csvPath?} | null（取消）。 */
export const CHANNEL_IMPORT_PICK = 'import:pick';
/** 执行：{planId, confirm:true} → {report}；断点续传语义见 main/importer.ts。 */
export const CHANNEL_IMPORT_EXECUTE = 'import:execute';
/** 进度轮询：{planId} → {status, done, total, failedAt}。 */
export const CHANNEL_IMPORT_PROGRESS = 'import:progress';
/** 取消：{planId} → {ok:true}（在下一个 batch 边界生效）。 */
export const CHANNEL_IMPORT_CANCEL = 'import:cancel';

export const IMPORT_CHANNELS = {
  plan: CHANNEL_IMPORT_PLAN,
  pick: CHANNEL_IMPORT_PICK,
  execute: CHANNEL_IMPORT_EXECUTE,
  progress: CHANNEL_IMPORT_PROGRESS,
  cancel: CHANNEL_IMPORT_CANCEL,
} as const;

export type ImportChannel = (typeof IMPORT_CHANNELS)[keyof typeof IMPORT_CHANNELS];

// ---------------------------------------------------------------------------
// 自动更新（M10-B · TASK-T12-01B）
// 通道名放本文件（全仓单一来源，零依赖）——preload 只 import 通道名，
// 绝不把 zod 运行时（shared/updater.ts 的 schema）带进 sandboxed preload。
// ---------------------------------------------------------------------------
export const CHANNEL_UPDATE_CHECK = 'update:check';
/** main → renderer：状态机每次跃迁推送 UpdateState。 */
export const CHANNEL_UPDATE_STATE = 'update:state';
export const CHANNEL_UPDATE_DOWNLOAD = 'update:download';
export const CHANNEL_UPDATE_INSTALL = 'update:install';
export const CHANNEL_UPDATE_ROLLBACK_HINT = 'update:rollbackHint';

export const UPDATE_CHANNELS = {
  check: CHANNEL_UPDATE_CHECK,
  state: CHANNEL_UPDATE_STATE,
  download: CHANNEL_UPDATE_DOWNLOAD,
  install: CHANNEL_UPDATE_INSTALL,
  rollbackHint: CHANNEL_UPDATE_ROLLBACK_HINT,
} as const;

export type UpdateChannel = (typeof UPDATE_CHANNELS)[keyof typeof UPDATE_CHANNELS];

// ---------------------------------------------------------------------------
// 同步运行时（M8b · TASK-T13-01 §1）
// ---------------------------------------------------------------------------

/** 状态轮询：→ SyncStatusSnapshot（shared/sync.ts）。 */
export const CHANNEL_SYNC_STATUS = 'sync:status';
/** 启停：{on:boolean} → 运行时启停 + 设置持久化 → SyncStatusSnapshot。 */
export const CHANNEL_SYNC_SET_ENABLED = 'sync:setEnabled';
/** 立即跑一轮：→ SyncStatusSnapshot（await 完成）。 */
export const CHANNEL_SYNC_NOW = 'sync:now';
/** main → renderer：状态机跃迁推送（低频），载荷 SyncStatusSnapshot。 */
export const CHANNEL_SYNC_STATE = 'sync:state';

export const SYNC_CHANNELS = {
  status: CHANNEL_SYNC_STATUS,
  setEnabled: CHANNEL_SYNC_SET_ENABLED,
  now: CHANNEL_SYNC_NOW,
  state: CHANNEL_SYNC_STATE,
} as const;

export type SyncChannel = (typeof SYNC_CHANNELS)[keyof typeof SYNC_CHANNELS];
