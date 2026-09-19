import { afterEach, describe, expect, it } from 'vitest';
import { Editor as TiptapEditor } from '@tiptap/core';
import { editorExtensions } from '../src/types';
import { matchInputRule } from '../src/rules/inputRules';
import { parseMarkdown } from '../src/rules/markdownPaste';
import {
  activeSlashItem,
  closeSlashMenu,
  createSlashMenuState,
  filterSlashCommands,
  moveSlashActive,
  openSlashMenu,
  setSlashQuery,
  SLASH_ITEMS,
} from '../src/rules/slashMenu';
import type { PMDocJSON } from '../src/model';

const editors: TiptapEditor[] = [];

function createEditor(content?: PMDocJSON): TiptapEditor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = new TiptapEditor({
    element: host,
    extensions: editorExtensions(),
    content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editors.push(editor);
  return editor;
}

function typeInto(editor: TiptapEditor, text: string): boolean | undefined {
  editor.commands.insertContent(text);
  const view = editor.view;
  const pos = editor.state.selection.from;
  // PM handleTextInput 签名：(view, from, to, text, deflt: () => Transaction)
  // 注意 someProp 只回传真值：处理器返回 false 时它继续找下一个插件，最终 undefined。
  // 因此「未被处理」= 非 true，这里归一为 boolean 供断言。
  const handled = view.someProp('handleTextInput', (handler) => handler(view, pos, pos, ' ', () => view.state.tr));
  return handled === true;
}

function fireComposition(editor: TiptapEditor, type: 'compositionstart' | 'compositionend'): void {
  const event =
    typeof CompositionEvent === 'function'
      ? new CompositionEvent(type, { bubbles: true })
      : new Event(type, { bubbles: true });
  editor.view.dom.dispatchEvent(event);
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
});

describe('inputRules：纯判定（半角 ASCII 触发集）', () => {
  const positives: Array<[string, string]> = [
    ['# ', 'heading'],
    ['## ', 'heading'],
    ['### ', 'heading'],
    ['- ', 'bulleted_list'],
    ['* ', 'bulleted_list'],
    ['1. ', 'numbered_list'],
    ['42. ', 'numbered_list'],
    ['[] ', 'to_do'],
    ['[ ] ', 'to_do'],
    ['[x] ', 'to_do'],
    ['[X] ', 'to_do'],
    ['> ', 'quote'],
    ['```', 'code'],
    ['```ts', 'code'],
  ];

  for (const [text, kind] of positives) {
    it(`${JSON.stringify(text)} → ${kind}`, () => {
      const action = matchInputRule(text, false);
      expect(action?.kind).toBe(kind);
      expect(action?.deleteChars).toBe(text.length);
    });
  }

  it('heading 等级与 to_do 勾选态正确', () => {
    expect(matchInputRule('### ', false)).toMatchObject({ kind: 'heading', level: 3 });
    expect(matchInputRule('[x] ', false)).toMatchObject({ kind: 'to_do', checked: true });
    expect(matchInputRule('[ ] ', false)).toMatchObject({ kind: 'to_do', checked: false });
    expect(matchInputRule('```rust', false)).toMatchObject({ kind: 'code', lang: 'rust' });
  });

  it('IME 组合期（composing=true）恒不触发', () => {
    for (const [text] of positives) {
      expect(matchInputRule(text, true)).toBeNull();
    }
  });

  it('CJK 标点安全：全角井号 / 全角空格 / 中文标点都不触发', () => {
    for (const text of ['＃ ', '＃＃ ', '#\u3000', '、', '。', '＞ ', '· ']) {
      expect(matchInputRule(text, false)).toBeNull();
    }
    expect(matchInputRule('- ', false)?.kind).toBe('bulleted_list');
  });

  it('非法/未完成形态不触发', () => {
    for (const text of ['', '#', '##', '-', '1.', '[]', '[x]', '``', '````', '#### ', '1． ']) {
      expect(matchInputRule(text, false)).toBeNull();
    }
  });
});

describe('inputRules：真 PM 执行（jsdom 也跑真 ProseMirror）', () => {
  it('非组合期：输入「# 」→ 当前块变 heading，井号被吃掉', () => {
    const editor = createEditor();
    const handled = typeInto(editor, '#');
    expect(handled).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.state.doc.firstChild?.attrs['level']).toBe(1);
    expect(editor.state.doc.firstChild?.textContent).toBe('');
  });

  it('块 id 保留（T32-01B）：带 id 的段落经输入规则转 heading 后 id 不被冲掉', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: 'blk-keep' } }],
    });
    expect(typeInto(editor, '#')).toBe(true);
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe('heading');
    expect(first?.attrs['level']).toBe(1);
    expect(first?.attrs['id']).toBe('blk-keep');
  });

  it('IME 组合期：compositionstart → 输入「# 」无任何变化；compositionend 后恢复', () => {
    const editor = createEditor();
    fireComposition(editor, 'compositionstart');
    const handled = typeInto(editor, '#');
    expect(handled).toBe(false);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');

    fireComposition(editor, 'compositionend');
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(typeInto(editor, '-')).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe('bulleted_list');
  });

  it('code 块内不触发规则', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { id: 'blk-code', lang: '' } }],
    });
    expect(typeInto(editor, '#')).toBe(false);
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock');
  });
});

