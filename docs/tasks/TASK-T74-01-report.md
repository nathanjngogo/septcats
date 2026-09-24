# T74-01 交付报告（CB 填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T74-01.md`（任务书写基线 main `235f0c8`）
> **实际起手 HEAD = `d5de7b3`**（main，T73 已合入其上；`9641caa` 是 T73 的收口 docs 提交）——
> 按任务书「等 T73 合入后再跑本单」的串行排程执行，无并行单在跑。禁碰 git / 不建表 / 不加依赖，均已遵守。

## §1 交付概览（DoD 自检）

- [x] 局部像素 glyph 盘点清单（T66_LOCAL_GLYPHS 起点）
- [x] 全部收进 @septcats/ui（icons 出口），renderer 改 import 删局部
- [x] 外观零变化证据（frame-check G4 + 真机顶栏截图**逐像素 0 差异** + DOM 签名冻结测）
- [x] t58 豁免名单收口（清空 + 反蔓延断言）
- [x] ui 图标导出测 + desktop 顶栏渲染测

### 1.1 盘点清单（起点 = t58 的 `T66_LOCAL_GLYPHS` 豁免名单）

grep 口径：`pixelGlyph|makeLocalGlyph|LocalGlyphProps|scanRuns`（全仓 `apps/**` + `packages/**`，排除 node_modules）。
命中的**局部像素 glyph 只有下面两个文件**，与豁免名单四名一一对应，无名单外遗漏（`theme/ThemePaletteButton.tsx`、`workbench/cards.tsx` 等只是消费点）。

| # | 原文件（应用层局部实现） | 导出组件 | 像素矩阵常量 | 应用层消费点 |
|---|---|---|---|---|
| 1 | `apps/desktop/src/renderer/src/workbench/pixelGlyph.tsx` | `PixelHomeGlyph` | `HOME_HOUSE_GLYPH` | `workbench/WorkbenchPage.tsx`（标题 20px / 欢迎条 24px） |
| 2 | 同上 | `PixelTodoGlyph` | `TODO_CHECK_GLYPH` | `workbench/cards.tsx`（待办卡头 16px） |
| 3 | 同上 | `PixelShopGlyph` | `SHOP_SHELF_GLYPH` | `App.tsx` 顶栏「工作台模板市场」钮、`workbench/TemplateMarketPage.tsx`（标题 20px） |
| 4 | `apps/desktop/src/renderer/src/theme/pixelGlyph.tsx` | `PixelPaletteGlyph` | `PALETTE_GLYPH` | `theme/ThemePaletteButton.tsx` → `App.tsx` 顶栏「配色画廊」钮 |

### 1.2 落地方式

1. 新增 `packages/ui/src/icons.tsx`：四枚矩阵 **逐字符原样搬运**（含 `Shop` 的参差行宽）+ 四枚组件出口；
2. `packages/ui/src/pixelIcons.tsx`：新增导出 `createPixelGlyph(grid, displayName)`（族内 `makeGlyph` 改为它的薄封装）——族内/族外共用**同一条渲染管线**（同一 `scanRuns` 合并规则 + 同一 tone→opacity 档），这是零外观变化的形式保证；`PIXEL_GLYPHS` 块与 `TONE_OPACITY`/`GLYPH_TONES` 一字未动；
3. `packages/ui/src/Icon.tsx`（全仓唯一图标出口 §16.6）：转出口四枚 + `PIXEL_GLYPHS_EXTRA`；
4. renderer 五处改 import（`@septcats/ui`），删除两份局部 `pixelGlyph.tsx`（-261 行）。

### 1.3 外观零变化的三重证据

| 证据 | 方法 | 结果 |
|---|---|---|
| 数据层 | 脚本逐字符比对「旧局部文件 ↔ `icons.tsx`」 | 四枚 16 行逐字符等价（`Shop` 行宽剖面 `[16,16,16,15,15,16,15,15,15,15,14,14,16,16,16,16]` 原样） |
| DOM 层 | 迁移前实渲染捕获四枚组件 + 顶栏 in-situ 的 rect 清单（坐标/合并宽度/opacity 档），迁移后逐条比对 | `t74-01-glyph-collection.test.tsx` 5/5 PASS（基线 literals 未动一字） |
| 真机层 | 迁移前后各跑一次 `cdp-e2e-t58-01.mjs`，PNG 逐像素对照 | **7/7 张 0 差异像素、最大通道差 0**（含顶栏动作区 4× 放大浅/深两态 1224×144） |

