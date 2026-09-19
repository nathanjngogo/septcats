# TASK-T41-01 · R4：编辑区全宽开关（Notion 式「Full width」）

> PM：Hermes ｜ P2（老板新需求 R4）｜ 前置：T40-01 收口后排队（若 T39-01 已落地，需与之协作读同一份布局变量）
> 老板原文：「编辑区，要能像Notion一样，有个选项开关能选择全宽。」

## 0. 现状（PM 侦察）

`apps/desktop/src/renderer/src/pages/PageView.css:15,32` 两条规则都用
`max-width: var(--sc-space-editor-measure);`（正文列居中、有固定 measure）→ 全宽就是把该列放开到容器宽。

## 1. 必须做到

1. **每页一个开关**（Notion 语义：**按页面**记，不是全局）：页面 `⋯` 菜单加一项「**全宽 / 固定宽度**」（可切换、显示当前状态、有勾选态）；命令面板加同名命令。
2. **实现口径**：**必须走 CSS 变量/类**（如页面根加 `--sc-page-measure: none` 或 `data-measure="full"`），**不许**用 JS 直接量测/内联改宽高。
3. **作用范围**：只放开**正文列**（`.pv-body` 等），标题/面包屑/页签条/侧栏/AI 面板不受影响；**不得**破坏 T33 的装订线 `gutter >= 8`（块手柄仍要在文字外 12px 左右）。
4. **持久化**：按页面 + 按 workspace 持久化（与 `septcats.tabs.<ws>` 同范式，localStorage）；重开还原；不同页面互不影响。
5. **默认值**：新页面默认「固定宽度」；若 T39-01 布局设计器已落地，允许布局预设提供**全局默认 measure**（页面级开关优先于全局默认）。
6. **不做**：不做每页字体/行距、不做导出差异。

## 2. 验收（数值化/真机）

1. 切到全宽：正文列 `clientWidth` 变为容器宽（贴实测数值：固定 = measure 值，全宽 = 容器宽；两者差值 > 0）。
2. **只影响正文列**：切换前后**标题/页签条/侧栏/AI 面板宽度不变**（贴数值）。
3. **装订线不回归**：切到全宽后手柄×文本 `overlap=false`、`gutter >= 8`（复用 `docs/mockups/probe-text-overlap.mjs`）。
4. **每页独立 + 持久化**：A 页全宽、B 页固定 → 重启后仍各自保持（贴断言）。
5. 回归：窗口零滚动（T30）、侧栏可完全收起、页签（T37）、AI 面板（T38）、对比度门禁；全仓无红。
6. 双主题 × 四态截图（固定/全宽 各主题）。

## 3. 红线

- 允许动：`apps/desktop/src/renderer/src/**`（PageView 及相关状态、菜单命令、i18n）、`apps/desktop/test/**`。
- 不碰：`packages/**`（含 `DESIGN.md`/tokens）、`main/**`、`shared/**`、CI。若确需新 token/布局变量 → 先报告等 PM 裁决。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（需调整 §DEVIATION 逐条）。
- CSS 只走 `var(--sc-*)`、无字面 hex、无非 1px 重复裸 px。

## 4. 交付物

代码 + 测试（切换生效 / 仅正文列 / 每页独立 + 持久化 / 装订线不回归）+ 真机数值与双主题截图 + `docs/tasks/TASK-T41-01-report.md`（PM 复跑节留「（PM 补）」；DEVIATION 逐条）。
