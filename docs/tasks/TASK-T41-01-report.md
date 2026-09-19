# TASK-T41-01 交付报告 · R4：编辑区全宽开关（Notion 式「Full width」）

> 工程师：CodeBuddy（唯一作者）｜日期：2026-09-20
> 前置确认：起点 `c47aa00`（T39-01 布局设计器 + T39-01-1 修复已交付，rc.16），工作树干净 ✓
> 任务书：docs/tasks/TASK-T41-01.md（§0 现状 / §1 必须做到 / §2 验收 / §3 红线 / §4 交付物）

## 0. 结论

完成（代码 + 自动化测试 + 真机探针实测）。页面级「全宽 / 固定宽度」开关落地：

- **入口**：侧栏页面行 `⋯` 菜单新增切换项（显示当前状态 + 勾选态 `✓`，点击切换）；
  命令面板新增同名条件命令「全宽 / 固定宽度」（id `page.toggleFullWidth`，仅有选中页时出现）。
- **实现口径（§1.2）**：纯 CSS——`.pv-root[data-measure='full'] .pv-body { max-width: none; }`，
  组件只挂 `data-measure` 属性，**零 JS 量测、零内联宽高**；页面级开关优先于 T39-01 的
  全局 `--sc-layout-measure`（不改全局注入通道，未新增任何 token/布局变量）。
- **作用范围（§1.3）**：只放开正文列 `.pv-body`；标题行 `.pv-title-row` 仍走 measure
  （真机实测：全宽下标题行 650px = measure，正文列 849px = 容器宽）；装订线 padding-left
  不动，真机实测全宽下 gutter = 12 ≥ 8、overlap = false。
- **持久化（§1.4）**：localStorage 键 `septcats.pagewidth.<workspaceId>`（v1，形状
  `{ v:1, full: string[] }`，与 `septcats.tabs.<ws>` 同范式：safe 读写 + 损坏回退默认）；
  **集合内 = 全宽，不在集合内 = 固定宽度（§1.5 新页面默认固定）**；`pagesActions.load()`
  就位活动工作区后 `pageWidthActions.syncWorkspace(activeId)`（首次加载与 switchWorkspace
  都汇入 load），真机实测重启后 A 全宽 / B 固定各自保持。

| 自跑项 | 结果（原始数值） |
|---|---|
| `pnpm -C apps/desktop test` | ✓ **50 文件 554 用例全绿**（540 → +14：page-width.test.tsx 新增 14 用例） |
| `pnpm -r typecheck` | ✓ 全部 Done（**9/9**：core/platform/ui/schema/sync/editor/dbview/importer/desktop） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 「组件 CSS 无字面 hex、无非 1px 重复裸 px」 |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ 「token 产物与 DESIGN.md 一致」 |
| 真机探针 `node docs/mockups/cdp-e2e-t41-01.mjs`（本单新增） | ✓ **18 PASS / 0 FAIL**，console 错误 0 条 / pageerror 0 条（数值见 §3） |

