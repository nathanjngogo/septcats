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
import { applyPragmaBaseline, loadSqliteConstructor, migrate, type SqliteDatabase } from './migrations';
import { getStatement, type StatementDefinition, type StatementKind } from './statements';
import {
  dbFail,
  dbOk,
  isDbRequest,
  type AllData,
  type BatchStepData,
  type DbErrorCode,
  type DbRequest,
  type DbResponse,
  type FtsSearchRow,
  type GetData,
  type IntegrityCheckData,
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
 * 全量重算 FTS 索引。rebuild/物化写入后调用，保证结果与「插入顺序」无关
 * （FTS 行由触发器维护，而块可能先于其页面被写入）。
 */
const FTS_RESYNC_SQL = `DELETE FROM page_block_fts;
INSERT INTO page_block_fts (title, body, page_id, workspace_id)
SELECT
  p.title,
  COALESCE((
    SELECT group_concat(json_extract(b.props_json, '$.title'), ' ')
    FROM block b
    WHERE b.page_id = p.id AND b.alive = 1 AND json_valid(b.props_json)
      AND json_extract(b.props_json, '$.title') IS NOT NULL
  ), ''),
  p.id,
  p.workspace_id
FROM page p
WHERE p.alive = 1;`;

/** 从分段重建前清空物化视图与事件账（分段才是真相）。 */
const REBUILD_CLEAR_SQL: readonly string[] = [
  'DELETE FROM page_block_fts',
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
};

/** 实体表 → 白名单 upsert 语句。'schema' 无物化表（M3 定稿前不落地）。 */
const STATEMENT_FOR_TABLE: Readonly<Partial<Record<TargetTable, string>>> = {
  page: 'page.upsert',
  block: 'block.upsert',
  collection: 'collection.upsert',
  record: 'record.upsert',
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

  const statement = db.prepare(definition.sql);
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
  const data = executeStatement(db, 'opLedger.listAll', {}, 'all');
  if (!('rows' in data)) {
    throw new RpcFailure('E_INTERNAL', 'op_ledger 读取失败');
  }
  const ops: Op[] = [];
  for (const row of data.rows) {
    const json = (row as { op_json?: unknown }).op_json;
    if (typeof json !== 'string') {
      throw new RpcFailure('E_INTERNAL', 'op_ledger 行缺少 op_json');
    }
    try {
      ops.push(decodeOp(json));
    } catch (error) {
      throw new RpcFailure('E_INTERNAL', `op_ledger 中存在非法 op：${describeError(error)}`);
    }
  }
  return ops;
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
  /** 关闭连接（幂等）。 */
  dispose(): void;
}

export function createDbServerCore(database: SqliteDatabase): DbServerCore {
  let current = database;
  let closed = false;

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
        const statement = current.prepare(FTS_SEARCH_SQL);
        const rows = statement.all({
          query: toFtsPhrase(query),
          workspaceId: request.workspaceId,
          limit: clampLimit(request.limit),
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
        const ops: Op[] = [];
        const segIdByOpId = new Map<string, string>();
        for (const segment of segments) {
          for (const op of segment.ops) {
            ops.push(op);
            if (!segIdByOpId.has(op.op_id)) {
              segIdByOpId.set(op.op_id, segment.seg_id);
            }
          }
        }
        const { projection } = replay(ops);
        const entities = orderEntities(projection.entities());
        const ledgerSql = requireStatement('opLedger.insert').sql;

        const rebuild = current.transaction(() => {
          for (const sql of REBUILD_CLEAR_SQL) {
            current.exec(sql);
          }
          const insertLedger = current.prepare(ledgerSql);
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
          return { segments: segments.length, ops: ops.length, entities: entities.length };
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
      default: {
        return dbFail(id, 'E_BAD_REQUEST', '未知请求类型');
      }
    }
  }

  async function handleRequest(raw: unknown): Promise<DbResponse> {
    if (!isDbRequest(raw)) {
      return dbFail(extractRequestId(raw), 'E_BAD_REQUEST', '请求结构非法');
    }
    if (closed) {
      return dbFail(raw.id, 'E_NOT_READY', '数据库连接已关闭');
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
      if (closed) {
        return;
      }
      closed = true;
      try {
        current.close();
      } catch (error) {
        console.error(`[dbServer] 关闭数据库失败：${describeError(error)}`);
      }
    },
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

  const core = createDbServerCore(db);
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
