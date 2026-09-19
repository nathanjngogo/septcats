# TASK-T38-01 交付报告 · R2：AI 对话框（右侧可收起面板 · 多轮对话）

> 工程师：CodeBuddy（唯一作者）｜日期：2026-09-19
> 前置确认：起点 `2cb3e7f docs(t38-01): AI 对话框任务书…`（T37-01 收口 `b141001` 之后）✓
> 任务书：docs/tasks/TASK-T38-01.md（§0 口径 / §1 数值化验收 / §2 红线）

## 0. 结论

完成。右侧可收起 AI 对话面板落地：多轮对话（消息列表 + Enter 发送 / Shift+Enter 换行 +
生成中可停止 + E_AI_* 错误可读）、上下文取当前页（标题+块文本按预算截断 + 「附带选中
内容」开关）、AI 回复引用渲染为可点击「页名 › 块锚点」chip（复用块选中机制跳转）、
历史按 workspace 隔离持久化（上限 200，不进账本）、三入口（顶栏 AI 钮 / 命令面板 /
Ctrl+J）、隐私硬不变量全部保持（未动 main/ai 任何门禁代码）。
四项自跑绿；真机三项（本地模型 3 轮对话截图 / 双主题截图 / 重启还原）按任务书留 PM：

| 自跑项 | 结果 |
|---|---|
| `pnpm -C apps/desktop test` | ✓ 46 文件 **506 用例全绿**（471 → +35，新增 ai-chat-context 16 + ai-chat 19） |
| `pnpm -r typecheck` | ✓ 全部 Done（9/9） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 0 命中 |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ 与 DESIGN.md 一致 |

> 备注：未新增依赖；未新增 token（面板全用既有 `var(--sc-*)`）；未碰 `packages/**`
> （含 DESIGN.md）、`shared/**`、`preload`、`main/**`（含 main/ai——多轮复用既有
> `ai:chat` 通道，通道名零新增）、CI。`docs/perf-history.jsonl` 有 8 行追加系
> perf.test.ts 自记产物（跑测试附带），非本单交付内容。

## 1. 实现面（文件清单）

**新增**
| 文件 | 内容 |
|---|---|
| `renderer/src/ai/chatState.ts` | 消息/历史状态：`ChatMsg`（role/content/ts/refs/stopped）+ localStorage 持久化（`septcats.aichat.history.<ws>` 按 ws 隔离、版本化、损坏防御、逐条校验；`septcats.aichat.panel` 面板开合全局态）+ 上限 200 丢最旧 + `aiChatStore`/`aiChatActions`/`useAiChat`（store.ts 同款 Zustand 同形实现） |
| `renderer/src/ai/chatContext.ts` | 上下文装配与引用解析（纯函数）：`buildBlockIndex`（块编号 [N] + 单块 600 字符截断 + 总预算 8000 整块丢弃）、`buildContextText`（页名 + 块清单 + 选中文本 2000 上限）、`buildChatSystemPrompt`（角色 + ⟦#N⟧ 引用规则 + 上下文）、`assembleChatMessages`（[system, …历史≤20 条/≤60k 字符整轮丢弃, 本轮提问]，客户端预收敛 ipc 64 条/200k 硬门禁）、`parseCitations`/`resolveCitations`（⟦#N⟧ 切分/映射/去重/未知 N 丢弃） |
| `renderer/src/ai/chatBridge.ts` | 编辑器桥：`EditorChatProvider` 单槽注册（PageView 产出上下文 + 块跳转）；`requestBlockJump` 同页直跳、跨页挂 pending + `openInTab` 切页；`consumePendingJump` 编辑器就绪后消费 |
| `renderer/src/ai/AiChatPanel.tsx` | 面板组件：标题栏（Sparkle + 清空历史 + 关闭）/ 消息列表（用户/AI 气泡，⟦#N⟧ → 「页名 › 块锚点」chip 点击跳转）/ busy 行（Spinner + 停止）/ 门控空态（未启用/无 provider → 引导 + 打开设置）/ 错误 role=alert / 输入区（Enter 发送、Shift+Enter 换行、isComposing 防中文输入法误发、「附带选中内容」Checkbox）/ Esc 收起 |
| `renderer/src/ai/AiChatPanel.css` | 全 token（颜色/字阶/圆角/间距全 `var(--sc-*)`）；面板宽单处裸 px（DEVIATION-6）；无 transition（无需 reduced-motion 块）；文本区 user-select:text |
| `apps/desktop/test/ai-chat-context.test.ts` | 16 用例（§2） |
| `apps/desktop/test/ai-chat.test.tsx` | 19 用例（§2） |

