# TASK-T46-01 交付报告 · P3：AI 对话健壮性——可配置超时 + 空正文/纯推理可读提示

> 执行：CodeBuddy（工程师，唯一作者）
> 基座：HEAD = `f8d9a235dc90f346752eb6ce1be4855e00b1f314`（`fix(audit): 更正复核报告…`）
> 任务书：`docs/tasks/TASK-T46-01.md`
> **前置实况与任务书不符，见 §0——本单实际是「补齐一处已落盘但仍不绿的半成品」**，非从零实现。

---

## §0 前置实况（动手前实测，与任务书描述不一致）

任务书称「工作树干净、`_scratch/t46-salvage/t46.patch` 可作参考」。实测**不是**这样：

| 事实 | 证据 |
|---|---|
| 工作树**不干净**；T46 的 18 个源文件改动**已在索引中**（`git status --porcelain` 首列 `M`） | 首次 `git status` 输出 18 行 `M ` |
| 会话期间 HEAD 被推进两次（`b779b5c` → `414c31f` → `f8d9a23`），那份 T46 改动**已被提交进 HEAD** | `git reflog`：`414c31f test(audit): 5 个修复批次独立真机复核`（该提交带上了 `main/ai/client.ts` 等 T46 内容） |
| salvage 补丁**缺失 3 个被它引用的新模块**（`git diff` 不含未跟踪文件所致） | `client.ts` 引 `./chatConfig`、`service.ts` 引 `./chatConfigStore`、`AiChatPanel.tsx` 引 `./chatReply`，三者**均不存在** |
| 因此 HEAD 处于**不可编译**状态 | 接手时 `pnpm -r typecheck` = **8/9**（apps/desktop 报 3 处 TS 错误） |

**处置口径**：按任务书「必须以你自己跑绿的版本为准，不要直接套用未验证的代码」——
本轮**不回滚既有已提交内容**（不碰 git），而是**逐条审读已在树上的实现 + 补齐 3 个缺失模块 + 修掉类型错误**，
并以**我自己实测跑绿**的全量结果作为交付基线。所有新增模块都按测试钉死的契约重写/新写，非盲抄。

---

## 1. 改动清单（本轮实际写入）

