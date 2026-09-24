/**
 * 黄金样例 · blocks —— schema-v1 §6 承诺「每种块一个标准样例」的编辑器侧对照：
 * 每个 fixture 给 {块模型, 投影节点}，model.test 用它做 roundtrip 恒等与确定性断言。
 *
 * 注意：这些是**归一化后的规范形状**（见 model.ts 顶部约定）——numbered_list 无 start
 * 即不写、空内联的 paragraph 不写 content 键；R25（T76-01）的 table/toggle 是
 * 结构化 content（rows/header[/colWidths]、title/body），PM 侧为 atom 节点，attr 名
 * 与 content 键逐字同名。
 *
 * 唯一的「未知块」样例（embed）刻意**不用**已知类型名：R25 前它是 toggle，
 * toggle 转正后必须换成真正未知的类型，否则该用例失去意义（见报告 §3 DEVIATION-1）。
 */
import { inlineDoc, text, type Block, type PMNodeJSON } from '../../src/model';

export const FIXTURE_PAGE_ID = 'pg0000000000000000000000page';
export const FIXTURE_NOW = 1_700_000_000_000;

export interface BlockFixture {
  name: string;
  block: Block;
  node: PMNodeJSON;
}

function base(partial: {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: Block['content'];
  sort_key: string;
  version?: number;
}): Block {
  return {
    id: partial.id,
    page_id: FIXTURE_PAGE_ID,
    type: partial.type,
    props: partial.props,
    content: partial.content,
    parent_id: null,
    sort_key: partial.sort_key,
    alive: 1,
    version: partial.version ?? 1,
    last_edited: FIXTURE_NOW,
  };
}

const P1 = 'blk00000000000000000001p';
const H1 = 'blk00000000000000000001h';
const BL = 'blk00000000000000000001b';
const NL = 'blk00000000000000000001n';
const TD = 'blk00000000000000000001t';
const QT = 'blk00000000000000000001q';
const CO = 'blk00000000000000000001c';
const DV = 'blk00000000000000000001d';
const IM = 'blk00000000000000000001i';
const UN = 'blk00000000000000000001u';
const TB = 'blk00000000000000000001x';
const TC = 'blk00000000000000000001y';
const TG = 'blk00000000000000000001z';

const IMAGE_SHA = 'a'.repeat(64);

