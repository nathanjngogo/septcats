/**
 * blockAnchor.ts —— T36-01 §1.2 换块型视觉锚定的**装饰承载层**。
 *
 * 补偿样式（padding-top / margin-top）以 Node 装饰（Decoration.node → style 属性）
 * 写到块元素上，而不是直接改 el.style：
 * - 编辑器存在持续的重渲染波（EditSession/collab 的 Y→PM 回声等会把块元素整个
 *   重建），外部 inline style 会在同 tick~几百 ms 内被抹掉（真机探针实证）；
 *   装饰是 PM 自有渲染输入，**每次重渲染自动重放**，天然抗重建；
 * - 不污染文档模型（attrs 不变，BlockDoc 往返恒等不受影响）。
 *
 * 状态按 blockId（node attrs.id）索引、按顶层块 presence 剪枝；位置每次在
 * decorations() 里现场查找，不依赖 pos 映射。
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor as TiptapEditor } from '@tiptap/core';

interface AnchorMeta {
  id: string;
  style: string | null;
}

const key = new PluginKey<Map<string, string>>('septcatsBlockAnchor');

/** 块锚定补偿样式（px；paddingTop ≥ 0，marginTop 可为负，见 anchor.ts 代数）。 */
export interface BlockAnchorStyle {
  paddingTop: number;
  marginTop: number;
}

function styleToCss(style: BlockAnchorStyle): string {
  return `padding-top: ${String(style.paddingTop)}px; margin-top: ${String(style.marginTop)}px;`;
}

/** 生成块锚定装饰插件（Editor 装配时注册一次）。 */
export function blockAnchorPlugin(): Plugin<Map<string, string>> {
  return new Plugin<Map<string, string>>({
    key,
    state: {
      init: () => new Map<string, string>(),
      apply(tr, value) {
        const meta = tr.getMeta(key) as AnchorMeta | undefined;
        if (meta === undefined) {
          return value;
        }
        const next = new Map(value);
        if (meta.style === null) {
          next.delete(meta.id);
        } else {
          next.set(meta.id, meta.style);
        }
        // 按顶层块 presence 剪枝：块被删除后其补偿不再驻留
        const ids = new Set<string>();
        tr.doc.forEach((node) => {
          const id: unknown = node.attrs['id'];
          if (typeof id === 'string' && id.length > 0) {
            ids.add(id);
          }
        });
        for (const id of next.keys()) {
          if (!ids.has(id)) {
            next.delete(id);
          }
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        const map = key.getState(state);
        if (map === undefined || map.size === 0) {
          return DecorationSet.empty;
        }
        const decorations: Decoration[] = [];
        state.doc.forEach((node, offset) => {
          const id: unknown = node.attrs['id'];
          const style = typeof id === 'string' ? map.get(id) : undefined;
          if (style !== undefined) {
            decorations.push(Decoration.node(offset, offset + node.nodeSize, { style }));
          }
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/**
 * 写入/清除某块的锚定补偿。style=null 清除；值未变化时不派发事务。
 * meta-only 事务（docChanged=false），不触发反投影/落库。
 */
export function setBlockAnchorStyle(
  editor: TiptapEditor,
  blockId: string,
  style: BlockAnchorStyle | null,
): void {
  const css = style === null ? null : styleToCss(style);
  const current = key.getState(editor.state)?.get(blockId);
  if (current === css) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(key, { id: blockId, style: css } satisfies AnchorMeta));
}
