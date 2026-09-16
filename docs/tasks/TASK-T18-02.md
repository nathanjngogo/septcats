# TASK-T18-02 · M11 AI 集成（2/3）：设置页「AI 助手」区块（provider 管理 / 密钥 / 测试连接）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：TASK-T18-01 已交付（HEAD `50ecbca`，开工前 `git log -1` 确认）
> 依据：M11「Provider 抽象…端点白名单与'云端调用需显式开关'（你的隐私默认）」+ T18-01 落地的 `ai:*` 五通道。
> **本任务纯 renderer**：`SettingsPage.tsx`(+css) / 新组件 `AiSection`(+css) / i18n / settings-react 测试。
> **红线（零改动，verify-by-commit-范围内一行为算偏）：`packages/*`、`apps/desktop/src/main/**`、`preload`、`window.d.ts`、`shared/ipc.ts`、`shared/ai.ts`、`shared/settings.ts`——main 侧本次一个字都不许动**。
> 纪律：不碰 git；禁占位符/TODO；CSS 只吃 `var(--sc-*)`（改完自跑 `node packages/ui/tokens/no-magic.mjs`）；不许改既有测试断言语义（只许按 §4 追加）；不要跑全仓 `pnpm -r test` 与 selftest（PM 收口）。

## 0. PM 设计裁决（照此实现）

1. **数据源**：`ai.state()` 为本区块唯一数据源（mount 拉取一次 + 每次 patch/密钥/添加/删除后重新拉取）。provider 编辑/删除只经 `settings.patch({ ai: { providers: … } })`（整体替换语义，T18-01 schema 已定）；禁用全局 `saving`，区块内自管 busy。
2. **创建流**：添加弹窗三选预设——LM Studio（`kind:'lmstudio'`，`baseUrl:'http://127.0.0.1:1234'`）、Ollama（`kind:'ollama'`，`baseUrl:'http://127.0.0.1:11434'`）、自定义 OpenAI 兼容（`kind:'openai-compatible'`）；自定义需填名称+端点。`id` 客户端生成：`` `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` ``（base36，11~15 字符，满足 schema 正则）。编辑弹窗只改 name/baseUrl（kind 创建后不可改）。
3. **模型下拉**：在**已保存的 provider 行内**（不在创建弹窗——新 provider 未落盘，服务端拿不到配置）。点击/展开时 `listModels({providerId, refresh?})`，四态（loading/error/空/成功），带手动「刷新」（`refresh:true` 强制绕过 60s TTL）。选中写入 `settings.patch({ai:{providers:[…，model: xxx]}})`。
4. **密钥**：行内按钮 → 弹窗（显示当前 hasKey 状态 + 密码输入框 + 保存/清除）。`ai.setKey`/`ai.clearKey`。清除需 destructive 确认弹窗。**删除 provider 时顺带 `ai.clearKey(id)`（尽力而为，失败不阻断删除）**，防孤儿凭据。
5. **网络操作门控**：`ai.enabled === false` 时，「测试连接」与模型下拉禁用并提示「请先启用 AI」；provider 增删改与密钥设置不禁用（配置先行）。
6. **默认 provider**：行内 radio（name=`ai-active`，aria-label「设为默认」），选中 → `patch({ai:{activeProviderId:id}})`，供 T18-03 编辑器动作使用。
7. **云端开关**：Switch 行，desc 明示「非本地端点会离开本机」；`!enabled` 时该 Switch 禁用。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `apps/desktop/src/renderer/src/settings/AiSection.tsx` | 区块组件（fieldset 内三区：开关×2 / provider 列表 / 添加按钮 + 弹窗×4：添加编辑、密钥、清除确认、删除确认） |
| `apps/desktop/src/renderer/src/settings/AiSection.css` | 新类（token-only；行卡片/徽标/下拉/inline 反馈） |
| `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` | 在「同步密钥」fieldset 之后插入 `<AiSection />` 的 fieldset 壳 + import（区块自身管 i18n/busy） |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | `settings.ai.*` 段（全文见 §2.3） |
| `apps/desktop/test/settings-react.test.tsx` | 桥补 `ai` 子桥 + 新 describe 6 用例（§4） |

无 main/平台改动（红线）。不做 CDP 真机（并入 T18-03 验收脚本一起跑）。

## 2. 分步规格

