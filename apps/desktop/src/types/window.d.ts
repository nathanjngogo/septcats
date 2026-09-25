/**
 * preload 通过 contextBridge 暴露到渲染器的类型化 API。
 * 渲染器只能通过 window.septcats 访问主进程能力（contextIsolation:true）。
 */
import type { Op } from '@septcats/core';
import type {
  CloseAction,
  CloseDecisionInput,
  EditorFlushAckInput,
  MenuActionId,
  ShellOpenInput,
  ShellOpenResult,
} from '../shared/ipc';
import type { Block, PageNode } from '@septcats/editor';
import type { CollectionEntity, DbView, FieldType, RecordEntity } from '@septcats/dbview';
import type { PageNodeView } from '../main/pages';
import type {
  PageExportConfirmResponse,
  PageExportInput,
  PageExportPreview,
} from '../shared/pageExport';
import type { SearchInput, SearchResponse } from '../shared/search';
import type {
  PortableExportConfirmResponse,
  PortableExportInput,
  PortableExportPreview,
  PortableImportExecuteResponse,
  PortableImportInput,
  PortableImportPlanResponse,
  PortableImportRevertInput,
  PortableImportRevertResult,
} from '../shared/portable';
import type {
  AppSettings,
  AppSettingsPatch,
  DiagConfirmResult,
  DiagExportResult,
} from '../shared/settings';
import type { DbGcPreview, DbGcRunResult } from '../shared/dbgc';
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
  TemplateFull,
  TemplateKind,
  TemplateMeta,
} from '../main/templates';
import type {
  AiChatConfigPatch,
  AiChatConfigSnapshot,
  AiChatResult,
  AiListModelsResult,
  AiMessage,
  AiStateSnapshot,
} from '../shared/ai';

/** 树节点 + 承载注解（TASK-T42-01；真源在 main/pages.ts，此处转出口供 renderer 使用）。 */
export type { PageNodeView } from '../main/pages';
export type { PageType } from '../main/pages';

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
  /**
   * 写 AI 对话运行时配置（TASK-T46-01）：字段缺省 = 不改、显式 null = 清回未设置、
   * 有限数 = 设值（越界在 main 侧夹紧）。返回写后生效值。
   */
  setChatConfig(input: AiChatConfigPatch): Promise<AiChatConfigSnapshot>;
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
export interface BlocksListResult {
  /** 编辑器 Block 形状（按 sort_key, id 升序）。锁页未解锁时为空数组。 */
  readonly blocks: Block[];
  /** 该页是否处于密码锁锁定态。 */
  readonly locked: boolean;
}

export interface SeptcatsBlocksApi {
  /** 提交一批 Op（renderer EditSession 产出，原样透传），返回写入条数（同事务语义由 main 侧保证）。 */
  commit(input: { ops: Op[] }): Promise<number>;
  /** 读一页的存活块；锁页未解锁返回 `{ locked: true, blocks: [] }`，已解锁返回明文块。 */
  list(input: { pageId: string }): Promise<BlocksListResult>;
  /** 订阅块变更推送，返回退订函数（main 本期只保留通道名，不推送）。 */
  onChanged(listener: (payload: unknown) => void): () => void;
}

/**
 * 页面树 IPC（TASK-T6-01 §3）。一切写路径在 main 侧先造 Op 再落库；
 * 错误码经 Error.message 透传（E_NOT_FOUND / E_PARENT_GONE / E_CYCLE / E_INVARIANT）。
 */
