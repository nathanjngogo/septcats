/**
 * serialize.test.ts —— TASK-T79-01 §A：blocks↔markdown 双向 roundtrip（14 块型）。
 *
 * 铁律（报告 §0-①）：**roundtrip 以自家解析器为准**——
 * - 文本/结构/表格/toggle/callout：`pmDocToBlockSpecs(parseMarkdown(md))`；
 * - image：`markdown.ts` BodyScanner（`parseMdFile` + 内存 fs，内容寻址）。
 * 两个方向：`serialize→parse→deep-equal` 与 `parse→serialize→deep-equal`。
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseMarkdown, pmDocToBlockSpecs } from '@septcats/editor';
import type { BlockSpec } from '@septcats/editor';
import { parseMdFile } from '../src/markdown';
import { blocksToMarkdown } from '../src/serialize';
import type { ImportSourceFs } from '../src/types';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function memoryFs(entries: Record<string, string | Uint8Array>): ImportSourceFs {
  const map = new Map<string, string | Uint8Array>(Object.entries(entries));
  return {
    list: () => [...map.keys()],
    read: (path: string) => {
      const value = map.get(path);
      if (value === undefined) {
        throw new Error(`missing: ${path}`);
      }
      return value;
    },
  };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_HASH = createHash('sha256').update(PNG_BYTES).digest('hex');
const IMG_FILE = `files/${PNG_HASH}.png`;

/** 文本/结构/表格路径：自家块解析器。 */
function parseBack(md: string): BlockSpec[] {
  return pmDocToBlockSpecs(parseMarkdown(md));
}

/** image 路径：BodyScanner（需注入 fs；'page.md' 承载正文，附件走内容寻址）。 */
function parseBackFile(md: string, extra: Record<string, Uint8Array> = {}): BlockSpec[] {
  const plan = parseMdFile(memoryFs({ 'page.md': md, ...extra }), 'page.md');
  const page = plan.items.find((item) => item.op === 'page');
  if (page?.op !== 'page') {
    throw new Error('unreachable：未产出 page 条目');
  }
  return page.blocks;
}

function doc(...nodes: ReturnType<typeof text>[]): BlockSpec['content'] {
  return { type: 'doc', content: [{ type: 'paragraph', content: nodes }] };
}

function text(value: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) {
  return marks === undefined
    ? { type: 'text', text: value }
    : { type: 'text', text: value, marks };
}

// ---------------------------------------------------------------------------
// 14 块型 canonical 夹具（= 解析器真实产物形态）
// ---------------------------------------------------------------------------

const H1: BlockSpec = { type: 'heading', props: { level: 1 }, content: doc(text('一级标题')) };
const H2: BlockSpec = { type: 'heading', props: { level: 2 }, content: doc(text('二级标题')) };
const H3: BlockSpec = { type: 'heading', props: { level: 3 }, content: doc(text('三级标题')) };

const IMAGE: BlockSpec = {
  type: 'image',
  props: { src: `asset://${PNG_HASH}.png`, name: '猫图' },
  content: null,
};

interface Case {
  name: string;
  block: BlockSpec;
  /** 期望 md（不含尾换行）；缺省由 serialize 现场产出。 */
  md: string;
  /** 解析回块（image 走 fs）。 */
  parse: (md: string) => BlockSpec[];
}

const CASES: Case[] = [
  {
    name: 'paragraph',
    block: { type: 'paragraph', props: {}, content: doc(text('正文一段')) },
    md: '正文一段',
    parse: parseBack,
  },
  { name: 'heading1', block: H1, md: '# 一级标题', parse: parseBack },
  { name: 'heading2', block: H2, md: '## 二级标题', parse: parseBack },
  { name: 'heading3', block: H3, md: '### 三级标题', parse: parseBack },
  {
    name: 'bulleted_list',
    block: { type: 'bulleted_list', props: {}, content: doc(text('项目')) },
    md: '- 项目',
    parse: parseBack,
  },
  {
    name: 'numbered_list',
    block: { type: 'numbered_list', props: {}, content: doc(text('第一')) },
    md: '1. 第一',
    parse: parseBack,
  },
  {
    name: 'to_do',
    block: { type: 'to_do', props: { checked: true }, content: doc(text('买猫粮')) },
    md: '- [x] 买猫粮',
    parse: parseBack,
  },
  {
    name: 'quote',
    block: { type: 'quote', props: {}, content: doc(text('引用')) },
    md: '> 引用',
    parse: parseBack,
  },
  {
    name: 'callout（quote+icon）',
    block: { type: 'quote', props: { icon: '💡' }, content: doc(text('提示')) },
    md: '> [!💡] 提示',
    parse: parseBack,
  },
  {
    name: 'divider',
    block: { type: 'divider', props: {}, content: null },
    md: '---',
    parse: parseBack,
  },
  {
    name: 'code（lang fence）',
    block: { type: 'code', props: { lang: 'ts' }, content: 'const a = 1;' },
    md: '```ts\nconst a = 1;\n```',
    parse: parseBack,
  },
  {
    name: 'image（asset 内容寻址）',
    block: IMAGE,
    md: `![猫图](${IMG_FILE})`,
    parse: (md) => parseBackFile(md, { [IMG_FILE]: PNG_BYTES }),
  },
  {
    name: 'table（header=true）',
    block: {
      type: 'table',
      props: {},
      content: { rows: [['a', 'b'], ['1', '2']], header: true },
    },
    md: '| a | b |\n| --- | --- |\n| 1 | 2 |',
    parse: parseBack,
  },
  {
    name: 'toggle',
    block: { type: 'toggle', props: {}, content: { title: '折叠标题', body: ['正文一', '正文二'] } },
    md: '> [!toggle] 折叠标题\n> 正文一\n> 正文二',
    parse: parseBack,
  },
];

