/**
 * dbview.ts —— 主进程「行内数据库」服务（TASK-T7b-01 §2）。
 *
 * 职责：把 renderer 的 db:* 请求翻译成 **Op + 物化同事务** 的 `commitOps` 调用，
 * 落到 DbServer（`collection` / `record` 物化表）。数据层的形状 / 值语义 /
 * 视图计算 / relation 双写计划全部复用 `@septcats/dbview` 的纯函数，本文件不重写。
 *
 * 纪律：
 * - **本文件不 import electron**（IPC 注册走 DI 的 `registerDbViewIpc(service, registrar)`，
 *   `main/index.ts` 用 ipcMain 适配），因此可在 vitest 纯 Node 环境直连 better-sqlite3 跑端到端；
 * - **一切写路径先造 Op 再 `commitOps`**，本文件不出现裸 SQL / 物化直写；
 * - Op payload 用**领域形态**（`schema`/`views`/`values` 为 JSON 安全对象，见 schema-v1 §4），
 *   `backlinks_json` 是设备本地派生态、**不进 Op payload**：relation 双写发 2 条 record op
 *   （主记录 upsert + 对方记录 upsert），对方反链索引经 `extraStatements` 在同一 batch 内
 *   `record.setBacklinks`（见 commit.ts）。
 */
import { sortBetween, ulid } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';
import {
  BOM,
  applyView,
  coerceValue,
  decodeValuesJson,
  defaultView,
  formatValue,
  normalizeView,
  parseCollectionSchema,
  parseViews,
  recordTitle,
  relationWritePlan,
  toCsv,
  type CollectionEntity,
  type CollectionSchema,
  type DbView,
  type FieldType,
  type RecordEntity,
} from '@septcats/dbview';
import { z } from 'zod';
import {
  CHANNEL_DB_CREATE,
  CHANNEL_DB_EXPORT_CSV,
  CHANNEL_DB_LOAD,
  CHANNEL_DB_PROP_ADD,
  CHANNEL_DB_PROP_REMOVE,
  CHANNEL_DB_PROP_UPDATE,
  CHANNEL_DB_RECORD_CREATE,
  CHANNEL_DB_RECORD_DELETE,
  CHANNEL_DB_RECORD_UPDATE,
  CHANNEL_DB_RELATION_SEARCH,
  CHANNEL_DB_RENAME,
  CHANNEL_DB_VIEW_SAVE,
} from '../shared/ipc';
import { commitOps } from './commit';
import type { StatementExecutor } from './pages';
import type { DbBatchStatement } from '../db/rpc';

// ---------------------------------------------------------------------------
// 错误（与 PagesApiError 同形：{ code, message }）
// ---------------------------------------------------------------------------

export type DbViewErrorCode =
  | 'E_NOT_FOUND'
  | 'E_MALFORMED'
  | 'E_REFERRED'
  | 'E_UNSUPPORTED'
  | 'E_INVARIANT'
  | 'E_DB_UNAVAILABLE';

export class DbViewApiError extends Error {
  readonly code: DbViewErrorCode;

  constructor(code: DbViewErrorCode, message: string) {
    super(message);
    this.name = 'DbViewApiError';
    this.code = code;
    Object.setPrototypeOf(this, DbViewApiError.prototype);
  }
}

