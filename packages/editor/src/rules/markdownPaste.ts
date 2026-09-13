/**
 * markdownPaste.ts —— text/plain 粘贴 → PM doc（M4.5 子集，自写解析器，不引依赖）。
 *
 * 覆盖：标题（#..######，块级钳到 H1–H3）、无序/有序列表、待办 `- [ ]`/`- [x]`、
 * 代码围栏 ```、引用 `>`、分隔线 `---`、内联 粗/斜/删除线/行内代码/链接（href 白名单）。
 * 不覆盖（超出 v1 子集，见报告 DEVIATIONS）：表格、嵌套列表、图片、HTML 内联。
 */
import { isAllowedHref } from '../marks';
import { pmNodeNameOf } from '../model';
import type { PMDocJSON, PMMarkJSON, PMNodeJSON } from '../model';

const FENCE = /^```([A-Za-z0-9_+#-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const TODO = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const DIVIDER = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const INLINE_SOURCE =
  '(`[^`]+`|\\[[^\\]]*\\]\\([^)\\s]+\\)|\\*\\*[^*]+\\*\\*|__[^_]+__|~~[^~]+~~|\\*[^*]+\\*|_[^_]+_)';

const LINK = /^\[([^\]]*)\]\(([^)\s]+)\)$/;

function textNode(value: string, marks: PMMarkJSON[]): PMNodeJSON {
  return marks.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks };
}

function markedToken(token: string): { value: string; marks: PMMarkJSON[] } {
  if (token.startsWith('`')) {
    return { value: token.slice(1, -1), marks: [{ type: 'code' }] };
  }
  if (token.startsWith('**') || token.startsWith('__')) {
    return { value: token.slice(2, -2), marks: [{ type: 'bold' }] };
  }
  if (token.startsWith('~~')) {
    return { value: token.slice(2, -2), marks: [{ type: 'strike' }] };
  }
  if (token.startsWith('*') || token.startsWith('_')) {
    return { value: token.slice(1, -1), marks: [{ type: 'italic' }] };
  }
  const link = LINK.exec(token);
  if (link !== null) {
    const value = link[1] ?? '';
    const href = link[2] ?? '';
    return { value, marks: isAllowedHref(href) ? [{ type: 'link', attrs: { href } }] : [] };
  }
  return { value: token, marks: [] };
}

/** 内联子集解析（不支持嵌套强调）。 */
export function parseInlineMarkdown(text: string): PMNodeJSON[] {
  if (text.length === 0) {
    return [];
  }
  const pattern = new RegExp(INLINE_SOURCE, 'g');
  const out: PMNodeJSON[] = [];
  let cursor = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match.index > cursor) {
      out.push(textNode(text.slice(cursor, match.index), []));
    }
    const token = match[0];
    const parsed = markedToken(token);
    if (parsed.value.length > 0) {
      out.push(textNode(parsed.value, parsed.marks));
    }
    cursor = match.index + token.length;
    match = pattern.exec(text);
  }
  if (cursor < text.length) {
    out.push(textNode(text.slice(cursor), []));
  }
  return out;
}

/** 文本类块 content：单个 paragraph 包裹内联内容（与 model.ts 的归一化一致）。 */
export function inlineContent(text: string): PMDocJSON {
  const nodes = parseInlineMarkdown(text);
  return nodes.length === 0
    ? { type: 'doc', content: [{ type: 'paragraph' }] }
    : { type: 'doc', content: [{ type: 'paragraph', content: nodes }] };
}

function paragraph(text: string): PMNodeJSON {
  const nodes = parseInlineMarkdown(text);
  return nodes.length === 0 ? { type: 'paragraph' } : { type: 'paragraph', content: nodes };
}

function codeBlock(lang: string, body: string): PMNodeJSON {
  const node: PMNodeJSON = { type: pmNodeNameOf('code'), attrs: { lang } };
  if (body.length > 0) {
    node.content = [{ type: 'text', text: body }];
  }
  return node;
}

function heading(level: number, text: string): PMNodeJSON {
  const node: PMNodeJSON = {
    type: 'heading',
    attrs: { level: Math.min(3, Math.max(1, level)) },
  };
  const content = parseInlineMarkdown(text);
  if (content.length > 0) {
    node.content = content;
  }
  return node;
}

function listNode(type: string, text: string, extra?: Record<string, unknown>): PMNodeJSON {
  const node: PMNodeJSON = extra === undefined ? { type } : { type, attrs: extra };
  const content = parseInlineMarkdown(text);
  if (content.length > 0) {
    node.content = content;
  }
  return node;
}

/** Markdown（子集）→ PM doc。 */
export function parseMarkdown(text: string): PMDocJSON {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const content: PMNodeJSON[] = [];
  let fenced: string | null = null;
  let buffer: string[] = [];

  for (const line of lines) {
    if (fenced !== null) {
      if (FENCE.test(line)) {
        content.push(codeBlock(fenced, buffer.join('\n')));
        fenced = null;
        buffer = [];
      } else {
        buffer.push(line);
      }
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      fenced = fence[1] ?? '';
      buffer = [];
      continue;
    }
    if (line.trim().length === 0) {
      continue;
    }
    if (DIVIDER.test(line)) {
      content.push({ type: 'divider' });
      continue;
    }

    const headingMatch = HEADING.exec(line);
    if (headingMatch !== null) {
      content.push(heading((headingMatch[1] ?? '#').length, headingMatch[2] ?? ''));
      continue;
    }
    const todo = TODO.exec(line);
    if (todo !== null) {
      const marker = todo[1] ?? ' ';
      content.push(
        listNode('to_do', todo[2] ?? '', { checked: marker === 'x' || marker === 'X' }),
      );
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote !== null) {
      content.push(listNode('quote', quote[1] ?? ''));
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      content.push(listNode('bulleted_list', bullet[1] ?? ''));
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered !== null) {
      content.push(listNode('numbered_list', numbered[1] ?? ''));
      continue;
    }
    content.push(paragraph(line));
  }

  if (fenced !== null) {
    content.push(codeBlock(fenced, buffer.join('\n')));
  }
  if (content.length === 0) {
    content.push({ type: 'paragraph' });
  }
  return { type: 'doc', content };
}
