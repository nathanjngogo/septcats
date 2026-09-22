# TASK-T63-01 · P1：全宽定义修正——随窗口/分辨率自适应 + 缩小窗口走横向滚动

> 老板 09-22 原话：「编辑区的全宽的定义不对。我需要全宽可以随最大化的大小变化（要适配不同分辨率的电脑）」+「如果缩小，全宽可以以编辑区下方的滚轴来拉动。」

## 0. 根因（PM 已定位，勿重复调查）

现状全宽链（T41-01）：`.pv-root[data-measure='full'] .pv-body { max-width: none }`（PageView.css:50）。**但正文真正宽度被内层编辑器外壳二次钉死**：

- `packages/editor/src/react/editor.css:9` `.sc-editor { max-width: var(--sc-space-editor-measure) /* 720px */; margin: 0 auto; }`（PageView.tsx 里 `<Editor>` 渲染在 `.pv-body` 内，外层解除了、内层没解除）→ **全宽=假全宽，正文永远 720px 居中**，这就是老板判「定义不对」的本体。
- `.pv-title-row`（标题行）在全宽态也仍夹 720（PageView.css:17，T41 原口径=标题不动；老板新口径=全宽应整列铺满，**此原口径作废**）。
- `.pv-root` 只有 `overflow-y: auto`（PageView.css:9），无横向滚动兜底。
- 宽度自适应本体**不需要新机制**：编辑列 `.app-editor-col` 是 `flex:1 min-width:0`（App.css），窗口最大化/换分辨率时列宽本来跟着变——只要把「720 内层钉」拔掉，全宽即 = 列宽 100%，天然适配任意分辨率。**禁 JS 量测/resize 监听/内联宽高**（CSS-only 纪律不破）。

## 1. 实现口径（PM 定死）

1. **全宽态整列铺满**：`.pv-root[data-measure='full']` 作用域内同时解除——
   - `.pv-body`：保持 `max-width: none`（已有）；
   - `.sc-editor`：`max-width: none`（本单核心修复；跨包选择器走 `.pv-root` 作用域写在 PageView.css，**不要求 dbview/editor 包 CSS 改动**，editor 包零碰）；
   - `.pv-title-row`：`max-width: none`（老板新口径：标题行同步铺满；T41「标题保持 measure」原决议作废，DESIGN.md/注释按新口径改写）。
   - 固定态（非全宽）= 现状 720/measure 完全不变（默认阅读列不破）。
2. **缩小窗口 → 编辑区下方横向滚轴**：`.pv-root[data-measure='full'] { overflow-x: auto }`。
   - 硬前提：**不得出现无条件横向滚动**——固定态、窄窗（390px 逻辑宽）下 `.pv-root` 仍 `overflow-x: visible/hidden 等效无横滚`（探针实测 scrollWidth ≤ clientWidth）。
   - 全宽+窄窗时出现横滚是**预期行为**（老板点名要），判定基准=内容自然宽不被压缩（正文/表格按内容展开），滚动条在编辑区底部（`.pv-root` 自身滚动容器，非 window——窗口零滚动红线不破）。
   - 滚动条外观走仓内既有 scrollbar 像素化样式（若有），没有就裸默认，**不新增视觉层**。
   - 手柄装订线：横滚后 `.pv-handle`（absolute，left:0 相对 pv-body）随内容走属预期；gutter≥8 断言只在固定态+宽窗全宽态复验。
3. **多分辨率适配断言**（不写代码，探针验）：同一全宽页在 1920/1440/1280/1184 逻辑宽下正文可用宽 = 列宽−gutter（贴数值、逐档变化）；660 逻辑宽=横滚分支。
4. DbPage（数据库页）不参与全宽（T41-01-1 既有裁决不变），本单不动其口径。

## 2. 交付要求

1. 改动面预期：`apps/desktop/src/renderer/src/pages/PageView.css`（唯一 CSS）+ 注释；T41 时代「标题保持 measure」注释改写为新口径并指向本单。
2. 单测/回归：**已知旧口径钉子=`apps/desktop/test/page-width.test.tsx`（:278-279 断言「标题行不被全宽覆盖」）**——按新口径改写该组期望（标题行同步铺满），其余同文件用例保持；改处列 DEVIATION 报；新增 CSS 口径纪律测（grep 型）：全宽作用域含 `.sc-editor`/`.pv-title-row` 解除 + `overflow-x: auto` + 固定态不含任何横滚声明。
3. 真机探针 `docs/mockups/cdp-e2e-t63-01.mjs`（参考 cdp-e2e-t41-01.mjs 与 t62 探针范式；**先跑一次性形状探针再写断言**，行内标题读 input.value 防编辑态假红）：
   - A 全宽铺满：开全宽后 `.sc-editor`/`.pv-body`/`.pv-title-row` 的 `getBoundingClientRect().width` ≈ `.pv-root` 内容宽（±gutter），**断言 ≥0.95×列宽**（现状会 720/列宽 失败=红→修后绿）；
   - B 分辨率扫档：`page.setViewportSize`（Electron 用 `win.setBounds`——参考 t52 探针窗口 resize 法）1920/1440/1280/1184 四档，逐档贴 A 数值（证明随窗口变，非固定像素）；
   - C 横滚兜底：660 宽 + 全宽 → `.pv-root` `scrollWidth > clientWidth` 且 `scrollLeft` 可动（滚到底读到右侧元素）；**固定态 660 宽** → `scrollWidth <= clientWidth`（无横滚红线）；window 级 `scrollWidth<=innerWidth` 两态都断言（窗口零滚动）；
   - D 每页独立+重启还原+双主题截图 4 张（宽窗全宽/宽窗固定/窄窗全宽横滚/重启后）。
4. 报告 `docs/tasks/TASK-T63-01-report.md`：骨架前置，DEVIATION 留空节；数值全贴原始。

## 3. 红线

- 仅动 `apps/desktop/**`（CSS/测试）；`packages/**` 零改动（editor 的 720 默认**不改**——它仍是固定态与包内独立使用场景的兜底；解除只在全宽作用域）；core/sync 零碰。
- 不新增 JS 量测/resize 监听；不新增依赖；不碰 git；真档案只读（`_scratch` 夹具）。
- 交付前杀净 electron、贴 node 计数=0（对照基线口径）。

## 4. DoD（PM 复跑判据）

- 探针 A/B/C/D 全绿；`pnpm -C apps/desktop test` 无红；typecheck 0；双门禁+selftest OK；固定态零回归（720/measure 数值与 T41 老探针在固定分支一致）。
