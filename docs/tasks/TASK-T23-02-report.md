# TASK-T23-02 · 交付报告：模板子系统（方案 B）· UI 面：另存为模板 + 两处入口 + 模板管理

> 工程师：CodeBuddy ｜ 前置：`65aaee5`（T23-02 任务书提交，已 `git log -1` 核实）｜ 日期：2026-09-19
> 按 §0 PM 裁决实现，未另择方案；DEVIATION 见 §4（5 处，均为形态/口径选择，不改裁决语义）。
> SSIM-NOTE：本报告为唯一交付说明；§6 为 PM 复跑节留（PM 补）。

## §0 交付范围

- **模板 slice** `renderer/src/state/templates.ts`（新）：`templates: TemplateMeta[]` + `loadTemplates()` / `saveFromPage()` / `createFromTemplate()` / `renameTemplate()` / `deleteTemplate()`；**六个 templates IPC 调用全部集中在 slice**，UI 组件零直接 `window.septcats`（与 pages slice 同范式）；「另存为模板」弹窗可见性（`saveDialogOpen`）也在 slice。
- **另存为模板（§B）**：命令面板条件命令 `page.saveAsTemplate`（`SAVE_AS_TEMPLATE_DEF`，仅注入 `deps.saveAsTemplate` 时追加；无选中页由 `configurePaletteCommands(deps, hasSelection)` 整体摘除——**不出现而非置灰**，`beginSaveFromPage` 二重护栏静默早退）；App 级 `TemplateSaveDialog`（复用 `@septcats/ui` Dialog + Input）：默认名 = 当前页标题、空名禁用保存、确认 → `saveFromPage({pageId,title})`（**只传 title，icon 继承源页 §0.A**）→ 成功关弹窗 + slice 统一刷新列表。
- **两处「从模板新建」（§C）**：
  - 侧栏「新建页面 ▾」（SidebarTree）：主体点击仍 = `createPage(null)`（既有行为/测试不动），右侧箭头（`aria-expanded`）展开模板子菜单——行 = 数据 icon（空则按 kind 回落 `@septcats/ui` 图标）+ 模板名，展开时懒加载 `templates:list`；点击 → `createFromTemplate` → 对账树 → `selectPage` 选中新页 → 菜单关闭；空态行「暂无模板」（复用 `.app-nav-empty` token 组合）。
  - 命令面板（CommandPalette）：打开时并行拉 `templates:list({})`；模板作为**独立分组「模板」**（排命令/页面/数据库之后），行文案「从模板新建：<名称>」；检索**只按模板标题**（`rank.ts` 扩展 `TemplateLike` + `view.templates`，`>`/`@` 前缀模式模板组为空）——模板不进 pages 命中分组的隔离语义成立；点击/回车 → createPage + 关面板；键盘循环（`selectableRowCount`）与 `aria-activedescendant` 覆盖模板行。
- **设置「模板」区块（§D）**：`TemplatesSection`（SettingsPage 在「AI 助手」之后挂 fieldset 壳，照 AiSection 范式）：行 = 图标 + 名称 + 右侧「⋯」（`@septcats/ui` Menu：重命名 / 删除-danger）；重命名 → Dialog 预填现名；删除 → Dialog 二次确认（文案含模板名，destructive 钮）；空态「暂无模板」（读失败同样回落空态，错误留在 slice）；操作后 slice 统一 `loadTemplates` 刷新。
- **三处订阅同一 slice（§E）**：命令面板分组、侧栏子菜单、设置区块均读 `templatesStore.templates`；新建（不影响列表）/重命名/删除后一次 `loadTemplates` 三处一致。
- **文案**：i18n 新增 `templates.*`（分组/弹窗/菜单/空态）+ `settings.templates.title` + `commands.page.saveAsTemplate` / `commandHints.page.saveAsTemplate`。

## §1 关键实现口径

