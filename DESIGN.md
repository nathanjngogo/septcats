---
version: alpha
name: Septcats
description: 安静的、精确的、带一点猫须般灵巧的桌面书写工具。Linear 级克制 × 中文编辑部呼吸感。
colors:
  # ---- 浅色主题语义色（:root）----
  # T34-01：中性面全部换用 PM 对老板 Notion 截图逐像素采样的真值（docs/tasks/TASK-T34-01.md §0）。
  canvas: "#F9F8F7"        # 侧栏 + 顶栏（chrome 面；采样值，非白）
  surface: "#F1F0EF"       # 列表行悬停（采样推得，介于背景与选中之间）
  surface-raised: "#FFFFFF" # 弹层/输入框底
  content: "#FFFFFF"       # 内容区背景（采样值）
  surface-active: "#EEECEB" # 列表行选中（采样值）
  ink: "#2C2C2B"           # 主文字（采样值）
  ink-secondary: "#5F5E59" # 次级文字（采样值）
  ink-faint: "#6B6964"     # 弱化文字（文字级下限值；采样弱化色 #8E8B86 对比度 3.1 不达 AA，只准走 icon-faint）
  icon-faint: "#8E8B86"    # 图标/非文字弱化（采样值；禁用于任何正文级文字）
  hairline: "#EAE8E6"      # 采样值
  hairline-strong: "#D2D2CC"
  accent: "#A16207"        # 品牌琥珀铃铛不变（Notion 红 #FA5151 对 canvas 3.11 不达 AA，且无对应 UI 位，见 T34-01 报告 DEVIATION）
  accent-soft: "#F6EEDD"
  on-accent: "#FFFFFF"
  danger: "#8A2B1C"
  danger-soft: "#FBEFEC"
  success: "#3F6B34"
  focus-ring: "#A16207"
  selection: "#E8DDBC"
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
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
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
motion:
  fast: 120ms
  base: 200ms
  spring-stiffness: 100
  spring-damping: 20
---

## Overview

Septcats 是一款本地优先的块式笔记与轻量数据库工具。设计语言一句话：**安静的、精确的、带一点猫须般灵巧的桌面书写工具**。

- 画布即内容：编辑区不出现卡片、不出现装饰性容器；层级靠留白与发丝线（hairline），不靠阴影堆叠。
- 唯一的强调色是「琥珀铃铛」`accent`，它是品牌猫颈圈上的那颗铃铛（见计划书 §17）。**全应用同屏最多一个主强调动作**；其余动作一律 secondary/ghost。
- 中性色是暖灰家族（Notion 同构，T34-01 换采样真值）：chrome 面 `#F9F8F7`、内容区纯白 `#FFFFFF`、墨色 `#2C2C2B` 而非纯黑。禁纯 `#000` 作前景背景（内容区纯白为 PM 采样裁决的例外）。
- 动效只回答四个问题：层级、反馈、状态迁移、存在性确认。时长全部来自 `motion.*`，弹簧参数唯一。

### 深色主题映射（构建脚本据此生成 `[data-theme=dark]`；T34-01 按 Notion 深色同构，老板深色截图到位后 PM 再采样精修）

深色带 alpha 的采样值（主文字 `#FFFFFFE6`、弱化 `#FFFFFF7A`）以对侧栏底 `#202020` 合成后的 6-hex 落表：`#E9E9E9` /（弱化只走 icon-faint）`#8B8B8B`。

