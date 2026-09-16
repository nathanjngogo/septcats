/**
 * main/ai/client.ts —— OpenAI 兼容客户端（TASK-T18-01 §2.6）。
 *
 * 单一 provider 形态：lmstudio / ollama / openai-compatible 共用
 * `GET {base}/v1/models` 与 `POST {base}/v1/chat/completions`。
 * fetch 注入（生产 = net.fetch 包装，测试 = 假实现）；非流式 MVP（stream:false）。
 * 错误映射：AbortError/TimeoutError → E_AI_TIMEOUT；其余抛出 → E_AI_UNREACHABLE；
 * !ok → E_AI_HTTP；JSON/形状不对 → E_AI_BAD_RESPONSE。
 *
 * 纯 Node（不 import electron），可直测。
 */
import type { AiMessage } from '../../shared/ai';
import { AiError } from './types';

/** 最小 fetch 面（生产 = net.fetch 包装；测试 = 假实现）。 */
export interface AiFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type AiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<AiFetchResponse>;

export interface AiClientOptions {
  fetchFn: AiFetch;
  /** 模型列表请求超时（默认 8s）。 */
  modelListTimeoutMs?: number;
  /** chat 请求超时（默认 120s，本地推理延迟可接受）。 */
  chatTimeoutMs?: number;
}

interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_MODEL_LIST_TIMEOUT_MS = 8_000;
const DEFAULT_CHAT_TIMEOUT_MS = 120_000;

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    const name = (error as { name?: string }).name;
    return name === 'AbortError' || name === 'TimeoutError';
  }
  return false;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AiClient {
  private readonly fetchFn: AiFetch;
  private readonly modelListTimeoutMs: number;
  private readonly chatTimeoutMs: number;

  constructor(options: AiClientOptions) {
    this.fetchFn = options.fetchFn;
    this.modelListTimeoutMs = options.modelListTimeoutMs ?? DEFAULT_MODEL_LIST_TIMEOUT_MS;
    this.chatTimeoutMs = options.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
  }

  /** GET {base}/v1/models → 去重保序的模型 id 列表。 */
  async listModels(baseUrl: string, apiKey: string | null): Promise<string[]> {
    const data = await this.requestJson(
      `${baseUrl}/v1/models`,
      apiKey,
      'GET',
      undefined,
      this.modelListTimeoutMs,
    );
    if (typeof data !== 'object' || data === null || !Array.isArray((data as { data?: unknown }).data)) {
      throw new AiError('E_AI_BAD_RESPONSE', '模型列表响应缺少 data 数组');
    }
    const items = (data as { data: unknown[] }).data;
    const models: string[] = [];
    for (const item of items) {
      const id = (item as { id?: unknown } | null)?.id;
      if (typeof id !== 'string') {
        throw new AiError('E_AI_BAD_RESPONSE', '模型列表条目缺少字符串 id');
      }
      if (!models.includes(id)) {
        models.push(id);
      }
    }
    return models;
  }

  /** POST {base}/v1/chat/completions（stream:false）→ 全文一次往返。 */
  async chat(
    baseUrl: string,
    apiKey: string | null,
    model: string,
    messages: AiMessage[],
    opts?: ChatOptions,
  ): Promise<{ text: string; model: string }> {
    const body: Record<string, unknown> = { model, messages, stream: false };
    if (opts?.maxTokens !== undefined) {
      body['max_tokens'] = opts.maxTokens;
    }
    if (opts?.temperature !== undefined) {
      body['temperature'] = opts.temperature;
    }
    const data = await this.requestJson(
      `${baseUrl}/v1/chat/completions`,
      apiKey,
      'POST',
      JSON.stringify(body),
      this.chatTimeoutMs,
    );
    const content = (data as { choices?: Array<{ message?: { content?: unknown } }> | undefined })
      .choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AiError('E_AI_BAD_RESPONSE', 'chat 响应缺少 choices[0].message.content 字符串');
    }
    return { text: content, model };
  }

  /** 统一请求面：头/超时/错误映射收口在一处。 */
  private async requestJson(
    url: string,
    apiKey: string | null,
    method: 'GET' | 'POST',
    body: string | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey !== null) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }
    let response: AiFetchResponse;
    const init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    } = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) {
      init.body = body;
    }
    try {
      response = await this.fetchFn(url, init);
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new AiError('E_AI_TIMEOUT', `端点请求超时（${url}）`);
      }
      throw new AiError('E_AI_UNREACHABLE', `端点不可达：${describeError(error)}`);
    }
    if (!response.ok) {
      throw new AiError('E_AI_HTTP', `HTTP ${String(response.status)}（${url}）`);
    }
    let raw: string;
    try {
      raw = await response.text();
    } catch (error) {
      throw new AiError('E_AI_BAD_RESPONSE', `响应体读取失败：${describeError(error)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      throw new AiError('E_AI_BAD_RESPONSE', '响应不是合法 JSON');
    }
    return data;
  }
}
