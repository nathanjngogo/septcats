/**
 * headings.ts —— 页内大纲的纯提取函数（创意项 IDEA-C）。
 *
 * 从 ProseMirror 文档收集标题块：只认 type.name==='heading' 的顶层块
 * （schema-v1 §3：level 1..3）；跳过空标题（没字的标题进大纲是噪音）。
 * 住在 editor 包（可单测），渲染层只画表 + 复用 PageView 的 jumpToBlockId 跳转。
 */

export interface HeadingEntry {
  /** 块稳定 id（attrs.id；缺 id 的块跳过——跳转锚不存在）。 */
  id: string;
  level: 1 | 2 | 3;
  /** 标题文本（已 trim；显示侧再截断）。 */
  text: string;
}

/** 大纲读取所需的最小节点面（ProseMirror Node 结构上天然满足；测试可伪造）。 */
export interface HeadingSourceNode {
  type: { name: string };
  attrs: Record<string, unknown>;
  textContent: string;
}

export interface HeadingSource {
  forEach(cb: (node: HeadingSourceNode, offset: number, index: number) => void): void;
}

/** 收集顺序 = 文档块顺序（大纲即目录，不重排）。 */
export function collectHeadings(doc: HeadingSource): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  doc.forEach((node) => {
    if (node.type.name !== 'heading') {
      return;
    }
    const id = node.attrs['id'];
    const text = node.textContent.trim();
    if (typeof id !== 'string' || id.length === 0 || text.length === 0) {
      return;
    }
    const raw = typeof node.attrs['level'] === 'number' ? node.attrs['level'] : 1;
    const level = (raw < 1 ? 1 : raw > 3 ? 3 : Math.round(raw)) as 1 | 2 | 3;
    out.push({ id, level, text });
  });
  return out;
}
