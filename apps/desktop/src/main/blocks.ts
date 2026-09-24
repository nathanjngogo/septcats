/**
 * blocks.ts —— 主进程「块」服务（TASK-T21-01 §0）。
 *
 * 职责：把 renderer 的 `blocks:list` / `blocks:commit` 翻译成既有 DB 面：
 * - 读：`block.listByPage`（statements.ts 既有语句，ORDER BY sort_key, id），
 *   行 → 编辑器 Block 形状（id/page_id/type/props/content/parent_id/sort_key/
 *   alive/version/last_edited，照 PageView 的 DEMO_PAGE 构造字段）；
 * - 写：renderer 的 EditSession 产出的 Op[] 透传给既有 `commitOps`
 *   （op_ledger + 物化 + FTS 同事务；执行面经 withSyncHook 装饰 → 进攒段器）。
 *   renderer 不组 Op；main 唯一改写的是**设备身份**（TASK-T28-01）：设备身份的
 *   唯一真源在 main，写入前把每个 op 的 actor/lamport.d 权威改写为本机真实 actor
 *   （rebindOpActor），其余字段原样保留——渲染层携带的 actor 一律不可信。
 *
 * 与 pages/search 同一纪律：
 * - **本文件不 import electron**（IPC 注册走 DI 的 `registerBlocksIpc(service, registrar)`），
 *   vitest 纯 Node 环境直连 better-sqlite3 可端到端（test/blocks.test.ts）；
 * - 一切读写走语句白名单 + commitOps，本文件不出现裸 SQL。
 *
 * `blocks:changed`（main → renderer 推送通道）本期只保留通道名（preload 已订阅），
 * main 侧不注册 handler、不推送 —— 协作/多窗口推送归后续任务（§0.3）。
 */
import type { ActorId, Op } from '@septcats/core';
import { normalizeTableContent, normalizeToggleContent } from '@septcats/editor';
import type { Block, BlockContent } from '@septcats/editor';
import { CHANNEL_BLOCKS_COMMIT, CHANNEL_BLOCKS_LIST } from '../shared/ipc';
import { CommitError, commitOps } from './commit';
import { pageIdsTouchedByOps, syncLinksForPages } from './links';
import { PagesApiError, type StatementExecutor } from './pages';
import type { LockService } from './lock';

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
const EMPTY_PARAGRAPH_DOC: BlockContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/** content_json → JSON 值；null / 空串 / 损坏 JSON 一律 null（调用方决定降级）。 */
function parseContentJson(contentJson: string | null): unknown {
  if (contentJson === null || contentJson.length === 0) {
    return null;
  }
  try {
    return JSON.parse(contentJson) as unknown;
  } catch {
    return null;
  }
}

function isDocJson(value: unknown): value is BlockContent {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { type?: unknown })['type'] === 'doc'
  );
}

/**
 * content_json → 真相层块 content（**唯一实现**：`blocks:list` 读路径与本仓导出链路
 * `main/pageExport.ts` 共用，后者不再自带副本——TASK-T79-02 缺陷 A）。
 *
 * 分流按 `packages/editor/src/model.ts` 的 `blockContentSchema`：
 * - divider / image → null；
 * - code → 纯文本 string（写入路径原样存串，不 JSON 化）；
 * - table → 结构化 `{rows,header[,colWidths]}`；toggle → 结构化 `{title,body}`
 *   （R25 冻结口径：**不是** PM doc，经 normalize 归一）；
 * - 其余文本类 → JSON 化的 PM doc（`type:'doc'` 校验保留）；
 * - 解析失败 / 形态不符 → 降级为空段落（不丢块，只丢内容，保持现韧性）。
 */
