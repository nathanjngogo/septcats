// @vitest-environment jsdom
/**
 * dbview-ai.test.tsx —— AI 属性列桥流程（TASK-T18-04 §3）。
 *
 * 假桥（vi.stubGlobal septcats：ai.state / ai.chat / db.recordUpdate / db.propUpdate spy）
 * 直挂 DbPage，断言：
 * - 单行生成：chat 收到 system=列指令、user=逐列「列名：值」（跳过空值与 AI 列自身），
 *   recordUpdate 收到生成文本（trim 后写入）；
 * - hasKey 语义：云端 provider 未设密钥 → 不调 chat，出 needProvider 引导；
 * - 未启用 → 不调 chat 且出 needEnable 引导（隐私/成本不变量）；
 * - 批量：确认弹窗明示条数 → 串行逐行 → 失败行跳过并计数 toast（结果写值只落成功行）；
 * - 批量门控：未启用连确认弹窗都不出；
 * - 指令提交：propUpdate 收到 ai:{prompt} patch。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectionEntitySchema,
  collectionSchemaSchema,
  defaultView,
  propertySchema,
} from '@septcats/dbview';
import type { CollectionEntity, RecordEntity } from '@septcats/dbview';
import { DbPage } from '../src/renderer/src/db/DbPage';
import { pagesStore } from '../src/renderer/src/state/pages';
import type { SeptcatsApi } from '../src/types/window';

const PAGE_ID = 'pg-ai-1';
const TITLE_PID = 'p_title';
const NOTE_PID = 'p_note';
const AI_PID = 'p_ai';

const SCHEMA = collectionSchemaSchema.parse({
  properties: {
    [TITLE_PID]: propertySchema.parse({ id: TITLE_PID, name: '书名', type: 'text' }),
    [NOTE_PID]: propertySchema.parse({ id: NOTE_PID, name: '备注', type: 'text' }),
    [AI_PID]: propertySchema.parse({
      id: AI_PID,
      name: '摘要',
      type: 'ai',
      ai: { prompt: '用一句话概括本行' },
    }),
  },
  title_pid: TITLE_PID,
});

function makeRecord(id: string, title: string, note: string, sortKey: string): RecordEntity {
  return {
    id,
    collection_id: 'col-ai',
    workspace_id: 'ws-test',
    values: { [TITLE_PID]: title, [NOTE_PID]: note },
    sort_key: sortKey,
    alive: 1,
    version: 1,
  };
}

const RECORDS: RecordEntity[] = [
  makeRecord('rec-1', '哥德尔、艾舍尔、巴赫', '认知科学经典', 'A1'),
  makeRecord('rec-2', '时间简史', '科普畅销书', 'A2'),
];

const COLLECTION: CollectionEntity = collectionEntitySchema.parse({
  id: 'col-ai',
  page_id: PAGE_ID,
  workspace_id: 'ws-test',
  name: 'AI 验收库',
  schema: SCHEMA,
  views: [defaultView('v1', '表格')],
  alive: 1,
  version: 1,
});

/** 同形状但 ai 列未配指令（默认指令回落路径用）。 */
const SCHEMA_NO_PROMPT = collectionSchemaSchema.parse({
  properties: {
    [TITLE_PID]: propertySchema.parse({ id: TITLE_PID, name: '书名', type: 'text' }),
    [NOTE_PID]: propertySchema.parse({ id: NOTE_PID, name: '备注', type: 'text' }),
    [AI_PID]: propertySchema.parse({ id: AI_PID, name: '摘要', type: 'ai' }),
  },
  title_pid: TITLE_PID,
});

const COLLECTION_NO_PROMPT: CollectionEntity = collectionEntitySchema.parse({
  ...COLLECTION,
  schema: SCHEMA_NO_PROMPT,
});

type AiState = {
  enabled: boolean;
  cloudConsent: boolean;
  activeProviderId: string | null;
  providers: Array<{
    id: string;
    kind: 'lmstudio' | 'ollama' | 'openai-compatible';
    name: string;
    baseUrl: string;
    isLocal: boolean;
    hasKey: boolean;
    model: string | null;
  }>;
};