export interface SeptcatsPagesApi {
  /**
   * 返回 alive+deleted 全量节点（childIds/depth 已派生 + T42-01 承载注解
   * pageType/summary/updatedAt），渲染器再组树。
   */
  tree(input: { workspaceId: string }): Promise<PageNodeView[]>;
  /** 新建页（title='未命名'，sort_key=该父下 max+1；父不存在 → E_PARENT_GONE）。 */
  create(input: { parentId: string | null }): Promise<{ id: string; sortKey: string }>;
  /** T64-01：新建文件夹（page_type='folder'；标题由调用方按 locale 传入）。 */
  createFolder(input: { parentId: string | null; title: string }): Promise<{ id: string; sortKey: string }>;
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
  /**
   * 页面承载类型双向转换（TASK-T42-01）：普通页 ↔ Wiki；多维数据页/回收站页拒绝
   * （E_MALFORMED）。正文块/子页/收藏/最近/页签零触碰。
   */
  convert(input: { pageId: string; to: 'wiki' | 'page' | 'folder' }): Promise<{ ok: true }>;
  /** Wiki 落地页简介（独立于正文块）；仅 Wiki 页可设（E_MALFORMED）。 */
  setSummary(input: { pageId: string; summary: string }): Promise<{ ok: true }>;
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
  /**
   * 属性更新（TASK-T40-01）：name / type（含值迁移；title 列拒绝 E_INVARIANT）/
   * ai.prompt / options（仅 select·multi_select 全量替换，被删选项的引用值同事务清理）。
   */
  propUpdate(input: {
    pageId: string;
    pid: string;
    patch: {
      name?: string | undefined;
      type?: FieldType | undefined;
      /** `ai` 属性（type='ai'）的生成指令；空串 = 清除配置、回落默认指令（TASK-T18-04）。 */
      ai?: { prompt: string } | undefined;
      /** select / multi_select 的选项全量列表；缺 id 项由 main 侧生成。 */
      options?:
        | Array<{ id?: string | undefined; name: string; tone?: 'neutral' | 'amber' | 'red' | undefined }>
        | undefined;
    };
  }): Promise<{ collection: CollectionEntity }>;
  propRemove(input: { pageId: string; pid: string }): Promise<{ collection: CollectionEntity }>;
  /** 字段左右排序（TASK-T40-01 §B2）：`beforePid=null` = 移到末尾；标题列恒首列（E_INVARIANT）。 */
  propMove(input: {
    pageId: string;
    pid: string;
    beforePid: string | null;
  }): Promise<{ collection: CollectionEntity }>;
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

/**
 * 模板 IPC（M13 · TASK-T23-01 §0.B，数据面；UI 归 T23-02）。通道与
 * `src/shared/ipc.ts` 的 TEMPLATES_CHANNELS 一对一。
 * 错误经 Error.message 透传（E_MALFORMED / E_NO_WORKSPACE / E_NOT_FOUND /
 * E_PARENT_GONE / E_TEMPLATE_NOT_FOUND / E_INVARIANT）。
 */
export interface SeptcatsTemplatesApi {
  /** 模板列表（不含 payload；updated_at 倒序；kind 缺省 = 全部）。 */
  list(input: { kind?: TemplateKind }): Promise<{ templates: TemplateMeta[] }>;
  /** 单个模板（meta + payload，预览/编辑用）。不存在或已删 → E_TEMPLATE_NOT_FOUND。 */
  get(input: { id: string }): Promise<{ template: TemplateFull }>;
  /** 另存为模板（kind 自动判：页面有 collection → 'database'，否则 'page'）。 */
  saveFromPage(input: { pageId: string; title: string; icon?: string }): Promise<{ id: string }>;
  /** 重命名（icon 缺省 = 保持不变）。 */
  rename(input: { id: string; title: string; icon?: string }): Promise<Record<string, never>>;
  /** 软删（进回收站语义）。 */
  remove(input: { id: string }): Promise<Record<string, never>>;
  /** 从模板新建页（深拷贝：新 page/block/collection id；records 不复制）。 */
  createPage(input: { templateId: string; parentId: string | null }): Promise<{ pageId: string }>;
  /** 另存工作台模板（kind='workbench'；layout+seedPages 原样存 payload）。 */
  saveWorkbench(input: {
    title: string;
    layout: { v: 2; order: string[]; hidden: string[] };
    seedPages: Array<{ title: string; body: string }>;
  }): Promise<{ id: string }>;
}

/**
 * 工作台内置模板 IPC（TASK-T72-01 §范围3）。通道与 `src/shared/ipc.ts` 的
 * WORKBENCH_TEMPLATES_CHANNELS 一对一；只读（随包资源，零外联）。
 * 错误经 Error.message 透传（E_INVARIANT）。
 */
export interface SeptcatsWorkbenchTemplatesApi {
  /** 内置模板清单（坏 JSON 跳过不抛；order/hidden 为原始字符串，归一化由 renderer 侧把关）。 */
  list(): Promise<{
    templates: Array<{
      id: string;
      title: string;
      desc: string;
      layout: { v: 2; order: string[]; hidden: string[] };
      seedPages: Array<{ title: string; body: string }>;
    }>;
  }>;
}

/**
 * 双链 IPC（R8 · TASK-T44-01）。通道与 `src/shared/ipc.ts` 的 LINKS_CHANNELS 一对一；
 * 派生索引全本地维护（不进 Op 真相层），零外呼。
 * 错误经 Error.message 透传（E_MALFORMED / E_INVARIANT）。
 */
export interface SeptcatsLinksApi {
  /** 回链面板：引用了本页的存活源页（源页 id/当前标题 + 源块 id + 上下文片段）。 */
  backlinks(input: { pageId: string }): Promise<{
    entries: Array<{
      sourcePageId: string;
      sourceTitle: string;
      sourceBlockId: string;
      context: string;
    }>;
  }>;
  /** 全量重建派生索引（启动时自动跑一次；也可手动触发）。回索引行数。 */
  rebuild(): Promise<{ links: number }>;
}

/**
 * 原生应用菜单（T51-01）。通道与 `src/shared/ipc.ts` 的 `MENU_CHANNELS` 一对一；
 * main 侧菜单项被点击 → 推送 `{ action }`，renderer 派发到既有 actions。
 */
export interface SeptcatsMenuApi {
  /** 订阅菜单动作推送，返回退订函数。 */
  onAction(listener: (payload: { action: MenuActionId }) => void): () => void;
}

/**
 * 关窗协作（T54-01）。通道与 `src/shared/ipc.ts` 的 `CLOSE_CHANNELS` 一对一：
 * main 拦主窗 close → `onFlushRequest`（editor:flush）→ renderer 冲刷一切未提交编辑
 * → `flushAck` → main 按 settings.trayClose 路由；ask 时推 `onAsk` 弹自绘像素询问框，
 * 用户选择经 `decide`（close:decide）回 main。
 */
export interface SeptcatsCloseApi {
  /** 订阅「关窗前冲刷」请求，返回退订函数。 */
  onFlushRequest(listener: (payload: { requestId: string }) => void): () => void;
  /** 冲刷完成回执（一切未提交编辑已落库）。 */
  flushAck(input: EditorFlushAckInput): Promise<{ ok: true }>;
  /** 订阅关窗询问（main 已完成冲刷、等待用户选择），返回退订函数。 */
  onAsk(listener: () => void): () => void;
  /** 提交用户选择；remember=true 时 main 持久化 settings.trayClose。 */
  decide(input: CloseDecisionInput): Promise<{ action: CloseAction }>;
}

/**
 * 页面密码锁（TASK-T67-01-B1-01 · 后端核心）。通道与 `src/shared/ipc.ts` 的
 * LOCK_CHANNELS 一对一；载荷形状见 `src/shared/lock.ts`。错误经 Error.message 透传
 * （E_LOCK_* 稳定 code；绝不把口令/恢复码写入日志或异常栈）。
 */
export interface SeptcatsLockApi {
  /** 锁状态：{locked（页面属性）, unlockedInSession（会话属性）, failures, lockedUntil}。 */
  getStatus(input: { pageId: string }): Promise<{ locked: boolean; unlockedInSession?: boolean; failures: number; lockedUntil: number | null }>;
  /** 设锁：返回一次性恢复码（B2 弹框展示，绝不二次可读）。 */
  setPass(input: { pageId: string; pass: string }): Promise<{ recoveryCode: string }>;
  /** 校验并解锁（DK 入会话缓存）。 */
  verify(input: { pageId: string; pass: string }): Promise<{ ok: true }>;
  /** 恢复码一次性解锁并换口令：返回新恢复码。 */
  recover(input: { pageId: string; code: string; newPass: string }): Promise<{ ok: true; recoveryCode: string }>;
  /** 改口令。 */
  changePass(input: { pageId: string; oldPass: string; newPass: string }): Promise<{ ok: true }>;
  /** 移除锁（解密回明文 + 删锁行）。 */
  remove(input: { pageId: string; pass: string }): Promise<{ ok: true }>;
}

/**
 * 外部链接（TASK-T73-01）。通道与 `src/shared/ipc.ts` 的 SHELL_CHANNELS 一对一。
 * 安全护栏：main 侧仅放行 http:/https:（其余结构化拒绝）；结果不抛异常——
 * 失败经 `error.code`（E_PROTOCOL / E_EMPTY / E_MALFORMED / E_OPEN_FAILED）透传。
 * 隐私红线：审计只记 host，URL 原文不进审计正文。
 */
export interface SeptcatsShellApi {
  /** 用系统默认浏览器打开外部链接；仅 http/https 放行。 */
  openExternal(input: ShellOpenInput): Promise<ShellOpenResult>;
}

/**
 * 页面导出 Markdown（R27 · TASK-T79-01）。通道与 `src/shared/ipc.ts` 的
 * PAGE_EXPORT_CHANNELS 一对一；载荷形状见 `src/main/pageExport.ts`。
 * 全只读消费：preview 不落盘；confirm 预览→确认→落盘（目录选择取消 = 零落盘）；
 * reveal 走 shell.openPath（**非** openExternal，file:// 不在其白名单）。
 * 错误经 Error.message 透传（E_MALFORMED / E_NOT_FOUND / E_INVARIANT）。
 */
export interface SeptcatsPageExportApi {
  /** 只读预览：读库 + 列附件，返回页/文件清单与孤儿清单（零盘写）。 */
  preview(input: PageExportInput): Promise<PageExportPreview>;
  /** 落盘：dir 缺省时弹系统目录选择；用户取消 → `{canceled:true}` 且零落盘。 */
  confirm(input: PageExportInput): Promise<PageExportConfirmResponse>;
  /** 在文件管理器中打开导出目录（shell.openPath）。 */
  reveal(input: { dir: string }): Promise<{ ok: true }>;
}

/**
 * 便携包导出（R28 · TASK-T80-01）。通道与 `src/shared/ipc.ts` 的
 * PORTABLE_EXPORT_CHANNELS 一对一；载荷形状见 `src/main/portable.ts`。
 * 形状沿用 R27 纪律：preview 只回清单（零落盘）→ confirm（dir 显式）落盘 →
 * 取消 = 零落盘。错误经 Error.message 透传（含 `E_PORTABLE_ENCRYPTED_UNSUPPORTED`）。
 */
export interface SeptcatsPortableExportApi {
  /** 只读预览：列段/附件/主库条目与字节数（零盘写）。 */
  preview(): Promise<PortableExportPreview>;
  /** 落盘：单个 zip（原子写 tmp→rename）；dir 缺省时弹目录选择，取消 → `{canceled:true}`。 */
  confirm(input: PortableExportInput): Promise<PortableExportConfirmResponse>;
  /**
   * 导入预检（R28 · T80-02）：清点 + checksums 全验 + 目标库覆盖度预检，**零落盘**。
   * 选包取消 → `{canceled:true}`。
   */
  importPlan(input: PortableImportInput): Promise<PortableImportPlanResponse>;
  /** 导入执行（confirm 必须 true）：备份 → 重放（显式 replace）→ 失败逐字节还原。 */
  importExecute(
    input: PortableImportInput & { readonly confirm: true },
  ): Promise<PortableImportExecuteResponse>;
  /** 撤销导入：还原指定备份三件套（confirm 必须 true）。 */
  importRevert(input: PortableImportRevertInput): Promise<PortableImportRevertResult>;
}

/**
 * DB 面墓碑物理清除（T81-01）。通道与 `src/shared/ipc.ts` 的 DBGC_CHANNELS 一对一；
 * 载荷形状见 `src/shared/dbgc.ts`。纪律同 R27/R28：preview 只读（零写）→ run 确认执行。
 */
export interface SeptcatsDbGcApi {
  /** dry-run：扫墓碑 + 应用 planDbGc 判据，回条数/预估字节（零写）。 */
  preview(): Promise<DbGcPreview>;
  /** 确认执行：真删计划内页面（同事务分批；op_ledger 不动）。 */
  run(): Promise<DbGcRunResult>;
}

export interface SeptcatsApi {
  /** IPC 自检：主进程返回当前时间戳字符串。 */
  ping(): Promise<string>;  /** 应用元信息（名称/版本/schema 版本）。 */
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
  /** 模板（M13 · T23-01 数据面）。 */
  templates: SeptcatsTemplatesApi;
  /** 工作台内置模板（TASK-T72-01 §范围3，只读资源）。 */
  workbenchTemplates: SeptcatsWorkbenchTemplatesApi;
  /** 双链（R8 · T44-01）。 */
  links: SeptcatsLinksApi;
  /** 页面密码锁（TASK-T67-01-B1-01 · 后端核心）。 */
  lock: SeptcatsLockApi;
  /** 原生应用菜单（T51-01）。 */
  menu: SeptcatsMenuApi;
  /** 关窗协作（T54-01：冲刷握手 + 自绘询问框）。 */
  close: SeptcatsCloseApi;
  /** 外部链接（TASK-T73-01：shell.openExternal，协议白名单）。 */
  shell: SeptcatsShellApi;
  /** 页面导出 Markdown（R27 · T79-01）。 */
  pageExport: SeptcatsPageExportApi;
  /** 便携包导出（R28 · T80-01）。 */
  portable: SeptcatsPortableExportApi;
  /** DB 面墓碑物理清除（T81-01）。 */
  dbgc: SeptcatsDbGcApi;
}

declare global {
  interface Window {
    septcats: SeptcatsApi;
  }
}
