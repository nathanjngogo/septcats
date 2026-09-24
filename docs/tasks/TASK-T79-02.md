# TASK-T79-02 · 导出链路结构化内容降级修复 + 代码围栏 lang 丢失

> 前置：TASK-T79-01（R27 页面导出）已交付、四门禁全绿，但 PM 真机探针暴露两个缺陷。
> PRD=`docs/PRD-R27-页面导出.md`；基线=main。工作目录=主树，禁碰 git、不跑全仓回归。
> 只 Write/Edit 落盘；报告骨架 `docs/tasks/TASK-T79-02-report.md`。收尾打印 `CB-T79-02-EXIT=0`。

## 缺陷 A（P0 · 阻断 T79 验收）：导出与 IPC 读路径把结构化内容降级成空段落

### 症状（PM 真机实锤）
- 真机导出：表格块导出为 **3×3 全空** md（单元格文本全丢）；对照真相层 DB 里 `content_json` 明确有值。
- IPC 实测：`window.septcats.blocks.list({pageId})` 对 table 块返回 `{"type":"doc","content":[{"type":"paragraph"}]}`（降级空段落）。

### 证据（夹具可复现，真实库同形态）
- table 块 `content_json` = `{"rows":[["格A","",""],["","",""],["","",""]],"header":true}`
- toggle 块 `content_json` = `{"title":"折叠标题Q","body":[""]}`
- 即 R25 冻结口径：table/toggle 的 content 是**结构化对象**（见 `packages/editor/src/model.ts` 顶部注释 + `blockContentSchema`），不是 PM doc。

### 根因（两处同口径复制，均只放行 doc）
- `apps/desktop/src/main/blocks.ts` `blockContentOf()`：`parsed.type === 'doc'` 才透传，否则 `EMPTY_PARAGRAPH_DOC`。
- `apps/desktop/src/main/pageExport.ts` `contentOfRow()`：注释自称「与 main/blocks.ts blockContentOf 同口径」，实为同一缺陷的副本。

### 要求
1. **单一实现**：pageExport 不再自带副本，改为共用 blocks.ts 的同一函数（导出侧只保留 image 资源适配等自身逻辑）。
2. **口径**：按 `packages/editor/src/model.ts` 的 `blockContentSchema` 分流——
   - `divider`/`image` → `null`；`code` → 纯文本 string；
   - `table` → 结构化 `{rows,header[,colWidths]}`（可用 `normalizeTableContent` 归一）；
   - `toggle` → 结构化 `{title,body}`（可用 `normalizeToggleContent` 归一）；
   - 其余文本类 → JSON 化的 PM doc（`type:'doc'` 校验保留）；
   - 解析失败/形态不符 → 仍降级为空段落（**不丢块**，只丢内容，保持现韧性）。
3. **测试**：main 侧单测覆盖 6 种行形态（doc / code / table / toggle / divider-image-null / 损坏 JSON 降级）；导出用例必须覆盖「table 单元格文本进 md」「toggle title/body 进 md」。
4. **回归**：desktop / editor / importer / ui 测试与 tsc、no-magic 全绿（只增不减）；T76 表格/折叠探针语义不破。
5. 报告里说明：该改动对 `blocks.list` 其他消费方（渲染层重载）的影响面与验证方式。

## 缺陷 B（P1 · 用户体验）：键入 ```python 后语言丢失

### 症状（PM 真机实锤）
- 真机导出 md = ` ```\npython\nprint("hi")\n``` `：围栏无语言，`python` 变成代码正文首行。

### 根因
- `packages/editor/src/rules/inputRules.ts` 的 `FENCE_RULE = /^```([A-Za-z0-9_+#-]{0,32})$/` 在**第三个反引号**那一帧即命中（lang 捕获为 `''`）→ 立刻转代码块；随后键入的 `python` 落进代码正文。
- 结果：` ```python ` 这种最常见的手感永远无法落 lang（T77 只覆盖了「先 ``` 再用语言栏选」的路径）。

### 要求
1. 让 ` ```lang ` 能正确落 `lang`（方案自选：等 Enter 触发、或要求围栏与语言间允许空格分隔；报告里写明选择与理由）。
2. 现行 ` ``` ` + Enter → 空 lang 代码块的行为**不得破**（含 Enter 触发时序）。
3. 单测 ≥3 例：` ``` `、` ```python `、语言后带尾随字符（不应误判）；含「转换后删除字符数」断言（防残留反引号）。
4. 报告写明对既有 T77 语言栏路径无回归。

## 红线（全量适用）
像素框线 token `var(--sc-*)`、R14 ink-edge；不建表、不加依赖；禁省略号占位；中文界面禁「数据库」词（i18n 纪律测试）；启动零外联；op-log 零新增（`packages/editor/src/{sync,schema}` 与 core 零改动）；不动 serialize.ts 的 Markdown 方言；显性不做 HTML/PDF/便携包/加密导出。