### 2.1 组件结构（AiSection.tsx 骨架，照此实现）
```tsx
export function AiSection(): JSX.Element {
  // state：
  //   aiState: AiStateSnapshot | null（null = 加载中）
  //   busy  : Record<string, boolean>（per-provider 行内动作：test/model）
  //   result: Record<string, { ok: boolean; text: string }>（测试连接/模型反馈，行内显示）
  //   弹窗开关×4 + form 字段（name/baseUrl）+ editId: string | null + kindPreview
  //   keyDialogId / keyInput / keySaving
  // mount：loadAiState()；此后每成功交互后重拉（统一 refresh(): AiStateSnapshot = await ai.state()）
}
```
- 开关行：`<Switch checked={aiState?.enabled ?? false} onCheckedChange={(on)=>{patch({ai:{enabled:on}}).then(refresh)}} />`；云端开关同款（disabled=`!enabled`）。
- provider 行卡片（`<div className="settings-ai-card">`）：
  - 左：radio（`name="ai-active"`，`checked={activeProviderId===p.id}`）+ 名称 + kind 徽标（`settings-ai-badge--lmstudio/ollama/custom`，文案 `settings.ai.providerKindLmstudio` 等短名）+ baseUrl（mono，`title` 完整）
  - 中：模型 `<select>`（aria-label="模型"）+ 本地/云端徽标（来自 `isLocal`）+ `hasKey` 状态（「已设置/未设置」）
  - 右：测试连接 / 密钥 / 编辑 / 删除 四按钮（`variant="ghost" size="sm"`，测试连接 loading 态用行 busy）
- 「+ 添加模型服务」按钮（`variant="secondary"`）→ 添加弹窗。
- 空态：`emptyProviders` 文案。
- 测试连接：`ai.listModels({ providerId, refresh: true })` → `result.ok` 文案「已连接，{n} 个模型」；catch →「连接失败：{msg}」（msg 从 Error.message 提取，含 `E_AI_*` 前缀照展示）。
- 模型下拉 onOpen/onFocus 触发加载（首次）+ 手动刷新按钮；选项写入 model；`e_AI_*` 错误在行内提示并可重试。
- 密钥弹窗：显示当前 hasKey；`ai.setKey({providerId, key})` → 成功刷新 + `keySaved` 反馈；「清除密钥」→ 确认弹窗 → `clearKey` → `keyCleared`。
- 删除：确认弹窗（名字用 {name} 插值）→ `await ai.clearKey(id).catch(()=>{})` 然后 patch providers 过滤。

### 2.2 utils
- `patchAi(patch: { enabled?: boolean; cloudConsent?: boolean; activeProviderId?: string | null; providers?: AiProviderConfig[] })`：`await window.septcats.settings.patch({ ai: patch })` 后 `refresh()`。
- `describeAiError(error): string`：`error instanceof Error ? error.message : String(error)`（消息自带 `E_AI_*：` 前缀）。
- `fillTemplate` 复用 SettingsPage 的（如需插值请本地小实现 `{n}/{name}/{msg}`，勿改 SettingsPage 导出）。

### 2.3 i18n 全文（`settings` 段 `recovery` 之后插入 `ai`）
```ts
    ai: {
      title: 'AI 助手',
      enable: '启用 AI',
      enableDesc: '开启后可调用本地/云端模型；配置好模型服务即用',
      cloud: '允许云端模型',
      cloudDesc: '非本地端点（local 以外）需显式开启；云端请求会离开本机',
      providers: '模型服务',
      addProvider: '添加模型服务',
      emptyProviders: '还没有模型服务，点击「添加模型服务」开始',
      activeHint: '默认',
      localBadge: '本地',
      cloudBadge: '云端',
      test: '测试连接',
      testOk: '已连接，{n} 个模型',
      testFail: '连接失败：{msg}',
      modelLabel: '模型',
      modelNone: '（未选择模型）',
      modelRefresh: '刷新',
      modelLoading: '加载模型中…',
      modelEmpty: '未获取到模型（请确认服务已启动）',
      keyLabel: '密钥',
      keySet: '已设置',
      keyUnset: '未设置',
      keyDialogTitle: 'API 密钥',
      keyDialogBody: '密钥只存入系统凭据存储（DPAPI），不写入设置文件或日志。',
      keyPlaceholder: '输入 API 密钥',
      keySave: '保存',
      keyClear: '清除密钥',
      keyClearConfirmTitle: '清除密钥',
      keyClearConfirmBody: '清除后该服务需重新输入密钥才能发起云端请求。确定清除？',
      keySaved: '密钥已保存',
      keyCleared: '密钥已清除',
      removeConfirmTitle: '删除模型服务',
      removeConfirmBody: '删除「{name}」并同时清除其保存的密钥？',
      removeConfirm: '确认删除',
      providerDialogNewTitle: '添加模型服务',
      providerDialogEditTitle: '编辑模型服务',
      providerName: '名称',
      providerBaseUrl: '端点地址',
      providerBaseUrlPlaceholder: 'http://127.0.0.1:1234',
      providerKindLmstudio: 'LM Studio（本地）',
      providerKindOllama: 'Ollama（本地）',
      providerKindCustom: 'OpenAI 兼容（任意端点）',
      providerSave: '保存',
      providerCancel: '取消',
      enableFirstHint: '请先启用 AI',
    },
```

