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
  FILTER_KINDS,
  NEW_PROPERTY_TYPES,
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
  onAddProperty: (type: FieldType) => void;
  /** 属性表头下拉的「重命名/删除」在 DbView 的属性管理区触发；工具条只负责新属性。 */
  onRemoveProperty?: ((pid: string) => void) | undefined;
  onRenameProperty?: ((pid: string, name: string) => void) | undefined;
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

export function PropBar({
  schema,
  views,
  activeVid,
  onSwitchView,
  filter,
  onChangeFilter,
  sort,
  onChangeSort,
  onAddProperty,
  onRemoveProperty,
  onRenameProperty,
  onAiBatchGenerate,
  onUpdateAiPrompt,
  onCreateRecord,
  onExportCsv,
}: PropBarProps) {
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [propMenuOpen, setPropMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [propManagePid, setPropManagePid] = useState<string | null>(null);
  const [renamePid, setRenamePid] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [promptPid, setPromptPid] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState('');

  const properties = Object.values(schema.properties);
  const chips = flattenClauses(filter);
  const activeView = views.find((view) => view.vid === activeVid) ?? views[0];

  const viewItems: MenuEntry[] = views.map((view) => ({
    id: view.vid,
    label: view.name,
    hint: view.vid === activeVid ? '当前' : undefined,
  }));

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
        {properties.map((property) => (
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
