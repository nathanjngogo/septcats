/**
 * types.ts —— 行内数据库的实体形状与 zod 契约（TASK-T7-01 §1）。
 *
 * 字段表严格照 `docs/schema-v1.md` §4：
 * - collection：`page_id?`、`name`、`schema:{ properties:{pid:{name,type,options?,format?}}, title_pid }`、
 *   `views:[{vid,name,type:'table',filter,sort,widths}]`；
 * - record：`collection_id`、`values:{pid: 值}`、`sort_key`。
 *
 * 值类型白名单（schema-v1 §4 record 行 + §3 属性类型延伸）：
 * `text number select multi_select date checkbox url email relation file`。
 * 每个值的 JSON 形态与 §4 逐字对应（date = `{y,m,d,tz?}`；select = 选项 id；
 * multi_select = 选项 id[]；relation = 目标 record id[]；file = 文件名数组）。
 *
 * 纪律：本文件**零 React**、零 IO；所有 schema 产物都是 JSON 安全的普通对象，
 * 可直接进 `Op.payload`（见 `view.ts` 的 filter/sort 序列化说明）。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 属性类型
// ---------------------------------------------------------------------------

/**
 * 属性类型白名单。`email` 是 `text` 的语义细分；`file` 一期只显示文件名；
 * `ai` 是手动触发的模型生成列（TASK-T18-04 §2.1）：值 = 纯字符串（与 `text`
 * 同构，复用 text 的值路径/CSV/聚合/同步投影），生成元数据不写入值。
 */
export const FIELD_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'email',
  'relation',
  'file',
  'ai',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const FIELD_TYPE_SET: ReadonlySet<string> = new Set<string>(FIELD_TYPES);

export function isFieldType(value: string): value is FieldType {
  return FIELD_TYPE_SET.has(value);
}

/** 新属性菜单里的 9 种（`email`/`file` 从该菜单收起，避免一屏过挤；TASK-T18-04 增 `ai`）。 */
export const NEW_PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'relation',
  'ai',
] as const satisfies readonly FieldType[];

// ---------------------------------------------------------------------------
// select 选项 / 日期
// ---------------------------------------------------------------------------

export const OPTION_TONES = ['neutral', 'amber', 'red'] as const;
export type OptionTone = (typeof OPTION_TONES)[number];

/** select 选项。`tone` 是三语义色（03 mockup：在读=amber、弃读=danger、其余中性）。 */
export const propertyOptionSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string(),
  tone: z.enum(OPTION_TONES).optional(),
});
export type PropertyOption = z.infer<typeof propertyOptionSchema>;

/** 日期值：`{y,m,d,tz?}`（§4）。不存 Date 对象，保证 JSON 往返恒等。 */
export const dateValueSchema = z
  .object({
    y: z.number().int().min(1).max(9999),
    m: z.number().int().min(1).max(12),
    d: z.number().int().min(1).max(31),
    tz: z.string().optional(),
  })
  // 日历真实性：2月30日、闰年 2月29日 之类必须在 JS Date 往返后不变，
  // 否则会被 SQLite/显示层静默修正成别的日期，比拒绝更难查。
  .refine(
    (value) => {
      const probe = new Date(Date.UTC(value.y, value.m - 1, value.d));
      return (
        probe.getUTCFullYear() === value.y &&
        probe.getUTCMonth() === value.m - 1 &&
        probe.getUTCDate() === value.d
      );
    },
    { message: '非法日历日期' },
  );
export type DateValue = z.infer<typeof dateValueSchema>;

// ---------------------------------------------------------------------------
// 属性 schema
// ---------------------------------------------------------------------------

/**
 * 单个属性定义。`options` 仅 select/multi_select 有；`format` 留给数字/日期的显示格式
 * （一期只存不解释，渲染层按 token 默认格式显示）。
 */
export const propertySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string(),
  type: z.enum(FIELD_TYPES),
  options: z.array(propertyOptionSchema).optional(),
  format: z.string().optional(),
  /** 仅 `ai` 列使用：生成指令（system 提示）。可选 = 旧数据/旧 op 零迁移（TASK-T18-04 §0.1）。 */
  ai: z.object({ prompt: z.string() }).optional(),
});
export type Property = z.infer<typeof propertySchema>;

