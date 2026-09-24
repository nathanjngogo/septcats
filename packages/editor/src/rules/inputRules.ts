/**
 * inputRules.ts —— 块级输入规则（任务书 §1 / M4.3）。
 *
 * 触发集（**只认半角 ASCII**，CJK 标点安全）：
 *   `# ` `## ` `### ` → heading 1/2/3；`- ` `* ` → bulleted_list；`1. ` → numbered_list；
 *   `[] ` `[ ] ` `[x] ` → to_do（checked）；`> ` → quote；``` ```lang ``` → code。
 *
 * R25（T76-01）追加：`|a|b|` + **Enter** → table（PRD §2A；判定器 matchTableShorthand
 * 住 content.ts，经 applyTableEnterRule 在 handleKeyDown 执行——Enter 不是文本输入，
 * 走不了 handleTextInput 通道）。
 *
 * CJK 组合期铁律（任务书 §0.4）：compositionstart→compositionend 之间
 * **零触发**（本地 flag + `view.composing` 双保险）；面板/输入法提交的那一帧不误伤。
 *
 * 判定是纯函数 `matchInputRule(textBeforeCursor, composing)`，PM 插件只是执行器，
 * 因此「IME 期间零触发」可以在无浏览器环境下逐例断言。
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Attrs } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { matchTableShorthand, type TableContent } from '../content';
import { pmNodeNameOf } from '../model';

export type ParagraphInputKind = 'heading' | 'bulleted_list' | 'numbered_list' | 'to_do' | 'quote' | 'code';

export type BlockInputAction =
  | { kind: 'heading'; level: 1 | 2 | 3; deleteChars: number }
  | { kind: 'bulleted_list'; deleteChars: number }
  | { kind: 'numbered_list'; deleteChars: number }
  | { kind: 'to_do'; checked: boolean; deleteChars: number }
  | { kind: 'quote'; deleteChars: number }
  | { kind: 'code'; lang: string; deleteChars: number };

const HEADING_RULE = /^(#{1,3}) $/;
const NUMBERED_RULE = /^\d{1,9}\. $/;
const TODO_RULE = /^\[( ?|x|X)?\] $/;
const FENCE_RULE = /^```([A-Za-z0-9_+#-]{0,32})$/;

/** 纯判定：textBeforeCursor = 当前文本块内、光标之前的全部文本 + 本帧输入。 */
export function matchInputRule(textBeforeCursor: string, composing: boolean): BlockInputAction | null {
  if (composing || textBeforeCursor.length === 0) {
    return null;
  }
  const heading = HEADING_RULE.exec(textBeforeCursor);
  if (heading !== null) {
    const hashes = heading[1] ?? '#';
    return {
      kind: 'heading',
      level: Math.min(3, hashes.length) as 1 | 2 | 3,
      deleteChars: textBeforeCursor.length,
    };
  }
  if (textBeforeCursor === '- ' || textBeforeCursor === '* ') {
    return { kind: 'bulleted_list', deleteChars: textBeforeCursor.length };
  }
  if (NUMBERED_RULE.test(textBeforeCursor)) {
    return { kind: 'numbered_list', deleteChars: textBeforeCursor.length };
  }
  const todo = TODO_RULE.exec(textBeforeCursor);
  if (todo !== null) {
    const marker = todo[1] ?? ' ';
    return {
      kind: 'to_do',
      checked: marker === 'x' || marker === 'X',
      deleteChars: textBeforeCursor.length,
    };
  }
  if (textBeforeCursor === '> ') {
    return { kind: 'quote', deleteChars: textBeforeCursor.length };
  }
  const fence = FENCE_RULE.exec(textBeforeCursor);
  if (fence !== null) {
    return { kind: 'code', lang: fence[1] ?? '', deleteChars: textBeforeCursor.length };
  }
  return null;
}

function attrsFor(action: BlockInputAction): Attrs {
  switch (action.kind) {
    case 'heading':
      return { level: action.level };
    case 'to_do':
      return { checked: action.checked };
    case 'code':
      return { lang: action.lang };
    default:
      return {};
  }
}

/** 文本块内不参与输入规则的类型（code 自成一类，divider/image 无文本）。
 *  注意：比较的是 PM 节点名，故用 codeBlock。 */
const RULE_EXEMPT_TYPES: ReadonlySet<string> = new Set(['codeBlock', 'divider', 'image']);

