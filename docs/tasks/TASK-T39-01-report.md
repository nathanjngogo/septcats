# TASK-T39-01 交付报告 · R3：布局设计器（预设 + 参数 + 导入导出）

> 工程师：CodeBuddy（唯一作者）｜日期：2026-09-20
> 前置确认：起点 `16c47e6 feat(dbview): T40-01 数据库「字段」体系检查与优化（rc.14）`，工作树干净 ✓
> 任务书：docs/tasks/TASK-T39-01.md（§0 口径 / §1 数值化验收 / §2 红线）

## 0. 结论

完成（代码侧）。三预设 `notion`（默认）/`focus`/`workbench` 切换即时生效且持久化；
参数微调全部持久化并夹紧（侧栏位置/宽度 200–320 · measure 560–1000 · AI 面板位置
右/底/隐藏 + 默认展开 · 标签条显隐 · 主题三选 · 密度两档）；全部结构参数以 **CSS 变量
注入根节点**（documentElement 内联 `setProperty` + 密度 data 属性），既有布局消费变量，
**零 JS 量测、零元素内联宽高**；存储 `septcats.layout`（localStorage 全局，损坏回退默认）；
导出/导入 = 剪贴板双向（未新增任何 IPC）；入口 = 设置页「布局」区块 + 命令面板「切换布局
预设」（循环）。

| 自跑项 | 结果（原始数值） |
|---|---|
| `pnpm -C apps/desktop test` | ✓ **49 文件 537 用例全绿**（513 → +24：layout-state 17 + layout-ui 7，含既有 settings-react 2 处作用域收窄，见 DEVIATION-9/10）。注：全量 537 曾出现 1 例偶发红（并行抖动），连续复跑两轮均 537 全绿 |
| 全仓 `pnpm -r --if-present test` | ✓ **1156 passed / 1 skipped**（core 51 · platform 41+1skip · ui 79 · schema 3 · sync 109 · editor 182 · dbview 95 · importer 59 · desktop 537；基线 1132+1 → +24） |
| `pnpm -r typecheck` | ✓ 全部 Done（**9/9**） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 0 命中（「组件 CSS 无字面 hex、无非 1px 重复裸 px」） |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓ 「token 产物与 DESIGN.md 一致」 |
| `packages/ui/test/contrast.test.ts`（红线④） | ✓ 9/9 |

> 备注：未新增依赖；**未新增 token、未改配色**（未碰 `packages/**`、DESIGN.md、token 真源）；
> 未碰 `main/**`、`shared/**`、CI/发布脚本；未碰 git。`docs/perf-history.jsonl` 有 32 行追加
> 系 perf.test.ts / search.test.ts 自记产物（跑测试附带），非本单交付内容。

## 1. 实现面（文件清单）

**新增（apps/desktop/src/renderer/src/layout/）**
| 文件 | 内容 |
|---|---|
| `layoutState.ts` | 布局状态与持久化核心：`LayoutState`（v/preset/sidebar{position,width}/content{measure}/ai{position,expanded}/tabsVisible/theme/density）、三预设常量（数值见 §2.1）、`clampSidebarWidth`/`clampMeasure`、`validateLayout`/`parseLayoutImport`（非法 JSON → reason='json'/'shape'，不触当前布局）、`readLayout`/`writeLayout`（键 `septcats.layout`，版本化 + 损坏回退默认）、`applyLayoutToRoot`（CSS 变量注入根节点）、`layoutStore`/`layoutActions`（init/applyPreset/各参数 setter/exportJson/importFromText）、`nextLayoutPreset`（循环） |
| `LayoutSection.tsx` | 设置页「布局」区块：预设卡片三选（aria-pressed）+ 参数控件（RadioGroup/Switch/数值输入）+ 导出（`navigator.clipboard.writeText`，失败 → 弹出 JSON 供手动复制）/ 导入 Dialog（textarea 粘贴 → 解析 → 可读错误 role=alert 或应用）；主题控件复用既有机制（`setGlobalThemeMode` + `settings.patch`，照 SettingsPage.handleTheme） |
| `LayoutSection.css` | 卡片/便签/JSON textarea 样式，全 `var(--sc-*)` token；无 transition（无需 reduced-motion 块）；无字面 hex、无非 1px 重复裸 px |

