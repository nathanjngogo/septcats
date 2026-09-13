# TASK-T10-01 交付报告 · M9 设置页 + i18n 骨架 + 诊断包

> 工程师：CodeBuddy ｜ 日期 2026-09-13 ｜ 状态：**五条 DoD 全绿（本地已复跑）**
> 复述（写前）：设置页成为真路由（面板「打开设置」不再 notify），承载外观 / 数据与隐私 / 诊断三组；i18n 立「文案单一来源」骨架（一期只 zh-CN）；诊断包导出默认脱敏 + 人工预览后确认落盘。范围外（PM 已裁，未动）：快捷键自定义、自定义 tokens、en-US 全量翻译、同步面板。

## 1. 设置存储（packages/platform 扩展，不另立文件）

| 交付物 | 说明 |
|---|---|
| `packages/platform/src/settings.ts` | 在既有 `SeptcatsSettings` 上扩展 `AppSettings`（zod `appSettingsSchema`：`theme: 'light'|'dark'|'system'`、`locale: 'zh-CN'|'en-US'`、`privacy: { telemetry: literal(false), linkPreviewOnType }`、`editor: { defaultEditMode, spellcheck }`、`data: { note }`）+ `DEFAULT_APP_SETTINGS` + `mergeSettingsPatch`；`readSettings` 损坏/非法回退默认并 `console.warn`；`writeSettings` rootPath replace 语义 + app settings merge 语义，合并结果严格校验（非法抛 `E_SETTINGS_INVALID`） |
| `packages/platform/test/settings.test.ts` | 回归锁定：缺失静默默认（不告警）、损坏 JSON + 非法 theme:'neon' 回退并 warn、rootPath roundtrip、app 配置 roundtrip、mergeSettingsPatch 非法拒绝 |

## 2. IPC 三件套（EOPT 风格）

- `apps/desktop/src/shared/ipc.ts` — 新增 `settings:get` / `settings:patch` / `diag:export` / `diag:confirm` 常量（`SETTINGS_CHANNELS` / `DIAG_CHANNELS`）。
- `apps/desktop/src/shared/settings.ts` — 纯协议类型 `ThemeMode` / `Locale` / `EditMode` / `AppSettings` / `AppSettingsPatch`（深 partial）/ `DiagExportResult` / `DiagConfirmResult`；**不 import node / platform**，规避 web tsconfig 拉进 `node:*` 的模块边界问题。
- `apps/desktop/src/main/settings.ts` — `readAppSettings(userDataDir, syncDir)`（回整份，`data.note` = 同步目录绝对路径）与 `patchAppSettings(...)`（`mergeSettingsPatch` 严格校验 → 原子落盘 → 回整份）。
- `apps/desktop/src/main/diag.ts` — `buildDiagnosticPackage`（纯 Node，无 electron/net）：值级脱敏 `redactSensitive`（key 命中 `/(?i)(api[-_]?(key|token)|secret|password)/` → value `[REDACTED]`）、路径脱敏 `redactHomeDir`（主目录绝对路径 → `~`）、`listSyncDirFiles`（递归文件名清单，跳过 credentials 目录，不含内容）、`listDbFiles`（db + wal + shm 大小）、`readLogTail`（每模块尾 200 行）。
- `apps/desktop/src/main/index.ts` — 注册 `settings:get/patch`、`diag:export`（只生成预览不落盘）、`diag:confirm`（写 `userData/diagnostics/diag-<ts>.json`，tmp→rename）；`readDbUserVersion` 经 `dbHandle.migrate().to` 取 `PRAGMA user_version`。
- `apps/desktop/src/main/platform.ts` — `PlatformContext` 增加 `userDataDir` / `homeDir`（settings.json 所在 + 脱敏基准）。
- `apps/desktop/src/preload/index.ts` — `septcats.settings.get/patch` + `septcats.diag.export/confirm`。
- `apps/desktop/src/types/window.d.ts` — `SeptcatsSettingsApi` / `SeptcatsDiagApi` 挂入 `SeptcatsApi`。

## 3. i18n 骨架（一期 zh-CN）

- `apps/desktop/src/renderer/src/i18n/zh-CN.ts` — 嵌套字典：`settings.*`（外观/数据与隐私/诊断/关于/错误）+ `commands.<id>` / `commandHints.<id>`（命令 id 自然嵌套，`commands.page.new`）。
- `apps/desktop/src/renderer/src/i18n/index.ts` — `t(key)` 按 `.` 拆层查字典，缺失回退 zh-CN → 仍缺失返回 key 并 `console.warn`；`useLocale()` 一期固定 `zh-CN`；en-US 留空字典回退（不 import 不存在的文件）。
- `apps/desktop/src/renderer/src/palette/commands.ts` — label/hint 走 `t('commands.<id>')` / `t('commandHints.<id>')`；aliases（拼音/英文搜索词）本地维护。