/**
 * 执行输入规则。返回 true 表示「本帧已消费」（PM 不再插入原字符）。
 *
 * 注意：handleTextInput 在**文本插入之前**触发，故 `text` 只存在于判定串里，
 * 文档里要删的是 `deleteChars - text.length` 个字符。
 */
export function applyInputRule(view: EditorView, from: number, to: number, text: string): boolean {
  if (from !== to || text.length === 0) {
    return false;
  }
  const $from = view.state.doc.resolve(from);
  const parent = $from.parent;
  if (!parent.isTextblock || RULE_EXEMPT_TYPES.has(parent.type.name)) {
    return false;
  }
  const blockStart = $from.start();
  const before = parent.textBetween(0, from - blockStart, undefined, '\ufffc');
  const action = matchInputRule(before + text, false);
  if (action === null) {
    return false;
  }
  const nodeType = view.state.schema.nodes[pmNodeNameOf(action.kind)];
  if (nodeType === undefined) {
    return false;
  }
  const tr = view.state.tr;
  const toDelete = action.deleteChars - text.length;
  if (toDelete > 0) {
    tr.delete(from - toDelete, from);
  }
  // setNodeMarkup 的 attrs 是全量替换（缺省的 attr 重置为 default），必须显式带上
  // 原 id，否则「# 」「- 」等转换会把块身份冲掉 → 反投影按新块处理（身份分叉）。
  tr.setNodeMarkup($from.before($from.depth), nodeType, {
    id: parent.attrs['id'],
    ...attrsFor(action),
  });
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const inputRulesPluginKey = new PluginKey('septcatsInputRules');

/**
 * R25（T76-01 §A.5）输入规则：文本块内键入 `|a|b|` 后按 **Enter** → 转表格块。
 *
 * 为什么挂在 handleKeyDown 而非 handleTextInput：触发键是 Enter（不是文本输入），
 * 现有 `handleTextInput` 通道结构上吃不到（它只在插入字符那一帧被调用）。
 * 判定仍是纯函数 `matchTableShorthand`（content.ts），本函数只做执行——
 * 与 applyInputRule 同一口径（同一块级范围、同一 RULE_EXEMPT_TYPES 豁免）。
 * 保留原块 id：与「# 」「- 」等输入规则一致，身份不因换型分叉。
 */
export function applyTableEnterRule(view: EditorView, from: number, to: number): boolean {
  if (from !== to) {
    return false;
  }
  const $from = view.state.doc.resolve(from);
  const parent = $from.parent;
  if (!parent.isTextblock || RULE_EXEMPT_TYPES.has(parent.type.name)) {
    return false;
  }
  const blockStart = $from.start();
  const before = parent.textBetween(0, from - blockStart, undefined, '\ufffc');
  const content: TableContent | null = matchTableShorthand(before);
  if (content === null) {
    return false;
  }
  const nodeType = view.state.schema.nodes[pmNodeNameOf('table')];
  if (nodeType === undefined) {
    return false;
  }
  const blockPos = $from.before($from.depth);
  const tr = view.state.tr;
  tr.replaceWith(
    blockPos,
    blockPos + parent.nodeSize,
    nodeType.create({
      id: parent.attrs['id'],
      rows: content.rows,
      header: content.header,
      colWidths: null,
    }),
  );
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Enter 键形态守卫：不带修饰键、非组合期（与 handleTextInput 的 IME 铁律同口径）。 */
function isPlainEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

/** PM 插件：composition flag + handleTextInput。 */
export function createInputRulesPlugin(): Plugin {
  let composing = false;
  return new Plugin({
    key: inputRulesPluginKey,
    props: {
      handleDOMEvents: {
        compositionstart: () => {
          composing = true;
          return false;
        },
        compositionend: () => {
          composing = false;
          return false;
        },
      },
      handleTextInput: (view, from, to, text) => {
        if (composing || view.composing) {
          return false;
        }
        return applyInputRule(view, from, to, text);
      },
      // R25：`|a|b|` + Enter → 表格块（纯判定见 applyTableEnterRule）
      handleKeyDown: (view, event) => {
        if (composing || view.composing || !isPlainEnter(event)) {
          return false;
        }
        return applyTableEnterRule(view, view.state.selection.from, view.state.selection.to);
      },
    },
  });
}

export const SeptcatsInputRules = Extension.create({
  name: 'septcatsInputRules',
  addProseMirrorPlugins() {
    return [createInputRulesPlugin()];
  },
});
