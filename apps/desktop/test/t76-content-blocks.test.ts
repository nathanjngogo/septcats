/**
 * t76-content-blocks.test.ts —— R25（TASK-T76-01）内容块扩展的**数据面**用例。
 *
 * 覆盖任务书 §9 的四项纯函数面：
 * ① 表格 content 序列化往返（块模型 ↔ PM 投影，含 op payload 同构的 JSON 往返）；
 * ② 加/删行、加/删列、表头开关、列宽拖拽的算子正确性与夹紧边界；
 * ③ markdown 表格 → 表格块（粘贴管道），并钉住「导入链零改动」的隔离边界；
 * ④ 输入规则简写 `|a|b|` 的纯判定。
 *
 * 纪律：本文件跑在 apps/desktop 的 node 工程（无 DOM），只 require 纯函数——
 * NodeView/DOM 交互面在 t76-blocks-ui.test.tsx（jsdom）。
 */
import { describe, expect, it } from 'vitest';
import { LamportClock } from '@septcats/core';
import {
  BLOCK_TYPES,
  KNOWN_BLOCK_TYPES,
  TABLE_DEFAULT_COLS,
  TABLE_DEFAULT_ROWS,
  TABLE_MIN_COL_WIDTH,
  blockToPMNode,
  blocksToPMDoc,
  defaultTableContent,
  defaultToggleContent,
  matchMarkdownTable,
  matchTableShorthand,
  normalizeTableContent,
  normalizeToggleContent,
  parseMarkdown,
  parseMarkdownTableLines,
  pmDocToBlockSpecs,
  pmDocToBlocks,
  tableAddCol,
  tableAddRow,
  tableColCount,
  tableDeleteCol,
  tableDeleteRow,
  tableGridTemplate,
  tableResizeColumn,
  tableSetCell,
  tableSetHeader,
  toggleAddBodyLine,
  toggleDeleteBodyLine,
  toggleSetBodyLine,
  toggleSetTitle,
  type Block,
  type BlockDoc,
  type TableContent,
  type ToggleContent,
} from '@septcats/editor';

const PAGE = 'pg0000000000000000000000t76';
const BLOCK_ID = 'blk000000000000000000t76';
const ACTOR = 't7600001';

function clock(): () => { c: number; d: string } {
  const lamport = new LamportClock(ACTOR);
  return () => lamport.tick();
}

function blockOf(type: string, content: Block['content']): Block {
  return {
    id: BLOCK_ID,
    page_id: PAGE,
    type,
    props: {},
    content,
    parent_id: null,
    sort_key: 'A00000000',
    alive: 1,
    version: 1,
    last_edited: 0,
  };
}

function docOf(block: Block): BlockDoc {
  return { pageId: PAGE, blocks: [block] };
}

const TABLE: TableContent = {
  rows: [
    ['事件', '曝光量'],
    ['LZ 2025 SR', '4.2 ton·yr'],
  ],
  header: true,
};

const TOGGLE: ToggleContent = { title: '口径问答', body: ['为什么？', '统一下限基准。'] };

// ---------------------------------------------------------------------------
// ① content 序列化往返
// ---------------------------------------------------------------------------