**新增测试**
| 文件 | 内容 |
|---|---|
| `apps/desktop/test/layout-state.test.ts`（17，jsdom） | 三预设定义值 / 夹紧（100→200、999→320、measure 100→560、9999→1000）/ actions 越界写入 → 存储与根变量均为夹紧值 / 预设切换即时生效 + 持久化 + 切预设不改主题 / 微调落 custom + 循环顺序 / 导出→改→导入逐字段深比较等价 / `{bad json` → json、结构不符 → shape 且布局不变 / 导入越界夹紧 / 损坏存储回退默认 / 变量注入断言 |
| `apps/desktop/test/layout-ui.test.tsx`（7，jsdom） | 设置页区块渲染 / 预设卡片切换（变量 + 密度属性 + localStorage + 卡片高亮）/ 输入框夹紧回显 / 剪贴板往返深比较 / 非法导入 role=alert + 布局不变 / **App 集成红线回归**（挂载注入变量、`.sc-shell--collapsed` 侧栏完全收起、AI 面板 右/底/隐藏 + 入口隐藏 + 开合无效、标签条显隐）/ 重开保持（新挂载读 localStorage） |

**修改**
| 文件 | 变更 |
|---|---|
| `App.tsx` | 挂载 `layoutActions.init()`（读存储 + 注入变量）；侧栏收起态改由布局状态持有（顶栏开合钮写入 `setSidebarPosition`，位置随布局同步 effect 保持一致）；AI 面板：位置=hidden → 面板不渲染 + 顶栏入口隐藏 + Ctrl+J/命令开合无效（`toggleAiPanel` 统一出口），位置=bottom → 主行转纵向 class；标签条 `tabsVisible` 条件渲染；`initPanel(layout.ai.expanded && position!=='hidden')`（默认展开）；命令装配注入 `cycleLayoutPreset`（循环 + toast）与隐藏门禁的 `openAiChat` |
| `App.css` | 密度档位变量（`--sc-layout-density-row-h` / `--sc-layout-density-pad`，token 派生，`:root[data-sc-density='compact']` 切档）；`.app-nav-row` 行高、`.app-side-head` 内边距消费密度变量；`.app-main-row--ai-bottom` 纵向行 + 面板定高 `calc(var(--sc-layout-row-h) * 8)` + 顶边框（高度链仍闭合，窗口零滚动不变） |
| `pages/PageView.css` | `.pv-title-row` / `.pv-body` max-width 改 `var(--sc-layout-measure, var(--sc-space-editor-measure))`（未注入回退既有 token，组件级测试/兜底不变） |
| `ai/chatState.ts` | `readStoredPanelOpen()`（区分「无手动记录 null」与显式收起 '0'）；`initPanel(defaultExpanded=false)`：无记录时以布局「默认展开」接管，有记录（含显式收起）以记录为准 |
| `palette/commands.ts` | `LAYOUT_PRESET_DEF`（id `app.layoutPreset`，拼音+英文 aliases）+ deps `cycleLayoutPreset?` 门控 push（照 T38 openAiChat 同范式，静态清单基线不受影响） |
| `pages/SettingsPage.tsx` | 「外观」之后插入「布局」fieldset（LayoutSection 自管，照 AiSection 范式） |
| `i18n/zh-CN.ts` / `en-US.ts` | 新增 `settings.layout.*`（约 40 键双语同构：预设卡/参数/导出导入/错误文案/`presetSwitched`）+ `commands.app.layoutPreset` + `commandHints.app.layoutPreset` |
| `test/settings-react.test.tsx` | 2 处既有查询**作用域收窄**（语义不变，DEVIATION-9/10） |

## 2. 布局变量表（§0.3 实现口径）

全部经 `layoutState.applyLayoutToRoot` 注入 `document.documentElement`（内联样式优先级
高于 tokens.css 的 `:root` 定义，包侧组件零改动即消费新值）：

