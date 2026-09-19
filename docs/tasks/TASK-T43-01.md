# TASK-T43-01 · R6：「数据库」改称「多维数据」（zh-CN 文案单）

> PM：Hermes ｜ P3（老板新需求 R6）｜ 可与 T41-01 同批派发（改动面不重叠）
> 老板原文：「数据库的名称改为多维数据」

## 0. 范围（PM 侦察：zh-CN 命中 9 处）

`apps/desktop/src/renderer/src/i18n/zh-CN.ts` 中 `数据库` 命中 **9 处**，含：
`convertToDatabase: '转为数据库'`、`filterDatabases`、`kindCollection`、`groupDatabases: '数据库 · {n}'`、命令面板 placeholder「搜索页面、数据库，或输入 > 命令」、`metaDatabase`、`loadFailed: '数据库加载失败'` 等。

## 1. 必须做到

1. **zh-CN 全量替换**：所有**面向用户**的「数据库」→「**多维数据**」（含：菜单项「转为数据库」→「转为多维数据」、面板分组标题、搜索 placeholder、字段/空态/错误文案、设置页、AI 动作面板文案）。
   - **命令面板/菜单里名字变了，命令 id 与 i18n key 不许改**（只改文案值）——避免打断既有调用与测试。
2. **英文不动**：`en-US.ts` 保持 `Database`（若你判断需要更贴切的英文，先报告再改）。
3. **代码与注释里的内部用词不改**（`collection`/`Database` 等实现名保持），只改**用户可见文案**。
4. **一致性**：替换后 zh-CN 中不得残留用户可见的「数据库」（**断言：在 i18n 文件中该词命中 = 0**；`docs/**` 与代码注释不计）。
5. **不做**：不改功能、不改数据结构、不改 schema。

## 2. 验收

1. `grep -c 数据库 apps/desktop/src/renderer/src/i18n/zh-CN.ts` → **0**（贴命令与输出）。
2. 真机中文界面截图 3 张：侧栏/菜单（「转为多维数据」）、命令面板（含「多维数据」分组与 placeholder）、空态或错误文案。
3. 英文界面仍为英文、无新增 CJK（门禁⑤绿，`renderer/src/**` 字符串字面量 CJK 检查）。
4. 回归：全仓无红；typecheck 9/9；`no-magic` ✓；`build-tokens --check` ✓。
5. 视觉：双主题截图。

## 3. 红线

- 允许动：`apps/desktop/src/renderer/src/i18n/{zh-CN,en-US}.ts`（仅文案值）、必要的测试断言（若测试里写死了中文文案 → 同步更新并 §DEVIATION 说明）、`apps/desktop/test/**`。
- 不碰：其它源码、`packages/**`、`main/**`、CI。
- 不碰 git；禁占位符/TODO。

## 4. 交付物

文案改动 + 测试（断言无残留 + 关键 key 值正确）+ 真机截图 + `docs/tasks/TASK-T43-01-report.md`（替换清单逐条：key → 旧值 → 新值；PM 复跑节留「（PM 补）」）。
