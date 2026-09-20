/**
 * ai-client.test.ts —— OpenAI 兼容客户端（TASK-T18-01 §3，假 fetch）。
 *
 * 覆盖：listModels 正常（URL/去重保序/无 Authorization 当 key=null/{data:[]} 空数组）、
 * chat 正常（URL/Authorization: Bearer/body.model+messages/stream:false/max_tokens 温控可选）、
 * HTTP 500 → E_AI_HTTP；坏 JSON → E_AI_BAD_RESPONSE；fetch 抛普通错 → E_AI_UNREACHABLE；
 * 抛 AbortError → E_AI_TIMEOUT。
 */
import { describe, expect, it } from 'vitest';
import { AiClient, DEFAULT_CHAT_TIMEOUT_MS, type AiFetch, type AiFetchResponse } from '../src/main/ai/client';
import type { AiMessage } from '../src/shared/ai';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

function okResponse(json: string): AiFetchResponse {
  return { ok: true, status: 200, text: async () => json };
}

/** 假 fetch：记录每次调用，按队列回放响应/异常。 */
function makeFetch(
  queue: Array<AiFetchResponse | Error>,
): { fetchFn: AiFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    fetchFn: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      const next = queue.shift();
      if (next instanceof Error) {
        throw next;
      }
      if (next === undefined) {
        throw new Error('假 fetch 队列耗尽');
      }
      return next;
    },
  };
}

const MESSAGES: AiMessage[] = [
  { role: 'system', content: '你是写作助手' },
  { role: 'user', content: '续写这句话' },
];

describe('ai/client listModels', () => {
  it('正常：URL 正确、key=null 无 Authorization、去重保序', async () => {
    const { fetchFn, calls } = makeFetch([
      okResponse(JSON.stringify({ data: [{ id: 'm2' }, { id: 'm1' }, { id: 'm2' }] })),
    ]);
    const client = new AiClient({ fetchFn });
    const models = await client.listModels('http://127.0.0.1:1234', null);
    expect(models).toEqual(['m2', 'm1']);
    expect(calls[0]?.url).toBe('http://127.0.0.1:1234/v1/models');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.headers['authorization']).toBeUndefined();
    expect(calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('apiKey 非 null 时带 Bearer 头', async () => {
    const { fetchFn, calls } = makeFetch([okResponse(JSON.stringify({ data: [{ id: 'a' }] }))]);
    const client = new AiClient({ fetchFn });
    await client.listModels('http://127.0.0.1:1234', 'sk-test');
    expect(calls[0]?.headers['authorization']).toBe('Bearer sk-test');
  });

  it('{data:[]} → 空数组不炸', async () => {
    const { fetchFn } = makeFetch([okResponse(JSON.stringify({ data: [] }))]);
    const client = new AiClient({ fetchFn });
    expect(await client.listModels('http://127.0.0.1:1234', null)).toEqual([]);
  });

  it('HTTP 500 → E_AI_HTTP；形状不对 → E_AI_BAD_RESPONSE', async () => {
    const { fetchFn } = makeFetch([okResponse(JSON.stringify({ items: [] }))]);
    const client = new AiClient({ fetchFn });
    await expect(client.listModels('http://127.0.0.1:1234', null)).rejects.toThrow(
      /E_AI_BAD_RESPONSE/,
    );
  });
});

describe('ai/client chat', () => {
  it('正常：URL/Bearer/body（model+messages+stream:false）', async () => {
    const { fetchFn, calls } = makeFetch([
      okResponse(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: '续写的内容' } }] }),
      ),
    ]);
    const client = new AiClient({ fetchFn });
    const result = await client.chat('http://127.0.0.1:1234', 'k', 'qwen2.5-7b', MESSAGES);
    expect(result).toEqual({ text: '续写的内容', model: 'qwen2.5-7b' });
    expect(calls[0]?.url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['authorization']).toBe('Bearer k');
    const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['model']).toBe('qwen2.5-7b');
    expect(body['messages']).toEqual(MESSAGES);
    expect(body['stream']).toBe(false);
    expect(body['max_tokens']).toBeUndefined();
    expect(body['temperature']).toBeUndefined();
  });

  it('maxTokens/temperature 提供时进 body，undefined 时不出现', async () => {
    const { fetchFn, calls } = makeFetch([
      okResponse(JSON.stringify({ choices: [{ message: { content: 'x' } }] })),
    ]);
    const client = new AiClient({ fetchFn });
    await client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES, {
      maxTokens: 256,
      temperature: 0.7,
    });
    const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['max_tokens']).toBe(256);
    expect(body['temperature']).toBe(0.7);
  });

  it('HTTP 500 → E_AI_HTTP（消息含 status 与 URL）', async () => {
    const { fetchFn } = makeFetch([{ ok: false, status: 500, text: async () => 'server error' }]);
    const client = new AiClient({ fetchFn });
    await expect(client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES)).rejects.toThrow(
      /E_AI_HTTP：HTTP 500/,
    );
  });

  it('坏 JSON → E_AI_BAD_RESPONSE', async () => {
    const { fetchFn } = makeFetch([okResponse('not json at all')]);
    const client = new AiClient({ fetchFn });
    await expect(client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES)).rejects.toThrow(
      /E_AI_BAD_RESPONSE/,
    );
  });

  it('choices[0].message.content 非字符串 → E_AI_BAD_RESPONSE', async () => {
    const { fetchFn } = makeFetch([
      okResponse(JSON.stringify({ choices: [{ message: { content: 42 } }] })),
    ]);
    const client = new AiClient({ fetchFn });
    await expect(client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES)).rejects.toThrow(
      /E_AI_BAD_RESPONSE/,
    );
  });

  it('fetch 抛普通错 → E_AI_UNREACHABLE；抛 AbortError → E_AI_TIMEOUT', async () => {
    const { fetchFn } = makeFetch([new Error('connection refused')]);
    const client = new AiClient({ fetchFn });
    await expect(client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES)).rejects.toThrow(
      /E_AI_UNREACHABLE/,
    );

    const abort: Error = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    const timed = makeFetch([abort]);
    const client2 = new AiClient({ fetchFn: timed.fetchFn });
    await expect(client2.chat('http://127.0.0.1:1234', null, 'm', MESSAGES)).rejects.toThrow(
      /E_AI_TIMEOUT/,
    );

    const timeout: Error = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
    const timed2 = makeFetch([timeout]);
    const client3 = new AiClient({ fetchFn: timed2.fetchFn });
    await expect(client3.listModels('http://127.0.0.1:1234', null)).rejects.toThrow(/E_AI_TIMEOUT/);
  });
});

