---
version: alpha
name: Septcats
description: 安静的、精确的、带一点猫须般灵巧的桌面书写工具。Linear 级克制 × 中文编辑部呼吸感。
colors:
  # ---- 浅色主题语义色（:root）----
  # T53-01：老板 09-21「整体黑白灰」——中性轴退役 T34-01 的 Notion 暖灰采样值，全轴灰阶化。
  # 色板起板 = 任务书附录 A；门禁（packages/ui/test/contrast.test.ts）实跑为最终定论。
  canvas: "#F5F5F5"        # 侧栏 + 顶栏（chrome 面）
  surface: "#EDEDED"       # 列表行悬停（介于背景与选中之间）
  surface-raised: "#FFFFFF" # 弹层/输入框底
  content: "#FFFFFF"       # 内容区背景
  surface-active: "#DFDFDF" # 列表行选中
  ink: "#1A1A1A"           # 主文字（禁纯 #000）
  ink-secondary: "#595959" # 次级文字
  ink-faint: "#6B6B6B"     # 弱化文字（文字级下限值；附录 A 起点 #757575 对 surface 仅 3.94 不过门禁，按 §2 提档预案落 #6B6B6B → 4.55）
  icon-faint: "#9A9A9A"    # 图标/非文字弱化（对 canvas 2.58，按 T34-01 裁决不进文字门禁；禁用于任何正文级文字）
  hairline: "#DDDDDD"
  hairline-strong: "#C4C4C4"
  accent: "#333333"        # T53-01 灰阶化：琥珀铃铛退役，强调改走明度差（深灰实心）；语义色只留 danger/success 两粒
  accent-soft: "#E6E6E6"
  on-accent: "#FFFFFF"
  danger: "#8A2B1C"        # 语义粒 1/2：错误红（最小落点，见 Components）
  danger-soft: "#F5E5E1"
  success: "#3F6B34"       # 语义粒 2/2：同步绿（最小落点，见 Components）
  focus-ring: "#1A1A1A"
  selection: "#D4D4D4"
  # ---- 像素风立体语法色（T53-01：硬边亮暗面 + 实心无模糊投影；几何在 elevation 组）----
  bevel-hi: "#FFFFFF"      # 上/左 2px 硬边高亮
  bevel-lo: "#A9A9A9"      # 下/右 2px 硬边暗部
  shadow-pixel: "#C6C6C6"  # offset 投影唯一来源（无 blur）
  # ---- 深色主题覆盖值不写在这里：由 tokens 构建脚本从 colors-dark 组生成 [data-theme=dark] ----
typography:
  font-ui:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
  font-serif-note:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
  font-mono:
    fontFamily: "Geist Mono, Sarasa Mono SC, Microsoft YaHei Mono, Consolas, monospace"
  editor-body:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "0.01em"
  h1:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: 28px
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  h2:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: 22px
    fontWeight: 620
    lineHeight: 1.35
    letterSpacing: "-0.005em"
  h3:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
  ui-sm:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.5
  ui-md:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: 14px
    fontWeight: 450
    lineHeight: 1.5
  ui-xs:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: 12px
    fontWeight: 450
    lineHeight: 1.5
  code:
    fontFamily: "Geist Mono, Sarasa Mono SC, Microsoft YaHei Mono, Consolas, monospace"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
rounded:
  # T53-01 像素风：控件走 2px 微圆角；浮层各级同步收一档（直角与 2px 微圆角，禁大圆角胶囊化）
  xs: 2px
  sm: 2px
  md: 4px
  lg: 6px
  xl: 8px
  full: 999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  gutter: 40px
  block-gap: 6px
  editor-measure: 720px