| 变量 / 属性 | 注入值 | 消费方 | 既有消费基线 |
|---|---|---|---|
| `--sc-layout-sidebar` | `'{width}px'`（200–320） | `packages/ui/AppShell.css` `.sc-shell__body` 列宽（既有消费，**未改包**）；折叠态由 `.sc-shell--collapsed` 显式 `1fr` 覆盖 → 完全收起 width=0 | tokens.css 240px |
| `--sc-layout-measure` | `'{measure}px'`（560–1000） | `PageView.css` `.pv-title-row`/`.pv-body` max-width（本单改为消费此变量，回退 `--sc-space-editor-measure`） | tokens.css `--sc-space-editor-measure` 720px |
| `data-sc-density` | `'comfortable' / 'compact'` | `App.css` `:root[data-sc-density=…]` 密度派生变量（见下） | — |

密度派生变量（**token 档位，无写死数值**，定义于 App.css）：

| 派生变量 | 舒适 | 紧凑 | 消费方 |
|---|---|---|---|
| `--sc-layout-density-row-h` | `calc(var(--sc-space-xxl) + var(--sc-space-xs))` = 28px（= T34 基准） | `calc(var(--sc-space-xl) + var(--sc-space-xxs))` = 26px | `.app-nav-row` 行高 |
| `--sc-layout-density-pad` | `var(--sc-space-md)` = 12px | `var(--sc-space-sm)` = 8px | `.app-side-head` 内边距 |
| `--sc-layout-ai-bottom-h`（常量，非参数） | `calc(var(--sc-layout-row-h) * 8)` = 288px | 同左 | `.app-main-row--ai-bottom .ai-chat` 高度 |

非参数辅助：`tabsVisible` → App 条件渲染 `<TabsBar/>`（T37 行为不变，仅显隐）；
`ai.position/expanded` → App 渲染面 + `chatState.initPanel`（T38 行为保持，仅位置/默认态扩展）；
`theme` → 仅布局快照字段，应用走 `setGlobalThemeMode`（ThemeProvider 管道写 localStorage
`septcats.theme`，不新造真相源）。

## 3. §1 验收逐条（自动化面实测数值；真机截图留 PM）

### §1.1 预设切换即时生效 + 重开保持（断言实测值）

`layout-ui.test.tsx`（App 集成 + 设置页两组）：

| 断言点 | notion | focus | workbench |
|---|---|---|---|
| `--sc-layout-sidebar` | `240px` | `240px`（width 保持 240，收起走折叠类） | `240px` |
| `--sc-layout-measure` | `650px` | `900px` | `650px` |
| 侧栏收起（`.sc-shell--collapsed`） | 无 | **有**（grid 单列 1fr + 侧栏 display:none → width=0） | 无 |
| AI 面板展开（`ai.expanded`） | `false` | `false` | `true` |
| localStorage `septcats.layout` | `{preset:'notion'…}` | `{preset:'focus', content:{measure:900}, sidebar:{position:'collapsed'}}` | `{preset:'workbench', ai:{position:'right',expanded:true}}` |
| 密度根属性 | `comfortable` | `comfortable` | `comfortable` |

重开保持：新挂载 `<App/>` 前预置 localStorage `{preset:'focus', measure:900}` →
断言 `.sc-shell--collapsed` 出现 + `--sc-layout-measure` = `900px`（layout-ui 末用例）✓

### §1.2 参数夹紧（断言实际值）

- 宽度输入 `100` → 实际 **200**（store `sidebar.width===200` + 根变量 `'200px'` + localStorage `200` + 输入框回显 `'200'`）；输入 `999` → 实际 **320**（同三面断言）。
- measure 输入 `9999` → 实际 **1000**（`'1000px'`）；`100` → **560**（纯逻辑面）。
- 非整数 `240.6` → `241`（取整）。

### §1.3 导入导出往返（逐字段深比较）

