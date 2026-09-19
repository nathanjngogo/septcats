# TASK-T30-01 · 🔴 P1 布局三缺陷：侧栏不完全收起 / 侧栏随内容滚动 / 转库编辑被遮

> PM：Hermes ｜ 优先级 **P1（用户实测反馈，老板亲自报障）** ｜ 前置：T29-01 收口（`4c9e272`，rc.5）
> 来源：老板真机截图 + 口述三症状（附原始截图 `image_df5503.png`）

## 0. 症状（老板原话）

1. **侧边栏不能完全收起**
2. **侧边栏会跟着编辑区一起滚动**
3. **转为数据库编辑的时候，软件区域有一半是被遮掩的**

## 1. PM 已定位的根因（①②；③ 需你先复现定位）

**① 收起 = 窄轨而非隐藏**：`packages/ui/src/AppShell.css:36` `.sc-shell--collapsed .sc-shell__body { grid-template-columns: var(--sc-layout-sidebar-collapsed) 1fr }` —— 收起态只是把列宽换成窄轨，`<aside>` 与其中内容仍渲染占位。
**② 滚动发生在窗口级**：`.sc-shell { height: 100% }`（`AppShell.css:4`）依赖父级定高，但 `html/body/#root` 未设 `height:100%` 且未禁滚动 → shell 被内容（尤其数据库页）撑高 → **窗口出现滚动条，整个布局（含侧栏）随内容上移**；此时 `.sc-shell__main { overflow: auto }`（`AppShell.css:49`）形同失效。老板截图里「右侧滚动条只覆盖上半屏」正是窗口级滚动 + main 内部滚动的叠加症状。
**③ 待复现定位**：疑为「转为数据库后进入记录编辑（打开记录/单元格编辑）」时，编辑面板或浮层覆盖主区约半屏且不易关闭。**你必须先在真机上复现并给出确切遮挡元素**（`elementFromPoint` 采样 + 截图 + 复现步骤），再动手修——**不许猜着改**。

## 2. 修法与验收（可量化，别只凭肉眼）

### ① 完全收起
- 收起态：侧栏**宽度 = 0**（内容不可见、不占位、不响应点击），主区**占满剩余宽度**；顶部栏的 `sc-shell` 侧栏按钮保留（点击可展开）；展开态恢复现状宽度。
- 验收断言（真机）：收起后 `.sc-shell__sidebar` 的 `getBoundingClientRect().width === 0`（或 `display:none`）且 `document.querySelector('.app-side')` 不可见；主区宽度 ≈ 窗口宽度 − 0；再点按钮恢复。

### ② 侧栏不随内容滚动
- 目标：**滚动只发生在内部滚动容器**（侧栏 `.app-side-scroll`、主区 `.sc-shell__main`），**窗口不得滚动**。
- 验收断言（真机，三条都要）：
  1. `document.scrollingElement.scrollHeight <= clientHeight + 1`（窗口无滚动）；
  2. 在主区滚到底后，`.app-side` 的 `getBoundingClientRect().top` **与滚动前一致**（±1px）；
  3. 数据库页/长页面下同样成立（不要只测空页）。

### ③ 转库编辑不遮
- 先复现 → 报告给出：遮挡元素、触发步骤、覆盖面积（可用网格采样 `elementFromPoint` 估算主区被覆盖比例）。
- 修后验收：转库 → 编辑记录/单元格 → **主区关键内容（表格/记录）不被不可关闭的浮层遮挡**；任何面板必须可关闭（Esc 或显式按钮），且主区可继续滚动/交互。

## 3. 红线与授权（本单特殊：允许动共享 shell，但最小化）

- **允许动**：`packages/ui/src/AppShell.{tsx,css}`（**本单唯一授权的 packages 改动**：布局语义修复，只动折叠列宽与溢出/高度约束；**不得**改 AppShell 的 props API、不得改其它包）、`apps/desktop/src/renderer/src/**`（全局 CSS/布局容器）、`apps/desktop/test/**`。
- **不碰**：`packages/{core,sync,editor,dbview,importer}`、`shared/**`、`main/**` 业务逻辑、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（如需调整 §DEVIATION 逐条）。
- **UI 红线照旧**：CSS 只走 `var(--sc-*)`、无字面 hex、无非 1px 重复裸 px；图标只从 `@septcats/ui` 出口；双主题四态齐备；`no-magic` 与 `build-tokens --check` 必须通过。
- **shell 回归自证**：`packages/ui` 既有测试（75 例）必须全绿；若既有无障碍/结构断言与「完全收起」冲突，用最小调整并在报告说明。

## 4. 交付物

代码 + 测试（折叠态宽度/窗口不滚动/主区可滚 + 任何可断言的布局不变量；布局类断言可用既有 DOM 测试栈）+ 真机复现与修复前后证据（截图 + `getBoundingClientRect` 实测数值）+ `docs/tasks/TASK-T30-01-report.md`（PM 复跑节留「（PM 补）」；§三症状各自的根因与验收数值；DEVIATION 逐条）。

## 5. 自跑（全仓/selftest/重打包/真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -C packages/ui test`（或等价包内命令）、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。
**PM 收口会跑**：全仓 + 重打包（**打包前先 `node apps/desktop/scripts/ensure-abi.mjs electron`**，否则 DbServer 起不来）+ 真机三症状逐条断言 + 双主题截图。