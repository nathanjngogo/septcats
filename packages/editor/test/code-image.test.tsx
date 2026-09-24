// @vitest-environment jsdom
/**
 * code-image.test.ts —— R26（TASK-T77-01）代码块语言栏 / 换行开关 / 图片宽度拖拽的
 * 就近用例（含纯函数与 jsdom 事件态机）。
 *
 * 覆盖任务书 §A/§B/§C 与 testid 契约：
 * - 语言常量表（12 语言 + 自动）与文案回落；
 * - 装载往返：lang/wrap attr → DOM（data-lang / --wrap 类 / 淡标签）；
 * - 聚焦显形 / blur 收起的态机（fireEvent.focus/blur 走 Tiptap focusEvents 真链）；
 * - 选择语言 / 切换 wrap → 写既有 attr → onChange 反投影；
 * - 图片宽度拖拽吸附纯函数；拖拽中 badge、松手落库 width attr、微位移不发事务。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import {
  CODE_LANG_AUTO_ID,
  CODE_LANGUAGES,
  CODE_LANG_OPTIONS,
  IMAGE_DEFAULT_WIDTH,
  IMAGE_WIDTH_STEP,
  codeLanguageLabel,
  imageWidthBadgeText,
  snapImageWidth,
  type Block,
  type BlockDoc,
} from '../src/index';
import { DEFAULT_BLOCK_LABELS } from '../src/types/blockLabels';
import { Editor } from '../src/react/Editor';

type EditorHandle = Exclude<
  Parameters<NonNullable<ComponentProps<typeof Editor>['onReady']>>[0],
  null
>;

const PAGE = 'pg-t77';
const CODE_ID = 'blk-t77-code';
const IMAGE_ID = 'blk-t77-image';
const SHA = 'a'.repeat(64);

function baseBlock(partial: Partial<Block> & Pick<Block, 'id' | 'type'>): Block {
  return {
    page_id: PAGE,
    props: {},
    content: null,
    parent_id: null,
    sort_key: 'A00000000',
    alive: 1,
    version: 1,
    last_edited: 0,
    ...partial,
  };
}

function codeBlock(lang: string, wrap = false, text = 'print(1)'): Block {
  return baseBlock({
    id: CODE_ID,
    type: 'code',
    props: wrap ? { lang, wrap: true } : { lang },
    content: text,
  });
}

function imageBlock(width: number | null): Block {
  return baseBlock({
    id: IMAGE_ID,
    type: 'image',
    props: width === null ? { file_id: SHA, caption: '图' } : { file_id: SHA, caption: '图', width },
  });
}

function docOf(...blocks: Block[]): BlockDoc {
  return { pageId: PAGE, blocks };
}

function mount(doc: BlockDoc): {
  container: HTMLElement;
  onChange: ReturnType<typeof vi.fn>;
  editor: { current: EditorHandle | null };
} {
  const onChange = vi.fn();
  const editor: { current: EditorHandle | null } = { current: null };
  const { container } = render(
    <Editor
      doc={doc}
      onChange={onChange}
      onReady={(instance) => {
        editor.current = instance;
      }}
    />,
  );
  return { container, onChange, editor };
}

function lastDoc(spy: ReturnType<typeof vi.fn>): BlockDoc {
  const call = spy.mock.calls[spy.mock.calls.length - 1];
  return call?.[0] as BlockDoc;
}

function blockOf(doc: BlockDoc, id: string): Block | undefined {
  return doc.blocks.find((block) => block.id === id);
}

const pmRootOf = (container: HTMLElement): HTMLElement =>
  container.querySelector('.ProseMirror') as HTMLElement;

/** 让 caret 落进代码块（配合 fireEvent.focus 走 Tiptap focusEvents 真链）。 */
function focusCodeBlock(container: HTMLElement, editor: EditorHandle): void {
  fireEvent.focus(pmRootOf(container));
  let pos = -1;
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'codeBlock') {
      pos = offset;
    }
  });
  expect(pos).toBeGreaterThanOrEqual(0);
  editor.commands.setTextSelection(pos + 1);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('R26 语言常量表与文案回落', () => {
  it('12 语言白名单顺序固定且无重复', () => {
    expect(CODE_LANGUAGES).toHaveLength(12);
    expect([...CODE_LANGUAGES]).toEqual([
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
    ]);
    expect(new Set(CODE_LANGUAGES).size).toBe(12);
  });

  it('下拉选项 = 自动 + 12 语言；自动项 id=auto、值=空串', () => {
    expect(CODE_LANG_OPTIONS).toHaveLength(13);
    expect(CODE_LANG_OPTIONS[0]).toEqual({ id: CODE_LANG_AUTO_ID, value: '' });
    expect(CODE_LANG_OPTIONS.slice(1).map((option) => option.value)).toEqual([...CODE_LANGUAGES]);
  });

  it('codeLanguageLabel：空值走「自动」文案，语言名是专有名词原样返回（注入文案生效）', () => {
    expect(codeLanguageLabel('')).toBe(DEFAULT_BLOCK_LABELS.codeLangAuto);
    expect(codeLanguageLabel('')).toBe('自动');
    expect(codeLanguageLabel('python')).toBe('python');
    expect(codeLanguageLabel('', { ...DEFAULT_BLOCK_LABELS, codeLangAuto: 'Auto' })).toBe('Auto');
  });
});

