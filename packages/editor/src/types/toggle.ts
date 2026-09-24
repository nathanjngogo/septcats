/**
 * toggle.ts —— R25（T76-01）11 · toggle（折叠列表，单块自包含）。
 *
 * 建模口径（报告 §0-②，二选一后的**唯一**形态）：块模型无父子原语（PM schema 全员
 * 扁平、全仓无写非 null 块 parent_id 的路径），故按 PRD §2B 走**单块自包含**：
 * content = `{ title: string, body: string[] }`，PM 侧一个 atom 节点 + 原生 DOM NodeView。
 *
 * 展开态是**纯视图态**：`open` 只活在 NodeView 闭包里，**不进 content、不进 attrs、
 * 不派发任何事务**——重开文档回默认收起（与 Notion 略异，PRD §2B 已记口径）。
 */
import { Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import {
  normalizeToggleContent,
  toggleAddBodyLine,
  toggleDeleteBodyLine,
  toggleSetBodyLine,
  toggleSetTitle,
  type ToggleContent,
} from '../content';
import { DEFAULT_BLOCK_LABELS, type BlockLabels } from './blockLabels';
import { blockClass, blockIdAttribute, joinClass } from './shared';

/** PM 节点名 = 真相层类型名（无同名 mark）。 */
export const TOGGLE_PM_NAME = 'toggle';
/** 折叠块根 DOM 的 testid（探针锚点）。 */
export const TOGGLE_ROOT_TESTID = 'septcats-block-toggle';

function toggleContentOf(node: PMNode): ToggleContent {
  return normalizeToggleContent({ title: node.attrs['title'], body: node.attrs['body'] });
}

const INNER_EVENT_TYPES: ReadonlySet<string> = new Set([
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'paste',
  'cut',
  'copy',
  'dragstart',
  'dragover',
  'drop',
  'dragend',
  'focusin',
  'focusout',
  'wheel',
]);

/**
 * 折叠列表 NodeView（原生 DOM）。
 * 结构变化（正文行数）→ 重建；数值变化 → 就地改写。展开态闭包持有，跨 update 保留。
 */
export function createToggleView(
  props: { node: PMNode; editor: Editor; getPos: () => number | undefined },
  labels: BlockLabels = DEFAULT_BLOCK_LABELS,
): NodeView {
  let current = props.node;
  /** 展开态：纯视图态，绝不进 content/attrs，也不产生事务。 */
  let open = false;
  let titleInput: HTMLInputElement | null = null;
  let bodyInputs: HTMLInputElement[] = [];
  let pendingBodyFocus: number | null = null;

  const dom = document.createElement('div');
  dom.className = joinClass(blockClass(TOGGLE_PM_NAME), 'sc-toggle');
  dom.setAttribute('data-testid', TOGGLE_ROOT_TESTID);
  dom.contentEditable = 'false';
  dom.dataset['open'] = 'false';
  const head = document.createElement('div');
  head.className = 'sc-toggle__head';
  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'sc-toggle__arrow';
  arrow.setAttribute('aria-label', labels.toggleExpand);
  arrow.setAttribute('aria-expanded', 'false');
  arrow.textContent = '▶';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'sc-toggle__body';
  dom.append(head, bodyEl);

  const content = (): ToggleContent => toggleContentOf(current);

  const commit = (next: ToggleContent): void => {
    const pos = props.getPos();
    if (typeof pos !== 'number') {
      return;
    }
    props.editor.view.dispatch(
      props.editor.state.tr.setNodeMarkup(pos, undefined, {
        ...current.attrs,
        title: next.title,
        body: next.body,
      }),
    );
  };

  /** 块 id 落 DOM（手柄归属链锚点）+ 展开钮 testid 随块 id 对齐（T32-01B 写回后）。 */
  const applyIdentity = (): void => {
    const id: unknown = current.attrs['id'];
    const value = typeof id === 'string' && id.length > 0 ? id : '';
    if (value.length > 0) {
      dom.setAttribute('data-id', value);
    } else {
      dom.removeAttribute('data-id');
    }
    arrow.setAttribute('data-testid', `block-toggle-${value}`);
  };

  /** 展开态 → DOM（零事务）。 */
  const applyOpen = (): void => {
    dom.dataset['open'] = open ? 'true' : 'false';
    dom.classList.toggle('sc-toggle--open', open);
    arrow.setAttribute('aria-expanded', open ? 'true' : 'false');
    arrow.setAttribute('aria-label', open ? labels.toggleCollapse : labels.toggleExpand);
    bodyEl.hidden = !open;
  };

  const focusLine = (index: number): void => {
    if (!open) {
      open = true;
      applyOpen();
    }
    const input = bodyInputs[index];
    if (input !== undefined) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  };

  const build = (): void => {
    applyIdentity();
    const value = content();
    head.textContent = '';
    const title = document.createElement('input');
    title.type = 'text';
    title.className = 'sc-toggle__title';
    title.setAttribute('data-testid', 'block-toggle-title');
    title.setAttribute('aria-label', labels.toggleTitlePlaceholder);
    title.placeholder = labels.toggleTitlePlaceholder;
    title.value = value.title;
    const onTitle = (): void => {
      const fresh = content();
      if (fresh.title === title.value) {
        return;
      }
      commit(toggleSetTitle(fresh, title.value));
    };
    title.addEventListener('input', onTitle);
    title.addEventListener('change', onTitle);
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const fresh = content();
        const at = fresh.body.length;
        pendingBodyFocus = at;
        commit(toggleAddBodyLine(fresh, at));
        return;
      }
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        focusLine(0);
      }
    });
    head.append(arrow, title);
    titleInput = title;

    bodyEl.textContent = '';
    bodyInputs = [];
    value.body.forEach((line, index) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sc-toggle__line';
      input.setAttribute('data-testid', `block-toggle-line-${String(index)}`);
      input.setAttribute('data-line', String(index));
      input.setAttribute('aria-label', labels.toggleBodyPlaceholder);
      input.placeholder = labels.toggleBodyPlaceholder;
      input.value = line;
      const onLine = (): void => {
        const fresh = content();
        if (fresh.body[index] === input.value) {
          return;
        }
        commit(toggleSetBodyLine(fresh, index, input.value));
      };
      input.addEventListener('input', onLine);
      input.addEventListener('change', onLine);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const fresh = content();
          const at = index + 1;
          pendingBodyFocus = at;
          commit(toggleAddBodyLine(fresh, at));
          return;
        }
        if (event.key === 'Backspace' && input.value.length === 0) {
          // 空正文行：吃掉按键（不让宿主/PM 拿它去删块），仅当 >1 行时真删一行
          event.preventDefault();
          const fresh = content();
          if (fresh.body.length > 1) {
            pendingBodyFocus = Math.max(0, index - 1);
            commit(toggleDeleteBodyLine(fresh, index));
          }
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          const next = index + (event.shiftKey ? -1 : 1);
          if (next >= 0 && next < bodyInputs.length) {
            focusLine(next);
          } else if (next < 0) {
            titleInput?.focus();
          }
        }
      });
      bodyEl.appendChild(input);
      bodyInputs.push(input);
    });
    applyOpen();
    if (pendingBodyFocus !== null) {
      const target = pendingBodyFocus;
      pendingBodyFocus = null;
      focusLine(target);
    }
  };

  const syncValues = (): void => {
    applyIdentity();
    const value = content();
    if (titleInput !== null && document.activeElement !== titleInput && titleInput.value !== value.title) {
      titleInput.value = value.title;
    }
    for (let index = 0; index < value.body.length; index += 1) {
      const input = bodyInputs[index];
      const expected = value.body[index] ?? '';
      if (input !== undefined && document.activeElement !== input && input.value !== expected) {
        input.value = expected;
      }
    }
    applyOpen();
  };

  arrow.addEventListener('click', () => {
    // 纯视图态翻转：不派发事务、不改 content（PRD §2B 口径）
    open = !open;
    applyOpen();
  });

  // 与表格同口径：折叠块内按键不冒泡出块（宿主 .pv-body 的斜杠触发不抢键盘）
  for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput']) {
    dom.addEventListener(type, (event) => {
      event.stopPropagation();
    });
  }

  build();

  return {
    dom,
    update: (updated: PMNode): boolean => {
      if (updated.type.name !== TOGGLE_PM_NAME) {
        return false;
      }
      const previousLines = content().body.length;
      current = updated;
      if (content().body.length !== previousLines) {
        build();
      } else {
        syncValues();
      }
      return true;
    },
    // 注：本文件的 `Node` 标识符被 Tiptap 的 Node 占用，DOM 判定显式走 globalThis.Node。
    stopEvent: (event: Event): boolean =>
      INNER_EVENT_TYPES.has(event.type) &&
      event.target instanceof globalThis.Node &&
      dom.contains(event.target),
    ignoreMutation: (): boolean => true,
    selectNode: (): void => {
      dom.classList.add('sc-block--selected');
    },
    deselectNode: (): void => {
      dom.classList.remove('sc-block--selected');
    },
  };
}

