# TASK-T56-01 · P1：使用说明书（嵌入帮助菜单）

> 老板 2026-09-22 原话：「要做一份使用说明书，嵌入菜单栏的帮助里。」前置：T55-02 后派发（共用 menuTemplate/Icon/i18n）。

## 0. 侦察事实（勿重复调查）

- 帮助菜单现仅一项：`apps/desktop/src/main/menuTemplate.ts:127` `submenu: [action('helpAbout', 'about')]`；动作链 `MenuActionId`（shared/ipc.ts）→ main 发 IPC → renderer（App.tsx 有 `septcats:open-settings` 同款事件监听模式可参考）。main/index.ts:582 有 `menuText(locale,'helpAbout')`。
- i18n：`renderer/src/i18n/{zh-CN,en}.ts` 双语字典 + `t()`；菜单文案在 `main/menuTemplate.ts` 的 MenuLocale 字典（T51 已本地化）。
- 像素模态参考实现：`renderer/src/close/CloseAskDialog.tsx/.css`（overlay+2px 描边+bevel+pixel shadow token，零内联色）。
- §16.6 图标纪律：唯一出口 `packages/ui/src/Icon.tsx`（phosphor 单族）——**新图标只准加到它的 re-export 清单**。

## 1. 必须做到

1. **内容源**：`docs/manual/` 下 Markdown 分章（zh 为准 + en 对照，两文件制：`manual.zh.md`/`manual.en.md`），章节 ≥：快速上手、页面与标签、Markdown 与块编辑器、双链与 Wiki、数据库视图、搜索与命令面板、导入导出、同步、AI 助手、键盘快捷键总表、设置与布局、托盘与关闭行为（T54 新行为必须写进去）。内容必须与当前真机行为一致——**每一节写之前先到代码/菜单核实，禁止编造功能**。
2. **渲染通道**：构建期把 md 打进 renderer（vite `?raw` import 编译进 bundle，**运行时零 fs 读取、零网络**，隐私红线不破）；说明书查看器=应用内**全屏像素风阅读视图**（不是外部浏览器）：左侧章节锚点列表（可折叠）+ 右侧正文渲染。**Markdown 渲染不许新增 npm 依赖**：仓内已有 Tiptap/或自写最小 md→React 子集渲染器（标题/段落/列表/表格/行内码/代码块/链接/加粗）——选择权在工程师，但必须过单测（渲染器纯函数，夹具≥8 断言含表格与代码块）。
3. **入口两处**：① 帮助菜单加「使用说明书」项（`MenuActionId` 新 `helpManual`；双语 label 走 menuText 字典；位置=「关于」上方，加分隔线）；② 命令面板加同名命令（palette commands 注册表现成模式）。快捷键不设（避免抢占）。
4. **查看器接线**：App.tsx `view` 状态机新增 `'manual'`（editor/settings/import 同族）；监听 main 的 manual 打开事件（参考 `septcats:open-settings`）；Esc/关闭钮回 editor。i18n 全部走双语字典新键。
5. **测试**：md 渲染器单测 ≥8；菜单模板断言 helpManual 存在+双语；view 状态机测试（open manual→渲染、Esc→回 editor）≥2；desktop 用例 ≥693+12。
6. **真机探针** `cdp-e2e-t56-01.mjs`：帮助菜单点开→说明书视图出现→锚点跳转→章节标题命中 DOM→切英文菜单 label 变→命令面板入口通→Esc 回编辑区；截图 3 张（zh 正文/en 正文/锚点折叠态）存 `screens-t56/`。

## 2. 红线

- `packages/ui/src/Icon.tsx` 只准**追加** re-export；AppShell/core/sync 零改动；不加 npm 依赖；不碰 git；禁 TODO；真档案只读；交付前杀净 electron 贴计数=0。
- 说明书文案里**禁止出现未实现功能**（PM 会逐条对代码抽查）。
- 数值：desktop 全绿、typecheck 9/9、双门禁、selftest OK。

## 3. 交付

代码+i18n+md 两文件+渲染器+探针+3 截图+`docs/tasks/TASK-T56-01-report.md`（原始值+DEVIATION；PM 复跑节留空）。全仓/打包留 PM。
