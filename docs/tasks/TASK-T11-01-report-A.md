# TASK-T11-01 · M12 导入器 —— A 阶段报告

> 工程师：CodeBuddy ｜ 日期：2026-09-14 ｜ 范围：仅 A 阶段（blocks.ts 反向投影 + importer 骨架/types/markdown 解析器）。B（notion-zip/csv + planner）、C（desktop 执行器 + 向导）未动，范围外零文件改动。

## 1. 交付清单

| 文件 | 内容 |
|---|---|
| `packages/editor/src/blocks.ts`（新增） | `pmDocToBlocks(doc: PMDocJSON): BlockSpec[]` 纯反向投影：type 经 `blockTypeOfPmNode` 映射用真相层名（codeBlock→code，与 model.ts 投影边界单源）；content 语义与块模型一致（文本类=PM doc 单 paragraph 包裹、code=纯文本 string、divider/image=null）；`_unsupported/_raw` 节点原样恢复 type/props（page_link/bookmark 走此通道）；无 id/sort_key/version（执行器落库时补） |
| `packages/editor/test/blocks.test.ts`（新增，18 条） | 14 块型全覆盖（对照 packages/schema `blockTypes`：heading1-3→heading+level、todo→to_do+checked、callout→quote+icon、page_link/bookmark 经 _unsupported 通道）+ 往返恒等 `pmDocToBlocks(parseMarkdown(md))` 逐块结构断言（含 H4+ 钳 H3、内联 mark 保真、空正文、多块顺序、手工节点与 md 产物一致性） |
| `packages/editor/src/index.ts`（仅 +1 行出口） | `export { pmDocToBlocks as pmDocToBlockSpecs, type BlockSpec } from './blocks';`（见 DEVIATIONS-1） |
| `packages/importer/*`（新包骨架） | package.json（deps 仅 @septcats/core、@septcats/editor、@septcats/schema、zod；devDeps ts/vitest/@types/node）、tsconfig、vitest.config（**node 环境**，纯逻辑零 IO 范式照抄 packages/sync）、`src/index.ts`；已注册 workspace 并 `pnpm install` |
| `packages/importer/src/types.ts` | §1 全契约 zod：`importPlanSchema`（source/items/counts/warnings）、`importItemSchema` 判别三形态（page/collection/asset）、`importWarningSchema`（action: degraded/skipped-duplicate/failed）、`collectionSchemaDefSchema`（schema-v1 §4 properties+title_pid）、`blockSpecSchema`（复用 editor 的 `pmDocSchema`）；`ImportSourceFs` 接口（`list()` 文件相对路径 + `read(path)`，测试用内存 Map 实现）；`buildPlan()` counts 统计（skippedDuplicate 留给 B 计划器） |
| `packages/importer/src/markdown.ts` | md-file / md-dir 解析器：front-matter（title/tags，行内 `[a,b]` 与逐行 `- x` 两形态，未闭合按普通正文）；目录递归建树（真树先序：同目录文件字典序在前、子目录递归在后；parentPath=所在目录，根为 null）；正文 `parseMarkdown → pmDocToBlockSpecs`（不重写解析器，只做行级预处理）；图片 `![]()` 围栏感知提取：本地相对路径 → sha256 内容寻址 asset item + image 块重写 `asset://<hash><ext>`（同 hash 去重），http(s) 外链 → 保留 URL + degraded warning，附件缺失 → src 原样保留 + warning（不静默丢内容）；GFM 表 → 整表降级 code 块原文 + degraded warning |
| `packages/importer/test/markdown.test.ts`（11 条） | front-matter 全量/缺项/列表形态/未闭合；嵌套目录建树+先序+rootName；附件双形态（sha256 断言、asset 去重、外链保留、缺失保留 src、围栏内不触发）；GFM 表降级；每条 plan 过 `importPlanSchema.parse` 契约校验 |

## 2. 验证（原文）