elevation:
  shadow-popover: "0 8px 24px -12px rgba(28,30,33,0.18), 0 2px 6px rgba(28,30,33,0.06)"
  shadow-modal: "0 24px 64px -16px rgba(28,30,33,0.28), 0 4px 12px rgba(28,30,33,0.08)"
  shadow-tinted-light: "0 1px 2px rgba(28,30,33,0.05)"
  # ---- T53-01 像素风立体语法（全 token，组件 CSS 零字面量）----
  # bevel-*：硬边 2px 亮暗面（inset，上/左 = hi，下/右 = lo）；*--in 为按压态亮暗对调
  # pixel-*：实心 offset 投影（x y blur=0 spread=0），禁 blur —— 立体感的唯一投影来源
  bevel-out: "inset 2px 2px 0 0 var(--sc-color-bevel-hi), inset -2px -2px 0 0 var(--sc-color-bevel-lo)"
  bevel-in: "inset 2px 2px 0 0 var(--sc-color-bevel-lo), inset -2px -2px 0 0 var(--sc-color-bevel-hi)"
  pixel-out: "2px 2px 0 0 var(--sc-color-shadow-pixel), inset 2px 2px 0 0 var(--sc-color-bevel-hi), inset -2px -2px 0 0 var(--sc-color-bevel-lo)"
  pixel-flat: "2px 2px 0 0 var(--sc-color-shadow-pixel)"
motion:
  fast: 120ms
  base: 200ms
  spring-stiffness: 100
  spring-damping: 20
---

## Overview

Septcats 是一款本地优先的块式笔记与轻量数据库工具。设计语言一句话：**安静的、精确的、带一点猫须般灵巧的桌面书写工具**。

- 画布即内容：编辑区不出现卡片、不出现装饰性容器；层级靠留白与发丝线（hairline），不靠阴影堆叠。
- 唯一的强调色是「琥珀铃铛」`accent`，它是品牌猫颈圈上的那颗铃铛（见计划书 §17）。**全应用同屏最多一个主强调动作**；其余动作一律 secondary/ghost。**T53-01 起铃铛退役**：`accent` 灰阶化为深灰实心（强调靠明度差 + 描边，不再靠色相），token 名保留。
- 中性色是**纯灰阶**（T53-01 老板「整体黑白灰」）：chrome 面 `#F5F5F5`、内容区纯白 `#FFFFFF`、墨色 `#1A1A1A` 而非纯黑。禁纯 `#000` 作前景背景（内容区纯白为既有裁决的例外）。
- **语义色只剩两粒**（T53-01 §0）：错误红 `danger`、同步绿 `success`，只准落在小图标/短文案/状态点上，禁大面积铺色。其余状态一律明度差 + 描边 + 像素立体。
- **立体语法 = 像素风**：硬边 2px 亮暗面（`bevel-*`）+ 实心无模糊 offset 投影（`pixel-*`）+ 2px 微圆角；按下 = 整体下沉 2px 且亮暗面对调（`bevel-in`）。字面量禁入 CSS，全部走 token。
- 动效只回答四个问题：层级、反馈、状态迁移、存在性确认。时长全部来自 `motion.*`，弹簧参数唯一。

### 深色主题映射（构建脚本据此生成 `[data-theme=dark]`；T53-01 灰阶双主题，附录 A 深色列）

