# TASK-T24-01 · UI 收口三小项：删除页面入口 + 「转为数据库」后另存口径 + Toast 挂载

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T23-02 已交付（`7fe582d`）
> 本单是三个已登记缺口的合并小修（均经真机/审阅实证）：

## 0. PM 裁决（先定死）

### A. T22-01-2：补「删除页面」入口（让回收站鼠标可达）

现状：`removePage` 在 renderer 侧**零调用点** → 回收站列表/恢复/彻底删除鼠标不可达（T22-01 交付的 UI 正确但进不去）。
实现两处（都走既有 `pagesStore` 动作，二次确认复用 `@septcats/ui` Dialog，同 T22-01 范式）：
1. **命令面板**新增命令「删除页面」（仅当前有选中页时出现；无选中页不出现/置灰，不得抛错）→ Dialog 确认 → `removePage(selectedId)` → 回到 pages 视图且**选中回落**（若无选中则调 `ensureSelection()`）。
2. **侧栏行「⋯」菜单**：行 hover/选中时显示「⋯」→ 菜单项「删除」→ 同 A.1 的 Dialog 与调用（含子页时的文案提示继承既有 `彻底删除` Dialog 措辞风格）。
**删除后的状态刷新**：动作本身更新 store（既有语义），侧栏树/最近/回收站角标需同步——若既有动作已覆盖则不加代码，否则最小补齐并在报告说明。

### B. T23-02-1：「转为数据库」后经面板另存模板得 `kind=page`（应 database）

**先判别再修**（必须给出证据，不许猜）：
1. `PageView.tsx:188` 注：转换后的跳转「一期无路由，用本地状态承载」→ 判别 **`pagesStore.selectedId` 在转换后是否指向新建的库页**（探针：转换后读 `pages:tree` 与选中态，或直接在页面里用 `document` 观察侧栏 active 行）。
2. 判别新库页的 **collection 是否按 `page_id` 关联**（服务层 `saveFromPage` 就是靠这个判定 kind）。
**修法二选一（按判别结果，报告写清依据）**：①转换后同步更新 store 选中项（`selectPage(newDbPageId)`）→ 面板命令自然存对页；②若 selectedId 已正确而 collection 未按 page_id 关联 → 修转换写入的 collection payload（**这属于数据面，须只增不改并在报告标注**）。
**验收**：真机 —— 建页 → 转为数据库 → 面板「另存为模板」→ `templates:list` 该模板 `kind='database'`；再从该模板建页 → 新页是库（界面出现「新建记录」库 UI）+ 新库 **0 条记录**。

### C. T23-02-2：挂载 `ToastViewport`

`pushToast` 全库有调用但 `ToastViewport` **从未挂载** → 所有提示不可见（非 T23-02 删减，属既有缺口）。修：在 `App.tsx` 挂载（位置=根层、不遮挡 Dialog；样式走既有 token）。**验收**：真机 —— 另存为模板后出现可见提示（或至少断言 `ToastViewport` DOM 存在且 pushToast 有节点落地）。

## 1. 交付物

`renderer/src/**`（命令面板/侧栏行菜单/Settings 无关、App 挂载、`PageView.tsx` 仅转换后选中口径）、必要时 `main/**` 仅限 B 的判别结论指向数据面时（须先报告说明），`apps/desktop/test/**`、`docs/tasks/TASK-T24-01-report.md`（PM 复跑节留「（PM 补）」）。

## 2. 红线

- 允许动：`renderer/src/**`、`apps/desktop/test/**`；**B 若确需数据面改动，只增不改且必须在报告 §DEVIATION 明列**。
- 不碰：`packages/**` 契约、`shared/**`、CI/发布脚本、`main/**` 其余既有逻辑。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变；CSS 只走 `var(--sc-*)`、图标只从 `@septcats/ui` 出口、双主题四态齐备。

## 3. 自跑（全仓/selftest/真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。

**PM 收口会跑**：全仓 + selftest + 重打包 + 真机（删除入口→回收站→恢复/彻底删全鼠标链路；转换→另存 kind=database→实例化 0 记录；另存后有可见提示）。