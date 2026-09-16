/**
 * TableGrid.tsx —— 表格视图（TASK-T7-01 §1/§4）。
 *
 * 自写虚拟滚动（不引 TanStack Table；行高固定 = `--sc-layout-row-h` = 36px）：
 * 只渲染视口内行 + 上下各一行缓冲，用两个 spacer 撑出总高度；滚动时按
 * `scrollTop / ROW_H` 算窗口，不使用 IntersectionObserver / ResizeObserver。
 *
 * 键盘（对齐 03 mockup 与 §4 红线）：
 * - 方向键在单元格间移动（真实移动 DOM 焦点 + `scrollIntoView(block:'nearest')`）；
 * - Enter 进入编辑（checkbox 直接切换、file 只读）；
 * - Esc 取消编辑；编辑态内的 Enter/Esc 由 CellEditor 自行收敛（stopPropagation）。
 *
 * 列宽：`view.widths[pid]` 覆盖，缺省 `DEFAULT_COL_W`；表头右缘拖动改宽并回调 `onResizeColumn`。
 *
 * 四态齐（§4.6）：loading → 与行同构的 Skeleton；empty → EmptyState（一句 + 新建记录 primary）；
 * error → ErrorPanel（重试）；ready → 正常表格。批量勾选行时底部显批量条。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type {
  ClipboardEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  UIEvent,
} from 'react';
import { Button, Checkbox, EmptyState, ErrorPanel, Plus, Skeleton, Trash } from '@septcats/ui';
import { propertyList, type CollectionSchema, type RecordEntity } from '../types';
import { recordTitle } from '../values';
import { CellEditor, type RelationCandidate } from './CellEditor';

/** 行高（与 token `--sc-layout-row-h` 同值，虚拟滚动算术用）。 */
export const ROW_H = 36;
/** 缺省列宽（px）。 */
export const DEFAULT_COL_W = 180;
/** 表头高（与 token `--sc-layout-head-h` 同值）。 */
export const HEAD_H = 32;
/** 列宽拖动范围。 */
export const MIN_COL_W = 120;
export const MAX_COL_W = 400;
/** 勾选列宽。 */
const CHECK_W = 32;
/** 上下各留一行缓冲，减少快速滚动时的空白。 */
const OVERSCAN = 1;

export type DbTableStatus = 'loading' | 'ready' | 'error' | 'empty';

export interface TableGridProps {
  schema: CollectionSchema;
  rows: readonly RecordEntity[];
  widths: Readonly<Record<string, number>>;
  status: DbTableStatus;
  error?: (string | null) | undefined;
  selectedIds: ReadonlySet<string>;
  focusedCell: { rowIndex: number; prop: string } | null;
  editingCell: { rowIndex: number; prop: string } | null;
  /** 视口高度（px）。缺省 480，调用方可用容器实测值传入。 */
  viewportHeight?: number | undefined;
  relationCandidates?: readonly RelationCandidate[] | undefined;
  relationTitle?: ((id: string) => string | null) | undefined;
  onClickRelation?: ((id: string) => void) | undefined;
  onRetry?: (() => void) | undefined;
  onCreateRecord?: (() => void) | undefined;
  /** 批量删除（批量条上的动作）。 */
  onDeleteSelected?: ((ids: string[]) => void) | undefined;
  /** 清空选择。 */
  onClearSelection?: (() => void) | undefined;
  onToggleSelectRow?: ((id: string) => void) | undefined;
  onToggleSelectAll?: ((all: boolean) => void) | undefined;
  onChangeCell?: ((rowId: string, pid: string, value: unknown) => void) | undefined;
  /** 直接编辑标题列（Enter/失焦提交；空串 = 清空标题）。 */
  onRenameRecord?: ((rowId: string, title: string) => void) | undefined;
  onResizeColumn?: ((pid: string, width: number) => void) | undefined;
  onFocusCell?: ((rowIndex: number, prop: string) => void) | undefined;
  onBeginEdit?: ((rowIndex: number, prop: string) => void) | undefined;
  onEndEdit?: (() => void) | undefined;
  onReorderRecord?: ((fromId: string, toId: string) => void) | undefined;
  /** AI 列：生成中的记录 id 集合（该行按钮禁用 + spinner）。 */
  aiBusyRecordIds?: ReadonlySet<string> | undefined;
  /** AI 列：单行生成（未提供则单元格按钮不渲染）。 */
  onAiGenerateCell?: ((recordId: string, pid: string) => void) | undefined;
}

function colWidthOf(widths: Readonly<Record<string, number>>, pid: string): number {
  const width = widths[pid];
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return DEFAULT_COL_W;
  }
  return Math.min(Math.max(Math.round(width), MIN_COL_W), MAX_COL_W);
}

