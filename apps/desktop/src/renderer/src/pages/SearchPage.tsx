/**
 * SearchPage.tsx —— 独立搜索结果页（TASK-T8-01 §3，视觉基准 = mockup 05）。
 *
 * - 查询 chip（可移除）+ 范围/类型 chips + 「N 条结果 · M ms」；
 * - 分组结果（页面 / 数据库）+ snippet 高亮（`[命中]` → <mark>）+ 路径 + meta；
 * - 点击开页；查询词同步 URL-ish state（location.hash，jsdom/受限环境静默失败）；
 * - 空 query 露出「最近查询」chips（palette store 的 recents，10 条去重）。
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FileText, Icon, MagnifyingGlass, Note, X } from '@septcats/ui';
import type { SearchHit } from '../../../shared/search';
import { t } from '../i18n';
import { paletteActions, usePalette } from '../state/palette';
import { pagesStore, usePages, type PagesState } from '../state/pages';
import './SearchPage.css';

/** 模块级选择器（useStore 要求选择器引用稳定）。 */
const selectWorkspaceId = (state: PagesState): string | null => state.workspaceId;
const selectWorkspaces = (state: PagesState) => state.workspaces;

type TypeFilter = 'all' | 'page' | 'db';

const NEXT_TYPE_FILTER: Readonly<Record<TypeFilter, TypeFilter>> = {
  all: 'page',
  page: 'db',
  db: 'all',
};

function typeFilterLabel(filter: TypeFilter): string {
  switch (filter) {
    case 'all':
      return t('search.filterAll');
    case 'page':
      return t('search.filterPages');
    case 'db':
      return t('search.filterDatabases');
  }
}

function matchFilter(kind: SearchHit['kind'], filter: TypeFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  return filter === 'page' ? kind === 'page' : kind !== 'page';
}

/** snippet 的 `[命中]` 标记 → <mark>（与 FTS snippet()/LIKE 摘要约定一致）。 */
function Snippet({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/[\[\]]/), [text]);
  return (
    <div className="search-snip">
      {parts.map((part, index) => (index % 2 === 1 ? <mark key={String(index)}>{part}</mark> : <span key={String(index)}>{part}</span>))}
    </div>
  );
}

function ResultRow({ hit }: { hit: SearchHit }): ReactNode {
  const isDb = hit.kind !== 'page';
  return (
    <button type="button" className="search-res" onClick={() => paletteActions.openHit(hit)}>
      <h3>
        <Icon icon={isDb ? Note : FileText} size="sm" className="search-res-ic" />
        {hit.title}
      </h3>
      {hit.path.length > 0 ? (
        <div className="search-res-path">{hit.path.join(' / ')}</div>
      ) : null}
      {hit.snippet.length > 0 ? <Snippet text={hit.snippet} /> : null}
      <div className="search-res-meta">
        {hit.kind === 'block'
          ? t('search.kindBlock')
          : hit.kind === 'collection'
            ? t('search.kindCollection')
            : hit.kind === 'record'
              ? t('search.kindRecord')
              : t('search.kindPage')}
        {' · '}
        {hit.via === 'fts' ? t('search.viaFts') : t('search.viaFallback')}
      </div>
    </button>
  );
}

export function SearchPage() {
  const query = usePalette((state) => state.query);
  const hits = usePalette((state) => state.hits);
  const tookMs = usePalette((state) => state.tookMs);
  const searching = usePalette((state) => state.searching);
  const recents = usePalette((state) => state.recents);
  const workspaceId = usePages(selectWorkspaceId);
  const workspaces = usePages(selectWorkspaces);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  // 查询词 URL-ish 同步：#search=<encoded>（受限环境静默失败）
  useEffect(() => {
    try {
      window.history.replaceState(null, '', query.length > 0 ? `#search=${encodeURIComponent(query)}` : '#search');
    } catch {
      // history 不可用（如受限容器）：忽略
    }
  }, [query]);

  // 挂载：从 hash 恢复查询词并立即检索一次
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#search=')) {
      try {
        paletteActions.setQuery(decodeURIComponent(hash.slice('#search='.length)));
      } catch {
        paletteActions.setQuery('');
      }
    }
    paletteActions.searchNow();
    return () => {
      // 离开搜索页时不清理 query：面板与搜索页共用同一查询态（§3「接同一状态」）
    };
  }, []);

  // 活动工作区变化时重查（切换工作区后结果必须换域）
  useEffect(() => {
    if (workspaceId !== null) {
      paletteActions.searchNow();
    }
  }, [workspaceId]);

  const filtered = useMemo(() => hits.filter((hit) => matchFilter(hit.kind, typeFilter)), [hits, typeFilter]);
  const pageGroup = useMemo(() => filtered.filter((hit) => hit.kind === 'page'), [filtered]);
  const dbGroup = useMemo(() => filtered.filter((hit) => hit.kind !== 'page'), [filtered]);
  const workspaceName = workspaces.find((item) => item.id === workspaceId)?.name ?? t('common.currentWorkspace');

  return (
    <div className="search-page">
      <div className="search-fbar">
        {query.length > 0 ? (
          <button type="button" className="search-qchip" data-testid="search-qchip" onClick={() => paletteActions.setQuery('')}>
            <Icon icon={MagnifyingGlass} size="sm" className="search-qchip-ic" />
            {query}
            <Icon icon={X} size="sm" className="search-qchip-x" />
          </button>
        ) : null}
        <button type="button" className="search-chip">
          {t('search.scope').replace('{name}', workspaceName)}
        </button>
        <button
          type="button"
          className="search-chip"
          onClick={() => setTypeFilter((current) => NEXT_TYPE_FILTER[current])}
        >
          {t('search.type').replace('{type}', typeFilterLabel(typeFilter))}
        </button>
        <span className="search-count">
          {searching
            ? t('search.searching')
            : t('search.resultsCount').replace('{n}', String(filtered.length)).replace('{ms}', String(tookMs))}
        </span>
      </div>

      {query.trim().length === 0 && recents.length > 0 ? (
        <div className="search-recents">
          <div className="search-res-h">{t('search.recents')}</div>
          <div className="search-recent-chips">
            {recents.map((recent) => (
              <button
                type="button"
                key={recent}
                className="search-chip"
                onClick={() => paletteActions.setQuery(recent)}
              >
                {recent}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {pageGroup.length > 0 ? (
        <>
          <div className="search-res-h">{t('search.groupPages').replace('{n}', String(pageGroup.length))}</div>
          {pageGroup.map((hit) => (
            <ResultRow key={`${hit.kind}-${hit.id}`} hit={hit} />
          ))}
        </>
      ) : null}

      {dbGroup.length > 0 ? (
        <>
          <div className="search-res-h">{t('search.groupDatabases').replace('{n}', String(dbGroup.length))}</div>
          {dbGroup.map((hit) => (
            <ResultRow key={`${hit.kind}-${hit.id}`} hit={hit} />
          ))}
        </>
      ) : null}

      {query.trim().length > 0 && !searching && filtered.length === 0 ? (
        <div className="search-empty">
          {pagesStore.getState().workspaceId === null
            ? t('search.emptyNoWorkspace')
            : t('search.emptyNoMatch')}
        </div>
      ) : null}
    </div>
  );
}
