# TASK-T23-02 · 模板子系统（方案 B）· UI 面：另存为模板 + 两处入口 + 模板管理

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T23-01 已交付（`00c0412`，数据面六通道全通、真机 10/10）
> 老板裁决：**两处入口**（侧栏「新建页面」下拉 + 命令面板）；模板列表显示**名称+图标**；页面模板与数据库模板都做。

## 0. PM 裁决（先定死，勿另择方案）

### A. 模板图标 = 继承源页图标（本期不做图标选择器）

`saveFromPage({ pageId, title, icon? })` 已支持 icon；本期 UI **只传 `title`**，icon 由源自页面/库继承（`icon` 在 UI 只用于**展示**列表行）。理由：图标选择器是独立小功能，本期不做，避免范围膨胀；后续需要再单开。

### B. 另存为模板（入口 1：命令面板命令）

命令面板（Ctrl+K）**新增命令**「另存为模板」：仅在当前有选中页时可用 → 触发 `Dialog`（复用 `@septcats/ui`，与 T22-01 同范式）输入模板名称（默认值=当前页标题），确认 →
- 调 `window.septcats.templates.saveFromPage({ pageId: selectedId, title })`
- 成功后轻提示（用既有 toast/提示机制；若无，则关闭对话框即可，不新增全局提示系统——报告说明）
- **无选中页**时不出现该命令（或置灰），不得抛错。

### C. 两处「从模板新建」入口

1. **侧栏「新建页面」行**：改为「新建页面 ▾」——点击主体仍=新建空白页（保持既有行为不破坏），点击右侧小箭头展开**模板子菜单**：行 = `图标 + 模板名`，点击 → `templates.createPage({ templateId, parentId: null })` → **选中新页**（`selectPage(pageId)`）→ 菜单关闭；模板为空时显示空态行「暂无模板」（与既有空态同 token）。
2. **命令面板**：打开时并行拉 `templates:list({})`，把模板作为**独立分组「模板」**并入列表：行文案 `从模板新建：<名称>`（带图标），回车/点击 → 同 C.1 的 createPage + 选中；检索按模板标题匹配（**模板不进页面检索结果**这条隔离语义必须保持——它们是另一个分组，不是 pages 命中）。

### D. 模板管理（设置页「模板」区块）

设置视图新增「模板」区块：`templates:list({})` 渲染 `图标 + 名称` 行 + 右侧「⋯」：
- **重命名** → Dialog 输入新名称 → `templates.rename({ id, title })`
- **删除** → Dialog 二次确认 → `templates:delete({ id })`（软删）
- 空态行「暂无模板」；列表按 `updated_at` 倒序（服务端已排）；操作后刷新列表。
- 命令面板/侧栏子菜单的模板列表需在**新建/重命名/删除后刷新**（订阅 store 的模板 slice，避免两处不一致）。

### E. store 接线

`renderer/src/state/` 新增模板 slice（`templates: TemplateMeta[]`、`loadTemplates()`、`saveFromPage()`、`createFromTemplate()`、`renameTemplate()`、`deleteTemplate()`），**所有 IPC 调用集中在 slice**，UI 组件不直接调 `window.septcats`（与既有 pages slice 风格一致）。

## 1. 交付物

`renderer/src/state/templates.ts`(新) 或并入既有 store 文件（照既有组织方式）、`renderer/src/pages/Settings*.tsx`、`renderer/src/pages/SidebarTree.tsx`（新建页下拉）、`renderer/src/palette/CommandPalette.tsx`（命令 + 模板分组）、相关 CSS（`var(--sc-*)`）、`apps/desktop/test/**`、`docs/tasks/TASK-T23-02-report.md`（PM 复跑节留「（PM 补）」）。

## 2. 红线

- 允许动：`renderer/src/**`、`apps/desktop/test/**`。
- **不碰**：`main/**`（T23-01 的 templates IPC 已完成）、`packages/**`、`shared/**`、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变。
- UI 红线（§16）：CSS 只走 `var(--sc-*)`、无字面 hex；图标只从 `@septcats/ui` 出口；**双主题 × 四态齐备**；两个门禁脚本必须通过。

## 3. 自跑（全仓/selftest/真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。

**PM 收口会跑**：全仓 + selftest + 重打包 + 真机 CDP：搭结构页 → 命令面板「另存为模板」→ 侧栏新建下拉出现该模板（名称+图标）→ 从模板新建 → 新页结构与源一致 → 面板搜模板名 → 回车建页 → 设置里重命名/删除 → 双主题截图 + 零 pageerror。