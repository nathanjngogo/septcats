# TASK-T71-01 报告 · P2：卡片注册表 + 工作台自定义模式（R20 条目④引擎）

> 基线 = main HEAD（T70 收口后）。本单 = 硬编码 5 卡升注册表驱动 + 6 新卡 + 自定义模式。
> 红线：main/preload/shared/ipc/SCHEMA/op-log 零改动；不建新表；不加依赖；不碰 git。

## 1. 交付概览（DoD 自检）
- [x] 卡定义注册表 `workbench/cards.tsx`：内置 5 卡迁入（行为零变）+ 6 新卡。
- [x] 布局持久化升 v2（`{v:2,order,hidden,sizes?}`），v1→v2 迁移守卫单测钉。
- [x] 自定义模式：wb-customize 开关 / ⋮⋮ 拖排（T60 语法）/ ⊟ 移除 / + 添加卡片目录 Menu（T70 宿主钮 stopPropagation）/ 即时持久化 / 完成钮退出。
- [x] 6 新卡数据全走 settings localStorage（`septcats.wbcard.<key>`）或 tree 缓存；热力写点唯一 = PageView EditSession commit 防抖处 +1（`bumpActivityToday()` 全仓仅此一处调用）。
- [x] 旧 5 卡 DOM/testid 一个未动（T66-ui 11/11 原样绿；t66-workbench-state 12/12）。

## 2. 用例计数
- desktop 用例基线：833（PM 派单给定口径）。
- 本单新增用例数：27（test/t71-cards.test.ts 13 + test/t71-customize.test.tsx 5 + test/t71-newcards.test.tsx 9）。
- 全量用例数（仅增不减）：876（851 passed · 25 skipped），本次 **0 unhandled error · 0 失败**（`npx vitest run` 全量实测）。
- 受影响老用例更新：t66-workbench-state.test.ts（未知 id 补尾含 6 新 / 野 JSON 拒绝 v3 即 v2 现合法）+ t66-workbench-ui 夹具 cardOrder 仍为内置 5（隔离，未动 DOM/testid）。

## 3. 验收锚 K1–K6 结果（PM 真机 cdp-e2e-t71-01.mjs，PM 补）
**PM 真机 `docs/mockups/cdp-e2e-t71-01.mjs`：25 PASS / 0 FAIL**（夹具双隔离：`--user-data-dir` + settings.rootPath 钉死 `_scratch`；真实数据根 mtime 逐位一致）。
- K1 五旧卡迁入行为零变：槽序 = 注册表全集序（quick,todo,database,recent,favorites,shortcut,countdown,heatmap,quote,bookmarks,libstats）；8 个老 DOM 锚点（wb-quick-page/database/daily、wb-todo-input、wb-db-new、wb-recent-empty、wb-favorites-empty、wb-card-more-quick）原样在位；11 卡壳齐。
- K2 六新卡逐一存在 + 最小功能：壳全在；热力 7 格；库统计 4 项数值齐；**播种走真实产品路径**（quick 卡「新建页」→ 编辑器打字 → blocks.list 读到正文），格言卡即从近期页首块取句上卡（`quote="T71 格言样本正文"`）；快捷方式目录可选（候选=1）→ 录入落 `septcats.wbcard.shortcut.links` 且卡面即显；倒计时录入「发布日」→ 显示「还剩 30 天」；收藏录入即显且**点击不跳转**（URL 不变、窗口数不变）=D-1 行为实证。
- K3 自定义模式：进模式 grip/移除钮各 11；拖排（三段式 dragstart→dragover→drop）heatmap 前移为第 1 且**即时落盘 v2**；移除卡片 11→10 且 hidden 记账；添加目录菜单可加回（引用摘抄）→ 11；完成钮退出 grip 归零且 11 卡在册。
- K4 v1→v2 迁移：预埋 v1 串（含 3s 落盘等待，防 leveldb 未 flush 假红）→ reload → DOM 全序 = 内置保序 + 六新卡补尾；随后任一写动作落盘即为 `v:2` 且 hidden 正确（写格式实证）。
- K5 空态全套：8/8 消费卡空态占位齐（todo/db/recent/favorites/shortcut/bookmarks/countdown/quote）。
- K6 真根 untouched（mtime 逐位一致）+ 本探针 electron 残留 0。

