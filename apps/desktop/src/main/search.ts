/**
 * search.ts —— 主进程「搜索」服务（TASK-T8-01 §1）。
 *
 * 职责：把 renderer 的 `search:query` 请求翻译成 DbServer 白名单语句
 * （FTS bm25 主检索 + LIKE 兜底），再拼装成带面包屑/摘要/排序的命中列表。
 * 与 pages/dbview 同一纪律：
 * - **本文件不 import electron**（IPC 注册走 DI 的 `registerSearchIpc(service, registrar)`），
 *   vitest 纯 Node 环境直连 better-sqlite3 可端到端；
 * - 一切查询走语句白名单（`search.*` / `page.listAll`），本文件不出现裸 SQL；
 * - 性能红线：1 万页 fixture 查询 P95 < 150ms（test/search.test.ts 实测）。
 *
 * 排序（§1 output）：score asc → title 命中加权(×0.6) → updated_at desc（末位 id 决胜稳定序）。
 * FTS bm25 ≤ 0（越小越相关）；LIKE 兜底命中给正的基准分（shared/search.ts），排在 FTS 之后。
 */
import {
  SEARCH_LIKE_BASE_SCORE,
  SEARCH_LIKE_LIMIT,
  SEARCH_BREADCRUMB_TTL_MS,
  clampSearchLimit,
  type SearchHit,
  type SearchInput,
  type SearchResponse,
  type SearchResultKind,
} from '../shared/search';
import { CHANNEL_SEARCH_QUERY } from '../shared/ipc';
import type { AllData, BatchData, GetData, RunData } from '../db/rpc';
import type { StatementExecutor } from './pages';

// ---------------------------------------------------------------------------
// 错误（与 PagesApiError 同形：{ code, message }）
// ---------------------------------------------------------------------------

export type SearchErrorCode = 'E_MALFORMED' | 'E_DB_UNAVAILABLE' | 'E_INVARIANT';

export class SearchApiError extends Error {
  readonly code: SearchErrorCode;

  constructor(code: SearchErrorCode, message: string) {
    super(message);
    this.name = 'SearchApiError';
    this.code = code;
    Object.setPrototypeOf(this, SearchApiError.prototype);
  }
}

