/**
 * ai-chat-context.test.ts —— AI 对话上下文装配/引用解析/隐私零外呼（TASK-T38-01 §3）。
 *
 * 覆盖：
 * 1) 多轮上下文装配：第 3 轮请求的 messages 里能看到第 1 轮的 user/assistant 原文
 *    （§1.1 的客户端前提）；system = 角色 + 引用规则 + 当前页上下文；
 * 2) 上下文预算：单块截断、总预算丢整块、历史上限（条数/字符）与 64 条/200k 硬门禁
 *    的客户端预收敛；
 * 3) 「附带选中内容」开关：开 → 选中文本注入；关 → 不注入；
 * 4) 引用解析：⟦#N⟧ 切分/解析/去重/未知 N 丢弃；
 * 5) **隐私硬不变量（§1.4）**：非本地端点 + 未 consent → AiService.chat 拒绝
 *    E_AI_CLOUD_DENIED，且 **fetch 调用次数 = 0**（打桩计数，报告贴数值）；
 *    装配结果本身也满足 ipc 层 64 条/200k 上限。
 */
import { describe, expect, it, vi } from 'vitest';
import type { CredentialStore } from '@septcats/platform';
import { AiService } from '../src/main/ai/service';
import {
  BLOCK_CHAR_LIMIT,
  CONTEXT_CHAR_BUDGET,
  HISTORY_TURN_LIMIT,
  assembleChatMessages,
  buildBlockIndex,
  buildContextText,
  parseCitations,
  resolveCitations,
  type PageChatContext,
} from '../src/renderer/src/ai/chatContext';
import {
  CHAT_HISTORY_LIMIT,
  appendMessages,
  makeChatMsg,
  type ChatMsg,
} from '../src/renderer/src/ai/chatState';
import type { AppSettings } from '../src/shared/settings';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function pageCtx(): PageChatContext {
  return {
    pageId: 'p1',
    pageTitle: '页A',
    blocks: [
      { id: 'b1', text: '第一块：项目结论是甲' },
      { id: 'b2', text: '第二块：数据口径是乙' },
      { id: 'b3', text: '第三块：待办是丙' },
    ],
    selectedText: '选中的句子',
  };
}

function turn(user: string, assistant: string): ChatMsg[] {
  return [makeChatMsg('user', user, 1), makeChatMsg('assistant', assistant, 2)];
}

// ---------------------------------------------------------------------------
// 块清单与上下文文本
// ---------------------------------------------------------------------------

describe('buildBlockIndex（编号 + 预算截断）', () => {
  it('块按顺序编号 1..N，n ↔ blockId 对齐', () => {
    const index = buildBlockIndex(pageCtx());
    expect(index.map((block) => block.n)).toEqual([1, 2, 3]);
    expect(index.map((block) => block.blockId)).toEqual(['b1', 'b2', 'b3']);
  });

  it('单块超 BLOCK_CHAR_LIMIT → 截断加省略号', () => {
    const long = '字'.repeat(BLOCK_CHAR_LIMIT + 500);
    const index = buildBlockIndex({ ...pageCtx(), blocks: [{ id: 'b1', text: long }] });
    expect(index[0]?.text.endsWith('…')).toBe(true);
    expect(index[0]?.text.length).toBe(BLOCK_CHAR_LIMIT + 1);
  });

  it('总预算 CONTEXT_CHAR_BUDGET：装不下的块整块丢弃（不出现半块）', () => {
    const per = 500; // < BLOCK_CHAR_LIMIT：不触发单块截断
    const blocks = Array.from({ length: 20 }, (_, i) => ({
      id: `b${String(i + 1)}`,
      text: 'x'.repeat(per),
    }));
    const index = buildBlockIndex({ ...pageCtx(), blocks });
    expect(index.length).toBe(Math.floor(CONTEXT_CHAR_BUDGET / per));
    expect(index.every((block) => block.text.length === per)).toBe(true);
    expect(index[index.length - 1]?.n).toBe(Math.floor(CONTEXT_CHAR_BUDGET / per));
  });

  it('null 上下文 → 空清单', () => {
    expect(buildBlockIndex(null)).toEqual([]);
  });
});