/**
 * 标题列单元格：默认展示记录标题，**双击**进入改名编辑态（没有 Enter 进入改名的
 * 分支；编辑态内 Enter 提交、Esc 取消、失焦提交；空串 = 清空标题）。
 * 其余列由 `CellEditor` 承担。
 */
function TitleCell({
  rowId,
  title,
  focused,
  onRename,
}: {
  rowId: string;
  title: string;
  focused: boolean;
  onRename?: ((rowId: string, title: string) => void) | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null && onRename !== undefined) {
    const commit = (): void => {
      const next = draft;
      setDraft(null);
      if (next !== title) {
        onRename(rowId, next);
      }
    };
    return (
      <input
        autoFocus
        className="sc-dbc-input"
        value={draft}
        aria-label="编辑标题"
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            commit();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
          }
        }}
        onBlur={commit}
      />
    );
  }

  return (
    <span
      className="sc-dbcell__title"
      title={title}
      onDoubleClick={() => {
        if (onRename !== undefined) {
          setDraft(title);
        }
      }}
    >
      {title}
      {focused && onRename !== undefined ? <span className="sc-dbcell__title-hint">双击改名</span> : null}
    </span>
  );
}

interface HeaderRowProps {
  schema: CollectionSchema;
  widths: Readonly<Record<string, number>>;
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelectAll?: ((all: boolean) => void) | undefined;
  onResizeColumn?: ((pid: string, width: number) => void) | undefined;
}