describe('slashMenu：三通道匹配 + 状态机', () => {
  it('空 query 返回内置顺序的全部菜单项', () => {
    expect(filterSlashCommands('')).toHaveLength(SLASH_ITEMS.length);
    expect(filterSlashCommands('')[0]?.id).toBe('paragraph');
  });

  it('拼音首字母 / 全拼 / 中文 / 英文别名都能命中', () => {
    expect(filterSlashCommands('dm')[0]?.blockType).toBe('code');
    expect(filterSlashCommands('daima')[0]?.blockType).toBe('code');
    expect(filterSlashCommands('bt')[0]?.blockType).toBe('heading');
    expect(filterSlashCommands('标题')[0]?.id).toBe('heading1');
    expect(filterSlashCommands('todo')[0]?.blockType).toBe('to_do');
    expect(filterSlashCommands('fgx')[0]?.blockType).toBe('divider');
    expect(filterSlashCommands('zzz')).toEqual([]);
  });

  it('排序稳定：标题三级按 1/2/3 出场', () => {
    expect(filterSlashCommands('biaoti').map((item) => item.id)).toEqual([
      'heading1',
      'heading2',
      'heading3',
    ]);
  });

  it('状态机：open → 过滤 → 循环移动 → 选中/关闭', () => {
    let state = createSlashMenuState();
    expect(state.open).toBe(false);
    state = openSlashMenu(state);
    expect(state.open).toBe(true);
    expect(activeSlashItem(state)?.id).toBe('paragraph');

    state = moveSlashActive(state, 1);
    state = moveSlashActive(state, 1);
    expect(activeSlashItem(state)?.id).toBe('heading2');

    state = moveSlashActive(state, -1);
    expect(activeSlashItem(state)?.id).toBe('heading1');

    state = setSlashQuery(state, 'dm');
    expect(activeSlashItem(state)?.blockType).toBe('code');

    state = moveSlashActive(state, 99);
    expect(state.activeIndex).toBeLessThan(state.items.length);

    state = closeSlashMenu(state);
    expect(state.open).toBe(false);
    expect(activeSlashItem(state)).toBeNull();
  });
});

describe('markdownPaste：子集解析（≥20 例）', () => {
  interface MdCase {
    md: string;
    types: string[];
    marks?: string[];
  }

  const cases: MdCase[] = [
    { md: '# 一级标题', types: ['heading'] },
    { md: '### 三级标题', types: ['heading'] },
    { md: '#### 四级标题（钳到 H3）', types: ['heading'] },
    { md: '普通段落', types: ['paragraph'] },
    { md: '- 无序项', types: ['bulleted_list'] },
    { md: '* 星号无序项', types: ['bulleted_list'] },
    { md: '+ 加号无序项', types: ['bulleted_list'] },
    { md: '1. 有序项', types: ['numbered_list'] },
    { md: '12) 另一种有序', types: ['numbered_list'] },
    { md: '- [ ] 待办', types: ['to_do'] },
    { md: '- [x] 已完成', types: ['to_do'] },
    { md: '> 引用', types: ['quote'] },
    { md: '---', types: ['divider'] },
    { md: '***', types: ['divider'] },
    { md: '___', types: ['divider'] },
    { md: '```ts\nconst a = 1;\n```', types: ['codeBlock'] },
    { md: '```\nplain text\n```', types: ['codeBlock'] },
    { md: '**加粗**', types: ['paragraph'], marks: ['bold'] },
    { md: '*斜体*', types: ['paragraph'], marks: ['italic'] },
    { md: '~~删除线~~', types: ['paragraph'], marks: ['strike'] },
    { md: '`inline code`', types: ['paragraph'], marks: ['code'] },
    { md: '[链接](https://example.com)', types: ['paragraph'], marks: ['link'] },
    { md: '[站内](page:abc)', types: ['paragraph'], marks: ['link'] },
    { md: '[坏链](javascript:alert(1))', types: ['paragraph'], marks: [] },
    { md: '# 标题\n\n- [x] 待办\n\n> 引用', types: ['heading', 'to_do', 'quote'] },
  ];

  for (const testCase of cases) {
    it(`解析 ${JSON.stringify(testCase.md.slice(0, 24))}`, () => {
      const doc = parseMarkdown(testCase.md);
      expect(doc.type).toBe('doc');
      expect(doc.content?.map((node) => node.type)).toEqual(testCase.types);
      if (testCase.marks !== undefined) {
        const first = doc.content?.[0];
        const marks = (first?.content ?? []).flatMap((node) => node.marks ?? []);
        expect(marks.map((mark) => mark.type)).toEqual(testCase.marks);
      }
    });
  }

  it('标题等级钳在 1..3；代码围栏带 lang', () => {
    const doc = parseMarkdown('#### H4\n\n```rust\nfn main() {}\n```');
    expect(doc.content?.[0]?.attrs?.['level']).toBe(3);
    expect(doc.content?.[1]?.attrs?.['lang']).toBe('rust');
  });

  it('未闭合围栏也产出 code 块（不吞内容）', () => {
    const doc = parseMarkdown('```js\nconst a = 1;');
    expect(doc.content?.[0]?.type).toBe('codeBlock');
    expect(doc.content?.[0]?.content?.[0]?.text).toBe('const a = 1;');
  });

  it('空输入退化为单个空 paragraph', () => {
    expect(parseMarkdown('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
