/**
 * ai-client.test.ts —— OpenAI 兼容客户端（TASK-T18-01 §3，假 fetch）。
 *
 * 覆盖：listModels 正常（URL/去重保序/无 Authorization 当 key=null/{data:[]} 空数组）、
 * chat 正常（URL/Authorization: Bearer/body.model+messages/stream:false/max_tokens 温控可选）、
 * HTTP 500 → E_AI_HTTP；坏 JSON → E_AI_BAD_RESPONSE；fetch 抛普通错 → E_AI_UNREACHABLE；
 * 抛 AbortError → E_AI_TIMEOUT。
 */
import { describe, expect, it } from 'vitest';
import { AiClient, type AiFetch, type AiFetchResponse } from '../src/main/ai/client';
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