| token | light | dark | 备注 |
|---|---|---|---|
| canvas | #F5F5F5 | #141414 | 侧栏 + 顶栏（chrome 面） |
| surface | #EDEDED | #1E1E1E | 行悬停 |
| surface-raised | #FFFFFF | #262626 | 弹层/输入底 |
| content | #FFFFFF | #0A0A0A | 内容区背景 |
| surface-active | #DFDFDF | #2A2A2A | 行选中 |
| ink | #1A1A1A | #EDEDED | |
| ink-secondary | #595959 | #A8A8A8 | |
| ink-faint | #6B6B6B | #909090 | 文字级弱化下限值，两主题 ≥AA（提档后） |
| icon-faint | #9A9A9A | #6E6E6E | 仅图标/非文字 |
| hairline | #DDDDDD | #2E2E2E | |
| hairline-strong | #C4C4C4 | #3F3F3F | |
| accent | #333333 | #D4D4D4 | 灰阶化后的「强调」（明度差 + 描边） |
| on-accent | #FFFFFF | #141414 | 深色走墨色 |
| accent-soft | #E6E6E6 | #333333 | 选中/软背景 |
| danger | #8A2B1C | #F2B8AD | 语义粒：错误红 |
| danger-soft | #F5E5E1 | #3A1E1A | |
| success | #3F6B34 | #9CCB8F | 语义粒：同步绿 |
| focus-ring | #1A1A1A | #EDEDED | 灰阶焦点环（与 ink 同值，token 名独立） |
| selection | #D4D4D4 | #3A3A3A | |
| bevel-hi | #FFFFFF | #565656 | 像素高亮面 |
| bevel-lo | #A9A9A9 | #0A0A0A | 像素暗部 |
| shadow-pixel | #C6C6C6 | #050505 | 实心 offset 投影 |
| shadow 族 | 墨色 12–28% | 提深至 40–60%，加 1px hairline-strong 上缘高光 | 仅 popover/modal/tinted-light 三处浮层阴影；按钮立体走 bevel/pixel 组 |

对比度红线（门禁：packages/ui/test/contrast.test.ts，WCAG AA 全部 ≥4.5）：T53-01 灰阶化后重测——门禁配对表**逐对全过**，最差对为浅色 ink-faint/surface 4.55（提档前 #757575 仅 3.94）；其余文字对（ink、ink-secondary 两主题 × canvas/surface/surface-raised/content）与 `on-accent/accent`、`accent|danger|success` 对 canvas 两主题均 ≥4.5。**icon-faint（#9A9A9A/#6E6E6E）不是文字 token，禁用于任何正文级文字**（浅色对 canvas 仅 2.58），只准用于图标、三角、装饰性非文字元素。

## Colors

- **canvas / content / surface / surface-raised / surface-active**：五级灰阶平面。canvas = 侧栏 + 顶栏（chrome 面）；content = 内容区背景；surface = 列表行悬停；surface-active = 列表行选中；surface-raised = 弹层与输入框底。层级只靠明度差，禁色相区分。
- **ink 三档 + icon-faint**：正文 ink，次级说明 ink-secondary，时间戳/占位/装饰 ink-faint（文字级下限，≥AA）。icon-faint（#9A9A9A）只用于图标/三角/非文字弱化元素，**禁用于正文级文字**。ink-faint 禁用于任何必读信息。
- **accent（灰阶 #333333/#D4D4D4）**：T53-01 琥珀退役后，`accent` 只表达「实心强调底」（主按钮、勾选框选中底、开关 on 态、进度填充、spinner 头）。**强调态一律靠明度差 + 描边**（活动标签 = content 底 + 无分隔线；选中行 = surface-active + 字重；焦点 = focus-ring 外环）；**禁止**大面积铺色、禁止渐变、禁止发光晕（glow）。
- **两粒语义色**：`danger`（错误红）落点 = 删除确认/冲突/同步失败/表单错误/危险菜单项；`success`（同步绿）落点 = 同步进行中呼吸点/同步完成点/toast 成功图标。两处之外禁用色相。
- **bevel-hi / bevel-lo / shadow-pixel**：像素立体的三个色源——高亮面、暗部、实心投影。只准被 `elevation.bevel-*` / `elevation.pixel-*` 组合引用。
- **hairline**：1px 分隔线唯一来源。表格用横向 hairline，纵向不用。

## Typography