导出（`navigator.clipboard.writeText`）→ 改布局（切 focus）→ 导入原 JSON →
`expect(layoutStore.getState().layout).toEqual(JSON.parse(exported))` —— **LayoutState 全字段
（v/preset/sidebar{position,width}/content.measure/ai{position,expanded}/tabsVisible/theme/density）
逐字段相等**（纯逻辑面 + UI 面各 1 例，UI 面并断言开关回显 aria-checked）。

### §1.4 非法导入

贴入 `{bad json` → `role="alert"` 可读错误「不是有效的 JSON：请粘贴完整的布局 JSON 文本，
当前布局未改动」；断言 store 快照与 localStorage 写入值**逐字节不变**（`toEqual` + 字符串全等）。
结构不符（`{}` / 缺字段 / 枚举外 / 版本不符）→ 「布局 JSON 结构不符…当前布局未改动」，
同样布局不变。导入越界数值 → 夹紧后应用（9999→320 / 1→560）。

### §1.5 四条红线 + ⑤回归

| 红线 | 证据 |
|---|---|
| ① 窗口零滚动 | `layout-invariants.test.ts` 全绿（#root 定高禁溢出 / .sc-shell__main 内滚）；本单新增 AI 底部面板为 `.app-main-row` 纵向 flex 内定高 flex:none，高度链仍闭合 |
| ② 侧栏完全收起（width=0 非窄轨） | layout-ui App 集成：切 focus 后 `.sc-shell--collapsed` 存在（包侧 CSS：`display:none` + 列 `1fr`，未动包）；未引入任何窄轨列 |
| ③ 手柄装订线 gutter ≥ 8 | `pageview-gutter.test.ts` 全绿（537 内）；PageView.css 仅改 max-width 变量、未触 gutter 计算 |
| ④ 对比度门禁 | `packages/ui/test/contrast.test.ts` **9/9 绿**（零改色） |
| ⑤ 多页签(T37) / AI 面板(T38) 行为不变 | `tabs.test.tsx`（21）/ `ai-chat.test.tsx`（19）/ `ai-chat-context.test.ts`（16）全绿；新增断言：标签条显隐仅由布局控制（隐藏→恢复往返）、AI 面板默认展开仅在**无手动记录**时接管（显式收起 '0' 仍还原收起）、位置=hidden 时三入口（顶栏钮/Ctrl+J/命令）均无效 |

### §1.6 双主题截图 / no-magic / build-tokens

- 双主题 × 四态截图：**真机留 PM**（本单零改色，主题机制未动；自跑面已覆盖 no-magic/build-tokens/contrast）。
- `no-magic.mjs` ✓ 0 命中；`build-tokens.mjs --check` ✓ 一致（见 §0 表）。

## 4. DEVIATION（逐条，待 PM 追认）

1. **`--sc-layout-measure` 是新变量名但非 token**：在 PageView.css（apps 侧）消费，回退既有
   `--sc-space-editor-measure`；未动 packages 与 DESIGN.md。若 PM 认为该变量应升格为
   DESIGN.md layout token，请裁决（当前仅 apps 侧布局变量，报告 §2 列管）。
2. **三预设不携带主题**：任务书三预设定义未含主题 → `applyPreset` 保留当前主题；主题作为
   布局快照字段仅随导出/导入同步（导出时读 `septcats.theme` 真相源，导入经
   `setGlobalThemeMode` 应用），启动 init **不**用布局快照覆盖主题（避免双源打架）。
3. **参数手动微调 → `preset` 落 `'custom'`**：任务书未定义微调后预设归属；预设卡片高亮以
   「当前参数是否恰为该预设」表达（custom 时三卡全不亮）。导入 JSON 接受 `custom`。
4. **命令面板「切换布局预设」= 循环**（notion→focus→workbench→notion，custom→notion）+ toast
   反馈；未做选择子菜单（任务书允许「循环或选择」二选一）。
5. **AI 面板位置=hidden 的交互口径**：顶栏 Sparkle 钮不渲染、Ctrl+J 与命令「打开/关闭 AI
   对话」均无效（不是「点开但看不见」）；改回 右/底 后恢复。
6. **导出写剪贴板失败兜底**：`navigator.clipboard` 不可用/被拒时弹出只读 JSON textarea
   （全选即复制），不新增 IPC。
