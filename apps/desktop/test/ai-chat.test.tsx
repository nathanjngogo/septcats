// @vitest-environment jsdom
/**
 * ai-chat.test.tsx —— AI 对话面板（TASK-T38-01 §3）。
 *
 * 覆盖：
 * 1) 历史持久化：按 workspace 隔离（septcats.aichat.history.<ws>）、上限 200 丢最旧、
 *    清空按钮生效、损坏/版本不符静默回落；不进账本（纯 localStorage）；
 * 2) 面板状态持久化：septcats.aichat.panel 开/关恢复；
 * 3) 多轮发送：ai.chat 收到 system+历史+提问；「附带选中内容」注入；
 * 4) 引用渲染：⟦#N⟧ → 「页名 › 块锚点」chip，点击 → jumpToBlock；
 * 5) 键盘：Enter 发送 / Shift+Enter 换行 / Esc 收起；
 * 6) 停止：busy 中点停止 → 迟到结果丢弃（不落 assistant）；
 * 7) 错误可读：E_AI_* 原文 role=alert；未启用/无 provider 引导 + 打开设置；
 * 8) **隐私（§1.4 renderer 面）**：非本地端点 + 未 consent 的拒绝流里
 *    window.fetch 调用次数 = 0（打桩计数），localStorage 全量不含密钥明文。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel, chatRefLabel } from '../src/renderer/src/ai/AiChatPanel';
import { setEditorChatProvider } from '../src/renderer/src/ai/chatBridge';
import type { PageChatContext } from '../src/renderer/src/ai/chatContext';
import {
  CHAT_HISTORY_PREFIX,
  PANEL_OPEN_KEY,
  aiChatActions,
  aiChatStore,
  makeChatMsg,
  readChatHistory,
  readPanelOpen,
} from '../src/renderer/src/ai/chatState';
import { pagesStore } from '../src/renderer/src/state/pages';
import type { SeptcatsApi } from '../src/types/window';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function resetStores(): void {
  localStorage.clear();
  aiChatStore.setState(() => ({ open: true, workspaceId: null, messages: [] }));
  pagesStore.setState((state) => ({ ...state, workspaceId: 'ws-1' }));
  setEditorChatProvider(null);
}

const AI_STATE_OK = {
  enabled: true,
  cloudConsent: false,
  activeProviderId: 'p1',
  // TASK-T46-01：AI 请求参数（未设置的旁路配置 → 生效超时 120s、不带 max_tokens）
  chatTimeoutSec: 120,
  maxOutputTokens: null,
  providers: [
    {
      id: 'p1',
      kind: 'lmstudio' as const,
      name: 'LM Studio',
      baseUrl: 'http://127.0.0.1:1234/v1',
      isLocal: true,
      hasKey: false,
      model: 'qwen2.5-7b',
    },
  ],
};

function installBridge(ai: Partial<SeptcatsApi['ai']> = {}): void {
  vi.stubGlobal('septcats', {
    ai: {
      state: vi.fn(async () => AI_STATE_OK),
      chat: vi.fn(async () => ({ text: '回复全文', model: 'qwen2.5-7b' })),
      listModels: vi.fn(async () => ({ models: [], cached: false, fetchedAt: 0 })),
      setKey: vi.fn(async () => ({ ok: true as const })),
      clearKey: vi.fn(async () => ({ ok: true as const })),
      ...ai,
    },
  } as unknown as SeptcatsApi);
}

function editorCtx(): PageChatContext {
  return {
    pageId: 'p1',
    pageTitle: '页A',
    blocks: [
      { id: 'b1', text: '第一块：结论甲' },
      { id: 'b2', text: '第二块：口径乙' },
    ],
    selectedText: '选中的句子',
  };
}

function installEditorProvider(jumpToBlock: (blockId: string) => void = () => {}): void {
  setEditorChatProvider({
    pageId: 'p1',
    getPageContext: editorCtx,
    jumpToBlock,
  });
}

function typeAndSend(text: string, shift = false): void {
  const input = document.querySelector('.ai-chat__input') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: shift });
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1) 历史持久化
// ---------------------------------------------------------------------------

describe('历史持久化（按 workspace 隔离，上限 200）', () => {
  it('追加消息写 localStorage，readChatHistory 逐字还原', () => {
    aiChatActions.setWorkspace('ws-1');
    aiChatActions.appendMessages([makeChatMsg('user', '第一问', 111)]);
    aiChatActions.appendMessages([makeChatMsg('assistant', '第一答', 222)]);
    const stored = readChatHistory('ws-1');
    expect(stored).not.toBeNull();
    expect(stored?.map((msg) => [msg.role, msg.content, msg.ts])).toEqual([
      ['user', '第一问', 111],
      ['assistant', '第一答', 222],
    ]);
  });

  it('workspace 隔离：ws-2 读不到 ws-1 的历史；切回 ws-1 历史还原', () => {
    aiChatActions.setWorkspace('ws-1');
    aiChatActions.appendMessages([makeChatMsg('user', '只有 ws-1 有', 1)]);
    expect(readChatHistory('ws-2')).toBeNull();
    aiChatActions.setWorkspace('ws-2');
    expect(aiChatStore.getState().messages).toEqual([]);
    aiChatActions.setWorkspace('ws-1');
    expect(aiChatStore.getState().messages.map((msg) => msg.content)).toEqual(['只有 ws-1 有']);
  });

  it('上限 200：超出丢最旧（store 与持久层一致）', () => {
    aiChatActions.setWorkspace('ws-1');
    const batch = Array.from({ length: 210 }, (_, i) => makeChatMsg('user', `m${String(i)}`, i));
    aiChatActions.appendMessages(batch);
    expect(aiChatStore.getState().messages.length).toBe(200);
    expect(aiChatStore.getState().messages[0]?.content).toBe('m10');
    const stored = readChatHistory('ws-1');
    expect(stored?.length).toBe(200);
    expect(stored?.[0]?.content).toBe('m10');
  });

  it('清空：store 清空且存储键移除', () => {
    aiChatActions.setWorkspace('ws-1');
    aiChatActions.appendMessages([makeChatMsg('user', '待清空', 1)]);
    aiChatActions.clearMessages();
    expect(aiChatStore.getState().messages).toEqual([]);
    expect(readChatHistory('ws-1')).toBeNull();
    expect(localStorage.getItem(`${CHAT_HISTORY_PREFIX}ws-1`)).toBeNull();
  });

  it('损坏/版本不符 → null（调用方走无记录分支）', () => {
    localStorage.setItem(`${CHAT_HISTORY_PREFIX}ws-bad`, '{broken json');
    expect(readChatHistory('ws-bad')).toBeNull();
    localStorage.setItem(
      `${CHAT_HISTORY_PREFIX}ws-v0`,
      JSON.stringify({ v: 0, messages: [] }),
    );
    expect(readChatHistory('ws-v0')).toBeNull();
  });

  it('清空按钮（confirm=true）清空当前历史', () => {
    aiChatActions.setWorkspace('ws-1');
    aiChatActions.appendMessages([makeChatMsg('user', '待清空', 1)]);
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<AiChatPanel />);
    fireEvent.click(screen.getByRole('button', { name: '清空历史' }));
    expect(aiChatStore.getState().messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2) 面板状态持久化
// ---------------------------------------------------------------------------

describe('面板状态持久化（收起 → 重启 → 仍收起）', () => {
  it('setOpen 写 septcats.aichat.panel，readPanelOpen 还原', () => {
    aiChatActions.setOpen(true);
    expect(readPanelOpen()).toBe(true);
    expect(localStorage.getItem(PANEL_OPEN_KEY)).toBe('1');
    aiChatActions.setOpen(false);
    expect(readPanelOpen()).toBe(false);
    expect(localStorage.getItem(PANEL_OPEN_KEY)).toBe('0');
  });

  it('initPanel：启动时从 localStorage 恢复开合', () => {
    localStorage.setItem(PANEL_OPEN_KEY, '1');
    aiChatActions.initPanel();
    expect(aiChatStore.getState().open).toBe(true);
    localStorage.setItem(PANEL_OPEN_KEY, '0');
    aiChatActions.initPanel();
    expect(aiChatStore.getState().open).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3) 多轮发送装配 + 3.5) 引用渲染
// ---------------------------------------------------------------------------

type ChatCall = {
  providerId: string;
  messages: Array<{ role: string; content: string }>;
};

describe('多轮发送（上下文注入 + 引用 chip 可跳转）', () => {
  it('ai.chat 收到 system+历史+提问；「附带选中内容」默认注入；引用 chip 渲染并可点击跳转', async () => {
    const jumpToBlock = vi.fn();
    installEditorProvider(jumpToBlock);
    const chat = vi.fn(async (_input: ChatCall) => ({ text: '依据页面⟦#2⟧得出。', model: 'qwen2.5-7b' }));
    installBridge({ chat });

    const { rerender } = render(<AiChatPanel />);
    rerender(<AiChatPanel />);
    typeAndSend('第一问：口径是什么？');
    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(1);
    });
    const firstCall = chat.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.providerId).toBe('p1');
    const roles = (firstCall?.messages ?? []).map((msg) => msg.role);
    expect(roles[0]).toBe('system');
    expect(roles[roles.length - 1]).toBe('user');
    // 上下文 = 当前页：标题 + 块清单 + 选中文本
    const system = firstCall?.messages[0]?.content ?? '';
    expect(system).toContain('页A');
    expect(system).toContain('[1] 第一块：结论甲');
    expect(system).toContain('选中的句子');

    // 引用 chip：页名 › 块锚点，可点击跳转
    const chip = screen.getByRole('button', { name: '页A › 块2' });
    fireEvent.click(chip);
    expect(jumpToBlock).toHaveBeenCalledWith('b2');

    // 第二轮：历史带上了第一轮的 user/assistant 原文（多轮上下文）
    typeAndSend('第二问：再说说口径');
    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(2);
    });
    const secondMessages = (chat.mock.calls[1]?.[0] as ChatCall | undefined)?.messages ?? [];
    const contents = secondMessages.map((msg) => msg.content);
    expect(contents).toContain('第一问：口径是什么？');
    expect(contents).toContain('依据页面⟦#2⟧得出。');
    expect(contents[contents.length - 1]).toBe('第二问：再说说口径');
  });

  it('「附带选中内容」关闭 → system 不含选中文本', async () => {
    installEditorProvider();
    installBridge();
    render(<AiChatPanel />);
    const toggle = screen.getByLabelText('附带选中内容') as HTMLInputElement;
    fireEvent.click(toggle);
    typeAndSend('问');
    const chat = vi.mocked((window as unknown as { septcats: SeptcatsApi }).septcats.ai.chat);
    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(1);
    });
    const system = ((chat.mock.calls[0] as unknown as [ChatCall] | undefined)?.[0]?.messages[0]
      ?.content ?? '');
    expect(system).not.toContain('选中的句子');
  });

  it('未知块编号的标记原样保留（不静默改写 AI 输出）', async () => {
    installEditorProvider();
    const chat = vi.fn(async () => ({ text: '野标记⟦#9⟧保留', model: 'm' }));
    installBridge({ chat });
    render(<AiChatPanel />);
    typeAndSend('问');
    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('⟦#9⟧')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4) 键盘
// ---------------------------------------------------------------------------

describe('键盘（Enter 发送 / Shift+Enter 换行 / Esc 收起）', () => {
  it('Enter 发送；Shift+Enter 换行不发送', async () => {
    installEditorProvider();
    const chat = vi.fn(async () => ({ text: '答', model: 'm' }));
    installBridge({ chat });
    render(<AiChatPanel />);
    const input = document.querySelector('.ai-chat__input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '第一行' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(chat).not.toHaveBeenCalled();
    // jsdom 不做按键默认插入：断言未发送且草稿未被发送流程清空
    expect((input as HTMLTextAreaElement).value).toBe('第一行');
    fireEvent.change(input, { target: { value: '正式问题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(1);
    });
  });

  it('Esc 收起面板（open 持久化为 false）', () => {
    installEditorProvider();
    installBridge();
    render(<AiChatPanel />);
    const aside = document.querySelector('.ai-chat') as HTMLElement;
    fireEvent.keyDown(aside, { key: 'Escape' });
    expect(aiChatStore.getState().open).toBe(false);
    expect(readPanelOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5) 停止
// ---------------------------------------------------------------------------

describe('生成中停止（迟到结果丢弃）', () => {
  it('busy 中点停止 → busy 消失；迟到的回复不落历史，用户消息保留', async () => {
    installEditorProvider();
    const deferred: { resolve?: (value: { text: string; model: string }) => void } = {};
    const chat = vi.fn(
      () =>
        new Promise<{ text: string; model: string }>((resolve) => {
          deferred.resolve = resolve;
        }),
    );
    installBridge({ chat });
    render(<AiChatPanel />);
    typeAndSend('会卡住的问题');
    await waitFor(() => {
      expect(screen.getAllByText('生成中…').length).toBeGreaterThan(0);
    });
    expect(chat).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('button', { name: '停止' })[0] as HTMLElement);
    expect(screen.queryByText('生成中…')).toBeNull();
    // 迟到结果到达：不落 assistant 消息
    deferred.resolve?.({ text: '迟到回复', model: 'm' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const messages = aiChatStore.getState().messages;
    expect(messages.map((msg) => msg.role)).toEqual(['user']);
    expect(messages[0]?.content).toBe('会卡住的问题');
    expect(screen.queryByText('迟到回复')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6) 门控与错误
// ---------------------------------------------------------------------------

describe('门控与错误（复用既有 AI 错误口径）', () => {
  it('未启用 → 引导文案 + 打开设置，不发 chat', async () => {
    installBridge({ state: vi.fn(async () => ({ ...AI_STATE_OK, enabled: false })) });
    render(<AiChatPanel />);
    typeAndSend('问');
    await waitFor(() => {
      expect(screen.getByText('AI 功能尚未启用（设置 → AI 助手）')).toBeTruthy();
    });
    const chat = vi.mocked((window as unknown as { septcats: SeptcatsApi }).septcats.ai.chat);
    expect(chat).not.toHaveBeenCalled();
    expect(screen.getByText('打开设置')).toBeTruthy();
  });

  it('无 provider → 引导文案', async () => {
    installBridge({
      state: vi.fn(async () => ({ ...AI_STATE_OK, providers: [], activeProviderId: null })),
    });
    render(<AiChatPanel />);
    typeAndSend('问');
    await waitFor(() => {
      expect(screen.getByText('还没有配置模型服务（设置 → AI 助手）')).toBeTruthy();
    });
  });

  it('E_AI_* 错误 role=alert 原文呈现', async () => {
    installBridge({ chat: vi.fn(async () => {
      throw new Error('E_AI_UNREACHABLE：端点不可达');
    }) });
    render(<AiChatPanel />);
    typeAndSend('问');
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('E_AI_UNREACHABLE：端点不可达');
    });
  });
});

// ---------------------------------------------------------------------------
// 7) 隐私（renderer 面）
// ---------------------------------------------------------------------------

describe('隐私（TASK-T38-01 §1.4 renderer 面）', () => {
  it('云拒绝流（E_AI_CLOUD_DENIED）：window.fetch 调用次数 = 0；localStorage 不含密钥', async () => {
    installEditorProvider();
    installBridge({
      chat: vi.fn(async () => {
        throw new Error('E_AI_CLOUD_DENIED：非本地端点需要先开启「允许云端模型」');
      }),
    });
    const fetchSpy = vi.fn(async () => {
      throw new Error('MUST NOT BE CALLED');
    });
    vi.stubGlobal('fetch', fetchSpy);

    render(<AiChatPanel />);
    typeAndSend('走云端的问题');
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('E_AI_CLOUD_DENIED');
    });
    // 隐私断言数值：fetch 调用次数 = 0
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    // localStorage 全量不含密钥明文（消息历史只有对话文本，密钥只进 CredentialStore）
    const allStorage = JSON.stringify(window.localStorage);
    expect(allStorage).not.toContain('sk-');
    expect(allStorage).not.toContain('Bearer');
  });
});

// ---------------------------------------------------------------------------
// 8) TASK-T46-01：空正文/纯推理/length/超时 的可读呈现 + max_tokens
// ---------------------------------------------------------------------------

describe('回复健壮性（TASK-T46-01 §1.2/§1.3/§1.4）', () => {
  const REASONING = '先看第一块：结论甲。再核对第二块：口径乙。';

  it('纯推理响应（content 空 + reasoning_content + finish_reason=length）：提示文案 + 折叠区默认收起可展开 + 无空白气泡', async () => {
    installEditorProvider();
    installBridge({
      chat: vi.fn(async () => ({
        text: '',
        model: 'qwen2.5-7b',
        reasoningContent: REASONING,
        finishReason: 'length',
      })),
    });
    render(<AiChatPanel />);
    typeAndSend('本页讲了什么？');

    await waitFor(() => {
      expect(screen.getByText('模型未返回正文（仅推理内容）')).toBeTruthy();
    });
    // ③ finish_reason=length 提示
    expect(screen.getByText('达到输出上限，可增大 max_tokens 或重试')).toBeTruthy();
    // 无空白气泡：assistant 气泡可见文本非空
    const bubble = document.querySelector('.ai-chat__bubble--assistant');
    expect((bubble?.textContent ?? '').length).toBeGreaterThan(0);
    expect(bubble?.textContent).toContain('模型未返回正文（仅推理内容）');
    // ② 折叠区默认收起（正文不在 DOM）
    expect(document.querySelector('.ai-chat__reasoning-body')).toBeNull();
    const toggle = document.querySelector('.ai-chat__reasoning-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.textContent).toBe(`查看推理内容（${String(REASONING.length)} 字符）`);
    // 点开 → 推理原文可见 + aria-expanded=true
    fireEvent.click(toggle as HTMLElement);
    await waitFor(() => {
      const body = document.querySelector('.ai-chat__reasoning-body');
      expect(body?.textContent).toBe('先看第一块：结论甲。再核对第二块：口径乙。');
      expect(document.querySelector('.ai-chat__reasoning-toggle')?.getAttribute('aria-expanded')).toBe('true');
    });
    // 折叠态可逆
    fireEvent.click(document.querySelector('.ai-chat__reasoning-toggle') as HTMLElement);
    await waitFor(() => {
      expect(document.querySelector('.ai-chat__reasoning-body')).toBeNull();
    });
    // 历史落盘：reasoning / finishReason 随消息保存（重启可还原折叠区）
    const stored = readChatHistory('ws-1');
    const last = stored?.[stored.length - 1];
    expect(last?.content).toBe('');
    expect(last?.reasoning).toContain('结论甲');
    expect(last?.finishReason).toBe('length');
  });

  it('空正文且无推理内容：给「未返回正文」提示（不渲染空白气泡）', async () => {
    installBridge({
      chat: vi.fn(async () => ({ text: '   ', model: 'qwen2.5-7b' })),
    });
    render(<AiChatPanel />);
    typeAndSend('问');

    await waitFor(() => {
      expect(screen.getByText('模型未返回正文（可重试，或调大「最大输出 tokens」）')).toBeTruthy();
    });
    expect(document.querySelector('.ai-chat__reasoning')).toBeNull();
    const bubble = document.querySelector('.ai-chat__bubble--assistant');
    expect(bubble?.textContent).toContain('模型未返回正文');
  });

  it('正常正文 + length：正文照常渲染，另加「达到输出上限」提示', async () => {
    installBridge({
      chat: vi.fn(async () => ({
        text: '这是被截断的半句',
        model: 'qwen2.5-7b',
        finishReason: 'length',
      })),
    });
    render(<AiChatPanel />);
    typeAndSend('问');

    await waitFor(() => {
      expect(document.querySelector('.ai-chat__bubble--assistant')?.textContent).toContain(
        '这是被截断的半句',
      );
    });
    expect(screen.getByText('达到输出上限，可增大 max_tokens 或重试')).toBeTruthy();
    expect(screen.queryByText('模型未返回正文（仅推理内容）')).toBeNull();
  });

  it('E_AI_TIMEOUT：文案「等待超过 N 秒已中止」+ 调大指引（不焯错误码）', async () => {
    installBridge({
      state: vi.fn(async () => ({ ...AI_STATE_OK, chatTimeoutSec: 5 })),
      chat: vi.fn(async () => {
        throw new Error('E_AI_TIMEOUT：等待超过 5 秒已中止（127.0.0.1:3599）');
      }),
    });
    render(<AiChatPanel />);
    typeAndSend('慢问题');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('等待超过 5 秒已中止');
    });
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toBe(
      '请求超时：等待超过 5 秒已中止（127.0.0.1:3599） 可在设置 › AI 助手中调大「请求超时」（当前 5 秒）。',
    );
    expect(alert).toContain('可在设置 › AI 助手中调大「请求超时」');
  });

  it('非超时错误不被改写（E_AI_UNREACHABLE 走既有 errorText 口径）', async () => {
    installBridge({
      chat: vi.fn(async () => {
        throw new Error('E_AI_UNREACHABLE：端点不可达：fetch failed');
      }),
    });
    render(<AiChatPanel />);
    typeAndSend('问');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'E_AI_UNREACHABLE：端点不可达：fetch failed',
      );
    });
  });

  it('max_tokens：设置里配了才带（未设置 = 请求不带该字段）', async () => {
    const chat = vi.fn(async (_input: Record<string, unknown>) => ({ text: '回复', model: 'qwen2.5-7b' }));
    installBridge({ state: vi.fn(async () => ({ ...AI_STATE_OK, maxOutputTokens: 800 })), chat });
    render(<AiChatPanel />);
    typeAndSend('问');
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    expect(chat.mock.calls[0]?.[0]).toMatchObject({ maxTokens: 800 });

    cleanup();
    aiChatStore.setState(() => ({ open: true, workspaceId: 'ws-1', messages: [] }));
    const chat2 = vi.fn(async (_input: Record<string, unknown>) => ({ text: '回复', model: 'qwen2.5-7b' }));
    installBridge({ chat: chat2 });
    render(<AiChatPanel />);
    typeAndSend('问');
    await waitFor(() => expect(chat2).toHaveBeenCalledTimes(1));
    const arg = chat2.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg['maxTokens']).toBeUndefined();
  });

  it('超长推理正文落盘时截断（localStorage 体量可控）', async () => {
    installEditorProvider();
    installBridge({
      chat: vi.fn(async () => ({
        text: '',
        model: 'qwen2.5-7b',
        reasoningContent: '推'.repeat(5_000),
      })),
    });
    render(<AiChatPanel />);
    typeAndSend('问');
    await waitFor(() => {
      expect(screen.getByText('模型未返回正文（仅推理内容）')).toBeTruthy();
    });
    const stored = readChatHistory('ws-1');
    const last = stored?.[stored.length - 1];
    expect(last?.reasoning?.length).toBe(4_000 + '…（推理内容较长，此处仅保留前 4000 字符）'.length);
    expect(last?.reasoning?.startsWith('推'.repeat(10))).toBe(true);
    expect(last?.reasoning?.endsWith('…（推理内容较长，此处仅保留前 4000 字符）')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

describe('chatRefLabel', () => {
  it('「页名 › 块N」', () => {
    expect(chatRefLabel({ n: 2, pageId: 'p1', pageTitle: '页A', blockId: 'b2' })).toBe('页A › 块2');
  });
});
