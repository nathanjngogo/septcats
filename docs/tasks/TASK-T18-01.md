# TASK-T18-01 · M11 AI 集成（1/3）：核心服务（provider 抽象 + 端点策略 + 模型缓存 + chat + 设置 + IPC）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：TASK-T17-01B 完成并提交后的 HEAD（本任务开工前先 `git log -1` 确认）
> 依据：PROJECT_PLAN `§7 M11`——「Provider 抽象（OpenAI 兼容 + Ollama + LM Studio）、端点白名单与"云端调用需显式开关"、
> 块内续写/摘要/改写/翻译、AI 属性类型、模型列表 TTL 缓存（复用办公插件 E-030 已验证的拉取+TTL 模式）」。
> **本任务只做 1/3：main 侧核心服务 + 设置 + IPC，零 UI**（设置页 UI = T18-02、编辑器动作 = T18-03，见 §6）。
> M11 验收（总）：「本地模型零外联可用；云端 provider 默认关闭」——本轮用单测锁住隐私不变量，真机 LM Studio 连通性由 PM 在 UI 就绪后验收。
> 纪律：`packages/sync`、`packages/core` 零改动；`packages/platform` **只许动 `settings.ts` + 其测试**（credentials/logger/layout 一行不改）；
> `electron-updater` 不碰；不碰 git；禁占位符/TODO；每写完一个文件立即跑对应测试。

## 0. PM 架构裁决（照此实现，勿改架构）

1. **位置**：`apps/desktop/src/main/ai/` 内聚（不新建 workspace 包）；纯逻辑（policy/client/cache）不 import electron，可 Node 直测（照 `main/sync` 的测试范式）。`AiService` 依赖注入 `CredentialStore + getSettings + fetchFn`（照 `SyncRuntime` 的注入风格）。
2. **单一 provider 形态**：`kind: 'lmstudio' | 'ollama' | 'openai-compatible'` 三者共用 **OpenAI 兼容协议**（`GET {base}/v1/models`、`POST {base}/v1/chat/completions`）。本地预设：LM Studio `http://127.0.0.1:1234`、Ollama `http://127.0.0.1:11434`（两者均已支持 /v1 兼容层）。
3. **端点策略**：`baseUrl` 必须 http/https；**本地 = localhost / *.localhost / 127.0.0.1 / ::1**（按 URL.hostname 判定，不做 DNS 解析）。非本地 → **必须 `ai.cloudConsent === true` 才允许发请求**，否则抛 `E_AI_CLOUD_DENIED` 且**未发出任何网络请求**（这是测试断言的硬不变量）。
4. **密钥**：每个 provider 一把可选 API key，存 `CredentialStore`（service=`septcats`，account=`ai-<providerId>`）；**绝不进 settings.json / 日志 / 错误消息**。IPC 只回 `hasKey: boolean`。
5. **模型列表缓存**：内存 TTL **60s**（照办公插件 E-030：`(monotonic_ts, models)` 窗口 + 设置变更即失效）；缓存键含 `providerId + baseUrl`（改 URL 自动失效）；`refresh: true` 强制绕过。
6. **错误码**（stable，消息一律 `CODE：中文详情`）：`E_AI_DISABLED / E_AI_NO_PROVIDER / E_AI_NO_MODEL / E_AI_CLOUD_DENIED / E_AI_BAD_URL / E_AI_UNREACHABLE / E_AI_TIMEOUT / E_AI_HTTP / E_AI_BAD_RESPONSE`。
7. **隐私请求日志**：只记 `op providerId host model 耗时 结果码`；**禁记 prompt/响应体/密钥**。启动零外联：不建连、不预拉模型（`ai:listModels` 只在被调用时发网络请求）。
8. **非流式 MVP**：`ai:chat` 一次往返返回全文（流式留后续任务；LM Studio/Ollama 本地推理延迟可接受）。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `packages/platform/src/settings.ts` | `ai` 段 schema + 默认值 + merge/parse/clone 三处同步扩展 |
| `packages/platform/test/settings.test.ts` | ai 段默认值/合并/非法值测试 |
| `apps/desktop/src/shared/settings.ts` | 类型镜像（AppSettings/AppSettingsPatch + ai 段） |
| `apps/desktop/src/shared/ai.ts` | 线上契约类型（仅类型，无 zod——preload 红线照旧） |
| `apps/desktop/src/main/ai/types.ts` | `AiError` 类 + 错误码常量 + 内部类型 |
| `apps/desktop/src/main/ai/policy.ts` | URL 规范化 / 本地判定 / 云端门禁（纯） |
| `apps/desktop/src/main/ai/client.ts` | fetch 注入的 OpenAI 兼容客户端（纯） |
| `apps/desktop/src/main/ai/cache.ts` | 模型列表 TTL 缓存（纯，可注入时钟） |
| `apps/desktop/src/main/ai/service.ts` | `AiService`（门禁顺序 + 凭据 + 缓存 + 日志） |
| `apps/desktop/src/shared/ipc.ts` | `ai:*` 五通道 |
| `apps/desktop/src/main/ai/ipc.ts` | 五处理器（照 `main/sync/ipc.ts` 注册器范式） |
| `apps/desktop/src/main/index.ts` | 装配（`net.fetch` 包装注入；无需生命周期清理） |
| `apps/desktop/src/preload/index.ts` + `src/types/window.d.ts` | `septcats.ai.*` 五方法 |
| `apps/desktop/test/ai-policy.test.ts`、`ai-client.test.ts`、`ai-cache.test.ts`、`ai-service.test.ts` | 见 §3 |