## 4. 设置页与分发

- `packages/ui/src/RadioGroup.tsx` + `.css` + `.test.tsx` — 原生 `input[type=radio]` 承载语义/键盘，视觉分段控件（mockup 06 `.seg`）；token 纪律，no-magic 通过。
- `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` + `.css` — 三区块 fieldset/legend：外观（主题 RadioGroup → 立即 `setGlobalThemeMode` + patch）、数据与隐私（同步路径只读 mono + 遥测恒 off 占位 + 外链预览 Switch）、诊断（导出按钮 busy → 预览 `<pre>` 只读 → 确认/取消 → 已保存路径）+ 关于（版本/猫标/技术栈）。zod 拒绝 → `ErrorPanel` 内联（不弹 toast）。
- `apps/desktop/src/renderer/src/App.tsx` — 内容区 `view: 'editor' | 'settings'` 分发；顶栏齿轮钮 `aria-pressed` 切换设置视图；`app.settings` 命令接 `openSettings`（**替换 notify 桩**）；设置态面包屑显示「设置」。

## 5. 测试（全部本地实跑）

| 文件 | 覆盖 |
|---|---|
| `packages/platform/test/settings.test.ts`（11 例） | 缺失默认不告警、损坏/非法回退 + warn、rootPath/app 配置 roundtrip、mergeSettingsPatch 拒绝 theme:'neon'/telemetry:true |
| `apps/desktop/test/settings.test.ts`（3 例） | main 侧 get 回整份 + patch roundtrip + 非法 theme:'neon' 抛 E_SETTINGS_INVALID |
| `apps/desktop/test/diag.test.ts`（4 例） | 值级脱敏（api_key/apiToken/secret/password → `[REDACTED]`）、路径脱敏 `~`、整体导出（假 secret 不出现、`~` 替换、凭据目录不进清单、meta 齐全）、**无 net/http/fetch 模块（读源码 grep 断言）** |
| `apps/desktop/test/i18n.test.ts`（3 例） | 嵌套 key 解析、缺失 key 回退 + warn、useLocale 一期 zh-CN |
| `apps/desktop/test/settings-react.test.tsx`（3 例，jsdom） | 三区块渲染 + radiogroup、主题切换派发 `septcats:theme-mode`（spy `window.dispatchEvent`）+ patch、诊断导出预览 + 确认/取消 |
| `apps/desktop/test/palette.test.ts` / `palette-react.test.tsx` | 存量更新：`app.settings` 不再 notify（notify 计数 4→3，新增 `openSettings` 分支断言） |

## 6. DoD 五条结果原文（本地复跑 2026-09-13）

> 任务书 §6 原文：
> ```
> pnpm -r typecheck && pnpm -r test
> pnpm -C apps/desktop selftest
> node packages/ui/tokens/no-magic.mjs
> pnpm -C apps/desktop build
> ```

### ① `pnpm -r typecheck` — 全绿
```
Scope: 8 of 9 workspace projects
packages/core / platform / ui / dbview / editor / schema / sync / apps/desktop typecheck: Done
```

### ② `pnpm -r test` — 全绿
apps/desktop 明细（本任务重点）：
```
 ✓ test/i18n.test.ts (3 tests)
 ✓ test/diag.test.ts (4 tests)
 ✓ test/palette.test.ts (14 tests)
 ✓ test/settings.test.ts (3 tests)
 ✓ test/statements.test.ts (17 tests)
 ✓ test/migrations.test.ts (21 tests)
 ✓ test/server.test.ts (12 tests)
 ✓ test/dbview.test.ts (9 tests)
 ✓ test/pages.test.ts (11 tests)
 ✓ test/settings-react.test.tsx (3 tests)
 ✓ test/db-bridge.test.ts (6 tests)
 ✓ test/palette-react.test.tsx (8 tests)
 ✓ test/search.test.ts (6 tests)  # 1 万页 P95 = 13.0ms < 150ms
 Test Files  13 passed (13) / Tests  117 passed (117)
```
其余包：core / platform（34 passed, 1 skipped）/ ui（61 passed）/ schema / editor（126 passed）/ dbview（79 passed）均通过。

### ③ `pnpm -C apps/desktop selftest` — SELFTEST OK
```
PASS v2 加列（page.deleted_at）
...（T8 既有 28 条全 PASS）...
PASS v4 触发器已重建（6 个 FTS 触发器在位）
  FTS_RESYNC 2000 页全量重算耗时 22.0 ms
PASS FTS_RESYNC 2000 页全量重算 < 3000ms
SELFTEST OK
```

