# TASK-T25-01 · en i18n（二期 Q9）交付报告

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：d45077c（T24-01 收口，git log -1 已核）
> 结论：**代码侧完成**。§0 四项（A/B/C/D）全落地；自跑四件套全绿（407 用例，含新门禁 9 例）。

## 1. 交付物

- `apps/desktop/src/renderer/src/i18n/index.ts`：重写。`setLocale(locale)`（订阅者集合 + `septcats:locale-changed` 事件，与 theme 的 `setGlobalThemeMode` 同范式）、`useLocale()`（`useSyncExternalStore` 订阅，切换即重渲染）、`initLocale(stored)`（启动种子：回落顺序 settings.locale → navigator.language（zh*→zh-CN，其余→en-US）→ zh-CN）、`getLocalePref/setLocalePref/systemLocale`、`errorText(error)`（错误码 → t() 键映射，见 §3-3）。
- `apps/desktop/src/renderer/src/i18n/zh-CN.ts`：补 10 个新域（common/app/errors/sidebar/editor/pageDelete/trash/search/palette/pages）+ 既有域增量键；既有键值**逐字保留原字面量**（保证渲染输出不变，既有用例零改动通过）。
- `apps/desktop/src/renderer/src/i18n/en-US.ts`（新）：与 zh-CN.ts 键集合**递归拍平完全同构**，值全英文；术语口径 Block/Page/Database/Property/View/Template/Trash/Workspace/Sync；按钮祈使短句。
- `apps/desktop/test/i18n.test.ts`：重写（原 T10-01 骨架测试）为 §0.D 门禁四项，9 例。
- 文案抽取改造（用户可见面全 t() 化）：`App.tsx`、`main.tsx`（locale 种子）、`SettingsPage.tsx`（含新增语言选择行）、`SidebarTree.tsx`、`TrashList.tsx`、`PageDeleteDialog.tsx`、`PageView.tsx`、`SearchPage.tsx`、`CommandPalette.tsx`、`ImportWizard.tsx`、`DbPage.tsx`、`AiSection.tsx`、`palette/commands.ts`、`state/pages.ts`、`state/templates.ts`。
- 红线遵守：只动 `renderer/src/**` 与 `apps/desktop/test/**`；不加依赖；不碰 git；CSS 未新增（语言选择复用 SettingsRow + RadioGroup 既有 `var(--sc-*)` 样式）；图标全部 `@septcats/ui` 出口。

## 2. §0.A locale 驱动要点

- 设置页「外观」区新增**语言**行（RadioGroup：跟随系统 / 简体中文 / English，`name="settings-locale"`），onChange 走既有 `settings.patch({ locale })` 路径（`handleLanguage`）。
- 启动种子在 `main.tsx`：`settings.get().then(...initLocale(s.locale))`，catch 分支按系统语言兜底（与主题种子的「不拦路」口径一致）。
- 重渲染链：`App` 顶层 `useLocale()` 订阅 → 切换语言整树重渲染（t() 渲染期现取）；`useCommandWiring` 依赖 locale，切换后命令面板命令重装配（`bindPaletteCommands` 绑定期经 `t()` 现取 label/hint，替代原模块加载期快照）。

## 3. DEVIATION（逐条）

