# TASK-T11-01 · M12 导入器（Notion 导出包 / Markdown / CSV）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T6 页面树、T7/T7b dbview 已合入。必读：docs/mockups/09-import-wizard.html（视觉真相）；docs/PROJECT_PLAN.md §M12（职责/降级/验收全文，本任务书是它的工程化）；packages/editor/src/rules/markdownPaste.ts（**Markdown 解析唯一实现**，§3）；packages/schema blockTypes 14 种；apps/desktop/src/main/pages.ts + dbview.ts（commitOps 写路径范式）；docs/schema-v1.md §4 实体表。
> 纪律：用 Write/Edit 落盘；必须跑 pnpm 验证自己写的每个测试（绝不交没跑过的测试）；不碰 git；禁占位符。

## 0. 架构裁决（PM 已定，不再讨论）
1. **新建 `packages/importer`（纯逻辑包，零 IO）**：输入 = `ImportSourceFs`（注入的文件读抽象，测试用内存 Map 实现），输出 = **导入计划** `ImportPlan`（不直接写库）。所有落库动作由 desktop main 侧执行。
2. **PM doc → 块模型的反向投影放 `packages/editor`**：新增导出 `pmDocToBlocks(doc): BlockSpec[]`（BlockSpec = {type, props, content(JSON)}，type 用**真相层名**，经 `blockTypeOfPmNode` 映射——codeBlock→code 等，与投影边界单源）。importer 依赖 editor 的 markdownPaste（正向）+ pmDocToBlocks（反向）完成 `.md → 块` 全链路。**不许在 importer 里再写一个 markdown 解析器**。
3. **zip 解包 = fflate**（唯一新增依赖，只进 apps/desktop 不进 packages/importer——importer 接收已解压的 `Map<path, Uint8Array|string>`；解压发生在 desktop main）。
4. **附件一期方案**（无 asset 实体，schema 裁决）：导入时按 sha256 内容寻址写入 `userData/assets/<hash><ext>`，image 块 props = `{src: 'asset://<hash><ext>', name}`；书签/页面引用降级见 §5。`asset://` 解析器随本任务加到 renderer（PageView 图片 src 映射）。
5. **幂等表 `import_source`**（migration v5，**注意 v4 已被 T8 占用**）：`(source_path TEXT, content_hash TEXT, page_id TEXT, created_at INT, PRIMARY KEY(source_path, content_hash))`。执行前查重跳过；断点重跑天然幂等。断言用 `LATEST_SCHEMA_VERSION` 参数化。

## 1. ImportPlan 契约（types.ts，全部 zod）
```
ImportPlan = {
  source: {kind:'notion-zip'|'md-dir'|'md-file'|'csv', rootName},
  items: ImportItem[],            // 有序=树先序，执行按此序
  counts: {pages, collections, records, assets, skippedDuplicate, degraded},
  warnings: ImportWarning[]       // 降级/跳过项全量，绝不静默
}
ImportItem =
  | {op:'page', path, title, parentPath|null, blocks: BlockSpec[]}
  | {op:'collection', path, title, parentPath|null, schema, records: values[]}
  | {op:'asset', hash, ext, bytes}                    // bytes 仅 preview 前存在于内存
```

## 2. 三种源解析器（parsers/）
- **notion-zip**：识别 Notion「Markdown & CSV」导出结构——目录名 `页面名 <SPACE-ID 32hex>` 建父子边（目录嵌套=页面树）；`.md` 同名文件=页正文；顶层 `*.csv` 若与某页同名 → 该页的 database（列名 `名称`/`Name` 强制 title 属性；`标签,逗号,分隔` 值 → multi_select 启发；类型推断：全整数/小数→number、ISO 日期或 `2024-01-01` → date、`true/false` → boolean、含逗号 token 集≤20 → multi_select、其余 text）。CSV 内的 `Name` 列且值指向他页目录名的 → relation 候选（一期降级为 text + warning，**不做跨页 relation 重建**，列入报告）。
- **md-dir / md-file**：front-matter `title:`（缺=文件名）与 `tags: []`（→ 页首 callout 块列标签，warning 注明降级）；目录递归=页面树；正文走 markdownPaste→PM doc→pmDocToBlocks。
- **csv**：单表 → 一个 collection 页（类型推断同上）。
- 块映射全覆盖 blockTypes：heading1-3/bulleted/numbered/todo/quote/callout/code/divider 直映；`image ![](...)` → image（本地相对路径→asset 重写；http(s) 外链→**保留 URL + bookmark 化 warning**）；表格 → 一期降级：解析 GFM 表为 collection+records（同名页下建 mini db），失败则整表转 code 块原文 + warning。

