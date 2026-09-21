# TASK-T51-01 · P1：行为修正两件（重命名 blur 提交 + 原生菜单本地化）

> PM：Hermes ｜ 工程师：CBL ｜ 前置：rc.27（tip `5dfa58e`）｜ 老板 09-21 原话：「1. 新建页面重命名，一定要回车才能确认，不合理」「2. 菜单栏应与选择的语言统一」

## 0. 侦察事实（PM 已定位，勿重复调查）

- **①** `apps/desktop/src/renderer/src/pages/SidebarTree.tsx:54-78`：行内重命名输入框 `Enter→commit`、**`onBlur→cancelRename()`** —— 点别处就吞掉改名，这是抱怨根源。全仓其它 blur 提交先例可参照：`WikiLanding.tsx:115/145`、`LayoutSection.tsx:96`（都是 onBlur→submit 的正确姿势）。
- **②** `apps/desktop/src/main/**` 里 **零** `setApplicationMenu/Menu.buildFromTemplate` → Electron 默认菜单（英文 File/Edit/View/Window/Help），不随应用语言变化。语言真源：settings 的 locale（renderer `initLocale` 读取；main 侧 settings 可同步读）。

## 1. 必须做到

**① 重命名 blur 提交（全仓统一）**
1. `SidebarTree` 重命名输入框：`onBlur` 从 cancel 改为 **commit**（走既有 `pagesActions.renamePage`）；Enter 仍 commit；**Esc 仍 cancel**（三键语义都测）。
2. 空值/仅空白 blur 时**回退原标题**（不得把页面改成空名）；值未变化时不发了空 op（用 renamePage 现有幂等保护，若无则跳过提交——别新造协议）。
3. 全仓搜其它「Enter 才确认」的行内输入（tab 重命名等，`grep -rn "cancelRename\|onBlur" src/renderer`），同一姿势统一修。
4. 单测：`blur 提交`、`Enter 提交`、`Esc 取消`、`空值回退` 四例进 desktop 测试。

**② 原生菜单本地化**
1. main 侧建 `menu.ts`：`Menu.buildFromTemplate`，**label 全走 i18n 字典**（zh-CN/en-US 与 renderer 现有 `i18n/{zh-CN,en-US}.ts` 同源新增 `menu.*` 键；main 侧读 settings locale）。
2. 菜单结构与标准 role 对齐（File→新建页面/导入/回收站…；Edit→undo/redo/cut/copy/paste/selectAll 用 role；View→侧栏折叠/全宽/命令面板/缩放；Help→关于），**快捷键与现有全局快捷键逐字核对避免双绑**：页签 `Ctrl+W/Ctrl+Tab/Ctrl+1..9` 已占（`state/tabs.ts`），菜单里 Close Tab 用同键同动作（委托给 tabs 逻辑）而非 role:'close'（role close 会关窗口！）。
3. **语言切换即时重建**：设置页切语言 → IPC 通知 main → `setApplicationMenu(build(locale))`；启动时用当前 locale。
4. 验收：真机 CDP 或截图取证——zh 菜单条目全中文；切 English 重启后菜单全英文；点击 File→New Page 真能建页；Ctrl+W 关的是**标签不是窗口**。

## 2. 数值化验收

`pnpm -C apps/desktop test`（贴用例数，≥ 现 638+4）；`pnpm -r typecheck` 9/9；no-magic + build-tokens --check ✓（本单不动 CSS 也应复跑）；真机菜单双语截图 2 张（`docs/mockups/screens-t51/`）。

## 3. 红线

不碰 `packages/**`、DESIGN.md/tokens；i18n 新键只加 `menu.*` 段；不加依赖；不碰 git；禁 TODO；真机独立夹具绝不写 `C:/Users/Administrator/.septcats`；交付前杀自起进程。ABI：测试 node、Electron 前切回。

## 4. 交付

代码+单测+双语截图+`docs/tasks/TASK-T51-01-report.md`（原始值+DEVIATION；PM 复跑节留空）。全仓/打包留 PM。