## 2. 分步规格

### 2.1 `packages/platform/src/settings.ts`（精确扩展点）
- 新增常量与 schema（在 `EDIT_MODES` 后加 kind 常量）：
```ts
export const AI_PROVIDER_KINDS = ['lmstudio', 'ollama', 'openai-compatible'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];
```
- `appSettingsSchema` 增加 `ai` 段（放在 `sync` 后）：
```ts
  ai: z.object({
    /** 总开关（默认 false；关 = 所有 ai:* 通道拒绝）。 */
    enabled: z.boolean(),
    /** 云端调用显式开关（默认 false；非本地端点无它一律拒绝且不发请求）。 */
    cloudConsent: z.boolean(),
    /** 活动 provider（UI 选区；null = 未选）。 */
    activeProviderId: z.string().nullable(),
    providers: z.array(
      z.object({
        /** 凭据安全的短 id：^[a-z0-9][a-z0-9-]{1,27}$（account=ai-<id> ≤32 字符）。 */
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,27}$/),
        kind: z.enum(AI_PROVIDER_KINDS),
        name: z.string().min(1),
        /** http(s)://host[:port][/prefix]；规范化为根（剥尾部 /v1）。 */
        baseUrl: z.string().min(1),
        model: z.string().nullable(),
      }),
    ),
  }),
```
- `DEFAULT_APP_SETTINGS.ai = { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] }`。
- **三处同步扩展**（漏一处就漂移）：`cloneDefaultAppSettings`（深拷贝 ai + providers 数组）、`parseAppSettings`（`ai: isPlainObject(raw['ai']) ? {...默认, ...raw} : {...默认}`）、`mergeSettingsPatch`（同款浅合并；providers 数组为整体替换语义）。`data.note` 同款处理不动 `rootPath`。
- **测试**（`packages/platform/test/settings.test.ts` 追加）：默认含 ai 且全关/空；写读往返保留 providers；`kind:'claude'` 或 `id:'A!'` → `E_SETTINGS_INVALID`；缺 ai 段的旧文件读回不炸（补默认）。

### 2.2 `apps/desktop/src/shared/settings.ts`（镜像）
`AppSettings` 加 `ai`（与平台 schema 同形，含注释）；`AppSettingsPatch` 加 `ai?: Partial<AppSettings['ai']>`。

