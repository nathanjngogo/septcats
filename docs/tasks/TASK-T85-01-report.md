# TASK-T85-01 · 质感派系：Linear + 毛玻璃入主题市场 ✅

> 老板 09-26 三连令之③：「目前只有像素风的主题，我需要增加 Linear 风格的主题，以及
> 毛玻璃风格的主题。放入主题市场。」提交：`23259fa`（实现）+ `b4bc964`（真机探针）。

## 交付
1. **主题第三维 `data-look`**：theme（明暗）× palette（配色，6）× look（质感，3）全正交。
   - `pixel` = 现状（默认，零回归）；`linear` = Linear 极简；`glass` = 毛玻璃。
2. **全库框线 token 化**：118 处 `2px solid/dashed var(--sc-color-ink-edge)` →
   `var(--sc-border-edge)` / `var(--sc-border-edge-dashed)`（pixel 块展开=原值逐字等值）。
   圆角/斜角/投影本就 token 化，未动组件一行业务 CSS。
3. **`packages/ui/src/looks.css`**（质感覆写层，no-magic 豁免同 themes.css）：
   - linear：1px 边 / 圆角 2·4·6·8 / bevel-out 退役为柔影 / modal 柔影。
   - glass：linear 骨架 + 圆角 4·8·12·16 + 浮层（对话框/菜单/弹层/吐司/下拉/命令面板/
     画廊）`color-mix(surface 72%)` + `backdrop-filter: blur(14px) saturate(1.4)`；
     顶栏/侧栏 chrome 84% 轻玻璃；侧栏接缝条 ::after 收细 1px。**正文保持实心=可读性铁律**。
4. **lookState.ts**：localStorage `septcats.look` 旁路（同 paletteState 范式，野值回退 pixel）。
5. **主题市场 UI**：画廊新增「质感风格」三卡行（预览卡挂 data-look 即时呈现）；
   命令面板 `theme.look.{pixel,linear,glass}` 三条；i18n 双语。
6. **纪律测试迁移**（等价改写非放松）：pixel-borders 扫描器认 `var(--sc-border-edge)` 为
   合法落点；borders-t59 AppShell/CONTROL_FILES 口径改写；41 文件锚点 needle 同步。

## 验证
- 门禁：ui **177**（+looks-t85 8 测）· desktop（包内）全部通过 · tsc web/node 0 错 · build OK。
  注：根聚合 `pnpm test` 有 3 例 ENOENT（page-width/tabs/perf 用 process.cwd() 拼相对
  路径，属既有聚合口径问题，包内跑 41/41 绿，非本单引入）。
- 真机 `docs/mockups/cdp-e2e-t85-01.mjs` **15/15**：真实 UI 点卡 → 顶栏框线 2px→1px、
  按钮圆角 0→4px、面板硬 bevel→柔影（CSS 级联换肤）；glass 态画廊 backdrop-filter=
  `blur(14px) saturate(1.4)`、背景 `color(srgb 1 1 1 / 0.72)`（**Electron 内核
  color-mix/backdrop-filter 支持性=物理墙探测通过**）；优雅重启后 look=glass 自动恢复；
  布局无塌陷；真实档案 mtime 零触碰。
- 探针教训（已记文件头注）：force-kill 下 Chromium localStorage 不落盘，重启验证必须走
  app.quit 优雅通道（sync:restart 自带 relaunch）。

## 数据兼容
零格式变化：look 存 localStorage（渲染侧旁路），设置文件/op-log 不动；旧用户升级后
= pixel（现状），不推任何观感变化。
