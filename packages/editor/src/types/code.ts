import { Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { DEFAULT_BLOCK_LABELS, type BlockLabels } from './blockLabels';
import { blockClass, blockIdAttribute, joinClass } from './shared';

/**
 * 7 · code —— content 是**纯文本 string**（schema-v1 §3/§7 裁决：不转 PM doc）。
 * PM 侧用 text* 承载；mark 全部禁用；wrap 只做展示开关。
 * 节点名 = codeBlock：PM 禁止 node/mark 同名，而内联 mark 占了 'code'
 * （真相层类型名由 model.ts 的 pmNodeNameOf 映射，持久化仍是 'code'）。
 *
 * R26（T77-01）：加**原生 DOM NodeView**——聚焦（caret 进入）时块右上角浮出语言栏
 * （12 语言白名单 + 自动）与换行开关；失焦收起、左上角淡显 lang 标签。改动只写
 * `lang`/`wrap` 两个**既有 attr**（走既有 patch op 通道，op 类型零新增）。
 * 本包当前**无语法高亮引擎**（§0-③ 实证）：lang 的 UI 价值 = 为导出/未来高亮保留
 * 真相层，B 项（淡标签）只做可见性，不引入 highlight.js。
 */
export const CODE_BLOCK_PM_NAME = 'codeBlock';

/** 语言白名单（task §A.1：12 语言，常量数组放包内）。顺序即下拉展示顺序。 */
export const CODE_LANGUAGES: readonly string[] = [
  'javascript',
  'typescript',
  'python',
  'bash',
  'json',
  'html',
  'css',
  'sql',
  'markdown',
  'yaml',
  'rust',
  'go',
];

/** 「自动」选项的稳定 id（值 = 空串 = 无语言）。 */
export const CODE_LANG_AUTO_ID = 'auto';

/** 换行修饰类（与 renderHTML 的 `${blockClass('code')}--wrap` 同源，单点定义）。 */
export const CODE_WRAP_CLASS = 'sc-block--code--wrap';

export interface CodeLangOption {
  /** 下拉项 id（= testid 后缀）：'auto' 或语言名。 */
  id: string;
  /** 写入 attr 的值：''（自动）或语言名。 */
  value: string;
}

/** 选项表：自动（值 ''）+ 12 语言。 */
export const CODE_LANG_OPTIONS: readonly CodeLangOption[] = [
  { id: CODE_LANG_AUTO_ID, value: '' },
  ...CODE_LANGUAGES.map((lang) => ({ id: lang, value: lang })),
];

/** 语言值 → 展示文案（空值走「自动」文案；语言名是专有名词，不翻译）。 */
export function codeLanguageLabel(value: string, labels: BlockLabels = DEFAULT_BLOCK_LABELS): string {
  return value.length > 0 ? value : labels.codeLangAuto;
}

/** 内置控件的 DOM 事件白名单——只对这些事件挡 PM（内容区不挡，保输入）。 */
const CODEBAR_EVENT_TYPES: ReadonlySet<string> = new Set([
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
 * 代码块 NodeView（原生 DOM）。
 * - dom = `pre.sc-block.sc-block--code`（与 renderHTML 同构，既有 CSS/测试零回归）；
 * - contentDOM = `code.sc-code-body`（文本仍由 PM 原位编辑，update 返回 true → 子节点由 PM 同步）；
 * - 语言栏/淡标签是**非内容DOM子元素**（绝对定位），经 ignoreMutation 挡在 PM 之外。
 *
 * 显形口径：`editor.isFocused && 选区落在本块内部`。聚焦态由 Tiptap 的
 * focusEvents 插件维护（view 根上 focus/blur → editor.isFocused + 事件），故真机
 * 「点进/点出代码块」自然成立；jsdom 下由 fireEvent.focus/blur 驱动同一条链。
 */
export function createCodeView(
  props: { node: PMNode; editor: Editor; getPos: () => number | undefined },
  labels: BlockLabels = DEFAULT_BLOCK_LABELS,
): NodeView {
  let current = props.node;
  let menuOpen = false;

  /** 读当前 attr 的 lang（半合法值一律收敛为 ''）。 */
  const langOf = (node: PMNode): string => {
    const value = node.attrs['lang'];
    return typeof value === 'string' ? value : '';
  };
  const wrapOf = (node: PMNode): boolean => node.attrs['wrap'] === true;

  const dom = document.createElement('pre');
  dom.className = joinClass(blockClass('code'), wrapOf(current) ? CODE_WRAP_CLASS : '');
  const tag = document.createElement('span');
  tag.className = 'sc-code-lang';
  const bar = document.createElement('div');
  bar.className = 'sc-codebar';
  bar.setAttribute('contenteditable', 'false');
  const langBtn = document.createElement('button');
  langBtn.type = 'button';
  langBtn.className = 'sc-codebar__btn';
  langBtn.setAttribute('aria-haspopup', 'menu');
  langBtn.setAttribute('aria-label', labels.codeLang);
  langBtn.addEventListener('mousedown', (event) => {
    // 保 caret 留在代码块：指针按下不夺焦（真机；jsdom 无副作用）
    event.preventDefault();
  });
  langBtn.addEventListener('click', (event) => {
    event.preventDefault();
    menuOpen = !menuOpen;
    renderMenu();
  });
  const wrapBtn = document.createElement('button');
  wrapBtn.type = 'button';
  wrapBtn.className = 'sc-codebar__btn';
  wrapBtn.textContent = '↵';
  wrapBtn.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  wrapBtn.addEventListener('click', (event) => {
    event.preventDefault();
    commitWrap(current.attrs['wrap'] !== true);
  });

  const menu = document.createElement('div');
  menu.className = 'sc-codebar__menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', labels.codeLang);
  for (const option of CODE_LANG_OPTIONS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'sc-codebar__item';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-testid', `codebar-lang-opt-${option.id}`);
    item.setAttribute('data-value', option.value);
    item.textContent = codeLanguageLabel(option.value, labels);
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    item.addEventListener('click', (event) => {
      event.preventDefault();
      commitLang(option.value);
    });
    menu.appendChild(item);
  }
  bar.append(langBtn, wrapBtn, menu);

  const body = document.createElement('code');
  body.className = 'sc-code-body';

  dom.append(tag, bar, body);

  /** 一次 setNodeMarkup 写回既有 attr（op 类型零新增；外发由宿主 EditSession 负责）。 */
  const commit = (patch: Record<string, unknown>): void => {
    const pos = props.getPos();
    if (typeof pos !== 'number') {
      return;
    }
    props.editor.view.dispatch(
      props.editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch }),
    );
  };

  const commitLang = (value: string): void => {
    menuOpen = false;
    if (langOf(current) !== value) {
      commit({ lang: value });
    }
    renderMenu();
    refresh();
  };

  const commitWrap = (value: boolean): void => {
    if (wrapOf(current) !== value) {
      commit({ wrap: value });
    }
    refresh();
  };

  function renderMenu(): void {
    menu.hidden = !menuOpen;
    langBtn.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
    const active = langOf(current);
    for (const item of [...menu.children]) {
      if (!(item instanceof HTMLButtonElement)) {
        continue;
      }
      const isCurrent = item.getAttribute('data-value') === active;
      item.classList.toggle('sc-codebar__item--current', isCurrent);
      item.setAttribute('aria-current', isCurrent ? 'true' : 'false');
    }
  }

  /** attr → DOM（data-id / data-lang / wrap 修饰类 / 钮文案 / 淡标签文本）。 */
  const applyAttrs = (): void => {
    const id: unknown = current.attrs['id'];
    const idValue = typeof id === 'string' && id.length > 0 ? id : '';
    if (idValue.length > 0) {
      dom.setAttribute('data-id', idValue);
    } else {
      dom.removeAttribute('data-id');
    }
    const lang = langOf(current);
    dom.setAttribute('data-lang', lang);
    dom.classList.toggle(CODE_WRAP_CLASS, wrapOf(current));
    langBtn.setAttribute('data-testid', `codebar-lang-${idValue}`);
    langBtn.textContent = codeLanguageLabel(lang, labels);
    wrapBtn.setAttribute('data-testid', `codebar-wrap-${idValue}`);
    wrapBtn.setAttribute('aria-pressed', wrapOf(current) ? 'true' : 'false');
    wrapBtn.setAttribute('aria-label', wrapOf(current) ? labels.codeWrapOn : labels.codeWrapOff);
    tag.setAttribute('data-testid', `code-lang-tag-${idValue}`);
    tag.textContent = lang;
    renderMenu();
    applyVisibility();
  };

  /** 选区是否落在本块**内部**（caret 进入；端点位置不算，避免相邻块尾误显形）。 */
  const selectionInside = (): boolean => {
    const pos = props.getPos();
    if (typeof pos !== 'number') {
      return false;
    }
    const { from, to } = props.editor.state.selection;
    return from > pos && to < pos + current.nodeSize;
  };

  /** 显形 = 编辑器聚焦 且 caret 在本块（bar 显 / 淡标签隐）；否则 bar 隐、lang 非空则淡标签显。 */
  function applyVisibility(): void {
    const lang = langOf(current);
    const focused = props.editor.isFocused && selectionInside();
    if (!focused && menuOpen) {
      // caret 离开本块：语言栏收起时一并收掉展开中的下拉，避免残留开态
      menuOpen = false;
      renderMenu();
    }
    bar.dataset['visible'] = focused ? 'true' : 'false';
    tag.hidden = focused || lang.length === 0;
  }

  function refresh(): void {
    applyAttrs();
  }

  const onSelection = (): void => {
    applyVisibility();
  };
  const onFocus = (): void => {
    applyVisibility();
  };
  const onBlur = (): void => {
    menuOpen = false;
    renderMenu();
    applyVisibility();
  };
  props.editor.on('selectionUpdate', onSelection);
  props.editor.on('focus', onFocus);
  props.editor.on('blur', onBlur);

  applyAttrs();

  return {
    dom,
    contentDOM: body,
    update: (updated: PMNode): boolean => {
      if (updated.type.name !== CODE_BLOCK_PM_NAME) {
        return false;
      }
      current = updated;
      applyAttrs();
      return true;
    },
    // 语言栏/淡标签不是内容：其 DOM 变更不进 PM 的文档模型。
    ignoreMutation: (mutation): boolean =>
      !(mutation.target instanceof globalThis.Node) || !body.contains(mutation.target),
    // 内置控件事件挡在 PM 外（内容区不挡，保住键入与选区）。
    stopEvent: (event): boolean =>
      CODEBAR_EVENT_TYPES.has(event.type) &&
      event.target instanceof globalThis.Node &&
      bar.contains(event.target),
    destroy: (): void => {
      props.editor.off('selectionUpdate', onSelection);
      props.editor.off('focus', onFocus);
      props.editor.off('blur', onBlur);
    },
  };
}

