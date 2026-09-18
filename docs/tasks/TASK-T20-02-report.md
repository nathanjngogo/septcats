# TASK-T20-02 · 修复报告：rootPath 丢失（P0 数据级）/ UI 检索不发请求（P1）/ 主题双源（P2）

> 工程师：CodeBuddy ｜ 前置：`40191cc`（任务书提交）｜ 日期：2026-09-18
> 三处缺陷根因均按任务书 §0 的 PM 定位照做，未另择方案。SSIM-NOTE：本报告为唯一交付说明；§4 为 PM 复跑节留。

## §1 A（T20-01-1 · P0 数据级）`settings.patch` 抹掉 `rootPath`

**根因行**：`packages/platform/src/settings.ts` 原 `writeSettings()`：

```ts
const rootPath =
  patch.rootPath !== undefined && patch.rootPath.length > 0 ? patch.rootPath : undefined;
```

只看 patch、从不回退 `current.rootPath`，且 `main/settings.ts::patchAppSettings` 每次都以「无 rootPath 的 merged AppSettings」调 `writeSettings` → 文件里 rootPath 被抹掉 → 重启落默认根，用户笔记「看似消失」。

**修法**（同文件，取值三分支）：

```ts
const rootPath =
  patch.rootPath !== undefined
    ? patch.rootPath.length > 0
      ? patch.rootPath        // 显式非空 → 覆盖
      : undefined             // 显式空串 → 清除（空 = 无自定义根，语义不变）
    : current.rootPath;       // 缺省 → 保留（关键修复）
```

`apps/desktop/src/main/settings.ts` 未改动：`patchAppSettings` 传给 `writeSettings` 的 merged 不含 rootPath（= 缺省），新语义下自动保留。同步更新了 `writeSettings` JSDoc 与 `SeptcatsSettingsPatch` 注释。

**修复前红**（临时回退到旧取值逻辑实测，原文摘录）：

```
 ❯  platform  test/settings.test.ts (18 tests | 2 failed) 64ms
   × settings/读写 > writeSettings 原子写且可读回（rootPath 显式非空覆盖 + app settings merge）
   × settings/writeSettings rootPath 保留语义（TASK-T20-02 §0.A） > patch 只改无关字段（theme）→ rootPath 保留
 FAIL   platform  test/settings.test.ts > ... > patch 只改无关字段（theme）→ rootPath 保留
    115|     expect(s.rootPath).toBe(root);
 ❯  @septcats/desktop  test/settings.test.ts (5 tests | 1 failed) 16ms
   × main/settings（settings:get / settings:patch） > patch 后 rootPath 不被抹掉（TASK-T20-02 §0.A 端到端：patch → 读回仍在）
 FAIL   @septcats/desktop  test/settings.test.ts > ... > expect(readSettings(userData).rootPath).toBe(customRoot);
 Test Files  2 failed (2)
      Tests  3 failed | 20 passed (23)
```

**修复后绿**：

```
 Test Files  2 passed (2)
      Tests  23 passed (23)
```

**测试**：
- `packages/platform/test/settings.test.ts` 新增 describe「writeSettings rootPath 保留语义」3 条：patch 无关字段（theme）→ 保留 / patch 显式传 rootPath → 覆盖 / patch 显式传 `''` → 清除；
- `apps/desktop/test/settings.test.ts` 新增 1 条 main 级端到端：`writeSettings` 设自定义根 → `patchAppSettings` 只改 theme → `readSettings` 读回 `rootPath` 仍在；
- **口径说明（既有断言语义更新 1 处）**：`settings/读写 > writeSettings 原子写且可读回` 原钉「`writeSettings(userData, {})` 清空 rootPath」——该断言钉的正是本缺陷的旧行为，与裁决「缺省 → 保留」直接冲突，无法两全。已改为钉新语义（缺省保留 + 显式空串清除），其余既有断言一律未动、只追加。

## §2 B（T20-01-2 · P1 可用性）命令面板/搜索页检索不发请求

**根因行**：`renderer/src/state/palette.ts:89-93` 读 `pagesStore.workspaceId`，为 `null` 时静默早退；而设置该字段的 `pagesActions.load()`（`state/pages.ts:233`）在全 renderer 无任何调用点（PM grep 零命中），`workspaceId` 恒为 `null` → `window.septcats.search.query` 永不被调（PM 真机拦截 `calls: []`）。

