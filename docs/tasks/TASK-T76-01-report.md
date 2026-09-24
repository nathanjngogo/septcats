# T76-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T76-01.md` · PRD：`docs/PRD-R25-内容块扩展.md`

## §0 开工侦察结论（先写这节再动工）

### ① 块 content 存储形态（样例块 + 字段风格）

**存储链**：`Block.content`（editor 真相层形状，`packages/editor/src/model.ts:124`）
→ 反投影 `blockPayload()` → op payload → core `blockSchema.content = payloadSchema`
（`packages/core/src/op.ts:145`，宽 `record<string, unknown>`）→ 物化层/段文件。
**结论：content 只要是 JSON 对象，全链路（op 校验 / stableStringify / diff / 同步 / 导入导出）天然兼容**，
`targetTable='block'` 一字不动。

**现有 content 三形态**（`model.ts:124`）与样例块：

| 形态 | 样例块 | 真相层 content | PM 节点 |
|---|---|---|---|
| PM doc（恰好一个 paragraph 包裹内联） | paragraph / heading / ul / ol / to_do / quote(+icon=callout) | `{type:'doc',content:[{type:'paragraph',…}]}` | `paragraph`/`heading`/… |
| 纯文本 string | code | `"const a = 1;"` | `codeBlock`（`text*`，节点名在投影边界改名） |
| null | divider / image | `null` | `divider`(atom) / `image`(atom) |

**字段风格**：实体字段全 snake_case（`page_id`/`sort_key`/`last_edited`）；
块内 props/content 键为短名（`lang`/`file_id`/`caption`/`width`/`checked`/`level`/`start`/`icon`）。

**本单定名**（一次定死，全链路一致，禁混用）：直接采用 PRD §2A 的字段名
`{ rows: string[][], header: boolean, colWidths?: number[] }`；toggle 为
`{ title: string, body: string[] }`。PM 侧 attr 名与 content 字段名**逐字同构**
（`rows`/`header`/`colWidths`、`title`/`body`）——零映射，`blockToPMNode`/
`semanticsOf` 两侧可直接对拷（与 code 的「PM 侧 text* ↔ 真相层 string」同一手法：
**PM 内容形态可变，真相层 content 语义不可动**）。

### ② 块模型父子原语有无 → toggle 选型

**有字段，无原语**（三条实证）：

1. **投影面是硬扁平**：`Block` 有 `parent_id`（`model.ts:138`）与 `sort_key`，
   但 PM schema 里**每个块节点都是 `group:'block'`、doc = `block+`，没有任何节点接受块级子内容**
   （`packages/editor/src/types/*.ts` 全员如此）——容器投影在当前 schema 下无法表达。
2. **没有任何代码路径写非 null 的块 parent_id**：`pmDocToBlocks` 只做
   `parent_id: old.parent_id ?? null`（`model.ts:523`）继承；app 层从不设置；`blocks.ts` 忽略该字段；
   全仓无「块 re-parent」的 op 或命令。
3. **仓内的父子级联机制是页面专属**：`tree.ts` 的 `childrenIndex`/`collectDescendants`/
   `rebalanceLayer`/`TreeCycleError` 全部吃 `PageNode[]`（`tree.ts:42` 起），与 block 无关。

⇒ **选型：单块自包含**（toggle = 「标题 + 多行正文」单块，content=`{title,body}`，
PM 侧一个 atom 节点 + 内置控件）。**不造第三态**：不做 `parent_id` 容器路径，
故任务书 §7 括注的「（若容器路径）Enter 拆子块 / Backspace 空子块收会父级」本单不适用，
由单块自身的「正文行为空行增删」承担同类手感（详见 §3 DEVIATION-3 口径登记）。

### ③ SlashMenu / 输入规则 / markdownPaste 接线位

