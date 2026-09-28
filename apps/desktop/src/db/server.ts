/**
 * DbServer —— Electron `utilityProcess` 内的数据库服务入口（TASK-T2-01 §3/§6）。
 *
 * 职责：**独占** better-sqlite3；对外只暴露 RPC 白名单（`./statements`），
 * 渲染器/主进程永远不 import better-sqlite3。启动时打开库 → 跑 PRAGMA 基线 →
 * 迁移 → 完整性检查；之后按 `DbRequest` 派发、执行、应答 `DbResponse`。
 *
 * 可测试性：真正的派发逻辑收口在 `createDbServerCore(db)`，它**不依赖 Electron**，
 * 也不在顶层加载 better-sqlite3——测试可以自己 `new Database(临时库)` 后直接调用。
 * 只有作为 utilityProcess 被 fork 时（`process.parentPort` 存在）才会拉起入口逻辑。
 */

import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  decodeOp,
  encodeOp,
  opSchema,
  opsToSnapshot,
  replay,
  validateSegment,
  type Entity,
  type Op,
  type Segment,
  type TargetTable,
} from '@septcats/core';
import {
  applyPragmaBaseline,
  loadSqliteConstructor,
  migrate,
  type SqliteConstructor,
  type SqliteDatabase,
} from './migrations';
import { ftsPageBodyExpr } from './schema.v4';
import { rebuildLinkIndexSync } from './linkRebuild';
import { getStatement, type StatementDefinition, type StatementKind } from './statements';
import {
  dbFail,
  dbOk,
  isDbRequest,
  type AllData,
  type BatchStepData,
  type ConnectionData,
  type DbErrorCode,
  type DbRequest,
  type DbResponse,
  type FtsSearchRow,
  type GetData,
  type IntegrityCheckData,
  type RebuildMode,
  type RunData,
} from './rpc';

// ---------------------------------------------------------------------------
// 内部错误：携带稳定错误码，供派发层转成 DbResponse
// ---------------------------------------------------------------------------

class RpcFailure extends Error {
  readonly code: DbErrorCode;

  constructor(code: DbErrorCode, message: string) {
    super(message);
    this.name = 'RpcFailure';
    this.code = code;
    Object.setPrototypeOf(this, RpcFailure.prototype);
  }
}

// ---------------------------------------------------------------------------
// 内部 SQL（不走白名单的维护语句：FTS 检索与重建，仅 server 自己调用）
// ---------------------------------------------------------------------------

/** bm25 + snippet 的中文子串检索（trigram）。 */
const FTS_SEARCH_SQL = `SELECT
  page_id,
  title,
  bm25(page_block_fts) AS score,
  snippet(page_block_fts, -1, '[', ']', '…', 12) AS snippet
FROM page_block_fts
WHERE page_block_fts MATCH @query
  AND workspace_id = @workspaceId
ORDER BY score ASC
LIMIT @limit`;

/**
 * <3 字兜底（TASK-T20-01）：trigram tokenizer 最小 MATCH 单元是 3 字，1–2 字
 * 短词在 MATCH 下恒 0 条。扫 page_block_fts 底表 LIKE：join page alive=1；
 * @like 由分派层做 \ % _ ESCAPE 转义；标题命中优先，同级 updated_at desc 稳定序。
 * 行形状与 FTS_SEARCH_SQL 一致（page_id/title/score/snippet）。
 */
const FTS_LIKE_SEARCH_SQL = `SELECT
  f.page_id AS page_id,
  p.title AS title,
  1.0 AS score,
  CASE
    WHEN instr(lower(f.body), @needle) > 0
      THEN substr(f.body, max(1, instr(lower(f.body), @needle) - 24), 88)
    ELSE f.title
  END AS snippet
FROM page_block_fts f
JOIN page p ON p.id = f.page_id
WHERE f.workspace_id = @workspaceId
  AND p.alive = 1
  AND (f.title LIKE @like ESCAPE '\\' OR f.body LIKE @like ESCAPE '\\')
ORDER BY CASE WHEN p.title LIKE @like ESCAPE '\\' THEN 0 ELSE 1 END ASC, p.updated_at DESC, f.page_id
LIMIT @limit`;