export const ToggleNode = Node.create({
  name: TOGGLE_PM_NAME,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { labels: DEFAULT_BLOCK_LABELS as BlockLabels };
  },

  addAttributes() {
    return {
      ...blockIdAttribute,
      // 默认值是静态标量：数组默认值会被同型节点共享，正文行一律由 normalize 现场生成。
      title: {
        default: '',
        parseHTML: (): null => null,
        renderHTML: (): Record<string, unknown> => ({}),
      },
      body: {
        default: null,
        parseHTML: (): null => null,
        renderHTML: (): Record<string, unknown> => ({}),
      },
    };
  },

  parseHTML() {
    return [];
  },

  renderHTML({ node, HTMLAttributes }) {
    const value = toggleContentOf(node);
    const lines: DOMOutputSpec[] = value.body.map((line) => [
      'div',
      { class: 'sc-toggle__plain-line' },
      line,
    ]);
    return [
      'div',
      { ...HTMLAttributes, class: blockClass(TOGGLE_PM_NAME), 'data-toggle': 'true' },
      ['div', { class: 'sc-toggle__plain-title' }, value.title],
      ...lines,
    ];
  },

  addNodeView() {
    const labels = this.options.labels;
    return (viewProps) =>
      createToggleView(
        { node: viewProps.node, editor: viewProps.editor, getPos: () => viewProps.getPos() },
        labels,
      );
  },
});
