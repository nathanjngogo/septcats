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
 *
 * 例外（TASK-T47-01）：宿主（DbPage）在**每次写库后** reload 会把本组件整树卸载
 * 重挂（status→loading 骨架 → 就绪后再挂载），组件内的 focusedCell 随之丢失、
 * DOM 焦点落回 body——勾选格「点一次就再也按不动 Enter/Space」（键盘只能生效一次，
 * 点击后无法键盘接力）。故用**会话级焦点记忆**（collection + 记录 id + 属性 id）
 * 在重挂后恢复单元格焦点；键处理与持久化通道一字未改。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CollectionEntity,
  type CollectionSchema,
  type DbView as DbViewEntity,
  type FieldType,
  type RecordEntity,
  type ViewType,
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

/**
 * 「最后一个被聚焦的单元格」会话级记忆（TASK-T47-01，模块级、跨重挂存活）。
 * 用记录 id + 属性 id 而非行下标——重挂后行序可能因筛选/排序重排。
 * 一次性消费：恢复（或确认不可恢复）后立即作废，避免陈旧焦点跨页/跨用例复活。
 */
const focusMemory: { collectionId: string | null; rowId: string | null; prop: string | null } = {
  collectionId: null,
  rowId: null,
  prop: null,
};

function rememberFocusedCell(collectionId: string, rowId: string, prop: string): void {
  focusMemory.collectionId = collectionId;
  focusMemory.rowId = rowId;
  focusMemory.prop = prop;
}

export interface DbViewProps {
  collection: CollectionEntity;
  /**
   * 视图条只显示这些类型的视图（缺省 = 全部）。
   * T99-01：看板视图由多维表格一级页自己渲染，而本组件只会画表格 —— 宿主（DbPage）传
   * `['table']` 把看板视图挡在视图条外，否则用户在这里切到看板会看到一张「表格形态的看板」。
   */
  viewTypes?: readonly ViewType[] | undefined;
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
  /** 改字段类型（title 列不可；确认与值迁移由调用方承担，TASK-T40-01 §B2）。 */
  onChangePropertyType?: ((pid: string, type: FieldType) => void) | undefined;
  /** select/multi_select 选项全量替换（TASK-T40-01 §B3）；缺 id 项（新建）由 main 侧生成。 */
  onUpdatePropertyOptions?:
    | ((pid: string, options: Array<{ id?: string; name: string; tone?: 'neutral' | 'amber' | 'red' }>) => void)
    | undefined;
  /** 字段左右排序（beforePid=null = 末尾；title 恒首列）。 */
  onMoveProperty?: ((pid: string, beforePid: string | null) => void) | undefined;
  /** select/multi_select 单元格内新建选项：创建并返回选项 id（已存在同名返回既有 id）。 */
  onCreateCellOption?: ((pid: string, name: string) => string | undefined) | undefined;
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
    onChangePropertyType,
    onUpdatePropertyOptions,
    onMoveProperty,
    onCreateCellOption,
    onSaveView,
    onExportCsv,
    onOpenRelation,
    onAiGenerate,
    onAiBatchGenerate,
    onUpdateAiPrompt,
    relationCandidates = [],
    viewportHeight = 480,
    viewTypes,
  } = props;

  const schema = collection.schema;
  // 视图条白名单（T99-01）：宿主可把本组件画不了的视图类型挡在视图条外（见 DbViewProps.viewTypes）。
  const visibleViews = viewTypes === undefined ? collection.views : collection.views.filter((view) => viewTypes.includes(view.type));
  const [activeVid, setActiveVid] = useState<string>(visibleViews[0]?.vid ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedCell, setFocusedCell] = useState<{ rowIndex: number; prop: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; prop: string } | null>(null);
  /** AI 生成中的记录 id 集合（设备本地瞬时态，不落 Op）。 */
  const [aiBusyIds, setAiBusyIds] = useState<ReadonlySet<string>>(new Set());
  const aiBusyRef = useRef<ReadonlySet<string>>(new Set());

  const activeView = visibleViews.find((view) => view.vid === activeVid) ?? visibleViews[0];

  // collection 切换（多标签页/跨页跳转）时收敛瞬时状态
  useEffect(() => {
    setActiveVid(visibleViews[0]?.vid ?? '');
    setSelectedIds(new Set());
    setEditingCell(null);
    // visibleViews 由 collection.views + viewTypes 派生：依赖这两者即可（避免新数组引用导致每次都跑）
  }, [collection.id, collection.views, viewTypes]);

  // TASK-T47-01：焦点格只在**换库**时收敛。宿主每次写库后 reload 都会换 `views`
  // 数组引用（structured clone），若把 focusedCell 一并清掉，勾选格的 Enter/Space
  // 就会在同一次写库后被吞掉（键盘只能生效一次）。收敛口径与注释声明的「切页/跳转」
  // 意图一致：以 collection.id 为准。
  useEffect(() => {
    setFocusedCell(null);
  }, [collection.id]);

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

  // TASK-T47-01：重挂后恢复焦点格（一次性消费记忆）。挂载首帧的 filtered 已是
  // reload 后的新数据，记录 id → 行下标映射在此时是准的。
  useEffect(() => {
    const remembered = {
      collectionId: focusMemory.collectionId,
      rowId: focusMemory.rowId,
      prop: focusMemory.prop,
    };
    focusMemory.collectionId = null;
    focusMemory.rowId = null;
    focusMemory.prop = null;
    if (
      remembered.collectionId !== collection.id ||
      remembered.rowId === null ||
      remembered.prop === null
    ) {
      return;
    }
    const rowIndex = filtered.findIndex((row) => row.id === remembered.rowId);
    if (rowIndex < 0) {
      return;
    }
    setFocusedCell({ rowIndex, prop: remembered.prop });
  }, []);

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
        {records.length} 条记录 · {visibleViews.length} 个视图
        {activeView === undefined ? null : ` · 当前视图「${activeView.name}」`}
      </p>

      <PropBar
        schema={schema}
        views={visibleViews}
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
        hiddenPids={activeView?.hiddenPids ?? []}
        onChangeHidden={(next) => {
          saveView({ hiddenPids: next });
        }}
        onAddProperty={onAddProperty}
        onRemoveProperty={onRemoveProperty}
        onRenameProperty={onRenameProperty}
        onChangePropertyType={onChangePropertyType}
        onUpdatePropertyOptions={onUpdatePropertyOptions}
        onMoveProperty={onMoveProperty}
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
        hiddenPids={activeView?.hiddenPids ?? []}
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
        onCreateCellOption={onCreateCellOption}
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
          // TASK-T47-01：同步记下会话级焦点格（按记录 id 记，重挂后按 id 反查行号）
          const row = visibleRows[rowIndex];
          if (row !== undefined) {
            rememberFocusedCell(collection.id, row.id, prop);
          }
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
