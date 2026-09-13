/**
 * values.ts —— 值编解码与显示（TASK-T7-01 §1）。
 *
 * 三层职责：
 * 1. **编解码**：值 ↔ 存储 JSON（`JSON.parse(JSON.stringify())` 语义的深拷贝 + 校验），
 *    保证 roundtrip 恒等（8 类型各 20 随机值，见 `test/values.test.ts`）；
 * 2. **显示文本**：值 → 字符串（表格单元格 / CSV 导出用），空值恒为「—」；
 *    文本类超过 `DISPLAY_MAX_LEN` 字符按 Unicode 码点截断并加省略号；
 * 3. **类型推断**：CSV 单元格字符串 → FieldType（M12 导入复用）。
 *
 * 纪律：零 React、零 IO、零随机源；所有函数是纯函数（同输入同输出）。
 */
import {
  dateValueSchema,
  type CollectionSchema,
  type DateValue,
  type FieldType,
  type PropertyOption,
  type RecordValues,
} from './types';

/** 显示文本的最大长度（Unicode 码点）。 */
export const DISPLAY_MAX_LEN = 40;
/** 空值占位符（03 mockup：空值一律「—」）。 */
export const EMPTY_DISPLAY = '—';
/** 截断省略号。 */
export const ELLIPSIS = '…';

// ---------------------------------------------------------------------------
// 编解码
// ---------------------------------------------------------------------------

/** JSON 语义深拷贝（丢弃 undefined，与 core.stableStringify 口径一致）。 */
export function cloneJson<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 值 → 存储 JSON 文本（与 `decodeValue` 严格配对：`decodeValue(encodeValue(v))` 深等于 v）。
 *
 * 规范：undefined 收敛为 `null`（空值的规范形态，SQLite NULL 列）；
 * 其余一律 `JSON.stringify`，因此字符串 `"ok"` 存为 `"\"ok\""` ——
 * decode 侧统一 JSON.parse 复原，字符串里含非 JSON 裸文本时不会被误解析成 null。
 */
export function encodeValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value) as string;
}

/**
 * 存储 JSON → 值。非法 JSON 文本返回 `null`（空值），不抛。
 * 注意：这里只做 JSON 解码，**不做类型级校验**（类型级走 types.coerceValue）。
 */
export function decodeValue(raw: unknown): unknown {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === 'string') {
    if (raw.length === 0) {
      return null;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

/** 值表的 JSON 文本 → 值表（物化层 `values_json` 列 → 领域对象）。 */
export function decodeValuesJson(json: string): RecordValues {
  if (json.length === 0) {
    return {};
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as RecordValues;
}

/** 值表 → 物化层 JSON 文本。 */
export function encodeValuesJson(values: RecordValues): string {
  return JSON.stringify(values);
}

// ---------------------------------------------------------------------------
// 空值判定
// ---------------------------------------------------------------------------

/** 空值判定（`is_empty` 算子与显示占位共用同一口径）。 */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 显示
// ---------------------------------------------------------------------------

/** 按 Unicode 码点截断（避免截断代理对，中文/emoji 都安全）。 */
export function truncate(text: string, maxLen = DISPLAY_MAX_LEN): string {
  const points = Array.from(text);
  if (points.length <= maxLen) {
    return text;
  }
  return points.slice(0, maxLen).join('') + ELLIPSIS;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** DateValue → `YYYY-MM-DD`。 */
export function formatDate(value: DateValue): string {
  return `${String(value.y).padStart(4, '0')}-${pad2(value.m)}-${pad2(value.d)}`;
}

/** `YYYY-MM-DD` → DateValue；非法日期（含 2 月 30 日）返回 null。 */
export function parseDateText(text: string): DateValue | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const candidate = { y, m, d };
  const parsed = dateValueSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }
  // 语义校验：真实存在的日历日（Date 会自动滚月，故比回原值）
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return parsed.data;
}

function optionName(
  property: { options?: readonly PropertyOption[] | undefined },
  id: string,
): string | null {
  const found = property.options?.find((option) => option.id === id);
  return found === undefined ? null : found.name;
}

/**
 * 值 → 单元格显示文本。
 * - 空值 / 未知 select id / 未知 relation id → `EMPTY_DISPLAY`；
 * - 文本类按 `DISPLAY_MAX_LEN` 截断加省略号；
 * - checkbox 勾选显示「✓」，未勾选显示空值占位（满足 §4「空值占位—」的统一口径）。
 */
export function formatValue(
  property: { type: FieldType; options?: readonly PropertyOption[] | undefined },
  value: unknown,
  options: { relationTitle?: (id: string) => string | null } = {},
): string {
  if (isEmptyValue(value)) {
    return EMPTY_DISPLAY;
  }
  switch (property.type) {
    case 'text':
    case 'url':
    case 'email':
      return truncate(String(value));
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return EMPTY_DISPLAY;
      }
      return String(value);
    }
    case 'checkbox':
      return value === true ? '✓' : EMPTY_DISPLAY;
    case 'date': {
      const parsed = dateValueSchema.safeParse(value);
      return parsed.success ? formatDate(parsed.data) : EMPTY_DISPLAY;
    }
    case 'select': {
      const name = optionName(property, String(value));
      return name === null ? EMPTY_DISPLAY : truncate(name);
    }
    case 'multi_select': {
      const ids = Array.isArray(value) ? value : [];
      const names = ids
        .map((id) => optionName(property, String(id)))
        .filter((name): name is string => name !== null);
      return names.length === 0 ? EMPTY_DISPLAY : truncate(names.join(', '));
    }
    case 'relation': {
      const ids = Array.isArray(value) ? value : [];
      const titles = ids
        .map((id) => options.relationTitle?.(String(id)) ?? null)
        .filter((title): title is string => title !== null);
      return titles.length === 0 ? EMPTY_DISPLAY : truncate(titles.join(', '));
    }
    case 'file': {
      const names = Array.isArray(value) ? value.map((item) => String(item)) : [];
      return names.length === 0 ? EMPTY_DISPLAY : truncate(names.join(', '));
    }
    default:
      return EMPTY_DISPLAY;
  }
}

