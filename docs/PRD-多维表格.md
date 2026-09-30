# PRD —— 多维表格（飞书多维表格对标，T99-01）

> 老板 09-30 令（原文）：「完成流程之后，在日历下方再增加一个飞书的多维表格功能。」
> 「可以去飞书多维表格官网上了解一下它的功能。」
>
> 本文是**接口冻结面**：先改本文件，再动代码。功能集对标自飞书官方文档
> （`open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview` 与飞书帮助中心）。

## 1. 飞书多维表格的能力模型（官方口径摘录）

| 资源 | 上限（官方） | 说明 |
| --- | --- | --- |
| Base App | — | 一个「多维表格」应用（`app_token`），可独立存在，也可嵌在文档/表格/知识库里 |
| Table | 100 | 数据表（`table_id`）；一个 Base 至少一张表 |
| View | 200 | 视图（`view_id`）：**表格 / 看板 / 画册 / 甘特 / 表单**五种 |
| Field | 300（公式 ≤100） | 字段=列（`field_id`），多种类型（文本/数字/单选/多选/日期/人员/附件/复选框/公式/关联…） |
| Record | 按租户 | 记录=行（`record_id`）；批量写上限 1000/次 |
| Dashboard | — | 仪表盘（`block_id`）：多维透视/图表 |
| Workflow | — | 自动化：触发条件 + 执行动作 |
| 高级权限 | 角色 30 / 协作者 200 | 行级、列级权限与自定义角色 |

## 2. 本仓现状（不重造轮子）

`packages/dbview` + `src/main/dbview.ts` 已是**本地版多维表引擎**：

- 字段类型：`text / number / select / multi_select / date / checkbox / url / email / file / relation / ai`
  （新属性菜单暴露 9 种，见 `NEW_PROPERTY_TYPES`）。
- 视图：`VIEW_TYPES = ['table']`（**kanban / calendar 已留名位**），视图模型为数组
  `views: DbView[]`（含 `name / filter / sort / widths`）⇒ **多视图管理天然支持**。
- 能力：`load / createRecord / updateRecord / deleteRecords / add|update|remove|moveProperty /
  saveView / relationSearch / exportCsv / convertPage`。
- 渲染层已有按页打开的多维表界面：`src/renderer/src/db/DbPage.tsx`（`DbPage({ pageId })`）。

## 3. v1 范围（本次交付）

1. **一级入口「多维表格」**：位置**紧随「日历」之后**（一级轨 8 项：
   笔记 / 知识库 / 日历 / **多维表格** / 待办 / 工作台 / 模板 / 回收站）。
2. **二级栏**＝本库全部多维表（名称 + 记录数），含「新建多维表」；点条目切换当前表。
3. **主区**＝对标飞书「表格视图」的工作区：
   - **视图条**：列出该表全部视图，可新建 / 重命名 / 删除 / 切换（复用 `views[]` 模型）。
   - **工具条**：筛选 / 排序 / 字段管理（增删改类型）/ 导出 CSV —— 全部接既有引擎能力。
   - **网格**：行内编辑、增行、行选中批量删、列宽、聚合行（复用既有 `DbPage` 组件与 `view.ts`）。
4. **看板视图（kanban，新增）**：按 `select` 字段分组为列，卡片可**拖动改值**（拖到另一列即改该字段）。
   视图配置新增 `groupPid`（分组字段）与 `hiddenPids`（隐藏列）。

**明确不在 v1**（标注为后续里程碑，不做半成品）：画册 / 甘特 / 表单视图、仪表盘、自动化工作流、
行级/列级高级权限、飞书云端 API 同步（本应用隐私优先：**默认零外联**；若将来要接飞书账号，
另立里程碑并需老板提供应用凭据）。

## 4. 冻结契约（三方并行开发时不得单方面改）

### 4.1 引擎层（packages/dbview）

- `VIEW_TYPES` 由 `['table']` → `['table', 'kanban']`（**顺序即视图菜单顺序**）。
- `DbView` 增两个**可选**字段（旧数据零迁移，缺省 = 现状）：
  - `groupPid?: string`：看板视图的分组字段（必须是 `select` 类型；非法/缺失 → 视图回退表格渲染并提示）。
  - `hiddenPids?: string[]`：视图内隐藏的列。
- 纯函数（放 `packages/dbview/src/view.ts`，无副作用、可单测）：
  - `kanbanGroups(schema, records, view)` → `{ pid, key, label, records[] }[]`；
  - `moveCardToGroup(schema, record, pid, key)` → 该记录应写入的值（不含 IO）。
- `src/main/dbview.ts` 的 `saveView` 必须原样接受新字段（校验放宽，不新增通道）。

### 4.2 渲染层

| 文件 | 根 testid | 其他固定 testid |
| --- | --- | --- |
| `src/renderer/src/bitable/BitablePage.tsx`（默认导出 `BitablePage`） | `bitable-page` | `bitable-table-name`、`bitable-viewbar`、`bitable-view-chip-` 前缀（视图 id）、`bitable-view-new`、`bitable-toolbar`、`bitable-filter`、`bitable-sort`、`bitable-fields`、`bitable-export`、`bitable-grid`、`bitable-row-` 前缀（记录 id）、`bitable-cell-` 前缀（`行id-列pid`）、`bitable-add-row`、`bitable-kanban`、`bitable-kanban-col-` 前缀（分组 key）、`bitable-card-` 前缀（记录 id）、`bitable-empty` |
| `src/renderer/src/bitable/BitableSidePanel.tsx`（默认导出 `BitableSidePanel`） | `bitable-side` | `bitable-side-item-` 前缀（pageId）、`bitable-side-new`、`bitable-side-empty` |

- 数据一律经既有 `window.septcats.db.*` 与 `window.septcats.pages.*`；**不新增 IPC 通道**。
- 只读上下文（主进程不可用）时渲染空态，不崩。
- 只吃 token（no-magic 必过）；文案走 `t('bitable.*')`（键由 PM 预置，子 Agent 只消费）。

### 4.3 i18n 键（PM 预置，只消费）

`nav.bitable` / `nav.bitableHint` / `bitable.*`（title、empty、emptyHint、newTable、sideTitle、
viewTable、viewKanban、viewNew、viewRename、viewRemove、filter、sort、fields、export、
addRow、addRowHint、groupBy、groupByNone、cardCount、itemSuffix、tableList…）。

## 5. 验收

| 角色 | 交付 | 证据 |
| --- | --- | --- |
| A（引擎） | 看板视图类型 + `groupPid/hiddenPids` + 两个纯函数 + 单测 | `pnpm -C packages/dbview test` 与 `pnpm -C apps/desktop test -- test/t99-*` 输出 |
| B（一级页） | `bitable/*` 四件 + 单测 | `pnpm -C apps/desktop test -- test/t99-bitable-ui.test.tsx` |
| PM | 一级入口/二级栏/App 接线、PRD、真机探针 **T99-01**（rail 位置、表列表、视图切换、表格行内编辑落库、看板拖动改值落库、重启后仍在、档案零触碰）、门禁、打包、包审 | 探针输出 |

## 6. 禁止事项

1. 不改：`App.tsx`、`NavRail.tsx`、`navState.ts`、`i18n/*`、`src/shared/ipc.ts`（契约面由 PM 独占）。
2. 不跑 `pnpm dist` / `ensure-abi` / 全量测试（worktree 里 ABI 与虚拟存储不对，必失败）。
3. 不新增依赖；不发任何外部请求（**本功能零外联**）。
4. 绝不写 `C:\Users\Administrator\.septcats`；测试用临时目录。
5. 不重构无关代码。