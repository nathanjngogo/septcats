# TASK-T72-01 报告 · 工作台模板市场（PRD-R20 条目③+④的壳）

> 基线 = main HEAD `4edf260`（T71 收口后）。分支 `feat/t72-template-market`，工作目录 `.worktrees/t72-market`。
> 分工：CB 写码（只 Write/Edit 落盘，**不碰 git**、不 merge/push、不跑全仓打包）；PM 复跑门禁+真机验收+提交。
> 门禁原始输出见 §7；全部自跑通过（typecheck 0 错 / desktop 1011 绿 / packages-ui 157 绿 / no-magic ✓）。

## §1 交付概览

| 范围 | 交付物 | 状态 |
|---|---|---|
| 范围1 入口改造 | 顶栏 `workbench-market-open`（店铺 glyph）、市场页内 `workbench-open`（我的工作台）、命令面板双命令（`app.workbenchMarket` + 既有工作台命令）、Alt+H 开市场、i18n zh/en | ✅ 完成 |
| 范围2 市场页壳+两 Tab | `TemplateMarketPage` region 页、模板/卡片两 Tab、应用/还原/导出/导入、卡片开关同源 `setCardHidden` | ✅ 完成 |
| 范围3 内置模板 ≥4 + 只读通道 | 4 个 JSON（`work-journal`/`project-board`/`reading-tracker`/`weekly-review`）、main `workbenchTemplates.list` 只读服务、preload 暴露、`electron-builder.yml` extraResources | ✅ 完成 |
| 范围4 另存为模板 | `TemplateKind+'workbench'`、`templates.saveWorkbench`、wb-save-template 弹框、删除（软删口径） | ✅ 完成 |
| 范围5 导入/导出 | 单 JSON 导出、粘贴/文件导入校验（`parseWorkbenchTemplateText`）、坏 JSON toast 不落库 | ✅ 完成 |

## §2 用例计数

| 套件 | 文件 | 用例数 | 备注 |
|---|---|---|---|
| market(renderer 模型/边界) | apps/desktop/test/t72-market-model.test.ts（新） | 15 | parseWorkbenchTemplateText（合法/坏JSON/缺title/缺layout/形状/非对象/seedPages）、normalizeLayout（未知id丢弃+补尾）、内置4 JSON 形状校验、applyTemplateToWorkbench 布局落地、toggleWorkbenchCard===workbenchActions.setCardHidden（spy）、备份/还原往返 |
| workbenchTemplates(主进程只读通道) | apps/desktop/test/workbenchTemplates.test.ts（新） | 6 | list() 注入 resourcesDir→4 内置模板形状齐备；parseWorkbenchTemplateFile 坏JSON/非对象/缺title/形状不合法→null；合法→落库形状 |
| templates(saveWorkbench) | apps/desktop/test/templates.test.ts（追加 2） | +2 | saveWorkbench 落库 kind=workbench + payload.layout/seedPages；非法入参 E_MALFORMED（空title/形状/seedPages非数组） |
| i18n / t58 / t66 | 既有套件（修正/豁免，不计新增） | — | i18n 键齐平门禁通过；t58 加 PixelShopGlyph 豁免；t66 顶栏钮/Alt+H/Esc 接线修正 |
| **新增合计** | | **≥23** | 目标 ≥12，已满 |

> 四强制类别全覆盖：内置 JSON 形状校验（t72-model + workbenchTemplates）、apply 布局落地（t72-model）、坏 JSON 拒绝（t72-model + workbenchTemplates）、card toggle 同源 setCardHidden（t72-model spy）。

## §3 验收锚（PM 真机节）

> 本节由 PM 真机验收填写。CB 仅列出真机可验收的 testid 清单与口径。

