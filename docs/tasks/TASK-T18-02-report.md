# TASK-T18-02 · 报告：M11 AI 集成 2/3 —— 设置页「AI 助手」区块（纯 renderer）

> 工程师：CodeBuddy ｜ PM：Hermes ｜ 日期：2026-09-17 ｜ 前置 HEAD `50ecbca`（T18-01，开工 `git log -1` 已确认）
> 红线遵守：`packages/*`、`apps/desktop/src/main/**`、`preload`、`window.d.ts`、`shared/ipc.ts`、`shared/ai.ts`、`shared/settings.ts` **零 diff**（`git diff --stat -- packages apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/shared apps/desktop/src/types` 为空，见 §5）；**不碰 git**（全程未 add/commit）；CSS 全部 `var(--sc-*)` token（no-magic ✓）；未跑全仓 `pnpm -r test` 与 selftest（PM 收口）。

## 1. 交付表

| 文件 | 内容 |
|---|---|
| `apps/desktop/src/renderer/src/settings/AiSection.tsx`（新建） | 区块组件：mount 拉 `ai.state()` 唯一数据源 + `refresh()` 统一重拉；`patchAi()` 走 `settings.patch({ai:…})`（整体替换语义）后 refresh；自管 busy（per-provider `test:/model:`）+ 行内 result 反馈；不碰全局 saving。含：启用/云端两 Switch 行（云端 `disabled={!enabled}`）、provider 行卡片（radio `ai-active` + kind 徽标 + baseUrl mono + 模型 `<select>` 四态 + 本地/云端徽标 + hasKey 状态 + 测试连接/密钥/编辑/删除四按钮）、添加弹窗（三预设：LM Studio `:1234` / Ollama `:11434` / 自定义需名称+`^https?://` 端点；id 客户端生成 `p{Date.now().toString(36)}{rand4}`）、编辑弹窗（只改 name/baseUrl）、密钥弹窗（hasKey 状态 + password 输入 + 保存/清除，清除走 destructive 确认弹窗）、删除确认弹窗（`{name}` 插值；删除前 `ai.clearKey(id).catch(()=>{})` 尽力而为）。网络门控：`!enabled` 时测试连接与模型下拉（含刷新）禁用 + `title` 提示「请先启用 AI」，增删改与密钥不禁用（配置先行） |
| `apps/desktop/src/renderer/src/settings/AiSection.css`（新建） | 13 新类：`.settings-ai-card/-card-head/-card-mid/-name/-active-hint/-baseurl/-mono/-select/-key-state/-actions/-badge(--lmstudio/--ollama/--custom/--local/--cloud)/-inline-ok/-inline-error/-empty/-presets/-field/-input`，全部 token（颜色取 accent/accent-soft/danger-soft/danger/success/surface/surface-raised/hairline/ink*，无字面 hex、无重复裸 px） |
| `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` | import `AiSection`；「同步密钥」fieldset 之后、「诊断」之前插入 fieldset 壳（legend=`settings.ai.title`）+ `<AiSection />`；头注释补「AI 助手（T18-02）」与区块列表 |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | `settings` 段 `recovery` 之后插入 `ai` 全文（§2.3 照抄，见 §3 DEVIATIONS 追加 2 键） |
| `apps/desktop/test/settings-react.test.tsx` | `installBridge` 桥补 `ai` 子桥（state/listModels/chat/setKey/clearKey，enabled:false + plocal1 夹具）；返回值扩展 `listModels`/`setKey`（既有解构不受影响）；新 describe「设置页 · AI 助手（T18-02）」7 用例（§2） |

测试增量：19 → 26（+7，全部追加，既有断言语义零改动）。

## 2. 测试用例（7 条全绿）

1. **渲染**：`AI 助手` legend 出现；`getByRole('switch', {name:'启用 AI'})` aria-checked=false（隐私默认）。
2. **启用开关**：点击 → `patch` 收到 `{ai:{enabled:true}}` 且 `ai.state` 被重拉（1→2 次，refresh 生效）。
3. **添加 LM Studio 预设**：添加弹窗 → 点「LM Studio（本地）」→ 保存 → patch 的 providers 长 2，新项 `kind:'lmstudio'`、`baseUrl:'http://127.0.0.1:1234'`、id 匹配 `/^p[a-z0-9]{6,}$/` 且 ≠ plocal1。
4. **模型下拉**（enabled:true 覆盖桥）：点开触发 `listModels`（参数含 providerId）→ 选项 qwen-7b 出现 → change 选中后 patch 写 `model:'qwen-7b'`。
5. **测试连接**（enabled:true 覆盖桥）：成功 inline「已连接，2 个模型」；`mockRejectedValueOnce(E_AI_UNREACHABLE…)` → inline「连接失败：E_AI_UNREACHABLE：…」。
6. **密钥**：弹窗内「密钥：未设置」→ 填 sk-test 保存 → `setKey({providerId:'plocal1', key:'sk-test'})` + 「密钥已保存」→ 清除密钥 → 确认弹窗「确认删除」→ `clearKey({providerId:'plocal1'})` + 「密钥已清除」。
7. **云端开关禁用态**：`enabled:false` 时 `getByRole('switch', {name:'允许云端模型'}).disabled === true`。

