/**
 * wikilink.test.ts —— 双链纯函数层与 PM 集成断言（TASK-T44-01）。
 *
 * 纯函数（触发/收口/过滤/语法/JSON 抽取）在无浏览器环境逐例断言；
 * PM 集成（节点 schema/渲染 DOM/收口插件/补全回调/命令助手）用真实 TiptapEditor
 * （jsdom，口径同 rules.test.ts）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor as TiptapEditor } from '@tiptap/core';
import { editorExtensions } from '../src/types';
import {
  createWikilinkInputRulePlugin,
  createWikilinkMenuPlugin,
  extractWikilinksFromContent,
  filterWikilinkCandidates,
  insertWikilinkSelection,
  matchWikilinkClose,
  matchWikilinkTrigger,
  parseWikilinkSyntax,
  resolveTitleToId,
  resolveWikilinkTarget,
  textOfBlockContent,
  type WikilinkCandidate,
  type WikilinkHostRef,
  type WikilinkMenuState,
} from '../src/rules/wikilink';
import { blockContentTextLines } from '../src/content';

const editors: TiptapEditor[] = [];

interface HostRecorder {
  candidates: WikilinkCandidate[];
  menus: Array<WikilinkMenuState | null>;
}

function createEditor(
  content?: Record<string, unknown>,
  recorder?: HostRecorder,
): TiptapEditor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ref: WikilinkHostRef = {
    current:
      recorder === undefined
        ? null
        : {
            candidates: recorder.candidates,
            onMenuChange: (state) => {
              recorder.menus.push(state);
            },
          },
  };
  const editor = new TiptapEditor({
    element: host,
    extensions: editorExtensions(),
    content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  // 与 react/Editor.tsx 相同的插件装配（宿主 ref 注入）
  editor.registerPlugin(createWikilinkMenuPlugin(ref));
  editor.registerPlugin(createWikilinkInputRulePlugin(ref));
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
});

const CANDIDATES: WikilinkCandidate[] = [
  { id: 'pg-1', title: '甲页' },
  { id: 'pg-2', title: '乙页研究' },
  { id: 'pg-3', title: '研究笔记' },
  { id: 'pg-4', title: '研究' },
];

describe('wikilink 纯函数：触发检测', () => {
  it('`[[` 后任意词触发，返回 query 与 [[ 偏移', () => {
    expect(matchWikilinkTrigger('前文[[研究')).toEqual({ query: '研究', offset: 2 });
    expect(matchWikilinkTrigger('[[')).toEqual({ query: '', offset: 0 });
  });
  it('无 `[[`、query 含换行或闭括号、空串不触发', () => {
    expect(matchWikilinkTrigger('普通文本')).toBeNull();
    expect(matchWikilinkTrigger('[[abc]]')).toBeNull();
    expect(matchWikilinkTrigger('[[a\nb')).toBeNull();
    expect(matchWikilinkTrigger('')).toBeNull();
  });
});

describe('wikilink 纯函数：语法收口', () => {
  it('`[[页名]]` 与 `[[页名|别名]]` 拆分', () => {
    expect(matchWikilinkClose('看[[乙页研究]]', false)).toEqual({
      title: '乙页研究',
      alias: null,
      length: 8,
    });
    expect(matchWikilinkClose('[[乙页|简称]]', false)).toEqual({
      title: '乙页',
      alias: '简称',
      length: 9,
    });
  });
  it('IME 组合期零触发；空 title 拒绝；未收口返回 null', () => {
    expect(matchWikilinkClose('[[乙页]]', true)).toBeNull();
    expect(matchWikilinkClose('[[]]', false)).toBeNull();
    expect(matchWikilinkClose('[[乙页', false)).toBeNull();
  });
  it('parseWikilinkSyntax：首个 | 分隔、两侧裁空白', () => {
    expect(parseWikilinkSyntax(' 页名 | 别名 ')).toEqual({ title: '页名', alias: '别名' });
    expect(parseWikilinkSyntax('页名|')).toEqual({ title: '页名', alias: null });
  });
});

describe('wikilink 纯函数：候选过滤与标题解析', () => {
  it('按标题包含过滤（大小写不敏感）、上限截断、稳定排序', () => {
    expect(filterWikilinkCandidates(CANDIDATES, '研究').map((c) => c.id)).toEqual([
      'pg-2',
      'pg-4',
      'pg-3',
    ]);
    expect(filterWikilinkCandidates(CANDIDATES, '')).toHaveLength(4);
    expect(filterWikilinkCandidates(CANDIDATES, '', 2)).toHaveLength(2);
  });
  it('resolveTitleToId：精确优先，其次大小写不敏感，未命中 null', () => {
    expect(resolveTitleToId(CANDIDATES, '甲页')).toBe('pg-1');
    expect(resolveTitleToId(CANDIDATES, 'ghost')).toBeNull();
  });
});

describe('wikilink 纯函数：块 content JSON 抽取（main 派生共用）', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '前文' },
          { type: 'wikilink', attrs: { target: 'pg-2', title: '乙页', alias: null } },
          { type: 'wikilink', attrs: { target: null, title: '幽灵', alias: '别名' } },
        ],
      },
    ],
  };
  it('extractWikilinksFromContent 抽出全部链接（含未解析）', () => {
    expect(extractWikilinksFromContent(doc)).toEqual([
      { target: 'pg-2', title: '乙页', alias: null },
      { target: null, title: '幽灵', alias: '别名' },
    ]);
  });
  it('textOfBlockContent 提取纯文本（wikilink 节点不计入）', () => {
    expect(textOfBlockContent(doc)).toBe('前文');
    expect(textOfBlockContent('code 纯文本')).toBe('code 纯文本');
    expect(textOfBlockContent(null)).toBe('');
  });

  // T82-02（H-07）：单一实现 `blockContentTextLines` 的三形态覆盖。
  // 修复前本函数自带 PM-doc-only 递归，table/toggle 结构化正文抽不到（空串）。
  it('T82-02：结构化 table → 逐单元格一行（阅读序，空单元格不产行）', () => {
    const table = { rows: [['格A', '', '格B'], ['', '格C', '']], header: true };
    expect(blockContentTextLines(table)).toEqual(['格A', '格B', '格C']);
    // 与旧口径的差别：修复前这里恒为空数组
    expect(textOfBlockContent(table)).toBe('格A格B格C');
  });

  it('T82-02：结构化 toggle → title 一行 + body 逐行', () => {
    const toggle = { title: '折叠标题Q', body: ['正文行R', '正文行S'] };
    expect(blockContentTextLines(toggle)).toEqual(['折叠标题Q', '正文行R', '正文行S']);
    expect(textOfBlockContent(toggle)).toBe('折叠标题Q正文行R正文行S');
  });

  it('T82-02：PM doc 多段 → 每段一行（段内多 text 节点合成一行）', () => {
    const multi = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '续' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
        { type: 'paragraph' },
      ],
    };
    expect(blockContentTextLines(multi)).toEqual(['第一段续', '第二段']);
    // 旧口径：join('') 后逐字等价（回归保护）
    expect(textOfBlockContent(multi)).toBe('第一段续第二段');
  });

  it('T82-02：单段 doc / 字符串 / null 三形与旧口径逐字一致', () => {
    expect(blockContentTextLines(doc)).toEqual(['前文']);
    expect(blockContentTextLines('code 纯文本')).toEqual(['code 纯文本']);
    expect(blockContentTextLines(null)).toEqual([]);
    expect(blockContentTextLines([])).toEqual([]);
    expect(blockContentTextLines(undefined)).toEqual([]);
    expect(blockContentTextLines(42)).toEqual([]);
  });

  it('T82-02：divider/image 形态（无 text/content）不产行', () => {
    expect(blockContentTextLines({ type: 'divider' })).toEqual([]);
    expect(blockContentTextLines({ type: 'image', attrs: { src: 'asset://x' } })).toEqual([]);
  });
});

describe('wikilink PM 集成（真实 TiptapEditor）', () => {
  it('节点注册进 schema；JSON → 文档 → getJSON attrs 往返', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '见' },
            { type: 'wikilink', attrs: { target: 'pg-1', title: '甲页', alias: null } },
          ],
        },
      ],
    });
    expect(editor.state.schema.nodes['wikilink']).toBeDefined();
    const json = editor.getJSON() as { content?: Array<{ content?: Array<Record<string, unknown>> }> };
    const inline = json.content?.[0]?.content ?? [];
    expect(inline[1]?.type).toBe('wikilink');
    expect(inline[1]?.attrs).toMatchObject({ target: 'pg-1', title: '甲页' });
  });

  it('渲染：已解析 = sc-wikilink；未解析带 --unresolved 弱化类（同段互不串扰）', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'wikilink', attrs: { target: 'pg-1', title: '甲页', alias: null } },
            { type: 'text', text: 'b' },
            { type: 'wikilink', attrs: { target: null, title: '幽灵页', alias: null } },
          ],
        },
      ],
    });
    const links = editor.view.dom.querySelectorAll('span[data-wikilink]');
    expect(links).toHaveLength(2);
    expect(links[0]?.className).toBe('sc-wikilink');
    expect(links[0]?.textContent).toBe('甲页');
    expect(links[1]?.className).toBe('sc-wikilink sc-wikilink--unresolved');
    expect(links[1]?.textContent).toBe('幽灵页');
  });

  it('补全回调：输入 `[[词` 后 onMenuChange 收到触发态；光标离开/清空回 null', () => {
    const recorder: HostRecorder = { candidates: CANDIDATES, menus: [] };
    const editor = createEditor(undefined, recorder);
    editor.commands.insertContent('[[');
    editor.commands.insertContent('研究');
    const last = recorder.menus[recorder.menus.length - 1];
    expect(last).not.toBeNull();
    expect(last?.query).toBe('研究');
    // 清掉触发文本 → 关闭
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(recorder.menus[recorder.menus.length - 1]).toBeNull();
  });

  it('收口插件：`]]` 直填成链（候选命中 → target 解析），替换 [[…]] 文本', () => {
    const recorder: HostRecorder = { candidates: CANDIDATES, menus: [] };
    const editor = createEditor(undefined, recorder);
    editor.commands.insertContent('看[[乙页研究');
    const view = editor.view;
    const pos = editor.state.selection.from;
    const pass1 = view.someProp('handleTextInput', (handler) =>
      handler(view, pos, pos, ']', () => view.state.tr),
    );
    expect(pass1).not.toBe(true); // 单个 ] 不收口
    // 真实键入：首个 ] 未被消费会由 PM 正常落进文档，第二个 ] 才收口
    editor.commands.insertContent(']');
    const pos2 = editor.state.selection.from;
    const pass2 = view.someProp('handleTextInput', (handler) =>
      handler(view, pos2, pos2, ']', () => view.state.tr),
    );
    expect(pass2).toBe(true);
    const json = editor.getJSON() as { content?: Array<{ content?: Array<Record<string, unknown>> }> };
    const inline = json.content?.[0]?.content ?? [];
    expect(inline).toHaveLength(2); // text '看' + wikilink
    expect(inline[1]?.type).toBe('wikilink');
    expect(inline[1]?.attrs).toMatchObject({ target: 'pg-2', title: '乙页研究', alias: null });
    // 触发态同步关闭（文本已不再是 `[[query`）
    expect(recorder.menus[recorder.menus.length - 1]).toBeNull();
  });

  it('命令助手：insertWikilinkSelection 替换区间；resolveWikilinkTarget 回填 id', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '[[甲页' }] }],
    });
    const from = 1; // paragraph 内容起点
    const to = from + '[[甲页'.length;
    expect(insertWikilinkSelection(editor, from, to, { target: 'pg-1', title: '甲页', alias: null })).toBe(
      true,
    );
    const json1 = editor.getJSON() as { content?: Array<{ content?: Array<Record<string, unknown>> }> };
    expect(json1.content?.[0]?.content?.[0]?.type).toBe('wikilink');
    // 未解析节点回填 target（按节点位置定位，不猜光标）
    let nodePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'wikilink') {
        nodePos = pos;
        return false;
      }
      return true;
    });
    expect(nodePos).toBeGreaterThanOrEqual(0);
    expect(resolveWikilinkTarget(editor, nodePos, 'pg-9')).toBe(true);
    const json2 = editor.getJSON() as { content?: Array<{ content?: Array<Record<string, unknown>> }> };
    expect(json2.content?.[0]?.content?.[0]?.attrs).toMatchObject({ target: 'pg-9' });
  });

  it('块投影往返：wikilink 经 blocksToPMDoc/pmDocToBlocks 不丢 attrs', async () => {
    const model = await import('../src/model');
    type Block = import('../src/model').Block;
    type BlockDoc = import('../src/model').BlockDoc;
    const base = {
      id: 'blk-1',
      page_id: 'pg-1',
      type: 'paragraph',
      props: {},
      parent_id: null,
      sort_key: 'A00000000',
      alive: 1,
      version: 1,
      last_edited: 0,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'x' },
              { type: 'wikilink', attrs: { target: 'pg-2', title: '乙页', alias: '乙' } },
            ],
          },
        ],
      },
    } as Block;
    const prev: BlockDoc = { pageId: 'pg-1', blocks: [base] };
    const round = model.pmDocToBlocks(model.blocksToPMDoc(prev), prev, () => ({ c: 1, d: 'x' }));
    const doc0 = round.blocks[0]?.content as
      | { content?: Array<{ content?: Array<Record<string, unknown>> }> }
      | undefined;
    const inline = doc0?.content?.[0]?.content ?? [];
    expect(inline[1]).toMatchObject({
      type: 'wikilink',
      attrs: { target: 'pg-2', title: '乙页', alias: '乙' },
    });
  });
});
