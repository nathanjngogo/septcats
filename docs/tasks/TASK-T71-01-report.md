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
- K1 五旧卡迁入行为零变（T66 探针 21/0 原样绿）：（PM 补）
- K2 六新卡逐一存在 + 最小功能：（PM 补）
- K3 自定义模式拖排/移除/添加/重启还原：（PM 补）
- K4 v1→v2 迁移预埋 v1 串→旧序保持 + 新卡追加：（PM 补）
- K5 空态全套：（PM 补）
- K6 真根 untouched + electron 计数 0：（PM 补）

## 4. DEVIATION 登记
- D-1 书签卡点击跳转：任务书要求「有 openExternal 通道则跳转，没有则只收藏」。侦察核实 `window.septcats` 无 `openExternal` 通道（仅 dist 二进制误命中字符串）。故 bookmarks 卡**只做收藏记录、点击不跳转**，记本 DEVIATION，待 PM 在 T72/后续补 openExternal 通道后接跳转。
- D-2 （PM 补）
- D-3 （PM 补）

## 5. 老探针零回归（PM 连跑 T66/T61/T60/T59/T67-B2/T70）
- 计数 / 断言条数：（PM 补）

## 6. 文件改动清单（renderer 仅）
- 新增：`workbench/cards.tsx`、`workbench/activity.ts`、`test/t71-*.test.*`
- 改：`workbench/state.ts`、`workbench/WorkbenchCard.tsx`、`workbench/WorkbenchPage.tsx`、`pages/PageView.tsx`（仅 commit 包装处 +1 调用）、`i18n/zh-CN.ts`、`i18n/en-US.ts`、`test/t66-*.test.*`（v2 受影响断言）
- 未动：main / preload / shared / ipc / SCHEMA / op-log。

## 7. 备注
- 收尾阶段 t66-ui 与 t71-newcards 同跑曾触发 1 个 unhandled error（`RecentCardBody` 读 `recentIds` 在跨文件 store 单例瞬态为 undefined 时 `.slice` 崩）。修复方式：所有 `usePages` 选择器读**原始值**、在组件体内 `?? []` 兜底（切勿在 selector 内 `?? []`，否则每次返回新数组字面量触发 Zustand 引用不等价 → "Maximum update depth" 无限重渲染）。已实测两文件同跑 + 全量 0 error。
- 红线自检：git 改动仅 renderer（`workbench/*`、`pages/PageView.tsx` 仅 commit 包装 +1、`i18n/*`）+ test + docs；main/preload/shared/ipc/SCHEMA/op-log 零改动；无新表、无新依赖、无 electron 引入、无 TODO。
- 真机验收探针 `cdp-e2e-t71-01.mjs`（K1–K6）由 PM 独立连跑；老探针 T66/T61/T60/T59/T67-B2/T70 由 PM 连跑核对断言条数。
