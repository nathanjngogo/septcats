/**
 * types/index.ts —— 显式装配 Tiptap schema（任务书 §5：**不要 starter-kit**）。
 *
 * 依赖白名单只有 @tiptap/core + @tiptap/pm，所以 document / text / paragraph
 * 这三个「通常由 extension-* 包提供」的节点也在本包内自写；history 用
 * prosemirror-history（经 @tiptap/pm/history 出口）自装。
 */
import { Extension, getSchema } from '@tiptap/core';
import { history } from '@tiptap/pm/history';
import type { Schema } from '@tiptap/pm/model';
import { EDITOR_MARKS } from '../marks';
import { SeptcatsInputRules } from '../rules/inputRules';
import { mergeBlockLabels, type BlockLabels } from './blockLabels';
import { CodeNode } from './code';
import { DividerNode } from './divider';
import { DocumentNode } from './document';
import { HeadingNode } from './heading';
import { ImageNode } from './image';
import { BulletedListNode, NumberedListNode, TodoNode } from './lists';
import { ParagraphNode } from './paragraph';
import { QuoteNode } from './quote';
import { TableNode } from './table';
import { TextNode } from './text';
import { ToggleNode } from './toggle';
import { WikilinkNode } from './wikilink';

export * from './blockLabels';

/** 撤销/重做（PM 侧）；Op 级撤销栈见 history.ts（两者职责不同）。 */
export const SeptcatsHistory = Extension.create({
  name: 'septcatsHistory',
  addProseMirrorPlugins() {
    return [history()];
  },
});

/**
 * 不含 R25 两个内容块（table/toggle）的节点基座——它们带**可注入文案**
 * （见 blockLabels.ts），故在 editorExtensions 里按实例 configure。
 */
export const BASE_BLOCK_NODES = [
  DocumentNode,
  TextNode,
  ParagraphNode,
  HeadingNode,
  BulletedListNode,
  NumberedListNode,
  TodoNode,
  QuoteNode,
  CodeNode,
  DividerNode,
  ImageNode,
];

/** 全部块节点（table/toggle 用默认中文文案；等价于 editorExtensions() 的节点面）。 */
export const BLOCK_NODES = [
  ...BASE_BLOCK_NODES,
  TableNode,
  ToggleNode,
  // T44-01：双链内联节点（inline，独立于块节点白名单；块级语义零触碰）
  WikilinkNode,
];

/** editorExtensions 的可选注入面（R25：新块内置控件的 zh/en 文案）。 */
export interface EditorExtensionOptions {
  /** 缺省用包内中文默认值（见 blockLabels.ts 的 DEFAULT_BLOCK_LABELS）。 */
  blockLabels?: Partial<BlockLabels> | undefined;
}

/** 每次调用返回全新数组（Tiptap 会原地消费扩展列表，避免跨实例共享）。 */
export function editorExtensions(options: EditorExtensionOptions = {}) {
  const labels = mergeBlockLabels(options.blockLabels);
  return [
    ...BASE_BLOCK_NODES,
    TableNode.configure({ labels }),
    ToggleNode.configure({ labels }),
    WikilinkNode,
    ...EDITOR_MARKS,
    SeptcatsInputRules,
    SeptcatsHistory,
  ];
}

/** 与 editorExtensions 同构的 PM Schema（纯函数层做投影校验时用）。 */
export function editorSchema(): Schema {
  return getSchema(editorExtensions());
}
