/**
 * ai-prompts.test.ts —— 块级 AI 动作 prompt（TASK-T18-03 §3）。
 *
 * 纯 Node 直测：四动作 system 文案逐字、targetLang 默认与传入、user 原样、
 * 形状（长度 2 + role 顺序 system→user）。
 */
import { describe, expect, it } from 'vitest';
import { AI_BLOCK_ACTIONS, buildAiMessages } from '../src/shared/aiPrompts';

describe('AI_BLOCK_ACTIONS', () => {
  it('四动作清单（续写/摘要/改写/翻译）', () => {
    expect([...AI_BLOCK_ACTIONS]).toEqual(['continue', 'summarize', 'rewrite', 'translate']);
  });
});

describe('buildAiMessages：形状', () => {
  it('四动作均返回长度 2 且 role 顺序 system→user', () => {
    for (const action of AI_BLOCK_ACTIONS) {
      const messages = buildAiMessages({ action, text: '原文' });
      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe('system');
      expect(messages[1]?.role).toBe('user');
    }
  });

  it('user 消息原样（含换行/前后空格，不 trim 不截断）', () => {
    const raw = '  第一行\n\n  第二行  \n';
    for (const action of AI_BLOCK_ACTIONS) {
      expect(buildAiMessages({ action, text: raw })[1]?.content).toBe(raw);
    }
  });
});

describe('buildAiMessages：system 文案逐字', () => {
  it('continue：只输出续写内容本身', () => {
    const messages = buildAiMessages({ action: 'continue', text: 'x' });
    expect(messages[0]?.content).toBe(
      '你是中文写作助手。基于给定文本继续往下写，保持同一语气与体裁；只输出续写内容本身，不要解释、不要重复原文。',
    );
  });

  it('summarize：压缩为要点摘要', () => {
    const messages = buildAiMessages({ action: 'summarize', text: 'x' });
    expect(messages[0]?.content).toBe(
      '你是中文写作助手。把给定文本压缩为要点摘要，保留关键信息；只输出摘要本身。',
    );
  });

  it('rewrite：保持原意改写', () => {
    const messages = buildAiMessages({ action: 'rewrite', text: 'x' });
    expect(messages[0]?.content).toBe(
      '你是中文写作助手。在保持原意与信息量的前提下改写给定文本，使表达更清晰顺畅；只输出改写后的文本。',
    );
  });

  it('translate：默认目标语言 English', () => {
    const messages = buildAiMessages({ action: 'translate', text: 'x' });
    expect(messages[0]?.content).toBe(
      '你是中文翻译。把给定文本翻译为English，保持原有格式与换行；只输出译文。',
    );
  });

  it('translate：传入 targetLang 生效（日本語）', () => {
    const messages = buildAiMessages({ action: 'translate', text: 'x', targetLang: '日本語' });
    expect(messages[0]?.content).toContain('把给定文本翻译为日本語');
    expect(messages[0]?.content).not.toContain('English');
  });
});
