# T77-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T77-01.md` · PRD：`docs/PRD-R26-编辑器体验包.md` §1
> 基线 main `060bb03`（本报告开工时工作树报文为 `7b3eb00`，与本单无交集文件）

## §0 开工侦察结论

### ① 代码块渲染归属 + lang/wrap 现有写路径

**渲染归属（编辑器侧）**：`packages/editor/src/types/code.ts` 的 `CodeNode`——纯 Tiptap
节点（`content: 'text*'`、`marks: ''`、`code: true`），无 NodeView，原渲染 = `renderHTML`
输出 `pre.sc-block.sc-block--code > code.sc-code-body`（PM 节点名 `codeBlock`，真相层类型名
`code`，由 `model.ts` 的 `pmNodeNameOf` 映射）。**本单新增原生 DOM NodeView**（同 table/toggle
的包内范式，不引 @tiptap/react、不加依赖）。

**投影层 attr 读写（真相层 → PM → 真相层）**：
- 正投影 `model.ts` `blockToPMNode` code 分支（319–333）：`lang` 恒写（可 `''`）、`wrap` 仅在
  `=== true` 时写；
- 反投影 `model.ts` `pmDocToBlocks` 与 `blocks.ts`（M12 导入器纯版）code 分支：读回
  `lang`(string) 与 `wrap === true`，**两路同源**。

**改 lang/wrap 的既有写路径（本单之前只有"创建期"，无"改"入口）**：
1. 斜杠/输入规则：`rules/inputRules.ts`（``` ```lang ``` → `attrs.lang`）；
2. markdown 粘贴：`rules/markdownPaste.ts` `codeBlock(lang, body)` → `attrs.lang`；
3. 块转换：`PageView.tsx:712` 转 code 时补 `attrs.lang = ''`（缺省）。

**落库通道（本单复用，未新增任何 op 类型）**：NodeView 内 `tr.setNodeMarkup(pos, undefined,
{...attrs, lang|wrap})` → `Editor.tsx` onUpdate → `pmDocToBlocks` → `onChange` → PageView
`handleChange` → `diff.ts` 产出 **`kind: 'patch'`（payload.props）** → `EditSession` 批提交
`blocks.commit`。审计 `diff.ts:315-322` 确认 props 变化走既有 patch，op 类型零新增。

### ② image 渲染位 + width attr 现语义 + 吸附档位选型

**渲染位**：`packages/editor/src/types/image.ts` 的 `ImageNode`——`atom: true`，原渲染 =
`figure.sc-block.sc-block--image > img.sc-image-body`（`src = attachment://<file_id>`，
caption → `alt`）。本单新增 NodeView，在 `figure` 内插 `div.sc-image-frame` 包裹层，把拖拽柄/
badge 贴**图片**右缘（避免 width < 容器时柄悬空）。

**width attr 现语义 = 像素（非百分比）**：
- `renderHTML` 把 `width` 透传为 `<img width="N">`（HTML 属性语义 = CSS 像素），配合
  `editor.css .sc-image-body { max-width: 100% }` 夹紧；
- **现有默认值样本**：`packages/editor/test/fixtures/blocks.ts:211` /
  `:217` → `width: 480`（props 与 node attrs 两侧一致）；
- 正/反投影：仅当 `typeof width === 'number'` 时写（`model.ts:347-350` / `blocks.ts:110-113`），
  attr 默认 `null`。

**吸附档位选型（二选一，取像素）**：**像素 + 8px 步进吸附**。理由：既有 attr 语义即像素，
改用百分比会让 `<img width>` / 既有 fixture 失真并给导出埋口径债；样本 480 恰为 8 的整数倍，
与 8px 网格同族。缺省（null）基准 = `IMAGE_DEFAULT_WIDTH = 480`（沿用现有样本）。
badge 文案：容器可量测 → `NN%`（需求「百分比标签」）；不可量测（jsdom/未布局）→ `NNpx`
确定性退化（纯函数 `imageWidthBadgeText`）。

### ③ 语言切换后是否真有高亮（决定 B 项口径）

**无**。全仓 grep `highlight|refractor|lowlight|shiki|prism`：`packages/editor/src`、
`packages/editor/package.json`、`PageView.tsx` 均**零命中**（唯一命中是本单新增注释）。
故编辑器当前**无语法高亮引擎** → `lang` 的 UI 价值 = **为导出/未来高亮保留真相层**。
**B 项（非聚焦淡显 lang 标签）照做**（可见性口径），**禁引 highlight.js**——本单不引入任何
高亮依赖，切换语言只改 attr，正文视觉零变化。

## §1 交付概览（DoD 自检）

- [x] A 代码块语言栏（聚焦浮出/12+自动/wrap 开关/attr 写入）——`code.ts` NodeView；
      显形口径 = `editor.isFocused && caret 在本块内`（Tiptap focusEvents 真链 + selectionUpdate）
