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
  # ---- 像素边框色（T59-01 立 · T62-01 扩到全程序框线；唯一色源，与 ink 同值但语义独立，详见「Pixel Borders」）----
  ink-edge: "#1A1A1A"      # 框线描边（浅色 = 黑边）：外框 2px / 内部网格与分隔线 1px
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
    # UI 评估（Apple §15 字距随字号）：18px 仍属大字号 → 轻微收紧
    letterSpacing: "-0.002em"
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
- 唯一的强调色是 `accent`。**全应用同屏最多一个主强调动作**；其余动作一律 secondary/ghost。**T53-01 起「琥珀铃铛」退役**：`accent` 灰阶化为深灰实心（强调靠明度差 + 描边，不再靠色相），token 名保留；**T55-02 起品牌图形标也不再向 UI 供色**（猫标只在应用图标/托盘图标等品牌资产里出现，见下「品牌」节）。
- 中性色是**纯灰阶**（T53-01 老板「整体黑白灰」）：chrome 面 `#F5F5F5`、内容区纯白 `#FFFFFF`、墨色 `#1A1A1A` 而非纯黑。禁纯 `#000` 作前景背景（内容区纯白为既有裁决的例外）。
- **语义色只剩两粒**（T53-01 §0）：错误红 `danger`、同步绿 `success`，只准落在小图标/短文案/状态点上，禁大面积铺色。其余状态一律明度差 + 描边 + 像素立体。
- **立体语法 = 像素风**：硬边 2px 亮暗面（`bevel-*`）+ 实心无模糊 offset 投影（`pixel-*`）+ 2px 微圆角；按下 = 整体下沉 2px 且亮暗面对调（`bevel-in`）。字面量禁入 CSS，全部走 token。
- 动效只回答四个问题：层级、反馈、状态迁移、存在性确认。时长全部来自 `motion.*`，弹簧参数唯一。

### 品牌（T55-02 · 覆盖计划书 §17 旧「单线描猫 + 铃铛」决议）

- **图形标 = 3D 像素浮雕布偶猫**：正面 28×28 像素语法（元重叠绘制 + 右下 1 格挤出浮雕 + 每格上/左亮 bevel、下/右暗 bevel），**白底圆角**（托盘子型直角满幅）、**黑白灰**（零彩色——布偶猫特征全靠明度差：重点色深灰 / 身体浅灰 / 胸毛袜白 / 眼黑带白高光）。
- **三变体 A/B/C 供老板三选一，默认 C（侧位版）已接线**为应用图标；**托盘用 16px 原生简化子型 T**（1 格 = 1 物理像素，只保「双尖耳 + 面罩大眼 + 圆头」三指纹，Tail/脚/胸在 16px 取舍掉）。
- 尺寸档：A/B/C = 16/32/48/256；T = 16/24/32。装包 `.ico` 五层 = **T16/T24/T32 + C48/C256**（全 PNG 表项）。
- 生成、质检断言、A/B/C/T 对应关系与换型命令：见 `assets/brand/README.md`（本目录为设计资产真源，勿手改）。
- 品牌资产属 §16.6 的**唯一例外**（非 UI 图标族，不并入仓内像素图标族；见「Icons」节），改动须重新批准。
- UI 内的猫形语言仍只有一处：`sync-status` 状态点（`full` 圆点 + 呼吸动画），与图形标无耦合。

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
| ink-edge | #1A1A1A | #EDEDED | 框线描边唯一色源（T59-01 立「区域边界」，T62-01 扩到**全程序所有框**）。**深色取亮边**：近黑底（#141414/#0A0A0A）上黑描边等于不可见，改以亮边描述轮廓——见「Pixel Borders」 |
| shadow 族 | 墨色 12–28% | 提深至 40–60%，加 1px hairline-strong 上缘高光 | 仅 popover/modal/tinted-light 三处浮层阴影；按钮立体走 bevel/pixel 组 |

