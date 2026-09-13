# TASK-T11-01 · C 阶段报告（M12 导入器：desktop 执行器 + 向导 UI）

> 工程师：CodeBuddy ｜ 会话：C 阶段（A `004e264`、B `99b324b` 已合入 main）
> 任务书：docs/tasks/TASK-T11-01.md + TASK-T11-01C.md ｜ 前置消费：B 报告 §2 的 6 条裁决（已全部消费，见「关键裁决」）

> **协作说明（必读）**：本会话开工后发现工作区已存在同一任务的**并行会话产物**（schema.v5 / migrations v5 注册 / importSource 白名单三条 / import 四通道 / shared 契约类型 / main/importer.ts / main/assets.ts / main/index.ts 接线）。本会话**沿用并验证**了这批产物（未推倒重写），补齐了其余交付物：`import:pick` 通道、preload 桥、window.d.ts、ImportWizard、App/i18n/commands 接线、全部测试与 DoD。适配与修复逐条见「关键裁决」「DEVIATIONS」。

## 1. 交付物清单

| 文件 | 状态 | 内容 |
| --- | --- | --- |
| `apps/desktop/src/main/importer.ts` | 沿用并行产物 + 最小适配 | 三态入口（`defaultSourceLoader`：zipPath→fflate `unzipSync` 内存解压 / dirPath→递归收集或单 md（statSync 分派）/ csvPath→单表，zip-slip 收口）；`buildPlan(source, files, existingLookup)` 调用（ExistingLookup = `importSource.list` 全量预载 Map）；plan 缓存（内存 Map，planId=ulid，TTL 30 分钟惰性淘汰）；执行 = 每页/每 collection 一个 `commitOps` batch（op_ledger + 物化 + `importSource.insert` 同事务）；asset sha256 校验后内容寻址落 `layout.attachments/<hash><ext>`（存在即跳过）；image 块 props `asset://` src → `file_id` + caption；断点续传（failedAt 下标 + pageIds 幂等跳过）；取消在条目边界生效 |
| `apps/desktop/src/db/schema.v5.ts` | 沿用并行产物 | migration #5：`import_source` 表（STRICT，PK (source_path, content_hash)，无多余索引） |
| `apps/desktop/src/db/migrations.ts` | 沿用并行产物 | 注册 `{id:5, name:'v5-import-source'}`；`LATEST_SCHEMA_VERSION` 为推导值，随迁移表前进到 5 |
| `apps/desktop/src/db/statements.ts` | 沿用并行产物 | 白名单补 `importSource.insert`（OR IGNORE）/ `importSource.get`（(path,hash)→page_id）/ `importSource.list`（全量预载）；54 条 < 60 预算 |
| `apps/desktop/src/shared/ipc.ts` | 沿用 + 本会话补 pick | `import:plan/execute/progress/cancel` 四通道（任务书 §0.3 字面）+ `import:pick`（系统对话框，见 DEVIATIONS-4） |
| `apps/desktop/src/shared/importer.ts` | 沿用 + 本会话适配 | IPC 契约类型（ImportPlanInput/PreviewItem/Preview/Progress/Report/Counts/ImportWarning）；本会话改：本地声明 ImportWarning（web tsconfig 无 node types，type-only import 也把 importer 的 node:crypto 拖进 renderer 编译程序）、Preview 补 `totalItems` + `PREVIEW_ITEM_LIMIT=50` |
| `apps/desktop/src/main/assets.ts` | 沿用并行产物 | `asset://<hash><ext>` 与 `attachment://<hash>` 自定义协议（protocol.handle，app ready 前声明特权；host 正则收口防路径穿越；404 不暴露目录列表）——即任务书 §0.7 的「asset:// renderer 解析」，以协议方案替代 asset:resolve 通道 |
| `apps/desktop/src/main/index.ts` | 沿用 + 本会话补 pick | 服务装配（attachmentsDir = `ctx.layout.attachments`，activeWorkspaceId 经 pages.listWorkspaces 注入）；import 四通道注册（PlanTooLargeError→E_TOO_LARGE 传导）；asset/attachment 协议挂载；本会话补 `import:pick`（dialog.showOpenDialog，按扩展名映射三态入口） |
| `apps/desktop/src/preload/index.ts` | 本会话新增段 | `window.septcats.import.{plan,pick,execute,progress,cancel}` 桥五方法 |
| `apps/desktop/src/types/window.d.ts` | 本会话新增段 | `SeptcatsImportApi` + `SeptcatsApi.import` 成员 |
| `apps/desktop/src/renderer/src/pages/ImportWizard.tsx` + `.css` | 本会话新增 | 三步向导（选择→预览→执行→结果），mockup 09 对齐（见 SSIM-NOTE）；纯逻辑 `wizardNext/confirmLabel/tooLargeCount` 导出；四态 data-state；warnings `<details>` 折叠全量；确认文案「继续导入（N 项降级）」；执行页 ProgressBar + 400ms 轮询 + 取消；结果页 report 全文 + 打开首页；CSS 只吃 var(--sc-*) |
| `apps/desktop/src/renderer/src/App.tsx` | 本会话修改 | 顶栏「导入」IconButton（与设置入口同级形态）+ 面包屑 + 视图接线；palette `app.import` 命令经 `openImport`（可选依赖）接通 |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts`、`palette/commands.ts` | 本会话修改 | importWizard 文案段；CommandDeps 补可选 `openImport`（未注入回退 notify，palette 测试不破） |
| `apps/desktop/package.json` | 修改 | +`fflate@0.8.2`（**唯一新增外部依赖**，精确版本）+ `@septcats/importer: workspace:*`（消费 B 契约所需 workspace 依赖） |
| `apps/desktop/test/import-entry.test.ts` | 本会话新增，8 测试 | 三态入口检测（zip/目录/csv/md-file 各内容逐字节断言；zip slip 与目录条目被拒；三字段全空/多填/dirPath 非 md → E_MALFORMED）；fflate 内存合成 zip 解压；E_TOO_LARGE 透传（toImporterError + service.plan 两层）；ImportWizard 纯逻辑 2 条（状态机主链/回退/保持 + confirmLabel 三态/tooLargeCount） |
| `apps/desktop/test/importer-exec.test.ts` | 本会话新增，4 测试 | **真 SQLite**（describeDb ABI 守卫 + DbServerCore + 白名单转发 + commitOps）：全量导入 op 对账（blocks op 数 == items blocks 总数 8；batchCount==4；附件落盘 hash 文件存在）；幂等重跑 0 新增（重新 plan skippedDuplicate==4 + 同 plan 重复 execute，import_source/ledger 均不增）；失败续传（注入「页三」batch throw → failedAt==2 → 同 planId 重跑 done，页一/页二不重复，最终 4 页 7 块）；csv 源页+collection+records（值类型 number 保持）；LATEST_SCHEMA_VERSION 参数化（migrate.to === LATEST_SCHEMA_VERSION） |
| `apps/desktop/test/migrations.test.ts`、`test/statements.test.ts` | 沿用并行产物改动 | 版本钉死 4→5、v5 结构/幂等/白名单三段新增测试 |

**已合入文件零改动**：`git status --short` 全部改动仅 apps/desktop + pnpm-lock.yaml；`packages/importer`、`packages/editor` 未动。

## 2. 关键裁决（含对 B 契约的消费与适配）

1. **B 契约消费对账**（B 报告 §2 六条全部消费）：包根 `buildPlan(source, files, existingLookup)`（裁决 1/DEVIATIONS-1 的显式 re-export）、`contentHashOf` 直接插 `import_source` 行（裁决 5）、items 树先序执行 + 逻辑路径（裁决 1）、collection.path 约定 `<父页>/<库名>`（裁决 2）、CSV 值形与 dbview 白名单逐字对齐（裁决 6，测试断言 `:3` 证 number 未串型）、warning 全量透传到预览（裁决 4）。
2. **ExistingLookup 同步签名 × 异步 executor**：importer 的注入面是同步函数而 StatementExecutor 异步 → plan() 先 `importSource.list` 全量预载进内存 Map（`path\0hash` 键）再同步查；execute 另持一份快照用于「父页是重复跳过条目」时的父解析（`existingPages`），本运行新建页走 `pageIds`。
3. **双层执行幂等**：① 同 plan 重复 execute → `entry.pageIds` 命中即 0 op 跳过；② 同源重新 plan → 计划期 (path, contentHash) 查 import_source → skipped-duplicate 剔除。两层都断言「0 新增」。
4. **三态入口的第四变体**：`dirPath` 通道承接「目录或单 .md 文件」（loader 内 `statSync` 分派）——renderer 侧 pick 对非 zip/csv 的一切选择统一给 dirPath。
5. **asset:// = 自定义协议而非 IPC 通道**：`protocol.handle('asset')` + `registerSchemesAsPrivileged`（standard+secure），`<img src="asset://…">` 直接命中，无需逐图重写 URL；`attachment://<hash>` 同时兼容编辑器 ImageNode 既有 file_id 口径。执行器落盘前 sha256 复核（bytes 与 hash 不符即失败），image 块 props 物化为 `{file_id, caption}`（对齐 editor ImageNode，A 报告 DEVIATIONS-2 的 C 侧裁决）。
6. **collection 宿主页**：csv 源 `parseCsvFile` 先发 page item 再发 collection（parentPath=页 path）→ 执行器「collection 宿主页必须已存在」恒可解析；notion 源同理（页面先序保证）。
7. **import_source 表无 workspace_id 列** → 语句不带 workspace 守卫（沿用并行产物的 §C-2 说明，口径同设备本地派生态）。

