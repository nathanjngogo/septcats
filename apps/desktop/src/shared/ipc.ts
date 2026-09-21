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
// 页面承载类型（TASK-T42-01 · 新增通道；写路径在 main 侧造 page upsert op 走
// commitOps（账本 + 物化同事务），实现住 main/dbview.ts 的 DbViewService——
// 该文件自持 IPC 注册面（registerDbViewIpc），无需改 main/index.ts）
// ---------------------------------------------------------------------------

/** 双向转换：{pageId, to:'wiki'|'page'} → {ok:true}（page_type 随整对象 op 走账本）。 */
export const CHANNEL_PAGE_CONVERT = 'page:convert';
/** Wiki 落地页简介：{pageId, summary} → {ok:true}（summary 列，独立于正文块）。 */
export const CHANNEL_PAGE_SUMMARY_SET = 'page:summary:set';

export const PAGE_TYPE_CHANNELS = {
  convert: CHANNEL_PAGE_CONVERT,
  setSummary: CHANNEL_PAGE_SUMMARY_SET,
} as const;

export type PageTypeChannel = (typeof PAGE_TYPE_CHANNELS)[keyof typeof PAGE_TYPE_CHANNELS];

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
/** TASK-T40-01 §B2：字段左右排序（beforePid=null = 移到末尾；标题列由 service 强制恒首）。 */
export const CHANNEL_DB_PROP_MOVE = 'db:prop:move';
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
  propMove: CHANNEL_DB_PROP_MOVE,
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

/* S10 三通道（T17-01 D4） */
/** 导出恢复码：→ {code}（一次性明文；D1/D4）。 */
export const CHANNEL_SYNC_EXPORT_RECOVERY = 'sync:exportRecovery';
/** 导入恢复码：{code} → {ok, keyId}（校验→写入 keyring→触发追平；D1/D4）。 */
export const CHANNEL_SYNC_IMPORT_RECOVERY = 'sync:importRecovery';
/** 轮换钥匙：→ {startedAt}（异步启动后台重加密，进度走 sync:state；D3/D4）。 */
export const CHANNEL_SYNC_ROTATE_KEY = 'sync:rotateKey';

export const SYNC_CHANNELS = {
  status: CHANNEL_SYNC_STATUS,
  setEnabled: CHANNEL_SYNC_SET_ENABLED,
  now: CHANNEL_SYNC_NOW,
  state: CHANNEL_SYNC_STATE,
  exportRecovery: CHANNEL_SYNC_EXPORT_RECOVERY,
  importRecovery: CHANNEL_SYNC_IMPORT_RECOVERY,
  rotateKey: CHANNEL_SYNC_ROTATE_KEY,
} as const;

export type SyncChannel = (typeof SYNC_CHANNELS)[keyof typeof SYNC_CHANNELS];

// ---------------------------------------------------------------------------
// AI（M11 · TASK-T18-01 §2.9）
// ---------------------------------------------------------------------------

/** 渲染器视图：AiStateSnapshot（shared/ai.ts，hasKey 派生布尔，不泄露密钥）。 */
export const CHANNEL_AI_STATE = 'ai:state';
/** 拉模型列表：{providerId, refresh?} → AiListModelsResult（TTL 60s 缓存）。 */
export const CHANNEL_AI_LIST_MODELS = 'ai:listModels';
/** 非流式对话：{providerId, messages, maxTokens?, temperature?} → AiChatResult。 */
export const CHANNEL_AI_CHAT = 'ai:chat';
/** 设置密钥：{providerId, key} → {ok:true}（密钥只进 CredentialStore）。 */
export const CHANNEL_AI_SET_KEY = 'ai:setKey';
/** 清除密钥：{providerId} → {ok:true}。 */
export const CHANNEL_AI_CLEAR_KEY = 'ai:clearKey';
/** 写 AI 对话运行时配置（超时/max_tokens）：AiChatConfigPatch → AiChatConfigSnapshot。 */
export const CHANNEL_AI_SET_CHAT_CONFIG = 'ai:setChatConfig';

export const AI_CHANNELS = {
  state: CHANNEL_AI_STATE,
  listModels: CHANNEL_AI_LIST_MODELS,
  chat: CHANNEL_AI_CHAT,
  setKey: CHANNEL_AI_SET_KEY,
  clearKey: CHANNEL_AI_CLEAR_KEY,
  setChatConfig: CHANNEL_AI_SET_CHAT_CONFIG,
} as const;

export type AiChannel = (typeof AI_CHANNELS)[keyof typeof AI_CHANNELS];

// ---------------------------------------------------------------------------
// 协作（CRDT · TASK-T19-05 §0.2）。载荷形状见 shared/collab.ts。
// ---------------------------------------------------------------------------

