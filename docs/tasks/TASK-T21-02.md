# TASK-T21-02 · 关键路径 2/2：真实页面导航与显示（侧栏真树 + 选中页 + 搜索跳转）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T21-01 已交付（`3c17b1c`；编辑器已能按 `selectedId` 加载/落库）
> 现状（PM 实证）：`App.tsx` 侧栏是**设计稿假树**（硬编码 `<TreeRow label="新建页面" …/>` 等），`PageView` 已改为按 `pagesStore.selectedId` 渲染真实页（T21-01），但**没有任何入口去设置 `selectedId`**；`pagesActions.load()` 已在挂载时调用（T20-02），store 里 `nodes/favoriteIds/recentIds/selectPage/toggleExpand/beginRename/showTrash/create` 等动作**都已存在**——缺的是 UI 渲染与事件绑定。

## 0. PM 裁决（先定死，勿另择方案）

1. **侧栏改为真树**：用 `pagesStore.nodes`（`PageNode{id,title,childIds,depth,...}`）渲染三级树，替换 `App.tsx` 里硬编码的 TreeRow 列表。
   - 交互：点击行 = `selectPage(id)`；有子页的行显示折叠三角 = `toggleExpand(id)`（`expanded: Set<string>` 在 store 中）；`active` 高亮 = 当前 `selectedId`。
   - 「新建页面」行 = `create({parentId:null})`（返回值取 id → `selectPage` 选中新页）；「收藏」「最近」分组用 `favoriteIds`/`recentIds` 经 `nodes` 解析（找不到的 id 跳过；为空则显示既有空态样式）。
   - 「回收站」= `showTrash()`（既有动作切换 `scope`）；`view` 回 pages 用 `showPages()`。
   - **视觉零新增**：复用既有 CSS 类与 token（`app-side*`/行样式），只把数据从常量改成 store；密度/层级/图标沿用设计稿（Phosphor Icon 出口）。
2. **初始化选中**：`load()` 完成后若 `selectedId === null`，调用既有 `ensureSelection()`（或等价逻辑）选中首个可达页；`load()` 失败保持既有错误态。
3. **搜索命中跳转**：命令面板 hit 点击 → `selectPage(hit.pageId)` + 关面板（`close()`）+ 视图切回 `editor`（`showPages()`）；`SearchPage` 结果点击同理（其 `openHit` 已有链路，接上 selectPage 即可）。
4. **PageView 无改动**（T21-01 已接线）；若发现 demo 兜底与真实页冲突（例如 `page` 显式传入导致 demo 优先），以「真实页优先」修正并在报告说明。
5. 行内重命名：双击行标题 → `beginRename(id)` + 既有 `editingId` 输入框（store 已支持）→ Enter 调 `rename`，Esc 取消。若既有 store/UI 缺输入框组件，**最小实现**（行内 input + 既有样式），不新增设计。

## 1. 交付物

- `apps/desktop/src/renderer/src/App.tsx`（侧栏真树渲染 + 事件绑定）、如需要则新增 `renderer/src/pages/SidebarTree.tsx`（+CSS 走 token）。
- `renderer/src/palette/CommandPalette.tsx`（hit 点击跳转）、`renderer/src/pages/SearchPage.tsx`（结果点击跳转）。
- `renderer/src/state/pages.ts`：仅在必要时小修（如 `ensureSelection` 可复用性）；**不改既有动作语义**。
- 测试：`apps/desktop/test/**`（store 级可测：selectPage/expand/新建选中/跳转回调）；renderer 无 React 测试环境则以 store 级 + PM 真机承接，报告写明口径。
- `docs/tasks/TASK-T21-02-report.md`（PM 复跑节留「（PM 补）」）。

## 2. 红线

- 允许动：`renderer/src/App.tsx`、`renderer/src/pages/SearchPage.tsx`、`renderer/src/palette/CommandPalette.tsx`、`renderer/src/state/pages.ts`(小修)、`renderer/src/pages/SidebarTree.tsx`(新，如需) 与其 CSS、`apps/desktop/test/**`。
- **不碰**：`main/**`（含 T21-01 的 blocks/search/collab/sync IPC）、`packages/**` 既有契约、`shared/**`、CI/发布脚本。
- 不加新依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变；UI 红线：CSS 只走 `var(--sc-*)`，图标只从 `@septcats/ui` 出口，双主题四态齐备。

## 3. 自跑（全仓与真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。
**PM 收口会跑**：全仓 + selftest + 重打包 + 真机 CDP 全链路：**建页 → 侧栏出现 → 点开 → 输入中文 → 重载 app → 文字仍显示在该页 → 搜索该词 → 点结果跳回该页**。