import { describe, expect, it } from 'vitest';
import { pmDocToBlocks, type BlockSpec } from '../src/blocks';
import { parseMarkdown } from '../src/rules/markdownPaste';
import type { PMDocJSON, PMNodeJSON } from '../src/model';

function docOf(...nodes: PMNodeJSON[]): PMDocJSON {
  return { type: 'doc', content: nodes };
}

function textNode(value: string, marks?: PMNodeJSON['marks']): PMNodeJSON {
  return marks === undefined ? { type: 'text', text: value } : { type: 'text', text: value, marks };
}

function para(value: string): PMNodeJSON {
  return { type: 'paragraph', content: [textNode(value)] };
}

/** 文本类块的期望 content（恰好一个 paragraph 包裹内联）。 */
function inlineDocOf(...inline: PMNodeJSON[]): PMDocJSON {
  return inline.length === 0
    ? { type: 'doc', content: [{ type: 'paragraph' }] }
    : { type: 'doc', content: [{ type: 'paragraph', content: inline }] };
}

function expectBlock(spec: BlockSpec, type: string, props: unknown, content: unknown): void {
  expect(spec.type).toBe(type);
  expect(spec.props).toEqual(props);
  expect(spec.content).toEqual(content);
}

describe('blocks：16 块型（对照 packages/schema blockTypes）', () => {
  it('paragraph：空内联不写 content 键；有文本走单 paragraph 包裹', () => {
    const empty = pmDocToBlocks(docOf({ type: 'paragraph' }));
    expect(empty).toHaveLength(1);
    expectBlock(empty[0] as BlockSpec, 'paragraph', {}, inlineDocOf());

    const withText = pmDocToBlocks(docOf(para('你好')));
    expectBlock(withText[0] as BlockSpec, 'paragraph', {}, inlineDocOf(textNode('你好')));
  });

  it('heading1/2/3：level 进 props', () => {
    for (const level of [1, 2, 3] as const) {
      const specs = pmDocToBlocks(
        docOf({ type: 'heading', attrs: { level }, content: [textNode(`H${level}`)] }),
      );
      expectBlock(specs[0] as BlockSpec, 'heading', { level }, inlineDocOf(textNode(`H${level}`)));
    }
  });

  it('bulleted_list：props 恒空', () => {
    const specs = pmDocToBlocks(
      docOf({ type: 'bulleted_list', content: [textNode('条目')] }),
    );
    expectBlock(specs[0] as BlockSpec, 'bulleted_list', {}, inlineDocOf(textNode('条目')));
  });

  it('numbered_list：start 仅在有值且 ≠1 时进 props', () => {
    const plain = pmDocToBlocks(docOf({ type: 'numbered_list', content: [textNode('a')] }));
    expectBlock(plain[0] as BlockSpec, 'numbered_list', {}, inlineDocOf(textNode('a')));

    const started = pmDocToBlocks(
      docOf({ type: 'numbered_list', attrs: { start: 5 }, content: [textNode('a')] }),
    );
    expectBlock(started[0] as BlockSpec, 'numbered_list', { start: 5 }, inlineDocOf(textNode('a')));
  });

  it('todo：checked 恒写', () => {
    const open = pmDocToBlocks(docOf({ type: 'to_do', attrs: { checked: false } }));
    expectBlock(open[0] as BlockSpec, 'to_do', { checked: false }, inlineDocOf());

    const done = pmDocToBlocks(
      docOf({ type: 'to_do', attrs: { checked: true }, content: [textNode('完成')] }),
    );
    expectBlock(done[0] as BlockSpec, 'to_do', { checked: true }, inlineDocOf(textNode('完成')));
  });

  it('quote 与 callout（quote + props.icon）', () => {
    const quote = pmDocToBlocks(docOf({ type: 'quote', content: [textNode('引用')] }));
    expectBlock(quote[0] as BlockSpec, 'quote', {}, inlineDocOf(textNode('引用')));

    const callout = pmDocToBlocks(
      docOf({ type: 'quote', attrs: { icon: '💡' }, content: [textNode('提示')] }),
    );
    expectBlock(callout[0] as BlockSpec, 'quote', { icon: '💡' }, inlineDocOf(textNode('提示')));
  });

  it('code：codeBlock 节点名还原为真相层 code，content 收敛为纯文本 string', () => {
    const specs = pmDocToBlocks(
      docOf({ type: 'codeBlock', attrs: { lang: 'ts' }, content: [textNode('const a = 1;')] }),
    );
    expectBlock(specs[0] as BlockSpec, 'code', { lang: 'ts' }, 'const a = 1;');

    const bare = pmDocToBlocks(docOf({ type: 'codeBlock' }));
    expectBlock(bare[0] as BlockSpec, 'code', { lang: '' }, '');
  });

  it('divider：content 恒 null', () => {
    const specs = pmDocToBlocks(docOf({ type: 'divider' }));
    expectBlock(specs[0] as BlockSpec, 'divider', {}, null);
  });

  it('image：file_id 必写，caption/width 有值才写，content 恒 null', () => {
    const full = pmDocToBlocks(
      docOf({
        type: 'image',
        attrs: { file_id: 'a'.repeat(64), caption: '截图', width: 320 },
      }),
    );
    expectBlock(full[0] as BlockSpec, 'image', { file_id: 'a'.repeat(64), caption: '截图', width: 320 }, null);

    const bare = pmDocToBlocks(docOf({ type: 'image' }));
    expectBlock(bare[0] as BlockSpec, 'image', { file_id: '' }, null);
  });

  it('page_link / bookmark：无 PM 投影节点，经 _unsupported/_raw 原样恢复', () => {
    const pageLink = pmDocToBlocks(
      docOf({
        type: 'paragraph',
        attrs: { _unsupported: 'page_link', _raw: { page_id: 'p1' } },
        content: [textNode('引用页')],
      }),
    );
    expectBlock(pageLink[0] as BlockSpec, 'page_link', { page_id: 'p1' }, inlineDocOf(textNode('引用页')));

    const bookmark = pmDocToBlocks(
      docOf({
        type: 'paragraph',
        attrs: { _unsupported: 'bookmark', _raw: { url: 'https://example.com' } },
      }),
    );
    expectBlock(
      bookmark[0] as BlockSpec,
      'bookmark',
      { url: 'https://example.com' },
      inlineDocOf(),
    );
  });

  it('未知节点名（无 _unsupported 标记）跳过，不产出垃圾 paragraph', () => {
    const specs = pmDocToBlocks(docOf({ type: 'embed', content: [textNode('x')] }, para('保留')));
    expect(specs).toHaveLength(1);
    expectBlock(specs[0] as BlockSpec, 'paragraph', {}, inlineDocOf(textNode('保留')));
  });

  // R25（T76-01）：单块自包含内容块——两条反投影路径（model.ts / blocks.ts）同口径
  it('R25 · table：attrs → {rows,header,colWidths}（colWidths 缺省不进 content）', () => {
    const rows = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    const plain = pmDocToBlocks(docOf({ type: 'table', attrs: { rows, header: true } }));
    expectBlock(plain[0] as BlockSpec, 'table', {}, { rows, header: true });

    const sized = pmDocToBlocks(
      docOf({ type: 'table', attrs: { rows, header: false, colWidths: [120, 80] } }),
    );
    expectBlock(sized[0] as BlockSpec, 'table', {}, { rows, header: false, colWidths: [120, 80] });
  });

  it('R25 · toggle：attrs → {title,body}；body 非法回落单空行', () => {
    const filled = pmDocToBlocks(
      docOf({ type: 'toggle', attrs: { title: '问', body: ['答'] } }),
    );
    expectBlock(filled[0] as BlockSpec, 'toggle', {}, { title: '问', body: ['答'] });

    const bare = pmDocToBlocks(docOf({ type: 'toggle' }));
    expectBlock(bare[0] as BlockSpec, 'toggle', {}, { title: '', body: [''] });
  });
});

