/**
 * wikilink.ts —— 双链的纯函数层与 PM 插件（TASK-T44-01）。
 *
 * 分层与 inputRules.ts 同款纪律：**判定是纯函数，PM 插件只是执行器**——
 * 触发检测（`[[` 补全）、语法收口（`]]` 成链）、候选过滤都可以在无浏览器
 * 环境下逐例断言；IME 组合期零触发（composition flag + view.composing 双保险）。
 *
 * 宿主（PageView）经 `wikilinkHost` 注入三个能力：
 * - `candidates`：当前工作区页面候选（id+title，改名不破链的稳定键）；
 * - `onMenuChange`：补全菜单开/关（含 query），宿主渲染浮层（复用 SlashMenu）；
 * - `onLinkClick`：点击 wikilink（宿主决定页签打开或新建目标页）。
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { WIKILINK_NODE_NAME } from '../types/wikilink';

// ---------------------------------------------------------------------------
// 纯函数层
// ---------------------------------------------------------------------------

/** 页面候选（当前工作区；id 是稳定键——改名不破链）。 */
export interface WikilinkCandidate {
  id: string;
  title: string;
}

/** 补全菜单状态：`from` = `[[` 的文档位置，`query` = `[[` 后的过滤词。 */
export interface WikilinkMenuState {
  from: number;
  query: string;
}

/** 点击链接的信息（pos = 节点在文档中的位置，供宿主回填 target）。 */
export interface WikilinkClickInfo {
  target: string | null;
  title: string;
  alias: string | null;
  pos: number;
}

/** 宿主注入面（Editor 的 `wikilinkHost` prop；经 ref 热更新）。 */
export interface WikilinkHostHandlers {
  candidates: WikilinkCandidate[];
  onMenuChange?: (state: WikilinkMenuState | null) => void;
  onLinkClick?: (info: WikilinkClickInfo) => void;
}

export type WikilinkHostRef = { current: WikilinkHostHandlers | null };

/** 补全候选上限（避免长列表溢出视口；SlashMenu 自带视口夹紧兜底）。 */
export const WIKILINK_CANDIDATE_LIMIT = 8;

/**
 * 补全候选过滤：标题包含 query（大小写不敏感），空 query = 全量；稳定排序。
 */
export function filterWikilinkCandidates(
  candidates: readonly WikilinkCandidate[],
  query: string,
  limit: number = WIKILINK_CANDIDATE_LIMIT,
): WikilinkCandidate[] {
  const needle = query.trim().toLowerCase();
  const matched = candidates.filter((candidate) => {
    if (needle.length === 0) {
      return true;
    }
    return candidate.title.toLowerCase().includes(needle);
  });
  return matched
    .slice()
    .sort((a, b) => (a.title === b.title ? (a.id < b.id ? -1 : 1) : a.title < b.title ? -1 : 1))
    .slice(0, limit);
}

/** `[[页名|别名]]` 语法拆分（首个 `|` 分隔；两侧空白裁掉）。 */
export function parseWikilinkSyntax(raw: string): { title: string; alias: string | null } {
  const pipe = raw.indexOf('|');
  if (pipe < 0) {
    return { title: raw.trim(), alias: null };
  }
  return { title: raw.slice(0, pipe).trim(), alias: raw.slice(pipe + 1).trim() || null };
}

