# TASK-T21-02 · 交付报告：侧栏真树 + 选中页渲染 + 搜索命中跳转（关键路径 2/2）

> 工程师：CodeBuddy ｜ 前置：`fb99383`（任务书提交）｜ 日期：2026-09-18
> 按 §0 PM 裁决实现，未另择方案；无新增依赖、未触碰 main/**、packages/**、shared/**。
> SSIM-NOTE：本报告为唯一交付说明；§5 为 PM 复跑节留。

## §0 现状核实（对任务书前提的两处确认）

1. **搜索跳转链路在 T8-01 交付时已存在**：`state/palette.ts` 的 `executeActive()`（面板
   Enter/点击，state/palette.ts:199）对 `hit.pageId !== null` 的命中已调
   `pagesActions.selectPage(hit.pageId)` 并置 `open:false, searchOpen:false`；
   `openHit()`（SearchPage 结果点击，state/palette.ts:220）同样已接 `selectPage`。
   `selectPage` 内部已置 `view:'pages'`（state/pages.ts:282），等价 `showPages()`。
   **因此 `CommandPalette.tsx` / `SearchPage.tsx` 本单零改动**（详见 §2-DEVIATION-1），
   补 React 断言钉住该链路（§4）。
2. **demo 兜底与真实页无冲突**：App.tsx 渲染 `<PageView />` 从不传 `page` prop，
   PageView 的 `page ?? (selectedNode … : DEMO_PAGE)` 分支（PageView.tsx:198）以
   `selectedId` 优先——`selectedId !== null` 且节点存在即真实页。未做修正，仅需
   `load()` 后补 `ensureSelection()` 让真实页成为缺省。

## §1 修法

### 1.1 renderer/src/pages/SidebarTree.tsx（新，§0.1 侧栏真树）

- **页面树**：`nodes` → alive roots 按 sortKey 序、经 `childIds` 下钻（行序与 main 侧
  派生序一致）；展开态读 store `expanded`，仅对 alive 子行下钻；`depth` 字段直接做缩进。
- **交互**：点击行 = `selectPage(id)`（祖先链自动展开、复位编辑态、touchRecent）；
  折叠三角 = `toggleExpand(id)`（`stopPropagation`，不触发行选中）；active = `selectedId`。
- **新建页面** = `void pagesActions.createPage(null)`——store 内部已「create → 对账 →
  选中新页 + 进入重命名」，无需二次 selectPage。
- **收藏/最近**：`favoriteIds`/`recentIds` 经 `nodeMap` 解析，**找不到或已删除的 id
  跳过**；分组行带解析后计数（角标），点击展开/收起（本地视图态，store `expanded`
  只管页面树行）；空分组展开显示空态行（「暂无收藏/暂无最近」）。
- **回收站**：底栏点击 = `view !== 'trash'` 时 `showTrash()`、否则 `showPages()`；
  角标 = `trashNodes(nodes).length`（真实待删数，mockup 02 口径）；激活态高亮。
- **行内重命名**（§0.5）：双击行标题 = `beginRename(id)`；`editingId === id` 的行把
  标题槽替换为行内 `<input>`（autoFocus + 全选）：Enter 非空 = `renamePage(id, title)`
  （既有乐观更新 + 对账链路），空 Enter / Esc / blur = `cancelRename()`。
- **视觉零新增**：行结构/类名与原假树 TreeRow 完全同构（app-nav-row / -tw / -ic / -tx /
  -count、app-side-head / -scroll / -foot）；图标全部来自 `@septcats/ui` 出口
  （CaretRight/Star/Clock/FolderSimple/FileText/Plus/Trash）；根行照 mockup 02 用
  FolderSimple、子页 FileText。

### 1.2 App.css（4 条最小规则，全部既有 var(--sc-*) token）

`.app-nav-tw--open`（展开三角 rotate 90°）、`.app-nav-input`（重命名输入框：surface 底 +
hairline 边）、`.app-nav-empty`（分组空态行，ink-faint 弱化口径同 head）、
`.app-side-foot--active`（回收站激活底色，accent-soft 同行高亮口径）。

### 1.3 App.tsx（换数据源）

删除硬编码假树（`TreeRow` 组件与 9 行常量），`sidebar={<SidebarTree />}`；按需裁剪
@septcats/ui 图标导入。挂载 `load()` 调用点、命令装配、内容区路由均未动。

### 1.4 state/pages.ts（小修，§0.2）

`load()` 成功 setState 后追加 `pagesActions.ensureSelection()`：`selectedId === null`
则选中首个可达根页（空树保持 null → PageView demo 兜底）；已有选中不覆盖（对账不抢
用户位置）；`load()` 失败路径不变（error 态不选中）。放 load() 尾部使 switchWorkspace
等所有 load 路径同享，App.tsx 调用点零改动。

## §2 DEVIATIONS / 口径说明（两处）

1. **DEVIATION-1**：任务书 §1 交付物列出 `CommandPalette.tsx` / `SearchPage.tsx`，
   本单**两者零改动**。依据：§0-1 核实——§0.3 要求的
   「hit 点击 → selectPage + close() + showPages()」在 T8-01 的
   `executeActive()`/`openHit()` 中已完整接线（含关面板 + searchOpen=false；
   showPages 语义由 selectPage 的 `view:'pages'` 覆盖）。为交付「跳转回调」的回归钉，
   在 `palette-react.test.tsx` 补面板命中点击断言（§4）。若 PM 期望命中后显式调
   `showPages()`（防御 selectPage 语义变更），可后续微调，本单不重复调用。
2. **口径-2（回收站视图边界）**：§0.1 只要求绑定 `showTrash()`/`showPages()`，本单照绑
   （底栏切换 + 激活态 + 真实待删角标）。**回收站列表 UI（mockup 10）不在本单范围**：
   `pagesStore.view === 'trash'` 目前无内容区消费者，点回收站后内容区仍显示 PageView。
   回收站页的渲染归属请 PM 裁量（建议另开任务接 mockup 10）。

## §3 交付物清单

- `apps/desktop/src/renderer/src/pages/SidebarTree.tsx`（新：真树 + 分组 + 回收站 + 重命名）
- `apps/desktop/src/renderer/src/App.css`（+4 条 token 规则）
- `apps/desktop/src/renderer/src/App.tsx`（sidebar 接 SidebarTree，删假树）
- `apps/desktop/src/renderer/src/state/pages.ts`（load() 尾部 + ensureSelection，一行）
- `apps/desktop/test/sidebar-tree.test.tsx`（新：8 用例）
- `apps/desktop/test/pages-store.test.ts`（+3 用例：load 选中三态）
- `apps/desktop/test/palette-react.test.tsx`（+1 用例：面板命中跳转）

## §4 测试（自跑，全绿）

- **store 级（pages-store.test.ts +3）**：load 后 null → 选中首个可达根页；已有选中
  不覆盖；空树保持 null（不误选）。
- **React 级（sidebar-tree.test.tsx，8 用例，jsdom + 假桥）**：真树渲染与 active 高亮；
  行点击 selectPage（selectedId/编辑态复位/touchRecent `{pageId}`）；折叠三角
  toggleExpand 且不冒泡行选中；「新建页面」→ `create({parentId:null})` 落库对账并选中
  新页（+editingId）；收藏分组缺失 id 跳过（计数=1）且可点选；最近空组空态行；回收站
  showTrash/showPages 往返 + 待删角标；行内重命名（双击 → Enter 提交 rename、Esc 取消
  不发请求）。
- **跳转回归钉（palette-react.test.tsx +1）**：面板页面命中点击 →
  `selectPage('pg-1')` + `open=false` + `searchOpen=false`。

**修复前红**（= 本次实现的行为缺口）：假树 TreeRow 不读 store（无任何渲染路径消费
nodes/selectedId）；load 后 `selectedId` 停留 null（无 ensureSelection 接线）——新增
用例在旧代码上必红。

**修复后绿**（自跑原文）：

```
 Test Files  33 passed (33)
      Tests  346 passed (346)
```

```
pnpm -r typecheck                     → 9/9 Done，0 错
node packages/ui/tokens/no-magic.mjs  → ✓ 无字面 hex、无非 1px 重复裸 px
node packages/ui/tokens/build-tokens.mjs --check → ✓ token 产物与 DESIGN.md 一致
```

**口径说明**：①首跑 typecheck 红于 SidebarTree 头注释里 `app-side*/app-nav-*` 的 `*/`
提前终止块注释（已改写为顿号分隔）；②首跑测试红于 touchRecent 断言签名（
`recent.touch` 实为 `{ pageId }` 对象载荷，已按契约修正断言）；均为本单文件内问题，
既有测试零改动。

## §5 PM 复跑（2026-09-18）

```
node apps/desktop/scripts/ensure-abi.mjs node
pnpm -r typecheck                     → 9/9 Done，0 错
pnpm -r test                          → 全仓 928 无红（desktop 334→346 = +12，逐包对账一致）
node packages/ui/tokens/no-magic.mjs  → ✓
node packages/ui/tokens/build-tokens.mjs --check → ✓ 产物与 DESIGN.md 一致
pnpm -C apps/desktop selftest         → SELFTEST OK
重打包 + 真机全链路（docs/mockups/cdp-e2e-t21-full.mjs，独立夹具根）→ ALL-PASS 8/8
```

**真机全链路逐条（PM 验收，脚本 + 截图留档 `docs/mockups/screens-t21/`）**

| 环节 | 结果 | 证据 |
|---|---|---|
| 侧栏真树：新建页面 | ✅ | 点击「新建页面」→ 新页行出现且**自动进入标题编辑态**（input value=「未命名」，同 Notion 手感） |
| 双击重命名 | ✅ | 侧栏显示「T21 全链路靶页」 |
| 选中页编辑器输入 | ✅ | 正文出现输入内容（真实页，非 demo） |
| **重载 app** | ✅ | 侧栏仍有该页 + **编辑器显示输入内容** *（跨进程真落库 + 真实页渲染）* |
| 面板搜索命中 | ✅ | 输入「全链路靶」→ 命中该页 |
| 点击命中跳转 | ✅ | 面板关闭 + 回到该页内容 |
| pageerror | ✅ | 0 |

**脚本缺陷 2 处（PM 亲修，非产品问题）**：①「建页」断言原用固定 1.2s 等待 → 改 waitFor；② 更关键的一处认知修正——新页创建后 store 立即置 `editingId`（标题进入编辑态），**标题在 `<input>` 里、`innerText` 读不到**，原断言方式错误（产品行为正确且体验更好）。两处均已修正并复跑 ALL-PASS。
**DEVIATIONS 追认**：①跳转链路（`executeActive`/`openHit` → `selectPage` + 关面板）**T8-01 已存在**，本单只补回归断言、`CommandPalette.tsx`/`SearchPage.tsx` 零改动（PM git 核对确认）；②回收站列表 UI 归属：接受现状（入口与角标已通，列表页归后续批次）。

```
node apps/desktop/scripts/ensure-abi.mjs node
pnpm -r typecheck                     →
pnpm -r test                          →
node packages/ui/tokens/no-magic.mjs  →
pnpm -C apps/desktop selftest         →
重打包 + asar 实证                     →
```

**真机全链路（CDP）**：建页 → 侧栏出现 → 点开 → 输入中文 → 重载 app → 文字仍显示在该页
→ 搜索该词 → 点结果跳回该页 →（追加）双击侧栏行重命名 / 折叠展开 / 收藏分组 / 回收站
底栏切换 / 截图复审双主题四态（含重命名输入框与空分组空态）。
