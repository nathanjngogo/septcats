/**
 * PropBar.tsx —— 数据库工具条（TASK-T7-01 §1，对齐 03 mockup 的 `.db-toolbar`）。
 *
 * 组成（左 → 右）：视图切换（下拉，一期只有 table，预留位）/ 筛选 chip 链 /
 * 排序 chip / 新属性菜单 / 弹性占位 / 新建记录。
 *
 * 交互红线（§4）：
 * - **筛选 chip 可点「×」单个移除**（不是整条清空）；
 * - 排序 chip 点方向箭头切换 asc/desc，点「×」移除；
 * - 「新属性」菜单只有 8 种类型（text number select multi_select date checkbox url relation）；
 *   已有属性的重命名/改选项/删除走属性表头的下拉（`prop-menu-<pid>`），不堆在工具条上。
 *
 * 纪律：只 import react + @septcats/ui + `../types`/`view`；一切变更上抛回调。
 */
import { useState } from 'react';
import clsx from 'clsx';
import { Button, CaretDown, Icon, Menu, Plus, X, type MenuEntry } from '@septcats/ui';
import {
  FIELD_TYPES,
  FILTER_KINDS,
  NEW_PROPERTY_TYPES,
  isFieldType,
  type CollectionSchema,
  type DbView,
  type FieldType,
  type FilterClause,
  type FilterGroup,
  type FilterKind,
  type Property,
  type SortDirection,
} from '../types';
import { normalizeFilter, normalizeSort } from '../view';

/** 筛选算子 → 中文标签（chip 文案用）。 */
const FILTER_KIND_LABEL: Readonly<Record<FilterKind, string>> = {
  eq: '=',
  neq: '≠',
  contains: '包含',
  is_empty: '为空',
  gt: '>',
  lt: '<',
  before: '早于',
  after: '晚于',
};

const FIELD_TYPE_LABEL: Readonly<Record<FieldType, string>> = {
  text: '文本',
  number: '数字',
  select: '单选',
  multi_select: '多选',
  date: '日期',
  checkbox: '勾选',
  url: '链接',
  email: '邮箱',
  relation: '关联',
  file: '文件',
  ai: 'AI',
};

/** 各类型可选算子（与 view.matchesClause 的实现一一对应）。 */
export const FILTER_KINDS_BY_TYPE: Readonly<Record<FieldType, readonly FilterKind[]>> = {
  text: ['eq', 'neq', 'contains', 'is_empty'],
  url: ['eq', 'neq', 'contains', 'is_empty'],
  email: ['eq', 'neq', 'contains', 'is_empty'],
  number: ['eq', 'neq', 'gt', 'lt', 'is_empty'],
  date: ['eq', 'neq', 'before', 'after', 'is_empty'],
  checkbox: ['eq', 'neq'],
  select: ['eq', 'neq', 'is_empty'],
  multi_select: ['contains', 'is_empty'],
  relation: ['contains', 'is_empty'],
  file: ['contains', 'is_empty'],
  // ai 值 = 字符串，筛选语义与 text 同路（TASK-T18-04 §0.2）
  ai: ['eq', 'neq', 'contains', 'is_empty'],
};

