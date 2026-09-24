/**
 * blocks.ts —— PM doc → BlockSpec[] 的**纯反向投影**（M12 导入器用）。
 *
 * 与 model.ts 的 pmDocToBlocks(json, prev, clock)（带状态：保 id/sort_key、
 * 出 tombstone）职责不同：本函数无 prev、无时钟、无 id，只做「PM 节点语义 →
 * 真相层块语义」的一次性投影，供 importer 组装 ImportPlan 的 blocks 字段。
 *
 * type 一律用**真相层名**，经 blockTypeOfPmNode 映射（与投影边界单源）：
 * codeBlock→code，其余同名（heading/to_do/…）。content 语义与块模型一致：
 * 文本类 = PM doc（恰好一个 paragraph 包裹内联）；code = 纯文本 string；
 * divider / image = null。未知 PM 节点名（含 page_link/bookmark 等无投影
 * 节点）若带 _unsupported/_raw 标记则原样恢复，否则按 paragraph 收敛。
 */
import {
  KNOWN_BLOCK_TYPES,
  RAW_ATTR,
  UNSUPPORTED_ATTR,
  blockTypeOfPmNode,
  cloneJson,
  inlineDoc,
} from './model';
import { normalizeTableContent, normalizeToggleContent } from './content';
import type { BlockContent, PMDocJSON, PMNodeJSON } from './model';

/** 真相层块规格（无 id / sort_key / version —— 由执行器落库时补）。 */
export interface BlockSpec {
  type: string;
  props: Record<string, unknown>;
  content: BlockContent;
}

function textOfNode(node: PMNodeJSON): string {
  let out = '';
  for (const child of node.content ?? []) {
    out += child.text ?? '';
  }
  return out;
}

function semanticsOf(node: PMNodeJSON): BlockSpec {
  const attrs = node.attrs ?? {};
  const inline = node.content ?? [];
  // 投影边界的节点名（如 codeBlock）先还原为真相层块类型再分派
  const blockType = blockTypeOfPmNode(node.type);

  if (typeof attrs[UNSUPPORTED_ATTR] === 'string') {
    const raw = attrs[RAW_ATTR];
    return {
      type: attrs[UNSUPPORTED_ATTR],
      props:
        raw !== null && typeof raw === 'object' && !Array.isArray(raw)
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
    // R25（T76-01）：单块自包含内容块（口径与 model.ts 的 semanticsOf 逐字一致，
    // normalize 同一份纯函数——两条反投影路径不可分叉）。
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

/** PM doc → 真相层 BlockSpec[]（数组顺序 = 文档顺序；不认识的非块节点跳过）。 */
export function pmDocToBlocks(doc: PMDocJSON): BlockSpec[] {
  const out: BlockSpec[] = [];
  for (const node of doc.content ?? []) {
    if (typeof node !== 'object' || node === null) {
      continue;
    }
    const isCarryUnknown = typeof node.attrs?.[UNSUPPORTED_ATTR] === 'string';
    // 非块节点（text / 嵌套 doc 等）与未知节点名都跳过——与 model 的白名单收敛一致
    if (!isCarryUnknown && !KNOWN_BLOCK_TYPES.has(blockTypeOfPmNode(node.type))) {
      continue;
    }
    out.push(semanticsOf(node));
  }
  return out;
}
