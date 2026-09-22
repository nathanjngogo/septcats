# TASK-T65-01 · P1：主题画廊（老板 09-22 选方案①）

> 老板原话需求：主题模块=「主题画廊」——顶栏弹框、缩略预览卡、实时切换，参照已上线的布局弹框（T57 LayoutPicker）同款交互。

## 0. 现状底座（PM 侦察，勿重复调查）

- 主题=token 覆写制：`packages/ui/src/tokens.css` 109 个 `--sc-*`，`[data-theme="dark"]` 覆写（:102）；ThemeProvider 在 packages/ui（renderer 经其挂 `data-theme`）；主题三态 `light|dark|system` 存于 `layoutState.ts`（LayoutTheme :28，持久化 `septcats.theme` :396-399）。
- 弹框范式现成：`apps/desktop/src/renderer/src/layout/LayoutPicker.tsx`（T57）——顶栏钮+弹框+缩略图 LayoutPreviewDiagram+实时应用+Esc/外点关闭+像素黑框语法（`--sc-pixel-out`）。
- 顶栏按钮区在 `App.tsx`（GearSix 设置钮旁有 LayoutPicker 入口钮的先例）。
- 立法红线：T53 黑白灰（彩色仅低饱和派生灰、错误红/同步绿语义不动）；T62 全局像素黑框线；§16 token 纪律（CSS 无字面 hex/裸 px，有纪律测试）。
- i18n：`apps/desktop/src/renderer/src/i18n/{zh-CN,en-US}.ts`，全部新文案双份。

## 1. 口径（PM 定稿）

1. **两层模型**：明暗基底（现有 light/dark/system，不动）× 配色派系 palette（新增）= `mono`（现状默认灰）| `oled`（纯黑底，仅 dark 基底生效，light 下该项置灰不可选或按 mono 渲染）| `contrast`（高对比灰阶）| `paper`（纸黄暖灰）| `slate`（蓝灰）| `moss`（苔绿）。
2. **实现**：palette 用新属性 `data-palette="<id>"` 挂到与 `data-theme` 同元素；派系定义写在 `packages/ui` 内**新增** `themes.css`（tokens.css 之后加载），每派系一个 `[data-palette="x"]` 覆写块，只覆写背景/前景/边框/弱化等中性 token 成低饱和色；语义色（danger/success）、accent 黑框线像素阴影 token 一律不动。
3. **持久化**：palette 存 localStorage `septcats.palette`（读 layoutState 现有 storage 范式旁路即可，**不**扩 LayoutState 类型——避免与 T64/布局编辑器搅面）。App 启动读取并挂属性。
4. **入口**：顶栏布局钮旁新增一枚像素调色板钮（图标从 packages/ui 像素族取，若无合适 glyph 就在 pixelIcons.tsx 新增一枚 `PaletteGlyph` 16 网格黑白像素画，风格对齐既有 28 枚）；点击开「主题画廊」弹框。
5. **画廊弹框**：新组件 `apps/desktop/src/renderer/src/theme/ThemeGallery.tsx` + `.css`，复用 LayoutPicker 的弹框骨架范式（不自造新交互语法）：卡片网格（每卡=一个 palette × 当前明暗基底的**真 token 迷你预览**——用 CSS 变量直接渲染小窗示意：标题条/正文行/按钮/红绿语义点）+ 卡下名称（i18n）+ 选中态描边 + 点击即实时应用 + 顶部明暗三态小切换（light/dark/system 复用现有 actions）。Esc/外点关闭。
6. **设置页**：外观区嵌同一 ThemeGallery 的紧凑版（同一组件 `variant="compact"` 或弹框按钮「打开主题画廊」，二选一以改动小为准）。
7. 命令面板注册 `theme gallery` 命令（COMMAND_DEFS 范式，含中英别名）。

## 2. 交付物
1. 代码：themes.css（6 palette 覆写块）、pixelIcons 新 glyph（若需）、ThemeGallery 组件+css、App 顶栏钮、main.tsx/App 启动挂 `septcats.palette`、commands.ts 注册、i18n 双份。
2. 单测：a) palette 合法性兜底（野值→mono）；b) 纪律测试确认 tokens.css 本体无改动或改动合规（字面值只出现在 themes.css 覆写块，且该文件豁免清单显式列出）；c) ThemeGallery 渲染 6 卡/点击回调携带 id（jsdom）；d) 明暗基底持久化回归不破坏。
3. 真机探针 `docs/mockups/cdp-e2e-t65-01.mjs`（写断言前先一次性脚本拿真值；窗口 resize 若需必须走 main inspector setBounds+回读）：开画廊→截图→点 paper→`documentElement.data-palette='paper'`+背景 computed 变化→重启还原→命令面板 `theme gallery` 可开→高对比卡文字对比度≥4.5 抽 2 组数值。截图 ≥6 张存 `screens-t65/`。
   ⚠ 本 worktree 内**不启动 Electron**（并行环境无本机依赖保证）；探针写好即可，跑由 PM 合并后执行。
4. 报告 `docs/tasks/TASK-T65-01-report.md`：分节+原始数值+DEVIATION+「PM 复跑节（PM 补）」留空。

## 3. 红线
- 语义色 token（danger/success/accent/黑框线阴影）任何派系不得改值；tokens.css 原有行不改（可文件末尾追加豁免注释除外——最好零改）。
- 不碰 SidebarTree/pages/Sidebar 状态（T64 施工中）；不碰 layoutState 类型导出；LayoutPicker 本体不改只借样式类名。
- 思源黑体、像素风、本地零外呼不破。

## 4. DoD
`pnpm -r test` 无红、`pnpm typecheck` 0、`pnpm -C apps/desktop build` 通过（node ABI：先 `node apps/desktop/scripts/ensure-abi.mjs node`）；报告填全；git 在**本 worktree 分支**上 commit（message 前缀 `feat(t65):`），不合 main。
