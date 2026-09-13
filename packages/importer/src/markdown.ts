/**
 * markdown.ts —— md-file / md-dir 源解析器（任务书 §2）。
 *
 * 铁律：**不重写 markdown 解析器**——正文一律走 @septcats/editor 的
 * parseMarkdown（正向）→ pmDocToBlockSpecs（反向，真相层 BlockSpec[]）；
 * 本文件只做 markdownPaste 覆盖之外的**行级预处理/后处理**：
 * - front-matter（title/tags 简单子集）；
 * - 目录递归 → 页面树（parentPath）；
 * - 图片 `![]()`：本地相对路径 → sha256 内容寻址 asset 重写（§0.4），
 *   http(s) 外链 → 保留 URL + warning；
 * - GFM 表格 → 一期降级为 code 块原文 + warning。
 * 图片与表格都在 ``` 围栏**之外**才生效（围栏内原样交给 parseMarkdown）。
 */
import { createHash } from 'node:crypto';
import { parseMarkdown, pmDocToBlockSpecs } from '@septcats/editor';
import type { PMNodeJSON } from '@septcats/editor';
import { buildPlan, toBytes } from './types';
import type { BlockSpec, ImportItem, ImportPlan, ImportSourceFs, ImportWarning } from './types';

/** 与 markdownPaste.ts:12 的围栏正则保持一致（该处未导出，注释锚点防漂移）。 */
const FENCE = /^```([A-Za-z0-9_+#-]*)\s*$/;
/** 图片内联语法（markdownPaste 不覆盖图片，导入期在此提取）。 */
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const GFM_ROW = /^\s*\|.*\|\s*$/;
const GFM_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;
const IMAGE_EXT = /\.([A-Za-z0-9]+)$/;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

function extOf(path: string): string {
  const match = IMAGE_EXT.exec(basename(path));
  return match === null ? '' : `.${(match[1] ?? '').toLowerCase()}`;
}

/** 把 md 文件内的相对引用解析为源内路径（POSIX 归一，'..' 收敛到根内）。 */
function resolveRef(mdPath: string, ref: string): string {
  const dir = dirname(mdPath);
  const parts = dir.length === 0 ? [] : dir.split('/');
  for (const part of ref.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function textNode(value: string): PMNodeJSON {
  return { type: 'text', text: value };
}

/** 标签 callout = quote + props.icon（schema-v1 §3：callout 不另设类型）。 */
function tagsCallout(tags: string[]): BlockSpec {
  const label = `标签: ${tags.join(', ')}`;
  return {
    type: 'quote',
    props: { icon: '🏷️' },
    content: { type: 'doc', content: [{ type: 'paragraph', content: [textNode(label)] }] },
  };
}

// ---------------------------------------------------------------------------
// front-matter（简单子集：title / tags）
// ---------------------------------------------------------------------------

interface FrontMatter {
  title: string | null;
  tags: string[];
  bodyStart: number; // 正文起始行号（front-matter 结束后一行）
}

/** 识别并解析 front-matter；无 front-matter（首行非 ---）返回缺省。 */
function parseFrontMatter(lines: string[]): FrontMatter {
  if ((lines[0] ?? '').trim() !== '---') {
    return { title: null, tags: [], bodyStart: 0 };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return { title: null, tags: [], bodyStart: 0 }; // 未闭合 → 按普通正文处理
  }
  const matter: FrontMatter = { title: null, tags: [], bodyStart: close + 1 };
  for (let i = 1; i < close; i += 1) {
    const line = lines[i] ?? '';
    const title = /^title:\s*(.*)$/.exec(line);
    if (title !== null) {
      matter.title = (title[1] ?? '').trim().replace(/^["']|["']$/g, '');
      continue;
    }
    const inlineTags = /^tags:\s*\[(.*)\]\s*$/.exec(line);
    if (inlineTags !== null) {
      matter.tags = (inlineTags[1] ?? '')
        .split(',')
        .map((tag) => tag.trim().replace(/^["']|["']$/g, ''))
        .filter((tag) => tag.length > 0);
      continue;
    }
    if (/^tags:\s*$/.test(line)) {
      // 列表形态：后续 `  - a` 行
      for (let j = i + 1; j < close; j += 1) {
        const item = /^-\s+(.*)$/.exec((lines[j] ?? '').trim());
        if (item === null) {
          break;
        }
        matter.tags.push((item[1] ?? '').trim());
        i = j;
      }
    }
  }
  return matter;
}

// ---------------------------------------------------------------------------
// 正文扫描（图片/表格提取，围栏感知）
// ---------------------------------------------------------------------------

interface AssetEntry {
  item: ImportItem;
}

class BodyScanner {
  blocks: BlockSpec[] = [];
  warnings: ImportWarning[] = [];
  private assets = new Map<string, AssetEntry>();
  private buffer: string[] = [];

  constructor(
    private readonly mdPath: string,
    private readonly fs: ImportSourceFs,
    private readonly knownFiles: ReadonlySet<string>,
  ) {}

  /** 扫描正文行，产出 blocks/warnings/assets。 */
  run(lines: string[]): void {
    let fenced = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (fenced) {
        this.buffer.push(line);
        if (FENCE.test(line)) {
          fenced = false;
        }
        continue;
      }
      if (FENCE.test(line)) {
        fenced = true;
        this.buffer.push(line);
        continue;
      }
      if (this.tryTable(lines, i, (next) => (i = next))) {
        continue;
      }
      this.lineWithImages(line);
    }
    this.flushText();
  }

  assetItems(): ImportItem[] {
    return [...this.assets.values()].map((entry) => entry.item);
  }

  private flushText(): void {
    if (this.buffer.some((line) => line.trim().length > 0)) {
      this.blocks.push(...pmDocToBlockSpecs(parseMarkdown(this.buffer.join('\n'))));
    }
    this.buffer = [];
  }

  /** GFM 表格（当前行是行、下一行是分隔行）→ 整表降级 code 块 + warning。 */
  private tryTable(lines: string[], start: number, jump: (next: number) => void): boolean {
    const first = lines[start] ?? '';
    const second = lines[start + 1] ?? '';
    if (!GFM_ROW.test(first) || !GFM_SEPARATOR.test(second)) {
      return false;
    }
    if (!second.includes('-') || !second.includes('|')) {
      return false;
    }
    const rows: string[] = [first, second];
    let end = start + 2;
    while (end < lines.length && GFM_ROW.test(lines[end] ?? '')) {
      rows.push(lines[end] ?? '');
      end += 1;
    }
    this.flushText();
    this.blocks.push({ type: 'code', props: { lang: '' }, content: rows.join('\n') });
    this.warnings.push({
      path: this.mdPath,
      what: 'GFM 表格',
      action: 'degraded',
      note: `表格（${rows.length} 行）一期降级为 code 块原文`,
    });
    jump(end);
    return true;
  }

  /** 单行内的图片提取：图片前后文本保持顺序，本地附件重写为 asset://。 */
  private lineWithImages(line: string): void {
    IMAGE.lastIndex = 0;
    if (!IMAGE.test(line)) {
      this.buffer.push(line);
      return;
    }
    IMAGE.lastIndex = 0;
    let cursor = 0;
    let match = IMAGE.exec(line);
    while (match !== null) {
      const before = line.slice(cursor, match.index);
      if (before.trim().length > 0) {
        this.buffer.push(before);
      }
      this.flushText();
      this.emitImage(match[1] ?? '', match[2] ?? '');
      cursor = match.index + match[0].length;
      match = IMAGE.exec(line);
    }
    const rest = line.slice(cursor);
    if (rest.trim().length > 0) {
      this.buffer.push(rest);
    }
  }

  private emitImage(alt: string, ref: string): void {
    const name = alt.length > 0 ? alt : stripExt(basename(ref));
    if (/^https?:\/\//i.test(ref)) {
      // §2：http 外链 → 保留 URL + bookmark 化 warning
      this.blocks.push({
        type: 'image',
        props: { src: ref, name },
        content: null,
      });
      this.warnings.push({
        path: this.mdPath,
        what: 'http 外链图片',
        action: 'degraded',
        note: `外链 ${ref} 保留 URL 原样（bookmark 化候选）`,
      });
      return;
    }
    const resolved = resolveRef(this.mdPath, ref);
    if (!this.knownFiles.has(resolved)) {
      // 附件缺失：不静默丢内容——保留原 src 并出 warning
      this.blocks.push({ type: 'image', props: { src: ref, name }, content: null });
      this.warnings.push({
        path: this.mdPath,
        what: '本地附件缺失',
        action: 'degraded',
        note: `${ref} 在源内不存在，src 原样保留`,
      });
      return;
    }
    const bytes = toBytes(this.fs.read(resolved));
    const hash = sha256Hex(bytes);
    const ext = extOf(ref);
    if (!this.assets.has(hash)) {
      this.assets.set(hash, { item: { op: 'asset', hash, ext, bytes } });
    }
    // §0.4：image 块 props = {src:'asset://<hash><ext>', name}
    this.blocks.push({
      type: 'image',
      props: { src: `asset://${hash}${ext}`, name },
      content: null,
    });
  }
}