/** LIKE 通配符收口：\ % _ 前加转义符（配合语句里的 ESCAPE '\'；与 main/search.ts 同源）。 */
function toLikePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * 全量重算 FTS 索引（TASK-T8-01 §2.2 重写）：body 聚合该页全部 text-ish 块的
 * props.title + content 深层 `text` 串（json_tree，与 v4 触发器 / fts.syncBlock
 * 共用 ftsPageBodyExpr，见 schema.v4.ts）。rebuild/物化写入后调用，保证结果与
 * 「插入顺序」无关（FTS 行由触发器维护，而块可能先于其页面被写入）。
 * 导出仅供 selftest 做全量重算计时断言（TASK-T8-01 DoD）。
 */
export const FTS_RESYNC_SQL = `DELETE FROM page_block_fts;
INSERT INTO page_block_fts (title, body, page_id, workspace_id)
SELECT p.title, ${ftsPageBodyExpr('p.id')}, p.id, p.workspace_id
FROM page p
WHERE p.alive = 1;`;

/** 从分段重建前清空物化视图与事件账（分段才是真相）。
 *  H-06（R42）补派生表：page_link_index 由事务尾部 rebuildLinkIndexSync 全量重算；
 *  mention 是 schema.v2 预留的派生反链表（当前零写入方），一并清防未来回填漂移。 */
const REBUILD_CLEAR_SQL: readonly string[] = [
  'DELETE FROM page_block_fts',
  'DELETE FROM page_link_index',
  'DELETE FROM mention',
  'DELETE FROM record',
  'DELETE FROM block',
  'DELETE FROM collection',
  'DELETE FROM page',
  'DELETE FROM op_ledger',
];

/** 物化写入顺序：page 先行，block 最后（块的 FTS 触发器需要页面已存在）。 */
const TABLE_INSERT_ORDER: Readonly<Record<TargetTable, number>> = {
  page: 0,
  collection: 1,
  record: 2,
  block: 3,
  schema: 4,
  template: 5,
};

/** 实体表 → 白名单 upsert 语句。'schema' 无物化表（M3 定稿前不落地）。 */
const STATEMENT_FOR_TABLE: Readonly<Partial<Record<TargetTable, string>>> = {
  page: 'page.upsert',
  block: 'block.upsert',
  collection: 'collection.upsert',
  record: 'record.upsert',
  // T23-01：模板实体从快照/分段重建时经 template.upsert 重物化
  template: 'template.upsert',
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ZodIssueLike {
  readonly path?: readonly PropertyKey[];
  readonly message?: unknown;
}

/**
 * 把 zod 校验失败压成人类可读文本。**只输出字段路径与类型描述，绝不回显参数值**
 * （任务书 §3 防泄露要求）。
 */
function describeZodIssues(error: unknown): string {
  const issues = (error as { issues?: readonly ZodIssueLike[] }).issues;
  if (!Array.isArray(issues)) {
    return '参数校验失败';
  }
  const parts = issues.map((issue) => {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
    const message = typeof issue.message === 'string' ? issue.message : '非法值';
    return path.length > 0 ? `${path}: ${message}` : message;
  });
  return parts.length > 0 ? parts.join('；') : '参数校验失败';
}

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function removeFileQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // 删除失败不致命：后续操作会给出真实错误
  }
}

// ---------------------------------------------------------------------------
// 语句执行（白名单唯一入口）
// ---------------------------------------------------------------------------

/**
 * prepare 的产物类型（结构化最小面，只取本文件用到的 run/get/all）。
 * 不直接用 better-sqlite3 的 Statement 泛型别名——其条件泛型在 ReturnType
 * 推导下会落到元组分支，run(...args) 展开报 TS2556。
 */
interface PreparedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * prepare 缓存（TASK-T15-01 §2.4）：按连接缓存白名单语句的 prepare 结果。
 * rebuild 34k 条 ledger 插入与 batch 402 条语句此前**每条语句重新 prepare**，
 * 微基准 ≈4.4s 纯开销；sqlId→sql 不可变（白名单是常量表），按 sqlId 缓存安全。
 * 连接可变（迁移文件级还原会换连接），故外层用 WeakMap 挂在连接实例上，
 * 旧连接被弃时缓存整体随之失效，无泄漏、无跨连接复用。
 */