## 3. 验证记录（DoD 五条，原文尾段）

`pnpm -r typecheck`（9 projects 全 Done）：

```
packages/importer typecheck$ tsc -p tsconfig.json --noEmit
packages/importer typecheck: Done
apps/desktop typecheck$ tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
apps/desktop typecheck: Done
```

`pnpm -r test`（各包全绿；本阶段新增 12 条在其中）：

```
packages/editor test:  Test Files  8 passed (8)
packages/editor test:       Tests  144 passed (144)
packages/dbview test:  Test Files  5 passed (5)
packages/dbview test:       Tests  79 passed (79)
packages/importer test:  Test Files  4 passed (4)
packages/importer test:       Tests  50 passed (50)
apps/desktop test:  Test Files  15 passed (15)
apps/desktop test:       Tests  137 passed (137)
```

`pnpm -C apps/desktop selftest`：

```
PASS FTS_RESYNC 后重算页全部在索引中
PASS v4 后块正文进 FTS（触发器写入路径）
PASS fts.syncBlock 显式重算页 FTS 行
  FTS_RESYNC 2000 页全量重算耗时 15.2 ms
PASS FTS_RESYNC 2000 页全量重算 < 3000ms
SELFTEST OK
```

`node packages/ui/tokens/no-magic.mjs`：

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

