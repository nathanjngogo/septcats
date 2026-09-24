# TASK-T78-01 · 跨块多选与批量操作（R26 第二单）

> PRD=`docs/PRD-R26-编辑器体验包.md` §2（必读）。**基线 = main `750b4f4`（T77 已合入：CodeBarView/image 拖拽柄已就位，报告 §8 含真机 9/0）。**
> 工作目录=主树 `E:\Hermes Agent工作空间\Septcats`（分支 main）。禁碰 git；不建表、不加依赖。
> 开工侦察三问写报告 §0：① BlockControls 菜单开态与 `onAction` 宿主链（PageView→EditSession）现结构——多选态怎么插进「意图发送」模式最薄；② `dnd.ts`（123 行，纯函数 planDrop）对「一次拖多块」的适配面：DropPlan 是否已按块列表工作还是单块假设，列出最小改法；③ 撤销链现状（ops 入段事务边界；**不要求**新增撤销语义——批量=N 个单块 op 同事务提交，undo 粒度天然=一次提交即一步）。

## 范围

1. **选择模型（纯状态机，可 jsdom 测）**：
   - 锚块=当前焦点块；**Shift+click ⋮⋮ 手柄** → 选中锚块到该块的**连续区间**（按文档序，非点击序：二次 Shift+click 另一块=重算区间，禁集合并）；
   - 普通点击手柄=回单块态（现行为零回归）；Esc / 点击正文 / 焦点移出手柄簇 = 清选；
   - 选区状态供 UI 消费（块左缘选中条 `--accent` token 淡显）。
2. **批量动作（复用现有 BlockAction 通道扩 kind）**：
   - 多选态下手柄菜单变体：批量删除 / 批量复制 / 批量转为（13 型，复用 convert）/ 颜色；
   - **批量=对区间内每块发同型单块 op，一次提交（同事务）**——op 类型零新增、targetTable 零变化；
   - 批量复制=整组副本插在原组之后（保相对序）。
3. **组拖拽**：多选态下拖任一被选块 ⋮⋮=整组移动（dnd.ts 最小改：DropContext 接受块 id 数组→区间视作整体算落位/重排；sortKey 一次分配）；单块拖拽行为零回归。
4. **纯函数面**：区间计算/组落位计划都抽纯函数（`selection.ts` 新文件），单测优先覆盖这块——UI 只做接线。
5. **i18n/testid**：`block-select-bar-<id>`（选中条）、`block-menu-bulk-delete`、`block-menu-bulk-duplicate`、`block-menu-bulk-convert-<type>`、`block-menu-bulk-count`（「已选 N 块」文案区）；控件名 zh/en 成对。

## 红线
§16/R14/no-magic；**op-log v3 零新增类型/零改格式**（同步/导入导出零改动的硬证据=sync 包 109 例+importer 59 例零修改）；不建表不加依赖；禁省略号占位；T76 新块（table/toggle）在批量操作下不炸（至少 delete/convert 两路各有测）；中文禁「数据库」词零回归。

## 显性不做（PRD §2/§5 记档）
非连续 ctrl+click 多选、跨页多选、多选拖拽的动画美化、批量 undo 的「一步撤销多步」新语义。

## 交付
报告 `docs/tasks/TASK-T78-01-report.md`（§0 侦察三问 → §6 门禁，骨架待 PM 建）。门禁四件套原始输出（基线=desktop **1100** / editor **221** / ui **168** / tsc **0** / no-magic ✓，只增不减）。收尾打印 `CB-T78-01-EXIT=0`。
