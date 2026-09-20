/**
 * ai-service.test.ts —— AiService 门禁/凭据/缓存/日志（TASK-T18-01 §3，假依赖注入）。
 *
 * 覆盖（隐私硬不变量加粗）：
 * 1) enabled:false → 所有网络方法 E_AI_DISABLED 且 fetch 零调用；
 * 2) 未知 providerId → E_AI_NO_PROVIDER；
 * 3) **非本地 + 无 consent → E_AI_CLOUD_DENIED 且 fetchFn 零调用**；同 provider 开 consent 放行；
 * 4) model:null 的 chat → E_AI_NO_MODEL；
 * 5) listModels 二次调用 cached:true 且 fetch 只 1 次；refresh:true 再拉（fetch 2 次）；
 * 6) setKey 后 hasKey===true；clearKey 后 false；**state 返回值 JSON 不含密钥明文**；
 * 7) chat 把 provider 配置正确透传到 client（假 fetch 断言 host/model/消息体）。
 */
import { describe, expect, it } from 'vitest';
import type { CredentialStore } from '@septcats/platform';
import type { AiFetchResponse } from '../src/main/ai/client';
import { DEFAULT_CHAT_TIMEOUT_MS } from '../src/main/ai/client';
import { serializeAiChatConfig, type AiChatRuntimeConfig } from '../src/main/ai/chatConfig';
import { AiChatConfigStore } from '../src/main/ai/chatConfigStore';
import { AiService } from '../src/main/ai/service';
import type { AppSettings } from '../src/shared/settings';
import type { AiMessage } from '../src/shared/ai';

/** 内存假 CredentialStore（照 sync-keyring 测试范式）。 */
function makeFakeStore(): CredentialStore & { secrets: Map<string, string> } {
  const secrets = new Map<string, string>();
  return {
    secrets,
    async get(service: string, account: string): Promise<string | null> {
      return secrets.get(`${service}|${account}`) ?? null;
    },
    async set(service: string, account: string, secret: string): Promise<void> {
      secrets.set(`${service}|${account}`, secret);
    },
    async delete(service: string, account: string): Promise<boolean> {
      return secrets.delete(`${service}|${account}`);
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

type FakeFetch = ConstructorParameters<typeof AiService>[0]['fetchFn'];

/** 假 fetch：记录每次调用；优先回放显式队列，队列耗尽后按 URL 分派样例响应。 */
function makeFetch(responses: Array<AiFetchResponse | Error> = []): {
  fetchFn: FakeFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchFn: FakeFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (next !== undefined) {
      return next;
    }
    if (url.endsWith('/v1/models')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '回复全文' } }] }),
    };
  };
  return { fetchFn, calls };
}

const LOCAL_PROVIDER = {
  id: 'local',
  kind: 'lmstudio' as const,
  name: 'LM Studio',
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'qwen2.5-7b',
};

const CLOUD_PROVIDER = {
  id: 'cloud',
  kind: 'openai-compatible' as const,
  name: '云端',
  baseUrl: 'https://api.example.com/v1',
  model: null,
};

const DEFAULT_AI: AppSettings['ai'] = {
  enabled: true,
  cloudConsent: false,
  activeProviderId: 'local',
  providers: [
    { ...LOCAL_PROVIDER },
    { ...CLOUD_PROVIDER },
    { ...CLOUD_PROVIDER, id: 'cloud-with-model', model: 'gpt-x' },
    // 本地 + 未选模型：isolate E_AI_NO_MODEL（云门禁在 model 检查之前）
    { ...LOCAL_PROVIDER, id: 'no-model', model: null },
  ],
};

const MESSAGES: AiMessage[] = [{ role: 'user', content: '你好' }];

function baseSettings(): Omit<AppSettings, 'ai'> {
  return {
    theme: 'system',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' },
    sync: { enabled: true, encrypt: false, gc: false },
  };
}

