/**
 * notion.ts —— Notion「Markdown & CSV」导出包解析器（任务书 §2 notion-zip + §5 降级）。
 *
 * 目录契约（Notion 导出可观察形态，本文件与测试夹具按此对齐）：
 * - 页面 = 目录 `页面名 <32hex>`，目录嵌套 = 页面树父子边；页正文 = 目录内同名 `.md`；
 * - database = 同名子目录 `库名 <32hex>/` 内的 `<库名 <32hex>>.csv`（含 32hex 后缀的
 *   顶层散 CSV 若与某页清理名同名，也归为该页的 database）；
 * - 附件 = md 内相对引用的任意文件（走 A 阶段 markdown.ts 的 asset 逻辑：sha256
 *   内容寻址 + `asset://` 重写）。
 *
 * 降级铁律（§5，绝不静默）——在交给 A 阶段 parseMdPage 之前做**围栏感知的文本预处理**：
 * - 页面引用 `[文本](<32hex>|UUID)` → 纯文本保留原文 + warning；
 * - 块公式 `$$…$$`（单行/多行）→ code 块原文 + warning；行内 `$…$` → 行内 code 原文 + warning；
 * - `:::synced … :::` → quote 占位写明原类型、内容逐行保留在引用内 + warning；
 * - `:::embed <url>` / `:::toc` → quote 占位写明原类型 + warning；
 * - `@提及` → 保留原文 + warning（纯文本，不改写）；
 * - database CSV 中值指向他页标题的列 → relation 候选，一期降级 text + warning（§2）。
 *
 * path 约定：page/collection 的 item.path = **逻辑路径**（清理 32hex 后的标题链，
 * 'A/B' 形态），parentPath 引用父页逻辑路径或 null；同一父下重名页的合并由计划器
 * （plan.ts）做 hash 后缀。warnings 的 path 用源内相对路径（含 32hex 的真实文件路径）。
 */
import { parseMdPage } from './markdown';
import { inferCsv } from './csvInfer';
import { buildPlan } from './types';
import type { ImportItem, ImportPlan, ImportSourceFs, ImportWarning } from './types';

// ---------------------------------------------------------------------------
// Notion 命名契约
// ---------------------------------------------------------------------------

/** 目录/文件名的 32hex 页 id 后缀（`页面名 <32hex>`）；Notion 页 id 实为小写 hex。 */
const NAME_ID = /^(.*)\s+([0-9a-f]{32})$/;

/** 清理 Notion 名称：剥掉尾部 ` <32hex>`；无后缀原样返回。 */
export function cleanNotionName(name: string): string {
  const match = NAME_ID.exec(name.trim());
  return (match?.[1] ?? name.trim()).trim();
}

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

function isPathPrefix(parent: string, child: string): boolean {
  return parent.length > 0 && child.startsWith(`${parent}/`);
}

// ---------------------------------------------------------------------------
// §5 降级：围栏感知的正文预处理（Notion 专有语法 → 安全 markdown + warnings）
// ---------------------------------------------------------------------------