- 一个无衬线家族统治全应用（**自托管思源黑体**：Noto Sans SC 可变体随包分发，禁一切在线字体 + CJK 系统栈兜底；T50-01 §16.5）。**衬线禁用**——「笔记本感」由排版密度与纸色达成，不靠字体装腔（design-taste-frontend 的 serif discipline）。
- 字重梯度小而准：400 正文 / 450–500 UI / 600–650 标题。层级靠颜色与间距，不靠字号轰炸；H1 28px 封顶。
- **中文排印规则（编辑器强制）**：
  1. 中西文之间加 `0.15em` 间隙（CSS: 文本节点包裹 `span.cjk-gap`，或 `font-feature-settings` + JS 预处理，实现层统一提供）。
  2. 行首禁则：标点（，。、；：！？》」』）不得出现在行首；行尾标点悬挂 `text-spacing-trim: trim-start;`（Chromium 不支持时用 JS 首字缩进兜底）。
  3. 正文 16px/1.75，行长上限 `editor-measure 720px`，居中；侧栏与表格 UI 用 `ui-sm/ui-xs`。
  4. 数字与日期一律 font-mono（表格单元格、相对时间、文件大小）。
- 编辑器内块类型字阶：page-title 28/650 · h1 22 · h2 18 · h3 16/600 · body 16/400 · code 14 mono · caption 12/ink-faint。

## Layout

- 8px 基准栅格；间距只允许 `spacing.*`。
- 应用壳：顶栏 40px · 侧栏 240px（可折叠至 48px 图标栏）· 内容区无内衬（编辑器自己控制 gutter）。侧栏与顶栏同底色（canvas），内容区用 content 白底（T53-01 灰阶两档）。
- 侧栏列表行：高 28px、行内左右内边距 8px、圆角 6px；悬停 surface、选中 surface-active（选中可略加粗但不得失真）；分组标题用 ui-xs + ink-faint（图标 icon-faint）；底部工具行（回收站）弱化为 ink-faint。
- 编辑器水平节奏：块间距 `block-gap 6px`，列表项内间距 2px，前后标题额外 `xl` 上浮。
- 数据库表格：行高 36px，表头 32px，列宽最小 96px，数值列右对齐 mono。
- 响应式（窗口缩放而非断点设备）：<1100px 自动收起侧栏；<900px 表格横向滚动 + 冻结首列。

## Elevation & Depth

- 浮层阴影只允许两处：popover/menu、modal（见 front matter）。其余层级用 hairline + surface 色阶表达。
- 浮层阴影颜色继承 ink 家族并降透明度（tinted），禁纯黑阴影。
- **控件立体只允许 bevel/pixel 组**（T53-01）：`bevel-out` = 上/左 2px 高亮 + 下/右 2px 暗部；`pixel-out` = 其上再叠 2px 实心 offset 投影（**blur 恒为 0**）；`bevel-in` = 亮暗对调（按压/凹陷）。**禁**在控件上使用任何带 blur 的阴影、禁多层软阴影堆叠。
- 按压态 = `bevel-in` + 整体位移 2px（下/右），位移量恰等于 offset 投影量（视觉上「压进自己的影子里」）。
- z-index 刻度：dropdown 20 / sticky-bar 30 / dialog 40 / toast 50 / drop-indicator 60。业务代码只引用刻度常量。

## Shapes

- 圆角家族（T53-01 像素化）：控件 xs/sm(2px) · 浮层 md(4px) · 模态 lg(6px) · 大浮层 xl(8px) · chip/full pill。同层组件必须同圆角；混用需书面理由。
- **像素风约束**：交互件圆角一律 ≤2px（直角或 2px 微圆角），禁止大圆角胶囊化按钮；`full` 只留给 pill（标签/状态点/开关轨/进度条）。
- 猫形语言仅一处例外：顶栏「铃铛」同步状态点用 `full` + 呼吸动画（motion.fast 淡入淡出，reduced-motion 下静态）。

## Components