## 3. 计划器（plan.ts）
- 去重：对每个 (path, contentHash) 查 import_source（经注入的 `ExistingLookup` 回调，desktop 用 SQL，测试用 Map）→ `skippedDuplicate`。
- 树一致性：父不存在的孤儿项挂根 + warning；重名目录 path 冲突 → 后者追加 hash 前 6 位 + warning。
- **上限熔断**：单计划 > 5000 items → 拒（E_TOO_LARGE，分批导）。

## 4. 执行器（desktop main `import:` 通道，commitOps 同源）
- 通道：`import:plan {zipPath?|dirPath?|csvPath?} → {planId, preview(不含 bytes)}`；`import:execute {planId, confirm: true} → {report}`；`import:cancel {planId}`。
- 执行 = 每页一个 batch：page.upsert op + N 个 block.upsert op（sort_key 依序、actor=本机）+ collection/record op（走 T7b dbview 同款物化）+ 资产落盘（先写 `userData/assets/`，**内容寻址天然幂等**）；成功后插 import_source 行（同 batch）。
- 任一 batch 失败：已完成的**不自动回滚**（页面是 upsert 幂等，重跑续），report 记 `failedAt` 与已成功计数——断点重跑语义 = 从失败处继续，0 脏数据靠幂等而非回滚。
- 预览页（renderer，对齐 mockup 09）：三步向导 选择→预览（counts 摘要 + warnings 折叠列表 + 树形 items 前 50）→执行（进度=已完成/总数，来自轮询 `import:progress {planId}`）→结果页（report 全文 + 「打开首页」）。**warnings 非空时确认按钮文案 = 「继续导入（N 项降级）」**，不藏警告。

## 5. 降级规则（不静默丢内容铁律）
Notion 专有语法 → 映射：`<page-ref>`/`@`提及 → text 保留原文+warning；`$$公式$$`/inline math → code 块原文+warning；Synced block/嵌入视图/TOC → quote 块占位写明原类型+warning；`> Callout（emoji）` markdownPaste 已支持则直映。warning 结构 = {path, what, action:'degraded'|'skipped-duplicate'|'failed', note}。

## 6. 测试底线（fixtures 全部程序化生成，禁二进制大文件）
- 三解析器：合成 Notion zip 结构（内存 map）20 页 3 层嵌套 + 2 db + 附件断言树/类型推断/warnings；front-matter 缺项；GFM 表降级；熔断。
- pmDocToBlocks：**往返恒等 property test**——`pmDocToBlocks(markdownPaste(md))` 对 14 块型×嵌套样例 == 直接块期望；以及 editor 既有 markdownPaste 测试不破。
- 执行器（node 真 SQLite）：幂等重跑 0 新增（import_source 计数）；失败续传（注入第 3 页 throw → 重跑成功且 1-2 页不重复）；blocks op 数 == 断言；LATEST_SCHEMA_VERSION 参数化。
- 存量全绿；typecheck/test/no-magic/build/selftest DoD。

## 7. DoD
```
pnpm -r typecheck && pnpm -r test
pnpm -C apps/desktop selftest
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop build
```
报告 docs/tasks/TASK-T11-01-report.md + SSIM-NOTE（09 屏对齐）。真机验收（老板真实 Notion 导出包 ≥99% 一致率）由 PM 在合入后组织。
