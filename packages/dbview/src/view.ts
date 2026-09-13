/**
 * view.ts —— 视图引擎（纯函数，重测区；TASK-T7-01 §1/§3）。
 *
 * 提供 `applyFilter` / `applySort` / `aggregate` / `groupBySelect`，
 * 以及 filter/sort 的**序列化与规范化**（保证可进 `Op.payload`：filter 树与
 * sort 数组都是普通 JSON 对象/数组，无 Date、无函数、无 Map）。
 *
 * 语义口径（与 §3 关键语义测试一一对应）：
 * - `neq` 恒为 `eq` 的逻辑补集（故「补集 = 取反 filter」断言在两个方向上成立）；
 * - `is_empty` 覆盖「缺键 / null / 空串 / 空数组」四种形态；
 * - 日期空值恒排最后（不随方向翻转），其余同值时按 `sort_key` 稳定决胜；
 * - `select` 排序按属性 `options` 的声明顺序（未在 options 内的 id 排最后）。
 *
 * 纪律：零 React、零 IO；排序不修改入参（先拷贝）。
 */
import {
  FILTER_KINDS,
  propertyList,
  type CollectionSchema,
  type DbView,
  type FilterClause,
  type FilterGroup,
  type FilterKind,
  type Property,
  type RecordEntity,
  type RecordValues,
  type SortKey,
} from './types';
import { dateValueSchema, type DateValue } from './types';
import { isEmptyValue } from './values';

// ---------------------------------------------------------------------------
// 筛选
// ---------------------------------------------------------------------------

/** 取某记录某属性的值（缺键 → undefined）。参数只依赖 values，故用 Pick 放宽调用面。 */
export function valueOf(record: Pick<RecordEntity, 'values'>, pid: string): unknown {
  return record.values[pid];
}