describe('R26 代码块：装载往返 + 淡标签', () => {
  it('lang/wrap attr → DOM（data-lang / --wrap 类 / 语言栏 testid / 淡标签文本）', () => {
    const { container } = mount(docOf(codeBlock('python', true)));
    const pre = container.querySelector('pre.sc-block--code') as HTMLElement;
    expect(pre).not.toBeNull();
    expect(pre.getAttribute('data-id')).toBe(CODE_ID);
    expect(pre.getAttribute('data-lang')).toBe('python');
    expect(pre.classList.contains('sc-block--code--wrap')).toBe(true);
    // 语言栏钮（含当前语言文案）与换行钮 testid 随块 id
    const langBtn = container.querySelector(`[data-testid="codebar-lang-${CODE_ID}"]`);
    expect(langBtn?.textContent).toBe('python');
    expect(container.querySelector(`[data-testid="codebar-wrap-${CODE_ID}"]`)).not.toBeNull();
    // 未聚焦：语言栏收起、lang 非空 → 淡标签显形
    const bar = container.querySelector('.sc-codebar') as HTMLElement;
    expect(bar.dataset['visible']).toBe('false');
    const tag = container.querySelector(`[data-testid="code-lang-tag-${CODE_ID}"]`) as HTMLElement;
    expect(tag.textContent).toBe('python');
    expect(tag.hidden).toBe(false);
  });

  it('lang 为空（自动）→ 淡标签不显形', () => {
    const { container } = mount(docOf(codeBlock('')));
    const tag = container.querySelector(`[data-testid="code-lang-tag-${CODE_ID}"]`) as HTMLElement;
    expect(tag.hidden).toBe(true);
    expect(container.querySelector('pre.sc-block--code')?.getAttribute('data-lang')).toBe('');
  });
});

describe('R26 代码块：聚焦显形 / blur 收起态机', () => {
  it('caret 进入 → 语言栏浮出、淡标签隐；blur → 语言栏收起、淡标签复显', () => {
    const { container, editor } = mount(docOf(codeBlock('rust')));
    const bar = container.querySelector('.sc-codebar') as HTMLElement;
    const tag = container.querySelector(`[data-testid="code-lang-tag-${CODE_ID}"]`) as HTMLElement;
    expect(bar.dataset['visible']).toBe('false');

    focusCodeBlock(container, editor.current as EditorHandle);
    expect(bar.dataset['visible']).toBe('true');
    expect(tag.hidden).toBe(true);

    fireEvent.blur(pmRootOf(container));
    expect(bar.dataset['visible']).toBe('false');
    expect(tag.hidden).toBe(false);
  });

  it('caret 不在本块（选区落在别的块）→ 不显形', () => {
    const doc = docOf(
      baseBlock({ id: 'blk-p', type: 'paragraph', content: { type: 'doc', content: [] } }),
      codeBlock('go'),
    );
    const { container, editor } = mount(doc);
    const bar = container.querySelector('.sc-codebar') as HTMLElement;
    fireEvent.focus(pmRootOf(container));
    // 位置 1 = 首块（段落）内；代码块在其后 → 不应显形
    editor.current?.commands.setTextSelection(1);
    expect(bar.dataset['visible']).toBe('false');
  });
});

