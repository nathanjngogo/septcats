# TASK-T54-01 · P1：关闭自动保存 + 「退出 / 最小化到托盘」询问框（像素风）

> PM：Hermes ｜ 工程师：CBL ｜ 前置：**T53-01 收口后**派发 ｜ 老板 09-21 原话：「关闭笔记要能自动保存，且要询问退出还是最小化托盘。弹出框要与整体风格统一。」

## 0. 侦察事实（PM 定位，勿重复调查）

- 现状：关窗 = 直接退应用；**无 Tray**；编辑经 `blocks:commit` 防抖落库（有极短未冲刷窗口期）；页面正文本就 append-only 落库，但**无关窗冲刷保证**。
- 弹框要「与整体风格统一」= T53 刚落地的像素黑白灰 token（`--sc-bevel-*`/`--sc-shadow-*`）→ **必须用 renderer 自绘模态**，禁 `dialog.showMessageBox`（系统样式不吃 token）。
- 标签关闭路径已即时落库（T37），仅需一条不丢断言。
- 语言真源：`settings.locale`；文案进 `i18n/{zh-CN,en-US}.ts` 新 `closeAsk.*` 段。

## 1. 必须做到

1. **关闭拦截**：main 拦主窗 `close`（区分「用户关窗」与「真退出意图」`quittingFlag`）；用户关窗 → 先向 renderer 发 `editor:flush`，renderer 立即冲刷一切未提交编辑（PageView 防抖缓冲、行内重命名待结算态）并回 ack（**2s 超时兜底继续，但 main 日志记 WARNING**）→ ack 后才弹询问框。
2. **询问框**（自绘像素模态，复用 `@septcats/ui` Button 家族自动吃 bevel）：标题「关闭 Septcats」；三钮：**最小化到托盘**（默认聚焦）/ **退出** / **取消**；勾选「记住我的选择」→ 写 `settings.trayClose`（`ask|tray|quit`），此后按记住值直行动作（仍可经设置页改回）；Esc/点遮罩 = 取消。
3. **托盘**：`Tray`（图标暂用现品牌 ico，T55 换新像素图标时换引用）；左键 toggle 显隐、右键菜单「显示主窗口 / 退出」；托盘菜单「退出」走 `quittingFlag` 真退（不再弹框）；无窗口残留进程不得假死。
4. **不丢数据硬证**：两条路径（托盘/退出）各验「键入正文 → 立刻关窗 → 恢复/重启 → 内容完整且在库」；「记住选择」路径同验一次。
5. 双主题截图：询问框浅/深 2 张 + 托盘右键菜单 1 张（窗口级取证法同 T51 D-7）。

## 2. 数值化验收

单测：flush ack/超时、quittingFlag 语义、trayClose 三态路由（main 纯函数化）；真机 CDP：上述 4 条全过贴原始值；全仓 `pnpm -r test` 无红、typecheck 9/9、双门禁、selftest OK；desktop 用例 ≥663+8。

## 3. 红线

不碰 `packages/core|sync`（op 层零改动）；不新增色值（只吃 T53 token）；不加依赖；不碰 git；禁 TODO；真机独立夹具绝不写 `C:/Users/Administrator/.septcats`；交付前杀进程。ABI 同前。

## 4. 交付

代码+单测+真机探针 `cdp-e2e-t54-01.mjs`+截图 3 张+`docs/tasks/TASK-T54-01-report.md`（原始值+DEVIATION；PM 复跑节留空）。