/** 打开页：{pageId} → main attach（播种 + LRU 缓存）→ CollabAttachResult。 */
export const CHANNEL_COLLAB_ATTACH = 'collab:attach';
/** 关闭页：{pageId} → main flush + 释放 → {ok:true}。 */
export const CHANNEL_COLLAB_DETACH = 'collab:detach';
/** 上行：CrdtUpdatePayload（renderer Y.Doc 防抖 flush）→ main 组 Op 入账 → {ok:true}。 */
export const CHANNEL_COLLAB_APPLY = 'collab:apply';
/** main → renderer 下行：mergeRemote 报告到账的 crdtUpdates（CollabUpdateEntry[]）。 */
export const CHANNEL_COLLAB_UPDATE = 'collab:update';

export const COLLAB_CHANNELS = {
  attach: CHANNEL_COLLAB_ATTACH,
  detach: CHANNEL_COLLAB_DETACH,
  apply: CHANNEL_COLLAB_APPLY,
  update: CHANNEL_COLLAB_UPDATE,
} as const;

export type CollabChannel = (typeof COLLAB_CHANNELS)[keyof typeof COLLAB_CHANNELS];

// ---------------------------------------------------------------------------
// 模板（M13 · TASK-T23-01 §0.B，数据面；UI 归 T23-02）。契约用对象形载荷。
// 出参形状见 main/templates.ts 的 TemplateMeta / TemplateFull。
// ---------------------------------------------------------------------------

/** 模板列表：{kind?} → {templates: TemplateMeta[]}（不含 payload，updated_at 倒序）。 */
export const CHANNEL_TEMPLATES_LIST = 'templates:list';
/** 单个模板：{id} → {template: TemplateMeta + payload}。 */
export const CHANNEL_TEMPLATES_GET = 'templates:get';
/** 另存为模板：{pageId, title, icon?} → {id}（kind 自动判：有 collection → 'database'）。 */
export const CHANNEL_TEMPLATES_SAVE_FROM_PAGE = 'templates:saveFromPage';
/** 重命名：{id, title, icon?} → {}。 */
export const CHANNEL_TEMPLATES_RENAME = 'templates:rename';
/** 软删：{id} → {}（照既有回收站风格）。 */
export const CHANNEL_TEMPLATES_DELETE = 'templates:delete';
/** 从模板新建页：{templateId, parentId} → {pageId}（深拷贝；records 不复制）。 */
export const CHANNEL_TEMPLATES_CREATE_PAGE = 'templates:createPage';

export const TEMPLATES_CHANNELS = {
  list: CHANNEL_TEMPLATES_LIST,
  get: CHANNEL_TEMPLATES_GET,
  saveFromPage: CHANNEL_TEMPLATES_SAVE_FROM_PAGE,
  rename: CHANNEL_TEMPLATES_RENAME,
  delete: CHANNEL_TEMPLATES_DELETE,
  createPage: CHANNEL_TEMPLATES_CREATE_PAGE,
} as const;

export type TemplatesChannel = (typeof TEMPLATES_CHANNELS)[keyof typeof TEMPLATES_CHANNELS];

// ---------------------------------------------------------------------------
// 双链（R8 · TASK-T44-01：页面互链派生索引 + 回链查询；派生态不进 Op，
// 通道只读 + 重建；实现在 main/links.ts）
// ---------------------------------------------------------------------------

/** 回链面板：{pageId} → {entries: BacklinkEntry[]}（谁引用了我，含上下文片段）。 */
export const CHANNEL_LINKS_BACKLINKS = 'links:backlinks';
/** 全量重建派生索引（启动时自动跑一次）→ {links: number}。 */
export const CHANNEL_LINKS_REBUILD = 'links:rebuild';

export const LINKS_CHANNELS = {
  backlinks: CHANNEL_LINKS_BACKLINKS,
  rebuild: CHANNEL_LINKS_REBUILD,
} as const;

export type LinksChannel = (typeof LINKS_CHANNELS)[keyof typeof LINKS_CHANNELS];

// ---------------------------------------------------------------------------
// 原生应用菜单（T51-01）。main 侧菜单项被点击 → 推送给 renderer，由 renderer
// 派发到既有 actions（Close Tab 复用页签逻辑，绝不用 role:'close' 关窗口）。
// ---------------------------------------------------------------------------

/** main → renderer：原生菜单项被点击，载荷 `{ action: MenuActionId }`。 */
export const CHANNEL_MENU_ACTION = 'menu:action';

/** 菜单可派发动作的单一来源（main 菜单项 ↔ renderer handler 的契约）。 */
export const MENU_ACTIONS = [
  'newPage',
  'import',
  'openTrash',
  'toggleSidebar',
  'toggleFullWidth',
  'commandPalette',
  'closeTab',
  /** 「关于」由 main 侧就地弹窗处理，不经 renderer。 */
  'about',
] as const;

export type MenuActionId = (typeof MENU_ACTIONS)[number];

export const MENU_CHANNELS = { action: CHANNEL_MENU_ACTION } as const;