/** collection.schema：properties 按 pid 索引 + 标题列 pid。 */
export const collectionSchemaSchema = z.object({
  properties: z.record(z.string(), propertySchema),
  title_pid: z.string(),
});
export type CollectionSchema = z.infer<typeof collectionSchemaSchema>;

/** 取属性定义（不存在 → undefined，调用方按未知属性降级）。 */
export function propertyOf(schema: CollectionSchema, pid: string): Property | undefined {
  return schema.properties[pid];
}

/** 标题列属性；title_pid 失配时回落第一个属性（不抛，保持视图可用）。 */
export function titleProperty(schema: CollectionSchema): Property | undefined {
  const primary = schema.properties[schema.title_pid];
  if (primary !== undefined) {
    return primary;
  }
  const first = Object.values(schema.properties)[0];
  return first;
}

/** 属性列表（保持插入序：properties 是普通对象，JSON 往返保序）。 */
export function propertyList(schema: CollectionSchema): Property[] {
  return Object.values(schema.properties);
}

// ---------------------------------------------------------------------------
// 视图：筛选 / 排序
// ---------------------------------------------------------------------------

/**
 * 筛选算子。语义（逐一对应 §3 关键语义测试）：
 * - `eq/neq`：文本/选项/URL/邮箱/关系按字符串比较；数字按数值比较；日期按 y/m/d 三元组比较；
 * - `contains`：文本/URL/邮箱的子串；select/multi/relation 按「任一 id 命中」；
 * - `is_empty`：值缺失/空串/空数组/未勾选之外的空值形态（checkbox 恒非空）；
 * - `gt/lt`：数字（数值）、日期（时间序）；
 * - `before/after`：**仅日期**（比 gt/lt 更严格的日期专用算子）。
 */
export const FILTER_KINDS = [
  'eq',
  'neq',
  'contains',
  'is_empty',
  'gt',
  'lt',
  'before',
  'after',
] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

/** 筛选子句。`value` 是 JSON 字面量（与属性类型一致），`is_empty` 忽略它。 */
export const filterClauseSchema = z.object({
  prop: z.string().min(1),
  kind: z.enum(FILTER_KINDS),
  value: z.unknown().optional(),
});
export type FilterClause = z.infer<typeof filterClauseSchema>;

/** 筛选树：顶层 `and`，`clauses` 可嵌套子 `and`（深度 3 已在测试内断言）。 */
export type FilterGroup = {
  op: 'and';
  clauses: Array<FilterClause | FilterGroup>;
};

export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    op: z.literal('and'),
    clauses: z.array(z.union([filterClauseSchema, filterGroupSchema])),
  }),
) as unknown as z.ZodType<FilterGroup>;

/** 判定节点是否为子分组。 */
export function isFilterGroup(node: FilterClause | FilterGroup): node is FilterGroup {
  return (node as FilterGroup).op === 'and';
}

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** 排序键。数组顺序即优先级（多键排序）。 */
export const sortKeySchema = z.object({
  prop: z.string().min(1),
  dir: z.enum(SORT_DIRECTIONS),
});
export type SortKey = z.infer<typeof sortKeySchema>;

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

export const VIEW_TYPES = ['table', 'kanban', 'gallery', 'form', 'dashboard', 'automation'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

// ---------------------------------------------------------------------------
// 仪表盘磁贴 / 自动化规则（T102，飞书对标；挂在**视图**上而非 schema 顶层 ——
// schema_json 顶层键会被 parseCollectionSchema 剥掉，视图经 saveView→normalizeView 往返）
// ---------------------------------------------------------------------------

/** 磁贴五型：指标卡（按选项分组计数）/ 分布（色带占比）/ 数值（字段聚合）/ 文本 / 分隔线。 */
export const WIDGET_TYPES = ['metric', 'distribution', 'number', 'text', 'divider'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** 磁贴可用的聚合（与 view.ts 的 AGGREGATIONS 交集，去掉展示语义的 `none`）。 */
export const WIDGET_AGGREGATIONS = ['count', 'sum', 'avg', 'earliest', 'latest'] as const;
export type WidgetAggregation = (typeof WIDGET_AGGREGATIONS)[number];

/**
 * 仪表盘磁贴。config 按 type 取用：
 * - metric / distribution：`groupPid`（必为 select/multi_select，缺失或指向不存在/隐藏字段
 *   → `resolveWidgets` 剔除该项）；
 * - number：`pid` + 可选 `agg`（缺省按字段类型可用聚合的第一项）；
 * - text：`text`；divider：无 config。
 */
export const dashboardWidgetSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(WIDGET_TYPES),
  config: z
    .object({
      groupPid: z.string().min(1).max(128).optional(),
      pid: z.string().min(1).max(128).optional(),
      agg: z.enum(WIDGET_AGGREGATIONS).optional(),
      text: z.string().max(2000).optional(),
    })
    .optional(),
});
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;

