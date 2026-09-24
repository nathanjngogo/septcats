/**
 * model.ts —— 真相层块模型（BlockDoc / Block）与 ProseMirror 文档（投影）的双向映射。
 *
 * 铁律（任务书 §0.1）：**真相是 M3 块模型，PM doc 只是它的投影**。
 * 本文件是纯函数区（不 import @tiptap/*），可在纯 Node 下做「每块型 roundtrip 恒等」测试。
 *
 * 归一化约定（roundtrip 恒等的边界，写进 fixtures 与报告）：
 * - 文本类块的 content 恒为 PM doc，且**恰好一个 paragraph 包裹内联内容**；
 *   空内联时该 paragraph 不写 content 键（`{type:'paragraph'}`）。
 * - numbered_list 的 props 缺 start 即视为 1（不写默认值）；to_do 恒写 checked；
 *   quote 的 icon 仅在有值时出现；code 恒写 lang（可为 ''）；image 恒写 file_id。
 * - divider / image 的 content 恒为 null；code 的 content 恒为纯文本 string。
 * - R25（T76-01）：table 的 content 恒为 `{rows,header[,colWidths]}`、toggle 恒为
 *   `{title,body}`（结构化对象，normalize 归一，见 content.ts）；两者的 PM 侧是
 *   **atom 节点**（attrs 逐字同名），投影↔反投影不引入第二套字段名。
 * - 未知 type（v1 拒收，schema-v1 §3）：投影为 paragraph + attrs._unsupported/_raw，
 *   反投影时**原样恢复** type 与 props（不丢数据），UI 层灰显「不支持的块」。
 */
import { z } from 'zod';
import { sortBetween, ulid } from '@septcats/core';
import type { Lamport, TargetTable } from '@septcats/core';
import {
  normalizeTableContent,
  normalizeToggleContent,
  tableContentSchema,
  toggleContentSchema,
} from './content';

/** Op 的目标表名（复用 core 的 TargetTable 语义）。 */
export const BLOCK_TARGET_TABLE: TargetTable = 'block';

/**
 * schema-v1 §3 冻结的 9 种块类型 + R25（T76-01）新增 2 种单块自包含内容块
 * （table / toggle，结构化 content JSON，见 content.ts 顶部）。
 */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulleted_list',
  'numbered_list',
  'to_do',
  'quote',
  'code',
  'divider',
  'image',
  'table',
  'toggle',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set<string>(BLOCK_TYPES);

export function isBlockType(value: string): value is BlockType {
  return KNOWN_BLOCK_TYPES.has(value);
}

/**
 * 真相层块类型 → PM 节点名。ProseMirror 的 schema 不允许同名 node 与 mark
 * （RangeError: code can not be both a node and a mark），而 schema-v1 §3 同时
 * 规定块 `code` 与内联 mark `code`——**真相层类型名不可动**（它是持久化契约），
 * 因此只在投影边界把块节点改名 codeBlock，其余类型两名一致。
 */
export const PM_NODE_NAME_BY_BLOCK_TYPE: Readonly<Record<string, string>> = { code: 'codeBlock' };
/** PM 节点名 → 真相层块类型（反查表，由上式导出，保证两表单源）。 */
const BLOCK_TYPE_BY_PM_NODE_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(PM_NODE_NAME_BY_BLOCK_TYPE).map(([from, to]) => [to, from] as const),
);

export function pmNodeNameOf(blockType: string): string {
  return PM_NODE_NAME_BY_BLOCK_TYPE[blockType] ?? blockType;
}
export function blockTypeOfPmNode(nodeName: string): string {
  return BLOCK_TYPE_BY_PM_NODE_NAME.get(nodeName) ?? nodeName;
}

/** 未知块的降级标记（投影为 paragraph 时挂在 attrs 上）。 */
export const UNSUPPORTED_ATTR = '_unsupported';
/** 未知块的原 props 快照（置于 attrs，反投影时还原）。 */
export const RAW_ATTR = '_raw';

// ---------------------------------------------------------------------------
// PM 文档 JSON（PMDocJSON）
// ---------------------------------------------------------------------------