对比度红线（门禁：packages/ui/test/contrast.test.ts，WCAG AA 全部 ≥4.5）：T53-01 灰阶化后重测——门禁配对表**逐对全过**，最差对为浅色 ink-faint/surface 4.55（提档前 #757575 仅 3.94）；其余文字对（ink、ink-secondary 两主题 × canvas/surface/surface-raised/content）与 `on-accent/accent`、`accent|danger|success` 对 canvas 两主题均 ≥4.5。**icon-faint（#9A9A9A/#6E6E6E）不是文字 token，禁用于任何正文级文字**（浅色对 canvas 仅 2.58），只准用于图标、三角、装饰性非文字元素。

## Colors

- **canvas / content / surface / surface-raised / surface-active**：五级灰阶平面。canvas = 侧栏 + 顶栏（chrome 面）；content = 内容区背景；surface = 列表行悬停；surface-active = 列表行选中；surface-raised = 弹层与输入框底。层级只靠明度差，禁色相区分。
- **ink 三档 + icon-faint**：正文 ink，次级说明 ink-secondary，时间戳/占位/装饰 ink-faint（文字级下限，≥AA）。icon-faint（#9A9A9A）只用于图标/三角/非文字弱化元素，**禁用于正文级文字**。ink-faint 禁用于任何必读信息。
- **accent（灰阶 #333333/#D4D4D4）**：T53-01 琥珀退役后，`accent` 只表达「实心强调底」（主按钮、勾选框选中底、开关 on 态、进度填充、spinner 头）。**强调态一律靠明度差 + 描边**（活动标签 = content 底 + 无分隔线；选中行 = surface-active + 字重；焦点 = focus-ring 外环）；**禁止**大面积铺色、禁止渐变、禁止发光晕（glow）。
- **两粒语义色**：`danger`（错误红）落点 = 删除确认/冲突/同步失败/表单错误/危险菜单项；`success`（同步绿）落点 = 同步进行中呼吸点/同步完成点/toast 成功图标。两处之外禁用色相。
- **bevel-hi / bevel-lo / shadow-pixel**：像素立体的三个色源——高亮面、暗部、实心投影。只准被 `elevation.bevel-*` / `elevation.pixel-*` 组合引用。
- **ink-edge**：**框线**（面板/卡片/输入控件/按钮/浮层/弹窗的**外轮廓** + 表格网格/列表分隔等**内线**）的唯一色源，与文字色 `ink` 语义分离（同值仅为巧合，可独立微调）。宽度谱 = **外框 2px / 内线 1px**（同一种黑，靠宽度分层）——控件亦吃 ink-edge（T62-01 起；T59-01 的「控件不上 ink-edge」已退役，见「Pixel Borders」）。
- **hairline / hairline-strong**：**框线语义已不再首选此二者**（T62-01）。仍保留给非框线的面/轨/装饰：`Divider` 的 1px 底线、`ProgressBar` 轨底、`Skeleton` 扫光、`Switch` 轨、`LayoutPreview` 示意行这类 `background` 填充，以及渲染环 `Spinner` 的动段弱档。

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
- 应用壳：顶栏 40px · 侧栏 240px（可折叠至 48px 图标栏）· **一级导航轨 56px**（T93-01 NavRail：位于侧栏左侧的全高一列，承载「笔记 / 知识库 / 工作台 / 模板 / 回收站」一级菜单）· 内容区无内衬（编辑器自己控制 gutter）。侧栏与顶栏同底色（canvas），内容区用 content 白底（T53-01 灰阶两档）。
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
- 猫形语言仅一处例外：顶栏同步状态点（旧称「铃铛」，T53-01 已灰阶化为纯圆点）用 `full` + 呼吸动画（motion.fast 淡入淡出，reduced-motion 下静态）。

## Pixel Borders（T59-01 立 · R12：老板 09-22「像素风黑色边框」；T62-01 扩 · R14：老板 09-22 晚「整个程序的所有框的线条都做成像素风的黑线条」）

