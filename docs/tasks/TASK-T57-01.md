# TASK-T57-01 · P1：布局选择弹框 + 独立布局编辑器（Hermes 式，入口在设置钮旁）

> 老板 2026-09-22 原话：「布局设计修改为像 Hermes 一样，有弹出框选择布局样式，单独的布局编辑器。在打开设置按钮的旁边。」前置：T56-01 后（共用 AppShell actions/i18n/Icon）。

## 0. 侦察事实（勿重复调查）

- 布局模型现成：`renderer/src/layout/layoutState.ts`——`LayoutState{preset: 'notion'|'focus'|'workbench'|'custom', sidebar:{position:'left'|'collapsed',width}, aiPanel:{position:'right'|'bottom'|'hidden'}, measure, density, theme}`，含 clamp/validate/LAYOUT_PRESETS/`nextLayoutPreset`（App.tsx:114 已有循环切换+toast）。持久化 `LAYOUT_STORAGE_KEY='septcats.layout'`。
- 现有编辑 UI：设置页内 `layout/LayoutSection.tsx`（preset 卡片+细项滑杆），入口藏在设置页里——老板要的是**顶栏直达 + 弹框快选 + 独立编辑器页**。
- 顶栏 actions 区（App.tsx ~350-375）现序：SyncStatusButton → Plus(导入) → GearSix(设置)。AppShell 有 `actions?: ReactNode` 插槽。
- 弹框必须吃像素模态语法（参考 `close/CloseAskDialog.css`：overlay/2px 描边/bevel/pixel shadow token，禁系统 dialog）。

## 1. 必须做到

1. **新顶栏按钮「布局」**：放 GearSix **左边**（顺序 Sync→Plus→**Layout**→Gear），`SidebarSimple` 图标（或 packages/ui Icon 族内选最贴切的；不自造），aria-label+tooltip 双语 `t('app.layoutLabel')`，`aria-pressed`=弹框打开态。
2. **布局快选弹框**（点「布局」弹出）：像素模态小弹框，内容=**布局样式预览卡选择器**（≥3 张 preset 卡：notion/focus/workbench；每卡=CSS 画的微缩窗口示意：侧栏位置/宽度比例/AI 位/正文宽度的灰阶抽象图形——**禁止位图截图，用 CSS/div 画**）+当前项高亮描边+底部一行「自定义编辑…」按钮。点卡=即时应用（写 layoutState、界面实时重排）+toast；「自定义编辑…」=关弹框、进入 ③ 的编辑器页。Esc/遮罩=关闭不改动。
3. **独立布局编辑器页**：`view:'layout'` 状态机新增；页面从 LayoutSection 迁移/重排为**整页编辑器**：左=预设卡片列+预览大图（同 ② 的 CSS 抽象图放大版），右=细项表单（侧栏位置/宽度滑杆、AI 面板位置三选、正文宽度、密度、主题）；顶部「恢复默认」+「完成」。所有控件复用 @septcats/ui Button/Checkbox/滑杆现成件（吃 T53 立体语法）。设置页内原 LayoutSection 保留为「在布局编辑器」跳转链接（不重复两套编辑 UI，把旧 section 换成一枚入口按钮，避免行为分叉）。
4. **行为一致性**：AppShell 实际排布（侧栏位置/宽度、AI 位、measure）必须继续只从 layoutState 派生——新增纯逻辑一律进 `layoutState.ts`（可单测），视图只消费。弹框/编辑器操作实时反映到背后的主窗口（弹框是 overlay 不挡主区结构变化）。
5. **i18n** 全双语新键；命令面板注册「布局编辑器」命令。
6. **测试**：layoutState 新纯函数（若有）单测；弹框渲染+选卡应用+Esc 不改动 单测 ≥6；编辑器页控件回写断言 ≥6；view 状态机（editor→layout→editor）≥2；desktop 用例 ≥(T56 后基线)+14。
7. **真机探针** `cdp-e2e-t57-01.mjs`：点布局钮→弹框→选 focus→**主窗口侧栏实时变窄实证**（getBoundingClientRect 前后对比原始值贴报告）→开编辑器→拉宽度滑杆→sidebar 宽度 DOM 实测跟随→恢复默认→完成回 editor；三 preset 卡截图 + 编辑器页 zh/en 截图 ≥5 张 `screens-t57/`；1184/894 两宽度不溢出复验（T52 红线不破）。

## 2. 红线

- `packages/**` 零改动（AppShell props 已有 actions 插槽，够用）；不加依赖；不碰 git；禁 TODO；真档案只读；交付前杀净 electron 贴计数=0。
- T52 布局融合语义（侧栏通高/折叠钮位/标签连通）不许被重排逻辑破坏——探针里带 T52 关键断言复跑。
- 数值：desktop 全绿、typecheck 9/9、双门禁、selftest OK。

## 3. 交付

代码+i18n+探针+≥5 截图+`docs/tasks/TASK-T57-01-report.md`（原始值+DEVIATION；PM 复跑节留空）。全仓/打包留 PM。