/**
 * 用 type alias（而非 interface）声明：对象字面量类型才会获得**隐式索引签名**，
 * 从而可直接赋给 Tiptap 的 `JSONContent`（其含 `[key: string]: any`）。
 */
export type PMMarkJSON = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type PMNodeJSON = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNodeJSON[];
  marks?: PMMarkJSON[];
  text?: string;
};

export type PMDocJSON = {
  type: 'doc';
  content?: PMNodeJSON[];
};

export const pmMarkSchema = z.object({
  type: z.string().min(1),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

export const pmNodeSchema: z.ZodType<PMNodeJSON> = z.lazy(() =>
  z.object({
    type: z.string().min(1),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(pmNodeSchema).optional(),
    marks: z.array(pmMarkSchema).optional(),
    text: z.string().optional(),
  }),
) as unknown as z.ZodType<PMNodeJSON>;

export const pmDocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(pmNodeSchema).optional(),
});

/** 校验并（浅）规范化一份 PM doc；非法输入 return null（调用方决定降级策略）。 */
export function parsePMDoc(value: unknown): PMDocJSON | null {
  const parsed = pmDocSchema.safeParse(value);
  return parsed.success ? (parsed.data as PMDocJSON) : null;
}

// ---------------------------------------------------------------------------
// 块模型（BlockDoc / Block）
// ---------------------------------------------------------------------------

/** 块 content：PM doc（文本类）| 纯文本（code）| 结构化对象（table/toggle）| null（divider/image）。 */
export const blockContentSchema = z.union([
  pmDocSchema,
  z.string(),
  tableContentSchema,
  toggleContentSchema,
  z.null(),
]);
export type BlockContent = z.infer<typeof blockContentSchema>;

/**
 * 编辑器侧的块形状。与 core 的 blockSchema 同构，唯一的差异是 content 被收窄为
 * `PMDocJSON | string | null`（core 的 payloadSchema 是宽 record，无法表达 code 的纯文本）。
 * 实体级的 id/version/alive 语义与 core 完全一致。
 */
export const blockSchema = z.object({
  id: z.string().min(1).max(128),
  page_id: z.string().min(1).max(128),
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  content: blockContentSchema,
  parent_id: z.string().nullable(),
  sort_key: z.string().min(1),
  alive: z.number().int().min(0).max(1),
  version: z.number().int().min(0),
  last_edited: z.number().int().nonnegative(),
});
export type Block = z.infer<typeof blockSchema>;

export const blockDocSchema = z.object({
  pageId: z.string().min(1),
  blocks: z.array(blockSchema),
});
export type BlockDoc = z.infer<typeof blockDocSchema>;

export function emptyBlockDoc(pageId: string): BlockDoc {
  return { pageId, blocks: [] };
}

