/**
 * main/ai/client.ts —— OpenAI 兼容客户端（TASK-T18-01 §2.6）。
 *
 * 单一 provider 形态：lmstudio / ollama / openai-compatible 共用
 * `GET {base}/v1/models` 与 `POST {base}/v1/chat/completions`。
 * fetch 注入（生产 = net.fetch 包装，测试 = 假实现）；非流式 MVP（stream:false）。
 * 错误映射：AbortError/TimeoutError → E_AI_TIMEOUT；其余抛出 → E_AI_UNREACHABLE；
 * !ok → E_AI_HTTP；JSON/形状不对 → E_AI_BAD_RESPONSE。
 * TASK-T46-01：chat 超时可被 opts.timeoutMs 覆盖（呈现侧配置注入），超时文案带秒数；
 * 响应额外透出 `reasoning_content`/`finish_reason`（**只增字段**，错误码语义不变）。
 *
 * 纯 Node（不 import electron），可直测。
 */
import type { AiChatResult, AiMessage } from '../../shared/ai';
import { AI_CHAT_TIMEOUT_DEFAULT_SEC } from '../../shared/ai';
import { describeTimeoutSeconds } from './chatConfig';
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
  /** 本请求的超时（ms）；缺省 = 构造注入的 chatTimeoutMs（默认 120s）。 */
  timeoutMs?: number;
}

const DEFAULT_MODEL_LIST_TIMEOUT_MS = 8_000;
/** chat 请求默认超时（未注入 chatTimeoutMs 时的真相源）= 120_000ms。 */
export const DEFAULT_CHAT_TIMEOUT_MS = AI_CHAT_TIMEOUT_DEFAULT_SEC * 1_000;

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

/** baseUrl → host（超时文案只带 host，不带完整路径）。 */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
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
  ): Promise<AiChatResult> {
    const body: Record<string, unknown> = { model, messages, stream: false };
    if (opts?.maxTokens !== undefined) {
      body['max_tokens'] = opts.maxTokens;
    }
    if (opts?.temperature !== undefined) {
      body['temperature'] = opts.temperature;
    }
    const timeoutMs = opts?.timeoutMs ?? this.chatTimeoutMs;
    let data: unknown;
    try {
      data = await this.requestJson(
        `${baseUrl}/v1/chat/completions`,
        apiKey,
        'POST',
        JSON.stringify(body),
        timeoutMs,
      );
    } catch (error) {
      // TASK-T46-01 §1.3：chat 超时文案可读（「等待超过 N 秒已中止」）；
      // 错误码仍是 E_AI_TIMEOUT，其余错误原样冒泡（listModels 的 8s 文案不变）。
      if (error instanceof AiError && error.code === 'E_AI_TIMEOUT') {
        throw new AiError(
          'E_AI_TIMEOUT',
          `等待超过 ${describeTimeoutSeconds(timeoutMs)} 秒已中止（${hostOf(baseUrl)}）`,
        );
      }
      throw error;
    }
    const choice = (
      data as {
        choices?: Array<{
          message?: { content?: unknown; reasoning_content?: unknown };
          finish_reason?: unknown;
        }>;
      }
    ).choices?.[0];
    const content = choice?.message?.content;
    const rawReasoning = choice?.message?.reasoning_content;
    const finishReason = choice?.finish_reason;
    // 纯推理响应（content 缺省/为空但带 reasoning_content）按**成功**处理：
    // 呈现层负责给出「仅推理内容」提示，不再当坏响应（TASK-T46-01 §1.2）。
    const reasoningContent =
      typeof rawReasoning === 'string' && rawReasoning.length > 0 ? rawReasoning : null;
    if (typeof content !== 'string' && reasoningContent === null) {
      throw new AiError('E_AI_BAD_RESPONSE', 'chat 响应缺少 choices[0].message.content 字符串');
    }
    const result: AiChatResult = {
      text: typeof content === 'string' ? content : '',
      model,
    };
    if (reasoningContent !== null) {
      result.reasoningContent = reasoningContent;
    }
    if (typeof finishReason === 'string' && finishReason.length > 0) {
      result.finishReason = finishReason;
    }
    return result;
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