1. **「跟随系统」无法落 settings**：platform schema 的 locale enum 只收 `zh-CN|en-US`（`packages/platform/src/settings.ts:37`，红线禁碰 packages/**），'system' 落库会被 main 侧 zod 拒绝。处理：跟随系统 = renderer localStorage 标记 `septcats.localePref=system`（`setLocalePref`），settings.locale 写入**最近一次解析值**（`systemLocale()`）；显式选择 zh/en 则清标记并 patch settings.locale。真相源分裂为「标记（跟随系统）+ settings.locale（显式值）」两层，是 schema 封闭下的最小方案；后续若 schema 放开 'system'，只需删标记层。
2. **既有测试断言中文 UI 文案**：**零改动**。策略是 zh-CN.ts 新旧键值逐字保留全部原字面量，抽取后渲染输出与抽取前 byte-identical，398 个既有用例原样通过（含 page-delete「及其 N 个子页面」、templates-ui「从模板新建：研究模板」、sync-ui「水位 12」等）。唯一重写的既有测试是 `i18n.test.ts` 本身（T10-01 骨架版 → T25-01 门禁版，任务 §0.D 明令的新交付物，非测试口径变更）。
3. **errorText 保留码后细节段**：错误码命中映射表后，main 消息里码后的细节（如 `E_MALFORMED：恢复码长度非法：期望 52 字符…`）拼在映射文案之后呈现——settings-react.test 既有断言 `toContain('恢复码长度非法')` 要求细节不丢；同时满足 PM「错误码 → t() 键呈现」。代价：en 界面下该细节仍是 main 侧中文（main 文案不动的必然结果，与 5 同口径）。首个 `E_*` 之后的段一律视为细节。
4. **键移除/合并**：`importWizard.errorPlan`/`errorTooLarge`/`errorTooLargeGeneric` → 合并为 `errorPlanFmt`/`errorTooLargeFmt`（占位符化）；`settings.about.statusError` → `statusErrorFmt`。移除前已 grep 确认无其余引用、无测试引用。
5. **AI 错误原文照展（不映射）**：`AiActionPanel`/`AiSection` 的 `E_AI_*` 错误保持原样展示——T18-03 契约「E_AI_* 原文照展」+ ai-panel.test（`E_AI_UNREACHABLE：端点不可达`）与 dbview-ai.test 既有断言。错误码→键映射表覆盖 pages/templates/settings 三个既有映射点（pages.ts、templates.ts、SettingsPage 的 describeError 统一走 `errorText`）。PM 真机全英文检查时，AI 错误提示含 main 侧中文属预期豁免。
6. **演示文档内容豁免**：`PageView` 的 `DEMO_PAGE`（「暗物质探测实验笔记」）与演示块文本视为示例用户内容（非界面骨架文案），不抽取；PM 真机检查「豁免用户内容」口径下 demo 页为预期中文残留。`DEFAULT_RECORD_TITLE = '未命名'` 是**写入数据库的默认标题**（与 main 侧 createPage 默认标题同口径），属数据默认值非展示文案，不抽。
7. **协议正则不抽**：`ImportWizard.toLargeCount` 的 `/单计划 (\d+) 个条目/` 是解析 main 侧 E_TOO_LARGE 消息的匹配常量（协议层，非展示文案）。
8. **en 语言选择器中 zh 选项名**：显示 `Chinese (Simplified)` 而非「简体中文」——门禁②（en 值无 CJK）的绝对性优先于「语言自称」惯例。
9. **renderer 内部错误消息部分英文化**：`bridge()`/`main.tsx` 挂载失败/`PageView` 未知块操作等 throw 消息改为英文（内部排障面，非用户可见文案）；`console.error/warn` 中文日志按「日志不抽」豁免原样保留（collabClient、PageView 等）。

## 4. 门禁四项实现说明（§0.D）

1. **键集合等价**：递归拍平 Map 全等比较，zh-only / en-only 分开报错，另断言 size 相等。
2. **无空值 + en 无 CJK**：两字典全键值非空 trim；CJK 范围含假名/谚文/全角/CJK 标点（`[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]`）。
3. **无残留硬编码**：扫描 `renderer/src/**`（.ts/.tsx，`i18n/` 目录豁免），剥块/行注释后：①JSX 文本（`>`…`<` 之间、`{…}` 容器外）加**形态守卫**（真 JSX 文本不含 `;(){}=` 等代码字符——防普通 TS 的 `=>` 跨界捕获误报）；②`aria-label|placeholder|title|alt|label` 的引号字面量。当前源码扫描零命中。
4. **切换 locale 关键文案**：en 下五处（顶栏 `Search (Ctrl+K)` / 侧栏 `Trash` / 面板 placeholder / 设置 `Language` / 对话框 `Delete Page`）+ 切回 zh 复原 + `useLocale` 订阅重渲染探针（zh→en→zh）+ `systemLocale` 回落断言。

## 5. 自跑输出原文

### 5.1 `pnpm -C apps/desktop test`

```
 Test Files  37 passed (37)
      Tests  407 passed (407)
   Start at  02:31:04
   Duration  26.09s (transform 2.74s, setup 0ms, collect 79.90s, tests 47.63s, environment 9.21s, prepare 101ms)
```

（act 环境告警修复后门禁单测复跑：`test/i18n.test.ts (9 tests) 30ms`，9 passed，无 stderr。）

### 5.2 `pnpm -r typecheck`

```
packages/importer typecheck$ tsc -p tsconfig.json --noEmit
packages/importer typecheck: Done
apps/desktop typecheck$ tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
apps/desktop typecheck: Done
```

### 5.3 `node packages/ui/tokens/no-magic.mjs`

```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### 5.4 `node packages/ui/tokens/build-tokens.mjs --check`

```
✓ token 产物与 DESIGN.md 一致
```

## 6. PM 复跑节（PM 补）

（PM 补）

## §6 PM 复跑（2026-09-19）

```
pnpm -r typecheck → 9/9 Done，0 错
pnpm -r test      → 全仓 989 无红（desktop 401→407 = +9 门禁用例，逐包对账一致）
no-magic ✓ / build-tokens --check ✓ / selftest → SELFTEST OK
重打包 + 真机 CDP（docs/mockups/cdp-e2e-t25-01.mjs，独立夹具根）→ 6 PASS / 1 FAIL（**真残留，已登记**）
```

| 环节 | 结果 | 证据 |
|---|---|---|
| 基线中文 | ✅ | 侧栏 CJK=16 |
| English 侧栏 | ✅ | `cjk=0` → `"Personal Workspace New Page Favorites 0 Recent 0 Trash"` |
| English 命令面板 | ✅ | `cjk=0` → `"Commands / New Page / Create a blank page at the top level …"` |
| **English 设置页** | ❌ | `cjk=7`：**顶栏同步状态「已同步」仍是中文**（`"Settings 已同步 Personal Workspace …"`），其余设置文案已英化 |
| 切回中文 | ✅ | 侧栏 CJK=16 恢复 |
| pageerror | ✅ | 0 |

**登记 T25-01-1（真残留 + 门禁盲区）**：①顶栏同步状态「已同步」未走 `t()`；②本单的门禁③只扫 JSX 文本/属性，**盲区=非 JSX 的 TS 字符串字面量**（该文案疑从 `.ts` 常量/映射产出）→ 需硬化门禁：扫描 renderer 源码中**非注释、非日志**的 CJK 字符串字面量（i18n 字典与测试豁免），防同类残留再次漏网。

**DEVIATIONS 追认（9 条，抽查核对）**：①「跟随系统」受 `packages/**` locale enum 只收 `zh-CN/en-US` 限制 → 用 renderer localStorage `septcats.localePref` 表达偏好（`system`/`zh-CN`/`en-US`），settings.locale 存最近解析值 ✓ 合理且未越红线；②错误码→文案映射 `errorText()` 收口三处 ✓；③AI 错误原文照展（第三方返回文本不改）✓；④演示内容豁免 ✓；⑤既有 398 用例零改动通过（渲染输出 byte-identical）✓ —— 这点很关键，说明抽取没改变既有行为。
