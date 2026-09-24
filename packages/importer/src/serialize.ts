/**
 * serialize.ts —— BlockSpec[] → Markdown（TASK-T79-01 §A，与 markdown.ts 解析器**对偶**）。
 *
 * 铁律（任务书 §0-①）：**方言以自家解析器吃得回为准，禁抄外部 CommonMark/GFM 规范**。
 * 逐型语法与 `rules/markdownPaste.ts` 的 `parseMarkdown` + `markdown.ts` 的 BodyScanner
 * 一一对应（callout/toggle 为本单同期新增的自家方言，见该文件顶部注释）：
 * - paragraph/heading(1-3)/bullet/numbered/todo/quote/divider/code：直用解析器既有语法；
 * - callout（quote+icon）：`> [!<icon>] <inline>`；toggle：`> [!toggle] <title>` + `> ` 行 body；
 * - table：GFM 管道表，单元格转义 `|`→`\|`、换行→`<br>`（解析侧 `splitTableCells` 反解）；
 * - image：`![name](href)`，`href` 由注入的 `resolveAsset` 给出（相对路径 `files/…`）；
 *   孤儿（解析为 null）→ 留 `<!-- 附件缺失: <src> -->` 占位注释（不静默丢文件）。
 *
 * 纯 TS 零 electron、零 IO：本文件不读盘、不 import electron/@tiptap，node 直测。
 * **无损边界**（无法用自家方言表达的轴，记报告 §0-⑤）：colWidths（列宽）、code `wrap`、
 * image `width`、image 空 caption（解析器用文件名兜底 alt）、numbered `start`、
 * 单行 header=false 表格（不满足解析器归组门槛）、md 控制符字面量（解析器无转义反解）。
 */
import {
  normalizeTableContent,
  normalizeToggleContent,
} from '@septcats/editor';
import type { BlockSpec, BlockContent, PMDocJSON, PMMarkJSON, PMNodeJSON } from '@septcats/editor';

// ---------------------------------------------------------------------------
// 内联序列化
// ---------------------------------------------------------------------------

/** 单标记 → 包裹符（解析器 `parseInlineMarkdown` 的 INLINE_SOURCE 子集，禁嵌套强调）。 */
const MARK_WRAP: Readonly<Record<string, readonly [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
};

/** 标记链 → 包裹文本（link 单列；嵌套强调解析器不支持，按叠加顺序包裹）。 */
function wrapMarks(text: string, marks: readonly PMMarkJSON[] | undefined): string {
  let out = text;
  for (const mark of marks ?? []) {
    if (mark.type === 'link') {
      const href = typeof mark.attrs?.['href'] === 'string' ? mark.attrs['href'] : '';
      out = `[${out}](${href})`;
      continue;
    }
    const wrap = MARK_WRAP[mark.type];
    if (wrap !== undefined) {
      out = `${wrap[0]}${out}${wrap[1]}`;
    }
  }
  return out;
}

/** 单个内联节点 → md 片段（wikilink 节点走 `[[title]]` / `[[title|alias]]`）。 */
function inlineNode(node: PMNodeJSON): string {
  if (node.type === 'wikilink') {
    const title = typeof node.attrs?.['title'] === 'string' ? node.attrs['title'] : '';
    const alias = typeof node.attrs?.['alias'] === 'string' ? node.attrs['alias'] : null;
    return alias !== null && alias.length > 0 ? `[[${title}|${alias}]]` : `[[${title}]]`;
  }
  return wrapMarks(node.text ?? '', node.marks);
}

/** 文本类块 content（PM doc，恰好一个 paragraph 包裹内联）→ 内联 md 文本。 */
function inlineText(content: BlockContent): string {
  if (typeof content === 'string') {
    return content;
  }
  const doc = content as PMDocJSON | null;
  const paragraph = doc?.content?.[0];
  const nodes = paragraph?.content ?? [];
  return nodes.map((node) => inlineNode(node)).join('');
}

// ---------------------------------------------------------------------------
// 表格单元格转义
// ---------------------------------------------------------------------------

/** 单元格内 `|`→`\|`、换行→`<br>`（解析侧 `splitTableCells` 反解回原值）。 */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** 一行 → `| a | b |`。 */
function tableRow(cells: readonly string[]): string {
  return `| ${cells.map((cell) => escapeCell(cell)).join(' | ')} |`;
}

/**
 * 表格 → GFM 管道表。
 * - header=true：首行 = 表头 + 分隔行 `| --- |`（解析器据分隔行判 header=true 并剔除该行）；
 * - header=false：无分隔行的连续管道行（解析器 `run.length>=2` 判表格、header=false）。
 *
 * ⚠️ header=false 且仅 1 行时，解析器归组门槛（`run>=2 || 第二行是分隔行`）不满足 →
 * 退回段落（报告 §0-⑤ 登记）。colWidths 无 md 表达，丢弃。
 */