describe('buildContextText（标题/块清单/选中内容）', () => {
  it('含页名与 [N] 块清单', () => {
    const index = buildBlockIndex(pageCtx());
    const text = buildContextText(pageCtx(), index, { includeSelection: false });
    expect(text).toContain('页A');
    expect(text).toContain('[1] 第一块：项目结论是甲');
    expect(text).toContain('[3] 第三块：待办是丙');
    expect(text).not.toContain('选中的句子');
  });

  it('「附带选中内容」开 → 注入选中文本；无选区 → 不注入', () => {
    const index = buildBlockIndex(pageCtx());
    const withSelection = buildContextText(pageCtx(), index, { includeSelection: true });
    expect(withSelection).toContain('选中的句子');
    const noSelection = buildContextText(
      { ...pageCtx(), selectedText: null },
      index,
      { includeSelection: true },
    );
    expect(noSelection).not.toContain('选中的句子');
  });
});

// ---------------------------------------------------------------------------
// 多轮装配
// ---------------------------------------------------------------------------

describe('assembleChatMessages（多轮上下文）', () => {
  it('第 3 轮请求里能看到第 1 轮的结论（system + 历史 + 本轮提问）', () => {
    const history = [...turn('第一问：结论是什么？', '第一轮结论：甲。'), ...turn('第二问：口径呢？', '第二轮口径：乙。')];
    const messages = assembleChatMessages({
      history,
      contextText: '页A 的上下文',
      question: '第三问：把第 1 轮的结论展开',
    });
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('页A 的上下文');
    expect(messages.map((msg) => msg.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages[1]?.content).toBe('第一问：结论是什么？');
    expect(messages[2]?.content).toBe('第一轮结论：甲。');
    expect(messages[messages.length - 1]?.content).toBe('第三问：把第 1 轮的结论展开');
  });

  it('历史上限 HISTORY_TURN_LIMIT：只带最近 20 条历史', () => {
    const history: ChatMsg[] = [];
    for (let i = 0; i < 30; i++) {
      history.push(...turn(`问${String(i)}`, `答${String(i)}`));
    }
    const messages = assembleChatMessages({ history, contextText: null, question: '最新一问' });
    // system + 20 历史 + 1 提问
    expect(messages.length).toBe(HISTORY_TURN_LIMIT + 2);
    expect(messages[1]?.content).toBe('问20');
  });

  it('历史字符预算：超预算从最旧整轮丢弃，总量收敛', () => {
    const big = 'y'.repeat(20_000);
    const history: ChatMsg[] = [];
    for (let i = 0; i < 10; i++) {
      history.push(...turn(big, big));
    }
    const question = 'z'.repeat(1000);
    const messages = assembleChatMessages({ history, contextText: null, question });
    const total = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    expect(total).toBeLessThanOrEqual(60_000 + question.length + 100);
    expect(messages.length % 2).toBe(0); // system + 成对历史 + 提问 → 偶数
    expect(messages[1]?.role).toBe('user'); // 从整轮起点保留
  });

  it('装配结果满足 ipc 层硬门禁：≤64 条且总长 ≤200k', () => {
    const history: ChatMsg[] = [];
    for (let i = 0; i < 100; i++) {
      history.push(...turn(`问${String(i)}`, '答'.repeat(2000)));
    }
    const messages = assembleChatMessages({
      history,
      contextText: 'c'.repeat(8000),
      question: '最终问',
    });
    expect(messages.length).toBeLessThanOrEqual(64);
    const total = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    expect(total).toBeLessThanOrEqual(200_000);
  });
});

// ---------------------------------------------------------------------------
// 引用解析
// ---------------------------------------------------------------------------

describe('parseCitations / resolveCitations（⟦#N⟧ 出处标记）', () => {
  it('切分文本段与引用标记段', () => {
    const segments = parseCitations('结论甲⟦#2⟧，中段⟦#1⟧结尾');
    expect(segments).toEqual([
      { kind: 'text', value: '结论甲' },
      { kind: 'ref', n: 2 },
      { kind: 'text', value: '，中段' },
      { kind: 'ref', n: 1 },
      { kind: 'text', value: '结尾' },
    ]);
  });

  it('无标记 → 单一文本段', () => {
    expect(parseCitations('普通回答')).toEqual([{ kind: 'text', value: '普通回答' }]);
  });

  it('resolveCitations：n→blockId 映射、按 n 去重、未知 n 丢弃', () => {
    const index = buildBlockIndex(pageCtx());
    const refs = resolveCitations('甲⟦#1⟧ 又⟦#1⟧ 引⟦#3⟧ 野⟦#9⟧', index, 'p1', '页A');
    expect(refs).toEqual([
      { n: 1, pageId: 'p1', pageTitle: '页A', blockId: 'b1' },
      { n: 3, pageId: 'p1', pageTitle: '页A', blockId: 'b3' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 隐私硬不变量：非本地端点 + 未 consent → fetch 零调用
// ---------------------------------------------------------------------------

function makeFakeStore(): CredentialStore {
  return {
    async get(): Promise<string | null> {
      return null;
    },
    async set(): Promise<void> {
      /* no-op */
    },
    async delete(): Promise<boolean> {
      return true;
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

function cloudSettings(): AppSettings {
  return {
    theme: 'system',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' },
    sync: { enabled: false, encrypt: false, gc: false },
    ai: {
      enabled: true,
      cloudConsent: false,
      activeProviderId: 'cloud',
      providers: [
        {
          id: 'cloud',
          kind: 'openai-compatible',
          name: '云端',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-x',
        },
      ],
    },
  } as AppSettings;
}

describe('隐私硬不变量（TASK-T38-01 §1.4）', () => {
  it('非本地端点 + 未 consent：多轮装配结果走 AiService.chat → E_AI_CLOUD_DENIED，fetch 调用次数 = 0', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('MUST NOT BE CALLED');
    });
    const log = vi.fn();
    const service = new AiService({
      credentials: makeFakeStore(),
      getSettings: cloudSettings,
      fetchFn,
      log,
    });
    const ctx = pageCtx();
    const index = buildBlockIndex(ctx);
    const contextText = buildContextText(ctx, index, { includeSelection: true });
    const history = [...turn('第一问：结论是什么？', '第一轮结论：甲。⟦#1⟧'), ...turn('第二问：', '乙。')];
    const messages = assembleChatMessages({
      history,
      contextText,
      question: '第三问：再说说第 1 轮的结论',
    });

    await expect(service.chat({ providerId: 'cloud', messages })).rejects.toThrow(
      'E_AI_CLOUD_DENIED',
    );
    // 隐私断言数值：云门禁拒绝时 fetch 一次都未发
    expect(fetchFn).toHaveBeenCalledTimes(0);
    // 云门禁在网络栈之前同步拒绝：隐私日志连 op 行都不产生（更不会记消息正文）
    expect(log).toHaveBeenCalledTimes(0);
  });

  it('AI 关闭（enabled=false）：同样 fetch 零调用', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('MUST NOT BE CALLED');
    });
    const settings = cloudSettings();
    settings.ai.enabled = false;
    const service = new AiService({
      credentials: makeFakeStore(),
      getSettings: () => settings,
      fetchFn,
      log: () => {},
    });
    await expect(
      service.chat({ providerId: 'cloud', messages: [{ role: 'user', content: '你好' }] }),
    ).rejects.toThrow('E_AI_DISABLED');
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// 历史纯函数（上限/追加）
// ---------------------------------------------------------------------------

describe('appendMessages（历史上限纯函数）', () => {
  it('超出 CHAT_HISTORY_LIMIT 丢最旧', () => {
    const base: ChatMsg[] = [];
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 10; i++) {
      base.push(makeChatMsg('user', `m${String(i)}`, i));
    }
    const next = appendMessages([], base);
    expect(next.length).toBe(CHAT_HISTORY_LIMIT);
    expect(next[0]?.content).toBe('m10');
    expect(next[next.length - 1]?.content).toBe(`m${String(CHAT_HISTORY_LIMIT + 9)}`);
  });
});