/** 兄弟序（base62 升序，等键时按 id 稳定决胜）。 */
export function compareBlocksBySortKey(a: Block, b: Block): number {
  if (a.sort_key !== b.sort_key) {
    return a.sort_key < b.sort_key ? -1 : 1;
  }
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

/** 存活块按文档顺序（数组顺序即视觉顺序，sort_key 是持久化兄弟序）。 */
export function liveBlocks(doc: BlockDoc): Block[] {
  return doc.blocks.filter((block) => block.alive === 1);
}

/** 块 → Op payload（upsert 的整对象；patch 也可复用其字段）。 */
export function blockPayload(block: Block): Record<string, unknown> {
  return {
    page_id: block.page_id,
    type: block.type,
    props: cloneJson(block.props),
    content: cloneJson(block.content),
    parent_id: block.parent_id,
    sort_key: block.sort_key,
    alive: block.alive,
    last_edited: block.last_edited,
  };
}

/** JSON 语义深拷贝（丢弃 undefined，与 core.stableStringify 一致）。 */
export function cloneJson<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// 内联内容助手
// ---------------------------------------------------------------------------

/** content 是否为 PM doc 形态（R25 起 content 还有结构化对象两形态，须先收窄）。 */
export function isPmDocContent(content: BlockContent): content is PMDocJSON {
  return (
    content !== null &&
    typeof content === 'object' &&
    !Array.isArray(content) &&
    (content as { type?: unknown }).type === 'doc'
  );
}

/** 取出块 content 里的内联节点（PM doc 的唯一 paragraph 的 content）。 */
export function inlineNodes(content: BlockContent): PMNodeJSON[] {
  if (!isPmDocContent(content)) {
    return [];
  }
  const paragraph = (content.content ?? [])[0];
  if (paragraph === undefined) {
    return [];
  }
  return paragraph.content ?? [];
}

/** 把内联节点包成块 content（空内联 → 空 paragraph，不写 content 键）。 */
export function inlineDoc(nodes: PMNodeJSON[]): PMDocJSON {
  if (nodes.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return { type: 'doc', content: [{ type: 'paragraph', content: nodes }] };
}

/** 便捷构造：`inlineDoc([text('你好')])`。 */
export function text(value: string, marks?: PMMarkJSON[]): PMNodeJSON {
  const node: PMNodeJSON = { type: 'text', text: value };
  if (marks !== undefined && marks.length > 0) {
    node.marks = marks;
  }
  return node;
}

// ---------------------------------------------------------------------------
// blocks → PM doc
// ---------------------------------------------------------------------------

function blockIdAttrs(block: Block): Record<string, unknown> {
  return { id: block.id };
}

function withContent(node: PMNodeJSON, inline: PMNodeJSON[]): PMNodeJSON {
  if (inline.length === 0) {
    return node;
  }
  return { ...node, content: inline };
}

function headingLevelOf(block: Block): number {
  const level = block.props['level'];
  if (typeof level === 'number' && Number.isFinite(level)) {
    return Math.min(3, Math.max(1, Math.trunc(level)));
  }
  return 2;
}

/** 单块 → 投影节点（确定性：同输入同输出）。 */
export function blockToPMNode(block: Block): PMNodeJSON {
  const base = blockIdAttrs(block);
  const inline = inlineNodes(block.content);

  switch (block.type) {
    case 'paragraph':
      return withContent({ type: 'paragraph', attrs: base }, inline);

    case 'heading':
      return withContent(
        { type: 'heading', attrs: { ...base, level: headingLevelOf(block) } },
        inline,
      );

    case 'bulleted_list':
      return withContent({ type: 'bulleted_list', attrs: base }, inline);

    case 'numbered_list': {
      const attrs: Record<string, unknown> = { ...base };
      const start = block.props['start'];
      if (typeof start === 'number' && start !== 1) {
        attrs['start'] = start;
      }
      return withContent({ type: 'numbered_list', attrs }, inline);
    }

    case 'to_do':
      return withContent(
        { type: 'to_do', attrs: { ...base, checked: block.props['checked'] === true } },
        inline,
      );

    case 'quote': {
      const attrs: Record<string, unknown> = { ...base };
      const icon = block.props['icon'];
      if (typeof icon === 'string' && icon.length > 0) {
        attrs['icon'] = icon;
      }
      return withContent({ type: 'quote', attrs }, inline);
    }

    case 'code': {
      const attrs: Record<string, unknown> = {
        ...base,
        lang: typeof block.props['lang'] === 'string' ? block.props['lang'] : '',
      };
      if (block.props['wrap'] === true) {
        attrs['wrap'] = true;
      }
      const codeText = typeof block.content === 'string' ? block.content : '';
      const node: PMNodeJSON = { type: pmNodeNameOf('code'), attrs };
      if (codeText.length > 0) {
        node.content = [{ type: 'text', text: codeText }];
      }
      return node;
    }

    case 'divider':
      return { type: 'divider', attrs: base };

    case 'image': {
      const attrs: Record<string, unknown> = {
        ...base,
        file_id: typeof block.props['file_id'] === 'string' ? block.props['file_id'] : '',
      };
      const caption = block.props['caption'];
      if (typeof caption === 'string') {
        attrs['caption'] = caption;
      }
      const width = block.props['width'];
      if (typeof width === 'number') {
        attrs['width'] = width;
      }
      return { type: 'image', attrs };
    }

    // R25（T76-01）：单块自包含内容块——PM attr 名与 content 键逐字同构（零映射表）。
    // colWidths 缺省写 null（attr 形态恒定，roundtrip 恒等由 normalize 保证）。
    case 'table': {
      const content = normalizeTableContent(block.content);
      return {
        type: 'table',
        attrs: {
          ...base,
          rows: content.rows,
          header: content.header,
          colWidths: content.colWidths ?? null,
        },
      };
    }

    case 'toggle': {
      const content = normalizeToggleContent(block.content);
      return {
        type: 'toggle',
        attrs: { ...base, title: content.title, body: content.body },
      };
    }

    default: {
      // schema-v1 §3：未知 type → paragraph + props 原样存 _raw，不丢数据。
      return withContent(
        {
          type: 'paragraph',
          attrs: { ...base, [UNSUPPORTED_ATTR]: block.type, [RAW_ATTR]: cloneJson(block.props) },
        },
        inline,
      );
    }
  }
}

/** 全部存活块 → PM doc（数组顺序即文档顺序）。 */
export function blocksToPMDoc(doc: BlockDoc): PMDocJSON {
  const content: PMNodeJSON[] = [];
  for (const block of doc.blocks) {
    if (block.alive === 0) {
      continue;
    }
    content.push(blockToPMNode(block));
  }
  return { type: 'doc', content };
}

// ---------------------------------------------------------------------------
// PM doc → blocks
// ---------------------------------------------------------------------------

function attrString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function textOfNode(node: PMNodeJSON): string {
  let out = '';
  for (const child of node.content ?? []) {
    out += child.text ?? '';
  }
  return out;
}

interface NodeSemantics {
  type: string;
  props: Record<string, unknown>;
  content: BlockContent;
}

function semanticsOf(node: PMNodeJSON): NodeSemantics {
  const attrs = node.attrs ?? {};
  const inline = node.content ?? [];
  // 投影边界的节点名（如 codeBlock）先还原为真相层块类型再分派
  const blockType = blockTypeOfPmNode(node.type);

  if (typeof attrs[UNSUPPORTED_ATTR] === 'string') {
    const raw = attrs[RAW_ATTR];
    return {
      type: attrs[UNSUPPORTED_ATTR],
      props: raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? cloneJson(raw as Record<string, unknown>)
        : {},
      content: inlineDoc(inline),
    };
  }

  switch (blockType) {
    case 'heading': {
      const level = attrs['level'];
      return {
        type: 'heading',
        props: { level: typeof level === 'number' ? level : 2 },
        content: inlineDoc(inline),
      };
    }
    case 'bulleted_list':
      return { type: 'bulleted_list', props: {}, content: inlineDoc(inline) };
    case 'numbered_list': {
      const props: Record<string, unknown> = {};
      const start = attrs['start'];
      if (typeof start === 'number') {
        props['start'] = start;
      }
      return { type: 'numbered_list', props, content: inlineDoc(inline) };
    }
    case 'to_do':
      return {
        type: 'to_do',
        props: { checked: attrs['checked'] === true },
        content: inlineDoc(inline),
      };
    case 'quote': {
      const props: Record<string, unknown> = {};
      const icon = attrs['icon'];
      if (typeof icon === 'string' && icon.length > 0) {
        props['icon'] = icon;
      }
      return { type: 'quote', props, content: inlineDoc(inline) };
    }
    case 'code': {
      const props: Record<string, unknown> = {
        lang: typeof attrs['lang'] === 'string' ? attrs['lang'] : '',
      };
      if (attrs['wrap'] === true) {
        props['wrap'] = true;
      }
      return { type: 'code', props, content: textOfNode(node) };
    }
    case 'divider':
      return { type: 'divider', props: {}, content: null };
    case 'image': {
      const props: Record<string, unknown> = {
        file_id: typeof attrs['file_id'] === 'string' ? attrs['file_id'] : '',
      };
      const caption = attrs['caption'];
      if (typeof caption === 'string') {
        props['caption'] = caption;
      }
      const width = attrs['width'];
      if (typeof width === 'number') {
        props['width'] = width;
      }
      return { type: 'image', props, content: null };
    }
    // R25（T76-01）：结构化 content 两形态——PM attrs → 真相层 content（normalize 归一，
    // 故「新建节点 attrs 为默认值」与「投影节点」产出**同一**规范 content）。
    case 'table':
      return {
        type: 'table',
        props: {},
        content: normalizeTableContent({
          rows: attrs['rows'],
          header: attrs['header'],
          colWidths: attrs['colWidths'],
        }),
      };
    case 'toggle':
      return {
        type: 'toggle',
        props: {},
        content: normalizeToggleContent({ title: attrs['title'], body: attrs['body'] }),
      };
    case 'paragraph':
    default:
      return { type: 'paragraph', props: {}, content: inlineDoc(inline) };
  }
}

/** 节点名是否为已知块（先还原投影别名，如 codeBlock→code）。
 */
function isBlockTypeName(type: string): boolean {
  return KNOWN_BLOCK_TYPES.has(type) || type === 'paragraph';
}

/** 节点名是否为已知块（先还原投影别名，如 codeBlock→code）。
 *  导出供 Editor 的块 id 回写复用（过滤顶层节点须与 pmDocToBlocks 同一口径）。 */
export function isPmBlockNodeName(name: string): boolean {
  return isBlockTypeName(blockTypeOfPmNode(name));
}

/**
 * PM doc → 块模型。
 * - 按 attrs.id 匹配 prev 中的旧块：保留 id / sort_key / version / parent_id / last_edited；
 * - 新插入的块生成 ulid，version 取注入的 clock().c（出生即带 Lamport 出处）；
 * - prev 中在场但投影里已消失的块 → 原地转 tombstone（alive=0，保留 sort_key/version），
 *   供 diff 生成 delete 事件（并让「删除后再删」不会重复发事件）。
 */
export function pmDocToBlocks(json: PMDocJSON, prev: BlockDoc, clock: () => Lamport): BlockDoc {
  const prevById = new Map<string, Block>();
  for (const block of prev.blocks) {
    prevById.set(block.id, block);
  }

  const nodes = (json.content ?? []).filter((node) => isPmBlockNodeName(node.type));
  const keys: Array<string | null> = nodes.map((node) => {
    const id = attrString(node.attrs?.['id'] ?? null);
    const old = id === null ? undefined : prevById.get(id);
    return old === undefined ? null : old.sort_key;
  });

  const seen = new Set<string>();
  const blocks: Block[] = [];
  let lastKey: string | null = null;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) {
      continue;
    }
    const semantics = semanticsOf(node);
    const id = attrString(node.attrs?.['id'] ?? null);
    const old = id === null ? undefined : prevById.get(id);

    let sortKey: string;
    if (old !== undefined) {
      sortKey = old.sort_key;
    } else {
      let nextKey: string | null = null;
      for (let look = index + 1; look < keys.length; look += 1) {
        const candidate = keys[look];
        if (candidate !== null && candidate !== undefined) {
          nextKey = candidate;
          break;
        }
      }
      sortKey = freshSortKey(lastKey, nextKey);
    }
    lastKey = sortKey;

    let blockId = old !== undefined ? old.id : ulid();
    if (seen.has(blockId)) {
      blockId = ulid();
    }
    seen.add(blockId);

    blocks.push({
      id: blockId,
      page_id: prev.pageId,
      type: semantics.type,
      props: semantics.props,
      content: semantics.content,
      parent_id: old !== undefined ? old.parent_id : null,
      sort_key: sortKey,
      alive: 1,
      version: old !== undefined ? old.version : Math.max(1, clock().c),
      last_edited: old !== undefined ? old.last_edited : 0,
    });
  }

  // tombstone：prev 在场但投影消失的块（保序：按 prev 顺序追加）
  for (const old of prev.blocks) {
    if (seen.has(old.id)) {
      continue;
    }
    blocks.push(old.alive === 1 ? { ...old, alive: 0 } : { ...old });
  }

  return { pageId: prev.pageId, blocks };
}

/** 在 a、b 之间生成兄弟序键；退化时降级为「排在 a 之后」，仍失败则抛错（调用方重平衡）。 */
export function freshSortKey(a: string | null, b: string | null): string {
  try {
    return sortBetween(a, b);
  } catch {
    try {
      return sortBetween(a, null);
    } catch {
      throw new Error(
        `无法在 '${String(a)}' 与 '${String(b)}' 之间生成 sort_key：请触发整层重平衡`,
      );
    }
  }
}