export function blockContentOf(type: string, contentJson: string | null): BlockContent {
  if (type === 'divider' || type === 'image') {
    return null;
  }
  if (type === 'code') {
    return contentJson ?? '';
  }
  if (type === 'table') {
    return normalizeTableContent(parseContentJson(contentJson));
  }
  if (type === 'toggle') {
    return normalizeToggleContent(parseContentJson(contentJson));
  }
  const parsed = parseContentJson(contentJson);
  return isDocJson(parsed) ? parsed : EMPTY_PARAGRAPH_DOC;
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

export interface BlocksListResult {
  /** 编辑器 Block 形状（按 sort_key, id 升序）。锁页未解锁时为空数组。 */
  readonly blocks: Block[];
  /** 该页是否处于密码锁锁定态（解锁前不可读正文）。 */
  readonly locked: boolean;
}

export interface BlocksService {
  /** 读一页的存活块；锁页未解锁返回 `{ locked: true, blocks: [] }`，已解锁返回明文块。 */
  list(input: { pageId: string }): Promise<BlocksListResult>;
  /** 提交一批 Op（renderer EditSession 产出；写入前 actor 权威改写为本机真实值）。回提交条数。 */
  commit(input: { ops: Op[] }): Promise<number>;
}

/**
 * TASK-T28-01（P0）：把一个 op 的设备身份权威改写为本机真实 actor。
 *
 * 背景：渲染层（EditSession/DropContext 契约）必须携带某个 actor 才能组 Op，但那
 * 只是占位值；段校验（core/segment.ts 不变量 3）要求段内每个 op 的 `lamport.d` 等
 * 于段头 `dev`（本机真实 actor），`actor` 是账本里的写入者字段——两者都来自渲染层
 * 时会与本机真源不一致 → 攒段 flush 自校验抛 SegmentValidationError → 同步轮失败
 * 并保持错误态（Q-1）。
 *
 * 只改 `actor` 与 `lamport.d` 两个字段；`op_id`/`lamport.c`/`at`/`target`/`kind`/
 * `payload`/`base`/`merge_policy` 原样保留 → op_id 去重与幂等行为不变（op_id 是
 * ULID，不内嵌 actor）。已是本机 actor 的 op 原引用返回（幂等）。
 */
export function rebindOpActor(op: Op, actor: ActorId): Op {
  if (op.actor === actor && op.lamport.d === actor) {
    return op;
  }
  return { ...op, actor, lamport: { ...op.lamport, d: actor } };
}

export interface BlocksServiceOptions {
  readonly executor: StatementExecutor;
  /**
   * 本机真实 actor（设备身份唯一真源，index.ts 从 meta.device_id 派生）：
   * commit 写入前对每个 op 执行 rebindOpActor。
   */
  readonly actor: ActorId;
  /** 活动工作区解析（Q4 单库分片：物化语句的 workspace_id 取它）。缺工作区时抛 E_NO_WORKSPACE。 */
  readonly activeWorkspaceId: () => Promise<string>;
  /**
   * T67-01-B2-01 范围0：读路径接线。注入 lock 服务后，`list` 经 `readBlocks`
   * 判定锁定态；未注入（null/undefined）时退化为原明文读（保持无锁页零开销）。
   */
  readonly lock?: LockService | null;
}

export function createBlocksService(options: BlocksServiceOptions): BlocksService {
  const { executor, actor, activeWorkspaceId } = options;
  const lock = options.lock ?? null;

  return {
    async list(input: { pageId: string }): Promise<BlocksListResult> {
      if (input.pageId.length === 0) {
        throw new BlocksApiError('E_MALFORMED', 'pageId 必须是非空字符串');
      }
      // 未接 lock 服务：原实现直读明文（无锁页零额外开销）。
      if (lock === null) {
        const data = await executor.all('block.listByPage', { page_id: input.pageId });
        // 语句内 ORDER BY sort_key, id —— 与编辑器 compareBlocksBySortKey 同一语义
        return { blocks: data.rows.map((row) => blockRowToBlock(row)), locked: false };
      }
      // 接 lock 服务：锁页未解锁 → 空且 locked:true；已解锁 → 解密映射为 Block[]。
      const result = await lock.readBlocks(input.pageId);
      if (result.locked) {
        return { blocks: [], locked: true };
      }
      return { blocks: result.blocks.map((row) => blockRowToBlock(row)), locked: false };
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
      // 写入前权威改写设备身份（TASK-T28-01）：只动 actor/lamport.d，其余字段不变。
      const workspaceId = await activeWorkspaceId();
      const rebound = ops.map((op) => rebindOpActor(op, actor));
      const written = await commitOps(executor, rebound, { workspaceId });
      // T44-01：双链派生索引增量同步（commit 主体成功后做；失败只记录不回滚——
      // 派生态，下次编辑同页或启动重建兜底）。page 收集含 patch/delete 的块反查。
      try {
        const touched = await pageIdsTouchedByOps(executor, rebound);
        if (touched.size > 0) {
          await syncLinksForPages(executor, touched);
        }
      } catch (error) {
        console.error('[blocks] 双链派生索引同步失败（重建兜底）', error);
      }
      return written;
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