export const BLOCK_FIXTURES: readonly BlockFixture[] = [
  {
    name: 'paragraph',
    block: base({
      id: P1,
      type: 'paragraph',
      props: {},
      content: inlineDoc([text('本页汇总 LZ 类稀有事件探测的实验现状与文献线索。')]),
      sort_key: 'A00000000',
    }),
    node: {
      type: 'paragraph',
      attrs: { id: P1 },
      content: [{ type: 'text', text: '本页汇总 LZ 类稀有事件探测的实验现状与文献线索。' }],
    },
  },
  {
    name: 'heading',
    block: base({
      id: H1,
      type: 'heading',
      props: { level: 2 },
      content: inlineDoc([text('一、探测器矩阵')]),
      sort_key: 'A00000001',
      version: 2,
    }),
    node: {
      type: 'heading',
      attrs: { id: H1, level: 2 },
      content: [{ type: 'text', text: '一、探测器矩阵' }],
    },
  },
  {
    name: 'bulleted_list',
    block: base({
      id: BL,
      type: 'bulleted_list',
      props: {},
      content: inlineDoc([text('XENONnT 2025 SR 的 WIMP 上限图')]),
      sort_key: 'A00000002',
    }),
    node: {
      type: 'bulleted_list',
      attrs: { id: BL },
      content: [{ type: 'text', text: 'XENONnT 2025 SR 的 WIMP 上限图' }],
    },
  },
  {
    name: 'numbered_list',
    block: base({
      id: NL,
      type: 'numbered_list',
      props: {},
      content: inlineDoc([text('复核 LZ 核反冲效率曲线')]),
      sort_key: 'A00000003',
    }),
    node: {
      type: 'numbered_list',
      attrs: { id: NL },
      content: [{ type: 'text', text: '复核 LZ 核反冲效率曲线' }],
    },
  },
  {
    name: 'number_list_with_start',
    block: base({
      id: 'blk00000000000000000001s',
      type: 'numbered_list',
      props: { start: 5 },
      content: inlineDoc([text('从第 5 条起')]),
      sort_key: 'A00000004',
    }),
    node: {
      type: 'numbered_list',
      attrs: { id: 'blk00000000000000000001s', start: 5 },
      content: [{ type: 'text', text: '从第 5 条起' }],
    },
  },
  {
    name: 'to_do',
    block: base({
      id: TD,
      type: 'to_do',
      props: { checked: true },
      content: inlineDoc([text('整理 XENONnT 2025 SR 的 WIMP 上限图')]),
      sort_key: 'A00000005',
    }),
    node: {
      type: 'to_do',
      attrs: { id: TD, checked: true },
      content: [{ type: 'text', text: '整理 XENONnT 2025 SR 的 WIMP 上限图' }],
    },
  },
  {
    name: 'quote',
    block: base({
      id: QT,
      type: 'quote',
      props: {},
      content: inlineDoc([
        text('「稀有事件率本底是暗物质直接探测的终极限制。」'),
      ]),
      sort_key: 'A00000006',
    }),
    node: {
      type: 'quote',
      attrs: { id: QT },
      content: [{ type: 'text', text: '「稀有事件率本底是暗物质直接探测的终极限制。」' }],
    },
  },
  {
    name: 'callout(quote+icon)',
    block: base({
      id: CO,
      type: 'quote',
      props: { icon: 'ℹ' },
      content: inlineDoc([text('口径提醒：曝光量单位统一换算为 ton·yr。')]),
      sort_key: 'A00000007',
    }),
    node: {
      type: 'quote',
      attrs: { id: CO, icon: 'ℹ' },
      content: [{ type: 'text', text: '口径提醒：曝光量单位统一换算为 ton·yr。' }],
    },
  },
  {
    name: 'code',
    block: base({
      id: 'blk00000000000000000001k',
      type: 'code',
      props: { lang: 'python' },
      content: 'er = np.interp(energy_kev, breakpoints, values)',
      sort_key: 'A00000008',
    }),
    node: {
      type: 'codeBlock',
      attrs: { id: 'blk00000000000000000001k', lang: 'python' },
      content: [{ type: 'text', text: 'er = np.interp(energy_kev, breakpoints, values)' }],
    },
  },
  {
    name: 'divider',
    block: base({ id: DV, type: 'divider', props: {}, content: null, sort_key: 'A00000009' }),
    node: { type: 'divider', attrs: { id: DV } },
  },
  {
    name: 'image',
    block: base({
      id: IM,
      type: 'image',
      props: { file_id: IMAGE_SHA, caption: '图 1：排除曲线', width: 480 },
      content: null,
      sort_key: 'A0000000A',
    }),
    node: {
      type: 'image',
      attrs: { id: IM, file_id: IMAGE_SHA, caption: '图 1：排除曲线', width: 480 },
    },
  },
  {
    name: 'table',
    block: base({
      id: TB,
      type: 'table',
      props: {},
      content: {
        rows: [
          ['事件', '曝光量'],
          ['LZ 2025 SR', '4.2 ton·yr'],
        ],
        header: true,
      },
      sort_key: 'A0000000B',
    }),
    node: {
      type: 'table',
      attrs: {
        id: TB,
        rows: [
          ['事件', '曝光量'],
          ['LZ 2025 SR', '4.2 ton·yr'],
        ],
        header: true,
        colWidths: null,
      },
    },
  },
  {
    name: 'table_with_col_widths',
    block: base({
      id: TC,
      type: 'table',
      props: {},
      content: {
        rows: [
          ['参数', '值'],
          ['阈值', '3.5 keV'],
        ],
        header: true,
        colWidths: [160, 96],
      },
      sort_key: 'A0000000C',
    }),
    node: {
      type: 'table',
      attrs: {
        id: TC,
        rows: [
          ['参数', '值'],
          ['阈值', '3.5 keV'],
        ],
        header: true,
        colWidths: [160, 96],
      },
    },
  },
  {
    name: 'toggle',
    block: base({
      id: TG,
      type: 'toggle',
      props: {},
      content: { title: '口径问答', body: ['为什么用 ton·yr？', '统一下限换算基准。'] },
      sort_key: 'A0000000D',
    }),
    node: {
      type: 'toggle',
      attrs: { id: TG, title: '口径问答', body: ['为什么用 ton·yr？', '统一下限换算基准。'] },
    },
  },
  {
    name: 'unknown(embed)',
    block: base({
      id: UN,
      type: 'embed',
      props: { url: 'https://example.com/chart' },
      content: inlineDoc([]),
      sort_key: 'A0000000E',
    }),
    node: {
      type: 'paragraph',
      attrs: {
        id: UN,
        _unsupported: 'embed',
        _raw: { url: 'https://example.com/chart' },
      },
    },
  },
];

/**
 * 「一页假文档，含各块型各一」——apps 接线与 react 冒烟共用。
 * 排除唯一的「未知块」样例（UN）：它投影成 paragraph，不属于常规内容面。
 */
export function demoBlockDoc(): { pageId: string; blocks: Block[] } {
  return {
    pageId: FIXTURE_PAGE_ID,
    blocks: BLOCK_FIXTURES.filter((fixture) => !fixture.name.startsWith('unknown')).map(
      (fixture) => fixture.block,
    ),
  };
}