`pnpm -C apps/desktop build`：

```
✓ 4807 modules transformed.
rendering chunks...
../../out/renderer/index.html                     1.00 kB
../../out/renderer/assets/index-Bz8Z2MmT.css     61.30 kB
../../out/renderer/assets/index-ufCB7KWi.js   1,347.68 kB
✓ built in 3.37s
```

单文件跑测记录（纪律：每写完一个测试立即跑）：

```
✓ test/import-entry.test.ts (6 tests) 14ms   →（补向导逻辑后）8 passed
✓ test/importer-exec.test.ts (4 tests) 74ms
```

## SSIM-NOTE（mockup 09 对齐）

**对齐点**：① 三步 stepper（选择文件/预览报告/执行；done=对勾、on=accent 实心圆、pending=描边圆）+ 节点间分隔线语义（flex 布局）；② `wiz` 容器 720px 居中 + 顶部页标题/副文案；③ drop 虚线选择区（dashed hairline-strong、图标+主文案+弱化 hint、hover 提亮）；④ 源卡片 rpt（图标 + 文件名/元信息两行 + 右侧「上一步」ghost 按钮）；⑤ 树形 items（图标 + 名称 + 右侧 mono 计数，按路径深度缩进，240px 滚动区，超出计数提示）；⑥ warnlist（accent-soft 底、accent 色 what、note 逐条全量，折叠 details 不藏）；⑦ 底部 actions（secondary 上一步 + primary 确认 + 右侧「幂等」弱化提示）；⑧ 确认按钮文案「继续导入（N 项降级）」（mockup 的「开始导入（可整体撤销）」在无警告时还原为「开始导入」）。CSS 全量 var(--sc-*)，双主题经 tokens 自动生效。

