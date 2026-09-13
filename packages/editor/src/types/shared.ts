/**
 * shared.ts —— 9 个块节点共用的属性/类名约定。
 *
 * 每个块节点都带 `id` 属性（块模型的主键，渲染为 data-id）：
 * 这是「PM doc 是投影」能反投影回 M3 块模型的唯一锚点（pmDocToBlocks 按 attrs.id 认领旧块）。
 */
import type { BlockType } from '../model';

export const BLOCK_CLASS = 'sc-block';

export function blockClass(type: BlockType | string): string {
  return `${BLOCK_CLASS} ${BLOCK_CLASS}--${type}`;
}

/** 块 id 属性：parse 读 data-id，render 写 data-id。 */
export const blockIdAttribute = {
  id: {
    default: null,
    parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-id'),
    renderHTML: (attributes: Record<string, unknown>): Record<string, unknown> =>
      typeof attributes['id'] === 'string' && attributes['id'].length > 0
        ? { 'data-id': attributes['id'] }
        : {},
  },
};

/** 不渲染到 DOM 的纯语义属性（未知块降级用的 _unsupported/_raw）。 */
export function hiddenAttribute(): Record<string, unknown> {
  return { default: null, renderHTML: (): Record<string, unknown> => ({}) };
}
