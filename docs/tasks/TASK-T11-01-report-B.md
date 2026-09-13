# TASK-T11-01 · B 阶段报告（M12 导入器：csvInfer / notion / plan）

> 工程师：CodeBuddy ｜ 会话：B 阶段（A 已合入；C=desktop 执行器+向导 UI 归下一会话）
> 任务书：docs/tasks/TASK-T11-01.md ｜ 本报告只覆盖 B 阶段交付。

## 1. 交付物清单

| 文件 | 状态 | 内容 |
| --- | --- | --- |
| `packages/importer/src/csvInfer.ts` | 新增 | RFC4180 解析（引号/`""`转义/CRLF/BOM/全空行丢弃）+ 列类型推断（true/false→checkbox、整数/小数→number、ISO 日期→date、含逗号且 token 集≤20→multi_select、其余 text；空值不参与推断、混合列落 text）+ title 属性（`名称`/`Name` 列强制 text，缺则第一列）+ `parseCsvFile`（csv 源：单表→页+collection） |
| `packages/importer/src/notion.ts` | 新增 | Notion「Markdown & CSV」目录解析：`页面名 <32hex>` 目录建父子树、同名 `.md` 走 A 阶段 `parseMdPage`（front-matter/附件 sha256 asset/`asset://` 重写/GFM 表降级全复用）、同名 database 子目录+CSV→collection+records、§5 降级预处理（围栏感知）+ relation 候选 warning |
| `packages/importer/src/plan.ts` | 新增 | 三源统一入口 `buildPlan(source, files, existingLookup)`：>5000 熔断 `PlanTooLargeError(E_TOO_LARGE)`、(path, contentHash) 去重→skippedDuplicate、孤儿挂根+warning（兼容 md-dir 目录前缀父约定）、重名 path→内容 hash 前 6 位后缀+warning、counts 汇总（复用 types.buildPlan，回填 skippedDuplicate） |
| `packages/importer/src/index.ts` | 补全（任务书 B-4） | 出口补全；以**显式 re-export** 消解 types/plan 两个 `buildPlan` 的 star-export 歧义 |
| `packages/importer/test/csvInfer.test.ts` | 新增 | 15 测试：解析器边界、五档类型推断（含空值/混合/非法日历/>20 token）、title 三态、值形（{y,m,d}/boolean/选项 id[]/null）、csv 源 plan 契约 |
| `packages/importer/test/notion.test.ts` | 新增 | 11 测试：§5 降级预处理（围栏内不触发、未闭合 synced 不静默）、合成夹具 20 页 3 层嵌套+2 db+附件（树先序/parentPath 链/类型推断/counts.degraded=9/warnings 全量断言）、散 CSV 兜底（同名归页/孤儿挂根+warning） |
| `packages/importer/test/plan.test.ts` | 新增 | 13 测试：去重（页面/数据表/asset 豁免）、孤儿+前缀父、重名 hash6、熔断 5000/5001 边界、counts 对账、三源 dispatch、缺 path 报错 |

**已合入文件零改动**：`git status --short` 仅 `M packages/importer/src/index.ts`（B-4 出口补全）+ 6 个新增文件；`types.ts`/`markdown.ts` 未动，全程复用其导出（`ImportPlan/ImportItem/ImportWarning/ImportSourceFs/toBytes/buildPlan(types)/parseMdPage`）。

## 2. 关键裁决（工程化细节，供 C 阶段消费）

1. **逻辑路径**：notion/csv 源的 `item.path` = 清理 32hex 后的标题链（`工作区/项目甲/规划`），`parentPath` = 父页逻辑路径或 null；md 源保持 A 阶段文件路径/目录路径约定。重名合并因此落在计划器（hash 后缀）。
2. **database 匹配**：① `库名 <32hex>/` 目录内 CSV（canonical，父=目录内同名页或最深祖先页）；② 顶层散 CSV 清理名与某页同名（父=该页）；③ 都不中→挂根 + `CSV 数据库` warning（不静默）。collection.path 约定：有父=`<父页>/<库名>`，无父=`<库名>/<库名>`。
3. **§5 降级 = 围栏感知文本预处理 + warning**，之后整体交给 A 阶段 `parseMdPage`（附件/表格/front-matter 零重写）：块公式 `$$…$$`→code 围栏（定界符由围栏替代，公式原文保留在块内）、行内 `$…$`/`$$…$$`→行内 code 原文、page-ref `[文本](32hex|UUID)`→纯文本、`:::synced…:::`→单行 quote 占位（内容以「；」连接保留在占位行内）、`:::embed <url>`/`:::toc`→quote 占位、`@提及`→原文保留。
4. **warning 粒度**：B 阶段新产生的降级 warning 按文件按类聚合（note 含 `N 处` 计数）；A 阶段既有逐条 warning（GFM 表/图片）行为不变。两类合计保证「绝不静默」。
5. **contentHash 规范化**：键序排序的 canonical JSON 后 sha256（page={title,blocks}、collection={title,schema,records}），去重与重名后缀共用 `contentHashOf`（已导出，C 阶段执行器可直接复用插 `import_source` 行）。
6. **CSV 值形**：与 `@septcats/dbview` types.ts §4 白名单逐字对齐——date=`{y,m,d}`（含日历真实性校验，非法落 text）、multi_select=选项 id[]（id=`<pid>-o<j>`）、checkbox=boolean、空值=null；产物可直接进 schema-v1 collection。

