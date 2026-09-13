/**
 * csvInfer.ts —— CSV 解析与属性类型推断（任务书 §2 csv 源 + notion-zip 的 database CSV 共用）。
 *
 * 职责：
 * - RFC4180 行级解析（引号字段、"" 转义、CRLF/LF、BOM）；
 * - 列类型推断（任务书 §2 顺序裁决）：true/false → checkbox、全整数/小数 → number、
 *   ISO 日期或 `2024-01-01` → date、含逗号且 token 集 ≤20 → multi_select、其余 text；
 *   空值单元格不参与推断（全空列 → text），混合列天然落到 text；
 * - title 属性取 `名称`/`Name` 列（强制 text），缺则第一列；
 * - 产物 = schema-v1 合法的 collection.schema（properties + title_pid）+ records
 *   （值形照 @septcats/dbview types.ts §4：date={y,m,d}、multi_select=选项 id[]、
 *   checkbox=boolean、number=finite number、空值=null 规范形态）。
 *
 * 本文件零 IO：parseCsvFile 接收注入的 ImportSourceFs。
 */
import { buildPlan } from './types';
import type { CollectionSchemaDef, ImportPlan, ImportSourceFs, RecordValues } from './types';

// ---------------------------------------------------------------------------
// 常量与正则
// ---------------------------------------------------------------------------

/** 数值：全整数/小数（含符号、.5 形态）；不支持千分位/指数（落 text，宁降级勿误判）。 */
const NUMBER_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;
/** 日期：`YYYY-MM-DD` 或带时间的 ISO（`T`/空格分隔、可带秒/毫秒/时区）。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** multi_select 启发上限：整列去重 token ≤ 20 才判 multi_select（任务书 §2）。 */
const MULTI_TOKEN_LIMIT = 20;

// ---------------------------------------------------------------------------
// RFC4180 行级解析
// ---------------------------------------------------------------------------

