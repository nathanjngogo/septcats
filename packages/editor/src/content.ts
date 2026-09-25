/**
 * content.ts —— R25（T76-01）两个**单块自包含**内容块的真相层语义与纯函数算子。
 *
 * 边界（与 model.ts 同纪律）：**纯函数区，不 import @tiptap/*、不 import react**，
 * 可在纯 Node 下逐例断言；PM 侧的节点/NodeView 只是这两个 shape 的投影外壳。
 *
 * 选型依据（报告 §0-②）：块模型有 `parent_id` **字段**但无父子**原语**——PM schema
 * 全员 `group:'block'`、doc = `block+`，没有任何节点接受块级子内容；全仓也没有任何
 * 代码路径写非 null 的块 parent_id（tree.ts 的父子机制是页面专属）。故按 PRD §2B
 * 走**单块自包含**（同 code/table 思路），不造第三个状态。
 *
 * 字段名一次定死、全链路同构（报告 §0-①）：`{ rows, header, colWidths? }` 与
 * `{ title, body }`——PM attr 名与真相层 content 键**逐字相同**（零映射表）。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 表格块 table —— content = { rows: string[][], header: boolean, colWidths?: number[] }
// ---------------------------------------------------------------------------

/** 新表默认规模（斜杠菜单插入即 3×3，PRD §2A）。 */
export const TABLE_DEFAULT_ROWS = 3;
export const TABLE_DEFAULT_COLS = 3;
/** 结构下限：行/列至少保留 1（删到 0 行的「块还在但看不见」是不可恢复态）。 */
export const TABLE_MIN_ROWS = 1;
export const TABLE_MIN_COLS = 1;
/** 列宽（纵向拖拽）的像素下限与自动列宽的退化基准。 */
export const TABLE_MIN_COL_WIDTH = 56;
export const TABLE_DEFAULT_COL_WIDTH = 112;

export const tableContentSchema = z.object({
  rows: z.array(z.array(z.string())),
  header: z.boolean(),
  colWidths: z.array(z.number()).optional(),
});
export type TableContent = z.infer<typeof tableContentSchema>;

/** 3×3 空表（每次调用返回**全新**数组：PM attr 默认值可能被多节点共享，禁原地改）。 */
export function defaultTableContent(): TableContent {
  const rows: string[][] = [];
  for (let row = 0; row < TABLE_DEFAULT_ROWS; row += 1) {
    rows.push(new Array<string>(TABLE_DEFAULT_COLS).fill(''));
  }
  return { rows, header: true };
}

function isStringGrid(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row) => Array.isArray(row) && row.length > 0 && row.every((cell) => typeof cell === 'string'),
    )
  );
}

/**
 * 归一化：任何来源（块 content / PM attrs / 外部导入）→ 规范形状。
 * - rows 非法（缺省/空/非 string[][]）→ 落回 3×3 空表；
 * - header 非布尔 → 默认 true（首行即表头）；
 * - colWidths 长度与列数不等 → **丢弃**（降级为自适应列宽，绝不留下错位宽度）。
 * 输出键序固定（rows → header → [colWidths]），`stableStringify` 幂等。
 */
export function normalizeTableContent(raw: unknown): TableContent {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultTableContent();
  }
  const source = raw as Record<string, unknown>;
  const rows = isStringGrid(source['rows'])
    ? source['rows'].map((row) => [...row])
    : defaultTableContent().rows;
  const header = typeof source['header'] === 'boolean' ? source['header'] : true;
  const cols = rows[0]?.length ?? 0;
  const rawWidths = source['colWidths'];
  const widths = Array.isArray(rawWidths)
    ? rawWidths.filter((width): width is number => typeof width === 'number' && Number.isFinite(width) && width > 0)
    : [];
  const out: TableContent = { rows, header };
  if (widths.length === cols && cols > 0) {
    out.colWidths = widths;
  }
  return out;
}

function cloneTable(content: TableContent): TableContent {
  const out: TableContent = {
    rows: content.rows.map((row) => [...row]),
    header: content.header,
  };
  if (content.colWidths !== undefined) {
    out.colWidths = [...content.colWidths];
  }
  return out;
}

/** 表列数（以首行为准；rows 恒非空——normalize 保证）。 */
export function tableColCount(content: TableContent): number {
  return content.rows[0]?.length ?? 0;
}

/** 在 index（缺省=末尾）插入一行；新行全空、列数与现有列数一致。 */
export function tableAddRow(content: TableContent, index?: number): TableContent {
  const next = cloneTable(content);
  const at = index === undefined ? next.rows.length : Math.min(Math.max(index, 0), next.rows.length);
  next.rows.splice(at, 0, new Array<string>(tableColCount(content)).fill(''));
  return next;
}