## §2 用例计数

| 门 | 命令 | 迁移前 | 本单后 | 增量 |
|---|---|---|---|---|
| typecheck | `pnpm -r --no-bail run typecheck` | 0 error（9 project） | **0 error（9 project）** | 0 |
| desktop vitest | `pnpm -C apps/desktop test` | 同条件=1041−6=1035 例（推算，见下方口径说明） | **97 文件 / 1041 例，0 失败 0 跳过** | **+6**（`t58-pixel-icons` +1、新 `t74-01-glyph-collection` +5），无删除用例 |
| ui vitest | `pnpm -C packages/ui test` | 32 文件 / 157 例 | **33 文件 / 168 例** | **+11**（新 `icons.test.tsx`） |
| no-magic | `pnpm -C packages/ui lint:magic` | ✓ | **✓** | — |
| 附带（T58 资产表门禁） | `node scripts/check-pixel-icons.mjs` | ✓ 28 枚 | **✓ 28 枚全绿**（族外新增未污染资产表；产物 PNG 重跑后 git 无差异） | 0 |
| 真机 t58 探针 | `node docs/mockups/cdp-e2e-t58-01.mjs` | 14 PASS / 0 FAIL | **14 PASS / 0 FAIL** | 0（逐条 raw 相同） |
| 真机 frame-check | `node docs/mockups/probe-frame-check.mjs` | — | **10 PASS / 0 FAIL**（G4 描边抽检 checked=61 bad=[]） | — |

> 计数口径说明：T73 台账里的 desktop「921」与本次「1041」是不同 ABI/DB 用例口径下的绝对值（本单跑前 `pretest` 执行
> `ensure-abi node`，better-sqlite3 对 node 侧可用 → DB 相关用例全部真跑，`0 skipped`）。「只增不减」按**用例清单增删**判定：
> 本单只新增 6 例、未删除/未屏蔽任何用例，全量 1041 例 0 失败 0 跳过。

构建面副证：迁移后 `pnpm -C apps/desktop build` 产物 JS 由 2147.34 kB → 2144.67 kB（拷贝的画法去重），
CSS 产物哈希/体积**完全未变**（`index-BYtZFPwQ.css` 203.10 kB）——纯逻辑搬迁，样式面零动。

## §3 DEVIATION 登记