interface SetupResult {
  service: AiService;
  store: ReturnType<typeof makeFakeStore>;
  calls: RecordedCall[];
  logs: string[];
  /** 整体替换 ai 段（模拟设置热更新）。 */
  setAi: (ai: AppSettings['ai']) => void;
}

function setup(
  aiOverrides?: Partial<AppSettings['ai']>,
  responses?: Array<AiFetchResponse | Error>,
  configStore?: AiChatConfigStore,
): SetupResult {
  const store = makeFakeStore();
  const { fetchFn, calls } = makeFetch(responses);
  const logs: string[] = [];
  let ai: AppSettings['ai'] = { ...DEFAULT_AI, providers: [...DEFAULT_AI.providers], ...aiOverrides };
  const options: ConstructorParameters<typeof AiService>[0] = {
    credentials: store,
    getSettings: () => ({ ...baseSettings(), ai }) as AppSettings,
    fetchFn,
    log: (line) => logs.push(line),
    now: () => 1_000,
  };
  if (configStore !== undefined) {
    options.chatConfigStore = configStore;
  }
  const service = new AiService(options);
  return {
    service,
    store,
    calls,
    logs,
    setAi: (next) => {
      ai = next;
    },
  };
}

describe('ai/service 门禁顺序', () => {
  it('enabled:false → 所有网络方法 E_AI_DISABLED 且 fetch 零调用', async () => {
    const { service, calls } = setup({ enabled: false });
    await expect(service.listModels({ providerId: 'local' })).rejects.toThrow(/E_AI_DISABLED/);
    await expect(service.chat({ providerId: 'local', messages: MESSAGES })).rejects.toThrow(
      /E_AI_DISABLED/,
    );
    expect(calls).toHaveLength(0);
  });

  it('未知 providerId → E_AI_NO_PROVIDER（fetch 零调用）', async () => {
    const { service, calls } = setup();
    await expect(service.listModels({ providerId: 'nope' })).rejects.toThrow(/E_AI_NO_PROVIDER/);
    await expect(service.chat({ providerId: 'nope', messages: MESSAGES })).rejects.toThrow(
      /E_AI_NO_PROVIDER/,
    );
    expect(calls).toHaveLength(0);
  });

  it('非本地 + 无 consent → E_AI_CLOUD_DENIED 且 fetchFn 零调用（隐私硬断言）；开 consent 放行', async () => {
    const { service, calls, setAi } = setup();
    await expect(service.listModels({ providerId: 'cloud-with-model' })).rejects.toThrow(
      /E_AI_CLOUD_DENIED/,
    );
    await expect(
      service.chat({ providerId: 'cloud-with-model', messages: MESSAGES }),
    ).rejects.toThrow(/E_AI_CLOUD_DENIED/);
    expect(calls).toHaveLength(0);

    setAi({
      enabled: true,
      cloudConsent: true,
      activeProviderId: 'cloud-with-model',
      providers: [
        { ...LOCAL_PROVIDER },
        { ...CLOUD_PROVIDER },
        { ...CLOUD_PROVIDER, id: 'cloud-with-model', model: 'gpt-x' },
      ],
    });
    const models = await service.listModels({ providerId: 'cloud-with-model' });
    expect(models.models).toEqual(['m1', 'm2']);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/models');
  });

  it('model:null 的 chat → E_AI_NO_MODEL（fetch 零调用）', async () => {
    const { service, calls } = setup();
    await expect(service.chat({ providerId: 'no-model', messages: MESSAGES })).rejects.toThrow(
      /E_AI_NO_MODEL/,
    );
    expect(calls).toHaveLength(0);
  });

  it('本地端点无 consent 放行（M11 验收：本地模型零外联可用）', async () => {
    const { service } = setup();
    const result = await service.chat({ providerId: 'local', messages: MESSAGES });
    expect(result).toEqual({ text: '回复全文', model: 'qwen2.5-7b' });
  });
});

