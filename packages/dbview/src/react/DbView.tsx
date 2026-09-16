/**
 * DbView.tsx —— 数据库视图的组装根（TASK-T7-01 §1/§4）。
 *
 * 组装：标题行（icon + 名称 + 记录数）→ PropBar（视图/筛选/排序/属性）→
 * TableGrid（表格 + 四态）→ Aggregations（计算行）。
 *
 * 职责边界：本组件**只做视图状态与筛选/排序/选择**；一切持久化动作
 * （改值、增删属性、建记录、导出）经回调上抛给 apps 层的数据层，
 * 由后者造 Op 并 `commitOps`（本包不碰 db/IPC）。
 *
 * 交互状态（focusedCell/editingCell/selectedIds）**不落 Op**：它们是设备本地的
 * 瞬时视图状态，不进真相层（切页/重载即重置）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CollectionEntity,
  type CollectionSchema,
  type DbView as DbViewEntity,
  type FieldType,
  type RecordEntity,
} from '../types';
import { isEmptyValue } from '../values';
import { applyView } from '../view';
import { Aggregations } from './Aggregations';
import { PropBar } from './PropBar';
import { TableGrid, type DbTableStatus } from './TableGrid';
import type { RelationCandidate } from './CellEditor';
import './DbView.css';

/** 记录创建意图：`pid` 缺省 = 标题列。 */
export interface CreateRecordField {
  pid?: string | undefined;
  value: string;
}

export interface DbViewProps {
  collection: CollectionEntity;
  records: readonly RecordEntity[];
  status: DbTableStatus;
  error?: (string | null) | undefined;
  onRetry?: (() => void) | undefined;
  onCreateRecord: (initial?: CreateRecordField) => void;
  onDeleteRecords: (ids: readonly string[]) => void;
  onChangeValue: (recordId: string, pid: string, value: unknown) => void;
  onRenameRecord: (recordId: string, title: string) => void;
  onAddProperty: (type: FieldType) => void;
  onRemoveProperty: (pid: string) => void;
  onRenameProperty: (pid: string, name: string) => void;
  onSaveView: (view: DbViewEntity) => void;
  onExportCsv: () => void;
  onOpenRelation?: ((recordId: string) => void) | undefined;
  /** AI 列单行生成（受控回调：dbview 不 import electron、不直接调 window.septcats）。 */
  onAiGenerate?: ((pid: string, recordId: string) => Promise<void>) | undefined;
  /** AI 列批量生成（受控回调；recordIds = 当前视图前 ≤20 行，由本组件计算）。 */
  onAiBatchGenerate?:
    | ((pid: string, recordIds: readonly string[]) => Promise<{ done: number; failed: number }>)
    | undefined;
  /** AI 列生成指令提交（空串 = 清除配置，回落默认指令）。 */
  onUpdateAiPrompt?: ((pid: string, prompt: string) => void) | undefined;
  /** 关系候选（目标 collection 的记录）；缺省时 relation 列只读。 */
  relationCandidates?: readonly RelationCandidate[] | undefined;
  /** 视口高度（px）；缺省 480。 */
  viewportHeight?: number | undefined;
}