export const CodeNode = Node.create({
  name: CODE_BLOCK_PM_NAME,
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  addOptions() {
    return { labels: DEFAULT_BLOCK_LABELS as BlockLabels };
  },

  addAttributes() {
    return {
      ...blockIdAttribute,
      lang: {
        default: '',
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-lang'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, unknown> =>
          typeof attributes['lang'] === 'string' && attributes['lang'].length > 0
            ? { 'data-lang': attributes['lang'] }
            : {},
      },
      wrap: {
        default: false,
        parseHTML: (element: HTMLElement): boolean | null => {
          const raw = element.getAttribute('data-wrap');
          return raw === null ? null : raw === 'true';
        },
        renderHTML: (): Record<string, unknown> => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'pre', preserveWhitespace: 'full' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const lang = typeof node.attrs['lang'] === 'string' ? node.attrs['lang'] : '';
    const wrap = node.attrs['wrap'] === true;
    return [
      'pre',
      {
        ...HTMLAttributes,
        // joinClass 去重：blockClass('code') 自带 'sc-block'，直接拼 `${blockClass}--wrap`
        // 会重复 sc-block（TASK-T20-01 修复的真残留点）
        class: wrap
          ? joinClass(blockClass('code'), `${blockClass('code')}--wrap`)
          : blockClass('code'),
        'data-lang': lang,
      },
      ['code', { class: 'sc-code-body' }, 0],
    ];
  },

  addNodeView() {
    const labels = this.options.labels;
    return (viewProps) =>
      createCodeView(
        { node: viewProps.node, editor: viewProps.editor, getPos: () => viewProps.getPos() },
        labels,
      );
  },
});