export interface PropBarProps {
  schema: CollectionSchema;
  views: readonly DbView[];
  activeVid: string;
  onSwitchView: (vid: string) => void;
  /** 整棵筛选树（含递归 and 子组）。 */
  filter: FilterGroup;
  onChangeFilter: (next: FilterGroup) => void;
  sort: DbView['sort'];
  onChangeSort: (next: DbView['sort']) => void;
  /** 当前视图隐藏的字段（视图 `hiddenPids`，老板 10-01 第②项）。 */
  hiddenPids?: readonly string[] | undefined;
  /** 提交新的隐藏集（缺省则不渲染「字段显示」菜单——旧宿主零影响）。 */
  onChangeHidden?: ((next: string[]) => void) | undefined;
  onAddProperty: (type: FieldType) => void;
  /** 属性表头下拉的「重命名/删除」在 DbView 的属性管理区触发；工具条只负责新属性。 */
  onRemoveProperty?: ((pid: string) => void) | undefined;
  onRenameProperty?: ((pid: string, name: string) => void) | undefined;
  /** 改字段类型（title 列不可；值迁移由调用方确认后提交，TASK-T40-01 §B2）。 */
  onChangePropertyType?: ((pid: string, type: FieldType) => void) | undefined;
  /** select/multi_select 选项全量替换（TASK-T40-01 §B3）；缺 id 项（新建）由 main 侧生成。 */
  onUpdatePropertyOptions?:
    | ((pid: string, options: Array<{ id?: string; name: string; tone?: 'neutral' | 'amber' | 'red' }>) => void)
    | undefined;
  /** 字段左右排序：`beforePid=null` = 移到末尾（title 恒首列由 main 侧强制）。 */
  onMoveProperty?: ((pid: string, beforePid: string | null) => void) | undefined;
  /** AI 列「批量生成」入口（仅 ai 列渲染；目标行集由 DbView 按当前视图计算）。 */
  onAiBatchGenerate?: ((pid: string) => void) | undefined;
  /** AI 列「编辑生成指令」提交（仅 ai 列渲染；空串 = 清除配置回落默认指令）。 */
  onUpdateAiPrompt?: ((pid: string, prompt: string) => void) | undefined;
  onCreateRecord: () => void;
  onExportCsv: () => void;
}

/** 把筛选树的直接子句摊平成 chip 列表（子分组内的子句带前缀标记，只读展示）。 */
function flattenClauses(filter: FilterGroup, prefix = ''): Array<{ path: number[]; clause: FilterClause; label: string }> {
  const out: Array<{ path: number[]; clause: FilterClause; label: string }> = [];
  filter.clauses.forEach((node, index) => {
    if ((node as FilterGroup).op === 'and') {
      out.push(...flattenClauses(node as FilterGroup, prefix));
      return;
    }
    out.push({ path: [index], clause: node as FilterClause, label: prefix });
  });
  return out;
}

/** 从筛选树里按索引路径移除一个子句（保持其余结构与顺序）。 */
export function removeClauseAtPath(filter: FilterGroup, path: readonly number[]): FilterGroup {
  const [head, ...rest] = path;
  if (head === undefined) {
    return filter;
  }
  const clauses: Array<FilterClause | FilterGroup> = [];
  filter.clauses.forEach((node, index) => {
    if (index !== head) {
      clauses.push(node);
      return;
    }
    if (rest.length === 0) {
      return; // 命中：丢弃
    }
    if ((node as FilterGroup).op === 'and') {
      clauses.push(removeClauseAtPath(node as FilterGroup, rest));
    } else {
      clauses.push(node);
    }
  });
  return { op: 'and', clauses };
}

/** 追加一个子句（顶层）。 */
export function appendClause(filter: FilterGroup, clause: FilterClause): FilterGroup {
  return normalizeFilter({ op: 'and', clauses: [...filter.clauses, clause] });
}

/** 属性名 → chip 文案（属性已删时回落 pid）。 */
function propertyName(schema: CollectionSchema, pid: string): string {
  return schema.properties[pid]?.name ?? pid;
}

function filterChipText(schema: CollectionSchema, clause: FilterClause): string {
  const name = propertyName(schema, clause.prop);
  const label = FILTER_KIND_LABEL[clause.kind];
  if (clause.kind === 'is_empty') {
    return `${name} ${label}`;
  }
  const property = schema.properties[clause.prop];
  let valueText = String(clause.value ?? '');
  if (property?.type === 'select' && typeof clause.value === 'string') {
    valueText = property.options?.find((option) => option.id === clause.value)?.name ?? clause.value;
  }
  if (property?.type === 'date' && typeof clause.value === 'object' && clause.value !== null) {
    const date = clause.value as { y?: number; m?: number; d?: number };
    valueText = `${String(date.y ?? 0)}-${String(date.m ?? 0).padStart(2, '0')}-${String(date.d ?? 0).padStart(2, '0')}`;
  }
  return `${name} ${label} ${valueText}`;
}

