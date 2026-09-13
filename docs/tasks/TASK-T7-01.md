# TASK-T7-01 · M6 行内数据库（collection/record + 表格视图）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T6（页面树）已合入。必读：docs/schema-v1.md §4（collection/record payload）、docs/mockups/03-database-table.html（交互与视觉基准）、packages/editor/src/model.ts（块↔PM 投影范式，collection 块照此思路）。
> 纪律：只 Write/Edit；不跑终端命令、不碰 git；禁占位符。

## 0. 一句话
把「数据库」做成**可编辑的表格视图组件 + 数据层**：collection 定义（schema/视图）与 record 行都是 Op 实体（已在 core/物化表），本任务做 CRUD 管线与 UI。编辑器里 `collection` 以**引用块**出现（block type 二期再加 `linked_collection` —— 本任务**不碰 packages/editor**，页面里点「数据库」入口 = 打开 DB 页；DB 页本身是独立视图）。

## 1. packages/dbview（新包，纯逻辑 + React 视图分离，同 editor 范式）
```
packages/dbview/
  src/
    index.ts react.ts
    types.ts     # PropertySchema/Value/RawView zod（schema-v1 §4 collection/record 字段表 + §3 属性类型白名单）
    values.ts    # 值编解码：JSON ↔ 显示文本；类型推断（CSV 导入用，M12 复用）
    view.ts      # 视图引擎（纯函数，重测区）：
                 #   applyFilter(rows, filter[]) / applySort / groupBySelect(二期预留,返回 undefined 不实现)
                 #   filter 树：{op:'and',clauses:[{prop,kind:'eq|neq|contains|is_empty|gt|lt|before|after',value}]}
                 #   全部可序列化（JSON 安全）、可进 Op.payload
    csv.ts       # RFC4180 子集解析（自写 ≤150 行；引号/逗号/换行/CRLF；UTF-8 BOM 剔除）
    react/
      TableGrid.tsx     # 虚拟滚动（行 36px，列 120-400px 可拖宽存 view.widths）；键盘：方向键移 cell、Enter 编辑、Esc 取消
      CellEditor.tsx    # 按属性类型分发：Text/Number/Date(原生 date input)/Select(菜单)/MultiSelect/Checkbox/URL/Relation(搜索选记录)/File(占位:仅显示名)
      PropBar.tsx       # 工具条：视图切换占位/筛选 chip 链/排序 chip/新属性菜单（类型 8 种：text number select multi select? 无人员; date checkbox url email relation）
      Aggregations.tsx  # 底部计算行：空/计数/求和/平均/最早/最晚（按类型可用集）
      DbView.css        # token-only（no-magic 覆盖此包）
  test/ view.test.ts types.test.ts values.test.ts csv.test.ts react.test.tsx
  vitest.config.ts（node+jsdom projects 双工程，抄 editor 的拆法）
```

## 2. 数据接线（apps/desktop，main 侧 pages.ts 旁新增 dbview 通道）
- statements 追加（不新增 migration，collection/record 表 v1 已有）：`record.listByCollection {collectionId, workspaceId}`、`record.byIds`、`collection.get/upsert`、`view.set {collectionId, viewJson}`、`relation.countTargets {id}`（删除前检查）。
- IPC channels（shared/ipc.ts）：`db:create {workspaceId, title} → {collectionId, pageId}`（建独立 DB 页 + collection 实体，**同事务 batch**）、`db:get {id}`、`db:rename`、`db:prop:add/remove/update`、`db:view:save {collectionId, view}`、`db:record:create {collectionId, values?}`（sort_key=层尾）、`db:record:update {id, patch}`、`db:record:delete {ids}`（批量=多条 delete op）、`db:records:export {collectionId} → CSV 文本`。
- **一切写走 commitOps 同源**（T5/T6 已立的规）：Op{target:collection|record} + 物化 upsert/delete 同事务；relation 字段值改动要同步写对方 record 的 backlink 数组（双 op，一个 batch，原子）。
- renderer 路由接入：App 内容区从假树换成真 page 打开（T6 已铺 state/pages，这里补 collection 类型页渲染 DbView；PageView 顶栏「转为数据库」按钮=创建+跳转）。

## 3. 关键语义测试（view.ts 纯函数）
- filter 六 kind × 各类型：1万 record 属性化（fast-check）断言：①applyFilter 结果全部真满足 ②补集=取反 filter；③and 嵌套深度 3 不崩。
- sort：select 按 options 顺序、date 空值最后、稳定（同值保 sort_key 序）。
- CSV：引号内逗号/换行/双引号转义/仅首行带 BOM/CRLF 混合/空文件→[]。
- values：roundtrip 恒等（8 类型各 20 随机值）；显示文本截断 40 字符加省略号。
- relation：双写 batch 中对方 backlink 与主写要么都在要么都无（batch 失败回滚测试 → 复用 T2 的 batch 事务语义证明）。

## 4. UI 红线（§16 适用，对齐 03 mockup）
行高/表头高/最小列宽=token（layout.*）；筛选 chip 可点除；编辑单元格描边 focus-ring 且 Enter 提交；批量勾选行显批量条；空值占位「—」；数字/日期列 mono 右/左对齐；tag 三语义色。**每个列表区域四态齐**（EmptyState：一句+「新建记录」primary；Skeleton：与行同构；Error：重试）。

## 5. 依赖白名单
无新增（@septcats/ui、clsx 已在 editor 模式；react peer）。**不引 TanStack Table**——虚拟滚动自写 ≤200 行（编辑器窗口固定行高 36px，简单 windowing）。

## 6. DoD
```
pnpm -r typecheck && pnpm -r test        # dbview 新测试全绿；存量不破
node packages/ui/tokens/no-magic.mjs      # 需先扩 paths：packages/dbview/src
pnpm -C apps/desktop build
```
报告含 SSIM-NOTE（03 屏对齐点清单）。