describe('① 表格块 content 序列化往返（T76-01 §9）', () => {
  it('projection：content → PM 节点 attrs（键名逐字同名，colWidths 缺省写 null）', () => {
    expect(blockToPMNode(blockOf('table', TABLE))).toEqual({
      type: 'table',
      attrs: { id: BLOCK_ID, rows: TABLE.rows, header: true, colWidths: null },
    });
    expect(
      blockToPMNode(blockOf('table', { ...TABLE, colWidths: [160, 96] })).attrs?.['colWidths'],
    ).toEqual([160, 96]);
  });

  it('roundtrip 恒等：pmDocToBlocks(blocksToPMDoc(doc)) === doc（含 colWidths 两态）', () => {
    for (const content of [TABLE, { ...TABLE, header: false }, { ...TABLE, colWidths: [160, 96] }]) {
      const doc = docOf(blockOf('table', content));
      const restored = pmDocToBlocks(blocksToPMDoc(doc), doc, clock());
      expect(restored).toEqual(doc);
    }
  });

  it('op payload 同构：JSON 往返（导入导出/段文件走的正是这条序列化）', () => {
    const doc = docOf(blockOf('table', { ...TABLE, colWidths: [160, 96] }));
    const json = JSON.parse(JSON.stringify(doc)) as BlockDoc;
    expect(json).toEqual(doc);
    expect(pmDocToBlocks(blocksToPMDoc(json), json, clock())).toEqual(json);
  });

  it('新建节点（attrs 全默认）反投影出**规范 3×3 空表**——斜杠插入路径即此形态', () => {
    const fresh = pmDocToBlocks(
      { type: 'doc', content: [{ type: 'table', attrs: { id: BLOCK_ID } }] },
      docOf(blockOf('table', TABLE)),
      clock(),
    );
    const content = fresh.blocks[0]?.content as TableContent;
    expect(content.rows).toHaveLength(TABLE_DEFAULT_ROWS);
    expect(content.rows[0]).toHaveLength(TABLE_DEFAULT_COLS);
    expect(content.rows.flat().every((cell) => cell === '')).toBe(true);
    expect(content.header).toBe(true);
    expect(content.colWidths).toBeUndefined();
  });

  it('归一化：非法 rows / 错位 colWidths 一律回落（绝不抛、绝不留下错位宽度）', () => {
    expect(normalizeTableContent(null)).toEqual(defaultTableContent());
    expect(normalizeTableContent({ rows: 'x', header: 'y' })).toEqual(defaultTableContent());
    // 宽度数组长度 ≠ 列数 → 丢弃宽度（列数 2 vs 宽度 3）
    const dropped = normalizeTableContent({ rows: TABLE.rows, header: true, colWidths: [1, 2, 3] });
    expect(dropped.colWidths).toBeUndefined();
    expect(dropped.rows).toEqual(TABLE.rows);
  });
});

describe('① 折叠列表 content 序列化往返', () => {
  it('projection / roundtrip 恒等', () => {
    expect(blockToPMNode(blockOf('toggle', TOGGLE))).toEqual({
      type: 'toggle',
      attrs: { id: BLOCK_ID, title: '口径问答', body: ['为什么？', '统一下限基准。'] },
    });
    const doc = docOf(blockOf('toggle', TOGGLE));
    expect(pmDocToBlocks(blocksToPMDoc(doc), doc, clock())).toEqual(doc);
  });

  it('归一化：body 恒 ≥1 行（空块也要有可落光标的一行）', () => {
    expect(normalizeToggleContent(null)).toEqual(defaultToggleContent());
    expect(normalizeToggleContent({ title: 7, body: [] })).toEqual({ title: '', body: [''] });
    expect(normalizeToggleContent({ title: 't', body: ['a', 5] })).toEqual({ title: 't', body: ['a'] });
  });

  it('展开态**不在 content 里**（纯视图态口径的数据面钉子）', () => {
    const content = normalizeToggleContent({ title: 't', body: ['a'], open: true });
    expect(Object.keys(content).sort()).toEqual(['body', 'title']);
  });
});

// ---------------------------------------------------------------------------
// ② 加删行列 / 表头 / 列宽算子
// ---------------------------------------------------------------------------

