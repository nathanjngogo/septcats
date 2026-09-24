/**
 * markdownPaste.ts —— text/plain 粘贴 → PM doc（M4.5 子集，自写解析器，不引依赖）。
 *
 * 覆盖：标题（#..######，块级钳到 H1–H3）、无序/有序列表、待办 `- [ ]`/`- [x]`、
 * 代码围栏 ```、引用 `>`、分隔线 `---`、内联 粗/斜/删除线/行内代码/链接（href 白名单）。
 * R25（T76-01）追加：**表格**（`| a | b |` 行 + 可选 `| --- |` 分隔行 → table 块；
 * 判定纯函数住 content.ts，本文件只做块级归组）。
 * R27（T79-01）追加：**callout**（`> [!<icon>] <inline>` → quote + icon）与
 * **toggle**（`> [!toggle] <title>` + 紧邻 `> ` 行 body）——导出序列化器的对偶方言。
 * 不覆盖（超出 v1 子集，见报告 DEVIATIONS）：嵌套列表、图片、HTML 内联。
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isMarkdownTableRow, isMarkdownTableSeparator, matchMarkdownTable } from '../content';
import { isAllowedHref } from '../marks';
import { pmNodeNameOf } from '../model';
import type { PMDocJSON, PMMarkJSON, PMNodeJSON } from '../model';

const FENCE = /^```([A-Za-z0-9_+#-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const TODO = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
/**
 * T79-01（R27 导出）自家方言：callout / toggle 都以 quote 形态承载——
 * - callout：`> [!<icon>] <inline>` → quote 节点 + attrs.icon（`types/quote.ts` 的 callout 口径）；
 * - toggle：`> [!toggle] <title>` + 紧邻 `> ` 行为 body（连续 quote 行成组，空行断组）。
 * 保留 token `toggle` 区分二型；方言为导出序列化器专属，真实世界 md 无此串 → 导入既有行为零改动。
 */
const CALLOUT = /^\s*>\s*\[!([^\]\n]+)\]\s?(.*)$/;
const TOGGLE_TOKEN = 'toggle';
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

/** 表格块节点（R25）：attrs 形态与 model.ts 的 blockToPMNode 完全一致（零映射）。 */
function tableBlock(rows: string[][], header: boolean): PMNodeJSON {
  return { type: pmNodeNameOf('table'), attrs: { rows, header, colWidths: null } };
}

/**
 * Markdown（子集）→ PM doc。
 *
 * 表格归组（R25）：进入一段连续 pipe 行时，用 matchMarkdownTable 一次判完——
 * 要求「第一行是 pipe 行 + （第二行是分隔行 或 第二行也是 pipe 行）」，否则按普通
 * 段落收口（`|` 开头但不构成表格的行不受影响）。
 */
export function parseMarkdown(text: string): PMDocJSON {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const content: PMNodeJSON[] = [];
  let fenced: string | null = null;
  let buffer: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
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

    // R25：表格块（连续 pipe 行整段归组）。
    // 归组门槛刻意收紧：**≥2 行 pipe 行，或第 2 行是分隔行**——单独一行 `| a | b |`
    // 在 markdown 里不构成表格（GFM 要求分隔行），若在此处放行，M12 导入链
    // （importer 逐行走同一个 parseMarkdown）会把普通正文里的孤立竖线行改判成表格，
    // 违背「导入导出零改动」红线。粘贴侧的「整段即表格」由窄口插件单独承接
    // （handlePaste，用户显式粘贴，不经过导入链）。
    if (isMarkdownTableRow(line) || isMarkdownTableSeparator(line)) {
      const run: string[] = [];
      let cursor = index;
      while (cursor < lines.length) {
        const candidate = lines[cursor] ?? '';
        if (!isMarkdownTableRow(candidate) && !isMarkdownTableSeparator(candidate)) {
          break;
        }
        run.push(candidate);
        cursor += 1;
      }
      const eligible = run.length >= 2 || isMarkdownTableSeparator(lines[index + 1] ?? '');
      const table = eligible ? matchMarkdownTable(run.join('\n')) : null;
      if (table !== null) {
        content.push(tableBlock(table.rows, table.header));
        index = cursor - 1;
        continue;
      }
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
    // T79-01：自家方言先于普通 quote 收口（callout / toggle）
    const callout = CALLOUT.exec(line);
    if (callout !== null) {
      const token = callout[1] ?? '';
      if (token === TOGGLE_TOKEN) {
        // toggle：紧随的连续 quote 行为正文（空行 / 非 quote 行断组）
        const body: string[] = [];
        let cursor = index + 1;
        while (cursor < lines.length) {
          const inner = QUOTE.exec(lines[cursor] ?? '');
          if (inner === null) {
            break;
          }
          body.push(inner[1] ?? '');
          cursor += 1;
        }
        content.push({
          type: pmNodeNameOf('toggle'),
          attrs: { title: callout[2] ?? '', body: body.length > 0 ? body : [''] },
        });
        index = cursor - 1;
        continue;
      }
      const calloutNode: PMNodeJSON = { type: 'quote', attrs: { icon: token } };
      const calloutInline = parseInlineMarkdown(callout[2] ?? '');
      if (calloutInline.length > 0) {
        calloutNode.content = calloutInline;
      }
      content.push(calloutNode);
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

export const markdownTablePastePluginKey = new PluginKey('septcatsMarkdownTablePaste');

/**
 * 窄口 `handlePaste`（R25 §A.4）：**仅当**剪贴板纯文本整体就是一张 markdown 表格时
 * 才接管——其余（含正文夹表格、纯文本、HTML）一律返回 false，PM 默认粘贴行为零变化。
 *
 * 为什么需要它：`parseMarkdown` 在此之前**只被测试调用**（全仓无运行时消费方，
 * 见报告 §0-③），只扩解析器等于功能不可达。窄口接管让「md 表格 → 表格块」在真机
 * 可用，同时把行为面压到最小。
 */
export function createMarkdownTablePastePlugin(): Plugin {
  return new Plugin({
    key: markdownTablePastePluginKey,
    props: {
      handlePaste: (view: EditorView, event: ClipboardEvent): boolean => {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (text.length === 0) {
          return false;
        }
        const table = matchMarkdownTable(text);
        if (table === null) {
          return false;
        }
        const nodeType = view.state.schema.nodes[pmNodeNameOf('table')];
        if (nodeType === undefined) {
          return false;
        }
        // id 留 null：交 pmDocToBlocks 生成 ulid，再由 Editor 的 id 回写落 DOM（T32-01B）
        const node = nodeType.create({
          id: null,
          rows: table.rows,
          header: table.header,
          colWidths: null,
        });
        const { from, to } = view.state.selection;
        view.dispatch(view.state.tr.replaceWith(from, to, node).scrollIntoView());
        return true;
      },
    },
  });
}