**偏差**：① mockup warnlist 为常开展示，实现按任务书 §0.8 要求折叠（`<details>`，展开即全量）；② mockup 内联 svg 换成 @septcats/ui Icon 单族出口（上传箭头缺位 → drop 区用 Copy 图标）；③ stepper 未画分隔线元素（flex 间距近似，视觉复审可补）；④ 结果页为任务书新增态，mockup 09 无对应屏，报告全文用 mono pre。

## DEVIATIONS

1. **并行会话产物的沿用与适配**：工作区存在另一会话的同任务产物（见报告头）。本会话修复其 2 处类型错误（layerKeyIndex null 比较、PlanSource 的 exactOptionalPropertyTypes path）、补预览「截前 50 + totalItems」、ImportWarning 本地声明（防 node:crypto 泄入 web 编译）。未重写已验证通过的执行器逻辑。
2. **report 形状**：实现为 `{planId, status, done, total, failedAt: number|null, error: string|null, opCount, batchCount, counts}`；任务书 §0.5 字面 `{planned, done, failedAt, errors[], counts}` 的 planned≈total、errors[] 收敛为单条 error（报告全文仍整体展示，信息不丢）。如需逐条 errors[] 由 PM 定夺后一行扩展。
3. **planId = ulid 且 TTL 30 分钟**：任务书 §0.3 写 `crypto.randomUUID`、重启即失。实现为 ulid + 内存 Map + 30 分钟惰性淘汰（「重启即失」满足，TTL 为附加防线，都在 main 内存）。
4. **新增第五通道 `import:pick`**：任务书 §0.3 只列四通道，但 renderer sandbox 拿不到文件路径，向导「选择文件」步需 main 侧系统对话框；`pick` 只回路径对象，不触碰 importer 纯逻辑。
5. **apps/desktop 新增 `@septcats/importer` workspace 依赖**：任务书约束「fflate 是唯一新增依赖」指外部 npm 依赖；消费包根 buildPlan 必须声明 workspace 依赖，未引入任何其他外部包。
6. **migrations.test.ts 版本钉死 4→5**：存量断言 `LATEST_SCHEMA_VERSION === 4` 随 v5 前进更新（desktop 测试，非禁改范围），并新增 v5 结构/增量迁移/幂等三段断言。
7. **导入页排序键极端降级**：层尾无空位（sortBetween 抛错）时沿用 prev 键，靠 (sort_key, id) 的 id 决胜保持稳定序（导入场景 ≤5000 条/层，重平衡 batch 不值得引入）。
8. **App 入口图标**：@septcats/ui 单族出口无上传类图标，顶栏「导入」用 Plus（SSIM 偏差 ② 的同源裁决）。

## 未决项（移交 PM / 真机验收）

- **真机样包校准**（同 B 报告）：§5 降级标记集、checkbox 大小写、UUID 连字符目录名——C 侧执行器对标记集无感知（全部在 plan 阶段消化），但 ≥99% 一致率验收仍依赖它。
- **E_TOO_LARGE 分批导 UI**：一期只做错误态提示（「共 N 个条目超过 5000 上限，请分批导入」），分批选择/拆包交互未做。
- **import:pick 的窗口空指针边界**：handler 用 `mainWindow!` 作父窗口；单实例锁下总有主窗，但未来多窗口/托盘态需改为遍历 BrowserWindow。
- **report.errors[] 展开与国际化**：结果页报告为 JSON 全文 + 状态标题；若要人读逐条错误清单需扩展 report 形状（DEVIATIONS-2）。
- **执行进度只到条目粒度**：大 collection 的 records 是单 batch，进度条在其执行期间不走动（任务书 §0.4 的 batch 粒度即如此，如需行粒度需拆 batch）。

## DoD 复跑指引（PM 口径）

```
pnpm -r typecheck && pnpm -r test
pnpm -C apps/desktop selftest
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop build
```