### 2.4 CSS（token-only；照既有 `settings-*` 写法）
`.settings-ai-card`（行卡片：flex、边框、圆角、底距）、`.settings-ai-badge` + 三变体（色 token 取既有语义变量，禁字面 hex）、`.settings-ai-mono`、`.settings-ai-inline-ok`（成功色）、`.settings-ai-inline-error`（danger 色）、`.settings-ai-select`（宽度约束）。数值/字体照 `.settings-preview` / `.sc-sync-status__*` 的既有 token 用法抄。

## 3. SettingsPage 集成
- `SettingsPage.tsx`：import `AiSection`；在「同步密钥」fieldset（`settings.recovery.title`）之后、「诊断」之前插入：
```tsx
          <AiSection />
```
- AiSection 自带 i18n/busy/弹窗；头注释三区块列表补「- AI 助手（T18-02）」。

## 4. 测试（settings-react.test.tsx）

- `installBridge` bridge 补 `ai` 子桥（照 sync 子桥写法）：
```ts
    ai: {
      state: vi.fn(async () => ({
        enabled: false,
        cloudConsent: false,
        activeProviderId: null,
        providers: [
          { id: 'plocal1', kind: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234', isLocal: true, hasKey: false, model: null },
        ],
      })),
      listModels: vi.fn(async () => ({ models: ['qwen-7b', 'deepseek-v3'], cached: false, fetchedAt: 1 })),
      chat: vi.fn(async () => ({ text: 'ok', model: 'qwen-7b' })),
      setKey: vi.fn(async () => ({ ok: true })),
      clearKey: vi.fn(async () => ({ ok: true })),
    },
```
`installBridge` 返回值扩展 `ai` 三件 mock（state/listModels/rotateKey 不需要）——只暴露 `listModels`、`setKey`（断言用），既有解构不受影响。`defaultSettings()` （含既有 fixture）须含 `ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] }`（先读文件，`settings` 返回对象同步补，不改既有断言）。

- 新 describe「设置页 · AI 助手（T18-02）」，6 用例：
  1. 渲染：`findByText('AI 助手')`；启用开关反映 `settings.ai.enabled`（初始 false → `getByRole('switch', { name: '启用 AI' })` 状态为 off）。
  2. 启用开关点击 → `settings.patch` 收到 `{ai:{enabled:true}}` 且再次 `ai.state` 被调（refresh 生效）。
  3. 添加 LM Studio 预设：点「添加模型服务」→ 弹窗点「LM Studio（本地）」→ 点「保存」→ patch 的 providers 含新项（`kind:'lmstudio'`、`baseUrl:'http://127.0.0.1:1234'`、id 匹配 `/^p[a-z0-9]{6,}$/`）。
  4. 模型下拉：点 provider 行的模型下拉触发加载 → `listModels` 被调（参数含 providerId）→ 选项「qwen-7b」出现；选中后 patch 写 `model:'qwen-7b'`。
  5. 测试连接：点「测试连接」→ 成功 inline 文案「已连接，2 个模型」；`listModels.mockRejectedValueOnce(new Error('E_AI_UNREACHABLE：端点不可达：…'))` → 文案「连接失败」。
  6. 密钥：点「密钥」→ 弹窗显示「未设置」→ 填 key 点「保存」→ `setKey({providerId:'plocal1', key:'sk-test'})` 被调 → 弹窗成功态「密钥已保存」；再点「清除密钥」→ 确认弹窗「确认删除」同款流程 → `clearKey` 被调。
  7. 云端开关在 `enabled:false` 时 disabled：`getByRole('switch', { name: '允许云端模型' })` 禁用态成立。

## 5. DoD（PM 复跑）
```bash
pnpm -r typecheck && pnpm -r test && node packages/ui/tokens/no-magic.mjs && pnpm -C apps/desktop selftest
```
+ 红线核验：`git diff --stat -- packages apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/shared apps/desktop/src/types apps/desktop/src/renderer/src/sync/SyncStatus.tsx` 仅期望路径为空或只含本任务许可文件。真机 CDP 验收并入 T18-03（不另开）。

## 6. 纪律
不碰 git；不新增依赖；禁占位符/TODO；每改一组立即自跑：`cd apps/desktop && npx vitest run test/settings-react.test.tsx test/sync-ui.test.tsx test/settings.test.ts` 与 `node packages/ui/tokens/no-magic.mjs`、收尾 `pnpm -r typecheck`。完成后回复：改动文件清单 + 每条命令最后一次输出摘要。