function enabledState(overrides: Partial<AiState> = {}): AiState {
  return {
    enabled: true,
    cloudConsent: false,
    activeProviderId: 'prov-1',
    providers: [
      { id: 'prov-1', kind: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234', isLocal: true, hasKey: false, model: 'mock-model' },
    ],
    ...overrides,
  };
}

interface Bridge {
  recordUpdate: ReturnType<typeof vi.fn>;
  propUpdate: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
  state: ReturnType<typeof vi.fn>;
}

function installBridge(overrides: Partial<Record<string, unknown>> = {}): Bridge {
  const bridge: Record<string, unknown> = {
    recordUpdate: vi.fn(async () => ({ ok: true })),
    propUpdate: vi.fn(async () => ({ ok: true })),
    state: vi.fn(async () => enabledState()),
    chat: vi.fn(async () => ({ text: 'AI 生成结果', model: 'mock-model' })),
  };
  const api = {
    ping: vi.fn(),
    appMeta: vi.fn(),
    db: {
      load: vi.fn(async () => ({ collection: COLLECTION, records: RECORDS })),
      create: vi.fn(),
      recordCreate: vi.fn(),
      recordUpdate: bridge.recordUpdate,
      recordDelete: vi.fn(),
      propAdd: vi.fn(),
      propRemove: vi.fn(),
      propUpdate: bridge.propUpdate,
      viewSave: vi.fn(),
      rename: vi.fn(),
      relationSearch: vi.fn(),
      exportCsv: vi.fn(),
    },
    ai: {
      state: bridge.state,
      listModels: vi.fn(),
      chat: bridge.chat,
      setKey: vi.fn(),
      clearKey: vi.fn(),
    },
    ...overrides,
  };
  vi.stubGlobal('septcats', api as unknown as SeptcatsApi);
  return bridge as unknown as Bridge;
}

async function renderPage(): Promise<void> {
  render(<DbPage pageId={PAGE_ID} />);
  await screen.findByText('AI 验收库');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  pagesStore.setState((state) => ({ ...state, toasts: [] }));
});

beforeEach(() => {
  pagesStore.setState((state) => ({ ...state, toasts: [] }));
});

describe('AI 属性列 · 单行生成', () => {
  it('chat 收到 system=列指令 + user=逐列上下文（跳过 AI 列自身）；recordUpdate 写入 trim 后文本', async () => {
    const bridge = installBridge();
    bridge.chat.mockResolvedValue({ text: '  这是一段生成的摘要。  ', model: 'mock-model' });
    await renderPage();

    const buttons = screen.getAllByRole('button', { name: 'AI 生成' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0] as HTMLButtonElement);

    await waitFor(() => expect(bridge.recordUpdate).toHaveBeenCalledTimes(1));
    expect(bridge.recordUpdate).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      recordId: 'rec-1',
      patch: { [AI_PID]: '这是一段生成的摘要。' },
    });
    expect(bridge.chat).toHaveBeenCalledTimes(1);
    const call = bridge.chat.mock.calls[0]?.[0] as {
      providerId: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.providerId).toBe('prov-1');
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0]).toEqual({ role: 'system', content: '用一句话概括本行' });
    // 逐列「列名：值」、跳过 AI 列自身与空值
    expect(call.messages[1]).toEqual({
      role: 'user',
      content: '书名：哥德尔、艾舍尔、巴赫\n备注：认知科学经典',
    });
  });

  it('列未配指令 → system 回落默认指令（§0.4）', async () => {
    const bridge = installBridge({
      db: {
        load: vi.fn(async () => ({ collection: COLLECTION_NO_PROMPT, records: RECORDS })),
        recordUpdate: vi.fn(async () => ({ ok: true })),
        propUpdate: vi.fn(async () => ({ ok: true })),
      },
    });
    bridge.chat.mockResolvedValue({ text: '默认指令产物', model: 'mock-model' });
    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'AI 生成' })[0] as HTMLButtonElement);
    await waitFor(() => expect(bridge.chat).toHaveBeenCalledTimes(1));
    const call = bridge.chat.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]).toEqual({
      role: 'system',
      content: '根据该记录各列的内容，用简洁的中文给出这一列的值；只输出结果本身。',
    });
  });

  it('未启用 → 不调 chat 且出 needEnable 引导（成本/隐私不变量）', async () => {
    const bridge = installBridge();
    bridge.state.mockResolvedValue(enabledState({ enabled: false }));
    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'AI 生成' })[0] as HTMLButtonElement);
    await screen.findByRole('status');
    expect(screen.getByRole('status').textContent).toBe('AI 未启用（设置 → AI 助手）');
    expect(bridge.chat).not.toHaveBeenCalled();
    expect(bridge.recordUpdate).not.toHaveBeenCalled();
  });

  it('hasKey 语义：云端 provider 未设密钥 → 视同未配置，不调 chat', async () => {
    const bridge = installBridge();
    bridge.state.mockResolvedValue(
      enabledState({
        providers: [
          { id: 'prov-1', kind: 'openai-compatible', name: '云', baseUrl: 'https://api.x.test', isLocal: false, hasKey: false, model: 'm' },
        ],
      }),
    );
    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'AI 生成' })[0] as HTMLButtonElement);
    await screen.findByRole('status');
    expect(screen.getByRole('status').textContent).toBe('未配置模型服务（设置 → AI 助手）');
    expect(bridge.chat).not.toHaveBeenCalled();
    expect(bridge.recordUpdate).not.toHaveBeenCalled();
  });

  it('chat 失败 → 行内错误引导，不写值', async () => {
    const bridge = installBridge();
    bridge.chat.mockRejectedValue(new Error('E_AI_UNREACHABLE：端点不可达'));
    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'AI 生成' })[0] as HTMLButtonElement);
    await screen.findByRole('status');
    expect(screen.getByRole('status').textContent).toBe('生成失败：E_AI_UNREACHABLE：端点不可达');
    expect(bridge.recordUpdate).not.toHaveBeenCalled();
  });
});