// ---------------------------------------------------------------------------
// TASK-T46-01：reasoning_content / finish_reason 透出 + 可配置超时
// ---------------------------------------------------------------------------

/** 永不解析的假 fetch：只在 signal abort 时 reject（超时路径的墙钟取证）。 */
function hangingFetch(): AiFetch {
  return (_url, init) =>
    new Promise<AiFetchResponse>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }));
      });
    });
}

describe('ai/client 纯推理响应与超时（TASK-T46-01）', () => {
  it('reasoning_content / finish_reason 透出（新增可选字段，text/model 语义不变）', async () => {
    const { fetchFn } = makeFetch([
      okResponse(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: '正文', reasoning_content: '推理链' },
              finish_reason: 'stop',
            },
          ],
        }),
      ),
    ]);
    const client = new AiClient({ fetchFn });
    const result = await client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES);
    expect(result).toEqual({
      text: '正文',
      model: 'm',
      reasoningContent: '推理链',
      finishReason: 'stop',
    });
  });

  it('content 为空但带 reasoning_content → 成功返回（不再当坏响应）', async () => {
    const { fetchFn } = makeFetch([
      okResponse(
        JSON.stringify({
          choices: [{ message: { content: '', reasoning_content: '只有推理' }, finish_reason: 'length' }],
        }),
      ),
    ]);
    const client = new AiClient({ fetchFn });
    const result = await client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES);
    expect(result.text).toBe('');
    expect(result.reasoningContent).toBe('只有推理');
    expect(result.finishReason).toBe('length');
  });

  it('content 字段缺省但带 reasoning_content → text 空串（不抛 E_AI_BAD_RESPONSE）', async () => {
    const { fetchFn } = makeFetch([
      okResponse(JSON.stringify({ choices: [{ message: { reasoning_content: '推理' } }] })),
    ]);
    const client = new AiClient({ fetchFn });
    const result = await client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES);
    expect(result.text).toBe('');
    expect(result.reasoningContent).toBe('推理');
    expect(result.finishReason).toBeUndefined();
  });

  it('既无 content 又无 reasoning_content → 仍 E_AI_BAD_RESPONSE（坏响应语义不变）', async () => {
    const { fetchFn } = makeFetch([okResponse(JSON.stringify({ choices: [{}] }))]);
    const client = new AiClient({ fetchFn });
    await expect(client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES)).rejects.toThrow(
      /E_AI_BAD_RESPONSE/,
    );
  });

  it('未注入时 chat 超时真相源 = 120_000ms', () => {
    expect(DEFAULT_CHAT_TIMEOUT_MS).toBe(120_000);
  });

  it('注入 chatTimeoutMs 生效；opts.timeoutMs 覆盖注入值（墙钟实测）', async () => {
    const client = new AiClient({ fetchFn: hangingFetch(), chatTimeoutMs: 600 });
    const startedAt = Date.now();
    const error = await client.chat('http://127.0.0.1:1234', null, 'm', MESSAGES).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    const elapsedInjected = Date.now() - startedAt;
    expect(error?.message).toContain('E_AI_TIMEOUT');
    expect(error?.message).toContain('等待超过 0.60 秒已中止');
    expect(error?.message).toContain('（127.0.0.1:1234）');
    expect(elapsedInjected).toBeGreaterThanOrEqual(560);
    expect(elapsedInjected).toBeLessThan(1_500);

    const started2 = Date.now();
    await client
      .chat('http://127.0.0.1:1234', null, 'm', MESSAGES, { timeoutMs: 120 })
      .then(
        () => null,
        (caught: unknown) => caught as Error,
      );
    const elapsedOverride = Date.now() - started2;
    expect(elapsedOverride).toBeGreaterThanOrEqual(100);
    expect(elapsedOverride).toBeLessThan(500);
  });

  it('listModels 的 8s 模型列表超时文案保持原样（只改 chat 超时文案）', async () => {
    const client = new AiClient({ fetchFn: hangingFetch(), modelListTimeoutMs: 100 });
    const error = await client.listModels('http://127.0.0.1:1234', null).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error?.message).toBe('E_AI_TIMEOUT：端点请求超时（http://127.0.0.1:1234/v1/models）');
  });
});