/** 数值化：仅有限数字有值。 */
function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 日期化：合法 `{y,m,d,tz?}` 才有值。 */
function dateOf(value: unknown): DateValue | null {
  const parsed = dateValueSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 字符串化：字符串原样，数字/布尔转文本；数组/对象 → null（不可比）。 */
function textOf(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

/** 数组化：数组原样，标量 → 单元素数组，null/undefined → 空数组。 */
function idsOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [String(value)];
}

/**
 * 单子句判定。
 *
 * `kind` 语义分派：
 * - `is_empty` 独立分支（不看 value）；
 * - `eq` 按类型分派：select/multi/relation 看「集合命中」，number/date/text 看直接相等；
 * - `neq` = `eq` 的逻辑补集；
 * - `contains`：文本/URL/邮箱子串；select/multi/relation 任一 id 命中；数组 → 元素子串；
 * - `gt/lt`：number 数值、date 时间序、text/url/email 字典序；
 * - `before/after`：仅 date（`before` = `<`，`after` = `>`）；日期不合法 → false。
 */
export function matchesClause(record: RecordEntity, clause: FilterClause): boolean {
  const raw = valueOf(record, clause.prop);
  const kind: FilterKind = clause.kind;

  if (kind === 'is_empty') {
    return isEmptyValue(raw);
  }

  const target = clause.value;

  switch (kind) {
    case 'eq':
    case 'neq': {
      const equal = equalsValue(raw, target);
      return kind === 'eq' ? equal : !equal;
    }
    case 'contains': {
      if (typeof target !== 'string' || target.length === 0) {
        return false;
      }
      if (Array.isArray(raw)) {
        return raw.some((item) => String(item).includes(target));
      }
      // select/multi 传的是选项 id；直接按 id 命中判定（原始值是 id 或 id[]）
      const text = textOf(raw);
      return text === null ? false : text.includes(target);
    }
    case 'gt':
    case 'lt': {
      const order = compareRaw(raw, target);
      if (order === null) {
        return false;
      }
      return kind === 'gt' ? order > 0 : order < 0;
    }
    case 'before':
    case 'after': {
      const left = dateOf(raw);
      const right = dateOf(target);
      if (left === null || right === null) {
        return false;
      }
      const order = compareDate(left, right);
      return kind === 'before' ? order < 0 : order > 0;
    }
    default:
      return false;
  }
}

/**
 * `eq` 的类型无感实现：值形态决定比较方式。
 * - 数组值（multi/relation）：目标字符串 ∈ 数组 → 命中（缺目标 → 数组为空才算命中）；
 * - 数字值：目标必须也是数字；
 * - 布尔值：严格相等；
 * - 日期值：目标也是合法日期时按三元组相等；
 * - 其余（含字符串）：按文本相等（目标非字符串 → 转文本比较）。
 */
function equalsValue(raw: unknown, target: unknown): boolean {
  if (Array.isArray(raw)) {
    if (target === undefined || target === null) {
      return raw.length === 0;
    }
    return idsOf(raw).includes(String(target));
  }
  if (isEmptyValue(raw)) {
    return target === undefined || target === null || target === '';
  }
  if (typeof raw === 'number') {
    return numberOf(target) === raw;
  }
  if (typeof raw === 'boolean') {
    return target === raw;
  }
  const date = dateOf(raw);
  if (date !== null) {
    const other = dateOf(target);
    return other !== null && compareDate(date, other) === 0;
  }
  const text = textOf(raw);
  const otherText = textOf(target);
  return text !== null && otherText !== null && text === otherText;
}

/** 通用序比较：数字按数值、日期按时间序、其余按文本字典序；不可比 → null。 */
function compareRaw(raw: unknown, target: unknown): number | null {
  const leftNum = numberOf(raw);
  const rightNum = numberOf(target);
  if (leftNum !== null && rightNum !== null) {
    if (leftNum === rightNum) {
      return 0;
    }
    return leftNum < rightNum ? -1 : 1;
  }
  const leftDate = dateOf(raw);
  const rightDate = dateOf(target);
  if (leftDate !== null && rightDate !== null) {
    return compareDate(leftDate, rightDate);
  }
  const leftText = textOf(raw);
  const rightText = textOf(target);
  if (leftText !== null && rightText !== null) {
    if (leftText === rightText) {
      return 0;
    }
    return leftText < rightText ? -1 : 1;
  }
  return null;
}

/** 日期三元组比较（含 w 的日期为空值则应先被 isEmptyValue 拦截）。 */
export function compareDate(a: DateValue, b: DateValue): number {
  if (a.y !== b.y) {
    return a.y < b.y ? -1 : 1;
  }
  if (a.m !== b.m) {
    return a.m < b.m ? -1 : 1;
  }
  if (a.d !== b.d) {
    return a.d < b.d ? -1 : 1;
  }
  return 0;
}

/** 完整筛选树判定（`and` 递归；空 clauses 恒真）。 */
export function matchesFilter(record: RecordEntity, filter: FilterGroup): boolean {
  for (const node of filter.clauses) {
    if ((node as FilterGroup).op === 'and') {
      if (!matchesFilter(record, node as FilterGroup)) {
        return false;
      }
      continue;
    }
    if (!matchesClause(record, node as FilterClause)) {
      return false;
    }
  }
  return true;
}

/** 应用筛选（空 filter → 同入参的浅拷贝，保持纯函数契约）。 */
export function applyFilter(rows: readonly RecordEntity[], filter: FilterGroup): RecordEntity[] {
  if (filter.clauses.length === 0) {
    return [...rows];
  }
  return rows.filter((row) => matchesFilter(row, filter));
}

// ---------------------------------------------------------------------------
// 排序
// ---------------------------------------------------------------------------

/** 稳定决胜键（同值时保持 sort_key 序；再同则 id 序）。 */
export function compareSortKey(a: RecordEntity, b: RecordEntity): number {
  if (a.sort_key !== b.sort_key) {
    return a.sort_key < b.sort_key ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/** select/multi 的选项序号（未在 options 内 → 排最后）。 */
function optionIndex(property: Property, id: string): number {
  const index = property.options?.findIndex((option) => option.id === id) ?? -1;
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * 单属性比较（升序语义）。
 * - 空值恒为「最大」（排最后，实现里由调用方做方向无关处理）；
 * - select：按 options 声明顺序；multi_select：取命中选项的最小序号；
 * - date：三元组；number：数值；relation：目标 id 文本；file：文件名连接；
 * - 其余：显示文本字典序。
 */
function compareProperty(property: Property, a: RecordEntity, b: RecordEntity): number {
  const left = valueOf(a, property.id);
  const right = valueOf(b, property.id);

  switch (property.type) {
    case 'number': {
      const l = numberOf(left);
      const r = numberOf(right);
      if (l === null || r === null) {
        return 0; // 空值由外层统一排最后
      }
      return l === r ? 0 : l < r ? -1 : 1;
    }
    case 'date': {
      const l = dateOf(left);
      const r = dateOf(right);
      if (l === null || r === null) {
        return 0;
      }
      return compareDate(l, r);
    }
    case 'checkbox': {
      const l = left === true ? 1 : 0;
      const r = right === true ? 1 : 0;
      return l === r ? 0 : l < r ? -1 : 1;
    }
    case 'select': {
      const l = optionIndex(property, String(left));
      const r = optionIndex(property, String(right));
      return l === r ? 0 : l < r ? -1 : 1;
    }
    case 'multi_select': {
      const l = Math.min(...idsOf(left).map((id) => optionIndex(property, id)), Number.MAX_SAFE_INTEGER);
      const r = Math.min(...idsOf(right).map((id) => optionIndex(property, id)), Number.MAX_SAFE_INTEGER);
      return l === r ? 0 : l < r ? -1 : 1;
    }
    default: {
      const l = Array.isArray(left) ? idsOf(left).join('\u0000') : (textOf(left) ?? '');
      const r = Array.isArray(right) ? idsOf(right).join('\u0000') : (textOf(right) ?? '');
      if (l === r) {
        return 0;
      }
      return l < r ? -1 : 1;
    }
  }
}

/**
 * 多键排序：先按 `sort` 里的键序，全部相等时按 sort_key（稳定）。
 * **空值恒排最后**：不论 asc/desc，空值都不参与方向翻转。
 */
export function applySort(
  rows: readonly RecordEntity[],
  sort: readonly SortKey[],
  schema: CollectionSchema,
): RecordEntity[] {
  const out = [...rows];
  if (sort.length === 0) {
    out.sort(compareSortKey);
    return out;
  }
  out.sort((a, b) => {
    for (const key of sort) {
      const property = schema.properties[key.prop];
      if (property === undefined) {
        continue;
      }
      const leftEmpty = isEmptyValue(valueOf(a, property.id));
      const rightEmpty = isEmptyValue(valueOf(b, property.id));
      if (leftEmpty || rightEmpty) {
        if (leftEmpty && rightEmpty) {
          continue;
        }
        return leftEmpty ? 1 : -1; // 空值永远在后
      }
      const order = compareProperty(property, a, b);
      if (order !== 0) {
        return key.dir === 'asc' ? order : -order;
      }
    }
    return compareSortKey(a, b);
  });
  return out;
}

// ---------------------------------------------------------------------------
// 计算行（聚合）
// ---------------------------------------------------------------------------

export const AGGREGATIONS = ['none', 'count', 'sum', 'avg', 'earliest', 'latest'] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

/** 某属性类型可用的聚合集（数字：计数/求和/平均；日期：计数/最早/最晚；其余只有计数）。 */
export function availableAggregations(type: Property['type']): Aggregation[] {
  if (type === 'number') {
    return ['count', 'sum', 'avg'];
  }
  if (type === 'date') {
    return ['count', 'earliest', 'latest'];
  }
  return ['count'];
}

export interface AggregateResult {
  kind: Aggregation;
  /** 人类可读结果（空集 → 「—」）。 */
  text: string;
  /** 数值结果（sum/avg/count 有值；earliest/latest/none 为 null）。 */
  value: number | null;
}

const AGGREGATION_LABEL: Readonly<Record<Aggregation, string>> = {
  none: '',
  count: '计数',
  sum: '求和',
  avg: '平均',
  earliest: '最早',
  latest: '最晚',
};

export function aggregationLabel(kind: Aggregation): string {
  return AGGREGATION_LABEL[kind];
}

/**
 * 对某属性做聚合。非空值才参与计算；结果文本与数值同源（不会出现「显示 3.67 但 value=null」）。
 */
export function aggregate(
  rows: readonly RecordEntity[],
  property: Property | undefined,
  kind: Aggregation,
): AggregateResult {
  if (kind === 'none' || property === undefined) {
    return { kind: 'none', text: '', value: null };
  }
  if (kind === 'count') {
    return { kind, text: String(rows.length), value: rows.length };
  }

  if (property.type === 'number') {
    const numbers = rows
      .map((row) => numberOf(valueOf(row, property.id)))
      .filter((value): value is number => value !== null);
    if (numbers.length === 0) {
      return { kind, text: '—', value: null };
    }
    const total = numbers.reduce((sum, value) => sum + value, 0);
    if (kind === 'sum') {
      return { kind, text: formatNumber(total), value: total };
    }
    const average = total / numbers.length;
    return { kind, text: formatNumber(average), value: average };
  }

  if (property.type === 'date') {
    const dates = rows
      .map((row) => dateOf(valueOf(row, property.id)))
      .filter((value): value is DateValue => value !== null);
    if (dates.length === 0) {
      return { kind, text: '—', value: null };
    }
    const extreme = dates.reduce((best, current) => {
      const order = compareDate(current, best);
      if (kind === 'earliest') {
        return order < 0 ? current : best;
      }
      return order > 0 ? current : best;
    });
    return { kind, text: formatDateText(extreme), value: null };
  }

  return { kind, text: '—', value: null };
}

/** 数字显示：整数原样，小数保留两位（03 mockup：3.67）。 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateText(value: DateValue): string {
  return `${String(value.y).padStart(4, '0')}-${pad2(value.m)}-${pad2(value.d)}`;
}

// ---------------------------------------------------------------------------
// 分组（二期预留）
// ---------------------------------------------------------------------------

/**
 * 按 select 属性分组 —— 二期（看板视图）预留，一期**不实现**：
 * 恒返回 `undefined`，调用方据此隐藏分组入口（见报告 DEVIATIONS）。
 */
export function groupBySelect(
  _rows: readonly RecordEntity[],
  _property: Property | undefined,
): undefined {
  return undefined;
}

// ---------------------------------------------------------------------------
// 序列化 / 规范化（进 Op.payload 前的收口）
// ---------------------------------------------------------------------------

const FILTER_KIND_SET: ReadonlySet<string> = new Set<string>(FILTER_KINDS);

/** filter 树规范化：丢弃未知算子/空 prop；子分组递归；产物是纯 JSON。 */
export function normalizeFilter(filter: unknown): FilterGroup {
  if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
    return { op: 'and', clauses: [] };
  }
  const candidate = filter as { op?: unknown; clauses?: unknown };
  if (candidate.op !== 'and' || !Array.isArray(candidate.clauses)) {
    return { op: 'and', clauses: [] };
  }
  const clauses: Array<FilterClause | FilterGroup> = [];
  for (const node of candidate.clauses) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      continue;
    }
    const entry = node as { op?: unknown };
    if (entry.op === 'and') {
      clauses.push(normalizeFilter(node));
      continue;
    }
    const clause = node as { prop?: unknown; kind?: unknown; value?: unknown };
    if (typeof clause.prop !== 'string' || clause.prop.length === 0) {
      continue;
    }
    if (typeof clause.kind !== 'string' || !FILTER_KIND_SET.has(clause.kind)) {
      continue;
    }
    const normalized: FilterClause = {
      prop: clause.prop,
      kind: clause.kind as FilterKind,
    };
    if (clause.value !== undefined) {
      normalized.value = clause.value;
    }
    clauses.push(normalized);
  }
  return { op: 'and', clauses };
}

/** sort 规范化：丢弃未知 dir / 空 prop / 重复 prop（保留首次出现）。 */
export function normalizeSort(sort: unknown): SortKey[] {
  if (!Array.isArray(sort)) {
    return [];
  }
  const seen = new Set<string>();
  const out: SortKey[] = [];
  for (const entry of sort) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as { prop?: unknown; dir?: unknown };
    if (typeof candidate.prop !== 'string' || candidate.prop.length === 0) {
      continue;
    }
    if (seen.has(candidate.prop)) {
      continue;
    }
    seen.add(candidate.prop);
    out.push({ prop: candidate.prop, dir: candidate.dir === 'desc' ? 'desc' : 'asc' });
  }
  return out;
}