/** 由底层异常映射成 IPC 错误（不吞错：全部收敛为带稳定 code 的 SearchApiError）。 */
export function toSearchError(error: unknown): SearchApiError {
  if (error instanceof SearchApiError) {
    return error;
  }
  return new SearchApiError('E_INVARIANT', error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// 短语转义 / LIKE 转义 / 摘要
// ---------------------------------------------------------------------------

/**
 * FTS5 短语包裹。**与 db/server.ts 的 toFtsPhrase 同源**（trigram 下整体短语 =
 * 子串检索；内部双引号翻倍）——server 侧那份是 DbServer 内部符号不外泄，故在
 * 此复制并注明同源，两边改动必须同步。
 */
export function toFtsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

/** LIKE 通配符收口：\ % _ 前加转义符（配合语句里的 ESCAPE '\'）。 */
function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function likePattern(query: string): string {
  return `%${escapeLike(query)}%`;
}

/** 把 JSON 值里的字符串收集出来（偏好 `text` 键：PM doc 的正文节点）。 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === 'string' && key === 'text') {
        out.push(item);
      } else {
        collectStrings(item, out);
      }
    }
  }
}

/** 安全解析 JSON 列文本；失败返回 null。 */
function parseJsonSafe(json: unknown): unknown {
  if (typeof json !== 'string' || json.length === 0) {
    return null;
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/** LIKE 命中的摘要：首个命中 ±窗口，`[命中]` 标记（与 FTS snippet() 约定一致）。 */
function likeSnippet(text: string, query: string): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return text.length > 88 ? `…${text.slice(0, 88)}…` : text;
  }
  const windowRadius = 44;
  const start = Math.max(0, index - windowRadius);
  const end = Math.min(text.length, index + query.length + windowRadius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, index)}[${text.slice(index, index + query.length)}]${text.slice(index + query.length, end)}${suffix}`;
}

/** 在候选字符串里挑第一个含 query 的（大小写不敏感），返回它的摘要。 */
function snippetFromCandidates(candidates: readonly string[], query: string): string {
  for (const text of candidates) {
    if (text.toLowerCase().includes(query.toLowerCase())) {
      return likeSnippet(text, query);
    }
  }
  return candidates[0]?.slice(0, 88) ?? '';
}

function rowString(row: unknown, key: string, fallback = ''): string {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : fallback;
}

function rowNumber(row: unknown, key: string, fallback = 0): number {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// 页面地图（面包屑用）——小 TTL 缓存，1 万页查询时避免每次全量拉树
// ---------------------------------------------------------------------------

interface PageEntry {
  readonly title: string;
  readonly parentId: string | null;
  readonly updatedAt: number;
}

interface PageMapCache {
  readonly workspaceId: string;
  readonly at: number;
  readonly byId: ReadonlyMap<string, PageEntry>;
}

function ancestorsOf(pageId: string, byId: ReadonlyMap<string, PageEntry>): string[] {
  const chain: string[] = [];
  const visited = new Set<string>([pageId]);
  let cursor = byId.get(pageId)?.parentId ?? null;
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const entry = byId.get(cursor);
    if (entry === undefined) {
      break;
    }
    chain.unshift(entry.title);
    cursor = entry.parentId;
  }
  return chain;
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export type SearchResultKindFilter = readonly SearchResultKind[];

const ALL_KINDS: SearchResultKindFilter = ['page', 'block', 'collection', 'record'];

export interface SearchService {
  query(input: SearchInput): Promise<SearchResponse>;
}

export interface SearchServiceOptions {
  readonly executor: StatementExecutor;
}

export function createSearchService(options: SearchServiceOptions): SearchService {
  const { executor } = options;
  let pageMapCache: PageMapCache | null = null;

  async function pageMap(workspaceId: string): Promise<ReadonlyMap<string, PageEntry>> {
    if (
      pageMapCache !== null &&
      pageMapCache.workspaceId === workspaceId &&
      Date.now() - pageMapCache.at < SEARCH_BREADCRUMB_TTL_MS
    ) {
      return pageMapCache.byId;
    }
    const rows = await executor.all('page.listAll', { workspace_id: workspaceId });
    const byId = new Map<string, PageEntry>();
    for (const row of rows.rows) {
      const id = rowString(row, 'id');
      if (id.length === 0) {
        continue;
      }
      byId.set(id, {
        title: rowString(row, 'title'),
        parentId: rowString(row, 'parent_id') || null,
        updatedAt: rowNumber(row, 'updated_at'),
      });
    }
    pageMapCache = { workspaceId, at: Date.now(), byId };
    return byId;
  }

  /** trigram tokenizer 的最小 MATCH 单元长度：字数 < 3 走底表 LIKE 兜底（TASK-T20-01）。 */
  const FTS_TRIGRAM_MIN_CHARS = 3;

  async function ftsPageHits(
    query: string,
    workspaceId: string,
    limit: number,
    byId: ReadonlyMap<string, PageEntry>,
  ): Promise<SearchHit[]> {
    // <3 字（1–2 字中文短词）在 trigram MATCH 下恒 0 条 → 底表 LIKE 兜底；
    // ≥3 字路径逐字节不变（bm25 语义/排序零回归）。
    if ([...query].length < FTS_TRIGRAM_MIN_CHARS) {
      return likeFtsPageHits(query, workspaceId, limit, byId);
    }
    const data = await executor.all('search.ftsPage', {
      query: toFtsPhrase(query),
      workspaceId,
      limit,
    });
    const lower = query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const row of data.rows) {
      const pageId = rowString(row, 'page_id');
      if (pageId.length === 0) {
        continue;
      }
      const entry = byId.get(pageId);
      const title = entry?.title ?? rowString(row, 'title');
      const rawScore = rowNumber(row, 'score');
      const titleHit = title.toLowerCase().includes(lower);
      hits.push({
        kind: 'page',
        id: pageId,
        pageId,
        title,
        path: ancestorsOf(pageId, byId),
        snippet: rowString(row, 'snippet'),
        // §1 排序：title 命中加权 ×0.6（bm25 越小越好，加权后更小、排更前）
        score: titleHit ? rawScore * 0.6 : rawScore,
        via: 'fts',
        updatedAt: entry?.updatedAt ?? rowNumber(row, 'updated_at'),
      });
    }
    return hits;
  }

  /**
   * <3 字兜底（TASK-T20-01）：`search.likeFtsPage` 白名单语句扫 page_block_fts
   * 底表（\ % _ 已由 likePattern 转义；标题命中优先由语句内 title_rank 排序）。
   * 行形状与 search.ftsPage 对齐（page_id/title/score/snippet/updated_at），
   * score 为正基准分（标题命中再 ×0.6 加权，排序语义与 FTS 主路径一致）。
   */
  async function likeFtsPageHits(
    query: string,
    workspaceId: string,
    limit: number,
    byId: ReadonlyMap<string, PageEntry>,
  ): Promise<SearchHit[]> {
    const data = await executor.all('search.likeFtsPage', {
      like: likePattern(query),
      needle: query.toLowerCase(),
      workspaceId,
      limit,
    });
    const lower = query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const row of data.rows) {
      const pageId = rowString(row, 'page_id');
      if (pageId.length === 0) {
        continue;
      }
      const entry = byId.get(pageId);
      const title = entry?.title ?? rowString(row, 'title');
      const rawScore = rowNumber(row, 'score', SEARCH_LIKE_BASE_SCORE);
      const titleHit = title.toLowerCase().includes(lower);
      hits.push({
        kind: 'page',
        id: pageId,
        pageId,
        title,
        path: ancestorsOf(pageId, byId),
        snippet: rowString(row, 'snippet'),
        score: titleHit ? rawScore * 0.6 : rawScore,
        via: 'like',
        updatedAt: entry?.updatedAt ?? rowNumber(row, 'updated_at'),
      });
    }
    return hits;
  }

  async function likeBlockHits(
    query: string,
    workspaceId: string,
    byId: ReadonlyMap<string, PageEntry>,
  ): Promise<SearchHit[]> {
    const data = await executor.all('search.likeBlock', {
      workspace_id: workspaceId,
      like: likePattern(query),
      limit: SEARCH_LIKE_LIMIT,
    });
    const hits: SearchHit[] = [];
    for (const row of data.rows) {
      const blockId = rowString(row, 'id');
      const pageId = rowString(row, 'page_id');
      if (blockId.length === 0 || pageId.length === 0) {
        continue;
      }
      const contentText = parseJsonSafe(rowString(row, 'content_json'));
      const propsText = parseJsonSafe(rowString(row, 'props_json'));
      const contentCandidates: string[] = [];
      collectStrings(contentText, contentCandidates);
      const propsCandidates: string[] = [];
      collectStrings(propsText, propsCandidates);
      const pageTitle = byId.get(pageId)?.title ?? rowString(row, 'page_title');
      const blockTitle = propsCandidates.find((text) => text.toLowerCase().includes(query.toLowerCase())) ?? '';
      hits.push({
        kind: 'block',
        id: blockId,
        pageId,
        title: blockTitle.length > 0 ? blockTitle : pageTitle,
        path: [...ancestorsOf(pageId, byId), pageTitle],
        snippet: snippetFromCandidates(contentCandidates, query),
        score: SEARCH_LIKE_BASE_SCORE,
        via: 'like',
        updatedAt: rowNumber(row, 'updated_at'),
      });
    }
    return hits;
  }

  async function likeCollectionHits(
    query: string,
    workspaceId: string,
    byId: ReadonlyMap<string, PageEntry>,
  ): Promise<SearchHit[]> {
    const data = await executor.all('search.likeCollection', {
      workspace_id: workspaceId,
      like: likePattern(query),
      limit: SEARCH_LIKE_LIMIT,
    });
    const hits: SearchHit[] = [];
    for (const row of data.rows) {
      const id = rowString(row, 'id');
      if (id.length === 0) {
        continue;
      }
      const name = rowString(row, 'name');
      const pageId = rowString(row, 'page_id') || null;
      const anchorId = pageId ?? id;
      const entry = byId.get(anchorId);
      hits.push({
        kind: 'collection',
        id,
        pageId,
        title: name,
        path: entry === undefined ? [] : [...ancestorsOf(anchorId, byId), entry.title],
        snippet: snippetFromCandidates([name], query),
        score: SEARCH_LIKE_BASE_SCORE,
        via: 'like',
        updatedAt: rowNumber(row, 'updated_at'),
      });
    }
    return hits;
  }

  async function likeRecordHits(
    query: string,
    workspaceId: string,
    byId: ReadonlyMap<string, PageEntry>,
  ): Promise<SearchHit[]> {
    const data = await executor.all('search.likeRecord', {
      workspace_id: workspaceId,
      like: likePattern(query),
      limit: SEARCH_LIKE_LIMIT,
    });
    const hits: SearchHit[] = [];
    for (const row of data.rows) {
      const id = rowString(row, 'id');
      if (id.length === 0) {
        continue;
      }
      const collectionId = rowString(row, 'collection_id');
      const pageId = rowString(row, 'page_id') || null;
      const collectionName = rowString(row, 'collection_name');
      const values = parseJsonSafe(rowString(row, 'values_json'));
      const candidates: string[] = [];
      collectStrings(values, candidates);
      const anchorId = pageId ?? collectionId;
      const entry = byId.get(anchorId);
      hits.push({
        kind: 'record',
        id,
        pageId,
        title: collectionName,
        path: entry === undefined ? [] : [...ancestorsOf(anchorId, byId), entry.title],
        snippet: snippetFromCandidates(candidates, query),
        score: SEARCH_LIKE_BASE_SCORE,
        via: 'like',
        updatedAt: rowNumber(row, 'updated_at'),
      });
    }
    return hits;
  }

  return {
    async query(input: SearchInput): Promise<SearchResponse> {
      const startedAt = Date.now();
      const query = input.query.trim();
      if (query.length === 0 || input.workspaceId.length === 0) {
        return { hits: [], tookMs: Date.now() - startedAt };
      }
      const limit = clampSearchLimit(input.limit);
      const kinds: SearchResultKindFilter =
        input.types === undefined ? ALL_KINDS : ALL_KINDS.filter((kind) => input.types?.includes(kind));

      const byId = await pageMap(input.workspaceId);
      const [pageHits, blockHits, collectionHits, recordHits] = await Promise.all([
        kinds.includes('page') ? ftsPageHits(query, input.workspaceId, limit, byId) : Promise.resolve([]),
        kinds.includes('block') ? likeBlockHits(query, input.workspaceId, byId) : Promise.resolve([]),
        kinds.includes('collection') ? likeCollectionHits(query, input.workspaceId, byId) : Promise.resolve([]),
        kinds.includes('record') ? likeRecordHits(query, input.workspaceId, byId) : Promise.resolve([]),
      ]);

      const merged = [...pageHits, ...blockHits, ...collectionHits, ...recordHits]
        .sort((a, b) => {
          if (a.score !== b.score) {
            return a.score - b.score;
          }
          if (a.updatedAt !== b.updatedAt) {
            return b.updatedAt - a.updatedAt;
          }
          return a.id < b.id ? -1 : 1;
        })
        .slice(0, limit);

      return { hits: merged, tookMs: Date.now() - startedAt };
    },
  };
}

// ---------------------------------------------------------------------------
// IPC 注册（DI：不 import electron，index.ts 用 ipcMain 适配）
// ---------------------------------------------------------------------------

/** 最小 IPC 注册面（`main/index.ts` 用 ipcMain 适配）。 */
export interface SearchIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

/**
 * 注册 search:query 通道。`service === null`（DbServer 未就绪）时统一回
 * `E_DB_UNAVAILABLE`（与 pages/dbview 的降级一致）。参数在边界再校验一次
 * （不信任 renderer）。
 */
export function registerSearchIpc(service: SearchService | null, registrar: SearchIpcRegistrar): void {
  registrar.handle(CHANNEL_SEARCH_QUERY, async (raw: unknown): Promise<unknown> => {
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用（启动失败，见日志）');
    }
    if (typeof raw !== 'object' || raw === null) {
      throw new SearchApiError('E_MALFORMED', 'IPC 参数必须是对象');
    }
    const input = raw as Record<string, unknown>;
    const workspaceId = input['workspaceId'];
    const query = input['query'];
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new SearchApiError('E_MALFORMED', 'workspaceId 必须是非空字符串');
    }
    if (typeof query !== 'string') {
      throw new SearchApiError('E_MALFORMED', 'query 必须是字符串');
    }
    const types = input['types'];
    if (types !== undefined && !Array.isArray(types)) {
      throw new SearchApiError('E_MALFORMED', 'types 必须是数组');
    }
    const limit = input['limit'];
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit))) {
      throw new SearchApiError('E_MALFORMED', 'limit 必须是整数');
    }
    return service.query({
      workspaceId,
      query,
      ...(types !== undefined ? { types: types as SearchResultKind[] } : {}),
      ...(limit !== undefined ? { limit: limit as number } : {}),
    });
  });
}

/** 导出类型别名供测试/调用方复用（避免到处 import rpc 内部类型）。 */
export type SearchExecutorData = AllData | BatchData | GetData | RunData;