## 3. 验证记录（原文）

`pnpm -C packages/importer test`：

```
> @septcats/importer@0.0.0 test E:\Hermes Agent工作空间\Septcats\packages\importer
> vitest run

 RUN  v3.2.7 E:/Hermes Agent工作空间/Septcats/packages/importer

 ✓  importer  test/csvInfer.test.ts (15 tests) 12ms
 ✓  importer  test/markdown.test.ts (11 tests) 14ms
 ✓  importer  test/notion.test.ts (11 tests) 15ms
 ✓  importer  test/plan.test.ts (13 tests) 57ms

 Test Files  4 passed (4)
      Tests  50 passed (50)
   Start at  00:47:41
 Duration  704ms (transform 318ms, setup 0ms, collect 1.40s, tests 98ms, environment 1ms, prepare 499ms)
```

`pnpm -r typecheck`：

```
Scope: 9 of 10 workspace projects
packages/core typecheck$ tsc -p tsconfig.json --noEmit
packages/platform typecheck$ tsc -p tsconfig.json --noEmit
packages/ui typecheck$ tsc -p tsconfig.json --noEmit
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
packages/dbview typecheck$ tsc -p tsconfig.json --noEmit
packages/editor typecheck$ tsc -p tsconfig.json --noEmit
packages/schema typecheck$ tsc -p tsconfig.json --noEmit
packages/sync typecheck$ tsc -p tsconfig.json --noEmit
packages/sync typecheck: Done
packages/schema typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
apps/desktop typecheck$ tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
packages/importer typecheck$ tsc -p tsconfig.json --noEmit
packages/importer typecheck: Done
apps/desktop typecheck: Done
```

纪律遵守：未做任何 git 写操作（仅只读 `git status --short` 核对改动面）；未跑 `pnpm install`。

## SSIM-NOTE

B 阶段为纯逻辑层（packages/importer 零 IO、零 UI），与 `docs/mockups/09-import-wizard.html` 无直接像素契约；09 屏的三步向导（选择→预览→执行）、counts 摘要、warnings 折叠列表、「继续导入（N 项降级）」文案所需的数据面——`counts.{pages,collections,records,assets,skippedDuplicate,degraded}`、`warnings[{path,what,action,note}]`、items 树先序——已由本阶段契约化产出并测试锁定。视觉对齐（预览页渲染、按钮文案、进度轮询）归 C 阶段，届时在本文件补记 SSIM-NOTE。

## DEVIATIONS

1. **包根 `buildPlan` 指向计划器版本**：任务书要求 plan.ts 入口名为 `buildPlan(source, files, existingLookup)`，但 A 已合入的 `types.buildPlan(source, items, warnings)` 同名且不可改。裁决：`index.ts` 以显式 re-export 让包根导出 plan 版本，types 版本继续供各解析器经 `'./types'` 内部使用；A 的 11 个测试（直接从 `../src/types` 导入）不受影响。C 阶段统一从包根 `@septcats/importer` 拿到的 `buildPlan` 即计划器。
2. **item.path 用逻辑路径而非源内 fs 路径**（notion/csv 源）：任务书 §1 字面为「源内相对路径」；但 32hex id 后缀会阻碍重名检测/树一致性语义，且执行器最终需要的是标题树。md 源保持 A 约定不变；warnings.path 仍用源内真实路径（含 32hex）以便溯源。
3. **§5 降级的可观察形态为文档化合成契约**：真实 Notion「Markdown & CSV」导出对 synced 块/TOC/嵌入视图没有标准 markdown 形态。本阶段按 `:::synced/:::embed/:::toc` 与 `$$…$$` 定义（代码头注释+测试锁定），**待 PM 真机样包（§7）校准标记集**——这是 B 阶段最大的待验证假设。
4. **relation 候选检测做了推广**：任务书 §2 字面「CSV 内的 Name 列且值指向他页目录名」，但 Name 列即 title 列（不降级、指向自身表无意义）；实现为「任意非 title 的 text 列，非空值命中他页清理标题 ≥1 → 整列一条 warning，类型保持 text」。覆盖字面意图，不重建跨页 relation。
5. **checkbox 推断严格小写 `true`/`false`**：`TRUE`/`Yes`/`是` 落 text。任务书字面即 true/false；真机样包若出现大小写变体再放宽（一行改动）。
6. **markdown.ts 的 `preOrderPaths` 未导出**（已合入文件不可改），notion.ts 自实现 nodeDir 字典序先序（父目录必为路径前缀、必排在前），行为与 A 等价。

## 未决项（移交 C 阶段 / PM）

- C 阶段执行器需消费：`buildPlan(source, files, existingLookup)`（existingLookup 用 import_source SQL）、`contentHashOf`（插 import_source 行）、items 先序执行、`asset://` 落盘与 renderer 解析、E_TOO_LARGE 的分批导 UI。
- 真机样包校准：§5 标记集（DEVIATIONS-3）、checkbox 大小写（DEVIATIONS-5）、Notion UUID 连字符形态的目录名（当前目录名严格 32hex，链接已兼容连字符 UUID）。
- DoD 四条（`pnpm -r test`、`selftest`、`no-magic`、`build`）随 C 阶段合入后由 PM 复跑。

## DoD 复跑指引（本阶段）

```
pnpm -C packages/importer test      # 50 passed
pnpm -r typecheck                    # 9 projects Done
```