/** 自动化触发事件类型：记录创建 / 记录更新。 */
export const AUTOMATION_TRIGGERS = ['create', 'update'] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

/**
 * 自动化规则（一条 = 触发 + 条件 + 动作）：
 * - `on`：监听 create/update；`pid` 可选 —— 指定时只在**该字段**被写入的事件上触发；
 * - `if`：当刻记录值 `values[pid]` 与 `eq` 相等（引擎 `equalsValue` 口径，select 传选项 id）；
 * - `set`：写入 `{pid: to}`（select/multi 的目标选项 id 必须存在，否则主进程跳过该规则）。
 * 执行与链式不动点在 main 侧（`dbview.ts`），引擎只提供 `evalRules` 纯函数。
 */
export const automationRuleSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string(),
  enabled: z.boolean(),
  on: z.object({
    kind: z.enum(AUTOMATION_TRIGGERS),
    pid: z.string().min(1).max(128).optional(),
  }),
  if: z.object({
    pid: z.string().min(1).max(128),
    eq: z.unknown(),
  }),
  set: z.object({
    pid: z.string().min(1).max(128),
    to: z.unknown(),
  }),
});
export type AutomationRule = z.infer<typeof automationRuleSchema>;

/**
 * 视图定义。`widths` 是列宽覆盖（pid → px，拖宽后落盘）。
 * 六型：table（表格）/ kanban（看板）/ gallery（画廊）/ form（表单）
 * / dashboard（仪表盘，T102）/ automation（自动化，T102）。
 * 各型专属配置一律**可选**且缺省即老行为 ⇒ 老数据零迁移。
 */
export const dbViewSchema = z.object({
  vid: z.string().min(1).max(128),
  name: z.string(),
  type: z.enum(VIEW_TYPES),
  filter: filterGroupSchema,
  sort: z.array(sortKeySchema),
  widths: z.record(z.string(), z.number()),
  /** T99-01 看板：分组字段（必须是 select / multi_select；非法 → 渲染层回退表格并提示）。 */
  groupPid: z.string().optional(),
  /** T99-01 视图内隐藏的列（pid 列表）。 */
  hiddenPids: z.array(z.string()).optional(),
  /** 画廊：封面字段（卡片顶部色带取它的值）；缺省 = 首个 file/url 可见字段。 */
  coverPid: z.string().optional(),
  /** 画廊：卡片正文显示哪些字段；缺省 = 可见的非标题字段（上限见 GALLERY_FIELD_LIMIT）。 */
  cardPids: z.array(z.string()).optional(),
  /** 表单：标题 / 说明（缺省用视图名，不写空占位）。 */
  formTitle: z.string().optional(),
  formDesc: z.string().optional(),
  /** 表单：展示哪些字段（标题列恒在首位）；缺省 = 标题列 + 全部非标题字段。 */
  formPids: z.array(z.string()).optional(),
  /** 表单：其中哪些必填（提交校验用；可含标题列）。 */
  formRequired: z.array(z.string()).optional(),
  /** 仪表盘（T102）：磁贴列表（顺序 = 展示顺序）；清洗与消费见 view.ts。 */
  widgets: z.array(dashboardWidgetSchema).optional(),
  /** 自动化（T102）：规则列表（执行在主进程 createRecord/updateRecord）。 */
  rules: z.array(automationRuleSchema).optional(),
});
export type DbView = z.infer<typeof dbViewSchema>;

