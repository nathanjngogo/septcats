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

/** 单个 op → 物化语句。未知 kind/表一律 throw（绝不静默跳过，避免真相层与物化层分叉）。 */
export function materializeStatement(
  op: Op,
  workspaceId: string,
  deletionMode: DeletionMode = 'soft',
): DbBatchStatement {
  if (op.target.table !== 'page') {
    throw new CommitError('E_UNSUPPORTED_TARGET', `commitOps 暂不支持 target.table=${op.target.table}`);
  }

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

    default: {
      const exhaustive: never = op.kind;
      throw new CommitError('E_MALFORMED_OP', `未知 op.kind：${String(exhaustive)}`);
    }
  }
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
  for (const op of ops) {
    stmts.push(ledgerStatement(op, null));
    stmts.push(materializeStatement(op, options.workspaceId, mode));
  }
  await executor.batch(stmts);
  return ops.length;
}