```
$ pnpm -r typecheck
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

```
$ pnpm -C packages/importer test

 RUN  v3.2.7 E:/Hermes Agent工作空间/Septcats/packages/importer

 ✓  importer  test/markdown.test.ts (11 tests) 14ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  00:16:15
   Duration  677ms (transform 171ms, setup 0ms, collect 352ms, tests 14ms, environment 0ms, prepare 99ms)
```

```
$ pnpm -C packages/editor test

 RUN  v3.2.7 E:/Hermes Agent工作空间/Septcats/packages/editor

 ✓  editor  test/model.test.ts (19 tests) 11ms
 ✓  editor  test/seq.test.ts (7 tests) 12ms
 ✓  editor  test/diff.test.ts (14 tests) 14ms
 ✓  editor  test/blocks.test.ts (18 tests) 12ms
 ✓  editor  test/history.test.ts (4 tests) 102ms
 ✓  editor  test/rules.test.ts (53 tests) 78ms
 ✓  editor  test/react.test.tsx (9 tests) 179ms
 ✓  editor  test/tree.test.ts (20 tests) 999ms

 Test Files  8 passed (8)
      Tests  144 passed (144)
```

存量 126 条 editor 测试不破（144 = 126 + 新增 18）。

## 3. SSIM-NOTE

A 阶段无 UI 面（mockup 09 导入向导属 C 阶段 renderer 预览页），本阶段仅通读 `docs/mockups/09-import-wizard.html` 确认三步向导（选择→预览→执行）的 counts 摘要 / warnings 折叠列表 / 树形 items 语义，已反推为 ImportPlan 契约字段（counts 六元组、warnings 全量、items 先序）；SSIM 屏对齐验收留待 C 阶段随预览页交付。

## 4. DEVIATIONS

1. **出口别名 `pmDocToBlockSpecs`**：model.ts 已有带状态版 `pmDocToBlocks(json, prev, clock): BlockDoc`（model.ts:468），且已合入文件不许改。blocks.ts 内函数名按任务书保持 `pmDocToBlocks`，index.ts 出口用显式命名导出（显式优先于 star，model 版对外不受影响）以别名 `pmDocToBlockSpecs` 暴露，避免双 `export *` 歧义。importer 全部经该别名调用。
2. **image 块 props 采用 §0.4 的 `{src:'asset://<hash><ext>', name}`**（而非 model 层 image 的 `{file_id}`）：BlockSpec 由 importer 产出、§0.4 对导入附件 props 形态有明文裁决；C 阶段执行器落库时按此映射（src=file_id 的 asset:// 形态），如需与 model 层 props 严格对齐由 C 阶段统一裁决。
3. **GFM 表降级 code 块包含分隔行**（`| --- |`）：保证「原文」语义完整，重解析不丢列对齐信息。
4. **md 页面 title 只取 front-matter `title`，缺省=文件名**（不取正文 H1）：任务书 §2 明文；md-dir 用例中 `root.md` 的 title 为 `root`。
5. **md-dir 中目录本身不建页**：仅 `*.md` 为页、所在目录为 parentPath；纯目录（无同名 md）产生的中间 parentPath 由 B 阶段计划器的树一致性规则（孤儿挂根）与 C 阶段执行器补建，A 阶段不做。
6. **围栏正则复制**：markdownPaste.ts 的 `FENCE` 未导出，markdown.ts 以注释锚点（markdownPaste.ts:12）复制同式，漂移风险由两侧测试共同约束。
7. **`node:crypto`（sha256）**：内容寻址哈希属纯计算非 IO，不违反 importer 零 IO 铁律；未新增任何运行时依赖。

## 5. B/C 阶段待办（未动）

- B：notion-zip 解析器（`<SPACE-ID>` 目录建父子边、CSV 类型推断、relation 降级 text）、csv 单表、plan.ts（(path, contentHash) 查重 ExistingLookup、孤儿挂根、重名追加 hash6、>5000 熔断 E_TOO_LARGE）。
- C：desktop main `import:plan/execute/cancel/progress` 通道、migration v5 `import_source`（v4 已被 T8 占用）、fflate 解包（只进 desktop）、renderer 三步向导（mockup 09 对齐、warnings 非空确认按钮「继续导入（N 项降级）」）。
