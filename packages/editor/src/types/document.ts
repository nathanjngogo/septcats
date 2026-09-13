import { Node } from '@tiptap/core';

/** 顶层 doc 节点（显式装配，不用 starter-kit）。内容 = 块序列。 */
export const DocumentNode = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
});