## 4. DEVIATION 登记
- D-1 书签卡点击跳转：任务书要求「有 openExternal 通道则跳转，没有则只收藏」。侦察核实 `window.septcats` 无 `openExternal` 通道（仅 dist 二进制误命中字符串）。故 bookmarks 卡**只做收藏记录、点击不跳转**，记本 DEVIATION，待 PM 在 T72/后续补 openExternal 通道后接跳转。
- D-2 **PM 修：5 处 §16 框线越界（门禁 pixel-borders）**。`NewWorkspaceDialog.css` 4 处（T70 遗留、当时漏跑 ui 门禁未拦）：`border: 1px solid var(--sc-color-border)`、hover `border-color: ink-faint`、active `border-color: ink`/`border-width: 2px` → 按 §1.2/§1.3 口径改 1px/2px **ink-edge** 全吃 + hover 改填充态（`surface-active`），并合并为 shorthand 免裸 `border-width` 越界；`WorkbenchPage.css` 1 处（T71 新增）`.wb-customize--active` 的 `border-color: ink-secondary` → 改 `--sc-pixel-out` + `translate(--sc-space-xxs)` 按压态。修后 ui 157/157 绿。
- D-3 **PM 修：10 处 typecheck 错（全在本单新增测试文件）**。`t71-customize/newcards`：`../types/window` → `../src/types/window`（2 处）、删未用 `act`/`PagesState`（3 处）；`t71-cards`：`today`/`yest` 可选值显式收窄（5 处）。
- D-4 **PM 修：3 处存储常量名省略号占位符（真实缺陷）**。`workbench/state.ts` `'septca…ards'`/`'septca…nOpen'`、`workbench/work.ts` `'septca…odos'`（U+2026 字面省略号，CB 施工遗留）→ 还原为 `septcats.workbench.cards` / `septcats.workbenchOpen` / `septcats.workbench.todos`。行为自洽（读写同一常量）故单测未炸；PM 在真机探针按 localStorage 键名取样时暴露。测试用常量 import，改名零波及（desktop 876 全绿）。

## 5. 老探针零回归（PM 连跑，T71 构建）
| 探针 | 结果 | 备注 |
|---|---|---|
| T59 | 45 PASS / 0 FAIL | 断言条数 = T70 基线一致 |
| T60 | 32 PASS / 0 FAIL | 同上 |
| T61 | 30 PASS / 0 FAIL | 同上 |
| T66 | **21 PASS / 0 FAIL** | 首轮掉到 9/3（探针侧，非产品）：①T3 三红=`.app-side(4,4)` 后 Playwright `force:true` 不触发 React onClick（T66 时代同源坑，T70 已记）→ 改页内原生 click+轮询后 21/0；②T4-c 卡数口径 5→11（T71 注册表全集）；③T5-b 删除待办同为 force click 同源 → 页内 click 后绿。产品侧另写两诊断件实测：`db.create` 直调与 quick 卡建库链正常（`.dbpage` 开、toast「已新建多维数据页」）、待办增/勾/删正常（storage `items:[]`） |
| T67-B2 | 35 PASS / 0 FAIL | 断言条数 = T70 基线 35 一致（锁面零回归） |
| T70 | 11 PASS / 0 FAIL | 断言条数一致 |
| T65 | 12 PASS / 0 FAIL | 主题面零回归 |

**口径教训（已入 skill）**：布局/卡片面改动后，老探针必须**全量连跑并比对断言条数**——条数变少 = 静默蒸发（T70 已记）；`force:true` 在 Electron 真机不触发 React onClick，交互一律页内原生 click。
**未纳入本轮**：T48/T49/T51 等更早探针（其面未被本单触碰；如需可另跑）。

## 6. 文件改动清单（renderer 仅）
- 新增：`workbench/cards.tsx`、`workbench/activity.ts`、`test/t71-*.test.*`
- 改：`workbench/state.ts`、`workbench/WorkbenchCard.tsx`、`workbench/WorkbenchPage.tsx`、`pages/PageView.tsx`（仅 commit 包装处 +1 调用）、`i18n/zh-CN.ts`、`i18n/en-US.ts`、`test/t66-*.test.*`（v2 受影响断言）
- 未动：main / preload / shared / ipc / SCHEMA / op-log。

## 7. 备注
- 收尾阶段 t66-ui 与 t71-newcards 同跑曾触发 1 个 unhandled error（`RecentCardBody` 读 `recentIds` 在跨文件 store 单例瞬态为 undefined 时 `.slice` 崩）。修复方式：所有 `usePages` 选择器读**原始值**、在组件体内 `?? []` 兜底（切勿在 selector 内 `?? []`，否则每次返回新数组字面量触发 Zustand 引用不等价 → "Maximum update depth" 无限重渲染）。已实测两文件同跑 + 全量 0 error。
- 红线自检：git 改动仅 renderer（`workbench/*`、`pages/PageView.tsx` 仅 commit 包装 +1、`i18n/*`）+ test + docs；main/preload/shared/ipc/SCHEMA/op-log 零改动；无新表、无新依赖、无 electron 引入、无 TODO。
- 真机验收探针 `cdp-e2e-t71-01.mjs`（K1–K6）由 PM 独立连跑；老探针 T66/T61/T60/T59/T67-B2/T70 由 PM 连跑核对断言条数。
