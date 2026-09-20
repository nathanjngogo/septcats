/**
 * renderer/src/ai/chatReply.ts —— AI 回复的呈现口径（TASK-T46-01 §1.2/§1.3）。
 *
 * 纯函数：空正文 / 纯推理 / `finish_reason === 'length'` 的可读提示、推理正文折叠数据、
 * 推理正文落盘截断、错误文案（超时 → 可读 + 调大指引）。文案全走 i18n，本文件无中文
 * 字面量、不触网、不读密钥。
 *
 * 关键不变量（§1.2）：**绝不把空回复渲染成空白气泡** —— 正文为空时本模块必给提示文案
 * （有推理正文 → 「仅推理内容」；否则 → 「未返回正文」）。
 */
import { errorText, t } from '../i18n';
import type { ChatMsg } from './chatState';

/** 推理正文落盘上限（字符）：超出则截断 + 尾部说明，避免 localStorage 体量失控。 */
export const REASONING_STORAGE_LIMIT = 4_000;

/** 超时错误码探测（main 侧 AiError 消息形如 `E_AI_TIMEOUT：…`）。 */
const TIMEOUT_CODE_PATTERN = /\bE_AI_TIMEOUT\b/;

/**
 * 空正文提示：正文（去空白后）非空 → null（不打扰）；
 * 正文为空但带推理正文 → 「仅推理内容」；正文为空且无推理 → 「未返回正文」。
 */
export function replyNoticeText(msg: Pick<ChatMsg, 'content' | 'reasoning'>): string | null {
  if (msg.content.trim().length > 0) {
    return null;
  }
  const reasoning = msg.reasoning;
  if (reasoning !== undefined && reasoning.length > 0) {
    return t('aiChat.reasoningOnlyNotice');
  }
  return t('aiChat.emptyReplyNotice');
}

/** `finish_reason === 'length'` → 「达到输出上限」提示；其余（含 undefined）→ null。 */
export function lengthNoticeText(finishReason: string | undefined): string | null {
  return finishReason === 'length' ? t('aiChat.lengthNotice') : null;
}

/** 消息携带的推理正文（非空才返回；供折叠区渲染）。 */
export function reasoningOf(msg: Pick<ChatMsg, 'reasoning'>): string | null {
  const reasoning = msg.reasoning;
  return reasoning !== undefined && reasoning.length > 0 ? reasoning : null;
}

/** 推理正文落盘截断：≤上限原样；超出 → 前 N 字符 + 尾部说明（undefined 原样透传）。 */
export function clampReasoningForStorage(reasoning: string | undefined): string | undefined {
  if (reasoning === undefined || reasoning.length <= REASONING_STORAGE_LIMIT) {
    return reasoning;
  }
  const suffix = t('aiChat.reasoningTruncated').replace('{n}', String(REASONING_STORAGE_LIMIT));
  return reasoning.slice(0, REASONING_STORAGE_LIMIT) + suffix;
}

/**
 * 错误文案：走既有 `errorText`（错误码 → 文案，未知码回落原文）。
 * `E_AI_TIMEOUT` 额外追加「可在设置 › AI 助手中调大『请求超时』」指引（§1.3：
 * 不许只显示原始错误码）；`timeoutSec` 为当前生效值时带上具体秒数。
 */
export function panelErrorText(error: unknown, timeoutSec: number | null): string {
  const text = errorText(error);
  const message = error instanceof Error ? error.message : String(error);
  if (!TIMEOUT_CODE_PATTERN.test(message)) {
    return text;
  }
  const hint =
    timeoutSec === null
      ? t('aiChat.timeoutHintBare')
      : t('aiChat.timeoutHint').replace('{n}', String(timeoutSec));
  return `${text} ${hint}`;
}