- 真机 testid 清单（按施工单 §1）：`workbench-market-open`、`workbench-open`、`wb-market-close`、`wb-market-tab-templates`、`wb-market-tab-cards`、`wb-market-template-<id>`、`wb-market-template-apply-<id>`、`wb-apply-confirm`、`wb-restore-layout`、`wb-market-card-<id>`、`wb-market-card-status-<id>`、`wb-market-card-toggle-<id>`、`wb-save-template`、`wb-save-template-title`、`wb-save-template-page-<pageId>`、`wb-save-template-confirm`、`wb-market-template-delete-<id>`、`wb-market-template-export-<id>`、`wb-market-import`、`wb-market-import-text`、`wb-market-import-confirm`。
- 口径：市场开合/两 Tab/应用模板前后布局可一键还原/另存为模板→出现在我的模板/导出 JSON 再导入还原；老探针 T61/T60/T65/T66/T67-B2/T59 零回归。

## §4 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| D1 | 工作树 `node_modules` 由符号链接改为 `pnpm install --offline` 本地化 | 接受 | 符号链接使 `@septcats/*` 解析到主树源码，引发双实例致 `backlinks-panel` 等无关用例挂死；本地化后全绿（不碰主树）。 |
| D2 | 报告文件名用仓库约定 `TASK-T72-01-report.md`（施工单字面 `T72-01-report.md`） | 接受 | 仓库既有报告均带 `TASK-` 前缀，统一口径。 |
| D3 | 顶栏店铺 glyph 用本地 `PixelShopGlyph` | 接受 | 已加入 t58 `T66_LOCAL_GLYPHS` 豁免，与既有 `PixelHomeGlyph` 同口径，待 PM 收编进 @septcats/ui。 |
| D4 | 市场「打开」语义为 open 非 toggle | 接受 | 施工单 §1 口径：Alt+H 与顶栏钮只开市场、Esc 关；原 `workbench-open` 移入市场内作为「我的工作台」行按钮（保留 testid）。 |
| D5 | 应用确认内联 `wb-apply-confirm`（市场页内联 Dialog） | 接受 | 未单列确认组件，市场页内联即可满足应用前二次确认。 |
| D6 | 我的模板预览从简（列表展示，未做整页预览抽屉） | 接受 | 施工单未强制预览抽屉；内置模板已在 builtinSection 列表呈现标题/说明。 |
| D7 | 种子页正文抽取为纯文本（ProseMirror 块树→纯文本） | 接受 | 种子页正文只需纯文本梗概；建页失败/写正文失败降级只建页，不阻断模板应用（施工单允许降级）。 |

## §5 文件改动清单