export function DbView(props: DbViewProps) {
  const {
    collection,
    records,
    status,
    error = null,
    onRetry,
    onCreateRecord,
    onDeleteRecords,
    onChangeValue,
    onRenameRecord,
    onAddProperty,
    onRemoveProperty,
    onRenameProperty,
    onSaveView,
    onExportCsv,
    onOpenRelation,
    onAiGenerate,
    onAiBatchGenerate,
    onUpdateAiPrompt,
    relationCandidates = [],
    viewportHeight = 480,
  } = props;

  const schema = collection.schema;
  const [activeVid, setActiveVid] = useState<string>(collection.views[0]?.vid ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedCell, setFocusedCell] = useState<{ rowIndex: number; prop: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; prop: string } | null>(null);
  /** AI 生成中的记录 id 集合（设备本地瞬时态，不落 Op）。 */
  const [aiBusyIds, setAiBusyIds] = useState<ReadonlySet<string>>(new Set());
  const aiBusyRef = useRef<ReadonlySet<string>>(new Set());

  const activeView = collection.views.find((view) => view.vid === activeVid) ?? collection.views[0];

  // collection 切换（多标签页/跨页跳转）时收敛瞬时状态
  useEffect(() => {
    setActiveVid(collection.views[0]?.vid ?? '');
    setSelectedIds(new Set());
    setFocusedCell(null);
    setEditingCell(null);
  }, [collection.id, collection.views]);

  const visibleRows = useMemo(() => {
    if (activeView === undefined) {
      return [...records];
    }
    return applyView(records, activeView, schema);
  }, [activeView, records, schema]);

  const relationTitle = useCallback(
    (id: string): string | null => {
      const found = relationCandidates.find((candidate) => candidate.id === id);
      return found === undefined ? null : found.title;
    },
    [relationCandidates],
  );

  const saveView = useCallback(
    (patch: Partial<DbViewEntity>) => {
      if (activeView === undefined) {
        return;
      }
      onSaveView({ ...activeView, ...patch });
    },
    [activeView, onSaveView],
  );

  const filtered = visibleRows;

  const effectiveStatus: DbTableStatus =
    status === 'ready' && filtered.length === 0 && records.length === 0 ? 'empty' : status;

  const emptyByFilter =
    status === 'ready' && filtered.length === 0 && records.length > 0 && activeView !== undefined;

  const toggleSelectRow = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (all: boolean) => {
      setSelectedIds(all ? new Set(visibleRows.map((row) => row.id)) : new Set());
    },
    [visibleRows],
  );

  const createRecord = useCallback(() => {
    const titleProperty = schema.properties[schema.title_pid];
    if (titleProperty === undefined) {
      onCreateRecord();
      return;
    }
    onCreateRecord({ pid: titleProperty.id, value: '未命名' });
  }, [onCreateRecord, schema]);

  /** 单行 AI 生成包装：登记 busy（重复触发忽略），结束后解除。 */
  const handleAiGenerate = useCallback(
    (pid: string, recordId: string): void => {
      if (onAiGenerate === undefined || aiBusyRef.current.has(recordId)) {
        return;
      }
      const next = new Set(aiBusyRef.current);
      next.add(recordId);
      aiBusyRef.current = next;
      setAiBusyIds(next);
      onAiGenerate(pid, recordId).finally(() => {
        const rest = new Set(aiBusyRef.current);
        rest.delete(recordId);
        aiBusyRef.current = rest;
        setAiBusyIds(rest);
      });
    },
    [onAiGenerate],
  );

  /** 批量生成入口：目标 = 当前视图前 ≤20 行（行集由本组件决定，调用方只拿 id）。 */
  const handleAiBatchGenerate = useCallback(
    (pid: string): void => {
      if (onAiBatchGenerate === undefined) {
        return;
      }
      const recordIds = visibleRows.slice(0, 20).map((row) => row.id);
      void onAiBatchGenerate(pid, recordIds);
    },
    [onAiBatchGenerate, visibleRows],
  );

  return (
    <div className="sc-db">
      <div className="sc-db__title-row">
        <span className="sc-db__icon" aria-hidden="true">
          🗂
        </span>
        <h1 className="sc-db__title">{collection.name.length === 0 ? '未命名数据库' : collection.name}</h1>
      </div>
      <p className="sc-db__sub">
        {records.length} 条记录 · {collection.views.length} 个视图
        {activeView === undefined ? null : ` · 当前视图「${activeView.name}」`}
      </p>

      <PropBar
        schema={schema}
        views={collection.views}
        activeVid={activeView?.vid ?? ''}
        onSwitchView={setActiveVid}
        filter={activeView?.filter ?? { op: 'and', clauses: [] }}
        onChangeFilter={(next) => {
          saveView({ filter: next });
        }}
        sort={activeView?.sort ?? []}
        onChangeSort={(next) => {
          saveView({ sort: next });
        }}
        onAddProperty={onAddProperty}
        onRemoveProperty={onRemoveProperty}
        onRenameProperty={onRenameProperty}
        onAiBatchGenerate={onAiBatchGenerate === undefined ? undefined : handleAiBatchGenerate}
        onUpdateAiPrompt={onUpdateAiPrompt}
        onCreateRecord={createRecord}
        onExportCsv={onExportCsv}
      />

      {emptyByFilter ? (
        <p className="sc-db__notice">
          当前筛选没有匹配的记录（共 {records.length} 条）—— 移除部分筛选 chip 可恢复显示。
        </p>
      ) : null}

      <TableGrid
        schema={schema}
        rows={visibleRows}
        widths={activeView?.widths ?? {}}
        status={effectiveStatus}
        error={error}
        selectedIds={selectedIds}
        focusedCell={focusedCell}
        editingCell={editingCell}
        viewportHeight={viewportHeight}
        relationCandidates={relationCandidates}
        relationTitle={relationTitle}
        onClickRelation={onOpenRelation}
        onRetry={onRetry}
        onCreateRecord={createRecord}
        onDeleteSelected={(ids) => {
          onDeleteRecords(ids);
          setSelectedIds(new Set());
        }}
        onClearSelection={() => {
          setSelectedIds(new Set());
        }}
        onToggleSelectRow={toggleSelectRow}
        onToggleSelectAll={toggleSelectAll}
        onChangeCell={(recordId, pid, value) => {
          onChangeValue(recordId, pid, coerceForProperty(schema, pid, value));
        }}
        onRenameRecord={onRenameRecord}
        onResizeColumn={(pid, width) => {
          saveView({ widths: { ...(activeView?.widths ?? {}), [pid]: width } });
        }}
        onFocusCell={(rowIndex, prop) => {
          setFocusedCell({ rowIndex, prop });
        }}
        onBeginEdit={(rowIndex, prop) => {
          setEditingCell({ rowIndex, prop });
        }}
        onEndEdit={() => {
          setEditingCell(null);
        }}
        aiBusyRecordIds={aiBusyIds}
        onAiGenerateCell={
          onAiGenerate === undefined
            ? undefined
            : (recordId, pid) => {
                // TableGrid 给 (recordId, pid)，受控回调契约是 (pid, recordId)
                handleAiGenerate(pid, recordId);
              }
        }
      />

      <Aggregations schema={schema} rows={visibleRows} />
    </div>
  );
}

/**
 * 把 UI 上来的原始值按属性类型归一（粘贴/编辑器都走这里）：
 * - number：字符串 → 数字（不合法清空）；
 * - date：`YYYY-MM-DD` → `{y,m,d}`；已有对象原样；
 * - checkbox：字符串 'true'/'false' 归一为布尔；
 * - 其余：原样（select/multi/relation 由编辑器直接给 id）。
 */
export function coerceForProperty(
  schema: CollectionSchema,
  pid: string,
  value: unknown,
): unknown {
  const property = schema.properties[pid];
  if (property === undefined) {
    return value;
  }
  if (property.type === 'number' && typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (property.type === 'date' && typeof value === 'string') {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
    if (match === null) {
      return null;
    }
    return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  }
  if (property.type === 'checkbox' && typeof value === 'string') {
    return value === 'true';
  }
  if (property.type === 'multi_select' && typeof value === 'string') {
    return isEmptyValue(value) ? null : value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  }
  return value;
}
