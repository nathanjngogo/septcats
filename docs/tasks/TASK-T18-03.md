# TASK-T18-03 · M11 AI 集成（3/3）：编辑器块级 AI 动作（续写/摘要/改写/翻译）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T18-02 已交付（HEAD `eb1f64c`，开工 `git log -1` 确认）
> 依据：M11「块内续写/摘要/改写/翻译」。T18-01 服务面（`ai:*` 五通道）与 T18-02 设置面已就绪，**本轮只做 renderer + shared**。
> 红线（零改动）：`packages/*`、`apps/desktop/src/main/**`、`preload`、`window.d.ts`、`shared/ipc.ts`、`shared/ai.ts`、`shared/settings.ts`、`settings/AiSection.*`、`pages/SettingsPage.*`（设置页 UI 不动）。
> 纪律：不碰 git；禁占位符/TODO；CSS 只吃 `var(--sc-*)`；不改既有测试断言语义（只许追加）；不要跑全仓 `pnpm -r test` 与 selftest（PM 收口）。

## 0. PM 设计裁决（照此实现）

1. **入口 = 命令面板四条命令**（`ai.continue / ai.summarize / ai.rewrite / ai.translate`，中文名「AI 续写 / AI 摘要 / AI 改写 / AI 翻译」+ 拼音别名），**作用对象 = 编辑器当前选中文本；无选中 → 光标所在块的整块文本**。
2. **PageView 触发通道**：照 `septcats:sync-open` 既有先例，用 `window.dispatchEvent(new CustomEvent('septcats:ai-action', { detail: { action } }))`；PageView 挂监听打开 AI 面板（命令面板不 import PageView 内部）。
3. **prompt 单一来源** `shared/aiPrompts.ts`（纯函数、可直测；renderer 与将来的 main 侧动作共用同一份）。
4. **非流式 MVP**：`ai.chat()` 一次往返回全文；面板四态 = 空态（未启用/未配置 provider → 引导 + 「打开设置」）/ 生成中 / 成功（结果文本 + 应用）/ 错误（`E_AI_*` 原文 + 重试）。
5. **应用语义（块内）**：摘要/改写/翻译 → **替换**（有选中替换选中，无选中替换整块文本）；续写 → **在该块末尾追加**。落地走 TipTap transaction（`tr.insertText(text, from, to)`，续写为 `tr.insertText(text, blockEnd)`），随后按 PageView **既有**的持久化路径保存（不得新增旁路）。
6. **provider 选择**：`ai.state()` 的 `activeProviderId`；为 null 则取 providers[0]；无 providers → 空态引导。
7. **不自动写库不自动发送**：面板关闭即丢弃结果；应用前不落任何持久态。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `apps/desktop/src/shared/aiPrompts.ts`（新建） | `AI_BLOCK_ACTIONS` / `AiBlockAction` / `buildAiMessages({action, text, targetLang?})`（§2.1 文案逐字） |
| `apps/desktop/test/ai-prompts.test.ts`（新建） | 四动作形状/文案/默认 targetLang/空文本与未知动作的行为（§3） |
| `apps/desktop/src/renderer/src/ai/AiActionPanel.tsx` + `AiActionPanel.css`（新建） | 结果面板（受控组件，四态；§2.2） |
| `apps/desktop/src/renderer/src/pages/PageView.tsx`（修改） | 监听 `septcats:ai-action`；取文本（选中优先/块文本）；调 `ai.state()`+`ai.chat()`；应用 transaction；渲染 `<AiActionPanel/>` |
| `apps/desktop/src/renderer/src/palette/commands.ts`（修改） | 4 条命令（COMMAND_DEFS + `CommandDeps.runAiAction(action)`） |
| `apps/desktop/src/renderer/src/App.tsx`（修改） | 命令面板装配 `runAiAction` → 派发 `septcats:ai-action` |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts`（修改） | `commands.ai.*` / `commandHints.ai.*` / `ai.*` 面板段（§2.3 全文） |
| `apps/desktop/test/palette.test.ts`（修改） | 追加 4 命令的 id/别名命中断言（既有断言零改动） |
| `apps/desktop/test/ai-panel.test.tsx`（新建） | 面板四态 + 应用回调（§3） |
| `docs/mockups/cdp-e2e-ai.mjs`（新建） | 真机 CDP 验收脚本（照 `docs/mockups/cdp-e2e-*.mjs` 既有范式；PM 跑）：设置页配 LM Studio → 编辑器选中文本触发改/摘要 → 断言块文本变化 → 未配置空态引导 → pageerror 0（§4） |
| `docs/tasks/TASK-T18-03-report.md`（新建） | 交付表/裁决消费/自跑输出/DEVIATIONS（PM 复跑节留「（PM 补）」） |

## 2. 分步规格

### 2.1 `shared/aiPrompts.ts`（prompts 逐字）
```ts
export const AI_BLOCK_ACTIONS = ['continue', 'summarize', 'rewrite', 'translate'] as const;
export type AiBlockAction = (typeof AI_BLOCK_ACTIONS)[number];
export function buildAiMessages(input: { action: AiBlockAction; text: string; targetLang?: string }): AiMessage[];
```
- `continue` → system：`你是中文写作助手。基于给定文本继续往下写，保持同一语气与体裁；只输出续写内容本身，不要解释、不要重复原文。`
- `summarize` → system：`你是中文写作助手。把给定文本压缩为要点摘要，保留关键信息；只输出摘要本身。`
- `rewrite` → system：`你是中文写作助手。在保持原意与信息量的前提下改写给定文本，使表达更清晰顺畅；只输出改写后的文本。`
- `translate` → system：``你是中文翻译。把给定文本翻译为${targetLang ?? 'English'}，保持原有格式与换行；只输出译文。``
- 四条均为 `[{role:'system',content:…},{role:'user',content: text}]`；`text` 原样进 user（不 trim、不截断——长度上限由 ipc 层 200k 兜底）。

### 2.2 `AiActionPanel.tsx`（受控组件）
```ts
export interface AiActionPanelProps {
  open: boolean;
  action: AiBlockAction | null;
  phase: 'idle' | 'busy' | 'ok' | 'error';
  result: string;          // phase==='ok'
  error: string;           // phase==='error'（E_AI_* 原文照展）
  emptyReason: string | null; // 空态引导文案（未启用/无 provider）
  canApply: boolean;       // false = 无可替换目标（如空块续写以外的边界）
  onApply: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}