- **像素立体基线（T53-01，全交互件）**：`box-shadow: {elevation.pixel-out}`（或 `{elevation.bevel-out}`）、`border-radius: {rounded.sm}`（2px）；`:active:not(:disabled)` → `box-shadow: {elevation.bevel-in}` + `transform: translate(2px, 2px)`（下沉 + 亮暗对调）；`:focus-visible` → 2px `{colors.focus-ring}` 外环 offset 2px。过渡含 `box-shadow`，时长 `{motion.fast}`，缓动 `{ease-out}`。
- `button-primary`: backgroundColor `{colors.accent}`（深灰实心）, textColor `{colors.on-accent}`, rounded `{rounded.sm}`, height 32px(md)/28px(sm), padding-x `{spacing.md}`；hover: 明度提亮 6%（brightness）+ `{elevation.pixel-out}`；active 见基线。
- `button-secondary`: backgroundColor `{colors.surface-raised}`, textColor `{colors.ink}`, border 1px `{colors.hairline-strong}`；立体走 `{elevation.pixel-out}`。
- `button-ghost`: 透明底，hover `{colors.surface}` + `{elevation.bevel-out}`（无 offset 投影，避免工具条抖动）；active 同基线但只走 `{elevation.bevel-in}`。
- `input`: backgroundColor `{colors.surface-raised}`, border 1px `{colors.hairline}`, rounded `{rounded.sm}`；hover border→`{colors.hairline-strong}`；**focus 时 border→`{colors.ink}` + `{elevation.bevel-in}`**（凹陷即焦点语义，替掉原 accent 边框）；错误态 border `{colors.danger}`，错误文案在输入框下方 `ui-xs` danger（**label 在上、helper 中、error 下**的固定结构）。
- `block-handle`（编辑器）：宽 24px，hover 显现（motion.fast），图标 `ink-faint`；拖拽时显示 2px accent 插入线（圆角 full）。
- `command-palette`: 宽 560px 居中偏上 20vh，`elevation.shadow-modal`，圆角 lg；输入行 40px，结果行 36px，选中行左侧 3px accent 条。
- `breadcrumb`（顶栏）：字号走 ui-md（14px）；当前页 ink 加粗 500，祖先 ink-secondary，分隔符 ink-faint。
- `sync-status`（顶栏）：五态——静止灰点（已同步）/ **同步进行中 = success 绿呼吸点** / 完成 = success 绿点 / 部分降级 = 灰点 + 2px surface-active 描边环（明度差方案）/ 需处理 = danger 红点 + 计数角标。tooltip 文案含「上次同步 HH:mm」，兑现 §16「异步可靠同步」叙事。
- `toast`: 底部居中堆叠，3 条可见，surface-raised + shadow-popover，图标按语义色（成功绿 / 失败红 / 其余 ink-secondary）。
- 四态强制：每个数据视图必须实现 `EmptyState`（插画占位 + 一句动作导向文案 + 主按钮）、`Skeleton`（形似最终布局，禁通用转圈）、`ErrorPanel`（说明 + 重试）、成功静默（toast 仅不可自动恢复时）。

## Do's and Don'ts

- Do：先改 DESIGN.md 再改任何样式代码；tokens 构建脚本是唯一翻译层。
- Do：所有可点元素有 hover、active、focus-visible 三态；所有列表有空态。
- Do：交互件一律吃 `{elevation.pixel-out}` / `{elevation.bevel-*}`（像素立体），按压必须给「下沉 + 亮暗对调」反馈。
- Do：深浅主题同一 PR 内同时截图自检（§16.3）。
- Don't：写死 hex；Don't：用 Inter 或任何在线字体（字体固定为自托管思源黑体 Noto Sans SC，禁 CDN/远程 font-face，T50-01 §16.5）；Don't：AI 紫、渐变按钮、毛玻璃大面积铺、装饰性彩色圆点、em-dash 堆叠的文案。
- Don't：**任何色相**（除 danger/success 两粒）——状态一律走明度差 + 描边；Don't：控件上用带 blur 的阴影或大圆角胶囊按钮（像素风红线）。
- Don't：animate `width/height/top/left`；Don't：linear 缓动（全部 spring 或 `cubic-bezier(0.16,1,0.3,1)` 近似）。
- Don't：emoji 当图标；图标只用 Icon.tsx（Phosphor, strokeWidth 1.5，尺寸档 16/20/24）。
