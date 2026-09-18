# TASK-T24-01 · 交付报告：UI 收口三小项（删除页面入口 + 转为数据库另存口径 + Toast 挂载）

> 工程师：CodeBuddy ｜ 前置：`10788ca`（T24-01 任务书提交，已 `git log -1` 核实）｜ 日期：2026-09-19
> 按 §0 PM 裁决实现，未另择方案；B 先判别后修（证据原文见 §1.2）；DEVIATION 见 §4。
> SSIM-NOTE：本报告为唯一交付说明；§6 为 PM 复跑节留（PM 补）。

## §0 交付范围

- **A.「删除页面」两处入口（T22-01-2）**
  - **命令面板条件命令** `page.delete`（`DELETE_PAGE_DEF`，i18n `commands.page.delete`/`commandHints.page.delete`）：**不在静态 COMMAND_DEFS**，与「另存为模板」同口径——仅注入 `deps.deletePage` 时追加；无选中页由 `configurePaletteCommands` 整体摘除（不出现、不置灰、不抛错）；App `useCommandWiring` 注入 `deletePage` → `pagesActions.requestDeletePage(selectedId)`。
  - **侧栏行「⋯」菜单**（SidebarTree）：行尾 DotsThree IconButton（`side-more-<id>`）+ `@septcats/ui` Menu（「删除」danger 项）；点击 stopPropagation 不触发行选中；菜单「删除」→ 同一确认弹层入口。
  - **二次确认弹层** `PageDeleteDialog`（App 根级，与 TemplateSaveDialog 同范式）：`pagesStore.deleteConfirmId` 驱动开合；复用 `@septcats/ui` Dialog（焦点圈闭/Esc/遮罩）；文案继承回收站「彻底删除」措辞风格（含子页 → 「及其 N 个子页面」，标题空回退「未命名」）；确认 → `pagesActions.confirmDeletePage()`。
  - **删除后状态刷新**：确认既有动作已覆盖，**未加同步代码**——`confirmDeletePage` 复用 store 既有 `deletePage`（乐观更新 → `pages.remove` → `refresh()` 拉树/收藏/最近；回收站角标由 nodes 派生自动同步），随后 `showPages()` 回 pages 视图 + `ensureSelection()` 选中回落。
- **B.「转为数据库」后另存口径（T23-02-1）**：判别结论 = **修法①（selectedId 没跟上）**，`convertToDatabase` 在 `db.create` 成功后追加 `await pagesActions.refresh()`（侧栏树立即出现新库页）+ `pagesActions.selectPage(created.pageId)`（选中同步，含既有 touchRecent 口径）。**数据面零改动**（判别②证明 collection 已按 page_id 正确关联，见 §1.2）。
- **C. 挂载 `ToastViewport`（T23-02-2）**：App.tsx 根层挂载（CommandPalette/TemplateSaveDialog/PageDeleteDialog 之后的根级兄弟），订阅 `pagesState.toasts`，关闭走既有 `dismissToast`；样式全部为 `@septcats/ui` 既有 token（Toast.css 自带，零新增样式）。

## §1 关键实现口径

### §1.1 A/C

- 确认弹层状态入 pages slice（`deleteConfirmId: string | null` + `requestDeletePage/cancelDeletePage/confirmDeletePage` 三个动作）——与 `toasts`/`editingId` 同类的 UI 流状态先例；`confirmDeletePage` 在 store 层串「关弹层 → deletePage → showPages → ensureSelection」，组件只做渲染（可独立层测）。
- 行「⋯」露出规则（App.css，全 token）：默认 `visibility: hidden`，`.app-nav-row:hover` / `--active` / 菜单展开（`--open`）时可见；定位壳 `.app-nav-menu`（`right:0; top:100%; z:var(--sc-z-dropdown)`）与设置页 `.tpl-menu` 同式。
- 命令序：条件命令追加序 = saveAsTemplate → deletePage（均在静态 14 条之后）；`'>'` 模式命令总数有选中页 16 条 / 无选中 14 条，palette.test.ts 静态基线（14/'sz'/'yin'）不受影响。
- Toast 位置：底部居中 fixed（`--sc-space-xl`），z 序走既有 `--sc-z-toast`（50）> `--sc-z-dialog`（40），但 Dialog 居中、toast 贴底且瞬时，不遮挡；未改任何 token。

### §1.2 B 的判别证据（原文）

**判别①：转换后 `pagesStore.selectedId` 是否指向新建库页 → 否（修法①成立）。**