describe('ai/service 模型列表缓存', () => {
  it('二次调用 cached:true 且 fetch 只 1 次；refresh:true 再拉（fetch 2 次）', async () => {
    const { service, calls } = setup();
    const first = await service.listModels({ providerId: 'local' });
    expect(first).toEqual({ models: ['m1', 'm2'], cached: false, fetchedAt: 1_000 });
    const second = await service.listModels({ providerId: 'local' });
    expect(second.cached).toBe(true);
    expect(second.models).toEqual(['m1', 'm2']);
    expect(calls).toHaveLength(1);

    const refreshed = await service.listModels({ providerId: 'local', refresh: true });
    expect(refreshed.cached).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('改 baseUrl（缓存键含 baseUrl）自动失效旧缓存', async () => {
    const { service, calls, setAi } = setup();
    await service.listModels({ providerId: 'local' });
    expect(calls).toHaveLength(1);
    setAi({
      enabled: true,
      cloudConsent: false,
      activeProviderId: 'local',
      providers: [{ ...LOCAL_PROVIDER, baseUrl: 'http://127.0.0.1:9000' }],
    });
    await service.listModels({ providerId: 'local' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe('http://127.0.0.1:9000/v1/models');
  });
});

describe('ai/service 凭据与 state', () => {
  it('setKey 后 hasKey===true；clearKey 后 false；state JSON 不含密钥明文', async () => {
    const { service, store } = setup();
    let snapshot = await service.state();
    expect(snapshot.providers.find((p) => p.id === 'local')?.hasKey).toBe(false);

    await service.setKey({ providerId: 'local', key: 'sk-super-secret-42' });
    expect(store.secrets.get('septcats|ai-local')).toBe('sk-super-secret-42');
    snapshot = await service.state();
    expect(snapshot.providers.find((p) => p.id === 'local')?.hasKey).toBe(true);
    // 隐私断言：整个快照序列化后不含密钥明文
    expect(JSON.stringify(snapshot)).not.toContain('sk-super-secret-42');

    await service.clearKey({ providerId: 'local' });
    snapshot = await service.state();
    expect(snapshot.providers.find((p) => p.id === 'local')?.hasKey).toBe(false);
  });

  it('state 派生 isLocal（本地 true / 云端 false）且 enabled/cloudConsent 透传', async () => {
    const { service } = setup();
    const snapshot = await service.state();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.cloudConsent).toBe(false);
    expect(snapshot.activeProviderId).toBe('local');
    expect(snapshot.providers.find((p) => p.id === 'local')?.isLocal).toBe(true);
    expect(snapshot.providers.find((p) => p.id === 'cloud')?.isLocal).toBe(false);
  });

  it('setKey 后请求带 Authorization: Bearer（key 不进日志）', async () => {
    const { service, calls, logs } = setup();
    await service.setKey({ providerId: 'local', key: 'sk-abc' });
    await service.listModels({ providerId: 'local' });
    expect(calls[0]?.headers['authorization']).toBe('Bearer sk-abc');
    const joined = logs.join('\n');
    expect(joined).not.toContain('sk-abc');
    expect(joined).not.toContain('你好');
  });
});

describe('ai/service 请求透传与日志', () => {
  it('chat 把 provider 配置正确透传到 client（host/model/消息体）', async () => {
    const { service, calls } = setup();
    await service.chat({
      providerId: 'local',
      messages: [{ role: 'user', content: '续写' }],
      maxTokens: 128,
    });
    expect(calls[0]?.url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['model']).toBe('qwen2.5-7b');
    expect(body['messages']).toEqual([{ role: 'user', content: '续写' }]);
    expect(body['stream']).toBe(false);
    expect(body['max_tokens']).toBe(128);
  });

  it('网络失败时日志记结果码（无正文无密钥）', async () => {
    const { service, logs } = setup(undefined, [new Error('connection refused')]);
    await expect(service.listModels({ providerId: 'local' })).rejects.toThrow(/E_AI_UNREACHABLE/);
    expect(logs.some((line) => line.includes('E_AI_UNREACHABLE'))).toBe(true);
    expect(logs.some((line) => line.includes('connection refused'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TASK-T46-01：可配置超时 / max_tokens（注入值 = 现状；设置值 = 覆盖）
// ---------------------------------------------------------------------------

/** 内存配置 store（不落盘：注入文本 + 记录写入；目录虚构）。 */
function makeConfigStore(initial: AiChatRuntimeConfig = { requestTimeoutSec: null, maxOutputTokens: null }): {
  store: AiChatConfigStore;
  written: string[];
} {
  const written: string[] = [];
  let text = serializeAiChatConfig(initial);
  const store = new AiChatConfigStore({
    resolveDir: async () => 'C:/fixture-userdata',
    io: {
      readText: () => text,
      writeText: (_path, next) => {
        written.push(next);
        text = next;
      },
    },
  });
  return { store, written };
}

/** 永不解析的假 fetch：只在 signal abort 时 reject（模拟慢/挂死端点）。 */
function hangingFetch(): FakeFetch {
  return (_url, init) =>
    new Promise<AiFetchResponse>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }));
      });
    });
}

/** 延迟 delayMs 后回正常响应的假 fetch（模拟慢模型）。 */
function delayedFetch(delayMs: number): { fetchFn: FakeFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: FakeFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '慢回复' } }] }),
    };
  };
  return { fetchFn, calls };
}