7. **导入用 Dialog + textarea 粘贴**而非直接 `clipboard.readText()`：Chromium 对
   `readText` 需 clipboard-read 权限且 Electron 默认授权行为不稳，textarea 粘贴（Ctrl+V）
   100% 可靠且同样满足「从剪贴板文本导入」口径。
8. **密度作用面**：行高（侧栏导航行）+ 间距（侧栏头部内边距）两处消费派生变量；标签条/
   内容区行距未挂密度（内容行距属编辑器域，apps 侧 CSS 不覆盖）。任务书「影响行高与间距
   档位」按最小可见面落地，如需扩面请 PM 圈定范围。
9. **settings-react.test.tsx**（既有）：`findByRole('radiogroup', {name:'主题'})` →
   `findAllByRole(...)[0]`（布局区块也有「主题」组，DOM 序外观在前；断言语义不变）。
10. **settings-react.test.tsx**（既有）：`getByText('深色')` → `within(外观主题组).getByText('深色')`
    （同上，选项名词双处出现；点击对象与断言不变）。
11. **App.tsx 侧栏开合持久化**：顶栏开合钮现在写入布局存储（原为会话内 useState 不持久）——
    语义增强：重启后侧栏开合态保持（T30 红线②口径不变：收起仍 = width 0）。
12. **`chatState.initPanel` 签名扩展**（默认参数 `defaultExpanded=false`）：既有调用语义不变
    （不传 = 原行为），无既有用例需改。

## 5. 未做 / 留 PM

1. **真机验收全节**（任务书 §3 真机证据 + §4 PM 收口）：三预设双主题截图、参数数值真机
   复核、重打包（先 `ensure-abi electron`）——（PM 补）。
2. §1 各项只到 jsdom/静态断言面（变量注入值、类名、存储快照），CSS 真实几何（列宽像素、
   面板高度 288px 渲染）未做真机量测——（PM 补）。
3. 未做：任意拖拽/浮动面板、多窗口、每页独立布局（任务书 §0.6 明确不做）✓；「重置为默认
   预设」独立按钮未做（循环命令 + 导入默认 JSON 可达，如需显式按钮请立单）。

## PM 复跑

> PM：Hermes ｜ 日期：2026-09-20 ｜ 产物：**rc.15**（`0.3.0-rc.15`，93,425,376 字节，
> sha256 `70076aa998fa8ed2519c9002c76584893b5869fef53f71c8a261e510ac22bcc7`）
> 口径：PM 独立复跑，**不采信工程师自报**；每条断言均有原始数值回显。

### 0. 门禁复核（全部独立重跑）

| 项 | PM 实测 | 与工程师自报 |
|---|---|---|
| `pnpm -r test` | **1156 passed / 1 skipped**（core 51 · platform 41 · ui 79 · schema 3 · sync 109 · editor 182 · dbview 95 · importer 59 · desktop **537**） | 一致 ✓ |
| `pnpm -r typecheck` | 9/9 Done | 一致 ✓ |
| `no-magic.mjs` | ✓ 0 命中 | 一致 ✓ |
| `build-tokens.mjs --check` | ✓ 产物与 DESIGN.md 一致 | 一致 ✓ |
| 红线越界核查 | `git status` **零** `packages/**` / `src/main/**` / `src/shared/**` 改动 | 一致 ✓ |
| 版本字段 | `0.3.0-rc.15`（由 rc.14 升） | — |

### 1. 真机验收（`docs/mockups/cdp-e2e-t39-01.mjs`，三开机次，双隔离）

**结果：21 PASS / 3 FAIL**；console 错误 0 条 / pageerror 0 条。
3 条 FAIL **同源于一个缺陷 T39-01-1**（下表 §3），非三项独立问题。

