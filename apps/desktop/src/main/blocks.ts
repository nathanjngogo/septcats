/**
 * blocks.ts —— 主进程「块」服务（TASK-T21-01 §0）。
 *
 * 职责：把 renderer 的 `blocks:list` / `blocks:commit` 翻译成既有 DB 面：
 * - 读：`block.listByPage`（statements.ts 既有语句，ORDER BY sort_key, id），
 *   行 → 编辑器 Block 形状（id/page_id/type/props/content/parent_id/sort_key/
 *   alive/version/last_edited，照 PageView 的 DEMO_PAGE 构造字段）；
 * - 写：renderer 的 EditSession 产出的 Op[] **原样透传**给既有 `commitOps`
 *   （op_ledger + 物化 + FTS 同事务；执行面经 withSyncHook 装饰 → 进攒段器）。
 *   renderer 不组 Op、main 不改写 Op —— 两侧都不越权。
 *
 * 与 pages/search 同一纪律：
 * - **本文件不 import electron**（IPC 注册走 DI 的 `registerBlocksIpc(service, registrar)`），
 *   vitest 纯 Node 环境直连 better-sqlite3 可端到端（test/blocks.test.ts）；
 * - 一切读写走语句白名单 + commitOps，本文件不出现裸 SQL。
 *
 * `blocks:changed`（main → renderer 推送通道）本期只保留通道名（preload 已订阅），
 * main 侧不注册 handler、不推送 —— 协作/多窗口推送归后续任务（§0.3）。
 */
import type { Op } from '@septcats/core';
import type { Block } from '@septcats/editor';
import { CHANNEL_BLOCKS_COMMIT, CHANNEL_BLOCKS_LIST } from '../shared/ipc';
import { CommitError, commitOps } from './commit';
import { PagesApiError, type StatementExecutor } from './pages';

// ---------------------------------------------------------------------------
// 错误（与 PagesApiError 同形：{ code, message }）
// ---------------------------------------------------------------------------

export type BlocksErrorCode = 'E_MALFORMED' | 'E_NO_WORKSPACE' | 'E_NOT_FOUND' | 'E_INVARIANT';

export class BlocksApiError extends Error {
  readonly code: BlocksErrorCode;

  constructor(code: BlocksErrorCode, message: string) {
    super(message);
    this.name = 'BlocksApiError';
    this.code = code;
    Object.setPrototypeOf(this, BlocksApiError.prototype);
  }
}