- **斜杠菜单**：纯状态机在 `packages/editor/src/rules/slashMenu.ts`
  （`SLASH_KEYWORDS: Record<BlockType, readonly string[]>` 第 21 行 + `SLASH_ITEMS` 第 45 行），
  UI 在 `packages/editor/src/react/SlashMenu.tsx`（按钮现带 `data-command-id={item.id}`，
  **无 `slash-item-*` 命名先例**——本单按任务书 §10 逐字新增 `data-testid="slash-item-<id>"`）。
  插入落点在 `apps/desktop/src/renderer/src/pages/PageView.tsx`
  `handleSlashSelect`（第 836 行）→ `applyBlockType`（第 691 行）：
  原子块（`nodeType.spec.content === undefined`）走 `replaceWith(…, nodeType.create(attrs))`，
  attrs 由旧段落 `{...node.attrs}` 透传（**保留 `id`**）→ 本单两个新块都设计成 atom 节点，
  **默认 3×3 / 默认收起即由节点 attr 默认值天然承载，PageView 零新增分支**。
- **输入规则**：纯判定 `matchInputRule(textBeforeCursor, composing)`
  （`rules/inputRules.ts:36`）+ 执行器 `createInputRulesPlugin`（第 134 行，现只有
  `handleTextInput` / composition flag）。`|a|b|`+Enter 属 **Enter 键**（非文本输入），
  `handleTextInput` 结构上吃不到 → 本单在既有插件上**加挂 `handleKeyDown`**（复用
  `isTextblock` + `RULE_EXEMPT_TYPES` 同一口径）。砍/做的判定见 §1。
- **markdownPaste**：纯函数 `parseMarkdown(text) → PMDocJSON`（`rules/markdownPaste.ts:120`），
  行级 `for (const line of lines)` 主循环（第 126 行）即表格块解析的插入点。
  **注意**：该函数仓库内**只被测试引用**，无运行时 `handlePaste` 消费方
  （grep 实证：`parseMarkdown` 仅出现在 editor 包自身与测试；apps 的
  `manual/markdown.ts` 是同名不同物）→ 本单补一个**窄口** `handlePaste` 插件，
  仅当剪贴板纯文本整体是 markdown 表格时才接管（其余情况返回 false，PM 默认粘贴行为零变化）。

**基线核对**：`main` HEAD = `22425c8`（含 PRD-R25 + 本任务书 + 报告骨架），PRD 基线 `639f615` 已在其祖先链上。
两条块白名单**都在**且都要动：`packages/schema/src/index.ts:20`（14 型）与
`packages/editor/src/model.ts:24`（9 型 + `KNOWN_BLOCK_TYPES`），另有
`packages/editor/test/fixtures/blocks.ts:213` 把 `'toggle'` 当**未知块样例**、
`packages/editor/test/blocks.test.ts:140` 把 `{type:'toggle'}` 当**未知节点样例**——
toggle 转正后这两处必须换样例（见 §3 DEVIATION-1）。

## §1 交付概览（DoD 自检）

- [x] A 表格块：schema 白名单+斜杠插入（默认 3×3）+单元格编辑+加删行列+表头开关+列宽拖拽
- [x] 输入规则 `|a|b|` + Enter（**做了**，见 §3 D-2 的边界口径与 D-4 的执行通道）
- [x] B 折叠列表：按 §0-② 选型为**单块自包含** + 斜杠入口 + ▶ 旋转 + 默认收起
- [x] markdown 粘贴表格转换（`parseMarkdown` 扩表 + 窄口 `handlePaste` 接线，功能真可达）
- [x] i18n 成对（`editor.table` / `editor.toggle` 两域 zh+en）+ 禁词纪律零回归
- [x] t76-* 单测 48 例 + schema 白名单门禁测更新（+2 例）
- [x] testid 清单挂齐（任务书 §10 逐字对齐，见下表）

**testid 对照（任务书 §10 → 实现）**

| 任务书要求 | 实现位置 | 备注 |
|---|---|---|
| `block-table-add-row` | table.ts `bar`「添加行」 | 像素钮（`sc-table__pixbtn`） |
| `block-table-add-col` | table.ts `bar`「添加列」 | 同上 |
| `block-table-del-row-<i>` | 每行行柄（`i` = 行下标 0 基） | hover 显形，键盘可聚焦 |
| `block-table-del-col-<j>` | 列柄行（`j` = 列下标 0 基） | 同上 |
| `block-table-header-toggle` | table.ts `bar`「表头」 | 带 `aria-pressed` |
| `block-toggle-<blockId>` | toggle.ts 展开钮 | `blockId` = 块 `attrs.id`，随 id 回写同步 |
| `slash-item-table` | SlashMenu.tsx（本轮新增 `slash-item-<id>` 契约） | 全项通用，非 table 专属 |
| `slash-item-toggle` | 同上 | |