| 断言 | 实测数值 |
|---|---|
| B1 预设 notion | `--sc-layout-sidebar=240px` 实测侧栏 **239px** · `--sc-layout-measure=650px` · 侧栏可见 · AI 面板收起 |
| B2 预设 focus | 侧栏**完全收起 collapse=true 实测宽 0px** · measure **900px** · AI 面板收起 |
| B3 预设 workbench | 侧栏 239px · measure 650px · **AI 面板仍未出现（缺陷 T39-01-1）** |
| B5 存储 | `septcats.layout` = `{preset:'workbench', …}` ✓ |
| C1 宽度输入 100 | 变量 `200px` · 存储 `200` · 输入框回显 `"200"`（三面一致） |
| C2 宽度输入 999 | 变量 `320px` · 存储 `320` · 回显 `"320"` |
| C3 夹紧后**几何** | 实测渲染宽 **319px**（变量 320px，差 1px = 边框） |
| C4 measure 输入 9999 | 变量 `1000px` · 存储 `1000` |
| D1 导出反馈 | 「布局 JSON 已复制到剪贴板」（剪贴板可读 → D2 未走兜底） |
| D2 导出 vs 存储 | 规范化后**逐字段等价**（`theme` 除外，见 DEVIATION-2 追认） |
| D3 导入往返 | 改到 notion → 导入原 JSON → **规范化逐字段等价** ✓ 提示「布局已导入并应用」 |
| E1 非法导入 | `{bad json` → 「不是有效的 JSON：请粘贴完整的布局 JSON 文本，当前布局未改动」 |
| E2 非法导入后 | 布局快照**逐字段**与导入前全等（未改动） |
| G1 重开保持 | 布局**规范化全等**（含预设 custom / 宽度 280 / measure 650 / ai.expanded=true） |
| G2 重开参数 | 变量 `280px` · 实测渲染宽 **279px** |
| F1 红线① | 窗口零滚动 `overflow=0px`（浅/深 + 三预设态均 0） |
| F2 红线② | focus 下 `collapsed=true`、实测渲染宽 **0px**（真·完全收起，非窄轨） |
| F3 红线③ | **gutter = 12px** ≥ 8（簇 58×28，`.pv-body` 真机矩形量测；深色态量） |
| F4 红线⑤ | 标签条 `[data-testid=tabsbar]` 已渲染 ✓ |
| F5 红线⑤ | AI 面板可见性与布局推导值**不一致** → 同 T39-01-1 |
| H1/H2 深色 | `data-theme=dark` ✓ · 零滚动 ✓ |

### 2. 截图（`docs/mockups/screens-t39/`，12 张 + `t39-results.json`）

`light-00-boot` / `light-01-layout-section` / `light-02-preset-notion` / `light-03-preset-focus` /
`light-04-preset-workbench` / `light-05-import-error` / `light-06-collapsed` /
`dark-00-boot` / `dark-01-layout-section` / `dark-02-preset-focus` / `dark-03-preset-workbench` / `dark-04-gutter`

### 3. 新登记缺陷（PM 复跑发现）

**T39-01-1（P2，本单引入 · 规格偏差，未在 DEVIATION 中披露）**
- **症状**：切换布局预设时，**AI 面板可见性不即时生效**。切到「工作台」（`ai.expanded=true`）
  后 AI 面板**不出现**；切「专注」（收起）后若原本展开也**不收起**。其余三项（侧栏位置/宽度、
  内容 measure）**即时生效**，只有 AI 面板例外。
- **证据**：探针 B3/F5 —— 切换后 `localStorage['septcats.layout'].ai = {position:'right',expanded:true}`
  但编辑区 `.ai-chat` **不存在**；重启后同一布局下 `.ai-chat` 才出现（BOOT2 G1 态 `aiPanel=true`）。
- **根因**：`ai.expanded` 只在启动时经 `chatState.initPanel(layout.ai.expanded && position!=='hidden')`
  接管一次；**预设切换路径只写 store，不重新应用面板开合**。
- **与任务书冲突**：TASK-T39-01 §1.1 明确要求「预设切换**即时生效**（贴侧栏宽 / measure /
  **AI 面板可见性**数值）」。实现把它做成了「下次启动的默认态」（i18n `aiExpandedDesc` 写
  「重启后首次打开的默认状态」）——**属未披露的口径变更**，不追认。
