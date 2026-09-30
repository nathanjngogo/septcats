/**
 * BitablePage.tsx —— 多维表格一级工作区（TASK-T99-01，飞书多维表格对标）。
 *
 * 组合式实现（不重造轮子）：
 *   - **表格视图** → 直接复用既有 `DbPage`（筛选 / 排序 / 字段管理 / 行内编辑 / CSV 全在它里面，
 *     见 `@septcats/dbview/react` 的 PropBar + TableGrid）；
 *   - **看板视图**（本期新增）→ 本文件内的 `KanbanBoard`：按 select 字段分列、卡片拖动改值，
 *     分组/移动的语义全部来自 `@septcats/dbview` 的纯函数（groupBySelect / kanbanGroups /
 *     moveCardToGroup），渲染层不自己发明分组规则；
 *   - **视图条**（本文件）→ 列出 collection.views，可切换 / 新建表格视图 / 新建看板视图 /
 *     重命名 / 删除；视图配置一律经既有 `db.saveView` 落库（含 groupPid / hiddenPids）。
 *
 * 纪律：零新增 IPC 通道、零外部请求；只吃 token；文案走 t('bitable.*')。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DbPage } from '../db/DbPage';
import { useDbPage } from '../db/useDbPage';
import {
  NONE_GROUP_KEY,
  defaultView,
  kanbanGroups,
  moveCardToGroup,
  propertyList,
  recordTitle,
  type CollectionSchema,
  type DbView,
  type Property,
  type RecordEntity,
} from '@septcats/dbview';
import { t } from '../i18n';
import { bitableActions, useBitable } from './state';
import './Bitable.css';

interface DbFileApi {
  exportCsv(input: { pageId: string }): Promise<{ csv: string }>;
}

function fileApi(): DbFileApi | undefined {
  return (window as unknown as { septcats?: { db?: DbFileApi } }).septcats?.db;
}

/** 生一个不与既有视图冲突的 vid（视图 id 只在集合内唯一）。 */
function nextVid(views: readonly DbView[]): string {
  let n = views.length + 1;
  const taken = new Set(views.map((view) => view.vid));
  while (taken.has(`v${String(n)}`)) {
    n += 1;
  }
  return `v${String(n)}`;
}

/** 第一个 select / multi_select 属性（看板的天然分组字段）。 */
function firstSelectable(schema: CollectionSchema): Property | undefined {
  return propertyList(schema).find((p) => p.type === 'select' || p.type === 'multi_select');
}

export function BitablePage(): ReactNode {
  const tableId = useBitable((state) => state.tableId);
  if (tableId === null) {
    return (
      <div className="bitable-page" data-testid="bitable-page">
        <header className="bitable-head">
          <h1 className="bitable-title">{t('bitable.title')}</h1>
        </header>
        <p className="bitable-empty" data-testid="bitable-empty">
          {t('bitable.empty')} · {t('bitable.emptyHint')}
        </p>
      </div>
    );
  }
  return <BitableWorkspace pageId={tableId} />;
}

