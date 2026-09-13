/**
 * lists.ts —— 3 • bulleted_list / 4 • numbered_list / 5 • to_do。
 *
 * v1 不把缩进做进 PM 嵌套列表：**缩进层级 = parent 链**（schema-v1 §3），
 * 所以每个块就是一个扁平节点，一层列表 = 一层块。
 */
import { Node } from '@tiptap/core';
import { blockClass, blockIdAttribute } from './shared';

export const BulletedListNode = Node.create({
  name: 'bulleted_list',
  group: 'block',
  content: 'inline*',
  addAttributes() {
    return { ...blockIdAttribute };
  },
  parseHTML() {
    return [{ tag: 'ul > li' }, { tag: 'li[data-type="bulleted"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'ul',
      { ...HTMLAttributes, class: blockClass('bulleted_list') },
      ['li', { class: 'sc-list-item' }, 0],
    ];
  },
});

export const NumberedListNode = Node.create({
  name: 'numbered_list',
  group: 'block',
  content: 'inline*',
  addAttributes() {
    return {
      ...blockIdAttribute,
      start: {
        default: 1,
        parseHTML: (element: HTMLElement): number | null => {
          const raw = element.getAttribute('start');
          return raw === null ? null : Number(raw);
        },
        renderHTML: (): Record<string, unknown> => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'ol > li' }, { tag: 'li[data-type="numbered"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const start = typeof node.attrs['start'] === 'number' ? node.attrs['start'] : 1;
    return [
      'ol',
      { ...HTMLAttributes, class: blockClass('numbered_list'), start: String(start) },
      ['li', { class: 'sc-list-item', value: String(start) }, 0],
    ];
  },
});

export const TodoNode = Node.create({
  name: 'to_do',
  group: 'block',
  content: 'inline*',
  addAttributes() {
    return {
      ...blockIdAttribute,
      checked: {
        default: false,
        parseHTML: (element: HTMLElement): boolean | null => {
          const raw = element.getAttribute('data-checked');
          return raw === null ? null : raw === 'true';
        },
        renderHTML: (): Record<string, unknown> => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'li[data-type="todo"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const checked = node.attrs['checked'] === true;
    const marker = { class: 'sc-todo-item', 'data-type': 'todo', 'data-checked': checked ? 'true' : 'false' };
    return [
      'ul',
      {
        ...HTMLAttributes,
        class: blockClass('to_do'),
        'data-type': 'todo',
        'data-checked': checked ? 'true' : 'false',
      },
      ['li', marker, 0],
    ];
  },
});