const TRIGGER_RULE = /\[\[([^\[\]\n]*)$/;
const CLOSE_RULE = /\[\[([^\[\]\n]+)\]\]$/;

/**
 * 触发检测：光标前文本以 `[[query` 收尾（query 内不允许 `[`/`]`/换行）。
 * 返回 query 与 `[[` 在 textBefore 中的偏移；未触发返回 null。
 */
export function matchWikilinkTrigger(textBefore: string): { query: string; offset: number } | null {
  const matched = TRIGGER_RULE.exec(textBefore);
  if (matched === null) {
    return null;
  }
  const query = matched[1] ?? '';
  return { query, offset: matched.index };
}

/**
 * 语法收口：textBefore 以 `[[...]]` 收尾 → 拆出 title/alias。
 * composing=true 恒 null（IME 组合期零触发，任务书 §0.4 铁律）。
 */
export function matchWikilinkClose(
  textBefore: string,
  composing: boolean,
): { title: string; alias: string | null; length: number } | null {
  if (composing || textBefore.length === 0) {
    return null;
  }
  const matched = CLOSE_RULE.exec(textBefore);
  if (matched === null) {
    return null;
  }
  const raw = matched[1] ?? '';
  const parsed = parseWikilinkSyntax(raw);
  if (parsed.title.length === 0) {
    return null;
  }
  return { ...parsed, length: matched[0].length };
}

/** 按标题找候选（精确优先，其次大小写不敏感）。供 `]]` 直填时解析 target。 */
export function resolveTitleToId(
  candidates: readonly WikilinkCandidate[],
  title: string,
): string | null {
  const exact = candidates.find((candidate) => candidate.title === title);
  if (exact !== undefined) {
    return exact.id;
  }
  const lower = title.toLowerCase();
  const loose = candidates.find((candidate) => candidate.title.toLowerCase() === lower);
  return loose !== undefined ? loose.id : null;
}

// ---------------------------------------------------------------------------
// PM doc JSON 解析（main 侧派生索引共用；不依赖 PM 实例）
// ---------------------------------------------------------------------------

/** 从块 content JSON（PM doc）里抽出全部 wikilink 节点（递归遍历）。 */
export function extractWikilinksFromContent(
  content: unknown,
): Array<{ target: string | null; title: string; alias: string | null }> {
  const found: Array<{ target: string | null; title: string; alias: string | null }> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (value === null || typeof value !== 'object') {
      return;
    }
    const record = value as Record<string, unknown>;
    if (record['type'] === WIKILINK_NODE_NAME) {
      const attrs = (record['attrs'] ?? {}) as Record<string, unknown>;
      found.push({
        target: typeof attrs['target'] === 'string' && attrs['target'].length > 0 ? attrs['target'] : null,
        title: typeof attrs['title'] === 'string' ? attrs['title'] : '',
        alias: typeof attrs['alias'] === 'string' ? attrs['alias'] : null,
      });
      return;
    }
    visit(record['content']);
  };
  visit(content);
  return found;
}

/** 块 content JSON 的纯文本（上下文片段用；code 纯文本与 PM doc 双形态都支持）。 */
export function textOfBlockContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (value === null || typeof value !== 'object') {
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record['text'] === 'string') {
      out.push(record['text']);
    }
    visit(record['content']);
  };
  visit(content);
  return out.join('');
}

// ---------------------------------------------------------------------------
// PM 插件执行器
// ---------------------------------------------------------------------------

const wikilinkMenuPluginKey = new PluginKey('septcatsWikilinkMenu');

/** code 块等无内联语义的文本块不参与双链（口径同 inputRules 的 RULE_EXEMPT_TYPES）。 */
const TRIGGER_EXEMPT_TYPES: ReadonlySet<string> = new Set(['codeBlock', 'divider', 'image']);

/** 当前选区（空选区）在文本块内的光标前文本；不满足条件返回 null。 */
function textBeforeCursor(view: EditorView): { parent: PMNode; text: string } | null {
  const { from, to } = view.state.selection;
  if (from !== to) {
    return null;
  }
  const $from = view.state.doc.resolve(from);
  const parent = $from.parent;
  if (!parent.isTextblock || TRIGGER_EXEMPT_TYPES.has(parent.type.name)) {
    return null;
  }
  const blockStart = $from.start();
  return { parent, text: parent.textBetween(0, from - blockStart, undefined, '\ufffc') };
}

function menuStateOf(view: EditorView): WikilinkMenuState | null {
  const ctx = textBeforeCursor(view);
  if (ctx === null) {
    return null;
  }
  const trigger = matchWikilinkTrigger(ctx.text);
  if (trigger === null) {
    return null;
  }
  const blockStart = view.state.selection.$from.start();
  return { from: blockStart + trigger.offset, query: trigger.query };
}