/** 视图规范化：filter/sort 过一遍、widths 只保留正有限数。 */
export function normalizeView(view: DbView): DbView {
  const widths: Record<string, number> = {};
  for (const [pid, width] of Object.entries(view.widths)) {
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
      widths[pid] = Math.round(width);
    }
  }
  const filter = normalizeFilter(view.filter);
  const sort = normalizeSort(view.sort);
  return {
    vid: view.vid,
    name: view.name,
    type: view.type,
    filter,
    sort,
    widths,
  };
}

// ---------------------------------------------------------------------------
// 组合入口（渲染层一次调用完成 筛选 → 排序）
// ---------------------------------------------------------------------------

export interface ApplyViewOptions {
  /** 是否套用视图筛选（缺省 true）。 */
  filter?: boolean;
  /** 是否套用视图排序（缺省 true）。 */
  sort?: boolean;
}

/** 对一批记录应用视图：先筛选后排序。 */
export function applyView(
  rows: readonly RecordEntity[],
  view: Pick<DbView, 'filter' | 'sort'>,
  schema: CollectionSchema,
  options: ApplyViewOptions = {},
): RecordEntity[] {
  const filtered = options.filter === false ? [...rows] : applyFilter(rows, view.filter);
  const sorted = options.sort === false ? filtered : applySort(filtered, view.sort, schema);
  return sorted;
}