| token | light | dark | 备注 |
|---|---|---|---|
| canvas | #F9F8F7 | #202020 | 侧栏 + 顶栏（chrome 面）；深色同构采样值 |
| surface | #F1F0EF | #252525 | 行悬停；深色悬停为同构派生值（待深色截图复采） |
| surface-raised | #FFFFFF | #2E2E2E | 弹层/输入底 |
| content | #FFFFFF | #191919 | 内容区背景；深色同构采样值 |
| surface-active | #EEECEB | #2C2C2C | 行选中；深色同构派生值 |
| ink | #2C2C2B | #E9E9E9 | 深色 = #FFFFFFE6 合成 |
| ink-secondary | #5F5E59 | #A9A7A1 | 深色为同亮度暖灰（≥AA） |
| ink-faint | #6B6964 | #9C9A94 | 文字级弱化下限值，两主题 ≥AA |
| icon-faint | #8E8B86 | #8B8B8B | 深色 = #FFFFFF7A 合成；仅图标/非文字 |
| hairline | #EAE8E6 | #2F2F2F | 深色同构采样值 |
| hairline-strong | #D2D2CC | #424242 | |
| accent | #A16207 | #D9A441 | 品牌琥珀铃铛不变（Notion 红 #FA5151 不达 AA，见 DEVIATION） |
| on-accent | #FFFFFF | #1C1E21 | 深色铃铛上走墨色 |
| accent-soft | #F6EEDD | #33290F | 选中/软背景 |
| danger | #8A2B1C | #F2B8AD | |
| danger-soft | #FBEFEC | #3A1E1A | |
| success | #3F6B34 | #9CCB8F | |
| selection | #E8DDBC | #42381C | |
| shadow 族 | 墨色 12–28% | 提深至 40–60%，加 1px hairline-strong 上缘高光 | |

对比度红线（门禁：packages/ui/test/contrast.test.ts，WCAG AA 全部 ≥4.5）：T34-01 换 Notion 采样色后重测——浅色 ink-faint 最差对 4.82（/surface #F1F0EF），深色 ink-faint 最差对 4.83（/surface-raised #2E2E2E）；其余文字对（ink、ink-secondary、on-accent/accent、accent/canvas、danger、success）两主题均 ≥4.5。**icon-faint（#8E8B86/#8B8B8B）不是文字 token，禁用于任何正文级文字**（浅色对 canvas 仅 3.1），只准用于图标、三角、装饰性非文字元素。

## Colors

- **canvas / content / surface / surface-raised / surface-active**：五级平面。canvas = 侧栏 + 顶栏（chrome 面，T34-01 起与内容区分色）；content = 内容区背景；surface = 列表行悬停；surface-active = 列表行选中；surface-raised = 弹层与输入框底。
- **ink 三档 + icon-faint**：正文 ink，次级说明 ink-secondary，时间戳/占位/装饰 ink-faint（文字级下限，≥AA）。icon-faint（#8E8B86）只用于图标/三角/非文字弱化元素，**禁用于正文级文字**。ink-faint 禁用于任何必读信息。
- **accent（琥珀铃铛 #A16207）**：仅用于 ①主按钮底色 ②链接 hover ③同步进行中的呼吸点。侧栏列表行的选中态走中性 surface-active（Notion 同构，T34-01）；**禁止**大面积铺色、禁止渐变、禁止发光晕（glow）。
- **hairline**：1px 分隔线唯一来源。表格用横向 hairline，纵向不用。
- **danger / success**：只出现在状态语义位（删除确认、冲突、同步失败、完成对勾）。

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
- 应用壳：顶栏 40px · 侧栏 240px（可折叠至 48px 图标栏）· 内容区无内衬（编辑器自己控制 gutter）。侧栏与顶栏同底色（canvas），内容区用 content 白底（T34-01 Notion 对齐）。
- 侧栏列表行：高 28px、行内左右内边距 8px、圆角 6px；悬停 surface、选中 surface-active（选中可略加粗但不得失真）；分组标题用 ui-xs + ink-faint（图标 icon-faint）；底部工具行（回收站）弱化为 ink-faint。
- 编辑器水平节奏：块间距 `block-gap 6px`，列表项内间距 2px，前后标题额外 `xl` 上浮。
- 数据库表格：行高 36px，表头 32px，列宽最小 96px，数值列右对齐 mono。
- 响应式（窗口缩放而非断点设备）：<1100px 自动收起侧栏；<900px 表格横向滚动 + 冻结首列。

