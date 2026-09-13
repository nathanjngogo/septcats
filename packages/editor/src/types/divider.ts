import { Node } from '@tiptap/core';
import { blockClass, blockIdAttribute } from './shared';

/** 8 · divider —— 原子块，content 恒为 null。 */
export const DividerNode = Node.create({
  name: 'divider',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { ...blockIdAttribute };
  },
  parseHTML() {
    return [{ tag: 'hr' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['hr', { ...HTMLAttributes, class: blockClass('divider') }];
  },
});