const PREPARE_CACHE = new WeakMap<SqliteDatabase, Map<string, PreparedStatement>>();

function getPrepared(db: SqliteDatabase, cacheKey: string, sql: string): PreparedStatement {
  let cache = PREPARE_CACHE.get(db);
  if (cache === undefined) {
    cache = new Map<string, PreparedStatement>();
    PREPARE_CACHE.set(db, cache);
  }
  let statement = cache.get(cacheKey);
  if (statement === undefined) {
    statement = db.prepare(sql);
    cache.set(cacheKey, statement);
  }
  return statement;
}

function executeStatement(
  db: SqliteDatabase,
  sqlId: string,
  params: unknown,
  expectedKind?: StatementKind,
): RunData | GetData | AllData {
  const definition: StatementDefinition | null = getStatement(sqlId);
  if (definition === null) {
    throw new RpcFailure('E_UNKNOWN_STATEMENT', `未知语句：${sqlId}`);
  }
  if (expectedKind !== undefined && definition.kind !== expectedKind) {
    throw new RpcFailure(
      'E_WRONG_KIND',
      `语句 ${sqlId} 的 kind=${definition.kind}，不能以 ${expectedKind} 调用`,
    );
  }

  const parsed = definition.params.safeParse(params === undefined ? {} : params);
  if (!parsed.success) {
    throw new RpcFailure('E_BAD_PARAMS', describeZodIssues(parsed.error));
  }

  const statement = getPrepared(db, sqlId, definition.sql);
  const record = parsed.data as Record<string, unknown>;
  const args: unknown[] = Object.keys(record).length > 0 ? [record] : [];

  if (definition.kind === 'run') {
    const result = statement.run(...args);
    return { changes: result.changes, lastInsertRowid: toNumber(result.lastInsertRowid) };
  }
  if (definition.kind === 'get') {
    return { row: statement.get(...args) ?? null };
  }
  return { rows: statement.all(...args) };
}

// ---------------------------------------------------------------------------
// Op 物化（rebuild 用：把 core 重放出的实体映射回物化表列）
// ---------------------------------------------------------------------------

function readString(data: Record<string, unknown>, key: string, fallback: string | null): string | null {
  const value = data[key];
  return typeof value === 'string' ? value : fallback;
}