describe('② 表格算子：加删行列 / 表头 / 列宽（T76-01 §9）', () => {
  it('加行：末行追加、列数与现有一致、原 content 不被改写（不可变）', () => {
    const next = tableAddRow(TABLE);
    expect(next.rows).toHaveLength(3);
    expect(next.rows[2]).toEqual(['', '']);
    expect(TABLE.rows).toHaveLength(2);
    expect(next).not.toBe(TABLE);

    const middle = tableAddRow(TABLE, 1);
    expect(middle.rows[1]).toEqual(['', '']);
    expect(middle.rows[2]).toEqual(TABLE.rows[1]);
  });

  it('删行：越界/到下限（1 行）原样返回（夹紧而非报错）', () => {
    expect(tableDeleteRow(TABLE, 0).rows).toEqual([TABLE.rows[1]]);
    expect(tableDeleteRow(TABLE, 9)).toEqual(TABLE);
    expect(tableDeleteRow(TABLE, -1)).toEqual(TABLE);
    const single: TableContent = { rows: [['only']], header: false };
    expect(tableDeleteRow(single, 0)).toEqual(single);
  });

  it('加列：每行同步插空、列宽数组同步插入', () => {
    const next = tableAddCol(TABLE);
    expect(tableColCount(next)).toBe(3);
    expect(next.rows[0]).toEqual(['事件', '曝光量', '']);
    expect(next.colWidths).toBeUndefined();

    const sized = tableAddCol({ ...TABLE, colWidths: [160, 96] }, 0);
    expect(sized.colWidths).toHaveLength(3);
    expect(sized.rows[0]).toEqual(['', '事件', '曝光量']);
  });

  it('删列：每行同步剔除、列宽数组同步剔除、到下限（1 列）原样返回', () => {
    const sized: TableContent = { ...TABLE, colWidths: [160, 96] };
    const next = tableDeleteCol(sized, 0);
    expect(next.rows[0]).toEqual(['曝光量']);
    expect(next.colWidths).toEqual([96]);

    const single: TableContent = { rows: [['only'], ['b']], header: false };
    expect(tableDeleteCol(single, 0)).toEqual(single);
  });

  it('表头开关：翻转写 content（同值不产新对象 = diff 无 patch）', () => {
    expect(tableSetHeader(TABLE, false).header).toBe(false);
    expect(tableSetHeader(TABLE, true)).toBe(TABLE);
  });

  it('单元格写入：越界原样返回；同值不产新对象', () => {
    expect(tableSetCell(TABLE, 0, 0, 'X').rows[0]?.[0]).toBe('X');
    expect(tableSetCell(TABLE, 5, 0, 'X')).toBe(TABLE);
    expect(tableSetCell(TABLE, 0, 0, '事件')).toBe(TABLE);
  });

  it('列宽拖拽：起点快照 + 夹下限 + 未设宽度时用默认宽起算', () => {
    const sized: TableContent = { ...TABLE, colWidths: [160, 96] };
    expect(tableResizeColumn(sized, 0, 40).colWidths).toEqual([200, 96]);
    // 夹下限
    expect(tableResizeColumn(sized, 1, -1000).colWidths).toEqual([160, TABLE_MIN_COL_WIDTH]);
    // 无 colWidths → 退化默认宽 + 量测快照
    expect(tableResizeColumn(TABLE, 1, 10, [200, 120]).colWidths).toEqual([200, 130]);
    // 越界列原样返回
    expect(tableResizeColumn(TABLE, 9, 10)).toBe(TABLE);
  });

  it('grid 模板：无宽度 = 自适应；有宽度 = px 轨道（真相层不留 px 语义）', () => {
    expect(tableGridTemplate(TABLE)).toBe('minmax(0, 1fr) minmax(0, 1fr)');
    expect(tableGridTemplate({ ...TABLE, colWidths: [160, 96] })).toBe('160px 96px');
  });
});

describe('② 折叠列表算子：正文行增删 / 标题与行写入', () => {
  it('加行（指定插入点）与删行（到下限原样返回）', () => {
    expect(toggleAddBodyLine(TOGGLE, 1).body).toEqual(['为什么？', '', '统一下限基准。']);
    expect(toggleAddBodyLine(TOGGLE).body).toEqual(['为什么？', '统一下限基准。', '']);
    expect(toggleDeleteBodyLine(TOGGLE, 0).body).toEqual(['统一下限基准。']);
    const single: ToggleContent = { title: 't', body: ['only'] };
    expect(toggleDeleteBodyLine(single, 0)).toEqual(single);
  });

  it('标题 / 正文行写入：同值不产新对象', () => {
    expect(toggleSetTitle(TOGGLE, '新题').title).toBe('新题');
    expect(toggleSetTitle(TOGGLE, '口径问答')).toBe(TOGGLE);
    expect(toggleSetBodyLine(TOGGLE, 1, '改').body).toEqual(['为什么？', '改']);
    expect(toggleSetBodyLine(TOGGLE, 1, '统一下限基准。')).toBe(TOGGLE);
    expect(toggleSetBodyLine(TOGGLE, 9, '改')).toBe(TOGGLE);
  });
});

// ---------------------------------------------------------------------------
// ③ markdown 表格 → 表格块（粘贴管道）
// ---------------------------------------------------------------------------