- **处置**：立 T39-01-1 修复单，切预设时同步应用 `ai.expanded`（保持 `initPanel` 启动语义不变）。
- **探针断言有意保留为红**（3 条），修复后应转绿。

### 4. DEVIATION 追认

DEVIATION 1–12 **全部追认**，其中各点 PM 裁决：

| # | 裁决 |
|---|---|
| 1 | 追认。`--sc-layout-measure` 暂为 apps 侧布局变量（回退既有 token），**不**升格 DESIGN.md；若后续 workbench 需要独立内容宽度再单独立项。 |
| 2 | 追认。主题真相源唯一（`septcats.theme`），预设不携带主题、启动不被快照覆盖 —— 避免双源打架，口径正确。 |
| 3 | 追认。参数微调 → `custom` 且三卡全不亮，语义自洽。 |
| 4 | 追认。命令面板循环 + toast 满足「循环或选择」二选一。 |
| 5 | 追认（`hidden` 三入口全无效）。 |
| 6/7 | 追认。导出剪贴板失败兜底 + 导入用 Dialog textarea，均不新增 IPC，符合红线。 |
| 8 | 追认（密度作用面 = 侧栏行高 + 侧栏头内边距）。扩面另行立项。 |
| 9/10 | 追认（既有用例查询作用域收窄，语义不变）。 |
| 11 | 追认。侧栏开合纳入布局持久化是增强，T30 红线②口径不变。 |
| 12 | 追认（`initPanel` 默认参数，既有调用语义不变）。 |

### 5. PM 未覆盖 / 遗留

1. 真机未量测：密度档位切换后的**行高像素**（自动化面已断言档位变量，真机几何未量）。
2. 窄窗口（640px）下三预设的 AI 底部面板高度链未做真机回归（自动化面 `layout-invariants` 已绿）。
3. T39-01-1 修复后需重跑本探针（3 条红转绿）+ 重打包 rc.16。

### 6. T39-01-1 修复闭环（PM 复跑）

修复单交付后 PM **重跑同一探针**（未改考卷；渲染层改动后先 `pnpm -C apps/desktop build` 重建 out/）：

| 项 | 修复前 | 修复后 |
|---|---|---|
| 探针汇总 | 21 PASS / **3 FAIL** | **24 PASS / 0 FAIL** |
| B3 预设 workbench → AI 面板展开 | ✗ 面板未出现 | ✅ |
| B4 三预设真实差异 | ✗ | ✅ |
| F5 AI 面板可见性随布局 | ✗ 实测=false 期望=true | ✅ **实测=true 期望=true** |
| 门禁 | 1156 用例 | **1159 用例全绿**（desktop 537 → **540**，+3 修复用例） |
| typecheck / token 双门禁 | ✓ | ✓ |
| 红线越界核查 | — | 零 `packages/**`/`main/**`/`shared/**` 改动；**未动探针脚本** ✓ |
| console / pageerror | 0 / 0 | **0 / 0** |

**修复要点（已复核）**：新增 `aiChatActions.applyLayoutVisibility(expanded, positionHidden)`，
在 `applyPreset` 与 `importFromText` 的 `commit()` 之后调用；**不写** `septcats.aichat.panel`
手动记录（保住 T38「有手动记录以手动记录为准」的启动口径），`initPanel` 未动。
i18n `aiExpandedDesc` 双语同步改为「切换布局预设时即时生效（手动开合后以手动为准）」。

**结论：T39-01-1 关闭**。版本 → **rc.16**。探针截图与 `t39-results.json` 已按 rc.16 覆盖刷新。

## §PM 复跑后修复（T39-01-1）

### 1. 根因确认

与 PM 定位一致，无需重新排查：

- `App.tsx` 挂载 effect 经 `aiChatActions.initPanel(layout.ai.expanded && position !== 'hidden')`
  接管面板开合**一次**（App.tsx:149-152）；
- 预设切换路径 `layoutActions.applyPreset`（layoutState.ts）只 `commit()`（写 store + localStorage +
  CSS 变量注入），**不重新应用面板开合** → 切 workbench（`ai.expanded=true`）后 `.ai-chat` 不出现
  （探针 B3），切 focus 后原本展开的也不收起；重启后 `initPanel` 才按布局默认接管（BOOT2 G1 现象）。