- [x] B blur 后 lang 淡标签（非聚焦且 lang 非空才显；空=不显）
- [x] C 图片右缘拖拽柄 + 宽度吸附（8px 网格）+ 拖拽中百分比 badge（`image.ts` NodeView）
- [x] 单测：attr 往返 / 吸附纯函数 / 焦点态机 / 语言常量（editor 包 16 例 + desktop 6 例）
- [x] i18n 成对（`editor.code.*` / `editor.image.*`，经 `blockLabels` 注入通道）
- [x] testid 契约 6 名挂齐：`codebar-lang-<id>` / `codebar-lang-opt-<lang>` / `codebar-wrap-<id>`
      / `code-lang-tag-<id>` / `image-resize-handle-<id>` / `image-width-badge`

## §2 用例计数

| 工程 | 基线 | 本单后 | 增量 |
|---|---|---|---|
| packages/editor | 205 | **221** | +16（`test/code-image.test.tsx`） |
| apps/desktop | 1094 | **1100** | +6（`test/t77-code-image-ui.test.tsx`） |
| packages/ui | 168 | 168 | 0 |
| packages/core / dbview / importer / schema / sync / platform | 未动 | 未动 | 0 |

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| D-1 | `codebar-lang-opt-<lang>` 的「自动」项若以 lang 值（空串）作后缀，testid 会退化成 `codebar-lang-opt-`（空后缀）。 | 「自动」项取**稳定 id `auto`**（testid = `codebar-lang-opt-auto`，`data-value=""`）；12 语言项 id = 语言名。 | testid 需有辨识度与可断言性；空后缀不可读。待 PM 追认。 |
| D-2 | 语言白名单按任务书 §A.1 的 12 项字面实现，未对齐 CommonMark 官方语言标签表。 | 照任务书给定的 12 项（javascript/typescript/python/bash/json/html/css/sql/markdown/yaml/rust/go）。 | 任务书 §A.1 明确列了这 12 个；PRD 称「commonMark 12 语言白名单」，以施工单字面为准。 |
| D-3 | width 单位二选一。 | 取**像素 + 8px 步进**（§0-②）；badge 文案容器可量测 → 百分比、不可量测 → 像素。 | 既有 attr 语义即像素（样本 480）；避免百分比引入后 renderHTML/fixture/导出失真。 |
| D-4 | 语言栏/淡标签是 `pre` 内的绝对定位子元素；`pre`（`.sc-block--code`）有 `overflow-x: auto`，横向滚动时浮层随内容滚动。 | 接受该边界（不重构 DOM 结构）。 | 代码块横向滚动极少；改 root 结构会破既有 CSS/测试（真机 PM 探针可复核）。 |
| D-5 | 代码块内容在**单一 contenteditable 根**内（非独立 input），DOM 无逐块 focus；且 jsdom 不聚焦 contenteditable。 | 显形态由 Tiptap `focus/blur/selectionUpdate` 事件 + `editor.isFocused` + 选区位置推导；jsdom 用 `fireEvent.focus/blur` 走 FocusEvents 真链。 | 与浏览器实现一致（点击进出编辑器即触发 focus/blur）；单测可驱动同一链，避免造私有态。 |
| D-6 | `CodeNode`/`ImageNode` 此前未从包入口导出；新增常量/纯函数（`CODE_LANGUAGES`/`snapImageWidth` 等）需被测试消费。 | `types/index.ts` 新增 `export * from './code'` / `'./image'`；`BASE_BLOCK_NODES` 拆出 code/image（改在 `editorExtensions` 里 `configure({labels})`）。 | 节点面不变（等价）；无命名冲突（已过 tsc）。 |
| D-7 | i18n 新键落点。 | 新增 `editor.code.*`（4 键）+ `editor.image.*`（1 键），与 T76 的 `editor.table/toggle` 同构。 | 沿用既有域划分；键集合 zh/en 等价由门禁①把关。 |
| D-8 | 图片宽度的键盘等价操作。 | **不做**。 | 同 T76 D-6 口径；任务书 §C.4 明示不做。 |

## §4 文件改动清单

