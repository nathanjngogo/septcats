/**
 * DbServer ⇄ 主进程 的 RPC 消息协议（M2 · TASK-T2-01 §3）。
 *
 * 约束（任务书 §1）：本文件是 shared 与 main 都 import 的**纯协议层**——
 * 只描述“线上格式”，不 import electron，也不引任何运行时依赖。真正的
 * SQLite 访问只发生在 DbServer（utilityProcess）里，主进程/渲染器永远拿不到它。
 *
 * 传输：Electron `utilityProcess` 的结构化克隆消息（非 JSON 文本），
 * 因此这里用普通的 TS 判别联合表示请求/应答即可。
 */

/** client 侧请求的默认超时（毫秒）。 */
export const DB_RPC_TIMEOUT_MS = 10_000;

/** 请求相关事实常量：与 client 的 dispose 宽限期共用。 */
export const DB_DISPOSE_GRACE_MS = 2_000;

/**
 * 错误码：稳定字符串，日志与 UI 可据此分支，不得随手改名。
 * - 前六项由 DbServer 产生，后两项只由 client（主进程侧）产生。
 */
export type DbErrorCode =
  /** sqlId 不在白名单内（**安全红线**：绝不接受任意 SQL 字符串）。 */
  | 'E_UNKNOWN_STATEMENT'
  /** params 未通过该语句的 zod schema（错误消息不得含参数值）。 */
  | 'E_BAD_PARAMS'
  /** sqlId 的 kind 与调用方式不符（如 get 语句走了 run）。 */
  | 'E_WRONG_KIND'
  /** 请求整体结构非法（不是合法的 DbRequest）。 */
  | 'E_BAD_REQUEST'
  /** 数据库连接已关闭。 */
  | 'E_NOT_READY'
  /** 未预期异常（DB 报错、段非法、内部语句缺失等）。 */
  | 'E_INTERNAL'
  /** client 侧：应答超时。 */
  | 'E_TIMEOUT'
  /** client 侧：DbServer 进程退出，所有挂起请求被拒绝。 */
  | 'E_DBPROCESS_EXIT';

export interface DbErrorPayload {
  readonly code: DbErrorCode;
  readonly message: string;
}

/** batch 参数里单条语句：白名单 id + 未校验的参数对象。 */
export interface DbBatchStatement {
  readonly sqlId: string;
  readonly params: unknown;
}

/**
 * 请求联合体（判别字段 `t`）。与任务书 §3 一一对应。
 */
export type DbRequest =
  | { readonly id: string; readonly t: 'migrate' }
  | { readonly id: string; readonly t: 'run'; readonly sqlId: string; readonly params: unknown }
  | { readonly id: string; readonly t: 'get'; readonly sqlId: string; readonly params: unknown }
  | { readonly id: string; readonly t: 'all'; readonly sqlId: string; readonly params: unknown }
  | { readonly id: string; readonly t: 'batch'; readonly stmts: readonly DbBatchStatement[] }
  | {
      readonly id: string;
      readonly t: 'ftsSearch';
      readonly workspaceId: string;
      readonly query: string;
      readonly limit: number;
    }
  | { readonly id: string; readonly t: 'exportSnapshot' }
  | { readonly id: string; readonly t: 'rebuildFromSegments'; readonly segmentsJson: string }
  | { readonly id: string; readonly t: 'integrityCheck' }
  /** R28（T80-01）：便携包/备份前强制 `PRAGMA wal_checkpoint(TRUNCATE)`（先例 migrations.ts）。 */
  | { readonly id: string; readonly t: 'checkpoint' }
  | { readonly id: string; readonly t: 'backupTo'; readonly destPath: string };

export type DbRequestType = DbRequest['t'];

// ---------------------------------------------------------------------------
// 应答数据
// ---------------------------------------------------------------------------

export interface MigrateData {
  readonly from: number;
  readonly to: number;
}

export interface RunData {
  readonly changes: number;
  readonly lastInsertRowid: number;
}

/** get：`row` 为 null 表示未命中。 */
export interface GetData {
  readonly row: unknown;
}

export interface AllData {
  readonly rows: unknown[];
}

export interface BatchStepData {
  readonly sqlId: string;
  readonly data: RunData | GetData | AllData;
}

export interface BatchData {
  readonly results: BatchStepData[];
}

export interface FtsSearchRow {
  readonly page_id: string;
  readonly title: string;
  /** bm25() 得分，越小越相关。 */
  readonly score: number;
  readonly snippet: string;
}

export interface FtsSearchData {
  readonly rows: FtsSearchRow[];
}

export interface ExportSnapshotData {
  /** core.opsToSnapshot 产出的稳定键序快照 JSON。 */
  readonly json: string;
}

export interface RebuildData {
  readonly segments: number;
  readonly ops: number;
  readonly entities: number;
}

export interface IntegrityCheckData {
  readonly ok: boolean;
  readonly messages: string[];
}

export interface BackupData {
  readonly path: string;
}

/** `PRAGMA wal_checkpoint(TRUNCATE)` 的结果（非 WAL 模式恒 0，不算失败）。 */
export interface CheckpointData {
  readonly busy: number;
  readonly log: number;
  readonly checkpointed: number;
}

export type DbResponseData =
  | MigrateData
  | RunData
  | GetData
  | AllData
  | BatchData
  | FtsSearchData
  | ExportSnapshotData
  | RebuildData
  | IntegrityCheckData
  | BackupData
  | CheckpointData;

/** 应答联合体：ok=true 时必有 data，ok=false 时必有 error。 */
export type DbResponse<T extends DbResponseData = DbResponseData> =
  | { readonly id: string; readonly ok: true; readonly data: T }
  | { readonly id: string; readonly ok: false; readonly error: DbErrorPayload };

/** 构造成功应答。 */
export function dbOk<T extends DbResponseData>(
  id: string,
  data: T,
): { readonly id: string; readonly ok: true; readonly data: T } {
  return { id, ok: true, data };
}

/** 构造失败应答。 */
export function dbFail(
  id: string,
  code: DbErrorCode,
  message: string,
): { readonly id: string; readonly ok: false; readonly error: DbErrorPayload } {
  return { id, ok: false, error: { code, message } };
}

const REQUEST_TYPES: ReadonlySet<string> = new Set<DbRequestType>([
  'migrate',
  'run',
  'get',
  'all',
  'batch',
  'ftsSearch',
  'exportSnapshot',
  'rebuildFromSegments',
  'integrityCheck',
  'checkpoint',
  'backupTo',
]);

/** 运行时守卫：收到的消息是否形如合法请求（server 用于拒绝脏输入）。 */
export function isDbRequest(value: unknown): value is DbRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { id?: unknown; t?: unknown };
  return typeof candidate.id === 'string' && typeof candidate.t === 'string' && REQUEST_TYPES.has(candidate.t);
}

/** 运行时守卫：收到的消息是否形如应答（client 用于忽略无关消息）。 */
export function isDbResponse(value: unknown): value is DbResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { id?: unknown; ok?: unknown };
  return typeof candidate.id === 'string' && typeof candidate.ok === 'boolean';
}