## Elevation & Depth

- 只允许两处阴影：popover/menu、modal（见 front matter）。其余层级用 hairline + surface 色阶表达。
- 阴影颜色继承 ink 家族并降透明度（tinted），禁纯黑阴影。
- z-index 刻度：dropdown 20 / sticky-bar 30 / dialog 40 / toast 50 / drop-indicator 60。业务代码只引用刻度常量。

## Shapes

- 圆角家族：控件 sm(6px)、卡片浮层 md(8px)、模态 lg(12px)、chip/full pill。同层组件必须同圆角；混用需书面理由。
- 猫形语言仅一处例外：顶栏「铃铛」同步状态点用 `full` + 呼吸动画（motion.fast 淡入淡出，reduced-motion 下静态）。

## Components

- `button-primary`: backgroundColor `{colors.accent}`, textColor `{colors.on-accent}`, rounded `{rounded.sm}`, height 32px(md)/28px(sm), padding-x `{spacing.md}`；hover: accent 提亮 6%；**active: translateY(1px)**；focus-visible: 2px `{colors.focus-ring}` 外环 offset 2px。
- `button-secondary`: backgroundColor `{colors.surface-raised}`, textColor `{colors.ink}`, border 1px `{colors.hairline-strong}`。
- `button-ghost`: 透明底，hover `{colors.surface}`，用于工具条/图标钮。
- `input`: backgroundColor `{colors.surface-raised}`, border 1px `{colors.hairline}`, focus 时 border→`{colors.accent}` + focus-ring；错误态 border `{colors.danger}`，错误文案在输入框下方 `ui-xs` danger（**label 在上、helper 中、error 下**的固定结构）。
- `block-handle`（编辑器）：宽 24px，hover 显现（motion.fast），图标 `ink-faint`；拖拽时显示 2px accent 插入线（圆角 full）。
- `command-palette`: 宽 560px 居中偏上 20vh，`elevation.shadow-modal`，圆角 lg；输入行 40px，结果行 36px，选中行左侧 3px accent 条。
- `breadcrumb`（顶栏）：字号走 ui-md（14px，T34-01 Notion 对齐）；当前页 ink 加粗 500，祖先 ink-secondary，分隔符 ink-faint。
- `sync-status`（顶栏）：三态——静止灰点（已同步）/ 琥珀呼吸点（进行中）/ danger 点+计数角标（需处理）。tooltip 文案含「上次同步 HH:mm」，兑现 §16「异步可靠同步」叙事。
- `toast`: 底部居中堆叠，3 条可见，surface-raised + shadow-popover，图标按语义色。
- 四态强制：每个数据视图必须实现 `EmptyState`（插画占位 + 一句动作导向文案 + 主按钮）、`Skeleton`（形似最终布局，禁通用转圈）、`ErrorPanel`（说明 + 重试）、成功静默（toast 仅不可自动恢复时）。

## Do's and Don'ts

- Do：先改 DESIGN.md 再改任何样式代码；tokens 构建脚本是唯一翻译层。
- Do：所有可点元素有 hover、active、focus-visible 三态；所有列表有空态。
- Do：深浅主题同一 PR 内同时截图自检（§16.3）。
- Don't：写死 hex；Don't：用 Inter 或任何在线字体（字体固定为自托管思源黑体 Noto Sans SC，禁 CDN/远程 font-face，T50-01 §16.5）；Don't：AI 紫、渐变按钮、毛玻璃大面积铺、装饰性彩色圆点、em-dash 堆叠的文案。
- Don't：animate `width/height/top/left`；Don't：linear 缓动（全部 spring 或 `cubic-bezier(0.16,1,0.3,1)` 近似）。
- Don't：emoji 当图标；图标只用 Icon.tsx（Phosphor, strokeWidth 1.5，尺寸档 16/20/24）。