describe('blocks：往返恒等 pmDocToBlocks(parseMarkdown(md))', () => {
  it('heading（H4+ 钳到 H3）', () => {
    expect(pmDocToBlocks(parseMarkdown('# 标题'))).toEqual([
      { type: 'heading', props: { level: 1 }, content: inlineDocOf(textNode('标题')) },
    ]);
    expect(pmDocToBlocks(parseMarkdown('#### 四级'))).toEqual([
      { type: 'heading', props: { level: 3 }, content: inlineDocOf(textNode('四级')) },
    ]);
  });

  it('列表三型：bulleted / numbered / todo（含勾选态）', () => {
    expect(pmDocToBlocks(parseMarkdown('- 项目'))).toEqual([
      { type: 'bulleted_list', props: {}, content: inlineDocOf(textNode('项目')) },
    ]);
    expect(pmDocToBlocks(parseMarkdown('1. 第一'))).toEqual([
      { type: 'numbered_list', props: {}, content: inlineDocOf(textNode('第一')) },
    ]);
    expect(pmDocToBlocks(parseMarkdown('- [ ] 待办'))).toEqual([
      { type: 'to_do', props: { checked: false }, content: inlineDocOf(textNode('待办')) },
    ]);
    expect(pmDocToBlocks(parseMarkdown('- [x] 完成'))).toEqual([
      { type: 'to_do', props: { checked: true }, content: inlineDocOf(textNode('完成')) },
    ]);
  });

  it('quote / divider / code（含 lang）', () => {
    expect(pmDocToBlocks(parseMarkdown('> 引用'))).toEqual([
      { type: 'quote', props: {}, content: inlineDocOf(textNode('引用')) },
    ]);
    expect(pmDocToBlocks(parseMarkdown('---'))).toEqual([{ type: 'divider', props: {}, content: null }]);
    expect(pmDocToBlocks(parseMarkdown('```ts\nconst a = 1;\n```'))).toEqual([
      { type: 'code', props: { lang: 'ts' }, content: 'const a = 1;' },
    ]);
  });

  it('paragraph：内联 mark（bold/italic/strike/code/link）保真', () => {
    const md = '**bold** and *it* ~~gone~~ `raw` [link](https://example.com)';
    expect(pmDocToBlocks(parseMarkdown(md))).toEqual([
      {
        type: 'paragraph',
        props: {},
        content: inlineDocOf(
          textNode('bold', [{ type: 'bold' }]),
          textNode(' and '),
          textNode('it', [{ type: 'italic' }]),
          textNode(' '),
          textNode('gone', [{ type: 'strike' }]),
          textNode(' '),
          textNode('raw', [{ type: 'code' }]),
          textNode(' '),
          textNode('link', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
        ),
      },
    ]);
  });

  it('空正文 → 单个空 paragraph', () => {
    expect(pmDocToBlocks(parseMarkdown(''))).toEqual([
      { type: 'paragraph', props: {}, content: inlineDocOf() },
    ]);
  });

  it('多块文档：顺序 = 文档顺序，结构与逐块期望一致', () => {
    const md = '# 计划\n\n正文一段\n\n- [x] 事项\n\n> 备注\n\n```js\nhi();\n```\n\n---';
    expect(pmDocToBlocks(parseMarkdown(md))).toEqual([
      { type: 'heading', props: { level: 1 }, content: inlineDocOf(textNode('计划')) },
      { type: 'paragraph', props: {}, content: inlineDocOf(textNode('正文一段')) },
      { type: 'to_do', props: { checked: true }, content: inlineDocOf(textNode('事项')) },
      { type: 'quote', props: {}, content: inlineDocOf(textNode('备注')) },
      { type: 'code', props: { lang: 'js' }, content: 'hi();' },
      { type: 'divider', props: {}, content: null },
    ]);
  });

  it('parseMarkdown 产物与手工构造节点投影一致（同语义同结果）', () => {
    const fromMd = pmDocToBlocks(parseMarkdown('- [ ] 买猫粮'));
    const handmade = pmDocToBlocks(
      docOf({ type: 'to_do', attrs: { checked: false }, content: [textNode('买猫粮')] }),
    );
    expect(fromMd).toEqual(handmade);
  });
});
