import { Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { DEFAULT_BLOCK_LABELS, type BlockLabels } from './blockLabels';
import { blockClass, blockIdAttribute, joinClass } from './shared';

/**
 * 9 · image —— 原子块（content 恒为 null）。文件走内容寻址附件存储，
 * 这里只存 file_id = sha256(64)，src 由渲染层按 attachments 解析（M4.6）。
 *
 * R26（T77-01）：加**原生 DOM NodeView**——图片右缘拖拽柄（hover 显形）拖动写
 * **既有 `width` attr**（走既有 patch op 通道，op 类型零新增），拖拽中浮显宽度
 * 百分比 badge。width 语义 = **像素**（§0-② 实证：既有样本 width:480，fixtures/
 * blocks.ts；HTML `width` 属性 + CSS `max-width:100%` 夹紧），吸附档位 = **8px 步进**。
 */
export const IMAGE_DEFAULT_WIDTH = 480;
/** 拖拽吸附步进（像素网格；样本 480 是 8 的整数倍，与既有 attr 语义同族）。 */
export const IMAGE_WIDTH_STEP = 8;
/** 宽度下限（拖到 0 宽无意义；与吸附网格对齐）。 */
export const IMAGE_WIDTH_MIN = 48;
/** 容器无法量测（jsdom / 未布局）时的宽度上限兜底。 */
export const IMAGE_WIDTH_MAX = 4096;
/** 最小位移（px）：低于此值不产生事务（避免点击抖动改宽度）。 */
export const IMAGE_RESIZE_DRAG_THRESHOLD = 2;
/** 宽度百分比 badge 的 testid（探针锚点；全页唯一，不带块 id）。 */
export const IMAGE_WIDTH_BADGE_TESTID = 'image-width-badge';

/** 宽度 badge testid（导出给测试/探针用）。 */
export const IMAGE_RESIZE_HANDLE_TESTID = 'image-resize-handle';

/**
 * 吸附纯函数：四舍五入到 8px 网格，并夹在 [下限, 上限]（上限 = 容器宽，量测不到
 * 时由调用方给 IMAGE_WIDTH_MAX）。上限先对齐网格，避免出现「上限本身不在网格上」
 * 导致末档参差。
 */
export function snapImageWidth(raw: number, max: number): number {
  const snapped = Math.round(raw / IMAGE_WIDTH_STEP) * IMAGE_WIDTH_STEP;
  const upperGrid = Math.max(IMAGE_WIDTH_MIN, Math.floor(max / IMAGE_WIDTH_STEP) * IMAGE_WIDTH_STEP);
  return Math.min(Math.max(snapped, IMAGE_WIDTH_MIN), upperGrid);
}

/**
 * 拖拽中 badge 文案：容器可量测 → 百分比；不可量测（jsdom）→ 像素（确定性退化）。
 */
export function imageWidthBadgeText(width: number, containerWidth: number): string {
  if (containerWidth > 0) {
    return `${String(Math.round((width / containerWidth) * 100))}%`;
  }
  return `${String(width)}px`;
}

/**
 * 图片块 NodeView（原生 DOM）。
 * - dom = `figure.sc-block.sc-block--image`（与 renderHTML 同构）；
 * - 内容锚（img）包在 `div.sc-image-frame`（position:relative）里，拖拽柄/ badge 贴
 *   图片右缘（而非整块右缘，避免 width 小于容器时柄悬空）；
 * - 原子块：`contentEditable=false` + stopEvent 只挡柄/badge，img 点击仍归 PM。
 */
export function createImageView(
  props: { node: PMNode; editor: Editor; getPos: () => number | undefined },
  labels: BlockLabels = DEFAULT_BLOCK_LABELS,
): NodeView {
  let current = props.node;
  let drag: { startX: number; base: number; max: number; container: number } | null = null;

  const dom = document.createElement('figure');
  dom.className = joinClass(blockClass('image'));
  dom.contentEditable = 'false';
  const frame = document.createElement('div');
  frame.className = 'sc-image-frame';
  const img = document.createElement('img');
  img.className = 'sc-image-body';
  const handle = document.createElement('span');
  handle.className = 'sc-image-resize';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('draggable', 'false');
  const badge = document.createElement('span');
  badge.className = 'sc-image-badge';
  badge.setAttribute('data-testid', IMAGE_WIDTH_BADGE_TESTID);
  badge.hidden = true;
  frame.append(img, handle, badge);
  dom.appendChild(frame);

  const widthOf = (node: PMNode): number | null => {
    const value = node.attrs['width'];
    return typeof value === 'number' && value > 0 ? value : null;
  };

  /** 一次 setNodeMarkup 写回既有 width attr（外发由宿主 EditSession 负责）。 */
  const commit = (patch: Record<string, unknown>): void => {
    const pos = props.getPos();
    if (typeof pos !== 'number') {
      return;
    }
    props.editor.view.dispatch(
      props.editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch }),
    );
  };

  const applyWidth = (width: number | null): void => {
    if (width === null) {
      img.removeAttribute('width');
    } else {
      img.setAttribute('width', String(width));
    }
  };

  const applyAttrs = (): void => {
    const id: unknown = current.attrs['id'];
    const idValue = typeof id === 'string' && id.length > 0 ? id : '';
    if (idValue.length > 0) {
      dom.setAttribute('data-id', idValue);
    } else {
      dom.removeAttribute('data-id');
    }
    const fileId = typeof current.attrs['file_id'] === 'string' ? current.attrs['file_id'] : '';
    dom.setAttribute('data-file-id', fileId);
    img.setAttribute('src', `attachment://${fileId}`);
    const caption = typeof current.attrs['caption'] === 'string' ? current.attrs['caption'] : '';
    img.setAttribute('alt', caption);
    applyWidth(widthOf(current));
    handle.setAttribute('data-testid', `${IMAGE_RESIZE_HANDLE_TESTID}-${idValue}`);
    handle.setAttribute('aria-label', labels.imageResize);
  };

  /** 拖拽基准宽：attr → 实测渲染宽 → 默认宽（480）。 */
  const baseWidth = (): number => {
    const attr = widthOf(current);
    if (attr !== null) {
      return attr;
    }
    const measured = img.getBoundingClientRect().width;
    return measured > 0 ? Math.round(measured) : IMAGE_DEFAULT_WIDTH;
  };

  /** 容器可用宽（figure 内容盒）；量测不到（jsdom）返回 0，由调用方走兜底上限。 */
  const measureContainer = (): number => {
    const measured = frame.getBoundingClientRect().width;
    return measured > 0 ? Math.round(measured) : 0;
  };

  const showBadge = (width: number, container: number): void => {
    badge.textContent = imageWidthBadgeText(width, container);
    badge.hidden = false;
  };

  const startResize = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const container = measureContainer();
    drag = {
      startX: event.clientX,
      base: baseWidth(),
      max: container > 0 ? container : IMAGE_WIDTH_MAX,
      container,
    };
    showBadge(drag.base, container);
    const onMove = (moveEvent: MouseEvent): void => {
      if (drag === null) {
        return;
      }
      const next = snapImageWidth(drag.base + (moveEvent.clientX - drag.startX), drag.max);
      applyWidth(next);
      showBadge(next, drag.container);
    };
    const onUp = (upEvent: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      badge.hidden = true;
      if (drag === null) {
        return;
      }
      const state = drag;
      drag = null;
      const next = snapImageWidth(state.base + (upEvent.clientX - state.startX), state.max);
      if (Math.abs(next - state.base) < IMAGE_RESIZE_DRAG_THRESHOLD) {
        // 微小位移 = 点击抖动：还原显示，不发事务
        applyWidth(state.base);
        return;
      }
      commit({ width: next });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  handle.addEventListener('mousedown', startResize);

  applyAttrs();

  return {
    dom,
    update: (updated: PMNode): boolean => {
      if (updated.type.name !== 'image') {
        return false;
      }
      current = updated;
      applyAttrs();
      return true;
    },
    ignoreMutation: (): boolean => true,
    stopEvent: (event): boolean =>
      event.target instanceof globalThis.Node &&
      (handle.contains(event.target) || badge.contains(event.target)),
    destroy: (): void => {
      drag = null;
      handle.removeEventListener('mousedown', startResize);
    },
    selectNode: (): void => {
      dom.classList.add('sc-block--selected');
    },
    deselectNode: (): void => {
      dom.classList.remove('sc-block--selected');
    },
  };
}

export const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { labels: DEFAULT_BLOCK_LABELS as BlockLabels };
  },

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

  addNodeView() {
    const labels = this.options.labels;
    return (viewProps) =>
      createImageView(
        { node: viewProps.node, editor: viewProps.editor, getPos: () => viewProps.getPos() },
        labels,
      );
  },
});
