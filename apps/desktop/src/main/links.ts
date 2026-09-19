/**
 * links.ts —— 主进程「双链」服务（TASK-T44-01）。
 *
 * 职责：
 * - **派生索引维护**：从块 content（PM doc JSON）解析 `[[ ]]` 双链（editor 包
 *   `extractWikilinksFromContent` 是唯一解析器——与编辑器节点 attrs 单源），
 *   增量 = 按涉及页「清该页源行 + 重插」（同 batch 事务）；全量重建 = 清表重扫。
 *   一致性判据：`增量维护结果 == 全量重建结果`（test/links.test.ts 断言）。
 * - **回链查询**：`links:backlinks` —— 谁引用了我（源页存活 + 同工作区分片，
 *   含源页当前标题与上下文片段）。
 * - 纪律：与 blocks/pages/search 同款——本文件不 import electron（IPC 走 DI 注册），
 *   一切读写走语句白名单；派生态不进 Op payload（不随同步发布）。
 */
import type { StatementExecutor } from './pages';
import { PagesApiError } from './pages';
import {
  extractWikilinksFromContent,
  textOfBlockContent,
} from '@septcats/editor';
import {
  CHANNEL_LINKS_BACKLINKS,
  CHANNEL_LINKS_REBUILD,
} from '../shared/ipc';

/** 上下文片段上限（字符；块文本过长时截断，够回链面板展示）。 */
const CONTEXT_SNIPPET_MAX = 120;

/** 回链面板条目（sourceTitle 取源页当前名——改名后即时可读）。 */
export interface BacklinkEntry {
  readonly sourcePageId: string;
  readonly sourceTitle: string;
  readonly sourceBlockId: string;
  readonly context: string;
}

function rowString(row: unknown, key: string): string | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
}

function truncate(text: string): string {
  return text.length > CONTEXT_SNIPPET_MAX ? text.slice(0, CONTEXT_SNIPPET_MAX) : text;
}

/**
 * 派生一页的链接行并按事务落库（link.clearPage + link.insert 成对，同 batch）。
 * 只解析存活块；未解析链接（target=null）不入索引。返回写入行数。
 */
async function syncOnePage(executor: StatementExecutor, pageId: string): Promise<number> {
  const data = await executor.all('block.listByPage', { page_id: pageId });
  const stmts: Array<{ sqlId: string; params: Record<string, unknown> }> = [
    { sqlId: 'link.clearPage', params: { page_id: pageId } },
  ];
  for (const row of data.rows) {
    const blockId = rowString(row, 'id');
    const workspaceId = rowString(row, 'workspace_id');
    const contentJson = rowString(row, 'content_json');
    if (blockId === null || workspaceId === null || contentJson === null) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contentJson) as unknown;
    } catch {
      continue; // content 非法（理论上不出现）：跳过该块，不吞整页
    }
    const links = extractWikilinksFromContent(parsed).filter(
      (link) => link.target !== null,
    );
    if (links.length === 0) {
      continue;
    }
    const context = truncate(textOfBlockContent(parsed));
    for (const link of links) {
      stmts.push({
        sqlId: 'link.insert',
        params: {
          source_page_id: pageId,
          source_block_id: blockId,
          target_page_id: link.target as string,
          workspace_id: workspaceId,
          title: link.title,
          context,
        },
      });
    }
  }
  // 单页一批（同事务）：中途失败整页回滚，索引不会留下半页态
  if (stmts.length > 1) {
    await executor.batch(stmts);
    return stmts.length - 1;
  }
  await executor.run('link.clearPage', { page_id: pageId });
  return 0;
}

/** 增量维护入口：对每个涉及页做「清 + 重插」。返回写入行数。 */
export async function syncLinksForPages(
  executor: StatementExecutor,
  pageIds: ReadonlySet<string>,
): Promise<number> {
  let written = 0;
  for (const pageId of pageIds) {
    written += await syncOnePage(executor, pageId);
  }
  return written;
}

/**
 * 从一批 op 收集「索引需要重算的页」：
 * - block upsert：payload.page_id 直取；
 * - block patch/delete/reorder：payload 无 page_id（T21-01 口径），提交后按块 id
 *   反查（block 行软删后仍在；物理缺失 → row null → 跳过）；
 * - 非 block op：不触碰索引（page rename 以 id 为键、内容零变更，无需重算）。
 */