### ④ `node packages/ui/tokens/no-magic.mjs`
```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### ⑤ `pnpm -C apps/desktop build` — 三进程产物齐
```
√ Rebuild Complete
vite v7.3.6 building ssr environment for production...
out/main/index.js                453.56 kB
out/main/dbServer.js              61.19 kB
out/preload/index.js               6.74 kB
building client environment for production...
out/renderer/assets/index-CjxroJiR.css     55.83 kB
out/renderer/assets/index-DZ_0cSdd.js   1,322.63 kB
✓ built in 3.60s
```
（中段仍有 zod `@__PURE__` 注释的 Rollup 提示，非错误，与 T7b/T8 报告一致。）

## 7. SSIM-NOTE（06 屏对齐点）

**mockup 06 → SettingsPage.tsx / SettingsPage.css**
- **控件三件套**：主题三选用 RadioGroup 渲染成分段控件（`--sc-color-surface` 底 + `--sc-radius-md` + 选中项 `surface-raised`/`--sc-shadow-tinted-light`），对应 mockup 的 `.seg`；开关用 Switch（`--sc-color-accent` on 态）；圆角/高度统一走 `--sc-radius-*` / `--sc-size-control-sm`。
- **说明文案层级**：行标题 `--sc-text-ui-sm`/ink，说明 `--sc-text-ui-xs`/`ink-secondary`，分区 legend `ui-xs`/`ink-faint` 下发丝线——对应 mockup `.lab b` 与 `.lab span` 的 ink/ink-secondary 分层。
- **同步路径只读**：mono 字体 + `--sc-color-surface` 底 + 省略号截断，对应 mockup 的只读展示区。
- **预览区即组件实例**：诊断预览 `<pre>` 用 `--sc-text-code` mono，面板用真实 Button/ErrorPanel，所见即所得。
- **偏离**：mockup 06 有左侧分区导航（通用/外观/同步/AI/快捷键/关于），本任务按任务书 §3「三区块」用 fieldset/legend 单列布局——nav 里「同步/AI/快捷键」对应范围外功能（同步面板/快捷键自定义被 PM 裁），故不还原导航，仅还原「设置主区」的控件语言。
- **无法自证的**：真实深浅色切换观感（token 已用 surface-raised/accent-soft，理论可读）、主题交叉淡化（走既有 ThemeProvider，非本任务新增）。需 PM 真机截图复审。

## 8. DEVIATIONS（有意的偏离与理由）

1. **命令表 aliases 未走 `t()`（任务书 §2 写「label/aliases 走 t()」）**：aliases 是拼音+英文**搜索词**（`sz`/`settings`），非用户可见展示文案，翻译无意义；实际迁移了 label + hint 两个展示字段，aliases 仍在 commands.ts 本地维护。若 PM 要求 aliases 也按 locale 分离，改动集中在一处（commands.ts 的 aliases 取值）。
2. **设置页用 fieldset/legend 三区块而非 mockup 06 的左侧导航**：任务书 §3 明示「三区块（fieldset/legend）」，且 mockup 导航中的同步/AI/快捷键对应范围外功能，故单列三区块 + fieldset/legend（无障碍语义）。
3. **editor 设置（defaultEditMode/spellcheck）进 schema 但不进 UI**：任务书 §1 定义 schema，§3 只列「外观/数据与隐私/诊断」三区块，无编辑器分区；一期持久化字段（默认值落 settings.json），UI 暴露归后续里程碑。
4. **`data.note` 为派生展示字段**：main 的 `settings:get/patch` 始终用「同步目录绝对路径」覆盖返回（仅展示不可改），settings.json 里不持久化该值（保持默认 ''）；renderer 类型层面 `AppSettingsPatch` 里 `data`/`privacy.telemetry` 不可改（telemetry 字面量 false）。
5. **诊断包 `diag:export` 只生成预览不落盘，`diag:confirm` 重新生成并落盘**：为满足「确认才落最终文件」+ 主进程无状态，confirm 时重新构建（脱敏确定性保证结构一致，仅 `generatedAt` 时间戳有秒级差异）；落盘路径由 main 计算（`userData/diagnostics/diag-<ts>.json`），renderer 不传路径，无路径注入面。
6. **主题命令（命令面板 theme.light/dark/system）仍只走 `setGlobalThemeMode`（不落 settings.json）**：任务书要求「主题命令接 setGlobalThemeMode，不许重写状态机」，未要求命令面板侧持久化；设置页主题三选是「setGlobalThemeMode + patch」双写。两者在 localStorage 与 settings.json 间可能短暂不一致，属范围外（后续统一）。