/** CSV 文本 → 二维行（引号字段含逗号/换行/"" 转义；全空行丢弃；BOM 剥离）。 */
export function parseCsvRows(text: string): string[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < clean.length) {
    const ch = clean[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && clean[i + 1] === '\n') {
        i += 1;
      }
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // 文件末尾无换行时收尾行（field 非空或行内已有字段才补）
  if (field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

// ---------------------------------------------------------------------------
// 类型推断
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` → {y,m,d}；带日历真实性校验（2月30日之类非法 → null，列落 text）。 */
function dateCell(cell: string): { y: number; m: number; d: number } | null {
  if (!DATE_RE.test(cell)) {
    return null;
  }
  const y = Number(cell.slice(0, 4));
  const m = Number(cell.slice(5, 7));
  const d = Number(cell.slice(8, 10));
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

interface ColumnType {
  type: 'text' | 'number' | 'checkbox' | 'date' | 'multi_select';
  /** multi_select 的选项（按首次出现序，id 由列 pid + 序号派生） */
  options: Array<{ id: string; name: string }>;
}

/** 单列类型推断：非空值全票通过，任一失败落到下一档；空值不参与。 */
function inferColumn(cells: string[]): ColumnType {
  const nonEmpty = cells.filter((cell) => cell.trim().length > 0);
  if (nonEmpty.length === 0) {
    return { type: 'text', options: [] };
  }
  if (nonEmpty.every((cell) => cell === 'true' || cell === 'false')) {
    return { type: 'checkbox', options: [] };
  }
  if (nonEmpty.every((cell) => NUMBER_RE.test(cell))) {
    return { type: 'number', options: [] };
  }
  if (nonEmpty.every((cell) => dateCell(cell) !== null)) {
    return { type: 'date', options: [] };
  }
  if (nonEmpty.some((cell) => cell.includes(','))) {
    const tokens: string[] = [];
    for (const cell of nonEmpty) {
      for (const raw of cell.split(',')) {
        const token = raw.trim();
        if (token.length > 0 && !tokens.includes(token)) {
          tokens.push(token);
        }
      }
    }
    if (tokens.length <= MULTI_TOKEN_LIMIT) {
      return { type: 'multi_select', options: tokens.map((name) => ({ id: '', name })) };
    }
  }
  return { type: 'text', options: [] };
}

// ---------------------------------------------------------------------------
// 主入口：CSV 文本 → schema + records
// ---------------------------------------------------------------------------

export interface CsvInferred {
  schema: CollectionSchemaDef;
  records: RecordValues[];
}

/**
 * CSV 文本 → collection schema + records。
 * - 列 pid 按位置派生（`p1..pn`，同名表头不冲突）；
 * - title 属性：表头恰为 `名称` 或 `Name` 的列（首个），缺则第一列；title 强制 text；
 * - multi_select 选项 id = `<pid>-o<j>`（j 从 1 起，按首次出现序）；
 * - 单元格空（含缺失的行尾列）→ null（空值规范形态）。
 */
export function inferCsv(text: string): CsvInferred {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return { schema: { properties: {}, title_pid: '' }, records: [] };
  }
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const width = header.length;

  // 列名：空表头 → `列<i+1>`
  const names = header.map((cell, index) => {
    const name = cell.trim();
    return name.length > 0 ? name : `列${index + 1}`;
  });

  // title 列：恰名 `名称`/`Name`（首个）；缺则第一列
  let titleIndex = names.findIndex((name) => name === '名称' || name === 'Name');
  if (titleIndex === -1) {
    titleIndex = 0;
  }

  const pids = names.map((_, index) => `p${index + 1}`);
  const columnCells = names.map((_, index) => body.map((row) => row[index] ?? ''));
  const inferred = columnCells.map((cells) => inferColumn(cells));

  const properties: CollectionSchemaDef['properties'] = {};
  for (let index = 0; index < width; index += 1) {
    const pid = pids[index] as string;
    const info = inferred[index] as ColumnType;
    const isTitle = index === titleIndex;
    const type = isTitle ? 'text' : info.type; // title 强制 text（schema-v1 标题列语义）
    const base = { name: names[index] as string, type };
    // options 仅 multi_select 有（与 dbview propertySchema 语义一致）
    if (!isTitle && info.type === 'multi_select') {
      properties[pid] = {
        ...base,
        options: info.options.map((option, j) => ({ id: `${pid}-o${j + 1}`, name: option.name })),
      };
    } else {
      properties[pid] = base;
    }
  }

  const records: RecordValues[] = body.map((row) => {
    const values: RecordValues = {};
    for (let index = 0; index < width; index += 1) {
      const pid = pids[index] as string;
      const cell = row[index] ?? '';
      if (cell.trim().length === 0) {
        values[pid] = null;
        continue;
      }
      const info = inferred[index] as ColumnType;
      const isTitle = index === titleIndex;
      if (isTitle || info.type === 'text') {
        values[pid] = cell;
        continue;
      }
      if (info.type === 'checkbox') {
        values[pid] = cell === 'true';
        continue;
      }
      if (info.type === 'number') {
        values[pid] = Number(cell);
        continue;
      }
      if (info.type === 'date') {
        values[pid] = dateCell(cell);
        continue;
      }
      // multi_select：token → 选项 id（id 生成式与上面 properties 一致：<pid>-o<j>）
      const idMap = new Map(info.options.map((option, j) => [option.name, `${pid}-o${j + 1}`]));
      const tokens = cell
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      values[pid] = tokens.map((token) => idMap.get(token) ?? token);
    }
    return values;
  });

  return { schema: { properties, title_pid: pids[titleIndex] as string }, records };
}

// ---------------------------------------------------------------------------
// csv 源（任务书 §2：单表 → 一个 collection 页）
// ---------------------------------------------------------------------------

function decode(value: string | Uint8Array): string {
  return typeof value === 'string' ? value : new TextDecoder().decode(value);
}

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * csv 源：单个 CSV → 一页（空正文占位）+ 一个 collection（挂在该页下）。
 * 约定 collection.path = `<页 path>/<页 path>`（确定性、唯一、层级化）。
 */
export function parseCsvFile(fs: ImportSourceFs, path: string): ImportPlan {
  const { schema, records } = inferCsv(decode(fs.read(path)));
  const stem = stripExt(basename(path));
  const items = [
    { op: 'page' as const, path: stem, title: stem, parentPath: null, blocks: [] },
    {
      op: 'collection' as const,
      path: `${stem}/${stem}`,
      title: stem,
      parentPath: stem,
      schema,
      records,
    },
  ];
  return buildPlan({ kind: 'csv', rootName: stem }, items, []);
}
