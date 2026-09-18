# TASK-T20-02 · 缺陷修复：rootPath 丢失（P0 数据级）/ UI 检索不发请求（P1）/ 主题双源（P2）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 前置：T20-01 已交付（`edce765`）
> 来历：T20-01 **PM 真机复核期间挖出的三个既有缺陷**（`docs/tasks/TASK-T20-01-report.md` §6 + `docs/MILESTONES.md` 待修清单 T20-01-1/2/3）。三处都有可复跑的铁证探针。

## 0. 根因与 PM 裁决（均已定位到行，勿另择方案）

### A. T20-01-1（P0·数据级）`settings.patch` 抹掉 `rootPath`
**根因（PM 定位）**：`packages/platform/src/settings.ts` 的 `writeSettings()`：
```ts
const rootPath = patch.rootPath !== undefined && patch.rootPath.length > 0 ? patch.rootPath : undefined;
const merged = mergeSettingsPatch({ ...current, ... }, patch);
const payload = composeSettings(rootPath, merged);   // ← rootPath=undefined → 文件里没有 rootPath
```
**只看 patch、从不回退 `current.rootPath`**。而 `mergeSettingsPatch` 只处理 AppSettings（rootPath 在文件顶层、不在 schema 内），于是 `main/settings.ts::patchAppSettings` 每次 patch 都把文件里的 `rootPath` 抹掉。
**后果**（已实测）：改过任意设置 → 重启 → `rootPath` 缺失 → 落到默认根 → **用户笔记「看似消失」且可能向另一根写入分叉**。
**裁决修法**：`rootPath` 取值改为——
- patch **显式传非空字符串** → 用 patch 值（改根路径）；
- patch **显式传空串** → 清除（保持既有「空 = 无自定义根」语义）；
- patch **缺省** → **保留 `current.rootPath`**（关键修复）。

### B. T20-01-2（P1·可用性）命令面板/搜索页检索根本不发请求
**根因（PM 定位 + 真机拦截取证）**：`renderer/src/state/palette.ts:89` 读 `pagesStore.workspaceId`，为 `null` 时**静默早退**（不改状态、不报错）；而设置该字段的动作 `pagesActions.load()`（`state/pages.ts:233`，内部 `workspaces.list()` → `workspaceId: activeId`）**在整个 renderer 里没有任何调用点**（PM grep 全仓零命中）。真机拦截 `window.septcats.search.query` 得到 `calls: []`，列表恒显示「没有匹配的命令或内容」。
**后果**：UI 内搜索完全不可用（后端/服务层正常，T20-01 的真机 IPC 实测已证 2 字命中）。
**裁决修法**：在 renderer **挂载时调用一次 `pagesActions.load()`**（`App.tsx` 或 `main.tsx` 的 mount effect；需幂等/防 StrictMode 双调用——重复调用只多一次 IPC，不得产生状态抖动），使 `workspaceId` 就位。**不新增 UI、不改造侧栏假树**（假树是设计稿，另属模块）。

### C. T20-01-3（P2·一致性）主题双源
`packages/ui` 的 `ThemeProvider` 写 `documentElement[data-theme]` 并**持久化到 localStorage**（`theme.test.tsx` 已钉）；而 `settings` 文件里也有 `theme` 字段 —— 两者未打通，导致「settings 写 dark 但首启仍 light」（真机实证 `probe-t20-settings.mjs`）。
**裁决**：以 **localStorage 为准**（UI 现行为真源）；启动时**仅当 localStorage 无 theme** 时，用 `settings.read().theme` 作**种子**（一次性；不做双向同步，避免两源打架）。若判定成本高于价值，可只补一段代码注释说明口径、报告里写明「本期不改」，由 PM 决定是否落到视觉打磨批次 2。

## 1. 交付物与验收

- A：`packages/platform/src/settings.ts` 一处取值修复 + 测试（**必须真做**）：
  - 平台级：「patch 无关字段（如 theme）→ `rootPath` 保留」「patch 传 rootPath → 覆盖」「patch 传 `rootPath:''` → 清除」；
  - main 级：`settings:patch` 端到端一条（patch → 读回，`rootPath` 仍在）。
- B：`renderer` 挂载点一行初始化 + 测试（若 renderer 无测试环境，则在 `apps/desktop/test` 用 store 单测钉 `load()` 后 `workspaceId` 非 null；报告说明口径）。
- C：按裁决实现或明确「本期不改 + 理由」。
- 报告 `docs/tasks/TASK-T20-02-report.md`：每条缺陷的「根因行 → 修法 → 修复前红/修复后绿原文」+ PM 复跑节留「（PM 补）」。

## 2. 红线

- 允许动：`packages/platform/src/settings.ts`（及其 test）、`apps/desktop/src/main/settings.ts`（如需）、`apps/desktop/src/renderer/src/state/pages.ts`、`apps/desktop/src/renderer/src/{App,main}.tsx`、`packages/ui` 主题种子（仅 C）、各对应 test。
- 不碰：搜索 SQL/白名单/对比度门禁（T20-01 已验收物）、`packages/{core,sync,editor}`、`main/{collab,sync}`、IPC 形状（除 B 可能新增的只读调用）、CI/发布脚本。
- 不加新依赖；不碰 git；禁占位符/TODO；既有测试断言语义不变（只许追加）。

## 3. 自跑（全仓与真机冒烟留 PM）

`pnpm -C packages/platform test`、`pnpm -C apps/desktop test`、`pnpm -r typecheck`、`node packages/ui/tokens/no-magic.mjs`。
**PM 收口会跑**：全仓 `pnpm -r test` + selftest + 重打包 + 复跑 `docs/mockups/probe-t20-settings.mjs`（A 的铁证）与 `docs/mockups/cdp-e2e-t20-01.mjs`（B 的验收红线：**命令面板输入 2 字「量子」必须出结果**）。