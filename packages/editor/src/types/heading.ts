import { Node } from '@tiptap/core';
import { blockClass, blockIdAttribute } from './shared';

/** 2 · heading —— level 1..3（schema-v1 §3：允许块级 H1）。 */
export const HeadingNode = Node.create({
  name: 'heading',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      ...blockIdAttribute,
      level: {
        default: 2,
        parseHTML: (element: HTMLElement): number | null => {
          const tag = element.tagName.toLowerCase();
          const match = /^h([1-6])$/.exec(tag);
          return match === null ? null : Number(match[1]);
        },
        renderHTML: (): Record<string, unknown> => ({}),
      },
    };
  },
  parseHTML() {
    return [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = typeof node.attrs['level'] === 'number' ? node.attrs['level'] : 2;
    return [`h${String(level)}`, { ...HTMLAttributes, class: blockClass('heading') }, 0];
  },
});