function makeService(options: {
  fetchFn: FakeFetch;
  config: AiChatRuntimeConfig;
  chatTimeoutMs?: number;
}): { service: AiService; logs: string[]; store: ReturnType<typeof makeFakeStore> } {
  const store = makeFakeStore();
  const logs: string[] = [];
  const serviceOptions: ConstructorParameters<typeof AiService>[0] = {
    credentials: store,
    getSettings: () => ({ ...baseSettings(), ai: { ...DEFAULT_AI } }) as AppSettings,
    fetchFn: options.fetchFn,
    log: (line) => logs.push(line),
    chatConfigStore: makeConfigStore(options.config).store,
  };
  if (options.chatTimeoutMs !== undefined) {
    serviceOptions.chatTimeoutMs = options.chatTimeoutMs;
  }
  return { service: new AiService(serviceOptions), logs, store };
}

describe('ai/service 可配置超时（TASK-T46-01 §1.1）', () => {
  it('未设置配置 → 生效 120s、请求体无 max_tokens（默认行为不变）', async () => {
    const { store } = makeConfigStore();
    const { service, calls } = setup(undefined, undefined, store);
    const snapshot = await service.state();
    expect(snapshot.chatTimeoutSec).toBe(120);
    expect(snapshot.maxOutputTokens).toBeNull();
    await service.chat({ providerId: 'local', messages: MESSAGES });
    const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['max_tokens']).toBeUndefined();
    expect(DEFAULT_CHAT_TIMEOUT_MS).toBe(120_000);
  });

  it('未设置配置 → 用注入兜底值（本用例 400ms，实测约 0.4s 中止；生产注入 = 120_000ms）', async () => {
    const { service } = makeService({
      fetchFn: hangingFetch(),
      config: { requestTimeoutSec: null, maxOutputTokens: null },
      chatTimeoutMs: 400,
    });
    const startedAt = Date.now();
    const error = await service.chat({ providerId: 'local', messages: MESSAGES }).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    const elapsedMs = Date.now() - startedAt;
    expect(error?.message).toContain('E_AI_TIMEOUT');
    expect(error?.message).toContain('等待超过 0.40 秒已中止');
    expect(elapsedMs).toBeGreaterThanOrEqual(380);
    expect(elapsedMs).toBeLessThan(1_500);
  });

  it('配置 requestTimeoutSec=5 → 约 5s 中止且文案含「等待超过 5 秒已中止」（墙钟实测）', async () => {
    const { service, logs } = makeService({
      fetchFn: hangingFetch(),
      config: { requestTimeoutSec: 5, maxOutputTokens: null },
    });
    const startedAt = Date.now();
    const error = await service.chat({ providerId: 'local', messages: MESSAGES }).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    const elapsedMs = Date.now() - startedAt;
    expect(error?.message).toContain('E_AI_TIMEOUT');
    expect(error?.message).toContain('等待超过 5 秒已中止');
    expect(error?.message).toContain('127.0.0.1:1234');
    expect(elapsedMs).toBeGreaterThanOrEqual(4_700);
    expect(elapsedMs).toBeLessThan(7_000);
    expect(logs.some((line) => line.includes('timeout=5s') && line.includes('E_AI_TIMEOUT'))).toBe(
      true,
    );
  }, 20_000);

  it('配置 requestTimeoutSec=300 → 不提前中止（600ms 慢响应照常返回，日志 timeout=300s）', async () => {
    const slow = delayedFetch(600);
    const { service, logs } = makeService({
      fetchFn: slow.fetchFn,
      config: { requestTimeoutSec: 300, maxOutputTokens: null },
    });
    const startedAt = Date.now();
    const result = await service.chat({ providerId: 'local', messages: MESSAGES });
    const elapsedMs = Date.now() - startedAt;
    expect(result).toEqual({ text: '慢回复', model: 'qwen2.5-7b' });
    expect(elapsedMs).toBeGreaterThanOrEqual(580);
    expect(logs.some((line) => line.includes('timeout=300s') && line.includes('→ ok('))).toBe(true);
  });

  it('配置 maxOutputTokens=800 → 请求体带 max_tokens=800；显式 maxTokens 优先', async () => {
    const { service, calls } = setup(undefined, undefined, makeConfigStore({
      requestTimeoutSec: null,
      maxOutputTokens: 800,
    }).store);
    const snapshot = await service.state();
    expect(snapshot.maxOutputTokens).toBe(800);
    await service.chat({ providerId: 'local', messages: MESSAGES });
    expect((JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>)['max_tokens']).toBe(800);
    await service.chat({ providerId: 'local', messages: MESSAGES, maxTokens: 64 });
    expect((JSON.parse(calls[1]?.body ?? '{}') as Record<string, unknown>)['max_tokens']).toBe(64);
  });

  it('setChatConfig 越界夹紧/清除并返回生效值（9999→600、2→5、tokens 0→1、null→回 120）', async () => {
    const { store, written } = makeConfigStore();
    const { service } = setup(undefined, undefined, store);
    expect(await service.setChatConfig({ requestTimeoutSec: 9_999 })).toEqual({
      chatTimeoutSec: 600,
      maxOutputTokens: null,
    });
    expect(await service.setChatConfig({ requestTimeoutSec: 2 })).toEqual({
      chatTimeoutSec: 5,
      maxOutputTokens: null,
    });
    expect(await service.setChatConfig({ maxOutputTokens: 0 })).toEqual({
      chatTimeoutSec: 5,
      maxOutputTokens: 1,
    });
    expect(await service.setChatConfig({ requestTimeoutSec: null })).toEqual({
      chatTimeoutSec: 120,
      maxOutputTokens: 1,
    });
    expect(await service.setChatConfig({ maxOutputTokens: null })).toEqual({
      chatTimeoutSec: 120,
      maxOutputTokens: null,
    });
    expect(written).toHaveLength(5);
    expect(JSON.parse(written[4] ?? '{}')).toEqual({
      v: 1,
      requestTimeoutSec: null,
      maxOutputTokens: null,
    });
  });

  it('配置写入后 chat 立即生效（同一实例：5s → 中止值随新的 600s 变化）', async () => {
    const { store } = makeConfigStore({ requestTimeoutSec: 5, maxOutputTokens: null });
    const { service, logs } = setup(undefined, undefined, store);
    await service.setChatConfig({ requestTimeoutSec: 600 });
    const snapshot = await service.state();
    expect(snapshot.chatTimeoutSec).toBe(600);
    expect(await service.setChatConfig({ requestTimeoutSec: null })).toEqual({
      chatTimeoutSec: 120,
      maxOutputTokens: null,
    });
    expect(logs.some((line) => line.includes('ai setChatConfig timeout=120s'))).toBe(true);
  });
});