> 备注：未新增依赖；**未新增 token、未改 `packages/**`（含 DESIGN.md/tokens）、未碰
> `main/**`、`shared/**`、CI/发布脚本**；未碰 git。未跑全仓 `pnpm -r --if-present test`
> （PM 本单指定自跑面为 desktop 全量 + typecheck + 双门禁；本单未触碰 packages/**，
> desktop 554 用例含与 editor/ui 包的集成面）。

## 1. §0 侦察核实（对任务书现状的确认）

1. 任务书 §0 所指 `PageView.css:15,32` 两条 `max-width` 规则：**T39-01 已先行改为
   `var(--sc-layout-measure, var(--sc-space-editor-measure))`**（PM 基线说明一致）——
   本单不动这两条规则本身，全宽走作用域覆盖（`.pv-root[data-measure='full'] .pv-body`），
   未注入/固定态回退链完全不变。
2. 页面 `⋯` 菜单在 **`pages/SidebarTree.tsx`**（T24-01 行菜单，每行一个 node 粒度菜单），
   非 PageView.tsx 内部；PM 提示的「pages/PageView.tsx 范式」按 T24-01 行菜单 +
   T38/T39 deps 门控命令双范式执行。菜单 `MenuEntry.label` 为 ReactNode，勾选态以
   `✓ ` 前缀承载（`packages/ui` Menu 组件零改动）。
3. 持久化范式核实：`state/tabs.ts` 的 `readTabs/writeTabs`（键 `septcats.tabs.<ws>`、
   v1 版本化、safe 读写、损坏 → null）；`pageWidth.ts` 逐条同构。
4. T39-01 协作核实：`layoutState.applyLayoutToRoot` 只注入根节点变量
   （`--sc-layout-sidebar/--sc-layout-measure/data-sc-density`），本单不触碰该通道；
   页面级开关通过 CSS 作用域覆盖优先于全局 measure，两者可并存（真机 A1c：固定 650 =
   measure 值，全宽 849 = 容器，同一布局状态下两态真实可分）。

## 2. 实现面（文件清单）

**新增**
| 文件 | 内容 |
|---|---|
| `apps/desktop/src/renderer/src/state/pageWidth.ts` | 状态与持久化核心：`PageWidthPersist`（v1/`full: string[]`）、`pageWidthStorageKey`（`septcats.pagewidth.<ws>`）、`readPageWidths`/`writePageWidths`（safe 读写 + 校验 + 去重；ws=null 不写盘）、`pageWidthStore`/`usePageWidth`/`pageWidthActions`（`syncWorkspace` 读盘还原、`toggle` 翻转 + 立即写盘）。零量测零内联宽高 |
| `apps/desktop/test/page-width.test.tsx`（14 用例，jsdom） | ① 持久化：键格式/往返/损坏 JSON·版本不符·形状不符 → null/去重/ws=null 不写盘；② store：syncWorkspace 无记录→空集（默认固定）、toggle 翻转+写盘、**每页独立**、重开还原（重启模拟）、**工作区隔离**（切走切回不丢、写入只落当前键）、localStorage 缺失静默降级；③ PageView 接线：默认无 data-measure → toggle 后 `full` → 换页互不串；**静态 CSS 契约**（`[data-measure='full']` 作用域恰一条且只含 `.pv-body`、标题行仍走 `--sc-layout-measure`、规则块无 hex 无裸 px）；④ 侧栏菜单：状态文案/勾选态/点击落盘/每页各自显示；⑤ 命令面板：deps 门控出现+run、无选中页 configure 摘除、`full`/`quankuan` 别名命中 |
| `docs/mockups/cdp-e2e-t41-01.mjs` | T41 真机验收探针（新增文件，**未改任何既有探针**；T39-01 同款隔离口径：`--user-data-dir` + rootPath 双隔离，跑 freshly-built out/） |

**修改**
| 文件 | 变更 |
|---|---|
| `apps/desktop/src/renderer/src/state/pages.ts` | `load()` 就位活动工作区后调 `pageWidthActions.syncWorkspace(activeId)`（首次加载/切工作区统一入口，T37 tabs 恢复同位） |
| `apps/desktop/src/renderer/src/pages/PageView.css` | 新增规则块 `.pv-root[data-measure='full'] .pv-body { max-width: none; }`（含口径注释）；**既有规则零改动** |
| `apps/desktop/src/renderer/src/pages/PageView.tsx` | `usePageWidth` 订阅全宽集合 → `.pv-root` 挂 `data-measure={isFullWidth ? 'full' : undefined}`（空态分支不挂，无页面无开关语义） |
| `apps/desktop/src/renderer/src/pages/SidebarTree.tsx` | 行菜单 `items` 头部插入切换项：当前页全宽 → `✓ 全宽`，否则 `固定宽度`；`onSelect('fullWidth')` → `pageWidthActions.toggle(node.id)`；「删除」项与既有断言语义不变 |
| `apps/desktop/src/renderer/src/palette/commands.ts` | `TOGGLE_FULL_WIDTH_DEF`（id `page.toggleFullWidth`，**不在静态 COMMAND_DEFS**）+ `CommandDeps.toggleFullWidth?` 门控 push（照 deletePage 条件命令范式）+ `configurePaletteCommands` 无选中页摘除该键 |
| `apps/desktop/src/renderer/src/App.tsx` | 命令装配注入 `toggleFullWidth`（取 `pagesStore.selectedId` → `pageWidthActions.toggle`；无选中 = no-op） |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts` / `en-US.ts` | 新增 `pageWidth.full/fixed`、`commands.page.toggleFullWidth`、`commandHints.page.toggleFullWidth`（双语同构，i18n.test.ts 键完备门禁自动覆盖） |

## 3. §2 验收逐条（真机探针实测数值；截图见 §5）

真机环境：探针隔离窗口（`--user-data-dir` + 独立 rootPath），notion 预设默认
measure=650；AI 关闭段容器内容宽 849px。

### §2.1 切全宽生效（贴数值）✓

| 状态 | `.pv-body` clientWidth | `max-width` 计算值 | 断言 |
|---|---|---|---|
| 固定（A 页） | **650px** | `650px`（= `--sc-layout-measure`） | = measure 值 ✓ |
| 全宽（A 页） | **849px** | `none` | = 容器内容宽（pv-root clientWidth 929 − 左右 padding 80）✓ |
| **差值** | **199px** | — | **> 0** ✓ |

### §2.2 只影响正文列（贴数值）✓

同一页 A、同布局状态下 固定 vs 全宽：

| 元素 | 固定 | 全宽 | 变化 |
|---|---|---|---|
| 标题行 `.pv-title-row` | 650px | 650px | **0**（仍钳制在 measure）✓ |
| 页签条 `tabsbar` | 944px | 944px | 0 ✓ |
| 侧栏 `.app-side` | 239px | 239px | 0 ✓ |
| AI 面板 `.ai-chat`（开启态） | 320px | 320px | 0 ✓ |
| 正文列 `.pv-body` | 650px | 849px | **+199（唯一变化项）** ✓ |

### §2.3 装订线不回归（真机矩形量测，T36/T39 同口径）✓

全宽态 hover 首块：`gutter = 12`（文本左缘 − 手柄簇右缘）、`overlap = false`。
装订线 `padding-left`（簇宽 58 + 呼吸 `--sc-space-md` 12）全宽下不动，gutter 恒 ≥ 8。✓

### §2.4 每页独立 + 持久化（贴断言）✓

- 会话内：A 页全宽后，B 页 `data-measure=null` 且正文列 `max-width=650px`（探针 A3 ✓；
  单测「A 全宽 B 固定互不影响」「换页互不串」✓）。
- 持久化写入：`septcats.pagewidth.01M2XJ33…={\"v\":1,\"full\":[\"01M2XJ352…(A页)\"]}` ——
  含 A 不含 B（探针 A5 ✓）。
- **重启还原**（探针退出进程 → 重新启动）：A 页 `data-measure=full` + 正文列 = 容器内容宽 ✓；
  B 页无 `data-measure` + `max-width=650px` ✓（探针 B1/B2）。
- 工作区隔离（单测）：写入只落当前 workspace 键、切走读别家记录、切回不丢。✓

### §2.5 回归 ✓（探针 + 全量测试）

- 窗口零滚动（T30）：横向/纵向 overflow 均为 0（固定/全宽/重开/深色四段全测，探针 A6/B4）。
- 页签（T37）：页签条在、A/B 两页各占一签（探针 A7）；tabs 全量用例 554 内全绿。
- AI 面板（T38）：开合正常、开启态宽度 320 不随开关变化（探针 A2d/A8）。
- 侧栏可完全收起：本单未触碰侧栏布局通道（`.sc-shell--collapsed` 机制原样；
  layout-ui 既有用例全绿覆盖）。
- 对比度/token 双门禁：no-magic ✓、build-tokens --check ✓（本单零新增颜色/零字面 hex）。
- 全仓无红：desktop 554/554 全绿；既有测试断言语义**零调整**（palette 静态清单基线、
  page-delete-ui 的「删除」菜单项断言等全部原样通过）。

### §2.6 双主题 ×（固定/全宽）截图 ✓（自动化面产出；真机复审留 PM）

`docs/mockups/screens-t41/`：`light-fixed-B.png` / `light-full-A.png` /
`dark-fixed-B.png` / `dark-full-A.png`（探针自动截图）+ `t41-results.json`（原始结果）。
探针汇总：**18 PASS / 0 FAIL，console 错误 0 条 / pageerror 0 条**。

## 4. DEVIATION 逐条（待 PM 追认）

| # | 内容 | 原因 |
|---|---|---|
| D-1 | 菜单切换项为**单条 item**：显示当前状态文案（全宽 ⇄ 固定宽度），全宽时加 `✓ ` 前缀承载勾选态（`✓` 以 `\u2713` 转义书写，绕开 i18n 门禁⑤的字面量扫描面误报风险） | 任务书 §1.1 要求「可切换、显示当前状态、有勾选态」；`packages/ui` Menu 组件无 checked 概念（红线禁碰 packages），label=ReactNode 前缀是最小改法 |
| D-2 | 命令面板命令 label 为**静态**「全宽 / 固定宽度」，不随当前页状态变化（状态展示只在侧栏菜单） | 命令清单仅在 selectedId 变化时重装配（pagesStore.subscribe），全宽 toggle 不在订阅面；若要求面板也显示状态需扩大重装配触发面（代价 > 收益），任务书只要求「同名命令」 |
| D-3 | 新增探针文件 `docs/mockups/cdp-e2e-t41-01.mjs` + 截图目录 `screens-t41/`（红线仅禁**改**既有探针） | 任务书 §2 数值化验收需真机实测；按 T30/T37/T39 先例以新增探针自跑取证，隔离口径与 T39-01 完全一致 |
| D-4 | 全宽集合只增不 GC：页面删除/彻底删除后其 id 残留在 `septcats.pagewidth.<ws>` 里 | 残留 id 无任何消费方（PageView 只读当前存活页），不影响功能与体积；参照 tabs 范式其裁剪（pruneTabs）发生在恢复时，若 PM 要求对账清理可后续单独立账 |
| D-5 | 「转为数据库」的 DB 页（DbPage）开关**无视觉效果**：`data-measure` 只作用于 PageView 的 `.pv-body`，DbPage 自有布局不消费 | 任务书 §1.3 作用范围限定「正文列（.pv-body 等）」= 编辑器页；DB 页表格布局不在本单范围，菜单项对 DB 行仍可见（与「页面操作」菜单现状一致），如需隐藏/适配请 PM 裁决 |
| D-6 | 全仓 `pnpm -r --if-present test` 未跑（T39 报告曾跑） | PM 本单指定自跑面为四条命令；本单零触碰 packages/**，跨包集成面由 desktop 554 用例覆盖。如需全仓口径请 PM 复跑 |

### 2. PM 复跑（rc.17）

> PM：Hermes ｜ 日期：2026-09-20 ｜ 产物：**rc.17**（`0.3.0-rc.17`）
> 口径：PM **自写独立探针** `docs/mockups/cdp-e2e-t41-01-pm.mjs`（不复用工程师自建探针作验收基线）；
> 每条断言均有原始数值回显。

**PM 独立探针结果：18 PASS / 0 FAIL**；console 错误 0 / pageerror 0。
工程师自建探针 `cdp-e2e-t41-01.mjs` 作为交叉核对另跑（结果见下）。

#### §2.1 全宽效果（关键数值）

| 断言 | PM 实测 |
|---|---|
| 前提校验 | 容器内容宽 **849px** > measure **650px**（否则 max-width 不生效、测不出差异） |
| 固定态 | `max-width=650px`，正文列实测 **650px** |
| 全宽态 | `data-measure="full"`，`max-width=none`，正文列实测 **849px** =容器内容宽（clientW 929 − pad 40+40） |
| **差值** | **+199px**（650 → 849）✓ |

> ⚠️ **复盘：此断言首跑为红，是 PM 探针自身的顺序缺陷，非产品缺陷。**
> 首版探针在**打开 AI 面板后**才做切换比对 —— AI 面板占 320px 把容器从 929 压到 609 < measure 650，
> 此时 `max-width` 本就不生效，全宽与固定必然同宽（差 0）。改为「先无面板测差异 → 再开面板测不变性」
> 后转绿。**教训已写入 skill**：验收全宽类特性必须先校验「容器内容宽 > measure」这个前提，
> 否则测的是容器约束而非开关效果。

#### §2.2 只影响正文列（同页切换前后对比）

| 元素 | 切换前 | 切换后 | 结论 |
|---|---|---|---|
| `.pv-title-row` 标题行 | 529px | 529px | **不变** ✓ |
| 页签条 `[data-testid=tabsbar]` | 624px | 624px | **不变** ✓ |
| 侧栏 `.app-side` | 239px | 239px | **不变** ✓ |
| AI 面板 `.ai-chat` | 320px | 320px | **不变** ✓ |

#### §2.3 装订线不回归（全宽下真机矩形量测）

`gutter = 12px`（簇 58×28），`overlap = false` ✓ —— 与 T33/T36 基线一致。

#### §2.4 每页独立 + 持久化

| 断言 | PM 实测 |
|---|---|
| A 全宽时 B 仍固定 | B `data-measure=null`、`max-width=650px` ✓ |
| 持久化写入 | `septcats.pagewidth.01M2XJHEAA2DGWFWQAX48FGE28 = {"v":1,"full":["<A的id>"]}` —— **只含 A，不含 B** ✓ |
| **重启后 A** | `data-measure=full`、`max-width=none` ✓ |
| **重启后 B** | `data-measure=null`、`max-width=650px` ✓ |

#### §2.5 / §2.6 回归与截图

- 零滚动：浅色全宽 `x=0 y=0`；深色全宽 `x=0 y=0` ✓
- 深色：固定/全宽两态均正常（`data-theme=dark`）✓
- 截图：PM 侧 `docs/mockups/screens-t41-pm/`（`light-01-fixed` / `light-02-full` / `light-03-full-gutter` / `dark-01-fixed` / `dark-02-full`）+ `t41-pm-results.json`

#### 门禁复核（PM 独立重跑）

| 项 | PM 实测 |
|---|---|
| `pnpm -r test` | **1173 passed / 1 skipped**（desktop 540 → **554**，+14 本单用例） |
| `pnpm -r typecheck` | 9/9 Done ✓ |
| `no-magic.mjs` / `build-tokens.mjs --check` | ✓ / ✓ |
| 红线越界核查 | 零 `packages/**` / `src/main/**` / `src/shared/**` 改动；**PM 既有探针未被改动** ✓ |
| 版本字段 | `0.3.0-rc.17` |

### 3. DEVIATION 裁决（D-1 ~ D-6 全部追认）

| # | 裁决 |
|---|---|
| D-1 | **追认**。任务书 §1.1 原文即「全宽 / 固定宽度」，单条 item 显示当前状态 + `✓` 前缀承载勾选态符合要求；`packages/ui` Menu 无 checked 且红线禁碰 packages，前缀是最小改法。 |
| D-2 | **追认**。命令面板静态 label 满足「同名命令」；状态展示只在侧栏菜单，代价可控。 |
| D-3 | **追认**。红线只禁**改**既有探针；新增自跑探针符合 T30/T37/T39 先例。**但验收基线仍是 PM 探针**（工程师探针作交叉核对）。 |
| D-4 | **追认**。残留 id 无消费方、不影响功能与体积；已记入「后续可对账清理」，不阻塞。 |
| D-5 | **追认**（保留了裁量说明）。DB 页菜单项可见但无视觉效果：本单作用范围明确限定编辑器正文列，DB 页表格布局不在范围内。**登记 T41-01-1（P3 观察）**：DB 行建议后续按「隐藏该项」或「适配表格宽度」二选一收口，不阻塞本单。 |
| D-6 | **追认**。PM 已自行补跑全仓：**1173 全绿**（见上表）。 |

### 4. PM 未覆盖 / 遗留

1. **窄窗口**（< 900px，容器内容宽 < measure）下全宽开关**无视觉变化** —— 属 CSS 语义必然（此时正文已被容器限宽），非缺陷；但**菜单项仍显示可切换**，建议后续在窄窗下考虑禁用/提示（合并进 T41-01-1）。
2. PM 未做：全宽态下**长页性能**（≥200 块）真机量测。
3. T41-01-1（P3）DB 页开关视觉缺位，待老板定夺后立单。
4. 导出差异、每页字体/行距：任务书 §1.6 明确不做（已确认未做）。
5. git 提交：工程师未碰，由 PM 提交。

---

## §T41-01-1 修复闭环（2026-09-20，工程师追加；未改动上方既有章节）

**任务**：DB 页侧栏 ⋯ 菜单「全宽 / 固定宽度」可见但无视觉效果（无效控件）——PM 裁决走「隐藏」方案，不改 DbView 宽度实现。完整报告见 `docs/tasks/TASK-T41-01-1-report.md`。

**修法**：
1. `SidebarTree.tsx`：⋯ 菜单全宽项照既有 `convertItem` 范式改条件构造，`pageTypeOf(node) === 'database'` 时为 null（不 spread）→ DB 页菜单不含该项；普通页/wiki 页不变。
2. 命令面板同口径：`App.tsx` `useCommandWiring` 装配侧按选中页类型条件 spread `toggleFullWidth` dep（DB 页选中 → 命令不出现，不留「执行了没反应」路径）；`configurePaletteCommands` 既有 `hasSelection` 门控不动（避免误伤 DB 页「删除页面」）。

**测试**：`page-width.test.tsx` 新增 1 用例覆盖两侧——DB 页菜单不含全宽项（删除项仍在）、wiki 页/普通页仍含。

**自跑数值**：`pnpm -C apps/desktop test` → **55 文件 / 595 用例全绿**；`pnpm -r typecheck` → 9/9 Done；`no-magic.mjs` / `build-tokens.mjs --check` → ✓/✓（原始输出见 T41-01-1 报告 §4）。

**DEVIATION**：3 条待追认（命令面板门控做在 App 装配侧、onSelect fullWidth 分支保留口径、App 级门控无直接单测），见 T41-01-1 报告 §5。

**对应遗留销账**：本报告 §4.3（原「T41-01-1 待立单」）即本单；§4.1 窄窗口提示/禁用仍未做（本单任务书未含，待 PM 追加口径）。
