# TASK-T27-01 交付报告 · 收尾：默认工作区名按 locale 种子 + 交互态/空态巡检（S4 批次 3）

> 工程师：CodeBuddy ｜ 日期：2026-09-19 ｜ 前置：`6522b0c`（任务书）已确认

## 0. 结论

A（T26-01-1）与 B（S4 批次 3）均按任务书 §0 裁决交付。自跑四件套全绿：
`pnpm -C apps/desktop test` **422 passed**（39 文件；含新增 2 文件 14 用例）、
`pnpm -r typecheck` 全绿、`no-magic` ✓、`build-tokens --check` ✓。
全仓 / selftest / 重打包 / 真机留 PM。

## 1. A · 默认工作区名按「创建时 locale」种子

**事实链**：建库（首次自动建工作区）在 main 侧 `requireActiveWorkspace`（`apps/desktop/src/main/pages.ts`，唯一读路径写入，renderer 无法先行拦截），原种子写死中文 `DEFAULT_WORKSPACE_NAME`。

改动：

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/main/pages.ts` | ① 新增导出 `defaultWorkspaceNameForLocale(locale)`：`zh* → 个人工作区`，其余/空 → `Personal Workspace`；② `PagesServiceOptions` 增可选 `defaultWorkspaceName`；③ `requireActiveWorkspace` 种子名取 `options.defaultWorkspaceName ?? DEFAULT_WORKSPACE_NAME` |
| `apps/desktop/src/main/index.ts` | 接线一处：`createPagesService({ ..., defaultWorkspaceName: defaultWorkspaceNameForLocale(app.getLocale()) })` |
| `renderer/src/i18n/zh-CN.ts` / `en-US.ts` | 新增 `workspace.defaultName`（个人工作区 / Personal Workspace），作种子名文案单一基准 |
| `apps/desktop/test/workspace-seed.test.ts`（新） | 5 用例：en 口径注入 → `Personal Workspace`；zh 口径注入 → `个人工作区`；不注入 → 缺省回落不变；locale 映射（zh-TW/fr-FR/空串）；main 映射 × 两词典 `workspace.defaultName` 互锁 |

既有 `pages.test.ts:111` 的「首次运行 → 个人工作区」断言**语义不变**（未注入时的回落路径原样保留），全量测试通过。

## 2. B · S4 批次 3 巡检（只补 gating 缺口，不做改版）

CSS 交互态补缺（全部走 `var(--sc-*)`、过渡一律 `--sc-motion-fast`=120ms ≤150ms、每文件带 `prefers-reduced-motion` 兜底）：

| 文件 | 补缺 |
| --- | --- |
| `App.css` | `.app-nav-row:active`（accent-soft，同 trash/search-res 口径）；`.app-side-foot:hover/:active`（回收站底行原本无任何 hover 反馈）；`.app-nav-suffix:active`；reduced-motion 块扩入 `.app-nav-suffix` |
| `SearchPage.css` | `.search-chip` 补过渡 + `:active`；`.search-qchip` 补过渡 + `:active`（实心胶囊按压反转 accent/on-accent）；reduced-motion 块扩入两 chip |
| `CommandPalette.css` | `.palette-row:active`（见 §发现 5：刻意不加过渡） |
| `ImportWizard.css` | `.wiz-drop` 补过渡 + `:active` + reduced-motion 块 |
| `SyncStatus.css` | `.sc-sync-status__pill` 补过渡 + `:hover` + `:active`（顶栏状态钮原本 hover 零反馈）；`.sc-sync-status__button` 补过渡 + `:active:not(:disabled)`；reduced-motion 块扩入 |

`TrashList.css`（hover/active/过渡/兜底）本轮巡检**已齐备，未动**。

`apps/desktop/test/ui-interaction-audit.test.ts`（新，9 用例）静态门禁：
- 过渡纪律：renderer 全部 CSS 的 transition 一律 `var(--sc-motion-fast)`、禁字面 ms、禁超 150ms 的 `--sc-motion-base`；`--sc-motion-fast` 源值断言 ≤150ms；
- 凡引入 transition 的文件必有 `prefers-reduced-motion: reduce` 块；
- 交互态清单（侧栏行/底行/箭头钮/回收站行/搜索结果行/两类 chip/面板行/拖放区/同步 pill 与按钮）hover/active 规则齐备、按压态走 token 色；
- disabled 与全局 `:focus-visible` 环（tokens.css）存在；
- 空态六类（`.pv-empty`/`.trash-empty`/`.search-empty`/`.tpl-empty`/`.app-nav-empty`/`.palette-empty`）font/color 同 token 组合（`--sc-text-ui-sm` + `--sc-color-ink-faint`），页面级另断言居中 + `--sc-space-xxl` 留白；
- 双主题：tokens.css 深色块映射四态依赖的全部核心 token；renderer CSS 无字面 hex。

按钮与图标按钮：`Button`/`IconButton`/`Menu`/`Input` 等三态由 `@septcats/ui` 组件契约承担（hover/active/focus-visible/disabled 均在库内），packages 红线未动、巡检确认无缺口。

## 3. §发现（巡检缺口与未修理由）

1. **工作区改名入口缺失**（任务书 §0.A 顺带查）：`workspaces` slice 有 `renameWorkspace`（`state/pages.ts:534`）、main IPC 有 `CHANNEL_WORKSPACE_RENAME`，但 renderer **无任何 UI 入口**（侧栏/设置页均无）。按任务书只做种子，未做设置页 UI。用户当前改不了工作区名——后续里程碑需补一个入口（建议并入设置页，勿散在侧栏）。
2. **历史库种子不可追溯**：种子修复只对首次建库生效；已有库的「个人工作区」是数据不是文案，English 用户的老库仍显示中文名（真机验收请用全新库）。
3. **侧栏行/树行/回收站行是 div onClick**（无 tabindex/role=button）→ `focus-visible` 对这些行不适用；键盘可达性属既有缺口，涉及树交互改版，本轮不做（克制）。真实 button/input 的 focus 环由全局 tokens.css 兜底，已在门禁断言。
4. **空态间距语境差异（有理由保留）**：页面级（pv/trash/search）`margin-top: xxl + 居中`；行内/面板级（tpl/app-nav-empty）随行流无 margin；palette-empty 用 `padding: xl`（弹窗内）。字色/字号 token 完全一致（门禁钉死），间距差异是容器语境，非不一致。
5. **`.palette-row` 刻意不加 transition**：面板行高亮由键盘导航 `--active` 即时切换，加过渡会产生拖影感；仅补 `:active` 按压反馈。门禁对「有 transition 的文件」查兜底，对「无 transition」不强制，口径一致。
6. **`sc-sync-breathe` 呼吸动画 1.2s**：属状态指示动画非过渡，不纳入 ≤150ms 过渡口径；已有 `prefers-reduced-motion` 兜底（animation: none + 静态 0.8 透明度）。
7. **设置行/模板行无需行级交互态**：设置行是纯布局容器（控件在 `.settings-ctl` 内自带四态）；`.tpl-row` 本体不可点（只有「⋯」IconButton），加行 hover 反而是误导性 affordance。

## 4. §DEVIATION（逐条，待 PM 追认）

1. **D-1（红线内自裁）**：任务书允许「main/** 只增不改」；但种子修复无法用纯增量实现——`requireActiveWorkspace` 是唯一建库路径。实际改动：`pages.ts` 的种子名表达式一行改为 `options.defaultWorkspaceName ?? DEFAULT_WORKSPACE_NAME`（未注入时行为逐字节不变，`pages.test.ts` 既有断言原样通过）＋ `index.ts` 一处构造参数注入。属「最小改」，请 PM 确认口径。
2. **D-2**：新增导出 `defaultWorkspaceNameForLocale` 落在 `main/pages.ts`（该文件不 import electron 的纪律保持）。locale→名映射在 main 侧维护，未让 main 直接 import renderer i18n 词典（main/renderer 打包边界）；一致性由 `workspace-seed.test.ts` 的互锁断言保证（词典值 ↔ 映射输出必须相等）。
3. **D-3**：`workspace.defaultName` 键在 renderer 词典新增但 renderer 源码无人调用 `t('workspace.defaultName')`——种子在 main 侧生成（main 不可引用 renderer 词典），键作为文案单一基准存在并被层测钉住。若 PM 认为应删键改注释口径，改动很小，但会失去词典互锁。
4. **D-4**：`.search-qchip:active` 采用反转底色（accent-soft→accent、文字→on-accent），比其他元素的 accent-soft 按压 stronger——实心胶囊的按压需可辨，否则与静态态无异。属克制的样式补缺而非改版，请 PM 复核截图。
5. **D-5**：巡检门禁测试（`ui-interaction-audit.test.ts`）直接读 `packages/ui/src/tokens.css`（只读，不写 packages/**）以断言 `--sc-motion-fast ≤150ms`、深色主题映射与全局 focus 环。跨包只读引用，如认为越界可改为复制常量（会失去单源校验）。

## 5. 自跑

| 命令 | 结果 |
| --- | --- |
| `pnpm -C apps/desktop test` | 39 文件 / **422 passed**（含新增 workspace-seed 5 + ui-interaction-audit 9） |
| `pnpm -r typecheck` | 全绿 |
| `node packages/ui/tokens/no-magic.mjs` | ✓（无字面 hex、无非 1px 重复裸 px） |
| `node packages/ui/tokens/build-tokens.mjs --check` | ✓（token 产物与 DESIGN.md 一致） |

## 6. PM 复跑节

（PM 补）：全仓 + selftest + 重打包 + 真机（English 全新库首次启动整页 CJK=0 含工作区名；交互态与空态双主题截图；存量库工作区名不动的确认）。

## §6 PM 复跑（2026-09-19）

```
pnpm -r typecheck → 9/9 Done，0 错
pnpm -r test      → 全仓 1004 无红（desktop 408→422 = +14：workspace-seed 5 + ui-interaction-audit 9）
no-magic ✓ / build-tokens --check ✓
红线核对：packages/** 与 shared/** 零改动；main 侧仅 D-1 声明的最小注入（PagesServiceOptions.defaultWorkspaceName + defaultWorkspaceNameForLocale）
```

**PM 真机复核口径（诚实说明）**：本单改动了 main 侧种子逻辑，**真机复核（English 首次启动整页 CJK=0，含工作区名）安排在 T28-01（P0）修完后的统一重建里一并执行**，届时用 `docs/mockups/cdp-e2e-t26-01.mjs` 复跑留证；层测已覆盖「英文 locale 种子 = Personal Workspace」。

**DEVIATIONS 追认**：①D-1 main 侧一行最小注入（renderer 无法先于建库拦截）✓ 合理且已声明；②`.palette-row` 刻意不加过渡（键盘导航即时口径）、div 行 focus-visible N/A —— 接受（§发现 3/5）；③空态六类 font/color 同 token、页面级居中留白钉死 ✓。