**另挂（超出最低要求，供探针用）**：`septcats-block-table`（表根）、`septcats-block-toggle`（折叠根）、
`block-table-cell-<i>-<j>`（单元格）、`block-toggle-title`、`block-toggle-line-<i>`。

## §2 用例计数

| 工程 | 基线（main `22425c8`） | 本单 | 增减 |
|---|---|---|---|
| `apps/desktop`（门禁②） | 1046 passed / 98 files | **1094 passed / 100 files** | +48 / +2 files（只增不减） |
| `packages/editor` | 200 passed | **205 passed** | +5 |
| `packages/schema` | 3 passed | **5 passed** | +2（白名单门禁） |
| `packages/ui`（门禁③） | 168 passed | **168 passed** | 0 |
| `packages/importer` | 59 passed | 59 passed | 0（零改动口径已由该套件自证） |
| `packages/core` / `dbview` / `sync` / `platform` | 51 / 122 / 109 / 41+1skip | 51 / 122 / 109 / 41+1skip | 0 |

新增用例清单：

- `apps/desktop/test/t76-content-blocks.test.ts`（27 例）：① 表格/折叠 content 序列化往返（含 op payload JSON 往返、
  新建节点 → 规范 3×3、归一化边界）；② 加删行列 / 表头 / 单元格 / 列宽算子（含夹紧与不可变）；③ markdown 表格
  解析（GFM 全表、端到端 `pmDocToBlockSpecs`、混排、不规则行、**导入链隔离**、窄口判据）；④ 输入规则简写；
  白名单（编辑器侧 11 型）。
- `apps/desktop/test/t76-blocks-ui.test.tsx`（21 例）：装载/testid 契约、退化 rows → 3×3、加/删行、加/删列、
  表头开关、单元格写入（恰一次 onChange）、Tab/Shift+Tab 移焦 + 末格 Tab 补行、表内按键不外泄、列宽拖拽
  （含微小位移不产事务、负位移夹下限）、折叠两态（**零事务**）、标题/正文编辑与 Enter 增行 / 空行 Backspace 删行、
  斜杠项 testid 与中文/拼音查询、markdown 粘贴两例（吃/不吃窄口）、Yjs 结构化 attrs 存活、
  PageView 端到端（`/` → 选「表格」→ DOM 出表格块且 **data-id 保留原块 id** → commit 落 `type=table`）。
- `packages/editor/test/blocks.test.ts`（+3）：table/toggle 的 `attrs → content` 反投影同口径；
  未知块样例改用 `embed`。