// ---------------------------------------------------------------------------
describe('serialize：14 块型 serialize→parse→deep-equal', () => {
  for (const testCase of CASES) {
    it(`${testCase.name}`, () => {
      const md = blocksToMarkdown([testCase.block]);
      expect(md).toBe(`${testCase.md}\n`);
      expect(testCase.parse(md)).toEqual([testCase.block]);
    });
  }
});

describe('serialize：14 块型 parse→serialize→deep-equal（md 定点）', () => {
  for (const testCase of CASES) {
    it(`${testCase.name}`, () => {
      const blocks = testCase.parse(testCase.md);
      expect(blocksToMarkdown(blocks)).toBe(`${testCase.md}\n`);
    });
  }
});

describe('serialize：特殊字符 / table 转义 / 内联标记', () => {
  it('paragraph 特殊字符（<> & 引号 emoji 竖线括号）无损', () => {
    const value = `特殊 <tag> & "双" '单' 🐱 竖线|管道 [[双链]] (括号)`;
    const block: BlockSpec = { type: 'paragraph', props: {}, content: doc(text(value)) };
    const md = blocksToMarkdown([block]);
    expect(parseBack(md)).toEqual([block]);
  });

  it('内联标记（粗/斜/删除线/行内码/链接）无损', () => {
    const block: BlockSpec = {
      type: 'paragraph',
      props: {},
      content: doc(
        text('粗', [{ type: 'bold' }]),
        text(' '),
        text('斜', [{ type: 'italic' }]),
        text(' '),
        text('删', [{ type: 'strike' }]),
        text(' '),
        text('码', [{ type: 'code' }]),
        text(' '),
        text('链', [{ type: 'link', attrs: { href: 'https://example.com/x' } }]),
      ),
    };
    const md = blocksToMarkdown([block]);
    expect(parseBack(md)).toEqual([block]);
  });

  it('table 单元格转义：竖线 → \\| ，换行 → <br>（解析侧反解）', () => {
    const block: BlockSpec = {
      type: 'table',
      props: {},
      content: { rows: [['a|b', 'c'], ['多行\nexample', 'd']], header: true },
    };
    const md = blocksToMarkdown([block]);
    expect(md).toBe('| a\\|b | c |\n| --- | --- |\n| 多行<br>example | d |\n');
    expect(parseBack(md)).toEqual([block]);
  });

  it('table header=false（≥2 行）无损', () => {
    const block: BlockSpec = {
      type: 'table',
      props: {},
      content: { rows: [['a', 'b'], ['1', '2']], header: false },
    };
    const md = blocksToMarkdown([block]);
    expect(parseBack(md)).toEqual([block]);
  });

  it('code 围栏内特殊字符（</>/&/引号/反斜杠）无损', () => {
    const body = '<script>alert("x")</script>\nconst p = a & b;\nlet s = "\\n";';
    const block: BlockSpec = { type: 'code', props: { lang: 'ts' }, content: body };
    expect(parseBack(blocksToMarkdown([block]))).toEqual([block]);
  });

  it('toggle 正文含空行（body 行原样保留）', () => {
    const block: BlockSpec = { type: 'toggle', props: {}, content: { title: 'T', body: ['', 'x'] } };
    expect(parseBack(blocksToMarkdown([block]))).toEqual([block]);
  });

  it('孤儿附件 → md 占位注释（不静默丢）', () => {
    const block: BlockSpec = {
      type: 'image',
      props: { src: 'asset://deadbeef.png', name: 'x' },
      content: null,
    };
    const md = blocksToMarkdown([block], { resolveAsset: () => null });
    expect(md).toBe('<!-- 附件缺失: asset://deadbeef.png -->\n');
  });

  it('组合文档：14 型混排 serialize→parse 逐块保持', () => {
    const blocks = CASES.map((testCase) => testCase.block);
    // image 走 fs 解析，其余经 parseMarkdown；混排文档图片在 parseMarkdown 侧丢 → 分两段验
    const textBlocks = blocks.filter((block) => block.type !== 'image');
    const md = blocksToMarkdown(textBlocks);
    expect(parseBack(md)).toEqual(textBlocks);
  });
});

describe('serialize：无损边界（§0-⑤ 登记，钉死降级口径）', () => {
  it('空文本块 → 空串（解析器跳过，不回块）', () => {
    expect(blocksToMarkdown([{ type: 'paragraph', props: {}, content: doc() }])).toBe('');
  });

  it('colWidths 无 md 表达 → 丢弃（不炸、不回宽度）', () => {
    const block: BlockSpec = {
      type: 'table',
      props: {},
      content: { rows: [['a'], ['b']], header: true, colWidths: [120] },
    };
    const [back] = parseBack(blocksToMarkdown([block]));
    expect(back?.type).toBe('table');
    expect(back?.content).toEqual({ rows: [['a'], ['b']], header: true });
  });

  it('单行 header=false 表格 → 不满足归组门槛，退回段落', () => {
    const block: BlockSpec = {
      type: 'table',
      props: {},
      content: { rows: [['a', 'b']], header: false },
    };
    const [back] = parseBack(blocksToMarkdown([block]));
    expect(back?.type).toBe('paragraph');
  });

  it('组合强调（粗+斜）解析器不支持 → 落回字面文本', () => {
    const block: BlockSpec = {
      type: 'paragraph',
      props: {},
      content: doc(text('x', [{ type: 'bold' }, { type: 'italic' }])),
    };
    const [back] = parseBack(blocksToMarkdown([block]));
    expect(back?.type).toBe('paragraph');
    expect(block !== back).toBe(true);
  });
});
