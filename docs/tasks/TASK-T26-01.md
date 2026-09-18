# TASK-T26-01 · 收尾两项残留：空库回落 demo 假内容 + 「已同步」未英化（含门禁硬化）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T25-01 已交付（`bd3efac`）
> 两项均为 PM 真机抓出的真问题：

## 0. PM 裁决（先定死）

### A. T24-01-1：空库回落 demo 假内容 → 应为空态

现状（真机证据）：删掉**唯一**一个页面后，正文区显示设计稿 demo 页（「🔭 暗物质探测实验笔记 / 本页汇总 LZ 类稀有事件探测的实验现状与文献线索…」）——用户会以为软件里凭空多出一篇不是自己的笔记。
修：`PageView` 的 `DEMO_PAGE` 兜底**仅保留给夹具/演示场景**（判据自选：如仅在 `rootPath` 为夹具根/显式演示开关时启用，或直接移除兜底），**正常空库（无任何页面）走既有空态**（复用既有空态样式，与回收站/搜索空态同 token 组合；文案走 `t()` 并补 en）。
验收：真机 —— 新库删除唯一页 → 正文区显示**空态**（无 demo 假标题/假正文）；`grep` 确认 demo 常量不再出现在正常路径（报告说明判据）。

### B. T25-01-1：「已同步」未英化 + 门禁盲区

现状（真机证据，切 English）：顶栏同步状态仍显示「已同步」（`cjk=7`），其余界面已全英文。
修两步：
1. 该文案（以及同类**非 JSX 来源**的用户可见文案：状态指示、从 `.ts` 常量/映射产出的文案）改为走 `t()`，补 `zh-CN`/`en-US` 两侧键。
2. **门禁硬化**（关键，防同类漏网）：`i18n.test.ts` 的 CJK 源码扫描从「只扫 JSX 文本/属性」扩展为——扫描 `renderer/src/**`（`.ts` + `.tsx`）中**非注释、非日志（`console.*`）、非 i18n 字典/测试/夹具**的**字符串字面量**是否含 CJK；命中即失败并列出文件:行。
   - 允许白名单（须在报告说明理由）：`i18n/*.ts` 字典、`*.test.*`、`docs`、以及确属用户内容/演示内容的常量（若保留 demo 兜底则列入白名单并注明）。
   - **注意**：`errorText()` 之类的键映射表属于「键引用」不是文案，不算违规（按其值是否为 CJK 判定）。
验收：层测门禁在**修前能复现红**（可先跑一次记录原文）→ 修后全绿；真机切 English 顶栏无 CJK。

## 1. 交付物

`renderer/src/**`（PageView 兜底/空态、同步状态文案、`i18n/{zh-CN,en-US}.ts` 键）、`apps/desktop/test/i18n.test.ts`（门禁硬化）、`docs/tasks/TASK-T26-01-report.md`（PM 复跑节留「（PM 补）」；含「门禁修前红 → 修后绿」原文）。

## 2. 红线

- 允许动：`renderer/src/**`、`apps/desktop/test/**`。
- 不碰：`packages/**`、`shared/**`、`main/**`、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（若既有测试断言 demo 页文案，须在 §DEVIATION 说明并按新语义调整）。
- UI 红线：CSS 只走 `var(--sc-*)`、图标只从 `@septcats/ui` 出口、双主题四态齐备。

## 3. 自跑（全仓/selftest/真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。

**PM 收口会跑**：全仓 + selftest + 重打包 + 真机（删唯一页 → 空态非 demo；切 English → 顶栏无 CJK → 切回中文）+ 双主题截图。