/**
 * BitableSidePanel.tsx —— 多维表格一级页的二级栏（TASK-T99-01）：本库全部多维表。
 *
 * 数据源：pages store 的节点表（`pageTypeOf(node) === 'database'` 即承载 collection 的表页）
 * + `window.septcats.db.load` 的**惰性**记录数（上限 20 张，避免大库一次性打满 IPC）。
 * 新建表走既有 `db.create`（同事务 page.upsert + collection.upsert），**不新增通道**。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PageNode } from '@septcats/editor';
import { t } from '../i18n';
import { pageTypeOf, pagesActions, usePages } from '../state/pages';
import { bitableActions, useBitable } from './state';
import './Bitable.css';

const COUNT_LIMIT = 20;

interface DbApi {
  create(input: { workspaceId: string; parentPageId?: string | null; title: string }): Promise<{ pageId: string }>;
  load(input: { pageId: string }): Promise<{ records: unknown[] }>;
}

function dbApi(): DbApi | undefined {
  return (window as unknown as { septcats?: { db?: DbApi } }).septcats?.db;
}

/** 表列表排序：按 sortKey（与侧栏页面树同序），同键按标题决胜。 */
function sortTables(nodes: readonly PageNode[]): PageNode[] {
  return [...nodes]
    .filter((node) => node.alive === 1 && node.deletedAt === null && pageTypeOf(node) === 'database')
    .sort((a, b) => (a.sortKey === b.sortKey ? a.title.localeCompare(b.title) : a.sortKey.localeCompare(b.sortKey)));
}

export function BitableSidePanel(): ReactNode {
  const nodes = usePages((state) => state.nodes);
  const workspaceId = usePages((state) => state.workspaceId);
  const workspaces = usePages((state) => state.workspaces);
  const tableId = useBitable((state) => state.tableId);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const tables = useMemo(() => sortTables(nodes), [nodes]);
  const tableKey = tables.map((table) => table.id).join(',');

  useEffect(() => {
    const api = dbApi();
    if (api === undefined) {
      return;
    }
    let cancelled = false;
    const targets = tables.slice(0, COUNT_LIMIT);
    void (async () => {
      const next: Record<string, number> = {};
      for (const table of targets) {
        try {
          const loaded = await api.load({ pageId: table.id });
          next[table.id] = loaded.records.length;
        } catch {
          next[table.id] = -1; // 读失败（锁页/主进程不可用）→ 不显示计数，不打断列表
        }
      }
      if (!cancelled) {
        setCounts((current) => ({ ...current, ...next }));
      }
    })();
    return () => { cancelled = true; };
    // tableKey 精确表达「表集合变了」；counts 不进依赖避免自触发
  }, [tableKey, tables]);

  const createTable = useCallback(async (): Promise<void> => {
    const api = dbApi();
    const ws = workspaceId ?? workspaces[0]?.id ?? null;
    if (api === undefined || ws === null || busy) {
      return;
    }
    setBusy(true);
    try {
      const made = await api.create({ workspaceId: ws, title: `${t('bitable.title')} ${String(tables.length + 1)}` });
      // 建表会写 page + collection 两行：**必须让页面树对账**，否则新表不会出现在本列表里
      // （真机探针实测：不刷新时二级栏是空的，用户会以为没建成功）。
      await pagesActions.refresh();
      bitableActions.setTable(made.pageId);
    } catch {
      /* 建表失败（DB 不可用）：保持现状，用户可重试 */
    } finally {
      setBusy(false);
    }
  }, [busy, tables.length, workspaceId, workspaces]);

  return (
    <div className="bitable-side" data-testid="bitable-side">
      <div className="bitable-side-head">
        <span className="bitable-side-title">{t('bitable.sideTitle')}</span>
        <button
          type="button"
          className="bitable-side-new"
          data-testid="bitable-side-new"
          onClick={() => { void createTable(); }}
          disabled={busy}
        >
          {t('bitable.newTable')}
        </button>
      </div>
      {tables.length === 0 ? (
        <p className="bitable-side-empty" data-testid="bitable-side-empty">{t('bitable.empty')}</p>
      ) : (
        <ul className="bitable-side-list">
          {tables.map((table) => {
            const count = counts[table.id];
            return (
              <li key={table.id}>
                <button
                  type="button"
                  className={`bitable-side-item${table.id === tableId ? ' bitable-side-item--active' : ''}`}
                  data-testid={`bitable-side-item-${table.id}`}
                  aria-current={table.id === tableId ? 'page' : undefined}
                  onClick={() => { bitableActions.setTable(table.id); }}
                >
                  <span className="bitable-side-name">{table.title}</span>
                  {count !== undefined && count >= 0 ? (
                    <span className="bitable-side-count">{count}{t('bitable.recordSuffix')}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default BitableSidePanel;