describe('R26 代码块：语言 / 换行选择写既有 attr', () => {
  it('选语言 → props.lang 更新（不新增 op 类型，只改 attr）', () => {
    const { container, onChange, editor } = mount(docOf(codeBlock('')));
    focusCodeBlock(container, editor.current as EditorHandle);
    fireEvent.click(container.querySelector(`[data-testid="codebar-lang-${CODE_ID}"]`) as HTMLElement);
    const option = container.querySelector(
      '[data-testid="codebar-lang-opt-typescript"]',
    ) as HTMLElement;
    expect(option).not.toBeNull();
    fireEvent.click(option);
    expect(blockOf(lastDoc(onChange), CODE_ID)?.props['lang']).toBe('typescript');
    expect(container.querySelector('pre.sc-block--code')?.getAttribute('data-lang')).toBe('typescript');
    // 菜单选后收起
    expect((container.querySelector('.sc-codebar__menu') as HTMLElement).hidden).toBe(true);
  });

  it('换行钮：wrap false → true → false（DOM 修饰类随 attr 同步）', () => {
    const { container, onChange, editor } = mount(docOf(codeBlock('bash', false)));
    focusCodeBlock(container, editor.current as EditorHandle);
    const wrapBtn = container.querySelector(`[data-testid="codebar-wrap-${CODE_ID}"]`) as HTMLElement;
    expect(wrapBtn.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(wrapBtn);
    expect(blockOf(lastDoc(onChange), CODE_ID)?.props['wrap']).toBe(true);
    expect(container.querySelector('pre.sc-block--code')?.classList.contains('sc-block--code--wrap')).toBe(
      true,
    );
    expect(wrapBtn.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(wrapBtn);
    const props = blockOf(lastDoc(onChange), CODE_ID)?.props ?? {};
    expect(props['wrap']).not.toBe(true);
  });
});

describe('R26 图片宽度：吸附纯函数与 badge 文案', () => {
  it('snapImageWidth：8px 网格四舍五入 + 上下限夹紧', () => {
    expect(IMAGE_WIDTH_STEP).toBe(8);
    expect(snapImageWidth(483, 1000)).toBe(480);
    expect(snapImageWidth(485, 1000)).toBe(488);
    expect(snapImageWidth(480, 1000)).toBe(480);
    // 下限夹紧
    expect(snapImageWidth(10, 1000)).toBe(48);
    // 上限先对齐网格（容器 500 → 网格 496）
    expect(snapImageWidth(9999, 500)).toBe(496);
  });

  it('imageWidthBadgeText：可量测 → 百分比；不可量测 → 像素退化', () => {
    expect(imageWidthBadgeText(400, 800)).toBe('50%');
    expect(imageWidthBadgeText(560, 800)).toBe('70%');
    expect(imageWidthBadgeText(480, 0)).toBe('480px');
  });
});

describe('R26 图片宽度：拖拽柄', () => {
  it('装载：右缘拖拽柄 testid 随块 id；badge 初始隐藏；width attr 落 img', () => {
    const { container } = mount(docOf(imageBlock(480)));
    const figure = container.querySelector('figure.sc-block--image') as HTMLElement;
    expect(figure.getAttribute('data-id')).toBe(IMAGE_ID);
    const handle = container.querySelector(`[data-testid="image-resize-handle-${IMAGE_ID}"]`);
    expect(handle).not.toBeNull();
    const badge = container.querySelector('[data-testid="image-width-badge"]') as HTMLElement;
    expect(badge.hidden).toBe(true);
    expect(container.querySelector('img.sc-image-body')?.getAttribute('width')).toBe('480');
  });

  it('拖拽 → width attr 吸附落库；badge 拖拽中显、松手收', () => {
    const { container, onChange } = mount(docOf(imageBlock(480)));
    const handle = container.querySelector(
      `[data-testid="image-resize-handle-${IMAGE_ID}"]`,
    ) as HTMLElement;
    const badge = container.querySelector('[data-testid="image-width-badge"]') as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 100 });
    expect(badge.hidden).toBe(false);
    fireEvent.mouseMove(document, { clientX: 141 });
    // 480 + 41 = 521 → 网格 520
    expect(container.querySelector('img.sc-image-body')?.getAttribute('width')).toBe('520');
    fireEvent.mouseUp(document, { clientX: 141 });

    expect(blockOf(lastDoc(onChange), IMAGE_ID)?.props['width']).toBe(520);
    expect(badge.hidden).toBe(true);
  });

  it('微小位移（< 阈值）不发事务：点击柄不误改宽度', () => {
    const { container, onChange } = mount(docOf(imageBlock(480)));
    const handle = container.querySelector(
      `[data-testid="image-resize-handle-${IMAGE_ID}"]`,
    ) as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseUp(document, { clientX: 101 });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('img.sc-image-body')?.getAttribute('width')).toBe('480');
  });

  it('容器可量测 → 拖拽中 badge 显示百分比', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ): DOMRect {
      const cls = typeof this.className === 'string' ? this.className : '';
      const width = cls.includes('sc-image-frame') ? 800 : 0;
      return { top: 0, left: 0, right: width, bottom: 0, width, height: 0, x: 0, y: 0 } as DOMRect;
    });
    const { container } = mount(docOf(imageBlock(400)));
    const handle = container.querySelector(
      `[data-testid="image-resize-handle-${IMAGE_ID}"]`,
    ) as HTMLElement;
    const badge = container.querySelector('[data-testid="image-width-badge"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 260 });
    // 400 + 160 = 560 → 网格 560；560/800 = 70%
    expect(badge.textContent).toBe('70%');
    fireEvent.mouseUp(document, { clientX: 260 });
  });

  it('width 缺省（null）→ 拖拽基准取默认 480，badge 无容器量测时退化为像素', () => {
    const { container, onChange } = mount(docOf(imageBlock(null)));
    const handle = container.querySelector(
      `[data-testid="image-resize-handle-${IMAGE_ID}"]`,
    ) as HTMLElement;
    const badge = container.querySelector('[data-testid="image-width-badge"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 0 });
    fireEvent.mouseMove(document, { clientX: 8 });
    expect(badge.textContent).toBe(`${IMAGE_DEFAULT_WIDTH + 8}px`);
    fireEvent.mouseUp(document, { clientX: 8 });
    expect(blockOf(lastDoc(onChange), IMAGE_ID)?.props['width']).toBe(IMAGE_DEFAULT_WIDTH + 8);
  });
});