- **入口联动**：App `useCommandWiring` 由一次性装配改为 `pagesStore.subscribe` 随 `selectedId` 变化重装配（§B「无选中页不出现」）；`configurePaletteCommands` 是纯函数（commands.ts 导出），测试直测可见性规则。
- **执行索引**：`palette.executeActive` 分段映射 `命令 → 页面 → 数据库 → 模板`（模板排最后，既有命令/页面/数据库索引零位移）；`moveActive` 同步传入模板列表。
- **icon 展示（§0.A）**：`TemplateMeta.icon` 是继承源页的自由字符串（Notion 常见 emoji）→ `TemplateIcon` 以文本 span 原样展示；空 → 按 kind 回落 UI 字形（page=`FileText` / database=`Note`）。UI 字形仍只从 `@septcats/ui` 出口（§16.6）。
- **CSS**：`templates.css`（`.tpl-emoji/.tpl-row*/.tpl-menu*/.tpl-empty/.tpl-dialog-*`）+ App.css `.app-nav-suffix`；全部 `var(--sc-*)`，无字面 hex、无裸 px；菜单层级 `var(--sc-z-dropdown)`。
- **createFromTemplate 时序**：IPC 建页 → `pagesActions.refresh()`（树含新页）→ `selectPage(pageId)`（祖先展开/选中/touchRecent）——与 pages slice 的 createPage 行为对齐。

## §2 红线核对

- 只动 `apps/desktop/src/renderer/**` 与 `apps/desktop/test/**`；`main/**`、`packages/**`、`shared/**`、CI/发布脚本零触碰（`git status` 佐证）。
- 零新依赖；不碰 git；无占位符/TODO。
- 既有测试断言语义零改动：palette-react（`>` 14 条、'sz'/'yin' 基线）、sidebar-tree、settings-react、i18n 等全部原样通过；「另存为模板」因不入静态 `COMMAND_DEFS`，palette.test.ts 静态清单/notify=3/别名基线无需动一行。
- UI 红线：双主题走既有 token 体系（无新增颜色字面量，浅深四态由 token 自带）；`no-magic` + `build-tokens --check` 双门禁通过。

## §3 自跑结果

| 命令 | 结果 |
|---|---|
| `pnpm -C apps/desktop test` | **36 文件全绿：316 用例（301 passed + 15 skipped）**，其中 templates-ui.test.ts 24 用例（新增） |
| `pnpm -r typecheck` | 全绿（8 包 + root） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 通过 |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ 通过 |

## §4 DEVIATION（逐条待追认）

1. **「成功后轻提示」的现状**：本单**复用既有 `pushToast`**（pagesStore 的 toasts 队列，pages/DbPage/PageView 一直在用），未新增任何全局提示系统；但 renderer 从未挂载 `@septcats/ui` 的 `ToastViewport`（T23-02 之前即如此，非本期删减）——故用户可见效果 = 弹窗关闭 + 列表刷新，Toast 渲染接线归后续任务（任务书 §B 预留的「若无，则关闭对话框即可」分支）。
2. **「另存为模板」未入静态 `COMMAND_DEFS`**：作为条件命令由 `bindPaletteCommands` 在 dep 注入时追加（`SAVE_AS_TEMPLATE_DEF` 独立导出）。任务书未钉死实现位置；这样静态清单测试（id 唯一/空 query 序/'yin' 无命中基线）零改动，且「无选中页不出现」天然成立。
3. **侧栏模板子菜单 = 行内展开**（与收藏/最近分组同范式），非浮层 Popover：任务书钉了「行 = 图标 + 模板名 + 空态」口径与「主体新建/箭头展开」分工，未钉形态；行内展开与侧栏既有交互一致、免层级/定位复杂度。
4. **面板模板分组排最后**（命令 → 页面与跳转 → 数据库 → 模板）：任务书只钉「独立分组并入」，未定次序；排最后使既有 `executeActive` 的命令/页面/数据库索引映射零位移，键盘循环回绕行为对存量用例完全不变。
5. **App `useCommandWiring` 增加了 `pagesStore.subscribe` 重装配**：为落实 §B「无选中页时不出现该命令」的最小接线（commands 本体是静态数据，重装配只是替换 store 里的命令数组，面板关闭态零渲染开销）。

## §5 测试覆盖（apps/desktop/test/templates-ui.test.ts，24 用例）

- **slice（8）**：loadTemplates 调 `list({})` + status；失败不抛错落 error；saveFromPage IPC 参数（仅 title）+ 写后刷新 + success/danger Toast；createFromTemplate `{templateId,parentId:null}` + 树对账 + selectPage + 失败 null；rename/delete IPC 参数 + 各自刷新；beginSaveFromPage 无选中页不开（不抛错）。
- **另存为模板（4）**：条件命令可见性（hasSelection true/false）+ run 派发 + 静态 14 条不受影响；`SAVE_AS_TEMPLATE_DEF` label/别名；弹窗默认名 = 页标题、确认 → IPC + 关弹窗；空名禁用。
- **面板分组（4）**：打开拉列表 + 行文案/分组头；点击模板行 → createPage + 关面板/关搜索页；检索按模板标题且「命令/页面与跳转」分组不出现（隔离）；`>`/无匹配标题时模板组隐藏。
- **侧栏（4）**：主体点击仍 createPage(null)；箭头懒加载 + 行 = 数据 icon(emoji)+名称（空 icon 回落）；点击项 → createPage + 选中 + 菜单关闭；空态「暂无模板」。
- **设置区块（4）**：行渲染（icon+名称）；空态；「⋯」→ 重命名 Dialog 预填 + rename({id,title})；「⋯」→ 删除二次确认 + remove({id})。