- **`ink-edge` = 框线的唯一色源**。与 `ink` 同值不同义：`ink` 是文字色，`ink-edge` 是结构线色，两者可独立微调（故独立成 token，不共用 `ink`）。
- **宽度谱（T62-01 定稿）**：**外框轮廓**（面板/卡片/输入控件/按钮/浮层/弹窗/标签/键帽/开关轨/滑杆件）一律 `2px solid {colors.ink-edge}`；**内部线**（表格单元格四边、列头分隔、列表 hairline、编辑器块内分隔、区隔线）一律 `1px solid {colors.ink-edge}`。**同一种黑，靠宽度分层**——与 `bevel-*` 硬边、模态描边的 2px 同谱（像素风 = 2px/1px 网格，禁 1.5px 混谱、禁其它宽度）。
- **深色主题 = 亮边（口径与原因）**：浅色 `#1A1A1A`（老板点名的"黑色边框"）。深色底 `canvas #141414` / `content #0A0A0A` 上用黑描边对比度 ≈1.05，等于**看不见**，故深色取 `#EDEDED`（亮边）——像素游戏 dark 关卡以亮边描述轮廓的惯例：**边界的语义是"结构分界"，靠与相邻面的明度差成立，不靠"黑"这个色相本身**。两主题因此是「结构反转」，不是同一支色的两档透明度。*（老板终审项：深色=亮边）*
- **相邻边只画一次**：接缝由**跨该缝更长的一侧独占绘制**，禁止两枚相邻元素各画一半（会叠出 4px 粗缝）。接缝归属表（网格容器上显式定死）：

  | 接缝 | 画线者 | 线 |
  |---|---|---|
  | 顶栏 ↔ 主区（右列横向） | `.sc-shell__topbar` | `border-bottom` |
  | 侧栏 ↔ 主区（纵向，通全高） | `.sc-shell__sidebar` | 右缘 2px 描边条（`::after` 定位条，位置等价 `border-right`） |
  | 标签条 ↔ 正文（横向） | `.pv-root` | `border-top` |
  | 编辑列 ↔ AI 面板（右侧布局，纵向） | `.ai-chat` | `border-left` |
  | 编辑列 ↔ AI 面板（底部布局，横向） | `.ai-chat` | `border-top` |

  编辑列自身**不补**左/右/下描边：左/右接缝已由侧栏 / AI 面板绘制，窗口边缘不需要线（"边框只在两个 chrome 面相接处画"）。
  **接缝条不得占用盒模型**：侧栏这类"通高、内含满宽子元素"的容器若用 `border-right` 画线，内层会被压窄 2px，破坏既有宽度契约 —— 此时改用同位置的定位描边条（零盒影响，且绘制层级在行 hover 底 / 滚动条之上，线恒可见）。
- **T52 标签融合规则（红线）**：正文顶边（`.pv-root` 的 `border-top`）在**活动标签处必须断开**——活动标签下缘下沉 2px 压住该描边，底色 = `content`，左右 + 顶部 2px `ink-edge` 成 **∏ 形轮廓且下缘无缝**（NES 窗口标题签观感，标签"骑缝融合"进正文）；**非活动标签**以 2px `ink-edge` 左描边彼此分隔，底边停在正文顶边**之上**（不压线、不破缝）。
- **浮层族统一** `2px ink-edge`：Dialog / Menu / Popover / Tooltip / Select 下拉 / Toast + CloseAskDialog / LayoutPicker（模态）——原 1px `hairline` 与 2px `hairline-strong` 一律换掉（模态与 popover 共用同一条边界语言）。命令面板 / 同步状态面板两处浮层已于 T59-01 当轮并入。
- **装饰性虚线/点线（T62-01 §1.4）**：拖放落位提示、虚线占位框等 —— **线型保留**（dashed/dotted 不改），颜色升 `{colors.ink-edge}`、宽度归 2px 谱。
- **focus / active（T62-01 §1.3）**：一律**黑线**（框线恒 `ink-edge`）+ 全局 `:focus-visible` 的 2px `focus-ring` 外环；**禁彩色光晕**（`box-shadow: … accent` 类改灰/黑）。原「hover 把描边提亮一档」的语法在黑基线下无档可提，状态反馈改由底色 / `bevel` 凹陷承担。

### T62-01 全局框线（R14）落点边界

