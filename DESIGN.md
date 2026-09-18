---
version: alpha
name: Septcats
description: 安静的、精确的、带一点猫须般灵巧的桌面书写工具。Linear 级克制 × 中文编辑部呼吸感。
colors:
  # ---- 浅色主题语义色（:root） ----
  canvas: "#FBFBFA"
  surface: "#F4F4F2"
  surface-raised: "#FFFFFF"
  ink: "#1C1E21"
  ink-secondary: "#5B6068"
  ink-faint: "#666C75"
  hairline: "#E6E6E2"
  hairline-strong: "#D2D2CC"
  accent: "#A16207"
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
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
  font-serif-note:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
  font-mono:
    fontFamily: "Geist Mono, Sarasa Mono SC, Microsoft YaHei Mono, Consolas, monospace"
  editor-body:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "0.01em"
  h1:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: 28px
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  h2:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: 22px
    fontWeight: 620
    lineHeight: 1.35
    letterSpacing: "-0.005em"
  h3:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
  ui-sm:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.5
  ui-xs:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
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
- 中性色是冷灰家族（zinc 倾向），纸面 `#FBFBFA` 而非纯白，墨色 `#1C1E21` 而非纯黑。禁纯 `#000` / `#fff` 作前景背景。
- 动效只回答四个问题：层级、反馈、状态迁移、存在性确认。时长全部来自 `motion.*`，弹簧参数唯一。

### 深色主题映射（构建脚本据此生成 `[data-theme=dark]`）

| token | light | dark | 备注 |
|---|---|---|---|
| canvas | #FBFBFA | #16181B | 非纯黑 |
| surface | #F4F4F2 | #1E2124 | |
| surface-raised | #FFFFFF | #26292D | 弹层/输入底 |
| ink | #1C1E21 | #E9E9E6 | |
| ink-secondary | #5B6068 | #A3A8AF | ≥AA |
| ink-faint | #666C75 | #8E94A0 | ≥AA（4.5+） |
| hairline | #E6E6E2 | #2C2F34 | |
| hairline-strong | #D2D2CC | #3B3F45 | |
| accent | #A16207 | #D9A441 | 深色提亮，同色相 |
| on-accent | #FFFFFF | #1C1E21 | 深色铃铛上走墨色 |
| accent-soft | #F6EEDD | #33290F | 选中/软背景 |
| danger | #8A2B1C | #F2B8AD | |
| danger-soft | #FBEFEC | #3A1E1A | |
| success | #3F6B34 | #9CCB8F | |
| selection | #E8DDBC | #42381C | |
| shadow 族 | 墨色 12–28% | 提深至 40–60%，加 1px hairline-strong 上缘高光 | |

对比度红线（门禁：packages/ui/test/contrast.test.ts，WCAG AA 全部 ≥4.5）：浅色 ink-faint 最差对 4.81（/surface，原 #8A8F98 时 2.95 不达标）· 深色 ink-faint 最差对 4.80（/surface-raised，原 #6E737B 时 3.06 不达标）；其余文字对（ink、ink-secondary、on-accent/accent、accent/canvas、danger、success）两主题均 ≥4.75。

## Colors

- **canvas / surface / surface-raised**：三级平面。编辑画布永远用 canvas；侧栏与列表行 hover 用 surface；浮层与输入框底用 surface-raised。
- **ink 三档**：正文 ink，次级说明 ink-secondary，时间戳/占位/装饰 ink-faint。ink-faint 禁用于任何必读信息。
- **accent（琥珀铃铛 #A16207）**：仅用于 ①主按钮底色 ②当前选中指示 ③链接 hover ④同步进行中的呼吸点。**禁止**大面积铺色、禁止渐变、禁止发光晕（glow）。
- **hairline**：1px 分隔线唯一来源。表格用横向 hairline，纵向不用。
- **danger / success**：只出现在状态语义位（删除确认、冲突、同步失败、完成对勾）。

## Typography

- 一个无衬线家族统治全应用（Geist + CJK 系统栈）。**衬线禁用**——「笔记本感」由排版密度与纸色达成，不靠字体装腔（design-taste-frontend 的 serif discipline）。
- 字重梯度小而准：400 正文 / 450–500 UI / 600–650 标题。层级靠颜色与间距，不靠字号轰炸；H1 28px 封顶。
- **中文排印规则（编辑器强制）**：
  1. 中西文之间加 `0.15em` 间隙（CSS: 文本节点包裹 `span.cjk-gap`，或 `font-feature-settings` + JS 预处理，实现层统一提供）。
  2. 行首禁则：标点（，。、；：！？》」』）不得出现在行首；行尾标点悬挂 `text-spacing-trim: trim-start;`（Chromium 不支持时用 JS 首字缩进兜底）。
  3. 正文 16px/1.75，行长上限 `editor-measure 720px`，居中；侧栏与表格 UI 用 `ui-sm/ui-xs`。
  4. 数字与日期一律 font-mono（表格单元格、相对时间、文件大小）。
- 编辑器内块类型字阶：page-title 28/650 · h1 22 · h2 18 · h3 16/600 · body 16/400 · code 14 mono · caption 12/ink-faint。

## Layout

- 8px 基准栅格；间距只允许 `spacing.*`。
- 应用壳：顶栏 40px · 侧栏 240px（可折叠至 48px 图标栏）· 内容区无内衬（编辑器自己控制 gutter）。
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
- `sync-status`（顶栏）：三态——静止灰点（已同步）/ 琥珀呼吸点（进行中）/ danger 点+计数角标（需处理）。tooltip 文案含「上次同步 HH:mm」，兑现 §16「异步可靠同步」叙事。
- `toast`: 底部居中堆叠，3 条可见，surface-raised + shadow-popover，图标按语义色。
- 四态强制：每个数据视图必须实现 `EmptyState`（插画占位 + 一句动作导向文案 + 主按钮）、`Skeleton`（形似最终布局，禁通用转圈）、`ErrorPanel`（说明 + 重试）、成功静默（toast 仅不可自动恢复时）。

## Do's and Don'ts

- Do：先改 DESIGN.md 再改任何样式代码；tokens 构建脚本是唯一翻译层。
- Do：所有可点元素有 hover、active、focus-visible 三态；所有列表有空态。
- Do：深浅主题同一 PR 内同时截图自检（§16.3）。
- Don't：写死 hex；Don't：用 Inter（字体占位 Geist，若授权受阻用系统栈首字族，由 PM 另行换发）；Don't：AI 紫、渐变按钮、毛玻璃大面积铺、装饰性彩色圆点、em-dash 堆叠的文案。
- Don't：animate `width/height/top/left`；Don't：linear 缓动（全部 spring 或 `cubic-bezier(0.16,1,0.3,1)` 近似）。
- Don't：emoji 当图标；图标只用 Icon.tsx（Phosphor, strokeWidth 1.5，尺寸档 16/20/24）。