describe('③ markdown 粘贴：表格 → table 块（T76-01 §9）', () => {
  const MD = ['| 字段 | 含义 |', '| --- | --- |', '| id | 主键 |', '| sort_key | 兄弟序 |'].join(
    '\n',
  );

  it('parseMarkdown：GFM 表格 → 单个 table 节点（分隔行吃掉、header=true）', () => {
    const doc = parseMarkdown(MD);
    expect(doc.content).toEqual([
      {
        type: 'table',
        attrs: {
          rows: [
            ['字段', '含义'],
            ['id', '主键'],
            ['sort_key', '兄弟序'],
          ],
          header: true,
          colWidths: null,
        },
      },
    ]);
  });

  it('端到端：parseMarkdown → pmDocToBlockSpecs → 真相层 content', () => {
    const specs = pmDocToBlockSpecs(parseMarkdown(MD));
    expect(specs).toEqual([
      {
        type: 'table',
        props: {},
        content: {
          rows: [
            ['字段', '含义'],
            ['id', '主键'],
            ['sort_key', '兄弟序'],
          ],
          header: true,
        },
      },
    ]);
  });

  it('混排文档：表格与前后段落各归各位，顺序 = 文档顺序', () => {
    const doc = parseMarkdown(`引言一段\n\n${MD}\n\n结尾一段`);
    expect(doc.content?.map((node) => node.type)).toEqual(['paragraph', 'table', 'paragraph']);
  });

  it('不规则行：短行右侧补空、以最宽行为列数', () => {
    const table = parseMarkdownTableLines(['| a | b | c |', '| --- | --- | --- |', '| 1 |']);
    expect(table?.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });

  it('导入链隔离：孤立 pipe 行（无分隔行/非多行）**不进**表格——parseMarkdown 维持旧判', () => {
    expect(parseMarkdown('| a | b |').content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '| a | b |' }] },
    ]);
    expect(parseMarkdown('| --- |').content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '| --- |' }] },
    ]);
    // 只有表头 + 分隔行、无数据行：仍是合法表格（首行即表头行，header=true）
    expect(parseMarkdown('| a | b |\n| --- | --- |').content).toEqual([
      { type: 'table', attrs: { rows: [['a', 'b']], header: true, colWidths: null } },
    ]);
  });

  it('粘贴窄口判据 matchMarkdownTable：整段即表格才接管（孤立 pipe 行也认）', () => {
    expect(matchMarkdownTable(MD)?.header).toBe(true);
    expect(matchMarkdownTable('| a | b |')).toEqual({ rows: [['a', 'b']], header: false });
    expect(matchMarkdownTable('正文\n| a | b |')).toBeNull();
    expect(matchMarkdownTable('')).toBeNull();
    expect(matchMarkdownTable('| --- |')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ④ 输入规则简写（纯判定）
// ---------------------------------------------------------------------------

describe('④ 输入规则简写 `|a|b|`（T76-01 §A.5 纯判定）', () => {
  it('两格及以上 → {rows:[cells], header:false}', () => {
    expect(matchTableShorthand('|a|b|')).toEqual({ rows: [['a', 'b']], header: false });
    expect(matchTableShorthand('| a | b | c |')).toEqual({ rows: [['a', 'b', 'c']], header: false });
  });

  it('单格 / 非表格 / 分隔行形态一律不触发', () => {
    expect(matchTableShorthand('|a|')).toBeNull();
    expect(matchTableShorthand('| |')).toBeNull();
    expect(matchTableShorthand('a|b')).toBeNull();
    expect(matchTableShorthand('| --- | --- |')).toBeNull();
    expect(matchTableShorthand('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 白名单（编辑器侧）
// ---------------------------------------------------------------------------

describe('白名单：KNOWN_BLOCK_TYPES 收 table/toggle', () => {
  it('两型在册，且既有 9 型一字不动', () => {
    expect(KNOWN_BLOCK_TYPES.has('table')).toBe(true);
    expect(KNOWN_BLOCK_TYPES.has('toggle')).toBe(true);
    expect(BLOCK_TYPES).toHaveLength(11);
    for (const type of [
      'paragraph',
      'heading',
      'bulleted_list',
      'numbered_list',
      'to_do',
      'quote',
      'code',
      'divider',
      'image',
    ]) {
      expect(KNOWN_BLOCK_TYPES.has(type)).toBe(true);
    }
  });
});
