/**
 * commit.ts —— 写路径的统一落库形态（TASK-T6-01 §3）。
 *
 * 一次 `commitOps` = **一个 batch**（DbServer 的 batch 是单事务）：
 * `op_ledger.insert × N`（真相层）+ 对应物化语句 × N（物化层）。
 * 与编辑器 `EditSession.commit` 的「一批 Op 一次提交」同构；
 * pagesApi（以及后续 blocksApi）**只造 Op，不写裸 SQL** —— 旁路 = 审计打回。
 *
 * 物化映射（page 目标表）：
 * | op.kind  | 语句                  | 说明 |
 * |---|---|---|
 * | upsert   | `page.upsert`         | 新建与恢复共用整对象写（ON CONFLICT 覆盖 tombstone） |
 * | patch    | `page.rename`         | 一期只有 title 是可 patch 的页面字段 |
 * | move     | `page.setChildrenOrder` | 改 parent + 同层 sort_key |
 * | reorder  | `page.setSort`        | 只改 sort_key（含整层重平衡批量） |
 * | delete   | `page.setDeleted`     | soft=进回收站（deleted_at=op.at）/ purge=彻底删除标记（0） |
 *
 * T7b 扩展（M6 行内数据库）：目标表新增 `collection` / `record`，Op payload 用
 * **领域形态**（`schema`/`views`/`values` 是 JSON 安全对象，同 schema-v1 §4），
 * 由本文件 stringify 成物化列（`schema_json`/`views_json`/`values_json`）：
 * | table      | kind   | 语句                  | 说明 |
 * |---|---|---|---|
 * | collection | upsert | `collection.upsert`   | 新建/改名/属性变更（整对象写，version+lamport 前进） |
 * | collection | patch  | `collection.setViews` | 视图落盘（只动 views_json 的局部 patch） |
 * | record     | upsert | `record.upsert`       | 记录新建/改值（backlinks_json 由 setBacklinks 维护，upsert 不覆盖） |
 * | record     | delete | `record.softDelete`   | soft delete（alive=0） |
 *
 * M7 扩展（TASK-T8-01 §2.1）：目标表新增 `block` upsert（`block.upsert` 白名单语句
 * 不动），并同 batch 追加 `fts.clearPage` + `fts.syncBlock` 把 text 块正文送进
 * `page_block_fts.body`（按涉及 page 去重；触发器是安全网，sync 是显式维护路径）。
 *
 * **派生物化**：relation 双写里对方记录的 backlink 索引（`backlinks_json`）是**设备本地
 * 派生态**，不进 Op payload；由调用方经 `extraStatements` 在同一 batch（同事务）追加
 * `record.setBacklinks` 步骤（见 dbview.ts 的 relation 双写）。
 */
import { encodeOp } from '@septcats/core';
import type { Op } from '@septcats/core';
import type { DbBatchStatement, BatchData } from '../db/rpc';

/** 「彻底删除」的 deleted_at 标记（>0 才是回收站软删除，见 db/schema.v2.ts）。 */
export const PURGE_DELETED_AT = 0;

export type DeletionMode = 'soft' | 'purge';

/** commit 阶段唯一的执行依赖（DbHandle 结构上满足它；测试可注入假实现）。 */
export interface BatchExecutor {
  batch(stmts: readonly DbBatchStatement[]): Promise<BatchData>;
}

export type CommitErrorCode = 'E_MALFORMED_OP' | 'E_UNSUPPORTED_TARGET';

export class CommitError extends Error {
  readonly code: CommitErrorCode;

  constructor(code: CommitErrorCode, message: string) {
    super(message);
    this.name = 'CommitError';
    this.code = code;
    Object.setPrototypeOf(this, CommitError.prototype);
  }
}

export interface CommitOptions {
  /** 活动工作区（Q4 单库分片）：所有物化语句的 workspace_id 都取它，越界即 0 行。 */
  readonly workspaceId: string;
  readonly deletionMode?: DeletionMode;
  /**
   * 同事务追加的物化步骤（**派生态**写入，如 relation 反链 `record.setBacklinks`）。
   * 排在全部 op 的 ledger+物化之后，仍属同一 batch/事务：任一失败整体回滚。
   * 派生态不进 Op payload（见 v3 注释），故只能由调用方在 batch 内直接追加。
   */
  readonly extraStatements?: readonly DbBatchStatement[];
}