export async function pageIdsTouchedByOps(
  executor: StatementExecutor,
  ops: ReadonlyArray<{ target: { table: string; id: string }; kind: string; payload: Record<string, unknown> }>,
): Promise<Set<string>> {
  const pages = new Set<string>();
  for (const op of ops) {
    if (op.target.table !== 'block') {
      continue;
    }
    if (op.kind === 'upsert') {
      const pageId = op.payload['page_id'];
      if (typeof pageId === 'string' && pageId.length > 0) {
        pages.add(pageId);
      }
      continue;
    }
    if (op.kind === 'patch' || op.kind === 'delete' || op.kind === 'reorder') {
      try {
        const found = await executor.get('links.blockPage', { id: op.target.id });
        const pageId = rowString(found.row, 'page_id');
        if (pageId !== null) {
          pages.add(pageId);
        }
      } catch {
        // 反查失败：跳过该块（启动重建兜底）
      }
    }
  }
  return pages;
}

/** 全量重建：清表 + 重扫全部存活块（单 batch 单事务）。返回写入行数。 */
export async function rebuildLinksIndex(executor: StatementExecutor): Promise<number> {
  const stmts: Array<{ sqlId: string; params: Record<string, unknown> }> = [
    { sqlId: 'links.clearAll', params: {} },
  ];
  const data = await executor.all('links.allBlocks', {});
  for (const row of data.rows) {
    const blockId = rowString(row, 'id');
    const pageId = rowString(row, 'page_id');
    const workspaceId = rowString(row, 'workspace_id');
    const contentJson = rowString(row, 'content_json');
    if (blockId === null || pageId === null || workspaceId === null || contentJson === null) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contentJson) as unknown;
    } catch {
      continue;
    }
    const links = extractWikilinksFromContent(parsed).filter((link) => link.target !== null);
    const context = truncate(textOfBlockContent(parsed));
    for (const link of links) {
      stmts.push({
        sqlId: 'link.insert',
        params: {
          source_page_id: pageId,
          source_block_id: blockId,
          target_page_id: link.target as string,
          workspace_id: workspaceId,
          title: link.title,
          context,
        },
      });
    }
  }
  await executor.batch(stmts);
  return stmts.length - 1;
}

// ---------------------------------------------------------------------------
// 服务 + IPC 注册
// ---------------------------------------------------------------------------

export interface LinksService {
  /** 回链：引用了本页的存活源页（页名 + 上下文片段 + 源块 id，供跳转）。 */
  backlinks(input: { pageId: string }): Promise<{ entries: BacklinkEntry[] }>;
  /** 全量重建派生索引（启动时自动跑一次；也可手动触发）。回索引行数。 */
  rebuild(): Promise<{ links: number }>;
}

export function createLinksService(options: { executor: StatementExecutor }): LinksService {
  const { executor } = options;
  return {
    async backlinks(input: { pageId: string }): Promise<{ entries: BacklinkEntry[] }> {
      if (input.pageId.length === 0) {
        throw new PagesApiError('E_MALFORMED', 'pageId 必须是非空字符串');
      }
      const data = await executor.all('links.backlinks', { page_id: input.pageId });
      const entries: BacklinkEntry[] = [];
      for (const row of data.rows) {
        const sourcePageId = rowString(row, 'source_page_id');
        const sourceTitle = rowString(row, 'source_title');
        const sourceBlockId = rowString(row, 'source_block_id');
        if (sourcePageId === null || sourceBlockId === null) {
          continue;
        }
        entries.push({
          sourcePageId,
          sourceTitle: sourceTitle ?? '',
          sourceBlockId,
          context: rowString(row, 'context') ?? '',
        });
      }
      return { entries };
    },

    async rebuild(): Promise<{ links: number }> {
      return { links: await rebuildLinksIndex(executor) };
    },
  };
}

/** 最小 IPC 注册面（`main/index.ts` 用 dbViewRegistrar 适配）。 */
export interface LinksIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

/** 注册 links:backlinks / links:rebuild。`service === null`（DB 未就绪）回 E_INVARIANT。 */
export function registerLinksIpc(service: LinksService | null, registrar: LinksIpcRegistrar): void {
  const fail = (error: unknown): never => {
    const code = error instanceof PagesApiError ? error.code : 'E_INVARIANT';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${code}: ${message}`);
  };

  registrar.handle(CHANNEL_LINKS_BACKLINKS, async (raw: unknown): Promise<unknown> => {
    try {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new PagesApiError('E_MALFORMED', 'IPC 参数必须是对象');
      }
      const pageId = (raw as Record<string, unknown>)['pageId'];
      if (typeof pageId !== 'string' || pageId.length === 0) {
        throw new PagesApiError('E_MALFORMED', 'pageId 必须是非空字符串');
      }
      if (service === null) {
        throw new PagesApiError('E_INVARIANT', '数据库服务不可用（启动失败，见日志）');
      }
      return await service.backlinks({ pageId });
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CHANNEL_LINKS_REBUILD, async (): Promise<unknown> => {
    try {
      if (service === null) {
        throw new PagesApiError('E_INVARIANT', '数据库服务不可用（启动失败，见日志）');
      }
      return await service.rebuild();
    } catch (error) {
      return fail(error);
    }
  });
}