/** 视图里引用的属性是否仍存在（属性删除后用于提示「筛选/排序引用了已删属性」）。 */
export function danglingReferences(view: DbView, schema: CollectionSchema): string[] {
  const known = new Set(propertyList(schema).map((property) => property.id));
  const dangling = new Set<string>();
  const walk = (group: FilterGroup): void => {
    for (const node of group.clauses) {
      if ((node as FilterGroup).op === 'and') {
        walk(node as FilterGroup);
        continue;
      }
      const prop = (node as FilterClause).prop;
      if (!known.has(prop)) {
        dangling.add(prop);
      }
    }
  };
  walk(view.filter);
  for (const key of view.sort) {
    if (!known.has(key.prop)) {
      dangling.add(key.prop);
    }
  }
  return [...dangling];
}

// ---------------------------------------------------------------------------
// 关系双写计划（纯函数；apps 层据此在同一 batch 内写主记录 + 对方 backlink）
// ---------------------------------------------------------------------------

/** 单条记录的字段级补丁（值表键 → 新值；`null` = 清空该字段）。 */
export interface RecordPatch {
  recordId: string;
  values: RecordValues;
  /** `null` = 清空 backlink 索引（两侧都空时用于删除键）。 */
  backlinks: Record<string, string[]> | null;
}

