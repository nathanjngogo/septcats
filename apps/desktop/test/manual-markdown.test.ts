/**
 * manual-markdown.test.ts —— 说明书 Markdown 解析器单测（TASK-T56-01 §1②/§5）。
 *
 * 只测纯函数 manual/markdown.ts（不 import React、不依赖 jsdom）：行内标记、
 * 标题层级、列表、**表格**、**围栏代码块**、段落合并、章节切分，以及两份真实文档
 * （docs/manual/manual.zh.md / manual.en.md PM 定稿）的结构不变量——**渲染器是自写
 * 最小子集（红线禁新增 npm 依赖），故断言必须钉住真实语料**。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseInline, parseManual, parseMarkdown } from '../src/renderer/src/manual/markdown';

const here = dirname(fileURLToPath(import.meta.url));
const readManual = (name: string): string => readFileSync(join(here, '..', '..', '..', 'docs', 'manual', name), 'utf8');

describe('parseInline（行内码 / 加粗 / 链接）', () => {
  it('混合行内标记按序拆成节点，行内码优先于加粗', () => {
    expect(parseInline('按 `Ctrl+N` 与 **加粗** 及 [链接](https://example.com) 结束')).toEqual([
      { kind: 'text', text: '按 ' },
      { kind: 'code', text: 'Ctrl+N' },
      { kind: 'text', text: ' 与 ' },
      { kind: 'strong', text: '加粗' },
      { kind: 'text', text: ' 及 ' },
      { kind: 'link', text: '链接', href: 'https://example.com' },
      { kind: 'text', text: ' 结束' },
    ]);
  });

  it('行内码内的星号不被当加粗（优先级）；空串返回空数组', () => {
    expect(parseInline('`a**b**c`')).toEqual([{ kind: 'code', text: 'a**b**c' }]);
    expect(parseInline('')).toEqual([]);
  });
});

describe('parseMarkdown（块解析）', () => {
  it('标题层级与稳定 id（# / ## / ###）', () => {
    expect(parseMarkdown('# A\n\n## B\n\n### C')).toEqual([
      { kind: 'heading', level: 1, text: 'A', id: 'heading-1' },
      { kind: 'heading', level: 2, text: 'B', id: 'heading-2' },
      { kind: 'heading', level: 3, text: 'C', id: 'heading-3' },
    ]);
  });

  it('无序列表与有序列表分块（有序/无序不混流）', () => {
    expect(parseMarkdown('- 甲\n- 乙\n\n1. 一\n2. 二')).toEqual([
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: '甲' }], [{ kind: 'text', text: '乙' }]] },
      {
        kind: 'list',
        ordered: true,
        items: [[{ kind: 'text', text: '一' }], [{ kind: 'text', text: '二' }]],
      },
    ]);
  });

  it('表格：表头 + 数据行逐格成行内节点（含行内码）', () => {
    const blocks = parseMarkdown('| 快捷键 | 功能 |\n| --- | --- |\n| `Ctrl+K` | 命令面板 |\n| `Esc` | 关闭弹层 |');
    expect(blocks).toEqual([
      {
        kind: 'table',
        header: [[{ kind: 'text', text: '快捷键' }], [{ kind: 'text', text: '功能' }]],
        rows: [
          [[{ kind: 'code', text: 'Ctrl+K' }], [{ kind: 'text', text: '命令面板' }]],
          [[{ kind: 'code', text: 'Esc' }], [{ kind: 'text', text: '关闭弹层' }]],
        ],
      },
    ]);
  });

  it('围栏代码块：保留语言、内容逐行原样（不 Trim 内部缩进）', () => {
    expect(parseMarkdown('```ts\nconst a = 1;\n  const b = 2;\n```')).toEqual([
      { kind: 'code', lang: 'ts', code: 'const a = 1;\n  const b = 2;' },
    ]);
  });

  it('段落：连续非空行合并为一段（软换行折成空格），空行分段', () => {
    expect(parseMarkdown('第一行\n第二行\n\n另起一段')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: '第一行 第二行' }] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: '另起一段' }] },
    ]);
  });

  it('代码块内的 ## 不切章（围栏保护）', () => {
    const doc = parseManual('# T\n\n## 甲\n\n```\n## 不是标题\n```\n');
    expect(doc.sections.map((section) => section.title)).toEqual(['甲']);
    expect(doc.sections[0]?.blocks).toEqual([{ kind: 'code', lang: '', code: '## 不是标题' }]);
  });
});

describe('parseManual（章节切分）', () => {
  it('一级标题 + 引言 + 章节（id 按序稳定、与语言无关）', () => {
    const doc = parseManual('# 标题\n\n引言一\n\n## 甲\n\n正文甲\n\n## 乙\n\n正文乙');
    expect(doc.title).toBe('标题');
    expect(doc.preamble).toEqual([{ kind: 'paragraph', inline: [{ kind: 'text', text: '引言一' }] }]);
    expect(doc.sections.map((section) => [section.id, section.title])).toEqual([
      ['section-1', '甲'],
      ['section-2', '乙'],
    ]);
  });
});

describe('真实语料（docs/manual 两份 PM 定稿）', () => {
  const zh = readManual('manual.zh.md');
  const en = readManual('manual.en.md');
  const zhDoc = parseManual(zh);
  const enDoc = parseManual(en);

  it('两份文档章节数一致、章节 id 逐一同构（切语言锚点不跳位）', () => {
    expect(zhDoc.sections.length).toBe(enDoc.sections.length);
    expect(zhDoc.sections.map((section) => section.id)).toEqual(enDoc.sections.map((section) => section.id));
    expect(zhDoc.sections.length).toBeGreaterThanOrEqual(12);
  });

  it('关键章节都在（快速上手 / 数据库视图 / 键盘快捷键总表；en 同键位）', () => {
    const zhTitles = zhDoc.sections.map((section) => section.title);
    const enTitles = enDoc.sections.map((section) => section.title);
    expect(zhTitles).toContain('快速上手');
    expect(zhTitles).toContain('数据库视图');
    expect(zhTitles).toContain('键盘快捷键总表');
    expect(enTitles).toContain('Getting Started');
    expect(enTitles).toContain('Database View');
    expect(enTitles).toContain('Keyboard Shortcuts');
    expect(zhTitles.indexOf('数据库视图')).toBe(enTitles.indexOf('Database View'));
  });

  it('键盘快捷键总表含表格块（表头 2 列、6 行数据；两语言同构）', () => {
    for (const doc of [zhDoc, enDoc]) {
      const index = doc.sections.findIndex((section) => section.title === '键盘快捷键总表' || section.title === 'Keyboard Shortcuts');
      const table = doc.sections[index]?.blocks.find((block) => block.kind === 'table');
      expect(table, '快捷键章节缺表格').toBeDefined();
      if (table !== undefined && table.kind === 'table') {
        expect(table.header).toHaveLength(2);
        expect(table.rows).toHaveLength(6);
      }
    }
  });

  it('两份文档均无 CJK 泄漏进块模型之外的散行：标题非空、每章至少一个块', () => {
    for (const doc of [zhDoc, enDoc]) {
      expect(doc.title.trim().length).toBeGreaterThan(0);
      for (const section of doc.sections) {
        expect(section.title.trim().length).toBeGreaterThan(0);
        expect(section.blocks.length).toBeGreaterThan(0);
      }
    }
  });
});
