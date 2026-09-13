/**
 * marks.ts —— content 内联 mark 规格（schema-v1 §3 内联 mark 词汇表）。
 *
 * v1 UI 暴露：bold / italic / strike / code / link（白名单校验 href）。
 * 另实现两个 **pass-through mark**（无 UI 入口，只为不丢数据）：
 * - `mention`（{ref:'page:'+id}，schema-v1 §3 明确在词汇表内，M5 反链消费）；
 * - `color`（{token}，schema-v1 §3 列出；token 只接受 [a-z0-9-]，渲染成 var(--sc-color-*)）。
 * 若缺这两个 mark，含它们的 content 一旦进入 PM schema 会直接抛「Unknown mark type」，
 * 属于数据安全问题，故按契约实现（见报告 DEVIATIONS）。
 *
 * 冲突副本块（schema-v1 §5.4）走的是「特殊 paragraph 块」，不需要隐藏 mark，未实现。
 */
import { Mark } from '@tiptap/core';

/** schema-v1 §3：link href 白名单。`javascript:` / `data:` 等一律拒绝。 */
export function isAllowedHref(href: string): boolean {
  const value = href.trim();
  if (value.length === 0) {
    return false;
  }
  if (value.startsWith('#')) {
    return value.length > 1;
  }
  if (value.startsWith('page:')) {
    return value.length > 'page:'.length;
  }
  if (/^https?:\/\//i.test(value)) {
    return true;
  }
  return /^notion:\/\//i.test(value);
}

/** 颜色 token 只允许 kebab-case 字母数字（防 CSS 注入）。 */
export function isAllowedColorToken(token: string): boolean {
  return /^[a-z0-9-]{1,32}$/.test(token);
}

const DOM_OUTPUT_BLOCKED_CLASS = 'sc-link--blocked';

export const BoldMark = Mark.create({
  name: 'bold',
  parseHTML() {
    return [{ tag: 'strong' }, { tag: 'b' }];
  },
  renderHTML() {
    return ['strong', { class: 'sc-mark-bold' }, 0];
  },
});

export const ItalicMark = Mark.create({
  name: 'italic',
  parseHTML() {
    return [{ tag: 'em' }, { tag: 'i' }];
  },
  renderHTML() {
    return ['em', { class: 'sc-mark-italic' }, 0];
  },
});

export const StrikeMark = Mark.create({
  name: 'strike',
  parseHTML() {
    return [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }];
  },
  renderHTML() {
    return ['s', { class: 'sc-mark-strike' }, 0];
  },
});

export const CodeMark = Mark.create({
  name: 'code',
  code: true,
  parseHTML() {
    return [{ tag: 'code' }];
  },
  renderHTML() {
    return ['code', { class: 'sc-mark-code' }, 0];
  },
});

export const LinkMark = Mark.create({
  name: 'link',
  inclusive: false,
  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('href'),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'a[href]',
        getAttrs: (element) => {
          if (typeof element === 'string') {
            return false;
          }
          const href = element.getAttribute('href') ?? '';
          return isAllowedHref(href) ? { href } : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const href = typeof HTMLAttributes['href'] === 'string' ? HTMLAttributes['href'] : '';
    if (!isAllowedHref(href)) {
      return ['span', { class: DOM_OUTPUT_BLOCKED_CLASS }, 0];
    }
    return [
      'a',
      { ...HTMLAttributes, href, rel: 'noopener noreferrer', target: '_blank' },
      0,
    ];
  },
});

export const MentionMark = Mark.create({
  name: 'mention',
  inclusive: false,
  addAttributes() {
    return {
      ref: {
        default: '',
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-ref'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, unknown> =>
          typeof attributes['ref'] === 'string' && attributes['ref'].length > 0
            ? { 'data-ref': attributes['ref'] }
            : {},
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-ref]',
        getAttrs: (element) => {
          if (typeof element === 'string') {
            return false;
          }
          const ref = element.getAttribute('data-ref') ?? '';
          return ref.length > 0 ? { ref } : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'sc-mention' }, 0];
  },
});

export const ColorMark = Mark.create({
  name: 'color',
  addAttributes() {
    return {
      token: {
        default: '',
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-color'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, unknown> => {
          const token = attributes['token'];
          if (typeof token !== 'string' || !isAllowedColorToken(token)) {
            return {};
          }
          return { 'data-color': token, style: `color: var(--sc-color-${token})` };
        },
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-color]',
        getAttrs: (element) => {
          if (typeof element === 'string') {
            return false;
          }
          const token = element.getAttribute('data-color') ?? '';
          return isAllowedColorToken(token) ? { token } : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const token = typeof HTMLAttributes['token'] === 'string' ? HTMLAttributes['token'] : '';
    if (!isAllowedColorToken(token)) {
      return ['span', {}, 0];
    }
    return ['span', { ...HTMLAttributes, class: 'sc-mark-color' }, 0];
  },
});

/** UI 暴露的 mark id → Tiptap mark 名（B/I/U/code/link；U 见报告：v1 词汇表无 underline）。 */
export const INLINE_MARK_NAMES = ['bold', 'italic', 'strike', 'code', 'link'] as const;
export type InlineMarkName = (typeof INLINE_MARK_NAMES)[number];

export const INLINE_MARKS = [BoldMark, ItalicMark, StrikeMark, CodeMark, LinkMark];

export const PASSTHROUGH_MARKS = [MentionMark, ColorMark];

export const EDITOR_MARKS = [...INLINE_MARKS, ...PASSTHROUGH_MARKS];