**修改**
| 文件 | 变更 |
|---|---|
| `pages/PageView.tsx` | 编辑器就绪时注册 chatBridge provider（`getPageContext`：editor.state.doc 现读块清单 id+text + 选区文本；`jumpToBlock`：blockPosById → setTextSelection → rAF scrollIntoView center）；编辑器就绪 effect 消费 `consumePendingJump`（跨页引用跳转）；数据库页/未就绪注销 provider |
| `App.tsx` | 顶栏搜索钮右侧新增 AI IconButton（Sparkle，aria-pressed）；Ctrl/Cmd+J keydown（命令面板打开时门禁短路，键位与 K/W/Tab/1..9 不相交）；`initPanel()` 启动恢复面板态；命令装配注入 `openAiChat`；编辑分支包 `.app-main-row`（编辑列 + 面板同行，chatOpen 才渲染面板） |
| `App.css` | `.app-main-row`（flex 行、高度链闭合于 .sc-shell__main）+ `.app-editor-col` 补 `flex:1; min-width:0`（面板打开主区变窄、收起不渲染即变宽） |
| `palette/commands.ts` | `AI_CHAT_DEF`（id `app.aiChat`，拼音+英文 aliases）+ deps `openAiChat?` 门控 push（DEVIATION-4） |
| `i18n/zh-CN.ts` / `en-US.ts` | 新增 `app.aiChatLabel`、`aiChat.*`（16 键含 promptRole/promptCitationRule 等 prompt 文案，DEVIATION-3）、`commands.app.aiChat`、`commandHints.app.aiChat` 双语同构 |

## 2. 测试（35 用例）

**ai-chat-context.test.ts（16，node 环境）**
- 块清单：顺序编号 n↔blockId 对齐；单块超 600 字符截断加省略号；总预算 8000 装不下的块**整块丢弃**（不出现半块）；null 上下文 → 空清单。
- 上下文文本：含页名 + `[N]` 块清单；「附带选中内容」开 → 注入选中文本、无选区不注入。
- **多轮装配**：第 3 轮请求 messages = [system, u1, a1, u2, a2, q3]——**第 1 轮结论原文在请求里**（§1.1 客户端前提）；历史上限 20 条只带最近；字符预算超限从最旧整轮丢弃（保 user/assistant 成对）；装配结果 ≤64 条且 ≤200k（ipc 硬门禁预收敛）。
- 引用解析：⟦#N⟧ 切分正确；无标记单文本段；n→blockId 映射、按 n 去重、未知 n 丢弃。
- **隐私硬不变量（主进程面）**：非本地端点 + 未 consent，多轮装配结果走**真 AiService** → 拒绝 `E_AI_CLOUD_DENIED`，**fetch 调用次数 = 0**（vi.fn 打桩计数），隐私日志连 op 行都为 0（云门禁在网络栈之前同步拒绝，更不会记消息正文）；enabled=false 同样 fetch=0。
- 历史纯函数：超出 200 丢最旧。

**ai-chat.test.tsx（19，jsdom）**
- **历史持久化**：追加写 localStorage 且 `readChatHistory` 逐字还原；ws 隔离（ws-2 读不到 ws-1、切回还原）；上限 200 store 与持久层一致丢最旧；清空（动作与清空按钮 confirm 流）清 store 且移除存储键；损坏 JSON/版本不符 → null。
- **面板状态持久化**：`septcats.aichat.panel` 写 '1'/'0' 往返；`initPanel` 启动恢复（收起 → 重启 → 仍收起）。
- **多轮发送（组件级）**：ai.chat 收到 system+历史+提问；system 含页名/`[1] 块文本`/选中文本；第二轮请求带上第一轮 user/assistant 原文；引用 chip 渲染为「页A › 块2」，点击 → `jumpToBlock('b2')`；「附带选中内容」关闭 → system 无选中文本；未知块编号标记原样保留（不静默改写 AI 输出）。
- **键盘**：Enter 发送 / Shift+Enter 不发送且草稿保留 / Esc 收起并持久化 false。
- **停止**：busy 中点停止 → busy 消失；迟到 resolve 的回复**不落历史**、用户消息保留。
- **门控与错误**：未启用 → 引导 + 打开设置、chat 零调用；无 provider → 引导；`E_AI_UNREACHABLE：端点不可达` role=alert 原文呈现（errorText 口径）。
- **隐私（renderer 面）**：云拒绝流（E_AI_CLOUD_DENIED）里 `window.fetch` 调用次数 = 0（打桩计数）；localStorage 全量不含 `sk-`/`Bearer`（密钥只进 CredentialStore，不经 renderer）。