const PROP_MENU_PREFIX = 'propmenu:';
const REMOVE_PROP_PREFIX = 'propmenu-remove:';
const RENAME_PROP_PREFIX = 'propmenu-rename:';
const AI_BATCH_PROP_PREFIX = 'propmenu-ai-batch:';
const AI_PROMPT_PROP_PREFIX = 'propmenu-ai-prompt:';
const TYPE_PROP_PREFIX = 'propmenu-type:';
const OPTIONS_PROP_PREFIX = 'propmenu-options:';
const MOVE_PROP_PREFIX = 'propmenu-move:';

/** 属性菜单可改至的目标类型：全集去掉当前类型；title 列在菜单层整项禁用。 */
function retargetableTypes(current: FieldType): FieldType[] {
  return FIELD_TYPES.filter((type) => type !== current);
}

export function PropBar({
  schema,
  views,
  activeVid,
  onSwitchView,
  filter,
  onChangeFilter,
  sort,
  onChangeSort,
  hiddenPids = [],
  onChangeHidden,
  onAddProperty,
  onRemoveProperty,
  onRenameProperty,
  onChangePropertyType,
  onUpdatePropertyOptions,
  onMoveProperty,
  onAiBatchGenerate,
  onUpdateAiPrompt,
  onCreateRecord,
  onExportCsv,
}: PropBarProps) {
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [propMenuOpen, setPropMenuOpen] = useState(false);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [propManagePid, setPropManagePid] = useState<string | null>(null);
  const [renamePid, setRenamePid] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [promptPid, setPromptPid] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  // 改类型二级菜单 / 选项管理面板（TASK-T40-01 §B2/§B3）
  const [typePid, setTypePid] = useState<string | null>(null);
  const [optionsPid, setOptionsPid] = useState<string | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<Array<{ id?: string; name: string; tone?: 'neutral' | 'amber' | 'red' }>>([]);
  const [optionNewDraft, setOptionNewDraft] = useState('');

  const properties = Object.values(schema.properties);
  const chips = flattenClauses(filter);
  const activeView = views.find((view) => view.vid === activeVid) ?? views[0];

  const viewItems: MenuEntry[] = views.map((view) => ({
    id: view.vid,
    label: view.name,
    hint: view.vid === activeVid ? '当前' : undefined,
  }));

  // 「字段显示」菜单：逐字段开关；**主字段（title_pid）不可隐藏**（与飞书主字段口径一致），
  // 故它压根不进菜单 —— 不给「点了没反应」的假入口。
  const hiddenSet = new Set(hiddenPids);
  const fieldItems: MenuEntry[] = properties
    .filter((property) => property.id !== schema.title_pid)
    .map((property) => ({
      id: property.id,
      label: property.name,
      hint: hiddenSet.has(property.id) ? '已隐藏' : '显示中',
    }));
  const toggleHidden = (pid: string): void => {
    if (onChangeHidden === undefined) {
      return;
    }
    onChangeHidden(hiddenSet.has(pid) ? hiddenPids.filter((x) => x !== pid) : [...hiddenPids, pid]);
  };

  const propItems: MenuEntry[] = NEW_PROPERTY_TYPES.map((type) => ({
    id: type,
    label: FIELD_TYPE_LABEL[type],
  }));

  const filterPropItems: MenuEntry[] = properties.map((property) => ({
    id: property.id,
    label: `${property.name}（${FIELD_TYPE_LABEL[property.type]}）`,
  }));

  const sortPropItems: MenuEntry[] = properties.map((property) => ({
    id: property.id,
    label: property.name,
  }));

  const addFirstClause = (pid: string): void => {
    const property = schema.properties[pid];
    if (property === undefined) {
      return;
    }
    const kind = FILTER_KINDS_BY_TYPE[property.type][0] ?? 'eq';
    // select 默认取第一个选项，其余类型空值（用户可在 chip 上改）
    const value =
      property.type === 'select'
        ? (property.options?.[0]?.id ?? '')
        : property.type === 'number'
          ? 0
          : property.type === 'checkbox'
            ? true
            : '';
    if (kind === 'is_empty') {
      onChangeFilter(appendClause(filter, { prop: pid, kind }));
      return;
    }
    onChangeFilter(appendClause(filter, { prop: pid, kind, value }));
  };

  const addSort = (pid: string): void => {
    const existing = sort.find((key) => key.prop === pid);
    if (existing !== undefined) {
      return;
    }
    onChangeSort(normalizeSort([...sort, { prop: pid, dir: 'asc' }]));
  };

  return (
    <div className="sc-propbar">
      <div className="sc-propbar__group">
        <Button
          variant="secondary"
          size="sm"
          icon={CaretDown}
          onClick={() => {
            setViewMenuOpen((open) => !open);
          }}
          aria-haspopup="menu"
          aria-expanded={viewMenuOpen}
        >
          {activeView?.name ?? '表格'}
        </Button>
        {viewMenuOpen ? (
          <div className="sc-propbar__pop">
            <Menu
              items={viewItems}
              label="视图"
              onSelect={(id) => {
                setViewMenuOpen(false);
                onSwitchView(id);
              }}
              onDismiss={() => {
                setViewMenuOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>

      {onChangeHidden === undefined ? null : (
        <div className="sc-propbar__group">
          <Button
            variant="secondary"
            size="sm"
            icon={CaretDown}
            data-testid="propbar-fields"
            aria-haspopup="menu"
            aria-expanded={fieldMenuOpen}
            onClick={() => {
              setFieldMenuOpen((open) => !open);
            }}
          >
            {`字段 ${String(properties.length - hiddenPids.length)}/${String(properties.length)}`}
          </Button>
          {fieldMenuOpen ? (
            <div className="sc-propbar__pop">
              <Menu
                items={fieldItems}
                label="字段显示"
                /* 开关类菜单**不自动关闭**：连点几个字段不用每次重开（Esc/点外部仍可退） */
                onSelect={(id) => {
                  toggleHidden(id);
                }}
                onDismiss={() => {
                  setFieldMenuOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>
      )}

      {chips.length === 0 ? null : (
        <div className="sc-propbar__group">
          {chips.map((chip) => (
            <span key={`${chip.clause.prop}:${chip.clause.kind}:${JSON.stringify(chip.clause.value)}`} className="sc-chip">
              <Icon icon={CaretDown} size="sm" className="sc-chip__ic" />
              {filterChipText(schema, chip.clause)}
              <button
                type="button"
                className="sc-chip__x"
                aria-label={`移除筛选：${filterChipText(schema, chip.clause)}`}
                onClick={() => {
                  onChangeFilter(removeClauseAtPath(filter, chip.path));
                }}
              >
                <Icon icon={X} size="sm" />
              </button>
            </span>
          ))}
        </div>
      )}

      {sort.length === 0 ? null : (
        <div className="sc-propbar__group">
          {sort.map((key) => (
            <span key={key.prop} className="sc-chip">
              排序：{propertyName(schema, key.prop)}
              <button
                type="button"
                className="sc-chip__x"
                aria-label={`切换排序方向：${propertyName(schema, key.prop)}`}
                onClick={() => {
                  const dir: SortDirection = key.dir === 'asc' ? 'desc' : 'asc';
                  onChangeSort(normalizeSort(sort.map((entry) => (entry.prop === key.prop ? { prop: key.prop, dir } : entry))));
                }}
              >
                {key.dir === 'asc' ? '↑' : '↓'}
              </button>
              <button
                type="button"
                className="sc-chip__x"
                aria-label={`移除排序：${propertyName(schema, key.prop)}`}
                onClick={() => {
                  onChangeSort(normalizeSort(sort.filter((entry) => entry.prop !== key.prop)));
                }}
              >
                <Icon icon={X} size="sm" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="sc-propbar__group">
        <Button
          variant="ghost"
          size="sm"
          icon={CaretDown}
          onClick={() => {
            setFilterMenuOpen((open) => !open);
          }}
          aria-haspopup="menu"
          aria-expanded={filterMenuOpen}
        >
          筛选
        </Button>
        {filterMenuOpen ? (
          <div className="sc-propbar__pop">
            <Menu
              items={filterPropItems}
              label="筛选属性"
              onSelect={(id) => {
                setFilterMenuOpen(false);
                addFirstClause(id);
              }}
              onDismiss={() => {
                setFilterMenuOpen(false);
              }}
            />
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon={CaretDown}
          onClick={() => {
            setSortMenuOpen((open) => !open);
          }}
          aria-haspopup="menu"
          aria-expanded={sortMenuOpen}
        >
          排序
        </Button>
        {sortMenuOpen ? (
          <div className="sc-propbar__pop">
            <Menu
              items={sortPropItems}
              label="排序属性"
              onSelect={(id) => {
                setSortMenuOpen(false);
                addSort(id);
              }}
              onDismiss={() => {
                setSortMenuOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="sc-propbar__group">
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={() => {
            setPropMenuOpen((open) => !open);
          }}
          aria-haspopup="menu"
          aria-expanded={propMenuOpen}
        >
          新属性
        </Button>
        {propMenuOpen ? (
          <div className="sc-propbar__pop">
            <Menu
              items={propItems}
              label="新属性类型"
              onSelect={(id) => {
                setPropMenuOpen(false);
                if ((NEW_PROPERTY_TYPES as readonly string[]).includes(id)) {
                  onAddProperty(id as FieldType);
                }
              }}
              onDismiss={() => {
                setPropMenuOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="sc-propbar__group sc-propbar__group--props">
        {properties.map((property, propIndex) => (
          <span key={property.id} className="sc-propbar__propwrap">
            <button
              type="button"
              id={`${PROP_MENU_PREFIX}${property.id}`}
              className="sc-chip sc-chip--prop"
              aria-label={`属性管理：${property.name}`}
              aria-haspopup="menu"
              aria-expanded={propManagePid === property.id}
              onClick={() => {
                setPropManagePid((current) => (current === property.id ? null : property.id));
              }}
            >
              {property.name}
              <span className="sc-chip__type">{property.type}</span>
            </button>
            {propManagePid === property.id ? (
              <div className="sc-propbar__pop">
                <Menu
                  items={[
                    {
                      id: `${TYPE_PROP_PREFIX}${property.id}`,
                      label: '更改类型…',
                      disabled:
                        property.id === schema.title_pid ||
                        onChangePropertyType === undefined,
                    },
                    ...(property.type === 'select' || property.type === 'multi_select'
                      ? [
                          {
                            id: `${OPTIONS_PROP_PREFIX}${property.id}`,
                            label: '选项管理…',
                            disabled: onUpdatePropertyOptions === undefined,
                          },
                        ]
                      : []),
                    ...(onMoveProperty !== undefined
                      ? [
                          {
                            id: `${MOVE_PROP_PREFIX}left:${property.id}`,
                            label: '左移',
                            disabled: propIndex < 2, // 首列是标题；第一数据列不能插到标题前
                          },
                          {
                            id: `${MOVE_PROP_PREFIX}right:${property.id}`,
                            label: '右移',
                            disabled: propIndex >= properties.length - 1,
                          },
                        ]
                      : []),
                    { id: `${RENAME_PROP_PREFIX}${property.id}`, label: '重命名属性' },
                    ...(property.type === 'ai' && onAiBatchGenerate !== undefined
                      ? [{ id: `${AI_BATCH_PROP_PREFIX}${property.id}`, label: '批量生成' }]
                      : []),
                    ...(property.type === 'ai' && onUpdateAiPrompt !== undefined
                      ? [{ id: `${AI_PROMPT_PROP_PREFIX}${property.id}`, label: '编辑生成指令' }]
                      : []),
                    {
                      id: `${REMOVE_PROP_PREFIX}${property.id}`,
                      label: '删除属性',
                      danger: true,
                      disabled: property.id === schema.title_pid || properties.length <= 1,
                    },
                  ]}
                  label="属性管理"
                  onSelect={(id) => {
                    setPropManagePid(null);
                    if (id.startsWith(TYPE_PROP_PREFIX)) {
                      setTypePid(property.id);
                      return;
                    }
                    if (id.startsWith(OPTIONS_PROP_PREFIX)) {
                      setOptionsPid(property.id);
                      setOptionsDraft(
                        (property.options ?? []).map((option) => ({
                          id: option.id,
                          name: option.name,
                          ...(option.tone !== undefined ? { tone: option.tone } : {}),
                        })),
                      );
                      setOptionNewDraft('');
                      return;
                    }
                    if (id.startsWith(`${MOVE_PROP_PREFIX}left:`)) {
                      // 左移一格：插到「前一个属性」之前（前两个元素被跳过 → beforePid = i-2）
                      const before = properties[propIndex - 2];
                      onMoveProperty?.(property.id, before === undefined ? null : before.id);
                      return;
                    }
                    if (id.startsWith(`${MOVE_PROP_PREFIX}right:`)) {
                      // 右移一格：插到「后一个属性」之后（= 后第二个之前；末尾用 null）
                      const before = properties[propIndex + 2];
                      onMoveProperty?.(property.id, before === undefined ? null : before.id);
                      return;
                    }
                    if (id.startsWith(RENAME_PROP_PREFIX)) {
                      setRenamePid(property.id);
                      setRenameDraft(property.name);
                      return;
                    }
                    if (id.startsWith(AI_BATCH_PROP_PREFIX)) {
                      // 目标行集（当前视图前 ≤20 行）由 DbView 计算；PropBar 只上报 pid
                      onAiBatchGenerate?.(property.id);
                      return;
                    }
                    if (id.startsWith(AI_PROMPT_PROP_PREFIX)) {
                      setPromptPid(property.id);
                      setPromptDraft(property.ai?.prompt ?? '');
                      return;
                    }
                    if (id.startsWith(REMOVE_PROP_PREFIX)) {
                      onRemoveProperty?.(property.id);
                    }
                  }}
                  onDismiss={() => {
                    setPropManagePid(null);
                  }}
                />
              </div>
            ) : null}
          </span>
        ))}
      </div>

      {renamePid === null ? null : (
        <div className="sc-propbar__rename">
          <input
            autoFocus
            className="sc-dbc-input"
            value={renameDraft}
            aria-label="属性名"
            onChange={(event) => {
              setRenameDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onRenameProperty?.(renamePid, renameDraft);
                setRenamePid(null);
              }
              if (event.key === 'Escape') {
                setRenamePid(null);
              }
            }}
            onBlur={() => {
              setRenamePid(null);
            }}
          />
        </div>
      )}

      {promptPid === null ? null : (
        <div className="sc-propbar__rename">
          <textarea
            autoFocus
            className="sc-dbc-input sc-propbar__prompt"
            value={promptDraft}
            rows={3}
            aria-label="生成指令"
            placeholder="例如：用一句话概括本行内容"
            onChange={(event) => {
              setPromptDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onUpdateAiPrompt?.(promptPid, promptDraft);
                setPromptPid(null);
              }
              if (event.key === 'Escape') {
                setPromptPid(null);
              }
            }}
          />
          <p className="sc-propbar__prompt-hint">Enter 保存 · 留空则使用默认指令</p>
        </div>
      )}

      {typePid === null ? null : (
        <div className="sc-propbar__pop sc-propbar__pop--type">
          <Menu
            items={retargetableTypes(schema.properties[typePid]?.type ?? 'text').map((type) => ({
              id: type,
              label: `${FIELD_TYPE_LABEL[type]}（${type}）`,
            }))}
            label="更改类型为"
            onSelect={(id) => {
              const pid = typePid;
              setTypePid(null);
              if (pid !== null && isFieldType(id)) {
                onChangePropertyType?.(pid, id);
              }
            }}
            onDismiss={() => {
              setTypePid(null);
            }}
          />
          <p className="sc-propbar__prompt-hint">
            不兼容的值将原样保留（不显示、不丢失），改回原类型即可恢复。
          </p>
        </div>
      )}

      {optionsPid === null || schema.properties[optionsPid] === undefined ? null : (
        <div className="sc-propbar__options" role="form" aria-label="选项管理">
          <p className="sc-propbar__options-title">选项管理（{schema.properties[optionsPid]?.name}）</p>
          <ul className="sc-propbar__options-list">
            {optionsDraft.map((option, index) => (
              <li key={option.id ?? `new-${String(index)}`} className="sc-propbar__options-row">
                <input
                  className="sc-dbc-input sc-propbar__options-name"
                  value={option.name}
                  aria-label={`选项 ${String(index + 1)} 名称`}
                  onChange={(event) => {
                    setOptionsDraft((current) =>
                      current.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)),
                    );
                  }}
                />
                <button
                  type="button"
                  className="sc-propbar__options-remove"
                  aria-label={`删除选项：${option.name}`}
                  onClick={() => {
                    setOptionsDraft((current) => current.filter((_entry, i) => i !== index));
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="sc-propbar__options-row">
            <input
              className="sc-dbc-input sc-propbar__options-name"
              value={optionNewDraft}
              placeholder="新选项名称…"
              aria-label="新选项名称"
              onChange={(event) => {
                setOptionNewDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const name = optionNewDraft.trim();
                  if (name.length === 0) {
                    return;
                  }
                  setOptionsDraft((current) => [...current, { name }]);
                  setOptionNewDraft('');
                }
              }}
            />
            <button
              type="button"
              className="sc-propbar__options-add"
              onClick={() => {
                const name = optionNewDraft.trim();
                if (name.length === 0) {
                  return;
                }
                setOptionsDraft((current) => [...current, { name }]);
                setOptionNewDraft('');
              }}
            >
              添加
            </button>
          </div>
          <div className="sc-propbar__options-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const pid = optionsPid;
                setOptionsPid(null);
                if (pid === null) {
                  return;
                }
                onUpdatePropertyOptions?.(
                  pid,
                  optionsDraft.map((entry) => ({
                    ...(entry.id !== undefined ? { id: entry.id } : {}),
                    name: entry.name,
                    ...(entry.tone !== undefined ? { tone: entry.tone } : {}),
                  })),
                );
              }}
            >
              保存
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOptionsPid(null);
              }}
            >
              取消
            </Button>
          </div>
        </div>
      )}

      <div className="sc-propbar__spacer" />

      <div className="sc-propbar__group">
        <Button variant="ghost" size="sm" onClick={onExportCsv}>
          导出 CSV
        </Button>
        <Button variant="secondary" size="sm" icon={Plus} onClick={onCreateRecord}>
          新建记录
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 小工具：供测试直接断言，不参与渲染
// ---------------------------------------------------------------------------

/** 可用算子列表（按属性类型）。 */
export function filterKindsFor(property: Property): readonly FilterKind[] {
  return FILTER_KINDS_BY_TYPE[property.type];
}

/** 全部算子（用于断言白名单完备）。 */
export const ALL_FILTER_KINDS: readonly FilterKind[] = FILTER_KINDS;

/** 属性名 → 类型标签（视图标题栏展示用）。 */
export function fieldTypeLabel(type: FieldType): string {
  return FIELD_TYPE_LABEL[type];
}

/** 样式类名拼接的小工具（PropBar 之外复用）。 */
export function propbarClasses(extra?: string): string {
  return clsx('sc-propbar', extra);
}
