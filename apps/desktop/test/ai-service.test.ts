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
): SetupResult {
  const store = makeFakeStore();
  const { fetchFn, calls } = makeFetch(responses);
  const logs: string[] = [];
  let ai: AppSettings['ai'] = { ...DEFAULT_AI, providers: [...DEFAULT_AI.providers], ...aiOverrides };
  const service = new AiService({
    credentials: store,
    getSettings: () => ({ ...baseSettings(), ai }) as AppSettings,
    fetchFn,
    log: (line) => logs.push(line),
    now: () => 1_000,
  });
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