- `PageView.tsx:188-189`（修前）：`/** 「转为数据库」后跳转到新建的 DB 页（一期无路由，用本地状态承载）。 */ const [dbPageId, setDbPageId] = useState<string | null>(null);`
- `PageView.tsx` `convertToDatabase`（修前 584-597 行）：`const created = await window.septcats.db.create({ workspaceId, title: activePage.title }); setDbPageId(created.pageId);` —— **仅写本地状态，全程未触碰 pagesStore**；跳转渲染靠 `if (dbPageId !== null) return <DbPage pageId={dbPageId} />`。
- 后果链：面板「另存为模板」→ `templatesActions.beginSaveFromPage()` 按 `pagesStore.selectedId`（仍指原页）→ `saveFromPage({ pageId: 原页 })` → 服务层 `collection.getByPage(原页)` 为 null → `isDatabase=false` → `kind='page'`。与 T23-02 真机实证（`模板U23库:page`）完全吻合。

**判别②：新库页 collection 是否按 page_id 关联 → 是（数据面无缺口）。**

- `main/dbview.ts` `create`（449-464 行）：`const collectionOp: Op = { ... target: { table: 'collection', id: collectionId }, kind: 'upsert', payload: { page_id: pageId, name: title, schema, views, alive: 1, updated_at: at } };` —— collection 落库即按新库页 page_id 关联；服务层 `saveFromPage` 的 kind 判定（`templates.ts:395-397`）直接受益。
- 佐证：`apps/desktop/test/templates.test.ts:179`「数据库页 → kind=database」服务层用例全绿（T23-02 报告 §6 亦证层测 12 例全绿）——问题确在「转换 → 选中 → 另存」UI 链，不在数据面。

**修法（二选一中的①）**：`convertToDatabase` 追加 `await pagesActions.refresh(); pagesActions.selectPage(created.pageId);`（先对账树让侧栏出现新库页，再走既有 selectPage 选中/touchRecent 口径）。数据面零改动、无只增不改项。

## §2 红线核对

- 允许动：`apps/desktop/src/renderer/**` 与 `apps/desktop/test/**`（git status 佐证：renderer 7 改 + 1 新增、test 2 处）；`main/**`、`packages/**`、`shared/**`、CI/发布脚本零触碰。**B 未触发数据面改动**。
- 零新依赖；不碰 git；无占位符/TODO。
- 既有测试断言语义零改动：palette.test.ts 静态清单/别名基线、palette-react（`>` 14 条）、sidebar-tree、trash-ui、templates-ui、i18n 全部原样通过；`pages-store.test.ts` 仅补 fixture 新必填字段一行（`deleteConfirmId: null`），断言零改动。
- UI 红线：新增 CSS 仅 App.css `.app-nav-more-wrap/.app-nav-menu`，全 `var(--sc-*)` 无字面 hex、无裸 px；图标只从 `@septcats/ui` 出口（DotsThree）；双主题四态由 token 体系自带；`no-magic` + `build-tokens --check` 双门禁通过。
- 附注：`docs/perf-history.jsonl` +72 行是本次自跑 `pnpm test`（perf.test.ts 自动采样落盘）所致，非交付改动，PM 收口复跑会继续追加。

## §3 自跑结果

| 命令 | 结果 |
|---|---|
| `pnpm -C apps/desktop test` | **37 文件全绿：401 用例**（392 + 本单新增 9），无 skip 变化 |
| `pnpm -r typecheck` | 全绿（8 包 + root） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 通过 |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ 通过 |

## §4 DEVIATION（逐条待追认）

1. **任务书口径 `removePage(selectedId)` 落为既有动作 `pagesActions.deletePage`**：`removePage` 是服务通道（IPC `pages.remove`）名，store 侧软删动作一直叫 `deletePage`（T22-01 交付）——本单未新增任何删除动作，确认回调复用它（乐观更新/失败回滚/对账语义不变）。
2. **pages slice 新增 `deleteConfirmId` + 三动作**：确认弹层状态入 store（而非组件局部 state），因命令面板与侧栏行菜单两个入口共用同一弹层（App 根级单实例）；任务书 §1 未钉弹层状态位置，此为最小共用形态。既有动作语义零改动。
3. **转换后 DbPage 渲染仍由 `dbPageId` 本地状态承载**（选中口径已修但渲染承载未动）：`PageNode` 无 kind 列、`pages:tree` 不返回 kind，`selectedNode` 拼不出 database 页——修后从侧栏重新选中该库页仍会渲染编辑器（树上无 kind 的既有缺口，超出本单「仅转换后选中口径」授权，未动）。既有边界顺带登记：转换后点击其它页，`dbPageId` 不复位、主区仍显示库页（修前即如此，本单未使其变差）。
4. **侧栏行「⋯」菜单仅含「删除」一项**：任务书 A.2 只钉「菜单项『删除』」，未钉重命名等其它项（行内重命名已有双击入口）——按最小面实现。
5. **「⋯」露出采用 visibility 切换**（hover/选中/展开三态可见）：任务书钉「hover/选中时显示」；补「菜单展开中保持可见」防菜单开着但触发钮消失的抖动，属实现细节。
6. **测试夹具补一行**：`pages-store.test.ts:77` 加 `deleteConfirmId: null`（PagesState 新必填字段），既有断言零改动。