/** 由底层异常映射成 IPC 错误（不吞错：全部收敛为带稳定 code 的 BlocksApiError）。 */
export function toBlocksError(error: unknown): BlocksApiError {
  if (error instanceof BlocksApiError) {
    return error;
  }
  if (error instanceof CommitError) {
    return new BlocksApiError('E_MALFORMED', error.message);
  }
  if (error instanceof PagesApiError) {
    // 注入的 activeWorkspaceId（index.ts）抛 E_NO_WORKSPACE：保留原码透传
    return new BlocksApiError(
      error.code === 'E_NO_WORKSPACE' ? 'E_NO_WORKSPACE' : 'E_INVARIANT',
      error.message,
    );
  }
  return new BlocksApiError('E_INVARIANT', error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// 行 → 编辑器 Block
// ---------------------------------------------------------------------------

function rowString(row: unknown, key: string): string | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
}

function rowNumber(row: unknown, key: string, fallback: number): number {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 空内联的 PM doc（model.ts 归一化约定：{type:'paragraph'} 不写 content 键）。 */
const EMPTY_PARAGRAPH_DOC: NonNullable<Block['content']> = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * content_json → 编辑器 BlockContent：
 * - code 块的 content 恒为纯文本（写入路径原样存串，不 JSON 化）；
 * - divider / image 恒为 null；
 * - 其余文本类块是 JSON 化的 PM doc，解析失败降级为空段落（不丢块，只丢样式）。
 */
function blockContentOf(type: string, contentJson: string | null): Block['content'] {
  if (type === 'divider' || type === 'image') {
    return null;
  }
  if (contentJson === null) {
    return type === 'code' ? '' : EMPTY_PARAGRAPH_DOC;
  }
  if (type === 'code') {
    return contentJson;
  }
  try {
    const parsed = JSON.parse(contentJson) as unknown;
    if (parsed !== null && typeof parsed === 'object' && (parsed as { type?: unknown })['type'] === 'doc') {
      return parsed as Block['content'];
    }
  } catch {
    // 落到下面的降级
  }
  return EMPTY_PARAGRAPH_DOC;
}

function blockRowToBlock(row: unknown): Block {
  const id = rowString(row, 'id');
  const pageId = rowString(row, 'page_id');
  const type = rowString(row, 'type');
  const sortKey = rowString(row, 'sort_key');
  if (id === null || pageId === null || type === null || sortKey === null) {
    throw new BlocksApiError('E_INVARIANT', 'block 行缺少 id/page_id/type/sort_key');
  }
  const propsJson = rowString(row, 'props_json');
  let props: Record<string, unknown> = {};
  if (propsJson !== null && propsJson.length > 0) {
    try {
      const parsed = JSON.parse(propsJson) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        props = parsed as Record<string, unknown>;
      }
    } catch {
      props = {};
    }
  }
  return {
    id,
    page_id: pageId,
    type,
    props,
    content: blockContentOf(type, rowString(row, 'content_json')),
    parent_id: rowString(row, 'parent_id'),
    sort_key: sortKey,
    alive: rowNumber(row, 'alive', 1) === 0 ? 0 : 1,
    version: rowNumber(row, 'version', 1),
    // block 表无 last_edited 列；commitOps 写入路径把 updated_at 记为提交时刻，
    // 这里回读它充当 last_edited（编辑器仅用作展示/差分参考，真相层是 op_ledger）。
    last_edited: rowNumber(row, 'updated_at', 0),
  };
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface BlocksService {
  /** 读一页的存活块（`block.listByPage`：alive=1，按 sort_key, id 升序）。 */
  list(input: { pageId: string }): Promise<Block[]>;
  /** 提交一批 Op（renderer EditSession 产出，原样透传 commitOps）。回提交条数。 */
  commit(input: { ops: Op[] }): Promise<number>;
}

export interface BlocksServiceOptions {
  readonly executor: StatementExecutor;
  /** 活动工作区解析（Q4 单库分片：物化语句的 workspace_id 取它）。缺工作区时抛 E_NO_WORKSPACE。 */
  readonly activeWorkspaceId: () => Promise<string>;
}

export function createBlocksService(options: BlocksServiceOptions): BlocksService {
  const { executor, activeWorkspaceId } = options;

  return {
    async list(input: { pageId: string }): Promise<Block[]> {
      if (input.pageId.length === 0) {
        throw new BlocksApiError('E_MALFORMED', 'pageId 必须是非空字符串');
      }
      const data = await executor.all('block.listByPage', { page_id: input.pageId });
      // 语句内 ORDER BY sort_key, id —— 与编辑器 compareBlocksBySortKey 同一语义
      return data.rows.map((row) => blockRowToBlock(row));
    },

    async commit(input: { ops: Op[] }): Promise<number> {
      const ops: unknown = input.ops;
      if (!Array.isArray(ops)) {
        throw new BlocksApiError('E_MALFORMED', 'ops 必须是数组');
      }
      for (const op of ops) {
        if (typeof op !== 'object' || op === null || Array.isArray(op)) {
          throw new BlocksApiError('E_MALFORMED', 'ops 的每一项必须是对象（core.Op）');
        }
      }
      // 深度校验（op_id/lamport/payload 形状）由 commitOps → encodeOp 负责：
      // 非法 op → CommitError(E_MALFORMED_OP)，经 toBlocksError 收敛为 E_MALFORMED。
      const workspaceId = await activeWorkspaceId();
      return commitOps(executor, ops, { workspaceId });
    },
  };
}

// ---------------------------------------------------------------------------
// IPC 注册（DI：不 import electron，index.ts 用 ipcMain 适配）
// ---------------------------------------------------------------------------

/** 最小 IPC 注册面（`main/index.ts` 用 dbViewRegistrar 适配）。 */
export interface BlocksIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

/**
 * 注册 blocks:list / blocks:commit 通道。`service === null`（DbServer 未就绪）时统一回
 * `E_INVARIANT`（与 pages/dbview 的降级一致）。参数在边界再校验一次（不信任 renderer）。
 * `blocks:changed` 是 main → renderer 推送通道：本期不注册 handler、不推送（§0.3）。
 */
export function registerBlocksIpc(service: BlocksService | null, registrar: BlocksIpcRegistrar): void {
  const requireService = (): BlocksService => {
    if (service === null) {
      throw new BlocksApiError('E_INVARIANT', '数据库服务不可用（启动失败，见日志）');
    }
    return service;
  };

  const fail = (error: unknown): never => {
    const mapped = toBlocksError(error);
    throw new Error(`${mapped.code}: ${mapped.message}`);
  };

  registrar.handle(CHANNEL_BLOCKS_LIST, async (raw: unknown): Promise<unknown> => {
    try {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new BlocksApiError('E_MALFORMED', 'IPC 参数必须是对象');
      }
      const pageId = (raw as Record<string, unknown>)['pageId'];
      if (typeof pageId !== 'string' || pageId.length === 0) {
        throw new BlocksApiError('E_MALFORMED', 'pageId 必须是非空字符串');
      }
      return await requireService().list({ pageId });
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CHANNEL_BLOCKS_COMMIT, async (raw: unknown): Promise<unknown> => {
    try {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new BlocksApiError('E_MALFORMED', 'IPC 参数必须是对象');
      }
      const ops = (raw as Record<string, unknown>)['ops'];
      if (!Array.isArray(ops)) {
        throw new BlocksApiError('E_MALFORMED', 'ops 必须是数组');
      }
      return await requireService().commit({ ops: ops as Op[] });
    } catch (error) {
      return fail(error);
    }
  });
}
