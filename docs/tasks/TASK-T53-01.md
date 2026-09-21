# TASK-T53-01 · P2：像素风立体按钮 + 全局黑白灰化（覆盖 Notion 配色）

> PM：Hermes ｜ 工程师：CBL ｜ 前置：**T52-01 收口后**派发 ｜ 老板 09-21 原话：「3. 所有按键应该更立体一些，风格可以改为像素风。整体黑白灰的风格。」

## 0. 口径（PM 裁决，老板验收时可否决）

- **基调 = 黑白灰**：canvas/surface/content/ink 全轴灰阶化（现 Notion 米色系 #F9F8F7 等退役，DESIGN.md 真源改值、token 名不动）。
- **语义色保留两粒最小点**：错误红、成功绿（同步点）仅在小图标/文案上保留——纯灰会让「冲突/失败」不可辨。老板若要全灰零彩，回一句话即再砍（先按此口径做）。accent 灰阶化后，原强调交互态（活动标签、焦点环）改用**明度差+描边**表达。
- **像素风落点 = 按钮/交互件的「立体」语法**：硬边高亮（上/左 2px 浅色）+ 硬边暗部（下/右 2px 深色）+ **实心无模糊投影**（`2px 2px 0` 类 offset shadow，禁 blur）+ 直角或 2px 微圆角；按下态=整体下沉 1-2px 且亮暗面对调（经典 8-bit 按压）。字面量禁入 CSS——**全部做成 token**（DESIGN.md 新 `shadow-*` / `bevel-*` 组，no-magic 门禁天然合规）。
- **不像素化**：正文字体仍是思源黑体（T50 老板全局规则，字体不随风格变）、图标仍 Phosphor 单族（§16.6 红线）、动效仍 spring 家族（可加 60ms 级 snap 感但禁删除过渡）。

## 1. 必须做到

1. `DESIGN.md`：色板灰阶化（浅/深双值逐 token）+ 新增 bevel/shadow 组；跑 `build-tokens.mjs --write`。
2. **对比度门禁**：17 对全过 ≥4.5；灰阶化最容易砸 `ink-faint`/`icon-faint` 这类弱文字，过不了就提亮档数值（PM 复算）。accent 灰化后所有「用 accent 表达状态」的组件改走明度差方案，逐处列进报告。
3. **按钮体系立体化**（全局一次改，别一屏一屏漏）：`packages/ui` 的 Button/IconButton/Tab/输入框 focus 态 + desktop 侧所有 `.app-*`/`.tabs-*`/`.pv-handle*` 交互件——统一吃新 bevel token；`:active` 按压位移从 1px 升级为「下沉+亮暗对调」（§16.8 红线只说不许无反馈，升级合规）。
4. 顶栏/侧栏/标签条/编辑区/弹窗/Toast/菜单（T51 新菜单是原生系统菜单，**不受本单 CSS 影响**——报告里记一句即可）全套双主题截图 8 张（4 关键屏 × 浅/深）。
5. 真机回归电池（T52 同款）：零滚动四宽度 / 折叠钮位置 / 手柄 gutter=12 / 活动标签连通 —— T52 的探针直接复跑贴新值。

## 2. 数值化验收

全仓 test 无红（含 contrast.test.ts 17 对逐对比值贴出）；typecheck 9/9；no-magic + --check ✓；T52 探针复跑全绿新值；截图 8 张。

## 3. 红线

token 名不改只改值（组件零改动吃新值——改不到的组件才允许动 CSS）；不碰 packages/core|sync|importer|dbview|editor；不碰字体族与图标族；不加依赖；不碰 git；禁 TODO；真机独立夹具；交付前杀进程。ABI 同前。

## 4. 交付

DESIGN.md+tokens 产物+组件 CSS diff+`docs/tasks/TASK-T53-01-report.md`（灰阶对照表：旧值→新值×对比度；DEVIATION 逐条；PM 复跑节留空）+ 8 截图。

## 5. 排队理由（对老板的交代）

③ 与 ④⑤ 同碰 `TabsBar.css`/`App.css`，且灰阶值要以布局定稿后的层次为准（先结构后皮肤），故排 T51→T52→T53 串行。