function tableMarkdown(content: BlockContent): string {
  const table = normalizeTableContent(content);
  const lines: string[] = [];
  if (table.header) {
    const head = table.rows[0] ?? [];
    lines.push(tableRow(head));
    lines.push(`| ${head.map(() => '---').join(' | ')} |`);
    for (let index = 1; index < table.rows.length; index += 1) {
      lines.push(tableRow(table.rows[index] ?? []));
    }
    return lines.join('\n');
  }
  for (const row of table.rows) {
    lines.push(tableRow(row));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 图片
// ---------------------------------------------------------------------------

/** 缺省 asset 解析：`asset://<hash><ext>` → `files/<hash><ext>`（其余 scheme 原样）。 */
function defaultAssetHref(src: string): string | null {
  const scheme = 'asset://';
  if (src.startsWith(scheme)) {
    return `files/${src.slice(scheme.length)}`;
  }
  return src.length > 0 ? src : null;
}

// ---------------------------------------------------------------------------
// 单块序列化
// ---------------------------------------------------------------------------

export interface SerializeOptions {
  /**
   * 图片 `src`（canonical 形态 `asset://<hash><ext>`）→ 包内相对链接（如 `files/x.png`）。
   * 返回 null = 孤儿附件（文件缺失）→ 落占位注释并与预览清单同步（不静默丢内容）。
   * 缺省：`asset://<hash><ext>` → `files/<hash><ext>`。
   */
  readonly resolveAsset?: (src: string) => string | null;
}

function blockMarkdown(block: BlockSpec, options: SerializeOptions): string {
  const resolveAsset = options.resolveAsset ?? defaultAssetHref;
  switch (block.type) {
    case 'paragraph':
      return inlineText(block.content);
    case 'heading': {
      const raw = block.props['level'];
      const level = typeof raw === 'number' && raw >= 1 ? Math.min(3, Math.floor(raw)) : 2;
      return `${'#'.repeat(level)} ${inlineText(block.content)}`;
    }
    case 'bulleted_list':
      return `- ${inlineText(block.content)}`;
    case 'numbered_list': {
      const raw = block.props['start'];
      const start = typeof raw === 'number' && raw > 0 ? Math.floor(raw) : 1;
      return `${String(start)}. ${inlineText(block.content)}`;
    }
    case 'to_do': {
      const checked = block.props['checked'] === true;
      return `- [${checked ? 'x' : ' '}] ${inlineText(block.content)}`;
    }
    case 'quote': {
      const raw = block.props['icon'];
      const icon = typeof raw === 'string' && raw.length > 0 ? raw : null;
      if (icon !== null) {
        return `> [!${icon}] ${inlineText(block.content)}`;
      }
      return `> ${inlineText(block.content)}`;
    }
    case 'divider':
      return '---';
    case 'code': {
      const raw = block.props['lang'];
      const lang = typeof raw === 'string' ? raw : '';
      const body = typeof block.content === 'string' ? block.content : '';
      return `\`\`\`${lang}\n${body}\n\`\`\``;
    }
    case 'image': {
      const src = typeof block.props['src'] === 'string' ? block.props['src'] : '';
      const name = typeof block.props['name'] === 'string' ? block.props['name'] : '';
      const href = resolveAsset(src);
      if (href === null) {
        return `<!-- 附件缺失: ${src} -->`;
      }
      return `![${name}](${href})`;
    }
    case 'table':
      return tableMarkdown(block.content);
    case 'toggle': {
      const toggle = normalizeToggleContent(block.content);
      const lines = [`> [!toggle] ${toggle.title}`];
      for (const line of toggle.body) {
        lines.push(`> ${line}`);
      }
      return lines.join('\n');
    }
    default:
      // 未知块：按段落收敛（与 pmDocToBlockSpecs 的未知块降级同口径，不静默丢文本）
      return inlineText(block.content);
  }
}

/**
 * BlockSpec[] → Markdown（块间空行分隔；块内多行原样）。
 * 空文本块产出空串 → 被解析器跳过（报告 §0-⑤ 无损边界）。
 */
export function blocksToMarkdown(blocks: readonly BlockSpec[], options: SerializeOptions = {}): string {
  const rendered = blocks
    .map((block) => blockMarkdown(block, options))
    .filter((text) => text.length > 0);
  return rendered.length === 0 ? '' : `${rendered.join('\n\n')}\n`;
}
