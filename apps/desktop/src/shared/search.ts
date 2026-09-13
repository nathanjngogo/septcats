/**
 * shared/search.ts —— `search:query` 的线上契约（TASK-T8-01 §1）。
 *
 * 与 ipc.ts 同级的纯协议层：只描述形状，不 import electron / 运行时依赖。
 * main/search.ts（服务实现）、preload、renderer（state/palette.ts）三侧共用。
 */

/** 结果种类。page = 页面标题/正文命中；block = code 块 LIKE 兜底；collection/record = 行内数据库。 */
export type SearchResultKind = 'page' | 'block' | 'collection' | 'record';

export const SEARCH_RESULT_KINDS: readonly SearchResultKind[] = [
  'page',
  'block',
  'collection',
  'record',
];

/** 命中来源：fts = FTS5 bm25；like = LIKE 兜底（code 块正文、collection 名、record 值）。 */
export type SearchHitVia = 'fts' | 'like';

/** 单条命中（§1 步骤 6 的输出形状）。 */
export interface SearchHit {
  readonly kind: SearchResultKind;
  /** 命中实体 id（page→页面 id，block→块 id，collection→库 id，record→记录 id）。 */
  readonly id: string;
  /** 打开用的页面锚点（collection/record → 所属库页；block → 所属页）。 */
  readonly pageId: string | null;
  readonly title: string;
  /** 面包屑（祖先标题，根 → 父；不含自身标题）。 */
  readonly path: readonly string[];
  /** 摘要：`[命中]` 段为高亮标记（与 FTS snippet() 的标记约定一致）。 */
  readonly snippet: string;
  /** 排序分（越小越靠前；title 命中加权 ×0.6 已折入）。 */
  readonly score: number;
  readonly via: SearchHitVia;
  /** 命中行 updated_at（排序键之一；0 = 未知）。 */
  readonly updatedAt: number;
}

/** search:query 入参。 */
export interface SearchInput {
  readonly workspaceId: string;
  readonly query: string;
  readonly types?: readonly SearchResultKind[];
  readonly limit?: number;
}

/** search:query 出参：命中 + 服务端耗时（mockup 05 的「N 条结果 · M ms」）。 */
export interface SearchResponse {
  readonly hits: readonly SearchHit[];
  readonly tookMs: number;
}

/** limit 钳制：缺省 20，上限 200（§1 输入约定）。 */
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 200;

/** LIKE 兜底每类探测上限（§1 步骤 4）。 */
export const SEARCH_LIKE_LIMIT = 50;

/** LIKE 兜底命中的基准分：FTS bm25 ≤ 0，LIKE 命中排其后（同 kind 分组展示，不跨组抢位）。 */
export const SEARCH_LIKE_BASE_SCORE = 1;

export function clampSearchLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return SEARCH_LIMIT_DEFAULT;
  }
  return Math.min(Math.max(Math.trunc(value), 1), SEARCH_LIMIT_MAX);
}

/** 面包屑缓存的 TTL：面包屑是展示性派生态，页树重命名后最多滞后这么久。 */
export const SEARCH_BREADCRUMB_TTL_MS = 3_000;
