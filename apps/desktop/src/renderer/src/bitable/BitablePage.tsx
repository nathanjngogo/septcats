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
import { CellEditor } from '@septcats/dbview/react';
import { Button, Dialog } from '@septcats/ui';
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

  // ---- 记录详情（老板 10-01 第①项：看板卡片点开记录，对标飞书）----
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 同一时刻只允许一个字段处于编辑态（与表格视图的 focused/editing 单点口径一致）。 */
  const [editPid, setEditPid] = useState<string | null>(null);
  const detailRecord = useMemo(
    () => (detailId === null ? null : (records.find((r) => r.id === detailId) ?? null)),
    [detailId, records],
  );
  const closeDetail = useCallback((): void => {
    setDetailId(null);
    setEditPid(null);
  }, []);
  /** 详情里改字段：走与看板拖动/表格行内编辑**同一条**写值通道（db.updateRecord）。 */
  const commitField = useCallback(
    (recordId: string, pid: string, value: unknown): void => {
      void db.updateRecord(recordId, { [pid]: value });
    },
    [db],
  );

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
          <span className="bitable-toolbar-hint">{t('bitable.gridHint')}</span>
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
          <KanbanBoard
            groups={groups}
            options={groups.map((g) => ({ key: g.key, label: g.label }))}
            schema={collection.schema}
            onMove={moveCard}
            onOpen={(recordId) => { setDetailId(recordId); setEditPid(null); }}
          />
        )
      ) : null}

      <div className="bitable-grid" data-testid="bitable-grid" hidden={isKanban}>
        <DbPage pageId={pageId} />
      </div>
      {records.length === 0 && !isKanban ? (
        <p className="bitable-empty" data-testid="bitable-empty">{t('bitable.addRowHint')}</p>
      ) : null}

      {/* 记录详情：字段编辑**复用引擎的 CellEditor**（每种字段类型的编辑器不重造），
          提交走 db.updateRecord（与拖动/行内编辑同源）；Esc / 关闭钮 / 遮罩都能退。 */}
      {detailRecord === null ? null : (
        <Dialog
          open
          onClose={closeDetail}
          title={recordTitle(collection.schema, detailRecord.values, detailRecord.id)}
          footer={
            <Button variant="secondary" data-testid="bitable-detail-close" onClick={closeDetail}>
              {t('bitable.close')}
            </Button>
          }
          className="bitable-detail-dialog"
        >
          <div className="bitable-detail" data-testid="bitable-detail">
            {propertyList(collection.schema).map((p: Property) => (
              <div className="bitable-detail__row" key={p.id} data-testid={`bitable-detail-row-${p.id}`}>
                <span className="bitable-detail__lab">{p.name}</span>
                <div
                  className="bitable-detail__ctl"
                  data-testid={`bitable-detail-ctl-${p.id}`}
                  onClick={() => { setEditPid(p.id); }}
                >
                  <CellEditor
                    property={p}
                    value={detailRecord.values[p.id]}
                    editing={editPid === p.id}
                    onBeginEdit={() => { setEditPid(p.id); }}
                    onEndEdit={() => { setEditPid(null); }}
                    onCommit={(value: unknown) => {
                      commitField(detailRecord.id, p.id, value);
                      setEditPid(null);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}

interface KanbanBoardProps {
  /** 点卡片标题 → 打开记录详情（老板 10-01 第①项）。 */
  onOpen: (recordId: string) => void;
  /** 分组列（可选项 + 未分组桶）：卡片上的「移到」下拉直接用它的 key/label。 */
  options: readonly { key: string; label: string }[];
  groups: ReturnType<typeof kanbanGroups>;
  /** 卡片标题取标题列：必须带上表 schema（缺 schema 会退化成显示记录 id —— 不是我们要的观感）。 */
  schema: CollectionSchema;
  onMove(recordId: string, key: string): void;
}

/** 看板：列 = 分组，卡片 = 记录；拖动卡片到另一列 = 改分组字段值（语义来自引擎纯函数）。 */
function KanbanBoard({ groups, options, schema, onMove, onOpen }: KanbanBoardProps): ReactNode {
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
                {/* 标题做成真按钮（不是给整张卡挂 onClick）：卡内还有「移到」下拉，
                    嵌套交互元素会让 a11y 树语义打架；按钮同时天然键盘可达（Tab + Enter）。 */}
                <button
                  type="button"
                  className="bitable-card-open"
                  data-testid={`bitable-open-${record.id}`}
                  onClick={() => { onOpen(record.id); }}
                >
                  {recordTitle(schema, record.values, record.id)}
                </button>
                {/* 键盘 / 无拖拽设备的等价路径：拖动是鼠标专属操作，只给拖动等于把看板对键盘用户关掉
                    （a11y 红线）。每张卡片一个「移到」下拉 —— 与拖动共用同一个 onMove。 */}
                <label className="bitable-card-move">
                  <span className="bitable-card-move-label">{t('bitable.moveTo')}</span>
                  <select
                    data-testid={`bitable-move-${record.id}`}
                    value={group.key}
                    onChange={(event) => { onMove(record.id, event.target.value); }}
                  >
                    {options.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.key === NONE_GROUP_KEY ? t('bitable.groupByNone') : option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default BitablePage;