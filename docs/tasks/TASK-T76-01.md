# TASK-T76-01 · 内容块扩展：表格块 + 折叠列表（R25 唯一单）

> PRD=`docs/PRD-R25-内容块扩展.md`（必读全文）。基线 main `639f615` 或更新（0.4.3 后）。
> 工作目录=主树 `E:\Hermes Agent工作空间\Septcats`（分支 main）。禁碰 git；不建表、不加依赖。
> 开工先侦察三处并在报告 §0 记录，侦察结论直接决定实现路径：**①** 块 content 存储形态（packages/core op/projection + 现有 callout/code 块样例）；**②** 块模型有无父子原语（决定 toggle 走容器还是单块自包含，PRD §2B 两选一禁第三态）；**③** SlashMenu/输入规则/markdownPaste 三管道接线位。

## 范围

### A 表格块 `table`（单块自包含）
1. schema 白名单 +`table`；content=`{ rows: string[][], header: boolean, colWidths?: number[] }`（字段名以侦察 ① 既有块风格为准，定了就全链路一致，禁混用）。
2. 斜杠菜单「表格」→ 插入 3×3 默认表；单元格 Tab/Shift+Tab 移焦；加/删行、加/删列（hover 行/列柄出现按钮——像素钮复用既有 wb-pixbtn 风格口径）；首行表头开关；列宽拖拽（记忆进 content.colWidths）。
3. 网格线=像素黑框线纪律（ink-edge token，禁灰线/裸 px）；行/列柄等浮层吃既有 Dialog/Menu token。
4. markdown 粘贴：`| a | b |` 块 → table content（接 markdownPaste.ts 既有管道）。
5. 输入规则 `|a|b|`+Enter 转表：可做则做，复杂度不可控就砍，记 DEVIATION。

### B 折叠列表 `toggle`
6. schema 白名单 +`toggle`；按侦察 ② 二选一实现（容器 or 标题+多行单块）；默认收起、▶ 旋转指示、展开态为纯视图态不入 content。
7. 斜杠菜单「折叠列表」+（若容器路径）Enter 拆子块、Backspace 空子块收会父级。

### 横切
8. i18n 成对（zh/en）；「表格块」与「多维数据」话术区分，中文界面禁「数据库」词纪律测试不回归。
9. 单测（apps/desktop/test/ 或就近，命名 t76-*）：A content 序列化往返 / 加删行列 op 断言 / 粘贴转换 / B 两态渲染 / 白名单门禁测试同步更新（packages/schema 测）。
10. 探针可测性：新块关键交互挂 testid——`block-table-add-row`、`block-table-add-col`、`block-table-del-row-<i>`、`block-table-del-col-<j>`、`block-table-header-toggle`、`block-toggle-<blockId>`（展开钮）、`slash-item-table`、`slash-item-toggle`（以仓库 slash-item 既有命名风格校准）。

## 红线（全量适用）
§16 全部 + R14 token + no-magic；启动零外联；不建表不加依赖；禁省略号占位常量；同步/导入导出零改动（op-log targetTable 不变）；**合并单元格/表格嵌套块/行级 undo 不做**（PRD §5）。

## 交付
- 报告 `docs/tasks/TASK-T76-01-report.md`（骨架已建：§0 侦察结论 → §1 概览 → §2 计数 → §3 DEVIATION → §4 文件清单 → §5 红线自检 → §6 门禁原始输出）。
- 门禁四件套原始输出 + 新增用例清单。收尾打印 `CB-T76-01-EXIT=0`。
