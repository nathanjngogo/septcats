/**
 * main/ai/service.ts —— AiService（TASK-T18-01 §2.8）。
 *
 * 门禁顺序（每个网络操作）：ai.enabled → provider 存在 → assertAiUrlAllowed
 * （云门禁：拒绝时 fetch 一次都不发）→ 取 key → 发请求。
 * state/setKey/clearKey 不走网络门禁；密钥只存 CredentialStore
 * （service=septcats，account=ai-<providerId>），绝不进 settings/日志/错误消息。
 * 隐私请求日志只记 `op providerId host 耗时 结果码`，禁记 prompt/响应体/密钥。
 * 启动零外联：不预拉模型，listModels 只在被调用时发请求。
 * TASK-T46-01：chat 超时与 max_tokens 由 AI 旁路配置（`main/ai/chatConfigStore.ts`）
 * 注入——未设置时**逐字保持**既有行为（120_000ms、不带 max_tokens）。
 *
 * 依赖注入 CredentialStore + getSettings + fetchFn（照 SyncRuntime 注入风格）；
 * 纯 Node（不 import electron），可直测。
 */
import type { CredentialStore } from '@septcats/platform';
import type {
  AiChatConfigSnapshot,
  AiChatResult,
  AiListModelsResult,
  AiMessage,
  AiStateSnapshot,
} from '../../shared/ai';
import type { AppSettings } from '../../shared/settings';
import { ModelListCache } from './cache';
import { effectiveChatTimeoutMs } from './chatConfig';
import { AiChatConfigStore, defaultChatConfigStore } from './chatConfigStore';
import { AiClient, DEFAULT_CHAT_TIMEOUT_MS, type AiClientOptions, type AiFetch } from './client';
import { assertAiUrlAllowed, isLocalBaseUrl, normalizeBaseUrl } from './policy';
import { AI_CREDENTIAL_SERVICE, AiError, aiCredentialAccount } from './types';

export interface AiServiceOptions {
  credentials: CredentialStore;
  /** 每次调用现读（settings 热更新）。 */
  getSettings: () => AppSettings;
  fetchFn: AiFetch;
  /** 隐私请求日志（main 侧接 logger.forModule('ai')）。 */
  log: (line: string) => void;
  now?: () => number;
  /** 模型列表缓存 TTL（默认 60s；测试注入 0/大值）。 */
  cacheTtlMs?: number;
  modelListTimeoutMs?: number;
  /** chat 超时**兜底注入值**（未设置旁路配置时生效；默认 120_000）。 */
  chatTimeoutMs?: number;
  /** AI 对话运行时配置存储（默认 = `defaultChatConfigStore()`，懒解析 userData）。 */
  chatConfigStore?: AiChatConfigStore;
}

interface GatedProvider {
  id: string;
  baseUrl: string;
  model: string | null;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '(bad-url)';
  }
}

function isLocalSafe(baseUrl: string): boolean {
  try {
    return isLocalBaseUrl(normalizeBaseUrl(baseUrl));
  } catch {
    return false;
  }
}

function errorCodeOf(error: unknown): string {
  return error instanceof AiError ? error.code : 'E_AI_UNREACHABLE';
}

export class AiService {
  private readonly credentials: CredentialStore;
  private readonly getSettings: () => AppSettings;
  private readonly client: AiClient;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly cache: ModelListCache;
  private readonly chatConfigStore: AiChatConfigStore;
  private readonly fallbackChatTimeoutMs: number;

  constructor(options: AiServiceOptions) {
    this.credentials = options.credentials;
    this.getSettings = options.getSettings;
    this.fallbackChatTimeoutMs = options.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
    const clientOptions: AiClientOptions = { fetchFn: options.fetchFn };
    if (options.modelListTimeoutMs !== undefined) {
      clientOptions.modelListTimeoutMs = options.modelListTimeoutMs;
    }
    if (options.chatTimeoutMs !== undefined) {
      clientOptions.chatTimeoutMs = options.chatTimeoutMs;
    }
    this.client = new AiClient(clientOptions);
    this.log = options.log;
    this.now = options.now ?? Date.now;
    this.cache = new ModelListCache(options.cacheTtlMs ?? 60_000, this.now);
    this.chatConfigStore = options.chatConfigStore ?? defaultChatConfigStore();
  }

  /** AI 对话运行时配置的**生效值**（秒/max_tokens；ai:state 与 ai:setChatConfig 共用）。 */
  async chatConfig(): Promise<AiChatConfigSnapshot> {
    const config = await this.chatConfigStore.read();
    return {
      chatTimeoutSec: Math.round(
        effectiveChatTimeoutMs(config, this.fallbackChatTimeoutMs) / 1_000,
      ),
      maxOutputTokens: config.maxOutputTokens,
    };
  }

  /** 写 AI 对话运行时配置（夹紧在 store 内；返回写后生效值）。 */
  async setChatConfig(patch: {
    requestTimeoutSec?: number | null;
    maxOutputTokens?: number | null;
  }): Promise<AiChatConfigSnapshot> {
    const config = await this.chatConfigStore.patch(patch);
    const snapshot: AiChatConfigSnapshot = {
      chatTimeoutSec: Math.round(
        effectiveChatTimeoutMs(config, this.fallbackChatTimeoutMs) / 1_000,
      ),
      maxOutputTokens: config.maxOutputTokens,
    };
    this.log(
      `ai setChatConfig timeout=${String(snapshot.chatTimeoutSec)}s maxTokens=${snapshot.maxOutputTokens === null ? 'unset' : String(snapshot.maxOutputTokens)}`,
    );
    return snapshot;
  }

