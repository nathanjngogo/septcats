# TASK-T46-01 · P3：AI 对话健壮性——可配置超时 + 空正文/纯推理响应提示

> PM：Hermes ｜ P3（T38-01 真机复跑中发现的体验隐患，非阻断）｜ 可与任一低风险单合并派发
> 起因（有实测依据，原文见 `docs/tasks/TASK-T38-01-report.md` §PM 真机复跑 · 第二轮）：
> 1. **超时固定**：`apps/desktop/src/main/ai/client.ts` `DEFAULT_CHAT_TIMEOUT_MS = 120_000`，`AiService` 注入未传 `chatTimeoutMs` → 用户可选的慢模型（本机 27B 推理模型实测单轮 **78.6s**）稍慢就会撞 `E_AI_TIMEOUT`。
> 2. **空正文无提示**：产品只取 `choices[0].message.content`，**不透出 `reasoning_content` / `finish_reason`** → 纯推理型响应（content 为空、只有 reasoning）在 UI 上表现为**「空回复」且无任何说明**，用户会误认为卡死/丢消息。
> 3. **面板不透出 `max_tokens`**：`AiChatPanel.send()` 只传 `providerId + messages` → 请求体无 `max_tokens`，由端点默认值决定；端点默认过小则推理模型可能只出 reasoning。

## 1. 必须做到

1. **超时可配置**：AI 设置里新增「请求超时」（秒，建议范围 30–600，默认保持现值 120s）；`AiService` 注入读取该设置 → `chatTimeoutMs` 生效；非法/越界值夹紧。**默认行为不得改变**（未设置时仍是 120s）。
2. **空正文/纯推理的可读呈现**：当 `content` 为空但响应成功时：①消息气泡显示**可读提示**（如「模型未返回正文（仅推理内容）」），②若响应里带 `reasoning_content`，以**可折叠**形式展示（默认收起，避免刷屏），③`finish_reason === 'length'` 时提示「达到输出上限，可增大 max_tokens 或重试」。**不得**把空回复渲染成空白气泡。
3. **超时文案可读**：`E_AI_TIMEOUT` 在面板上给出「等待超过 N 秒已中止」并提示可在设置里调大（不许只显示原始错误码）。
4. **（可选，若风险低）面板 max_tokens**：设置里新增可选「最大输出 tokens」，面板请求带上；未设置则保持现状（不带该字段）。
5. **不做**：不做多会话、不做重试队列、不做流式（流式属另一单）。

## 2. 验收（数值化）

1. **超时**：把超时设为 5s + 指向一个慢端点（或桩）→ 断言 5s 左右中止且文案含「5 秒」（贴耗时与文案）；设回 300s → 断言不再提前中止（贴耗时）。
2. **空正文**：用桩响应 `{content:"", reasoning_content:"…", finish_reason:"length"}` → 断言气泡显示提示文案、折叠区可展开、无空白气泡（截图）。
3. **默认不回归**：未设置时仍为 120s（断言注入值 = 120000）。
4. **真实端点回归**：本机 `http://127.0.0.1:1234/v1`（模型 `master` 或 `ternary-bonsai-2-27b-pq2_0`）真机跑一轮，正常回复仍正常渲染（贴耗时）。**（该端点免鉴权、本地，可直接用）**
5. 回归：全仓无红；typecheck 9/9；双门禁 ✓；双主题截图。

## 3. 红线

- 允许动：`apps/desktop/src/main/ai/**`（**只增不改既有语义**：新增配置读取与呈现数据，不改既有错误码含义）、`apps/desktop/src/renderer/src/ai/**`、设置页与 i18n、`shared/ipc.ts`/`preload`（仅新增字段）、`apps/desktop/test/**`。
- 不碰：`packages/**`（含 `DESIGN.md`/tokens）、其它 `main/**` 模块、CI。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（需调整 §DEVIATION 逐条）。
- **隐私硬不变量不得放宽**：云端默认关、非本地端点无 consent 零外呼、密钥只进 CredentialStore。
- UI 红线：CSS 只走 `var(--sc-*)`、无字面 hex、双主题四态齐备。

## 4. 交付物

代码 + 测试（超时夹紧/生效/默认不变、空正文与 length 提示、超时文案）+ 真机数值与截图 + `docs/tasks/TASK-T46-01-report.md`（PM 复跑节留「（PM 补）」；DEVIATION 逐条）。
