/**
 * chatContext.ts —— AI 对话的上下文装配与引用解析（TASK-T38-01 §0.3）。
 *
 * - 上下文 = 当前页：标题 + 块文本（块清单编号 [N]），按预算截断
 *   （总预算 CONTEXT_CHAR_BUDGET，单块 BLOCK_CHAR_LIMIT，超预算的块整块丢弃）；
 * - 「附带选中内容」：有选区且开关开 → 追加选中文本（自带独立上限）；
 * - 引用带出处：system 提示词约定出处标记 `⟦#N⟧`；回复渲染前经
 *   parseCitations 切分、resolveCitations 解析成 ChatRef（页名 + blockId），
 *   面板把标记替换为可点击的「页名 › 块锚点」chip（跳转走 chatBridge）。
 * - 多轮：历史按 HISTORY_TURN_LIMIT 条带上限重新装配进 messages；
 *   总长超 HISTORY_CHAR_BUDGET 时从最旧开始整轮丢弃（ipc 层 64 条/200k 硬门禁的
 *   客户端预收敛，绝不触发 E_MALFORMED）。
 * - 纯函数、无 IPC / 无 React；提示词文案走 i18n（门禁⑤：renderer 字符串字面量禁 CJK）。
 */
import type { AiMessage } from '../../../shared/ai';
import { t } from '../i18n';
import type { ChatMsg, ChatRef } from './chatState';

/** 编辑器侧提供的当前页上下文（chatBridge 转交，PageView 产出）。 */
export interface PageChatContext {
  pageId: string;
  pageTitle: string;
  /** 存活且有文本的块（编辑器文档顺序；id = data-id，可跳转锚点）。 */
  blocks: Array<{ id: string; text: string }>;
  /** 当前选区文本（无选区 → null）。 */
  selectedText: string | null;
}

/** 块清单条目：n 从 1 起（与 system 提示词与 ⟦#N⟧ 标记对应）。 */
export interface ChatContextBlock {
  n: number;
  blockId: string;
  text: string;
}

/** 上下文总预算（字符；system 消息里页面部分的上限）。 */
export const CONTEXT_CHAR_BUDGET = 8000;
/** 单块文本上限（超出截断加省略号）。 */
export const BLOCK_CHAR_LIMIT = 600;
/** 选中文本上限。 */
export const SELECTION_CHAR_LIMIT = 2000;
/** 随请求携带的历史条数上限（不含 system 与本轮提问）。 */
export const HISTORY_TURN_LIMIT = 20;
/** 历史总字符预算（超出从最旧整轮丢弃）。 */
export const HISTORY_CHAR_BUDGET = 60_000;

const ELLIPSIS = '…';

// ---------------------------------------------------------------------------
// 上下文装配
// ---------------------------------------------------------------------------

/** 页上下文 → 编号块清单（顺序编号；按单块/总预算截断，超预算的块整块丢弃）。 */
export function buildBlockIndex(ctx: PageChatContext | null): ChatContextBlock[] {
  if (ctx === null) {
    return [];
  }
  const index: ChatContextBlock[] = [];
  let used = 0;
  for (const block of ctx.blocks) {
    const text =
      block.text.length > BLOCK_CHAR_LIMIT
        ? block.text.slice(0, BLOCK_CHAR_LIMIT) + ELLIPSIS
        : block.text;
    if (used + text.length > CONTEXT_CHAR_BUDGET) {
      break;
    }
    used += text.length;
    index.push({ n: index.length + 1, blockId: block.id, text });
  }
  return index;
}

/** system 消息里的上下文段落（null ctx = 当前无页面上下文）。 */
export function buildContextText(
  ctx: PageChatContext | null,
  index: ChatContextBlock[],
  options: { includeSelection: boolean },
): string {
  if (ctx === null || index.length === 0) {
    return t('aiChat.contextUnavailable');
  }
  const lines: string[] = [];
  lines.push(`${t('aiChat.promptContextHeader')}${ctx.pageTitle}`);
  lines.push(t('aiChat.promptBlocksHeader'));
  for (const block of index) {
    lines.push(`[${String(block.n)}] ${block.text}`);
  }
  if (options.includeSelection && ctx.selectedText !== null && ctx.selectedText.length > 0) {
    const selected =
      ctx.selectedText.length > SELECTION_CHAR_LIMIT
        ? ctx.selectedText.slice(0, SELECTION_CHAR_LIMIT) + ELLIPSIS
        : ctx.selectedText;
    lines.push(`${t('aiChat.promptSelectionHeader')}${selected}`);
  }
  return lines.join('\n');
}

/** system 提示词（角色 + 引用规则 + 页面上下文）。 */
export function buildChatSystemPrompt(contextText: string): string {
  return `${t('aiChat.promptRole')}\n${t('aiChat.promptCitationRule')}\n${contextText}`;
}

/**
 * 多轮装配：[system, ...历史（时间序）, 本轮提问]。
 * 历史超限（条数/总字符）从最旧开始整轮丢弃（一轮 = 一条 user + 紧随的 assistant）。
 */
export function assembleChatMessages(input: {
  history: readonly ChatMsg[];
  contextText: string | null;
  question: string;
}): AiMessage[] {
  const system: AiMessage = {
    role: 'system',
    content: buildChatSystemPrompt(input.contextText ?? t('aiChat.contextUnavailable')),
  };
  // 先按条数截尾，再按总字符预算从最旧丢弃（一次丢一轮，保持 user/assistant 成对）
  let api: AiMessage[] = input.history
    .slice(-HISTORY_TURN_LIMIT)
    .map((msg) => ({ role: msg.role, content: msg.content }));
  const totalLength = (messages: readonly AiMessage[]): number =>
    messages.reduce((sum, msg) => sum + msg.content.length, 0);
  while (
    api.length > 0 &&
    totalLength([...api, { role: 'user', content: input.question }]) > HISTORY_CHAR_BUDGET
  ) {
    api = api.slice(2);
  }
  return [system, ...api, { role: 'user', content: input.question }];
}

// ---------------------------------------------------------------------------
// 引用解析（⟦#N⟧）
// ---------------------------------------------------------------------------

export type CitationSegment =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; n: number };

const CITATION_RE = /⟦#(\d+)⟧/g;

/** 把 assistant 回复切分为文本段与引用标记段（渲染层据此产出 chip）。 */
export function parseCitations(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, start) });
    }
    segments.push({ kind: 'ref', n: Number(match[1]) });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) });
  }
  return segments;
}

/**
 * 把回复里的 ⟦#N⟧ 解析成可跳转的引用列表（按 n 去重，保序）。
 * n 不在本次上下文块清单里 → 不产出引用（原样留在文本里，不静默改写 AI 输出）。
 */
export function resolveCitations(
  text: string,
  index: ChatContextBlock[],
  pageId: string,
  pageTitle: string,
): ChatRef[] {
  const byN = new Map(index.map((block) => [block.n, block]));
  const refs: ChatRef[] = [];
  const seen = new Set<number>();
  for (const segment of parseCitations(text)) {
    if (segment.kind !== 'ref' || seen.has(segment.n)) {
      continue;
    }
    const block = byN.get(segment.n);
    if (block === undefined) {
      continue;
    }
    seen.add(segment.n);
    refs.push({ n: segment.n, pageId, pageTitle, blockId: block.blockId });
  }
  return refs;
}
