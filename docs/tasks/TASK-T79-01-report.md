# T79-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T79-01.md` · PRD：`docs/PRD-R27-页面导出.md`

## §0 开工侦察结论

**基线核对**：开工四件套实测 desktop **1111** / editor **254** / ui **168** / tsc **0** /
no-magic ✓（另 importer **59**）。工作树 HEAD 与本单无交集。

### ① 解析器实际可识别语法（序列化方言据此定稿）

**「自家解析器」= 两段串联**：`packages/importer/src/markdown.ts` 的 `BodyScanner`
（行级预处理：图片提取 / GFM 表格降级 / 围栏感知）→ `@septcats/editor`
`parseMarkdown`（`rules/markdownPaste.ts:136`，块级语法）→ `pmDocToBlockSpecs`
（`blocks.ts:141`，PM 节点 → 真相层 BlockSpec）。

逐型实况（grep + 源码实证）：

| 块型 | 解析器实际识别语法 | 位置 |
|---|---|---|
| paragraph | 任意非空非命中行的连续文本 | `markdownPaste.ts:223` |
| heading 1–3 | `#`..`######`（**块级钳到 1–3**） | `:195` `heading()` 内 `Math.min(3,…)` |
| bulleted_list | `^\s*[-*+]\s+` | `:20 BULLET` |
| numbered_list | `^\s*\d{1,9}[.)]\s+` | `:21 NUMBERED` |
| to_do | `^\s*[-*+]\s+\[( |x|X)\]\s+` | `:19 TODO` |
| quote | `^\s*>\s?(.*)$` | `:22 QUOTE` |
| **callout** | **无独立语法**（quote 不带 icon；schema 层 callout = quote+props.icon，见 `types/quote.ts:4`） | — |
| divider | `^\s*(?:-{3,}|\*{3,}|_{3,})\s*$` | `:23 DIVIDER` |
| code | `^```([A-Za-z0-9_+#-]*)\s*$` … 闭合同式（**闭合必须恰好 ``` **） | `:17 FENCE` |
| image | **不进 parseMarkdown**：`markdown.ts` BodyScanner 的 `IMAGE` 正则提取，本地相对引用 → sha256 内容寻址 `asset://<hash><ext>` | `markdown.ts:23,253` |
| table | `| a | b |` 管道行 + 可选 `| --- |` 分隔行；**importer 侧 `tryTable` 把 GFM 表格降级为 code 块 + warning**（一期口径） | `markdownPaste.ts:175`；`markdown.ts:200` |
| **toggle** | **无语法**（T76 只做了块渲染，未做 md 解析） | — |

**结论 → 方言定稿（序列化器必须产出解析器吃得回的方言）**：

1. 12 型（paragraph/heading1-3/bullet/numbered/todo/quote/divider/code/table + image）——
   解析器已有语法，序列化器**逐字对齐**上表；**不抄外部 CommonMark/GFM 规范**。
2. **callout 与 toggle 解析器完全无语法** ⇒ 若不动解析器则双向 roundtrip 必断。
   按任务书「序列化方言据此定稿 + roundtrip 以自家解析器为准」，**在 editor `parseMarkdown`
   窄口新增两条自家方言**（纯 TS、只扩识别面、不动既有分支）：
   - **callout**：`> [!<icon>] <inline>` → `quote` 节点 + `attrs.icon`（`types/quote.ts`
     的 icon attr 已就绪，`blocks.ts:83` 反投影 → `props.icon`）。
   - **toggle**：`> [!toggle] <title>` + 紧邻 `> ` 行为 body（连续 quote 行成组，空行断组）
     → `toggle` 原子节点 `attrs{title,body}`（`types/toggle.ts` 已就绪）。
   选 `toggle` 作保留标记 token；因方言当天新增，真实世界 md 无此串 → 既有导入行为零改动。
3. **table 单元格转义**：PRD 要 GFM 管道表且「单元格内转义 `|` 与换行 `<br>`」——
   但 `content.ts:289 splitTableCells` 只按 `|` 裸切、**不反解转义**。为让
   `serialize→parse` 无损，在 `splitTableCells` 窄口补**反解** `\|`→`|`、`<br>`→`\n`
   （纯增量：现有夹具无 `\|`/`<br>`，零回归）。
4. **图片**：canonical 形态 = 解析器真实产物 `{type:'image', props:{src:'asset://<hash><ext>', name}, content:null}`
   （`markdown.ts:303`）。**序列化器消费/产出同一 canonical 形态**，故 roundtrip 无需形状适配器。
   DB 侧编辑器形态 `{file_id,caption,width}`（`blocks.ts:102`）由 main 侧出口适配为 canonical
   （src=`asset://<file_id><ext>`、name=caption）——适配住边界，序列化器保持纯。
5. **无损边界（记 §0 口径，测试按 canonical 化断言）**：colWidths（列宽无 md 表达）、
   code `wrap`、image `width`、image 空 caption（解析器会用文件名兜底 alt）、
   numbered `start`（解析器恒不带 start）、单行 header=false 表格（不满足归组门槛）、
   **md 控制符字面量**（如正文含 `**`/`` ``` ``/`\`）因解析器无转义反解而不保真。
   非嵌套列表项（解析器本就无嵌套语义，`markdownPaste.ts:8` 明文）。

### ② diag:export 落盘确认流与 zip 实现（复用同款）

- **确认流**（`main/index.ts:822-832`）：`diag:export` = 只组装 **preview**（不落盘）；
  `diag:confirm` = 重新组装 → `mkdirSync` → 写 `*.tmp` → `renameSync` 原子落
  `userData/diagnostics/diag-<ts>.json`。**先预览、用户确认才写盘**，无静默写盘。
- **zip 实现**：diag **不是 zip**（单 JSON）；仓内既有归档能力 = **`fflate@0.8.2`**
  （`apps/desktop/package.json` 已依赖；`main/importer.ts:27,119` 用 `unzipSync` 解 Notion zip）。
  序列化侧 `fflate` 无 `zipSync` 现用先例。
- **本单选型（PRD §1B 二选一）**：**落目录**（非 zip）。理由：① 与既有 reveal/文件管理器
  交互天然契合（zip 需先解包才能看）；② 零新增依赖、零自写归档器（更贴合 no-magic/不加依赖）；
  ③ 子树层级 + `files/` 附件本就需要目录结构。交互对齐 diag：**预览（列文件名+孤儿清单，不落盘）
  → 用户确认（选目标目录）→ 写盘**；`dialog.showOpenDialog` 取消 = **零落盘**。

### ③ image file_id → 磁盘路径解析与「media 表」

- **无 `media` 表**（grep 实证：`packages/**` 无 media 表定义；附件是**内容寻址目录**）。
- **落盘**：`layout.attachments/<hash><ext>`（导入执行器 `main/importer.ts:442` sha256 内容寻址）。
- **file_id**：`packages/editor/src/types/image.ts:234` = 纯 sha256 hex（64 位，无扩展名）。
- **解析函数**：`main/assets.ts:59 findHashFile(dir, hash)`——先精确 `<hash>`，再
  `startsWith('<hash>.')` 前缀匹配出磁盘文件（共两 scheme 解析口径）。
- **只读纪律**：导出 = `readFileSync` 源文件 → 写包内 `files/<basename>`，**源目录零写入**（拷贝非移动）。

### ④ 页面级菜单宿主链 / scope 对话框范式 / reveal 合规

- **页面级菜单宿主链**：侧栏页面行菜单 = `pages/SidebarTree.tsx:515 pageRowMenu(node)`
  （T60-01 ④ ⋯ 钮与右键**共用**同一 `Menu` 实例/锚点）。菜单组件 = `@septcats/ui` `Menu`
  （`Menu.tsx:7 MenuEntry`，`label: ReactNode`）⇒ **testid 可挂在 `label` 的 `<span>` 上，
  无需改 ui 包**。本单在此加「导出为 Markdown…」（`page-export-menu`），与既有
  「移入…/加锁/删除」同构。
- **scope 对话框范式**：`@septcats/ui` `Dialog`（`Dialog.tsx:16` open/onClose/title/children/footer；
  children 内挂 `data-testid`）。既有范式：`pages/PageDeleteDialog.tsx`、`pages/PageLockDialog.tsx`。
- **toast**：store `state/pages.ts:239 pushToast(message, tone)` → `App.tsx:702 ToastViewport`
  （`ToastItem` 无 testid → 窄口补可选 `testId`，见 §3 D-2）。
- **reveal 合规**：`file://` **不在** `shell:openExternal` 白名单（`shared/ipc.ts:486`，
  仅 http/https）⇒ **禁走 openExternal**。改用 Electron `shell.openPath(dir)`（打开目录，
  不经 URL 协议白名单），新增独立 IPC `page:export:reveal`，仅接受「已被本次导出写过的目录」
  （存在性 + 是目录校验），零外联、零协议面扩张。**做**（非一期不做）。

## §1 交付概览（DoD 自检）

- [x] **A** `packages/importer/src/serialize.ts`：blocks→Markdown，14 块型全覆盖（paragraph/
      heading1-3/bullet/numbered/todo/quote/callout/divider/code/image/table/toggle）；纯 TS
      零 electron/零 IO；table 用 GFM 管道表 + 单元格转义 `|`→`\|`、换行→`<br>`；code 用
      ```` ```lang ```` fence（lang 消费端首次落地）；callout/toggle 方言见 §0-①。
- [x] **B** `page:export:preview|confirm|reveal` 三通道（`main/pageExport.ts`，不 import
      electron）：scope single/subtree + 子树目录层级 + `files/` 附件**拷贝** + 图片内链改写为
      相对路径 + 孤儿 file_id 占位注释并计入预览；**预览（只读）→ 用户确认（选目录）→ 落盘**，
      目录选择取消 = 零落盘；对库/媒体**全只读**（只有 `all()` 读 + `readFile` 源）。
- [x] **C** 侧栏页面行菜单「导出为 Markdown…」（`page-export-menu`）+ 导出对话框
      （`page-export-scope`/`page-export-single`/`page-export-subtree`/`page-export-confirm`，
      内含只读文件清单预览）+ 完成 toast（`page-export-toast`）；reveal 走新 IPC
      `page:export:reveal` → `shell.openPath`（**非** openExternal，见 §0-④）。
- [x] **D** i18n `pageExport.*` zh/en 成对（10 键）；禁「数据库」词零回归。
- [x] roundtrip 双向 14 块型各 ≥1 例（importer 40 例）+ 附件 tmp 夹具测 + scope 纯函数测 +
      IPC 取消不落盘测（desktop 11 例）+ 装配层 UI 7 例 + editor 方言 9 例。
- [x] testid 契约 5 名挂齐（`page-export-menu` / `page-export-scope` / `page-export-single` /
      `page-export-subtree` / `page-export-confirm` / `page-export-toast`）＝ 6 名，齐备。

## §2 用例计数

| 工程 | 基线 | 本单后 | 增量 |
|---|---|---|---|
| apps/desktop（门禁②） | 1111 / 102 files | **1129 / 104 files** | +18 / +2 files |
| packages/editor（门禁③近邻） | 254 / 14 files | **263 / 15 files** | +9 / +1 file |
| packages/ui（门禁③） | 168 | 168 | 0 |
| packages/importer | 59 / 4 files | **99 / 5 files** | +40 / +1 file |
| packages/core / schema / platform / dbview / sync | 51 / 5 / 41+1skip / 122 / 109 | 同左 | 0（op-log 零新增硬证据） |

新增用例清单：
- `apps/desktop/test/page-export.test.ts`（11）：scope 纯函数（sanitize/collectSubtree）、IPC 注册
  （service=null → E_INVARIANT）、preview 只读零落盘、confirm 写 md+拷附件+孤儿占位、**源媒体与
  op_ledger 零变化**、**目录取消 = 零落盘**、subtree 子页 `../files` 前缀、单页仅本页、
  reveal E_MALFORMED、E_NOT_FOUND。
- `apps/desktop/test/t79-page-export-ui.test.tsx`（7）：菜单项 testid、无子页无 scope 选项、
  预览列文件名、有子页 scope→confirm(subtree)、成功 toast+reveal、取消 info、失败 danger、i18n en。
- `packages/importer/test/serialize.test.ts`（40）：14 块型 serialize→parse 与 parse→serialize
  双向 deep-equal、特殊字符、table 转义、code 围栏特殊字符、toggle 空行、孤儿占位、组合文档、
  无损边界钉死（空块/colWidths/单行 header=false/组合强调）。
- `packages/editor/test/t79-markdown-dialect.test.ts`（9）：callout / toggle 解析与反投影、
  普通 quote 边界、table 转义反解、既有口径不回归。

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| D-1 | callout/toggle 解析器原无语法 ⇒ 双向 roundtrip 结构不可达 | 在 `editor/rules/markdownPaste.ts` **窄口新增**两条自家方言（`> [!<icon>] ` / `> [!toggle] `），只加识别分支、不动既有分支 | 任务书 §0-① 要求「序列化器必须产出解析器吃得回的方言」；方言当天新增，真实世界 md 无此串 ⇒ 导入既有行为零改动（editor 254→263、importer 59 全绿）。副作用：`> [!NOTE]` 形态的 GitHub-alert md 现会被读成 icon='NOTE' 的 callout（接受）。**待追认** |
| D-2 | testid 契约 `page-export-toast` 需在 toast 上挂属性，但 `ToastItem` 无此字段 | `@septcats/ui` Toast **加可选 `testId`**（2 行，渲染为 `data-testid`） | 免改 renderer 侧另造 toast 外壳；可选属性，既有用法/用例零改动（ui 168 不变）。**待追认** |
| D-3 | PRD §1B 允许「打包 zip 或落目录」二选一 | 选 **落目录** | ① 与 reveal/文件管理器交互天然契合（zip 需先解包）；② 零新增依赖、零自写归档器（diag 非 zip；fflate 无 zipSync 先例）；③ 子树层级 + `files/` 本需目录。**待追认** |
| D-4 | PRD 未指定子树目录层级确切形态 | 布局 = `scope 根 = <title>.md`；非根页 = `<父目录>/<title>/<title>.md`（如 `<pkg>/子页/子页.md`），每页自拥同名目录 | 无歧义、层级可见、附件相对前缀可按深度计算。注：importer 的 md-dir `parentPath` 反解本就不重建嵌套（既有行为，不在本单范围）。**待追认** |
| D-5 | 「打开所在目录」的通道 | 新 IPC `page:export:reveal` → `shell.openPath(dir)`（仅接受存在且为目录者）；导出成功后**自动** reveal | `file://` 不在 `shell:openExternal` 白名单（http/https only）⇒ 禁走 openExternal；`shell.openPath` 不经 URL 协议白名单，合规。自动打开为 PRD「导出完成 toast + 打开所在目录」的字面兑现。**待追认** |
| D-6 | 「预览文件名」的 UI 呈现 | 导出对话框**恒开**（单页也开），内含只读文件清单预览；scope 选项仅在该页有活子页时出现 | 对齐 PRD「预览文件名→用户确认→写盘，禁静默写盘」：任何导出都先预览、再确认。**待追认** |
| D-7 | 无法用自家方言无损表达的轴 | 记 §0-⑤，测试钉死降级口径（不静默）：colWidths、code `wrap`、image `width`、image 空 caption、numbered `start`、单行 header=false 表格、组合强调、md 控制符字面量、空文本块 | 解析器无对应语法/转义反解；宁钉死降级也不造第二套解析器。**待追认** |
| D-8 | 序列化器消费的 image 形态 | 采用 importer canonical `{src:'asset://<hash><ext>', name}`（解析器真实产物）；DB 编辑器形态 `{file_id,caption,width}` 在 main 出口适配（src=asset://file_id+磁盘ext、name=caption） | 使 `parse→serialize` 无需形状适配器（roundtrip 干净 deep-equal）；适配住在 IO 边界，序列化器保持纯。**待追认** |

## §4 文件改动清单

**新增**
| 文件 | 说明 |
|---|---|
| `packages/importer/src/serialize.ts` | blocks→Markdown 序列化器（14 块型；纯 TS 零 electron/零 IO；`blocksToMarkdown(blocks, {resolveAsset})`） |
| `packages/importer/test/serialize.test.ts` | 40 例双向 roundtrip + 特殊字符 + 边界 |
| `packages/editor/test/t79-markdown-dialect.test.ts` | 9 例方言（callout/toggle/table 转义） |
| `apps/desktop/src/shared/pageExport.ts` | 导出契约纯类型（单一来源，renderer 直引，不引 node:fs） |
| `apps/desktop/src/main/pageExport.ts` | 导出服务（preview/confirm/reveal）+ IPC 注册 + 纯函数（sanitizeFileName/collectSubtree/blockSpecOfRow） |
| `apps/desktop/src/renderer/src/pages/PageExportDialog.tsx` | scope 对话框 + 只读预览清单 |
| `apps/desktop/test/page-export.test.ts` | 11 例（真库 + tmp 附件夹具） |
| `apps/desktop/test/t79-page-export-ui.test.tsx` | 7 例装配层 |

**修改**
| 文件 | 改动 |
|---|---|
| `packages/importer/src/index.ts` | re-export `./serialize` |
| `packages/editor/src/rules/markdownPaste.ts` | 新增 CALLOUT 正则与 callout/toggle 分支（+顶部注释） |
| `packages/editor/src/content.ts` | `splitTableCells` 反解 `\|`→`|`、`<br>`→换行 |
| `packages/ui/src/Toast.tsx` | `ToastItem.testId?` + 渲染 `data-testid` |
| `apps/desktop/src/shared/ipc.ts` | `PAGE_EXPORT_CHANNELS`（preview/confirm/reveal） |
| `apps/desktop/src/main/index.ts` | 造 pageExport 服务（DI dialog/openPath）+ 注册三通道 |
| `apps/desktop/src/preload/index.ts` | `pageExport.*` 三方法 |
| `apps/desktop/src/types/window.d.ts` | `SeptcatsPageExportApi` + `SeptcatsApi.pageExport` |
| `apps/desktop/src/renderer/src/state/pages.ts` | `exportDialog` 状态 + `openPageExport/closePageExport/loadPageExportPreview/runPageExport`；`pushToast` 加 `testId?` |
| `apps/desktop/src/renderer/src/pages/SidebarTree.tsx` | 行菜单加「导出为 Markdown…」（`page-export-menu`） |
| `apps/desktop/src/renderer/src/App.tsx` | 挂 `<PageExportDialog />` |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` / `en-US.ts` | `pageExport` 10 键（成对） |
| `apps/desktop/test/pages-store.test.ts` | 状态字面量补 `exportDialog: null` |

**未触碰**：`packages/core/**`、`packages/schema/**`、`packages/dbview/**`、`packages/sync/**`、
`packages/platform/**`、`main/blocks.ts`、`main/commit.ts`、`main/pages.ts`、`main/dbview.ts`、
`main/links.ts`（op-log / 语句白名单 / 表结构零改动）；`package.json` 未动（零新增依赖）。

## §5 红线自检

- [x] **op-log 零新增**：本单只 `all()` 读 + 文件读；`main/commit.ts`/`blocks.ts` 零改动；硬证据 =
      sync 109 / dbview 122 / core 51 **零修改全绿**（§6 附 B）
- [x] **不建表不加依赖**：零 SQL DDL、零 `package.json` 变更（表单中「媒体」实为内容寻址目录，
      无 media 表可用可建）；zip 选型记 §0-②（落目录，零新增归档能力）
- [x] **菜单/对话框全 token**：对话框内联样式只用 `var(--sc-space-*)`（无 hex/裸 px）；
      no-magic ✓（renderer CSS 亦在扫描面，本单未新增 CSS 文件）
- [x] **媒体库只读**：导出 = `readFileSync` 源 → 写包内 `files/`（拷贝非移动）；测断言源目录
      与 `op_ledger` 导出前后零变化
- [x] **T78 多选/手柄链零破坏**：BlockControls/PageView 零改动；desktop `t78-bulk-selection.test.tsx`、
      editor `t78-selection.test.ts` / `t78-block-bulk-menu.test.tsx` 全绿（仅行菜单**加一项**）
- [x] **禁「数据库」词零回归**（i18n 门禁⑥通过）；**无省略号占位**（新代码 `...` 均为 JS 展开，
      人工核对）；`…` 仅出现在 i18n 的「导出为 Markdown…」菜单标签（UI 约定，非占位）
- [x] **启动零外联**：无网络调用；`shell.openPath` 仅用户点导出后触发
- [x] 显性不做未越界：HTML/PDF/便携包/加密导出/Notion 格式导出/附件去重 全未涉及

## §6 门禁原始输出

### ① typecheck（`pnpm -r --no-bail run typecheck`）

```
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done
```

tsc 错误数 = **0**（基线 0）。

### ② desktop vitest（`pnpm --filter @septcats/desktop test`）

```
 Test Files  104 passed (104)
      Tests  1129 passed (1129)
   Duration  29.23s
```

delta：1111 → **1129**（+18，只增不减）。

### ③ editor vitest（`pnpm --filter @septcats/editor test`）

```
 Test Files  15 passed (15)
      Tests  263 passed (263)
   Duration  3.00s
```

delta：254 → **263**（+9）。

### ④ ui vitest（`pnpm --filter @septcats/ui test`）

```
 Test Files  33 passed (33)
      Tests  168 passed (168)
   Duration  4.43s
```

delta：168 → 168（0；Toast 加可选属性，无新增用例）。

### ⑤ no-magic（`node packages/ui/tokens/no-magic.mjs`）

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

违规数 = **0**（基线 0，只增不减）。

### 附 A：importer 包（roundtrip 主战场）

```
 Test Files  5 passed (5)
      Tests  99 passed (99)
   Duration  948ms
```

delta：59 → **99**（+40）。

### 附 B：op-log 零改动硬证据

```
（core）    Test Files  9 passed (9)     Tests   51 passed (51)
（schema）  Test Files  1 passed (1)     Tests    5 passed (5)
（platform）Test Files  4 passed (4)     Tests   41 passed | 1 skipped (42)
（dbview）  Test Files  5 passed (5)     Tests  122 passed (122)
（sync）    Test Files 11 passed (11)    Tests  109 passed (109)
```

## §7 PM 真机核验（待 PM）

- 建含全块型 + 图片的页 → 侧栏行「⋯」→「导出为 Markdown…」→（有子页时选 scope）→
  对话框预览 → 确认 → 选目录 → 验包内 md 内容与 `files/` 附件在场 → 导出物再走导入器
  反向 parse 回块（三方闭环：编辑器→md→解析器）。
- 探针锚点：`page-export-menu` / `page-export-scope` / `page-export-single` /
  `page-export-subtree` / `page-export-confirm` / `page-export-toast` / `page-export-preview`。
- 未覆盖（留 PM 真机）：系统目录对话框真实取消路径、`shell.openPath` 打开文件管理器、
  真实媒体库大附件拷贝性能。