/** 补全菜单状态机插件：每次事务后重算 `[[query` 触发态，仅在变化时回调宿主。 */
export function createWikilinkMenuPlugin(hostRef: WikilinkHostRef): Plugin {
  let last: { from: number; query: string } | null = null;
  const emit = (next: WikilinkMenuState | null): void => {
    const changed =
      (last === null && next !== null) ||
      (last !== null && (next === null || last.from !== next.from || last.query !== next.query));
    last = next === null ? null : { from: next.from, query: next.query };
    if (changed) {
      hostRef.current?.onMenuChange?.(next);
    }
  };
  return new Plugin({
    key: wikilinkMenuPluginKey,
    view: () => ({
      update: (updated) => {
        emit(menuStateOf(updated));
      },
      destroy: () => {
        emit(null);
      },
    }),
  });
}

const wikilinkInputRulePluginKey = new PluginKey('septcatsWikilinkInputRule');

/** `]]` 收口插件：`[[页名]]` / `[[页名|别名]]` 直填成链（候选命中 → 解析 target）。 */
export function createWikilinkInputRulePlugin(hostRef: WikilinkHostRef): Plugin {
  let composing = false;
  return new Plugin({
    key: wikilinkInputRulePluginKey,
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
        if (composing || view.composing || from !== to) {
          return false;
        }
        const ctx = textBeforeCursor(view);
        if (ctx === null) {
          return false;
        }
        const close = matchWikilinkClose(ctx.text + text, false);
        if (close === null) {
          return false;
        }
        const host = hostRef.current;
        const target = host !== null ? resolveTitleToId(host.candidates, close.title) : null;
        const nodeType = view.state.schema.nodes[WIKILINK_NODE_NAME];
        if (nodeType === undefined) {
          return false;
        }
        const tr = view.state.tr;
        // handleTextInput 在文本插入之前触发：要删的是 close.length - text.length 个字符
        const toDelete = close.length - text.length;
        if (toDelete > 0) {
          tr.delete(from - toDelete, from);
        }
        tr.replaceWith(
          from - toDelete,
          from - toDelete,
          nodeType.create({ target, title: close.title, alias: close.alias }),
        );
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}

const wikilinkClickPluginKey = new PluginKey('septcatsWikilinkClick');

/** 点击插件：点到 wikilink 原子节点时回调宿主（跳页签 / 新建目标页）。 */
export function createWikilinkClickPlugin(hostRef: WikilinkHostRef): Plugin {
  return new Plugin({
    key: wikilinkClickPluginKey,
    props: {
      handleClickOn: (_view, _pos, node, nodePos) => {
        if (node.type.name !== WIKILINK_NODE_NAME) {
          return false;
        }
        const target = typeof node.attrs['target'] === 'string' && node.attrs['target'].length > 0 ? node.attrs['target'] : null;
        const title = typeof node.attrs['title'] === 'string' ? node.attrs['title'] : '';
        const alias = typeof node.attrs['alias'] === 'string' ? node.attrs['alias'] : null;
        hostRef.current?.onLinkClick?.({ target, title, alias, pos: nodePos });
        // 不消费事件：光标落到节点上的既有行为保持
        return false;
      },
    },
  });
}

// ---------------------------------------------------------------------------
// 命令助手（宿主经 onReady 的 editor 实例调用）
// ---------------------------------------------------------------------------

/** wikilink 节点 attrs（宿主构造/回填用）。 */
export interface WikilinkAttrs {
  target: string | null;
  title: string;
  alias: string | null;
}

/** 用 wikilink 节点替换 [from, to) 文本（补全确认时的插入路径）。 */
export function insertWikilinkSelection(
  editor: TiptapEditor,
  from: number,
  to: number,
  attrs: WikilinkAttrs,
): boolean {
  const nodeType = editor.state.schema.nodes[WIKILINK_NODE_NAME];
  if (nodeType === undefined || to < from) {
    return false;
  }
  const tr = editor.state.tr.replaceWith(from, to, nodeType.create({ ...attrs }));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** 回填 target（未解析链接点击新建目标页后调用；保持 title/alias 不变）。 */
export function resolveWikilinkTarget(editor: TiptapEditor, pos: number, target: string): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (node === null || node.type.name !== WIKILINK_NODE_NAME) {
    return false;
  }
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, target });
  editor.view.dispatch(tr);
  return true;
}