describe('AI 属性列 · 批量生成', () => {
  it('确认弹窗明示条数 → 串行逐行 → 失败行跳过 + 计数 toast', async () => {
    const bridge = installBridge();
    bridge.chat.mockImplementation(async (input: { messages: Array<{ role: string; content: string }> }) => {
      const user = input.messages[1]?.content ?? '';
      if (user.includes('时间简史')) {
        throw new Error('E_AI_TIMEOUT：超时');
      }
      return { text: '第一行的摘要', model: 'mock-model' };
    });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '属性管理：摘要' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '批量生成' }));
    // 弹窗明示条数（当前视图 2 行；门控异步 → findBy）
    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(screen.getByText('将对当前视图前 2 条记录调用模型（每条约 1 次请求）。继续？')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(bridge.chat).toHaveBeenCalledTimes(2));
    // 失败行跳过：只有 rec-1 写值
    await waitFor(() => expect(bridge.recordUpdate).toHaveBeenCalledTimes(1));
    expect(bridge.recordUpdate).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      recordId: 'rec-1',
      patch: { [AI_PID]: '第一行的摘要' },
    });
    // 串行：rec-1 之后才轮到 rec-2（两行 user 上下文按行拼接）
    const firstUser = (bridge.chat.mock.calls[0]?.[0] as { messages: Array<{ content: string }> }).messages[1]?.content;
    expect(firstUser).toContain('哥德尔、艾舍尔、巴赫');
    // 结果计数 toast
    await waitFor(() => expect(pagesStore.getState().toasts.length).toBe(1));
    expect(pagesStore.getState().toasts[0]?.message).toBe('完成 1 条，失败 1 条');
  });

  it('未启用 → 批量入口直接引导（确认弹窗不出、chat 不调）', async () => {
    const bridge = installBridge();
    bridge.state.mockResolvedValue(enabledState({ enabled: false }));
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '属性管理：摘要' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '批量生成' }));
    expect(await screen.findByRole('status').then((node) => node.textContent)).toBe('AI 未启用（设置 → AI 助手）');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bridge.chat).not.toHaveBeenCalled();
  });
});

describe('AI 属性列 · 生成指令', () => {
  it('「编辑生成指令」提交 → propUpdate 收到 ai:{prompt} patch', async () => {
    const bridge = installBridge();
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '属性管理：摘要' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑生成指令' }));
    const textarea = screen.getByLabelText('生成指令') as HTMLTextAreaElement;
    expect(textarea.value).toBe('用一句话概括本行');
    fireEvent.change(textarea, { target: { value: '新指令：三句话概括' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(bridge.propUpdate).toHaveBeenCalledTimes(1));
    expect(bridge.propUpdate).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      pid: AI_PID,
      patch: { ai: { prompt: '新指令：三句话概括' } },
    });
  });
});