/** 由底层异常映射成 IPC 错误（不吞错：全部收敛为带稳定 code 的 DbViewApiError）。 */
export function toDbViewError(error: unknown): DbViewApiError {
  if (error instanceof DbViewApiError) {
    return error;
  }
  return new DbViewApiError('E_INVARIANT', error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// 公共形状
// ---------------------------------------------------------------------------

/** 关系候选（目标记录 id + 显示标题）。 */
export interface DbViewRelationCandidate {
  id: string;
  title: string;
}

export interface DbViewService {
  /** 建独立 DB 页：同事务 batch（page.upsert + collection.upsert）。 */
  create(input: { workspaceId: string; parentPageId?: string | null; title: string }): Promise<{ pageId: string; collectionId: string }>;
  load(input: { pageId: string }): Promise<{ collection: CollectionEntity; records: RecordEntity[] }>;
  rename(input: { pageId: string; title: string }): Promise<{ ok: true }>;
  createRecord(input: { pageId: string; values?: Record<string, unknown> }): Promise<{ record: RecordEntity }>;
  updateRecord(input: { pageId: string; recordId: string; patch: Record<string, unknown> }): Promise<{ record: RecordEntity }>;
  deleteRecords(input: { pageId: string; ids: readonly string[] }): Promise<{ ok: true }>;
  addProperty(input: { pageId: string; type: FieldType }): Promise<{ collection: CollectionEntity }>;
  updateProperty(input: {
    pageId: string;
    pid: string;
    patch: { name?: string; type?: FieldType; ai?: { prompt: string } };
  }): Promise<{ collection: CollectionEntity }>;
  removeProperty(input: { pageId: string; pid: string }): Promise<{ collection: CollectionEntity }>;
  saveView(input: { pageId: string; view: DbView }): Promise<{ collection: CollectionEntity }>;
  relationSearch(input: {
    pageId: string;
    targetCollectionId: string;
    query: string;
  }): Promise<{ candidates: DbViewRelationCandidate[] }>;
  exportCsv(input: { pageId: string }): Promise<{ csv: string }>;
}

export interface DbViewServiceOptions {
  readonly executor: StatementExecutor;
  readonly actor: ActorId;
  readonly now?: () => number;
}

// ---------------------------------------------------------------------------
// 行 → 实体
// ---------------------------------------------------------------------------

interface CollectionRow {
  id: string;
  page_id: string | null;
  workspace_id: string;
  name: string;
  schema_json: string;
  views_json: string;
  alive: number;
  version: number;
}

interface RecordRow {
  id: string;
  collection_id: string;
  workspace_id: string;
  values_json: string;
  backlinks_json: string;
  sort_key: string;
  alive: number;
  version: number;
}

function rowString(row: unknown, key: string): string | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
}

function rowNumber(row: unknown, key: string, fallback: number): number {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const EMPTY_SCHEMA: CollectionSchema = { properties: {}, title_pid: '' };

function toCollectionRow(row: unknown): CollectionRow {
  const id = rowString(row, 'id');
  const workspaceId = rowString(row, 'workspace_id');
  if (id === null || workspaceId === null) {
    throw new DbViewApiError('E_INVARIANT', 'collection 行缺少 id/workspace_id');
  }
  return {
    id,
    page_id: rowString(row, 'page_id'),
    workspace_id: workspaceId,
    name: rowString(row, 'name') ?? '',
    schema_json: rowString(row, 'schema_json') ?? '{}',
    views_json: rowString(row, 'views_json') ?? '[]',
    alive: rowNumber(row, 'alive', 1) === 0 ? 0 : 1,
    version: rowNumber(row, 'version', 1),
  };
}

function toRecordRow(row: unknown): RecordRow {
  const id = rowString(row, 'id');
  const collectionId = rowString(row, 'collection_id');
  const sortKey = rowString(row, 'sort_key');
  if (id === null || collectionId === null || sortKey === null) {
    throw new DbViewApiError('E_INVARIANT', 'record 行缺少 id/collection_id/sort_key');
  }
  return {
    id,
    collection_id: collectionId,
    workspace_id: rowString(row, 'workspace_id') ?? '',
    values_json: rowString(row, 'values_json') ?? '{}',
    backlinks_json: rowString(row, 'backlinks_json') ?? '{}',
    sort_key: sortKey,
    alive: rowNumber(row, 'alive', 1) === 0 ? 0 : 1,
    version: rowNumber(row, 'version', 1),
  };
}

function decodeSchema(json: string): CollectionSchema {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return EMPTY_SCHEMA;
  }
  return parseCollectionSchema(raw) ?? EMPTY_SCHEMA;
}

function decodeBacklinks(json: string): Record<string, string[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[key] = value.map((item) => String(item));
    }
  }
  return out;
}

/** collection 行 → 领域实体（schema/views 解析失败时安全降级）。 */
function collectionEntity(row: CollectionRow): CollectionEntity {
  return {
    id: row.id,
    page_id: row.page_id,
    workspace_id: row.workspace_id,
    name: row.name,
    schema: decodeSchema(row.schema_json),
    views: decodeViews(row.views_json),
    alive: row.alive,
    version: row.version,
  };
}

function decodeViews(json: string): DbView[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  return parseViews(raw) ?? [];
}

