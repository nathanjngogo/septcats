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
import { CodeNode } from './code';
import { DividerNode } from './divider';
import { DocumentNode } from './document';
import { HeadingNode } from './heading';
import { ImageNode } from './image';
import { BulletedListNode, NumberedListNode, TodoNode } from './lists';
import { ParagraphNode } from './paragraph';
import { QuoteNode } from './quote';
import { TextNode } from './text';

/** 撤销/重做（PM 侧）；Op 级撤销栈见 history.ts（两者职责不同）。 */
export const SeptcatsHistory = Extension.create({
  name: 'septcatsHistory',
  addProseMirrorPlugins() {
    return [history()];
  },
});

export const BLOCK_NODES = [
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

/** 每次调用返回全新数组（Tiptap 会原地消费扩展列表，避免跨实例共享）。 */
export function editorExtensions() {
  return [...BLOCK_NODES, ...EDITOR_MARKS, SeptcatsInputRules, SeptcatsHistory];
}

/** 与 editorExtensions 同构的 PM Schema（纯函数层做投影校验时用）。 */
export function editorSchema(): Schema {
  return getSchema(editorExtensions());
}
