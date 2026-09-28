/**
 * linkRebuild.ts —— page_link_index 的**同步**重建内核（H-06 治本，R29 挂账）。
 *
 * 存在理由：`page_link_index` 是派生投影（不在 Op 真相/段里）。db/server.ts 的
 * `rebuildFromSegments`（两种模式）清表重放物化表 + FTS，但旧版没管派生索引 →
 * 重建后回链面板可能挂着指向已不存在页的行（与投影不一致）。本模块把「全量重建」
 * 抽成不依赖 Electron/RPC 的纯同步函数，**在重建事务内**直接调用（与 FTS_RESYNC
 * 同事务、同回滚语义：中途 throw → better-sqlite3 把索引一并回滚）。
 *
 * 解析口径与 main/links.ts 的异步版完全同源（extractWikilinksFromContent /
 * textOfBlockContent / CONTEXT_SNIPPET_MAX=120）；SQL 全部走 statements.ts 白名单
 * （links.clearAll / links.allBlocks / link.insert），不新发明语句。
 */
import { extractWikilinksFromContent, textOfBlockContent } from '@septcats/editor';
import type { SqliteDatabase } from './migrations';
import { getStatement } from './statements';

/** 上下文片段上限（字符）——与 main/links.ts 同值（口径同源钉）。 */
const CONTEXT_SNIPPET_MAX = 120;

/**
 * 全量重建双链索引：清表 + 重扫全部存活块。在调用方事务内执行。
 * 返回写入的索引行数。坏 JSON 块跳过（口径同异步版：解析失败不入索引，
 * 启动重建兜底重试）。
 */
/** 白名单语句取用（缺失=编程错误，口径同 server.ts requireStatement）。 */
function sqlOf(sqlId: string): string {
  const def = getStatement(sqlId);
  if (def === null) {
    throw new Error(`linkRebuild: 未知语句 ${sqlId}`);
  }
  return def.sql;
}

export function rebuildLinkIndexSync(db: SqliteDatabase): number {
  const clear = db.prepare(sqlOf('links.clearAll'));
  const scan = db.prepare(sqlOf('links.allBlocks'));
  const insert = db.prepare(sqlOf('link.insert'));
  clear.run();
  let rows = 0;
  for (const raw of scan.all() as Array<Record<string, unknown>>) {
    const blockId = raw['id'];
    const pageId = raw['page_id'];
    const workspaceId = raw['workspace_id'];
    const contentJson = raw['content_json'];
    if (
      typeof blockId !== 'string'
      || typeof pageId !== 'string'
      || typeof workspaceId !== 'string'
      || typeof contentJson !== 'string'
    ) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contentJson) as unknown;
    } catch {
      continue;
    }
    const links = extractWikilinksFromContent(parsed).filter((link) => link.target !== null);
    if (links.length === 0) {
      continue;
    }
    const text = textOfBlockContent(parsed);
    const context = text.length > CONTEXT_SNIPPET_MAX ? text.slice(0, CONTEXT_SNIPPET_MAX) : text;
    for (const link of links) {
      insert.run({
        source_page_id: pageId,
        source_block_id: blockId,
        target_page_id: link.target as string,
        workspace_id: workspaceId,
        title: link.title,
        context,
      });
      rows += 1;
    }
  }
  return rows;
}