/** 与 markdownPaste.ts:12 / markdown.ts:21 的围栏正则保持一致（注释锚点防漂移）。 */
const FENCE = /^```([A-Za-z0-9_+#-]*)\s*$/;
/** 页面引用：`[文本](32hex)` / `[文本](#32hex)` / `[文本](UUID 连字符形态)`。 */
const PAGE_REF =
  /\[([^\]]*)\]\(\s*#?(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})\s*\)/g;
/** 行内公式：`$...$`（开/闭 `$` 内侧非空白，避免 "$5 and $10" 误判）。 */
const INLINE_MATH = /\$([^\s$][^$\n]*[^\s$]|[^\s$])\$/g;
/** @提及：行首或空白后的 `@词`（避免邮箱 foo@bar 误判）。 */
const MENTION = /(^|\s)@[^\s@]/g;
const SYNCED_START = /^:::synced\b/i;
const SYNCED_END = /^:::\s*$/;
const EMBED_LINE = /^:::embed\s+(.*)$/i;
const TOC_LINE = /^:::toc\b/i;

export function preprocessNotionMarkdown(mdPath: string, text: string): {
  text: string;
  warnings: ImportWarning[];
} {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const warnings: ImportWarning[] = [];
  const degrade = (what: string, note: string) => {
    warnings.push({ path: mdPath, what, action: 'degraded', note });
  };

  let inCodeFence = false;
  let inFormula = false;
  let inSynced = false;
  let syncedLines: string[] = [];
  let pageRefCount = 0;
  let inlineMathCount = 0;
  let mentionCount = 0;

  const flushSynced = () => {
    const joined = syncedLines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('；');
    out.push(`> 📎 此处原为 Synced block（原文 ${syncedLines.length} 行）：${joined}`);
    degrade('Synced block', `${syncedLines.length} 行内容保留为引用占位`);
    syncedLines = [];
    inSynced = false;
  };

  for (const line of lines) {
    if (inSynced) {
      if (SYNCED_END.test(line.trim())) {
        flushSynced();
      } else {
        syncedLines.push(line);
      }
      continue;
    }
    if (FENCE.test(line)) {
      inCodeFence = !inCodeFence;
      out.push(line);
      continue;
    }
    if (inCodeFence) {
      out.push(line);
      continue;
    }
    if (inFormula) {
      // 围栏替代 $$ 定界符：code 块内即公式原文（闭合行不再保留）
      if (line.trim() === '$$') {
        out.push('```');
        inFormula = false;
      } else {
        out.push(line);
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '$$') {
      // 块公式开栏 → code 围栏（原文行逐行保留在围栏内）
      out.push('```');
      inFormula = true;
      degrade('公式', '块公式降级为 code 块原文');
      continue;
    }
    const singleLineFormula = /^\$\$(.+)\$\$$/.exec(trimmed);
    if (singleLineFormula !== null) {
      // 单行块公式 → code 围栏
      out.push('```', singleLineFormula[1] ?? '', '```');
      degrade('公式', '块公式降级为 code 块原文');
      continue;
    }
    if (SYNCED_START.test(trimmed)) {
      inSynced = true;
      syncedLines = [];
      continue;
    }
    const embed = EMBED_LINE.exec(trimmed);
    if (embed !== null) {
      out.push(`> 🔗 此处原为嵌入视图（${embed[1]?.trim() || '无地址'}），一期降级为引用占位`);
      degrade('嵌入视图', '嵌入视图降级为 quote 占位');
      continue;
    }
    if (TOC_LINE.test(trimmed)) {
      out.push('> 📑 此处原为目录（TOC），一期降级为引用占位');
      degrade('目录（TOC）', 'TOC 降级为 quote 占位');
      continue;
    }

    // 行内变换：page-ref → 纯文本；行内公式 → 行内 code；@提及 → 原文保留
    let result = line.replace(PAGE_REF, (_all, label: string) => {
      pageRefCount += 1;
      return label;
    });
    result = result.replace(/\$\$([^\n$]+?)\$\$/g, (all) => {
      inlineMathCount += 1;
      return `\`${all}\``;
    });
    result = result.replace(INLINE_MATH, (all) => {
      inlineMathCount += 1;
      return `\`${all}\``;
    });
    mentionCount += result.match(MENTION)?.length ?? 0;

    out.push(result);
  }

  if (inSynced) {
    flushSynced(); // 未闭合的 synced 块照常占位（不静默）
  }
  if (inFormula) {
    out.push('```'); // 平衡围栏，防吞后续内容
  }
  if (pageRefCount > 0) {
    degrade('页面引用', `${pageRefCount} 处 page-ref 降级为纯文本保留原文`);
  }
  if (inlineMathCount > 0) {
    degrade('行内公式', `${inlineMathCount} 处行内公式降级为行内 code 原文`);
  }
  if (mentionCount > 0) {
    degrade('提及', `${mentionCount} 处 @提及保留原文`);
  }

  return { text: out.join('\n'), warnings };
}

// ---------------------------------------------------------------------------
// 页面树
// ---------------------------------------------------------------------------

interface PageNode {
  /** md 文件的源内路径（附件解析用） */
  mdPath: string;
  /** 页面节点目录（canonical 页 = 自身同名目录；散 md = 所在目录） */
  dir: string;
  /** 清理 32hex 后的页面标题 */
  title: string;
  /** 逻辑路径（标题链，'A/B'） */
  logical: string;
  /** 父页逻辑路径（无父页 → null） */
  parentLogical: string | null;
}

function decode(value: string | Uint8Array): string {
  return typeof value === 'string' ? value : new TextDecoder().decode(value);
}

/**
 * 收集页面节点并按树先序（nodeDir 字典序 = 父目录必为前缀、必排在前）排序。
 * canonical 形态：`…/X <id>/X <id>.md`；散 md（同目录多页）按 md-dir 语义挂在所在目录下。
 */
function collectPageNodes(fs: ImportSourceFs): PageNode[] {
  const mdPaths = fs
    .list()
    .filter((path) => /\.md$/i.test(path))
    .map((path) => ({ path, dir: dirname(path) }))
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const nodes: PageNode[] = [];
  for (const { path, dir } of mdPaths) {
    const title = cleanNotionName(stripExt(basename(path)));
    // 父页 = nodeDir 是本节点目录严格前缀的**最深**已见节点（先序保证其已出现）
    let parentDir = '';
    let parentLogical: string | null = null;
    for (const candidate of nodes) {
      if (isPathPrefix(candidate.dir, dir) && candidate.dir.length > parentDir.length) {
        parentDir = candidate.dir;
        parentLogical = candidate.logical;
      }
    }
    nodes.push({
      mdPath: path,
      dir,
      title,
      logical: parentLogical !== null ? `${parentLogical}/${title}` : title,
      parentLogical,
    });
  }
  return nodes;
}

/** 围栏感知预处理后的派生 fs：md 文本替换为净化版，其余（附件/CSV）透传。 */
function derivedFs(fs: ImportSourceFs, transformed: Map<string, string>): ImportSourceFs {
  return {
    list: () => fs.list(),
    read: (path: string) => (transformed.has(path) ? (transformed.get(path) as string) : fs.read(path)),
  };
}

// ---------------------------------------------------------------------------
// database（同名子目录 + CSV）
// ---------------------------------------------------------------------------

/** 从 CSV 文本推断 collection 条目 + relation 候选 warning（§2：不重建跨页 relation）。 */
function databaseItem(
  csvPath: string,
  text: string,
  dbTitle: string,
  parentLogical: string | null,
  pageTitleSet: ReadonlySet<string>,
): { item: ImportItem; relationWarnings: ImportWarning[] } {
  const { schema, records } = inferCsv(text);
  const path = parentLogical !== null ? `${parentLogical}/${dbTitle}` : `${dbTitle}/${dbTitle}`;
  const item: ImportItem = {
    op: 'collection',
    path,
    title: dbTitle,
    parentPath: parentLogical,
    schema,
    records,
  };

  const relationWarnings: ImportWarning[] = [];
  for (const [pid, property] of Object.entries(schema.properties)) {
    if (pid === schema.title_pid || property.type !== 'text') {
      continue;
    }
    let hits = 0;
    for (const record of records) {
      const value = record[pid];
      if (typeof value === 'string' && value.length > 0 && pageTitleSet.has(value)) {
        hits += 1;
      }
    }
    if (hits > 0) {
      relationWarnings.push({
        path: csvPath,
        what: 'relation 候选',
        action: 'degraded',
        note: `列 “${property.name}” 有 ${hits} 个值指向他页，一期降级为 text（不做跨页 relation 重建）`,
      });
    }
  }
  return { item, relationWarnings };
}

// ---------------------------------------------------------------------------
// 解析器入口
// ---------------------------------------------------------------------------

/**
 * notion-zip 源：Notion「Markdown & CSV」导出目录（已解压为 ImportSourceFs）→ ImportPlan。
 * items 有序 = 树先序（页面按 nodeDir 字典序，父必先于子）；database collection 追加在
 * 页面之后（其 parentPath 页必已在前）。
 */
export function parseNotionZip(fs: ImportSourceFs, rootName: string): ImportPlan {
  const nodes = collectPageNodes(fs);
  const pageTitleSet = new Set(nodes.map((node) => node.title));

  const items: ImportItem[] = [];
  const warnings: ImportWarning[] = [];
  const transformed = new Map<string, string>();

  for (const node of nodes) {
    const pre = preprocessNotionMarkdown(node.mdPath, decode(fs.read(node.mdPath)));
    for (const warning of pre.warnings) {
      warnings.push(warning);
    }
    transformed.set(node.mdPath, pre.text);
  }

  const vfs = derivedFs(fs, transformed);
  for (const node of nodes) {
    const page = parseMdPage(vfs, node.mdPath, node.title);
    items.push({
      op: 'page',
      path: node.logical,
      title: page.title,
      parentPath: node.parentLogical,
      blocks: page.blocks,
    });
    items.push(...page.assets);
    warnings.push(...page.warnings);
  }

  // database：① `库名 <32hex>/` 目录内的 CSV（canonical）；② 顶层散 CSV 清理名与某页同名；
  // 都匹配不上 → 挂根 + warning（不静默）。
  // D 阶段真包校准：Notion 对每个 database 导出两份 CSV —— `库名 <32hex>.csv`
  // （当前视图，仅可见列）+ `库名 <32hex>_all.csv`（全属性）。配对存在时以 _all 那份
  // 建库（列全、不丢属性），plain 那份跳过并记 skipped-duplicate warning；
  // title 统一清理掉 `_all` 后缀（两源同库同名）。
  const csvEntries = fs
    .list()
    .filter((path) => /\.csv$/i.test(path))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((csvPath) => {
      const dir = dirname(csvPath);
      const rawStem = stripExt(basename(csvPath));
      const isAll = rawStem.endsWith('_all');
      const baseStem = isAll ? rawStem.slice(0, rawStem.length - '_all'.length) : rawStem;
      const canonical = NAME_ID.test(basename(dir));
      // canonical 库以目录名定名；散 CSV 以（剥 `_all` 后的）清理名定名
      const dbTitle = canonical ? cleanNotionName(basename(dir)) : cleanNotionName(baseStem);
      return { csvPath, dir, canonical, isAll, dbTitle, pairStem: baseStem.trim() };
    });
  // 配对键 = 目录 + 剥 `_all` 后的原始 stem（含 32hex id；同目录同名「无标题」库靠
  // id 区分）；组内存在 _all → 只由首个 _all 建库，其余成员（plain 及多余 _all）跳过。
  // relation 候选检测随之每库只报一次（仅建库源参与）。
  const pairKeyOf = (entry: (typeof csvEntries)[number]): string => `${entry.dir}\u0000${entry.pairStem}`;
  const chosenAll = new Map<string, string>();
  for (const entry of csvEntries) {
    if (entry.isAll && !chosenAll.has(pairKeyOf(entry))) {
      chosenAll.set(pairKeyOf(entry), entry.csvPath);
    }
  }

  const hostUsedPaths = new Set<string>(); // 本批已发的孤儿 collection 宿主 path（防互相撞名）
  for (const entry of csvEntries) {
    const chosenPath = chosenAll.get(pairKeyOf(entry));
    if (chosenPath !== undefined && chosenPath !== entry.csvPath) {
      // 配对存在：当前视图 CSV 由 _all 全属性导出替代，跳过不建库（不静默）
      warnings.push({
        path: entry.csvPath,
        what: 'CSV 重复导出',
        action: 'skipped-duplicate',
        note: `当前视图 CSV 由 _all 全属性导出替代（“${entry.dbTitle}” 已按 _all 版本建库）`,
      });
      continue;
    }

    let parentLogical: string | null;
    if (entry.canonical) {
      const owner = nodes.find((node) => node.dir === entry.dir);
      if (owner !== undefined) {
        parentLogical = owner.logical; // 页面目录内同放的 CSV
      } else {
        parentLogical = null;
        let parentDir = '';
        for (const candidate of nodes) {
          if (isPathPrefix(candidate.dir, entry.dir) && candidate.dir.length > parentDir.length) {
            parentDir = candidate.dir;
            parentLogical = candidate.logical;
          }
        }
      }
    } else {
      const owner = nodes.find((node) => node.title === entry.dbTitle && node.dir === entry.dir);
      parentLogical = owner !== undefined ? owner.logical : null;
      if (parentLogical === null) {
        const byName = nodes.find((node) => node.title === entry.dbTitle);
        parentLogical = byName !== undefined ? byName.logical : null;
      }
    }

    if (parentLogical === null) {
      warnings.push({
        path: entry.csvPath,
        what: 'CSV 数据库',
        action: 'degraded',
        note: `未找到同名页面目录，collection “${entry.dbTitle}” 挂为根级`,
      });
    }

    const { item, relationWarnings } = databaseItem(
      entry.csvPath,
      decode(fs.read(entry.csvPath)),
      entry.dbTitle,
      parentLogical,
      pageTitleSet,
    );
    // 孤儿 collection（parentPath=null）必须先发一个宿主页：schema 层 collection.page_id
    // 非空、执行器对无宿主页的 collection 直接 throw（真包 CDP 抓到的契约破口）。
    // 约定同 parseCsvFile：空正文页，collection.parentPath 指向该页。宿主 path 必须
    // 避让已有页名与本批已发宿主（真包有 8 个孤儿「_all」散表且含重名「无标题」），
    // 用库的 32hex id 前 6 位作后缀——绕开 plan.ts 的 hash 重命名（它会改宿主 path
    // 而 collection.parentPath 不跟着改，解析必断）。
    if (item.parentPath === null) {
      let hostPath = item.title;
      if (pageTitleSet.has(hostPath) || hostUsedPaths.has(hostPath)) {
        const idSuffix = /([0-9a-f]{6})[0-9a-f]{26}$/.exec(entry.pairStem)?.[1] ?? hostPath.length.toString(16);
        hostPath = `${item.title}-${idSuffix}`;
      }
      hostUsedPaths.add(hostPath);
      items.push({
        op: 'page',
        path: hostPath,
        title: item.title,
        parentPath: null,
        blocks: [],
      });
      items.push({ ...item, path: `${hostPath}/${item.title}`, parentPath: hostPath });
      warnings.push(...relationWarnings);
      continue;
    }
    items.push(item);
    warnings.push(...relationWarnings);
  }

  return buildPlan({ kind: 'notion-zip', rootName }, items, warnings);
}
