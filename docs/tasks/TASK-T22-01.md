# TASK-T22-01 · UI 打磨批次 2：面包屑真路径 + 回收站列表 + 空态/微交互

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T21-02 已交付（`a20ec52`，侧栏真树/选中页/跳转全通，真机 ALL-PASS 8/8）

## 0. PM 裁决（先定死，勿另择方案）

### A. T21-02-1：顶栏面包屑去 demo（真机 vision 目检抓出的残留）

现状：`App.tsx:102-108` 的 pages 视图面包屑写死 `[{label:'研究'},{label:'暗物质探测实验笔记'}]`，选中真实页后仍显示 demo 路径。
改为：**按 `pagesStore.selectedId` 的祖先链真实渲染**（`nodes` 每项有 `parentId`，沿 `parentId` 上溯到根；顺序=根→当前页；每段 label=该节点 `title`，空标题回退「未命名」）。无 `selectedId` → 显示工作区名（沿用既有文案来源）；`scope==='trash'` → 「回收站」；`settings`/`importWizard` 视图保持现状不动。

### B. 回收站列表 UI（T21-02 报告 §2 遗留的裁量项）

现状：`showTrash()` 只切换 `scope`，侧栏有入口与待删角标，但**没有待删页列表**（store 侧 `trash` 节点数组 + `restorePage(id)`/`purgePage(id)` 动作都已存在）。
实现：`scope==='trash'` 时在侧栏（或主区，取既有布局最自然处）列出待删页树（含被删页的子页，`parentId` 关系已在 store 里裁好，直接用既有 `trash` 结构），每行两个动作：**恢复**→`restorePage(id)`；**彻底删除**→`purgePage(id)`。
**二次确认**：先 `grep -rn "ConfirmDialog\|Modal\|Dialog" renderer/src` —— **有既有确认组件必须复用**；确实没有则最小实现（走 token、双主题），并在报告说明。空态复用既有空态样式。
返回 pages：既有 `showPages()`（T21-02 已通）。

### C. 视觉打磨批次 2（空态一致性 + 微交互）

1. **空态统一**：`.search-empty`（T20-01 三处组件之一）与新增回收站空态、侧栏「收藏/最近」空态，**视觉一致**（同一 token 组合：色/间距/字号），双主题下都成立。
2. **微交互**：侧栏行/列表行的 hover/active/focus 过渡建议统一为 `transition: background-color var(--sc-*)` 等 token 化短过渡（≤150ms），**必须尊重 `prefers-reduced-motion: reduce`**（加 `@media` 兜底）。
3. 不引入动画库、不加关键帧炫技；只做「不刺眼、有反馈」的克制打磨。

## 1. 交付物

- `renderer/src/App.tsx`（面包屑真实化）、如需要则新增 `renderer/src/pages/TrashList.tsx`（+CSS 走 token）。
- `renderer/src/pages/SearchPage.tsx` 或相关组件（`.search-empty` 空态一致性，若需）。
- 既有 CSS（`App.css`/组件 CSS）：空态统一 + 微交互 + `prefers-reduced-motion`。
- 测试：`apps/desktop/test/**`（面包屑祖先链纯函数/组件级：多层父链顺序、空标题回退、trash scope；回收站恢复/彻底删除回调断言）。
- `docs/tasks/TASK-T22-01-report.md`（PM 复跑节留「（PM 补）」）。

## 2. 红线

- 允许动：`renderer/src/**`（UI 面）、`apps/desktop/test/**`。
- **不碰**：`main/**`、`packages/**`、`shared/**`、`state/pages.ts` 既有动作语义（如需小修须报告说明，只增不改）、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变。
- UI 红线（§16）：CSS 只走 `var(--sc-*)`、无字面 hex；图标只从 `@septcats/ui` 出口；**双主题 × 四态（默认/hover/active/disabled）齐备**；`node packages/ui/tokens/no-magic.mjs` 与 `build-tokens.mjs --check` 必须通过。

## 3. 自跑（全仓与真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。

**PM 收口会跑**：全仓 + selftest + 重打包 + 真机 CDP：选中多级页面看面包屑是否随之变化 → 删除页 → 回收站列表出现 → 恢复 → 彻底删除 → 双主题截图复审空态与 hover。