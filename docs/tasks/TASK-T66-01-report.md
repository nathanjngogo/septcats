# TASK-T66-01 报告 · 个人工作台首页（方案A + 数据库卡）

> 分支 `feat/t66-workbench`@起点 bc60368；执行=子 Agent 主体（1664 行）+ **PM salvage 全收口**。
> 2026-09-23 状态：**已合并 main（merge 08ed84d）+ PM 真机验收 21 PASS / 0 FAIL**。

## 1. 路线决议

### 1a. 待办卡：localStorage 最小列表（不建内建模板页）
- 理由：待办是"临时手边清单"语义，建页会污染页面树与搜索/最近；卡配置与待办项各自持久化。

### 1b. home 视图：一等可导航面，只覆盖编辑列（侧栏/顶栏/标签条保持可用）
- 理由：老板要"现有模式 ⇄ 工作台"随时切换；home 不是死角——任何"打开页面"旁路自动先收 home。
- 实现：`workbench/state.ts` 独立 slice（view: home|pages）；App 按 slice 换装 `.wb-root`；
  入口三件套=顶栏房子钮 / Alt+H / 命令面板「工作台」（aliases: home/go home/workbench）。

## 2. 交付面
- `workbench/`：WorkbenchPage（五卡：快捷/待办/库(cardId=database，标题「多维数据」)/最近/收藏）+ WorkbenchCard（⋯ 显隐·排序·恢复默认）+ state.ts + work.ts + pixelGlyph.tsx（房子/清单两枚 16 网格局部 glyph，T65 合入后收编像素族）。
- **库卡（老板点名"要加一个库"）**：常驻显示存活 `page_type='database'` 页列表 + 行数（异步 `db.load` 计数）+「新建」入口（快捷区+卡头双入口）+ 超 6 行出「查看全部」（回 pages 视图）。
- 防呆：重启后即使上次停在 home 也回 pages（localStorage open 旗标只作 toast 提示语境）。
- i18n 双份；zh 文案守 T43「多维数据」门禁（卡标题=「多维数据」、快捷/卡头建库钮=「新建库」，全文 0 处「数据库」——salvage 时逐条改齐）。

## 3. 测试（PM salvage 后）
- desktop **888 passed**（新增 t66-workbench-{state,work,ui} 三组）；全仓 typecheck 0。
- salvage 账：假桥补 `search.onTogglePalette`/`blocks.list` stub；裸 `vi.fn()` 10 处补 Promise（`.catch` 炸）；
  `wb-card-` 正则收紧（不误吞 `wb-card-more-*`）；t58 两钉子按新语义改（相对序断言 / T66 局部 glyph 显式豁免集）；
  合并后 workbench CSS 三处灰线违规改 ink-edge（pixel-borders 纪律 8/8 复绿）。

## 4. 真机（cdp-e2e-t66-01.mjs · PM 亲写亲跑）
- **21 PASS / 0 FAIL**；screens-t66/ 4 张 + 结果 JSON；夹具 `_scratch/t66-01/`，真实数据根 untouched=true，node 孤儿差分 0。
- T1 三入口全通（房子钮/Alt+H toggle/命令面板）；T2 home 非死角（点侧栏行→收 home→编辑器在场）；
  T3 库卡常驻+快捷建库（自动回 pages 开 `.dbpage`，重开 home 库卡行数+1、行数文案在）；
  T4 卡显隐/恢复五卡齐；T5 待办增勾删；T6 重启不滞留 home、重启后入口仍可用。
- 探针侧修账（**非产品缺陷**，逐条取证后定性）：
  ① T3 首跑无行=探针假设错——`createDatabasePage` 设计语义=建库后 closeHome 回 pages 开新库页（`db.create` 正确写 `page_type:'database'`，dbview.ts:676 实证），非漏传 type；
  ② T4 菜单打不开=**Playwright `force:true` 合成点击不触发 React onClick**（页内 `el.click()` 菜单正常开：aria=true、items=[隐藏卡片,上移,下移,恢复默认]）→ 卡 ⋯ 改页内派发，沉淀入 skill；
  ③ T6 Alt+H 盲按踩 toggle 反收 home → 状态感知确保开。

## 5. DEVIATION
- 任务书"侧栏库筛选分区"取消：T64 红线不动 SidebarTree，「查看全部」=回 pages 视图（语义等价，老板可目检）。
- 房子/清单两枚 glyph 暂住 `workbench/pixelGlyph.tsx`（画法逐格拷贝 makeGlyph），pixel-borders 测试挂了**显式豁免集**（撤豁免即红）——T65 合入后 PM 统一收编像素族。

## 6. PM 复跑节（PM 补）
- 合并无冲突（子 Agent 基线 bc60368 与 main 文件面天然错开）；合并后全仓 typecheck 0、desktop 888、pixel-borders 复绿。
- 真机命令：`node apps/desktop/scripts/ensure-abi.mjs electron && node docs/mockups/cdp-e2e-t66-01.mjs`。
- **判定：T66 验收通过。**
