# TASK-T64-01 · P1：侧栏行菜单 clamp 防超屏 + 新建文件夹（树容器节点）

> 老板 09-22 原话：「1. 左边栏最小时，文件的弹出框会超出屏幕 2. 左边侧边栏内目前不可新建文件夹，请增加此功能」

## 0. 根因与现状（PM 已实测复现，勿重复调查）

**① 菜单超屏**：行 ⋯ 菜单渲染走 `.app-nav-menu { position:absolute; right:0; top:100% }`（App.css:295），侧栏最小宽 200 而菜单宽 ~210 → PM 真机实测盒 `left=-26px` 越出屏幕左缘。右键菜单（T60-01 ④，SidebarTree.tsx:261-277 useLayoutEffect）已有 fixed+clamp 逻辑但**仅 ctx 路径生效**（`rowMenuAt!==null`），⋯ 按钮路径（`rowMenuAt===null`）仍是老的 absolute。

**② 无文件夹**：页面树只有 page/wiki/database 三型（`PageType`，apps/desktop/src/main/pages.ts:68）。`page_type` 列是 `TEXT NOT NULL DEFAULT 'page'`（schema.v8.ts:26），SQLite 层无 CHECK 约束，唯一枚举闸门 = `apps/desktop/src/db/statements.ts:122` 的 `z.enum(['page','wiki','database'])`。像素图标 `FolderSimple` 已在图标族（packages/ui/src/pixelIcons.tsx:226）。树行点击一律 `pagesActions.selectPage(node.id)`（SidebarTree.tsx:390/550）。

## 1. 口径（PM 定稿，不要发挥）

### 阶段 A —— ⋯ 菜单与右键菜单统一 clamp
1. ⋯ 按钮路径也走 fixed 定位宿主 + 与 ctxMenu 共用的 clamp useLayoutEffect（现成 `rowMenuAt` 机制：⋯ 打开时用**触发钮 getBoundingClientRect** 作锚点写入 rowMenuAt，不再渲染老的 `absolute` 分支）。
2. clamp 规则不变：留 8px 视口余量，x/y 双向压回；横纵都适用（底行不再溢出屏幕下缘，右缘翻转同理）。
3. `.app-nav-menu` 的 absolute 定位样式删掉或改为仅尺寸/外观（不再承担定位）；样式仍只借 `.sc-menu` 自身（对齐 T60 注释口径）。
4. 菜单内容（items/onSelect）零改动；`inMovePick` 两个实例 key 逻辑保持。

### 阶段 B —— 文件夹 = 树容器节点（page_type='folder'）
1. **数据**：`PageType` 扩 `'folder'`（main/pages.ts:68 + 全部联合出现点）；statements.ts:122 enum 扩 `'folder'`；**无 DB 迁移**（列本就是 TEXT）。`pageTypeOf`（renderer state/pages.ts:108）兜底口径同步扩。
2. **创建**：pagesActions 新增 `createFolder(parentId)`（走既有 page.upsert IPC，page_type='folder'，标题 i18n 新 key「新建文件夹/New Folder」，与新建页同规则自动去重后缀）；入口两处：a) 侧栏顶栏「新建页」钮拆成分体钮（主=新建页，箭头=菜单：新建页/新建文件夹——复用现有 `side-new-page-arrow` 结构）；b) 行 ⋯/右键菜单「新建子页面」下加「新建子文件夹」（任意节点行都有，无子层时挂到该节点下）。
3. **行为**（核心红线）：
   - folder 行点击 = 展开/收起（toggle expanded），**不 selectPage、不开页签、不进编辑器**。统一兜底：`pagesActions.selectPage` 入口处若目标是 folder → 只展开定位并 return（防搜索结果/收藏/最近/面包屑等旁路点开）。
   - 行图标：`FolderSimple`（开合态可共用一枚，不新增图形）；行结构、缩进、拖拽、⋯ 钮与页面行一致。
   - 树渲染：folder 参与普通树（**不**剪枝；wiki 剪枝逻辑 `pageTypeOf==='wiki'` 不受影响）；空文件夹展开态显示一行 i18n 空态文案「此文件夹为空」（灰、12px、无按钮）。
   - 拖放：folder 可作为拖放目标（parent）——沿用现有树 drop 机制；folder 也能被拖进别的 folder。
   - 「移入…」对话框目标列表天然含 folder（parent 候选=非后代的任意节点），无需特判。
   - 搜索：folder 行可出现在结果（点击=展开定位，走上面兜底）；收藏：folder 行的 ⋯ 菜单隐藏「收藏/加入最近」类项（如现无此二项则不管）；已入收藏的旧数据在 resolveGroup 跳过 folder。
   - 转换：folder ⋯ 菜单提供「转为普通页面」（转回 page，子页保留挂原位）；page 有子页时可「转为文件夹」（子页全保留）。wiki/database 与 folder 互不转换（菜单项不出现）。
   - 删除/回收站：folder 走现有 page 删除流（子树连带进回收站，恢复随父链）——预期零改动，测试兜住即可；回收站列表里 folder 行显示文件夹图标。
   - 数据库/Wiki/AI/图谱等消费 `pageTypeOf` 的模块：**folder 一律按普通树节点处理、不出现在 Wiki 分区/图谱页节点可保持现有口径**——若图谱把 folder 当节点渲染可接受（连线成立即可），不许崩溃。