### 2.3 `apps/desktop/src/shared/ai.ts`（**仅类型**）
```ts
/** ai:* 的线上契约（T18-01）。仅类型：preload 不带 zod 运行时（照 shared/updater 红线）。 */
export type AiProviderKind = 'lmstudio' | 'ollama' | 'openai-compatible';

export interface AiProviderConfig {
  id: string;
  kind: AiProviderKind;
  name: string;
  baseUrl: string;
  model: string | null;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** ai:state → 渲染器视图（不泄露密钥；hasKey 为派生布尔）。 */
export interface AiStateSnapshot {
  enabled: boolean;
  cloudConsent: boolean;
  activeProviderId: string | null;
  providers: Array<{
    id: string;
    kind: AiProviderKind;
    name: string;
    baseUrl: string;
    isLocal: boolean;
    hasKey: boolean;
    model: string | null;
  }>;
}

export interface AiListModelsResult {
  models: string[];
  cached: boolean;
  fetchedAt: number;
}

export interface AiChatResult {
  text: string;
  model: string;
}

/** 稳定错误码（消息格式 CODE：中文详情）。 */
export const AI_ERROR_CODES = [
  'E_AI_DISABLED',
  'E_AI_NO_PROVIDER',
  'E_AI_NO_MODEL',
  'E_AI_CLOUD_DENIED',
  'E_AI_BAD_URL',
  'E_AI_UNREACHABLE',
  'E_AI_TIMEOUT',
  'E_AI_HTTP',
  'E_AI_BAD_RESPONSE',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];
```

### 2.4 `apps/desktop/src/main/ai/types.ts`
`export class AiError extends Error { readonly code: AiErrorCode; constructor(code, detail) { super(`${code}：${detail}`); this.name='AiError'; } }`（照 `SyncKeyError` 风格）。

### 2.5 `apps/desktop/src/main/ai/policy.ts`（纯函数）
```ts
export function normalizeBaseUrl(raw: string): string;
export function isLocalBaseUrl(baseUrl: string): boolean;
export function assertAiUrlAllowed(baseUrl: string, cloudConsent: boolean): string; // 返回规范化后的 url
```
行为：`normalizeBaseUrl` = trim → 必须 `http:`/`https:`（否则 `E_AI_BAD_URL`）→ 剥尾部多余 `/` 与 `/v1`（幂等：`.../v1` → `...`）；`isLocalBaseUrl` = hostname ∈ {`localhost`,`127.0.0.1`,`::1`,`[::1]`} 或 endsWith(`.localhost`)；`assertAiUrlAllowed` = normalize → 非本地且 `!cloudConsent` → `E_AI_CLOUD_DENIED`（详情写「非本地端点需在设置中显式开启云端调用」）→ 返回规范化 url。

### 2.6 `apps/desktop/src/main/ai/client.ts`（fetch 注入）
```ts
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
  modelListTimeoutMs?: number; // 默认 8_000
  chatTimeoutMs?: number;      // 默认 120_000
}

export class AiClient {
  constructor(options: AiClientOptions);
  listModels(baseUrl: string, apiKey: string | null): Promise<string[]>;
  chat(
    baseUrl: string,
    apiKey: string | null,
    model: string,
    messages: AiMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<{ text: string; model: string }>;
}
```
- URL：`${baseUrl}/v1/models`、`${baseUrl}/v1/chat/completions`；`Authorization: Bearer <key>` 仅在 apiKey 非 null；`content-type: application/json`；超时用 `AbortSignal.timeout(ms)`。
- chat 请求体：`{ model, messages, stream: false, max_tokens?, temperature? }`（可选字段 undefined 时不出现）。
- 错误映射（全部 `AiError`）：fetch 抛 AbortError/TimeoutError→`E_AI_TIMEOUT`；其余抛→`E_AI_UNREACHABLE`（详情含原因）；`!ok`→`E_AI_HTTP：HTTP <status>（<base>/v1/...）`；JSON 解析失败或形状不对（`data[].id` 非字符串 / `choices[0].message.content` 非字符串）→`E_AI_BAD_RESPONSE`。模型列表去重保序。

### 2.7 `apps/desktop/src/main/ai/cache.ts`
```ts
export class ModelListCache {
  constructor(ttlMs?: number, nowFn?: () => number); // 默认 60_000 / Date.now
  get(key: string): { models: string[]; fetchedAt: number } | null;
  set(key: string, models: string[], fetchedAt?: number): void;
  invalidate(key?: string): void;
}
```
键 = `${providerId}|${baseUrl}`（由 service 拼）。过期条目 get 返回 null 并删除。