```
- 用 `@septcats/ui` 的 `Dialog`（footer：取消 / 重试（error 态）/ 应用（ok 态）+ busy 用 `Button loading`）。
- 结构：标题 = 动作名；busy = `ai.busy` 文案；ok = `<pre className="ai-panel__result">` 结果全文（可滚动、`user-select:text`、等宽断行）；error = `role="alert"` 原文 + 重试；空态 = `emptyReason` + 「打开设置」按钮（`onOpenSettings`）。
- 结果区**可手动全选复制**（§16：可选文本不得被 `user-select:none` 族继承破坏——显式 `user-select:text`）。

### 2.3 i18n 追加（`commands`/`commandHints` 补 `ai` 子段；顶层新增 `ai` 段）
```ts
  commands: { …, ai: { continue: 'AI 续写', summarize: 'AI 摘要', rewrite: 'AI 改写', translate: 'AI 翻译' } },
  commandHints: { …, ai: { continue: '基于选中文本或当前块继续写', summarize: '压缩为要点摘要', rewrite: '保持原意改写', translate: '翻译为英文（可改目标语言）' } },
  ai: {
    panelTitle: 'AI 助手', busy: '生成中…', apply: '应用', retry: '重试', cancel: '取消',
    needEnable: 'AI 功能尚未启用（设置 → AI 助手）', needProvider: '还没有配置模型服务（设置 → AI 助手）',
    openSettings: '打开设置', noTarget: '没有可应用的文本目标', emptyText: '选中文本或把光标放进有内容的块后再试',
    applied: '已应用到编辑器',
  },