/** 删除 index 行；已到结构下限（1 行）时原样返回（不是错误，是夹紧）。 */
export function tableDeleteRow(content: TableContent, index: number): TableContent {
  if (content.rows.length <= TABLE_MIN_ROWS || index < 0 || index >= content.rows.length) {
    return content;
  }
  const next = cloneTable(content);
  next.rows.splice(index, 1);
  return next;
}

/** 在 index（缺省=末尾）插入一列；colWidths 同步插入（缺省宽度或同列现值）。 */
export function tableAddCol(content: TableContent, index?: number): TableContent {
  const cols = tableColCount(content);
  const at = index === undefined ? cols : Math.min(Math.max(index, 0), cols);
  const next = cloneTable(content);
  next.rows = next.rows.map((row) => {
    const line = [...row];
    line.splice(at, 0, '');
    return line;
  });
  if (next.colWidths !== undefined) {
    const widths = [...next.colWidths];
    widths.splice(at, 0, widths[at - 1] ?? widths[0] ?? TABLE_DEFAULT_COL_WIDTH);
    next.colWidths = widths;
  }
  return next;
}

/** 删除 index 列；已到结构下限（1 列）时原样返回。 */
export function tableDeleteCol(content: TableContent, index: number): TableContent {
  const cols = tableColCount(content);
  if (cols <= TABLE_MIN_COLS || index < 0 || index >= cols) {
    return content;
  }
  const next = cloneTable(content);
  next.rows = next.rows.map((row) => row.filter((_, col) => col !== index));
  if (next.colWidths !== undefined) {
    next.colWidths = next.colWidths.filter((_, col) => col !== index);
  }
  return next;
}

/** 首行=表头开关。 */
export function tableSetHeader(content: TableContent, header: boolean): TableContent {
  if (content.header === header) {
    return content;
  }
  return { ...cloneTable(content), header };
}

/** 单元格写入（越界原样返回：调用方拿到的永远是合法 content）。 */
export function tableSetCell(content: TableContent, row: number, col: number, text: string): TableContent {
  const line = content.rows[row];
  if (line === undefined || col < 0 || col >= line.length || line[col] === text) {
    return content;
  }
  const next = cloneTable(content);
  const target = next.rows[row];
  if (target !== undefined) {
    target[col] = text;
  }
  return next;
}

/**
 * 第 index 列宽 = 起点宽 + deltaPx（夹到下限）。
 * `baseWidths` = **拖拽起点**的宽度快照（缺省时优先 content.colWidths，再退化到
 * 量测值 / 默认宽）——拖拽期间每次 move 都从起点重算，避免误差累积。
 */
export function tableResizeColumn(
  content: TableContent,
  index: number,
  deltaPx: number,
  baseWidths?: number[],
): TableContent {
  const cols = tableColCount(content);
  if (index < 0 || index >= cols) {
    return content;
  }
  const base =
    content.colWidths ??
    baseWidths ??
    new Array<number>(cols).fill(TABLE_DEFAULT_COL_WIDTH);
  const widths = [...base];
  while (widths.length < cols) {
    widths.push(TABLE_DEFAULT_COL_WIDTH);
  }
  widths[index] = Math.max(TABLE_MIN_COL_WIDTH, Math.round((widths[index] ?? TABLE_DEFAULT_COL_WIDTH) + deltaPx));
  return { ...cloneTable(content), colWidths: widths.slice(0, cols) };
}

/**
 * 列宽 → CSS grid 模板（真相层不留 px 语义，只在渲染边界兑现）。
 * colWidths 缺省 → 全列 `minmax(0, 1fr)` 自适应。
 */
export function tableGridTemplate(content: TableContent): string {
  const cols = tableColCount(content);
  const widths = content.colWidths;
  const tracks: string[] = [];
  for (let col = 0; col < cols; col += 1) {
    const width = widths?.[col];
    tracks.push(width === undefined ? 'minmax(0, 1fr)' : `${String(Math.round(width))}px`);
  }
  return tracks.join(' ');
}

// ---------------------------------------------------------------------------
// 折叠列表 toggle —— content = { title: string, body: string[] }
// ---------------------------------------------------------------------------

/** 正文恒 ≥1 行（空块也要有可落光标的一行）。 */
export const TOGGLE_MIN_BODY_LINES = 1;

