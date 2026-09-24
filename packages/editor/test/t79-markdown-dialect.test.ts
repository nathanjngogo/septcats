/**
 * t79-markdown-dialect.test.ts —— TASK-T79-01 §A' 自家 markdown 方言（callout / toggle /
 * table 单元格转义）。导出序列化器（packages/importer/src/serialize.ts）的对偶方言。
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseMarkdownTableLines, pmDocToBlockSpecs } from '../src/index';

describe('T79-01 markdown 方言：callout（quote + icon）', () => {
  it('`> [!icon] text` → quote 节点带 attrs.icon + 内联文本', () => {
    const doc = parseMarkdown('> [!💡] 提示');
    expect(doc.content).toEqual([
      {
        type: 'quote',
        attrs: { icon: '💡' },
        content: [{ type: 'text', text: '提示' }],
      },
    ]);
  });

  it('反投影 → 真相层 quote props.icon（callout 口径）', () => {
    expect(pmDocToBlockSpecs(parseMarkdown('> [!💡] 提示'))).toEqual([
      {
        type: 'quote',
        props: { icon: '💡' },
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '提示' }] }],
        },
      },
    ]);
  });

  it('普通引用 `> text` 不带 icon（callout 与 quote 边界不被误判）', () => {
    expect(parseMarkdown('> 引用')).toEqual({
      type: 'doc',
      content: [{ type: 'quote', content: [{ type: 'text', text: '引用' }] }],
    });
  });
});

describe('T79-01 markdown 方言：toggle（`> [!toggle] title` + `> ` 行 body）', () => {
  it('标题 + 连续 quote 行 → toggle 节点 attrs{title,body}', () => {
    const doc = parseMarkdown('> [!toggle] 折叠标题\n> 正文一\n> 正文二');
    expect(doc.content).toEqual([
      { type: 'toggle', attrs: { title: '折叠标题', body: ['正文一', '正文二'] } },
    ]);
  });

  it('无 body → 归一为单个空行 body（恒 ≥1 行）', () => {
    expect(pmDocToBlockSpecs(parseMarkdown('> [!toggle] 只有标题'))).toEqual([
      { type: 'toggle', props: {}, content: { title: '只有标题', body: [''] } },
    ]);
  });

  it('空行断组：toggle 之后的引用是独立 quote 块', () => {
    const doc = parseMarkdown('> [!toggle] T\n> body\n\n> 独立引用');
    expect(doc.content?.map((node) => node.type)).toEqual(['toggle', 'quote']);
    expect(doc.content?.[0]?.attrs?.['body']).toEqual(['body']);
  });

  it('反投影 → 真相层 toggle content{title,body}', () => {
    expect(pmDocToBlockSpecs(parseMarkdown('> [!toggle] T\n> a'))).toEqual([
      { type: 'toggle', props: {}, content: { title: 'T', body: ['a'] } },
    ]);
  });
});

describe('T79-01 markdown 方言：table 单元格转义反解', () => {
  it('`\\|` 不误切列 + `<br>` 反解为换行', () => {
    expect(parseMarkdownTableLines(['| a\\|b | c<br>d |', '| --- | --- |'])).toEqual({
      rows: [['a|b', 'c\nd']],
      header: true,
    });
  });

  it('既有口径不回归：普通单元格逐位一致', () => {
    expect(parseMarkdownTableLines(['| a | b |', '| --- | --- |'])).toEqual({
      rows: [['a', 'b']],
      header: true,
    });
  });
});