4. **i18n 双语**（中英两个 locale 都要）：新建文件夹、新建子文件夹、此文件夹为空、转为文件夹、转为普通页面、toast 若干（创建/转换成功）。
5. **像素风纪律**：不新增图标图形；行 hover/选中/菜单全部沿用 T53/T62 灰阶 token 与黑框线；禁止字面 hex/裸 px。

## 2. 交付物
1. 上述代码改动（main/renderer/db 层 + i18n 双 locale）。
2. 单测：a) statements enum 接受 folder、拒绝野值；b) pageTypeOf 兜底；c) 树渲染含 folder 且 wiki 剪枝不回归；d) selectPage 对 folder 不建页签；e) 转换/删除/恢复流；f) clamp 逻辑纯函数化测试（给盒宽/视口宽出坐标）。钉既有口径的用例若受影响按新语义改写并记 DEVIATION。
3. 真机探针 `docs/mockups/cdp-e2e-t64-01.mjs`（断言前必须一次性形状探针拿真值）：
   - A：侧栏拖到最小宽（复用 T63 诊断手法：拖 `.app-sidebar-resize` 柄到 x≈1；实测最小 200）→ 首行/末行分别开 ⋯ 菜单 → 盒 left≥8、top≥8、bottom≤innerH-8、right≤innerW-8；右键菜单同断言。
   - B：新建文件夹（顶栏分体钮）→ 树出现 folder 行（FolderSimple 图标）→ 点行 = 展开收起、无新页签、`tabs` 数不变 → 在文件夹上「新建子页面」→ 子页挂其下 → 点子页正常开编辑器。
   - C：拖一页进文件夹 → 面包屑含文件夹名；「移入…」可移回；folder「转为页面」后行为回归普通页。
   - D：优雅退出→重启：树结构与展开态还原；每步截图存 `docs/mockups/screens-t64/`（≥6 张，light 即可）。
   - E：回归：搜索页命中 folder 点击不白屏；回收站删 folder 连带子页可恢复；T52/T62 探针不重跑（未触其文件面），但全仓 test 必绿。
4. 报告 `docs/tasks/TASK-T64-01-report.md`：骨架先行；分节贴**原始数值**；DEVIATION 节；PM 复跑节留空。

## 3. 红线
- 布局系统（layoutState/T57 编辑器）零改动；`packages/**` 仅许 pixelIcons/Icon 若需引用（预期零改）。
- selectPage 兜底不许改签名破坏现有调用点类型；不改 page.upsert 之外的 statements。
- 不新增第三阶段重构；隐私零外呼；思源黑体/黑框线 token 不破。
- 探针窗口 resize 一律走 main inspector `setBounds`+回读断言（Electron CDP 无 getWindowForTarget，静默 resize 失败=假绿，PM 已为此返工过一次）。

## 4. DoD（CB 自验，贴数值进报告）
1. `pnpm -C apps/desktop test` 全绿；`pnpm -r test` 无红；typecheck 0。
2. `pnpm -C apps/desktop build` 通过；探针（先 `ensure-abi.mjs electron`）全 PASS；探针结束 electron 进程数 0。
3. 报告 + DEVIATION 明确；`git status` 里除交付物无杂物。
4. 真机手测记录：最小侧栏 ⋯ 菜单四边不越界（贴盒坐标）；folder 创建/展开/挂子页/转页/重启还原。