### 2. 改法

- **`ai/chatState.ts`**：新增 `aiChatActions.applyLayoutVisibility(expanded, positionHidden)`——
  `expanded && !positionHidden → 展开，否则收起`（hidden 恒收起，与启动接管语义一致）。
  与 `setOpen` 的差别：**不写** `septcats.aichat.panel` 手动记录——该记录只由用户显式开合产生，
  T38 启动口径「有手动记录以记录为准」不被预设切换改写。
- **`layout/layoutState.ts`**：新增私有 `syncAiPanelVisibility(layout)`，在
  `applyPreset` 与 `importFromText` 的 `commit()` 之后调用（后者与预设同属「整份套用」路径）。
  `init()`（启动）**不调**——启动语义（无手动记录以布局默认接管）原样保留，`initPanel` 未改。
  命令面板 `cycleLayoutPreset` 走 `applyPreset`，自动同批生效。
- 未动：`packages/**`、`src/main/**`、`src/shared/**`、探针脚本、T39-01 已有报告节。

### 3. i18n `settings.layout.aiExpandedDesc` 前后

| 语言 | 改前 | 改后 |
|---|---|---|
| zh-CN | 重启后首次打开的默认状态（手动开合后以手动为准） | 切换布局预设时即时生效（手动开合后以手动为准） |
| en-US | Default state on first open after restart (manual toggles win afterwards) | Applied immediately when switching presets (manual toggles win afterwards) |

### 4. 测试（apps/desktop/test/layout-ui.test.tsx 新增 describe「T39-01-1」3 例）

1. 切 workbench → 编辑区 `.ai-chat` **即时出现**（DOM 面，非 store 断言）；从「开」态切 focus →
   即时收起；预设切换不写 `PANEL_OPEN_KEY`；模拟重启（`initPanel` 布局默认接管）仍展开。
2. `ai.position='hidden'` 布局经 `importFromText` 应用后仍不渲染；再切 workbench 即时渲染。
3. T38 回归：手动收起（记录='0'）后切 workbench 会话内展开但记录不被改写，重启仍收起。

### 5. 自跑原始数值（2026-09-20）

- `pnpm -C apps/desktop test`：`Test Files 49 passed (49)　Tests 540 passed (540)`，Duration 26.58s。
  含 T38 既有「手动收起后重启仍收起」（ai-chat.test.tsx「面板状态持久化」组）全绿。
- `pnpm -r typecheck`：13 个包/应用全部 `Done`（含 `apps/desktop` node+web 两 tsconfig）。
- `node packages/ui/tokens/no-magic.mjs`：`✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px`。
- `node packages/ui/tokens/build-tokens.mjs --check`：`✓ token 产物与 DESIGN.md 一致`。

### 6. DEVIATION（2 处，待 PM 追认）

- **D-13**：`importFromText`（导入布局）也同步了 AI 面板可见性——任务书只点名预设切换，
  但导入与预设同属「整份套用」路径，不同步则同一缺陷换个入口复发。探针 D3/E2 断言不受影响。
- **D-14**：预设切换**不写** `septcats.aichat.panel` 手动记录（选「接管但不留痕」口径）。
  推论：用户手动收起（记录='0'）后切 workbench，会话内面板展开，但重启后仍收起（手动记录为准）——
  与新 i18n 文案「手动开合后以手动为准」一致。若 PM 希望「重启与最后一次所见一致」，
  改为经 `setOpen` 写记录即可（一处改动），现有 3 例测试需同向调整。

### 7. 遗留

- 真机复跑探针 `node docs/mockups/cdp-e2e-t39-01.mjs`（3 条红应自然转绿）+ rc.16 重打包 —— 留 PM。
- `settings.layout.aiExpanded` 开关（`setAiExpanded`）仍只改默认值、不即时开合面板——属「参数微调」
  语义（落 `custom`），不在本单范围；若 PM 认为该开关也须即时生效，另立小单。
