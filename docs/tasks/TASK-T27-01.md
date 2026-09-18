# TASK-T27-01 · 收尾：默认工作区名按 locale 种子 + 交互态/空态巡检（S4 批次 3）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T26-01 已交付（`c6310f6`）

## 0. PM 裁决（先定死）

### A. T26-01-1：默认工作区名按「创建时 locale」种子

现状（真机证据）：English 模式下整页仅剩 5 个 CJK = 默认工作区名「个人工作区」——建库时写死的**中文种子**。它是数据（用户可改名），但种子应由创建时的 UI 语言决定。
修：首次建工作区（首次启动 或 创建设置）时，名称取 `t('workspace.defaultName')`（zh-CN=`个人工作区`，en-US=`Personal Workspace`）。
**顺带查**：工作区是否**可改名**（`workspaces` slice 有 `rename`）。若 renderer 无改名入口 → **本单只做种子**，并把「工作区改名入口缺失」作为发现登记（报告 §发现），**不要**顺手扩大范围做设置页 UI（避免范围膨胀）。
**验收**：层测（英文 locale 种子=Personal Workspace；中文=个人工作区）；真机（English 首次启动的库，整页 CJK=0，含工作区名）。

### B. S4 批次 3：交互态与空态巡检（收尾，克制）

1. **交互态覆盖巡检**：侧栏行、树行、回收站行、设置行、面板行、模板行、按钮与图标按钮——hover / active / focus-visible 是否都有**可见反馈**且走 token；补齐缺失项（只补 gating 的缺口，不做视觉改版）。
2. **过渡纪律**：过渡时长 ≤150ms、token 化、**全部带 `prefers-reduced-motion: reduce` 兜底**（巡检遗漏处补齐）。
3. **空态一致性**：`.pv-empty`（空库）、`.trash-empty`、`.search-empty`、`.tpl-empty`（模板空态）、`.app-nav-empty`（收藏/最近空态）**同一 token 组合**（色/字号/间距对齐；若有理由不同须报告说明）。
4. **双主题 × 四态**：以上元素在浅/深两主题下四态（默认/hover/active/disabled 或 focus）齐备。
5. 不引入动画库、不加关键帧炫技；`no-magic` 与 `build-tokens --check` 必须通过。

## 1. 交付物

`renderer/src/**`（工作区种子、交互态与空态 CSS/组件）、`apps/desktop/test/**`（种子 locale 断言 + 巡检相关断言）、`docs/tasks/TASK-T27-01-report.md`（PM 复跑节留「（PM 补）」；§发现 列出巡检中发现的缺口与未修理由）。

## 2. 红线

- 允许动：`renderer/src/**`、`apps/desktop/test/**`；（若工作区建库在 main 侧，则允许 `main/**` **只增不改**并必须在报告 §DEVIATION 明列）。
- 不碰：`packages/**` 契约、`shared/**`、CI/发布脚本、`main/**` 其余既有逻辑。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变；UI 红线同 §0.B。

## 3. 自跑（全仓/selftest/真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。

**PM 收口会跑**：全仓 + selftest + 重打包 + 真机（English 首次启动整页 CJK=0 含工作区名；交互态与空态双主题截图）。