- `packages/schema/test/schema.test.ts`（+2）：白名单 16 型逐字清单 + op 目标表不变。
- `packages/editor/test/fixtures/blocks.ts`（+4 fixture）：table / table+colWidths / toggle / unknown(embed)。

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| D-1 | editor 测试的「未知块/未知节点」样例原用 `toggle`（`fixtures/blocks.ts` 的 `unknown(toggle)` 与 `blocks.test.ts` 的 `{type:'toggle'}`）——toggle 转正后不再是未知块，原 roundtrip 期望（投影成 paragraph）不再成立 | 样例改名为 `unknown(embed)` / `{type:'embed'}`（类型与 props 换成真未知形态），**断言口径一条不改** | 保持「未知块降级」覆盖不失效；改数据不改语义 |
| D-2 | `parseMarkdown` 同时是 **M12 导入链**的正向解析器（`packages/importer/src/markdown.ts:194` 调 `pmDocBlockSpecs(parseMarkdown(...))`）。若表格归组对孤立单行 `\| a \| b \|` 也放行，导入普通正文里的竖线行会被改判成表格 | `parseMarkdown` 归组门槛收紧为「**≥2 行 pipe 行，或第 2 行是分隔行**」；编辑器内**粘贴**整段 `\| a \| b \|` 仍转表（窄口 `handlePaste` 单独承接，用户显式动作、不经导入链） | 「导入导出零改动」是红线；粘贴侧的要求（任务书 §A.4）另路满足。两侧各有一例测试钉死（`t76-content-blocks.test.ts` 的「导入链隔离」与「粘贴窄口判据」） |
| D-3 | `packages/importer/src/types.ts` 的 `blockSpecSchema.content` 联合类型只认 3 形态，editor 扩到 5 后全仓 typecheck 红 | 该联合同步加入 table/toggle 两个 zod schema（**types-only 放宽接受面**），并加注释说明 importer 不产出这两型 | typecheck 0 是门禁；`BlockSpec` 同构是两包既有契约。importer 行为零改动由其 59 例自证（GFM 表格仍降级 code + warning） |
| D-4 | 两个新块的**载体形态**：本包依赖白名单只有 `@tiptap/core` + `@tiptap/pm`（无 `@tiptap/react`、无第三方 UI 库、红线不加依赖），且 PRD §2A 钉死「单块自包含、不做嵌套子块」 | 取 **atom 节点 + 原生 DOM NodeView**：结构化 content 进 PM attrs（键名与 content 逐字同名），内置控件用原生 `input/button`；单元格按「焦点语义」实现（任务书 §A.2 的 Tab/Shift+Tab **移焦**原文），不引 PM 行内光标；列宽拖拽用 mouse 事件（jsdom 无 PointerEvent，与 T61-01 同款口径） | 不新增依赖、不造嵌套事件流；代价（表内不参与内联 mark/每次输入一格一事务）已在 §5 口径登记 |
| D-5 | 任务书 §7 括注「（**若容器路径**）Enter 拆子块、Backspace 空子块收会父级」 | 本单走单块路径（§0-② 结论），该括注**不适用**；以单块内的「正文行 Enter 增行 / 空行 Backspace 删行」承接同类手感（有测试） | 二选一禁第三态：容器路径需 PM 嵌套 schema 重建，与「单块自包含」冲突 |
| D-6 | 列宽拖拽**无键盘等价路径**（只有列柄鼠标拖拽）；行/列柄按钮本身键盘可达（`:focus-visible` 显形） | 保留：键盘用户仍可加/删行列与切换表头（三键都是 `<button>`），仅「像素级宽度微调」是鼠标专属 | 与 T61-01 两侧拖拽把手（`role=separator` + 指针）同口径；做键盘宽度调节需要新 token 与新交互面，超一期 |
| D-7 | Yjs `attach` 时 stderr 出现一行 PM 告警 `TextSelection endpoint not pointing into a node with inline content (doc)` | **未修、判定为既有行为**：现场用 v1 就在册的 `divider` 做首块可复现同一条（临时探针实测后删除）；本单只在测试里加注释说明，不去改 `yjs.ts` 的整文档替换选区映射 | 触发条件是「文档首块是原子块」，与块型无关；修它属于协作层选区映射，超出本单范围 |
| D-8 | 表格/折叠块**不解析跨应用 HTML**（`parseHTML()` 返回空规则）：外部 `<table>` HTML 粘进来不产表格块 | 保留。复制**出**可用（`renderHTML` 输出真 `<table>`/标题+正文行） | PRD 只要求 `text/plain` markdown 管道；atom 叶子节点从 DOM 子结构回填 attrs 的解析路径易碎（PM 对叶子节点的子内容解析有歧义），不做不可靠路径 |
| D-9 | `apps/desktop/test/pageview-blocks-ui.test.tsx` 的「斜杠菜单项数 11」断言 | 改为 13（+表格 +折叠列表），并注明构成 | 菜单多两项的必然结果，**不是放宽断言**（该用例其余断言一条未动） |
| D-10 | `editorBlockLabels` 在 PageView 里**每帧现算**（不 useMemo），且文案热度只在编辑器实例重建（换页）时生效 | 保留 | 与 `doc`/`wikilinkHost` 同口径：Editor 的编辑器实例只建一次，文案属构造期输入；用 ref 取最新值避免陈旧闭包 |
| D-11 | 斜杠菜单的 label/hint 仍是 editor 包内的中文字面量（与既有 11 项一致）；T76 新增的**控件可访问名**才走 app i18n 注入 | 保留：新块在菜单里显示「表格 / 折叠列表」中文（同族一致），其内置控件的按钮名/占位从 `blockLabels` 注入（zh/en 成对） | editor 包在 apps 的 i18n 扫描面之外（既有事实）；单为两项改整条菜单的文案来源会牵动 11 项与 3 处测试，收益为负 |
| D-12 | `docs/perf-history.jsonl` 出现改动 | 不处理、不回复 | 该文件由 `perf.test.ts` 每次运行自动追加基线（跑门禁就会变），非本单产物 |