实现备注：用例 4/5 需要 `enabled:true`，经 `installEnabledAiBridge()`（`installBridge` 的 `overrides` 参数覆盖 `ai` 子桥）提供，默认桥保持 §4 夹具 `enabled:false` 不动。

## 3. SSIM-NOTE / DEVIATIONS

- **DEVIATION-1（i18n 追加 2 键）**：§2.3 全文照抄之外，`settings.ai` 段追加 `editButton: '编辑'`、`removeButton: '删除'`。原因：§2.1 规定行卡片四按钮含「编辑/删除」，但 §2.3 文案表未给这两个短键（`providerDialogEditTitle`/`removeConfirmTitle` 是弹窗标题，不作按钮文案）；zh-CN 全字典亦无既有「编辑/删除」短文案可复用。新增键不触碰任何既有键。
- **DEVIATION-2（清除密钥确认按钮文案）**：确认弹窗按钮复用 `removeConfirm: '确认删除'`（§4 用例 6 原文「确认弹窗『确认删除』同款流程」），未新造 `keyClearConfirm*` 按钮键。
- **SSIM-NOTE（模型下拉空态/加载态）**：`<select>` 四态实现为选项替换——loading→`modelLoading`、空→`modelEmpty`、成功→`modelNone`（或当前 model）+ 模型项（过滤与当前 model 重复项）、error→`modelNone` + 行内 `E_AI_*` 错误 + 「刷新」重试按钮；触发面 = select 的 onClick/onFocus（首次）+ 手动刷新（`refresh:true` 绕 TTL）。
- **SSIM-NOTE（测试连接复用 listModels）**：按 §2.1 用 `listModels({providerId, refresh:true})` 充当连通性探测，成功同时回填模型下拉缓存态。

## 4. 验证（每条命令最后一次输出）

| 命令 | 结果摘要 |
|---|---|
| `npx vitest run test/settings-react.test.tsx test/sync-ui.test.tsx test/settings.test.ts`（apps/desktop） | `Test Files 3 passed (3) / Tests 26 passed (26)` |
| `pnpm -r typecheck` | 各包 Done，`apps/desktop typecheck: Done`（0 错；期间修 2 处 exactOptionalPropertyTypes/noUncheckedIndexedAccess） |
| `node packages/ui/tokens/no-magic.mjs` | `✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px` |
| 红线核验 `git status --short` | 仅 `M zh-CN.ts`、`M SettingsPage.tsx`、`M settings-react.test.tsx`、`?? settings/`（本任务新目录）、`?? docs/tasks/TASK-T18-02.md`；禁改路径 diff 为空 |

## 5. 红线核验

`git diff --stat -- packages apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/shared apps/desktop/src/types apps/desktop/src/renderer/src/sync/SyncStatus.tsx` → **空输出**（零改动）。未新增依赖；无占位符/TODO；未跑全仓 `pnpm -r test` 与 selftest。真机 CDP 验收按任务书并入 T18-03。

## 6. PM 复跑与亲修（2026-09-17）

**PM 亲修 4 处**（3 处产品代码 + 1 处既有测试）：

1. **密钥弹窗反馈恒绿**：失败消息（`E_*：…` / Electron IPC 包装串）也用 `settings-ai-inline-ok` 渲染 → 改为结构化 `{ok,text}`，失败走 `settings-ai-inline-error`。
2. **编辑弹窗可保存空端点**：只校验名称，清空 baseUrl 会把 `''` 送进 zod `min(1)`（E_SETTINGS_INVALID）→ 补 baseUrl 非空门禁（与添加弹窗对齐）。
3. **删除默认 provider 后 `activeProviderId` 悬空**：删除的正是默认项时，同一次 patch 内置 `activeProviderId: null`。
4. **flaky（根因级）**：既有 T10 用例 `screen.getAllByRole('radio')).toHaveLength(3)` 是全局计数，被本任务新增的 provider radio 撞上，随 `ai.state()` 异步落地时序漂移（实测 2 红 1 绿）→ 作用域收窄为 `within(主题 radiogroup)`（断言原意「主题三选」不变）；同族全局计数断言已全仓排查（仅此一处）。

**PM 复跑**：受影响三文件连跑 3× 稳定 `26/26`；全仓 `pnpm -r test` **272/272**（desktop 265→272，+7 = 本任务 7 用例）；`pnpm -r typecheck` 9/9 Done；`node packages/ui/tokens/no-magic.mjs` ✓；`pnpm -C apps/desktop selftest` SELFTEST OK。

**DEVIATIONS 两条接受**：`editButton/removeButton` 为行内按钮补键（§2.3 漏列）；清除密钥确认按钮复用 `removeConfirm`（与 §4 用例 6 原文一致）。