### 1.1 新增（3 个被引用但缺失的模块 —— 本单能编译的关键）

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/main/ai/chatConfig.ts` | 数值口径纯函数：夹紧（超时 5–600s、tokens 1–131072）、`effectiveChatTimeoutMs`（未设置→注入兜底值）、`describeTimeoutSeconds`（整秒给整数/亚秒两位小数）、`parseAiChatConfigFile`/`serializeAiChatConfig`（v=1，坏值回默认**永不抛**） |
| `apps/desktop/src/main/ai/chatConfigStore.ts` | `AiChatConfigStore`（`resolveDir`+`io` 注入；`read` memo；`patch` 合并+夹紧+整体落盘；目录不可用/写失败**只更新内存**）+ `defaultChatConfigStore()`（**动态** `import('electron')` + try/catch 懒解析 userData） |
| `apps/desktop/src/renderer/src/ai/chatReply.ts` | 呈现口径纯函数：`replyNoticeText`（空正文→「仅推理内容」/「未返回正文」；正文非空→null）、`lengthNoticeText`（`length`→「达到输出上限」）、`reasoningOf`、`clampReasoningForStorage`（4000 字符上限+尾部说明）、`panelErrorText`（`E_AI_TIMEOUT` → 既有 `errorText` + 调大指引） |

### 1.2 新增（测试与取证）

| 文件 | 说明 |
|---|---|
| `apps/desktop/test/ai-chat-config.test.ts` | chatConfig/chatConfigStore/`ai:setChatConfig` 守卫的定向单测，**14 用例**（参考补丁同名文件的契约，本轮实跑并要求全绿后纳入） |
| `docs/mockups/probe-t46-robustness.mjs` | 真机 CDP 探针（口径照 `probe-t38-multiturn.mjs`；**不重打包**，`electron .` 直跑 `out/`；桩服务在探针进程内，可切 `empty-reasoning`/`empty-plain`/`normal`/`slow`/`hang` 五种响应形态） |
| `docs/mockups/screens-t46/` | 证据产物：8 张双主题截图 + `t46-results.json` + `probe-ai.log` |

### 1.3 修改（1 处，语义不变）

| 文件 | 改动 |
|---|---|
| `apps/desktop/test/ai-chat.test.tsx` | `max_tokens` 用例里两个 `vi.fn(async () => …)` 未标注入参 → mock 形参元组类型为 `[]`，`calls[0]?.[0]` 触发 `TS2493`/`TS2352`。补 `_input: Record<string, unknown>` 标注（**仅类型标注，断言语义逐字未变**） |

**未改动**：`packages/**`、其它 `main/**` 模块（含 `main/index.ts`）、CI、`electron-builder` 打包产物。

---

## 2. 验收（数值化，本次实跑原始输出）

### 2.1 工程门禁

| 项 | 命令 | 结果 |
|---|---|---|
| 全仓 typecheck | `pnpm -r typecheck` | **9/9 Done**（修复前为 8/9） |
| desktop 全量测试 | `pnpm -C apps/desktop test` | **Test Files 56 passed (56) / Tests 635 passed (635)**，28.92s |
| T46 相关用例 | `vitest run test/ai-client test/ai-service test/ai-chat test/ai-chat-config test/settings-react` | **5 files / 95 passed**（ai-chat-config 14 / ai-client 17 / ai-chat 26 / ai-service 19 / settings-react 19） |
| 门禁① | `node packages/ui/tokens/no-magic.mjs` | **✓ 组件 CSS 无字面 hex、无非 1px 重复裸 px** |
| 门禁② | `node packages/ui/tokens/build-tokens.mjs --check` | **✓ token 产物与 DESIGN.md 一致** |

### 2.2 原始数值（main 侧真实现，`_scratch/t46-probe/probe.ts`，tsx 直跑）

```
===== [1] 未设置配置：注入兜底值 =====
DEFAULT_CHAT_TIMEOUT_MS = 120000
effectiveChatTimeoutMs(未设置, DEFAULT_CHAT_TIMEOUT_MS) = 120000
state().chatTimeoutSec = 120
state().maxOutputTokens = null
===== [2] 未设置 + 注入 400ms → 用注入值中止 =====
elapsedMs = 403
error.message = E_AI_TIMEOUT：等待超过 0.40 秒已中止（127.0.0.1:1234）
===== [3] 配置 requestTimeoutSec=5 + 挂起端点 =====
elapsedMs = 5012
error.message = E_AI_TIMEOUT：等待超过 5 秒已中止（127.0.0.1:1234）
log[last] = ai chat provider=local host=127.0.0.1:1234 model=master timeout=5s → E_AI_TIMEOUT(5012ms)
===== [4] 配置 requestTimeoutSec=300 + 600ms 慢端点 =====
elapsedMs = 611
error = (无错误：正常返回)
log[last] = ai chat provider=local host=127.0.0.1:1234 model=master timeout=300s → ok(611ms)
===== [5] 桩响应 content 空 + reasoning_content + finish_reason=length =====
result.text =
result.reasoningContent = 推理链：先看第一块…
result.finishReason = length
===== [6] 真本机端点 http://127.0.0.1:1234/v1（model master）=====
elapsedMs = 1958
result.model = master
result.finishReason = stop
result.text(前 120 字) = 1+1 等于 2。
log[last] = ai chat provider=local host=127.0.0.1:1234 model=master timeout=120s → ok(1958ms)
```

**对照任务书 §2 四条验收**：
1. **超时**：5s + 挂起 → **5012ms** 中止、文案含「等待超过 **5** 秒已中止」；设回 300s → 600ms 慢响应 **611ms 正常返回（不提前中止）** ✅
2. **空正文**：桩 `{content:"", reasoning_content:"…", finish_reason:"length"}` → **成功返回**（不再是 `E_AI_BAD_RESPONSE`），UI 层见 §3 ✅
3. **默认不回归**：未设置 → 注入值 **120000ms**、`state().chatTimeoutSec = 120`、请求体无 `max_tokens` ✅
4. **真实端点**：`http://127.0.0.1:1234/v1` model `master` → 正常回复 ✅

---

## 3. 真机证据（真实 Electron 应用 · CDP 驱动）

**探针**：`docs/mockups/probe-t46-robustness.mjs`（`pnpm -C apps/desktop build` 生成 `out/`，`electron .` 直跑；夹具隔离在 `_scratch/probe-t46/`，`--user-data-dir` + `rootPath`；真实数据根 `.septcats` mtime 前后一致 = **未被触碰**）

### 3.1 结果：桩层 **30/30 PASS**；含真机层 **32/32 PASS**

| 判据 | 原始值 |
|---|---|
| ① 未设置参数 → `chatTimeoutSec=120` / `maxOutputTokens=null` | `{count:1,width:320}` / `120` / `null` |
| A1 空正文+推理 → 提示「模型未返回正文（仅推理内容）」 | `notices=["模型未返回正文（仅推理内容）","达到输出上限，可增大 max_tokens 或重试"]` |
| A3 **无空白气泡** | `lastBubbleLen=52`，`text="模型未返回正文（仅推理内容）达到输出上限，可增大 max_tokens 或重试查看推理内容（34 字符）"` |
| A4 折叠区默认收起 | `aria-expanded=false`，`.ai-chat__reasoning-body` **不在 DOM** |
| A6 点开 → 推理原文可见 | `bodies=["先核对第一块：结论甲；再看第二块：口径乙。据此正文应写「两处一致」。"]`，`aria-expanded=true` |
| A7 再点 → 可逆收起 | `bodies=[]`，`aria-expanded=false` |
| A9 历史落盘 | `content="" reasoningLen=34 finishReason=length` |
| B1 空正文无推理 → 「未返回正文」提示，B2 无折叠区，B3 无空白气泡 | `lastBubbleLen=32` |
| C1/C2 `setChatConfig({requestTimeoutSec:5})` → 生效 5s | `{"chatTimeoutSec":5,"maxOutputTokens":null}` |
| **C3 约 5s 中止** | **`elapsedMs=5292`**（main `ai.log` 自计 **`E_AI_TIMEOUT(5007ms)`**） |
| **C4/C5 超时文案可读** | `"请求超时：等待超过 5 秒已中止（127.0.0.1:18111） 可在设置 › AI 助手中调大「请求超时」（当前 5 秒）。"` |
| C6 不含裸错误码 | 文案内**无** `E_AI_TIMEOUT` |
| C7 超时轮不落 assistant 历史 | `assistantMsgs=2`（仅前两轮） |
| D2 300s 不提前中止 | `elapsedMs=836`，无错误，`ai.log → ok(614ms)` |
| E1 清回 null → 回 120s | `{"chatTimeoutSec":120,"maxOutputTokens":null}` |
| F2 面板请求体带 `max_tokens=800` | `body.max_tokens=800`；F3 清回 null → `hasMaxTokens=false` |
| H1/H2 卫生 | `pageerror=0`、`console error=0` |
| **G2 真本机端点（model `master`）正常回复** | **`elapsedMs=3279`**，`text="1+1 等于 2。查看推理内容（51 字符）"`，`ai.log → ok(3161ms)` |

> 注：真机 `master` 自身也回 `reasoning_content`（51 字符）→ 正常正文轮同时出现「查看推理内容」折叠区，符合 §1.2 预期（正文非空 → 不给「空正文」提示，只给折叠区）。

### 3.2 截图（双主题齐备，`docs/mockups/screens-t46/`，均为 1184×735）

| 文件 | 内容 |
|---|---|
| `t46-empty-reasoning-collapsed-light.png` / `-dark.png` | 纯推理响应**折叠态**：两条提示 + 折叠按钮，**无空白气泡** |
| `t46-empty-reasoning-expanded-light.png` / `-dark.png` | 同上**展开态**：推理正文以 `pre` 块可滚动展示 |
| `t46-timeout-5s-light.png` / `-dark.png` | 超时 5s：面板呈「请求超时：等待超过 5 秒已中止（…） 可在设置 › AI 助手中调大「请求超时」（当前 5 秒）。」 |
| `t46-real-light.png` / `-dark.png` | 真本机端点 `master` 正常回复「1+1 等于 2。」+ 推理折叠区 |

---

## 4. DEVIATION（逐条）

1. **D-1 前置状态与任务书不符（最重要）**：接手时工作树不干净，salvage 改动**已落盘并已被提交进 HEAD**（`414c31f`），且**缺失 3 个被引用的新模块** → HEAD 不可编译（typecheck 8/9）。本轮按任务书「以自己跑绿的版本为准」，**补齐缺失模块并修绿**，未回滚既有已提交内容、未执行任何 git 写操作。
2. **D-2 修复既有测试的类型错误**：`apps/desktop/test/ai-chat.test.tsx` 两处 `vi.fn` 补入参类型标注（`TS2493`/`TS2352`）。**断言语义逐字未变**。
3. **D-3 纳入参考单测**：`apps/desktop/test/ai-chat-config.test.ts`（14 用例）取自 `_scratch` 参考补丁的同名文件，**本轮实跑全绿后**才纳入；未做修改。
4. **D-4 常量再导出**：`chatConfig.ts` 额外再导出 `AI_CHAT_TIMEOUT_ADVISED_MIN_SEC/MAX_SEC`，**单一来源仍是 `shared/ai.ts`**（仅为单测就近引用，不产生第二真源）。
5. **D-5 `defaultChatConfigStore()` 自解析 userData**：`main/index.ts` 属红线外（不能注入 `ctx.userDataDir`），故以**动态 `import('electron')` + try/catch** 懒解析 `app.getPath('userData')`；非 Electron 环境（vitest/纯 Node）解析为 `null` → 回「未设置」，从而保持「纯 Node 可直测」。**未静态 import electron**。
6. **D-6 可选低风险项已做**：§1.4「面板 max_tokens」已实现（设置里可配、面板请求带上、未设置不带），并有 F1–F3 真机判据。
7. **D-7 取证脚本落位**：新增 `docs/mockups/probe-t46-robustness.mjs` / `docs/mockups/screens-t46/`（与 `probe-t38-*.mjs` 同目录同口径，便于 PM 复跑）。`out/` 用 `pnpm -C apps/desktop build` 重新生成——**是构建，不是 electron-builder 重打包**；`dist/` 未触碰。
8. **D-8 明确不做**：多会话、重试队列、流式（任务书 §1.5 明示不做）。
9. **D-9 行为面一处提示**：main 侧 `chat` 现在把「`content` 为空但带 `reasoning_content`」按**成功**处理（错误码语义不变：既无 content 又无 reasoning 仍回 `E_AI_BAD_RESPONSE`），这是 §1.2 落地所必需。

## 5. 红线自查

| 红线 | 结论 |
|---|---|
| 只动允许目录 | ✅ `main/ai/**`（新增 2 文件）、`renderer/src/ai/**`（新增 1 文件）、`apps/desktop/test/**`、`shared/ai.ts`+`shared/ipc.ts`+`preload`+`window.d.ts`（salvage 既有，仅新增字段）、i18n、设置页 |
| 不碰 `packages/**`/其它 `main/**`/CI | ✅ 逐字未动 |
| 不加依赖 | ✅ 仅用既有 `node:fs`/`node:path`/动态 `electron` |
| 不碰 git | ✅ 全程只读 git（`log`/`status`/`diff`/`ls-tree`/`reflog`），无 `add`/`commit`/`reset` |
| 禁 TODO/占位符 | ✅ 无 |
| 隐私硬不变量 | ✅ 云端默认关；非本地端点无 consent 仍 `E_AI_CLOUD_DENIED` 零外呼（既有测试 40 PASS 未被削弱）；密钥只进 CredentialStore；新增配置文件 `ai-chat-config.json` **只含两个数值**（超时秒 / max_tokens），无密钥、无 prompt、无正文 |
| CSS 只走 `var(--sc-*)` | ✅ `no-magic` 门禁 ✓；双主题四态截图齐备 |

## 6. 复现命令

```bash
node apps/desktop/scripts/ensure-abi.mjs node      # 测试前切 node ABI
pnpm -r typecheck
pnpm -C apps/desktop test
node packages/ui/tokens/no-magic.mjs
node packages/ui/tokens/build-tokens.mjs --check
pnpm -C apps/desktop exec tsx ../../_scratch/t46-probe/probe.ts        # 原始数值
pnpm -C apps/desktop build && node docs/mockups/probe-t46-robustness.mjs           # 真机（桩层）
SEPTCATS_T46_REAL=1 node docs/mockups/probe-t46-robustness.mjs                    # 真机（+真本机端点 master）
```

---

## §PM 真机复跑（PM 补）

（PM 补）


## §PM 复跑（独立，rc.25 构建后）—— **30 PASS / 0 FAIL**

**探针**：`docs/mockups/probe-t46-robustness.mjs`（CB 自建，PM 独立复跑）；日志 `_scratch/t46-probe.log`

| 判据 | PM 复跑原始数值 |
|---|---|
| 空正文无空白气泡 | `lastBubbleLen=52`，气泡原文「模型未返回正文（仅推理内容）达到输出上限，可增大 max_tokens 或重试查看推理内容（34 字符）」 |
| 折叠默认收起 | `aria-expanded=false`、正文 `bodies=0`（不在 DOM） |
| 展开可见推理原文 | `bodies=["先核对第一块：结论甲；再看第二块：口径乙。据此正文应写「两处一致」。"]`、`aria-expanded=true`、可逆 |
| 超时文案可读 | 「请求超时：等待超过 5 秒已中止（127.0.0.1:18111） 可在设置 › AI 助手中调大「请求超时」（当前 5 秒）。」→ **含指引、不含裸错误码**（C4/C5/C6 三条同时 PASS） |
| main 侧自计耗时（ai.log 原文） | `setChatConfig timeout=5s` → `E_AI_TIMEOUT(5011ms)`；`timeout=300s` → `ok(609ms)`；`timeout=120s maxTokens=800` → `ok(2ms)`；默认 120s → `ok(30ms)` |
| DoD | 全仓 **1272 无红**（desktop 635）、typecheck 9/9、双门禁 ✓、`packages/` 改动 0 |

**结论：T46-01 代码 + 测试 + 真机（含 PM 独立复跑）闭环 → rc.25。**