## 3. §1 验收逐项

| §1 | 结果 | 证据 |
|---|---|---|
| 1. 多轮上下文（第 3 轮引用第 1 轮结论） | 自动化 **PASS**；真机 3 轮截图 **留 PM** | ai-chat-context「第 3 轮请求里能看到第 1 轮的结论」+ ai-chat「第二轮请求带上第一轮原文」（多轮 messages 逐字断言）；LM Studio 真机 3 轮截图（PM 复跑节） |
| 2. 引用可跳转（点击 → 目标块视口/选中） | 自动化 **PASS**；真机 **留 PM** | ai-chat 组件测试：chip 点击 → `jumpToBlock('b2')`；PageView 侧 = blockPosById → setTextSelection(pos+1) → scrollIntoView({block:'center'})（跨页经 pendingJump + openInTab）；CDP 断言留 PM |
| 3. 历史持久化（重启逐字还原；清空为空） | 自动化 **PASS**；重启真机 **留 PM** | readChatHistory 逐字还原 / 200 上限丢最旧 / 清空移除键 / 损坏防御，全部单测锁死；面板态 `septcats.aichat.panel` 同范式 |
| 4. 隐私（非本地 + 未 consent → fetch=0；localStorage/日志无密钥） | **PASS** | **fetch 调用次数 = 0**（两条用例：云门禁拒绝流 + enabled=false）；隐私日志行数 = 0（拒绝早于网络栈）；localStorage 全量无 `sk-`/`Bearer`；`state()` 派生不泄露密钥由既有 ai-service.test 守护。真机复跑数值留 PM |
| 5. 面板状态持久化（收起 → 重启 → 仍收起） | 自动化 **PASS**；重启真机 **留 PM** | `initPanel`/`setOpen` 读写 `septcats.aichat.panel` 单测 |
| 6. 键盘可达 / 双主题四态 / no-magic / build-tokens | 自动化 **PASS**；双主题截图 **留 PM** | Enter/Shift+Enter/Esc/Tab（原生焦点序）单测；CSS 全 token、无字面 hex、四态色全走既有 token（hover=surface / user 气泡=accent-soft / 引用 chip=accent+accent-soft / 禁用=Button 既有 disabled）；no-magic ✓ build-tokens --check ✓ |
| 7. 回归红线（零滚动/侧栏收起/gutter/多页签/对比度） | **PASS**（代码面 + 既有用例） | 506 全绿含 layout-invariants/gutter/对比度/tabs 全部既有守护用例；面板为编辑列旁 flex 兄弟节点，不触碰窗口滚动与侧栏折叠逻辑 |

## 4. SSIM-NOTE

本单无 mockup 基准屏（老板新需求「AI部分应该要有对话框」）：视觉与既有面同构——
面板底=content 面 + hairline 左分隔（与侧栏 chrome/canvas 分色同思路）；标题栏 32px
（--sc-layout-head-h）+ icon-faint 的 Sparkle；用户气泡=accent-soft、AI 气泡=surface、
圆角 radius-lg；引用 chip=accent 色下划线、hover/active=accent-soft（与 palette-row
按压口径一致）；空态/引导=ui-sm + ink-faint（与 .pv-empty 族同 token 组合）；错误=
danger + danger-soft（AiActionPanel error 同构）；正式视觉由 PM 真机双主题截图复审。

## 5. DEVIATIONS（逐条，待 PM 追认）

1. **停止 = 渲染层作废（runId guard），非网络层 abort**：既有 client 为非流式
   （`stream:false`），红线「main/ai 只增不改」下未加 AbortController/新通道；停止后
   runId 递增，迟到的回复不落历史（测试锁死），main 侧请求自然完成并按既有隐私日志
   口径记录（只记 op/host/耗时，无正文）。若 PM 要求真中断，需 main/ai 增量加信号参数
   （另立小单）。
2. **既有 AI 动作面板未并入对话侧栏**：T18-03 的 AiActionPanel 是 PageView 内**模态
   Dialog**（非右侧面板），本轮保持不动；右侧 AI 侧栏只有对话面板一个，不存在「两个
   右侧 AI 面板」。是否把动作结果改走对话侧栏（Tab/分区）待 PM 裁决。