function readNumber(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readJsonText(data: Record<string, unknown>, key: string, fallback: string): string {
  const value = data[key];
  return value === undefined ? fallback : JSON.stringify(value);
}

function readNullableJsonText(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * 读可空整数（v2 的 `page.deleted_at`）。
 * 注意：`deleted_at` 是**设备本地**列，不进 Op payload —— 因此从分段重建后，
 * tombstone 行的 deleted_at 为 null（不再出现在回收站列表里，等同可 GC）。见交付报告未决项。
 */
function readNullableNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 把重放出的实体映射成对应 upsert 语句的参数（列名照抄 §6.2）。 */
function entityToParams(entity: Entity): Record<string, unknown> {
  const data = entity.data;
  switch (entity.table) {
    case 'page':
      return {
        id: entity.id,
        workspace_id: readString(data, 'workspace_id', '') ?? '',
        title: readString(data, 'title', '') ?? '',
        icon: readString(data, 'icon', null),
        cover: readString(data, 'cover', null),
        parent_id: readString(data, 'parent_id', null),
        sort_key: readString(data, 'sort_key', 'A00000000') ?? 'A00000000',
        alive: entity.alive,
        version: entity.version,
        deleted_at: readNullableNumber(data, 'deleted_at'),
        updated_at: readNumber(data, 'updated_at', 0),
      };
    case 'block':
      return {
        id: entity.id,
        page_id: readString(data, 'page_id', '') ?? '',
        workspace_id: readString(data, 'workspace_id', '') ?? '',
        type: readString(data, 'type', 'paragraph') ?? 'paragraph',
        props_json: readJsonText(data, 'props', '{}'),
        content_json: readNullableJsonText(data, 'content'),
        sort_key: readString(data, 'sort_key', 'A00000000') ?? 'A00000000',
        alive: entity.alive,
        version: entity.version,
        lamport_c: entity.lamport.c,
        lamport_d: entity.lamport.d,
        updated_at: readNumber(data, 'updated_at', 0),
      };
    case 'collection':
      return {
        id: entity.id,
        page_id: readString(data, 'page_id', null),
        workspace_id: readString(data, 'workspace_id', '') ?? '',
        name: readString(data, 'name', null),
        schema_json: readJsonText(data, 'schema', '{}'),
        views_json: readJsonText(data, 'views', '[]'),
        alive: entity.alive,
        version: entity.version,
        lamport_c: entity.lamport.c,
        lamport_d: entity.lamport.d,
        updated_at: readNumber(data, 'updated_at', 0),
      };
    case 'record':
      return {
        id: entity.id,
        collection_id: readString(data, 'collection_id', '') ?? '',
        workspace_id: readString(data, 'workspace_id', '') ?? '',
        values_json: readJsonText(data, 'values', '{}'),
        sort_key: readString(data, 'sort_key', 'A00000000') ?? 'A00000000',
        alive: entity.alive,
        version: entity.version,
        lamport_c: entity.lamport.c,
        lamport_d: entity.lamport.d,
        updated_at: readNumber(data, 'updated_at', 0),
      };
    case 'schema':
      return {};
    case 'template':
      // T23-01：模板实体（op payload = 模板对象全量，replay 后 data 即其键）
      return {
        id: entity.id,
        kind: readString(data, 'kind', 'page'),
        title: readString(data, 'title', ''),
        icon: readString(data, 'icon', null),
        payload: readJsonText(data, 'payload', '{}'),
        alive: entity.alive,
        version: entity.version,
        created_at: readNullableNumber(data, 'created_at'),
        updated_at: readNumber(data, 'updated_at', 0),
        deleted_at: readNullableNumber(data, 'deleted_at'),
      };
  }
  return {};
}

function applyEntity(db: SqliteDatabase, entity: Entity): void {
  const sqlId = STATEMENT_FOR_TABLE[entity.table];
  if (sqlId === undefined) {
    return;
  }
  executeStatement(db, sqlId, entityToParams(entity), 'run');
}

function orderEntities(entities: readonly Entity[]): Entity[] {
  return [...entities].sort((a, b) => {
    const byTable = TABLE_INSERT_ORDER[a.table] - TABLE_INSERT_ORDER[b.table];
    if (byTable !== 0) {
      return byTable;
    }
    if (a.id === b.id) {
      return 0;
    }
    return a.id < b.id ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// 分段解析 / op_ledger 读取
// ---------------------------------------------------------------------------

function requireStatement(sqlId: string): StatementDefinition {
  const definition = getStatement(sqlId);
  if (definition === null) {
    throw new RpcFailure('E_INTERNAL', `内部语句缺失：${sqlId}`);
  }
  return definition;
}

/** 解析并校验 `Segment[]` JSON：结构不变量 + 每条 op 的 schema 与语义都过一遍。 */
function parseSegments(segmentsJson: string): Segment[] {
  let raw: unknown;
  try {
    raw = JSON.parse(segmentsJson);
  } catch (error) {
    throw new RpcFailure('E_BAD_PARAMS', `segmentsJson 不是合法 JSON：${describeError(error)}`);
  }
  if (!Array.isArray(raw)) {
    throw new RpcFailure('E_BAD_PARAMS', 'segmentsJson 必须是 Segment[] 数组');
  }

  const segments: Segment[] = [];
  try {
    for (let index = 0; index < raw.length; index += 1) {
      const segment = raw[index] as Segment;
      const issues = validateSegment(segment);
      if (issues.length > 0) {
        throw new RpcFailure('E_BAD_PARAMS', `第 ${index + 1} 段非法：${issues.join('；')}`);
      }
      const opIssues: string[] = [];
      for (const op of segment.ops) {
        const parsed = opSchema.safeParse(op);
        if (!parsed.success) {
          opIssues.push(describeZodIssues(parsed.error));
          continue;
        }
        try {
          encodeOp(parsed.data);
        } catch (error) {
          opIssues.push(describeError(error));
        }
      }
      if (opIssues.length > 0) {
        throw new RpcFailure('E_BAD_PARAMS', `段 ${segment.seg_id} 含非法 op：${opIssues.join('；')}`);
      }
      segments.push(segment);
    }
  } catch (error) {
    if (error instanceof RpcFailure) {
      throw error;
    }
    throw new RpcFailure('E_BAD_PARAMS', `segmentsJson 结构非法：${describeError(error)}`);
  }
  return segments;
}

function readLedgerOps(db: SqliteDatabase): Op[] {
  return readLedgerRows(db).map((row) => row.op);
}

/**
 * 账本全量读取（含 seg_id）。T82-01：merge 模式据此挑出「段未覆盖」的本机 op
 * 并保留其原 seg_id（replace 模式不读）。
 */
function readLedgerRows(db: SqliteDatabase): Array<{ op: Op; segId: string | null }> {
  const data = executeStatement(db, 'opLedger.listAll', {}, 'all');
  if (!('rows' in data)) {
    throw new RpcFailure('E_INTERNAL', 'op_ledger 读取失败');
  }
  const rows: Array<{ op: Op; segId: string | null }> = [];
  for (const row of data.rows) {
    const json = (row as { op_json?: unknown }).op_json;
    const segId = (row as { seg_id?: unknown }).seg_id;
    if (typeof json !== 'string') {
      throw new RpcFailure('E_INTERNAL', 'op_ledger 行缺少 op_json');
    }
    try {
      rows.push({ op: decodeOp(json), segId: typeof segId === 'string' ? segId : null });
    } catch (error) {
      throw new RpcFailure('E_INTERNAL', `op_ledger 中存在非法 op：${describeError(error)}`);
    }
  }
  return rows;
}

function toFtsPhrase(query: string): string {
  // FTS5 字符串字面量：整体作为短语（trigram 下等价子串检索），内部双引号翻倍
  return `"${query.replace(/"/g, '""')}"`;
}

function clampLimit(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 20;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 500);
}

// ---------------------------------------------------------------------------
// DbServer Core：与 Electron 无关的派发层
// ---------------------------------------------------------------------------

export interface DbServerCore {
  /** 当前活动连接（迁移发生文件级还原后可能已替换）。 */
  activeDatabase(): SqliteDatabase;
  /** 处理一条原始消息，永不抛异常（错误统一进 DbResponse）。 */
  handleRequest(raw: unknown): Promise<DbResponse>;
  /** 启动自检：迁移 + 完整性检查（失败只记录，不阻断后续请求）。 */
  bootstrap(): Promise<void>;
  /** 关闭连接（幂等；含 `closeConnection` 释放后的连接）。 */
  dispose(): void;
  /**
   * T80-04（H-09）：释放主库文件句柄（进程不杀、RPC 句柄身份不变）。
   * 文件级还原（revert / execute 回滚）前必须先调它，否则 Windows 下删除/覆写
   * 主库撞 EBUSY。幂等；已释放时返回 `{open:false}`。
   */
  closeConnection(): Promise<ConnectionData>;
  /**
   * T80-04（H-09）：释放后按原库路径重建连接（照 `migrations.reopenDatabase`：
   * new Database + `applyPragmaBaseline`）。未释放时为幂等（返回 `{open:true}`）。
   */
  reopenConnection(): Promise<ConnectionData>;
}

export function createDbServerCore(
  database: SqliteDatabase,
  dbPath: string = database.name,
): DbServerCore {
  let current = database;
  const path = dbPath.length > 0 ? dbPath : database.name;
  /** 进程级终态（dispose 置位，不可再开）。 */
  let disposed = false;
  /** 连接打开态：closeConnection 置 false，reopenConnection 置 true。 */
  let connectionOpen = true;

  /** 服务器内部直接使用（等价于 run/get/all，但已带 kind 断言）。 */
  async function dispatch(request: DbRequest): Promise<DbResponse> {
    const id = request.id;
    switch (request.t) {
      case 'migrate': {
        const result = await migrate(current);
        if (result.db !== current) {
          current = result.db;
        }
        if (result.error !== undefined) {
          return dbFail(id, 'E_INTERNAL', `迁移失败：${result.error.message}`);
        }
        return dbOk(id, { from: result.from, to: result.to });
      }
      case 'run':
      case 'get':
      case 'all': {
        const data = executeStatement(current, request.sqlId, request.params, request.t);
        return dbOk(id, data);
      }
      case 'batch': {
        const steps = request.stmts;
        const results: BatchStepData[] = [];
        // 单事务：任一语句失败 → 抛错 → better-sqlite3 回滚 → 整体失败
        const runBatch = current.transaction(() => {
          for (const step of steps) {
            results.push({ sqlId: step.sqlId, data: executeStatement(current, step.sqlId, step.params) });
          }
        });
        runBatch();
        return dbOk(id, { results });
      }
      case 'ftsSearch': {
        const query = request.query.trim();
        if (query.length === 0) {
          return dbOk(id, { rows: [] });
        }
        const limit = clampLimit(request.limit);
        // <3 字（1–2 字中文短词）：trigram MATCH 拿不到结果，走底表 LIKE 兜底
        if ([...query].length < 3) {
          const likeStatement = current.prepare(FTS_LIKE_SEARCH_SQL);
          const likeRows = likeStatement.all({
            like: toLikePattern(query),
            needle: query.toLowerCase(),
            workspaceId: request.workspaceId,
            limit,
          }) as FtsSearchRow[];
          return dbOk(id, { rows: likeRows });
        }
        const statement = current.prepare(FTS_SEARCH_SQL);
        const rows = statement.all({
          query: toFtsPhrase(query),
          workspaceId: request.workspaceId,
          limit,
        }) as FtsSearchRow[];
        return dbOk(id, { rows });
      }
      case 'exportSnapshot': {
        const ops = readLedgerOps(current);
        const { projection } = replay(ops);
        return dbOk(id, { json: opsToSnapshot(projection) });
      }
      case 'rebuildFromSegments': {
        const segments = parseSegments(request.segmentsJson);
        // T82-01（H-04 P0）：缺省 merge（安全侧）——并集重建，段未覆盖的本机 op
        // 一律保留；只有显式 'replace' 才走「清表后仅重放段」的旧语义。
        const mode: RebuildMode = request.mode === 'replace' ? 'replace' : 'merge';
        const ops: Op[] = [];
        const segIdByOpId = new Map<string, string | null>();
        for (const segment of segments) {
          for (const op of segment.ops) {
            ops.push(op);
            if (!segIdByOpId.has(op.op_id)) {
              segIdByOpId.set(op.op_id, segment.seg_id);
            }
          }
        }
        // merge：本机账本里「段未覆盖」的 op 一并进重放集（保留其原 seg_id）。
        // 这是 H-04 的数据保全面——同步刚开启时段集远小于账本，replace 会把
        // 这些历史永久抹除（老板真实库 442 页 → 1 页）。
        const keptOps: Array<{ op: Op; segId: string | null }> = [];
        if (mode === 'merge') {
          const segOpIds = new Set(ops.map((op) => op.op_id));
          for (const row of readLedgerRows(current)) {
            if (!segOpIds.has(row.op.op_id)) {
              keptOps.push(row);
              segIdByOpId.set(row.op.op_id, row.segId);
            }
          }
          for (const row of keptOps) {
            ops.push(row.op);
          }
        }
        const { projection } = replay(ops);
        const entities = orderEntities(projection.entities());
        const ledgerSql = requireStatement('opLedger.insert').sql;

        const rebuild = current.transaction(() => {
          // FTS defer（TASK-T15-01）：事务头置 flag=1，v6 触发器的 WHEN 守卫
          // 跳过逐行整页重算（34k 块插入 × 整页重算的 O(n²) 根因）；事务末
          // FTS_RESYNC 全量重算一次（唯一一次），再复位 flag=0。flag 与数据
          // 同事务：中途 throw → better-sqlite3 回滚把 flag 一并回 0。
          current.exec('UPDATE fts_defer SET flag = 1');
          for (const sql of REBUILD_CLEAR_SQL) {
            current.exec(sql);
          }
          const insertLedger = getPrepared(current, 'opLedger.insert', ledgerSql);
          for (const op of ops) {
            insertLedger.run({
              op_id: op.op_id,
              seg_id: segIdByOpId.get(op.op_id) ?? null,
              lamport_c: op.lamport.c,
              lamport_d: op.lamport.d,
              target_table: op.target.table,
              target_id: op.target.id,
              op_json: encodeOp(op),
              applied_at: op.at,
            });
          }
          for (const entity of entities) {
            applyEntity(current, entity);
          }
          current.exec(FTS_RESYNC_SQL);
          // H-06（R42 还债）：page_link_index 是派生投影（不在段/Op 真相里），
          // 重建必须与 FTS 同事务同步重算，否则回链面板残留指向已消失页的旧行。
          // 同事务=同回滚语义（中途 throw 一并回滚）；解析口径与 main/links.ts 同源。
          rebuildLinkIndexSync(current);
          current.exec('UPDATE fts_defer SET flag = 0');
          return {
            segments: segments.length,
            ops: ops.length,
            entities: entities.length,
            mode,
            keptOps: keptOps.length,
          };
        });
        return dbOk(id, rebuild());
      }
      case 'integrityCheck': {
        const rows = current.pragma('integrity_check') as Array<Record<string, unknown>>;
        const messages = rows.flatMap((row) =>
          Object.values(row).filter((value): value is string => typeof value === 'string'),
        );
        const ok = messages.every((message) => message === 'ok');
        return dbOk(id, { ok, messages: ok ? [] : messages });
      }
      /**
       * R28（TASK-T80-01）：便携包导出的第一步——`PRAGMA wal_checkpoint(TRUNCATE)`
       * （同款先例 `db/migrations.ts` 备份前 checkpoint）。非 WAL / 空库时 pragma 不抛，
       * 只返回全 0（调用方不因此失败）。
       */
      case 'checkpoint': {
        const rows = current.pragma('wal_checkpoint(TRUNCATE)') as Array<Record<string, unknown>>;
        const first = rows[0] ?? {};
        const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
        return dbOk(id, {
          busy: num(first['busy']),
          log: num(first['log']),
          checkpointed: num(first['checkpointed']),
        });
      }
      case 'backupTo': {
        const destPath = request.destPath;
        if (typeof destPath !== 'string' || destPath.length === 0) {
          return dbFail(id, 'E_BAD_PARAMS', 'destPath 必填');
        }
        try {
          mkdirSync(dirname(destPath), { recursive: true });
        } catch {
          // 目录已存在或路径不可建，交由 backup 报错
        }
        removeFileQuietly(destPath);
        removeFileQuietly(`${destPath}-wal`);
        removeFileQuietly(`${destPath}-shm`);
        await current.backup(destPath);
        return dbOk(id, { path: destPath });
      }
      /**
       * T80-04（H-09）：释放主库文件句柄。Windows 下 better-sqlite3 打开的 .db
       * 不允许被删除/覆写（EBUSY），文件级还原前必须先关连接。幂等：已关则直接成功。
       */
      case 'closeConnection': {
        if (connectionOpen) {
          try {
            current.close();
          } catch (error) {
            return dbFail(id, 'E_INTERNAL', `释放数据库连接失败：${describeError(error)}`);
          }
          connectionOpen = false;
        }
        return dbOk(id, { open: false } satisfies ConnectionData);
      }
      /**
       * T80-04（H-09）：按原库路径重建连接（照 migrations.reopenDatabase：
       * new Database + applyPragmaBaseline；旧连接已 close 不能复用）。幂等。
       */
      case 'reopenConnection': {
        if (!connectionOpen) {
          try {
            const SqliteCtor: SqliteConstructor = await loadSqliteConstructor();
            const next = new SqliteCtor(path);
            applyPragmaBaseline(next);
            current = next;
            connectionOpen = true;
          } catch (error) {
            return dbFail(id, 'E_INTERNAL', `重建数据库连接失败：${describeError(error)}`);
          }
        }
        return dbOk(id, { open: true } satisfies ConnectionData);
      }
      default: {
        return dbFail(id, 'E_BAD_REQUEST', '未知请求类型');
      }
    }
  }

  async function handleRequest(raw: unknown): Promise<DbResponse> {
    if (!isDbRequest(raw)) {
      return dbFail(extractRequestId(raw), 'E_BAD_REQUEST', '请求结构非法');
    }
    if (disposed) {
      return dbFail(raw.id, 'E_NOT_READY', '数据库连接已关闭');
    }
    // closeConnection 释放后只有 reopenConnection / closeConnection 可达（幂等），
    // 其余请求按 E_NOT_READY 拒——避免在无连接态下 prepare 抛未捕获异常。
    if (!connectionOpen && raw.t !== 'reopenConnection' && raw.t !== 'closeConnection') {
      return dbFail(raw.id, 'E_NOT_READY', '数据库连接已释放（等待 reopenConnection）');
    }
    try {
      return await dispatch(raw);
    } catch (error) {
      if (error instanceof RpcFailure) {
        return dbFail(raw.id, error.code, error.message);
      }
      return dbFail(raw.id, 'E_INTERNAL', describeError(error));
    }
  }

  /** 维护类请求（close/reopen）走与 IPC 同一派发路径，保证回执形状一致。 */
  async function runMaintenance(
    t: 'closeConnection' | 'reopenConnection',
  ): Promise<ConnectionData> {
    const response = await handleRequest({ id: `__${t}__`, t });
    if (!response.ok) {
      throw new RpcFailure(response.error.code, response.error.message);
    }
    return response.data as ConnectionData;
  }

  return {
    activeDatabase: (): SqliteDatabase => current,
    handleRequest,
    bootstrap: async (): Promise<void> => {
      const migrated = await handleRequest({ id: '__bootstrap_migrate__', t: 'migrate' });
      if (!migrated.ok) {
        console.error(`[dbServer] 启动迁移失败：${migrated.error.code} ${migrated.error.message}`);
      }
      const checked = await handleRequest({ id: '__bootstrap_integrity__', t: 'integrityCheck' });
      if (!checked.ok) {
        console.error(`[dbServer] 启动完整性检查失败：${checked.error.code} ${checked.error.message}`);
        return;
      }
      const data = checked.data as IntegrityCheckData;
      if (!data.ok) {
        console.error(`[dbServer] integrity_check 报告问题：${data.messages.join(' / ')}`);
      }
    },
    dispose: (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (!connectionOpen) {
        return; // 已被 closeConnection 释放，无句柄可关
      }
      connectionOpen = false;
      try {
        current.close();
      } catch (error) {
        console.error(`[dbServer] 关闭数据库失败：${describeError(error)}`);
      }
    },
    closeConnection: (): Promise<ConnectionData> => runMaintenance('closeConnection'),
    reopenConnection: (): Promise<ConnectionData> => runMaintenance('reopenConnection'),
  };
}

function extractRequestId(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null) {
    const candidate = (raw as { id?: unknown }).id;
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// utilityProcess 入口（仅在 process.parentPort 存在时启用）
// ---------------------------------------------------------------------------

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

function getParentPort(): ParentPortLike | null {
  const candidate = (process as unknown as { parentPort?: unknown }).parentPort;
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const port = candidate as { on?: unknown; postMessage?: unknown };
  if (typeof port.on !== 'function' || typeof port.postMessage !== 'function') {
    return null;
  }
  return candidate as ParentPortLike;
}

async function startAsUtilityProcess(port: ParentPortLike): Promise<void> {
  const dbPath = process.argv[2];
  if (typeof dbPath !== 'string' || dbPath.length === 0) {
    console.error('[dbServer] 缺少数据库路径（argv[2]）');
    process.exit(1);
    return;
  }
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    // 目录创建失败交由 Database 构造报错
  }

  // 动态 import：让本模块顶层零原生依赖，纯逻辑测试可直接 import
  const SqliteCtor = await loadSqliteConstructor();
  const db = new SqliteCtor(dbPath);
  applyPragmaBaseline(db);

  const core = createDbServerCore(db, dbPath);
  await core.bootstrap();

  port.on('message', (event) => {
    void core.handleRequest(event.data).then(
      (response) => port.postMessage(response),
      (error: unknown) => console.error(`[dbServer] 处理请求异常：${describeError(error)}`),
    );
  });
}

const parentPort = getParentPort();
if (parentPort !== null) {
  void startAsUtilityProcess(parentPort).catch((error: unknown) => {
    console.error(`[dbServer] 启动失败：${describeError(error)}`);
    process.exit(1);
  });
}
