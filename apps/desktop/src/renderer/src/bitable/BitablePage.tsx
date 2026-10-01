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
  formFieldPids,
  formRequiredPids,
  formatValue,
  galleryFieldPids,
  kanbanGroups,
  missingRequiredPids,
  moveCardToGroup,
  propertyList,
  recordTitle,
  resolveCoverPid,
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

type AnyViewType = DbView['type'];

/** 视图类型 → 人话标签（视图条 / 新建按钮共用一处，避免两处漂移）。 */
function viewTypeLabel(type: AnyViewType): string {
  switch (type) {
    case 'kanban':
      return t('bitable.viewKanban');
    case 'gallery':
      return t('bitable.viewGallery');
    case 'form':
      return t('bitable.viewForm');
    default:
      return t('bitable.viewTable');
  }
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
  const { collection, records, status, error, createRecord } = db;
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
  const isGallery = activeView?.type === 'gallery';
  const isForm = activeView?.type === 'form';
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
    (type: AnyViewType): void => {
      if (collection === null) {
        return;
      }
      const vid = nextVid(views);
      const name = viewTypeLabel(type);
      const base = defaultView(vid, name);
      let view: DbView = { ...base, type };
      if (type === 'kanban') {
        const groupPid = firstSelectable(collection.schema)?.id;
        view = { ...view, ...(groupPid === undefined ? {} : { groupPid }) };
      }
      if (type === 'form') {
        // 表单标题缺省 = 视图名（表单页面上要有个抬头，且与视图条上的名字一致，不写空占位）
        view = { ...view, formTitle: name };
      }
      saveView(view);
      setActiveVid(vid);
    },
    [collection, saveView, views],
  );

  /** 画廊：换封面字段 / 表单：配字段与必填 —— 一律走 saveView 落库（零新增 IPC）。 */
  const patchActiveView = useCallback(
    (patch: Partial<DbView>): void => {
      if (activeView === undefined) {
        return;
      }
      saveView({ ...activeView, ...patch });
    },
    [activeView, saveView],
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
              {viewTypeLabel(view.type)} · {view.name}
            </button>
          ),
        )}
        <button type="button" className="bitable-btn" data-testid="bitable-view-new" onClick={() => { addView('table'); }}>
          +{t('bitable.viewTable')}
        </button>
        <button type="button" className="bitable-btn" data-testid="bitable-view-kanban" onClick={() => { addView('kanban'); }}>
          +{t('bitable.viewKanban')}
        </button>
        <button type="button" className="bitable-btn" data-testid="bitable-view-gallery" onClick={() => { addView('gallery'); }}>
          +{t('bitable.viewGallery')}
        </button>
        <button type="button" className="bitable-btn" data-testid="bitable-view-form" onClick={() => { addView('form'); }}>
          +{t('bitable.viewForm')}
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
        ) : isGallery ? (
          <label className="bitable-groupby">
            {t('bitable.galleryCover')}
            <select
              data-testid="bitable-gallery-cover"
              value={activeView?.coverPid ?? ''}
              onChange={(event) => { patchActiveView({ coverPid: event.target.value }); }}
            >
              <option value="">{t('bitable.coverAuto')}</option>
              {propertyList(collection.schema).filter((p) => p.id !== collection.schema.title_pid).map((property) => (
                <option key={property.id} value={property.id}>{property.name}</option>
              ))}
            </select>
          </label>
        ) : isForm ? null : (
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

      {isGallery ? (
        records.length === 0 ? (
          <p className="bitable-empty" data-testid="bitable-empty">{t('bitable.galleryEmpty')}</p>
        ) : (
          <GalleryBoard
            schema={collection.schema}
            records={records}
            view={activeView}
            onOpen={(recordId) => { setDetailId(recordId); setEditPid(null); }}
          />
        )
      ) : null}

      {isForm ? (
        <FormBoard
          schema={collection.schema}
          view={activeView}
          onPatchView={patchActiveView}
          onSubmit={(values) => createRecord(values)}
        />
      ) : null}

      <div className="bitable-grid" data-testid="bitable-grid" hidden={isKanban || isGallery || isForm}>
        <DbPage pageId={pageId} />
      </div>
      {records.length === 0 && !isKanban && !isGallery && !isForm ? (
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

interface GalleryBoardProps {
  schema: CollectionSchema;
  records: readonly RecordEntity[];
  view: DbView;
  /** 点卡片标题 → 打开记录详情（与看板同一入口语义）。 */
  onOpen: (recordId: string) => void;
}

/**
 * 画廊视图（TASK-T99-02）：记录 = 卡片，铺成自适应网格。
 *
 * 「显示哪几个字段 / 拿谁当封面」全部来自引擎纯函数（galleryFieldPids / resolveCoverPid），
 * 渲染层不自己挑字段 —— 这样规则可单测、三种视图口径一致。
 * 封面不做图片渲染（引擎没有附件取图通道）：以**色带 + 该字段的值文本**表达，
 * 空值用统一占位「—」，不假装有图。
 */
function GalleryBoard({ schema, records, view, onOpen }: GalleryBoardProps): ReactNode {
  const properties = propertyList(schema);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const coverPid = resolveCoverPid(schema, view);
  const cover = coverPid === undefined ? undefined : byId.get(coverPid);
  const fieldPids = galleryFieldPids(schema, view);

  return (
    <div className="bitable-gallery" data-testid="bitable-gallery">
      {records.map((record: RecordEntity) => (
        <article className="bitable-gcard" key={record.id} data-testid={`bitable-gcard-${record.id}`}>
          <div className="bitable-gcard-cover" data-testid={`bitable-gcard-cover-${record.id}`}>
            <span className="bitable-gcard-cover-name">{cover === undefined ? t('bitable.coverAuto') : cover.name}</span>
            <span className="bitable-gcard-cover-val">
              {cover === undefined ? t('bitable.coverEmpty') : formatValue(cover, record.values[cover.id])}
            </span>
          </div>
          <button
            type="button"
            className="bitable-gcard-open"
            data-testid={`bitable-open-${record.id}`}
            onClick={() => { onOpen(record.id); }}
          >
            {recordTitle(schema, record.values, record.id)}
          </button>
          {fieldPids.length === 0 ? null : (
            <dl className="bitable-gcard-fields">
              {fieldPids.map((pid: string) => {
                const property = byId.get(pid);
                if (property === undefined) {
                  return null;
                }
                return (
                  <div className="bitable-gcard-row" key={pid} data-testid={`bitable-gcard-row-${pid}`}>
                    <dt className="bitable-gcard-lab">{property.name}</dt>
                    <dd className="bitable-gcard-val">{formatValue(property, record.values[pid])}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </article>
      ))}
    </div>
  );
}

interface FormBoardProps {
  schema: CollectionSchema;
  view: DbView;
  /** 改表单配置（展示字段 / 必填）→ 走 saveView 落库。 */
  onPatchView: (patch: Partial<DbView>) => void;
  /** 提交一条新记录（走 useDbPage.createRecord，与表格/看板同一条记录创建通道）。 */
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}

/**
 * 表单视图（TASK-T99-02）：一次录入一条记录。
 *
 * 语义全部来自引擎：formFieldPids（字段与顺序，标题列恒首位）/ formRequiredPids（必填）/
 * missingRequiredPids（提交校验）。渲染层只负责：草稿态、把红字显示出来、提交后清空。
 * 校验**不通过就不提交**（而不是提交了再报错）—— 脏数据不进库。
 */
function FormBoard({ schema, view, onPatchView, onSubmit }: FormBoardProps): ReactNode {
  const properties = propertyList(schema);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const fields = formFieldPids(schema, view);
  const required = new Set(formRequiredPids(schema, view));
  const configurable = properties.filter((p) => p.id !== schema.title_pid);

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [editPid, setEditPid] = useState<string | null>(fields[0] ?? null);
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [done, setDone] = useState(false);
  /** 提交成功后递增：给表单区换 key ⇒ 整片重挂，编辑器的内部草稿也一起归零。
   *  （只清 state 不够：CellEditor 有自己的编辑草稿，重挂才是「表单真的重置了」。） */
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [openConfig, setOpenConfig] = useState(false);

  const shown = new Set(fields.filter((pid) => pid !== schema.title_pid));
  const toggleField = (pid: string, on: boolean): void => {
    const next = on
      ? [...shown, pid]
      : [...shown].filter((x) => x !== pid);
    const ordered = properties.filter((p) => next.includes(p.id)).map((p) => p.id);
    const stillRequired = (view.formRequired ?? []).filter((x) => ordered.includes(x));
    onPatchView({ formPids: ordered, formRequired: stillRequired });
  };
  const toggleRequired = (pid: string, on: boolean): void => {
    const next = on
      ? [...new Set([...(view.formRequired ?? []), pid])]
      : (view.formRequired ?? []).filter((x) => x !== pid);
    onPatchView({ formRequired: next });
  };

  const submit = (): void => {
    const miss = missingRequiredPids(schema, view, draft);
    setMissing(miss);
    if (miss.length > 0) {
      setDone(false);
      return;
    }
    setBusy(true);
    void onSubmit(draft).then(() => {
      setDraft({});
      setEditPid(fields[0] ?? null);
      setMissing([]);
      setDone(true);
      setFormKey((k) => k + 1);
      setBusy(false);
    }).catch(() => { setBusy(false); });
  };

  return (
    <div className="bitable-form" data-testid="bitable-form">
      <header className="bitable-form-head">
        <h2 className="bitable-form-title" data-testid="bitable-form-title">
          {view.formTitle ?? viewTypeLabel('form')}
        </h2>
        <button
          type="button"
          className="bitable-btn"
          data-testid="bitable-form-config-toggle"
          aria-expanded={openConfig}
          onClick={() => { setOpenConfig((open) => !open); }}
        >
          {t('bitable.formFields')}
        </button>
      </header>

      {openConfig ? (
        <div className="bitable-form-config" data-testid="bitable-form-config">
          <p className="bitable-form-config-hint">{t('bitable.formConfigHint')}</p>
          {configurable.map((property) => (
            <div className="bitable-form-config-row" key={property.id}>
              <label className="bitable-form-check">
                <input
                  type="checkbox"
                  data-testid={`bitable-form-field-${property.id}`}
                  checked={shown.has(property.id)}
                  onChange={(event) => { toggleField(property.id, event.target.checked); }}
                />
                {property.name}
              </label>
              <label className="bitable-form-check">
                <input
                  type="checkbox"
                  data-testid={`bitable-form-required-${property.id}`}
                  checked={required.has(property.id)}
                  disabled={!shown.has(property.id)}
                  onChange={(event) => { toggleRequired(property.id, event.target.checked); }}
                />
                {t('bitable.formRequired')}
              </label>
            </div>
          ))}
        </div>
      ) : null}

      <div className="bitable-form-body" key={formKey}>
        {fields.map((pid: string) => {
          const property = byId.get(pid);
          if (property === undefined) {
            return null;
          }
          const bad = missing.includes(pid);
          return (
            <div className="bitable-form-row" key={pid} data-testid={`bitable-form-row-${pid}`} data-invalid={bad ? 'true' : 'false'}>
              <span className="bitable-form-lab">
                {property.name}
                {required.has(pid) ? <b className="bitable-form-req" aria-hidden="true">*</b> : null}
              </span>
              <div className="bitable-form-ctl" data-testid={`bitable-form-ctl-${pid}`} onClick={() => { setEditPid(pid); }}>
                <CellEditor
                  property={property}
                  value={draft[pid]}
                  editing={editPid === pid}
                  onBeginEdit={() => { setEditPid(pid); }}
                  onEndEdit={() => { setEditPid(null); }}
                  onCommit={(value: unknown) => {
                    setDraft((current) => ({ ...current, [pid]: value }));
                    setEditPid(null);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <footer className="bitable-form-foot">
        <Button
          variant="primary"
          data-testid="bitable-form-submit"
          disabled={busy}
          onClick={submit}
        >
          {t('bitable.formSubmit')}
        </Button>
        {/* 校验失败 / 提交成功都用同一个 live region：读屏用户能听到结果，视觉用户看到红字/绿字 */}
        <p className="bitable-form-msg" data-testid="bitable-form-msg" role="status" aria-live="polite">
          {missing.length > 0 ? t('bitable.formMissing') : (done ? t('bitable.formSubmitted') : '')}
        </p>
      </footer>
    </div>
  );
}

export default BitablePage;