## §4 文件改动清单

**新增（6）**

| 文件 | 作用 |
|---|---|
| `packages/editor/src/content.ts` | table/toggle 的 content schema、类型、归一化与全部纯算子（加删行列/表头/列宽/单元格/正文行）+ markdown 表格解析与简写判定 |
| `packages/editor/src/types/table.ts` | `table` Tiptap atom 节点 + 原生 DOM NodeView（工具条/行列表头柄/列宽柄/Tab 移焦/stopEvent 三道事件围栏） |
| `packages/editor/src/types/toggle.ts` | `toggle` Tiptap atom 节点 + NodeView（▶ 旋钮、标题、正文行；展开态闭包持有） |
| `packages/editor/src/types/blockLabels.ts` | 新块内置控件的文案注入契约（默认中文 + `mergeBlockLabels`） |
| `apps/desktop/test/t76-content-blocks.test.ts` | 数据面 27 例 |
| `apps/desktop/test/t76-blocks-ui.test.tsx` | 视图/交互面 21 例 |

**修改（20）**

| 文件 | 改动 |
|---|---|
| `packages/schema/src/index.ts` | `blockTypes` +table/toggle（14 → 16），加 R25 注释 |
| `packages/schema/test/schema.test.ts` | +2 例：16 型逐字清单 / op 目标表不变 |
| `packages/editor/src/model.ts` | `BLOCK_TYPES` +2；`blockContentSchema` 扩结构化两形态；`isPmDocContent` 类型收窄 + `inlineNodes` 收窄；`blockToPMNode` / `semanticsOf` 各加 table/toggle 两 case；顶部归一化约定补记 |
| `packages/editor/src/blocks.ts` | `semanticsOf` 同步加两 case（与 model 同口径，normalize 同一份） |
| `packages/editor/src/index.ts` | `export * from './content'` |
| `packages/editor/src/types/index.ts` | `BASE_BLOCK_NODES` 拆出；`editorExtensions(options)` 按 `blockLabels` configure 两个新节点；`EditorExtensionOptions` |
| `packages/editor/src/rules/slashMenu.ts` | 关键词表 +table/toggle；`SLASH_ITEMS` +2 项（标签「表格」「折叠列表」） |
| `packages/editor/src/rules/inputRules.ts` | +`applyTableEnterRule`/`isPlainEnter`；插件加 `handleKeyDown`（Enter 通道） |
| `packages/editor/src/rules/markdownPaste.ts` | `parseMarkdown` 加表格块归组（门槛见 D-2）+ `createMarkdownTablePastePlugin` 窄口 |
| `packages/editor/src/react/SlashMenu.tsx` | 斜杠项加 `data-testid="slash-item-<id>"` |
| `packages/editor/src/react/Editor.tsx` | +`blockLabels` prop（ref 热更新、构造期读）；注册 md 表格粘贴插件 |
| `packages/editor/src/react/editor.css` | +表格/折叠块样式（token-only：外框 2px ink-edge、网格线 1px ink-edge、像素钮 flat/out/in、hover 柄、`--open` 旋转、`[hidden]` 显式 display:none、选中像素影） |
| `packages/editor/test/fixtures/blocks.ts` | +4 fixture（table / table+colWidths / toggle / unknown(embed)）；未知样例改名；`demoBlockDoc` 过滤口径同步 |
| `packages/editor/test/blocks.test.ts` | 未知节点样例 `toggle` → `embed`；+3 例（table/toggle 反投影）；describe 计数口径 14 → 16 |
| `packages/editor/test/model.test.ts` | describe 口径（9 块型 → 含 R25 的块型） |
| `packages/importer/src/types.ts` | `blockSpecSchema.content` 联合 +table/toggle（types-only，见 D-3） |
| `apps/desktop/src/renderer/src/pages/PageView.tsx` | 组装 `editorBlockLabels`（t() 取文案）并传给 `<Editor blockLabels>` |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | +`editor.table`（8 键）/ `editor.toggle`（3 键） |
| `apps/desktop/src/renderer/src/i18n/en-US.ts` | 同上成对 11 键 |
| `apps/desktop/test/pageview-blocks-ui.test.tsx` | 斜杠项计数 11 → 13（D-9） |