## §6 PM 复跑（2026-09-19）

```
pnpm -r typecheck → 9/9 Done，0 错
pnpm -r test      → 全仓 974 无红（desktop 368→392 = +24，与新增 templates-ui.test.tsx 用例数吻合）
no-magic ✓ / build-tokens --check ✓ / selftest → SELFTEST OK
重打包 + 真机 CDP（docs/mockups/cdp-e2e-t23-02.mjs，独立夹具根）→ 12 PASS / 2 FAIL（其中 1 条为探针缺陷、1 条登记为产品待查项）
```

**真机逐条（截图 `docs/mockups/screens-t23-ui/`）**

| 环节 | 结果 | 证据 |
|---|---|---|
| 面板「另存为模板」命令出现 | ✅ | 有选中页时出现；无选中页不出现的护栏由层测覆盖 |
| 另存 Dialog 默认名=页标题 | ✅ | `预填="源页U23"` → 改名「模板U23」→ 保存 |
| 保存成功 | ✅ | `templates:list` → `模板U23:page` |
| 侧栏「新建页面 ▾」下拉 | ✅ | 下拉出现模板行（名称+图标位） |
| 从模板建页（侧栏） | ✅ | 新页编辑器内容=「模板正文丙」（继承模板块） |
| 面板模板分组 | ✅ | 行文案「从模板新建：模板U23」 |
| 面板模板行建页 | ✅ | 建页后编辑器有内容 |
| 设置页「模板」区块 | ✅ | 列出模板行 |
| 设置页重命名 | ✅ | 列表变为「模板U23改」（随 slice 刷新，侧栏/面板同步） |
| 双主题截图 | ✅ | `theme-light.png`/`theme-dark.png` |
| pageerror | ✅ | 0 |
| ⑤a 转换库 UI 标记 | ⚠️ 探针缺陷 | 实测**转换成功**（界面出现「还没有记录 / 新建第一条记录开始填写这个数据库。 / 新建记录」），我关键词表漏了实际文案「新建记录」 |
| ⑤ 数据库页另存 → kind=database | ❌ **登记待查 T23-02-1** | 「转为数据库」后经面板另存，得到 `模板U23库:page`（应为 `database`）——转换确实发生，但 `saveFromPage` 拿到的页面查不到 collection |

**T23-02-1（待查，次批修）**：转换后的「另存为模板」把页面判成 `kind=page`。两个候选根因，下批用探针判别：①`转为数据库` 的跳转是 PageView 本地状态（`PageView.tsx:188` 注：一期无路由、用本地状态承载），`pagesStore.selectedId` 可能仍指向转换前的页 → 面板命令存了错页；②新库页的 collection 未按 `page_id` 关联，服务层查不到。层测（服务层直接构造含 collection 的页面）12 例全绿，说明问题在「转换 → 选中 → 另存」这条 UI 链的口径，不在数据面本身。

**PM 亲修脚本缺陷 3 处（非产品问题）**：①泛选择器改 testid（`template-save-name`/`settings-tpl-menu-0`/`template-rename-*`——CB 加了规范 testid，赞）；②「转为数据库」按钮需 `scrollIntoViewIfNeeded` + force click；③库 UI 标记关键词表补「新建记录」。修后 ⑤a 由红转“探针缺陷”定性。

**DEVIATIONS 追认**：①轻提示复用既有 `pushToast`，但 `ToastViewport` 本就未挂载（非本期删减）→ **登记 T23-02-2**（全局提示不可见，小修：App 挂载 ToastViewport）；②另存命令不入静态 `COMMAND_DEFS`（保基线测试零改动）✓；③侧栏子菜单取行内展开而非浮层 ✓；④面板模板组排最后（既有索引零位移）✓。

```
（PM 补）
```

**真机逐条（任务书 §3 收口清单：另存 → 两处入口新建 → 设置管理 → 双主题 + 零 pageerror）**

| 环节 | 结果 | 证据 |
|---|---|---|
| （PM 补） | | |