function HeaderRow({
  schema,
  widths,
  allSelected,
  someSelected,
  onToggleSelectAll,
  onResizeColumn,
}: HeaderRowProps) {
  const properties = propertyList(schema);

  const startResize = useCallback(
    (event: ReactMouseEvent<HTMLSpanElement>, pid: string) => {
      if (onResizeColumn === undefined) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = colWidthOf(widths, pid);
      const onMove = (move: MouseEvent): void => {
        const next = Math.min(Math.max(startWidth + (move.clientX - startX), MIN_COL_W), MAX_COL_W);
        onResizeColumn(pid, next);
      };
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [onResizeColumn, widths],
  );

  return (
    <div className="sc-dbhead" role="row">
      <div className="sc-dbhead__cell sc-dbhead__cell--check" role="columnheader">
        <Checkbox
          aria-label="全选"
          checked={allSelected}
          indeterminate={someSelected}
          onChange={(event) => {
            onToggleSelectAll?.(event.target.checked);
          }}
        />
      </div>
      {properties.map((property) => (
        <div key={property.id} className="sc-dbhead__cell" role="columnheader" title={`${property.name}（${property.type}）`}>
          <span className="sc-dbhead__name">{property.name}</span>
          <span className="sc-dbhead__type">{property.type}</span>
          <span
            className="sc-dbhead__resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={`调整列宽：${property.name}`}
            onMouseDown={(event) => {
              startResize(event, property.id);
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * 表格网格。**纯展示 + 交互**：不自己取数、不自己持久化；
 * 一切写意图经回调上抛给调用方（DbView → 数据层）。
 */
export function TableGrid(props: TableGridProps) {
  const {
    schema,
    rows,
    widths,
    status,
    error = null,
    selectedIds,
    focusedCell,
    editingCell,
    viewportHeight = 480,
    relationCandidates = [],
    relationTitle,
    onClickRelation,
    onRetry,
    onCreateRecord,
    onDeleteSelected,
    onClearSelection,
    onToggleSelectRow,
    onToggleSelectAll,
    onChangeCell,
    onRenameRecord,
    onResizeColumn,
    onFocusCell,
    onBeginEdit,
    onEndEdit,
    onReorderRecord,
    aiBusyRecordIds,
    onAiGenerateCell,
  } = props;

  const properties = useMemo(() => propertyList(schema), [schema]);
  const [scrollTop, setScrollTop] = useState(0);
  const dragIdRef = useRef<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());

  const colTemplate = useMemo(() => {
    const widthsPx = properties.map((property) => `${String(colWidthOf(widths, property.id))}px`);
    return [`${String(CHECK_W)}px`, ...widthsPx].join(' ');
  }, [properties, widths]);

  const visibleHeight = Math.max(viewportHeight - HEAD_H, ROW_H);
  const visibleCount = Math.ceil(visibleHeight / ROW_H);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endIndex = Math.min(rows.length, startIndex + visibleCount + OVERSCAN * 2);
  const visibleRows = rows.slice(startIndex, endIndex);

  // 焦点真实落到 DOM：focusedCell 变化后，把焦点移到新单元格（虚拟滚动下该行可能刚挂载）
  useEffect(() => {
    if (focusedCell === null) {
      return;
    }
    const node = cellRefs.current.get(`${String(focusedCell.rowIndex)}:${focusedCell.prop}`);
    if (node === undefined) {
      return;
    }
    if (!node.contains(document.activeElement)) {
      // 仅当焦点不在本单元格内部时才抢焦（TASK-T18-05）：编辑态输入框挂载后
      // focusin 冒泡会触发单元格 onFocus → focusedCell 引用变化 → 本 effect 重跑，
      // 若无条件 node.focus() 会把焦点从编辑输入框抢回 → onBlur 提交未变更的
      // draft → 编辑态闪退（双击改名/单元格编辑均受影响）。
      node.focus({ preventScroll: true });
    }
    node.scrollIntoView({ block: 'nearest' });
  }, [focusedCell, startIndex, endIndex]);

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  const moveFocus = useCallback(
    (rowIndex: number, prop: string, dRow: number, dCol: number): void => {
      if (onFocusCell === undefined || properties.length === 0) {
        return;
      }
      const nextRow = Math.min(Math.max(rowIndex + dRow, 0), rows.length - 1);
      const currentCol = Math.max(
        properties.findIndex((property) => property.id === prop),
        0,
      );
      const nextCol = Math.min(Math.max(currentCol + dCol, 0), properties.length - 1);
      const nextProperty = properties[nextCol];
      if (nextProperty === undefined) {
        return;
      }
      onFocusCell(nextRow, nextProperty.id);
    },
    [onFocusCell, properties, rows.length],
  );

  const onGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (editingCell !== null || focusedCell === null) {
        return;
      }
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveFocus(focusedCell.rowIndex, focusedCell.prop, 1, 0);
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveFocus(focusedCell.rowIndex, focusedCell.prop, -1, 0);
          return;
        case 'ArrowRight':
          event.preventDefault();
          moveFocus(focusedCell.rowIndex, focusedCell.prop, 0, 1);
          return;
        case 'ArrowLeft':
          event.preventDefault();
          moveFocus(focusedCell.rowIndex, focusedCell.prop, 0, -1);
          return;
        default:
          return;
      }
    },
    [editingCell, focusedCell, moveFocus],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>): void => {
      if (focusedCell === null || editingCell !== null || onChangeCell === undefined) {
        return;
      }
      const text = event.clipboardData.getData('text/plain');
      if (text.length === 0) {
        return;
      }
      const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.length > 0);
      const startCol = Math.max(
        properties.findIndex((property) => property.id === focusedCell.prop),
        0,
      );
      event.preventDefault();
      for (let offset = 0; offset < lines.length && offset <= 20; offset += 1) {
        const targetRow = rows[focusedCell.rowIndex + offset];
        if (targetRow === undefined) {
          break;
        }
        const cells = (lines[offset] ?? '').split('\t');
        for (let colOffset = 0; colOffset < cells.length; colOffset += 1) {
          const property = properties[startCol + colOffset];
          if (property === undefined) {
            break;
          }
          // 原样上交字符串；类型归一（number/date/checkbox）由调用方按属性类型收敛
          onChangeCell(targetRow.id, property.id, cells[colOffset] ?? '');
        }
      }
    },
    [editingCell, focusedCell, onChangeCell, properties, rows],
  );

  if (status === 'error') {
    return (
      <div className="sc-dbgrid sc-dbgrid--state">
        <ErrorPanel description={error ?? '数据库加载失败'} onRetry={onRetry} />
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className="sc-dbgrid sc-dbgrid--state">
        <EmptyState
          title="还没有记录"
          description="新建一条记录开始填写这个数据库。"
          actionLabel="新建记录"
          onAction={onCreateRecord}
        />
      </div>
    );
  }

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));
  const someSelected = !allSelected && rows.some((row) => selectedIds.has(row.id));

  return (
    <div className="sc-dbgrid">
      <div className="sc-dbgrid__header">
        <HeaderRow
          schema={schema}
          widths={widths}
          allSelected={allSelected}
          someSelected={someSelected}
          onToggleSelectAll={onToggleSelectAll}
          onResizeColumn={onResizeColumn}
        />
      </div>

      <div
        className="sc-dbgrid__body"
        role="grid"
        aria-rowcount={rows.length + 1}
        aria-colcount={properties.length + 1}
        tabIndex={0}
        style={{ maxHeight: `${String(viewportHeight)}px` }}
        onScroll={onScroll}
        onKeyDown={onGridKeyDown}
        onPaste={onPaste}
      >
        {status === 'loading' ? (
          <div className="sc-dbgrid__skeleton">
            {Array.from({ length: 8 }, (_value, index) => (
              <div key={index} className="sc-dbgrid__skelrow" style={{ gridTemplateColumns: colTemplate }}>
                <span className="sc-dbgrid__skelcell" />
                {properties.map((property) => (
                  <span key={property.id} className="sc-dbgrid__skelcell">
                    <Skeleton />
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="sc-dbgrid__viewport" style={{ height: `${String(rows.length * ROW_H)}px` }}>
            <div style={{ height: `${String(startIndex * ROW_H)}px` }} aria-hidden="true" />
            {visibleRows.map((row, offset) => {
              const rowIndex = startIndex + offset;
              const selected = selectedIds.has(row.id);
              const title = recordTitle(schema, row.values, row.id);
              return (
                <div
                  key={row.id}
                  role="row"
                  aria-selected={selected}
                  draggable
                  className={clsx(
                    'sc-dbrow',
                    rowIndex % 2 === 1 && 'sc-dbrow--odd',
                    selected && 'sc-dbrow--selected',
                    dropId === row.id && 'sc-dbrow--drop',
                  )}
                  style={{ gridTemplateColumns: colTemplate }}
                  onDragStart={() => {
                    dragIdRef.current = row.id;
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropId(dragIdRef.current === null || dragIdRef.current === row.id ? null : row.id);
                  }}
                  onDragEnd={() => {
                    dragIdRef.current = null;
                    setDropId(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = dragIdRef.current;
                    setDropId(null);
                    dragIdRef.current = null;
                    if (from !== null && from !== row.id) {
                      onReorderRecord?.(from, row.id);
                    }
                  }}
                >
                  <div className="sc-dbcell sc-dbcell--check" role="gridcell">
                    <Checkbox
                      aria-label={`选择记录：${title}`}
                      checked={selected}
                      onChange={() => {
                        onToggleSelectRow?.(row.id);
                      }}
                    />
                  </div>
                  {properties.map((property) => {
                    const key = `${String(rowIndex)}:${property.id}`;
                    const isTitle = property.id === schema.title_pid;
                    const focused =
                      focusedCell !== null &&
                      focusedCell.rowIndex === rowIndex &&
                      focusedCell.prop === property.id;
                    const editing =
                      editingCell !== null &&
                      editingCell.rowIndex === rowIndex &&
                      editingCell.prop === property.id;
                    return (
                      <div
                        key={property.id}
                        ref={(node) => {
                          if (node === null) {
                            cellRefs.current.delete(key);
                          } else {
                            cellRefs.current.set(key, node);
                          }
                        }}
                        role="gridcell"
                        tabIndex={focused ? 0 : -1}
                        className={clsx(
                          'sc-dbcell',
                          isTitle && 'sc-dbcell--title',
                          property.type === 'number' && 'sc-dbcell--num',
                          property.type === 'date' && 'sc-dbcell--date',
                          focused && 'sc-dbcell--focused',
                          editing && 'sc-dbcell--editing',
                        )}
                        onMouseDown={() => {
                          onFocusCell?.(rowIndex, property.id);
                        }}
                        onFocus={() => {
                          onFocusCell?.(rowIndex, property.id);
                        }}
                      >
                        {isTitle ? (
                          <TitleCell
                            rowId={row.id}
                            title={title}
                            focused={focused}
                            onRename={onRenameRecord}
                          />
                        ) : (
                          <CellEditor
                            property={property}
                            value={row.values[property.id]}
                            editing={editing}
                            relationCandidates={property.type === 'relation' ? relationCandidates : undefined}
                            relationTitle={relationTitle}
                            onClickRelation={onClickRelation}
                            onCommit={(value) => {
                              onChangeCell?.(row.id, property.id, value);
                            }}
                            onBeginEdit={() => {
                              onBeginEdit?.(rowIndex, property.id);
                            }}
                            onEndEdit={() => {
                              onEndEdit?.();
                            }}
                            aiBusy={property.type === 'ai' && aiBusyRecordIds !== undefined ? aiBusyRecordIds.has(row.id) : false}
                            onAiGenerate={
                              property.type === 'ai' && onAiGenerateCell !== undefined
                                ? () => {
                                    onAiGenerateCell(row.id, property.id);
                                  }
                                : undefined
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div style={{ height: `${String(Math.max(rows.length - endIndex, 0) * ROW_H)}px` }} aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="sc-dbgrid__foot">
        <Button variant="ghost" size="sm" icon={Plus} onClick={onCreateRecord}>
          新建记录
        </Button>
        {selectedIds.size > 0 ? (
          <span className="sc-dbgrid__bulk">
            已选 {selectedIds.size} 条
            <Button
              variant="ghost"
              size="sm"
              icon={Trash}
              onClick={() => {
                onDeleteSelected?.([...selectedIds]);
              }}
            >
              删除
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              取消选择
            </Button>
          </span>
        ) : null}
        <span className="sc-dbgrid__hint">方向键移动 · Enter 编辑 · Esc 取消</span>
      </div>
    </div>
  );
}
