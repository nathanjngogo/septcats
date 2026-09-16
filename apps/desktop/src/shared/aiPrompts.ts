/**
 * shared/aiPrompts.ts —— 编辑器块级 AI 动作的 prompt 单一来源（TASK-T18-03 §2.1）。
 *
 * 纯函数、无 IPC / 无 React —— renderer（T18-03）与将来的 main 侧动作共用同一份，
 * test/ai-prompts.test.ts 直测。文案与任务书逐字一致，不得改动措辞。
 * user 消息 = 原文原样（不 trim、不截断——长度上限由 ipc 层 200k 兜底）。
 */
import type { AiMessage } from './ai';

export const AI_BLOCK_ACTIONS = ['continue', 'summarize', 'rewrite', 'translate'] as const;

export type AiBlockAction = (typeof AI_BLOCK_ACTIONS)[number];

export function buildAiMessages(input: {
  action: AiBlockAction;
  text: string;
  targetLang?: string;
}): AiMessage[] {
  const { action, text, targetLang } = input;
  let system: string;
  switch (action) {
    case 'continue': {
      system =
        '你是中文写作助手。基于给定文本继续往下写，保持同一语气与体裁；只输出续写内容本身，不要解释、不要重复原文。';
      break;
    }
    case 'summarize': {
      system = '你是中文写作助手。把给定文本压缩为要点摘要，保留关键信息；只输出摘要本身。';
      break;
    }
    case 'rewrite': {
      system =
        '你是中文写作助手。在保持原意与信息量的前提下改写给定文本，使表达更清晰顺畅；只输出改写后的文本。';
      break;
    }
    case 'translate': {
      system = `你是中文翻译。把给定文本翻译为${targetLang ?? 'English'}，保持原有格式与换行；只输出译文。`;
      break;
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`buildAiMessages：未知动作 ${String(exhaustive)}`);
    }
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];
}