/**
 * 取记录里某属性的**可读标题**（relation 反查用）。
 * 优先 title_pid，其次第一个非空文本类属性，最后回落到 record id。
 */
export function recordTitle(
  schema: CollectionSchema,
  values: RecordValues,
  recordId: string,
): string {
  const primary = schema.properties[schema.title_pid];
  if (primary !== undefined) {
    const raw = values[primary.id];
    if (!isEmptyValue(raw)) {
      const text = formatValue(primary, raw);
      if (text !== EMPTY_DISPLAY) {
        return text;
      }
    }
  }
  for (const property of Object.values(schema.properties)) {
    const raw = values[property.id];
    if (isEmptyValue(raw)) {
      continue;
    }
    const text = formatValue(property, raw);
    if (text !== EMPTY_DISPLAY) {
      return text;
    }
  }
  return recordId;
}

// ---------------------------------------------------------------------------
// 类型推断（CSV 导入，M12 复用）
// ---------------------------------------------------------------------------

const NUMBER_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
/** 只认 true/false：'1'/'0' 归数字，避免与 number 冲突（口径见报告 DEVIATIONS）。 */
const BOOLEAN_RE = /^(true|false)$/i;

/** 单个单元格的候选类型（未命中任何特征 → `text`）。 */
export function inferFieldType(sample: string): FieldType {
  const text = sample.trim();
  if (text.length === 0) {
    return 'text';
  }
  if (BOOLEAN_RE.test(text)) {
    return 'checkbox';
  }
  if (NUMBER_RE.test(text)) {
    return 'number';
  }
  if (parseDateText(text) !== null) {
    return 'date';
  }
  if (EMAIL_RE.test(text)) {
    return 'email';
  }
  if (URL_RE.test(text)) {
    return 'url';
  }
  return 'text';
}

/** 若干样本的列类型推断：全一致才采信，否则回落 `text`（保守，不误转数据）。 */
export function inferColumnType(samples: readonly string[]): FieldType {
  let decided: FieldType | null = null;
  for (const sample of samples) {
    const text = sample.trim();
    if (text.length === 0) {
      continue; // 空格不参与推断
    }
    const type = inferFieldType(text);
    if (decided === null) {
      decided = type;
      continue;
    }
    if (decided !== type) {
      // number/date 可互相兼容（数字列混日期列应回落 text），其余一律回落
      return 'text';
    }
  }
  return decided ?? 'text';
}
