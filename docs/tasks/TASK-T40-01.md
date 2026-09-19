# TASK-T40-01 · 🔴 P1：数据库「字段」体系检查与优化（老板实测反馈）

> PM：Hermes ｜ P1（老板：「我发现目前实现的数据库的字段有问题，请检查并优化」）｜ 前置：T38-01 收口
> **排队说明**：本单**插到 T39-01（布局设计器）之前**——字段是功能缺陷，优先级高于增强。

## 0. PM 代码侦察结论（先复现，再修；不要直接照抄当事实）

1. **单元格编辑器按类型缺失**（最可能的「字段有问题」主因）
   `apps/desktop/src/renderer/src/db/DbPage.tsx` 仅 **353 行**，**无任何按类型的编辑分支**（`case '...'` 命中 0 处，`select`/`多选` 命中 0 处）。
   而字段类型全集有 **11 种**（`packages/dbview/src/types.ts:28`）：`text · number · select · multi_select · date · checkbox · url · email · relation · file · ai`
   → 需要逐类型确认：**单选/多选**有无下拉与选项、**日期**有无日期选择、**勾选**有无复选框、**数字**有无校验、**链接/邮箱**有无校验与可点、**关联**有无 picker（main 有 `RELATION_SEARCH_LIMIT=50`）、**AI 列**能否触发。
2. **字段改类型无 UI 入口**：`main` 侧 `db.propUpdate` 已放行 `type`（`dbview.ts:985-990`），但渲染层 hook 只暴露 `addProperty / removeProperty / renameProperty / updatePropertyPrompt`（`useDbPage.ts:52-56`）→ **改类型**入口缺失。
3. **字段删除 / 排序**：`removeProperty` 在 hook 已有（`useDbPage.ts:53`），但 `DbPage.tsx` 只找到 `addProperty`(:303) 与 `renameProperty`(:309) 调用点 → 需核实：**删除字段**、**字段左右移动/排序**是否有 UI。
4. **标题字段语义**：转库时首个字段写死 `{ name: '名称', type: 'text' }`（`dbview.ts:425`）→ Notion 语义下标题应是**专用 title 语义**（不可改类型/不可删/必填），需评估：保持 `text` 但**加保护**（禁改类型/禁删/置顶），还是引入 `title` 语义标记。
5. **选项（select/multi_select）无管理**：需确认选项集合是「自由输入」还是「可管理的选项列表（增删改、配色）」。

## 1. 必须交付的范围

**A. 先复现并出一份「字段问题清单」**（在你自己的真机夹具根上逐类型实测，附数值/截图）：
对 11 种类型逐一做：建字段 → 建记录 → 填值 → 改类型（若支持）→ 重开应用读回 → 断言值不丢不串型。把**每条不符**记进报告（含 PM 第 0 节 5 条的核实结论）。

**B. 修掉清单里的真缺陷**（优先级从高到低）：
1. **按类型单元格编辑器**：`select`（下拉）/`multi_select`（多选 + 标签）/`date`（日期选择 + 清空）/`checkbox`（勾选）/`number`（数字校验）/`url`+`email`（校验 + 可点开）/`relation`（选页 picker）/`file`（文件名展示）/`ai`（手动触发）
2. **字段管理入口**：改类型（含**值迁移策略**：不兼容时保留原值并提示，不许静默丢）、删除（**二次确认 + 该列值一并清理**）、**左右排序**
3. **选项管理**：`select` 选项列表增删改
4. **标题字段保护**：不可改类型、不可删、默认置首列
5. **值不丢**：任何字段操作后重开应用值逐条还原（含空值/非法值安全降级）

**C. 不做**（本单）：公式/汇总(rollup)、字段依赖、跨库关联的多跳。

## 2. 验收（数值化/真机）

1. 11 类型逐条：**填值 → 重开 → 读回一致**（断言值与类型，贴实测表）
2. 改类型：`text→select` 等不兼容场景**值不静默丢失**（给出迁移结果与提示）
3. 删除字段：确认后该列消失且重开不复活、该列值被清理（断言）
4. 排序：拖动后列序持久化（重开断言）
5. 选项管理：增删改后持久化
6. 标题字段：改类型/删除入口**被禁用**（断言）
7. **回归**：全仓无红；窗口零滚动、侧栏完全收起、手柄装订线、对比度门禁、多页签（T37）、AI 面板（T38）行为不变
8. 双主题 × 四态截图

## 3. 红线

- 允许动：`apps/desktop/src/renderer/src/db/**`、`apps/desktop/src/main/dbview.ts`（**只增不改语义**：新增能力不改既有 op 形态）、`shared/ipc.ts` 与 `preload`（仅新增通道）、`apps/desktop/test/**`。
- **`packages/dbview/src/**` 仅允许：新增 `title` 语义标记（如确需）**；值编解码/`VALUE_SCHEMA_BY_TYPE` 的**既有语义不得改变**（改了必须逐条 DEVIATION + 迁移说明）。
- 不碰：`DESIGN.md`/tokens（配色）、`packages/**` 其它包、CI/发布脚本。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（需调整 §DEVIATION 逐条）。
- 迁移：**任何 schema/op 变更都要向后兼容**（`MIN_SUPPORTED` 不许提高；旧库打开必须在真机验一次）。

## 4. 交付物

代码 + 测试（11 类型值往返 / 改类型迁移 / 删除清理 / 排序持久化 / 选项管理 / 标题保护）+ **真机实测表**（11 类型 × 填值/重开/读回，含截图）+ `docs/tasks/TASK-T40-01-report.md`（§0 第 5 条的核实结论 + 问题清单 + 修复对照 + DEVIATION；PM 复跑节留「（PM 补）」）。

## 5. 自跑（全仓/selftest/重打包/真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -C packages/dbview test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。
**PM 收口**：全仓 + 重打包（先 `ensure-abi electron`）+ 用老板真实库副本验证旧库兼容 + 双主题截图。

## 6. 顺带登记（老板同期新需求，单独立项，不混进本单）

- **R4 编辑区全宽开关**（Notion 式 per-page `Full width`）：`PageView.css:15,32` 现用 `max-width: var(--sc-space-editor-measure)` → 加**每页**全宽开关（页面 ⋯ 菜单 + 命令面板），状态随页持久化。→ **T41-01**
- **R5 页面转 Wiki**：需先把「Wiki」语义定清（检查清单：`page` 表/op 是否已有 `kind` 字段可承载；侧栏是否需独立分区；Wiki 落地页 = 标题+简介+子页索引）。→ **T42-01（待老板一句确认）**
- **R6「数据库」改称「多维数据」**：`i18n/zh-CN.ts` 命中 **9 处**（`convertToDatabase/filterDatabases/kindCollection/groupDatabases/metaDatabase/...`）→ 纯文案单（含命令面板、面板分组、空态、错误文案全量替换；英文保持 Database）。→ **T43-01（可与 T41 合并派发）**