## §5 测试覆盖（apps/desktop/test/page-delete-ui.test.tsx，9 用例）

- **条件命令（2）**：有选中页 → `page.delete` 出现且 run 触发依赖；无选中页 → 不出现且静态 14 条不受影响；`DELETE_PAGE_DEF` label「删除页面」/别名（scym、delete page）。
- **PageDeleteDialog（3）**：取消不调 `pages:remove` 且弹层关；确认 → `remove({id})` + view 回 pages + `ensureSelection` 选中回落（pg-a 删除后选中 pg-b）+ 对账后树同步（alive=0）；含子页文案「及其 1 个子页面」。
- **侧栏行菜单（1）**：`side-more-<id>` → menuitem「删除」→ `deleteConfirmId` 置位且未 remove；确认弹层确认后才 remove（同弹层复用）。
- **转换选中（2）**：转换 → `db.create` 后 `selectedId === 新库页` + 树对账触达 + 库 UI 出现（空库「新建记录」空态）；kind 判定 UI 链回归——转换后 `templatesActions.saveFromPage(selectedId)` 收到 `{ pageId: 新库页 }`（面板另存存的是新库页）。
- **ToastViewport（1）**：App 根层挂载 → `pushToast` 后 `.sc-toast` 落地含文案 → 经可访问名关闭后消失。

## §6 PM 复跑

```
（PM 补）
```

**真机逐条（任务书 §3 收口清单：删除入口→回收站→恢复/彻底删全鼠标链路；转换→另存 kind=database→实例化 0 记录；另存后有可见提示）**

| 环节 | 结果 | 证据 |
|---|---|---|
| （PM 补） | | |

## §6 PM 复跑（2026-09-19）

```
pnpm -r typecheck → 9/9 Done，0 错
pnpm -r test      → 全仓 983 无红（desktop 392→401 = +9，逐包对账一致）
no-magic ✓ / build-tokens --check ✓ / selftest → SELFTEST OK
重打包（0.3.0-rc.2）+ 真机 CDP（docs/mockups/cdp-e2e-t24-01.mjs，独立夹具根）→ ALL-PASS 11/11
```

**真机逐条（截图 `docs/mockups/screens-t24/`）**

| 环节 | 结果 | 证据 |
|---|---|---|
| 面板「删除页面」命令 | ✅ | 有选中页时出现 |
| 删除二次确认 Dialog | ✅ | *「删除页面「删除靶页T24」将移入回收站，可随时在回收站中恢复。」* + 取消/删除 |
| 删除后离开侧栏树 | ✅ | 侧栏无该页、回收站角标 `1` |
| **回收站鼠标可达** | ✅ | 回收站里出现该页 + 「恢复」「彻底删除」（T22-01-2 闭环） |
| 鼠标恢复 | ✅ | 行消失、空态文案回归；**提示可见**「已恢复」 |
| 转换后另存 kind=database | ✅ | `list=库模板T24:database`（T23-02-1 闭环） |
| **toast 可见** | ✅ | `.sc-toast__item` 落地（「已移入回收站」） |
| 库模板实例化 | ✅ | 新页是库 UI（「还没有记录 / 新建记录」）+ 0 条记录 |
| pageerror | ✅ | 0 |

**B 判别证据（CB 原文口径，PM 核对通过）**：①`PageView.tsx:188` `dbPageId` 为**纯本地态**，`convertToDatabase` 修前未触碰 store → `selectedId` 仍指原页 → `collection.getByPage(原页)` 为 null → kind='page'；②`main/dbview.ts` 的 collection op payload 明确带 `page_id` → **数据面无缺口、零改动**。修法：转换后 `refresh()` + `selectPage(created.pageId)` —— 与 PM 裁决的「口径①」一致，**未动数据面**（比预想更干净）。

**新发现（PM 真机抓出，已登记 T24-01-1）**：把**唯一**一个页面删除后，正文区回落到**设计稿 demo 页**（「暗物质探测实验笔记」等假内容）——空库浏览态应显示**空态**而非假内容。小修：PageView 的 demo 兜底仅在「夹具/演示模式」或「无工作区」时启用，正常空库走空态。

**DEVIATIONS 追认**：6 条（`pages-store.test.ts` 仅补 fixture 新字段一行 ✓；删除态刷新复用既有 `deletePage` 内部 refresh、未加同步代码 ✓；ToastViewport 订阅既有 `pagesState.toasts`、零新增样式 ✓）。
