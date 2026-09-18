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

/**
 * class 拼接收口：空值过滤 + token 级 Set 去重 + 稳定顺序（首次出现序）。
 *
 * 背景（TASK-T20-01 §3）：blockClass 自带 `sc-block` 前缀，调用方再拼修饰类
 * 时曾出现 `sc-block`×2 重复（code.ts wrap 路径）。统一走本函数后，重复 token
 * 被去重，顺序保持首次出现序（渲染输出确定性不回归）。
 */
export function joinClass(...parts: ReadonlyArray<string | false | null | undefined>): string {
  const seen = new Set<string>();
  for (const part of parts) {
    if (typeof part !== 'string' || part.length === 0) continue;
    for (const token of part.split(/\s+/)) {
      if (token.length > 0) seen.add(token);
    }
  }
  return [...seen].join(' ');
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