// ---------------------------------------------------------------------------
// 解析器入口
// ---------------------------------------------------------------------------

interface PageParsed {
  title: string;
  tags: string[];
  blocks: BlockSpec[];
  assets: ImportItem[];
  warnings: ImportWarning[];
}

/** 单个 md 文件 → 页语义（title/tags/blocks/assets/warnings）。 */
export function parseMdPage(fs: ImportSourceFs, path: string, fallbackTitle: string): PageParsed {
  const raw = fs.read(path);
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const matter = parseFrontMatter(lines);

  const scanner = new BodyScanner(path, fs, new Set(fs.list()));
  scanner.run(lines.slice(matter.bodyStart));

  const blocks = matter.tags.length > 0 ? [tagsCallout(matter.tags), ...scanner.blocks] : scanner.blocks;
  if (matter.tags.length > 0) {
    scanner.warnings.push({
      path,
      what: 'front-matter tags',
      action: 'degraded',
      note: `标签 [${matter.tags.join(', ')}] 降级为页首 callout 块列标签`,
    });
  }

  return {
    title: matter.title !== null && matter.title.length > 0 ? matter.title : fallbackTitle,
    tags: matter.tags,
    blocks,
    assets: scanner.assetItems(),
    warnings: scanner.warnings,
  };
}