```
- 命令别名（拼音/英文，照既有别名口径）：`ai.continue` → `['aixuxie','xuxie','aixx','xx','ai continue']`；`ai.summarize` → `['aizhaiyao','zhaiyao','aizy','zy','ai summarize']`；`ai.rewrite` → `['aigaixie','gaixie','aigx','gx','ai rewrite']`；`ai.translate` → `['aifanyi','fanyi','aify','fy','ai translate']`。
- **别名基线注意**：`palette.test.ts` 已有「'sz' 只命中打开设置 / 'yin' 无命中」两条断言——新增别名不得引入 `sz`/`yin` 前缀冲突（实现后用测试验证）。

### 2.4 PageView 接线（行为规格）
1. mount 时 `window.addEventListener('septcats:ai-action', handler)`，unmount 移除（照 `SyncStatus` 的 `septcats:sync-open` 范式）。
2. handler(action)：取 `editor`；`const { from, to } = editor.state.selection`；`selected = doc.textBetween(from, to, '\n')`；
   - 无选中 → 定位光标所在块：`doc.resolve(from)` 沿 `depth` 找最近的块级节点（`node.isBlock && node.isTextblock`），取其 `textContent` 与区间 `[blockStart+1, blockStart+node.nodeSize-1]`；空文本 → 空态文案 `ai.emptyText`。
   - `const st = await window.septcats.ai.state()`：`!st.enabled` → 空态 `ai.needEnable`；`st.providers.length===0` → 空态 `ai.needProvider`；否则 `providerId = st.activeProviderId ?? st.providers[0].id`。
   - `ai.chat({ providerId, messages: buildAiMessages({action, text}) })` → phase ok（`result.text`）；错误 → phase error（`Error.message`）。
3. `onApply`：`continue` → 在该块末尾（无选中时块末；有选中时选区末尾）`tr.insertText(result, target, target)`；其余动作 → `tr.insertText(result, from, to)`；dispatch 后走 **PageView 既有保存路径**（照现有 commit/保存调用，勿新增旁路）；随后关闭面板并 `ai.applied` 轻提示（可用现有 toast/或不加；不加也行，但**必须**在报告里写清选择了哪种）。
4. `onOpenSettings`：跳设置页（照 App 既有路由方式）。
5. 面板关闭 → 清 result/error/phase。

## 3. 测试（自跑，每个文件落盘后立即跑）
- `test/ai-prompts.test.ts`：四动作 system 文案逐字断言（`toContain` 关键句）；`targetLang` 默认 English / 传入 '日本語' 生效；user 消息原样（含换行/前后空格）；四动作返回长度 2 且 role 顺序 system→user。
- `test/palette.test.ts`（追加，不改既有）：4 条命令在 `COMMAND_DEFS` 中 id 正确；别名 `xuxie`/`zy`/`gx`/`fy` 各自命中对应 id 且**互不串**；空 query 命令序仍稳定（既有断言不动）。
- `test/ai-panel.test.tsx`（新建，jsdom）：四态渲染（busy 文案 / ok 结果文本可见且 `user-select` 未被禁用 / error `role=alert` 原文 / 空态引导 + 「打开设置」回调）；`onApply` 在 ok 态点击被调；error 态「重试」被调。
- 不写 PageView×TipTap 集成单测（真机 CDP 覆盖，见 §4）。

## 4. 真机 CDP 脚本 `docs/mockups/cdp-e2e-ai.mjs`（PM 跑）
照既有 `cdp-e2e-*.mjs` 范式（CDP 直连 renderer + 截图目录 `docs/mockups/`），断言项：
1. 启动 dev 实例（PM 提供 LM Studio 已开 + 设置页配好 provider 的前提下）：设置页「AI 助手」区块渲染、启用开关可开、provider 行「测试连接」成功文案出现。
2. 编辑器：新建页 → 输入中文段落 → 全选 → 派发 Ctrl+K 命令「AI 摘要」（或直接 `window.dispatchEvent`）→ 面板出现 →（真机 LM Studio 生成）→ 结果区非空 → 点「应用」→ 页面块文本变为结果。
3. 未配置路径：关掉 AI 开关 → 触发动作 → 空态引导文案出现 + 「打开设置」可点。
4. `pageerror` 计数 0；截图双主题各 1 张（设置页 + 面板）。
（脚本可注入 `window.septcats.ai.chat` 假实现做**离线**断言层，真机 LM Studio 层由 PM 手动/半自动跑——两种都要，报告里分别记。）

## 5. DoD（PM 复跑）
```bash
pnpm -r typecheck && pnpm -r test && node packages/ui/tokens/no-magic.mjs && pnpm -C apps/desktop selftest
```
+ 红线核验：`git diff --stat -- packages apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/shared/ai.ts apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/settings.ts` 为空（`shared/aiPrompts.ts` 属允许新增）。
+ PM 真机 CDP 层（§4）在收口时跑并记报告。

## 6. 收尾
改动文件清单 + 每条命令最后一次输出摘要（含测试计数对账）+ 报告落盘。**不改** 设置页/AiSection·main/preload/通道；不碰 git；不新增依赖。