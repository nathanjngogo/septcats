# TASK-T25-01 · en i18n（二期 Q9）：locale 驱动 + 文案抽取 + 全量英文 + 键完备性门禁

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T24-01 收口后
> 老板裁决：「按你的」= 做 i18n 骨架 + 全量英文文案，排在 bug 修完之后、0.3.0 之前。

## 0. PM 裁决（先定死）

### A. locale 驱动（现状：`settings.json` 的 `locale` 已落库但**不驱动 UI**）

- `i18n/index.ts`：加 `setLocale(locale)`（+ 订阅/事件，与既有 theme 的 `setGlobalThemeMode` 同范式）+ `useLocale()` 生效；缺省回落顺序：**settings.locale → 系统语言（`navigator.language`，`zh*`→zh-CN，其余→en-US）→ zh-CN**。
- 设置页「外观」区新增**语言**选择：跟随系统 / 简体中文 / English → 写回 settings（既有 `settings.patch` 路径）。
- **零外联、无第三方 i18n 库**（既有 `t()` 手写查表足够；不加依赖）。

### B. 文案抽取（renderer 侧）

- 27 个含中文字面量的 renderer 文件中，**用户可见文案**（JSX 文本、aria-label、placeholder、Dialog/命令面板/菜单/空态/错误提示）全部改为 `t('<key>')`；**注释与日志不抽取**。
- 键命名照既有 `zh-CN.ts` 风格（`域.子域.名`，如 `templates.empty`）；新增键补进 `zh-CN.ts`。
- **main 侧不动文案**：用户可见错误（`E_*`）在 renderer 侧按**错误码 → t() 键**的映射表呈现（既有错误展示点改造为映射查表）。

### C. en-US 全量翻译（复用 zh-CN 键结构）

`i18n/en-US.ts` 新：与 `zh-CN.ts` **键集合逐一同构**、值全英文（术语口径：Block/Page/Database/Property/View/Template/Trash/Workspace/Sync；按钮用祈使式短句）。
**关系**：`t()` 命中 en-US 缺失键仍回退 zh-CN（既有语义保留，但门禁保证不缺失）。

### D. 键完备性门禁（本单最有价值的部分）

新增测试 `apps/desktop/test/i18n.test.ts`：
1. **键集合等价**：`zh-CN` 与 `en-US` 的键集合（递归拍平）**完全相等**（多/少各报错）。
2. **无空值**：两字典任意键的值非空字符串；en-US 值**不含 CJK 字符**（防「忘了翻译」）。
3. **无残留硬编码**：渲染层源码扫描——`renderer/src/**` 的 JSX 文本/`aria-label`/`placeholder`/`title` 属性中**不得出现 CJK 字面量**（注释、`i18n/*.ts` 字典、测试夹具豁免）。
4. 切换 locale 后关键文案断言（主界面/侧栏/面板/设置/对话框各取一处）。

## 1. 交付物

`renderer/src/i18n/{index.ts,zh-CN.ts,en-US.ts(新)}`、`renderer/src/**`（文案抽取与语言选择器）、`apps/desktop/test/i18n.test.ts`(新)、`docs/tasks/TASK-T25-01-report.md`（PM 复跑节留「（PM 补）」）。

## 2. 红线

- 允许动：`renderer/src/**`、`apps/desktop/test/**`。
- 不碰：`packages/**`、`shared/**`、`main/**`、CI/发布脚本（main 侧文案不抽，靠 renderer 错误码映射）。
- 不加依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（**若既有测试断言中文 UI 文案**：允许改为断言 `t()` 键或用 zh-CN 字典值取文案，须在报告 §DEVIATION 列出）。
- UI 红线：CSS 只走 `var(--sc-*)`、图标只从 `@septcats/ui` 出口、双主题四态齐备。

## 3. 自跑（全仓/selftest/真机留 PM）

`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`、`node packages/ui/tokens/build-tokens.mjs --check`。

**PM 收口会跑**：全仓 + selftest + 重打包 + 真机：设置页切 English → 主界面/侧栏/命令面板/设置/对话框**全英文无中文残留**（豁免用户内容）→ 切回中文 → 双主题截图 + 零 pageerror。