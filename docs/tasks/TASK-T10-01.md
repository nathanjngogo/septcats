# TASK-T10-01 · M9 设置页 + i18n 骨架 + 诊断包

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T8 已合入。必读：docs/mockups/06-settings.html（视觉真相）；packages/ui/src/theme.tsx（setGlobalThemeMode 事件桥，主题命令**不许重写状态机**）；apps/desktop/src/renderer/src/palette/commands.ts（`app.settings` 桩位）；packages/platform/src（paths/credentials/logger）；apps/desktop/src/main/index.ts + src/preload/index.ts + src/types/window.d.ts（IPC 三件套范式）。
> 纪律：用 Write/Edit 落盘全部交付物；可以且必须跑 pnpm 验证自己写的每个测试（绝不交没跑过的测试）；不碰 git；禁占位符。**范围外**（PM 已裁，勿动）：快捷键自定义、自定义 tokens、en-US 全量翻译、同步面板（归 M8b/后续任务）。

## 0. 一句话
设置页成为真路由（面板「打开设置」不再 notify），承载外观 / 数据与隐私 / 诊断三组；i18n 立「文案单一来源」骨架（一期只 zh-CN），诊断包导出**默认脱敏 + 人工预览**。

## 1. 设置存储（main 侧，settings.json）
- 路径：`platform.paths.userData()/settings.json`（与 db 同目录树）；读写走 platform 的原子写（tmp+rename），损坏 JSON → 回退默认值并在诊断报告中记一条 warning（不炸应用）。
- Schema（zod 定义，shared/settings.ts 导出，三端共享类型）：
  ```
  { theme: 'light'|'dark'|'system'（默认 system）,
    locale: 'zh-CN'|'en-US'（默认 zh-CN，一期 UI 不暴露切换 en）,
    privacy: { telemetry: false 恒 false（一期无遥测，字段占位表达承诺）,
               linkPreviewOnType: true（打字时禁外链预览）},
    editor: { defaultEditMode: 'rich'|'markdown'（默认 rich）, spellcheck: true },
    data: { note: 同步文件夹路径仅展示不可改（改路径是 M8b 的事）} }
  ```
- IPC（shared/ipc.ts 常量 + main handlers + preload `septcats.settings.get/patch` + window.d.ts 类型，EOPT 风格）：`settings:get → Settings`；`settings:patch(partial) → Settings`（patch 后回整份，main 侧 zod 全量再校验——不信任 renderer）。

## 2. i18n 骨架（本期只求"结构对"，不求翻译量）
- `src/renderer/src/i18n/`：`zh-CN.ts` 导出嵌套字典（`settings.appearance` 等）+ `index.ts` 提供 `t(key)` 与 `useLocale()`；key 缺失 → 返回 key 本身并 console.warn（开发期可见，不白屏）。
- **本期迁移范围**：仅设置页 + 命令面板命令表（label/aliases）走 `t()`；其余屏**不动**（大爆炸式全仓文案搬迁禁止，后续 G4 分批）。任务书里列明的 key 清单必须全部存在。
- `locale` 写入 settings 但一期生效面 = zh-CN；en-US 分支在 i18n/index 留 TODO-FREE 的空字典回退（`import zhCN from './zh-CN'` 兜底），不许 import 不存在的文件。

## 3. 设置页（renderer，对齐 mockup 06）
- 路由：App.tsx 内容区加 view 状态（`'editor' | 'settings'`，与 T7b 的本地分发同风格，一期无 router 库）；`app.settings` 命令与顶栏齿轮钮 → `setView('settings')`（**替换掉 notify 桩**）。
- 组件：`SettingsPage.tsx` + `SettingsSection`/`SettingsRow` 内部小组件；控件全部用 `@septcats/ui`（Switch/Select/RadioGroup——缺的组件在 ui 包补，补的组件必须带测试与 CSS token 纪律）。
- 分区：外观（主题三选：浅色/深色/跟随系统——改动立即 `setGlobalThemeMode`）· 数据与隐私（同步路径只读展示 + 隐私开关两项）· 诊断（「导出诊断包」按钮 §4 + 「关于」块：版本/猫标/技术栈）。
- 四态：无异步加载需求 → 保存中用按钮 busy 态；zod 拒绝 → ErrorPanel 内联（不弹 toast 了事）。
- 无障碍：分组 fieldset/legend、Switch 有 aria-label、键盘全达。

## 4. 诊断包导出（main `diag:export`，隐私红线）
- 内容 = settings.json 全量 + meta（版本、平台、db 文件清单与大小、user_version、最近 N 条日志尾部）+ 同步目录**文件名清单（不含内容）**。
- **脱敏（写进代码级断言测试）**：不含凭据目录、不含任何 key/token 字样值（正则 `/(?i)(api[-_]?(key|token)|secret|password)/` 的 value 替换 `[REDACTED]`）、不含记录正文与标题（meta 只给计数）、不含用户主目录绝对路径（替换 `~`）。
- 流程：main 生成 JSON → 写 userData/diagnostics/diag-<ts>.json → 回 `{path, preview: string}`；renderer **先展示预览文本**（pre 只读），用户点「确认保存」才 reveal/落最终文件（预览即人工审查步骤，计划书 §M9「上传前必须人工预览脱敏」——一期无上传，导出的就是这份）。
- 网络零调用：本任务不得引入任何 fetch/net 模块（grep 断言进测试）。

## 5. 测试底线
- main：settings 持久化 roundtrip、损坏 JSON 回退、patch 校验拒绝（theme: 'neon' → 拒）、diag 脱敏断言（塞一个假 secret 进 settings 导出后不含它；含 `~` 路径替换）、无 net 模块。
- renderer（jsdom）：设置页渲染三区块、主题切换调用 setGlobalThemeMode（spy）、`app.settings` 命令不再 notify、t() 缺失 key 回退。
- 存量：命令表文案迁移后 palette.test 全绿；typecheck/test/no-magic/build/selftest 全绿。

## 6. DoD
```
pnpm -r typecheck && pnpm -r test
pnpm -C apps/desktop selftest
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop build
```
报告 docs/tasks/TASK-T10-01-report.md：通道/文件清单 + DoD 原文 + SSIM-NOTE（06 屏对齐点）+ DEVIATIONS。
