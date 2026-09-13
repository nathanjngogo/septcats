/**
 * csv.ts —— RFC 4180 子集解析与序列化（TASK-T7-01 §1/§3）。
 *
 * 解析契约（`test/csv.test.ts` 逐条断言）：
 * - 字段可被双引号包裹；引号内 `""` 表示一个字面双引号；
 * - 引号内允许逗号、CR、LF（换行属于字段内容，不切行）；
 * - 行分隔符同时接受 `\r\n` 与 `\n`（混合出现也正确）；引号外的裸 `\r` 也按分隔符处理；
 * - 首字符 UTF-8 BOM 被剔除；空文件/纯空白 → `[]`；
 * - 引号未闭合属于坏输入 → throw `CsvError`（fail loud，不静默截断数据）。
 *
 * 序列化契约：含 `"`/`,`/CR/LF 的字段加引号并把 `"` 翻倍；
 * 恒定 `\r\n` 行尾（RFC 4180），末行不带多余空行。
 *
 * 纪律：零依赖、零 IO、纯函数。全文件 < 150 行。
 */

/** CSV 坏输入（未闭合引号）时抛出。 */
export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvError';
    Object.setPrototypeOf(this, CsvError.prototype);
  }
}

/** UTF-8 BOM（\uFEFF）。 */
export const BOM = '\uFEFF';

type State = 'start' | 'unquoted' | 'quoted' | 'quote-in-quoted';

/**
 * 解析 CSV 文本为二维数组（行 × 字段）。
 * 不做类型转换（类型推断在 `values.inferColumnType`），不做表头假设。
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  if (source.length === 0 || /^[\s\r\n]*$/.test(source)) {
    return [];
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let state: State = 'start';
  let fieldStarted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source.charAt(i);

    if (state === 'quoted') {
      if (ch === '"') {
        const next = source.charAt(i + 1);
        if (next === '"') {
          field += '"';
          i += 1;
          continue;
        }
        state = 'quote-in-quoted';
        continue;
      }
      field += ch;
      continue;
    }

    if (state === 'quote-in-quoted') {
      if (ch === ',') {
        endField();
        state = 'start';
        continue;
      }
      if (ch === '\r') {
        endRow();
        if (source.charAt(i + 1) === '\n') {
          i += 1;
        }
        state = 'start';
        continue;
      }
      if (ch === '\n') {
        endRow();
        state = 'start';
        continue;
      }
      // 引号后出现非分隔字符：宽松接受（按未加引号内容继续）
      field += ch;
      state = 'unquoted';
      continue;
    }

    if (ch === '"' && !fieldStarted) {
      state = 'quoted';
      fieldStarted = true;
      continue;
    }
    if (ch === ',') {
      endField();
      state = 'start';
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && source.charAt(i + 1) === '\n') {
        i += 1;
      }
      endRow();
      state = 'start';
      continue;
    }
    field += ch;
    fieldStarted = true;
    state = 'unquoted';
  }

  if (state === 'quoted') {
    throw new CsvError('CSV 解析失败：引号未闭合');
  }
  // 末行无行尾符时补收
  if (fieldStarted || field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows;
}

/** 单个字段序列化：需要时加引号并把内部 `"` 翻倍。 */
export function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\r') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 二维数组 → CSV 文本（CRLF 行尾；无尾随换行）。 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map((cell) => escapeCsvField(cell)).join(',')).join('\r\n');
}

/**
 * 首行是否应视作表头（供 M12 导入判断）：全部单元格非空且无重复。
 * 纯函数，不影响解析本身。
 */
export function looksLikeHeader(firstRow: readonly string[]): boolean {
  if (firstRow.length === 0) {
    return false;
  }
  const seen = new Set<string>();
  for (const cell of firstRow) {
    const text = cell.trim();
    if (text.length === 0 || seen.has(text)) {
      return false;
    }
    seen.add(text);
  }
  return true;
}