**修法**：`apps/desktop/src/renderer/src/App.tsx` `App()` 组件挂载 effect 调用一次：

```ts
useEffect(() => {
  void pagesActions.load();
}, []);
```

幂等性：`load()` 重复调用只是多一次 `workspaces.list()`/树拉取 IPC 并以同一 `activeId` 覆盖同一状态切片，StrictMode 双挂载不产生状态抖动。未新增 UI、未改侧栏假树、未动 palette 门槛逻辑。

**修复前红 / 修复后绿**：本缺陷是「无调用点」而非 `load()` 逻辑错误——store 单测层不存在可复现的「修复前红」（`load()` 行为自 T6-01 起一直正确）；红牌证据即任务书 §0.B 引用的 PM 真机拦截 `calls: []`。按任务书 §1 的口径，在 `apps/desktop/test` 新增 store 单测（renderer 无 React 测试环境，vitest 纯 Node + 假 `window.septcats` 桥，jsdom 仅为 `@septcats/editor` 导入图兜底）：

```
 ✓  @septcats/desktop  test/pages-store.test.ts (3 tests) 4ms
   ✓ pages store / load 初始化（TASK-T20-02 §0.B） > load() 后 workspaceId 非 null 且 status ready（命令面板检索门槛就位）
   ✓ pages store / load 初始化（TASK-T20-02 §0.B） > 重复 load()（StrictMode 双挂载）幂等：workspaceId 稳定、无 error、不产生抖动
   ✓ pages store / load 初始化（TASK-T20-02 §0.B） > 桥异常时 load() 落 error 态而非抛出（workspaceId 保持 null，检索仍静默早退）
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

UI 真发请求的验收归 PM：命令面板输入 2 字「量子」必须出结果（`cdp-e2e-t20-01.mjs`）。

## §3 C（T20-01-3 · P2 一致性）主题双源

**根因**：`packages/ui` ThemeProvider 以 localStorage 为真相源（`theme.test.tsx` 已钉）；而 renderer `main.tsx` 原来每次启动**无条件** `setGlobalThemeMode(s.theme)`——settings 恒压过 localStorage，「settings 写 dark 但首启仍 light」实为两源打架（真机 `probe-t20-settings.mjs` 实证）。

**修法**（按裁决「以 localStorage 为准、仅无 theme 时种子」实现，未跳过——成本一处判定函数 + 一次条件判断，远低于价值）：
- `packages/ui/src/theme.tsx` 新增导出 `hasStoredTheme(storageKey?)`：判定 localStorage 是否已有合法 theme（light/dark/system 之外视为无；存储异常视为无）；
- `apps/desktop/src/renderer/src/main.tsx`：**挂载前**同步取 `shouldSeedTheme = !hasStoredTheme()`（必须在 Provider 挂载前——Provider 挂载即写回默认 `'system'`，挂载后判定恒真），`settings.get()` 成功后仅当 `shouldSeedTheme` 才 `setGlobalThemeMode(s.theme)` 作一次性种子；之后仍以 localStorage 为准，**不做双向同步**。原「主题真相 = main 侧 settings.json」的过时注释一并更正。

**修复前红 / 修复后绿**：种子判定为新增单元，无「修复前红」可比对；缺陷行为的红牌即任务书 §0.C 引用的 `probe-t20-settings.mjs` 真机实证。新增 3 条单测钉判定语义（`packages/ui/src/theme.test.tsx`，既有断言只追加未动）：

```
 ✓  ui  src/theme.test.tsx (6 tests) ...
   ✓ hasStoredTheme（TASK-T20-02 §0.C 主题双源：localStorage 为真相源） > localStorage 无 theme / 值非法 → false（应作 settings 种子）
   ✓ hasStoredTheme（TASK-T20-02 §0.C 主题双源：localStorage 为真相源） > localStorage 已有合法 theme → true（settings 不再播种，以 localStorage 为准）
   ✓ hasStoredTheme（TASK-T20-02 §0.C 主题双源：localStorage 为真相源） > ThemeProvider 挂载写入后即视为已有主题（启动方须在挂载前判定）
