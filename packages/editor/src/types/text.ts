import { Node } from '@tiptap/core';

/** 内联文本节点（mark 的载体）。 */
export const TextNode = Node.create({
  name: 'text',
  group: 'inline',
});