  /** 渲染器视图：派生 isLocal/hasKey，不泄露密钥。凭据读取失败按 false（不抛）。 */
  async state(): Promise<AiStateSnapshot> {
    const settings = this.getSettings();
    const chatConfig = await this.chatConfig();
    const providers: AiStateSnapshot['providers'] = [];
    for (const provider of settings.ai.providers) {
      let hasKey = false;
      try {
        hasKey =
          (await this.credentials.get(AI_CREDENTIAL_SERVICE, aiCredentialAccount(provider.id))) !==
          null;
      } catch {
        hasKey = false;
      }
      providers.push({
        id: provider.id,
        kind: provider.kind,
        name: provider.name,
        baseUrl: provider.baseUrl,
        isLocal: isLocalSafe(provider.baseUrl),
        hasKey,
        model: provider.model,
      });
    }
    return {
      enabled: settings.ai.enabled,
      cloudConsent: settings.ai.cloudConsent,
      activeProviderId: settings.ai.activeProviderId,
      chatTimeoutSec: chatConfig.chatTimeoutSec,
      maxOutputTokens: chatConfig.maxOutputTokens,
      providers,
    };
  }

  async listModels(input: { providerId: string; refresh?: boolean }): Promise<AiListModelsResult> {
    const startedAt = this.now();
    const gate = this.gateForNetwork(input.providerId);
    const cacheKey = `${gate.id}|${gate.baseUrl}`;
    const host = hostOf(gate.baseUrl);
    if (input.refresh !== true) {
      const hit = this.cache.get(cacheKey);
      if (hit !== null) {
        this.log(
          `ai listModels provider=${gate.id} host=${host} → ok(${String(hit.models.length)} models, ${String(this.now() - startedAt)}ms, cached)`,
        );
        return { models: hit.models, cached: true, fetchedAt: hit.fetchedAt };
      }
    }
    const apiKey = await this.readKey(gate.id);
    try {
      const models = await this.client.listModels(gate.baseUrl, apiKey);
      const fetchedAt = this.now();
      this.cache.set(cacheKey, models, fetchedAt);
      this.log(
        `ai listModels provider=${gate.id} host=${host} → ok(${String(models.length)} models, ${String(fetchedAt - startedAt)}ms)`,
      );
      return { models, cached: false, fetchedAt };
    } catch (error) {
      this.log(
        `ai listModels provider=${gate.id} host=${host} → ${errorCodeOf(error)}(${String(this.now() - startedAt)}ms)`,
      );
      throw error;
    }
  }

  async chat(input: {
    providerId: string;
    messages: AiMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<AiChatResult> {
    const startedAt = this.now();
    const gate = this.gateForNetwork(input.providerId);
    if (gate.model === null) {
      throw new AiError('E_AI_NO_MODEL', '先在设置中选择模型');
    }
    const host = hostOf(gate.baseUrl);
    const apiKey = await this.readKey(gate.id);
    // 旁路配置读在门禁之后（隐私：门禁拒绝时连配置文件都不碰）——「未设置」即注入兜底值。
    const config = await this.chatConfigStore.read();
    const timeoutMs = effectiveChatTimeoutMs(config, this.fallbackChatTimeoutMs);
    const opts: { maxTokens?: number; temperature?: number; timeoutMs: number } = { timeoutMs };
    const maxTokens = input.maxTokens ?? config.maxOutputTokens;
    if (maxTokens !== null) {
      opts.maxTokens = maxTokens;
    }
    if (input.temperature !== undefined) {
      opts.temperature = input.temperature;
    }
    try {
      const result = await this.client.chat(gate.baseUrl, apiKey, gate.model, input.messages, opts);
      this.log(
        `ai chat provider=${gate.id} host=${host} model=${gate.model} timeout=${String(timeoutMs / 1_000)}s → ok(${String(this.now() - startedAt)}ms)`,
      );
      return result;
    } catch (error) {
      this.log(
        `ai chat provider=${gate.id} host=${host} model=${gate.model} timeout=${String(timeoutMs / 1_000)}s → ${errorCodeOf(error)}(${String(this.now() - startedAt)}ms)`,
      );
      throw error;
    }
  }

  async setKey(input: { providerId: string; key: string }): Promise<{ ok: true }> {
    await this.credentials.set(AI_CREDENTIAL_SERVICE, aiCredentialAccount(input.providerId), input.key);
    return { ok: true };
  }

  async clearKey(input: { providerId: string }): Promise<{ ok: true }> {
    await this.credentials.delete(AI_CREDENTIAL_SERVICE, aiCredentialAccount(input.providerId));
    return { ok: true };
  }

  /**
   * 网络操作门禁：enabled → provider 存在 → 云门禁。
   * 云门禁拒绝时 fetchFn 一次都未被调用（隐私硬不变量，测试锁死）。
   */
  private gateForNetwork(providerId: string): GatedProvider {
    const settings = this.getSettings();
    if (!settings.ai.enabled) {
      throw new AiError('E_AI_DISABLED', 'AI 功能已在设置中关闭');
    }
    const provider = settings.ai.providers.find((p) => p.id === providerId);
    if (provider === undefined) {
      throw new AiError('E_AI_NO_PROVIDER', `未找到 id 为 '${providerId}' 的 provider`);
    }
    const baseUrl = assertAiUrlAllowed(provider.baseUrl, settings.ai.cloudConsent);
    return { id: provider.id, baseUrl, model: provider.model };
  }

  /** 凭据读取（CredentialUnavailableError 原样透传，不落日志）。 */
  private async readKey(providerId: string): Promise<string | null> {
    return this.credentials.get(AI_CREDENTIAL_SERVICE, aiCredentialAccount(providerId));
  }
}