- **覆盖**：`packages/ui/src` 全部组件 CSS、`apps/desktop/src/renderer/src` 全部页面/面板 CSS、`packages/dbview` 与 `packages/editor` 的**样式表**（这两包本单只许改 CSS，TS/逻辑零碰）。
- **不动**：`packages/core/coverage/**`（生成物）、`docs/mockups/**`（演示页）、`tokens.css`（生成物，色值钉死，双主题都由它出）、以及**非框线的面/轨/装饰填充**（见 `hairline` 条）——`Divider` 底线、`ProgressBar` 轨底、`Skeleton` 扫光、`Switch` 轨底、`LayoutPreview` 示意行、`ResizeHandle` 接缝条这类 `background` 而非 `border` 的落点不在本口径内。
- **例外（显式白名单，见 `packages/ui/test/pixel-borders.test.ts`）**：复位值（`0` / `none`）、透明占位边（ghost 控件的 `transparent` 描边）、**语义状态色**（错误/校验失败态 `danger` 系、标签同色底衬 `*-soft`）、`Spinner` 旋转动段弱档。白名单外**任何** `border*` 值声明都必须含 `ink-edge`。
- **回归护栏**：`packages/ui/test/pixel-borders.test.ts` 全量扫描上述四个包的 CSS（去注释、排除 coverage/mockups），断言「白名单外无灰线残留 + 宽度谱只允许 1px/2px + 全仓零 1.5px + T59 既有 17 处落点未被改回」，并逐次运行打印扫描数/命中数。

## Components

- **像素立体基线（T53-01，全交互件）**：`box-shadow: {elevation.pixel-out}`（或 `{elevation.bevel-out}`）、`border-radius: {rounded.sm}`（2px）；`:active:not(:disabled)` → `box-shadow: {elevation.bevel-in}` + `transform: translate(2px, 2px)`（下沉 + 亮暗对调）；`:focus-visible` → 2px `{colors.focus-ring}` 外环 offset 2px。过渡含 `box-shadow`，时长 `{motion.fast}`，缓动 `{ease-out}`。
- `button-primary`: backgroundColor `{colors.accent}`（深灰实心）, textColor `{colors.on-accent}`, border 2px `{colors.ink-edge}`（T62-01：原透明占位描边升为可见黑框）, rounded `{rounded.sm}`, height 32px(md)/28px(sm), padding-x `{spacing.md}`；hover: 明度提亮 6%（brightness）+ `{elevation.pixel-out}`；active 见基线。
- `button-secondary`: backgroundColor `{colors.surface-raised}`, textColor `{colors.ink}`, border 2px `{colors.ink-edge}`（T62-01：原 1px hairline-strong 退役）；立体走 `{elevation.pixel-out}`。
- `button-ghost`: 透明底（**有意无框**：`border: 2px solid transparent` 只作宽度谱占位），hover `{colors.surface}` + `{elevation.bevel-out}`（无 offset 投影，避免工具条抖动）；active 同基线但只走 `{elevation.bevel-in}`。
- `input`: backgroundColor `{colors.surface-raised}`, border 2px `{colors.ink-edge}`（T62-01：原 1px hairline 退役）, rounded `{rounded.sm}`；**状态反馈走 `{elevation.bevel-in}` 凹陷 + 全局 `:focus-visible` 的 2px `{colors.focus-ring}` 外环**（框线恒 ink-edge，禁彩色描边）；错误态 border `{colors.danger}`（语义状态色，白名单例外），错误文案在输入框下方 `ui-xs` danger（**label 在上、helper 中、error 下**的固定结构）。
- `block-handle`（编辑器）：宽 24px，hover 显现（motion.fast），图标 `ink-faint`；拖拽时显示 2px accent 插入线（圆角 full）。
- `command-palette`: 宽 560px 居中偏上 20vh，`elevation.shadow-modal`，圆角 lg；输入行 40px，结果行 36px，选中行左侧 3px accent 条。
- `breadcrumb`（顶栏）：字号走 ui-md（14px）；当前页 ink 加粗 500，祖先 ink-secondary，分隔符 ink-faint。
- `sync-status`（顶栏）：五态——静止灰点（已同步）/ **同步进行中 = success 绿呼吸点** / 完成 = success 绿点 / 部分降级 = 灰点 + 2px surface-active 描边环（明度差方案）/ 需处理 = danger 红点 + 计数角标。tooltip 文案含「上次同步 HH:mm」，兑现 §16「异步可靠同步」叙事。
- `toast`: 底部居中堆叠，3 条可见，surface-raised + shadow-popover，图标按语义色（成功绿 / 失败红 / 其余 ink-secondary）。
- 四态强制：每个数据视图必须实现 `EmptyState`（插画占位 + 一句动作导向文案 + 主按钮）、`Skeleton`（形似最终布局，禁通用转圈）、`ErrorPanel`（说明 + 重试）、成功静默（toast 仅不可自动恢复时）。

