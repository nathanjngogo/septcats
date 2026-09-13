import { Node } from '@tiptap/core';
import { BLOCK_CLASS, blockClass, blockIdAttribute } from './shared';

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
    // blockClass 自带 'sc-block' 前缀，callout 只能加修饰类，不得再次拼整串（避免 sc-block 重复）
    const cls = hasIcon ? `${blockClass('quote')} ${BLOCK_CLASS}--callout` : blockClass('quote');
    return ['blockquote', { ...HTMLAttributes, class: cls }, 0];
  },
});