function malformed(op: Op, reason: string): CommitError {
  return new CommitError(
    'E_MALFORMED_OP',
    `非法 ${op.kind} op（target=${op.target.table}:${op.target.id}）：${reason}`,
  );
}

function readString(op: Op, key: string, fallback: string): string {
  const value = op.payload[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw malformed(op, `payload.${key} 必须是字符串`);
  }
  return value;
}

function readNullableString(op: Op, key: string): string | null {
  const value = op.payload[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw malformed(op, `payload.${key} 必须是字符串或 null`);
  }
  return value;
}

function readNumber(op: Op, key: string, fallback: number): number {
  const value = op.payload[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed(op, `payload.${key} 必须是有限数字`);
  }
  return value;
}

function readNullableNumber(op: Op, key: string): number | null {
  const value = op.payload[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed(op, `payload.${key} 必须是有限数字或 null`);
  }
  return value;
}

function readRequiredString(op: Op, key: string): string {
  const value = op.payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw malformed(op, `payload.${key} 必填`);
  }
  return value;
}

/**
 * 读「领域对象」字段并序列化成物化列文本（collection.schema/views、record.values）。
 * payload 里应放 JSON 安全对象（schema-v1 §4）；已传字符串则原样采用（幂等重建路径）。
 */
function readJsonField(op: Op, key: string, fallback: string): string {
  const value = op.payload[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

/** upsert：整对象 payload → page.upsert 参数（version 取 lamport.c，不由 payload 携带）。 */
function pageUpsertStatement(op: Op, workspaceId: string): DbBatchStatement {
  return {
    sqlId: 'page.upsert',
    params: {
      id: op.target.id,
      workspace_id: workspaceId,
      title: readString(op, 'title', ''),
      icon: readNullableString(op, 'icon'),
      cover: readNullableString(op, 'cover'),
      parent_id: readNullableString(op, 'parent_id'),
      sort_key: readRequiredString(op, 'sort_key'),
      alive: readNumber(op, 'alive', 1) === 0 ? 0 : 1,
      version: op.lamport.c,
      deleted_at: readNullableNumber(op, 'deleted_at'),
      updated_at: readNumber(op, 'updated_at', op.at),
    },
  };
}

/** collection upsert：整对象写（name/schema/views 一起，version+lamport 前进）。 */
function collectionUpsertStatement(op: Op, workspaceId: string): DbBatchStatement {
  return {
    sqlId: 'collection.upsert',
    params: {
      id: op.target.id,
      page_id: readNullableString(op, 'page_id'),
      workspace_id: workspaceId,
      name: readString(op, 'name', ''),
      schema_json: readJsonField(op, 'schema', '{}'),
      views_json: readJsonField(op, 'views', '[]'),
      alive: readNumber(op, 'alive', 1) === 0 ? 0 : 1,
      version: op.lamport.c,
      lamport_c: op.lamport.c,
      lamport_d: op.lamport.d,
      updated_at: readNumber(op, 'updated_at', op.at),
    },
  };
}

/** collection patch：视图落盘（只动 views_json）。 */
function collectionSetViewsStatement(op: Op, workspaceId: string): DbBatchStatement {
  return {
    sqlId: 'collection.setViews',
    params: {
      id: op.target.id,
      workspace_id: workspaceId,
      views_json: readJsonField(op, 'views', '[]'),
      version: op.lamport.c,
      lamport_c: op.lamport.c,
      lamport_d: op.lamport.d,
      updated_at: readNumber(op, 'updated_at', op.at),
    },
  };
}

/**
 * record upsert：整对象写值表。**不携带 backlinks**（设备本地派生态）：
 * `record.upsert` 的冲突分支不覆盖 `backlinks_json`，反链由 `record.setBacklinks` 单独维护。
 */
function recordUpsertStatement(op: Op, workspaceId: string): DbBatchStatement {
  return {
    sqlId: 'record.upsert',
    params: {
      id: op.target.id,
      collection_id: readRequiredString(op, 'collection_id'),
      workspace_id: workspaceId,
      values_json: readJsonField(op, 'values', '{}'),
      backlinks_json: '{}',
      sort_key: readRequiredString(op, 'sort_key'),
      alive: readNumber(op, 'alive', 1) === 0 ? 0 : 1,
      version: op.lamport.c,
      lamport_c: op.lamport.c,
      lamport_d: op.lamport.d,
      updated_at: readNumber(op, 'updated_at', op.at),
    },
  };
}

/** record delete：soft delete（alive=0）。 */
function recordSoftDeleteStatement(op: Op): DbBatchStatement {
  return {
    sqlId: 'record.softDelete',
    params: {
      id: op.target.id,
      version: op.lamport.c,
      updated_at: op.at,
    },
  };
}

/** code/正文双形态字段：string 原样（code 纯文本），对象 stringify（PM doc），缺省 null。 */
function readContentJsonField(op: Op): string | null {
  const value = op.payload['content'];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * block upsert：整对象写（TASK-T8-01 §2.1）。`block.upsert` 白名单语句不动；
 * 正文进 FTS 由 commitOps 在同 batch 追加 `fts.clearPage` + `fts.syncBlock` 完成
 * （见 commitOps 尾部的 ftsSyncPages）。
 */
function blockUpsertStatement(op: Op, workspaceId: string): DbBatchStatement {
  return {
    sqlId: 'block.upsert',
    params: {
      id: op.target.id,
      page_id: readRequiredString(op, 'page_id'),
      workspace_id: workspaceId,
      type: readString(op, 'type', 'paragraph'),
      props_json: readJsonField(op, 'props', '{}'),
      content_json: readContentJsonField(op),
      sort_key: readRequiredString(op, 'sort_key'),
      alive: readNumber(op, 'alive', 1) === 0 ? 0 : 1,
      version: op.lamport.c,
      lamport_c: op.lamport.c,
      lamport_d: op.lamport.d,
      updated_at: readNumber(op, 'updated_at', op.at),
    },
  };
}

/** 单个 op → 物化语句。未知 kind/表一律 throw（绝不静默跳过，避免真相层与物化层分叉）。 */
export function materializeStatement(
  op: Op,
  workspaceId: string,
  deletionMode: DeletionMode = 'soft',
): DbBatchStatement {
  switch (op.target.table) {
    case 'page':
      return materializePageStatement(op, workspaceId, deletionMode);
    case 'collection':
      return materializeCollectionStatement(op, workspaceId);
    case 'record':
      return materializeRecordStatement(op, workspaceId);
    case 'block':
      return materializeBlockStatement(op, workspaceId);
    default:
      throw new CommitError(
        'E_UNSUPPORTED_TARGET',
        `commitOps 暂不支持 target.table=${op.target.table}`,
      );
  }
}

function materializePageStatement(
  op: Op,
  workspaceId: string,
  deletionMode: DeletionMode,
): DbBatchStatement {
  switch (op.kind) {
    case 'upsert':
      return pageUpsertStatement(op, workspaceId);

    case 'patch': {
      if (op.payload['title'] === undefined) {
        throw malformed(op, 'patch 目前只支持 title（page.rename）');
      }
      return {
        sqlId: 'page.rename',
        params: {
          id: op.target.id,
          workspace_id: workspaceId,
          title: readString(op, 'title', ''),
          version: op.lamport.c,
          updated_at: readNumber(op, 'updated_at', op.at),
        },
      };
    }

    case 'move':
      return {
        sqlId: 'page.setChildrenOrder',
        params: {
          id: op.target.id,
          workspace_id: workspaceId,
          parent_id: readNullableString(op, 'parent_id'),
          sort_key: readRequiredString(op, 'sort_key'),
          version: op.lamport.c,
          updated_at: readNumber(op, 'updated_at', op.at),
        },
      };

    case 'reorder':
      return {
        sqlId: 'page.setSort',
        params: {
          id: op.target.id,
          workspace_id: workspaceId,
          sort_key: readRequiredString(op, 'sort_key'),
          version: op.lamport.c,
          updated_at: readNumber(op, 'updated_at', op.at),
        },
      };

    case 'delete': {
      if (Object.keys(op.payload).length > 0) {
        throw malformed(op, 'delete 的 payload 必须为空对象（schema-v1 §1）');
      }
      return {
        sqlId: 'page.setDeleted',
        params: {
          id: op.target.id,
          workspace_id: workspaceId,
          deleted_at: deletionMode === 'purge' ? PURGE_DELETED_AT : op.at,
          version: op.lamport.c,
          updated_at: op.at,
        },
      };
    }

    // T19-02：crdt_update 不物化进 SQLite 投影，按既有未知 kind 语义显式拒绝（错误文案不变）
    case 'crdt_update': {
      throw new CommitError('E_MALFORMED_OP', '未知 page op.kind：crdt_update');
    }
    default: {
      const exhaustive: never = op.kind;
      throw new CommitError('E_MALFORMED_OP', `未知 page op.kind：${String(exhaustive)}`);
    }
  }
}

function materializeCollectionStatement(op: Op, workspaceId: string): DbBatchStatement {
  switch (op.kind) {
    case 'upsert':
      return collectionUpsertStatement(op, workspaceId);
    case 'patch':
      return collectionSetViewsStatement(op, workspaceId);
    default:
      throw new CommitError('E_MALFORMED_OP', `collection 暂不支持 op.kind=${op.kind}`);
  }
}

function materializeRecordStatement(op: Op, workspaceId: string): DbBatchStatement {
  switch (op.kind) {
    case 'upsert':
      return recordUpsertStatement(op, workspaceId);
    case 'delete': {
      if (Object.keys(op.payload).length > 0) {
        throw malformed(op, 'delete 的 payload 必须为空对象（schema-v1 §1）');
      }
      return recordSoftDeleteStatement(op);
    }
    default:
      throw new CommitError('E_MALFORMED_OP', `record 暂不支持 op.kind=${op.kind}`);
  }
}

function materializeBlockStatement(op: Op, workspaceId: string): DbBatchStatement {
  switch (op.kind) {
    case 'upsert':
      return blockUpsertStatement(op, workspaceId);
    case 'patch':
      return blockPatchStatement(op);
    case 'reorder':
      return blockSetSortStatement(op);
    case 'delete': {
      if (Object.keys(op.payload).length > 0) {
        throw malformed(op, 'delete 的 payload 必须为空对象（schema-v1 §1）');
      }
      // T21-01：编辑器删除块（alive=0）。FTS 同步由 v4 触发器（trg_block_fts_au/ad）
      // 维护（单条常规路径 flag=0，触发器即时生效）；block delete 拿不到 page_id，
      // 无法在此追加 fts.syncPage（与既有 block delete 注释口径一致）。
      return {
        sqlId: 'block.softDelete',
        params: {
          id: op.target.id,
          version: op.lamport.c,
          updated_at: op.at,
        },
      };
    }
    default:
      // block delete/patch/reorder 的物化自 T21-01 起支持（编辑器 diff 的三种 kind）；
      // 其余 kind 显式拒绝（绝不静默跳过，避免真相层与物化层分叉）。
      throw new CommitError('E_MALFORMED_OP', `block 暂不支持 op.kind=${op.kind}`);
  }
}

/**
 * block patch（T21-01）：编辑器 diff 的字段级局部更新（`block.patch` 白名单语句，
 * T21-01 新增）。payload 缺席的字段传 null → 语句里 COALESCE 保持旧列不触碰。
 * 注意：block 表无 parent_id 列（upsert 同样不落它），patch 里的 parent_id 忽略；
 * diff 语义下 patch 不会携带 content:null（type 变更走 upsert），
 * 故「显式 null」与「缺席」在物化层等价（缺席 = 不触碰）。
 */
function blockPatchStatement(op: Op): DbBatchStatement {
  const payload = op.payload as Record<string, unknown>;
  const present = (key: string): boolean =>
    payload[key] !== undefined && payload[key] !== null;
  let contentJson: string | null = null;
  const content = payload['content'];
  if (typeof content === 'string') {
    contentJson = content;
  } else if (content !== undefined && content !== null && typeof content === 'object') {
    contentJson = JSON.stringify(content);
  }
  const props = payload['props'];
  const alive = payload['alive'];
  return {
    sqlId: 'block.patch',
    params: {
      id: op.target.id,
      type: present('type') && typeof payload['type'] === 'string' ? payload['type'] : null,
      props_json:
        present('props') && props !== null && typeof props === 'object'
          ? JSON.stringify(props)
          : null,
      content_json: contentJson,
      sort_key: present('sort_key') && typeof payload['sort_key'] === 'string' ? payload['sort_key'] : null,
      alive: typeof alive === 'number' && (alive === 0 || alive === 1) ? alive : null,
      version: op.lamport.c,
      lamport_c: op.lamport.c,
      lamport_d: op.lamport.d,
      updated_at: readNumber(op, 'updated_at', op.at),
    },
  };
}

/** block reorder（T21-01）：只改 sort_key（`block.setSort` 白名单语句，T21-01 新增）。 */
function blockSetSortStatement(op: Op): DbBatchStatement {
  return {
    sqlId: 'block.setSort',
    params: {
      id: op.target.id,
      sort_key: readRequiredString(op, 'sort_key'),
      version: op.lamport.c,
      lamport_c: op.lamport.c,
      lamport_d: op.lamport.d,
      updated_at: readNumber(op, 'updated_at', op.at),
    },
  };
}

/** 一个 op → op_ledger.insert 参数（真相层；`op_json` 为 core.encodeOp 的稳定键序单行 JSON）。 */
export function ledgerStatement(op: Op, segId: string | null): DbBatchStatement {
  let opJson: string;
  try {
    opJson = encodeOp(op);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CommitError('E_MALFORMED_OP', `encodeOp 失败：${reason}`);
  }
  return {
    sqlId: 'opLedger.insert',
    params: {
      op_id: op.op_id,
      seg_id: segId,
      lamport_c: op.lamport.c,
      lamport_d: op.lamport.d,
      target_table: op.target.table,
      target_id: op.target.id,
      op_json: opJson,
      applied_at: op.at,
    },
  };
}

/**
 * 提交一批 Op：一个 batch（单事务）= ledger × N + 物化 × N。
 * 任一语句失败 → 整个事务回滚（DbServer.batch 语义），真相层与物化层不会分叉。
 * 返回提交的 op 数（空数组时**不**发请求）。
 *
 * M7（TASK-T8-01 §2.1）：块 upsert 的正文索引由写入路径维护——同一 batch 追加
 * `fts.clearPage` + `fts.syncBlock`（按涉及的 page 去重，事务内，排在全部物化之后）。
 * body 表达式与 v4 触发器 / FTS_RESYNC 同源，三条写入路径口径一致。
 * T15（TASK-T15-01）：批量写块（同 batch ≥2 条 block.upsert）时头尾自动插
 * `fts.deferOn`/`fts.deferOff`，触发器在事务内短路，FTS 只由尾部显式同步一次
 * （单条 block.upsert 的常规路径不包 defer，触发器照常即时生效）。
 */
export async function commitOps(
  executor: BatchExecutor,
  ops: readonly Op[],
  options: CommitOptions,
): Promise<number> {
  if (ops.length === 0) {
    return 0;
  }
  const mode: DeletionMode = options.deletionMode ?? 'soft';
  const stmts: DbBatchStatement[] = [];
  const ftsSyncPages = new Set<string>();
  let blockUpsertCount = 0;
  for (const op of ops) {
    stmts.push(ledgerStatement(op, null));
    stmts.push(materializeStatement(op, options.workspaceId, mode));
    if (op.target.table === 'block' && op.kind === 'upsert') {
      blockUpsertCount += 1;
      const pageId = op.payload['page_id'];
      if (typeof pageId === 'string' && pageId.length > 0) {
        ftsSyncPages.add(pageId);
      }
    }
  }
  // FTS 触发器 defer（TASK-T15-01，性能红牌 #30）：同 batch 含 ≥2 条 block.upsert
  // 时，v4/v6 触发器每行都会整页重算 FTS（O(n²)：200 块同页写 = 200 次整页重算，
  // P95 实测 232ms）。batch 尾部本就有 fts.clearPage + fts.syncBlock 单次重算，
  // 触发器在批量场景纯属重复劳动——故头尾插 fts.deferOn/deferOff（migration #6
  // 的 fts_defer 表 + WHEN 守卫），让触发器在事务内短路，FTS 只由尾部显式同步一次。
  // flag 与数据同事务：中途 throw 整体回滚（含 flag），单条 block.upsert 等常规
  // 路径（flag=0）触发器照常即时生效，语义零触碰（deletionMode/extraStatements 不变）。
  const deferFts = blockUpsertCount >= 2;
  if (deferFts) {
    stmts.unshift({ sqlId: 'fts.deferOn', params: {} });
  }
  for (const extra of options.extraStatements ?? []) {
    stmts.push(extra);
  }
  for (const pageId of ftsSyncPages) {
    stmts.push({ sqlId: 'fts.clearPage', params: { page_id: pageId } });
    stmts.push({ sqlId: 'fts.syncBlock', params: { page_id: pageId } });
  }
  if (deferFts) {
    // 排在 fts 同步之后：显式 sync 语句不受触发器守卫影响，deferOff 必须兜底复位
    stmts.push({ sqlId: 'fts.deferOff', params: {} });
  }
  if (stmts.length === 0) {
    return 0;
  }
  await executor.batch(stmts);
  return ops.length;
}