## §5 红线自检

- [x] **表格网格线=ink-edge 像素口径**：`.sc-table` 外框 `2px solid var(--sc-color-ink-edge)`（与 code 块同档）、
      单元格网格线 `1px solid var(--sc-color-ink-edge)`（与块内分隔线同档）；零灰线、零裸 px 决策值
      （仅 `1px/2px` 发丝级豁免档）、零字面 hex；`no-magic` 通过（见 §6）。
- [x] **浮层/按钮吃既有 token**：工具条三键 = `--sc-pixel-flat` → hover `--sc-pixel-out` → active `--sc-bevel-in`
      （与 `wb-pixbtn` 同风格口径），底色 `--sc-color-surface-raised` / `--sc-color-surface-active`。
- [x] **展开态不入 content（纯视图态）**：`open` 只存 NodeView 闭包，折叠块 content 恒为 `{title, body}`；
      单测双钉——点箭头前后 `onChange` **零调用**，且 `normalizeToggleContent({...,open:true})` 只吐 title/body。
- [x] **同步/导入导出零改动**：`targetTable` 唯一来源 `BLOCK_TARGET_TABLE='block'` 未动（schema 测新增断言）；
      op/段文件/快照格式零变更；导入链只加了一条「不许把孤立竖线行改判成表格」的门槛并加了钉死用例（D-2）；
      importer 全套 59 例绿。
- [x] **不建表、不加依赖**：`package.json` 零改动；无新 SQL 表/迁移（`packages/schema` 的改动是**块类型常量**不是库表）。
- [x] **禁「数据库」词**：新文案全部「表格 / 折叠列表 / 多维数据」口径；i18n 门禁⑥（zh 值不含旧称）在
      desktop 全量里跑绿；新 i18n 键无 `…`、无占位缩写。
- [x] **无省略号占位常量**：新增 6 文件的字符串字面量零 `…`（grep 实证）；`blockLabels` 默认值全为完整文案。
- [x] **testid 逐字对齐**：见 §1 对照表（8 项全中，另加 5 项）。
- [x] **中文 i18n 成对**：`editor.table.*` / `editor.toggle.*` 两域 zh+en 各 11 键（门禁①键集合等价绿）。
- [x] **启动零外联**：未触碰网络/更新/遥测任何代码路径。
- [x] **显性不做清单未越界**：无数组合并、无表格嵌套块、无行级 undo/历史（表格的行列操作都是同一块的
      content 事务，走 PM/Yjs 既有撤销栈）；无公式块、无多维数据联动、无移动端形态。

## §6 门禁原始输出

### ① typecheck（`pnpm -r --no-bail run typecheck`）

```
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done
```

### ② desktop vitest 全量（`pnpm --filter @septcats/desktop test`）

```
 ✓ test/t76-content-blocks.test.ts (27 tests) 14ms
 ✓ test/t76-blocks-ui.test.tsx (21 tests) 876ms
 Test Files  100 passed (100)
      Tests  1094 passed (1094)
   Duration  29.36s (transform 4.16s, setup 0ms, collect 46.02s, tests 100.53s, environment 37.85s, prepare 14.24s)
```

（基线 `22425c8`：`Test Files 98 passed (98)` / `Tests 1046 passed (1046)`——只增不减。）

### ③ ui vitest（`pnpm --filter @septcats/ui test`）

```
 Test Files  33 passed (33)
      Tests  168 passed (168)
   Duration  4.81s (transform 1.09s, setup 7.56s, collect 2.66s, tests 2.94s, environment 25.19s, prepare 5.32s)
```

