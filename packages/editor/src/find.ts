/**
 * find.ts —— 页内查找的纯匹配函数（创意项 IDEA-D）。
 *
 * v1 口径（刻意保守）：**按块匹配**——命中 = 块文本含查询词（大小写不敏感），
 * 结果 = 命中块的 {id, 预览, 首次命中偏移}；跳转复用大纲同一 data-id 锚通道。
 * 不做块内逐字高亮：那要动 ProseMirror 装饰面，风险高收益小（v1 不值当）。
 * query 空/纯空白 → []（查找条没词时不假装在工作）。
 */

export interface FindSourceNode {
  type: { name: string };
  attrs: Record<string, unknown>;
  textContent: string;
}

export interface FindSource {
  forEach(cb: (node: FindSourceNode, offset: number, index: number) => void): void;
}

export interface FindMatch {
  id: string;
  blockType: string;
  text: string;
  /** 首次命中在块文本里的下标（大小写归一后）。 */
  hitAt: number;
}

export function collectMatches(doc: FindSource, query: string): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const out: FindMatch[] = [];
  doc.forEach((node) => {
    const id = node.attrs['id'];
    if (typeof id !== 'string' || id.length === 0) {
      return;
    }
    const text = node.textContent;
    const hitAt = text.toLowerCase().indexOf(needle);
    if (hitAt === -1) {
      return;
    }
    out.push({ id, blockType: node.type.name, text, hitAt });
  });
  return out;
}

/** 预览：命中词居中可见，前后掐码点加省略号（长段落也能看到关键词附近）。 */
export function previewMatch(hit: FindMatch, maxLen = 40): string {
  const chars = [...hit.text];
  if (chars.length <= maxLen) {
    return hit.text;
  }
  const start = Math.max(0, hit.hitAt - 12);
  const end = Math.min(chars.length, start + maxLen);
  return `${start > 0 ? '…' : ''}${chars.slice(start, end).join('')}${end < chars.length ? '…' : ''}`;
}