3. **prompt 文案进 i18n（随界面语言）**：门禁⑤拦 renderer 字符串字面量 CJK，system
   prompt 文案入 `aiChat.prompt*` 双语键——zh 界面发中文 prompt、en 发英文 prompt；
   引用标记格式定为 locale 无关的 ASCII `⟦#N⟧`。若 PM 要求 prompt 固定单语言，需在
   门禁⑤为 shared prompt 常量开豁免（shared/** 本单被限定「仅新增通道名」，未动）。
4. **命令面板命令走 deps 门（`AI_CHAT_DEF` push）而非静态 COMMAND_DEFS**：palette
   基线测试（空 query 命令序、别名命中、'yin' 零命中等）零改动；App 恒注入
   `openAiChat` → 命令恒出现。语义上是「恒有命令」，实现上复用条件命令机制。
5. **面板仅编辑器视图渲染**：settings/import/回收站/搜索/命令面板视图不挂面板（这些
   视图有各自全屏布局与滚动容器）；三入口在任意视图均可切状态，回到编辑视图即呈现。
   避免对这些视图做高度链改造引发回归。
6. **面板宽度单处裸 px（320px）**：DESIGN.md 无侧栏面板宽度 token（layout 族只有
   topbar/sidebar/row/head），不碰 packages/** 前提下用单处决策值（no-magic 口径：
   单处非重复裸 px 合规）；如需 token 化请 PM 裁决是否扩 DESIGN.md。
7. **历史明文入 localStorage**（消息全文 + 引用元数据 pageTitle/blockId）：§0.4 明示
   与 `septcats.tabs.<ws>` 同范式持久化且不进账本——tabs/主题/语言偏好同为明文
   localStorage，本单同级处理；不做加密（与既有 UI 状态保密级一致）。
8. **「附带选中内容」开关恒可见、默认开**（§0.3「有选区时默认开」）：无选区时发送
   不注入任何选中内容（buildContextText 判空）；有选区且开关开 → 注入。开关状态跨轮
   保留（会话内），不持久化。
9. **跨页引用跳转对已删页的兜底**：引用页不存在时 `openInTab(死页)` 由 pages store
   现行口径处理（T37 起不裁剪已开签的场景外，load/refresh 会裁）；本轮未为「引用页
   已被删」加专门提示，跳转静默无效。
10. **既有测试断言语义：零改动**（任务书要求「需调整 §DEVIATION 逐条」——实际无需
    调整，palette/i18n/audit 全部门禁用例原样通过）。

## 6. PM 复跑节（PM 补）

- 全仓 selftest / 重打包（先 `node apps/desktop/scripts/ensure-abi.mjs electron`）：
- §1.1 本地模型（LM Studio）3 轮对话截图（第 3 轮正确引用第 1 轮结论）：
- §1.2 引用点击跳转 CDP 断言（目标块进视口/成为选中块）：
- §1.3/§1.5 重启还原（历史逐字 + 面板收起态）真机复核：
- §1.4 隐私真机数值复跑（非本地端点 + 未 consent → fetch 计数 = 0；localStorage/日志无密钥）：
- 双主题 × 四态截图：
- DEVIATION-1（停止语义）/ DEVIATION-2（动作面板是否并入）/ DEVIATION-6（宽度 token 化）追认：

## §PM 复跑（2026-09-19，rc.13）

```
全仓 1125 无红（desktop 471→506 = +35：ai-chat 组件 + ai-chat-context 装配）；typecheck 9/9；no-magic ✓；build-tokens --check ✓
重打包 0.3.0-rc.13（93,415,016 字节，sha256 `4cd963b039b3712344f6c989283821a5202962f930dbf86e33ff6f3adb3b21dc`）
提交 `2707c69`；PM 真机三项已派独立工作流（探针 `docs/mockups/probe-t38-ai.mjs` + 截图 `docs/mockups/screens-t38/`）
红线核对：改动仅在 renderer/src/**（ai/ 面板 + App + PageView + commands + i18n）+ apps/desktop/test/** ✓
```

**⚠️ 状态口径（重要，不许含糊）**：本单**自动化面全部通过**（多轮装配逐字断言、引用 chip→`jumpToBlock`、历史/面板态持久化、**fetch 计数 = 0** 两条、localStorage 无密钥、回归红线 506 全绿含 layout/gutter/对比度/tabs），但**真机三项仍待 PM 补**：
1. LM Studio 本地模型 **3 轮对话**（第 3 轮引用第 1 轮结论）截图；
2. **隐私真机复跑数值**（非本地端点 + 未 consent → fetch 计数 = 0）与 localStorage/日志无密钥的现场取证；
3. **重启还原**（历史逐字 + 面板收起态）与双主题 × 四态截图。
工程师未留 T38 探针与截图（`docs/mockups/` 无 t38 产物）→ 由 PM 写探针后补齐，**补齐前本单不计「真机闭环」**。