| 文件 | 改动 |
|---|---|
| `packages/editor/src/types/code.ts` | 重写：新增原生 NodeView（语言栏/换行钮/淡标签）、`CODE_LANGUAGES`/`CODE_LANG_OPTIONS`/`codeLanguageLabel`/`createCodeView`；`CodeNode` 加 `addOptions`/`addNodeView`（`renderHTML` 原样保留） |
| `packages/editor/src/types/image.ts` | 重写：新增原生 NodeView（右缘拖拽柄/宽度 badge）、`snapImageWidth`/`imageWidthBadgeText`/宽度常量；`ImageNode` 加 `addOptions`/`addNodeView` |
| `packages/editor/src/types/blockLabels.ts` | 新增 5 键（`codeLang`/`codeLangAuto`/`codeWrapOn`/`codeWrapOff`/`imageResize`）+ 中文默认 |
| `packages/editor/src/types/index.ts` | code/image 从 `BASE_BLOCK_NODES` 移到 `editorExtensions` 按 `labels` configure；新增 `export * from './code'`/`'./image'` |
| `packages/editor/src/react/editor.css` | 新增 `.sc-codebar*` / `.sc-code-lang` / `.sc-image-frame` / `.sc-image-resize` / `.sc-image-badge` 规则（全 `var(--sc-*)`） |
| `packages/editor/test/code-image.test.tsx` | 新增：16 用例（常量表/文案回落/装载往返/焦点态机/语言与 wrap 写入/吸附纯函数/badge 文案/拖拽落库/微位移/百分比） |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` | 新增 `editor.code`（4 键）+ `editor.image`（1 键） |
| `apps/desktop/src/renderer/src/i18n/en-US.ts` | 同上（英文，门禁③无 CJK） |
| `apps/desktop/src/renderer/src/pages/PageView.tsx` | `editorBlockLabels` 增 5 个注入键（`t('editor.code.*')` / `t('editor.image.resize')`） |
| `apps/desktop/test/t77-code-image-ui.test.tsx` | 新增：6 用例（PageView 装载 testid/zh 注入、选语言与 wrap 落 patch op、图片拖拽落 patch op、en-US 注入成对） |

## §5 红线自检

- [x] 浮层全 token（无直接色/裸 px/灰线）：新增 CSS 仅 `2px`（发丝级，no-magic 豁免）、`100%`、
      `content` 空串、`max-content` 与 `var(--sc-*)`；`no-magic` 门禁零违规（见 §6）
- [x] op 类型零新增（只 `patch` 既有 attr）；不建表不加依赖（editor deps 未动）
- [x] 禁「数据库」词零回归（新增 zh 文案无该词）；无省略号占位（新文案均完整）
- [x] T78 跨块选择零涉及（未触碰选择模型/手柄菜单/批量路径）
- 备注：启动零外联——本单无网络/新增 IPC；`lang` 只作真相层 attr，未引高亮引擎（§0-③）

## §6 门禁原始输出

### typecheck（根 `pnpm -r --no-bail run typecheck`）

```
packages/core typecheck: Done
packages/platform typecheck: Done
packages/ui typecheck: Done
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/importer typecheck: Done
apps/desktop typecheck: Done
```

tsc 错误数 = **0**（基线 0）。

### desktop vitest（`pnpm --filter @septcats/desktop test`）

```
 Test Files  101 passed (101)
      Tests  1100 passed (1100)
   Duration  27.94s
```

delta：1094 → **1100**（+6）。

### ui vitest（`pnpm --filter @septcats/ui test`）

```
 Test Files  33 passed (33)
      Tests  168 passed (168)
   Duration  4.56s
```

delta：168 → 168（0，未动）。

### no-magic（`node packages/ui/tokens/no-magic.mjs`）

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

违规数 = **0**（基线 0，只增不减）。

### 附：editor 包（四件套之外的邻近门禁）

```
 Test Files  12 passed (12)
      Tests  221 passed (221)
```

delta：205 → **221**（+16）。

## §8 PM 真机核验 + 门禁复跑（09-24）

**PM 复跑门禁**：typecheck **0** / desktop **1100 passed (101 files)**（+6 与自报一致）/ editor 包 221(+16) / ui **168** / no-magic ✓；CSS 改动零直接色；省略号扫描新代码零命中。

**真机探针 `docs/mockups/cdp-e2e-t77-01.mjs`：9 PASS / 0 FAIL**
- C1-a/b/c：``` 建代码块→聚焦浮语言栏+wrap 钮→选 python→blur 淡标签显 python
- C4-a/b/c（持久化三步定案）：同会话 IPC 直读 truth 层 `code props.lang="python"` + content 全等；**优雅退出重启后 IPC 再读 lang 持久**；导航回页渲染层标签还原
- C2-a：wrap 钮点击 aria-pressed false→true 翻转
- C3-a：斜杠插图片块→`image-resize-handle` 挂上（拖拽写宽全链需真图字节，探针不引 OS 文件对话框——jsdom 吸附测+DOM 在场=本单口径）
- C5：存活+真实数据根 untouched
- 探针自纠三坑（已沉淀 skill）：历史同名页堆积致 find 撞残留（页名唯一化+=== 精确）、finally process.exit 吞真因（改 exitCode）、evaluate 引用 Node 闭包变量（显式传参）。产品侧 lang attr 假红系探针缺陷，**非产品问题**（dbg IPC 早已证写链）。

**DEVIATION 裁决**：8 条全追认（D-1 焦点判据 caretInCode、D-4 像素吸附+badge 换算%、D-8 codebar z-index 9 < 弹层 10=弹层盖浮层为序，皆过硬）。

**回归电池**：T60/T61/T59（编辑器核心面）+T76（新块）+T71 后台跑批，结果回填后合入。

**回归电池终版（五连全绿 09-24）**：T60 32/0 · T61 30/0 · T59 45/0 · T76 13/0 · T71 26/0——编辑器核心面与新块零回归，合入。