function BitableWorkspace({ pageId }: { pageId: string }): ReactNode {
  const db = useDbPage(pageId);
  const { collection, records, status, error } = db;
  const views = useMemo(() => collection?.views ?? [], [collection]);
  const [activeVid, setActiveVid] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');

  // 视图集变化（换表 / 新建 / 删除）→ 收敛到合法 vid：保留当前若仍存在，否则取首个
  useEffect(() => {
    if (views.length === 0) {
      setActiveVid('');
      return;
    }
    setActiveVid((current) => (views.some((view) => view.vid === current) ? current : (views[0]?.vid ?? '')));
  }, [views]);

  const activeView = views.find((view) => view.vid === activeVid) ?? views[0];
  const isKanban = activeView?.type === 'kanban';
  const selectable = useMemo(() => (collection === null ? [] : propertyList(collection.schema).filter((p) => p.type === 'select' || p.type === 'multi_select')), [collection]);

  const groups = useMemo(() => {
    if (collection === null || activeView === undefined || activeView.type !== 'kanban') {
      return [];
    }
    return kanbanGroups(collection.schema, records, activeView);
  }, [activeView, collection, records]);

  const saveView = useCallback(
    (view: DbView): void => {
      void db.saveView(view);
    },
    [db],
  );

  const addView = useCallback(
    (type: 'table' | 'kanban'): void => {
      if (collection === null) {
        return;
      }
      const vid = nextVid(views);
      const base = defaultView(vid, type === 'kanban' ? t('bitable.viewKanban') : t('bitable.viewTable'));
      const view: DbView = type === 'kanban' ? { ...base, type: 'kanban', ...(firstSelectable(collection.schema) === undefined ? {} : { groupPid: firstSelectable(collection.schema)?.id }) } : base;
      saveView(view);
      setActiveVid(vid);
    },
    [collection, saveView, views],
  );

  const renameActive = useCallback(
    (name: string): void => {
      if (activeView === undefined || name.trim().length === 0) {
        return;
      }
      saveView({ ...activeView, name: name.trim() });
    },
    [activeView, saveView],
  );

  const setGroupPid = useCallback(
    (pid: string): void => {
      if (activeView === undefined) {
        return;
      }
      saveView({ ...activeView, ...(pid.length === 0 ? {} : { groupPid: pid }) });
    },
    [activeView, saveView],
  );

  const exportCsv = useCallback((): void => {
    const api = fileApi();
    if (api === undefined) {
      return;
    }
    void api.exportCsv({ pageId }).then(({ csv }) => {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${collection?.name ?? 'table'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(() => { /* 导出失败：主进程不可用/锁页，静默 */ });
  }, [collection, pageId]);

  const moveCard = useCallback(
    (recordId: string, key: string): void => {
      if (collection === null || activeView === undefined || activeView.type !== 'kanban') {
        return;
      }
      const pid = groups[0]?.pid;
      if (pid === undefined) {
        return;
      }
      const property = propertyList(collection.schema).find((p) => p.id === pid);
      const value = moveCardToGroup(property, key);
      if (value === undefined) {
        return;
      }
      void db.updateRecord(recordId, { [pid]: value });
    },
    [activeView, collection, db, groups],
  );

  if (status === 'loading' && collection === null) {
    return (
      <div className="bitable-page" data-testid="bitable-page">
        <p className="bitable-empty" data-testid="bitable-empty">{t('bitable.title')}…</p>
      </div>
    );
  }

  if (collection === null) {
    return (
      <div className="bitable-page" data-testid="bitable-page">
        <header className="bitable-head">
          <h1 className="bitable-title">{t('bitable.title')}</h1>
        </header>
        <p className="bitable-empty" data-testid="bitable-empty">
          {t('bitable.empty')}{error === null ? '' : ` · ${error}`}
        </p>
      </div>
    );
  }

  return (
    <div className="bitable-page" data-testid="bitable-page">
      <header className="bitable-head">
        <h1 className="bitable-title" data-testid="bitable-table-name">{collection.name}</h1>
        <span className="bitable-count">{records.length}{t('bitable.recordSuffix')}</span>
        <button
          type="button"
          className="bitable-link"
          data-testid="bitable-back"
          onClick={() => { bitableActions.setTable(null); }}
        >
          {t('bitable.tableList')}
        </button>
      </header>

      <div className="bitable-viewbar" data-testid="bitable-viewbar">
        {views.map((view) =>
          renaming && view.vid === activeView?.vid ? (
            <input
              key={view.vid}
              className="bitable-chip-input"
              data-testid="bitable-view-rename-input"
              value={renameText}
              autoFocus
              onChange={(event) => { setRenameText(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  renameActive(renameText);
                  setRenaming(false);
                }
                if (event.key === 'Escape') {
                  setRenaming(false);
                }
              }}
              onBlur={() => {
                renameActive(renameText);
                setRenaming(false);
              }}
            /> 
          ) : (
            <button
              key={view.vid}
              type="button"
              className={`bitable-chip${view.vid === activeView?.vid ? ' bitable-chip--active' : ''}`}
              data-testid={`bitable-view-chip-${view.vid}`}
              aria-pressed={view.vid === activeView?.vid}
              onClick={() => { setActiveVid(view.vid); }}
              onDoubleClick={() => { setRenameText(view.name); setRenaming(true); }}
            >
              {view.type === 'kanban' ? t('bitable.viewKanban') : t('bitable.viewTable')} · {view.name}
            </button>
          ),
        )}
        <button type="button" className="bitable-btn" data-testid="bitable-view-new" onClick={() => { addView('table'); }}>
          +{t('bitable.viewTable')}
        </button>
        <button type="button" className="bitable-btn" data-testid="bitable-view-kanban" onClick={() => { addView('kanban'); }}>
          +{t('bitable.viewKanban')}
        </button>
        <button type="button" className="bitable-btn" data-testid="bitable-view-rename" onClick={() => { setRenameText(activeView?.name ?? ''); setRenaming(true); }}>
          {t('bitable.viewRename')}
        </button>
        {/* v1 已知项：视图删除需要「整表视图集覆盖」的引擎路径（现 saveView 是单视图 upsert），
            本期**不提供按钮**而不是给一个点了没反应的假动作（见 PRD 第 3 节「明确不在 v1」）。 */}
        <button
          type="button"
          className="bitable-btn"
          data-testid="bitable-view-remove"
          disabled
          title={t('bitable.viewRemove')}
        >
          {t('bitable.viewRemove')}
        </button>
      </div>

      <div className="bitable-toolbar" data-testid="bitable-toolbar">
        {isKanban ? (
          <label className="bitable-groupby">
            {t('bitable.groupBy')}
            <select
              data-testid="bitable-groupby"
              value={groups[0]?.pid ?? ''}
              onChange={(event) => { setGroupPid(event.target.value); }}
            >
              {selectable.length === 0 ? <option value="">{t('bitable.groupByNone')}</option> : null}
              {selectable.map((property) => (
                <option key={property.id} value={property.id}>{property.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <span className="bitable-toolbar-hint">{t('bitable.fields')} · {t('bitable.filter')} · {t('bitable.sort')}</span>
        )}
        <button type="button" className="bitable-btn" data-testid="bitable-export" onClick={exportCsv}>
          {t('bitable.export')}
        </button>
      </div>

      {isKanban ? (
        groups.length === 0 ? (
          <p className="bitable-empty" data-testid="bitable-empty">
            {t('bitable.groupByNone')} · {t('bitable.emptyHint')}
          </p>
        ) : (
          <KanbanBoard groups={groups} schema={collection.schema} onMove={moveCard} />
        )
      ) : null}

      <div className="bitable-grid" data-testid="bitable-grid" hidden={isKanban}>
        <DbPage pageId={pageId} />
      </div>
      {records.length === 0 && !isKanban ? (
        <p className="bitable-empty" data-testid="bitable-empty">{t('bitable.addRowHint')}</p>
      ) : null}
    </div>
  );
}

interface KanbanBoardProps {
  groups: ReturnType<typeof kanbanGroups>;
  /** 卡片标题取标题列：必须带上表 schema（缺 schema 会退化成显示记录 id —— 不是我们要的观感）。 */
  schema: CollectionSchema;
  onMove(recordId: string, key: string): void;
}

/** 看板：列 = 分组，卡片 = 记录；拖动卡片到另一列 = 改分组字段值（语义来自引擎纯函数）。 */
function KanbanBoard({ groups, schema, onMove }: KanbanBoardProps): ReactNode {
  const [dragId, setDragId] = useState<string | null>(null);
  return (
    <div className="bitable-kanban" data-testid="bitable-kanban">
      {groups.map((group) => (
        <section
          key={group.key}
          className="bitable-kcol"
          data-testid={`bitable-kanban-col-${group.key}`}
          onDragOver={(event) => { event.preventDefault(); }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragId !== null) {
              onMove(dragId, group.key);
            }
            setDragId(null);
          }}
        >
          <header className="bitable-kcol-head">
            <span className="bitable-kcol-name">{group.key === NONE_GROUP_KEY ? t('bitable.groupByNone') : group.label}</span>
            <span className="bitable-kcol-count">{group.records.length}</span>
          </header>
          <div className="bitable-kcol-body">
            {group.records.map((record: RecordEntity) => (
              <article
                key={record.id}
                className="bitable-card"
                data-testid={`bitable-card-${record.id}`}
                draggable
                onDragStart={() => { setDragId(record.id); }}
                onDragEnd={() => { setDragId(null); }}
              >
                {recordTitle(schema, record.values, record.id)}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default BitablePage;