## Icons

**§16.6 修订（T58-01，2026-09-22）**：图标唯一出口仍是 `Icon.tsx`；**族 = 仓内像素 glyph 自绘**——`packages/ui/src/pixelIcons.tsx` 内置 16×16 硬边像素网格（28 枚手写 glyph，PM 定稿资产表 `scripts/gen-pixel-glyphs.mjs`），渲染为 `viewBox="0 0 16 16"` + `shapeRendering="crispEdges"` 的内联 `<svg>` 矩形条。`@phosphor-icons/react` 依赖保留在 `packages/ui/package.json`，**仅作 fallback / 文档引用**，仓内零 import（`Icon.tsx` 与全部业务代码都不再引用）。

- 色值纪律：glyph 只有 `fill="currentColor"` + 每档 `opacity` 两个来源（亮 1 / 中 .8 / 淡 .72）。档位是**对比度安全档**：三档压在 T53 灰阶平面上对图标前景 token 实测均 ≥3:1（非文字门禁），主题自适应由此免费获得。
- 尺寸档不变：`{ sm: 16, md: 20, lg: 24 }`（`ICON_SIZES`），档外显式数字允许；`ICON_STROKE_WIDTH` 保留为 legacy 出口，像素族不消费（硬边实心无描边）。
- 两态图标：`AiRobot`（AI 钮定稿）的眼部/天线是独立分组，由祖先 `aria-pressed` 切明暗（开=眼亮 1 / 关=眼暗 0.35，天线 1/0.55）——状态差即明暗差，不引入任何颜色。
- 无障碍不变：有 `label` → `role="img"` + `aria-label`；无 `label` → 装饰性 `aria-hidden`。
- 品牌图形标（§17 布偶猫）仍属本节的**唯一例外**，不并入图标族。
- 迁移对照表（旧 phosphor 权利名 → 像素 glyph；调用点 `icon={X}` 零改动）：

| 旧权利名（phosphor） | 像素 glyph | 说明 |
|---|---|---|
| `MagnifyingGlass` | `Search` | 别名同源（同一组件对象） |
| `X` | `Close` | 别名同源 |
| `Sparkle` | `AiRobot` | **语义迁移**：AI 语义统一到像素机器人头（顶栏 AI 钮 / AI 面板标题 / 多维数据「AI 生成」钮三处），`Sparkle` 出口退役 |
| 其余 23 名（Plus/Check/Caret×3/Trash/…） | 同名 | 一对一换实现 |
| — | `Layout` / `BookOpen` | 新增：T57 布局钮 / T56 说明书入口的像素 glyph |

## Do's and Don'ts

- Do：先改 DESIGN.md 再改任何样式代码；tokens 构建脚本是唯一翻译层。
- Do：所有可点元素有 hover、active、focus-visible 三态；所有列表有空态。
- Do：交互件一律吃 `{elevation.pixel-out}` / `{elevation.bevel-*}`（像素立体），按压必须给「下沉 + 亮暗对调」反馈。
- Do：深浅主题同一 PR 内同时截图自检（§16.3）。
- Don't：写死 hex；Don't：用 Inter 或任何在线字体（字体固定为自托管思源黑体 Noto Sans SC，禁 CDN/远程 font-face，T50-01 §16.5）；Don't：AI 紫、渐变按钮、毛玻璃大面积铺、装饰性彩色圆点、em-dash 堆叠的文案。
- Don't：**任何色相**（除 danger/success 两粒）——状态一律走明度差 + 描边；Don't：控件上用带 blur 的阴影或大圆角胶囊按钮（像素风红线）。
- Don't：animate `width/height/top/left`；Don't：linear 缓动（全部 spring 或 `cubic-bezier(0.16,1,0.3,1)` 近似）。
- Don't：emoji 当图标；图标只用 `Icon.tsx`（T58-01 起族 = 仓内像素 glyph 自绘，尺寸档 16/20/24，色值只走 `currentColor` + opacity 档——见「Icons」节）。