/** record 行 → 领域实体。 */
function recordEntity(row: RecordRow): RecordEntity {
  return {
    id: row.id,
    collection_id: row.collection_id,
    workspace_id: row.workspace_id,
    values: decodeValuesJson(row.values_json),
    sort_key: row.sort_key,
    alive: row.alive,
    version: row.version,
    backlinks: decodeBacklinks(row.backlinks_json),
  };
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

const PROPERTY_DEFAULT_NAME: Readonly<Record<FieldType, string>> = {
  text: '文本',
  number: '数字',
  select: '单选',
  multi_select: '多选',
  date: '日期',
  checkbox: '勾选',
  url: '链接',
  email: '邮箱',
  relation: '关联',
  file: '文件',
  ai: 'AI',
};

/** 关系候选上限（§1：≤50 条）。 */
export const RELATION_SEARCH_LIMIT = 50;

export function createDbViewService(options: DbViewServiceOptions): DbViewService {
  const { executor, actor } = options;
  const now = options.now ?? ((): number => Date.now());

  function nextId(prefix: string, at: number): string {
    return `${prefix}${ulid(at)}`;
  }

  function meta(): number {
    return now();
  }

  async function collectionRow(pageId: string): Promise<CollectionRow> {
    const data = await executor.get('collection.getByPage', { page_id: pageId });
    if (data.row === null) {
      throw new DbViewApiError('E_NOT_FOUND', `数据库页未关联 collection：${pageId}`);
    }
    return toCollectionRow(data.row);
  }

  async function reloadCollection(id: string): Promise<CollectionEntity> {
    const data = await executor.get('collection.get', { id });
    if (data.row === null) {
      throw new DbViewApiError('E_NOT_FOUND', `collection 不存在：${id}`);
    }
    return collectionEntity(toCollectionRow(data.row));
  }

  async function recordRow(recordId: string): Promise<RecordRow> {
    const data = await executor.get('record.get', { id: recordId });
    if (data.row === null) {
      throw new DbViewApiError('E_NOT_FOUND', `记录不存在：${recordId}`);
    }
    return toRecordRow(data.row);
  }

  /** 造一条 record upsert op（version = 当前版本 + 1）。 */
  function recordUpsertOp(
    id: string,
    collectionId: string,
    values: Record<string, unknown>,
    sortKey: string,
    version: number,
    at: number,
  ): Op {
    return {
      op_id: ulid(at),
      lamport: { c: version + 1, d: actor },
      at,
      actor,
      target: { table: 'record', id },
      kind: 'upsert',
      payload: {
        collection_id: collectionId,
        values,
        sort_key: sortKey,
        alive: 1,
        updated_at: at,
      },
    };
  }

  /** 造一条 collection upsert op（整对象写：name/schema/views，version+lamport 前进）。 */
  function collectionUpsertOp(
    row: CollectionRow,
    name: string,
    schema: CollectionSchema,
    views: readonly DbView[],
    at: number,
  ): Op {
    return {
      op_id: ulid(at),
      lamport: { c: row.version + 1, d: actor },
      at,
      actor,
      target: { table: 'collection', id: row.id },
      kind: 'upsert',
      payload: {
        page_id: row.page_id,
        name,
        schema,
        views,
        alive: 1,
        updated_at: at,
      },
    };
  }

  /** 按属性表把入参值归一（未知属性原样保留）。 */
  function coercePatch(
    schema: CollectionSchema,
    patch: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [pid, raw] of Object.entries(patch)) {
      const property = schema.properties[pid];
      out[pid] = property === undefined ? raw : coerceValue(property.type, raw);
    }
    return out;
  }

  return {
    async create(input) {
      const at = meta();
      const workspaceId = input.workspaceId;
      const parentId = input.parentPageId ?? null;
      const title = input.title.trim().length === 0 ? '未命名' : input.title.trim();
      const pageId = nextId('pg-', at);
      const collectionId = nextId('col-', at);

      // sort_key：同层尾（复用 page.listAll 取该父层存活兄弟的最大键）
      const pages = await executor.all('page.listAll', { workspace_id: workspaceId });
      let maxKey: string | null = null;
      for (const row of pages.rows) {
        if (rowString(row, 'parent_id') !== parentId || rowNumber(row, 'alive', 1) !== 1) {
          continue;
        }
        const key = rowString(row, 'sort_key');
        if (key !== null && (maxKey === null || key > maxKey)) {
          maxKey = key;
        }
      }
      let sortKey: string;
      try {
        sortKey = sortBetween(maxKey, null);
      } catch (error) {
        throw new DbViewApiError(
          'E_INVARIANT',
          `无法生成排序键：${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const titlePid = nextId('p', at);
      const schema: CollectionSchema = {
        properties: { [titlePid]: { id: titlePid, name: '名称', type: 'text' } },
        title_pid: titlePid,
      };
      const views: DbView[] = [defaultView(nextId('v', at), '表格')];

      const pageOp: Op = {
        op_id: ulid(at),
        lamport: { c: 1, d: actor },
        at,
        actor,
        target: { table: 'page', id: pageId },
        kind: 'upsert',
        payload: {
          workspace_id: workspaceId,
          title,
          icon: null,
          cover: null,
          parent_id: parentId,
          sort_key: sortKey,
          alive: 1,
          deleted_at: null,
          updated_at: at,
        },
      };
      const collectionOp: Op = {
        op_id: ulid(at + 1),
        lamport: { c: 1, d: actor },
        at,
        actor,
        target: { table: 'collection', id: collectionId },
        kind: 'upsert',
        payload: {
          page_id: pageId,
          name: title,
          schema,
          views,
          alive: 1,
          updated_at: at,
        },
      };
      await commitOps(executor, [pageOp, collectionOp], { workspaceId });
      return { pageId, collectionId };
    },

    async load(input) {
      const row = await collectionRow(input.pageId);
      const records = await executor.all('record.listByCollection', { collection_id: row.id });
      return {
        collection: collectionEntity(row),
        records: records.rows.map((entry) => recordEntity(toRecordRow(entry))).filter((entry) => entry.alive === 1),
      };
    },

    async rename(input) {
      const row = await collectionRow(input.pageId);
      const at = meta();
      const page = await executor.get('page.get', { id: input.pageId });
      if (page.row === null) {
        throw new DbViewApiError('E_NOT_FOUND', `页面不存在：${input.pageId}`);
      }
      const pageVersion = rowNumber(page.row, 'version', 1);
      const pageOp: Op = {
        op_id: ulid(at),
        lamport: { c: pageVersion + 1, d: actor },
        at,
        actor,
        target: { table: 'page', id: input.pageId },
        kind: 'patch',
        payload: { title: input.title, updated_at: at },
        base: pageVersion,
      };
      // 同 batch 双写：page.title + collection.name（§1）
      const collectionOp = collectionUpsertOp(
        row,
        input.title,
        decodeSchema(row.schema_json),
        decodeViews(row.views_json),
        at,
      );
      await commitOps(executor, [pageOp, collectionOp], { workspaceId: row.workspace_id });
      return { ok: true };
    },

    async createRecord(input) {
      const row = await collectionRow(input.pageId);
      const schema = decodeSchema(row.schema_json);
      const at = meta();

      const max = await executor.get('record.maxSortKey', { collection_id: row.id });
      const maxKey = rowString(max.row, 'max_key');
      let sortKey: string;
      try {
        sortKey = sortBetween(maxKey !== null && maxKey.length > 0 ? maxKey : null, null);
      } catch (error) {
        throw new DbViewApiError(
          'E_INVARIANT',
          `无法生成排序键：${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const values = coercePatch(schema, input.values ?? {});
      const id = nextId('rec-', at);
      const op = recordUpsertOp(id, row.id, values, sortKey, 0, at);
      await commitOps(executor, [op], { workspaceId: row.workspace_id });

      return {
        record: {
          id,
          collection_id: row.id,
          workspace_id: row.workspace_id,
          values,
          sort_key: sortKey,
          alive: 1,
          version: 1,
          backlinks: {},
        },
      };
    },

    async updateRecord(input) {
      const row = await collectionRow(input.pageId);
      const schema = decodeSchema(row.schema_json);
      const existing = await recordRow(input.recordId);
      if (existing.collection_id !== row.id) {
        throw new DbViewApiError('E_NOT_FOUND', `记录不属于该数据库：${input.recordId}`);
      }
      if (existing.alive === 0) {
        throw new DbViewApiError('E_NOT_FOUND', `记录已删除：${input.recordId}`);
      }
      const at = meta();

      const patch = coercePatch(schema, input.patch);
      const nextValues: Record<string, unknown> = { ...decodeValuesJson(existing.values_json), ...patch };
      const mainOp = recordUpsertOp(existing.id, row.id, nextValues, existing.sort_key, existing.version, at);

      const relationPids = Object.keys(patch).filter((pid) => schema.properties[pid]?.type === 'relation');
      if (relationPids.length === 0) {
        await commitOps(executor, [mainOp], { workspaceId: row.workspace_id });
        return { record: { ...recordEntity(existing), values: nextValues, version: existing.version + 1 } };
      }

      // relation 双写：主记录 upsert + 对方记录 upsert（一个 batch），
      // 反链索引（派生态）经 extraStatements 在同 batch 内 record.setBacklinks。
      const relatedBacklinks = new Map<string, Record<string, string[]>>();
      for (const pid of relationPids) {
        const plan = relationWritePlan(
          schema,
          {
            id: existing.id,
            collection_id: row.id,
            values: decodeValuesJson(existing.values_json),
            backlinks: decodeBacklinks(existing.backlinks_json),
          },
          pid,
          nextValues[pid],
        );
        for (const related of plan.related) {
          if (related.backlinks === null) {
            continue;
          }
          const current = relatedBacklinks.get(related.recordId) ?? {};
          const merged: Record<string, string[]> = { ...current };
          for (const [collectionId, ids] of Object.entries(related.backlinks)) {
            merged[collectionId] = [...new Set([...(merged[collectionId] ?? []), ...ids])];
          }
          relatedBacklinks.set(related.recordId, merged);
        }
      }

      const ops: Op[] = [mainOp];
      const extra: DbBatchStatement[] = [];
      if (relatedBacklinks.size > 0) {
        const ids = [...relatedBacklinks.keys()];
        const targets = await executor.all('record.byIds', {
          ids_json: JSON.stringify(ids),
          workspace_id: row.workspace_id,
        });
        const byId = new Map<string, RecordRow>();
        for (const entry of targets.rows) {
          const target = toRecordRow(entry);
          byId.set(target.id, target);
        }
        for (const [targetId, backlinks] of relatedBacklinks) {
          const target = byId.get(targetId);
          if (target === undefined || target.alive === 0) {
            continue; // 引用已不存在的记录：跳过对方写入（主记录值仍落库）
          }
          ops.push(
            recordUpsertOp(
              target.id,
              target.collection_id,
              decodeValuesJson(target.values_json),
              target.sort_key,
              target.version,
              at,
            ),
          );
          extra.push({
            sqlId: 'record.setBacklinks',
            params: {
              id: target.id,
              workspace_id: row.workspace_id,
              backlinks_json: JSON.stringify(backlinks),
              version: target.version + 1,
              lamport_c: target.version + 1,
              lamport_d: actor,
              updated_at: at,
            },
          });
        }
      }

      await commitOps(executor, ops, { workspaceId: row.workspace_id, extraStatements: extra });
      return { record: { ...recordEntity(existing), values: nextValues, version: existing.version + 1 } };
    },

    async deleteRecords(input) {
      const row = await collectionRow(input.pageId);
      const at = meta();
      const ops: Op[] = [];
      for (const id of input.ids) {
        // 删除前检查：仍被其它记录的 relation 值引用 → 拒删（§6）
        const counted = await executor.get('relation.countTargets', { id, workspace_id: row.workspace_id });
        const n = rowNumber(counted.row, 'n', 0);
        if (n > 0) {
          throw new DbViewApiError('E_REFERRED', `记录仍被 ${String(n)} 条记录引用，无法删除：${id}`);
        }
        const existing = await recordRow(id);
        if (existing.collection_id !== row.id) {
          throw new DbViewApiError('E_NOT_FOUND', `记录不属于该数据库：${id}`);
        }
        ops.push({
          op_id: ulid(at),
          lamport: { c: existing.version + 1, d: actor },
          at,
          actor,
          target: { table: 'record', id },
          kind: 'delete',
          payload: {},
        });
      }
      await commitOps(executor, ops, { workspaceId: row.workspace_id });
      return { ok: true };
    },

    async addProperty(input) {
      const row = await collectionRow(input.pageId);
      const schema = decodeSchema(row.schema_json);
      const at = meta();
      const pid = nextId('p', at);
      const property = { id: pid, name: PROPERTY_DEFAULT_NAME[input.type], type: input.type };
      const nextSchema: CollectionSchema = {
        properties: { ...schema.properties, [pid]: property },
        title_pid: schema.title_pid.length > 0 ? schema.title_pid : pid,
      };
      const op = collectionUpsertOp(
        row,
        row.name,
        nextSchema,
        decodeViews(row.views_json),
        at,
      );
      await commitOps(executor, [op], { workspaceId: row.workspace_id });
      return { collection: await reloadCollection(row.id) };
    },

    async updateProperty(input) {
      const row = await collectionRow(input.pageId);
      const schema = decodeSchema(row.schema_json);
      const property = schema.properties[input.pid];
      if (property === undefined) {
        throw new DbViewApiError('E_NOT_FOUND', `属性不存在：${input.pid}`);
      }
      // 一期只允许 rename + ai.prompt；type 变更需值迁移 → E_UNSUPPORTED（写死在任务书 §1）
      if (input.patch.type !== undefined && input.patch.type !== property.type) {
        throw new DbViewApiError('E_UNSUPPORTED', '属性类型变更一期不支持（需值迁移）');
      }
      const at = meta();
      const nextProperty = {
        ...property,
        name: input.patch.name ?? property.name,
        // ai 生成指令：仅在显式传入时覆盖（TASK-T18-04 §0.1；空串 = 清除配置回落默认指令）
        ai: input.patch.ai ?? property.ai,
      };
      const nextSchema: CollectionSchema = {
        properties: { ...schema.properties, [input.pid]: nextProperty },
        title_pid: schema.title_pid,
      };
      const op = collectionUpsertOp(row, row.name, nextSchema, decodeViews(row.views_json), at);
      await commitOps(executor, [op], { workspaceId: row.workspace_id });
      return { collection: await reloadCollection(row.id) };
    },

    async removeProperty(input) {
      const row = await collectionRow(input.pageId);
      const schema = decodeSchema(row.schema_json);
      if (schema.properties[input.pid] === undefined) {
        throw new DbViewApiError('E_NOT_FOUND', `属性不存在：${input.pid}`);
      }
      const at = meta();
      const properties = { ...schema.properties };
      delete properties[input.pid];
      const remaining = Object.keys(properties);
      const titlePid =
        schema.title_pid === input.pid ? (remaining[0] ?? '') : schema.title_pid;
      const nextSchema: CollectionSchema = { properties, title_pid: titlePid };
      const op = collectionUpsertOp(row, row.name, nextSchema, decodeViews(row.views_json), at);
      await commitOps(executor, [op], { workspaceId: row.workspace_id });
      return { collection: await reloadCollection(row.id) };
    },

    async saveView(input) {
      const row = await collectionRow(input.pageId);
      const at = meta();
      const view = normalizeView(input.view);
      const current = decodeViews(row.views_json);
      const exists = current.some((entry) => entry.vid === view.vid);
      const views = exists
        ? current.map((entry) => (entry.vid === view.vid ? view : entry))
        : [...current, view];
      const op: Op = {
        op_id: ulid(at),
        lamport: { c: row.version + 1, d: actor },
        at,
        actor,
        target: { table: 'collection', id: row.id },
        kind: 'patch',
        payload: { views, updated_at: at },
        base: row.version,
      };
      await commitOps(executor, [op], { workspaceId: row.workspace_id });
      return { collection: await reloadCollection(row.id) };
    },

    async relationSearch(input) {
      await collectionRow(input.pageId); // 本页面必须有 collection（副作用校验，结果不需要）
      const targetData = await executor.get('collection.get', { id: input.targetCollectionId });
      if (targetData.row === null) {
        throw new DbViewApiError('E_NOT_FOUND', `目标 collection 不存在：${input.targetCollectionId}`);
      }
      const targetSchema = decodeSchema(toCollectionRow(targetData.row).schema_json);
      const rows = await executor.all('record.listByCollection', {
        collection_id: input.targetCollectionId,
      });
      const query = input.query.trim().toLowerCase();
      const candidates: DbViewRelationCandidate[] = [];
      for (const entry of rows.rows) {
        const record = recordEntity(toRecordRow(entry));
        if (record.alive === 0) {
          continue;
        }
        const title = recordTitle(targetSchema, record.values, record.id);
        if (query.length > 0 && !title.toLowerCase().startsWith(query)) {
          continue;
        }
        candidates.push({ id: record.id, title });
        if (candidates.length >= RELATION_SEARCH_LIMIT) {
          break;
        }
      }
      return { candidates };
    },

    async exportCsv(input) {
      const row = await collectionRow(input.pageId);
      const schema = decodeSchema(row.schema_json);
      const recordsData = await executor.all('record.listByCollection', { collection_id: row.id });
      const records = recordsData.rows
        .map((entry) => recordEntity(toRecordRow(entry)))
        .filter((entry) => entry.alive === 1);

      const views = decodeViews(row.views_json);
      const view = views[0];
      const visible = view === undefined ? records : applyView(records, view, schema);

      const properties = Object.values(schema.properties);
      const header = properties.map((property) => property.name);
      const body = visible.map((record) =>
        properties.map((property) => formatValue(property, record.values[property.id])),
      );
      // BOM 前缀：zh-CN 场景导出首要消费者是 Excel，无 BOM 的 UTF-8 CSV 必乱码
      return { csv: `${BOM}${toCsv([header, ...body])}` };
    },
  };
}

// ---------------------------------------------------------------------------
// IPC 注册（DI：不 import electron，index.ts 用 ipcMain 适配）
// ---------------------------------------------------------------------------

/** 最小 IPC 注册面（`main/index.ts` 用 ipcMain 适配）。 */
export interface DbViewIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

const zId = z.string().min(1).max(128);
const zPatch = z.record(z.string(), z.unknown());

const DB_INPUT_SCHEMAS = {
  [CHANNEL_DB_CREATE]: z.object({
    workspaceId: z.string().min(1),
    parentPageId: z.string().min(1).nullable().optional(),
    title: z.string(),
  }),
  [CHANNEL_DB_LOAD]: z.object({ pageId: zId }),
  [CHANNEL_DB_RENAME]: z.object({ pageId: zId, title: z.string() }),
  [CHANNEL_DB_RECORD_CREATE]: z.object({ pageId: zId, values: zPatch.optional() }),
  [CHANNEL_DB_RECORD_UPDATE]: z.object({ pageId: zId, recordId: zId, patch: zPatch }),
  [CHANNEL_DB_RECORD_DELETE]: z.object({ pageId: zId, ids: z.array(zId).min(1) }),
  [CHANNEL_DB_PROP_ADD]: z.object({ pageId: zId, type: z.string().min(1) }),
  [CHANNEL_DB_PROP_UPDATE]: z.object({
    pageId: zId,
    pid: zId,
    patch: z.object({ name: z.string().optional(), type: z.string().min(1).optional(), ai: z.object({ prompt: z.string() }).optional() }),
  }),
  [CHANNEL_DB_PROP_REMOVE]: z.object({ pageId: zId, pid: zId }),
  [CHANNEL_DB_VIEW_SAVE]: z.object({ pageId: zId, view: z.unknown() }),
  [CHANNEL_DB_RELATION_SEARCH]: z.object({
    pageId: zId,
    targetCollectionId: zId,
    query: z.string(),
  }),
  [CHANNEL_DB_EXPORT_CSV]: z.object({ pageId: zId }),
} as const;

const FIELD_TYPE_SET: ReadonlySet<string> = new Set<string>([
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'email',
  'relation',
  'file',
  'ai',
]);

function asFieldType(value: string): FieldType {
  if (!FIELD_TYPE_SET.has(value)) {
    throw new DbViewApiError('E_MALFORMED', `未知属性类型：${value}`);
  }
  return value as FieldType;
}

function parseViewInput(raw: unknown): DbView {
  const parsed = z
    .object({
      vid: z.string().min(1),
      name: z.string(),
      type: z.literal('table'),
      filter: z.unknown(),
      sort: z.array(z.object({ prop: z.string().min(1), dir: z.enum(['asc', 'desc']) })),
      widths: z.record(z.string(), z.number()),
    })
    .safeParse(raw);
  if (!parsed.success) {
    throw new DbViewApiError('E_MALFORMED', '视图结构非法');
  }
  return normalizeView(parsed.data as DbView);
}

function describeZod(error: z.ZodError): string {
  const issues = error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join('；');
  return issues.length > 0 ? issues : '参数校验失败';
}

/**
 * 注册 db:* 通道。`service === null`（DbServer 未就绪）时各通道统一回
 * `E_DB_UNAVAILABLE`（与 pages 的降级一致：renderer 有明确错误可展示）。
 * 参数经 zod 再校验一次（不信任 renderer）。
 */
export function registerDbViewIpc(service: DbViewService | null, registrar: DbViewIpcRegistrar): void {
  const requireService = (): DbViewService => {
    if (service === null) {
      throw new DbViewApiError('E_DB_UNAVAILABLE', '数据库服务未就绪（启动失败，见日志）');
    }
    return service;
  };

  const on = (
    channel: string,
    schema: { safeParse: (value: unknown) => { success: true; data: unknown } | { success: false; error: z.ZodError } },
    run: (svc: DbViewService, data: unknown) => Promise<unknown>,
  ): void => {
    registrar.handle(channel, async (raw: unknown): Promise<unknown> => {
      try {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          throw new DbViewApiError('E_MALFORMED', `IPC 参数非法：${describeZod(parsed.error)}`);
        }
        return await run(requireService(), parsed.data);
      } catch (error) {
        const mapped = toDbViewError(error);
        throw new Error(`${mapped.code}: ${mapped.message}`);
      }
    });
  };

  const asRecord = (data: unknown): Record<string, unknown> => data as Record<string, unknown>;

  on(CHANNEL_DB_CREATE, DB_INPUT_SCHEMAS[CHANNEL_DB_CREATE], (svc, data) => {
    const input = asRecord(data);
    const parentPageId = input['parentPageId'];
    return svc.create({
      workspaceId: String(input['workspaceId']),
      parentPageId: typeof parentPageId === 'string' ? parentPageId : null,
      title: String(input['title']),
    });
  });

  on(CHANNEL_DB_LOAD, DB_INPUT_SCHEMAS[CHANNEL_DB_LOAD], (svc, data) =>
    svc.load({ pageId: String(asRecord(data)['pageId']) }),
  );

  on(CHANNEL_DB_RENAME, DB_INPUT_SCHEMAS[CHANNEL_DB_RENAME], (svc, data) => {
    const input = asRecord(data);
    return svc.rename({ pageId: String(input['pageId']), title: String(input['title']) });
  });

  on(CHANNEL_DB_RECORD_CREATE, DB_INPUT_SCHEMAS[CHANNEL_DB_RECORD_CREATE], (svc, data) => {
    const input = asRecord(data);
    const values = input['values'];
    return svc.createRecord({
      pageId: String(input['pageId']),
      values: typeof values === 'object' && values !== null ? (values as Record<string, unknown>) : {},
    });
  });

  on(CHANNEL_DB_RECORD_UPDATE, DB_INPUT_SCHEMAS[CHANNEL_DB_RECORD_UPDATE], (svc, data) => {
    const input = asRecord(data);
    return svc.updateRecord({
      pageId: String(input['pageId']),
      recordId: String(input['recordId']),
      patch: input['patch'] as Record<string, unknown>,
    });
  });

  on(CHANNEL_DB_RECORD_DELETE, DB_INPUT_SCHEMAS[CHANNEL_DB_RECORD_DELETE], (svc, data) => {
    const input = asRecord(data);
    return svc.deleteRecords({
      pageId: String(input['pageId']),
      ids: (input['ids'] as string[]).map((id) => String(id)),
    });
  });

  on(CHANNEL_DB_PROP_ADD, DB_INPUT_SCHEMAS[CHANNEL_DB_PROP_ADD], (svc, data) => {
    const input = asRecord(data);
    return svc.addProperty({ pageId: String(input['pageId']), type: asFieldType(String(input['type'])) });
  });

  on(CHANNEL_DB_PROP_UPDATE, DB_INPUT_SCHEMAS[CHANNEL_DB_PROP_UPDATE], (svc, data) => {
    const input = asRecord(data);
    const patch = input['patch'] as { name?: string; type?: string; ai?: { prompt: string } };
    const typed: { name?: string; type?: FieldType; ai?: { prompt: string } } = {};
    if (patch.name !== undefined) {
      typed.name = patch.name;
    }
    if (patch.type !== undefined) {
      typed.type = asFieldType(patch.type);
    }
    if (patch.ai !== undefined) {
      typed.ai = { prompt: String(patch.ai.prompt) };
    }
    return svc.updateProperty({ pageId: String(input['pageId']), pid: String(input['pid']), patch: typed });
  });

  on(CHANNEL_DB_PROP_REMOVE, DB_INPUT_SCHEMAS[CHANNEL_DB_PROP_REMOVE], (svc, data) => {
    const input = asRecord(data);
    return svc.removeProperty({ pageId: String(input['pageId']), pid: String(input['pid']) });
  });

  on(CHANNEL_DB_VIEW_SAVE, DB_INPUT_SCHEMAS[CHANNEL_DB_VIEW_SAVE], (svc, data) => {
    const input = asRecord(data);
    return svc.saveView({ pageId: String(input['pageId']), view: parseViewInput(input['view']) });
  });

  on(CHANNEL_DB_RELATION_SEARCH, DB_INPUT_SCHEMAS[CHANNEL_DB_RELATION_SEARCH], (svc, data) => {
    const input = asRecord(data);
    return svc.relationSearch({
      pageId: String(input['pageId']),
      targetCollectionId: String(input['targetCollectionId']),
      query: String(input['query']),
    });
  });

  on(CHANNEL_DB_EXPORT_CSV, DB_INPUT_SCHEMAS[CHANNEL_DB_EXPORT_CSV], (svc, data) =>
    svc.exportCsv({ pageId: String(asRecord(data)['pageId']) }),
  );
}