| 编号 | 现象 | 取舍 | 理由 |
|---|---|---|---|
| D-1 | 任务书建议「如 `@septcats/ui/icons` 出口」，实际未新开 `package.json` 的 `./icons` 子路径 | 取 **`Icon.tsx`（既有唯一图标出口）转出口 + index 透出**，即 `import { PixelShopGlyph } from '@septcats/ui'` | ① `DESIGN.md`/`index.ts` 纪律 = 组件层唯一入口，再开子路径等于第二入口；② t58 纪律测的口径本就是 `import * as ui from '@septcats/ui'` 逐名判 `typeof === 'function'`，索引单出口才让豁免清零成立。模块名仍叫 `icons.tsx`（文件即「icons 出口」） |
| D-2 | 触碰了族文件 `packages/ui/src/pixelIcons.tsx`（新增 `createPixelGlyph` 导出，`makeGlyph` 改为其薄封装） | 接受：只加不改数据 | 原文件带 `makeGlyph` 是私有的、且键死在 `PixelGlyphName` 上，族外 glyph 无法复用 → 若在 `icons.tsx` 里再抄一份 scanRuns 就是「把债从应用层搬到设计系统内部」。共享同一管线是零外观变化的**充分条件**；`PIXEL_GLYPHS` / `TONE_OPACITY` / `GLYPH_TONES` 未动，`check-pixel-icons.mjs` 28/28 同源全绿 + PNG 产物重跑无 diff 为佐证 |
| D-3 | `Shop` glyph 行宽参差（第 3/4/6..9 行 15 格、第 10/11 行 14 格），未按族契约对齐成 16 列 | **原样保留** | 红线「路径数据原样搬运、禁顺手优化」。按实际行宽取格是它当前外观的一部分（行尾之外即空），对齐即改外观。已在 `icons.tsx` 注释、`icons.test.tsx`（行宽剖面断言）、`t74-01-glyph-collection.test.tsx`（基线 rect 清单）三处钉死，防止后人「修 bug 式」对齐 |
| D-4 | 四枚族外 glyph **不进** `PIXEL_GLYPHS` 资产表，单独成表 `PIXEL_GLYPHS_EXTRA` | 接受「不进资产表」的代价 | T58 §1.3 的 28 枚口径与 `assets/icons/png/**` 112 张 PNG 门禁、`scripts/gen-pixel-glyphs.mjs` 资产表是**逐格同源**的强绑定（多一枚即红）。把它们并入会同时动资产表、PNG 产物、墨迹占比门禁。代价：这四枚暂无 16/24px PNG 质检产物与墨迹带门禁（由 ui 侧矩阵/渲染测 + 真机像素对照覆盖） |
| D-5 | `displayName` 由 `Pixel*GlyphLocal` 改为 `Pixel*Glyph`（`createPixelGlyph` 的 `displayName` 参数） | 接受 | 组件身份从「应用层局部实现」变为「设计系统族外成员」，`Local` 后缀已不成立。`displayName` 不参与渲染、无任何测试/CSS 依赖（全仓 grep `displayName` 仅 `pixelIcons.tsx` 自身命中），不影响外观 |
| D-6 | 报告归档的截图落在 `docs/mockups/screens-t58/**`（探针固定产物路径，覆盖上一轮 PM 同名单据；迁移前基线已另存 `_scratch/t74-01/before/`） | 接受 | 探针产物路径是探针既有契约，本单不改探针；基线副本与 diff 脚本留在 `_scratch/t74-01/`，PM 可随时复算 |

（`docs/mockups/screens-t66/t6-restart-home.png`、`screens-t66/t66-01-results.json`、`screens-t71/t71-results.json`
在**本单开工前就已是 modified**（PM 早前复跑的产物），CB 未触碰。）

## §4 文件改动清单

