import { Node } from '@tiptap/core';
import { blockClass, blockIdAttribute } from './shared';

/**
 * 6 · quote —— callout = quote + props.icon（schema-v1 §3：不另设类型，减一）。
 * icon 只在有值时进 PM attrs（保证 roundtrip 恒等，见 model.ts 归一化约定）。
 */
export const QuoteNode = Node.create({
  name: 'quote',
  group: 'block',
  content: 'inline*',
  addAttributes() {
    return {
      ...blockIdAttribute,
      icon: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-icon'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, unknown> =>
          typeof attributes['icon'] === 'string' && attributes['icon'].length > 0
            ? { 'data-icon': attributes['icon'] }
            : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'blockquote' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const hasIcon = typeof node.attrs['icon'] === 'string' && node.attrs['icon'].length > 0;
    return [
      'blockquote',
      {
        ...HTMLAttributes,
        class: hasIcon
          ? `${blockClass('quote')} ${blockClass('callout')}`
          : blockClass('quote'),
      },
      0,
    ];
  },
});