### ④ no-magic（`pnpm --filter @septcats/ui run lint:magic`）

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### 附：其余包 vitest（回归面）

```
packages/editor      Test Files  11 passed (11)   Tests  205 passed (205)
packages/schema      Test Files   1 passed (1)    Tests    5 passed (5)
packages/importer    Test Files   4 passed (4)    Tests   59 passed (59)
packages/core        Test Files   9 passed (9)    Tests   51 passed (51)
packages/dbview      Test Files   5 passed (5)    Tests  122 passed (122)
packages/sync        Test Files  11 passed (11)   Tests  109 passed (109)
packages/platform    Test Files   4 passed (4)    Tests   41 passed | 1 skipped (42)
```

## §7 PM 真机待验（超出 jsdom 能力面，**未跑**）

- `cdp-e2e-t76-01.mjs`：插入 → 单元格键入（真 IME）→ 加删行列 → 折叠 → 重启持久化 → 同步段可导出；
- 列宽拖拽的真像素观感与网格线档位（jsdom 无量测，本单只钉了 content 落库与 grid 模板字符串）；
- frame-check `--packed G4` 描边抽检覆盖表格块；
- 表格块 hover 时行/列柄的显形时机（`opacity` 过渡在 jsdom 不可见）。


## §8 PM 真机核验 + 门禁复跑（09-24）

**PM 复跑门禁（不轻信自报，原始输出）**：typecheck **0** / desktop vitest **1094 passed (100 files)**（基线 1046/98 → +48/+2，只增不减 ✓）/ ui **168** / no-magic **✓**；全仓 `pnpm -r test` 逐包核：core 51 / editor 205 / schema 5 / sync 109 / dbview 122 / importer 59 / platform 41+1skip——**importer 59 零改动口径成立**（D-3 自证可信）。

**红线扫描**：省略号占位符——T76 新增文件仅 `rules/slashMenu.ts` 命中，甄别为 UI 文案「表格 · 折叠…」分隔号（合法），**无存储键/常量位省略号**（T71 D-4 教训清零）；editor.css diff 无直接 hex/rgba 色（全吃 var）；testid 全挂齐（add-row/add-col/del-row-i/del-col-j/header-toggle/cell-i-j/block-toggle-<id>/title/line-i/slash-item-table/slash-item-toggle）。

**真机探针 `cdp-e2e-t76-01.mjs`：13 PASS / 0 FAIL**（取证 docs/mockups/screens-t76/）：
- S1 斜杠插 3×3 表+单元格键入「甲」+网格描边在场
- S2 加行+加列→4×4、删行3+删列3→回 3×3 且首格「甲」保真、表头开关 aria-pressed 翻转+首行 `--header` class（PM 修 D-4 认知：交互层=div-grid+input，非原生 table/th，取证改按真实 DOM）
- S3 折叠列表斜杠插入+默认收起（aria-expanded=false）+点开→展开+正文行可见
- S4 **优雅退出重启→表格 9 格+首格「甲」还原**（持久化硬证据，T65 leveldb flush 纪律）
- S5 全流程应用存活

**PM 探针自纠 2 处（非产品缺陷）**：① S3-d arrow 钮本身即 block-toggle 载体、无独立 root 容器带 dataset.open → 改读 aria-expanded；② S2-d 探针误设 `<th>` 判据 → 改真实形态（header class）+ 收敛默认态。均探针侧取证口径，产品行为正确。

**DEVIATION 追认**：D-1（未知块样例改 embed，断言不改）/ D-2（parseMarkdown 收紧+粘贴窄口，导入导出零改动，两侧测试钉死）/ D-3（importer content 联合 types-only 放宽，行为零改动由 59 例自证）/ D-4（atom+原生 NodeView、无新依赖，代价已登记）/ D-5~D-12 **全部核可**。特别认可 D-2/D-7：CB 主动识别导入链共用解析器的红线冲突并做窄口隔离、D-7 现场复现证明 Yjs 告警系既有行为不归本单。

**结论**：T76-01 **验收通过**。老探针回归电池连跑中（T60/61/59/66/71/72/73 + frame-check）。
