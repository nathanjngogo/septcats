import { Node } from '@tiptap/core';
import { blockClass, blockIdAttribute, hiddenAttribute } from './shared';

/** 1 · paragraph —— 默认块；也承担「未知 type 降级」载体（attrs._unsupported/_raw）。 */
export const ParagraphNode = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  addAttributes() {
    return {
      ...blockIdAttribute,
      _unsupported: hiddenAttribute(),
      _raw: hiddenAttribute(),
    };
  },
  parseHTML() {
    return [{ tag: 'p' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['p', { ...HTMLAttributes, class: blockClass('paragraph') }, 0];
  },
});
