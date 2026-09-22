/**
 * markdown.ts —— 极简 Markdown → 块模型解析器（TASK-T56-01 §1②）。
 *
 * **纯函数、零依赖、零 React**：说明书正文是受控语料（changelog 之外由 PM 定稿的
 * 两份手册），只需覆盖实际用到的子集——标题 / 段落 / 有序与无序列表 / 表格 /
 * 行内码 / 围栏代码块 / 链接 / 加粗。仓内没有 markdown 库，且红线禁止新增 npm 依赖，
 * 故自写最小子集解析器，把「解析」与「渲染」解耦：本文件可被单测直接调用。
 *
 * 输出是可序列化的块模型（MdBlock / InlineNode），渲染在 ManualView.tsx。
 */

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'link'; text: string; href: string };

export type MdBlock =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; inline: InlineNode[] }
  | { kind: 'list'; ordered: boolean; items: InlineNode[][] }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'table'; header: InlineNode[][]; rows: InlineNode[][][] };

/** 说明书一个章节（`## ` 起首）：id 供锚点定位，title 供章节表。 */
export interface ManualSection {
  id: string;
  title: string;
  blocks: MdBlock[];
}

/** 解析后的整份说明书：一级标题 + 引言块 + 章节序列。 */
export interface ManualDoc {
  title: string;
  preamble: MdBlock[];
  sections: ManualSection[];
}

/** 行内 token：行内码 > 加粗 > 链接（行内码最先生效，其内部不再解析）。 */
const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;

/** 解析一行文本的行内标记。空串 → 空数组（调用方据此渲染空内容）。 */
export function parseInline(text: string): InlineNode[] {
  if (text === '') {
    return [];
  }
  const nodes: InlineNode[] = [];
  let cursor = 0;
  INLINE_PATTERN.lastIndex = 0;
  let match = INLINE_PATTERN.exec(text);
  while (match !== null) {
    if (match.index > cursor) {
      nodes.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    const token = match[0];
    if (match[1] !== undefined) {
      nodes.push({ kind: 'code', text: token.slice(1, -1) });
    } else if (match[2] !== undefined) {
      nodes.push({ kind: 'strong', text: token.slice(2, -2) });
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link !== null) {
        nodes.push({ kind: 'link', text: link[1] ?? '', href: link[2] ?? '' });
      } else {
        nodes.push({ kind: 'text', text: token });
      }
    }
    cursor = match.index + token.length;
    match = INLINE_PATTERN.exec(text);
  }
  if (cursor < text.length) {
    nodes.push({ kind: 'text', text: text.slice(cursor) });
  }
  return nodes;
}

/** 表格分隔行（`| --- | --- |` / `--- | ---`）：只含 | : - 与空白，且至少一个 -。 */
function isTableSeparator(line: string): boolean {
  return /^[\s|:-]+$/.test(line) && line.includes('-');
}

/** 表格行 → 单元格文本（去首尾竖线与空白）。 */
function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) {
    body = body.slice(1);
  }
  if (body.endsWith('|')) {
    body = body.slice(0, -1);
  }
  return body.split('|').map((cell) => cell.trim());
}

const FENCE = /^\s*```(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const TABLE_ROW = /^\s*\|/;
const LIST_ITEM = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/;

/** 是否为「块起始」行（段落累积到下一个块起始为止）。 */
function startsNewBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    TABLE_ROW.test(line) ||
    LIST_ITEM.test(line)
  );
}

/** 把一段 Markdown 文本解析成块序列。 */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let index = 0;
  let headingSeq = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const lang = (fence[1] ?? '').trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // 跳过收尾围栏
      blocks.push({ kind: 'code', lang, code: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      headingSeq += 1;
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '').length,
        text: (heading[2] ?? '').trim(),
        id: `heading-${String(headingSeq)}`,
      });
      index += 1;
      continue;
    }

    if (TABLE_ROW.test(line) && isTableSeparator(lines[index + 1] ?? '')) {
      const header = splitTableRow(line).map(parseInline);
      index += 2;
      const rows: InlineNode[][][] = [];
      while (index < lines.length && TABLE_ROW.test(lines[index] ?? '')) {
        rows.push(splitTableRow(lines[index] ?? '').map(parseInline));
        index += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const list = LIST_ITEM.exec(line);
    if (list !== null) {
      const ordered = list[2] !== undefined;
      const items: InlineNode[][] = [];
      while (index < lines.length) {
        const item = LIST_ITEM.exec(lines[index] ?? '');
        if (item === null || (item[2] !== undefined) !== ordered) {
          break;
        }
        items.push(parseInline((item[3] ?? '').trim()));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '' || startsNewBlock(current)) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}

/**
 * 解析整份说明书：首个 `# ` 为标题，其余引言进 preamble，`## ` 切章（id 按序稳定，
 * 与语言无关——切换语言后锚点位置不变）。
 */
export function parseManual(source: string): ManualDoc {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  const pre: string[] = [];
  const raw: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  let inFence = false;

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
    }
    const h1 = !inFence ? /^#\s+(.*)$/.exec(line) : null;
    if (h1 !== null) {
      title = (h1[1] ?? '').trim();
      continue;
    }
    const h2 = !inFence ? /^##\s+(.*)$/.exec(line) : null;
    if (h2 !== null) {
      current = { title: (h2[1] ?? '').trim(), body: [] };
      raw.push(current);
      continue;
    }
    if (current === null) {
      pre.push(line);
    } else {
      current.body.push(line);
    }
  }

  return {
    title,
    preamble: parseMarkdown(pre.join('\n')),
    sections: raw.map((section, position) => ({
      id: `section-${String(position + 1)}`,
      title: section.title,
      blocks: parseMarkdown(section.body.join('\n')),
    })),
  };
}