```

（ui 包全套 `Test Files 27 passed (27) / Tests 73 passed (73)`。）

## §4 PM 复跑（2026-09-18）

```
node apps/desktop/scripts/ensure-abi.mjs node
pnpm -r typecheck                     → 9/9 Done，0 错
pnpm -r test                          → 全仓 906 无红（896+10：platform+3 / ui+3 / desktop+4 ✓ 逐包对账一致）
node packages/ui/tokens/no-magic.mjs  → ✓
pnpm -C apps/desktop selftest         → SELFTEST OK
重打包（dist）+ 两个真机探针（独立夹具根，每次断言 settings 未被改写）
```
**真机验收（验收红线逐条，独立夹具根，非合成夹具）**

| 项 | 结果 | 证据 |
|---|---|---|
| A rootPath 保留 | ✅ **ASSERT PASS** | `probe-t20-settings.mjs`：patch 前 `keys=[schema,rootPath,theme]` → patch 后 **rootPath 仍在**；**二次启动后仍在**（此前 patch 后即消失） |
| B 面板 2 字检索 | ✅ **红线通过** | `cdp-e2e-t20-01.mjs`：命令面板输入 2 字「量子」→ 真实命中行「量子实验记录」（1 字「量」、≥3 字「量子实验」、负样本不含无关页 全通过） |
| C 主题种子 | ✅ 生效 | 同脚本：开机 `data-theme=dark`（夹具 dark、localStorage 为空 → settings 播种成功） |
| 对比度真机实测 | ✅ | 深色 `.palette-esc`/`.palette-foot` = **4.80**（rgb(142,148,160) on rgb(38,41,45) = #8E94A0 on #26292D），**与 PM 算值完全一致** |
| 全程零 pageerror | ✅ | errors=0 |

**PM 亲修 1 处（超出工程师交付范围，属 C 的收尾）**：`packages/ui/src/theme.tsx` —— `setGlobalThemeMode` 原先**只派发事件**，而 `settings.get()`（异步 IPC）结算常早于 `ThemeProvider` 挂载 → 事件无人接收、播种静默失效（首发真机探针即因此红）。修法：加单槽 `pendingMode` 缓冲（派发同时暂存），Provider 初始化 `defaultMode ?? takePendingMode() ?? readStoredMode()` 消费；新增 2 条用例（挂载前播种生效 / 已挂载仍走事件管道不回归）；ui 73→75。**这是 C 端到端能过的必要条件**，工程师单测层无从暴露（其 `hasStoredTheme` 语义正确）。

**报告口径说明（诚实标注）**：`cdp-e2e-t20-01.mjs` 第 ⑤ 步「浅色复测」的标签有误导——patch theme=light 后由于 **C 的设计（localStorage 为真相源，settings 仅作无 theme 时的种子）**，实际仍是 dark，故该两行实测值与深色相同（4.80）。浅色值由 ① 门禁测试（`contrast.test.ts`，两主题断言）与 PM 算值（5.29）保证，非未验证项。

**DEVIATIONS 追认**：工程师 1 处既有断言语义更新（`writeSettings` 空 patch 清空 rootPath 的旧断言，钉的正是被修复的缺陷行为，与裁决冲突不可两全，改为钉新语义）——**接受**；其余零越界（未碰搜索 SQL/对比度门禁/core/sync/editor/main collab-sync/CI）。
**遗留**：`docs/perf-history.jsonl` 自动追加行为既有、由 PM 收口提交。

## 附：工程师自跑记录

| 命令 | 结果 |
| --- | --- |
| `pnpm -C packages/platform test` | 4 files / 41 passed + 1 skipped（credentials 真实后端 1 条环境跳过，既有行为） |
| `pnpm -C apps/desktop test` | 31 files / 326 passed（含新增 pages-store.test.ts 3 条、settings.test.ts 追加 1 条） |
| `pnpm -r typecheck` | 全部 Done（含 desktop node+web 双 tsconfig） |
| `node packages/ui/tokens/no-magic.mjs` | ✓ 组件 CSS 无字面 hex、无非 1px 重复裸 px |

全仓 `pnpm -r test` + selftest + 重打包 + 真机冒烟（`probe-t20-settings.mjs` / `cdp-e2e-t20-01.mjs`）留 PM。

边界说明：`docs/perf-history.jsonl` 由 `perf.test.ts` 运行时自动追加基线记录（测试副作用，非手工改动），请 PM 收口时留意。

DEVIATIONS：
- §1 所述 1 处既有断言语义更新（旧断言钉的是被修复的缺陷行为，属裁决的直接后果，非另择方案）；
- 其余为零：不加依赖、未碰搜索 SQL/白名单/对比度门禁、未碰 core/sync/editor、未碰 main/{collab,sync}、未碰 IPC 形状、未碰 CI/发布脚本、未碰 git。