### 2.8 `apps/desktop/src/main/ai/service.ts`
```ts
export interface AiServiceOptions {
  credentials: CredentialStore;
  getSettings: () => AppSettings;      // 每次调用现读（settings 热更新）
  fetchFn: AiFetch;
  log: (line: string) => void;
  now?: () => number;                  // 默认 Date.now
  cacheTtlMs?: number;                 // 默认 60_000（测试注入 0/大值）
  modelListTimeoutMs?: number;
  chatTimeoutMs?: number;
}
export class AiService {
  state(): Promise<AiStateSnapshot>;
  listModels(input: { providerId: string; refresh?: boolean }): Promise<AiListModelsResult>;
  chat(input: { providerId: string; messages: AiMessage[]; maxTokens?: number; temperature?: number }): Promise<AiChatResult>;
  setKey(input: { providerId: string; key: string }): Promise<{ ok: true }>;
  clearKey(input: { providerId: string }): Promise<{ ok: true }>;
}
```
**每个网络操作的门禁顺序**（`state/setKey/clearKey` 不走前两步）：
`ai.enabled`？否→`E_AI_DISABLED` → provider 存在？否→`E_AI_NO_PROVIDER` → `assertAiUrlAllowed(baseUrl, cloudConsent)`（云门禁，**此处拒绝时 fetchFn 一次都不能被调用**）→ 取 key（`credentials.get('septcats','ai-'+id)`，`CredentialUnavailableError` 原样透传）→ 发请求。
- `chat` 额外：`model = provider.model`，null→`E_AI_NO_MODEL`（「先在设置中选择模型」）。
- `listModels`：cache.get(key) 命中且 `!refresh` → `{models, cached:true, fetchedAt}`；否则客户端拉取 → cache.set → `cached:false`。**不做后台预热**。
- `state()`：对每个 provider `await credentials.get(...) !== null` 派生 hasKey（≤10 个 provider 可接受；失败按 false，不抛）。
- 日志：`ai listModels provider=<id> host=<host> → ok(2 models, 34ms)` 样式，**无正文无密钥**。

### 2.9 `src/shared/ipc.ts` + `src/main/ai/ipc.ts`
通道（放在 UPDATE 段后新起 AI 段）：
```ts
/** AI（M11 · TASK-T18-01 §2.9） */
export const CHANNEL_AI_STATE = 'ai:state';
export const CHANNEL_AI_LIST_MODELS = 'ai:listModels';
export const CHANNEL_AI_CHAT = 'ai:chat';
export const CHANNEL_AI_SET_KEY = 'ai:setKey';
export const CHANNEL_AI_CLEAR_KEY = 'ai:clearKey';
export const AI_CHANNELS = {
  state: CHANNEL_AI_STATE,
  listModels: CHANNEL_AI_LIST_MODELS,
  chat: CHANNEL_AI_CHAT,
  setKey: CHANNEL_AI_SET_KEY,
  clearKey: CHANNEL_AI_CLEAR_KEY,
} as const;
export type AiChannel = (typeof AI_CHANNELS)[keyof typeof AI_CHANNELS];
```
`main/ai/ipc.ts`：`registerAiIpc({ registrar, getService })`；`getService()===null`→`E_INVARIANT`；入参守卫（`readProviderId/readMessages/readKey`）非法→`PagesApiError('E_MALFORMED', ...)`；messages 校验：数组 1..64 条、role ∈ 三值、content 为 string 且总长 ≤ 200_000 字符；`AiError` 直接透传（消息自带码）。头注释列五通道。

### 2.10 preload + window.d.ts
- `window.d.ts` 新 `SeptcatsAiApi`（五方法，入出参用 `../shared/ai` 类型）；`SeptcatsApi` 加 `ai: SeptcatsAiApi`；注释「错误经 Error.message 透传（E_AI_* / E_CRED_UNAVAILABLE / E_INVARIANT / E_MALFORMED）」。
- preload 照 sync 块写法（`ipcRenderer.invoke(AI_CHANNELS.x, ...) as ReturnType<...>`）。

