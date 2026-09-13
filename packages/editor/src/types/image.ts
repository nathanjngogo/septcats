import { Node } from '@tiptap/core';
import { blockClass, blockIdAttribute } from './shared';

/**
 * 9 · image —— 原子块（content 恒为 null）。文件走内容寻址附件存储，
 * 这里只存 file_id = sha256(64)，src 由渲染层按 attachments 解析（M4.6）。
 */
export const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      ...blockIdAttribute,
      file_id: {
        default: '',
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-file-id'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, unknown> =>
          typeof attributes['file_id'] === 'string' && attributes['file_id'].length > 0
            ? { 'data-file-id': attributes['file_id'] }
            : {},
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('alt'),
        renderHTML: (): Record<string, unknown> => ({}),
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement): number | null => {
          const raw = element.getAttribute('width');
          return raw === null ? null : Number(raw);
        },
        renderHTML: (): Record<string, unknown> => ({}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[data-file-id]',
        getAttrs: (element) => {
          if (typeof element === 'string') {
            return false;
          }
          const fileId = element.getAttribute('data-file-id') ?? '';
          return fileId.length > 0 ? { file_id: fileId } : false;
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const fileId = typeof node.attrs['file_id'] === 'string' ? node.attrs['file_id'] : '';
    const caption = typeof node.attrs['caption'] === 'string' ? node.attrs['caption'] : '';
    const width = typeof node.attrs['width'] === 'number' ? node.attrs['width'] : null;
    const frame = {
      ...HTMLAttributes,
      class: blockClass('image'),
      'data-file-id': fileId,
    };
    const img = {
      src: `attachment://${fileId}`,
      alt: caption,
      class: 'sc-image-body',
      ...(width === null ? {} : { width: String(width) }),
    };
    return ['figure', frame, ['img', img]];
  },
});