export const toggleContentSchema = z.object({
  title: z.string(),
  body: z.array(z.string()),
});
export type ToggleContent = z.infer<typeof toggleContentSchema>;

export function defaultToggleContent(): ToggleContent {
  return { title: '', body: [''] };
}

/** 归一化：title 非串 → ''；body 非法/空 → ['']（恒 ≥1 行）。 */
export function normalizeToggleContent(raw: unknown): ToggleContent {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultToggleContent();
  }
  const source = raw as Record<string, unknown>;
  const title = typeof source['title'] === 'string' ? source['title'] : '';
  const rawBody = source['body'];
  const body = Array.isArray(rawBody)
    ? rawBody.filter((line): line is string => typeof line === 'string')
    : [];
  return { title, body: body.length >= TOGGLE_MIN_BODY_LINES ? body : [''] };
}

function cloneToggle(content: ToggleContent): ToggleContent {
  return { title: content.title, body: [...content.body] };
}

export function toggleSetTitle(content: ToggleContent, title: string): ToggleContent {
  if (content.title === title) {
    return content;
  }
  return { ...cloneToggle(content), title };
}

export function toggleSetBodyLine(content: ToggleContent, index: number, text: string): ToggleContent {
  if (index < 0 || index >= content.body.length || content.body[index] === text) {
    return content;
  }
  const next = cloneToggle(content);
  next.body[index] = text;
  return next;
}

/** 在 index（缺省=末尾）插入空正文行。 */
export function toggleAddBodyLine(content: ToggleContent, index?: number): ToggleContent {
  const next = cloneToggle(content);
  const at = index === undefined ? next.body.length : Math.min(Math.max(index, 0), next.body.length);
  next.body.splice(at, 0, '');
  return next;
}

/** 删除 index 正文行；已到下限（1 行）时原样返回。 */
export function toggleDeleteBodyLine(content: ToggleContent, index: number): ToggleContent {
  if (content.body.length <= TOGGLE_MIN_BODY_LINES || index < 0 || index >= content.body.length) {
    return content;
  }
  const next = cloneToggle(content);
  next.body.splice(index, 1);
  return next;
}

// ---------------------------------------------------------------------------
// markdown 表格（粘贴 / 解析共用；`| a | b |` 行 + 可选分隔行）
// ---------------------------------------------------------------------------

/**
 * 单元格分隔：按**未转义**的 `|` 切分（T79-01 起反解导出方言的转义——`\|`→`|`、
 * `<br>`→换行；见 serialize.ts 的 escapeCell）。单元格数量语义与旧版逐位一致
 * （现网夹具不含 `\|`/`<br>`，故既有判等零回归）。
 */
function splitTableCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) {
    body = body.slice(1);
  }
  if (body.endsWith('|')) {
    body = body.slice(0, -1);
  }
  const raw: string[] = [];
  let current = '';
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index];
    if (ch === '\\' && body[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (ch === '|') {
      raw.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  raw.push(current);
  return raw.map((cell) => cell.trim().replace(/<br\s*\/?>/gi, '\n'));
}

/** markdown 表格行：以 `|` 起首且以 `|` 收尾（`| a | b |`）。 */
export function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= 2 && trimmed.startsWith('|') && trimmed.endsWith('|');
}

/** 分隔行（`| --- | :--: |`）：只含 | : - 与空白，且至少一个 `-`。 */
export function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^[\s|:-]+$/.test(trimmed) && trimmed.includes('-');
}

/**
 * 连续 pipe 行 → 表格 content。
 * - 首行恒进 `rows[0]`（它是表格的第一视觉行）；`header` 只表示「首行是否为表头」；
 * - 第 2 行是分隔行（`| --- |`）⇒ header=true 且该行不是数据（被剔除）；
 * - 否则 header=false（纯数据行，`|a|b|` 独行即此形态）。
 * 至少要有 1 行数据；列数以**最宽行**为准，短行右侧补空串（不规则表格不丢列）。
 */
export function parseMarkdownTableLines(lines: readonly string[]): TableContent | null {
  // 分隔行不是数据（先剔掉，避免 `| --- |` 被当成一行单元格）
  const rows = lines
    .filter((line) => isMarkdownTableRow(line) && !isMarkdownTableSeparator(line))
    .map((line) => splitTableCells(line));
  if (rows.length === 0) {
    return null;
  }
  const header = isMarkdownTableSeparator(lines[1] ?? '');
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const padded = rows.map((row) => {
    const line = [...row];
    while (line.length < cols) {
      line.push('');
    }
    return line;
  });
  return { rows: padded, header };
}