/** md-file：单文件 → 单页 plan。 */
export function parseMdFile(fs: ImportSourceFs, path: string): ImportPlan {
  const page = parseMdPage(fs, path, stripExt(basename(path)));
  const items: ImportItem[] = [
    { op: 'page', path, title: page.title, parentPath: null, blocks: page.blocks },
    ...page.assets,
  ];
  return buildPlan({ kind: 'md-file', rootName: stripExt(basename(path)) }, items, page.warnings);
}

/**
 * 树先序排序：当前目录的 md 文件（按名字典序）在前，子目录（按名字典序）
 * 递归在后——保证父层页面先于子层出现。
 */
function preOrderPaths(paths: string[]): string[] {
  const filesByDir = new Map<string, string[]>();
  const dirs = new Set<string>();
  for (const path of paths) {
    const dir = dirname(path);
    dirs.add(dir);
    const bucket = filesByDir.get(dir);
    if (bucket === undefined) {
      filesByDir.set(dir, [path]);
    } else {
      bucket.push(path);
    }
  }
  const out: string[] = [];
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  for (const bucket of filesByDir.values()) {
    bucket.sort(compare);
  }
  const childDirsOf = (dir: string): string[] =>
    [...dirs]
      .filter((d) =>
        d === dir
          ? false
          : dir.length === 0
            ? !d.includes('/')
            : d.startsWith(`${dir}/`) && !d.slice(dir.length + 1).includes('/'),
      )
      .sort(compare);
  const walk = (dir: string) => {
    for (const file of filesByDir.get(dir) ?? []) {
      out.push(file);
    }
    for (const child of childDirsOf(dir)) {
      walk(child);
    }
  };
  walk('');
  return out;
}

/** md-dir：目录递归建树（*.md = 页面，所在目录 = parentPath）→ plan。 */
export function parseMdDir(fs: ImportSourceFs, rootName: string): ImportPlan {
  const mdPaths = preOrderPaths(fs.list().filter((path) => /\.md$/i.test(path)));
  const items: ImportItem[] = [];
  const warnings: ImportWarning[] = [];

  for (const path of mdPaths) {
    const parent = dirname(path);
    const page = parseMdPage(fs, path, stripExt(basename(path)));
    items.push({
      op: 'page',
      path,
      title: page.title,
      parentPath: parent.length > 0 ? parent : null,
      blocks: page.blocks,
    });
    items.push(...page.assets);
    warnings.push(...page.warnings);
  }

  return buildPlan({ kind: 'md-dir', rootName }, items, warnings);
}
