import { Node } from '@tiptap/core';
import { blockClass, blockIdAttribute } from './shared';

/**
 * 7 · code —— content 是**纯文本 string**（schema-v1 §3/§7 裁决：不转 PM doc）。
 * PM 侧用 text* 承载；mark 全部禁用；wrap 只做展示开关。
 * 节点名 = codeBlock：PM 禁止 node/mark 同名，而内联 mark 占了 'code'
 * （真相层类型名由 model.ts 的 pmNodeNameOf 映射，持久化仍是 'code'）。
 */
export const CODE_BLOCK_PM_NAME = 'codeBlock';

export const CodeNode = Node.create({
  name: CODE_BLOCK_PM_NAME,
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes() {
    return {
      ...blockIdAttribute,
      lang: {
        default: '',
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-lang'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, unknown> =>
          typeof attributes['lang'] === 'string' && attributes['lang'].length > 0
            ? { 'data-lang': attributes['lang'] }
            : {},
      },
      wrap: {
        default: false,
        parseHTML: (element: HTMLElement): boolean | null => {
          const raw = element.getAttribute('data-wrap');
          return raw === null ? null : raw === 'true';
        },
        renderHTML: (): Record<string, unknown> => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'pre', preserveWhitespace: 'full' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const lang = typeof node.attrs['lang'] === 'string' ? node.attrs['lang'] : '';
    const wrap = node.attrs['wrap'] === true;
    return [
      'pre',
      {
        ...HTMLAttributes,
        class: wrap ? `${blockClass('code')} ${blockClass('code')}--wrap` : blockClass('code'),
        'data-lang': lang,
      },
      ['code', { class: 'sc-code-body' }, 0],
    ];
  },
});