### 2.11 `main/index.ts` 装配
在 `registerIpcHandlers` 里（`registerSyncIpc` 之后）：
```ts
  const aiLogger = ctx.logger.forModule('ai');
  const aiService = new AiService({
    credentials: ctx.credentials,
    getSettings: () => readSettings(ctx.userDataDir),
    fetchFn: async (url, init) => {
      const response = await net.fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: init.signal,
      });
      return { ok: response.ok, status: response.status, text: () => response.text() };
    },
    log: (line) => aiLogger.info(line),
  });
  registerAiIpc({ registrar: dbViewRegistrar(), getService: () => aiService });
```
（`net` 已在 index.ts import；AiService 无常驻资源，无需清理。）

## 3. 测试（新增 4 个文件 + 1 处扩展；先写测试后实现亦可，但每个文件落盘后立即跑）
- `test/ai-policy.test.ts`：normalize（` http://HOST:1234/v1/ `→`http://host:1234`、缺 scheme→BAD_URL、`https` 保留）；isLocal（localhost/127.0.0.1/[::1]/sub.localhost true；192.168.1.5、example.com false）；`assertAiUrlAllowed`（本地放行、非本地无 consent→`E_AI_CLOUD_DENIED`、有 consent 放行）。
- `test/ai-client.test.ts`（假 fetch）：listModels 正常（断言 URL/无 Authorization 当 key=null）；chat 正常（断言 URL、`Authorization: Bearer k`、body.model/messages、`stream:false`）；HTTP 500→`E_AI_HTTP`；坏 JSON→`E_AI_BAD_RESPONSE`；fetch 抛普通错→`E_AI_UNREACHABLE`；抛 `AbortError`→`E_AI_TIMEOUT`；`{data:[]}`→空数组不炸。
- `test/ai-cache.test.ts`：TTL 内命中/过期 miss（假时钟）；键隔离（同 provider 改 baseUrl 不吃旧缓存）；invalidate。
- `test/ai-service.test.ts`（假 CredentialStore + 假 fetch）：
  1) `enabled:false` → 所有网络方法 `E_AI_DISABLED` 且 fetch 零调用；
  2) 未知 providerId → `E_AI_NO_PROVIDER`；
  3) **非本地 + 无 consent → `E_AI_CLOUD_DENIED` 且 `fetchFn` 零调用（隐私硬断言）**；同 provider 开 consent 后放行；
  4) `model:null` 的 chat → `E_AI_NO_MODEL`；
  5) listModels 二次调用 `cached:true` 且 fetch 只 1 次；`refresh:true` 再拉（fetch 2 次）；
  6) setKey 后 `state().providers[].hasKey===true`；clearKey 后 false；**state 返回值 JSON 里不含 key 明文**；
  7) chat 把 provider 配置正确透传到 client（fake fetch 断言 host/model/消息体）。
- `packages/platform/test/settings.test.ts` 扩展见 §2.1。
- 既有 `test/settings.test.ts`（desktop）如覆盖 get/patch 往返，补 ai 段往返一条（先读文件，不许改既有断言）。

## 4. DoD（PM 复跑）
```bash
pnpm -r typecheck && pnpm -r test && node packages/ui/tokens/no-magic.mjs
```
+ 计数对账（新增用例数如实列）；git 红线：`git diff --stat packages/sync packages/core` 为空；`packages/platform` 只出现 settings.ts 与其测试。

## 5. 纪律
`packages/sync`/`packages/core` 零改动；`packages/platform` 只动 settings.ts+测试；不碰 git；禁占位符/TODO；不新增依赖（全部 stdlib + 既有 zod）；测试文件头注释照既有风格（zh-CN，说明覆盖点）；报告不适用（本轮小块，任务书即规格；收尾在最终回复列文件清单+命令输出摘要）。

## 6. 后续任务（不在本轮；勿提前实现）
- **T18-02**：设置页「AI 助手」区块——provider 列表 CRUD（预设 LM Studio/Ollama 一键添加）、连通性测试、模型下拉（listModels+refresh）、密钥设置/清除、云端开关（含风险文案）。
- **T18-03**：编辑器块级 AI 动作（续写/摘要/改写/翻译，选中文本或整块）+ 命令面板入口 + `shared/aiPrompts.ts` prompt 单一来源 + 四态 UI + CDP 真机（含 LM Studio 实机连通）。
- **T18-04**：AI 属性类型（行内数据库列，依赖 dbview 类型注册表）。