/** 整段纯文本是否就是一张 markdown 表格（非空行全是 pipe 行）——粘贴插件的窄口判据。 */
export function matchMarkdownTable(text: string): TableContent | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }
  if (!lines.every((line) => isMarkdownTableRow(line) || isMarkdownTableSeparator(line))) {
    return null;
  }
  return parseMarkdownTableLines(lines);
}

/**
 * 输入规则简写：`|a|b|`（≥2 个非空单元格）→ 表格 content。
 * 纯判定，Enter 键的执行器在 rules/inputRules.ts（与 matchInputRule 同纪律）。
 */
export function matchTableShorthand(text: string): TableContent | null {
  if (!isMarkdownTableRow(text) || isMarkdownTableSeparator(text)) {
    return null;
  }
  const cells = splitTableCells(text);
  if (cells.length < 2 || cells.filter((cell) => cell.length > 0).length < 2) {
    return null;
  }
  return { rows: [cells], header: false };
}

// ---------------------------------------------------------------------------
// 内容 → 纯文本行（T82-02 · H-07 的**唯一实现**）
// ---------------------------------------------------------------------------

/**
 * 块 content（任意真相层形态）→ 纯文本行（按块级段落 / 表格单元 / 折叠行切分）。
 *
 * 覆盖 `model.ts` 的 `blockContentSchema` 全部形态：
 * - 纯文本 string（code 块）→ 该串一行；
 * - PM doc / 内联节点 → **块级子节点各成一行**（段落内联节点先拼成一行再上抛，
 *   故「多段落 doc」与「段内多 text 节点」两种形态都稳定）；
 * - 结构化 table `{rows, header}`（R25 冻结口径）→ **逐单元格一行**（阅读序）；
 * - 结构化 toggle `{title, body}` → title 一行 + body 逐行；
 * - divider / image / null / 非法形态 → 空数组（不产行，也不抛）。
 *
 * 【单一实现纪律】renderer 的「最近页摘抄」`firstTextOfBlock`、
 * 「模板市场种子正文」`extractPlainText`、以及 main 的双链上下文片段
 * `textOfBlockContent`（rules/wikilink.ts）**全部**经本函数取文本——T79 缺陷 A
 * 的教训（同一分流写三份 → table/toggle 结构化正文在部分路径整片丢失）在此收口。
 * 纯函数：不 import @tiptap/*、不 import react，main/renderer 两侧同源可测。
 */
export function blockContentTextLines(content: unknown): string[] {
  return textLinesOf(content);
}

/** toggle 结构化形态判定（title 串 + body 串数组；PM 节点带 attrs 不命中）。 */
function isToggleShape(record: Record<string, unknown>): boolean {
  return (
    typeof record['title'] === 'string' &&
    Array.isArray(record['body']) &&
    (record['body'] as unknown[]).every((line) => typeof line === 'string')
  );
}

function pushNonEmpty(out: string[], value: string): void {
  if (value.length > 0) {
    out.push(value);
  }
}

function textLinesOf(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.length > 0 ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => textLinesOf(item));
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  const record = value as Record<string, unknown>;

  // 结构化 table：{rows: string[][], header, colWidths?}（判据用行网格，不看 header）
  const rows = record['rows'];
  if (isStringGrid(rows)) {
    const out: string[] = [];
    for (const row of rows) {
      for (const cell of row) {
        pushNonEmpty(out, cell);
      }
    }
    return out;
  }

  // 结构化 toggle：{title, body}（与 table 同为「不是 PM doc」的真相层形态）
  if (isToggleShape(record)) {
    const out: string[] = [];
    pushNonEmpty(out, record['title'] as string);
    for (const line of record['body'] as string[]) {
      pushNonEmpty(out, line);
    }
    return out;
  }

  // PM 形态：内联节点自带的 text 优先；有 content 时继续下钻。
  const own: string[] = [];
  if (typeof record['text'] === 'string') {
    pushNonEmpty(own, record['text']);
  }
  const children = record['content'];
  if (!Array.isArray(children)) {
    return own;
  }
  if (own.length > 0) {
    // 自带 text 又有子节点（罕见的内联容器）：自身文本在后、子节点续接。
    return [...own, ...children.flatMap((child) => textLinesOf(child))];
  }
  // 块级容器（doc / paragraph 等）：**每个块级子节点合成一行**，保住段落边界。
  const lines: string[] = [];
  for (const child of children) {
    const parts = textLinesOf(child);
    if (parts.length > 0) {
      lines.push(parts.join(''));
    }
  }
  return lines;
}
