# PRD-R25 · 内容块扩展一期（表格块 + 折叠列表）

> 立项：PM（Hermes）09-24 · 基线 main `639f615`（0.4.3 已正式发布）
> 老板授权：「先规划，再派发给 CB 任务」——本 PRD 即规划产出，R25 唯一范围。

## 1. 选题理由（为什么是这两个）

现状（`packages/schema/src/index.ts` 块白名单 14 种）：paragraph/h1-h3/ul/ol/todo/quote/callout/code/divider/image/page_link/bookmark。
Notion 内容创作高频缺口只剩两块：**表格**（结构化信息，文档刚需）与**折叠列表 toggle**（长文大纲/FAQ 组织）。
同步与导入导出管线（op-log v3）已成熟，新块类型走既有 content JSON 即天然兼容——投入小、用户可感知价值大。

## 2. 范围

### T76-A 表格块 `table`
- 块形态：**单块自包含**（cells 二维 JSON 存块 content，与 code 块同构），**不做嵌套子块**——op-log 事件流模型下嵌套行/列的增删拖边界 case 爆炸，列为显性不做（§5）。
- 能力：插入 N×M（默认 3×3）；加/删行、加/删列；首行=表头开关；单元格文本编辑（Tab/Shift+Tab 移焦）；列宽拖拽调整（本地记忆，存 content）。
- 斜杠菜单「表格」+ 输入规则 `|a|b|` 回车转表（一期可砍，CB 视复杂度定，砍了记 DEVIATION）。
- 合并单元格 **一期不做**（ProseMirror 式 grid 复杂度高，单块模型下不划算）。

### T76-B 折叠列表 `toggle`
- 条件建模：块模型若已有父子/排序原语 → toggle=容器块（子块列表）；若无 → 降级为「标题+多行正文」单块自包含（同表格思路），**CB 侦察后二选一并在报告记 DEVIATION**，不许造第三态。
- ▶ 指示箭头随展开态旋转（transform，零新 token）；默认收起；展开态**不入 content**（纯视图态，重开文档回默认收起——与 Notion 略异，记口径）。

### 横切（两类型共同）
- schema 白名单 +1/+1；op-log targetTable 不变；同步/导入导出零改动。
- 粘贴：markdown 表格文本 → table 块（`packages/editor/src/rules/markdownPaste.ts` 既有管道顺接）。
- 多维数据禁区：文案一律「表格块」，与「多维数据（库）」明确区分，禁「数据库」词纪律不变。

## 3. 红线（既有纪律全量适用）
- §16 全部 + R14 框线 token（表格网格线=ink-edge 像素口径，禁灰线）；
- 组件 CSS 只吃 `var(--sc-*)`；no-magic；思源字体链不碰；
- 启动零外联不变；不建表（SQLite 无新表）、不加 npm 依赖；
- 字符串常量禁省略号占位写法（T71 D-4 教训）；localStorage/存储键如需新增逐字节自查。

## 4. 验收
- 四门禁：typecheck 0 / desktop vitest 只增不减（基线 1046+25skip 口径见 R24 记录）/ ui 168 / no-magic ✓；
- 新增单测：表格 content 序列化往返、加删行列 op 正确性、toggle 两态渲染、markdown 粘贴转换、白名单门禁更新；
- PM 真机探针 `cdp-e2e-t76-01.mjs`（插入→编辑→加删行列→折叠→重启持久化→同步段可导出）；
- frame-check --packed G4 描边抽检覆盖表格。

## 5. 显性不做（记档）
合并单元格、行级历史/undo、表格嵌套块、公式块、toC 数据库视图联动（那是多维数据的地盘）、移动端（一期形态锁死桌面）。