export interface RelationWritePlan {
  /** 主记录补丁（relation 值变更）。 */
  main: RecordPatch;
  /** 对方记录补丁（backlink 索引增删）；可能为空。 */
  related: RecordPatch[];
}

/**
 * 计算 relation 字段改动的**双写计划**（TASK-T7-01 §2「relation 字段值改动要同步写
 * 对方 record 的 backlink 数组，双 op，一个 batch，原子」的纯函数核心）。
 *
 * 语义：
 * - 主记录：`values[pid] = nextIds`（空数组 → `null`，与值语义一致）；
 * - 对方：对每个**新增**目标，在其 `backlinks[本记录所属 collection]` 里加入本记录 id；
 *   对每个**移除**目标，移出该 id（数组变空则删除该键）；
 * - 只处理 `type === 'relation'` 的属性；非 relation 属性返回「只有主记录」的计划；
 * - 幂等：新值等于旧值时 `related` 为空、`main` 仍是同值补丁（调用方可据此跳过写）。
 */
export function relationWritePlan(
  schema: CollectionSchema,
  record: Pick<RecordEntity, 'id' | 'collection_id' | 'values' | 'backlinks'>,
  pid: string,
  next: unknown,
): RelationWritePlan {
  const property = schema.properties[pid];

  // 非 relation 属性：无任何反向链接副作用，主记录原样写值即可。
  // 必须在此早退 —— 下面 relation 分支会把值按 id 数组归一，文本/数字会被清成 null。
  if (property?.type !== 'relation') {
    const passthroughValues: RecordValues = { ...record.values };
    passthroughValues[pid] = next === undefined ? null : next;
    return {
      main: { recordId: record.id, values: passthroughValues, backlinks: null },
      related: [],
    };
  }

  const current = valueOf(record, pid);
  const currentIds = idsOf(current).filter((id) => id.length > 0);
  const nextIds = idsOf(next).filter((id) => id.length > 0);

  const mainValues: RecordValues = { ...record.values };
  mainValues[pid] = nextIds.length === 0 ? null : nextIds;

  const main: RecordPatch = {
    recordId: record.id,
    values: mainValues,
    backlinks: null,
  };

  const added = nextIds.filter((id) => !currentIds.includes(id));
  const removed = currentIds.filter((id) => !nextIds.includes(id));
  const related: RecordPatch[] = [];
  for (const targetId of added) {
    const backlinks = { ...(record.backlinks ?? {}) };
    const list = backlinks[record.collection_id] ?? [];
    if (!list.includes(record.id)) {
      backlinks[record.collection_id] = [...list, record.id];
    }
    related.push({ recordId: targetId, values: {}, backlinks });
  }
  for (const targetId of removed) {
    const backlinks = { ...(record.backlinks ?? {}) };
    const list = (backlinks[record.collection_id] ?? []).filter((id) => id !== record.id);
    if (list.length === 0) {
      delete backlinks[record.collection_id];
    } else {
      backlinks[record.collection_id] = list;
    }
    related.push({ recordId: targetId, values: {}, backlinks });
  }
  return { main, related };
}
