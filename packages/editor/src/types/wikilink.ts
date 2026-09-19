/**
 * wikilink.ts —— 双链内联节点（TASK-T44-01，Obsidian 式 `[[ ]]`）。
 *
 * 承载走**真实 inline node**（T36 教训：临时内联样式会被协作回声重渲染抹掉）。
 * 节点是 atom（无内层文本），展示文本全部在 attrs 里——这样渲染/点击/序列化
 * 都不必处理内层选区，Yjs（y-prosemirror）按 XmlElement + attrs 同步。
 *
 * 解析状态：**resolved ⇔ attrs.target 非空**（target = 目标页稳定 id）。
 * 改名不破链：链接以 target（页 id）为键，页 title 变更不改写节点。
 * 未解析链接（target=null）以 raw title 记录，点击时由宿主新建目标页并回填 id。
 */
import { Node } from '@tiptap/core';

export const WIKILINK_NODE_NAME = 'wikilink';

/** 解析结果物化进 DOM 的开关属性（parseHTML 识别用）。 */
const WIKILINK_DATA_ATTR = 'data-wikilink';

export const WikilinkNode = Node.create({
  name: WIKILINK_NODE_NAME,
  inline: true,
  group: 'inline',
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      /** 目标页 id（稳定键）；null = 未解析（目标页尚不存在）。 */
      target: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-target'),
      },
      /** 链接文本（选择候选时=目标页标题；语法直填时=用户敲的页名）。 */
      title: {
        default: '',
        parseHTML: (element: HTMLElement): string =>
          element.getAttribute('data-title') ?? element.textContent ?? '',
      },
      /** 别名（`[[页名|别名]]` 的展示文本）；null = 无别名。 */
      alias: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-alias'),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${WIKILINK_DATA_ATTR}]` }];
  },

  renderHTML({ node }) {
    const title = typeof node.attrs['title'] === 'string' ? node.attrs['title'] : '';
    const alias = typeof node.attrs['alias'] === 'string' ? node.attrs['alias'] : null;
    const target = typeof node.attrs['target'] === 'string' ? node.attrs['target'] : null;
    const attrs: Record<string, unknown> = {
      class: target !== null ? 'sc-wikilink' : 'sc-wikilink sc-wikilink--unresolved',
      [WIKILINK_DATA_ATTR]: '',
      'data-title': title,
    };
    if (target !== null) {
      attrs['data-target'] = target;
    }
    if (alias !== null) {
      attrs['data-alias'] = alias;
    }
    return ['span', attrs, alias !== null && alias.length > 0 ? alias : title];
  },
});