新增（3）：

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/ui/src/icons.tsx` | 112 | 族外四枚 glyph：矩阵原样搬运 + `createPixelGlyph` 出口 |
| `packages/ui/src/icons.test.tsx` | 209 | ui 层测：出口面 / 矩阵与行宽冻结 / 渲染矩阵 / 管线契约 / rect 快照锚 |
| `apps/desktop/test/t74-01-glyph-collection.test.tsx` | 402 | 桌面层测：四枚直渲 + 顶栏 in-situ 迁移前基线逐条冻结 / 像素族几何护栏 |

修改（6）：

| 文件 | 改动 |
|---|---|
| `packages/ui/src/pixelIcons.tsx` | +19/-6：新增 `createPixelGlyph` 导出；`makeGlyph` 改薄封装（数据/表一字未动） |
| `packages/ui/src/Icon.tsx` | +5：转出口四枚 + `PIXEL_GLYPHS_EXTRA` + `ExtraPixelGlyphName` |
| `apps/desktop/src/renderer/src/App.tsx` | 删局部 import → 并入 `@septcats/ui` import；两处注释同步收编事实 |
| `apps/desktop/src/renderer/src/workbench/WorkbenchPage.tsx` | import `PixelHomeGlyph` 改自 `@septcats/ui` |
| `apps/desktop/src/renderer/src/workbench/cards.tsx` | import `PixelTodoGlyph` 改自 `@septcats/ui` |
| `apps/desktop/src/renderer/src/workbench/TemplateMarketPage.tsx` | import `PixelShopGlyph` 改自 `@septcats/ui` |
| `apps/desktop/src/renderer/src/theme/ThemePaletteButton.tsx` | import `PixelPaletteGlyph` 改自 `@septcats/ui`；文件头注释同步 |
| `apps/desktop/test/t58-pixel-icons.test.ts` | `T66_LOCAL_GLYPHS` 清空 + 「必须为空」断言 + 新增反蔓延用例（四枚是 ui 出口、无 `makeLocalGlyph` 残留、两份局部文件已删） |

删除（2）：

| 文件 | 行数 | 说明 |
|---|---|---|
| `apps/desktop/src/renderer/src/workbench/pixelGlyph.tsx` | -152 | T66-01 局部实现，整份删除 |
| `apps/desktop/src/renderer/src/theme/pixelGlyph.tsx` | -109 | T65-01 局部实现，整份删除 |

含探针/门禁产物（非代码）：`docs/mockups/screens-t58/**`（7 PNG + results.json，探针重跑覆盖）、
`docs/mockups/frame-check-results.json`（frame-check 重跑）、`docs/perf-history.jsonl`（perf 用例追加）。
净增删：`git diff --stat` = 10 files changed, 55 insertions(+), 285 deletions(-)（未含 3 个新文件）。

## §5 门禁原始输出

### 5.1 typecheck

```
$ pnpm -r --no-bail run typecheck
Scope: 9 of 10 workspace projects
packages/core typecheck$ tsc -p tsconfig.json --noEmit
packages/platform typecheck$ tsc -p tsconfig.json --noEmit
packages/ui typecheck$ tsc -p tsconfig.json --noEmit
packages/platform typecheck: Done
packages/core typecheck: Done
packages/ui typecheck: Done
packages/dbview typecheck$ tsc -p tsconfig.json --noEmit
packages/editor typecheck$ tsc -p tsconfig.json --noEmit
packages/schema typecheck$ tsc -p tsconfig.json --noEmit
packages/sync typecheck$ tsc -p tsconfig.json --noEmit
packages/schema typecheck: Done
packages/sync typecheck: Done
packages/editor typecheck: Done
packages/dbview typecheck: Done
packages/importer typecheck$ tsc -p tsconfig.json --noEmit
packages/importer typecheck: Done
apps/desktop typecheck$ tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit
apps/desktop typecheck: Done
```

### 5.2 desktop vitest

```
$ pnpm -C apps/desktop test
> @septcats/desktop@0.4.2-rc.1 pretest E:\Hermes Agent工作空间\Septcats\apps\desktop
> node scripts/ensure-abi.mjs node

> @septcats/desktop@0.4.2-rc.1 test E:\Hermes Agent工作空间\Septcats\apps\desktop
> vitest run

 stdout | test/perf.test.ts > perf：G4 §9.2 硬指标基线（TASK-T14-01） > 1 万页账本 rebuildFromSegments 全量重建 <5000ms（投影重建基线）
  [perf] rebuildFromSegments 1 万页 = 1597.3 ms （segments=14 ops=34244 entities=34244，预算 5000 ms）
stdout | test/perf.test.ts > perf：G4 §9.2 硬指标基线（TASK-T14-01） > 1 万页库冷打开 + migrate + 首查 <800ms（首屏预算的 DB 段）
  [perf] 冷打开+migrate+首查 = 44.9 ms （open+migrate=5.1 + 首查=39.8，预算 800 ms）

 ✓ test/perf.test.ts (4 tests) 26387ms
   ✓ perf：G4 §9.2 硬指标基线（TASK-T14-01） > 冷进程打开 1 万页真库 → 第一次搜索 ≤150ms（搜索红线的冷态账）  310ms
   ✓ perf：G4 §9.2 硬指标基线（TASK-T14-01） > 1 万字页 200 块 commitOps batch 落库 P95 ≤16ms（输入延迟的提交路径等价物）  330ms
   ✓ perf：G4 §9.2 硬指标基线（TASK-T14-01） > 1 万页账本 rebuildFromSegments 全量重建 <5000ms（投影重建基线）  1747ms

 Test Files  97 passed (97)
      Tests  1041 passed (1041)
   Start at  09:20:46
   Duration  29.42s (transform 4.14s, setup 0ms, collect 42.54s, tests 95.90s, environment 36.06s, prepare 13.64s)
```

本单两个目标文件的逐条输出（同一次全量跑内）：

```
 ✓ test/t58-pixel-icons.test.ts (8 tests) 44ms
 ✓ test/t74-01-glyph-collection.test.tsx (5 tests) 239ms
```

### 5.3 ui vitest

```
$ pnpm -C packages/ui test
 ✓  ui  test/pixel-icon-contrast.test.ts (4 tests) 12ms
 ✓  ui  test/borders-t59.test.ts (11 tests) 15ms

 Test Files  33 passed (33)
      Tests  168 passed (168)
   Start at  09:18:35
   Duration  4.65s (transform 831ms, setup 7.08s, collect 2.49s, tests 2.96s, environment 25.14s, prepare 5.41s)
```

### 5.4 no-magic

```
$ pnpm -C packages/ui lint:magic
> @septcats/ui@0.0.0 lint:magic E:\Hermes Agent工作空间\Septcats\packages\ui
> node tokens/no-magic.mjs

✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
```

### 5.5 附带门禁：T58 像素资产表同源门禁（`scripts/check-pixel-icons.mjs`）

```
$ node scripts/check-pixel-icons.mjs
① 同源：资产 28 枚 ↔ 运行时 28 枚，逐格不等价 0 枚
② 半透明像素：0（要求 0）
③ 色相：非法像素 0（要求 0；合法色 = 背景 ∪ 前景×{1,0.8,0.72} 压底色）
④ 16px 墨迹占比（带 18–46%）：…
⚠ 5 枚以下低于 18% 下限，属 PM 定稿资产属性（T58-01 D-1）：Plus 14.06% / Check 10.16% / Close 14.84% / ArrowClockwise 14.06% / ArrowsClockwise 17.97%
✓ 像素图标门禁全绿：28 枚 × {16,24}px × {浅,深} 硬边直画，同源/半透明/色相/墨带 四项通过

$ git status --short assets/
（空 —— 重跑产物与既有 PNG 逐字节一致，资产表未被族外新增污染）
```

### 5.6 t58 探针复跑（迁移**后**；原始输出）

```
$ node docs/mockups/cdp-e2e-t58-01.mjs
INFO  [boot] 夹具  — UD=E:\Hermes Agent工作空间\_scratch\t58-01\ud ROOT=E:\Hermes Agent工作空间\_scratch\t58-01\data APPDIR=E:\Hermes Agent工作空间\Septcats\apps\desktop
INFO  [boot] 运行时 glyph 表  — 28 枚；tone 档 1/0.8/0.72
PASS  [G0|fixture] G0-1 夹具成立：真建页 + 真键入正文（存活页 ≥2、编辑器块 ≥2）  — {"tabs":2,"alive":2,"blocks":2}
INFO  [G1|toolbar-family] 顶栏图标钮（原始）  — [{"label":"工作台模板市场","viewBox":"0 0 16 16","crisp":"crispEdges","rects":52,"stroke":null},{"label":"配色画廊","viewBox":"0 0 16 16","crisp":"crispEdges","rects":37,"stroke":null},{"label":"搜索（Ctrl+K）","viewBox":"0 0 16 16","crisp":"crispEdges","rects":16,"stroke":null},{"label":"AI 对话（Ctrl+J）","viewBox":"0 0 16 16","crisp":"crispEdges","rects":25,"stroke":null},{"label":"导入","viewBox":"0 0 16 16","crisp":"crispEdges","rects":10,"stroke":null},{"label":"布局","viewBox":"0 0 16 16","crisp":"crispEdges","rects":30,"stroke":null},{"label":"设置","viewBox":"0 0 16 16","crisp":"crispEdges","rects":24,"stroke":null}]
PASS  [G1|toolbar-family] G1-1 顶栏图标钮一个不漏都是像素族（viewBox 0 0 16 16 + crispEdges + rect 网格）  — 钮数=7 非像素族=[]
PASS  [G1|toolbar-family] G1-2 无描边残留（phosphor 时代 stroke-width 属性在顶栏图标上一律不存在）  — 工作台模板市场:null 配色画廊:null 搜索（Ctrl+K）:null AI 对话（Ctrl+J）:null 导入:null 布局:null 设置:null
PASS  [G2|pixel-proof] G2-0 AI 钮定位 + 像素族几何（viewBox/crispEdges/无 stroke-width）  — {"pressed":"false","viewBox":"0 0 16 16","crisp":"crispEdges","rects":25}
INFO  [G2|pixel-proof] AI 钮 8× 放大截图  — bytes=824 clip={"x":964,"y":5,"width":28,"height":28}
INFO  [G2|pixel-proof] 像素采样（原始）  — {"illegal":[],"illegalCount":0,"mismatch":0,"size":{"w":224,"h":224}}
PASS  [G2|pixel-proof] G2-1 硬边证明：8× 放大图全部像素落在「底色 ∪ 前景×{1,0.8,0.72} ∪ 关态眼档{0.35,0.55}」离散集内（零抗锯齿中间色）  — 非法像素=0 样本=[]
PASS  [G2|pixel-proof] G2-2 像素级证据：8× 放大图逐格采样掩码 == AiRobot 资产矩阵（16×16 全等）  — 不等格数=0
PASS  [G3|ai-two-state] G3-1 关态明暗实测（getComputedStyle）：眼 = 0.35、天线 = 0.55  — eye=0.35 antenna=0.55 aria-pressed=false
PASS  [G3|ai-two-state] G3-2 开态明暗实测：眼 = 1、天线 = 1（与关态唯一差别是明暗，几何完全一致）  — eye=1 antenna=1 几何同=true pressed=true
PASS  [G3|ai-two-state] G3-3 面板打开且标题栏图标同族（像素机器人头：眼分组 4 条横条 + crispEdges）  — {"open":true,"headEyes":4,"headCrisp":"crispEdges"}
PASS  [G3|ai-two-state] G3-4 再点回关态：眼/天线明暗回 0.35/0.55 且面板已收起（两态可反复往返）  — eye=0.35 antenna=0.55 pressed=false
INFO  [G4|screens] 浅色主界面视图态  — {"pvRoot":true,"tabRow":true,"settings":false}
PASS  [G4|screens] G4-1 深色主题下同为像素族且两态明暗按同一 CSS 档生效（关态 0.35/0.55）  — data-theme=dark eye=0.35 antenna=0.55
INFO  [G4|screens] 设置页/整屏图标族抽样  — {"count":20,"allPixel":true}
PASS  [G4|screens] G4-2 整屏图标（侧栏 + 顶栏 + 设置页）零漏网：全部是像素族几何（无 phosphor 混族残留）  — {"count":20,"allPixel":true}
PASS  [G4|screens] G4-3 截图 ≥4 张且逐张拍在对的视图（浅色主界面 / 顶栏放大 / AI 面板开 / 深色主界面 / 设置页）  — t58-01-ai-panel-open.png t58-01-editor-light.png t58-01-actions-zoom4x.png t58-01-editor-dark.png t58-01-actions-dark-zoom4x.png t58-01-settings-light.png
PASS  [teardown] G5-1 退出干净：window.close() 优雅退出（未强杀）  — {"gracefulExited":true,"forced":false}

===== T58-01：14 PASS / 0 FAIL =====
realRoot untouched=true
```

迁移**前**同一条探针（同夹具、同版本 out/ 重建链）：`===== T58-01：14 PASS / 0 FAIL =====`，
G1 原始行逐字相同（`rects` 52 / 37 / 16 / 25 / 10 / 30 / 24）。

### 5.7 顶栏截图迁移前后逐像素对照（硬约束的直接证据）

```
$ node _scratch/t74-01/pixel-diff.mjs _scratch/t74-01/before docs/mockups/screens-t58
IDENTICAL  t58-01-actions-dark-zoom4x.png     1224×144 差异像素=0/176256 最大通道差=0
IDENTICAL  t58-01-actions-zoom4x.png          1224×144 差异像素=0/176256 最大通道差=0
IDENTICAL  t58-01-ai-closed-zoom8x.png        224×224 差异像素=0/50176 最大通道差=0
IDENTICAL  t58-01-ai-panel-open.png           1184×735 差异像素=0/870240 最大通道差=0
IDENTICAL  t58-01-editor-dark.png             1184×735 差异像素=0/870240 最大通道差=0
IDENTICAL  t58-01-editor-light.png            1184×735 差异像素=0/870240 最大通道差=0
IDENTICAL  t58-01-settings-light.png          1184×735 差异像素=0/870240 最大通道差=0
✓ 全部截图逐像素 0 差异
```

SHA-256 前 16 位亦逐张相同（`actions-zoom4x=755857847d07a7f0`、`actions-dark-zoom4x=ee28cb03cc705fc6`）；
`t58-01-results.json` 除 `ranAt` 时间戳外无差异（`diff` 仅 1 处）。
迁移前基线副本：`E:\Hermes Agent工作空间\_scratch\t74-01\before\`（7 PNG + results.json + `dom-baseline.txt`）。

### 5.8 frame-check 整帧体检（G4 描边抽检）

```
$ node docs/mockups/probe-frame-check.mjs
PASS  EXE 启动+CDP 连上  — pid=27748
PASS  G1 整窗零滚动（横/纵）  — {"sw":1184,"cw":1184,"sh":735,"ch":735}
PASS  G2 壳层三件在场且不出屏  — {"side":"ok","topbar":"ok","market":"ok"}
PASS  G3 计算族名命中思源/Noto（非系统兜底）  — {"fam":"\"Noto Sans SC\", \"Source Han Sans SC\", \"Noto Sans CJK SC\", \"M","hit":true}
PASS  G7-1 新建页标题在树中（真实数据链）  — true
PASS  G2b 开页后页签条挂载且含活动页签  — ok:1
PASS  G4 描边色=ink-edge 抽检  — edge=RGB(26,26,26) checked=61 bad=[]
PASS  G5 data-theme 切换 ink-edge 换值  — {"before":"#1A1A1A","after":"#EDEDED"}
PASS  G6 无占位/模板残留词  — []
PASS  G7-2 命令面板搜到新建页（FTS 真链）  — true

===== frame-check：10 PASS / 0 FAIL =====
PASS  T 真实数据根未被触碰  — before=1790212008806.7554
```

### 5.9 迁移前 DOM 基线捕获（`t74-01-glyph-collection.test.tsx` 的 literals 来源）

一次性捕获脚本（跑完即删，不入仓）的原始输出，长行按 96 字符截断、`…` 为截断标记：

```
$ pnpm -C apps/desktop test test/zz-t74-capture.test.tsx
BASE_DIRECT={"PixelHomeGlyph":{"viewBox":"0 0 16 16","shapeRendering":"crispEdges","focusable":"false","cl…
BASE_VIA_ICON={"PixelShopGlyph":{"viewBox":"0 0 16 16","shapeRendering":"crispEdges","focusable":"false","…
BASE_TOPBAR=[{"label":"工作台模板市场","viewBox":"0 0 16 16","shapeRendering":"crispEdges","focusable":"fals…
 ✓ test/zz-t74-capture.test.tsx (2 tests) 137ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

同一输出的 rect 条数（未截断部分逐条可见）：`Home 29 / Todo 25 / Shop 52 / Palette 37`；
`BASE_TOPBAR` 七个钮依次 `52 / 37 / 16 / 25 / 10 / 30 / 24`——与 §5.6 真机探针 G1 原始行**完全一致**（DOM 层与真机层互证）。
四条完整 rect 清单（未截断）已固化为测试 literals，见 `apps/desktop/test/t74-01-glyph-collection.test.tsx` 的
`BASELINE_HOME` / `BASELINE_TODO` / `BASELINE_MARKET_BUTTON` / `BASELINE_PALETTE_BUTTON`；
全文留档 `_scratch/t74-01/before/dom-baseline.txt`。

## §6 数据搬迁逐字符等价校验（原始输出）

```
$ node _scratch/t74-01/verify-data.mjs
SAME  Home     行数 16→16 行宽 [16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16]
SAME  Todo     行数 16→16 行宽 [16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16]
SAME  Shop     行数 16→16 行宽 [16,16,16,15,15,16,15,15,15,15,14,14,16,16,16,16]
SAME  Palette  行数 16→16 行宽 [16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16]
✓ 四枚 glyph 数据逐字符等价（旧局部文件 ↔ packages/ui/src/icons.tsx）
```

## §7 PM 复跑节（PM 补）

（留空：`typecheck` / `desktop vitest` / `ui vitest` / `no-magic` / `cdp-e2e-t58-01` / `probe-frame-check` 逐项复核）

CB-T74-01-EXIT=0