/** 空筛选（恒真）。 */
export function emptyFilter(): FilterGroup {
  return { op: 'and', clauses: [] };
}

/** 新建 collection 的默认表格视图。 */
export function defaultView(vid: string, name = '表格'): DbView {
  return { vid, name, type: 'table', filter: emptyFilter(), sort: [], widths: {} };
}

// ---------------------------------------------------------------------------
// 记录值
// ---------------------------------------------------------------------------

const checkboxValue = z.boolean();
const numberValue = z.number().finite();
const textValue = z.string();
const selectValue = z.string().min(1).max(128);
const multiValue = z.array(z.string().min(1).max(128));
const relationValue = z.array(z.string().min(1).max(128));
const fileValue = z.array(z.string());

/** 值 → zod schema 的分派表。`null` 是「空值」的规范形态（非 undefined）。 */
export const VALUE_SCHEMA_BY_TYPE: Readonly<Record<FieldType, z.ZodType>> = {
  text: textValue,
  number: numberValue,
  select: selectValue,
  multi_select: multiValue,
  date: dateValueSchema,
  checkbox: checkboxValue,
  url: textValue,
  email: textValue,
  relation: relationValue,
  file: fileValue,
  // ai 列的值 = 纯字符串（与 text 同构；TASK-T18-04 §0.2）
  ai: textValue,
};

/** 单条记录的值表：`{pid: 值}`；缺键即空值。 */
export const recordValuesSchema = z.record(z.string(), z.unknown());
export type RecordValues = z.infer<typeof recordValuesSchema>;

// ---------------------------------------------------------------------------
// 实体（物化层行 → 领域对象）
// ---------------------------------------------------------------------------

/** collection 实体。`page_id` 为 null = 独立 DB 页（§4）。 */
export const collectionEntitySchema = z.object({
  id: z.string().min(1).max(128),
  page_id: z.string().nullable(),
  workspace_id: z.string().min(1),
  name: z.string(),
  schema: collectionSchemaSchema,
  views: z.array(dbViewSchema),
  alive: z.number().int().min(0).max(1),
  version: z.number().int().min(0),
});
export type CollectionEntity = z.infer<typeof collectionEntitySchema>;

/** record 实体。 */
export const recordEntitySchema = z.object({
  id: z.string().min(1).max(128),
  collection_id: z.string().min(1).max(128),
  workspace_id: z.string().min(1),
  values: recordValuesSchema,
  sort_key: z.string().min(1),
  alive: z.number().int().min(0).max(1),
  version: z.number().int().min(0),
  /** 关系反链索引：`{目标 collectionId: recordId[]}`（由 relation 双写维护）。 */
  backlinks: z.record(z.string(), z.array(z.string())).optional(),
});
export type RecordEntity = z.infer<typeof recordEntitySchema>;

// ---------------------------------------------------------------------------
// 校验助手
// ---------------------------------------------------------------------------

/** 解析一份 collection.schema；失败 return null（调用方降级，不抛）。 */
export function parseCollectionSchema(value: unknown): CollectionSchema | null {
  const parsed = collectionSchemaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 解析一份视图列表；失败 return null。 */
export function parseViews(value: unknown): DbView[] | null {
  const parsed = z.array(dbViewSchema).safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 解析单条记录值表（不做类型级校验，类型级校验走 `parseTypedValue`）。 */
export function parseRecordValues(value: unknown): RecordValues | null {
  const parsed = recordValuesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 值是否合法（含「无值」）：`undefined`/`null` 恒通过（空值）。 */
export function isValidValue(type: FieldType, value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  return VALUE_SCHEMA_BY_TYPE[type].safeParse(value).success;
}

/**
 * 规范化值：schema 通过则返回解析产物，否则返回 `null`（视作空值）。
 * 用于一切「从 UI/CSV/网络进来」的写入口，保证进 Op 的值永远合法。
 */
export function coerceValue(type: FieldType, value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = VALUE_SCHEMA_BY_TYPE[type].safeParse(value);
  return parsed.success ? parsed.data : null;
}