| 文件 | 改动类型 | 关联范围 / 红线 |
|---|---|---|
| apps/desktop/electron-builder.yml | 改 | extraResources 一段（白名单）· 范围3 |
| apps/desktop/src/db/statements.ts | 改 | `TemplateKind+'workbench'`（白名单）· 范围4 |
| apps/desktop/src/main/index.ts | 改 | 注册 `workbenchTemplates.list` 通道（白名单）· 范围3 |
| apps/desktop/src/main/templates.ts | 改 | `saveWorkbench` 校验+落库（白名单）· 范围4 |
| apps/desktop/src/main/workbenchTemplates.ts | 新 | 内置模板只读服务（白名单 `workbenchTemplates.list`）· 范围3 |
| apps/desktop/src/preload/index.ts | 改 | 暴露 `workbenchTemplates.list` + `templates.saveWorkbench`（白名单） |
| apps/desktop/src/shared/ipc.ts | 改 | 通道常量（白名单 plumbing） |
| apps/desktop/src/types/window.d.ts | 改 | `SeptcatsWorkbenchTemplatesApi` + saveWorkbench 类型（白名单类型） |
| apps/desktop/src/renderer/src/App.tsx | 改 | 入口改造：市场钮/Alt+H/Esc（范围1） |
| apps/desktop/src/renderer/src/i18n/zh-CN.ts | 改 | T72 键（zh）· i18n 齐平 |
| apps/desktop/src/renderer/src/i18n/en-US.ts | 改 | T72 键（en）· i18n 齐平 |
| apps/desktop/src/renderer/src/palette/commands.ts | 改 | 命令面板双命令（范围1） |
| apps/desktop/src/renderer/src/state/templates.ts | 改 | `templatesActions.saveWorkbench`（范围4） |
| apps/desktop/src/renderer/src/workbench/WorkbenchPage.tsx | 改 | 我的工作台入口 + 另存为入口（范围1/4） |
| apps/desktop/src/renderer/src/workbench/pixelGlyph.tsx | 改 | `PixelShopGlyph` 本地 glyph（范围1 / D3） |
| apps/desktop/src/renderer/src/workbench/market.ts | 新 | 纯模型/边界函数（parse/normalize/apply/backup/extract/seed） |
| apps/desktop/src/renderer/src/workbench/TemplateMarketPage.tsx | 新 | 市场页壳 + 两 Tab + 应用/还原/导出/导入/卡片开关（范围2/5） |
| apps/desktop/src/renderer/src/workbench/TemplateMarketPage.css | 新 | 市场页 token-only 样式（§16 框线纪律） |
| apps/desktop/src/renderer/src/workbench/SaveTemplateDialog.tsx | 新 | 另存为模板弹框（范围4） |
| apps/desktop/src/renderer/src/workbench/SaveTemplateDialog.css | 新 | 弹框 token-only 样式 |
| apps/desktop/resources/workbench-templates/*.json | 新（4） | 内置模板 JSON（白名单）· 范围3 |
| apps/desktop/test/t72-market-model.test.ts | 新 | 渲染无关模型单测（§2，15 例） |
| apps/desktop/test/workbenchTemplates.test.ts | 新 | 主进程只读通道单测（§2，6 例） |
| apps/desktop/test/templates.test.ts | 改 | saveWorkbench 追加 2 例（§2） |
| apps/desktop/test/t66-workbench-ui.test.tsx | 改 | 顶栏钮/Alt+H/Esc 接线修正（范围1） |
| apps/desktop/test/t58-pixel-icons.test.ts | 改 | PixelShopGlyph 加入豁免（D3） |

## §6 红线自检

- [x] 不碰 op-log / SCHEMA / 锁表 / 同步 / AI / 搜索
- [x] 不建新表（仅扩 `TemplateKind` + templates slice，落 `templates/` 数据根，软删口径）
- [x] 不加新依赖（`pnpm install --offline` 仅链接既有 store，lockfile 未变）
- [x] 无 TODO（全文无遗留 TODO）
- [x] main/preload/shared 改动仅限白名单：`TemplateKind+'workbench'`、`templates.saveWorkbench`、`workbenchTemplates.list`、`electron-builder.yml` extraResources 一段、4 个内置 JSON
- [x] §16 框线纪律：轮廓一律 `var(--sc-color-ink-edge)`（1px 内网格 / 2px 外框），禁灰线；CSS 走 token（`no-magic` ✓ 零违规）
- [x] 禁词「数据库」→「多维数据」（`i18n.test.ts` 门禁⑥通过：zh-CN 无任何「数据库」）
- [x] i18n zh/en 齐平（`apps/desktop/test/i18n.test.ts` 通过：键集合等价 + 无 CJK 残留 + 无空值）
- [x] 隐私：零外联；模板 JSON 不内嵌 URL 请求；未新增 `openExternal` 通道
- [x] 未碰 git（未 commit/merge/push）；未动主树

## §7 门禁原始输出

### `pnpm typecheck`（目标 0 错）→ 0 错 ✅
```
> tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
（无输出，Exit Code 0）
```

### `pnpm -C apps/desktop exec vitest run`（目标全绿，只增不减）→ 全绿 ✅
```
 Test Files  94 passed (94)
      Tests  1011 passed (1011)
```
> 含 DB 端到端真 SQLite 用例（better-sqlite3 已 rebuild）；backlinks-panel / i18n / t58 等无关用例全绿；无 `[i18n] missing key` 警告。

### `pnpm -C packages/ui exec vitest run`（目标全绿）→ 全绿 ✅
```
 Test Files  32 passed (32)
      Tests  157 passed (157)
```

### `node packages/ui/tokens/no-magic.mjs`（目标 ✓）→ ✓ ✅
```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

---

> 收尾：`CB-T72-EXIT=0`。未 merge / 未 push / 未动主树。

---

## §8 PM 真机缺陷修复（T72-02 · T72 真机首轮两缺陷收口）

> 来源：真机探针 `docs/mockups/cdp-e2e-t72-01.mjs` 首轮抓到 2 个产品缺陷。PM 已在主树工作区落下**底稿修复**（未提交），CB 在本单：**审查底稿 + 补 3 个回归钉 + 四门禁定稿**（任务书 `docs/tasks/TASK-T72-02.md`）。
> 本单未改任何产品源码逻辑（底稿原样保留），仅新增 3 个测试用例 + 本文档章节；DEVIATION 续号 D8–D10。

### §8.1 缺陷1 · dev 态内置模板空列表

- **现象**：dev 运行（非打包）进入模板市场，「内置模板」区恒为空；打包态正常。
- **根因**：`apps/desktop/src/main/workbenchTemplates.ts` 的 `candidateDirs()` dev 分支原为 `join(__dirname,'..','..')`。dev 态 `__dirname` = `apps/desktop/out/main`（源码态 = `apps/desktop/src/main`），上溯两级 = `apps/desktop`，再拼 `workbench-templates` = `apps/desktop/workbench-templates`——该目录不存在（真实资源在 `apps/desktop/resources/workbench-templates/`）。`existsSync` 永假 → 无候选命中 → `list()` 返回 `{templates: []}` → 内置区全空。
- **修复（PM 底稿，CB 审查通过）**：dev 候选补齐一层 `resources`：`join(__dirname,'..','..','resources')`；并追加 `join(process.cwd(),'resources')` 兜底。两级上溯从 `out/main`（打包 dev 产物）与 `src/main`（vitest 源态）均得 `apps/desktop`，拼接后均命中真实 `resources/`，与打包态 `<resourcesPath>/workbench-templates` 对齐。
- **审查结论**：正确、最小、与 `main/tray.ts` 三元组兜底同范式；候选顺序（resourcesPath 优先、命中即 break）与既有 `list()` 语义不冲突。**未重写**。

### §8.2 缺陷2 · 备份恒 null → 「还原备份」不可用

- **现象**：全新用户（从未动过卡）进入市场→应用模板→点「还原备份」无效果；真机 M4-a 实锤。
- **根因**：`apps/desktop/src/renderer/src/workbench/market.ts` 的 `backupCurrentLayout()` 仅读 `readCardsPersist()`（localStorage 投影）。LS 无记录时返回 `null` → 调用方 `writeLayoutBackup(null)` 清除备份 → 应用模板改写布局后无处可还原。但**照施工单 §范围2 语义，「应用前备份当前布局」的真相源是 store 当前布局，LS 只是持久化投影**。
- **修复（PM 底稿，CB 审查通过）**：`persist !== null` 时照旧 `stringify(persist)`；否则兜底读 `workbenchStore.getState()` 的 `{v:WORKBENCH_CARDS_PERSIST_VERSION, order:cardOrder, hidden:hiddenCards}`（数组浅拷贝 `[...]`）。
- **审查结论**：`workbenchStore.getState()` 为一次性快照读、**不引入新订阅**；深拷贝数组隔离引用；显式 `WorkbenchCardsPersist` 注解无害。语义与 `captureCurrentLayout()`（同样直读 store）**一致**——两处同源取当前布局，属正确收敛。**未重写**。

### §8.3 回归钉（新增 3 例 · 已验红）

| # | 文件 | 用例名 | 钉住什么 |
|---|---|---|---|
| 1 | `apps/desktop/test/workbenchTemplates.test.ts` | dev 无参路径（不注入 resourcesDir）：cwd 隔离后仍经 __dirname 相对布局读到 4 内置模板 | 把 `process.cwd()` 兜底隔离到一棵**不含 resources/** 的临时树，只留 `join(__dirname,'..','..','resources')` 候选；4 模板可读即证明目录拼接正确。改回少拼一层 → 0 模板 → 红。 |
| 2 | `apps/desktop/test/t72-market-model.test.ts` | LS 清空 + store 默认态 → backupCurrentLayout 返回 v:2 合法 JSON（order=默认 11 序，hidden 空） | 钉住「LS 无记录不得返回 null」：断言前置 `readCardsPersist()===null` 后，备份仍为 `{v:2, order=DEFAULT_CARD_ORDER(11), hidden:[]}`。 |
| 3 | `apps/desktop/test/t72-market-model.test.ts` | 兜底备份经 restoreLayoutBackup 回放 → 不崩且序与默认一致（还原可用） | 钉住「还原链路可用」：倒序+隐 recent 模拟应用模板后的新布局，回放兜底备份 → 不抛且 `order===默认序`、`hidden===[]`。 |

- **验红取证**（临时回退两处底稿 → 跑两套件，再原样复原）：
```
 Test Files  2 failed (2)
      Tests  3 failed | 21 passed (24)
```
  失败点恰为上述 3 例（缺陷1 用例得 `[]`、缺陷2 两例得 `null`），证明回归钉真实钉住缺陷场景；复原后 3 例转绿。

### §8.4 门禁原始输出（本单自跑）

#### `pnpm typecheck`（目标 0 错）→ 0 错 ✅
```
Scope: 9 of 10 workspace projects
（各包 typecheck: Done，含 apps/desktop tsc -p tsconfig.node.json && -p tsconfig.web.json）
TYPECHECK_EXIT=0
```

#### `pnpm -C apps/desktop exec vitest run`（目标全绿，只增不减）→ 94/94 全绿 ✅
```
 Test Files  94 passed (94)
      Tests  1014 passed (1014)
```
> 基线（T72-01 §7）1011 → 本单 **1014（+3，即 §8.3 三例）**，无删减、无关模块零回归。
> 前置：`node scripts/ensure-abi.mjs node` 已先对齐 better-sqlite3 原生 ABI（`exec vitest run` 绕过 `pretest` 钩子；未对齐时 DB 用例会以 `NODE_MODULE_VERSION` 不符跳过 13 个文件，非绿账口径）。

#### `pnpm -C packages/ui exec vitest run`（目标全绿）→ 157 全绿 ✅
```
 Test Files  32 passed (32)
      Tests  157 passed (157)
```

#### `node packages/ui/tokens/no-magic.mjs`（目标 ✓）→ ✓ ✅
```
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
NO_MAGIC_EXIT=0
```

### §8.5 DEVIATION 续号（D8–D10）

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| D8 | 底稿 `backupCurrentLayout` 注释称「显式注解打断 tsc 联合推导，修 T72 TS2589」 | 保留注解，注释照旧 | CB 复核：`tsc` 全量 0 错、未复现 TS2589；该显式 `WorkbenchCardsPersist` 注解**无害**且可在未来联合类型拓宽时防推导失败，故原样保留（不回退、不改注释，避免无谓噪声）。 |
| D9 | dev 候选新增 `join(process.cwd(),'resources')` 与 `join(__dirname,'..','..','resources')` 在 dev 下解析到同一目录（冗余）；且两条 push 同处一个 `try`，`__dirname` 抛错时会连带跳过 cwd 兜底 | 接受 | dev/打包态 main 均为 CJS，`__dirname` 恒可用，cwd 冗余仅为 alternate-cwd 稳健性；主树未采用 ESM main，理论死角不存在。若未来 main 转 ESM，再把 cwd 兜底移出 `try`（届时立账）。 |
| D10 | 缺陷1 回归钉未按任务书字面「建含真实 `resources/workbench-templates` 相对布局的临时目录树」，改用 `vi.spyOn(process,'cwd')` 隔离 cwd 兜底候选 | 接受 | 无参路径的目录由编译期 `__dirname` 决定、运行期无法改指；隔离 cwd 兜底是**唯一**能让 `__dirname` 相对候选独立受检、且回退即红的手法（已验红，见 §8.3），比真建临时树更贴近「防目录拼接回退」的目标。 |

> 收尾：`CB-T72-02-EXIT=0`。未 merge / 未 push / 未动主树 / 未建表 / 未加依赖。

